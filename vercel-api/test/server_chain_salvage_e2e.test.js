// ═══════════════════════════════════════════════════════════════════════
// مسار الخادم كاملًا — الإصلاح ليس كلَّ شيءٍ أو لا شيء
// تشغيل:  node --test vercel-api/test/server_chain_salvage_e2e.test.js
//
// الحادثة: على ملفٍ حقيقي متعدّد العيوب كان الخادم يُصلح **صفرًا**، ويُعيد
// AI_SUGGESTION، فلا يصل العميلَ أي تغيير. وقياسُ السبب كشف أربع عِلَل
// متراكبة، كلُّها معالَجة هنا ومُثبَّتة بهذا الملف:
//
//   [1] الكلُّ-أو-لا-شيء على مستوى الرُقعة
//       repairCode يُراكم إصلاحاته في مُرشَّحٍ واحد، والبوابة تحكم حكمًا
//       واحدًا. فعنصرٌ واحد لا يُثبَت يُلغي كلَّ إصلاحات الملف.
//       المقيس: تسعُ إصلاحات، كلٌّ منها مقبولٌ منفردًا، وككتلة صفر.
//       العلاج: [STEP-SALVAGE] في repair_engine.js.
//
//   [2] والكلُّ-أو-لا-شيء على مستوى المحرك في السلسلة
//       SmartRepair يُنتج في رُقعةٍ واحدة إصلاحَ SQL صحيحًا **ومحوًا شكليًّا
//       لـeval**. فتسقط الرُقعة كلها ويُفقَد إصلاح SQL.
//       العلاج: [CHAIN-SALVAGE] في reality_orchestrator.js.
//
//   [3] بوابةٌ غائبة عن VM الخادم
//       لا fix_verifier ولا acorn في server_repair_adapter، فلا تحقّق لكل
//       خطوة أصلًا. العلاج: إضافتهما، وacorn أولًا.
//
//   [4] كاشفاتٌ أقلّ من الواجهة بثمانية عشر ملفًا
//       فما لا يُبلَّغ عنه لا يُصلَح. العلاج: [DETECTOR-PARITY].
//
// والعقد الذي يحرسه هذا الملف: **خطوةٌ فاسدة تُسقِط نفسها وحدها**، ويبقى
// كلُّ ما تُثبته البوابة. ولا يُقبل محوٌ شكلي بحجة أن معه إصلاحًا صحيحًا.
// ═══════════════════════════════════════════════════════════════════════
'use strict';

const test   = require('node:test');
const assert = require('node:assert');
const fs     = require('node:fs');
const path   = require('node:path');
const vm     = require('node:vm');

const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const { RealityOrchestrator: RO, FixVerifier: FV } =
  require(path.join(PUBLIC_DIR, 'server_engine_registration.js'));

const run = (code, file) => RO.runPipeline(code, file, { useFallbackChain: true });
const titles = list => (list || []).map(i => String(i.title || i.strategy || ''));

// عيّنة بمزيج العيوب نفسه الذي أظهر الحادثة: سرّان، حقنُ SQL باقتباسٍ داخلي،
// ‎==‎، innerHTML، http، ‎var‎ ×4، eval على مدخلِ مستخدم، وmd5 لكلمة مرور.
const MIXED = [
  '// Game Server — عيّنة اختبار',
  'const DB_PASSWORD = "super_secret_db_pass_2024";',
  'const API_SECRET = "sk_live_abc123xyz789def456ghi";',
  '',
  'var totalScore = 0;',
  '',
  'function loginPlayer(username, password) {',
  '    var query = "SELECT * FROM players WHERE username=\'" + username + "\' AND password=\'" + password + "\'";',
  '    db.execute(query);',
  '    if (username == "admin") { grantAdminAccess(); }',
  '}',
  '',
  'function render(players) {',
  '    document.getElementById("board").innerHTML = "<b>" + players[0].name + "</b>";',
  '}',
  '',
  'function buy(itemId) {',
  '    fetch("http://api.example.com/purchase", { method: "POST", body: itemId });',
  '    var cheat = document.getElementById("cheatInput").value;',
  '    eval(cheat);',
  '}',
  '',
  'const crypto = require("crypto");',
  'function hashPassword(pass) {',
  '    return crypto.createHash("md5").update(pass).digest("hex");',
  '}',
  'module.exports = { loginPlayer, render, buy, hashPassword };',
  '',
].join('\n');

// ═══ 0. شروط العزل ═════════════════════════════════════════════════════

test('[CH-0] العيّنة تُبلَّغ عنها بغنى، والسلسلة فيها أكثر من محرك', () => {
  const issues = RO.runAnalysis(MIXED, 'game.js').issues || [];
  assert.ok(issues.length >= 12, 'بلاغات العيّنة: ' + issues.length);
  for (const must of [/SQL/i, /eval/i, /md5|تشفير ضعيف/i, /innerHTML|XSS/i, /http/i]) {
    assert.ok(titles(issues).some(t => must.test(t)),
      'صنفٌ مفقود من العيّنة: ' + must + ' — ' + JSON.stringify(titles(issues)));
  }

  // بلا محركَين على الأقل لا معنى لاختبار السلسلة ولا للإنقاذ على مستواها
  const repairEngines = RO.listEngines(RO.EngineType.REPAIR).map(e => e.id);
  assert.ok(repairEngines.length >= 2, 'محركات الإصلاح المُسجَّلة: ' + JSON.stringify(repairEngines));
  assert.ok(repairEngines.includes('server-repair'), JSON.stringify(repairEngines));
});

// ═══ 1. العقد: خطوةٌ فاسدة لا تُلغي الباقي ════════════════════════════

test('[CH-1] ملفٌ متعدّد العيوب يُصلَح فعلًا — لا صفرٌ ولا AI_SUGGESTION', () => {
  const out = run(MIXED, 'game.js');
  assert.strictEqual(out.decision.decision, 'SAFE_AUTO_FIX', out.decision.reason);

  const fixed = out.phases.fallback.verifiedCode;
  assert.ok(typeof fixed === 'string' && fixed !== MIXED, 'لا كود مُتحقَّق منه');
  assert.ok((out.phases.fallback.safeRepairs || []).length >= 6,
    'إصلاحات مُتحقَّق منها: ' + (out.phases.fallback.safeRepairs || []).length);

  // والبلاغات تنقص فعلًا — لا مجرّد قرارٍ مُسجَّل
  const before = (RO.runAnalysis(MIXED, 'game.js').issues || []).length;
  const after  = (RO.runAnalysis(fixed, 'game.js').issues || []).length;
  assert.ok(after < before, `البلاغات لم تنقص: ${before} → ${after}`);
});

test('[CH-2] الإصلاحات المُثبَتة تُكتب: أسرارٌ إلى البيئة، وSQL بمعاملاتٍ مربوطة', () => {
  const fixed = run(MIXED, 'game.js').phases.fallback.verifiedCode || '';

  // الأسرار
  assert.match(fixed, /const DB_PASSWORD = process\.env\./, fixed);
  assert.doesNotMatch(fixed, /"super_secret_db_pass_2024"/, 'السرّ باقٍ في الكود');
  assert.doesNotMatch(fixed, /"sk_live_abc123xyz789def456ghi"/, 'مفتاح Stripe باقٍ');

  // حقنُ SQL: مواضعُ معامِلات غير مُقتبَسة، ومعاملاتٌ في نفس الاستدعاء
  assert.match(fixed, /username=\? AND password=\?/, fixed);
  assert.doesNotMatch(fixed, /username='\?'/, 'موضعُ معامِلٍ داخل اقتباس — نصٌّ لا معامِل');
  assert.match(fixed, /db\.execute\(query, \[username, password\]\)/, fixed);

  // والباقي: == و innerHTML و http
  assert.match(fixed, /username === "admin"/, fixed);
  assert.doesNotMatch(fixed, /\.innerHTML\s*=/, 'innerHTML باقٍ');
  assert.doesNotMatch(fixed, /"http:\/\/api\.example\.com/, 'http غير مشفّر باقٍ');
});

test('[CH-3] والمحوُ الشكلي لا يُطبَّق ولو جاء في رُقعةٍ مع إصلاحٍ صحيح', () => {
  // SmartRepair يُنتج في رُقعةٍ واحدة: إصلاحَ SQL (صحيح) و
  // ‎eval(cheat) ⇒ /* SECURITY: eval removed */‎ (محوٌ شكلي ترفضه البوابة).
  // فالمطلوب: يُكتب الأول ولا يُكتب الثاني، وeval يبقى مُبلَّغًا عنه.
  const out = run(MIXED, 'game.js');
  const fixed = out.phases.fallback.verifiedCode || '';

  assert.match(fixed, /username=\? AND password=\?/, 'إصلاحُ SQL لم يُكتب ⇒ الرُقعة سقطت كاملة');
  assert.match(fixed, /\beval\s*\(\s*cheat\s*\)/, 'eval حُذف بلا بديلٍ آمن — محوٌ شكلي طُبِّق');
  assert.doesNotMatch(fixed, /SECURITY: eval removed/, 'تعليقُ المحو كُتب في الملف');

  // وeval يبقى على طريقه إلى القرار البشري/AI، لا يُسقَط بصمت
  const left = RO.runAnalysis(fixed, 'game.js').issues || [];
  assert.ok(titles(left).some(t => /eval/i.test(t)), 'بلاغ eval زال بلا إصلاح');
  assert.ok(titles(out.phases.fallback.aiNeeded).some(t => /eval/i.test(t)),
    'eval ليس في aiNeeded: ' + JSON.stringify(titles(out.phases.fallback.aiNeeded)));
});

test('[CH-4] الإنقاذ مُسجَّل في المرحلة: أُبقي كذا وأُسقط كذا، ومعه سببُ الرُقعة', () => {
  const out = run(MIXED, 'game.js');
  const salvaged = out.phases.fallback.stages.filter(s => s.salvaged);
  assert.ok(salvaged.length >= 1,
    'لا مرحلة أُنقذت ⇒ إما لم تسقط رُقعة (فالعيّنة لا تقيس الإنقاذ) أو الإنقاذ لا يُسجّل');
  for (const s of salvaged) {
    assert.ok(s.salvaged.keptHunks >= 1, JSON.stringify(s.salvaged));
    assert.ok(s.salvaged.droppedHunks >= 1, 'أُنقذت رُقعةٌ بلا إسقاط ⇒ لم تكن ساقطة');
    assert.ok(String(s.salvaged.batchReason).length > 0, 'سببُ رفض الرُقعة غير مُسجَّل');
    assert.strictEqual(s.succeeded, true, 'أُنقذت ولم تُعتمد');
  }
});

test('[CH-4b] والتقرير لا يدّعي إصلاحًا أسقطه الإنقاذ', () => {
  // نفس عِلّة [GHOST-PRUNE]: ما لم يُطبَّق لا يُعلَن. وكان safeRepairs يحمل
  // إصلاحات المحرك **كلَّها** حتى ما أسقطه الإنقاذ (مقيس: 11 مُعلَنًا
  // و10 أسطر متغيّرة، والزائد «eval → safe alternative»).
  const out = run(MIXED, 'game.js');
  const fixed = out.phases.fallback.verifiedCode || '';
  assert.ok(out.phases.fallback.stages.some(s => s.salvaged),
    'tripwire: لا إنقاذ في هذا التشغيل ⇒ لا يقيس الادّعاء الزائد');

  const after = new Set(fixed.split('\n'));
  const beforeLines = MIXED.split('\n');
  const changed = beforeLines.filter(l => !after.has(l)).length;
  const claimed = out.phases.fallback.safeRepairs || [];

  assert.ok(claimed.length <= changed,
    `إصلاحاتٌ مُعلَنة (${claimed.length}) أكثر من الأسطر المتغيّرة (${changed})`);
  for (const r of claimed) {
    const n = Number(r.line);
    assert.ok(Number.isFinite(n) && n >= 1, 'إصلاحٌ مُعلَن بلا موضع: ' + JSON.stringify(r));
    assert.ok(!after.has(beforeLines[n - 1]),
      `مُعلَنٌ وسطرُه لم يتغيّر — س${n}: ${String(beforeLines[n - 1]).trim()}`);
  }
  // وبالتحديد: لا ادّعاءَ لإصلاح eval
  assert.ok(!claimed.some(r => /eval/i.test(String(r.strategy || r.fix || r.title || ''))),
    'التقرير يدّعي إصلاح eval وقد أُسقط: ' + JSON.stringify(claimed.map(r => r.strategy || r.fix)));
});

// ═══ 2. ولا يُعتمد شيءٌ بلا تحقّق ══════════════════════════════════════

test('[CH-5] كلُّ مرحلة ناجحة مُتحقَّقٌ منها، وكلُّ ساقطةٍ سقطت لرفضِ ضرر', () => {
  const out = run(MIXED, 'game.js');
  for (const s of out.phases.fallback.stages) {
    if (s.succeeded) {
      assert.ok(s.verifyResult && s.verifyResult.valid === true && s.verifyResult.improved === true,
        `${s.engineId}: اعتُمدت بلا تحقّق — ${JSON.stringify(s.verifyResult)}`);
    } else if (s.verifyResult && s.verifyResult.valid === false) {
      assert.ok(FV.isHarmfulRejection(s.verifyResult.reason),
        `${s.engineId}: سقوطٌ بسببٍ ليس رفضَ ضرر — ${s.verifyResult.reason}`);
    }
  }
});

test('[CH-6] الناتج النهائي يجتاز البوابة نفسها — لا كودٌ مُسلَّم بلا حكم', () => {
  const out = run(MIXED, 'game.js');
  const fixed = out.phases.fallback.verifiedCode;
  assert.ok(fixed, 'لا ناتج');
  const v = FV.verifyFix(MIXED, fixed, 'game.js',
    c => RO.runAnalysis(c, 'game.js').issues || [], { allowUnverifiedLanguages: true });
  assert.strictEqual(v.accepted, true, 'الناتج النهائي لا تقبله البوابة: ' + v.reason);
  assert.ok(FV.syntaxCheck(fixed, 'game.js').ok, 'الناتج لا يُحلَّل نحويًا');
});

// ═══ 3. تكافؤ الكاشفات بين الخادم والواجهة ════════════════════════════

test('[CH-7] قائمةُ كاشفات الخادم لا تنقص عن الواجهة', () => {
  const html = fs.readFileSync(path.join(PUBLIC_DIR, 'index.html'), 'utf8');
  const ui = [...html.matchAll(/<script src="\/([\w.\-]+\.js)"/g)].map(m => m[1]);
  const adapter = fs.readFileSync(path.join(PUBLIC_DIR, 'server_repair_adapter.js'), 'utf8');
  const srv = [...adapter.matchAll(/^\s*"([\w.\-]+\.js)",/gm)].map(m => m[1]);

  // tripwire: الاستخراج يعمل
  assert.ok(ui.length >= 40, 'سكربتات الواجهة: ' + ui.length);
  assert.ok(srv.length >= 20, 'محركات الخادم: ' + srv.length);

  const DETECTOR = /analyz|scanner|detector|taint|patterns|knowledge|deep_flow|smart_context/i;

  // طبقاتُ التعلّم ليست كاشفات، ولا تعمل في VM الخادم أصلًا: مسارُ الخادم
  // لا يحمّل learning_engine.js ولا fix_engine_pipeline.js — وهما خارج هذا
  // النمط فلم يطلبهما هذا الاختبار يومًا. و‎knowledge‎ في النمط أعلاه كُتب
  // لـknowledge_base.js؛ فتسميةُ learning_knowledge.js تصادفه لا تعنيه.
  // (لو صار الخادم يتعلّم فذاك تغييرٌ مقصود، وحارسُه اختبارٌ يقيس التعلّم.)
  const LEARNING = /^learning_/;
  const missing = ui.filter(f => DETECTOR.test(f) && !LEARNING.test(f) && !srv.includes(f));
  assert.deepStrictEqual(missing, [],
    'كاشفاتٌ في الواجهة وغائبة عن الخادم ⇒ الخادم يرى أقلَّ فيُصلح أقلّ');
});

test('[CH-8] والبوابة داخل VM الخادم فعلًا، وacorn قبلها', () => {
  const adapter = fs.readFileSync(path.join(PUBLIC_DIR, 'server_repair_adapter.js'), 'utf8');
  const srv = [...adapter.matchAll(/^\s*"([\w.\-]+\.js)",/gm)].map(m => m[1]);
  assert.ok(srv.includes('fix_verifier.js'), 'بلا بوابة في الـVM لا تحقّق لكل خطوة');
  assert.ok(srv.includes('acorn.min.js'), 'بلا acorn يصير فحصُ JS النحوي غير متوفّر');
  assert.ok(srv.indexOf('acorn.min.js') < srv.indexOf('fix_verifier.js'),
    'acorn يجب أن يُحمَّل قبل البوابة — وإلا رفضت كلَّ شيء بسياسة Fail-Closed');

  // والمحوِّل يُصدّر محركات السلسلة الثلاثة
  const { createRepairEngine } = require(path.join(PUBLIC_DIR, 'server_repair_adapter.js'));
  const eng = createRepairEngine();
  for (const fn of ['analyze', 'repair', 'repairSmart', 'repairSqlEngine']) {
    assert.strictEqual(typeof eng[fn], 'function', 'المحوِّل بلا ' + fn);
  }
});

// ═══ 3b. تكافؤ المسارين — الجذرُ الحقيقي لتكرار المشكلة ═══════════════
//
// للمحرك مسارانِ مستقلّان يُصلحان نفس الملف:
//   • الخادم  : RealityOrchestrator.runFallbackChain  (api/analyze.js)
//   • الواجهة : fixAllEnginePipeline                  (index.html)
// وكلُّ إصلاحٍ بنيوي يُطبَّق على أحدهما ولا يُطبَّق على الآخر يُنتج بالضبط
// الشكوى المتكرّرة: «يُصلَح جزءٌ ويُترك المرتبط به». والمقيس قبل توحيد
// الإنقاذ: الخادم يُصلح حقنَ SQL والواجهة لا — نفس الملف، نفس المحركات.
//
// فهذا الاختبار يقيس الأمرين معًا على نفس المُدخَل، ويلزم أن يُحسَم في
// كليهما ما يُحسَم في أحدهما. وهو الحارس الذي يمنع عودة الانقسام.
test('[CH-10] المسارانِ يُصلحان نفس الأصناف — لا مسارٌ متقدّم وآخر متأخّر', () => {
  // (أ) مسار الخادم
  const srv = run(MIXED, 'game.js');
  const srvFixed = srv.phases.fallback.verifiedCode || MIXED;

  // (ب) مسار الواجهة، بسياقٍ كسياق index.html
  const noop = () => {};
  const store = new Map();
  const ui = {
    console: { log: noop, warn: noop, error: noop, info: noop },
    setTimeout, clearTimeout, TextEncoder, TextDecoder, URL,
    document: {
      getElementById: () => ({ style: {}, textContent: '', innerHTML: '' }),
      addEventListener: noop, createElement: () => ({ style: {} }),
      querySelector: () => null, querySelectorAll: () => [],
    },
    localStorage: {
      getItem: k => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => { store.set(k, String(v)); },
      removeItem: k => { store.delete(k); },
    },
    navigator: {}, location: { search: '' },
  };
  ui.window = ui;
  vm.createContext(ui);
  const html = fs.readFileSync(path.join(PUBLIC_DIR, 'index.html'), 'utf8');
  for (const m of html.matchAll(/<script src="\/([^"]+)"/g)) {
    const p = path.join(PUBLIC_DIR, m[1]);
    if (!fs.existsSync(p)) continue;
    try { vm.runInContext(fs.readFileSync(p, 'utf8'), ui, { filename: m[1] }); } catch (_) {}
  }
  ui.toast = noop; ui.refreshStats = noop;
  assert.strictEqual(typeof ui.fixAllEnginePipeline, 'function', 'مسار الواجهة غير محمَّل');

  ui.__src = MIXED;
  vm.runInContext('F = { "game.js": __src }; R = {};' +
    ' Object.keys(F).forEach(k => { R[k] = { code: F[k], issues: analyzeCode(F[k], k) }; });', ui);
  vm.runInContext('fixAllEnginePipeline();', ui);
  const uiFixed = JSON.parse(vm.runInContext('JSON.stringify(F["game.js"])', ui));

  // tripwire: كلاهما غيّر الملف فعلًا
  assert.notStrictEqual(srvFixed, MIXED, 'مسار الخادم لم يُصلح شيئًا');
  assert.notStrictEqual(uiFixed, MIXED, 'مسار الواجهة لم يُصلح شيئًا');

  // الأصناف التي يجب أن يحسمها **كلا** المسارين
  const CLASSES = {
    'حقن SQL بمعاملات مربوطة': /username=\? AND password=\?/,
    'السرّ إلى البيئة':         /process\.env\./,
    'المقارنة الصارمة':         /username === "admin"/,
    'https بدل http':           /"https:\/\/api\.example\.com/,
  };
  for (const [label, rx] of Object.entries(CLASSES)) {
    assert.match(srvFixed, rx, 'الخادم لم يحسم: ' + label);
    assert.match(uiFixed, rx, 'الواجهة لم تحسم: ' + label + ' — المسارانِ انقسما مرّةً أخرى');
  }

  // وما يُرفَض يُرفَض في كليهما: محوُ eval الشكلي لا يُطبَّق في أيٍّ منهما
  for (const [label, code] of [['الخادم', srvFixed], ['الواجهة', uiFixed]]) {
    assert.match(code, /\beval\s*\(\s*cheat\s*\)/, label + ': eval حُذف بلا بديلٍ آمن');
    assert.doesNotMatch(code, /SECURITY: eval removed/, label + ': تعليقُ المحو كُتب');
    assert.match(code, /createHash\("md5"\)/, label + ': md5 بُدِّل تلقائيًّا على اعتماد');
  }
});

// ═══ 4. حدٌّ مُعلَن ═════════════════════════════════════════════════════

test('[CH-9] documented: ما يبقى بعد الإصلاح قرارٌ بشري لا عجزٌ صامت', () => {
  // md5 لكلمة مرور لا يُبدَّل بـsha256 تلقائيًّا: تبديلُ خوارزمية تهشير
  // اعتمادٍ مُخزَّن يُبطل كلَّ كلمات المرور القائمة — قرارُ ترحيلٍ لا إصلاحُ
  // كود. وeval على مدخلِ مستخدم يحتاج معرفةَ ما يُنتظَر من ذلك المدخل.
  // وCallback Hell إعادةُ هيكلة. فالثلاثة في aiNeeded بحقّ، لا بإسقاط.
  const out = run(MIXED, 'game.js');
  const ai = titles(out.phases.fallback.aiNeeded);
  for (const must of [/md5|تشفير ضعيف|CWE-327/i, /eval/i]) {
    assert.ok(ai.some(t => must.test(t)), 'غائبٌ عن aiNeeded: ' + must + ' — ' + JSON.stringify(ai));
  }
  // ولا إصلاحَ مزيَّف: لا sha256 حُقن مكان md5
  const fixed = out.phases.fallback.verifiedCode || '';
  assert.doesNotMatch(fixed, /sha256|SHA-256/, 'md5 بُدِّل تلقائيًّا — إصلاحٌ مزيَّف لتهشير اعتماد');
  assert.match(fixed, /createHash\("md5"\)/, 'سطرُ md5 تغيّر بلا إصلاحٍ مُثبَت');
});
