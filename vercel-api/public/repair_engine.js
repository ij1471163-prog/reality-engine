// ═══════════════════════════════════════════════════════
// repair_engine.js v3.2 — Language-aware Repair Engine
// ═══════════════════════════════════════════════════════

// ─── Language Allowlists per Strategy ────────────────
const STRATEGY_LANGS = {
  XSS_INNER_HTML:   ['js', 'ts'],
  HTTP_USAGE:       ['js', 'ts', 'py', 'php', 'java', 'cs'],
  VAR_USAGE:        ['js', 'ts'],
  LOOSE_EQUALITY:   ['js', 'ts'],
  ACCUMULATION:     ['js', 'ts', 'py', 'php'],
  HARDCODED_SECRET: ['js', 'ts', 'py', 'php', 'java', 'cs'],
  LOG_SECRET:       ['js', 'ts', 'py', 'java'],
  EMPTY_CATCH:      ['js', 'ts', 'py', 'java', 'cs'],
  EMPTY_FUNCTION:   ['js', 'ts', 'py'],
  CALLBACK_HELL:    ['js', 'ts'],
  API_KEY:          ['js', 'ts', 'py', 'php', 'java', 'cs'],
  SQL_INJECTION:    ['js', 'ts', 'py', 'php', 'cs'],
  EVAL_USAGE:       ['js', 'ts', 'py'],
  WEAK_CRYPTO:      ['js', 'ts', 'py', 'php', 'java', 'cs'],
  MD5_USAGE:        ['js', 'ts', 'py', 'php', 'java', 'cs'],
  WEAK_HASH:        ['js', 'ts', 'py', 'php', 'java', 'cs'],
  HARDCODED_PASS:   ['js', 'ts', 'py', 'java', 'cs'],
  CMD_INJECTION:    ['js', 'ts'],
  CMD_INJECTION_PY: ['py'],
  NONE_COMPARE:     ['py'],
  NAMEERROR:        ['py'],
  MISSING_AUTH:     ['js', 'ts'],
  RETURN_NULL:      [],
  NPE_CHAIN:        [],
};

const STRATEGIES = {
  XSS_INNER_HTML:   { fn: fixXSS,               autoFix: true,  confidence: 0.95 },
  HTTP_USAGE:       { fn: fixHTTP,               autoFix: true,  confidence: 0.98 },
  VAR_USAGE:        { fn: fixVar,                autoFix: true,  confidence: 0.95 },
  LOOSE_EQUALITY:   { fn: fixEquality,           autoFix: true,  confidence: 0.90 },
  ACCUMULATION:     { fn: fixAccumulation,       autoFix: true,  confidence: 0.88 },
  HARDCODED_SECRET: { fn: fixHardcodedSecret,    autoFix: true,  confidence: 0.85 },
  LOG_SECRET:       { fn: fixLogSecret,          autoFix: true,  confidence: 0.90 },
  EMPTY_CATCH:      { fn: fixEmptyCatch,         autoFix: true,  confidence: 0.80 },
  // ═══════════════════════════════════════════════════
  // [STUB-NOT-FIX] كان ‎autoFix: true‎، وما يُنتجه المُصلِحُ تعليقٌ لا تنفيذ:
  //     function handleError() {}  ⇒  function handleError() {
  //                                     // TODO: implement
  //                                   }
  // والكاشفُ نفسُه يَعُدّ جسمًا تعليقُه وحدَه فارغًا (الشرطُ الصريحُ في
  // ‎pattern_detector‎: ‎nextLines[0].startsWith('//') && nextLines[1] === '}'‎).
  // فالبلاغُ لا يزول — مقيس: «دالة ناقصة» 1 قبل و1 بعد.
  //
  // وللتناقضِ ثمنان مقيسان:
  //   • وحدَها: البوابةُ تحكم ‎REJECTED_NO_IMPROVEMENT‎ بحقّ، وGhost يطرح
  //     الدفعةَ كلَّها ⇒ صفرُ إصلاح.
  //   • مع غيرها: تركب الدفعةَ التي أنقصت العددَ بسببِ إصلاحاتٍ أخرى،
  //     فتُحتسَب إصلاحًا (‎fixed=3‎) والبلاغُ باقٍ ⇒ نجاحٌ مُعلَنٌ بلا إصلاح.
  //
  // فالحلُّ ليس إرضاءَ الكاشفِ بنصٍّ آخر: ملءُ جسمِ دالّةٍ فارغةٍ قرارٌ
  // دلاليٌّ لا يُشتقّ من اسمِها، و‎throw‎ أو ‎return null‎ تغييرُ سلوكٍ لا
  // إصلاح. فتُعلَن كما هي: ‎autoFix: false‎ كـ‎CALLBACK_HELL‎ و‎MISSING_AUTH‎،
  // فيذهب البلاغُ إلى ‎aiNeeded‎ صادقًا بدل أن يُعَدَّ مُصلَحًا.
  // و‎fn‎ يبقى موضعَه: لا يُنادى مع ‎autoFix: false‎، وحذفُه تغييرٌ بلا داعٍ.
  // ═══════════════════════════════════════════════════
  EMPTY_FUNCTION:   { fn: fixEmptyFunction,      autoFix: false, confidence: 0.70 },
  CALLBACK_HELL:    { fn: null,                  autoFix: false, confidence: 0.75 },
  MISSING_AUTH:     { fn: null,                  autoFix: false, confidence: 0.70 },
  API_KEY:          { fn: fixApiKeyAdvanced,     autoFix: true,  confidence: 0.90 },
  SQL_INJECTION:    { fn: fixSQLInjection,       autoFix: true,  confidence: 0.75 },
  EVAL_USAGE:       { fn: fixEval,               autoFix: true,  confidence: 0.85 },
  WEAK_CRYPTO:      { fn: fixWeakCrypto,         autoFix: true,  confidence: 0.90 },
  MD5_USAGE:        { fn: fixWeakCrypto,         autoFix: true,  confidence: 0.90 },
  WEAK_HASH:        { fn: fixWeakCrypto,         autoFix: true,  confidence: 0.90 },
  HARDCODED_PASS:   { fn: fixHardcodedPassword,  autoFix: true,  confidence: 0.82 },
  CMD_INJECTION:    { fn: fixCommandInjection,   autoFix: true,  confidence: 0.78 },
  CMD_INJECTION_PY: { fn: fixCommandInjectionPy, autoFix: true,  confidence: 0.85 },
  NONE_COMPARE:     { fn: fixNoneCompare,        autoFix: true,  confidence: 0.95 },
  NAMEERROR:        { fn: fixNameError,          autoFix: true,  confidence: 0.90 },
  RETURN_NULL:      { fn: null,                  autoFix: false, confidence: 0.10 },
  NPE_CHAIN:        { fn: null,                  autoFix: false, confidence: 0.15 },
};

// ─── Language variants for explicit strategies ───────
// detector يضع مفتاحًا واحدًا (CMD_INJECTION)، واللغة تحدد الإصلاح الفعلي —
// نفس تحويل الـtitle fallback (command → CMD_INJECTION_PY في Python).
const STRATEGY_LANG_VARIANTS = {
  CMD_INJECTION: { py: 'CMD_INJECTION_PY' },
};

// ─── detectExt — امتداد الملف فقط ───────────────────
function detectExt(code, fileName) {
  if (!fileName) return 'unknown';
  const ext = fileName.split('.').pop().toLowerCase();
  if (ext === 'jsx' || ext === 'mjs' || ext === 'cjs') return 'js';
  if (ext === 'tsx') return 'ts';
  // detectExt يحدد هوية الملف من الامتداد فقط.
  // دعم الإصلاحات تحدده STRATEGY_LANGS لاحقًا.
  return ext || 'unknown';
}

// ─── Python: import os آمن ────────────────────────────
// إصلاح يكتب os.environ.get(...) بلا import os ينتج NameError وقت التشغيل —
// إصلاح مزيّف يمر من الـverifier. يُضاف import os بعد shebang/encoding/
// docstring/__future__ (قبل __future__ = SyntaxError). أي بنية غير مؤكدة ⇒ null
// (لا إصلاح) بدل التخمين.
// [PY-IMPORT] نفسُ المنطقِ لأيِّ وحدة، لا لـ‎os‎ وحدها: ‎fixEmptyCatch‎ كان
// يُقحم ‎import logging‎ بـ‎unshift‎ في السطرِ صفرٍ، وهو ما يُكسر الملفَ أمام
// shebang أو ‎from __future__‎، ويعتمد ‎code.includes('import logging')‎ وهي
// تُطابق تعليقًا أو نصًّا فيُترك الاستيرادُ ناقصًا. فالحارسُ المحكمُ أدناه
// يخدم الوحدتين، والاسمان القديمان يبقيان كما هما.
function _pyBindsModule(code, mod) {
  const rx = new RegExp('^' + mod + '(\\.\\w+)*$');
  return code.split('\n').some(l => {
    const m = l.match(/^import[ \t]+([^#]+)/);
    return !!m && m[1].split(',').some(item => rx.test(item.trim()));
  });
}
function _pyBindsOs(code) { return _pyBindsModule(code, 'os'); }
function _pyEnsureImport(code, mod) {
  if (_pyBindsModule(code, mod)) return code;
  const L = code.split('\n');
  let i = 0;
  if (L[0] !== undefined && L[0].startsWith('#!')) i = 1;
  while (i < L.length && i < 2 && /^#.*coding[:=]/.test(L[i])) i++;
  // تجاوز الأسطر الفارغة والتعليقات قبل أول جملة
  let j = i;
  while (j < L.length && /^\s*(#.*)?$/.test(L[j])) j++;
  // module docstring
  const doc = j < L.length && L[j].match(/^[rRuUbB]{0,2}("""|''')/);
  if (doc) {
    const q = doc[1];
    const rest = L[j].slice(L[j].indexOf(q) + 3);
    let end = rest.includes(q) ? j : -1;
    for (let k = j + 1; end < 0 && k < L.length; k++) if (L[k].includes(q)) end = k;
    if (end < 0) return null;                 // docstring غير مغلق ⇒ لا حكم
    i = end + 1;
  }
  // from __future__ يجب أن يبقى أولًا
  for (let k = i; k < L.length; k++) {
    if (/^\s*(#.*)?$/.test(L[k])) continue;
    if (/^from[ \t]+__future__[ \t]+import\b/.test(L[k])) {
      if (L[k].includes('(') && !L[k].includes(')')) return null;   // متعدد الأسطر ⇒ لا حكم
      i = k + 1;
      continue;
    }
    break;
  }
  L.splice(i, 0, 'import ' + mod);
  return L.join('\n');
}
function _pyEnsureImportOs(code) { return _pyEnsureImport(code, 'os'); }

// ─── Helper ───────────────────────────────────────────
function replaceLineInCode(code, lineNum, newLine) {
  const lines = code.split('\n');
  lines[lineNum - 1] = newLine;
  return lines.join('\n');
}

// ─── SQL Injection ────────────────────────────────────
function fixSQLInjection(code, issue, lines2, ext2, fileName) {
  const lines = code.split('\n');
  const ln = issue.line - 1;
  if (ln < 0 || ln >= lines.length) return null;
  const line = lines[ln];
  const ext = detectExt(code, fileName);

  if (ext === 'py') {
    // Python SQL: السياق والdriver غير معروفَين — نترك للمراجعة اليدوية
    return null;
  } else if (ext === 'js' || ext === 'ts') {
    // [SQL-BIND] كان هنا استبدالٌ نصّيٌّ يقلب الضمَّ إلى ‎?‎ **ويحذف الوسيطَ
    // نهائيًّا**، فينتج استعلامٌ بعلامةٍ نائبةٍ بلا قيمةٍ تُربَط بها:
    //     db.query("… n = '" + name + "'")  ⇒  db.query("… n = ?")
    // وهو برنامجٌ مكسورٌ لا إصلاح. والبوابةُ كانت تردُّه بحقٍّ
    // (‎SQL_PLACEHOLDERS_UNBOUND‎ و‎SQL_NOT_PARAMETERIZED‎)، ومقيسٌ أن
    // المسارَ القديمَ لم يُنتج ولا إصلاحًا مقبولًا واحدًا على 78 ملفًا
    // فيها بلاغُ SQL. فالعطبُ في المُصلِحِ لا في البوابة.
    //
    // والبديلُ يبني الاستدعاءَ المُعامَلَ كاملًا: النصُّ بعلاماتٍ نائبة،
    // والتعبيراتُ المحذوفةُ تُنقَل إلى مصفوفةِ القيمِ بترتيبِها.
    // وما لا يُحسَم — قالبُ نصّ، أو وسيطٌ متغيّرٌ لا ضمَّ فيه، أو نداءٌ
    // ليس استعلامًا، أو استدعاءٌ له وسائطُ أخرى — يُرجِع ‎null‎ فيذهب
    // البلاغُ إلى ‎aiNeeded‎ صادقًا بدل رُقعةٍ تُفقد القيمة.
    const bound = _sqlBindCall(line);
    if (!bound) return null;
    lines[ln] = bound;
    return { fixed: lines.join('\n'), patch: lines[ln], reason: 'SQL Injection — parameterized query' };
  } else if (ext === 'php') {
    const phpM = line.match(/\$(\w+)\s*=\s*["']([^"']+)["']\s*\.\s*\$(\w+)/);
    if (!phpM) return null;
    const indent = ' '.repeat(line.search(/\S/));
    lines[ln] = `${indent}$stmt = $conn->prepare("${phpM[2]}?");`;
    lines.splice(ln + 1, 0, `${indent}$stmt->bind_param("s", $${phpM[3]});`);
    lines.splice(ln + 2, 0, `${indent}$stmt->execute();`);
    return { fixed: lines.join('\n'), patch: lines[ln], reason: 'PHP SQL Injection — prepared statement' };
  } else if (ext === 'cs') {
    // [CS-BIND] كان الناتجُ مكسورًا من ثلاثِ جهات: الموضعُ يبقى داخلَ
    // اقتباسِ SQL (‎'@param'‎ نصٌّ لا معامِل)، وبقيّةُ الضمِّ ‎+ "'"‎ تبقى،
    // ويُشار إلى ‎cmd‎ وهو **متغيّرٌ غيرُ موجودٍ في النطاق** فلا يُترجَم
    // الملفّ. والمحلّلُ يظلّ يرى الحقنَ فتردُّه البوابةُ بحقّ
    // (‎SQL_INJECTION_STILL_REPORTED‎). فالعطبُ في المُصلِحِ لا فيها.
    //
    // والبديلُ لا يخترع كائنَ أمر: لا يعمل إلا حيث يكون الكائنُ مُسمًّى
    // في السطرِ نفسِه — إنشاءُ أمرٍ مُسنَدٌ إلى متغيّر، أو إسنادٌ إلى
    // ‎CommandText‎ — وما عدا ذلك ‎null‎ فيذهب البلاغُ إلى ‎aiNeeded‎.
    const csFix = _csBindCommand(line);
    if (!csFix) return null;
    lines[ln] = csFix.line;
    csFix.adds.forEach((a, k) => lines.splice(ln + 1 + k, 0, a));
    return { fixed: lines.join('\n'), patch: lines[ln], reason: 'C# SQL Injection — SqlParameter' };
  }
  return null;
}

// ─── eval() ───────────────────────────────────────────
function fixEval(code, issue, lines2, ext2, fileName) {
  const lines = code.split('\n');
  const ln = issue.line - 1;
  if (ln < 0 || ln >= lines.length) return null;
  const line = lines[ln];
  if (!/\beval\s*\(/.test(line)) return null;
  const ext = detectExt(code, fileName);
  const indent = ' '.repeat(line.search(/\S/));
  const argMatch = line.match(/eval\s*\(([^)]+)\)/);
  const arg = argMatch ? argMatch[1] : 'data';

  if (ext === 'js' || ext === 'ts') {
    if (/json|data|response|result/i.test(arg)) {
      lines[ln] = line.replace(/eval\s*\([^)]+\)/, `JSON.parse(${arg})`);
    } else {
      // لا نحذف السطر ولا نغيّر معناه عندما لا يكون المقصود JSON واضحًا.
      // الإصلاح الدلالي يُترك لمسار AI_REQUIRED.
      return null;
    }
    return { fixed: lines.join('\n'), patch: lines[ln], reason: 'eval() replaced with safe alternative' };
  } else if (ext === 'py') {
    lines[ln] = line.replace(/eval\s*\(([^)]+)\)/, 'ast.literal_eval($1)');
    if (!code.includes('import ast')) lines.unshift('import ast');
    return { fixed: lines.join('\n'), patch: lines[ln], reason: 'eval() → ast.literal_eval()' };
  }
  return null;
}

// ─── Hardcoded Password ───────────────────────────────
function fixHardcodedPassword(code, issue, lines2, ext2, fileName) {
  const lines = code.split('\n');
  const ln = issue.line - 1;
  if (ln < 0 || ln >= lines.length) return null;
  const line = lines[ln];
  // Idempotency: السطر يقرأ أصلًا من متغير بيئة ⇒ الاستبدال ينتج self-assignment.
  if (/process\.env\.|os\.environ|getenv\s*\(/i.test(line)) return null;
  const ext = detectExt(code, fileName);
  const varMatch = line.match(/(\w+)\s*[:=]/);
  const varName = varMatch ? varMatch[1].toUpperCase() : 'SECRET';

  let fixed = line;
  if (ext === 'py') {
    if (line.includes('os.environ')) return null;
    fixed = line.replace(/(["\'])[^"\']+(["\'])/, `os.environ.get('${varName}', '')`);
    // import os يُضاف بعد كتابة السطر: lines.unshift كان يزيح ln فيُكتب السطر في
    // الموضع الخطأ ويبقى الـsecret الأصلي في الكود
    if (fixed === line) return null;
    lines[ln] = fixed;
    const withOs = _pyEnsureImportOs(lines.join('\n'));
    if (withOs === null) return null;
    return { fixed: withOs, patch: fixed.trim(), reason: 'Hardcoded credential moved to env variable' };
  } else if (ext === 'js' || ext === 'ts') {
    fixed = line.replace(/(["\'])[^"\']+(["\'])/, `process.env.${varName}`);
  } else if (ext === 'java') {
    fixed = line.replace(/(["\'])[^"\']+(["\'])/, `System.getenv("${varName}")`);
  } else if (ext === 'cs') {
    fixed = line.replace(/(["\'])[^"\']+(["\'])/, `Environment.GetEnvironmentVariable("${varName}")`);
  } else if (ext === 'php') {
    if (/getenv\s*\(/i.test(line)) return null;
    fixed = line.replace(/(["\'])[^"\']+(["\'])/, `getenv('${varName}')`);
  } else {
    return null;
  }

  if (fixed === line) return null;
  lines[ln] = fixed;
  return { fixed: lines.join('\n'), patch: fixed.trim(), reason: 'Hardcoded credential moved to env variable' };
}

// ─── Command Injection JS/TS — splice لا string concat ─
// [FIX] exec( ليست أمر shell بمجرد الاسم: RegExp.prototype.exec، db.exec،
// stmt.exec، conn.exec، qb.exec و pattern.exec كلها APIs أخرى. تعقيم أمر
// shell عليها يخرّب الكود (استعلام SQL يُجرَّد من ترقيمه، و.replace على كائن
// params ينهار وقت التشغيل).
// القاعدة: أمر shell فقط إذا أُثبت أنه exec الخاص بـchild_process — exec(
// مباشر بلا نقطة، أو مستقبِل مربوط بـrequire/import من child_process.
// المستقبِل المجهول يُرفض (fail-closed): لا إصلاح، وتُمرَّر المشكلة كما هي.
//
// حدود هذا الفحص: الربط يُستدلّ عليه نصيًا، فثلاث حالات تمرّ وهي ليست ربطًا.
// الثلاث تشترط أن يحمل المستقبِل نفس معرّف الربط (name collision)، ولا يمكن
// حسمها إلا بتحليل نطاق/تدفّق لا يقدر عليه regex، وكلها كانت تمرّ أيضًا قبل
// وجود هذا الحارس — فهي حدّ معروف لا انحدار:
//   1) require داخل نص حرفي: const s = "const cp = require('child_process')"
//      (لا يمكن تجريد النصوص هنا لأن اسم الوحدة نفسه نصّ حرفي)
//   2) معامل يُظلّل الربط في نطاق آخر: f(){const cp=require(...)} / g(cp){cp.exec()}
//   3) إعادة إسناد بعد الربط: let cp=require(...); cp=getDb(); cp.exec()
// لا تُحَل بالتخمين: أي تشديد نصيّ إضافي سيرفض روابط شرعية.
function _isCommandExecCall(code, line, execIndex) {
  const before = line.slice(0, execIndex);
  if (!/\.\s*$/.test(before)) return true; // exec( بلا نقطة = نمط child_process الكلاسيكي (destructured exec)
  if (/require\s*\(\s*['"](?:node:)?child_process['"]\s*\)\s*\.\s*$/.test(before)) return true;

  // مستقبِل غير معرّف بسيط (/re/.exec، ).exec، this.x.exec) لا يُثبت شيئًا
  const recv = before.match(/(?:^|[^\w$.])([A-Za-z_$][\w$]*)\s*\.\s*$/);
  if (!recv) return false;

  // الدليل يُقرأ من الكود وحده: تعليق يذكر child_process ليس ربطًا.
  const scan = code.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ');

  const esc = recv[1].replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const CP = `['"](?:node:)?child_process['"]`;
  // بين الاسم وfrom لا يصحّ إلا بند import حقيقي: `, { ... }` أو `, * as ns`
  const CLAUSE = `(?:,\\s*(?:\\*\\s+as\\s+[A-Za-z_$][\\w$]*|\\{[^}]*\\}))?`;

  // [FIX] دليل نصّي غامض لا يُثبت الربط، فيُرفض كالمستقبِل المجهول. حلّ الغموض
  // يحتاج تحليل نطاق/تدفّق، لكن كشفه والرفض عنده لا يحتاجه.

  // (أ) المعرّف يظهر معاملًا لدالة ⇒ قد يُظلّل الربط في نطاق آخر.
  for (const pm of scan.matchAll(/\bfunction\b[^(]*\(([^()]*)\)|\(([^()]*)\)\s*=>/g)) {
    const params = (pm[1] !== undefined ? pm[1] : pm[2]).split(',');
    for (const p of params)
      if (p.replace(/[=:].*$/, '').replace(/^\s*\.\.\./, '').trim() === recv[1]) return false;
  }

  // (ب) المعرّف يُسند من شيء غير require('child_process') ⇒ الربط قد يكون بائتًا.
  const CP_RHS = new RegExp(`^\\s*require\\s*\\(\\s*${CP}\\s*\\)`);
  // الطرف الأيمن قد يبدأ على السطر التالي (const cp =\n  require(...))، فيُقرأ
  // حتى الفاصلة المنقوطة؛ والفحص مثبَّت على البداية فلا يضرّ طوله.
  for (const am of scan.matchAll(new RegExp(`(?:^|[^\\w$.])${esc}\\s*=(?![=>])([^;]*)`, 'g')))
    if (!CP_RHS.test(am[1])) return false;

  // (ج) الدليل يجب أن يكون كودًا لا محتوى نصٍّ حرفي.
  const binding = new RegExp(
    // cp = require(...) تعريفًا أو إعادة إسناد — لكن ليس عضوًا مثل obj.cp
    `(?:^|[^\\w$.])${esc}\\s*=\\s*require\\s*\\(\\s*${CP}\\s*\\)` +
    // import cp / import * as cp / import cp, { spawn } / import cp, * as ns
    `|\\bimport\\s+(?:\\*\\s+as\\s+)?${esc}\\b\\s*${CLAUSE}\\s+from\\s+${CP}` +
    // TypeScript: import cp = require('...')
    `|\\bimport\\s+${esc}\\s*=\\s*require\\s*\\(\\s*${CP}\\s*\\)`, 'g');
  // المطابقة تجري على الكود كاملًا (فالربط قد يمتد سطرين)، ثم يُعيَّن موضع
  // بدايتها إلى سطره لفحص النصوص الحرفية عند ذلك العمود.
  const srcLines = scan.split('\n');
  const lineStart = [];
  for (let i = 0, at = 0; i < srcLines.length; i++) { lineStart.push(at); at += srcLines[i].length + 1; }
  for (const bm of scan.matchAll(binding)) {
    let li = 0;
    while (li + 1 < lineStart.length && lineStart[li + 1] <= bm.index) li++;
    const col = bm.index - lineStart[li];
    const lits = _lineLiterals(srcLines[li], 'js');
    if (!lits.some(q => q.kind === 'string' && col > q.start && col < q.end - 1)) return true;
  }
  return false;
}

// ─── [CMD-ALLOWLIST] قائمةُ السماح في تعقيم وسيطِ exec ──────────────────
//
// كانت ‎[^a-zA-Z0-9 ]‎: تُسقط كلَّ ما ليس حرفًا أو رقمًا أو فراغًا. فالحقنُ
// يُمنَع، لكن الأمرَ الناتج يفقد معناه — وهذا مقيسٌ على المُنتَج المقبولِ
// فعلًا (البوابةُ تقبله ويُطبَّق على شفرة المستخدم):
//
//     ls /var/log      ⇒ ls varlog
//     ls /tmp/my-dir   ⇒ ls tmpmydir
//     ls report.txt    ⇒ ls reporttxt
//     ls -la /etc      ⇒ ls la etc
//
// أي أن الإصلاحَ يُزيل الثغرةَ ويُعطّل البرنامج. وسَلِم من تسعةِ مدخلاتٍ
// واقعيةٍ واحدٌ فقط.
//
// والمُضافُ هنا ‎-./:=_‎ وحدها، ولا متحكّمَ صَدَفيٍّ فيها. وبرهانُ ذلك
// تنفيذيٌّ لا استدلاليّ: سبعَ عشرةَ حملةَ حقنٍ (‎;‎ و‎&&‎ و‎||‎ و‎|‎ و‎$()‎
// والإحلالُ الخلفي وسطرٌ جديد و‎&‎ و‎>‎ و‎<‎ والأقواسُ وإقحامُ الاقتباس
// والمائلُ العكسي وتوسيعُ الأقواس والمنزلُ والنجمة) أُجريت عبر ‎/bin/sh -c‎
// وكلُّ حملةٍ منها تُنشئ ملفًا إن نُفِّذت: **صفرٌ من سبعةَ عشرَ نُفِّذ،
// بالقائمتين معًا**. فالأمانُ لم يتغيّر، والسلوكُ عاد (9 من 9).
//
// وما لا يُعالجه هذا ولا كان يُعالجه: ‎/‎ و‎.‎ يمرّان، فـ‎../..‎ يَسلَم. وهو
// تجاوزُ مسارٍ لا حقنُ أوامر — صنفٌ آخر، وقائمٌ في الأصل قبل الإصلاح. ولم
// تكن القائمةُ السابقةُ تمنعه قصدًا بل عرَضًا لأنها تُحطّم كلَّ مسار.
//
// والنمطُ هنا موضعٌ واحد: المُولِّدُ والحارسُ (‎cmdCandidateProblem‎) يقرآن
// منه، فلا يتفارقان — وتفارقُهما يُسقط كلَّ مُرشَّحٍ بـ‎CMD_SYNTAX_INVALID‎.
// ─── [CMD-NO-OPTION] ولا تبدأ كلمةٌ بشَرطة ────────────────────────────────
//
// إبقاءُ ‎-‎ أعاد بابًا كانت القائمةُ القديمة تُغلقه **عرَضًا**: حقنُ أعلام.
// فالقيمةُ المُحقَنة تصير عَلَمًا للأمر، وكثيرٌ من الأدوات تملك أعلامًا تكتب
// أو تُنفّذ. والمقيس بتشغيلٍ حقيقي، بضبطٍ أوّليٍّ يستثني ما يُنشئه الأمرُ
// الشرعيُّ نفسُه:
//
//     find . -name "x -fprintf PWN y"   ⇒ أُنشئ PWN      (كتابةُ ملفٍ تعسّفية)
//     find . -name "x -o -fls PWN"      ⇒ أُنشئ PWN
//     find . -name "x -o -fprint PWN"   ⇒ أُنشئ PWN
//
//     القائمةُ القديمة    مُنِع 6 من 6   (وتُحطّم كلَّ مسار)
//     بالأحرفِ وحدها      مُنِع 3 من 6   ← الانحدار
//     ومعها هذا الحدّ      مُنِع 6 من 6   وحفظُ السلوك 6 من 6
//
// فتُحذَف الشَرطةُ في **بداية** كلمةٍ فقط، فلا يصير المُدخَلُ عَلَمًا؛ وتبقى
// داخل الاسم فلا يتأذّى ‎my-dir‎ ولا ‎a_b-c.d‎.
//
// ⚠️ وما يبقى مفتوحًا بعد هذا: الفراغُ مسموح، فحقنُ **مُعامَلاتٍ** إضافية
// قائم (‎exec("rm -rf " + dir)‎ مع ‎dir="a b"‎ يحذف اثنين). ولا قائمةَ أحرفٍ
// تُغلق ذلك — يلزم فصلُ الأمر عن وسائطه بـ‎execFile/spawn‎. فهذا تخفيفٌ
// لا معالجةٌ تامّة، وحدُّه معلنٌ هنا لا مُضمَر.
const CMD_SANITIZE_CLASS = "[^A-Za-z0-9 ._/=:-]";
const CMD_SANITIZE_CALL  = ".replace(/" + CMD_SANITIZE_CLASS + "/g, '')" +
                           ".replace(/(^|\\s)-+/g, '$1')";

// ‎const‎ على مستوى النصّ لا يصير خاصيةً عامّة، والاختباراتُ تحمّل الملفَ في
// سياقٍ معزول. فتُنشَر عبر دالّة — والدوالُّ عامّةٌ هنا — كي تقرأ الاختباراتُ
// المصدرَ الواحد بدل أن تحمل نسخةً بديلةً منه تنحرف عنه.
function cmdSanitizeCall() { return CMD_SANITIZE_CALL; }

function fixCommandInjection(code, issue, lines2, ext2, fileName) {
  const lines = code.split('\n');
  const ln = issue.line - 1;
  if (ln < 0 || ln >= lines.length) return null;
  const line = lines[ln];
  const ext = detectExt(code, fileName);
  if (ext !== 'js' && ext !== 'ts') return null;

  const execMatch = /\bexec\s*\(/.exec(line);
  if (!execMatch) return null;
  // [FIX] مستقبِل غير مُثبت أنه child_process ليس command injection — لا نلمسه.
  if (!_isCommandExecCall(code, line, execMatch.index)) return null;

  const indent = ' '.repeat(line.search(/\S/));
  const execArg = line.match(/exec\s*\(([^)]+)\)/)?.[1] || 'command';
  const safeLine = line.replace(/exec\s*\([^)]+\)/, 'exec(safeArgs)');

  // أسطر مضافة بشكل صحيح عبر splice
  lines.splice(ln, 1,
    `${indent}// SECURITY: validate input before exec`,
    `${indent}const safeArgs = ${execArg}${CMD_SANITIZE_CALL};`,
    safeLine
  );
  return { fixed: lines.join('\n'), patch: lines[ln], reason: 'Command injection mitigated' };
}

// ─── Weak Crypto ──────────────────────────────────────
function fixWeakCrypto(code, issue, lines2, ext2, fileName) {
  const lines = code.split('\n');
  const ln = issue.line - 1;
  if (ln < 0 || ln >= lines.length) return null;
  const line = lines[ln];
  const ext = detectExt(code, fileName);
  let fixedLine = line;

  if (ext === 'py') {
    fixedLine = line
      .replace(/hashlib\.md5\s*\(/g, 'hashlib.sha256(')
      .replace(/hashlib\.sha1\s*\(/g, 'hashlib.sha256(');
  } else if (ext === 'js' || ext === 'ts') {
    fixedLine = line
      .replace(/createHash\s*\(\s*["']md5["']\s*\)/gi, 'createHash("sha256")')
      .replace(/createHash\s*\(\s*["']sha1["']\s*\)/gi, 'createHash("sha256")');
  } else if (ext === 'php') {
    fixedLine = line
      .replace(/md5\s*\(/gi, 'hash("sha256", ')
      .replace(/sha1\s*\(/gi, 'hash("sha256", ');
  } else if (ext === 'cs') {
    fixedLine = line
      .replace(/MD5\.Create\s*\(\s*\)/g, 'SHA256.Create()')
      .replace(/new MD5CryptoServiceProvider\s*\(\s*\)/g, 'new SHA256Managed()');
  } else if (ext === 'java') {
    fixedLine = line
      .replace(/MessageDigest\.getInstance\s*\(\s*["']MD5["']\s*\)/g, 'MessageDigest.getInstance("SHA-256")')
      .replace(/MessageDigest\.getInstance\s*\(\s*["']SHA-1["']\s*\)/g, 'MessageDigest.getInstance("SHA-256")');
  } else {
    return null;
  }

  if (fixedLine === line) return null;
  lines[ln] = fixedLine;
  return { fixed: lines.join('\n'), patch: fixedLine.trim(), reason: 'Weak crypto MD5/SHA1 → SHA256' };
}

// ─── WEAK_CRYPTO: سياق credential ─────────────────────
// يُرجع سبب منع إعادة الكتابة أو null. الأسماء هنا تُستخدم فقط لـ"منع" إصلاح
// (أكثر تحفظًا)، لا لإثبات أمان أي شيء.
const _CREDENTIAL_RE = /pass(?:word|wd|phrase)|pwd|credential/i;

// توقيع الدالة المحيطة بالسطر (js/ts/php: بموازنة الأقواس، py: بالإزاحة)
function _enclosingFunctionSig(lines, idx, ext) {
  if (ext === 'py') {
    const ind = (lines[idx].match(/^\s*/) || [''])[0].length;
    for (let k = idx - 1; k >= 0; k--) {
      const m = lines[k].match(/^(\s*)(?:async\s+)?def\s+\w+\s*\(([^)]*)\)/);
      if (m && m[1].length < ind) return { line: lines[k], params: m[2] };
      if (/^\S/.test(lines[k]) && !/^\s*(#|@)/.test(lines[k]) && lines[k].trim()) break;   // خرجنا لمستوى الـmodule
    }
    return null;
  }
  let depth = 0;
  for (let k = idx - 1; k >= 0 && k >= idx - 200; k--) {
    const l = lines[k];
    depth += (l.split('}').length - 1) - (l.split('{').length - 1);
    if (depth < 0) {
      const m = l.match(/function\s*\w*\s*\(([^)]*)\)/) || l.match(/\(([^)]*)\)\s*(?::\s*[\w<>[\]| ]+)?\s*=>/) ||
                l.match(/(\w+)\s*=>/) || l.match(/^\s*(?:async\s+)?\w+\s*\(([^)]*)\)\s*\{/);
      if (m) return { line: l, params: m[1] || '' };
      depth = 0;   // كتلة ليست دالة (if/for) — نكمل للأعلى
    }
  }
  return null;
}

function weakCryptoCredentialProblem(code, issue, ext) {
  const raw = [issue.cwe, issue.cAct, issue.title].filter(Boolean).join(' ');
  if (/CWE-?(916|759|760)\b|password|كلمة\s*(ال)?مرور/i.test(raw)) return 'WEAK_CRYPTO_PASSWORD_HASH';
  const lines = code.split('\n');
  const idx = issue.line - 1;
  const line = lines[idx] || '';
  if (_CREDENTIAL_RE.test(line)) return 'WEAK_CRYPTO_CREDENTIAL_CONTEXT';
  const fn = _enclosingFunctionSig(lines, idx, ext);
  if (fn) {
    if (_CREDENTIAL_RE.test(fn.line)) return 'WEAK_CRYPTO_CREDENTIAL_CONTEXT';
    const params = fn.params.split(',')
      .map(p => p.trim().replace(/^\.\.\./, '').split(/[\s=:]/)[0].replace(/^\$/, ''))
      .filter(p => /^\w+$/.test(p) && p !== 'self');
    const used = params.find(p => new RegExp('(^|[^\\w$])\\$?' + p + '\\b').test(line));
    if (used) return 'WEAK_CRYPTO_INPUT_FROM_CALLER (' + used + ')';
  }
  return null;
}

// ─── NameError Fix — يستخدم issue.line أولاً ─────────
function fixNameError(code, issue) {
  const lines = code.split('\n');
  const ln = (issue.line || 1) - 1;

  // تحقق من السطر المستهدف أولاً
  if (ln >= 0 && ln < lines.length && /^\s*#\s*query\s*=/.test(lines[ln])) {
    lines[ln] = lines[ln].replace(/^(\s*)#\s*/, '$1');
    return { fixed: lines.join('\n'), patch: lines[ln].trim(), reason: 'Uncommented query definition' };
  }

  // بحث في الأسطر المجاورة فقط (±3 أسطر)
  const start = Math.max(0, ln - 3);
  const end   = Math.min(lines.length - 1, ln + 3);
  for (let i = start; i <= end; i++) {
    if (/^\s*#\s*query\s*=/.test(lines[i])) {
      lines[i] = lines[i].replace(/^(\s*)#\s*/, '$1');
      return { fixed: lines.join('\n'), patch: lines[i].trim(), reason: 'Uncommented query definition' };
    }
  }
  return null;
}

// ─── None Compare ─────────────────────────────────────
function fixNoneCompare(code, issue) {
  const lines = code.split('\n');
  const ln = issue.line - 1;
  if (ln < 0 || ln >= lines.length) return null;
  const line = lines[ln];
  const fixed = line
    .replace(/==\s*None/g, 'is None')
    .replace(/!=\s*None/g, 'is not None');
  if (fixed === line) return null;
  lines[ln] = fixed;
  return { fixed: lines.join('\n'), patch: fixed.trim(), reason: 'Use "is None" instead of "== None"' };
}

// ─── XSS ─────────────────────────────────────────────
function fixXSS(code, issue, lines, ext) {
  const line = lines[issue.line - 1];
  if (!line) return null;
  let fixed = line.replace(/\.innerHTML\s*=/, '.textContent =');
  if (fixed === line) fixed = line.replace(/\.outerHTML\s*=/, '.textContent =');
  if (fixed === line && /res\.send\s*\(/.test(line)) {
    const m = line.match(/res\.send\s*\(["'`]([^"'`]*?)["'`]\s*\+\s*(\w+)/);
    if (m) {
      fixed = line.replace(/res\.send\s*\([^)]+\)/, `res.json({ message: String(${m[2]}).replace(/[<>]/g, '') })`);
    } else if (/res\.send\s*\([^)]*\+[^)]*\)/.test(line)) {
      const v = line.match(/res\.send\s*\([^)]*\+\s*(\w+)/)?.[1] || 'data';
      fixed = line.replace(/res\.send\s*\([^)]+\)/, `res.json({ message: String(${v}).replace(/[<>]/g, '') })`);
    }
  }
  if (fixed === line) return null;
  return { fixed: replaceLineInCode(code, issue.line, fixed), patch: fixed.trim(), reason: 'XSS fixed' };
}

// ─── HTTP → HTTPS ─────────────────────────────────────
// http:// يُعدَّل فقط في string هو نفسه URL: يبدأ بـhttp:// وليس فيه مسافة أو اقتباس أو
// \n (نص كود/بيانات مثل 'fetch("http://x");\n' أو 'https:// بدل http://' لا يُلمس)،
// وليس نمطًا يُبحث عنه أو يُقارن به (t.replace('http://', …) ، url === "http://…").
// التعليقات والـregex والكود خارج النصوص لا تُلمس.
const _HTTP_PATTERN_CALL = /\.(?:replace|replaceAll|includes|startsWith|endsWith|indexOf|lastIndexOf|match|matchAll|split|search|test)\s*\([^()]*$/;
// URI اسم namespace (معرّف وليس اتصالًا): createElementNS("http://www.w3.org/2000/svg") يتعطل مع https
const _HTTP_NAMESPACE_HOST = /^http:\/\/(?:www\.w3\.org|ns\.adobe\.com|purl\.org|schemas\.(?:xmlsoap\.org|microsoft\.com|openxmlformats\.org|android\.com)|xmlns\.com)\//i;
const _HTTP_NAMESPACE_CONTEXT = /(?:xmlns|namespace|\bns)\w*['"]?\s*(?:[:=]|\()\s*(?:[\w$.]+\s*\|\|\s*)?$|\b(?:create(?:Element|Attribute)NS|[gs]etAttributeNS|(?:has|remove)AttributeNS|lookupPrefix|isDefaultNamespace)\s*\([^()]*$/i;
function fixHTTP(code, issue, lines, ext) {
  const line = lines[issue.line - 1];
  if (!line) return null;
  const lits = _lineLiterals(line, ext === 'mjs' || ext === 'cjs' || ext === 'jsx' || ext === 'tsx' ? 'js' : ext);
  let fixed = line;
  for (const q of lits.reverse()) {
    if (q.kind !== 'string') continue;
    const body = line.slice(q.start + 1, q.end - 1);
    if (!/^http:\/\/[^\s'"`\\]*$/.test(body) && !/^http:\/\/[^\s'"`\\]*\$\{[^}]*\}[^\s'"`\\]*$/.test(body)) continue;
    const before = line.slice(0, q.start), after = line.slice(q.end);
    if (_HTTP_PATTERN_CALL.test(before) || /[=!]==?\s*$/.test(before) || /^\s*[=!]==?(?!>)/.test(after)) continue;
    if (_HTTP_NAMESPACE_HOST.test(body) || _HTTP_NAMESPACE_CONTEXT.test(before)) continue;
    fixed = fixed.slice(0, q.start + 1) + 'https://' + fixed.slice(q.start + 1 + 'http://'.length);
  }
  if (fixed === line) return null;
  return { fixed: replaceLineInCode(code, issue.line, fixed), patch: fixed.trim(), reason: 'HTTP → HTTPS' };
}

// ─── var → let ────────────────────────────────────────
function fixVar(code, issue, lines, ext) {
  const line = lines[issue.line - 1];
  if (!line) return null;
  const fixed = line.replace(/\bvar\b/, 'let');
  if (fixed === line) return null;
  return { fixed: replaceLineInCode(code, issue.line, fixed), patch: fixed.trim(), reason: 'var → let' };
}

// ─── Loose Equality ───────────────────────────────────
function fixEquality(code, issue, lines, ext) {
  const line = lines[issue.line - 1];
  if (!line) return null;
  let fixed = line
    .replace(/([^=!<>])==([^=])/g, '$1===$2')
    .replace(/([^=!<>])!=([^=])/g, '$1!==$2');
  fixed = fixed
    .replace(/===\s*"(\d+)"/g, '=== $1')
    .replace(/!==\s*"(\d+)"/g, '!== $1');
  if (fixed === line) return null;
  return { fixed: replaceLineInCode(code, issue.line, fixed), patch: fixed.trim(), reason: '== → ===' };
}

// ─── Accumulation ─────────────────────────────────────
// المتغير المقصود من عنوان المشكلة ("X = بدل +=" أو "X (counter) يستخدم = بدل +=").
function accumulationTarget(issue) {
  const m = String(issue.title || '').match(/([A-Za-z_$][\w$]*)\s*(?:\(counter\)\s*يستخدم\s*)?=\s*بدل\s*\+=/);
  return m ? m[1] : null;
}

// قيمة ثابتة = إعادة تهيئة وليست تراكمًا (x += 0 / x += false لا معنى لها).
const _ACC_LITERAL_RHS = /^(?:[-+]?(?:\d[\d_]*\.?\d*(?:e[-+]?\d+)?|\.\d+)|true|false|null|undefined|NaN|Infinity|None|True|False|(['"`])[^'"`]*\1|\[\s*\]|\{\s*\})$/i;

// المتغير (escaped) يُستخدم كمؤشر/فهرس في الكود: ++/-- ، ±= 1 ، [x] ، slice(x ...
function _accIsCursor(code, esc) {
  return new RegExp(
    '(?:\\+\\+|--)\\s*' + esc + '(?![\\w$])|(?:^|[^\\w$.])' + esc + '\\s*(?:\\+\\+|--|[-+]=\\s*1(?![\\w$.]))' +
    '|\\[\\s*' + esc + '\\s*(?:[\\]+\\-])' +
    '|\\b(?:slice|substring|substr|charAt|charCodeAt|codePointAt|indexOf|lastIndexOf|startsWith|splice)\\s*\\(\\s*' + esc + '(?![\\w$])'
  ).test(code);
}

function fixAccumulation(code, issue, lines, ext) {
  const line = lines[issue.line - 1];
  if (!line) return null;
  const target = accumulationTarget(issue);
  if (!target) return null;
  const esc = target.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  // إسناد عادي للمتغير نفسه فقط: ليس ==/=>، ولا خاصية obj.X، ولا تعريف let/const/var،
  // ولا داخل رأس for(...)، ولا وسيط مسمّى في Python f(x=...).
  // [PHP-SIGIL] الصنفُ ‎[^\w$.]‎ يمنع أن يسبق الاسمَ ‎$‎ — وهو في PHP سِمةُ
  // المتغيّرِ نفسِها لا جزءٌ من اسمٍ أطول. فكان ‎$total = …‎ لا يُطابَق أصلًا
  // فيُرجع المُصلِحُ ‎null‎ لكلِّ تراكمٍ في PHP (مقيس: ‎FIXER_NO_CHANGE‎).
  // فتُطلَب السِّمةُ صراحةً هناك، وتُكتَب في البديلِ كما كانت.
  //
  // والهدفُ يصل بالشكلَين: محلّلُ المشروعِ يضع ‎total‎ في العنوان بلا سِمة،
  // ومُستدعون آخرون يضعون ‎$total‎ بها. فلا تُضاف إلا إن لم تكن فيه أصلًا،
  // وإلا صار النمطُ ‎\$\$total‎ فلا يُطابق شيئًا.
  const phpSigil = ext === 'php' && !target.startsWith('$');
  const sig = phpSigil ? '\\$' : '';
  const re = new RegExp('(^|[^\\w$.])' + sig + esc + '\\s*=(?![=>])', 'g');
  const hits = [...line.matchAll(re)].filter(m => {
    const before = line.slice(0, m.index + m[1].length);
    if (/\b(?:let|const|var)\s+(?:[\w$]+\s*=[^,;]*,\s*)*$/.test(before)) return false;
    if (/\bfor\s*\([^)]*$/.test(before)) return false;
    if (ext === 'py' && /[(,]\s*$/.test(before)) return false;
    return true;
  });
  if (hits.length !== 1) return null;           // غائب أو مكرر في السطر → لا تخمين

  const h = hits[0];
  const start = h.index + h[1].length;
  const end = h.index + h[0].length;
  const rhs = line.slice(end).split(/;/)[0].replace(/\s*[)}\]]*\s*$/, '').trim();
  if (!rhs || _ACC_LITERAL_RHS.test(rhs)) return null;
  // ternary بين قيمتين ثابتتين (x = c ? 1 : 0) → إعادة تهيئة أيضًا.
  const tern = rhs.match(/\?\s*([^:?]+?)\s*:\s*([^:?]+)$/);
  if (tern && _ACC_LITERAL_RHS.test(tern[1].trim()) && _ACC_LITERAL_RHS.test(tern[2].trim())) return null;
  // الطرف الأيمن يستخدم المتغير نفسه (h = f(h) ، x = max(0, x - 1)) → تحديث كامل أصلًا.
  if (new RegExp('(?:^|[^\\w$.])' + esc + '(?![\\w$])').test(rhs)) return null;

  // تتبّع max/min: أقرب if (…) بمقارنة تذكر المتغير أو متغيرًا يُسند في نفس الكتلة
  //   if (cur > best) { best = cur; bestLine = i + 1; }
  for (let k = issue.line - 1; k >= Math.max(0, issue.line - 4); k--) {
    const cond = (lines[k] || '').match(/\bif\s*\((.*)\)/);
    if (!cond) continue;
    if (/[<>]/.test(cond[1].replace(/=>/g, ''))) {
      const names = new Set([target]);
      for (const l of lines.slice(k, issue.line))
        for (const m of l.matchAll(/(?:^|[^\w$.])([A-Za-z_$][\w$]*)\s*=(?![=>])/g)) names.add(m[1]);
      for (const n of names)
        if (new RegExp('(?:^|[^\\w$.])' + n.replace(/\$/g, '\\$') + '(?![\\w$])').test(cond[1])) return null;
    }
    break;
  }

  // مؤشر/فهرس (i++ ، [i] ، slice(i ...) وليس مجمّعًا: i = stop قفزة وليست تراكمًا.
  if (_accIsCursor(code, esc)) return null;
  // موضع وليس قيمة: الطرف الأيمن مؤشر ± رقم (start = i + 1).
  const pos = rhs.match(/^([A-Za-z_$][\w$]*)\s*(?:[-+]\s*\d+)?$/);
  if (pos) {
    const pe = pos[1].replace(/\$/g, '\\$');
    if (_accIsCursor(code, pe) ||
        new RegExp('\\bfor\\s*\\(\\s*(?:let|var)?\\s*' + pe + '\\s*=').test(code) ||
        new RegExp('\\.forEach\\s*\\(\\s*\\(\\s*[\\w$]+\\s*,\\s*' + pe + '\\s*\\)').test(code)) return null;
  }

  const fixed = line.slice(0, start) + (phpSigil ? '$' : '') + target +
                ' += ' + line.slice(end).replace(/^\s*/, '');
  if (fixed === line) return null;
  return { fixed: replaceLineInCode(code, issue.line, fixed), patch: fixed.trim(), reason: `${target} = → ${target} +=` };
}

// ─── Hardcoded Secret ─────────────────────────────────
function fixHardcodedSecret(code, issue, lines, ext) {
  const line = lines[issue.line - 1];
  if (!line) return null;
  const varMatch = line.match(/(\w+)\s*[:=]/);
  const varName = varMatch ? varMatch[1].toUpperCase() : 'SECRET';

  // Idempotency: لا نعيد تغليف قيمة سبق نقلها إلى متغير بيئة.
  if (
    /process\.env\./.test(line) ||
    /os\.environ(?:\.get)?\s*\(/.test(line) ||
    /getenv\s*\(/i.test(line) ||
    /System\.getenv\s*\(/.test(line) ||
    /Environment\.GetEnvironmentVariable\s*\(/.test(line)
  ) {
    return null;
  }

  let fixed = line;

  if (ext === 'py') {
    if (line.includes('os.environ')) return null;
    fixed = line.replace(/(["\'])[^"\']+(["\'])/, `os.environ.get('${varName}', '')`);
  } else if (ext === 'php') {
    if (/getenv\s*\(/i.test(line)) return null;
    fixed = line.replace(/(["\'])[^"\']+(["\'])/, `getenv('${varName}')`);
  } else if (ext === 'java') {
    fixed = line.replace(/(["\'])[^"\']+(["\'])/, `System.getenv("${varName}")`);
  } else if (ext === 'cs') {
    fixed = line.replace(/(["\'])[^"\']+(["\'])/, `Environment.GetEnvironmentVariable("${varName}")`);
  } else if (ext === 'js' || ext === 'ts') {
    fixed = line.replace(/(["\'])[^"\']+(["\'])/, `process.env.${varName}`);
  } else {
    return null;
  }

  if (fixed === line) return null;
  let out = replaceLineInCode(code, issue.line, fixed);
  if (ext === 'py') {
    out = _pyEnsureImportOs(out);          // بلا import os ⇒ NameError (إصلاح مزيّف)
    if (out === null) return null;
  }
  return { fixed: out, patch: fixed.trim(), reason: 'Secret moved to env variable' };
}

// ═══════════════════════════════════════════════════════
// [LOG-SECRET] قاعدةٌ واحدة، لاقطان، تحريرٌ على المدى
// ═══════════════════════════════════════════════════════
// أُعيدت كتابةُ التنفيذِ لا القاعدة. القاعدةُ كما أثبتتها الجولاتُ السابقة:
//
//   ① المَصرِف: ‎console.*‎ أو مُستقبِلٌ آخرُ كلمةٍ في اسمه ‎log/logger/logging‎
//      (‎log‎، ‎Log‎، ‎appLog‎، ‎this.logger‎) ولا ‎dialog‎ ولا ‎catalog‎؛
//      ودالّةٌ من قائمةٍ صريحةٍ لا ‎\w+‎ فلا يُمَسّ ‎getLogger‎ ولا ‎setLevel‎.
//   ② الحسّاس: ما كانت **آخرُ** كلمةٍ في اسمه حسّاسة — ‎userPassword‎ سرٌّ
//      و‎passwordCount‎ عدّاد.
//   ③ النصوصُ الحرفيةُ لا تُمَسّ، وقيمةُ نداءٍ (‎getToken()‎) ليست اسمَ سرّ.
//
// والذي تغيّر: كيف يُعرَف موضعُ الوسيط. كان أربعةَ فروعِ ‎regex‎ وثلاثَ
// دوالَّ مساعدةٍ تُقسّم النصَّ يدويًّا (‎_logSplitLiterals‎، ‎_redactLogArgs‎،
// ‎_redactLoggerSink‎)، وكلُّها تسقط على ما لا يستطيعه التعبيرُ النمطيّ:
// ‎)‎ داخل نصّ، ونداءٌ متداخل، ونداءان في سطر — ثلاثةٌ من خمسةِ أشكالٍ في
// js وpy وts وjava **بالتساوي**. فصار الموضعُ من لاقطٍ واحد:
//   • js  ⇒ شجرةُ ‎acorn‎ (تشمل النداءَ الموزَّعَ على أسطر)
//   • غيرُها ⇒ ماسحٌ نصّيٌّ يعي النصوصَ والأقواسَ، في حدِّ السطرِ الواحد
// ثم تحريرٌ واحدٌ على المدى عبر ‎repairEditApply‎ — بلا منطقِ تعديلِ نصٍّ
// داخل المُصلِح.
const _LOG_SENSITIVE_WORDS = new Set(['password', 'passwd', 'pwd', 'secret', 'token',
  'key', 'apikey', 'credential', 'credentials', 'auth', 'cvv', 'ssn']);
const _LOG_RECEIVER_WORDS = new Set(['log', 'logger', 'logging']);
const _LOG_SINK_METHODS = new Set(['log', 'info', 'debug', 'warn', 'warning', 'error',
  'critical', 'fatal', 'exception', 'trace', 'verbose', 'notice']);
const _LOG_RESERVED = new Set(['true', 'false', 'null', 'undefined', 'this', 'new', 'typeof',
  'JSON', 'String', 'Number', 'Boolean', 'Object', 'Array', 'Math', 'Date', 'console', 'process',
  'None', 'True', 'False', 'self']);

// تقسيمُ آخرِ مقطعٍ من الاسم إلى كلمات: camelCase و‎_‎ و‎-‎
function _logNameWords(name) {
  return String(name).split('.').pop()
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_\-]+/g, ' ')
    .toLowerCase().trim().split(/\s+/).filter(Boolean);
}

function _isSensitiveLogName(name) {
  const words = _logNameWords(name);
  if (!words.length) return false;
  if (_LOG_SENSITIVE_WORDS.has(words[words.length - 1])) return true;
  // ‎api_key‎ و‎apikey‎ ككلمةٍ واحدة
  return words.length === 1 && _LOG_SENSITIVE_WORDS.has(words[0]);
}

function _isLogReceiver(name) {
  const words = _logNameWords(name);
  return words.length > 0 && _LOG_RECEIVER_WORDS.has(words[words.length - 1]);
}

/**
 * ① هل هذا النداءُ مَصرِفَ تسجيل؟ ‎recv‎ قد يكون فارغًا (‎print‎).
 * المفرداتُ هنا **هي نفسُها** التي كانت موزَّعةً على فروعِ الـregex الأربعة،
 * مجموعةً في موضعٍ واحد — لا توسيعَ ولا تضييق:
 *   console → خمسُ دوالَّ كما كان النمطُ ‎console\.(log|error|warn|info|debug)‎
 *   py      → ‎print‎، و‎logging‎ **بقائمةِ الدوالِّ** لا بـ‎\w+‎: القاعدةُ
 *             القديمة ‎logging\.\w+‎ كانت تُنقّح ‎logging.getLogger(token)‎
 *             و‎basicConfig‎ — وهي تهيئةٌ لا تسجيل. والمشروعُ وثّق هذا
 *             السببَ نفسَه في ‎[PY-LOG-METHODS]‎ حين رفض ‎\w+‎ في الكاشف،
 *             فلا يُنقَل العيبُ إلى التنفيذِ الجديد.
 *   java    → ‎Log.*‎ كما كان ‎(android\.util\.)?Log\.\w+‎ (فـ‎Log.d/e/v/i/w‎ تبقى)
 *   مُستقبِلٌ آخرُ كلمةٍ في اسمه log/logger/logging → قائمةُ الدوالِّ الصريحة
 *   (وهي ما أضافه ‎[LOG-SINK]‎ بعد قياسِ سبعةِ أشكالٍ تُكتشَف ولا تُصلَح)
 */
const _LOG_CONSOLE_METHODS = new Set(['log', 'error', 'warn', 'info', 'debug']);
function _isLogSinkCall(recv, meth, ext) {
  const m = String(meth || '').toLowerCase();
  if (!recv) return ext === 'py' && m === 'print';
  if (recv === 'console') return _LOG_CONSOLE_METHODS.has(m);
  if (ext === 'java' && _isLogReceiver(recv)) return true;
  return _isLogReceiver(recv) && _LOG_SINK_METHODS.has(m);
}

/** ② + ③ هل يُنقَّح هذا الوسيطُ النصّيّ؟ (مسارُ الماسحِ النصّيّ) */
function _logTextArgEdits(arg) {
  const t = arg.text;

  // الضمُّ أوّلًا: ‎"tok: " + token‎ يبدأ بعلامةِ اقتباسٍ وليس نصًّا حرفيًّا.
  // (فحصُ «يبدأ باقتباس» قبل الضمِّ كان يُسقط هذا الشكل — أسقطه تحذيرُ
  // ‎[EL-2]‎ قبل أن يصل إلى أحد.) والقَسْمُ على كلِّ ‎+‎ يحفظ المواضعَ بدقّةٍ
  // ولو وقع ‎+‎ داخل نصّ، لأن كلَّ قطعةٍ تُفحَص بذاتها فلا تمرّ إلا ما كان
  // مُعرِّفًا خالصًا.
  if (t.includes('+')) {
    const parts = [];
    let off = 0;
    for (const piece of t.split('+')) {
      const start = arg.start + off;
      const lead = piece.length - piece.replace(/^\s+/, '').length;
      const body = piece.trim();
      if (body && !/^['"`]/.test(body) && !/[()]/.test(body) &&
          /^[A-Za-z_$][\w$.]*$/.test(body) &&
          !_LOG_RESERVED.has(body.split('.')[0]) && _isSensitiveLogName(body))
        parts.push([start + lead, start + lead + body.length]);
      off += piece.length + 1;
    }
    return parts.length ? parts : null;
  }

  // ثم: نصٌّ حرفيٌّ لا يُمَسّ، ونداءٌ قيمةٌ لا اسمٌ، والباقي يُقاس باسمه.
  if (/^['"`]/.test(t)) return null;
  if (/\(/.test(t)) return null;
  if (_LOG_RESERVED.has(t.split('.')[0])) return null;
  if (!/^[A-Za-z_$][\w$.]*$/.test(t)) return null;                   // ليس مُعرِّفًا ولا سلسلةَ أعضاء
  return _isSensitiveLogName(t) ? [[arg.start, arg.end]] : null;
}

/** مواضعُ التنقيحِ من الشجرة (js) */
function _logEditsFromTree(code, line) {
  const ast = repairEditParse(code);
  if (!ast) return null;
  const edits = [];
  const seen = new Set();
  const scan = n => {
    if (!n || seen.has(n.start + ':' + n.end)) return;
    if (n.type === 'BinaryExpression' && n.operator === '+') { scan(n.left); scan(n.right); return; }
    if (n.type === 'Literal' || n.type === 'TemplateLiteral') return;        // ③
    if (n.type === 'CallExpression' || n.type === 'NewExpression') return;   // ③
    if (n.type === 'Identifier' || n.type === 'MemberExpression') {
      const txt = repairEditText(code, n);
      if (_LOG_RESERVED.has(txt.split('.')[0])) return;
      if (_isSensitiveLogName(txt)) { seen.add(n.start + ':' + n.end); edits.push([n.start, n.end, '"[REDACTED]"']); }
      return;
    }
    if (n.type === 'ObjectExpression') {
      for (const p of n.properties || []) {
        if (p.type !== 'Property' || p.computed) continue;
        const key = p.key && (p.key.name || p.key.value);
        if (key && _isSensitiveLogName(String(key)) && p.value &&
            p.value.type !== 'Literal' && p.value.type !== 'TemplateLiteral') {
          seen.add(p.value.start + ':' + p.value.end);
          edits.push([p.value.start, p.value.end, '"[REDACTED]"']);
        }
      }
    }
  };
  for (const call of repairEditCallsAtLine(ast, line)) {
    const callee = call.callee;
    if (!callee || callee.type !== 'MemberExpression' || callee.computed) continue;
    const recv = repairEditText(code, callee.object);
    if (!_isLogSinkCall(recv, callee.property && callee.property.name, 'js')) continue;
    for (const arg of call.arguments || []) scan(arg);
  }
  return edits;
}

/** مواضعُ التنقيحِ من الماسحِ النصّيّ (ts / py / java وغيرها) */
function _logEditsFromText(code, line, ext) {
  const all = String(code).split('\n');
  const text = all[line - 1];
  if (text === undefined) return null;
  let base = 0;
  for (let i = 0; i < line - 1; i++) base += all[i].length + 1;
  const edits = [];
  for (const call of repairEditTextCalls(text, { comment: ext === 'py' ? '#' : '//' })) {
    if (!_isLogSinkCall(call.recv, call.meth, ext)) continue;
    for (const arg of call.args) {
      const spans = _logTextArgEdits(arg);
      if (spans) for (const [s, e] of spans) edits.push([base + s, base + e, '"[REDACTED]"']);
    }
  }
  return edits;
}

// ─── Log Secret ───────────────────────────────────────
function fixLogSecret(code, issue, lines, ext) {
  const line = Number(issue && issue.line) || 0;
  if (line < 1 || !String(code).split('\n')[line - 1]) return null;

  // اللاقط: الشجرةُ حيث تتوفّر، وإلا الماسحُ النصّيّ. والقاعدةُ واحدةٌ
  // في الحالتين — ولذلك لا يُكرَّر منطقُ التنقيحِ ولا منطقُ التحرير.
  const useTree = typeof repairEditSupports === 'function' && repairEditSupports(ext);
  const edits = useTree ? _logEditsFromTree(code, line) : _logEditsFromText(code, line, ext);
  if (!edits || !edits.length) return null;

  // الفحصُ الذاتيُّ بعد التحرير لا يكون إلا حيث يوجد مُحلِّل. ولغةٌ بلا
  // مُحلِّلٍ تُترك لفحصِ البوابة — كما كان المسارُ النصّيُّ القائمُ تمامًا.
  const fixed = repairEditApply(code, edits, { verify: useTree });
  if (fixed === null) return null;

  const at = repairEditLineOf(code, Math.min(...edits.map(e => e[0])));
  const patch = String(fixed).split('\n')[at - 1];
  return {
    fixed,
    patch: (patch === undefined ? '' : patch).trim(),
    reason: 'Sensitive data redacted from logs',
  };
}

// ─── Empty Catch — مع import logging لـ Python ────────
function fixEmptyCatch(code, issue, lines, ext) {
  const line = lines[issue.line - 1];
  if (!line) return null;
  let fixed = line;

  if (ext === 'java') {
    fixed = line.replace(/catch\s*\((\w+)\s+(\w+)\)\s*\{\s*\}/, 'catch ($1 $2) { android.util.Log.e("Error", $2.getMessage()); }');
    if (fixed === line) fixed = line.replace(/\{\s*\}$/, '{ android.util.Log.e("Error", "exception occurred"); }');
  } else if (ext === 'py') {
    // ═══════════════════════════════════════════════════
    // [PY-CATCH] إصلاحٌ كان يمرّ من الفحصِ ويكسر الشفرة
    // ═══════════════════════════════════════════════════
    // كان يكتب ‎logging.error("Exception: %s", str(e))‎ دائمًا — و‎e‎ غيرُ
    // مربوطٍ في ‎except Exception:‎ ولا في ‎except:‎. فالناتجُ يمرّ من
    // ‎py_compile‎ (فحصٌ نحويٌّ لا يرى الأسماء) ويرمي ‎NameError‎ وقتَ
    // تنفيذِ مسارِ الاستثناء. مقيسٌ بـ‎python3‎ على الحالةِ الأصلية:
    //     قبل:  RET=None                              (الخطأُ مكتومٌ — العيب)
    //     بعد:  RAISED=NameError: name 'e' is not defined   (الشفرةُ مكسورة)
    // أي أن البلاغَ يختفي والمشكلةُ تُستبدَل بأسوأ منها. وكان مستورًا
    // لأن البلاغَ لم يكن يُوجَّه إلى هذه الاستراتيجيةِ أصلًا (‎[CATCH-ROUTE]‎).
    //
    // فالآن: يُستعمل الاسمُ المربوطُ إن وُجد، وإلا ‎exc_info=True‎ — وهي
    // الصيغةُ القياسيةُ داخل معالِجِ استثناءٍ ولا تحتاج ربطًا.
    // والموضعُ يُؤخَذ من رقمِ السطرِ المُبلَّغ لا ببحثٍ نصّيٍّ عن مثله:
    // ‎indexOf‎ كان يُصيب أوّلَ سطرٍ مطابقٍ، فملفٌّ فيه ‎except Exception:‎
    // مرتين يُعالَج موضعُه الأوّلُ مرتين ويبقى الثاني كما هو.
    const ln = issue.line - 1;
    const src0 = code.split('\n');
    if (ln < 0 || ln >= src0.length) return null;
    const catchLine = src0[ln];
    const baseIndent = (catchLine.match(/^(\s*)/) || ['', ''])[1];
    const bodyIndent = baseIndent + '    ';
    const bind = (catchLine.match(/\bexcept\b[^:]*\bas[ \t]+([A-Za-z_]\w*)[ \t]*:/) || [])[1];
    const body = bind
      ? `${bodyIndent}logging.error("Exception: %s", str(${bind}))`
      : `${bodyIndent}logging.error("Unhandled exception", exc_info=True)`;
    // ورأسُ الملفِّ يُحترَم: shebang وترميزٌ وdocstring و‎__future__‎ — وبنيةٌ
    // غيرُ محسومةٍ تُرجع ‎null‎ بدل التخمين (نفسُ عقدِ ‎_pyEnsureImport‎).
    const withImport = _pyEnsureImport(code, 'logging');
    if (withImport === null) return null;
    const all = withImport.split('\n');
    const shift = all.length - src0.length;      // صفرٌ أو واحد
    const target = ln + shift;
    if (all[target] !== catchLine) return null;  // لم يُطابق الموضعُ ⇒ لا تخمين
    all.splice(target + 1, 0, body);
    return { fixed: all.join('\n'), patch: body.trim(), reason: 'Empty except now logs error' };
  } else if (ext === 'cs') {
    fixed = line.replace(/catch\s*(\([^)]*\))?\s*\{\s*\}/, 'catch (Exception ex) { Debug.LogError("Error: " + ex.Message); }');
  } else if (ext === 'js' || ext === 'ts') {
    fixed = line.replace(/catch\s*\(([^)]+)\)\s*\{\s*\}/, 'catch ($1) { console.error("Error:", $1); }');
    if (fixed === line) fixed = line.replace(/\{\s*\}$/, '{ console.error("unexpected error"); }');
    // [CATCH-SHAPE] والجسمُ الفارغُ في سطرين — وهو شكلُ الحالةِ الأصلية:
    //     } catch (e) {
    //     }
    // كان يُرجع ‎null‎ لأن النمطَين أعلاه يشترطان ‎{}‎ في السطرِ نفسِه.
    // فيُضاف السطرُ داخل الجسم بـ‎splice‎، كما يفعل فرعُ بايثون أعلاه
    // بالضبط. ولا يتغيّر تدفّقُ التحكّم ولا قيمةُ إرجاعٍ: سطرُ تسجيلٍ
    // فقط — وهو نفسُ نصِّ الإصلاحِ الذي يُنتجه المسارُ القائمُ للشكلِ
    // ذي السطرِ الواحد.
    //
    // والشرطُ ضيّقٌ: السطرُ ينتهي بـ‎{‎ بعد ‎catch‎، وأوّلُ سطرٍ غيرِ
    // فارغٍ بعده ‎}‎ وحدَه. فتعليقٌ داخل الجسم ليس فراغًا، وجسمٌ فيه
    // شفرةٌ لا يُمَسّ.
    if (fixed === line && /(?:^|\})\s*catch\s*(?:\([^)]*\))?\s*\{\s*$/.test(line.trim())) {
      const all = code.split('\n');
      const ln = issue.line - 1;
      if (ln < 0 || ln >= all.length) return null;
      let j = ln + 1;
      while (j < all.length && !all[j].trim()) j++;
      if (j >= all.length || all[j].trim() !== '}') return null;
      const bind = (line.match(/catch\s*\(\s*([A-Za-z_$][\w$]*)/) || [])[1];
      const indent = (line.match(/^(\s*)/) || ['', ''])[1] + '  ';
      const body = bind
        ? `${indent}console.error("Error:", ${bind});`
        : `${indent}console.error("unexpected error");`;
      all.splice(ln + 1, 0, body);
      return { fixed: all.join('\n'), patch: body.trim(), reason: 'Empty catch now logs error' };
    }
  } else {
    return null;
  }

  if (fixed === line) return null;
  return { fixed: replaceLineInCode(code, issue.line, fixed), patch: fixed.trim(), reason: 'Empty catch now logs error' };
}

// ─── Empty Function ───────────────────────────────────
function fixEmptyFunction(code, issue, lines, ext) {
  const line = lines[issue.line - 1];
  if (!line) return null;
  if (ext !== 'js' && ext !== 'ts' && ext !== 'py' && ext !== 'php') return null;

  const indent = ' '.repeat(line.search(/\S/) + 4);
  const outerIndent = ' '.repeat(line.search(/\S/));
  const nameMatch = line.match(/function\s+(\w+)|def\s+(\w+)|(\w+)\s*[=(]/);
  const funcName = nameMatch ? (nameMatch[1] || nameMatch[2] || nameMatch[3]) : '';

  let body = '';
  if (/get|fetch|load|read/i.test(funcName)) {
    body = ext === 'py' ? `${indent}return None  # TODO: implement` : `${indent}return null; // TODO: implement`;
  } else if (/save|write|store|set/i.test(funcName)) {
    body = ext === 'py' ? `${indent}pass  # TODO: implement` : `${indent}// TODO: implement`;
  } else if (/calculate|compute|sum|total/i.test(funcName)) {
    body = ext === 'py' ? `${indent}return 0  # TODO: implement` : `${indent}return 0; // TODO: implement`;
  } else if (/is|has|check|valid/i.test(funcName)) {
    body = ext === 'py' ? `${indent}return False  # TODO: implement` : `${indent}return false; // TODO: implement`;
  } else {
    body = ext === 'py' ? `${indent}pass  # TODO: implement` : `${indent}// TODO: implement`;
  }

  if (!line.includes('{}')) return null;
  const fixed = line.replace('{}', `{\n${body}\n${outerIndent}}`);
  if (fixed === line) return null;
  return { fixed: replaceLineInCode(code, issue.line, fixed), patch: 'Added stub', reason: 'Empty function placeholder' };
}

// ─── Callback Hell (autoFix: false) ──────────────────
function fixCallbackHell(code, issue) {
  return null;
}

// ─── Hardcoded API Keys ───────────────────────────────
function fixApiKeyAdvanced(code, issue, lines2, ext2, fileName) {
  const lines = code.split('\n');
  const ln = issue.line - 1;
  if (ln < 0 || ln >= lines.length) return null;
  const line = lines[ln];
  const ext = detectExt(code, fileName);

  // Idempotency: السطر يقرأ أصلًا من متغير بيئة ⇒ الاستبدال ينتج self-assignment.
  if (/process\.env\.|os\.environ|getenv\s*\(/i.test(line)) return null;

  const m = line.match(/(?:const|let|var|private|public|string)?\s*(\w+)\s*[:=]\s*["']([^"']+)["']/);
  if (!m) return null;
  const varName = m[1];
  const envName = varName.replace(/([a-z])([A-Z])/g, '$1_$2').toUpperCase();

  if (ext === 'py') {
    lines[ln] = line.replace(/["'][^"']+["']/, `os.environ.get('${envName}', '')`);
    if (!code.includes('import os')) lines.unshift('import os');
    lines.splice(ln + 2, 0, `# Add to .env: ${envName}=your_value`);
  } else if (ext === 'js' || ext === 'ts') {
    lines[ln] = line.replace(/["'][^"']+["']/, `process.env.${envName}`);
    lines.splice(ln + 1, 0, `// Add to .env: ${envName}=your_value`);
  } else if (ext === 'php') {
    lines[ln] = line.replace(/["'][^"']+["']/, `getenv('${envName}')`);
  } else if (ext === 'cs') {
    lines[ln] = line.replace(/["'][^"']+["']/, `Environment.GetEnvironmentVariable("${envName}")`);
  } else if (ext === 'java') {
    lines[ln] = line.replace(/["'][^"']+["']/, `System.getenv("${envName}")`);
  } else {
    return null;
  }

  return { fixed: lines.join('\n'), patch: lines[ln].trim(), reason: `Secret → ${envName} env variable` };
}

// ─── Command Injection Python ─────────────────────────
function fixCommandInjectionPy(code, issue) {
  const lines = code.split('\n');
  const ln = issue.line - 1;
  if (ln < 0 || ln >= lines.length) return null;
  const line = lines[ln];
  const m = line.match(/os\.system\s*\((.+)\)/);
  if (!m) return null;
  const indent = ' '.repeat(line.search(/\S/));
  const arg = m[1].trim();
  lines[ln] = `${indent}subprocess.run(shlex.split(${arg}), check=True, capture_output=True)`;
  let fixed = lines.join('\n');
  if (!fixed.includes('import subprocess')) fixed = 'import subprocess\nimport shlex\n' + fixed;
  else if (!/^import[ \t]+(?:[\w.]+[ \t]*,[ \t]*)*shlex[ \t]*(?:,|#|$)/m.test(fixed)) {
    // subprocess مستورد لكن الاسم shlex غير معرّف → أضفه بعد سطر import subprocess
    // (موضع import صالح أصلًا، فلا يسبق __future__ أو docstring).
    const at = fixed.match(/^([ \t]*)import[ \t]+subprocess\b.*$/m);
    fixed = at
      ? fixed.slice(0, at.index + at[0].length) + `\n${at[1]}import shlex` + fixed.slice(at.index + at[0].length)
      : 'import shlex\n' + fixed;
  }
  return { fixed, patch: lines[ln].trim(), reason: 'Command Injection → subprocess.run' };
}

// ─── detectStrategy — language-aware ─────────────────
function detectStrategy(issue, lang) {
  // لغة غير معروفة أو غير مدعومة = لا إصلاح
  if (!lang || lang === 'unknown') return null;

  // strategy صريح من الـdetector نفسه: يُستخدم قبل الـtitle، لأن الـtitle قد يحمل
  // بيانات من كود المستخدم (اسم متغير، route path) فتُضلّل الكلمات المفتاحية.
  // مفتاح غير معروف أو غير مدعوم للغة → نرجع لاستنتاج الـtitle كما كان.
  // strategy: null صريح = الـdetector يعلن "لا strategy" (الـtitle يحمل بيانات مستخدم
  // ولا يوجد إصلاح حتمي لهذا النوع) ⇒ لا استنتاج من الـtitle.
  if (issue && issue.strategy === null) return null;
  if (issue && typeof issue.strategy === 'string') {
    const variant = STRATEGY_LANG_VARIANTS[issue.strategy];
    const explicit = (variant && variant[lang]) || issue.strategy;
    if (Object.prototype.hasOwnProperty.call(STRATEGIES, explicit)) {
      // مفتاح معروف لكن غير مدعوم لهذه اللغة ⇒ لا إصلاح، بدل fallback للـtitle
      // (الـtitle قد يحمل اسمًا يوجّه لإصلاح آخر مدعوم، مثل $sqlCmd في PHP).
      return (STRATEGY_LANGS[explicit] && STRATEGY_LANGS[explicit].includes(lang)) ? explicit : null;
    }
    // مفتاح غير معروف ⇒ title fallback كما كان
  }

  const t = (issue.title || '').toLowerCase();
  let stratKey = null;

  if (t.includes('sql'))                                                    stratKey = 'SQL_INJECTION';
  else if (t.includes('innerhtml') || t.includes('xss'))                   stratKey = 'XSS_INNER_HTML';
  else if (t.includes('md5') || t.includes('sha1') || t.includes('ضعيف') || t.includes('لتشفير') || t.includes('crypto')) stratKey = 'WEAK_CRYPTO';
  else if (t.includes('command') || t.includes('os.system'))               stratKey = (lang === 'py') ? 'CMD_INJECTION_PY' : 'CMD_INJECTION';
  else if (t.includes('eval'))                                              stratKey = 'EVAL_USAGE';
  else if (t.includes('مرور') || t.includes('password'))                   stratKey = 'HARDCODED_PASS';
  else if (t.includes('secret') || t.includes('مكشوف'))                    stratKey = 'HARDCODED_SECRET';
  else if (t.includes('api key') || t.includes('google') || t.includes('stripe')) stratKey = 'API_KEY';
  else if (t.includes('تراكم') || t.includes('+='))                        stratKey = 'ACCUMULATION';
  else if (t.includes('مقارنة') || t.includes('string'))                   stratKey = 'LOOSE_EQUALITY';
  else if (t.includes('===') || t.includes('=='))                          stratKey = 'LOOSE_EQUALITY';
  else if (t.includes('var'))                                               stratKey = 'VAR_USAGE';
  else if (t.includes('catch'))                                             stratKey = 'EMPTY_CATCH';
  else if (t.includes('http'))                                              stratKey = 'HTTP_USAGE';
  else if (t.includes('log') || t.includes('تسجيل'))                       stratKey = 'LOG_SECRET';
  else if (t.includes('ناقصة') || t.includes('empty'))                     stratKey = 'EMPTY_FUNCTION';
  else if (t.includes('none') || t.includes('is none'))                    stratKey = 'NONE_COMPARE';
  else if (t.includes('nameerror') || t.includes('غير معرّف'))             stratKey = 'NAMEERROR';
  else if (t.includes('callback'))                                          stratKey = 'CALLBACK_HELL';
  else if (t.includes('auth') || t.includes('middleware'))                  stratKey = 'MISSING_AUTH';
  else if (t.includes('cwe-798') || t.includes('credential'))              stratKey = 'HARDCODED_SECRET';

  if (!stratKey) return null;

  // MISSING_AUTH يأتي فقط من strategy صريح (Auth detector) — كلمة auth في الـtitle
  // قد تكون اسم متغير/دالة من كود المستخدم (authZ, authToken...)، فلا تُعتمد.
  if (stratKey === 'MISSING_AUTH') return null;

  // تحقق من allowlist اللغة — بدون fallback
  const allowed = STRATEGY_LANGS[stratKey];
  if (!allowed || !allowed.includes(lang)) return null;

  return stratKey;
}

function getAIReason(strategy) {
  const reasons = {
    SQL_INJECTION:  'يحتاج تعديل query + execute() معاً',
    EVAL_USAGE:     'يحتاج فهم السلوك المقصود',
    CALLBACK_HELL:  'يحتاج مراجعة يدوية — إعادة هيكلة',
    RETURN_NULL:    'يحتاج منطق الدالة الكامل',
    NPE_CHAIN:      'يحتاج فهم السياق لإضافة null check',
  };
  return reasons[strategy] || 'يحتاج مراجعة يدوية';
}

// ─── SQL candidate validation ─────────────────────────
// candidate لـSQL_INJECTION يُعتمد فقط إذا أثبت استعلامًا صالحًا مربوط القيم.
// يُرفض (ويبقى السطر الأصلي كما هو) إذا:
//   1. بقي دمج قيمة متغيرة داخل نص SQL (+ أو . أو ${} أو f-string).
//   2. placeholder داخل علامات اقتباس SQL ('?') أو اقتباس غير متوازن.
//   3. الـplaceholders غير مربوطة بقيم، أو عدد القيم لا يطابقها.
//   4. الـAnalyzer ما زال يبلّغ عن نفس عدد ثغرات SQL.
// يُرجع null إذا كان سليمًا، أو سبب الرفض.
const SQL_KEYWORD = /\b(?:SELECT|INSERT|UPDATE|DELETE)\b/i;

function _sqlLiterals(line) {
  const out = [];
  const re = /(["'`])((?:\\.|(?!\1)[^\\])*)\1/g;
  let m;
  while ((m = re.exec(line))) {
    out.push({ quote: m[1], body: m[2], start: m.index, end: re.lastIndex });
  }
  return out;
}

// عدد العناصر داخل [..] أو (..) يبدأ عند open
function _sqlBoundCount(text, open) {
  const close = text[open] === '[' ? ']' : ')';
  let depth = 0, end = -1;
  for (let k = open; k < text.length; k++) {
    if (text[k] === text[open]) depth++;
    else if (text[k] === close && --depth === 0) { end = k; break; }
  }
  if (end < 0) return -1;
  const inner = text.slice(open + 1, end).replace(/\/\*[\s\S]*?\*\//g, '').trim();
  if (!inner) return 0;
  let n = 1; depth = 0;
  for (const ch of inner) {
    if ('([{'.includes(ch)) depth++;
    else if (')]}'.includes(ch)) depth--;
    else if (ch === ',' && depth === 0) n++;
  }
  return inner.endsWith(',') ? n - 1 : n;
}

function sqlCandidateProblem(beforeCode, afterCode, fileName, ext) {
  const B = beforeCode.split('\n'), A = afterCode.split('\n');
  let pre = 0;
  while (pre < B.length && pre < A.length && B[pre] === A[pre]) pre++;
  let suf = 0;
  while (suf < B.length - pre && suf < A.length - pre &&
         B[B.length - 1 - suf] === A[A.length - 1 - suf]) suf++;
  const regionEnd = A.length - suf;                     // حصري

  // كل literal يُستبدل بـ\u0001 (ليس حرف \w) → literal + literal لا يُحسب دمج متغير
  const concatOp = ext === 'php' ? /\u0001\s*\.\s*\$|\$[\w\[\]'"]+\s*\.\s*\u0001/ : /\u0001\s*\+\s*[A-Za-z_$(]|[\w$)\]]\s*\+\s*\u0001/;
  let sqlLines = 0;

  for (let i = pre; i < regionEnd; i++) {
    const line = A[i];
    const lits = _sqlLiterals(line);
    if (!lits.some(l => SQL_KEYWORD.test(l.body))) continue;
    sqlLines++;

    // 1. دمج قيمة متغيرة في نص SQL
    let masked = '', last = 0;
    for (const l of lits) { masked += line.slice(last, l.start) + '\u0001'; last = l.end; }
    masked += line.slice(last);
    const interpolated = lits.some(l =>
      (l.quote === '`' && /\$\{/.test(l.body)) ||
      (ext === 'php' && l.quote === '"' && /\$\w/.test(l.body)) ||
      (ext === 'py' && /[fF]$/.test(line.slice(0, l.start)) && /\{[^}]+\}/.test(l.body)));
    if (concatOp.test(masked) || interpolated) {
      return `SQL_STILL_CONCATENATED — line ${i + 1} still builds SQL from a variable`;
    }

    // 2. placeholder داخل اقتباس SQL أو اقتباس غير متوازن
    const sqlText = lits.map(l => l.body.replace(/\\'/g, "'")).join('');
    if (/'\s*(?:\?|\$\d+|%s)|(?:\?|\$\d+|%s)\s*'/.test(sqlText)) {
      return `SQL_PLACEHOLDER_QUOTED — line ${i + 1}: a placeholder inside quotes is a literal, not a bound value`;
    }
    if ((sqlText.replace(/''/g, '').match(/'/g) || []).length % 2 !== 0) {
      return `SQL_UNBALANCED_QUOTES — line ${i + 1} produces an invalid query`;
    }

    // 3. ربط الـplaceholders بقيم
    const dollars = (sqlText.match(/\$(\d+)/g) || []).map(s => +s.slice(1));
    const need = (sqlText.match(/\?/g) || []).length + (sqlText.match(/%s/g) || []).length +
                 (dollars.length ? Math.max(...dollars) : 0);
    if (!need) continue;

    if (ext === 'php' || ext === 'cs' || ext === 'java') {
      const region = A.slice(pre, Math.min(A.length, regionEnd + 5)).join('\n');
      const bind = { php: /bind_param\s*\(|->execute\s*\(\s*\[/, cs: /\.Parameters\.Add/, java: /\.set(?:String|Int|Long|Object|Double)\s*\(/ }[ext];
      if (!bind.test(region)) return `SQL_PLACEHOLDERS_UNBOUND — line ${i + 1} has placeholders but no bound values`;
      continue;
    }

    let bound = -1;
    const sameCall = masked.match(/\u0001\s*,\s*([\[(])/);
    if (sameCall) {
      bound = _sqlBoundCount(masked, sameCall.index + sameCall[0].length - 1);
    } else {
      const assign = masked.match(/^\s*(?:(?:var|let|const)\s+)?([A-Za-z_$][\w$]*)\s*=\s*\u0001/);
      if (assign) {
        const call = new RegExp('\\.(?:query|execute|executemany|run|all|get|each|exec|prepare)\\s*\\(\\s*' +
                                assign[1].replace(/\$/g, '\\$') + '\\b\\s*(,\\s*[\\[(])?');
        for (let k = i + 1; k < Math.min(A.length, i + 16); k++) {
          const c = A[k].match(call);
          if (!c) continue;
          bound = c[1] ? _sqlBoundCount(A[k], c.index + c[0].length - 1) : 0;
          break;
        }
      }
    }
    if (bound < 0) return `SQL_PLACEHOLDERS_UNBOUND — line ${i + 1}: no query call binding the placeholders was found`;
    if (bound !== need) {
      return `SQL_PLACEHOLDERS_UNBOUND — line ${i + 1} has ${need} placeholder(s) but ${bound} bound value(s)`;
    }
  }

  if (!sqlLines) return 'SQL_NOT_ADDRESSED — the candidate does not change any SQL statement';

  // 4. الـAnalyzer (إن وُجد) يجب أن يرى ثغرات SQL أقل
  if (typeof analyzeCode === 'function') {
    try {
      const count = c => (analyzeCode(c, fileName) || []).filter(x =>
        /sql injection|sql_injection|cwe-89/i.test([x && x.type, x && x.title, x && x.cAct].join(' '))).length;
      if (count(afterCode) >= count(beforeCode)) {
        return 'SQL_INJECTION_STILL_REPORTED — the analyzer still reports the SQL injection';
      }
    } catch (e) {
      return 'SQL_ANALYSIS_FAILED — could not verify the SQL candidate';
    }
  }
  return null;
}



// ─── [CS-BIND] أمرُ C# مُعامَلٌ باسمِ كائنِه الحقيقيّ ────────────────────
// شكلان وحدَهما، وفيهما الكائنُ مُسمًّى:
//   var cmd = new SqlCommand("… " + x, conn);
//   cmd.CommandText = "… " + x;
const _CS_NEW_CMD_RX = /^\s*(?:var|using\s*\(\s*var|[A-Za-z_][\w.<>]*)\s+([A-Za-z_]\w*)\s*=\s*new\s+[A-Za-z_]\w*Command\s*\(/;
const _CS_CMDTEXT_RX = /^\s*([A-Za-z_]\w*)\s*\.\s*CommandText\s*=\s*/;

function _csBindCommand(line) {
  if (typeof repairEditTextCalls !== 'function') return null;
  const indent = ' '.repeat(line.search(/\S/));
  const mark = i => '@p' + i;

  // (أ) ‎cmd.CommandText = "…" + x;‎
  const ct = _CS_CMDTEXT_RX.exec(line);
  if (ct) {
    const rhs = line.slice(ct[0].length).replace(/;\s*$/, '');
    const built = _sqlParamize(rhs, mark);
    if (!built) return null;
    return {
      line: indent + ct[1] + '.CommandText = ' + built.template + ';',
      adds: built.params.map((p, i) =>
        indent + ct[1] + '.Parameters.AddWithValue("' + mark(i) + '", ' + p + ');'),
    };
  }

  // (ب) ‎var cmd = new SqlCommand("…" + x, conn);‎
  const nc = _CS_NEW_CMD_RX.exec(line);
  if (!nc) return null;
  let calls;
  try { calls = repairEditTextCalls(line) || []; } catch (e) { return null; }
  for (const c of calls) {
    if (!/Command$/.test(c.meth) || !c.args.length) continue;
    const built = _sqlParamize(line.slice(c.args[0].start, c.args[0].end), mark);
    if (!built) continue;
    return {
      line: line.slice(0, c.args[0].start) + built.template + line.slice(c.args[0].end),
      adds: built.params.map((p, i) =>
        indent + nc[1] + '.Parameters.AddWithValue("' + mark(i) + '", ' + p + ');'),
    };
  }
  return null;
}

// ─── [SQL-BIND] بناءُ استدعاءِ استعلامٍ مُعامَل ───────────────────────────
// يُرجع السطرَ بعد تحويلِ ‎recv.query("… " + e + " …")‎ إلى
// ‎recv.query("… ? …", [e])‎، أو ‎null‎ إن لم يكن الشكلُ محسومًا.
const _SQL_QUERY_METH = /^(?:query|execute|run|all|get)$/i;
const _SQL_KEYWORD_RX = /\b(?:SELECT|INSERT|UPDATE|DELETE|FROM|WHERE|VALUES|SET)\b/i;

/** تقسيمُ تعبيرٍ على ‎+‎ في المستوى الأعلى، مع احترامِ النصوصِ والأقواس. */
function _sqlSplitPlus(s) {
  const out = [];
  let depth = 0, start = 0, i = 0;
  const skipStr = p => {
    const q = s[p];
    let j = p + 1;
    while (j < s.length) {
      if (s[j] === '\\') { j += 2; continue; }
      if (s[j] === q) return j + 1;
      j++;
    }
    return -1;
  };
  while (i < s.length) {
    const c = s[i];
    if (c === '"' || c === "'" || c === '`') { const e = skipStr(i); if (e < 0) return null; i = e; continue; }
    if (c === '(' || c === '[' || c === '{') { depth++; i++; continue; }
    if (c === ')' || c === ']' || c === '}') { depth--; i++; continue; }
    if (c === '+' && depth === 0) { out.push(s.slice(start, i)); start = i + 1; i++; continue; }
    i++;
  }
  out.push(s.slice(start));
  return out.map(x => x.trim()).filter(x => x.length);
}

/**
 * من تعبيرِ الضمِّ إلى ‎{template, params}‎، أو ‎null‎.
 * ‎mark‎ دالّةٌ تُعطي شكلَ الموضعِ بترتيبِه: ‎?‎ في js/ts، و‎@p0‎ في C#.
 */
function _sqlParamize(expr, mark) {
  const parts = _sqlSplitPlus(expr);
  if (!parts || parts.length < 2) return null;
  let text = '', quote = '"', sawExpr = false;
  const params = [];
  const MARK = '\u0000';
  for (const t of parts) {
    if (t[0] === '`') return null;                    // قالبُ نصٍّ: شكلٌ آخر
    if ((t[0] === '"' || t[0] === "'") && t.length >= 2 && t[t.length - 1] === t[0]) {
      quote = t[0];
      text += t.slice(1, -1);
    } else {
      // اقتباسُ SQL حول الموضع يُزال: ‎n = '?'‎ خطأ، والصوابُ ‎n = ?‎
      if (text.endsWith("'")) text = text.slice(0, -1);
      text += MARK;
      params.push(t);
      sawExpr = true;
    }
  }
  if (!sawExpr) return null;
  text = text.split(MARK + "'").join(MARK);
  const place = typeof mark === 'function' ? mark : (() => '?');
  let seq = 0;
  text = text.split(MARK).reduce((acc, part, idx) => idx === 0 ? part : acc + place(seq++) + part, '');
  if (!_SQL_KEYWORD_RX.test(text)) return null;
  if (text.includes(quote)) return null;              // اقتباسٌ يكسر النصَّ الناتج
  return { template: quote + text + quote, params };
}

function _sqlBindCall(line) {
  if (typeof repairEditTextCalls !== 'function') return null;
  let calls;
  try { calls = repairEditTextCalls(line) || []; } catch (e) { return null; }
  for (const c of calls) {
    if (!_SQL_QUERY_METH.test(c.meth) || c.args.length !== 1) continue;
    const built = _sqlParamize(line.slice(c.args[0].start, c.args[0].end));
    if (!built) continue;
    return line.slice(0, c.args[0].start) + built.template +
           ', [' + built.params.join(', ') + ']' + line.slice(c.args[0].end);
  }
  return null;
}

// ─── CMD candidate validation ─────────────────────────
// حارس فقط لـCMD_INJECTION (exec) و CMD_INJECTION_PY (os.system) — الـfixer نفسه لا يتغير.
// candidate يُعتمد فقط إذا عالج الاستدعاء كاملًا على السطر. يُرفض (ويبقى الكود كما هو) إذا:
//   0. [FIX] كان الاستدعاء فعليًا RegExp.prototype.exec وليس child_process exec.
//   1. أنتج كودًا غير صالح نحويًا (استدعاء مقطوع، safeArgs مكرر في نفس الـblock).
//   2. التعقيم انطبق على الجزء الخطأ من الأمر (نص ثابت أو template كامل بدل المدخل).
//   3. لم يعالج المشكلة المقصودة أو أسقط منطقًا (callback/options، مدخل ثانٍ، exec ثانٍ،
//      أو نتيجة os.system المستخدمة في assignment/return/if).
// يُرجع null إذا كان سليمًا، أو سبب الرفض.

// موضع القوس المغلق المطابق لـopen (يتجاهل ما داخل النصوص)، أو -1
function _cmdMatchParen(s, open) {
  let depth = 0, q = null;
  for (let k = open; k < s.length; k++) {
    const ch = s[k];
    if (q) { if (ch === '\\') k++; else if (ch === q) q = null; continue; }
    if (ch === '"' || ch === "'" || ch === '`') q = ch;
    else if ('([{'.includes(ch)) depth++;
    else if (')]}'.includes(ch) && --depth === 0) return k;
  }
  return -1;
}

// تقسيم s عند sep في المستوى الأعلى فقط (خارج النصوص والأقواس)
function _cmdSplitTop(s, sep) {
  const out = [];
  let depth = 0, q = null, last = 0;
  for (let k = 0; k < s.length; k++) {
    const ch = s[k];
    if (q) { if (ch === '\\') k++; else if (ch === q) q = null; continue; }
    if (ch === '"' || ch === "'" || ch === '`') q = ch;
    else if ('([{'.includes(ch)) depth++;
    else if (')]}'.includes(ch)) depth--;
    else if (ch === sep && depth === 0) { out.push(s.slice(last, k).trim()); last = k + 1; }
  }
  out.push(s.slice(last).trim());
  return out;
}

// عدد تعريفات name في نفس الـblock الذي يبدأ فيه السطر idx
function _cmdBlockDecls(lines, idx, name) {
  const code = lines.join('\n');
  const masked = code.replace(/\/\/[^\n]*|\/\*[\s\S]*?\*\/|(["'`])(?:\\[\s\S]|(?!\1)[^\\])*\1/g,
    s => s.replace(/[^\n]/g, ' '));
  const pos = lines.slice(0, idx).reduce((n, l) => n + l.length + 1, 0);
  let start = -1, end = masked.length, depth = 0;
  for (let k = pos - 1; k >= 0; k--) {
    if (masked[k] === '}') depth++;
    else if (masked[k] === '{' && depth-- === 0) { start = k; break; }
  }
  depth = 0;
  for (let k = pos; k < masked.length; k++) {
    if (masked[k] === '{') depth++;
    else if (masked[k] === '}' && depth-- === 0) { end = k; break; }
  }
  let top = '';
  depth = 0;
  for (let k = start + 1; k < end; k++) {
    const ch = masked[k];
    if (ch === '{') depth++;
    else if (ch === '}') depth--;
    else if (depth === 0) { top += ch; continue; }
    top += ' ';
  }
  return (top.match(new RegExp('\\b(?:const|let|var|function|class)\\s+' + name + '\\b', 'g')) || []).length;
}

// ═══════════════════════════════════════════════════════
// [CMD-WHOLE] الأمرُ كلُّه من المستخدم: لا إصلاحَ نصّيًّا آمنًا
// ═══════════════════════════════════════════════════════
// ‎cp.exec(req.query.cmd)‎ — لا نصَّ حرفيًّا في الوسيط، فاسمُ الأمرِ نفسُه
// من المدخَل. وقياسٌ بالتنفيذِ الفعليِّ في مجلّدٍ مؤقّتٍ على ثلاثةِ
// احتمالاتٍ، بأربعةِ مدخلاتٍ سليمةٍ وثماني حمولاتٍ غيرِ ضارّةٍ تُنشئ ملفًا
// إن نُفِّذت:
//
//                            سلوكٌ سليم   حقنُ شِلٍّ مُنِع   ‎cat /etc/passwd‎
//   ① تعقيمُ أحرفٍ + شِل          4/4          8/8          ⚠️ قرأ الملف
//   ② ‎execFile‎ على المُدخَلِ كلِّه 4/4          7/8          ⚠️ قرأ الملف
//   ③ قائمةُ أوامرٍ + ‎execFile‎    4/4          8/8          ⚠️ قرأ الملف
//
// فالثلاثةُ تقرأ ‎/etc/passwd‎، لأن ‎cat /etc/passwd‎ أمرٌ مشروعٌ بوسيطٍ
// مشروع: الثغرةُ ليست في الشِلِّ بل في أن الأمرَ نفسَه بيدِ المُهاجِم.
// والاحتمالُ ② **أسوأُ** من التعقيم: يُمرّر ‎-fprintf PWN7‎ وسيطًا حقيقيًّا
// لـ‎find‎ فيُنشئ الملفَ فعلًا (حقنُ خيارات)، والتعقيمُ يُسقط الشُرَط.
//
// ⇒ فصلُ الأمرِ عن الوسائطِ **لا** يُعالج هذا الشكل. والعلاجُ الصحيحُ تغييرُ
// تصميمٍ لا يستنتجه المحرّك: قائمةُ عملياتٍ مُعتمَدةٍ بأوامرَ ووسائطَ ثابتة،
// يختار المُدخَلُ بينها ولا يُكوِّنها.
//
// ولذلك يُرفَض الشكلُ **قبل** البوابة بسببٍ مُسمَّى، ويُدفَع إلى ‎aiNeeded‎
// بالعلاجِ المطلوب — بدل أن يُولَّد تخفيفٌ لا يعمل فتقتله البوابةُ بـ
// ‎GHOST_DISCARDED_BATCH — no_candidate‎ فلا يفهم المستخدمُ شيئًا.
// وهذا نفسُ نهجِ ‎weakCryptoCredentialProblem‎ القائم: رفضٌ + بيانُ ما يلزم.
function cmdWholeCommandProblem(code, issue, stratKey) {
  const lines = String(code).split('\n');
  const line = lines[(Number(issue.line) || 0) - 1];
  if (line === undefined) return null;
  const isPy = stratKey === 'CMD_INJECTION_PY';
  const callRx = isPy ? /(?:os\.system|os\.popen|subprocess\.(?:call|run|Popen|check_output))\s*\(/
                      : /\bexec(?:Sync)?\s*\(/;
  const m = callRx.exec(line);
  if (!m) return null;
  // وسيطُ النداء: ما بين قوسِه وأوّلِ ‎)‎ — يكفي للحكم على وجودِ نصٍّ حرفيّ
  const argStart = m.index + m[0].length;
  const close = line.indexOf(')', argStart);
  const arg = line.slice(argStart, close < 0 ? line.length : close);
  if (!arg.trim()) return null;
  // نصٌّ حرفيٌّ في الوسيط ⇒ اسمُ الأمرِ ثابتٌ ⇒ التعقيمُ تخفيفٌ مشروع
  if (/['"`]/.test(arg)) return null;
  return 'CMD_WHOLE_COMMAND_FROM_INPUT — اسمُ الأمرِ نفسُه من المدخَل، ' +
         'فلا تعقيمُ أحرفٍ ولا فصلُ وسائطَ يُجدي: ‎cat /etc/passwd‎ أمرٌ ' +
         'مشروعٌ بوسيطٍ مشروع (مقيسٌ بالتنفيذ على ثلاثةِ احتمالات)';
}

function cmdCandidateProblem(beforeCode, afterCode, lineNum, stratKey) {
  const B = beforeCode.split('\n'), A = afterCode.split('\n');
  const line = B[lineNum - 1];
  if (line === undefined) return `CMD_NOT_ADDRESSED — line ${lineNum} does not exist`;
  const isPy = stratKey === 'CMD_INJECTION_PY';
  const calls = [...line.matchAll(isPy ? /os\.system\s*\(/g : /\bexec\s*\(/g)];
  const fn = isPy ? 'os.system()' : 'exec()';

  if (!calls.length) return `CMD_NOT_ADDRESSED — line ${lineNum} has no ${fn} call`;

  // [FIX] دفاع بالعمق: نفس الفحص المطبَّق داخل fixCommandInjection، هنا كحارس
  // مستقل يمنع أي مصدر candidate ثانٍ (مثل legacy fixer) من تمرير نفس الخطأ.
  if (!isPy && !_isCommandExecCall(beforeCode, line, calls[0].index)) {
    return `CMD_NOT_COMMAND_EXEC — line ${lineNum}: the exec() receiver is not a child_process binding (RegExp.prototype.exec, db/stmt/conn/qb.exec, ...), not a shell command`;
  }

  if (calls.length > 1) {
    return `CMD_MULTIPLE_CALLS — line ${lineNum} has ${calls.length} ${fn} calls; the fix covers only the first`;
  }
  const open = calls[0].index + calls[0][0].length - 1;
  const close = _cmdMatchParen(line, open);
  if (close < 0) return `CMD_CALL_INCOMPLETE — the ${fn} call on line ${lineNum} does not close on the same line`;
  const inner = line.slice(open + 1, close).trim();

  if (isPy) {
    // 3. الاستدعاء يجب أن يكون الجملة كاملة — وإلا يضيع assignment/return/if
    if (line.slice(0, calls[0].index).trim() || !/^;?\s*(?:#.*)?$/.test(line.slice(close + 1).trim())) {
      return `CMD_CONTEXT_LOST — line ${lineNum} uses the os.system() result; replacing the whole line drops that logic`;
    }
    // 1. الـcandidate يمرر نفس الوسيط كاملًا
    const after = A[lineNum - 1 + (A.length - B.length)];
    if (!inner || !after || !after.trim().startsWith(`subprocess.run(shlex.split(${inner}),`)) {
      return `CMD_SYNTAX_INVALID — the candidate does not pass the os.system() argument on line ${lineNum} intact`;
    }
    return null;
  }

  // 1. الـcandidate يعقّم وسيط exec كاملًا في جملة صالحة
  // يُبنى من ‎CMD_SANITIZE_CALL‎ نفسِه، فلا يتفارق الحارسُ والمُولِّد
  const _rxEsc = s => String(s).replace(/[.*+?^${}()|[\]\\\/]/g, '\\$&');
  const declRx = new RegExp('^\\s*const safeArgs = ([\\s\\S]*)' + _rxEsc(CMD_SANITIZE_CALL) + ';\\s*$');
  const decl = (A[lineNum] || '').match(declRx);
  if (!decl || decl[1].trim() !== inner) {
    return `CMD_SYNTAX_INVALID — the candidate cuts the exec() call on line ${lineNum} and does not parse`;
  }
  const args = _cmdSplitTop(inner, ',').filter(Boolean);
  if (!args.length) return `CMD_NOT_ADDRESSED — exec() on line ${lineNum} has no argument`;
  if (args.length > 1) {
    return `CMD_ARGS_DROPPED — exec() on line ${lineNum} has ${args.length} arguments (callback/options); the fix drops them`;
  }
  if (_cmdBlockDecls(A, lineNum, 'safeArgs') > 1) {
    return `CMD_SYNTAX_INVALID — safeArgs is already declared in the same block as line ${lineNum}`;
  }

  // 2. .replace يلتصق بآخر جزء فقط — يجب أن يكون هو المدخل الوحيد
  const parts = _cmdSplitTop(args[0], '+');
  const isLit = p => /^(["'])(?:\\.|(?!\1)[^\\])*\1$/.test(p) || /^`(?:\\.|[^`\\$]|\$(?!\{))*`$/.test(p);
  const dynamic = parts.filter(p => !isLit(p));
  if (!dynamic.length) return `CMD_NOT_ADDRESSED — exec() on line ${lineNum} runs a constant command; no input to sanitize`;
  if (dynamic.length > 1) {
    return `CMD_UNSANITIZED_INPUT — exec() on line ${lineNum} has ${dynamic.length} inputs; the fix sanitizes only the last part`;
  }
  const lastPart = parts[parts.length - 1];
  if (isLit(lastPart)) {
    return `CMD_SANITIZE_WRONG_PART — the sanitizer on line ${lineNum} applies to ${lastPart}, not to input ${dynamic[0]}`;
  }
  if (lastPart.startsWith('`')) {
    return `CMD_SANITIZE_WRONG_PART — the sanitizer on line ${lineNum} strips the whole template command, not only its input`;
  }
  return null;
}

// ─── XSS candidate validation ─────────────────────────
// حارس فقط لفرع res.send(... + ...) في fixXSS — الـfixer نفسه لا يتغير.
// تحويل res.send إلى res.json يغيّر نوع الاستجابة وشكلها ولا يُرمِّز المخرج،
// فيُرفض دائمًا (لا نخمّن متى يكون آمنًا). فرع innerHTML/outerHTML لا يمر من هنا.
// يُرجع null إذا لم يكن candidate من هذا النوع، أو سبب الرفض.
function xssCandidateProblem(beforeCode, afterCode, lineNum) {
  const line = beforeCode.split('\n')[lineNum - 1];
  const after = afterCode.split('\n')[lineNum - 1];
  if (line === undefined || after === undefined) return null;
  if (!/res\.send\s*\([^)]*\+/.test(line)) return null;
  const count = (s, re) => (s.match(re) || []).length;
  if (count(after, /res\.json\s*\(/g) > count(line, /res\.json\s*\(/g) &&
      count(after, /res\.send\s*\(/g) < count(line, /res\.send\s*\(/g)) {
    return `XSS_RESPONSE_CHANGED — line ${lineNum}: the candidate replaces res.send with res.json, ` +
           'which changes the response type and shape instead of escaping the output';
  }
  return null;
}

// ─── Semantic candidate validation ────────────────────
// حارس فقط لـHARDCODED_SECRET / HARDCODED_PASS / API_KEY / LOOSE_EQUALITY — الـfixers
// نفسها لا تتغير. candidate صحيح نحويًا لكنه يغيّر معنى الكود يُرفض:
//   - السر: القيمة المستبدلة ليست literal كاملًا (تقطع نصًا آخر)، أو ليست credential
//     (مفتاح وسم عرض، نص فيه مسافات، أو لا المفتاح ولا القيمة يشبهان سرًا).
//   - المساواة: تغيّر شيئًا داخل نص/regex/تعليق، أو تحوّل == null (تطابق undefined أيضًا).
// يُرجع null إذا كان سليمًا، أو سبب الرفض.

// مقاطع literal في سطر واحد: [{start, end, kind}] — نص، template، regex، تعليق.
function _lineLiterals(line, ext) {
  const out = [];
  const js = ext === 'js' || ext === 'ts';
  const hashComment = ext === 'py' || ext === 'php';
  let prev = '';
  for (let k = 0; k < line.length;) {
    const ch = line[k], nx = line[k + 1];
    if ((ch === '/' && nx === '/') || (hashComment && ch === '#')) { out.push({ start: k, end: line.length, kind: 'comment' }); break; }
    if (ch === '/' && nx === '*') {
      const e = line.indexOf('*/', k + 2), end = e < 0 ? line.length : e + 2;
      out.push({ start: k, end, kind: 'comment' }); k = end; continue;
    }
    if (ch === '"' || ch === "'" || (js && ch === '`')) {
      let j = k + 1;
      while (j < line.length && line[j] !== ch) j += line[j] === '\\' ? 2 : 1;
      out.push({ start: k, end: Math.min(j + 1, line.length), kind: 'string' }); k = j + 1; prev = 'v'; continue;
    }
    if (js && ch === '/' && (prev === '' || /[(,=:[!&|?{};+\-*%<>~^]$/.test(prev) || /^(return|typeof|case|in|of|delete|void|throw|new|instanceof|yield|await)$/.test(prev))) {
      let j = k + 1, cls = false;
      while (j < line.length && (cls || line[j] !== '/')) {
        if (line[j] === '\\') j++;
        else if (line[j] === '[') cls = true;
        else if (line[j] === ']') cls = false;
        j++;
      }
      j++; while (j < line.length && /[a-z]/i.test(line[j])) j++;
      out.push({ start: k, end: j, kind: 'regex' }); k = j; prev = 'v'; continue;
    }
    if (/\s/.test(ch)) { k++; continue; }
    if (/[\w$]/.test(ch)) { let j = k; while (j < line.length && /[\w$]/.test(line[j])) j++; prev = line.slice(k, j); k = j; continue; }
    prev = ch; k++;
  }
  return out;
}

const _CREDENTIAL_NAME = /secret|passw|pwd|pass$|token|api_?key|apikey|key$|private|credential|auth|jwt|salt|access|sk_|pk_|bearer/i;
// قيمة تشبه مفتاحًا عشوائيًا: ≥16 حرفًا بلا مسافات، فيها أرقام وحروف
const _CREDENTIAL_VALUE = /^(?=.*\d)(?=.*[A-Za-z])[\w\-+/=.]{16,}$/;
// مفاتيح وسوم/بيانات وصفية معروفة — قيمتها نص عرض لا credential. غيرها لا يُحكم عليه.
const _LABEL_NAME = /^(?:name|title|label|type|kind|category|description|desc|message|msg|text|caption|display|displayName|id|slug|tag|group|section|header|placeholder|tooltip|hint|icon|status|mode|role|lang|locale)$/i;
// اسم credential بدون الإشارة الضعيفة key$ (STORAGE_KEY / _key / stratKey أسماء مفاتيح تخزين لا أسرار)
const _STRONG_CREDENTIAL_NAME = /secret|passw|pwd|pass$|token|api_?key|apikey|private|credential|auth|jwt|salt|access|sk_|pk_|bearer|signing|hmac|cipher|encrypt/i;
// بادئات مفاتيح معروفة
const _SECRET_PREFIX = /^(?:[spr]k_(?:live|test)_|gh[pousr]_|xox[abprs]-|AKIA|AIza|eyJ)/;
// اسم callee للاستدعاء المفتوح عند نهاية prefix (أو null إذا لم يكن داخل استدعاء في هذا السطر)
function _enclosingCallee(prefix) {
  let depth = 0;
  for (let i = prefix.length - 1; i >= 0; i--) {
    const c = prefix[i];
    if (c === ')' || c === ']' || c === '}') depth++;
    else if (c === '(' || c === '[' || c === '{') {
      if (depth > 0) { depth--; continue; }
      if (c !== '(') return null;
      const m = prefix.slice(0, i).match(/([\w$.]+)\s*$/);
      return m ? m[1] : null;
    }
  }
  return null;
}

function semanticCandidateProblem(beforeCode, afterCode, lineNum, stratKey, ext) {
  const B = beforeCode.split('\n'), A = afterCode.split('\n');
  const line = B[lineNum - 1];
  if (line === undefined) return null;

  if (stratKey === 'LOOSE_EQUALITY') {
    const after = A[lineNum - 1];
    if (after === undefined || A.length !== B.length) return null;
    const lits = s => _lineLiterals(s, ext).map(p => s.slice(p.start, p.end));
    if (JSON.stringify(lits(line)) !== JSON.stringify(lits(after))) {
      return `EQ_LITERAL_CHANGED — line ${lineNum}: the candidate changes a string, regex or comment, not only the comparison`;
    }
    const mask = s => { let m = s; for (const p of _lineLiterals(s, ext).reverse()) m = m.slice(0, p.start) + ' '.repeat(p.end - p.start) + m.slice(p.end); return m; };
    const looseNull = s => (mask(s).match(/(?:^|[^=!<>])[!=]=(?!=)\s*(?:null|undefined)\b|\b(?:null|undefined)\s*[!=]=(?!=)/g) || []).length;
    if (looseNull(after) < looseNull(line)) {
      return `EQ_NULL_SEMANTICS — line ${lineNum}: == null also matches undefined; === null changes the result`;
    }
    return null;
  }

  // السر: السطر المعدَّل هو lineNum أو التالي له (import os يُضاف في الرأس)
  const cands = [lineNum - 1, lineNum].filter(i => A[i] !== undefined && A[i] !== line);
  if (!cands.length) return null;
  const common = (a, b) => { let n = 0; while (n < a.length && n < b.length && a[n] === b[n]) n++; return n; };
  const after = cands.reduce((best, i) => (common(line, A[i]) > common(line, best) ? A[i] : best), A[cands[0]]);
  const p = common(line, after);
  let s = 0;
  while (s < line.length - p && s < after.length - p && line[line.length - 1 - s] === after[after.length - 1 - s]) s++;
  const removedEnd = line.length - s;
  const lit = _lineLiterals(line, ext).find(q => q.start === p && q.end === removedEnd && q.kind === 'string');
  if (!lit) {
    return `SECRET_LITERAL_BROKEN — line ${lineNum}: the replaced text is not one complete string literal (it cuts through another string)`;
  }
  // literal طرفُ مقارنة (== / === / != / !==) ليس قيمة سر مُسندة
  if (/(?:[=!]==?)\s*$/.test(line.slice(0, p)) || /^\s*[=!]==?(?!>)/.test(line.slice(removedEnd))) {
    return `SECRET_NOT_CREDENTIAL — line ${lineNum}: the replaced literal is a comparison operand, not an assigned secret`;
  }
  const key = line.slice(0, p).match(/([\w$]+)['"]?\s*(?:[:=]|=>)\s*$/);
  if (key && _LABEL_NAME.test(key[1])) {
    return `SECRET_NOT_CREDENTIAL — line ${lineNum}: "${key[1]}" is not a credential; replacing its value changes the program`;
  }
  // الـfixer يستبدل أول literal في السطر، لا literal السر بالضرورة
  const value = line.slice(p + 1, removedEnd - 1);
  if (/\s/.test(value)) {
    return `SECRET_NOT_CREDENTIAL — line ${lineNum}: the replaced value is text, not a credential`;
  }
  if (key && !_CREDENTIAL_NAME.test(key[1]) && !_CREDENTIAL_NAME.test(value) && !_CREDENTIAL_VALUE.test(value)) {
    return `SECRET_NOT_CREDENTIAL — line ${lineNum}: neither "${key[1]}" nor its value looks like a credential; the fixer picked the wrong literal`;
  }
  const looksSecret = _CREDENTIAL_VALUE.test(value) || _SECRET_PREFIX.test(value);
  // literal مفتاحٌ في object ('a.py': ...) وليس قيمة
  if (/(?:^|[{,])\s*$/.test(line.slice(0, p)) && /^\s*:(?!:)/.test(line.slice(removedEnd))) {
    return `SECRET_NOT_CREDENTIAL — line ${lineNum}: the replaced literal is an object key, not a value`;
  }
  if (!key) {
    // ليس قيمة مُسندة: يُقبل فقط وسيطًا لاستدعاء credential (jwt.sign(…, "x")) أو قيمة تشبه مفتاحًا
    const callee = _enclosingCallee(line.slice(0, p));
    if (!looksSecret && !(callee && _STRONG_CREDENTIAL_NAME.test(callee))) {
      return `SECRET_NOT_CREDENTIAL — line ${lineNum}: the replaced literal is an argument of ${callee || 'no call'}(), not an assigned secret`;
    }
    return null;
  }
  // ثابت enum/وسم كخاصية object فقط: SECRET: 'secret' ، HARDCODED_SECRET: 'SECRET'
  // (الإسناد const SECRET = "secret" قد يكون سرًا فعليًا، فلا يُطبَّق عليه)
  const norm = x => x.toLowerCase().replace(/[^a-z0-9]/g, '');
  const isProperty = /['"]?\s*:\s*$/.test(line.slice(0, p));
  if (isProperty && !looksSecret && (norm(value) === norm(key[1]) || /^[A-Z][A-Z_]*$/.test(value))) {
    return `SECRET_NOT_CREDENTIAL — line ${lineNum}: "${key[1]}: '${value}'" is an enum/tag constant, not a credential`;
  }
  // اسم مفتاح تخزين (STORAGE_KEY = 're_learned_patterns_v2' ، _key: "sh_log")
  if (_CREDENTIAL_NAME.test(key[1]) && !_STRONG_CREDENTIAL_NAME.test(key[1]) && !_SECRET_PREFIX.test(value) &&
      /^[a-z][a-z0-9]*(?:[_.:-][a-z0-9]+)+$/.test(value)) {
    return `SECRET_NOT_CREDENTIAL — line ${lineNum}: "${key[1]}" names a storage/lookup key; "${value}" is an identifier, not a credential`;
  }
  return null;
}

// EVAL / CMD / SQL: الـcall الذي يعدّله الـfixer يجب أن يكون في code فعلي، لا داخل
// string literal أو تعليق (كود مكتوب كنص). محتوى استعلام SQL داخل نص طبيعي ولا يُرفض:
// لـSQL الشرط أن يلمس التعديل code فعليًا، لا أن يقع كله داخل literal واحد.
const _TARGET_CALL = {
  EVAL_USAGE: /\beval\s*\(/g,
  CMD_INJECTION: /\bexec\s*\(/g,
  CMD_INJECTION_PY: /\bos\.system\s*\(/g,
};

const _WEAK_CRYPTO_CALL = {
  py:   [/hashlib\.md5\s*\(/g, /hashlib\.sha1\s*\(/g],
  js:   [/createHash\s*\(\s*["']md5["']\s*\)/gi, /createHash\s*\(\s*["']sha1["']\s*\)/gi],
  ts:   [/createHash\s*\(\s*["']md5["']\s*\)/gi, /createHash\s*\(\s*["']sha1["']\s*\)/gi],
  php:  [/md5\s*\(/gi, /sha1\s*\(/gi],
  cs:   [/MD5\.Create\s*\(\s*\)/g, /new MD5CryptoServiceProvider\s*\(\s*\)/g],
  java: [/MessageDigest\.getInstance\s*\(\s*["']MD5["']\s*\)/g, /MessageDigest\.getInstance\s*\(\s*["']SHA-1["']\s*\)/g],
};

function literalTargetProblem(beforeCode, afterCode, lineNum, stratKey, ext) {
  const B = beforeCode.split('\n'), A = afterCode.split('\n');
  const line = B[lineNum - 1];
  if (line === undefined) return null;
  const spans = _lineLiterals(line, ext);
  const inLiteral = k => spans.some(q => k > q.start && k < q.end) || spans.some(q => q.kind === 'comment' && k >= q.start && k < q.end);

  // WEAK_CRYPTO: الـfixer يستبدل كل تطابق في السطر (replace عام) ⇒ يكفي تطابق واحد داخل
  // نص/تعليق لرفض الـcandidate. الأنماط هي أنماط fixWeakCrypto نفسها لكل لغة.
  if (stratKey === 'WEAK_CRYPTO' || stratKey === 'MD5_USAGE' || stratKey === 'WEAK_HASH') {
    const pats = _WEAK_CRYPTO_CALL[ext] || [];
    for (const re of pats) {
      const hit = [...line.matchAll(re)].find(m => inLiteral(m.index));
      if (hit) {
        return `TARGET_IN_LITERAL — line ${lineNum}: the ${hit[0].replace(/\s+/g, '')} call is inside a string or comment, not code`;
      }
    }
    return null;
  }

  if (_TARGET_CALL[stratKey]) {
    const calls = [...line.matchAll(_TARGET_CALL[stratKey])];
    if (calls.length && calls.every(m => inLiteral(m.index))) {
      return `TARGET_IN_LITERAL — line ${lineNum}: the ${calls[0][0].replace(/\s*\($/, '()')} call is inside a string or comment, not code`;
    }
    return null;
  }

  // SQL: كل سطر معدَّل يجب أن يلمس code — تعديل يقع كله داخل literal واحد = كود داخل نص.
  // الـlegacy fixer قد يعدّل عدة أسطر: يكفي سطر واحد داخل literal لرفض الـcandidate.
  // المقارنة على الـcode وحده: كل literal = رمز ثابت، التعليقات محذوفة. code مطابق = التعديل كله داخل نص/تعليق.
  if (A.length !== B.length) return null;
  const codeOnly = s => {
    let m = s;
    for (const q of _lineLiterals(s, ext).reverse()) m = m.slice(0, q.start) + (q.kind === 'comment' ? '' : ' \u0000 ') + m.slice(q.end);
    return m.replace(/\s+/g, '');
  };
  for (let k = 0; k < B.length; k++) {
    if (A[k] !== B[k] && codeOnly(A[k]) === codeOnly(B[k])) {
      return `TARGET_IN_LITERAL — line ${k + 1}: the SQL change lies entirely inside a string literal (code written as text), not in the query code`;
    }
  }
  return null;
}

// ─── Evidence helpers (stale-line guard) ──────────────
// AST evidence (ast-engine.js, astVerified) وصفٌ للعقدة وليس نص السطر:
//   "total = MemberExpression"  أو  "items.forEach(...)".
// يُحوَّل إلى نمط يجب أن يطابق السطر الأصلي؛ غير ذلك → null (لا نخمّن).
function astEvidenceAnchor(ev) {
  const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  let m = ev.match(/^([A-Za-z_$][\w$]*)\s*=\s*(?:[A-Z][A-Za-z]*|\.\.\.)$/);
  if (m) return new RegExp('(?:^|[^\\w$.])' + esc(m[1]) + '\\s*=(?!=)');
  m = ev.match(/^([A-Za-z_$][\w$.]*)\.forEach\(\.\.\.\)$/);
  if (m) return new RegExp('(?:^|[^\\w$])' + esc(m[1]) + '\\s*\\.\\s*forEach\\s*\\(');
  return null;
}

// strategies تعالج نفس المشكلة على السطر — لا تُطبَّق فوق بعضها.
const SAME_PROBLEM_GROUP = {
  HARDCODED_SECRET: 'SECRET', HARDCODED_PASS: 'SECRET', API_KEY: 'SECRET',
  WEAK_CRYPTO: 'CRYPTO', MD5_USAGE: 'CRYPTO', WEAK_HASH: 'CRYPTO',
  CMD_INJECTION: 'CMD', CMD_INJECTION_PY: 'CMD',
};
const problemGroup = st => SAME_PROBLEM_GROUP[st] || st;

// ─── Main repairCode ──────────────────────────────────

function getLegacySQLFixer(fileName) {
  const ext = String(fileName || '').split('.').pop().toLowerCase();

  // JS/TS: RepairSQL يُرجع aiRequired بلا تغيير، بينما SQLInjectionFixer يُنتج candidate.
  if (
    (ext === 'js' || ext === 'ts') &&
    typeof SQLInjectionFixer !== 'undefined' &&
    SQLInjectionFixer &&
    typeof SQLInjectionFixer.fix === 'function'
  ) {
    return SQLInjectionFixer;
  }

  if (
    typeof RepairSQL !== 'undefined' &&
    RepairSQL &&
    typeof RepairSQL.fix === 'function'
  ) {
    return RepairSQL;
  }

  if (typeof SQLInjectionFixer !== 'undefined') {
    return SQLInjectionFixer;
  }

  if (
    typeof window !== 'undefined' &&
    window.SQLInjectionFixer
  ) {
    return window.SQLInjectionFixer;
  }

  return null;
}

// السطر الذي يحقنه فرع الـroute في AuthRepair حرفيًا
const AUTH_ROUTE_LINE = '  if (!req.user) return res.status(401).json({ error: "Unauthorized" });';

// ═══════════════════════════════════════════════════════════════════════
// [STEP-SALVAGE] الإصلاح ليس كلَّ شيءٍ أو لا شيء
// ═══════════════════════════════════════════════════════════════════════
//
// كانت الإصلاحات تتراكم في مُرشَّحٍ واحد، ثم تحكم عليه بوابة Ghost حُكمًا
// واحدًا. فعنصرٌ واحد لا تستطيع البوابة إثباته يُلغي **كل** إصلاحات الملف.
// والمقيس على ملف حقيقي (GameServer.js، 15 بلاغًا):
//     تِسعُ إصلاحات، كلٌّ منها مقبولٌ منفردًا بالبوابة  ·  وككتلة: 0 مقبول
//     ⇒ decision = AI_SUGGESTION  ·  لا يصل العميلَ أي تغيير
// وهذا سببُ «يصلح جزءًا فقط» — وفي الواقع: لا يصلح شيئًا.
//
// والعلاج: عند رفض الكتلة، يُعاد الإصلاح بتحقّقٍ لكل خطوة على حِدة، فتُحفَظ
// الخطوات التي تُثبَت وتُسقَط وحدها التي لا تُثبَت. وكلُّ خطوة تُقاس ضد
// **الكود الأصلي** لا ضد سابقتها، فالتراكم رتيبٌ: ما يُقبل يبقى الكل مقبولًا.
//
// ولماذا عند الرفض فقط لا دائمًا: نداءُ البوابة يُعيد التحليل مرّتين، وقيسَ
// كلفتُه ‎22 ms‎ على ملفٍ من 59 سطرًا و‎538 ms‎ على ملفٍ من 1203 أسطر. فتحقّقُ
// كل خطوة دائمًا يعني ثوانيَ على ملفٍ كبير بلا فائدة في الحالة الشائعة
// (الكتلة تُقبل). فالمسار السريع يبقى كما كان، والإنقاذ لا يُستدعى إلا عند
// الرفض الفعلي — مرّةً واحدة ولا تكرار.
function repairCode(code, issues, fileName, _opts) {
  const _o = _opts || {};
  // وضعُ الإنقاذ: كل خطوة تمرّ بالبوابة قبل أن تتقدّم.
  const verifyEachStep = _o.verifyEachStep === true;

  // البوابة متوفّرة؟ بلا بوابةٍ لا يُستدعى الإنقاذ إطلاقًا — فإسقاطُ كل خطوة
  // لتعذّر إثباتها يكون أسوأ من السلوك القائم، وGhost تبقى الحكمَ الأخير.
  const _gateReady = () => {
    try {
      return typeof FixVerifier !== 'undefined' && FixVerifier &&
             typeof FixVerifier.verifyFix === 'function' &&
             typeof analyzeCode === 'function';
    } catch (e) { return false; }
  };
  // الخطوة تُسقَط على الضرر/عدم الإثبات وحده — لا على «لا تحسّن قابل للقياس»
  // ولا على تعذّرٍ بيئي. فالإنقاذ لا يجوز أن يكون أشدَّ من الحكم النهائي على
  // الكتلة، وإلا أسقط إصلاحات كانت تُطبَّق. والتصنيف من البوابة نفسها.
  // ومقيسٌ ما يحدث بلا هذا التمييز: ثمانية اختبارات قائمة تسقط، منها إصلاحُ
  // ‎http://‎ على سطرٍ فيه عنوانان (أحدهما كودٌ داخل نصّ) — إصلاحٌ مقصود
  // وصحيح يرفضه requireImprovement لأن البلاغ يُحسَب للسطر.
  const _gateVerdict = candidate => {
    try { return FixVerifier.verifyFix(code, candidate, fileName, analyzeCode); }
    catch (e) { return null; }
  };
  // يُرجع حكمًا واحدًا بنداءٍ واحد: هل الرفض ضارّ؟ وهل هو على الهدف نفسه؟
  // (نداءان منفصلان كانا يُشغّلان البوابة مرّتين على نفس المُرشَّح — و
  //  كلفتُها قيست بـ‎538 ms‎ على ملفٍ من 1203 أسطر، فالتوفير ملموس.)
  const _classify = candidate => {
    const v = _gateVerdict(candidate);
    if (!v || v.accepted === true) return { harmful: false, target: false };
    const has = n => typeof FixVerifier[n] === 'function';
    return {
      harmful: has('isHarmfulRejection') ? FixVerifier.isHarmfulRejection(v.reason) : false,
      target:  has('isTargetRejection')  ? FixVerifier.isTargetRejection(v.reason)  : false,
    };
  };
  const _stepHarmful = candidate => _classify(candidate).harmful;

  let ext = 'unknown';
  try {
    ext = detectExt(code, fileName);
  } catch (e) {
    // إذا فشل detector، نستخدم امتداد اسم الملف فقط.
    // لا يوجد هنا أي تخمين من محتوى الكود.
    ext = 'unknown';
    if (fileName) {
      const fallback = String(fileName).split('.').pop().toLowerCase();
      if (fallback) {
        if (fallback === 'jsx' || fallback === 'mjs' || fallback === 'cjs') ext = 'js';
        else if (fallback === 'tsx') ext = 'ts';
        else ext = fallback;
      }
    }
  }

  const repairs  = [];
  const aiNeeded = [];
  const rejected = [];   // candidates رُفضت قبل التطبيق (مثل SQL غير سليم)
  // [SILENT-DROP] مُصلِحٌ نُودي ولم يُنتج شيئًا — قناةٌ مقروءةٌ لا صمت.
  //
  // كان المخرجُ عند ‎!result || result.fixed === repairedCode‎ يُرجع بلا أثر:
  // لا ‎rejected‎ ولا ‎aiNeeded‎ إلا إذا كان ‎issue.aiRequired === true‎ — وأكثرُ
  // الكاشفاتِ لا تضعه. فبلاغٌ مكتشَفٌ ومُوجَّهٌ إلى استراتيجيةٍ صحيحةٍ يختفي
  // تمامًا إذا كان نمطُ المُصلِحِ أضيقَ من نمطِ الكاشف.
  //
  // وهذا بعينه ما خبّأ ‎[LOG-SINK]‎: ‎log.info(password)‎ كان يُكتشَف ويُوجَّه
  // ويُنادى له ‎fixLogSecret‎ فيُرجع ‎null‎، فلا يظهر في أيِّ مخرَج — سبعةُ
  // أشكالٍ من سبعة، ولا اختبارٌ واحدٌ يسقط. فالقناةُ أدناه تجعل الفجوةَ
  // مقروءةً بلا أن تتغيّر قرارات القبول والرفض: ‎dropped‎ حقلٌ إضافيٌّ
  // للتشخيص، و‎repairs‎ و‎rejected‎ و‎aiNeeded‎ كما هي حرفًا.
  const dropped = [];
  let repairedCode = code;

  // تتبّع الأسطر: لكل سطر حالي → رقم سطره في code (أو -1 إذا أُضيف)،
  // ومجموعات المشاكل التي أصلحته في هذا التشغيل. يسمح بمعرفة أن الدليل
  // تغيّر لأن إصلاحًا سابقًا عدّل نفس السطر — لا لأن المشكلة قديمة.
  const codeLines = code.split('\n');
  let lineOrigin = codeLines.map((_, i) => i);
  let lineGroups = codeLines.map(() => null);
  const trackFix = (before, after, group) => {
    const O = before.split('\n'), N = after.split('\n');
    let pre = 0;
    while (pre < O.length && pre < N.length && O[pre] === N[pre]) pre++;
    let suf = 0;
    while (suf < O.length - pre && suf < N.length - pre &&
           O[O.length - 1 - suf] === N[N.length - 1 - suf]) suf++;
    const oldMid = O.length - pre - suf, newMid = N.length - pre - suf;
    const midOrigin = oldMid === newMid
      ? lineOrigin.slice(pre, pre + oldMid)
      : new Array(newMid).fill(-1);
    const midGroups = oldMid === newMid
      ? lineGroups.slice(pre, pre + oldMid).map(g => new Set([...(g || []), group]))
      : new Array(newMid).fill(null).map(() => new Set([group]));
    lineOrigin = [...lineOrigin.slice(0, pre), ...midOrigin, ...lineOrigin.slice(O.length - suf)];
    lineGroups = [...lineGroups.slice(0, pre), ...midGroups, ...lineGroups.slice(O.length - suf)];
  };

  const sorted = [...issues].sort((a, b) => b.line - a.line);

  sorted.forEach(issue => {
    const stratKey = detectStrategy(issue, ext);
    const strat = STRATEGIES[stratKey];
    if (!strat) { return; }

    if (!strat.autoFix || !strat.fn) {
      aiNeeded.push({
        line: issue.line, title: issue.title,
        strategy: stratKey, reason: getAIReason(stratKey), ev: issue.ev,
      });
      return;
    }

    const lines = repairedCode.split('\n');

    // لا إعادة معالجة: سطر أصلحته مشكلة من نفس المجموعة في هذا التشغيل لا يُعالج مرة ثانية.
    const trackedAt = lineOrigin.indexOf(issue.line - 1);
    if (trackedAt >= 0 && lineGroups[trackedAt] && lineGroups[trackedAt].has(problemGroup(stratKey))) {
      return;
    }

    // حماية من stale-line:
    // إذا كان الدليل لا يطابق السطر، فالـissue قديمة ويجب تجاهلها.
    // الاستثناء الوحيد: إذا حصل إصلاح سابق غيّر أرقام الأسطر
    // (مثل إضافة import في الرأس)، نعيد ربط الدليل بموقعه الجديد.
    if (issue.ev && String(issue.ev).trim()) {
      let evidence = String(issue.ev).trim();
      const originalText = codeLines[issue.line - 1];

      // AST evidence: يُقبل فقط إذا طابق شكله السطر الأصلي، ثم يصبح نص ذلك
      // السطر هو الدليل. لا يطابق → stale (كما كان).
      if (issue.astVerified === true && originalText !== undefined &&
          !originalText.includes(evidence)) {
        const anchor = astEvidenceAnchor(evidence);
        if (!anchor || !anchor.test(originalText)) return;
        evidence = originalText.trim();
      }

      const originalLineIndex = issue.line - 1;
      const currentLine = lines[originalLineIndex];

      // الدليل موجود في السطر الأصلي، لكن إصلاحًا سابقًا في هذا التشغيل عدّل
      // نفس السطر → ليست stale؛ تُعالج على موقع ذلك السطر الآن.
      const touchedAt = (!currentLine || !String(currentLine).includes(evidence)) &&
                        originalText !== undefined && originalText.includes(evidence)
        ? lineOrigin.indexOf(issue.line - 1)
        : -1;
      if (touchedAt >= 0 && lineGroups[touchedAt]) {
        issue = { ...issue, line: touchedAt + 1 };
      } else if (!currentLine || !String(currentLine).includes(evidence)) {
        // لا يوجد تعديل سابق: mismatch حقيقي = stale issue.
        if (repairedCode === code) {
          return;
        }

        // حصل تعديل سابق، لذلك قد يكون رقم السطر تحرك.
        const matchIndex = lines.findIndex(line =>
          String(line).includes(evidence)
        );

        if (matchIndex === -1) {
          return;
        }

        issue = { ...issue, line: matchIndex + 1 };
      }
    }

    let result = null;
    try {
      result = strat.fn(repairedCode, issue, lines, ext, fileName);
    } catch (e) {
      // فشل Strategy واحدة لا يجب أن يُسقط باقي الإصلاحات.
      console.warn(`[RepairEngine] Strategy failed: ${stratKey}`, e?.message || e);
      dropped.push({
        line: issue.line, strategy: stratKey, fixer: String(strat.fn.name || ''),
        kind: 'FIXER_THREW', title: issue.title,
        reason: String((e && e.message) || e), ev: String(lines[issue.line - 1] || '').trim(),
      });
      return;
    }

    // SQL: candidate يبقي الثغرة أو ينتج استعلامًا غير صالح لا يُعتمد أبدًا.
    if (stratKey === 'SQL_INJECTION' && result && result.fixed !== repairedCode) {
      const problem = sqlCandidateProblem(repairedCode, result.fixed, fileName, ext);
      if (problem) {
        rejected.push({ line: issue.line, strategy: stratKey, source: 'fixSQLInjection', reason: problem });
        result = null;
      }
    }

    // CMD: candidate يعقّم الجزء الخطأ أو يكسر السطر لا يُعتمد — المشكلة تبقى كما هي.
    if ((stratKey === 'CMD_INJECTION' || stratKey === 'CMD_INJECTION_PY') && result && result.fixed !== repairedCode) {
      const problem = cmdCandidateProblem(repairedCode, result.fixed, issue.line, stratKey);
      if (problem) {
        rejected.push({ line: issue.line, strategy: stratKey, source: strat.fn.name, reason: problem });
        result = null;
      }
    }

    // XSS: candidate يحوّل res.send إلى res.json لا يُعتمد — المشكلة تبقى كما هي.
    if (stratKey === 'XSS_INNER_HTML' && result && result.fixed !== repairedCode) {
      const problem = xssCandidateProblem(repairedCode, result.fixed, issue.line);
      if (problem) {
        rejected.push({ line: issue.line, strategy: stratKey, source: strat.fn.name, reason: problem });
        result = null;
      }
    }

    // Semantic: candidate صحيح نحويًا لكنه يغيّر معنى الكود لا يُعتمد — المشكلة تبقى كما هي.
    if ((stratKey === 'HARDCODED_SECRET' || stratKey === 'HARDCODED_PASS' || stratKey === 'API_KEY' ||
         stratKey === 'LOOSE_EQUALITY') && result && result.fixed !== repairedCode) {
      const problem = semanticCandidateProblem(repairedCode, result.fixed, issue.line, stratKey, ext);
      if (problem) {
        rejected.push({ line: issue.line, strategy: stratKey, source: strat.fn.name, reason: problem });
        result = null;
      }
    }
    if ((stratKey === 'EVAL_USAGE' || stratKey === 'CMD_INJECTION' || stratKey === 'CMD_INJECTION_PY' ||
         stratKey === 'SQL_INJECTION' || stratKey === 'WEAK_CRYPTO' || stratKey === 'MD5_USAGE' ||
         stratKey === 'WEAK_HASH') && result && result.fixed !== repairedCode) {
      const problem = literalTargetProblem(repairedCode, result.fixed, issue.line, stratKey, ext);
      if (problem) {
        rejected.push({ line: issue.line, strategy: stratKey, source: strat.fn.name || stratKey, reason: problem });
        result = null;
      }
    }
    // (بعد حارس الـliteral: target داخل نص يُرفض بسببه الأدق أولًا)
    // WEAK_CRYPTO: md5/sha1 → sha256 ليس إصلاحًا لـhash كلمة مرور (يبقى قابلًا
    // للكسر، والمحلل يتوقف عن الإبلاغ ⇒ SAFE_AUTO_FIX مزيّف). لا إعادة كتابة إذا
    // كان السياق credential أو المدخل parameter لا نعرف مصدره (قد يكون ملفًا آخر).
    if ((stratKey === 'WEAK_CRYPTO' || stratKey === 'MD5_USAGE' || stratKey === 'WEAK_HASH') &&
        result && result.fixed !== repairedCode) {
      const problem = weakCryptoCredentialProblem(repairedCode, issue, ext);
      if (problem) {
        rejected.push({ line: issue.line, strategy: stratKey, source: 'fixWeakCrypto', reason: problem });
        aiNeeded.push({ line: issue.line, title: issue.title, strategy: stratKey,
          reason: problem + ' — needs a password KDF (bcrypt/scrypt/Argon2) or proof the input is not a credential',
          ev: issue.ev });
        return;
      }
    }


    if (!result || result.fixed === repairedCode) {
      // SQL fallback: استخدم الـlegacy fixer فقط كمولّد candidate.
      // لا يتجاوز Ghost/FixVerifier في الطبقة الأعلى.
      if (stratKey === 'SQL_INJECTION') {
        const legacySQL = getLegacySQLFixer(fileName);

        if (
          legacySQL &&
          typeof legacySQL.fix === 'function' &&
          (ext === 'js' || ext === 'py')
        ) {
          try {
            const legacyOut = legacySQL.fix(repairedCode, fileName);

            const legacyFixed =
              typeof legacyOut?.fixed === 'string'
                ? legacyOut.fixed
                : typeof legacyOut?.code === 'string'
                  ? legacyOut.code
                  : null;

            const legacyChanged =
              legacyOut?.changed === true ||
              (typeof legacyOut?.code === 'string' &&
               legacyOut.code !== repairedCode);

            const legacyProblem =
              legacyChanged &&
              typeof legacyFixed === 'string' &&
              legacyFixed !== repairedCode
                ? sqlCandidateProblem(repairedCode, legacyFixed, fileName, ext) ||
                  literalTargetProblem(repairedCode, legacyFixed, issue.line, stratKey, ext)
                : null;
            if (legacyProblem) {
              rejected.push({ line: issue.line, strategy: stratKey, source: 'legacy SQL fixer', reason: legacyProblem });
            }

            if (
              legacyChanged &&
              typeof legacyFixed === 'string' &&
              legacyFixed !== repairedCode &&
              !legacyProblem
            ) {
              result = {
                fixed: legacyFixed,
                patch: 'Legacy SQL fixer candidate',
                reason: 'Legacy SQL fixer fallback',
              };
            }
          } catch (e) {
            console.warn(
              '[RepairEngine] Legacy SQL fallback failed:',
              e?.message || e
            );
          }
        }
      }

      if (!result || result.fixed === repairedCode) {
        // [SILENT-DROP] المُصلِحُ نُودي ولم يُنتج تغييرًا: فجوةُ قدرةٍ لا فجوةُ
        // اكتشاف. تُسجَّل كي تُقرأ، ولا يتغيّر القرار.
        dropped.push({
          line: issue.line, strategy: stratKey, fixer: String(strat.fn.name || ''),
          kind: 'FIXER_NO_CHANGE', title: issue.title,
          reason: 'الاستراتيجيةُ نُودِيت وأرجعت null أو شفرةً غيرَ مُغيَّرة — ' +
                  'نمطُ المُصلِحِ لا يُطابق هذا الشكل',
          ev: String(lines[issue.line - 1] || '').trim(),
          aiRequired: issue.aiRequired === true,
        });
        // إذا فشل الإصلاح الحتمي، لكن Analyzer أعلن أن المشكلة
        // تحتاج AI، فمررها إلى AI بدل إسقاطها بصمت.
        if (issue.aiRequired === true) {
          aiNeeded.push({
            line: issue.line,
            title: issue.title,
            strategy: stratKey,
            reason: getAIReason(stratKey),
            ev: issue.ev,
          });
        }
        return;
      }
    }

    // [STEP-SALVAGE] في وضع الإنقاذ: لا تتقدّم خطوةٌ لا تُثبتها البوابة.
    // تُقاس ضد الكود الأصلي، فيبقى المُرشَّح المتراكم مقبولًا في كل حال.
    if (verifyEachStep && _stepHarmful(result.fixed)) {
      rejected.push({
        line: issue.line, strategy: stratKey, source: 'step-salvage',
        reason: 'GATE_REJECTED_STEP — البوابة ترفض هذه الخطوة رفضَ ضررٍ أو ' +
                'عدمِ إثبات، فأُسقطت هي فقط وبقيت بقية إصلاحات الملف',
      });
      return;
    }

    repairs.push({
      line: issue.line, title: issue.title, strategy: stratKey,
      before: issue.ev, after: result.patch,
      confidence: strat.confidence, autoFix: true,
      reason: result.reason || 'Safe deterministic replacement',
    });
    trackFix(repairedCode, result.fixed, problemGroup(stratKey));
    repairedCode = result.fixed;
  });

  // [STEP-SALVAGE] قرارُ الإنقاذ، مرّةً واحدة وقبل أن يحكم Ghost.
  //
  // إن كانت البوابة ترفض الكتلة رفضَ **ضرر**، فالعيبُ في بعض خطواتها لا في
  // كلّها. فيُعاد الإصلاح بتحقّقٍ لكل خطوة، فتُسقَط الخطوة الضارّة وحدها
  // ويبقى الباقي. وGhost تبقى الحكم الأخير على الناتج المُنقَذ.
  //
  // وهو هنا لا في فرع Ghost: Ghost غير محمَّلة في كل بيئة — وVM الخادم
  // (server_repair_adapter) كانت بلا بوابةٍ إطلاقًا، فيُسلَّم المُرشَّح غير
  // مُتحقَّقٍ منه ثم يرفضه المُنسّق كاملًا. وتعليقُ الإنقاذ على Ghost يُخرِج
  // ذلك المسار من الحراسة أصلًا.
  //
  // والرفضُ غيرُ الضارّ (لا تحسّن قابل للقياس، أو تعذّرٌ بيئي) لا يُستدعى له
  // إنقاذ: لا خطوةَ فيه ضارّة، فالإعادة تُنتج نفس الناتج وتُهدر نداءات بوابة.
  if (!verifyEachStep && repairedCode !== code && _gateReady()) {
    const cls = _classify(repairedCode);
    if (cls.harmful && !cls.target) {
      const salvaged = repairCode(code, issues, fileName, { verifyEachStep: true });
      if (salvaged && typeof salvaged.repaired === 'string') return salvaged;
    }
  }

  // AuthRepair
  // يُفترض أنه يضيف أسطرًا فقط. حقن فرع الـroute (401 بلا أي فحص حساسية)
  // يُحذف ويُسجَّل في rejected؛ باقي الإضافات (فرع الـfunction) تبقى كما هي.
  if (typeof AuthRepair !== 'undefined') {
    try {
      const ar = AuthRepair.fix(repairedCode, fileName);
      if (ar.changed) {
        const B = repairedCode.split('\n'), A = String(ar.fixed).split('\n');
        const kept = [];
        const routeRejected = [];
        let p = 0;
        for (const l of A) {
          if (p < B.length && l === B[p]) { kept.push(l); p++; }
          else if (l === AUTH_ROUTE_LINE) routeRejected.push(p);   // p = عدد الأسطر الأصلية قبله = رقم السطر الذي حُقن بعده
          else kept.push(l);
        }
        if (p !== B.length) {
          rejected.push({ line: null, strategy: 'MISSING_AUTH', source: 'AuthRepair',
            reason: 'AUTH_NOT_ADDITIVE — AuthRepair modified existing lines instead of only adding; output not applied' });
        } else {
          routeRejected.forEach(line => rejected.push({ line, strategy: 'MISSING_AUTH', source: 'AuthRepair',
            reason: 'AUTH_ROUTE_INJECTED — unconditional 401 check added to a route without any sensitivity analysis' }));
          repairedCode = kept.join('\n');
        }
      }
    } catch(e) {}
  }

  // Ghost Mode
  //
  // [GHOST-PRUNE] رفضُ Ghost يُرجع الكود الأصلي حرفًا، فالإصلاحات المتراكمة
  // في repairs لم تُطبَّق. وكانت repairs وsummary.fixed تبقى كما هي، فيُبلّغ
  // التقرير عن إصلاحاتٍ على ملفٍ لم يتغيّر، وrejected خالٍ. والمقيس على ملف
  // حقيقي من المستودع، public/jszip.min.js (يرفضه حارس الحِزَم المُصغَّرة):
  //     repaired === original  ·  repairs 1  ·  summary.fixed 1  ·  score 33
  //     ·  rejected 0
  // أي تقريرٌ يدّعي إصلاحًا لم يحدث، ولا يسجّل سببَ عدم حدوثه. فالتهذيب هنا:
  // ما لم يُطبَّق يُنقَل إلى rejected بسببه، وsummary يُحتسب بعده فيصدُق.
  if (typeof GhostMode !== 'undefined') {
    try {
      const ghost = GhostMode.fix(code, repairedCode, fileName,
        typeof analyzeCode !== 'undefined' ? analyzeCode : null);

      if (repairedCode !== code && ghost.code === code) {
        const why = [
          ghost.reason,
          ...(ghost.rejectedCandidates || []).map(r => r.reason),
        ].filter(Boolean).map(String).join(' · ') || 'GHOST_REJECTED';
        for (const r of repairs) {
          rejected.push({
            line: r.line, strategy: r.strategy, source: 'GhostMode',
            reason: 'GHOST_DISCARDED_BATCH — ' + why,
          });
        }
        repairs.length = 0;      // نفس المرجع المُعاد أدناه
      }

      if (ghost.code !== repairedCode) repairedCode = ghost.code;
    } catch(e) {}
  }

  // [CMD-WHOLE] شرحُ الرفضِ للمستخدم — لا تغييرَ في أيِّ قرار.
  // صنفُ الأوامرِ الذي انتهى بلا إصلاحٍ مُطبَّقٍ على سطره، وشكلُه «الأمرُ
  // كلُّه من المُدخَل»، كان يُسجَّل ‎GHOST_DISCARDED_BATCH — no_candidate‎
  // فلا يعرف المستخدمُ سببًا ولا علاجًا. فيُضاف بيانٌ واحدٌ إلى ‎aiNeeded‎
  // بالسببِ والعلاج. والشرطُ «بلا إصلاحٍ على سطره» يحفظ عقدَ
  // ‎security_no_drop‎: صنفٌ أُصلح لا يظهر في ‎aiNeeded‎.
  for (const r of rejected) {
    if (!/^CMD_INJECTION(_PY)?$/.test(String(r.strategy))) continue;
    if (repairs.some(p => p.line === r.line && String(p.strategy) === String(r.strategy))) continue;
    if (aiNeeded.some(a => a.line === r.line && String(a.strategy) === String(r.strategy))) continue;
    const issue = issues.find(i => i && i.line === r.line) || { line: r.line };
    const whole = cmdWholeCommandProblem(code, issue, r.strategy);
    if (!whole) continue;
    aiNeeded.push({
      line: r.line, title: issue.title, strategy: r.strategy, ev: issue.ev,
      reason: whole + ' — العلاجُ قائمةُ عملياتٍ مُعتمَدةٍ بأوامرَ ووسائطَ ' +
              'ثابتة (execFile/spawn) يختار المُدخَلُ بينها ولا يُكوِّنها',
    });
  }

  return {
    original: code, repaired: repairedCode,
    repairs, aiNeeded, rejected,
    // [SILENT-DROP] حقلٌ إضافيٌّ للتشخيص وحده: ما نُودي له مُصلِحٌ فلم يُنتج
    // شيئًا. لا يدخل ‎summary‎ ولا يغيّر ‎score‎ — فالعدُّ كما كان حرفًا.
    dropped,
    summary: {
      total: issues.length,
      fixed: repairs.length,
      needsAI: aiNeeded.length,
      score: Math.round((repairs.length / Math.max(issues.length, 1)) * 100),
    },
  };
}
