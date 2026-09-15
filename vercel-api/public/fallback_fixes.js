// ═══════════════════════════════════════════════════════
// fallback_fixes.js v3.0 — الخط الثاني للإصلاح (محافظ ومُتحقَّق)
//
// القاعدة: لا يُطبَّق إلا إصلاح deterministic مؤكد لا يغيّر دلالة الكود.
// كل ما عداه لا يُلمس ويُعاد كـ AI_REQUIRED مع سبب واضح.
// كل إصلاح يمر بتحقق بنيوي + idempotency + المحلل (إن وُجد)، وعند فشل
// أي فحص يُرجَع هذا الإصلاح وحده إلى حالته الأصلية.
//
// الواجهة العامة (بلا تغيير للمستهلكين الحاليين):
//   fallbackFix(code, fileName, issues)
//     → { fixed, repairs, aiRequired, skipped, lang, verification }
//   applyFallbackToAll(F, R)
//     → { totalFixed, results, aiRequired, rolledBack }
// ═══════════════════════════════════════════════════════

"use strict";

// ─── 1. هوية اللغة: من الامتداد فقط — لا تخمين من المحتوى ─────
// أي امتداد خارج هذه القائمة ⇒ لا يُلمس الملف إطلاقاً (html/kt/java/go/…)
const FB_LANG_BY_EXT = {
  js: 'js', mjs: 'js', cjs: 'js', jsx: 'js',
  ts: 'ts', tsx: 'ts',
  py: 'py',
  php: 'php',
};

function fbLangOf(fileName) {
  const name = String(fileName || '');
  const dot  = name.lastIndexOf('.');
  if (dot < 0) return null;
  const ext = name.slice(dot + 1).toLowerCase();
  return Object.prototype.hasOwnProperty.call(FB_LANG_BY_EXT, ext) ? FB_LANG_BY_EXT[ext] : null;
}

// ─── 2. تصنيف الثغرة إلى فئة fallback ───────────────────────
// الترتيب مهم: JWT قبل الباقي، وCMD قبل SQL (كلاهما "injection")
const FB_CATEGORY_RULES = [
  ['JWT',    /\bjwt\b|jsonwebtoken/i],
  ['CMD',    /command injection|os\.system|os\.popen|shell\s*=\s*true|cwe-78\b|cmd_injection|في exec\b|system command/i],
  ['SQL',    /\bsql\b|cwe-89\b|sqli\b/i],
  ['EVAL',   /\beval\b|new\s+function|code injection|cwe-0?94\b/i],
  ['TS_ANY', /\bany\b/],
];

// اللغات التي يملك fallback لها fixer آمن لكل فئة — غيرها ⇒ AI_REQUIRED
const FB_CATEGORY_LANGS = {
  EVAL:   ['js', 'ts', 'py'],
  SQL:    ['js', 'ts', 'py', 'php'],
  CMD:    ['py'],
  TS_ANY: ['ts'],
  JWT:    ['js', 'ts', 'py'],
};

function fbCategory(issue) {
  const text = [issue.title, issue.cAct].filter(Boolean).join(' | ');
  for (const [cat, re] of FB_CATEGORY_RULES) if (re.test(text)) return cat;
  return null;
}

// ─── 3. تحديد السطر: الدليل (ev) أولاً، ورقم السطر ثانياً ──────
// لا يُصلَح سطر مختلف بسبب انزياح الأرقام: إن وُجد دليل ولم يطابق سطره
// نبحث عن سطر وحيد يطابقه؛ وإلا لا إصلاح.
function fbResolveLine(lines, issue) {
  const ev  = String(issue.ev || '').trim();
  const num = Number(issue.line);
  const idx = Number.isFinite(num) ? Math.floor(num) - 1 : -1;
  const inRange = idx >= 0 && idx < lines.length;
  if (ev) {
    if (inRange && lines[idx].includes(ev)) return { idx };
    const hits = [];
    for (let i = 0; i < lines.length; i++) if (lines[i].includes(ev)) hits.push(i);
    if (hits.length === 1) return { idx: hits[0], relocated: true };
    return { idx: -1, reason: hits.length ? 'evidence_ambiguous' : 'evidence_mismatch' };
  }
  if (!inRange) return { idx: -1, reason: 'line_out_of_range' };
  return { idx };
}

// ─── 4. أدوات تحليل نصية صغيرة (واعية بالسلاسل) ─────────────
function fbEscapeRe(s) { return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
function fbCount(text, ch) { let n = 0; for (const c of text) if (c === ch) n++; return n; }

// يقسّم وسائط استدعاء بدءاً من ما بعد '(' عند الفواصل في العمق صفر.
// يعيد { args, closed, post } — post ما بعد ')' الإغلاق، أو null عند خلل.
function fbSplitCallArgs(text) {
  const args = [];
  let depth = 0, cur = '', q = null;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      cur += c;
      if (c === '\\') { cur += text[i + 1] || ''; i++; continue; }
      if (c === q) q = null;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') { q = c; cur += c; continue; }
    if (c === '(' || c === '[' || c === '{') { depth++; cur += c; continue; }
    if (c === ')' || c === ']' || c === '}') {
      if (depth === 0) {
        if (c !== ')') return null;
        args.push(cur);
        return { args, closed: true, post: text.slice(i + 1) };
      }
      depth--; cur += c; continue;
    }
    if (c === ',' && depth === 0) { args.push(cur); cur = ''; continue; }
    cur += c;
  }
  args.push(cur);
  return { args, closed: false, post: '' };
}

// معرّف بسيط (مع وصول خصائص/فهارس حرفية فقط) — لا استدعاءات ولا عمليات
const FB_IDENT_HEAD = {
  js:  /^[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*|\[(?:\d+|'[^'\\\n]*'|"[^"\\\n]*")\])*/,
  py:  /^[A-Za-z_]\w*(?:\.[A-Za-z_]\w*|\[(?:\d+|'[^'\\\n]*'|"[^"\\\n]*")\])*/,
  php: /^\$[A-Za-z_]\w*(?:->[A-Za-z_]\w*|\[(?:\d+|'[^'\\\n]*'|"[^"\\\n]*")\])*/,
};
function fbIsIdent(s, lang) {
  const re = FB_IDENT_HEAD[lang === 'ts' ? 'js' : lang];
  const m = String(s).match(re);
  return !!m && m[0].length === s.length;
}

// يحلّل تعبير سلسلة "نقي": literals + متغيرات بسيطة فقط، بلا escapes ولا
// دوال ولا عمليات أخرى. يدعم template literal (JS) وf-string (Python)
// والاستيفاء داخل "…" (PHP). يعيد [{lit}|{v}] أو null عند أي شيء آخر.
function fbParseConcat(expr, lang) {
  const s   = String(expr).trim();
  const L   = lang === 'ts' ? 'js' : lang;
  const op  = L === 'php' ? '.' : '+';
  const parts = [];
  let i = 0, expectOperand = true;

  function readQuoted(q, interp) {
    let j = i + 1, buf = '';
    const out = [];
    const flush = () => { if (buf) { out.push({ lit: buf }); buf = ''; } };
    while (j < s.length && s[j] !== q) {
      const c = s[j];
      if (c === '\\') return null;
      if (interp === 'js' && c === '$' && s[j + 1] === '{') {
        const end = s.indexOf('}', j + 2);
        if (end < 0) return null;
        const inner = s.slice(j + 2, end).trim();
        if (!fbIsIdent(inner, 'js')) return null;
        flush(); out.push({ v: inner }); j = end + 1; continue;
      }
      if (interp === 'py' && (c === '{' || c === '}')) {
        if (c === '}') return null;
        const end = s.indexOf('}', j + 1);
        if (end < 0) return null;
        const inner = s.slice(j + 1, end).trim();
        if (!inner || !fbIsIdent(inner, 'py')) return null;   // {{ أو format spec أو تعبير
        flush(); out.push({ v: inner }); j = end + 1; continue;
      }
      if (interp === 'php' && c === '{' && s[j + 1] === '$') {
        const end = s.indexOf('}', j + 2);
        if (end < 0) return null;
        const inner = s.slice(j + 1, end).trim();
        if (!fbIsIdent(inner, 'php')) return null;
        flush(); out.push({ v: inner }); j = end + 1; continue;
      }
      if (interp === 'php' && c === '$') {
        const m = s.slice(j).match(/^\$[A-Za-z_]\w*/);
        if (!m) return null;
        const after = s.slice(j + m[0].length, j + m[0].length + 2);
        if (after.startsWith('[') || after === '->') return null;  // استيفاء مركّب
        flush(); out.push({ v: m[0] }); j += m[0].length; continue;
      }
      buf += c; j++;
    }
    if (j >= s.length) return null;                 // سلسلة غير مغلقة
    if (buf || !out.length) out.push({ lit: buf });
    i = j + 1;
    return out;
  }

  while (i < s.length) {
    while (i < s.length && /\s/.test(s[i])) i++;
    if (i >= s.length) break;
    const c = s[i];
    if (expectOperand) {
      let got = null;
      if (c === '"' || c === "'") {
        got = readQuoted(c, L === 'php' && c === '"' ? 'php' : null);
      } else if (c === '`' && L === 'js') {
        got = readQuoted('`', 'js');
      } else if (L === 'py' && (c === 'f' || c === 'F') && (s[i + 1] === '"' || s[i + 1] === "'")) {
        i++; got = readQuoted(s[i], 'py');
      } else if (L === 'py' && /[rRbBuU]/.test(c) && (s[i + 1] === '"' || s[i + 1] === "'")) {
        return null;                                 // بادئات لا نتعامل معها
      } else {
        const m = s.slice(i).match(FB_IDENT_HEAD[L]);
        if (!m) return null;
        got = [{ v: m[0] }]; i += m[0].length;
      }
      if (!got) return null;
      parts.push(...got);
      expectOperand = false;
    } else {
      if (c !== op) return null;
      i++; expectOperand = true;
    }
  }
  if (expectOperand || !parts.length) return null;

  const merged = [];
  for (const p of parts) {
    const last = merged[merged.length - 1];
    if (p.lit !== undefined && last && last.lit !== undefined) last.lit += p.lit;
    else merged.push(Object.assign({}, p));
  }
  return merged;
}

// ─── 5. SQL: بناء استعلام مُعلَّم من أجزاء السلسلة ─────────────
const FB_SQL_HEAD = /^\s*\(?\s*(?:SELECT|INSERT|UPDATE|DELETE)\b/i;

// موضع قيمة؟ (بعد مقارنة، أو داخل VALUES(...)) — الأعمدة/الجداول/ORDER BY
// وقوائم IN وLIMIT ليست قيماً قابلة للتعليم بأمان.
function fbValuePositionOk(sqlSoFar) {
  const t = sqlSoFar.replace(/\s+$/, '');
  if (/\bBETWEEN\s+\S+\s+AND$/i.test(t)) return true;
  if (/(?:^|[\s(,])(?:ORDER\s+BY|GROUP\s+BY|FROM|INTO|UPDATE|JOIN|TABLE|LIMIT|OFFSET|SELECT|WHERE|AND|OR|NOT|IN|VALUES|BY|ON)$/i.test(t)) return false;
  if (/[=<>]$/.test(t) || /(?:^|\s)(?:LIKE|BETWEEN)$/i.test(t)) return true;
  const vIdx = t.search(/\bVALUES\s*\(/i);
  if (vIdx >= 0) {
    const seg = t.slice(vIdx);
    const open = fbCount(seg, '('), close = fbCount(seg, ')');
    if (open > close && /[(,]$/.test(t)) return true;
  }
  return false;
}

function fbBuildParamQuery(srcParts, phFn) {
  const parts = srcParts.map(p => Object.assign({}, p));
  if (!parts.some(p => p.v !== undefined)) return { skip: 'no_variable_parts' };
  if (parts[0].lit === undefined || !FB_SQL_HEAD.test(parts[0].lit)) return { reason: 'sql_statement_not_recognized' };
  const allLit = parts.filter(p => p.lit !== undefined).map(p => p.lit).join('');
  if (/\?|\$\d|%[sd]|(?:^|[^:\w]):[A-Za-z_]\w*/.test(allLit)) return { reason: 'existing_placeholders' };

  let sql = '';
  const params = [];
  for (let k = 0; k < parts.length; k++) {
    const p = parts[k];
    if (p.lit !== undefined) { sql += p.lit; continue; }
    const prev = parts[k - 1], next = parts[k + 1];
    if (!prev || prev.lit === undefined || (next && next.lit === undefined)) return { reason: 'adjacent_variables' };
    // '" + x + "'  ⇒  ?   (تغليف اقتباس متوازن فقط)
    const tailQ = /['"]$/.test(sql) ? sql[sql.length - 1] : '';
    const headQ = next && /^['"]/.test(next.lit) ? next.lit[0] : '';
    if (tailQ || headQ) {
      if (!tailQ || !headQ || tailQ !== headQ) return { reason: 'unbalanced_quoting' };
      sql = sql.slice(0, -1);
      next.lit = next.lit.slice(1);
    }
    if (/%$/.test(sql) || (next && /^%/.test(next.lit))) return { reason: 'like_wildcard_concat' };
    if (!fbValuePositionOk(sql)) return { reason: 'non_value_position' };
    if (next && /^[\w%]/.test(next.lit)) return { reason: 'placeholder_glued_to_text' };
    params.push(p.v);
    sql += phFn(params.length);
  }
  return { sql, params };
}

function fbQuoteSql(sql, lang) {
  if (/[\\\n\r]/.test(sql)) return null;
  if (lang === 'php') {
    if (!sql.includes("'")) return "'" + sql + "'";
    if (!sql.includes('"') && !sql.includes('$')) return '"' + sql + '"';
    return null;
  }
  if (!sql.includes('"')) return '"' + sql + '"';
  if (!sql.includes("'")) return "'" + sql + "'";
  return null;
}

function fbRenderParams(params, lang) {
  if (lang === 'py') return '(' + params.join(', ') + (params.length === 1 ? ',' : '') + ')';
  return '[' + params.join(', ') + ']';
}

// الـdriver يُستنتج من استيرادات الملف نفسه فقط — لا افتراض. صفر أو أكثر من
// driver واحد ⇒ API مجهولة ⇒ لا تحويل.
const FB_SQL_DRIVERS = {
  py: [
    { name: 'sqlite3',         ph: '?',  re: /^\s*(?:import\s+sqlite3\b|from\s+sqlite3\s+import\b)/m },
    { name: 'pyodbc',          ph: '?',  re: /^\s*(?:import\s+pyodbc\b|from\s+pyodbc\s+import\b)/m },
    { name: 'psycopg',         ph: '%s', re: /^\s*(?:import\s+psycopg2?\b|from\s+psycopg2?(?:\.\w+)*\s+import\b)/m },
    { name: 'pymysql',         ph: '%s', re: /^\s*(?:import\s+pymysql\b|from\s+pymysql(?:\.\w+)*\s+import\b)/m },
    { name: 'MySQLdb',         ph: '%s', re: /^\s*(?:import\s+MySQLdb\b|from\s+MySQLdb(?:\.\w+)*\s+import\b)/m },
    { name: 'mysql.connector', ph: '%s', re: /^\s*(?:import\s+mysql\.connector\b|from\s+mysql\.connector(?:\.\w+)*\s+import\b|from\s+mysql\s+import\s+connector\b)/m },
  ],
  js: [
    { name: 'mysql',   ph: '?',  methods: ['query', 'execute'],          re: /require\(\s*['"]mysql2?(?:\/promise)?['"]\s*\)|from\s+['"]mysql2?(?:\/promise)?['"]/ },
    { name: 'pg',      ph: '$n', methods: ['query'],                     re: /require\(\s*['"]pg['"]\s*\)|from\s+['"]pg['"]/ },
    { name: 'sqlite3', ph: '?',  methods: ['all', 'get', 'run', 'each'], re: /require\(\s*['"]sqlite3['"]\s*\)|from\s+['"]sqlite3['"]/ },
  ],
  php: [
    { name: 'pdo', ph: '?', re: /new\s+\\?PDO\s*\(/ },
  ],
};

function fbDetectDriver(code, lang) {
  const list = FB_SQL_DRIVERS[lang === 'ts' ? 'js' : lang] || [];
  const hits = list.filter(d => d.re.test(code));
  if (hits.length !== 1) return null;
  if (lang === 'php' && /mysqli/i.test(code)) return null;
  return hits[0];
}
function fbPlaceholderFn(driver) { return driver.ph === '$n' ? (n => '$' + n) : (() => driver.ph); }

const FB_PY_POST = /^\)(?:\s*\.\w+\(\s*\))*\s*(?:#.*)?$/;
const FB_JS_POST = /^\)(?:\s*\.\w+\(\s*\))*\s*;?\s*(?:\/\/.*)?$/;
const FB_JS_CALLBACK_HEAD = /^\s*(?:async\s*)?(?:function\b|\(|[A-Za-z_$][\w$]*\s*=>)/;
const FB_JS_PRE = /^\s*(?:(?:const|let|var)\s+(?:[\w$]+|\[[^\]]*\]|\{[^}]*\})\s*=\s*|[\w$.]+\s*=\s*|return\s+)?(?:await\s+)?$/;
const FB_PY_PRE = /^\s*(?:[\w.]+\s*=\s*|return\s+)?(?:await\s+)?$/;

// (أ) البناء والتنفيذ على السطر نفسه: X.execute("…" + v) / db.query(`…${v}`) / $pdo->query("… $v")
function fbSqlDirect(line, lang, driver, ph) {
  const callRe = lang === 'py'
    ? /([A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*)\.execute\(/
    : lang === 'php'
      ? /(\$[A-Za-z_]\w*(?:->[A-Za-z_]\w*)*)->query\(/
      : new RegExp('([A-Za-z_$][\\w$]*(?:\\.[A-Za-z_$][\\w$]*)*)\\.(?:' + driver.methods.join('|') + ')\\(');
  const m = line.match(callRe);
  if (!m) return null;
  const pre  = line.slice(0, m.index);
  const head = m[0];
  const preOk = lang === 'py' ? FB_PY_PRE.test(pre)
              : lang === 'php' ? /^\s*(?:\$[A-Za-z_]\w*\s*=\s*)?$/.test(pre)
              : FB_JS_PRE.test(pre);
  if (!preOk) return { reason: 'call_context_unclear' };
  const split = fbSplitCallArgs(line.slice(m.index + head.length));
  if (!split || !split.args.length) return { reason: 'call_syntax_unparsed' };

  const parts = fbParseConcat(split.args[0], lang);
  if (!parts) return { reason: 'query_expression_not_pure' };
  const built = fbBuildParamQuery(parts, ph);
  if (built.skip)   return { skip: built.skip };
  if (built.reason) return { reason: built.reason };
  const quoted = fbQuoteSql(built.sql, lang);
  if (!quoted) return { reason: 'query_quoting_unclear' };
  const params = fbRenderParams(built.params, lang);

  if (lang === 'py') {
    if (!split.closed || split.args.length !== 1 || !FB_PY_POST.test(')' + split.post)) return { reason: 'call_arguments_unclear' };
    return { text: pre + head + quoted + ', ' + params + ')' + split.post, note: 'استعلام مُعلَّم (' + driver.name + ')' };
  }
  if (lang === 'php') {
    if (!split.closed || split.args.length !== 1 || !/^\)\s*;\s*(?:\/\/.*|#.*)?$/.test(')' + split.post)) return { reason: 'call_arguments_unclear' };
    const indent = pre.match(/^\s*/)[0];
    const asg    = pre.match(/(\$[A-Za-z_]\w*)\s*=\s*$/);
    const obj    = m[1];
    const tail   = split.post;                           // ';' + تعليق اختياري
    const text = asg
      ? `${indent}${asg[1]} = ${obj}->prepare(${quoted});\n${indent}${asg[1]}->execute(${params})${tail}`
      : `${indent}${obj}->prepare(${quoted})->execute(${params})${tail}`;
    return { text, note: 'PDO prepare/execute بدل query مع سلسلة' };
  }
  // js / ts
  if (split.closed && split.args.length === 1) {
    if (!FB_JS_POST.test(')' + split.post)) return { reason: 'call_arguments_unclear' };
    return { text: pre + head + quoted + ', ' + params + ')' + split.post, note: 'استعلام مُعلَّم (' + driver.name + ')' };
  }
  if (split.args.length === 2 && FB_JS_CALLBACK_HEAD.test(split.args[1])) {
    if (split.closed && !FB_JS_POST.test(')' + split.post)) return { reason: 'call_arguments_unclear' };
    return { text: pre + head + quoted + ', ' + params + ',' + split.args[1] + (split.closed ? ')' + split.post : ''),
             note: 'استعلام مُعلَّم (' + driver.name + ')' };
  }
  return { reason: 'call_arguments_unclear' };
}

// (ب) الإسناد ثم التنفيذ: q = "…" + v  ⟶  X.execute(q)  (استخدام وحيد للمتغير)
function fbSqlAssign(lines, idx, lang, driver, ph) {
  const line = lines[idx];
  const m = lang === 'php'
    ? line.match(/^(\s*)(\$[A-Za-z_]\w*)(\s*=\s*)(.+?)(\s*;\s*(?:\/\/.*|#.*)?)$/)
    : lang === 'py'
      ? line.match(/^(\s*)([A-Za-z_]\w*)(\s*=\s*)(.+?)(\s*(?:#.*)?)$/)
      : line.match(/^(\s*(?:(?:const|let|var)\s+)?)([A-Za-z_$][\w$]*)(\s*=\s*)(.+?)(\s*;?\s*(?:\/\/.*)?)$/);
  if (!m) return null;
  const [, head, name, eq, rhs, tail] = m;
  const parts = fbParseConcat(rhs, lang);
  if (!parts) return null;
  const built = fbBuildParamQuery(parts, ph);
  if (built.skip)   return { skip: built.skip };
  if (built.reason) return { reason: built.reason };
  const quoted = fbQuoteSql(built.sql, lang);
  if (!quoted) return { reason: 'query_quoting_unclear' };

  const esc    = fbEscapeRe(name);
  const nameRe = new RegExp('(?:^|[^\\w$])' + esc + '(?![\\w$])');
  let execIdx = -1;
  for (let j = idx + 1; j < lines.length; j++) {
    if (!nameRe.test(lines[j])) continue;
    if (execIdx >= 0) return { reason: 'query_variable_reused' };
    execIdx = j;
  }
  if (execIdx < 0 || execIdx - idx > 6) return { reason: 'execute_site_not_found' };

  const ex = lines[execIdx];
  let em, newExec;
  const params = fbRenderParams(built.params, lang);
  if (lang === 'py') {
    em = ex.match(new RegExp('^(\\s*(?:[\\w.]+\\s*=\\s*|return\\s+)?(?:await\\s+)?[A-Za-z_]\\w*(?:\\.[A-Za-z_]\\w*)*\\.execute\\()\\s*' + esc + '\\s*(\\)(?:\\s*\\.\\w+\\(\\s*\\))*\\s*(?:#.*)?)$'));
    if (!em) return { reason: 'execute_site_unclear' };
    newExec = em[1] + name + ', ' + params + em[2];
  } else if (lang === 'php') {
    em = ex.match(new RegExp('^(\\s*)(?:(\\$[A-Za-z_]\\w*)\\s*=\\s*)?(\\$[A-Za-z_]\\w*(?:->[A-Za-z_]\\w*)*)->query\\(\\s*' + esc + '\\s*\\)(\\s*;\\s*(?:\\/\\/.*|#.*)?)$'));
    if (!em) return { reason: 'execute_site_unclear' };
    newExec = em[2]
      ? `${em[1]}${em[2]} = ${em[3]}->prepare(${name});\n${em[1]}${em[2]}->execute(${params})${em[4]}`
      : `${em[1]}${em[3]}->prepare(${name})->execute(${params})${em[4]}`;
  } else {
    em = ex.match(new RegExp('^(\\s*(?:(?:const|let|var)\\s+(?:[\\w$]+|\\[[^\\]]*\\]|\\{[^}]*\\})\\s*=\\s*|[\\w$.]+\\s*=\\s*|return\\s+)?(?:await\\s+)?[A-Za-z_$][\\w$]*(?:\\.[A-Za-z_$][\\w$]*)*\\.(?:' + driver.methods.join('|') + ')\\()\\s*' + esc + '\\s*(?:(\\)(?:\\s*\\.\\w+\\(\\s*\\))*\\s*;?\\s*(?:\\/\\/.*)?)|(,.*))$'));
    if (!em) return { reason: 'execute_site_unclear' };
    if (em[2] !== undefined) newExec = em[1] + name + ', ' + params + em[2];
    else {
      if (!FB_JS_CALLBACK_HEAD.test(em[3].slice(1))) return { reason: 'execute_site_unclear' };
      newExec = em[1] + name + ', ' + params + em[3];
    }
  }
  return {
    edits: [{ idx, text: head + name + eq + quoted + tail }, { idx: execIdx, text: newExec }],
    note: 'استعلام مُعلَّم (' + driver.name + ') — الإسناد + التنفيذ',
  };
}

function fbFixSql(lines, idx, env) {
  const driver = env.driver;
  if (!driver) return { reason: 'db_api_unknown' };
  const ph = fbPlaceholderFn(driver);
  const direct = fbSqlDirect(lines[idx], env.lang, driver, ph);
  if (direct) {
    if (direct.text !== undefined) return { edits: [{ idx, text: direct.text }], note: direct.note };
    return direct;
  }
  const assign = fbSqlAssign(lines, idx, env.lang, driver, ph);
  if (assign) return assign;
  return { reason: 'sql_context_unclear' };
}

// ─── 6. Command Injection (Python فقط) ──────────────────────
// يُحوَّل فقط: أمر ثابت + وسائط ثابتة + متغيرات كوسائط منفصلة، بلا أي رمز shell،
// وبلا استخدام للقيمة المرجعة (os.system). غير ذلك ⇒ AI_REQUIRED.
const FB_SHELL_META = /[|&;<>()$`\\"'*?\[\]#~{}\n\r]/;

function fbShellArgv(parts) {
  const argv = [];
  let cur = [];
  const flush = () => { if (cur.length) { argv.push(cur); cur = []; } };
  for (const p of parts) {
    if (p.lit !== undefined) {
      if (FB_SHELL_META.test(p.lit)) return { reason: 'shell_syntax_in_command' };
      p.lit.split(/\s+/).forEach((tok, k) => {
        if (k > 0) flush();
        if (tok) cur.push({ lit: tok });
      });
    } else {
      cur.push({ v: p.v });
    }
  }
  flush();
  if (!argv.length) return { reason: 'empty_command' };
  if (argv[0].length !== 1 || argv[0][0].lit === undefined) return { reason: 'command_from_variable' };   // البرنامج نفسه يجب أن يكون ثابتاً
  return { argv: argv.map(el => el.map(x => x.lit !== undefined ? '"' + x.lit + '"' : x.v).join(' + ')) };
}

function fbFixCmd(lines, idx, env) {
  if (env.lang !== 'py') return { reason: 'cmd_fix_only_python' };
  const line = lines[idx];
  if (/\bos\.popen\s*\(|\bcommands\.\w+\s*\(/.test(line)) return { reason: 'return_value_semantics_change' };
  if (/\bos\.system\s*\(/.test(line) && /^\s*(?:[\w.]+\s*=\s*|return\s+|if\b|elif\b|while\b|assert\b|print\s*\()/.test(line)) {
    return { reason: 'return_value_used' };
  }

  // (أ) os.system(...) كجملة مستقلة (القيمة المرجعة غير مستخدمة)
  let m = line.match(/^(\s*)os\.system\(/);
  if (m) {
    const split = fbSplitCallArgs(line.slice(m[0].length));
    if (!split || !split.closed || split.args.length !== 1) return { reason: 'call_syntax_unparsed' };
    if (!/^\)\s*(?:#.*)?$/.test(')' + split.post)) return { reason: 'return_value_used' };
    const parts = fbParseConcat(split.args[0], 'py');
    if (!parts) return { reason: 'command_expression_not_pure' };
    if (!parts.some(p => p.v !== undefined)) return { skip: 'static_command' };
    const sh = fbShellArgv(parts);
    if (sh.reason) return { reason: sh.reason };
    return {
      edits: [{ idx, text: m[1] + 'subprocess.run([' + sh.argv.join(', ') + '])' + split.post }],
      note: 'os.system → subprocess.run(argv) بلا shell',
      imports: ['subprocess'],
    };
  }
  if (/\bos\.system\s*\(/.test(line)) return { reason: 'command_context_unclear' };

  // (ب) subprocess.X("…" + v, shell=True, …) ⟶ subprocess.X([argv], …)
  m = line.match(/^(.*?\bsubprocess\.(call|run|check_call|check_output|Popen)\()/);
  if (m) {
    const split = fbSplitCallArgs(line.slice(m[1].length));
    if (!split || !split.closed) return { reason: 'call_syntax_unparsed' };
    const args = split.args;
    const shellIdx = args.findIndex(a => /^\s*shell\s*=\s*True\s*$/.test(a));
    if (shellIdx < 0) return { skip: 'no_shell_true' };
    const rest = args.filter((a, k) => k !== 0 && k !== shellIdx);
    if (rest.some(a => !/^\s*[A-Za-z_]\w*\s*=/.test(a))) return { reason: 'positional_arguments_unclear' };
    if (rest.some(a => /^\s*(?:executable|shell)\s*=/.test(a))) return { reason: 'executable_override' };
    const parts = fbParseConcat(args[0], 'py');
    if (!parts) return { reason: 'command_expression_not_pure' };
    if (!parts.some(p => p.v !== undefined)) return { skip: 'static_command' };
    const sh = fbShellArgv(parts);
    if (sh.reason) return { reason: sh.reason };
    return {
      edits: [{ idx, text: m[1] + '[' + sh.argv.join(', ') + ']' + (rest.length ? ',' + rest.join(',') : '') + ')' + split.post }],
      note: 'shell=True أُزيل — ' + m[2] + ' بقائمة argv',
    };
  }
  return { reason: 'command_context_unclear' };
}

// ─── 7. eval / new Function: لا يوجد إصلاح يحفظ الدلالة ─────
// لا JSON.parse بحسب اسم المتغير، ولا حذف/تعليق للكود، ولا ast.literal_eval.
function fbFixEval(lines, idx) {
  const line = lines[idx];
  if (!/\beval\s*\(|new\s+Function\s*\(|\bexec\s*\(/.test(line)) return { skip: 'pattern_not_on_line' };
  return { reason: 'eval_no_semantics_preserving_rewrite' };
}

// ─── 8. TypeScript any: فقط عند استنتاج النوع بثقة من القيمة ───
function fbInferPrimitive(value) {
  const v = String(value).trim();
  if (/^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i.test(v) || /^0[xob][0-9a-f_]+$/i.test(v)) return 'number';
  if (/^'[^'\\\n]*'$/.test(v) || /^"[^"\\\n]*"$/.test(v) || /^`[^`\\$\n]*`$/.test(v)) return 'string';
  if (/^(?:true|false)$/.test(v)) return 'boolean';
  return null;
}

function fbFixTsAny(lines, idx, env) {
  if (env.lang !== 'ts') return { reason: 'any_annotation_only_in_typescript' };
  const line  = lines[idx];
  const count = (line.match(/:\s*any\b/g) || []).length;
  if (!count) return { skip: 'pattern_not_on_line' };
  if (count > 1) return { reason: 'multiple_any_annotations' };
  if (/\bfunction\b|=>|\(\s*[A-Za-z_$][\w$]*\s*:\s*any\b|,\s*[A-Za-z_$][\w$]*\s*:\s*any\b/.test(line)) {
    return { reason: 'parameter_type_needs_usage_analysis' };
  }
  const m = line.match(/^(\s*(?:export\s+)?(?:(?:public|private|protected|readonly|static|override|declare)\s+)*(?:(?:const|let|var)\s+)?)([A-Za-z_$][\w$]*)\s*:\s*any\s*=\s*(.+?)\s*;?\s*(?:\/\/.*)?$/);
  if (!m) return { reason: 'any_not_in_initialized_declaration' };
  const name = m[2];
  const type = fbInferPrimitive(m[3]);
  if (!type) return { reason: 'initializer_type_not_inferable' };
  // أي استخدام ككائن (عضو/فهرس) أو إعادة إسناد في الملف ⇒ لا نغيّر النوع
  const esc    = fbEscapeRe(name);
  const objUse = new RegExp('(?:^|[^\\w$])' + esc + '\\s*(?:[.\\[]|=(?!=)|\\+=|-=|\\*=|\\/=|\\+\\+|--)');
  const preInc = new RegExp('(?:\\+\\+|--)\\s*' + esc + '(?![\\w$])');
  for (let i = 0; i < lines.length; i++) {
    if (i === idx) continue;
    if (objUse.test(lines[i]) || preInc.test(lines[i])) return { reason: 'variable_used_as_object_or_reassigned' };
  }
  return { edits: [{ idx, text: line.replace(/:\s*any\b/, ': ' + type) }], note: 'any → ' + type + ' (مستنتج من القيمة)' };
}

// ─── 9. JWT: نقل secret مُضمَّن إلى env فقط عند نمط واضح ───────
// لا expiry ولا تغيير خيارات ولا افتراض أسماء متغيرات غير مؤكدة.
const FB_JWT_NAMES = /^(?:JWT_SECRET|JWT_KEY|JWT_PRIVATE_KEY|JWT_SIGNING_KEY|TOKEN_SECRET|jwtSecret|jwtKey|jwt_secret|tokenSecret)$/;
function fbToEnvName(name) { return name.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toUpperCase(); }

function fbReplaceSecretArg(line, calleeRe, replacement) {
  const m = line.match(calleeRe);
  if (!m) return null;
  const split = fbSplitCallArgs(line.slice(m.index + m[0].length));
  if (!split || split.args.length < 2) return null;
  const lit = split.args[1].match(/^(\s*)(['"])(?:(?!\2)[^\\\n])+\2(\s*)$/);
  if (!lit) return null;
  const args = split.args.slice();
  args[1] = lit[1] + replacement + lit[3];
  return line.slice(0, m.index) + m[0] + args.join(',') + (split.closed ? ')' + split.post : '');
}

function fbFixJwt(lines, idx, env, issue) {
  const lang = env.lang, line = lines[idx];
  if (lang === 'php') return { reason: 'jwt_php_no_deterministic_fix' };
  if (/process\.env\.|os\.environ/.test(line)) return { skip: 'already_uses_env' };
  if (lang === 'py') {
    const m = line.match(/^(\s*)([A-Za-z_]\w*)(\s*=\s*)(['"])(?:(?!\4)[^\\\n])+\4(\s*(?:#.*)?)$/);
    if (m && (FB_JWT_NAMES.test(m[2]) || m[2] === 'SECRET_KEY')) {
      return { edits: [{ idx, text: m[1] + m[2] + m[3] + "os.environ.get('" + fbToEnvName(m[2]) + "', '')" + m[5] }],
               note: 'JWT secret → os.environ', imports: ['os'] };
    }
    const call = fbReplaceSecretArg(line, /\bjwt\.(?:encode|decode)\(/, "os.environ.get('JWT_SECRET', '')");
    if (call) return { edits: [{ idx, text: call }], note: 'JWT literal secret → os.environ', imports: ['os'] };
  } else {
    const m = line.match(/^(\s*(?:export\s+)?(?:const|let|var)\s+)([A-Za-z_$][\w$]*)(\s*=\s*)(['"])(?:(?!\4)[^\\\n])+\4(\s*;?\s*(?:\/\/.*)?)$/);
    if (m && FB_JWT_NAMES.test(m[2])) {
      return { edits: [{ idx, text: m[1] + m[2] + m[3] + 'process.env.' + fbToEnvName(m[2]) + m[5] }], note: 'JWT secret → process.env' };
    }
    const call = fbReplaceSecretArg(line, /\b(?:jwt|jsonwebtoken)\.(?:sign|verify)\(/, 'process.env.JWT_SECRET');
    if (call) return { edits: [{ idx, text: call }], note: 'JWT literal secret → process.env.JWT_SECRET' };
  }
  const t = String((issue && issue.title) || '');
  if (/expir|انتهاء/i.test(t))          return { reason: 'token_expiry_policy_requires_review' };
  if (/\bnone\b/i.test(t))               return { reason: 'jwt_algorithm_requires_review' };
  if (/verif|تحقق|decode/i.test(t))      return { reason: 'jwt_verification_requires_review' };
  return { reason: 'jwt_pattern_not_recognized' };
}

const FB_FIXERS = { EVAL: fbFixEval, SQL: fbFixSql, CMD: fbFixCmd, TS_ANY: fbFixTsAny, JWT: fbFixJwt };

// ─── 10. استيرادات Python المؤجَّلة (تُدرج مرة واحدة بعد كتلة الاستيراد) ─
function fbHasImport(code, mod) {
  return new RegExp('^\\s*import\\s+(?:[\\w.]+(?:\\s+as\\s+\\w+)?\\s*,\\s*)*' + fbEscapeRe(mod) + '(?:\\.[\\w.]+)?(?:\\s*,|\\s*$|\\s*#)', 'm').test(code);
}

function fbImportInsertIndex(lines) {
  let i = 0;
  while (i < lines.length && (/^\s*$/.test(lines[i]) || /^\s*#/.test(lines[i]))) i++;
  if (i < lines.length && /^\s*[rRuUbB]*("""|''')/.test(lines[i])) {
    const q    = lines[i].match(/("""|''')/)[1];
    const rest = lines[i].slice(lines[i].indexOf(q) + 3);
    if (!rest.includes(q)) { i++; while (i < lines.length && !lines[i].includes(q)) i++; }
    i++;
  }
  let last = -1, j = i;
  while (j < lines.length) {
    const l = lines[j];
    if (/^\s*$/.test(l) || /^\s*#/.test(l)) { j++; continue; }
    if (!/^(?:import|from)\s/.test(l)) break;
    if (l.includes('(') && !l.includes(')')) { while (j < lines.length && !lines[j].includes(')')) j++; }
    else { while (j < lines.length && /\\\s*$/.test(lines[j])) j++; }
    last = j; j++;
  }
  return last >= 0 ? last + 1 : i;
}

function fbWithImports(lines, importsSet) {
  const need = [...importsSet].filter(n => !fbHasImport(lines.join('\n'), n));
  if (!need.length) return lines.join('\n');
  const out = lines.slice();
  out.splice(fbImportInsertIndex(out), 0, ...need.map(n => 'import ' + n));
  return out.join('\n');
}

// ─── 11. التحقق: بنيوي + idempotency + المحلل ─────────────────
const FB_FOREIGN = {
  js:  [/\bos\.environ\b/, /^\s*import\s+os\b/m, /\bsubprocess\b/, /\bshlex\b/, /\bast\.literal_eval\b/, /<\?php/, /\$stmt\b/, /->/],
  py:  [/\bprocess\.env\b/, /\brequire\(/, /\b(?:const|let|var)\s+[\w$]+\s*=/, /===/, /\$stmt\b/, /->/, /\bconsole\./],
  php: [/\bprocess\.env\b/, /\bos\.environ\b/, /\bsubprocess\b/, /===\s*undefined/],
};

function fbBracketDelta(text) {
  const d = { '(': 0, '[': 0, '{': 0 };
  let q = null;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '\\') { i++; continue; } if (c === q) q = null; continue; }
    if (c === '"' || c === "'" || c === '`') { q = c; continue; }
    if (c === '(') d['(']++; else if (c === ')') d['(']--;
    else if (c === '[') d['[']++; else if (c === ']') d['[']--;
    else if (c === '{') d['{']++; else if (c === '}') d['{']--;
  }
  return d;
}

function fbApplyEdits(lines, edits) {
  const out = lines.slice();
  edits.slice().sort((a, b) => b.idx - a.idx).forEach(e => out.splice(e.idx, 1, ...e.text.split('\n')));
  return out;
}

function fbStructuralProblem(beforeLines, afterLines, edits, lang) {
  const afterText = afterLines.join('\n');
  if (!afterText.trim()) return 'empty_result';
  if (afterText.trim().length < beforeLines.join('\n').trim().length * 0.25) return 'result_too_short';
  const expected = edits.reduce((n, e) => n + (e.text.split('\n').length - 1), 0);
  if (afterLines.length - beforeLines.length !== expected) return 'unexpected_line_delta';
  const foreign = FB_FOREIGN[lang === 'ts' ? 'js' : lang] || [];
  for (const e of edits) {
    const before = beforeLines[e.idx], after = e.text;
    if (typeof before !== 'string') return 'edit_out_of_range';
    const db = fbBracketDelta(before), da = fbBracketDelta(after);
    for (const k of Object.keys(db)) if (db[k] !== da[k]) return 'bracket_balance_changed';
    for (const q of ['"', "'", '`']) if ((fbCount(before, q) % 2) !== (fbCount(after, q) % 2)) return 'quote_parity_changed';
    const newLines = after.split('\n').map(l => l.trim()).filter(Boolean);
    if (newLines.length && newLines.every(l => /^(?:\/\/|#|\/\*)/.test(l))) return 'comment_only_replacement';
    for (const re of foreign) if (re.test(after) && !re.test(before)) return 'foreign_syntax_introduced';
  }
  return null;
}

function fbAnalyzeSafe(analyze, code, fileName) {
  try { const r = analyze(code, fileName); return Array.isArray(r) ? r : null; }
  catch (e) { return null; }
}

function fbHasRegression(before, after) {
  const ch = arr => arr.filter(i => i && (i.sev === 'c' || i.sev === 'h')).length;
  if (ch(after) > ch(before)) return true;
  const types = new Set(before.map(i => (i && (i.cAct || i.type)) || ''));
  return after.some(i => i && (i.sev === 'c' || i.sev === 'h') && !types.has(i.cAct || i.type || ''));
}

// ─── 12. الواجهة: fallbackFix ────────────────────────────────
function fallbackFix(code, fileName, issues) {
  const result = {
    fixed: code, repairs: [], aiRequired: [], skipped: [], fixedIssues: [],
    lang: null, verification: { checked: 0, rolledBack: 0, analyzer: false },
  };
  if (typeof code !== 'string' || !code.trim()) return result;
  const list = (Array.isArray(issues) ? issues : []).filter(i => i && typeof i === 'object');
  const lang = fbLangOf(fileName);
  result.lang = lang;

  const ai   = (issue, cat, reason) => result.aiRequired.push({ line: issue.line, title: issue.title, category: cat, status: 'AI_REQUIRED', reason });
  const skip = (issue, cat, reason) => result.skipped.push({ line: issue.line, title: issue.title, category: cat, reason });

  if (!lang) {
    list.forEach(issue => { const cat = fbCategory(issue); if (cat) ai(issue, cat, 'unsupported_language'); else skip(issue, null, 'not_fallback_category'); });
    return result;
  }

  const analyze = typeof analyzeCode === 'function' ? analyzeCode : null;
  result.verification.analyzer = !!analyze;
  const env = { lang, fileName, driver: fbDetectDriver(code, lang), imports: new Set() };
  let lines = code.split('\n');
  let baseIssues;                                  // تحليل الحالة الحالية (مع الاستيرادات المؤجلة) — كسول
  const touched = new Set();

  const ordered = list.map((issue, i) => ({ issue, i }))
    .sort((a, b) => ((Number(b.issue.line) || 0) - (Number(a.issue.line) || 0)) || (a.i - b.i));

  for (const { issue } of ordered) {
    const cat = fbCategory(issue);
    if (!cat) { skip(issue, null, 'not_fallback_category'); continue; }
    if (!FB_CATEGORY_LANGS[cat].includes(lang)) { ai(issue, cat, 'category_not_supported_for_language'); continue; }
    // بلاغ مكرر (من محلل آخر) على سطر أُصلح في هذه الجولة: يُتخطَّى ولا يُحال إلى AI
    const rawIdx = Number.isFinite(Number(issue.line)) ? Math.floor(Number(issue.line)) - 1 : -1;
    if (touched.has(rawIdx)) { skip(issue, cat, 'line_already_fixed_this_run'); continue; }
    const loc = fbResolveLine(lines, issue);
    if (loc.idx < 0) { ai(issue, cat, loc.reason); continue; }
    if (touched.has(loc.idx)) { skip(issue, cat, 'line_already_fixed_this_run'); continue; }

    const fixer = FB_FIXERS[cat];
    let out;
    try { out = fixer(lines, loc.idx, env, issue); }
    catch (e) { ai(issue, cat, 'fixer_error'); continue; }
    if (!out || (!out.edits && !out.reason && !out.skip)) { skip(issue, cat, 'no_change'); continue; }
    if (out.skip)   { skip(issue, cat, out.skip); continue; }
    if (out.reason) { ai(issue, cat, out.reason); continue; }

    // ── تحقق ──
    result.verification.checked++;
    const next = fbApplyEdits(lines, out.edits);
    let problem = fbStructuralProblem(lines, next, out.edits, lang);
    if (!problem) {
      // idempotency: إعادة تشغيل الـfixer نفسه على الناتج يجب ألا تنتج تعديلاً
      for (const e of out.edits) {
        let again = null;
        try { again = fixer(next, e.idx, env, issue); } catch (err) { again = { edits: [] }; }
        if (again && again.edits) { problem = 'not_idempotent'; break; }
      }
    }
    let targetGone;
    if (!problem && analyze) {
      if (baseIssues === undefined) baseIssues = fbAnalyzeSafe(analyze, fbWithImports(lines, env.imports), fileName);
      if (baseIssues) {
        const nextImports = new Set([...env.imports, ...(out.imports || [])]);
        const afterIssues = fbAnalyzeSafe(analyze, fbWithImports(next, nextImports), fileName);
        if (!afterIssues) problem = 'analysis_failed';
        else if (fbHasRegression(baseIssues, afterIssues)) problem = 'regression';
        else {
          const cnt = arr => arr.filter(i => i && i.title === issue.title).length;
          targetGone = cnt(afterIssues) < cnt(baseIssues);
          baseIssues = afterIssues;
        }
      }
    }
    if (problem) { result.verification.rolledBack++; ai(issue, cat, 'verification_failed:' + problem); continue; }

    lines = next;
    (out.imports || []).forEach(m => env.imports.add(m));
    out.edits.forEach(e => touched.add(e.idx));
    result.repairs.push({ line: issue.line, title: issue.title, fix: out.note, category: cat, verified: true, targetGone });
    result.fixedIssues.push(issue);
  }

  result.fixed = result.repairs.length ? fbWithImports(lines, env.imports) : code;
  return result;
}

// ─── 13. الواجهة: applyFallbackToAll ────────────────────────
function applyFallbackToAll(F, R) {
  const results = {}, aiRequired = {};
  let totalFixed = 0, rolledBack = 0;
  if (!F || typeof F !== 'object') return { totalFixed, results, aiRequired, rolledBack };

  Object.keys(F).forEach(fn => {
    const code = F[fn];
    if (typeof code !== 'string') return;
    const entry  = R && typeof R === 'object' ? R[fn] : null;
    const issues = entry && Array.isArray(entry.issues) ? entry.issues : [];
    if (!issues.length) return;

    let r;
    try { r = fallbackFix(code, fn, issues); }
    catch (e) { if (typeof console !== 'undefined' && console.warn) console.warn('fallbackFix failed for ' + fn + ': ' + (e && e.message)); return; }

    if (r.aiRequired.length) aiRequired[fn] = r.aiRequired;
    rolledBack += r.verification.rolledBack;
    if (!r.repairs.length || r.fixed === code) return;

    F[fn] = r.fixed;
    let newIssues = null;
    if (typeof analyzeCode === 'function') {
      try { const a = analyzeCode(r.fixed, fn); newIssues = Array.isArray(a) ? a : null; } catch (e) { newIssues = null; }
    }
    if (!newIssues) {
      const done = new Set(r.fixedIssues);
      newIssues = issues.filter(i => !done.has(i));       // بلا محلل: أزل ما أُصلح فعلاً فقط (بالهوية)
    }
    R[fn] = Object.assign({}, entry, { code: r.fixed, issues: newIssues });
    totalFixed += r.repairs.length;
    results[fn] = r.repairs;
  });

  return { totalFixed, results, aiRequired, rolledBack };
}
