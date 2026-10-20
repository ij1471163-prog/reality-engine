/**
 * healing_log_policy.js v1.0 — حماية الأسرار + سياسة الاحتفاظ والأرشفة + سجل التدقيق
 * ══════════════════════════════════════════════════════════════════════
 * الجزء الثاني من ملفين (الأول: healing_log_schema.js — المخطط وربط الأدلة).
 *
 *  1. حماية الأسرار: redactText/redactDeep/sanitizeEntry. أي قيمة تطابق نمط سرّ تُستبدل
 *     بـ[REDACTED:kind] قبل التخزين، ولا يُحفظ من السرّ حرف. patchedCode لا يُخزَّن أبدًا
 *     (نفس عقد healing_store.js). الاكتشاف نمطي: لا يُدّعى أنه شامل — انظر SECRET_PATTERNS.
 *  2. سياسة الاحتفاظ: applyRetention — سقف عدد وعمر وحجم؛ ما يُحذف من السجل الحي يُؤرشف
 *     كملخّص مضغوط (بلا patch ولا testResults). حوادث PENDING_REVIEW لا تُحذف بالعمر.
 *  3. سجل التدقيق: createAuditTrail — أحداث append-only بسلسلة هاشات SHA-256؛
 *     أي تعديل/حذف/إعادة ترتيب لحدث قديم يكسر verify(). تُسجَّل فيه قرارات الاعتماد والرفض
 *     والتراجع (بما فيها المرفوضة وسببها) وتغييرات الحالة والأرشفة.
 *
 * يعتمد على healing_log_schema.js (HealingLogSchema) ويُمرَّر حقنًا أو يُقرأ من global/require.
 * غير مربوط بأي شيء. لا require إلا لـschema، ولا fs. لا يرمي على مدخلات سيئة.
 * ══════════════════════════════════════════════════════════════════════
 */
"use strict";

(function (global) {

function resolveSchema() {
  if (global.HealingLogSchema) return global.HealingLogSchema;
  if (typeof require === "function") {
    try { return require("./healing_log_schema.js"); } catch (_) { /* غير متاح */ }
  }
  return null;
}
const S = resolveSchema();
if (!S) throw new Error("healing_log_policy.js يحتاج healing_log_schema.js محمَّلًا قبله");

const isStr = v => typeof v === "string";
const isObj = v => v !== null && typeof v === "object" && !Array.isArray(v);

// ═════════════════════════════════════════════════════
// 1) حماية الأسرار
// ═════════════════════════════════════════════════════
// ترتيب الأنماط مهم: الأخص أولًا. كل نمط يُستبدل كاملًا (أو قيمته فقط حيث يُذكر).
const SECRET_PATTERNS = [
  { kind: "private-key",  re: /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z ]*PRIVATE KEY-----|$)/g },
  { kind: "jwt",          re: /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g },
  { kind: "aws-key-id",   re: /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g },
  { kind: "github-token", re: /\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,})\b/g },
  { kind: "slack-token",  re: /\bxox[abprs]-[A-Za-z0-9-]{10,}\b/g },
  { kind: "api-key",      re: /\b(?:sk|pk|rk)[-_](?:live|test|proj)?[-_]?[A-Za-z0-9]{20,}\b/g },
  { kind: "google-key",   re: /\bAIza[0-9A-Za-z_-]{35}\b/g },
  { kind: "bearer",       re: /\b(Bearer|Basic)\s+[A-Za-z0-9._~+\/=-]{12,}/gi, keep: 1 },
  { kind: "url-password", re: /(\b[a-z][a-z0-9+.-]*:\/\/[^\s:@\/"']+:)[^\s@\/"']{3,}(@)/gi, keep: 2 },
  // name = "value" / name: "value" لأسماء توحي بسرّ — تُحجب القيمة فقط
  { kind: "assigned-secret",
    re: /\b((?:[A-Za-z0-9_.-]*(?:password|passwd|pwd|secret|token|api[_-]?key|apikey|access[_-]?key|private[_-]?key|auth(?:orization)?|credential)[A-Za-z0-9_.-]*)["']?\s*[:=]\s*)(["'])(?:(?!\2)[^\n]){4,}\2/gi,
    custom: (m, pre, q) => pre + q + "[REDACTED:assigned-secret]" + q }
];

const SECRET_KEY_RE = /^(?:.*[_-])?(?:password|passwd|pwd|secret|token|api[_-]?key|apikey|authorization|cookie|private[_-]?key|credentials?)$/i;

/** @returns {{text:string, findings:Object}} findings: {kind: عدد} — لا قيم أبدًا */
function redactText(text) {
  const findings = {};
  if (!isStr(text) || !text) return { text: isStr(text) ? text : "", findings };
  let out = text;
  for (const p of SECRET_PATTERNS) {
    out = out.replace(p.re, function () {
      findings[p.kind] = (findings[p.kind] || 0) + 1;
      if (p.custom) return p.custom.apply(null, arguments);
      const groups = Array.prototype.slice.call(arguments, 1);
      if (p.keep === 1) return groups[0] + " [REDACTED:" + p.kind + "]";
      if (p.keep === 2) return groups[0] + "[REDACTED:" + p.kind + "]" + groups[1];
      return "[REDACTED:" + p.kind + "]";
    });
  }
  return { text: out, findings };
}

/** عدّاد بلا استبدال — للاختبارات وللتحقق أن لا سرّ تسرّب */
function scanSecrets(text) {
  if (!isStr(text)) return {};
  const found = {};
  for (const p of SECRET_PATTERNS) {
    const m = text.match(new RegExp(p.re.source, p.re.flags));
    if (m && m.length) found[p.kind] = m.length;
  }
  return found;
}

function merge(into, add) { for (const k of Object.keys(add)) into[k] = (into[k] || 0) + add[k]; }

/** نسخة عميقة نظيفة: تحجب القيم النصية، وقيم المفاتيح ذات الأسماء الحساسة كاملة، وتقصّ الضخم. */
function redactDeep(v, state, depth) {
  state = state || { findings: {}, maxString: 20000, maxItems: 500 };
  depth = depth || 0;
  if (depth > 12) return "[TRUNCATED:depth]";
  if (isStr(v)) {
    const r = redactText(v.length > state.maxString ? v.slice(0, state.maxString) : v);
    merge(state.findings, r.findings);
    return v.length > state.maxString ? r.text + "…[TRUNCATED:" + v.length + "]" : r.text;
  }
  if (Array.isArray(v)) return v.slice(0, state.maxItems).map(x => redactDeep(x, state, depth + 1));
  if (isObj(v)) {
    const out = {};
    for (const k of Object.keys(v).slice(0, state.maxItems)) {
      if (k === "__proto__" || k === "constructor" || k === "prototype") continue;
      if (SECRET_KEY_RE.test(k) && isStr(v[k]) && v[k] !== "") {
        state.findings["secret-key"] = (state.findings["secret-key"] || 0) + 1;
        out[k] = "[REDACTED:secret-key]";
      } else out[k] = redactDeep(v[k], state, depth + 1);
    }
    return out;
  }
  if (typeof v === "function" || typeof v === "symbol" || typeof v === "bigint") return null;
  return v;
}

/**
 * يُنظّف مدخل سجل قبل التخزين/التصدير. لا يعدّل الأصل.
 * patchedCode يُحذف دائمًا (إلا opts.keepPatchedCode لتصدير ذاكرة محلي، وحتى حينها يُحجب).
 */
function sanitizeEntry(entry, opts) {
  opts = opts || {};
  if (!isObj(entry)) return null;
  const state = { findings: {}, maxString: opts.maxString || 20000, maxItems: opts.maxItems || 500 };
  const out = {};
  for (const k of Object.keys(entry)) {
    if (k === "patchedCode") {
      if (opts.keepPatchedCode && isStr(entry[k])) out[k] = redactDeep(entry[k], state);
      continue;
    }
    out[k] = redactDeep(entry[k], state);
  }
  const kinds = Object.keys(state.findings);
  if (kinds.length) {
    out.redaction = { count: kinds.reduce((n, k) => n + state.findings[k], 0), kinds };
  }
  return out;
}

// ═════════════════════════════════════════════════════
// 2) الاحتفاظ والأرشفة
// ═════════════════════════════════════════════════════
const DEFAULT_POLICY = Object.freeze({
  maxEntries: 200,          // سقف السجل الحي
  maxAgeDays: 90,           // أقدم من هذا يُؤرشف (إلا PENDING_REVIEW)
  maxBytes: 1500000,        // حجم السجل الحي بعد التسلسل
  archiveMaxEntries: 1000,  // سقف الأرشيف
  archiveMaxAgeDays: 365    // أقدم من هذا يُحذف من الأرشيف نهائيًا
});
const DAY = 86400000;

function sizeOf(v) { try { return JSON.stringify(v).length; } catch (_) { return Infinity; } }

/** ملخّص مضغوط يُحفظ في الأرشيف — بلا patch ولا testResults ولا نصوص كود. */
function toArchiveRecord(e, archivedAt, reason) {
  const lastAttempt = Array.isArray(e.attempts) && e.attempts.length ? e.attempts[e.attempts.length - 1] : null;
  const rec = {
    id: e.id, timestamp: e.timestamp, type: e.type, engine: e.engine, fileName: e.fileName,
    status: e.status, healingResult: e.healingResult,
    approvedAt: e.approvedAt || null, rejectedAt: e.rejectedAt || null,
    archivedAt, archiveReason: reason
  };
  if (lastAttempt) { rec.attemptId = lastAttempt.attemptId; rec.patchSha = lastAttempt.patchSha || null; }
  return redactDeep(rec);
}

/**
 * @param {Array} entries الأحدث أولًا
 * @param {Array} archive الأرشيف الحالي
 * @returns {{live:Array, archive:Array, archived:Array, purged:Array}} لا يعدّل المدخلات
 */
function applyRetention(entries, archive, policy, now) {
  const p = Object.assign({}, DEFAULT_POLICY, policy || {});
  const t = typeof now === "number" ? now : (now instanceof Date ? +now : Date.now());
  const nowIso = new Date(t).toISOString();
  const sorted = (Array.isArray(entries) ? entries : []).slice()
    .sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp));
  const archived = [];
  let live = [];
  const toArchive = (e, reason) => archived.push(toArchiveRecord(e, nowIso, reason));

  // (أ) العمر — PENDING_REVIEW لا ينتهي بالعمر (ينتظر قرارًا بشريًا)
  for (const e of sorted) {
    const age = t - Date.parse(e.timestamp);
    if (e.status !== "PENDING_REVIEW" && age > p.maxAgeDays * DAY) toArchive(e, "age>" + p.maxAgeDays + "d");
    else live.push(e);
  }
  // (ب) العدد والحجم — نُزيل الأقدم غير المعلّق أولًا، ثم المعلّق الأقدم إن لزم
  const dropOldest = reason => {
    for (let i = live.length - 1; i >= 0; i--) {
      if (live[i].status !== "PENDING_REVIEW") { toArchive(live[i], reason); live.splice(i, 1); return true; }
    }
    if (live.length) { toArchive(live[live.length - 1], reason + "+pending"); live.pop(); return true; }
    return false;
  };
  while (live.length > p.maxEntries && dropOldest("count>" + p.maxEntries)) { /* تكرار */ }
  while (sizeOf(live) > p.maxBytes && dropOldest("bytes>" + p.maxBytes)) { /* تكرار */ }

  // (ج) الأرشيف نفسه محدود العمر والعدد
  const purged = [];
  const seen = new Set();
  let arch = [];
  for (const r of archived.concat(Array.isArray(archive) ? archive : [])) {
    if (!r || seen.has(r.id)) continue;
    seen.add(r.id);
    const at = Date.parse(r.archivedAt);
    if (!isNaN(at) && t - at > p.archiveMaxAgeDays * DAY) { purged.push(r.id); continue; }
    arch.push(r);
  }
  arch.sort((a, b) => Date.parse(b.archivedAt) - Date.parse(a.archivedAt));
  if (arch.length > p.archiveMaxEntries) {
    for (const r of arch.slice(p.archiveMaxEntries)) purged.push(r.id);
    arch = arch.slice(0, p.archiveMaxEntries);
  }
  return { live, archive: arch, archived, purged };
}

// ═════════════════════════════════════════════════════
// 3) سجل التدقيق
// ═════════════════════════════════════════════════════
const AUDIT_ACTIONS = Object.freeze([
  "incident.created", "attempt.started", "tests.recorded", "status.changed",
  "approval.granted", "approval.denied", "rejection.recorded", "rollback.recorded",
  "retention.archived", "log.exported", "log.imported"
]);
const GENESIS = "0".repeat(64);

function canonicalJson(v) {
  if (Array.isArray(v)) return "[" + v.map(canonicalJson).join(",") + "]";
  if (isObj(v)) return "{" + Object.keys(v).sort().map(k => JSON.stringify(k) + ":" + canonicalJson(v[k])).join(",") + "}";
  return JSON.stringify(v === undefined ? null : v);
}
function eventHash(ev) {
  const body = Object.assign({}, ev); delete body.hash;
  return S.sha256(canonicalJson(body));
}

/** يتحقق من سلسلة أحداث. anchorHash = هاش آخر حدث قُصّ من الأمام (أو GENESIS). */
function verifyAuditChain(events, anchorHash) {
  let prev = anchorHash || GENESIS;
  const list = Array.isArray(events) ? events : [];
  for (let i = 0; i < list.length; i++) {
    const ev = list[i];
    if (!isObj(ev)) return { ok: false, index: i, reason: "حدث ليس كائنًا" };
    if (ev.prevHash !== prev) return { ok: false, index: i, reason: "prevHash لا يطابق (حذف/إعادة ترتيب)" };
    if (eventHash(ev) !== ev.hash) return { ok: false, index: i, reason: "hash لا يطابق (تعديل)" };
    if (i > 0 && !(ev.seq === list[i - 1].seq + 1)) return { ok: false, index: i, reason: "seq غير متتابع" };
    prev = ev.hash;
  }
  return { ok: true, index: -1 };
}

function createAuditTrail(opts) {
  opts = opts || {};
  const maxEvents = opts.maxEvents > 0 ? opts.maxEvents : 5000;
  const clock = typeof opts.now === "function" ? opts.now : Date.now;
  let events = [];
  let anchorHash = GENESIS;
  let nextSeq = 1;

  function append(action, data) {
    if (AUDIT_ACTIONS.indexOf(action) < 0) return { ok: false, error: "action غير معروف: " + String(action).slice(0, 40) };
    data = data || {};
    const ev = {
      seq: nextSeq,
      at: new Date(+clock()).toISOString(),
      actor: isStr(data.actor) ? data.actor.slice(0, 100) : "system",
      action,
      incidentId: isStr(data.incidentId) ? data.incidentId : null,
      attemptId: isStr(data.attemptId) ? data.attemptId : null,
      from: isStr(data.from) ? data.from : null,
      to: isStr(data.to) ? data.to : null,
      reasons: Array.isArray(data.reasons) ? data.reasons.filter(isStr).slice(0, 20) : [],
      note: isStr(data.note) ? redactText(data.note.slice(0, 1000)).text : "",
      prevHash: events.length ? events[events.length - 1].hash : anchorHash
    };
    ev.hash = eventHash(ev);
    events.push(ev);
    nextSeq++;
    while (events.length > maxEvents) { anchorHash = events[0].hash; events.shift(); }
    return { ok: true, event: ev };
  }

  /** تغيير حالة: يرفض الانتقالات غير المشروعة ويسجّل الرفض كحدث status.changed مرفوض عبر note. */
  function recordStatusChange(entryOrId, to, data) {
    data = data || {};
    const id = isObj(entryOrId) ? entryOrId.id : entryOrId;
    const from = isObj(entryOrId) ? entryOrId.status : data.from;
    if (!S.canTransition(from, to)) {
      append("status.changed", Object.assign({}, data, { incidentId: id, from, to, reasons: ["TRANSITION_DENIED"], note: "رُفض الانتقال" }));
      return { ok: false, reasons: ["TRANSITION_DENIED"] };
    }
    append("status.changed", Object.assign({}, data, { incidentId: id, from, to }));
    return { ok: true };
  }

  /**
   * قرار اعتماد: يُنفّذ approvalCheck (الحالة + دليل المحاولة الأحدث + تطابق الأختام)
   * ويسجّل النتيجة في التدقيق في الحالتين. الاعتماد نفسه (تغيير الحالة فعليًا) يبقى للمحرك.
   */
  function recordApproval(entry, baseCode, patchedCode, data) {
    data = data || {};
    const chk = S.approvalCheck(entry, baseCode, patchedCode, data.attemptId);
    const base = { actor: data.actor, incidentId: entry && entry.id, attemptId: chk.attemptId || null, from: entry && entry.status, to: "APPROVED" };
    if (!chk.ok) { append("approval.denied", Object.assign(base, { reasons: chk.reasons })); return chk; }
    append("approval.granted", base);
    return chk;
  }

  function recordRejection(entry, data) {
    data = data || {};
    const ok = S.canTransition(entry && entry.status, "REJECTED");
    append(ok ? "rejection.recorded" : "status.changed",
      { actor: data.actor, incidentId: entry && entry.id, from: entry && entry.status, to: "REJECTED",
        reasons: ok ? [] : ["TRANSITION_DENIED"], note: data.note });
    return { ok };
  }

  function recordRollback(entry, data) {
    data = data || {};
    const ok = S.canTransition(entry && entry.status, "ROLLED_BACK");
    append(ok ? "rollback.recorded" : "status.changed",
      { actor: data.actor, incidentId: entry && entry.id, attemptId: data.attemptId, from: entry && entry.status, to: "ROLLED_BACK",
        reasons: ok ? [] : ["TRANSITION_DENIED"], note: data.note });
    return { ok };
  }

  return {
    append, recordStatusChange, recordApproval, recordRejection, recordRollback,
    events: () => events.slice(),
    anchor: () => anchorHash,
    verify: () => verifyAuditChain(events, anchorHash),
    export: () => ({ anchorHash, events: events.slice() })
  };
}

const HealingLogPolicy = {
  SECRET_PATTERNS, DEFAULT_POLICY, AUDIT_ACTIONS, GENESIS,
  redactText, scanSecrets, redactDeep, sanitizeEntry,
  toArchiveRecord, applyRetention,
  createAuditTrail, verifyAuditChain
};

global.HealingLogPolicy = HealingLogPolicy;
if (typeof module !== "undefined" && module.exports) module.exports = HealingLogPolicy;

})(typeof window !== "undefined" ? window : (typeof global !== "undefined" ? global : {}));
