// ═══════════════════════════════════════════════════════
// [LOG-REDACT] تنقيحُ أسرارِ اللوج — المسارُ من الكشف إلى القبول
// ═══════════════════════════════════════════════════════
//
// عيبان مقيسان، كلٌّ يكفي وحده لإسقاط الإصلاح:
//
// ① حدُّ الوسائط في ‎fixLogSecret‎.
//    النمطُ الخارجي يبتلع قوسَي النداء، فلا يبقى في ‎args‎ ما تستند إليه
//    النظرةُ الخلفية على الوسيطة الأولى ولا الأمامية على الأخيرة. فلم
//    تُنقَّح إلا وسيطةٌ **وسطى** — والقيمةُ الحساسة أولى أو أخيرة في
//    الاستعمال الواقعي. وكان يقتصر على معرِّفٍ مجرّد فيفوته ‎user.token‎
//    و‎"tok: " + token‎. المقيس: صفرٌ من سبعة أشكالٍ يُصلَح، وسبعةُ كاشفاتٍ
//    تُبلّغ عن السطر فيُنادى المُصلِحُ خمسَ مرات ويُرجع ‎null‎ في كلِّها.
//
// ② إشارةُ الكاشف لا تزول بالإصلاح.
//    أربعةُ كاشفاتٍ تُطابق الكلمةَ الحسّاسة في **سطرِ** النداء كلِّه، فتجدها
//    داخلَ نصِّ الرسالة — وهو عنوانُ السرِّ لا السرُّ، ولا يملك التنقيحُ
//    حذفه. فالعددُ لا ينقص، والبوابةُ تحكم ‎REJECTED_NO_IMPROVEMENT‎، ثم
//    تُلغي Ghost الدفعةَ كاملةً. المقيس: الكلمةُ خارجَ الرسالة ⇒ يُقبل 3
//    من 3؛ وداخلَها ⇒ يُحجب 3 من 3.
//
// ويُحرَس هنا الإصلاحُ **فعلًا** لا اختفاءُ البلاغ: يُتحقَّق أن المعرِّفَ
// الحسّاس لم يبق وسيطةً للّوج، وأن الناتج يُحلَّل نحويًّا، وأن البوابة قبلت.
'use strict';

const test   = require('node:test');
const assert = require('node:assert');
const fs     = require('node:fs');
const path   = require('node:path');
const vm     = require('node:vm');

const PUBLIC_DIR = path.join(__dirname, '..', 'public');

function loadCtx() {
  const noop = () => {};
  const store = new Map();
  const ctx = {
    console: { log: noop, warn: noop, error: noop, info: noop },
    setTimeout, clearTimeout, TextEncoder, TextDecoder, URL,
    document: { getElementById: () => ({ style: {} }), addEventListener: noop,
                createElement: () => ({ style: {} }), querySelector: () => null, querySelectorAll: () => [] },
    localStorage: { getItem: k => (store.has(k) ? store.get(k) : null),
                    setItem: (k, v) => store.set(k, String(v)), removeItem: k => store.delete(k) },
    navigator: {}, location: { search: '' },
  };
  ctx.window = ctx;
  vm.createContext(ctx);
  const html = fs.readFileSync(path.join(PUBLIC_DIR, 'index.html'), 'utf8');
  for (const m of html.matchAll(/<script src="\/([^"]+)"/g)) {
    const f = path.join(PUBLIC_DIR, m[1]);
    if (!fs.existsSync(f)) continue;
    try { vm.runInContext(fs.readFileSync(f, 'utf8'), ctx, { filename: m[1] }); } catch (e) { /* ملف واجهة */ }
  }
  return ctx;
}

const wrap = line =>
  'function handle(user, password, token, secret, apiKey, cfg, name, count, getToken) {\n' +
  '  ' + line + '\n}\nmodule.exports = { handle };\n';

const logLineOf = src => (src.split('\n').find(l => /console\.|print\(|logging\./.test(l)) || '').trim();

// يُشغّل المسارَ كاملًا ويُرجع ما يلزم للحكم على **نجاح** الإصلاح لا على عدد البلاغات
function repair(ctx, fileName, code) {
  const before = ctx.analyzeCode(code, fileName) || [];
  const out = ctx.repairCode(code, before.map(x => Object.assign({}, x)), fileName);
  const after = ctx.analyzeCode(out.repaired, fileName) || [];
  let gate = null;
  if (out.repaired !== code) {
    gate = ctx.FixVerifier.verifyFix(code, out.repaired, fileName, (c, f) => ctx.analyzeCode(c, f));
  }
  return { before, after, out, gate, changed: out.repaired !== code, line: logLineOf(out.repaired) };
}

// ─────────────────────────────────────────────────────────────
// ① حدُّ الوسائط: كلُّ موضعٍ للوسيطة يُنقَّح، لا الوسطى وحدها
// ─────────────────────────────────────────────────────────────
const SHAPES = [
  ['الوسيطةُ الأخيرة',       'console.log("User:", password);',              'password'],
  ['الوسيطةُ الوحيدة',       'console.log(token);',                          'token'],
  ['الوسيطةُ الأولى',        'console.log(secret, "tail");',                 'secret'],
  ['الوسيطةُ الوسطى',        'console.log("a", apiKey, "b");',               'apiKey'],
  ['عضوُ كائن',              'console.log(user.token);',                     'user.token'],
  ['ضمٌّ نصّيٌّ ومعرِّف',      'console.log("tok: " + token);',                 'token'],
  ['ضمٌّ وعضوُ كائن',         'console.log("user token: " + user.token);',     'user.token'],
  ['سلسلةٌ عميقة',           'console.log(cfg.auth.secretKey);',             'cfg.auth.secretKey'],
];

for (const [name, line, leaked] of SHAPES) {
  test('[RC-1] يُنقَّح ويُقبل — ' + name, () => {
    const ctx = loadCtx();
    const code = wrap(line);
    const r = repair(ctx, 'leak.js', code);

    assert.ok(r.before.length > 0, 'tripwire: لم يُكشَف شيءٌ على السطر');
    assert.ok(r.changed, 'لم يُنتَج تعديلٌ إطلاقًا — ' + line);

    // (أ) الإصلاحُ وقع فعلًا: المعرِّفُ الحسّاس لم يبق وسيطةً للّوج
    assert.ok(r.line.includes('[REDACTED]'), 'لا عَلَمَ تنقيحٍ في السطر: ' + r.line);
    assert.ok(!r.line.includes(leaked),
      'المعرِّفُ الحسّاس ما زال يُسجَّل: ' + r.line);

    // (ب) الناتجُ سليمٌ نحويًّا — لا نكتفي بزوال البلاغ
    assert.doesNotThrow(() => new vm.Script(r.out.repaired.replace(/module\.exports.*/, '')),
      'الناتجُ مكسورٌ نحويًّا: ' + r.line);

    // (ج) والبوابةُ قبلته — وهذا ما كان يسقط في ②
    assert.ok(r.gate && r.gate.accepted === true,
      'البوابةُ رفضت تنقيحًا صحيحًا: ' + String(r.gate && r.gate.reason));

    // (د) وسُجِّل إصلاحًا، فلا تُلغيه Ghost
    assert.ok((r.out.repairs || []).some(x => x.strategy === 'LOG_SECRET'),
      'لم يُسجَّل إصلاحُ LOG_SECRET — أُلغيت الدفعة؟ rejected=' +
      JSON.stringify((r.out.rejected || []).map(x => String(x.reason).slice(0, 60))));
  });
}

test('[RC-2] والنصُّ الحرفيُّ لا يُمَسّ — الكلمةُ داخله عنوانٌ لا سرّ', () => {
  const ctx = loadCtx();
  const r = repair(ctx, 'leak2.js', wrap('console.log("user token: " + user.token);'));
  assert.ok(r.changed, 'لم يُنتَج تعديل');
  assert.ok(r.line.includes('"user token: "'),
    'نصُّ الرسالة تغيّر — التنقيحُ يمسّ ما ليس له: ' + r.line);
  assert.ok(!r.line.includes('user.token'), 'القيمةُ لم تُنقَّح: ' + r.line);
});

// ─────────────────────────────────────────────────────────────
// ② ما لا يُمَسّ: أسماءٌ سليمة، وقيمٌ غيرُ حسّاسة، ونداءاتُ دوالّ
// ─────────────────────────────────────────────────────────────
const BENIGN = [
  ['اسمٌ سليم',               'console.log("hello", name);'],
  ['عدّادٌ سليم',             'console.log(count);'],
  ['نصٌّ فيه الكلمة',          'console.log("set your api key in .env");'],
  ['نداءُ دالّة لا قيمة',      'console.log(getToken());'],
];
for (const [name, line] of BENIGN) {
  test('[RC-3] لا يُمَسّ — ' + name, () => {
    const ctx = loadCtx();
    const code = wrap(line);
    const r = repair(ctx, 'ok.js', code);
    assert.ok(!r.line.includes('[REDACTED]'),
      'شفرةٌ سليمةٌ نُقِّحت بالخطأ: ' + r.line);
  });
}

test('[RC-4] العدّادُ عن السرِّ ليس السرَّ — ‎passwordCount‎ لا يُنقَّح', () => {
  // ‎repair_strategy_routing‎ يحرس هذا من جهة التوجيه؛ وهنا من جهة التنقيح:
  // آخرُ كلمةٍ في الاسم هي الفاصل، لا مجرّدُ ورودِ الكلمة فيه.
  const ctx = loadCtx();
  assert.strictEqual(typeof ctx._isSensitiveLogName, 'function',
    'tripwire: مُسنِدُ الحساسية غيرُ منشور');

  for (const n of ['password', 'userPassword', 'dbPassword', 'authToken', 'api_key',
                   'apiKey', 'cfg.secretKey', 'user.token', 'credential', 'JWT_SECRET'])
    assert.strictEqual(ctx._isSensitiveLogName(n), true, 'فات اسمٌ حسّاس: ' + n);

  for (const n of ['passwordCount', 'tokenCount', 'keyLength', 'secretsFound',
                   'monkey', 'keyboard', 'keyword', 'tokenizer', 'passwordless',
                   'turkey', 'secretary', 'name', 'count', 'userId'])
    assert.strictEqual(ctx._isSensitiveLogName(n), false, 'اسمٌ سليمٌ عُدَّ حسّاسًا: ' + n);
});

// ─────────────────────────────────────────────────────────────
// ③ حارسُ المحلّل: المُنقَّحُ لا يُبلَّغ عنه، وما عداه يبقى
// ─────────────────────────────────────────────────────────────
const LEAK_RX = /DATA_EXPOSURE|CWE_312|CWE_532|تسجيل بيانات حساسة/;
const leakCount = (ctx, line) =>
  (ctx.analyzeCode(wrap(line), 'g.js') || [])
    .filter(i => LEAK_RX.test(String(i.type || '') + String(i.title || ''))).length;

test('[RC-5] سطرٌ نُقِّح ولا يُسجّل شيئًا ديناميًّا ⇒ لا بلاغَ تسريب', () => {
  const ctx = loadCtx();
  assert.ok(leakCount(ctx, 'console.log("password:", password);') > 0,
    'tripwire: التسريبُ الأصلي غيرُ مُبلَّغٍ عنه');
  assert.strictEqual(leakCount(ctx, 'console.log("password:", "[REDACTED]");'), 0,
    'سطرٌ لا يُسجّل إلا نصوصًا حرفية ما زال يُبلَّغ عنه تسريبًا');
  assert.strictEqual(leakCount(ctx, 'console.log("user token: " + "[REDACTED]");'), 0,
    'الضمُّ المُنقَّح ما زال يُبلَّغ عنه');
});

test('[RC-6] ولا يُضعَف الاكتشاف: كلُّ ما يُسجّل قيمةً ديناميّةً يبقى مُبلَّغًا عنه', () => {
  const ctx = loadCtx();
  // عَلَمُ التنقيح موجودٌ لكن تبقى قيمةٌ ديناميّة ⇒ التسريبُ قائم
  assert.ok(leakCount(ctx, 'console.log("[REDACTED]", token);') > 0,
    'وسيطةٌ ديناميّةٌ حسّاسة كُتمت لمجرّد وجود العَلَم');
  // والعنوانُ وحده دليلٌ كافٍ متى كانت القيمةُ ديناميّة
  assert.ok(leakCount(ctx, 'console.log("password:", user);') > 0,
    'عنوانٌ حسّاسٌ مع قيمةٍ ديناميّة كُتم — إضعافُ اكتشاف');
  // وسرٌّ حرفيٌّ داخل الرسالة بلا عَلَمِ تنقيحٍ يبقى: لا كاشفَ آخر يُغطّيه (مقيس)
  assert.ok(leakCount(ctx, 'console.log("your password is hunter2hunter2");') > 0,
    'سرٌّ حرفيٌّ في الرسالة كُتم بلا أن يكون نُقِّح');
});

test('[RC-7] الحارسُ لا يكتم إلا بلاغاتِ التسريب', () => {
  // ‎console.log‎ في شفرةِ الإنتاج بلاغٌ مستقلٌّ عن التسريب، فلا يُكتَم معه.
  const ctx = loadCtx();
  const iss = ctx.analyzeCode(wrap('console.log("password:", "[REDACTED]");'), 'h.js') || [];
  assert.ok(iss.some(i => /console\.log/.test(String(i.title || ''))),
    'بلاغُ ‎console.log‎ العام كُتم مع بلاغات التسريب');
});
