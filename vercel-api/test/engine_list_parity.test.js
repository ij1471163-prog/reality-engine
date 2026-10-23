// ═══════════════════════════════════════════════════════════════════════
// [ENGINE-PARITY] قائمة محركات save.js (تحقق التعلّم) = قائمة analyze.js (الإنتاج)
// تشغيل:  node --test vercel-api/test/engine_list_parity.test.js
//
// السلوك المطلوب ليس تساوي الأسماء لذاته، بل: تحقّق التعلّم يرى **نفس بلاغات**
// الإنتاج على نفس الكود. فيُختبر هنا: الأسماء والترتيب، وتوافق التبعيات،
// وآثار التحميل في سياق save.js المخزَّن (لا تسرّب بين الطلبات)، والأثر السلوكي
// عبر الـhandler الحقيقي. محلي بأسرار وهمية وGitHub محاكى.
//
// المقيس قبل التوحيد: 19 من 47 محركًا، وعلى 247 ملفًا اختلفت البلاغات في 206،
// وفي JS لم تُرَ عائلات SQL وXSS والتشفير الضعيف إطلاقًا.
// ═══════════════════════════════════════════════════════════════════════
'use strict';

const test   = require('node:test');
const assert = require('node:assert');
const fs     = require('node:fs');
const path   = require('node:path');
const vm     = require('node:vm');

const ROOT = path.join(__dirname, '..');
const PUB = path.join(ROOT, 'public');
const listFrom = (rel, re) => {
  const src = fs.readFileSync(path.join(ROOT, rel), 'utf8');
  const m = src.match(re);
  assert.ok(m, 'لم يُعثر على القائمة في ' + rel);
  return [...m[1].matchAll(/'([^']+)'/g)].map(x => x[1]);
};
const ANALYZE = listFrom('api/analyze.js', /const engines = \[([\s\S]*?)\]/);
const SAVE = listFrom('api/patterns/save.js', /const ENGINES = \[([\s\S]*?)\]/);

// نفس شكل السياق في save.js وanalyze.js
function ctxWith(list) {
  const ctx = vm.createContext({ console: { log() {}, warn() {}, error() {}, info() {} }, window: {}, global: {}, F: {}, R: {} });
  const errors = [];
  for (const f of list) {
    try { vm.runInContext(fs.readFileSync(path.join(PUB, f), 'utf8'), ctx); } catch (e) { errors.push(f + ': ' + e.message); }
  }
  return { ctx, errors };
}

test('[PARITY-1] الأسماء والترتيب متطابقان بين save.js وanalyze.js', () => {
  assert.ok(ANALYZE.length >= 40, 'قائمة analyze قصيرة على غير المتوقع: ' + ANALYZE.length);
  assert.deepStrictEqual(SAVE, ANALYZE);
  assert.strictEqual(new Set(SAVE).size, SAVE.length, 'اسم مكرر في القائمة');
});

test('[PARITY-2] التبعيات: كل ملف موجود، وacorn قبل ghost_mode، والمخطط ← السياسة ← المخزن ← المحرك', () => {
  for (const f of SAVE) assert.ok(fs.existsSync(path.join(PUB, f)), 'ملف مفقود: ' + f);
  const at = n => SAVE.indexOf(n);
  assert.ok(at('acorn.min.js') >= 0 && at('acorn.min.js') < at('ghost_mode.js'), 'acorn بعد ghost_mode: فحص النحو في البوابة يتعطّل');
  assert.ok(at('analyzer.js') >= 0, 'analyzer.js (analyzeCode) غائب');
  assert.ok(at('healing_log_schema.js') < at('healing_log_policy.js') &&
            at('healing_log_policy.js') < at('healing_store.js') &&
            at('healing_store.js') < at('self_healing_engine.js'), 'ترتيب وحدات الإصلاح الذاتي');
});

test('[PARITY-3] آثار التحميل: كل القائمة تُحمَّل بلا خطأ، والسياق المشترك المخزَّن (save.js) = سياق جديد لكل ملف (analyze.js)، بترتيبين', () => {
  const shared = ctxWith(SAVE);
  assert.deepStrictEqual(shared.errors, []);
  assert.strictEqual(typeof shared.ctx.analyzeCode, 'function');
  const samples = [];
  for (const dir of ['api', 'api/patterns', 'lib']) {
    for (const f of fs.readdirSync(path.join(ROOT, dir))) if (f.endsWith('.js')) samples.push([f, fs.readFileSync(path.join(ROOT, dir, f), 'utf8')]);
  }
  for (const f of ['GameServer.js', 'gen_python_syntax_cases.py', 'py_reach_mutate.py']) {
    const p = path.join(__dirname, 'fixtures', f);
    if (fs.existsSync(p)) samples.push([f, fs.readFileSync(p, 'utf8')]);
  }
  samples.push(['md5.js', 'const crypto = require("crypto");\nfunction h(pw) { return crypto.createHash("md5").update(pw).digest("hex"); }\nmodule.exports = h;\n']);
  samples.push(['sql.js', 'function q(db, id) { return db.query("SELECT * FROM users WHERE id = " + id); }\nmodule.exports = q;\n']);
  assert.ok(samples.length >= 15, 'عيّنات: ' + samples.length);
  const norm = r => JSON.stringify((r || []).map(i => [i.line, i.sev, i.title, i.type, i.cwe, i.cAct]));
  const fresh = {};
  for (const [n, c] of samples) fresh[n] = norm(ctxWith(ANALYZE).ctx.analyzeCode(c, n));
  for (const order of [samples, samples.slice().reverse()]) {
    const s = ctxWith(SAVE).ctx;
    for (const [n, c] of order) assert.strictEqual(norm(s.analyzeCode(c, n)), fresh[n], n + ': السياق المشترك اختلف عن الجديد');
  }
});

// ═══ السلوك عبر الـhandler الحقيقي ═══════════════════════════════════════
test('[PARITY-4] المحمِّل الحقيقي في save.js يحمّل القائمة كاملة (لا «Analyzer unavailable»)', async (t) => {
  const H = require('./helpers/api_harness.js');
  process.env.PATTERNS_WRITE_SECRET = 'patterns-secret-NOT-REAL';
  t.after(() => { delete process.env.PATTERNS_WRITE_SECRET; });
  const r = await H.call(H.fresh('patterns/save.js'), { headers: { authorization: 'Bearer patterns-secret-NOT-REAL' }, body: {} });
  assert.notStrictEqual(r.statusCode, 500, JSON.stringify(r.body));
  assert.strictEqual(r.statusCode, 429, 'المتوقع بعد تحميل المحلّل: رفض sessionId المفقود — ' + JSON.stringify(r.body));
});

test('[PARITY-5] نمط تعلّم SQL في JS: كان يُرفض «Target issue not found» لأن القائمة لا ترى SQL — لم يعد', async (t) => {
  const H = require('./helpers/api_harness.js');
  process.env.PATTERNS_WRITE_SECRET = 'patterns-secret-NOT-REAL';
  t.after(() => { delete process.env.PATTERNS_WRITE_SECRET; });
  // الإنتاج يرى SQL في هذا الكود — شرط مسبق يُثبت أن الاختبار يقيس شيئًا
  const prod = ctxWith(ANALYZE).ctx;
  const original = 'function q(db, id) {\n  return db.query("SELECT * FROM users WHERE id = " + id);\n}\nmodule.exports = q;\n';
  const fixed = 'function q(db, id) {\n  return db.query("SELECT * FROM users WHERE id = ?", [id]);\n}\nmodule.exports = q;\n';
  // نفس خريطة العائلات التي يستعملها save.js (canonicalFamily) — مقروءة من الملف لا منسوخة
  const saveSrc = fs.readFileSync(path.join(ROOT, 'api/patterns/save.js'), 'utf8');
  const FAM = vm.runInNewContext('(' + saveSrc.match(/const ISSUE_FAMILIES = (\{[\s\S]*?\n\});/)[1] + ')');
  const fam = x => FAM[String(x || '').toUpperCase().replace(/[-\s]/g, '_')] || null;
  const famsOf = ctx => new Set((ctx.analyzeCode(original, 'q.js') || []).map(i => fam(i.cAct || i.type)).filter(Boolean));
  assert.ok(famsOf(prod).has('sql'), 'الإنتاج لا يرى SQL — الاختبار لا يقيس شيئًا');
  const r = await H.call(H.fresh('patterns/save.js'), {
    headers: { authorization: 'Bearer patterns-secret-NOT-REAL' },
    body: { originalCode: original, fixedCode: fixed, fileName: 'q.js', sessionId: 'parity-session-0001', pattern: { issueType: 'SQL_INJECTION', language: 'js' } },
  });
  assert.notDeepStrictEqual(r.body, { error: 'Target issue not found in original code' }, 'التعلّم ما زال لا يرى SQL في JS');
  // والمسار يكتمل حتى الكتابة على GitHub **المحاكى** (لا شبكة ولا كتابة حقيقية)
  assert.strictEqual(r.statusCode, 200, JSON.stringify(r.body));
  assert.strictEqual(r.body.saved, true);
  assert.strictEqual(r.body.type, 'CWE-89');
  assert.ok(H.net.github.puts >= 1);
  assert.ok(H.net.calls.every(c => /api\.github\.com/.test(c.url)), 'نداء شبكة غير GitHub الوهمي');
});
