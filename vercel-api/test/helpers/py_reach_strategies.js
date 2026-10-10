// ═══════════════════════════════════════════════════════
// نماذج أولية لاستراتيجيات مطابقة الكود غير القابل للوصول.
//
// هذا ملف اختبارات مساعد، لا كود إنتاج. الماسح هنا نسخةٌ من ماسح
// fix_verifier.js تُرجع موضع كل عبارة (نطاقها وإزاحتها) وحالة وصولها، لا نصّها
// وحده — والاختبارات تُثبت أنه يوافق الإنتاج في تحديد الأسطر الميتة، فأي فرق
// في الأحكام يأتي من استراتيجية المطابقة لا من الماسح.
//
// المعيار الذي تُقاس به كل الاستراتيجيات:
//   يُدخل الإصلاح ضررًا إذا توقّفت عبارة كانت تُنفَّذ عن التنفيذ.
//     (أ) ارتفاع عدد العبارات غير القابلة للوصول — وكيل متحفّظ.
//     (ب) عبارة كانت قابلة للوصول قبل وصارت غير قابلة للوصول بعد — مباشر.
//   وتعديل محتوى كود ميت أصلًا ليس ضررًا: لا يُنفَّذ قبل ولا بعد.
// ═══════════════════════════════════════════════════════
'use strict';

const PY_TERM = /^(?:return|raise|break|continue)\b|^(?:sys\.exit|os\._exit)\s*\(/;
const PY_BR   = /^(?:elif|else|except|finally|case)\b/;
const PY_HEAD = /^(?:async\s+)?(?:def|class)\s+([A-Za-z_]\w*)/;

// يُرجع كل عبارة منطقية: {masked, raw, indent, scope, dead} + مجموعة النطاقات.
function statements(code) {
  const lines = String(code).replace(/\r\n?/g, '\n').split('\n');
  const termAt = new Map(); const out = []; const scopes = new Set(['<module>']);
  let triple = null, depth = 0, cont = false; const stack = [];

  for (const raw of lines) {
    if (!raw.trim()) continue;
    const startedInTriple = !!triple;
    let clean = '', quote = null, escaped = false;

    for (let k = 0; k < raw.length; k++) {
      const c = raw[k], n1 = raw[k + 1], n2 = raw[k + 2];
      if (triple) {
        if (c === triple && n1 === triple && n2 === triple) { clean += '   '; k += 2; triple = null; }
        else clean += ' ';
        continue;
      }
      if (quote) {
        clean += ' ';
        if (escaped) escaped = false;
        else if (c === '\\') escaped = true;
        else if (c === quote) quote = null;
        continue;
      }
      if ((c === "'" || c === '"') && n1 === c && n2 === c) { triple = c; clean += '   '; k += 2; continue; }
      if (c === "'" || c === '"') { quote = c; clean += ' '; continue; }
      if (c === '#') break;
      clean += c;
    }

    const wasCont = cont;
    for (const c of clean) {
      if (c === '(' || c === '[' || c === '{') depth++;
      else if (c === ')' || c === ']' || c === '}') depth--;
    }
    cont = depth > 0 || /\\$/.test(raw.replace(/\s+$/, ''));

    const stmt = clean.trim();
    if (!stmt || startedInTriple || wasCont) continue;

    const indent = raw.match(/^[ \t]*/)[0].replace(/\t/g, '    ').length;
    while (stack.length && indent <= stack[stack.length - 1].indent) stack.pop();
    for (const level of Array.from(termAt.keys())) if (level > indent) termAt.delete(level);

    const scope = stack.map(x => x.name).join('>') || '<module>';
    const dead  = !!(termAt.get(indent) && !PY_BR.test(stmt));
    out.push({ masked: stmt, raw: raw.trim(), indent, scope, dead });

    const h = PY_HEAD.exec(stmt);
    if (h) { stack.push({ name: h[1], indent }); scopes.add(stack.map(x => x.name).join('>')); }
    if (PY_TERM.test(stmt)) termAt.set(indent, true);
    if (PY_BR.test(stmt)) termAt.delete(indent);
  }
  return { all: out, dead: out.filter(x => x.dead), scopes };
}

// ─── (1) التنفيذ الحالي في fix_verifier.js: نص السطر المُعمَّى، الملف كله ───
function current(b, a) {
  const budget = new Map();
  for (const d of statements(b).dead) budget.set(d.masked, (budget.get(d.masked) || 0) + 1);
  const out = [];
  for (const d of statements(a).dead) {
    const n = budget.get(d.masked) || 0;
    if (n > 0) budget.set(d.masked, n - 1); else out.push(d.raw);
  }
  return out;
}

// ─── (4) عدّ لكل مسار نطاق + احتياطي عام للنطاقات الغائبة عن before ───
function cand4(b, a) {
  const B = statements(b), A = statements(a);
  const budget = new Map(); let total = 0;
  for (const d of B.dead) { budget.set(d.scope, (budget.get(d.scope) || 0) + 1); total++; }
  const out = [];
  for (const d of A.dead) {
    const n = budget.get(d.scope) || 0;
    if (n > 0) { budget.set(d.scope, n - 1); total--; continue; }
    if (!B.scopes.has(d.scope) && total > 0) { total--; continue; }
    out.push(d.raw);
  }
  return out;
}

// ─── (5) مرشَّح 4 + القاعدة المباشرة: عبارة كانت تُنفَّذ وصارت لا تُنفَّذ ───
//     المطابقة بالنص الخام على الملف كله، كي تصمد أمام إعادة تسمية الحاوية
//     وأمام نقل العبارة إلى نطاق آخر.
function cand5(b, a) {
  const B = statements(b), A = statements(a);
  const out = cand4(b, a).slice();
  const liveBefore = new Set(B.all.filter(x => !x.dead).map(x => x.raw));
  const deadBefore = new Set(B.dead.map(x => x.raw));
  for (const d of A.dead) {
    if (liveBefore.has(d.raw) && !deadBefore.has(d.raw) && !out.includes(d.raw)) out.push(d.raw);
  }
  return out;
}

// ─── (6) العدّ الكلي + قتل سطر حيّ (بلا خرائط نطاق) ───
function cand6(b, a) {
  const B = statements(b), A = statements(a);
  const out = [];
  if (A.dead.length > B.dead.length) {
    const budget = new Map();
    for (const d of B.dead) budget.set(d.raw, (budget.get(d.raw) || 0) + 1);
    for (const d of A.dead) {
      const n = budget.get(d.raw) || 0;
      if (n > 0) budget.set(d.raw, n - 1); else if (!out.includes(d.raw)) out.push(d.raw);
    }
    if (!out.length) out.push(A.dead[A.dead.length - 1].raw);
  }
  const liveBefore = new Set(B.all.filter(x => !x.dead).map(x => x.raw));
  const deadBefore = new Set(B.dead.map(x => x.raw));
  for (const d of A.dead) {
    if (liveBefore.has(d.raw) && !deadBefore.has(d.raw) && !out.includes(d.raw)) out.push(d.raw);
  }
  return out;
}

// ─── (7) مرشَّح 6 + حدس: نقص عدد الأحياء في نطاق مع تغيّر نصوص ميته ───
function cand7(b, a) {
  const out = cand6(b, a).slice();
  if (out.length) return out;
  const B = statements(b), A = statements(a);
  const group = arr => { const m = new Map(); for (const x of arr) { if (!m.has(x.scope)) m.set(x.scope, []); m.get(x.scope).push(x.raw); } return m; };
  const lb = group(B.all.filter(x => !x.dead)), la = group(A.all.filter(x => !x.dead));
  const db = group(B.dead), da = group(A.dead);
  for (const [scope, after] of da) {
    const before = db.get(scope) || [];
    const fresh = after.filter(t => !before.includes(t));
    if (!fresh.length) continue;
    if ((lb.get(scope) || []).length - (la.get(scope) || []).length > 0) out.push(fresh[0]);
  }
  return out;
}

// ─── (8) العدّ الكلي + قتل داخل النطاق، بارتداد للملف عند النطاقات الجديدة ───
function cand8(b, a) {
  const B = statements(b), A = statements(a);
  const out = [];
  if (A.dead.length > B.dead.length) {
    const budget = new Map();
    for (const d of B.dead) budget.set(d.raw, (budget.get(d.raw) || 0) + 1);
    for (const d of A.dead) {
      const n = budget.get(d.raw) || 0;
      if (n > 0) budget.set(d.raw, n - 1); else if (!out.includes(d.raw)) out.push(d.raw);
    }
    if (!out.length) out.push(A.dead[A.dead.length - 1].raw);
  }
  const liveIn = new Map(), deadIn = new Map();
  for (const x of B.all) {
    const m = x.dead ? deadIn : liveIn;
    if (!m.has(x.scope)) m.set(x.scope, new Set());
    m.get(x.scope).add(x.raw);
  }
  const liveAny = new Set(B.all.filter(x => !x.dead).map(x => x.raw));
  const deadAny = new Set(B.dead.map(x => x.raw));
  const EMPTY = new Set();
  for (const d of A.dead) {
    const hit = B.scopes.has(d.scope)
      ? ((liveIn.get(d.scope) || EMPTY).has(d.raw) && !(deadIn.get(d.scope) || EMPTY).has(d.raw))
      : (liveAny.has(d.raw) && !deadAny.has(d.raw));
    if (hit && !out.includes(d.raw)) out.push(d.raw);
  }
  return out;
}

// ─── (11ب) المعتمَد: (أ) العدّ الكلي + (ب) هوية خام + (و) موضعي + (هـ) اشتباه ───
//   (و) تفصل نقل الضرر بين النطاقات عن نقل كود ميت سليم.
//   (هـ) تُغطّي الحالات التي يُعاد فيها كتابة نصّ السطر المقتول، وثمنها
//        الصنف غير القابل للحسم. راجع fix_verifier.js للشرح الكامل.
function cand11b(b, a) {
  const B = statements(b), A = statements(a);
  const out = [];
  const push = t => { if (out.indexOf(t) === -1) out.push(t); };

  if (A.dead.length > B.dead.length) {
    const budget = new Map();
    for (const d of B.dead) budget.set(d.raw, (budget.get(d.raw) || 0) + 1);
    for (const d of A.dead) {
      const left = budget.get(d.raw) || 0;
      if (left > 0) budget.set(d.raw, left - 1); else push(d.raw);
    }
    if (!out.length) push(A.dead[A.dead.length - 1].raw);
  }

  const liveRaw = new Set(), deadRaw = new Set();
  for (const x of B.all) (x.dead ? deadRaw : liveRaw).add(x.raw);
  for (const d of A.dead) if (liveRaw.has(d.raw) && !deadRaw.has(d.raw)) push(d.raw);

  const at = src => { const live = new Map(), dead = new Map();
    for (const x of src.all) { const k = x.scope + '\u0000' + x.masked;
      const m = x.dead ? dead : live; m.set(k, (m.get(k) || 0) + 1); }
    return { live, dead }; };
  const flat = src => { const live = new Map(), dead = new Map();
    for (const x of src.all) { const m = x.dead ? dead : live; m.set(x.masked, (m.get(x.masked) || 0) + 1); }
    return { live, dead }; };
  const bAt = at(B), aAt = at(A);
  for (const [k, n] of aAt.dead) {
    if (n <= (bAt.dead.get(k) || 0)) continue;
    if ((aAt.live.get(k) || 0) < (bAt.live.get(k) || 0)) push(k.split('\u0000')[1]);
  }
  if (out.length) return out;

  const bF = flat(B), aF = flat(A);
  let fresh = null;
  for (const [t, n] of aF.dead) if (n > (bF.dead.get(t) || 0)) { fresh = t; break; }
  if (fresh === null) return out;
  for (const [t, n] of bF.live) if ((aF.live.get(t) || 0) < n) { push(fresh); break; }
  return out;
}

const STRATEGIES = { current, cand4, cand5, cand6, cand7, cand8, cand11b };

module.exports = { statements, STRATEGIES, current, cand4, cand5, cand6, cand7, cand8, cand11b };
