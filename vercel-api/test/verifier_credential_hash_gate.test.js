// ═══════════════════════════════════════════════════════════════════════
// [CRED-HASH] تهشيرُ اعتمادٍ لا يُصلَح بتبديل الخوارزمية — حارسُ البوابة
// تشغيل:  node --test vercel-api/test/verifier_credential_hash_gate.test.js
//
// الحادثة التي بدأت هذا: اختبارُ تكافؤ المسارين ([CH-10]) قاس على نفس الملف
// أن مسارَ الواجهة يُبدّل تهشيرَ كلمة المرور تلقائيًّا بينما مسارُ الخادم
// يرفضه:
//     - return crypto.createHash("md5").update(pass).digest("hex");
//     + return crypto.createHash("sha256").update(pass).digest("hex");
//   repairCode            ⇒ rejected: WEAK_CRYPTO_CREDENTIAL_CONTEXT ×2
//   emergencyFix + البوابة ⇒ accepted: «Emergency removed=2»
// والتبديل ليس إصلاحًا: تغييرُ خوارزمية تهشيرِ اعتمادٍ مُخزَّن يُبطل كل كلمات
// المرور القائمة، والضعفُ باقٍ — تهشيرٌ سريع بلا مِلح ولا تكلفة. والصحيحُ
// دالةُ اشتقاق مفتاح مع خطّة ترحيل.
//
// فالحارس في **البوابة** لا في المحركات: ما تمنعه البوابة لا يتجاوزه أيُّ
// محرك، حاضرٍ أو قادم. وهذه الاختبارات تُثبّت أنه ضيّقٌ لا شامل:
//   • اعتماد ⇒ sha256   مرفوض
//   • اعتماد ⇒ bcrypt   مقبول   (الترحيلُ الصحيح لا يُمنع)
//   • غيرُ اعتماد ⇒ sha256 مقبول (لا منعَ لصنف التشفير كله)
// ═══════════════════════════════════════════════════════════════════════
'use strict';

const test   = require('node:test');
const assert = require('node:assert');
const fs     = require('node:fs');
const path   = require('node:path');
const vm     = require('node:vm');

const PUBLIC_DIR = path.join(__dirname, '..', 'public');

// سياقٌ كسياق الإنتاج: البوابة والمحركات معًا
function loadCtx() {
  const LIST = ['acorn.min.js', 'analyzer.js', 'security_scanner.js', 'secret_detector.js',
    'knowledge_base.js', 'crypto_scanner.js', 'taint_core.js', 'taint_js.js',
    'repair_engine.js', 'emergency_fixes.js', 'fix_verifier.js'];
  const store = new Map();
  const ctx = vm.createContext({
    console: { log() {}, warn() {}, error() {}, info() {} },
    window: {}, global: {}, F: {}, R: {},
    localStorage: {
      getItem: k => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => store.set(k, String(v)),
      removeItem: k => store.delete(k), clear: () => store.clear(),
    },
  });
  for (const f of LIST) {
    const p = path.join(PUBLIC_DIR, f);
    if (!fs.existsSync(p)) continue;
    try { vm.runInContext(fs.readFileSync(p, 'utf8'), ctx, { filename: f }); } catch (_) {}
  }
  return ctx;
}

const ctx = loadCtx();

function gate(before, after, fileName) {
  ctx.__b = before; ctx.__a = after; ctx.__f = fileName;
  return JSON.parse(vm.runInContext(
    'JSON.stringify((function(){ var v = FixVerifier.verifyFix(__b, __a, __f, analyzeCode, {});' +
    ' return { accepted: v.accepted, reason: String(v.reason || "") }; })())', ctx));
}

const analyze = (code, fileName) => {
  ctx.__c = code; ctx.__f = fileName;
  return JSON.parse(vm.runInContext('JSON.stringify(analyzeCode(__c, __f) || [])', ctx));
};

// ─── العيّنات ──────────────────────────────────────────────────────────
// اعتماد: الدلالةُ في توقيع الدالة (hashPassword)، لا في سطر البلاغ.
const CRED = [
  'const crypto = require("crypto");',
  'function hashPassword(pass) {',
  '  return crypto.createHash("md5").update(pass).digest("hex");',
  '}',
  'module.exports = { hashPassword };',
].join('\n');

// غيرُ اعتماد: مجموعُ تحقّقٍ لملف. ومُدخَلُه وسيطُ دالة — وهو الشكل الأغلب،
// فلو رفضته البوابة لصار الحارسُ منعًا شاملًا لصنف التشفير.
const PLAIN = [
  'const crypto = require("crypto");',
  'function fileChecksum(buf) {',
  '  return crypto.createHash("md5").update(buf).digest("hex");',
  '}',
  'module.exports = { fileChecksum };',
].join('\n');

const toSha256 = s => s.replace('"md5"', '"sha256"');

const BCRYPT = [
  'const bcrypt = require("bcrypt");',
  'function hashPassword(pass) {',
  '  return bcrypt.hashSync(pass, 12);',
  '}',
  'module.exports = { hashPassword };',
].join('\n');

// tripwire: البوابة لا تُحاكَم على عيّنةٍ بلا بلاغٍ أصلًا
test('[CRED-0] العيّنتان تحملان بلاغَ تشفيرٍ ضعيف فعلًا', () => {
  const rx = /\bmd5\b|cwe-327|weak.?(?:crypto|hash)|تشفير ضعيف/i;
  for (const [label, src] of [['اعتماد', CRED], ['غيرُ اعتماد', PLAIN]]) {
    const hit = analyze(src, 'h.js').filter(i =>
      rx.test([i && i.type, i && i.title, i && i.cAct, i && i.cwe].map(v => String(v || '')).join(' ')));
    assert.ok(hit.length > 0, label + ': لا بلاغَ تشفيرٍ ضعيف — العيّنة لا تختبر شيئًا');
  }
});

test('[CRED-1] اعتماد: md5 ⇒ sha256 مرفوض، والسببُ يُسمّي العِلّة', () => {
  const v = gate(CRED, toSha256(CRED), 'h.js');
  assert.strictEqual(v.accepted, false,
    'تبديلُ خوارزمية تهشيرِ كلمة مرور قُبل — نفس انقسام المسارين');
  assert.ok(v.reason.indexOf('REJECTED_CRYPTO_FIX_UNPROVEN') === 0,
    'رُفض لسببٍ آخر لا لحارس الاعتماد: ' + v.reason);
  assert.match(v.reason, /تهشيرُ اعتماد/, 'السببُ لا يُسمّي العِلّة: ' + v.reason);
  assert.match(v.reason, /bcrypt|scrypt|argon2|pbkdf2/, 'السببُ لا يُسمّي الإصلاح الصحيح');
});

test('[CRED-2] اعتماد: الترحيلُ إلى دالةِ اشتقاقِ مفتاح مقبول — لا منعَ شامل', () => {
  const v = gate(CRED, BCRYPT, 'h.js');
  assert.strictEqual(v.accepted, true,
    'الإصلاحُ الصحيح (bcrypt) رُفض — الحارسُ صار منعًا شاملًا: ' + v.reason);
});

// [HASH-EPHEMERAL] كان: «غير اعتماد ⇒ md5 ⇒ sha256 مقبول». لكن fileChecksum تُصدَّر وتُرجع البصمة: تبديل
// الخوارزمية يغيّر كل checksum (طولًا وقيمة) فيكسر مقارنتها بقيمٍ محفوظة أو منشورة. فالرفض هنا صحيح، وسببه ليس
// الاعتماد. والمقبول خارج الاعتماد: بصمة تبقى مفتاحًا داخليًا لـMap/Set محلي (لا تغادر الملف).
test('[CRED-3] غيرُ اعتماد: md5 ⇒ sha256 لبصمة مُصدَّرة مرفوض (يغيّر الناتج) — وليس بسبب الاعتماد', () => {
  const v = gate(PLAIN, toSha256(PLAIN), 'h.js');
  assert.strictEqual(v.accepted, false, 'checksum مُصدَّر تغيّرت قيمته وقُبل');
  assert.ok(v.reason.indexOf('REJECTED_CRYPTO_FIX_UNPROVEN') === 0, v.reason);
  assert.doesNotMatch(v.reason, /تهشيرُ اعتماد/, 'نُسب الرفض للاعتماد خطأً');
});

test('[CRED-3b] غيرُ اعتماد: بصمة مفتاحٌ داخلي لـMap محلي ⇒ sha256 مقبول', () => {
  const B = ['const crypto = require("crypto");', 'const cache = new Map();', 'function memo(key, load) {',
    '  const h = crypto.createHash("md5").update(key).digest("hex");', '  if (!cache.has(h)) cache.set(h, load(key));',
    '  return cache.get(h);', '}', 'module.exports = { memo };'].join('\n');
  const v = gate(B, toSha256(B), 'h.js');
  assert.strictEqual(v.accepted, true, v.reason);
});

// ═══════════════════════════════════════════════════════════════════════
// والحارسُ في البوابة لا في المحرّك — وهذا مقيسٌ لا مُدّعى
// ═══════════════════════════════════════════════════════════════════════
// [CRED-4] كان: «محرّك الطوارئ لا يزال يُنتج التبديل، والبوابة تردّه»، ونصّ الاختبار نفسه توقّع:
// «لو امتنع المحرّك يومًا … يُعلَن ذلك». وقد امتنع عمدًا ([NO-BLIND] في emergency_fixes.js): md5 → sha256
// تبديلٌ أعمى. فالعقد الآن مُقاس على الطرفين: المحرّك لا يُنتج التبديل، والبوابة ما زالت تردّه لو أتاها
// من أي مصدر (حارسُ البوابة لم يُمسّ — نفس ناتج المحرّك القديم يُمرَّر إليها هنا مباشرة).
test('[CRED-4] محرّكُ الطوارئ لم يعد يُنتج التبديل، والبوابةُ ما زالت تردّه من أي مصدر', () => {
  ctx.__c = CRED; ctx.__f = 'h.js';
  const em = JSON.parse(vm.runInContext(
    'JSON.stringify((function(){ var r = emergencyFix(__c, __f);' +
    ' return { code: (r && r.fixed) || "", repairs: (r && r.repairs) || [] }; })())', ctx));
  assert.doesNotMatch(em.code, /createHash\("sha256"\)/, 'محرّك الطوارئ عاد يُنتج تبديل md5 → sha256');

  const v = gate(CRED, toSha256(CRED), 'h.js');
  assert.strictEqual(v.accepted, false,
    'البوابة قبلت تبديل md5 → sha256 على تهشير اعتماد');
});

test('[CRED-5] مفرداتُ «سياق الاعتماد» مُثبَّتة على المحرّك نفسه لا على نسخةٍ منها', () => {
  const codes = JSON.parse(vm.runInContext('JSON.stringify(FixVerifier.CRED_PROBLEM_CODES)', ctx));
  assert.deepStrictEqual(codes.slice().sort(),
    ['WEAK_CRYPTO_CREDENTIAL_CONTEXT', 'WEAK_CRYPTO_PASSWORD_HASH'],
    'مجموعةُ الأكواد المُثبِتة تغيّرت');

  const call = (code, line) => {
    ctx.__c = code; ctx.__i = { line, title: '', cAct: '', cwe: '' };
    return vm.runInContext('String(weakCryptoCredentialProblem(__c, __i, "js"))', ctx);
  };
  // الفرعُ المُثبِت: الدلالةُ في توقيع الدالة المحيطة
  assert.strictEqual(call(CRED, 3), 'WEAK_CRYPTO_CREDENTIAL_CONTEXT',
    'القاعدة لم تَعُد تُرجع الكود المُثبِت — الحارسُ يُعطَّل صامتًا');
  // والفرعُ غير المُثبِت: جهالةُ المصدر. ليس في المجموعة، وهذا مقصود:
  // أغلبُ المُهشَّرات وسيطُ دالة، فعدُّه إثباتًا منعٌ شامل.
  const callerCode = call(PLAIN, 3);
  assert.match(callerCode, /^WEAK_CRYPTO_INPUT_FROM_CALLER/,
    'فرعُ «وسيطٌ من المُستدعي» تغيّر: ' + callerCode);
  assert.ok(codes.indexOf(callerCode) === -1 &&
            codes.every(c => callerCode.indexOf(c) !== 0),
    'جهالةُ المصدر دخلت مجموعةَ الإثبات — الحارسُ يصير منعًا شاملًا');

  // القاعدةُ تُلتمَس من المحرّك فعلًا في هذا السياق، لا من بديلِ البوابة
  assert.strictEqual(vm.runInContext('typeof weakCryptoCredentialProblem', ctx), 'function');
});

test('[CRED-6] كلُّ سياقِ إنتاجٍ يُحمّل البوابةَ يُحمّل المحرّكَ معها', () => {
  // بديلُ البوابة عند غياب المحرّك أضيقُ من القاعدة: يفحص نصَّ البلاغ وسطرَه
  // ولا يمشي إلى توقيع الدالة المحيطة. وهو مقبولٌ بشرطٍ واحد: ألّا يكون
  // مسارَ إنتاجٍ أبدًا. فالشرطُ مُثبَّتٌ هنا بدل أن يُفترَض.
  const html = fs.readFileSync(path.join(PUBLIC_DIR, 'index.html'), 'utf8');
  const loaded = [...html.matchAll(/<script src="\/([^"]+)"/g)].map(m => m[1]);
  assert.ok(loaded.includes('fix_verifier.js'), 'index.html لا يُحمّل البوابة');
  assert.ok(loaded.includes('repair_engine.js'),
    'index.html يُحمّل البوابة بلا المحرّك — بديلُ البوابة صار مسارَ إنتاج');
  assert.ok(loaded.includes('emergency_fixes.js'),
    'emergency_fixes لم يُحمَّل — راجعْ عيّنةَ [CRED-4]');

  const adapter = fs.readFileSync(path.join(PUBLIC_DIR, 'server_repair_adapter.js'), 'utf8');
  const vmList = adapter.slice(adapter.indexOf('"acorn.min.js"'));
  assert.match(vmList, /"fix_verifier\.js"/, 'VM الخادم لا يُحمّل البوابة');
  assert.match(vmList, /"repair_engine\.js"/,
    'VM الخادم يُحمّل البوابة بلا المحرّك — بديلُ البوابة صار مسارَ إنتاج');
});
