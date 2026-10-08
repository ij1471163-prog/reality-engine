// ═══════════════════════════════════════════════════════
// اختبارات fixHTTP (repair_engine.js): http:// داخل نص كود/بيانات لا يُعدَّل
// تشغيل:  node --test vercel-api/test/repair_http_literal_guard.test.js
//
// كان fixHTTP يستبدل كل http:// في السطر بـhttps:// أينما كان:
//   'const u = "http://example.com";\n'   (كود مكتوب كنص في اختبار)  → يتغير
//   { any: 'https:// بدل http://' }       (نص شرح)                  → 'https:// بدل https://'
//   t.replace('http://', 'https://')      (نمط بحث)                  → replace('https://', 'https://')
//   namespaceuri: "http://…"               (namespace URI)            → يتغير
// الآن يُعدَّل فقط string هو نفسه URL (يبدأ بـhttp:// بلا مسافة/اقتباس/\n)، وليس
// نمط بحث أو طرف مقارنة أو namespace. التعليقات والـregex لا تُلمس.
// ═══════════════════════════════════════════════════════
'use strict';

const test   = require('node:test');
const assert = require('node:assert');
const fs     = require('node:fs');
const path   = require('node:path');
const vm     = require('node:vm');

const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const TEST_DIR = __dirname;

function loadUiContext() {
  const noop = () => {};
  const ctx = {
    console: { log: noop, warn: noop, error: noop, info: noop }, setTimeout, clearTimeout, TextEncoder, TextDecoder, URL,
    document: { getElementById: () => null, addEventListener: noop, createElement: () => ({}), querySelector: () => null, querySelectorAll: () => [] },
    localStorage: { getItem: () => null, setItem: noop }, navigator: {}, location: { search: '' },
  };
  ctx.window = ctx;
  vm.createContext(ctx);
  const html = fs.readFileSync(path.join(PUBLIC_DIR, 'index.html'), 'utf8');
  for (const m of html.matchAll(/<script src="\/([^"]+)"/g)) {
    const p = path.join(PUBLIC_DIR, m[1]);
    if (!fs.existsSync(p)) continue;
    try { vm.runInContext(fs.readFileSync(p, 'utf8'), ctx, { filename: m[1] }); } catch (e) { /* ملف واجهة فقط */ }
  }
  // GhostMode يرفض الملف كله عند أي تدهور — نختبر الـfixer نفسه بمعزل عنه.
  ctx.GhostMode = undefined;
  return ctx;
}

const ctx = loadUiContext();
const TITLE = '🟠 HTTP غير آمن — استخدم HTTPS';
const fixLine = (code, line, file = 'a.js') => {
  const issue = { line, sev: 'm', type: 'security', title: TITLE };
  assert.strictEqual(ctx.detectStrategy(issue, file.split('.').pop()), 'HTTP_USAGE', 'fixture: title routes to HTTP_USAGE');
  return ctx.repairCode(code, [issue], file).repaired.split('\n')[line - 1];
};

// ═══ 1. URL حقيقي في الكود → يُصلح ═══════════════════════
const FIX = {
  'JS fetch':                  ['fetch("http://api.example.com/save", { method: "POST" });', 'a.js', 'fetch("https://api.example.com/save", { method: "POST" });'],
  'JS const single quotes':    ["const u = 'http://example.com/a?b=1';", 'a.js', "const u = 'https://example.com/a?b=1';"],
  'JS template with ${}':      ['const u = `http://${host}/api/${id}`;', 'a.js', 'const u = `https://${host}/api/${id}`;'],
  'JS prefix + concatenation': ['const u = "http://" + host + "/x";', 'a.js', 'const u = "https://" + host + "/x";'],
  'JS two URLs on one line':   ['const a = "http://a.example", b = "http://b.example";', 'a.js', 'const a = "https://a.example", b = "https://b.example";'],
  'JS URL next to code-as-text': ["const u = \"http://a.example\", t = 'fetch(\"http://b.example\");\\n';", 'a.js', "const u = \"https://a.example\", t = 'fetch(\"http://b.example\");\\n';"],
  'JS URL before a comment':   ['const u = "http://a.example"; // was http://old.example', 'a.js', 'const u = "https://a.example"; // was http://old.example'],
  'TS':                        ['const u: string = "http://api.example.com";', 'a.ts', 'const u: string = "https://api.example.com";'],
  'Python':                    ['url = "http://api.example.com"', 'a.py', 'url = "https://api.example.com"'],
  'Python f-string':           ['r = requests.get(f"http://{host}/v1")', 'a.py', 'r = requests.get(f"https://{host}/v1")'],
  'PHP':                       ['$u = "http://api.example.com";', 'a.php', '$u = "https://api.example.com";'],
  'Java':                      ['String u = "http://api.example.com";', 'A.java', 'String u = "https://api.example.com";'],
  'C#':                        ['var u = "http://api.example.com";', 'A.cs', 'var u = "https://api.example.com";'],
};
for (const [name, [line, file, expected]] of Object.entries(FIX)) {
  test(`fixes a real http:// URL: ${name}`, () => {
    assert.strictEqual(fixLine(line + '\n', 1, file), expected);
  });
}

// ═══ 2. ليس URL في الكود → لا يتغير ═════════════════════
const KEEP = {
  'code-as-text string':              ["const code = 'const u = \"http://example.com\";\\n';", 'a.js'],
  'code-as-text in a test table':     ["  'JS': ['a.js', 'var x = 1;\\nfetch(\"http://api.example.com/a\");\\n', 'x'],", 'a.js'],
  'prose with a URL':                 ["  INSECURE_HTTP: { any: 'https:// بدل http://' },", 'a.js'],
  'text with spaces':                 ['const msg = "visit http://example.com today";', 'a.js'],
  'markup string':                    ['const svg = \'<svg xmlns="http://www.w3.org/2000/svg"></svg>\';', 'a.js'],
  'search pattern: replace':          ["fix: t.replace('http://', 'https://'),", 'a.js'],
  'search pattern: startsWith':       ['if (u.startsWith("http://")) warn();', 'a.js'],
  'comparison ===':                   ['if (url === "http://localhost") dev();', 'a.js'],
  'comparison (left operand)':        ['if ("http://x.example" == u) f();', 'a.js'],
  'comment only':                     ['// docs: http://example.com', 'a.js'],
  'regex literal':                    ['const re = /http:\\/\\//g;', 'a.js'],
  'SVG namespace':                    ['const el = document.createElementNS("http://www.w3.org/2000/svg", "svg");', 'a.js'],
  'namespace property':               ['this.meta = { namespaceuri: n || "http://jspdf.default.namespaceuri/" };', 'a.js'],
  'W3C namespace constant':           ['const XLINK = "http://www.w3.org/1999/xlink";', 'a.js'],
  'Python comment':                   ['# see http://example.com', 'a.py'],
  'Python code-as-text':              ['CODE = \'url = "http://api.example.com"\\n\'', 'a.py'],
};
for (const [name, [line, file]] of Object.entries(KEEP)) {
  test(`does not change: ${name}`, () => {
    assert.strictEqual(fixLine(line + '\n', 1, file), line);
  });
}

// ═══ 3. الملفات الحقيقية التي ظهر فيها الخطأ ═══════════════════
const REAL = [
  [path.join(PUBLIC_DIR, 'knowledge_base.js'), /INSECURE_HTTP:\s+\{ any: 'https:\/\/ بدل http:\/\/' \}/],
  [path.join(PUBLIC_DIR, 'security_scanner.js'), /t\.replace\('http:\/\/', 'https:\/\/'\)/],
  [path.join(TEST_DIR, 'repair_engine.test.js'), /const code = 'const API_KEY = .*http:\/\/example\.com/],
  [path.join(TEST_DIR, 'server_syntax_guard.test.js'), /http:\/\//],
  [path.join(TEST_DIR, 'server_verifier_syntax.test.js'), /http:\/\//],
];
for (const [file, re] of REAL) {
  test(`real file ${path.basename(file)}: http:// inside text/patterns is not changed`, () => {
    const code = fs.readFileSync(file, 'utf8');
    const lines = code.split('\n');
    const at = lines.map((l, i) => (re.test(l) ? i + 1 : 0)).filter(Boolean);
    assert.ok(at.length >= 1, 'fixture: the line exists');
    for (const line of at) {
      assert.strictEqual(fixLine(code, line, path.basename(file)), lines[line - 1], `line ${line}`);
    }
  });
}

test('analyzer → repairCode: the GameServer-like fetch is still fixed', () => {
  const code = 'function saveGame(data) {\n    fetch("http://api.example.com/save", { method: "POST", body: data });\n}\nsaveGame(1);\n';
  const http = ctx.analyzeCode(code, 'a.js').filter(i => ctx.detectStrategy(i, 'js') === 'HTTP_USAGE');
  assert.ok(http.length >= 1, 'fixture: analyzer reports insecure HTTP');
  const out = ctx.repairCode(code, http, 'a.js').repaired;
  assert.strictEqual(out.split('\n')[1], '    fetch("https://api.example.com/save", { method: "POST", body: data });');
});
