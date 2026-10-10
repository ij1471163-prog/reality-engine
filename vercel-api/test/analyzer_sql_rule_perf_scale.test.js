// ═══════════════════════════════════════════════════════
// سلّم أداء موسَّع لقاعدة SQL_INJECTION via %s — 1 KB … 131 KB
// ═══════════════════════════════════════════════════════
//
// الاختبار القائم (analyzer_sql_regex_quote_boundaries) يتوقّف سلّمه
// عند n=128 أي 299 حرفًا، وعندها كل المرشَّحات أقل من 5 ms — فلا
// يُميّز بينها ولا يكشف النمو التربيعي. هذا الملف يُغلق تلك الفجوة.
//
// السبب المقيس للنمو التربيعي: مقطعان كسولان نهايتُهما حرّة
//     execute\(\s*(Q) S1*? KEYWORD S2*? %s S3*? \1\s*%
// فعند **فشل** التطابق يُحصي المحرّك كل موضع للكلمة × كل موضع لـ%s
// × مسحًا بطول O(n). الأُسّ المقيس: %s مكرّر 1.98 · كلمات SQL مكرّرة
// 2.06 · و%s مكرّر **بلا** كلمة SQL 0.97 خطّي (لا كلمة ⇒ لا إحصاء).
//
// الأشكال الأربعة هنا ليست عشوائية:
//   A  — %s مكرّر بلا إغلاق            (كلمة واحدة × n موضعًا)
//   F  — كلمات SQL مكرّرة              (n كلمة × موضع واحد) — الأسوأ
//   H1 — %s مكرّر + تعليق لاحق فيه " % (يُنجِح أي مُرشِّح مسبق ثم يفشل)
//   H2 — كلمات مكرّرة + نفس التعليق
// H1 و H2 كشفا سقوط مرشَّحَين كانا يبدوان ناجحين على A و F وحدهما.
// حذفهما يُفقد الاختبار قدرته على رفض تلك البدائل.
//
// القياس في **عملية مستقلة**: تعبير منفجر لا يُقطَع من داخل node،
// فالمهلة هي الوسيلة الوحيدة لعدم تعليق المجموعة. والعملية الابنة
// تبني المدخل بنفسها من المقاس — لا يُمرَّر عبر متغيّر بيئة، لأن
// حدّ الطول في Linux يقارب 128 KB فيسقط مدخل 131 KB.
'use strict';

const test   = require('node:test');
const assert = require('node:assert');
const fs     = require('node:fs');
const path   = require('node:path');
const { execFileSync } = require('node:child_process');

const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const EP_PATH    = path.join(PUBLIC_DIR, 'extended_patterns.js');
const RULE_TITLE = 'SQL Injection via %s format';

function ruleFromSource() {
  const lines = fs.readFileSync(EP_PATH, 'utf8').split('\n');
  const idx   = lines.findIndex(l => l.includes(`title: '🔴 ${RULE_TITLE}'`));
  assert.ok(idx !== -1, `لم يُعثَر على سطر القاعدة «${RULE_TITLE}»`);
  const m = lines[idx].match(/\{ pattern: \/(.+)\/([a-z]*), sev:/);
  assert.ok(m, `سطر القاعدة ${idx + 1} ليس على الشكل { pattern: /…/flags, sev: … }`);
  return { source: m[1], flags: m[2], line: idx + 1, raw: lines[idx] };
}

// ─── بناء المدخلات: نفس الدالة في الأب والابن ──────────
const BUILD = {
  A:  kb => 'cur.execute("SELECT %s ' + '%s'.repeat(Math.floor(kb * 1024 / 2)) + '"',
  F:  kb => 'cur.execute("' + 'SELECT '.repeat(Math.floor(kb * 1024 / 7)) + 'x=%s", (a,))',
  H1: kb => 'cur.execute("SELECT %s ' + '%s'.repeat(Math.floor(kb * 1024 / 2)) + '", (a,))  # "z" % x',
  H2: kb => 'cur.execute("' + 'SELECT '.repeat(Math.floor(kb * 1024 / 7)) + 'x=%s", (a,))  # "z" % x',
  N1: kb => 'cur.execute("SELECT ' + 'a'.repeat(Math.floor(kb * 1024)) + ' x=%s", (a,))',
  N2: kb => 'cur.execute("SELECT ' + '" "'.repeat(Math.floor(kb * 1024 / 3)) + 'x=%s", (a,))',
  N3: kb => 'cur.execute("SELECT ' + 'a'.repeat(Math.floor(kb * 1024)) + ' x=%s" % a)',
  N4: kb => 'cur.execute("SELECT x=%s ' + '\\"'.repeat(Math.floor(kb * 1024 / 2)) + '", (a,))',
};
const LADDER = [1, 4, 16, 64, 131];
const BUDGET_MS        = 50;
const CHILD_TIMEOUT_MS = 5000;

// ⚠️ مع node -e تبدأ وسائط المستخدم من argv[1] لا argv[2].
// وقعتُ في هذا الخطأ فصار الابن ينهار فورًا، وكان المُغلِّف يترجم
// الانهيار إلى «تجاوز المهلة» — فظهر الاختبار أحمر على القاعدتين
// معًا. الآن: الانهيار يُميَّز عن المهلة ويُعرَض سببه.
const CHILD = [
  'const BUILD = ' + JSON.stringify(Object.fromEntries(Object.entries(BUILD).map(([k, f]) => [k, f.toString()]))) + ';',
  'const mk = eval("(" + BUILD[process.argv[1]] + ")");',
  'const s = mk(Number(process.argv[2]));',
  'const re = new RegExp(process.env.RX_SRC, process.env.RX_FLAGS);',
  're.test("warm");',
  'const t = process.hrtime.bigint();',
  're.test(s);',
  'process.stdout.write(String(Number(process.hrtime.bigint()-t)/1e6) + " " + s.length);',
].join('\n');

function matchMs(rule, shape, kb) {
  try {
    const out = execFileSync(process.execPath, ['-e', CHILD, shape, String(kb)], {
      env: { ...process.env, RX_SRC: rule.source, RX_FLAGS: rule.flags },
      timeout: CHILD_TIMEOUT_MS, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
    });
    const [ms, len] = String(out).split(' ');
    const v = Number(ms);
    if (!Number.isFinite(v)) return { ms: NaN, len: 0, why: 'مخرَج غير رقمي: ' + JSON.stringify(String(out).slice(0, 120)) };
    return { ms: v, len: Number(len) };
  } catch (e) {
    // المهلة وحدها تُحتسَب تجاوزًا؛ أي خطأ آخر عطبٌ في الأداة
    if (e.killed || e.signal === 'SIGTERM' || e.code === 'ETIMEDOUT')
      return { ms: Infinity, len: BUILD[shape](kb).length };
    return { ms: NaN, len: 0, why: 'انهيار العملية الابنة: ' + String(e.stderr || e.message).slice(0, 200) };
  }
}

const fmt = r => (Number.isNaN(r.ms) ? 'عطب' : r.ms === Infinity ? `>${CHILD_TIMEOUT_MS}` : r.ms.toFixed(2));
// عطب الأداة يُفشل الاختبار بسببه الصريح، ولا يُترجَم إلى «بطيء»
const assertSane = (r, label) =>
  assert.ok(!Number.isNaN(r.ms), `عطب في أداة القياس عند ${label}: ${r.why}`);

// ═══ 1. الأشكال المُفجِّرة — سلّم 1 KB … 131 KB ═════════

for (const shape of ['A', 'F', 'H1', 'H2']) {
  test(`أداء · الشكل ${shape} · 1 KB…131 KB دون ${BUDGET_MS} ms`, () => {
    const rule = ruleFromSource();
    const over = [];
    const trace = [];
    for (const kb of LADDER) {
      const r = matchMs(rule, shape, kb);
      assertSane(r, `${shape} @ ${kb} KB`);
      trace.push(`${kb}KB(${r.len})=${fmt(r)}`);
      if (!(r.ms <= BUDGET_MS)) over.push(`${kb} KB (طول ${r.len}) ⇒ ${fmt(r)} ms`);
    }
    assert.deepStrictEqual(over, [],
      `الشكل ${shape} تجاوز الميزانية على سطر القاعدة ${rule.line}:\n  ` + over.join('\n  ') +
      `\n  المنحنى الكامل: ${trace.join('  ')}`);
  });
}

// ═══ 2. الأشكال الخطّية — حارس انحدار ══════════════════

test(`أداء · أشكال خطّية (جسم طويل · ضمّ ضمني · مُطابِق · هروب) دون ${BUDGET_MS} ms`, () => {
  const rule = ruleFromSource();
  const over = [];
  for (const shape of ['N1', 'N2', 'N3', 'N4']) {
    for (const kb of LADDER) {
      const r = matchMs(rule, shape, kb);
      assertSane(r, `${shape} @ ${kb} KB`);
      if (!(r.ms <= BUDGET_MS)) over.push(`${shape} @ ${kb} KB (طول ${r.len}) ⇒ ${fmt(r)} ms`);
    }
  }
  assert.deepStrictEqual(over, [], 'تجاوز الميزانية:\n  ' + over.join('\n  '));
});

// ═══ 3. حدّ النمو — الأُسّ لا الزمن المطلق ═════════════
// ميزانية مطلقة وحدها قد تُجتاز على جهاز سريع رغم نمو تربيعي.
// فنقيس الأُسّ: مضاعفة الحجم تضاعف الزمن مرة واحدة لا أربع مرات.

test('أداء · الأُسّ على الشكل F دون 1.5 (أي نمو شبه خطّي لا تربيعي)', () => {
  const rule = ruleFromSource();
  const pts = [];
  for (const kb of [4, 16, 64, 131]) {
    const r = matchMs(rule, 'F', kb);
    assertSane(r, `F @ ${kb} KB`);
    assert.notStrictEqual(r.ms, Infinity, `تجاوز المهلة عند ${kb} KB ⇒ لا يمكن تقدير الأُسّ`);
    pts.push({ x: r.len, y: Math.max(r.ms, 0.01) });
  }
  const lx = pts.map(p => Math.log(p.x)), ly = pts.map(p => Math.log(p.y));
  const n = lx.length, mx = lx.reduce((a, b) => a + b) / n, my = ly.reduce((a, b) => a + b) / n;
  let num = 0, den = 0;
  for (let i = 0; i < n; i++) { num += (lx[i] - mx) * (ly[i] - my); den += (lx[i] - mx) ** 2; }
  const e = num / den;
  assert.ok(e < 1.5,
    `الأُسّ المقدَّر ${e.toFixed(2)} ⇒ نمو فوق الخطّي. النقاط: ` +
    pts.map(p => `${p.x}:${p.y.toFixed(2)}`).join('  '));
});

// ═══ 4. سلامة الأداة — تمنع المقياس الخاوي ════════════
// القاعدة السابقة (مقطعان كسولان) مثبَّتة نصًّا عن قصد: لو كان
// المقياس شكليًّا لمرّت هي أيضًا.

test('سلامة الأداة: القاعدة ذات المقطعين الكسولين تتجاوز الميزانية على A و F و H1 و H2', () => {
  const lazy = {
    source: String.raw`execute\s*\(\s*("""|'''|"|')(?:\\[\s\S]|\1\s*\1|(?!\1)[^\\])*?\b(?:SELECT|INSERT|UPDATE|DELETE)\b(?:\\[\s\S]|\1\s*\1|(?!\1)[^\\])*?%s(?:\\[\s\S]|(?!\1\s*%)(?!\1\s*[,)])[^\\])*?\1\s*%`,
    flags: 'i',
  };
  const caught = [];
  for (const shape of ['A', 'F', 'H1', 'H2']) {
    const r = matchMs(lazy, shape, 64);
    assertSane(r, `المرجعية ${shape} @ 64 KB`);
    if (!(r.ms <= BUDGET_MS)) caught.push(`${shape}=${fmt(r)}`);
  }
  assert.strictEqual(caught.length, 4,
    'المقياس لا يكشف النمو التربيعي على كل الأشكال الأربعة ⇒ لا قيمة لاجتياز القاعدة الحالية. ' +
    'المكشوف: ' + (caught.join(' · ') || 'لا شيء'));
});

test('سلامة الأداة: التعبير المقيس مُستخرَج حرفيًّا من سطر القاعدة المشحون', () => {
  const rule = ruleFromSource();
  assert.ok(rule.raw.includes(`/${rule.source}/${rule.flags}`),
    'نصّ التعبير المستخرج لا يطابق ما في الملف حرفيًّا');
  assert.doesNotThrow(() => new RegExp(rule.source, rule.flags), 'التعبير المستخرج لا يُصرَّف');
});
