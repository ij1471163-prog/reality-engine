// ─── Code Converter ──────────────────────────────────
// يحول الكود بين Python وJavaScript وJava

function convertCode(code, fromLang, toLang) {
  if (fromLang === toLang) return code;
  
  const key = fromLang + '_to_' + toLang;
  
  if (key === 'python_to_javascript') return pyToJS(code);
  if (key === 'javascript_to_python') return jsToPy(code);
  if (key === 'python_to_java')       return pyToJava(code);
  if (key === 'javascript_to_java')   return jsToJava(code);
  
  return '// تحويل غير مدعوم بعد';
}

// ─── Python → JavaScript ──────────────────────────────
function pyToJS(code) {
  let out = code;
  
  // def → function
  out = out.replace(/^def (\w+)\(([^)]*)\):/gm, 'function $1($2) {');
  
  // class
  out = out.replace(/^class (\w+)(?:\((\w+)\))?:/gm, (_, name, parent) =>
    parent ? `class ${name} extends ${parent} {` : `class ${name} {`);
  
  // if/elif/else/for/while
  out = out.replace(/^(\s*)elif (.+):/gm, '$1} else if ($2) {');
  out = out.replace(/^(\s*)if (.+):/gm, '$1if ($2) {');
  out = out.replace(/^(\s*)else:/gm, '$1} else {');
  out = out.replace(/^(\s*)for (\w+) in range\((\d+)\):/gm, '$1for (let $2 = 0; $2 < $3; $2++) {');
  out = out.replace(/^(\s*)for (\w+) in (.+):/gm, '$1for (const $2 of $3) {');
  out = out.replace(/^(\s*)while (.+):/gm, '$1while ($2) {');

  // True/False/None
  out = out.replace(/\bTrue\b/g, 'true');
  out = out.replace(/\bFalse\b/g, 'false');
  out = out.replace(/\bNone\b/g, 'null');

  // print → console.log
  out = out.replace(/print\((.+)\)/g, 'console.log($1)');

  // len() → .length
  out = out.replace(/len\((\w+)\)/g, '$1.length');

  // f-strings → template literals
  out = out.replace(/f["']([^"']*)["']/g, (_, s) =>
    '`' + s.replace(/\{(\w+)\}/g, '${$1}') + '`');

  // # comments → //
  out = out.replace(/^(\s*)#(.*)$/gm, '$1//$2');

  // إضافة أقواس للـ blocks
  out = addJSBraces(out);

  return out;
}

// ─── JavaScript → Python ──────────────────────────────
function jsToPy(code) {
  let out = code;

  // function → def
  out = out.replace(/function (\w+)\(([^)]*)\)\s*\{/g, 'def $1($2):');

  // const/let/var → بدون كلمة
  out = out.replace(/\b(?:const|let|var)\s+/g, '');

  // console.log → print
  out = out.replace(/console\.log\((.+)\)/g, 'print($1)');

  // true/false/null
  out = out.replace(/\btrue\b/g, 'True');
  out = out.replace(/\bfalse\b/g, 'False');
  out = out.replace(/\bnull\b/g, 'None');

  // === → ==
  out = out.replace(/===/g, '==');
  out = out.replace(/!==/g, '!=');

  // // comments → #
  out = out.replace(/^(\s*)\/\/(.*)$/gm, '$1#$2');

  // احذف الأقواس
  out = out.replace(/\s*\{/g, ':');
  out = out.replace(/^\s*\}\s*$/gm, '');
  out = out.replace(/;$/gm, '');

  return out;
}

// ─── Python → Java ────────────────────────────────────
function pyToJava(code) {
  let out = code;

  // def → public static void (تقريبي)
  out = out.replace(/^def (\w+)\(([^)]*)\):/gm, 'public static void $1($2) {');

  // print → System.out.println
  out = out.replace(/print\((.+)\)/g, 'System.out.println($1);');

  // True/False/None
  out = out.replace(/\bTrue\b/g, 'true');
  out = out.replace(/\bFalse\b/g, 'false');
  out = out.replace(/\bNone\b/g, 'null');

  // # → //
  out = out.replace(/^(\s*)#(.*)$/gm, '$1//$2');

  // for in range
  out = out.replace(/for (\w+) in range\((\d+)\):/g, 'for (int $1 = 0; $1 < $2; $1++) {');

  // if/else
  out = out.replace(/^(\s*)if (.+):/gm, '$1if ($2) {');
  out = out.replace(/^(\s*)else:/gm, '$1} else {');

  out = addJSBraces(out);

  return `public class Main {\n${out}\n}`;
}

// ─── JavaScript → Java ────────────────────────────────
function jsToJava(code) {
  let out = code;

  // const/let/var → نوع
  out = out.replace(/\b(?:const|let|var)\s+(\w+)\s*=\s*(\d+)/g, 'int $1 = $2');
  out = out.replace(/\b(?:const|let|var)\s+(\w+)\s*=\s*"([^"]*)"/g, 'String $1 = "$2"');
  out = out.replace(/\b(?:const|let|var)\s+(\w+)/g, 'var $1');

  // console.log → System.out.println
  out = out.replace(/console\.log\((.+)\)/g, 'System.out.println($1)');

  // === → .equals() للـ strings (تقريبي)
  out = out.replace(/===/g, '==');

  // function → public static void
  out = out.replace(/function (\w+)\(([^)]*)\)\s*\{/g, 'public static void $1($2) {');

  // // تبقى //
  return `public class Main {\n    public static void main(String[] args) {\n    }\n\n${out}\n}`;
}

// ─── Helper: أضف أقواس JS ────────────────────────────
function addJSBraces(code) {
  const lines = code.split('\n');
  const result = [];
  let prevIndent = 0;
  const stack = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const t = line.trim();
    if (!t) { result.push(''); continue; }

    const indent = line.search(/\S/);
    
    // اقفل الأقواس المفتوحة لو indent رجع
    while (stack.length && indent < stack[stack.length - 1] + 4) {
      if (indent <= stack[stack.length - 1]) {
        const si = stack.pop();
        result.push(' '.repeat(si) + '}');
      } else break;
    }

    result.push(line);

    // لو السطر ينتهي بـ { → ادفع الـ indent للـ stack
    if (t.endsWith('{')) {
      stack.push(indent);
    }
  }

  // اقفل الباقي
  while (stack.length) {
    result.push(' '.repeat(stack.pop()) + '}');
  }

  return result.join('\n');
}

// ─── واجهة للموقع ─────────────────────────────────────
function detectLanguage(fileName) {
  const ext = fileName.split('.').pop().toLowerCase();
  if (ext === 'py') return 'python';
  if (['js','jsx','ts'].includes(ext)) return 'javascript';
  if (ext === 'java') return 'java';
  return 'unknown';
}
