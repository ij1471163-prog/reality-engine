// ═══════════════════════════════════════════════════════
// typo_detector: أخطاءُ التبديل تُدرَك، والأسماءُ المشروعةُ تُترَك
// تشغيل:  node --test vercel-api/test/typo_detector_strength.test.js
//
// المحرّكُ يبحث عن أسماءٍ قريبةٍ من APIs خطرة — «خطأٌ مطبعيٌّ يمنع تنفيذَ
// صلاحيةٍ حسّاسة». فكرةٌ لا يفعلها محرّكٌ آخر، وكان بلا اختبارٍ واحد.
// وقياسُ حالتِه قبل التقوية:
//
//     أخطاءُ التبديل      : 2 من 10 تُدرَك
//     النداءُ المنقوط     : 1 من 4
//     إيجابيات كاذبة      : 7 من 40 ملفًا حقيقيًّا (18٪)
//     الأداء              : 153 ms/ملف
//
// وأسبابُها أربعة، كلٌّ منها مقيسٌ ومُعالَجٌ في موضعِه:
//   [DAMERAU]    التبديلُ كان خطوتين فتسقطه عتبةُ 1
//   [NO-ESCAPE]  ‎\bexecFile‎ في حرفيّةِ regex يُقرأ رمزًا ‎bexecFile‎
//   [SEGMENT]    ‎os.system‎ منزوعَ النقطة يجعل ‎system‎ على بُعدِ 2 منه
//   [NAMESPACE]  والمقاطعُ وحدَها تجعل ‎Promise.all‎ خطأً لـ‎subprocess.call‎
//   [THRESHOLD-1] عتبةُ 2 كانت تعويضًا عن عجزِ Levenshtein، فزال سببُها
//
// ولا يُربَط هذا المحرّكُ بمسارِ الخادمِ في هذه المرحلة — تقويةٌ واختبارٌ
// في عزلة أوّلًا.
// ═══════════════════════════════════════════════════════
'use strict';
const test = require('node:test'), assert = require('node:assert');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const PUBLIC_DIR = path.join(__dirname, '..', 'public');

function load() {
  const ctx = vm.createContext({ console: { log(){}, warn(){}, error(){}, info(){} } });
  vm.runInContext(fs.readFileSync(path.join(PUBLIC_DIR, 'typo_detector.js'), 'utf8'),
                  ctx, { filename: 'typo_detector.js' });
  return ctx;
}
const ctx = load();
const D = (code) => ctx.detectDangerousTypos(code) || [];
const call = (name) => `function f(x) { return ${name}(x); }`;

// الحالاتُ العشرُ الأصليّةُ المقيسة قبل التقوية
const ORIGINAL = [
  ['spwan', 'spawn'], ['exce', 'exec'], ['eavl', 'eval'], ['unlnik', 'unlink'],
  ['ruqire', 'require'], ['suprocess', 'subprocess'], ['urloepn', 'urlopen'],
  ['fecth', 'fetch'], ['axois', 'axios'], ['Popne', 'Popen'],
];

test('[TD-1] تسعٌ من الحالاتِ العشرِ الأصليّة تُدرَك', () => {
  const missed = [];
  for (const [typo] of ORIGINAL) {
    if (!D(call(typo)).length) missed.push(typo);
  }
  assert.deepStrictEqual(missed, ['ruqire'],
    'تغيّرت الحالةُ المقيسة — المفقود: ' + JSON.stringify(missed));
});

test('[TD-2] و‎ruqire‎ مفقودةٌ لسببٍ مُسمًّى: ‎require‎ ليست في قائمةِ الـAPIs', () => {
  // ليست فجوةَ خوارزمية: بُعدُ ‎ruqire‎ عن ‎require‎ هو 2، لكنّ ‎require‎
  // أصلًا غيرُ مُدرَجةٍ في ‎DANGEROUS_APIS‎ فلا مرجعَ تُقارَن به. وإدراجُها
  // قرارٌ عن نطاقِ المحرّك لا عن دقّتِه، ويُتخذ على حِدة.
  const apis = vm.runInContext('DANGEROUS_APIS', ctx);
  assert.ok(Array.isArray(apis) && apis.length > 0, 'القائمةُ غيرُ متاحة');
  assert.ok(!apis.some(a => String(a).replace(/\($/, '') === 'require'),
    'أُدرجت require — راجع [TD-1]، فالحالةُ العاشرةُ صارت قابلةً للإدراك');
});

test('[TD-3] والنداءُ المنقوط يُدرَك — كان يفوت كلُّه إلا واحدًا', () => {
  const CASES = ['cp.exce("ls")', 'child_process.exce(x)', 'os.systme("ls")', 'fs.unlnik(p)'];
  for (const c of CASES) {
    assert.ok(D(c).length >= 1, 'فات النداءُ المنقوط: ' + c);
  }
});

test('[TD-4] ولا إيجابيةَ كاذبةً على الملفّاتِ السبعةِ التي أنتجتها', () => {
  // هذه بالضبط الملفّاتُ التي قِيست قبل التقوية: 7 من 40 أنتجت بلاغًا كاذبًا.
  const WERE_FALSE = ['c_cpp_analyzer.js', 'command_injection_fix.js', 'extended_patterns.js',
                      'fallback_fixes.js', 'fix_verifier.js', 'knowledge_base.js',
                      'claude_engine.test.js'];
  const still = [];
  for (const f of WERE_FALSE) {
    const p = f.endsWith('.test.js') ? path.join(__dirname, f) : path.join(PUBLIC_DIR, f);
    if (!fs.existsSync(p)) continue;
    const out = D(fs.readFileSync(p, 'utf8'));
    if (out.length) still.push(f + ': ' + out.map(o => o.token + '→' + o.similar_to).join(', '));
  }
  assert.deepStrictEqual(still, [], 'عادت إيجابياتٌ كاذبة');
});

test('[TD-5] ولا إيجابيةَ كاذبةً على مصادرِ المشروعِ كلِّها', () => {
  // المقياسُ العامّ: 40 ملفًا حقيقيًّا. كان 7، والمعيارُ المتّفقُ عليه ≤2.
  const files = fs.readdirSync(PUBLIC_DIR)
    .filter(f => f.endsWith('.js') && !f.endsWith('.min.js')).slice(0, 40);
  const hits = [];
  for (const f of files) {
    let out = [];
    try { out = D(fs.readFileSync(path.join(PUBLIC_DIR, f), 'utf8')); } catch (e) { continue; }
    if (out.length) hits.push(f + ': ' + out.map(o => o.token + '→' + o.similar_to).join(', '));
  }
  assert.ok(hits.length <= 2, 'إيجابيات كاذبة ' + hits.length + '/40:\n  ' + hits.join('\n  '));
});

test('[TD-6] ومجموعةٌ محجوزةٌ لم تُستعمل في ضبطِ القواعد: عشرةٌ تُدرَك', () => {
  // قِيست مرّةً واحدةً بعد اكتمالِ التعديل، ولم يُضبَط شيءٌ عليها.
  const HELD_OUT = ['exeFile', 'spawnSycn', 'unlikSync', 'creatCipher', 'setIntervall',
                    'appenFile', 'XMLHttpRequets', 'WebScoket', 'rmidr', 'exceSync'];
  const missed = HELD_OUT.filter(t => !D(call(t)).length);
  assert.deepStrictEqual(missed, [], 'فاتت أخطاءٌ محجوزة');
});

test('[TD-7] والأسماءُ المشروعةُ المشابهةُ تُترَك — محجوزةٌ أيضًا', () => {
  const LEGIT = ['openStream', 'systemd', 'evaluate', 'spawner', 'fetcher', 'axiosInstance',
                 'closeFile', 'renderFile', 'execution', 'requester', 'socketIo', 'compiler'];
  const noisy = LEGIT.filter(n => D(`const ${n} = 1; function g(){ return ${n}(); }`).length);
  assert.deepStrictEqual(noisy, [], 'أسماءٌ مشروعةٌ بُلِّغ عنها');
});

test('[TD-8] والأسماءُ المعرَّفةُ في الملفِّ نفسِه ليست أخطاءً مطبعيّة', () => {
  // ‎compare‎ و‎verifyFn‎ كلمتان مقصودتان على بُعدٍ قصيرٍ من APIs خطرة.
  assert.strictEqual(D('function compare(a, b) { return compare(a, b); }').length, 0);
  assert.strictEqual(D('function run(verifyFn) { return verifyFn(1); }').length, 0);
  // وغيرُ المعرَّفِ يبقى مكشوفًا
  assert.ok(D('function f(x) { return spwan(x); }').length >= 1, 'ضاع الكشفُ عن غيرِ المعرَّف');
});

test('[TD-9] ونصوصُ الـregex لا تُقرأ رموزًا', () => {
  // ‎\bexecFile‎ كان يُنتج الرمزَ ‎bexecFile‎ فيُبلَّغ خطأً مطبعيًّا.
  const SRC = 'const RX = /\\bexecFile\\s*\\(/;\nconst RY = /\\bspawn\\s*\\(/;\n' +
              'function f(code) { return RX.test(code) || RY.test(code); }\n';
  assert.deepStrictEqual(Array.from(D(SRC).map(o => o.token)), []);
});

test('[TD-10] والأخطاءُ المعروفةُ مسبقًا ما زالت تُدرَك', () => {
  // ‎KNOWN_TYPOS‎ مسارٌ مستقلٌّ عن المسافة — يجب ألّا يتأثّر.
  for (const t of ['urloepn', 'subprocss', 'unlinkSyncc']) {
    assert.ok(D(call(t)).length >= 1, 'ضاع خطأٌ معروف: ' + t);
  }
});

test('[TD-12] ولا يُنتج هذا المحرّكُ إصلاحًا قابلًا للتطبيق — فلا شيءَ يتجاوزُ البوابة', () => {
  // كاشفٌ محض: مخرجُه ‎{token, similar_to, distance, severity, message, impact}‎
  // بلا ‎fix‎ ولا ‎conf‎، وواجهتُه تقول صراحةً «لن يُصلح هذه الأخطاء تلقائيًّا».
  // وهذا الاختبار يُثبّت ذلك قبل أيِّ ربطٍ بمسارِ الخادم: إنْ أُضيف ‎fix‎ يومًا
  // صار المحرّكُ مصدرَ رقعةٍ يجب أن تمرَّ على fix_verifier، وهذا قرارٌ يُتخذ
  // عمدًا لا بالسهو.
  const out = D('function f(x) { return spwan(x); } function g(y){ return eavl(y); }');
  assert.ok(out.length >= 2, 'لم يُنتج بلاغاتٍ أصلًا — الاختبارُ بلا معنى');
  for (const o of out) {
    assert.ok(!('fix' in o), 'ظهر حقلُ fix: ' + JSON.stringify(o));
    assert.ok(!('patch' in o) && !('fixed' in o) && !('replacement' in o),
      'ظهرت رقعةٌ قابلةٌ للتطبيق: ' + JSON.stringify(o));
  }
});

test('[TD-11] والأداءُ على ملفٍّ كبيرٍ ضمن حدٍّ معقول', () => {
  const big = path.join(PUBLIC_DIR, 'repair_engine.js');   // ~2700 سطر
  if (!fs.existsSync(big)) { assert.ok(true, 'الملفُّ غيرُ موجود'); return; }
  const code = fs.readFileSync(big, 'utf8');
  const t0 = process.hrtime.bigint();
  D(code);
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  // القياسُ قبل التقوية على معدّلِ الأربعين: 153 ms/ملف. والحدُّ هنا واسعٌ
  // عمدًا كي لا يتذبذب على آلةٍ بطيئة؛ الرقمُ الفعليُّ يُطبَع للمتابعة.
  assert.ok(ms < 2000, 'زمنٌ غيرُ مقبول: ' + ms.toFixed(0) + 'ms');
  console.log('        [TD-11] ' + code.split('\n').length + ' سطر في ' + ms.toFixed(0) + 'ms');
});
