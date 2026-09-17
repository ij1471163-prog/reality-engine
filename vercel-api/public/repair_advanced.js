// ═══════════════════════════════════════════════════════
// repair_advanced.js v2.1 — طبقة الإصلاح المتقدم (محافظة ومُتحقَّقة)
//
// الدور في المعمارية: **Repair Engine فقط، ليس Manager.**
//
//   RealityOrchestrator  ← المدير الوحيد
//        ↓
//   AdvancedRepair       ← هذا الملف: يقترح candidate patches
//        ↓
//   FixVerifier          ← بوابة التحقق النهائية الوحيدة
//        ↓
//   ACCEPT / REJECT
//        ↓
//   RealityOrchestrator يقرر Fallback / Claude / Apply
//
// هذا الملف لا يستدعي Fallback ولا Claude ولا يتخذ قرار مسار. يُرجع نتيجة
// منظمة (fixed / repairs / changed / aiRequired / verification) ويترك القرار
// للمنسّق.
//
// المبدأ: Advanced Repair → FixVerifier → نجح ⇒ يصبح الأساس المقبول /
// فشل ⇒ لا يُغيَّر الكود المقبول + AI_REQUIRED بسبب واضح.
//
// ⚠️ دقة في الوصف: لا يُطبَّق إلا إصلاح **deterministic محافظ، ولا يُقبل إلا
// بعد التحقق**. الادعاء بأنه "لا يغيّر دلالة الكود" غير دقيق: إصلاحات مثل
// Audit logging (يضيف استدعاء) وPromise .catch (يبتلع رفضًا كان ينتشر)
// وos.system → subprocess.run (يغيّر تفسير الـshell للأمر) لها أثر سلوكي
// محتمل حسب السياق. الشروط المحافظة هنا تقلّل ذلك الأثر، والبوابة ترفض ما
// لا يمكن التحقق منه — لكن انعدام التغيير الدلالي ليس ضمانًا مطلقًا.
//
// ═══ تغييرات v2.1 (معمارية فقط — لا fixer جديد ولا توسيع نطاق) ═══
//   [1] FixVerifier.verifyFix() صار القرار النهائي لكل candidate.
//       الفحوص المحلية (structural / idempotency / syntax) بقيت كما هي لكنها
//       صارت **pre-checks** رخيصة تمنع اقتراحًا فاسدًا من الوصول للبوابة،
//       لا حكمًا نهائيًا.
//   [2] hasRegression() المحلي لم يعد يُستخدم كحكم. FixVerifier يملك هوية
//       مشاكل مستقرة ومقارنة بالعدّ، وهي أدق من المقارنة بالنوع هنا: انخفاض
//       عدد نوع عام كان يُخفي بقاء/تبدّل instance أخرى. أُبقيت الدالة
//       معرَّفة للتوافق لكنها لم تعد في مسار القرار.
//   [3] Fail-Closed: بلا FixVerifier لا يُطبَّق أي إصلاح إطلاقًا.
//
// ⚠️ أثر جانبي معلن لهذا الربط (اقرأه قبل الاعتماد):
//   FixVerifier لا يملك فاحصًا تركيبيًا إلا لـJavaScript/JSON. وهو
//   Fail-Closed، أي يرفض ما لا يستطيع التحقق منه. لذلك مع الإعداد الحالي:
//       js / jsx      → تعمل ✅
//       ts / tsx      → تعتمد على توفر مترجم TypeScript داخل FixVerifier؛ إذا لم يتوفر، تُرفض Fail-Closed
//       py / php      → مرفوضة (لا فاحص) ❌
//       java/cs/rb/go → تقرير فقط أصلاً (لا تتأثر)
//   عمليًا هذا يُعطّل Secrets (py/php) وPHP_XSS وPY_EXCEPT ما لم يُضَف فاحص
//   لتلك اللغات في FixVerifier. الاقتراحات تُسجَّل في aiRequired بسبب
//   'verification_failed:REJECTED_NO_SYNTAX_CHECKER…' بدل أن تُطبَّق بلا تحقق.
//   هذا سلوك مقصود (لا نطبّق ما لا نتحقق منه)، وحله في FixVerifier لا هنا.
//
// الواجهة العامة (بلا تغيير للمستهلكين):
//   AdvancedRepair.fix(code, fileName[, options]) → { fixed, repairs, changed, ... }
//   AdvancedRepair.detectLang(fileName)           → js|ts|jsx|tsx|py|php|java|cs|rb|go|unknown
//   window.AdvancedRepair / module.exports كما كانا.
// ═══════════════════════════════════════════════════════
"use strict";

var AdvancedRepair = (() => {

  const VERSION = '2.1';

  // ─── 0. ربط بوابة التحقق الوحيدة (fix_verifier.js) ──────────
  // هذا الملف لا يملك قرار قبول خاصًا به. FixVerifier هو الحكم النهائي.
  // [v2.1 patch] Lazy Resolver بدل Load-time capture: يمنع حالة تحميل
  // repair_advanced.js قبل fix_verifier.js مما كان يجعل _FV يبقى null
  // حتى لو تحمّل FixVerifier لاحقًا. الآن يُحلَّل عند أول استخدام فعلي.
  var _FV = null;

  function _getFixVerifier() {
    if (_FV && typeof _FV.verifyFix === 'function') return _FV;

    _FV = null;

    if (typeof FixVerifier !== 'undefined' &&
        FixVerifier &&
        typeof FixVerifier.verifyFix === 'function') {
      _FV = FixVerifier;
      return _FV;
    }

    if (typeof globalThis !== 'undefined' &&
        globalThis.FixVerifier &&
        typeof globalThis.FixVerifier.verifyFix === 'function') {
      _FV = globalThis.FixVerifier;
      return _FV;
    }

    if (typeof require === 'function') {
      try {
        const m = require('./fix_verifier.js');
        if (m && typeof m.verifyFix === 'function') {
          _FV = m;
          return _FV;
        }
      } catch (e) {}
    }

    return null;
  }

  // ─── 1. اللغة: من الامتداد فقط، وunknown ⇒ لا إصلاح ─────────
  const LANG_BY_EXT = {
    js: 'js', ts: 'ts', jsx: 'jsx', tsx: 'tsx',
    py: 'py', php: 'php', java: 'java', cs: 'cs', rb: 'rb', go: 'go',
  };

  function detectLang(fileName) {
    const name = String(fileName || '');
    const dot  = name.lastIndexOf('.');
    if (dot < 0) return 'unknown';
    const ext = name.slice(dot + 1).toLowerCase();
    return Object.prototype.hasOwnProperty.call(LANG_BY_EXT, ext) ? LANG_BY_EXT[ext] : 'unknown';
  }

  // عائلة اللغة التي تحدد صياغة الإصلاح (JS/TS/JSX/TSX ⇒ js)
  function familyOf(lang) {
    return (lang === 'js' || lang === 'ts' || lang === 'jsx' || lang === 'tsx') ? 'js' : lang;
  }

  // ─── 2. أدوات نصية واعية بالسلاسل ───────────────────────────
  function escapeRe(s) { return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
  function count(text, ch) { let n = 0; for (const c of text) if (c === ch) n++; return n; }
  function toEnvName(name) {
    return String(name).replace(/^\$/, '').replace(/([a-z0-9])([A-Z])/g, '$1_$2').replace(/[^A-Za-z0-9]+/g, '_').toUpperCase();
  }

  // يقسّم وسائط استدعاء بدءاً من ما بعد '(' عند الفواصل في العمق صفر
  function splitCallArgs(text) {
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

  const IDENT_HEAD = {
    js:  /^[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*|\[(?:\d+|'[^'\\\n]*'|"[^"\\\n]*")\])*/,
    py:  /^[A-Za-z_]\w*(?:\.[A-Za-z_]\w*|\[(?:\d+|'[^'\\\n]*'|"[^"\\\n]*")\])*/,
    php: /^\$[A-Za-z_]\w*(?:->[A-Za-z_]\w*|\[(?:\d+|'[^'\\\n]*'|"[^"\\\n]*")\])*/,
  };
  function isIdent(s, fam) {
    const m = String(s).match(IDENT_HEAD[fam]);
    return !!m && m[0].length === s.length;
  }

  // تعبير سلسلة "نقي": literals + متغيرات بسيطة فقط (بلا escapes ولا دوال ولا عمليات)
  // يدعم template literal (JS) وf-string (Python) والاستيفاء داخل "…" (PHP)
  function parseConcat(expr, fam) {
    const s  = String(expr).trim();
    const op = fam === 'php' ? '.' : '+';
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
          if (!isIdent(inner, 'js')) return null;
          flush(); out.push({ v: inner }); j = end + 1; continue;
        }
        if (interp === 'py' && (c === '{' || c === '}')) {
          if (c === '}') return null;
          const end = s.indexOf('}', j + 1);
          if (end < 0) return null;
          const inner = s.slice(j + 1, end).trim();
          if (!inner || !isIdent(inner, 'py')) return null;
          flush(); out.push({ v: inner }); j = end + 1; continue;
        }
        if (interp === 'php' && c === '{' && s[j + 1] === '$') {
          const end = s.indexOf('}', j + 2);
          if (end < 0) return null;
          const inner = s.slice(j + 1, end).trim();
          if (!isIdent(inner, 'php')) return null;
          flush(); out.push({ v: inner }); j = end + 1; continue;
        }
        if (interp === 'php' && c === '$') {
          const m = s.slice(j).match(/^\$[A-Za-z_]\w*/);
          if (!m) return null;
          const after = s.slice(j + m[0].length, j + m[0].length + 2);
          if (after.startsWith('[') || after === '->') return null;
          flush(); out.push({ v: m[0] }); j += m[0].length; continue;
        }
        buf += c; j++;
      }
      if (j >= s.length) return null;
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
          got = readQuoted(c, fam === 'php' && c === '"' ? 'php' : null);
        } else if (c === '`' && fam === 'js') {
          got = readQuoted('`', 'js');
        } else if (fam === 'py' && (c === 'f' || c === 'F') && (s[i + 1] === '"' || s[i + 1] === "'")) {
          i++; got = readQuoted(s[i], 'py');
        } else if (fam === 'py' && /[rRbBuU]/.test(c) && (s[i + 1] === '"' || s[i + 1] === "'")) {
          return null;
        } else {
          const m = s.slice(i).match(IDENT_HEAD[fam]);
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

  // ─── 3. أوامر shell: تقسيم إلى argv بلا أي رمز shell ─────────
  const SHELL_META = /[|&;<>()$`\\"'*?\[\]#~{}\n\r]/;

  // يعيد { argv: [[{lit}|{v}, …], …] } أو { reason }
  function shellTokens(parts) {
    const argv = [];
    let cur = [];
    const flush = () => { if (cur.length) { argv.push(cur); cur = []; } };
    for (const p of parts) {
      if (p.lit !== undefined) {
        if (SHELL_META.test(p.lit)) return { reason: 'shell_syntax_in_command' };
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
    if (argv[0].length !== 1 || argv[0][0].lit === undefined) return { reason: 'command_from_variable' };
    return { argv };
  }
  // عنصر argv كتعبير JS/Python: "tok" أو متغير أو دمجهما بـ +
  const renderArgvElem = el => el.map(x => x.lit !== undefined ? '"' + x.lit + '"' : x.v).join(' + ');

  // ─── 4. استيرادات Python المؤجَّلة ───────────────────────────
  function hasPyImport(code, mod) {
    return new RegExp('^\\s*import\\s+(?:[\\w.]+(?:\\s+as\\s+\\w+)?\\s*,\\s*)*' + escapeRe(mod) + '(?:\\.[\\w.]+)?(?:\\s*,|\\s*$|\\s*#)', 'm').test(code);
  }
  function pyImportInsertIndex(lines) {
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
  function withPyImports(lines, importsSet) {
    const need = [...importsSet].filter(n => !hasPyImport(lines.join('\n'), n));
    if (!need.length) return lines.join('\n');
    const out = lines.slice();
    out.splice(pyImportInsertIndex(out), 0, ...need.map(n => 'import ' + n));
    return out.join('\n');
  }

  // ─── 5. التحقق ──────────────────────────────────────────────
  const FOREIGN = {
    js:  [/\bos\.environ\b/, /^\s*import\s+os\b/m, /\bsubprocess\b/, /\bshlex\b/, /\bescapeshellarg\b/, /\bhtmlspecialchars\b/, /<\?php/, /System\.getenv/, /->/],
    py:  [/\bprocess\.env\b/, /\brequire\(/, /\b(?:const|let|var)\s+[\w$]+\s*=/, /===/, /\bescapeshellarg\b/, /\bhtmlspecialchars\b/, /->/, /\bconsole\./, /\bexecFile\b/],
    php: [/\bprocess\.env\b/, /\bos\.environ\b/, /\bsubprocess\b/, /\bexecFile\b/, /\bconsole\./, /===\s*undefined/, /^\s*import\s+os\b/m],
  };

  function bracketDelta(text) {
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

  function applyEdits(lines, edits) {
    const out = lines.slice();
    edits.slice().sort((a, b) => b.idx - a.idx).forEach(e => out.splice(e.idx, 1, ...e.text.split('\n')));
    return out;
  }

  function structuralProblem(beforeLines, afterLines, edits, fam) {
    const afterText = afterLines.join('\n');
    if (!afterText.trim()) return 'empty_result';
    if (afterText.trim().length < beforeLines.join('\n').trim().length * 0.25) return 'result_too_short';
    const expected = edits.reduce((n, e) => n + (e.text.split('\n').length - 1), 0);
    if (afterLines.length - beforeLines.length !== expected) return 'unexpected_line_delta';
    const foreign = FOREIGN[fam] || [];
    for (const e of edits) {
      const before = beforeLines[e.idx], after = e.text;
      if (typeof before !== 'string') return 'edit_out_of_range';
      const db = bracketDelta(before), da = bracketDelta(after);
      for (const k of Object.keys(db)) if (db[k] !== da[k]) return 'bracket_balance_changed';
      for (const q of ['"', "'", '`']) if ((count(before, q) % 2) !== (count(after, q) % 2)) return 'quote_parity_changed';
      const newLines = after.split('\n').map(l => l.trim()).filter(Boolean);
      if (newLines.length && newLines.every(l => /^(?:\/\/|#|\/\*)/.test(l))) return 'comment_only_replacement';
      for (const re of foreign) if (re.test(after) && !re.test(before)) return 'foreign_syntax_introduced';
    }
    return null;
  }

  // فحص نحوي لـ JS النقي فقط عبر acorn إن وُجد (كقاعدة Ghost نفسها)
  function parsesAsJS(src) {
    for (const sourceType of ['module', 'script']) {
      try { acorn.parse(src, { ecmaVersion: 'latest', sourceType }); return true; } catch (e) {}
    }
    return false;
  }
  function syntaxAvailable(lang) {
    return lang === 'js' && typeof acorn !== 'undefined' && acorn && typeof acorn.parse === 'function';
  }
  function syntaxProblem(before, after, lang) {
    if (!syntaxAvailable(lang)) return null;
    if (!parsesAsJS(before)) return null;
    return parsesAsJS(after) ? null : 'syntax_broken';
  }

  function analyzeSafe(analyze, code, fileName) {
    try { const r = analyze(code, fileName); return Array.isArray(r) ? r : null; }
    catch (e) { return null; }
  }
  // ⚠️ [v2.1] لم تعد في مسار القرار — FixVerifier يتولى كشف الانحدار.
  // سبب الاستبعاد: هذه المقارنة بالنوع فقط، فانخفاض عدد نوع عام يُخفي
  // بقاء أو تبدّل instance أخرى من النوع نفسه (أُصلحت واحدة وكُسرت أخرى ⇒
  // العدد ثابت ⇒ تمر). FixVerifier يقارن بهوية مستقرة وبالعدّ لكل هوية.
  // أُبقيت معرَّفة للتوافق مع أي مستهلك داخلي، ولا تُستدعى في fix().
  function hasRegression(before, after) {
    const ch = arr => arr.filter(i => i && (i.sev === 'c' || i.sev === 'h')).length;
    if (ch(after) > ch(before)) return true;
    const types = new Set(before.map(i => (i && (i.cAct || i.type)) || ''));
    return after.some(i => i && (i.sev === 'c' || i.sev === 'h') && !types.has(i.cAct || i.type || ''));
  }

  // ─── 6. Secrets (Python / PHP) ──────────────────────────────
  const SECRET_NAME = /secret|password|passwd|pwd|token|api[_-]?key|apikey|private[_-]?key|access[_-]?key|auth[_-]?key|client[_-]?secret|signing[_-]?key|encryption[_-]?key/i;
  const PLACEHOLDER = /^(?:x+|\*+|\.+|-+|<[^>]*>|\$\{[^}]*\}|\{\{[^}]*\}\}|changeme|change[-_ ]?me|your[-_ ][\w-]+|todo|tbd|placeholder|dummy|example|sample|test|none|null|undefined|secret|password|123456|\.\.\.)$/i;

  function findSecrets(lines, env) {
    const cands = [];
    const src = lines.join('\n');
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (/^\s*(?:#|\/\/)/.test(line)) continue;
      if (/os\.environ|getenv\s*\(|\$_ENV\b|\$_SERVER\b/.test(line)) continue;      // يقرأ env أصلاً
      let m, name, value, rebuild;
      if (env.fam === 'py') {
        m = line.match(/^(\s*)([A-Za-z_]\w*)(\s*=\s*)(['"])((?:(?!\4)[^\\\n])+)\4(\s*(?:#.*)?)$/);
        if (!m) continue;
        name = m[2]; value = m[5];
        rebuild = envName => m[1] + m[2] + m[3] + "os.environ.get('" + envName + "', '')" + m[6];
      } else if (env.fam === 'php') {
        m = line.match(/^(\s*)(\$[A-Za-z_]\w*)(\s*=\s*)(['"])((?:(?!\4)[^\\\n])+)\4(\s*;\s*(?:\/\/.*|#.*)?)$/);
        if (m) {
          name = m[2]; value = m[5];
          rebuild = envName => m[1] + m[2] + m[3] + "getenv('" + envName + "')" + m[6];
        } else {
          m = line.match(/^(\s*define\s*\(\s*(['"])([A-Za-z_]\w*)\2\s*,\s*)(['"])((?:(?!\4)[^\\\n])+)\4(\s*\)\s*;\s*(?:\/\/.*|#.*)?)$/);
          if (!m) {
            if (/^\s*(?:public|private|protected|static|var|const|readonly)\b.*\$\w*(?:secret|password|token|key)\w*\s*=\s*['"]/i.test(line)) {
              cands.push({ idx: i, reason: 'class_property_needs_constructor_init' });
            }
            continue;
          }
          name = m[3]; value = m[5];
          rebuild = envName => m[1] + "getenv('" + envName + "')" + m[6];
        }
      } else continue;
      if (!SECRET_NAME.test(name)) continue;
      if (value.length < 6 || PLACEHOLDER.test(value.trim())) continue;
      const envName = toEnvName(name);
      const readsEnv = new RegExp("(?:os\\.environ(?:\\.get)?\\s*[\\[(]\\s*['\"]|os\\.getenv\\s*\\(\\s*['\"]|getenv\\s*\\(\\s*['\"]|\\$_ENV\\s*\\[\\s*['\"])" + escapeRe(envName) + "['\"]");
      if (readsEnv.test(src)) { cands.push({ idx: i, reason: 'env_already_read_for_name' }); continue; }
      cands.push({
        idx: i, edits: [{ idx: i, text: rebuild(envName) }],
        note: 'Secrets → env vars', imports: env.fam === 'py' ? ['os'] : [],
      });
    }
    return cands;
  }

  // ─── 7. Command Injection (JS / Python / PHP) ────────────────
  const JS_CALLBACK_HEAD = /^\s*(?:async\s*)?(?:function\b|\(|[A-Za-z_$][\w$]*\s*=>)/;

  function findCmdJS(lines, env) {
    const cands = [];
    if (!/child_process/.test(lines.join('\n'))) return cands;
    // ربط exec بـ child_process فقط: destructuring، أو alias للوحدة — لا regex.exec ولا مكتبات أخرى
    let importIdx = -1;
    const aliases = new Set();
    for (let i = 0; i < lines.length; i++) {
      const l = lines[i];
      if (/^\s*(?:const|let|var)\s*\{[^}]*\bexec(?:Sync)?\b[^}]*\}\s*=\s*require\(\s*['"](?:node:)?child_process['"]\s*\)/.test(l) ||
          /^\s*import\s*\{[^}]*\bexec(?:Sync)?\b[^}]*\}\s*from\s*['"](?:node:)?child_process['"]/.test(l)) { if (importIdx < 0) importIdx = i; }
      let a = l.match(/^\s*(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*require\(\s*['"](?:node:)?child_process['"]\s*\)\s*;?\s*$/) ||
              l.match(/^\s*import\s+(?:\*\s+as\s+)?([A-Za-z_$][\w$]*)\s+from\s*['"](?:node:)?child_process['"]/);
      if (a) aliases.add(a[1]);
    }
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (/^\s*(?:\/\/|\*)/.test(line)) continue;
      const m = line.match(/(^|[^\w$.])((?:[A-Za-z_$][\w$]*\.|require\(\s*['"](?:node:)?child_process['"]\s*\)\.)?)(exec|execSync)\s*\(/);
      if (!m) continue;
      const receiver = m[2];                                                  // 'cp.' | "require('child_process')." | ''
      const fn = m[3];
      if (receiver) {
        const alias = receiver.slice(0, -1);
        if (!/^require\(/.test(receiver) && !aliases.has(alias)) continue;    // obj.exec من شيء آخر (regex مثلاً)
      } else if (importIdx < 0) continue;                                      // exec بلا ربط واضح بـ child_process
      const callStart = m.index + m[1].length;
      const argsStart = callStart + m[0].length - m[1].length;
      const split = splitCallArgs(line.slice(argsStart));
      if (!split || !split.args.length) { cands.push({ idx: i, reason: 'call_syntax_unparsed' }); continue; }
      const parts = parseConcat(split.args[0], 'js');
      if (!parts) { cands.push({ idx: i, reason: 'command_expression_not_pure' }); continue; }
      if (!parts.some(p => p.v !== undefined)) continue;                     // أمر ثابت — لا حقن
      const tk = shellTokens(parts);
      if (tk.reason) { cands.push({ idx: i, reason: tk.reason }); continue; }
      const rest = split.args.slice(1);
      if (rest.some(a => /\bshell\s*:/.test(a))) { cands.push({ idx: i, reason: 'shell_option_present' }); continue; }
      if (!split.closed && !(rest.length && JS_CALLBACK_HEAD.test(rest[rest.length - 1]))) { cands.push({ idx: i, reason: 'call_arguments_unclear' }); continue; }
      const newFn = fn === 'exec' ? 'execFile' : 'execFileSync';
      const file  = '"' + tk.argv[0][0].lit + '"';
      const args  = '[' + tk.argv.slice(1).map(renderArgvElem).join(', ') + ']';
      const head  = line.slice(0, callStart) + receiver + newFn + '(';
      const text  = head + file + ', ' + args + (rest.length ? ',' + rest.join(',') : '') + (split.closed ? ')' + split.post : '');
      const edits = [{ idx: i, text }];
      if (!receiver) {
        const imp = lines[importIdx];
        if (!new RegExp('\\b' + newFn + '\\b').test(imp)) {
          edits.push({ idx: importIdx, text: imp.replace(/\{([^}]*)\}/, (all, inner) => '{' + inner.replace(/\s*$/, '') + ', ' + newFn + (/\s$/.test(inner) ? ' ' : '') + '}') });
        }
      }
      cands.push({ idx: i, edits, note: 'Command Injection → execFile/subprocess/escapeshellarg' });
    }
    return cands;
  }

  function findCmdPy(lines, env) {
    const cands = [];
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (/^\s*#/.test(line)) continue;
      if (/\bos\.popen\s*\(|\bcommands\.\w+\s*\(/.test(line)) { cands.push({ idx: i, reason: 'return_value_semantics_change' }); continue; }
      let m = line.match(/^(\s*)os\.system\(/);
      if (m) {
        const split = splitCallArgs(line.slice(m[0].length));
        if (!split || !split.closed || split.args.length !== 1) { cands.push({ idx: i, reason: 'call_syntax_unparsed' }); continue; }
        if (!/^\)\s*(?:#.*)?$/.test(')' + split.post)) { cands.push({ idx: i, reason: 'return_value_used' }); continue; }
        const parts = parseConcat(split.args[0], 'py');
        if (!parts) { cands.push({ idx: i, reason: 'command_expression_not_pure' }); continue; }
        if (!parts.some(p => p.v !== undefined)) continue;                                 // أمر ثابت
        const tk = shellTokens(parts);
        if (tk.reason) { cands.push({ idx: i, reason: tk.reason }); continue; }
        cands.push({ idx: i, edits: [{ idx: i, text: m[1] + 'subprocess.run([' + tk.argv.map(renderArgvElem).join(', ') + '])' + split.post }],
                     note: 'Command Injection → execFile/subprocess/escapeshellarg', imports: ['subprocess'] });
        continue;
      }
      if (/\bos\.system\s*\(/.test(line)) {
        cands.push({ idx: i, reason: /^\s*(?:[\w.]+\s*=\s*|return\s+|if\b|elif\b|while\b|assert\b|print\s*\()/.test(line) ? 'return_value_used' : 'command_context_unclear' });
        continue;
      }
      m = line.match(/^(.*?\bsubprocess\.(call|run|check_call|check_output|Popen)\()/);
      if (m) {
        const split = splitCallArgs(line.slice(m[1].length));
        if (!split || !split.closed) { cands.push({ idx: i, reason: 'call_syntax_unparsed' }); continue; }
        const args = split.args;
        const shellIdx = args.findIndex(a => /^\s*shell\s*=\s*True\s*$/.test(a));
        if (shellIdx < 0) continue;
        const rest = args.filter((a, k) => k !== 0 && k !== shellIdx);
        if (rest.some(a => !/^\s*[A-Za-z_]\w*\s*=/.test(a))) { cands.push({ idx: i, reason: 'positional_arguments_unclear' }); continue; }
        if (rest.some(a => /^\s*(?:executable|shell)\s*=/.test(a))) { cands.push({ idx: i, reason: 'executable_override' }); continue; }
        const parts = parseConcat(args[0], 'py');
        if (!parts) { cands.push({ idx: i, reason: 'command_expression_not_pure' }); continue; }
        if (!parts.some(p => p.v !== undefined)) continue;
        const tk = shellTokens(parts);
        if (tk.reason) { cands.push({ idx: i, reason: tk.reason }); continue; }
        cands.push({ idx: i, edits: [{ idx: i, text: m[1] + '[' + tk.argv.map(renderArgvElem).join(', ') + ']' + (rest.length ? ',' + rest.join(',') : '') + ')' + split.post }],
                     note: 'Command Injection → execFile/subprocess/escapeshellarg' });
      }
    }
    return cands;
  }

  function findCmdPHP(lines, env) {
    const cands = [];
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (/^\s*(?:\/\/|#|\*)/.test(line)) continue;
      const m = line.match(/(^|[^\w$>:])(exec|shell_exec|system|passthru|popen)\s*\(/);   // لا ->method ولا ::static
      if (!m) continue;
      const callStart = m.index + m[1].length;
      const split = splitCallArgs(line.slice(callStart + m[0].length - m[1].length));
      if (!split || !split.closed || !split.args.length) { cands.push({ idx: i, reason: 'call_syntax_unparsed' }); continue; }
      if (/escapeshellarg|escapeshellcmd/.test(split.args[0])) continue;                   // مُعالج أصلاً
      const parts = parseConcat(split.args[0], 'php');
      if (!parts) { cands.push({ idx: i, reason: 'command_expression_not_pure' }); continue; }
      if (!parts.some(p => p.v !== undefined)) continue;
      const tk = shellTokens(parts);
      if (tk.reason) { cands.push({ idx: i, reason: tk.reason }); continue; }
      // إعادة بناء الأمر: literals بين اقتباس مفرد، والمتغيرات داخل escapeshellarg()، وفراغ واحد بين الوسائط
      const seq = [];
      tk.argv.forEach((el, k) => {
        if (k > 0) seq.push({ lit: ' ' });
        el.forEach(x => seq.push(x));
      });
      const merged = [];
      for (const p of seq) {
        const last = merged[merged.length - 1];
        if (p.lit !== undefined && last && last.lit !== undefined) last.lit += p.lit; else merged.push(Object.assign({}, p));
      }
      const expr = merged.map(p => p.lit !== undefined ? "'" + p.lit + "'" : 'escapeshellarg(' + p.v + ')').join(' . ');
      const rest = split.args.slice(1);
      const text = line.slice(0, callStart) + m[2] + '(' + expr + (rest.length ? ',' + rest.join(',') : '') + ')' + split.post;
      cands.push({ idx: i, edits: [{ idx: i, text }], note: 'Command Injection → execFile/subprocess/escapeshellarg' });
    }
    return cands;
  }

  // لغات بلا fixer آمن: تقرير فقط
  const CMD_REPORT = {
    java: /Runtime\.getRuntime\(\)\.exec\s*\(.*\+|new\s+ProcessBuilder\s*\(.*\+/,
    cs:   /Process\.Start\s*\(.*\+|ProcessStartInfo\s*\(.*\+/,
    rb:   /`[^`]*#\{|\bsystem\s*\(.*(?:\+|#\{)|%x\{|Open3\.\w+\s*\(.*(?:\+|#\{)/,
    go:   /exec\.Command\s*\(\s*"(?:sh|bash|cmd)"\s*,\s*"-c"/,
  };
  function findCmdReport(lines, env) {
    const re = CMD_REPORT[env.fam];
    if (!re) return [];
    const cands = [];
    for (let i = 0; i < lines.length; i++) {
      if (/^\s*(?:\/\/|#|\*)/.test(lines[i])) continue;
      if (re.test(lines[i])) cands.push({ idx: i, reason: 'command_injection_manual_review' });
    }
    return cands;
  }

  function findCommandInjection(lines, env) {
    if (env.fam === 'js')  return findCmdJS(lines, env);
    if (env.fam === 'py')  return findCmdPy(lines, env);
    if (env.fam === 'php') return findCmdPHP(lines, env);
    return findCmdReport(lines, env);
  }

  // ─── 8. JWT (JS family): نقل secret مُضمَّن فقط — لا expiry ──────
  const JWT_NAMES = /^(?:JWT_SECRET|JWT_KEY|JWT_PRIVATE_KEY|JWT_SIGNING_KEY|TOKEN_SECRET|jwtSecret|jwtKey|jwt_secret|tokenSecret)$/;

  function replaceSecretArg(line, calleeRe, replacement) {
    const m = line.match(calleeRe);
    if (!m) return null;
    const split = splitCallArgs(line.slice(m.index + m[0].length));
    if (!split || split.args.length < 2) return null;
    const lit = split.args[1].match(/^(\s*)(['"])(?:(?!\2)[^\\\n])+\2(\s*)$/);
    if (!lit) return null;
    const args = split.args.slice();
    args[1] = lit[1] + replacement + lit[3];
    return line.slice(0, m.index) + m[0] + args.join(',') + (split.closed ? ')' + split.post : '');
  }

  function findJwt(lines, env) {
    const cands = [];
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (/^\s*(?:\/\/|\*)/.test(line)) continue;
      if (/process\.env\./.test(line)) continue;                                   // يستخدم env أصلاً — لا إعادة تغليف
      const m = line.match(/^(\s*(?:export\s+)?(?:const|let|var)\s+)([A-Za-z_$][\w$]*)(\s*=\s*)(['"])(?:(?!\4)[^\\\n])+\4(\s*;?\s*(?:\/\/.*)?)$/);
      if (m && JWT_NAMES.test(m[2])) {
        cands.push({ idx: i, edits: [{ idx: i, text: m[1] + m[2] + m[3] + 'process.env.' + toEnvName(m[2]) + m[5] }], note: 'JWT secret → env' });
        continue;
      }
      if (/\b(?:jwt|jsonwebtoken)\.(?:sign|verify)\(/.test(line)) {
        const text = replaceSecretArg(line, /\b(?:jwt|jsonwebtoken)\.(?:sign|verify)\(/, 'process.env.JWT_SECRET');
        if (text) cands.push({ idx: i, edits: [{ idx: i, text }], note: 'JWT secret → env' });
      }
    }
    return cands;
  }

  // ─── 9. Promise بلا catch: فقط جملة سلسلة مستقلة مُثبتة ─────────
  // قناع: 1 = داخل سلسلة/template، 2 = داخل تعليق
  function codeMask(src) {
    const m = new Uint8Array(src.length);
    const n = src.length;
    let i = 0;
    while (i < n) {
      const c = src[i], d = src[i + 1];
      if (c === '/' && d === '/') { while (i < n && src[i] !== '\n') m[i++] = 2; continue; }
      if (c === '/' && d === '*') {
        m[i++] = 2; m[i++] = 2;
        while (i < n && !(src[i] === '*' && src[i + 1] === '/')) m[i++] = 2;
        if (i < n) { m[i++] = 2; m[i++] = 2; }
        continue;
      }
      if (c === '"' || c === "'" || c === '`') {
        const q = c;
        m[i++] = 1;
        while (i < n && src[i] !== q) {
          if (q !== '`' && src[i] === '\n') break;
          if (src[i] === '\\') m[i++] = 1;
          if (i < n) m[i++] = 1;
        }
        if (i < n && src[i] === q) m[i++] = 1;
        continue;
      }
      i++;
    }
    return m;
  }
  function nextCode(src, mask, from) {
    for (let j = from; j < src.length; j++) {
      if (mask[j] === 2) continue;
      if (mask[j] === 1) return { ch: '"', pos: j };
      if (!/\s/.test(src[j])) return { ch: src[j], pos: j };
    }
    return { ch: '', pos: src.length };
  }
  function prevCode(src, mask, from) {
    for (let j = from; j >= 0; j--) {
      if (mask[j] === 2) continue;
      if (mask[j] === 1) return { ch: '"', pos: j };
      if (!/\s/.test(src[j])) return { ch: src[j], pos: j };
    }
    return { ch: '', pos: -1 };
  }
  function prevWord(src, mask, pos) {
    let k = pos, w = '';
    while (k >= 0 && !mask[k] && /[\w$]/.test(src[k])) { w = src[k] + w; k--; }
    return w;
  }
  function unmasked(src, mask, a, b) {
    let out = '';
    for (let j = a; j < b; j++) out += mask[j] ? ' ' : src[j];
    return out;
  }
  // نص العمق صفر فقط (ما بين الأقواس يُستبدل بفراغات)
  function depthZero(text) {
    let depth = 0, out = '';
    for (const c of text) {
      if (c === '(' || c === '[' || c === '{') { depth++; out += ' '; continue; }
      if (c === ')' || c === ']' || c === '}') { depth--; out += ' '; continue; }
      out += depth === 0 ? c : ' ';
    }
    return out;
  }

  function findPromiseCatch(lines, env) {
    const src  = lines.join('\n');
    if (!/\.then\s*\(/.test(src)) return [];
    const cands = [];
    if (/\$\.(?:ajax|Deferred|get|post|getJSON|when)\s*\(|\bjQuery\b/.test(src)) {
      return [{ idx: src.slice(0, src.search(/\.then\s*\(/)).split('\n').length - 1, reason: 'jquery_deferred_ambiguous' }];
    }
    const mask = codeMask(src);
    const lineStarts = [0];
    for (let j = 0; j < src.length; j++) if (src[j] === '\n') lineStarts.push(j + 1);
    const lineOf = pos => { let lo = 0, hi = lineStarts.length - 1; while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (lineStarts[mid] <= pos) lo = mid; else hi = mid - 1; } return lo; };
    const seen = new Set();
    const re = /\.then\s*\(/g;
    let m;
    while ((m = re.exec(src))) {
      const p = m.index;
      if (mask[p]) continue;
      // ── نهاية الجملة ──
      let depth = 0, end = -1, endSemi = false, ok = true;
      for (let j = p; j < src.length; j++) {
        if (mask[j]) continue;
        const c = src[j];
        if (c === '(' || c === '[' || c === '{') { depth++; continue; }
        if (c === ')' || c === ']' || c === '}') { if (depth === 0) { end = j; break; } depth--; continue; }
        if (depth !== 0) continue;
        if (c === ';') { end = j; endSemi = true; break; }
        if (c === ',') { ok = false; break; }
        if (c === '\n') {
          const nx = nextCode(src, mask, j + 1);
          if (nx.ch === '.') { j = nx.pos - 1; continue; }
          end = j; break;
        }
      }
      if (!ok) continue;
      if (end < 0) end = src.length;
      // ── بداية الجملة ──
      depth = 0;
      let start = -1;
      for (let k = p - 1; k >= 0; k--) {
        if (mask[k]) continue;
        const c = src[k];
        if (c === ')' || c === ']' || c === '}') { depth++; continue; }
        if (c === '(' || c === '[' || c === '{') { if (depth === 0) { start = c === '{' ? k + 1 : -2; break; } depth--; continue; }
        if (depth !== 0) continue;
        if (c === ';') { start = k + 1; break; }
        if (c === ',') { start = -2; break; }
        if (c === '\n') {
          const after = nextCode(src, mask, k + 1);
          if (after.ch === '.') continue;                                       // سطر متابعة
          const before = prevCode(src, mask, k - 1);
          if (before.ch === '' || /[;{}]/.test(before.ch)) { start = k + 1; break; }
          if (/[=+\-*\/,(\[?:&|!<>.%^]/.test(before.ch)) { start = -2; break; }
          if (/[\w$]/.test(before.ch) && /^(?:return|await|yield|throw|typeof|void|new|in|of|case|else|do|delete|instanceof)$/.test(prevWord(src, mask, before.pos))) { start = -2; break; }
          start = k + 1; break;                                                 // ASI: السطر السابق جملة مكتملة
        }
      }
      if (start === -1) start = 0;
      if (start === -2) continue;                                                // متداخل في تعبير/وسيط — ليس جملة مستقلة
      if (seen.has(start)) continue;
      seen.add(start);
      const head = unmasked(src, mask, start, p);
      if (!head.trim()) continue;
      if (/^\s*(?:return|await|throw|yield|export|const|let|var|import|typeof|void|new|delete|case|default)\b/.test(head)) continue;
      const hz = depthZero(head);
      if (/=>|(^|[^=!<>])=(?!=)|[?:,]|\bawait\b/.test(hz)) continue;               // إسناد/سهم/ثلاثي/await ⇒ القيمة مستخدمة
      const stmt = unmasked(src, mask, start, end);
      if (/\.(?:catch|finally)\s*\(/.test(stmt)) continue;                        // معالجة موجودة
      const last = prevCode(src, mask, end - 1);
      if (last.ch !== ')') { cands.push({ idx: lineOf(p), reason: 'promise_statement_end_unclear' }); continue; }
      const startLine = lineOf(start), lastLine = lineOf(last.pos);
      const lastText  = lines[lastLine];
      const col       = last.pos - lineStarts[lastLine] + 1;                     // بعد ')'
      const handler   = ".catch(err => console.error('Error:', err))";
      let text;
      if (startLine !== lastLine && /^\s*\./.test(lastText)) {
        const indent = lastText.match(/^\s*/)[0];
        const tail   = lastText.slice(col);
        const semi   = /^\s*;/.test(tail);
        text = lastText.slice(0, col) + (semi ? tail.replace(/^\s*;/, '') : tail) + '\n' + indent + handler + (semi ? ';' : '');
      } else {
        text = lastText.slice(0, col) + handler + lastText.slice(col);
      }
      cands.push({ idx: lastLine, edits: [{ idx: lastLine, text }], note: 'Promise → .catch() added' });
    }
    return cands;
  }

  // ─── 10. PHP XSS: htmlspecialchars في سياق HTML output فقط ───────
  const XSS_ESCAPED = /htmlspecialchars|htmlentities|esc_html|esc_attr|json_encode|urlencode|rawurlencode|intval|\(int\)|\(float\)/;

  function findPhpXss(lines, env) {
    const cands = [];
    const src = lines.join('\n');
    const nonHtml = /header\s*\(\s*['"]Content-Type:\s*(?!text\/html)[^'"]+['"]/i.test(src);
    let inScript = false;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const re = /\b(echo|print)\s+(\$_(?:GET|POST|REQUEST|COOKIE)\[(?:'[^'\\]*'|"[^"\\]*"|\w+)\])\s*;/g;
      let m, any = false;
      while ((m = re.exec(line))) {
        any = true;
        const pre = line.slice(0, m.index);
        let state = inScript;
        for (const t of pre.matchAll(/<\/?script\b/gi)) state = !t[0].startsWith('</');
        if (nonHtml)  { cands.push({ idx: i, reason: 'non_html_content_type' }); continue; }
        if (state)    { cands.push({ idx: i, reason: 'javascript_context' }); continue; }
        if (/<[A-Za-z][^>]*\s[\w:-]+\s*=\s*["'][^"']*(?:<\?(?:php|=)?\s*)?$/.test(pre)) { cands.push({ idx: i, reason: 'html_attribute_context' }); continue; }
        const text = line.slice(0, m.index) + m[1] + ' htmlspecialchars(' + m[2] + ", ENT_QUOTES, 'UTF-8');" + line.slice(m.index + m[0].length);
        cands.push({ idx: i, edits: [{ idx: i, text }], note: 'PHP XSS → htmlspecialchars' });
        break;                                                                    // إصلاح واحد لكل سطر في الجولة
      }
      if (!any && /\b(?:echo|print)\b[^;]*\$_(?:GET|POST|REQUEST|COOKIE)\[/.test(line) && !XSS_ESCAPED.test(line)) {
        cands.push({ idx: i, reason: 'echo_expression_not_simple' });
      }
      for (const t of line.matchAll(/<\/?script\b/gi)) inScript = !t[0].startsWith('</');
    }
    return cands;
  }

  // ─── 11. Python: except فارغ ⇒ تسجيل، بلا تغيير control flow ────
  function indentOf(line) { return line.match(/^[ \t]*/)[0].length; }

  function findPyExceptions(lines, env) {
    const cands = [];
    const src = lines.join('\n');
    const lg = src.match(/^\s*(logger|log|LOG|LOGGER|_logger|_log)\s*=\s*logging\.getLogger\(/m);
    const call = (lg ? lg[1] : 'logging') + '.exception("Unhandled exception")';
    const imports = lg ? [] : ['logging'];
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const m = line.match(/^([ \t]*)except\b([^:#]*):[ \t]*(.*)$/);
      if (!m) continue;
      const bare = m[2].trim() === '';
      const inline = m[3].trim();
      if (inline) {
        const im = inline.match(/^pass[ \t]*(#.*)?$/);
        if (im) {
          const text = m[1] + 'except' + m[2] + ': ' + call + (im[1] ? '  ' + im[1] : '');
          cands.push({ idx: i, edits: [{ idx: i, text }], note: 'Python empty except → logging', imports });
        }
        if (bare) cands.push({ idx: i, reason: 'bare_except_semantics' });
        continue;
      }
      const n = indentOf(line);
      let j = i + 1;
      while (j < lines.length && (/^\s*$/.test(lines[j]) || /^\s*#/.test(lines[j]))) j++;
      if (j < lines.length && indentOf(lines[j]) > n && /^[ \t]*pass[ \t]*(?:#.*)?$/.test(lines[j])) {
        let k = j + 1;
        while (k < lines.length && (/^\s*$/.test(lines[k]) || /^\s*#/.test(lines[k]))) k++;
        if (k >= lines.length || indentOf(lines[k]) <= n) {
          const body = lines[j];
          const cm = body.match(/#.*$/);
          cands.push({ idx: j, edits: [{ idx: j, text: body.match(/^[ \t]*/)[0] + call + (cm ? '  ' + cm[0] : '') }],
                       note: 'Python empty except → logging', imports });
        }
      }
      if (bare) cands.push({ idx: i, reason: 'bare_except_semantics' });
    }
    return cands;
  }

  // ─── 12. Audit logging: مسارات واضحة البنية وحساسة فقط ─────────
  const ROUTE_RE      = /^([ \t]*)(app|router|server|api)\.(get|post|put|delete|patch|all)\(\s*(['"`])([^'"`]*)\4\s*,(.*)$/;
  const HANDLER_TAIL  = /(?:\(\s*(req|request)\b[^()]*\)\s*=>|function\s*[\w$]*\s*\(\s*(req|request)\b[^()]*\))\s*\{\s*$/;
  const SENSITIVE_PATH = /admin|auth|login|logout|signin|signup|register|user|account|profile|payment|pay\b|order|checkout|delete|remove|role|permission|password|reset|token|secret|key|config|setting|upload|transfer|withdraw/i;
  const HAS_LOGGING   = /\[AUDIT\]|audit|console\.(?:log|info)\(|logger\.|\blog\.|\blog\(|winston|pino|morgan/i;

  function findAuditLogging(lines, env) {
    const cands = [];
    for (let i = 0; i < lines.length; i++) {
      const m = lines[i].match(ROUTE_RE);
      if (!m) continue;
      const method = m[3], path = m[5], rest = m[6];
      if (/\$\{/.test(path)) continue;
      if (!(method === 'post' || method === 'put' || method === 'delete' || method === 'patch' || SENSITIVE_PATH.test(path))) continue;
      const h = rest.match(HANDLER_TAIL);
      if (!h) continue;
      const req = h[1] || h[2];
      let j = i + 1;
      while (j < lines.length && /^\s*$/.test(lines[j])) j++;
      if (j >= lines.length) continue;
      if (indentOf(lines[j]) <= m[1].length) continue;                              // جسم فارغ
      if (HAS_LOGGING.test(lines[j])) continue;                                      // تسجيل موجود
      const indent = lines[j].match(/^[ \t]*/)[0];
      // لا تُكتب كلمات حساسة في سطر التسجيل نفسه (password/token/…): يُسجَّل نمط المسار وقت التشغيل بدلاً من الحرفي
      const pathExpr = /password|passwd|token|secret|credit|ssn|dob|key/i.test(path)
        ? '(' + req + '.route && ' + req + ".route.path) || '-'"
        : m[4] + path + m[4];
      const stmt = indent + "console.log('[AUDIT]', " + req + '.method, ' + pathExpr + ', (' + req + '.user && ' + req + ".user.id) || 'anonymous');";
      cands.push({ idx: i, edits: [{ idx: i, text: lines[i] + '\n' + stmt }], note: 'Audit logging added' });
    }
    return cands;
  }

  // ─── 13. Weak hash: تقرير فقط — لا استبدال عام ────────────────
  const WEAK_HASH = [
    /\bmd5\s*\(/i, /\bsha1\s*\(/i, /createHash\s*\(\s*['"](?:md5|sha1)['"]/i,
    /MessageDigest\.getInstance\s*\(\s*"(?:MD5|SHA-?1)"/i, /\b(?:MD5|SHA1)\.Create\s*\(/, /\bnew\s+(?:MD5|SHA1)CryptoServiceProvider\b/,
    /Digest::(?:MD5|SHA1)\b/, /\b(?:md5|sha1)\.(?:New|Sum)\b/,
  ];
  function findWeakHash(lines, env) {
    const cands = [];
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (/^\s*(?:\/\/|#|\*)/.test(line)) continue;
      if (!WEAK_HASH.some(re => re.test(line))) continue;
      cands.push({ idx: i, reason: /password|passwd|pwd|credential|login/i.test(line) ? 'weak_hash_password_context_use_password_hash' : 'weak_hash_usage_unclear' });
    }
    return cands;
  }

  // ─── 14. التجميع ─────────────────────────────────────────────
  const FIXERS = [
    { cat: 'SECRETS',   fams: ['py', 'php'],                         find: findSecrets },
    { cat: 'CMD',       fams: ['js', 'py', 'php', 'java', 'cs', 'rb', 'go'], find: findCommandInjection },
    { cat: 'JWT',       fams: ['js'],                                find: findJwt },
    { cat: 'PROMISE',   fams: ['js'],                                find: findPromiseCatch },
    { cat: 'PHP_XSS',   fams: ['php'],                               find: findPhpXss },
    { cat: 'PY_EXCEPT', fams: ['py'],                                find: findPyExceptions },
    { cat: 'AUDIT',     fams: ['js'],                                find: findAuditLogging },
    { cat: 'WEAK_HASH', fams: ['js', 'py', 'php', 'java', 'cs', 'rb', 'go'], find: findWeakHash },
  ];

  function fix(code, fileName, options) {
    options = options || {};
    const lang = detectLang(fileName);
    const result = {
      fixed: code, repairs: [], changed: false, lang,
      details: [], aiRequired: [],
      verification: { checked: 0, rolledBack: 0, analyzer: false, syntax: false },
    };
    if (typeof code !== 'string' || !code.trim()) return result;
    if (lang === 'unknown') { result.skippedReason = 'unsupported_language'; return result; }

    const fam = familyOf(lang);
    const analyze = typeof options.analyze === 'function' ? options.analyze
                  : (typeof analyzeCode === 'function' ? analyzeCode : null);
    result.verification.analyzer = !!analyze;
    result.verification.syntax   = syntaxAvailable(lang);
    // [v2.1] حالة البوابة تُعلَن في النتيجة حتى يعرف المنسّق على أي أساس بُني القرار.
    // [v2.1 patch] يُحلَّل الـverifier هنا (lazy) لا عند تحميل الملف.
    const verifier = _getFixVerifier();
    result.verification.gate = !!(verifier && typeof verifier.verifyFix === 'function');
    result.verification.gateRejected = 0;

    // Fail-Closed: بلا بوابة تحقق لا يُطبَّق أي إصلاح إطلاقًا.
    // هذا الملف لا يملك صلاحية اعتماد patch بمفرده.
    if (!result.verification.gate) {
      result.skippedReason = 'verifier_unavailable';
      // كل ما كان سيُقترح يُسجَّل كـAI_REQUIRED ليقرر المنسّق، بدل الصمت.
      result.aiRequired.push({ line: 0, category: 'ALL', status: 'AI_REQUIRED',
        reason: 'VERIFIER_UNAVAILABLE — FixVerifier غير محمّل؛ لا اعتماد بلا بوابة (Fail-Closed)' });
      return result;
    }
    const env = { lang, fam, fileName, imports: new Set() };
    let lines = code.split('\n');
    // [v2.1.1] آخر نص اجتاز البوابة فعليًا — هو مصدر result.fixed، لا إعادة بناء.
    let acceptedCode = null;
    let baseIssues;
    const ai = (cat, idx, reason) => result.aiRequired.push({ line: idx + 1, category: cat, status: 'AI_REQUIRED', reason });
    const reported = new Set();

    for (const fx of FIXERS) {
      if (!fx.fams.includes(fam)) continue;
      let cands;
      try { cands = fx.find(lines, env) || []; }
      catch (e) { ai(fx.cat, 0, 'fixer_error'); continue; }
      cands.sort((a, b) => b.idx - a.idx);
      for (const c of cands) {
        if (c.reason) {
          const key = fx.cat + ':' + c.idx + ':' + c.reason;
          if (!reported.has(key)) { reported.add(key); ai(fx.cat, c.idx, c.reason); }
          continue;
        }
        if (!c.edits || !c.edits.length) continue;
        result.verification.checked++;
        const next = applyEdits(lines, c.edits);
        let problem = structuralProblem(lines, next, c.edits, fam);
        if (!problem) {
          // idempotency: إعادة البحث على الناتج يجب ألا تُنتج تعديلاً على نفس السطر
          let again = [];
          try { again = fx.find(next, env) || []; } catch (e) { problem = 'not_idempotent'; }
          if (!problem && again.some(a => a.edits && a.idx === c.idx)) problem = 'not_idempotent';
        }
        // ── [v2.1] القرار النهائي: FixVerifier، لا المنطق المحلي ──
        // الفحوص أعلاه (structural / idempotency) pre-checks رخيصة تمنع
        // اقتراحًا فاسدًا من استهلاك دورة تحقق كاملة. البوابة هي الحكم.
        let gateReason = null;
        if (!problem) {
          const nextImports = new Set([...env.imports, ...(c.imports || [])]);
          const beforeCode  = fam === 'py' ? withPyImports(lines, env.imports) : lines.join('\n');
          const afterCode   = fam === 'py' ? withPyImports(next, nextImports)  : next.join('\n');

          // fail-fast محلي لـJS فقط (acorn) — لا يغني عن البوابة
          problem = syntaxProblem(beforeCode, afterCode, lang);

          if (!problem) {
            // كل candidate يُقاس ضد آخر كود **مقبول**، لا ضد ناتج اقتراح
            // لم يُعتمد. الفشل لا يغيّر الكود المقبول (rollback ضمني).
            let v;
            try {
              v = verifier.verifyFix(beforeCode, afterCode, fileName, analyze, {});
            } catch (e) {
              v = { accepted: false, reason: 'VERIFIER_THREW: ' + (e && e.message) };
            }
            if (!v || v.accepted !== true) {
              gateReason = (v && v.reason) || 'gate_rejected';
              result.verification.gateRejected++;
              problem = gateReason;
            } else {
              // [v2.1.1] الكود الذي اجتاز البوابة هو الذي يُعتمد، حرفيًا.
              // سابقًا كان afterCode (مع imports) يُفحص، ثم يُعاد بناء الناتج
              // النهائي من `lines` + env.imports في نهاية fix(). لم يكن هناك
              // ما يفرض تطابق الاثنين: أي اختلاف في ترتيب/محتوى الـimports
              // بين لحظة الفحص ولحظة البناء يعني اعتماد كود لم يُفحص.
              // الآن نحتفظ بالنص المعتمد نفسه ونبني منه.
              acceptedCode = afterCode;
            }
          }
        }
        if (problem) { result.verification.rolledBack++; ai(fx.cat, c.idx, 'verification_failed:' + problem); continue; }
        lines = next;
        (c.imports || []).forEach(m => env.imports.add(m));
        result.details.push({ line: c.idx + 1, category: fx.cat, note: c.note, verified: true, gateVerified: true });
        result.repairs.push(c.note);
      }
    }

    // [v2.1.1] result.fixed = آخر نص اجتاز FixVerifier، وليس إعادة بناء قد
    // تختلف عنه. إعادة البناء تبقى كمرجع للمقارنة فقط.
    if (!result.details.length) {
      result.fixed = code;
    } else {
      const rebuilt = fam === 'py' ? withPyImports(lines, env.imports) : lines.join('\n');
      if (acceptedCode !== null && rebuilt !== acceptedCode) {
        // انحراف بين المفحوص والمبني: Fail-Closed — لا نعتمد نصًا لم يُفحص.
        result.verification.driftDetected = true;
        result.aiRequired.push({ line: 0, category: 'ALL', status: 'AI_REQUIRED',
          reason: 'OUTPUT_DRIFT — الناتج المُعاد بناؤه يخالف النص الذي اجتاز البوابة؛ ' +
                  'أُلغيت كل الإصلاحات (Fail-Closed)' });
        result.details.length = 0;
        result.repairs.length = 0;
        result.fixed = code;
        result.changed = false;
        return result;
      }
      result.fixed = acceptedCode !== null ? acceptedCode : rebuilt;
    }
    result.changed = result.fixed !== code;
    return result;
  }

  return { fix, detectLang, VERSION };
})();

if (typeof window !== 'undefined') window.AdvancedRepair = AdvancedRepair;
if (typeof module !== 'undefined') module.exports = AdvancedRepair;

