// ═══════════════════════════════════════════════════════
// تراكم بعنوان Data Flow (deep_analyzer.js) على مسار الخادم
// تشغيل:  node --test vercel-api/test/repair_accumulation_dataflow.test.js
//
// السبب المقيس: مسار الخادم (api/analyze.js) لا يحمّل ast-engine.js — هو في الواجهة فقط —
// فالإشارة الوحيدة لـ«totalScore = p.score داخل حلقة» هناك عنوانُ deep_analyzer:
//   "🟠 Data Flow: totalScore = p.score داخل loop — يجب +="
// وfixAccumulation لا يستخرج اسم المتغير إلا من صيغة "X = بدل +=" ⇒ يُرجع null ⇒ يُسقط بصمت.
//
// العلاج مقصور على هذه الصيغة، وبشروط أشد من مسار AST لأن كاشف Data Flow أضعف دليلًا
// (يكتفي بنوع number وبكلمة for في آخر 8 أسطر):
//   0. اسم يدل بوضوح على التجميع (total/sum/accumulator…) بلا كلمة لحظية (last/current/latest…)
//   1. المتغير مُهيَّأ بـ0 قبل السطر (نفس معيار ast-engine.js: «مُهيَّأ بـ0»)
//   2. الإسناد داخل جسم حلقة فعلًا (بنية الأقواس/الإزاحة، لا قرب كلمة for)
//   3. لا يُقرأ المتغير في أي موضع آخر داخل الحلقة (لو قُرئ فهو غالبًا قيمة مؤقتة لكل دورة)
// وما لا يستوفي الشروط يبقى بلا تعديل، ويُسجَّل سببه في rejected، ويبقى في remainingIssues.
// ═══════════════════════════════════════════════════════
'use strict';

const test   = require('node:test');
const assert = require('node:assert');
const fs     = require('node:fs');
const path   = require('node:path');
const vm     = require('node:vm');

const ROOT = path.join(__dirname, '..');
const PUBLIC_DIR = path.join(ROOT, 'public');
const acorn = require('../public/acorn.min.js');

// سياق مطابق لـapi/analyze.js: القائمة نفسها تُقرأ من الملف (مصدر واحد للحقيقة)
function serverEngineList() {
  const src = fs.readFileSync(path.join(ROOT, 'api', 'analyze.js'), 'utf8');
  const m = src.match(/const\s+engines\s*=\s*\[([\s\S]*?)\]/);
  assert.ok(m, 'تعذّر استخراج قائمة engines من api/analyze.js');
  return m[1].replace(/\/\/[^\n]*/g, '').split(',')
    .map(s => s.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean);
}
function serverContext() {
  const noop = () => {};
  const ctx = vm.createContext({ console: { log: noop, warn: noop, error: noop, info: noop },
                                 window: {}, global: {}, F: {}, R: {} });
  for (const f of serverEngineList()) {
    const p = path.join(PUBLIC_DIR, f);
    if (!fs.existsSync(p)) continue;
    try { vm.runInContext(fs.readFileSync(p, 'utf8'), ctx, { filename: f }); } catch (_) { /* كما يفعل الخادم */ }
  }
  return ctx;
}
const ctx = serverContext();
const DF = v => `🟠 Data Flow: ${v} = p.score داخل loop — يجب +=`;
const lineOf = (code, n) => code.split('\n')[n - 1];
const parses = code => { acorn.parse(code, { ecmaVersion: 'latest', sourceType: 'script', allowReturnOutsideFunction: true }); return true; };
const analyze = (code, file) => { ctx.__c = code; ctx.__f = file || 'a.js'; return vm.runInContext('analyzeCode(__c, __f)', ctx); };
const accIssues = (code, file) => analyze(code, file).filter(i => ctx.detectStrategy(i, (file || 'a.js').split('.').pop()) === 'ACCUMULATION');
const repair = (code, issues, file) => ctx.repairCode(code, issues, file || 'a.js');

// ═══ 0. الشرط المسبق: هذا هو المسار الذي كان يُسقط بصمت ═══════════
test('[DF-0] على مسار الخادم: الإشارة الوحيدة للتراكم هي عنوان Data Flow (لا عنوان "= بدل +=")', () => {
  assert.ok(!serverEngineList().includes('ast-engine.js'), 'لو أُضيف ast-engine.js للخادم تغيّر سبب هذا الاختبار');
  const code = 'var totalScore = 0;\nfunction f(players) {\n    for (let p of players) {\n        totalScore = p.score;\n    }\n}\n';
  const acc = accIssues(code);
  assert.ok(acc.length >= 1, 'المحلل يبلّغ');
  assert.ok(acc.every(i => /Data Flow:/.test(i.title)), acc.map(i => i.title).join(' | '));
});

// ═══ 1. الحالات التي تُصلَح ═══════════════════════════════════════
test('[DF-1] GameServer: totalScore = p.score داخل for..of ⇒ totalScore += p.score', () => {
  const code = 'var totalScore = 0;\n\nfunction updateLeaderboard(players) {\n    for (let p of players) {\n        totalScore = p.score;\n    }\n}\n';
  const r = repair(code, accIssues(code));
  assert.strictEqual(lineOf(r.repaired, 5), '        totalScore += p.score;');
  assert.ok(parses(r.repaired));
  assert.strictEqual(r.repairs.filter(x => x.strategy === 'ACCUMULATION').length, 1);
});

test('[DF-2] forEach بسهم وكتلة على عدة أسطر', () => {
  const code = 'let sum = 0;\nitems.forEach(it => {\n  sum = it.price;\n});\n';
  const r = repair(code, [{ line: 3, sev: 'h', type: 'dataflow', title: '🟠 Data Flow: sum = it.price داخل loop — يجب +=', ev: 'sum = it.price;' }]);
  assert.strictEqual(lineOf(r.repaired, 3), '  sum += it.price;');
});

test('[DF-3] داخل if داخل الحلقة (الكتلة غير الحلقية تُتخطّى صعودًا)', () => {
  const code = 'let total = 0;\nfor (const p of ps) {\n  if (p.ok) {\n    total = p.score;\n  }\n}\n';
  const r = repair(code, [{ line: 4, sev: 'h', type: 'dataflow', title: DF('total'), ev: 'total = p.score;' }]);
  assert.strictEqual(lineOf(r.repaired, 4), '    total += p.score;');
});

test('[DF-4] Python: for بالإزاحة', () => {
  const code = 'total = 0\nfor p in ps:\n    total = p.score\nprint(total)\n';
  const r = repair(code, [{ line: 3, sev: 'h', type: 'dataflow', title: DF('total'), ev: 'total = p.score' }], 'a.py');
  assert.strictEqual(lineOf(r.repaired, 3), '    total += p.score');
});

// ═══ 2. ما لا يجب تعديله (الجمع ليس مثبتًا) ══════════════════════
const KEEP = {
  'غير مُهيَّأ بـ0 (اسم تجميعي لكن البداية 5)':
    ['let total = 5;\nfor (const p of ps) {\n  total = p.score;\n}\n', 3, 'total', 'ACCUMULATION_NOT_ZERO_INIT'],
  'بلا تهيئة إطلاقًا':
    ['let total;\nfor (const p of ps) {\n  total = p.score;\n}\n', 3, 'total', 'ACCUMULATION_NOT_ZERO_INIT'],
  'قيمة تُقرأ بعد الإسناد في نفس الدورة (sum > best)':
    ['let sum = 0, best = 0;\nfor (const p of ps) {\n  sum = p.score;\n  if (sum > best) best = sum;\n}\n', 3, 'sum', 'ACCUMULATION_VAR_USED_IN_LOOP'],
  'يُقرأ قبل الإسناد في الحلقة':
    ['let total = 0;\nfor (const p of ps) {\n  diff(total);\n  total = p.score;\n}\n', 4, 'total', 'ACCUMULATION_VAR_USED_IN_LOOP'],
  'يُقرأ في شرط الحلقة نفسه':
    ['let total = 0;\nwhile (total < 10) {\n  total = p.score;\n}\n', 3, 'total', 'ACCUMULATION_VAR_USED_IN_LOOP'],
  'خارج الحلقة رغم وجود for قريبًا (حلقة انتهت قبله)':
    ['let total = 0;\nfor (const x of xs) {\n  f(x);\n}\ntotal = p.score;\n', 5, 'total', 'ACCUMULATION_NOT_IN_LOOP'],
  'داخل دالة رد نداء ليست حلقة (.then) داخل حلقة':
    ['let total = 0;\nfor (const x of xs) {\n  load(x).then(p => {\n    total = p.score;\n  });\n}\n', 4, 'total', 'ACCUMULATION_NOT_IN_LOOP'],
  'العنوان يسمّي متغيرًا غير موجود في السطر':
    ['let total = 0;\nfor (const p of ps) {\n  other = p.score;\n}\n', 3, 'total', null],
};
for (const [name, [code, line, v, reason]] of Object.entries(KEEP)) {
  test(`[DF-KEEP] لا يُعدَّل: ${name} — ويُسجَّل السبب`, () => {
    const r = repair(code, [{ line, sev: 'h', type: 'dataflow', title: DF(v), ev: lineOf(code, line).trim() }]);
    assert.strictEqual(r.repaired, code);
    assert.strictEqual(r.repairs.filter(x => x.strategy === 'ACCUMULATION').length, 0);
    const rej = r.rejected.filter(x => x.strategy === 'ACCUMULATION');
    assert.strictEqual(rej.length, 1, 'لا إسقاط صامت: السبب مسجَّل في rejected');
    if (reason) assert.match(rej[0].reason, new RegExp('^' + reason));
  });
}

// ═══ 2ب. شرط الاسم: البنية مكتملة (تهيئة 0، داخل حلقة، لا قراءة) والفيصل هو الاسم ═══
const shape = v => 'let ' + v + ' = 0;\nfor (const p of ps) {\n  ' + v + ' = p.score;\n}\n';
const NAME_YES = ['total', 'sum', 'accumulator', 'totalScore', 'scoreTotal', 'scoreSum', 'sumOfScores',
                  'subtotal', 'runningTotal', 'grand_total', 'TOTAL_POINTS', 'accumulated'];
for (const v of NAME_YES) {
  test(`[DF-NAME+] اسم تجميعي «${v}» ⇒ يُصلَح`, () => {
    const code = shape(v);
    const r = repair(code, [{ line: 3, sev: 'h', type: 'dataflow', title: DF(v), ev: lineOf(code, 3).trim() }]);
    assert.strictEqual(lineOf(r.repaired, 3), '  ' + v + ' += p.score;');
    assert.strictEqual(r.rejected.filter(x => x.strategy === 'ACCUMULATION').length, 0);
  });
}
const NAME_NO = [
  // كلمات لحظية صريحة
  'last', 'current', 'latest', 'cur', 'prev',
  // كلمة لحظية تُبطل total/sum
  'lastTotal', 'currentSum', 'latestTotal', 'maxTotal', 'prevSum', 'best_total',
  // أسماء بلا دلالة تجميع
  'score', 'points', 'value', 'level', 'count',
  // تشابه حروف لا كلمة: summary ليست sum ، totalitarian ليست total ، account ليست accumulator
  'summary', 'totalitarian', 'account',
];
for (const v of NAME_NO) {
  test(`[DF-NAME-] اسم ملتبس «${v}» ⇒ لا تعديل، والسبب ACCUMULATION_NAME_AMBIGUOUS`, () => {
    const code = shape(v);
    const r = repair(code, [{ line: 3, sev: 'h', type: 'dataflow', title: DF(v), ev: lineOf(code, 3).trim() }]);
    assert.strictEqual(r.repaired, code);
    const rej = r.rejected.filter(x => x.strategy === 'ACCUMULATION');
    assert.strictEqual(rej.length, 1);
    assert.match(rej[0].reason, /^ACCUMULATION_NAME_AMBIGUOUS/);
  });
}

test('[DF-KEEP] عنوان التراكم القديم ("= بدل +=") لا تمسّه الشروط الجديدة (لا تغيير سلوك)', () => {
  // بلا تهيئة بـ0 وباسم total: المسار القديم يُصلحها كما كان، ولا تُطبَّق عليه شروط Data Flow
  const ok = 'for (const p of ps) {\n  total = p.score;\n}\n';
  const r = repair(ok, [{ line: 2, sev: 'c', type: 'bug', title: 'خطأ تراكم مؤكد: total = بدل += (AST ✓)' }]);
  assert.strictEqual(lineOf(r.repaired, 2), '  total += p.score;', 'المسار القديم يبقى كما كان');
  assert.strictEqual(r.rejected.filter(x => x.strategy === 'ACCUMULATION').length, 0);
});

// ═══ 3. الدورة الكاملة على ملف GameServer (المسار الذي يستعمله /api/analyze) ═══
const GAME_SERVER = [
  '// Game Server — Multiplayer RPG Backend', '// Version 1.0.0', '',
  'const DB_PASSWORD = "super_secret_db_pass_2024";', 'const API_SECRET = "sk_live_abc123xyz789def456ghi";', '',
  'var totalScore = 0;', 'var sessionToken = "";', '',
  '// Player Authentication', 'function loginPlayer(username, password) {',
  '    var query = "SELECT * FROM players WHERE username=\'" + username + "\' AND password=\'" + password + "\'";',
  '    db.execute(query);', '    ', '    if (username == "admin") {', '        grantAdminAccess();', '    }', '}', '',
  '// Score Tracking', 'function updateLeaderboard(players) {', '    for (let p of players) {', '        totalScore = p.score;',
  '    }', '    ', '    document.getElementById("leaderboard").innerHTML = ', '        "<h2>Top Player: " + players[0].name + "</h2>";',
  '}', '', '// Item Purchase', 'function purchaseItem(itemId, userId) {', '    fetch("http://api.gamestore.com/purchase", {',
  '        method: "POST",', '        body: JSON.stringify({ item: itemId, user: userId })', '    });', '    ',
  '    var cheatCode = document.getElementById("cheatInput").value;', '    eval(cheatCode);', '}', '',
  '// Save System', 'function savePlayerData(data) {', '    saveToCloud(function(result) {', '        syncInventory(function(inv) {',
  '            updateAchievements(function(ach) {', '                notifyFriends(function(friends) {',
  '                    refreshUI(result, inv, ach, friends);', '                });', '            });', '        });', '    });', '}', '',
  '// Crypto — weak hash', "const crypto = require('crypto');", 'function hashPassword(pass) {',
  "    return crypto.createHash('md5').update(pass).digest('hex');", '}',
].join('\n');

test('[DF-E2E] GameServer عبر RealityOrchestrator: التراكم يُصلَح، وeval وMD5 لا يُمسّان', async () => {
  const { RealityOrchestrator: R } = require('../public/server_engine_registration.js');
  assert.strictEqual(lineOf(GAME_SERVER, 23), '        totalScore = p.score;', 'fixture');
  const out = await R.runPipelineAsync(GAME_SERVER, 'GameServer.js', { useFallbackChain: true });
  const d = out.decision;
  assert.strictEqual(d.decision, R.Decision.SAFE_AUTO_FIX);
  const lines = d.patch.split('\n');
  assert.strictEqual(lines[22], '        totalScore += p.score;');
  assert.ok(lines.includes('    eval(cheatCode);'), 'بوابة eval كما هي');
  assert.ok(lines.includes("    return crypto.createHash('md5').update(pass).digest('hex');"), 'بوابة MD5 كما هي');
  const rem = out.phases.fallback.remainingIssues || [];
  assert.ok(!rem.some(i => i.strategy === 'ACCUMULATION' && i.line === 23), 'التراكم لم يعد ضمن المتبقّي');
  assert.ok(rem.some(i => /eval/i.test(i.title)), 'eval ما زال ظاهرًا');
  assert.ok(rem.some(i => i.type === 'CWE_327'), 'MD5 ما زال ظاهرًا');
  assert.ok(parses(d.patch));
});

for (const v of ['last', 'current', 'latest']) {
  test(`[DF-E2E] الاسم الملتبس «${v}» عبر RealityOrchestrator: لا يُعدَّل ويبقى في remainingIssues`, async () => {
    const { RealityOrchestrator: R } = require('../public/server_engine_registration.js');
    const code = 'var ' + v + ' = 0;\nfunction f(players) {\n    for (let p of players) {\n        ' + v + ' = p.score;\n    }\n}\nf([]);\n';
    assert.ok(accIssues(code).some(i => i.line === 4 && /Data Flow:/.test(i.title)), 'fixture: المحلل يبلّغ');
    const out = await R.runPipelineAsync(code, 'a.js', { useFallbackChain: true });
    const patched = (out.decision && out.decision.patch) || code;
    assert.strictEqual(lineOf(patched, 4), '        ' + v + ' = p.score;', 'لم يُحوَّل إلى +=');
    const rem = out.phases.fallback.remainingIssues || [];
    assert.ok(rem.some(i => i.line === 4 && new RegExp('Data Flow: ' + v + ' ').test(i.title)), 'ظاهر في remainingIssues');
  });
}

test('[DF-E2E] حالة غير مُثبتة (قيمة مؤقتة) تبقى ظاهرة في remainingIssues', async () => {
  const { RealityOrchestrator: R } = require('../public/server_engine_registration.js');
  const code = 'var cur = 0;\nvar best = 0;\nfunction f(ps) {\n    for (let p of ps) {\n        cur = p.score;\n        if (cur > best) { best = cur; }\n    }\n    return best;\n}\nf([]);\n';
  const acc = accIssues(code);
  assert.ok(acc.some(i => i.line === 5), 'fixture: المحلل يبلّغ عن cur');
  const out = await R.runPipelineAsync(code, 'a.js', { useFallbackChain: true });
  const patched = (out.decision && out.decision.patch) || code;
  assert.strictEqual(lineOf(patched, 5), '        cur = p.score;', 'لم يُحوَّل إلى +=');
  const rem = out.phases.fallback.remainingIssues || out.phases.analyze.issues || [];
  assert.ok(rem.some(i => i.line === 5 && /Data Flow: cur/.test(i.title)), 'ظاهر للمراجعة لا مُسقَط');
});
