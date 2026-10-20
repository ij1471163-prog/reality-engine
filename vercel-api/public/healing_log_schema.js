/**
 * healing_log_schema.js v1.0 — مخطط سجل الإصلاح v2 + ربط نتائج الاختبار بالتعديل
 * ══════════════════════════════════════════════════════════════════════
 * الجزء الأول من ملفين (الثاني: healing_log_policy.js — أسرار/احتفاظ/تدقيق).
 * فُصلا لأن للمخطط أسباب تغيّر (حقول، هجرة إصدارات) غير أسباب السياسة (أنماط أسرار،
 * مدد احتفاظ، قواعد تدقيق)، ولأن self_healing_engine.js فوق 1000 سطر أصلًا.
 *
 * ما يضيفه (فوق ما يفعله healing_store.js من تحقق بقائمة بيضاء وتخزين):
 *  1. معرّف للحادثة (id = SH_…) ومعرّف مستقل لكل محاولة إصلاح (SHA_…)، وتوقيت موحّد
 *     ISO-8601 UTC بالميلي ثانية (…sssZ).
 *  2. ربط الأدلة: كل تشغيل اختبار يُختم بـSHA-256 للكود الأصلي وللكود المُعدَّل الذي
 *     اختُبر. لا تُقبل نتيجة اختبار لتعديل غير الذي اختُبر، ولا لمحاولة أقدم من الأحدث.
 *  3. هجرة v1 → v2 دون فقد: السجلات القديمة تبقى صالحة لكنها «بلا أدلة مربوطة»
 *     (unbound) فلا تُعتمد عبر هذا المسار.
 *
 * غير مربوط بأي شيء: لا يعدّل المحرك ولا healing_store.js ولا يُحمَّل من index.html.
 * لا require ولا fs: يعمل في المتصفح وNode وvm. لا يرمي على مدخلات سيئة (يُرجع ok:false).
 * ══════════════════════════════════════════════════════════════════════
 */
"use strict";

(function (global) {

const SCHEMA_VERSION = "2.0.0";

const TYPES    = ["ENGINE_ERROR", "ENGINE_CONFLICT", "REGRESSION", "ACCUMULATION",
                  "FOREACH_RETURN", "SQL_INJECTION", "SYNTAX", "RUNTIME_ERROR", "ENGINE_SELF_DEFECT"];
const STATUSES = ["PENDING_REVIEW", "APPROVED", "REJECTED", "ROLLED_BACK"];
const RESULTS  = ["PASS", "FAIL", "SKIPPED"];

// المسموح من حالة إلى حالة. الحالات الثلاث الأخيرة نهائية (نفس سلوك approve/reject في المحرك).
const TRANSITIONS = Object.freeze({
  PENDING_REVIEW: ["APPROVED", "REJECTED", "ROLLED_BACK"],
  APPROVED: [], REJECTED: [], ROLLED_BACK: []
});

// الحقول التي ينتجها المحرك فعليًا اليوم (يُثبتها اختبار التوافق بتشغيل المحرك لا بالقراءة)
const LEGACY_FIELDS = Object.freeze([
  "id", "timestamp", "type", "engine", "fileName", "detail", "status", "healingResult",
  "testResults", "patch", "patchedCode", "patchReason", "note", "rollbackMsg",
  "approvedAt", "rejectedAt", "applyError", "applyFailedAt", "restored"
]);
// حقول v2 الجديدة
const V2_FIELDS = Object.freeze(["updatedAt", "attempts", "currentAttemptId", "redaction"]);
const ENTRY_FIELDS = Object.freeze(LEGACY_FIELDS.concat(V2_FIELDS));

const ATTEMPT_FIELDS = Object.freeze([
  "attemptId", "incidentId", "n", "startedAt", "finishedAt", "baseSha", "patchSha",
  "patchReason", "healingResult", "testRun", "legacy"
]);
const TESTRUN_FIELDS = Object.freeze([
  "runId", "attemptId", "baseSha", "patchSha", "startedAt", "finishedAt", "passed", "results", "unbound"
]);

const INCIDENT_ID_RE = /^SH_\d{10,16}_[A-Z0-9]{1,8}$/;
const ATTEMPT_ID_RE  = /^SHA_\d{10,16}_[A-Z0-9]{4,8}$/;
const RUN_ID_RE      = /^SHR_\d{10,16}_[A-Z0-9]{4,8}$/;
const SHA_RE         = /^[0-9a-f]{64}$/;
const CANON_TS_RE    = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/;
const LOOSE_TS_RE    = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d/;

const isStr = v => typeof v === "string";
const isObj = v => v !== null && typeof v === "object" && !Array.isArray(v);

// ─── SHA-256 (نقي، متزامن، بلا اعتماد على crypto) ─────────────────────
// ثوابته تُشتق من الجذور الأولى للأعداد الأولية كما في المواصفة، ويثبت اختبار التوافق
// تطابقه مع crypto.createHash في Node على عدة مدخلات (منها Unicode).
const _K = [], _H0 = [];
(function initSha() {
  const frac = x => x - Math.floor(x);
  let n = 2, count = 0;
  while (count < 64) {
    let prime = true;
    for (let d = 2; d * d <= n; d++) if (n % d === 0) { prime = false; break; }
    if (prime) {
      if (count < 8) _H0.push((frac(Math.sqrt(n)) * 4294967296) >>> 0);
      _K.push((frac(Math.cbrt(n)) * 4294967296) >>> 0);
      count++;
    }
    n++;
  }
})();

function utf8Bytes(str) {
  const out = [];
  for (let i = 0; i < str.length; i++) {
    let c = str.charCodeAt(i);
    if (c >= 0xD800 && c <= 0xDBFF && i + 1 < str.length) {
      const d = str.charCodeAt(i + 1);
      if (d >= 0xDC00 && d <= 0xDFFF) { c = 0x10000 + ((c - 0xD800) << 10) + (d - 0xDC00); i++; }
      else c = 0xFFFD;
    } else if (c >= 0xD800 && c <= 0xDFFF) c = 0xFFFD;
    if (c < 0x80) out.push(c);
    else if (c < 0x800) out.push(0xC0 | (c >> 6), 0x80 | (c & 63));
    else if (c < 0x10000) out.push(0xE0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
    else out.push(0xF0 | (c >> 18), 0x80 | ((c >> 12) & 63), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
  }
  return out;
}

function sha256(str) {
  const bytes = utf8Bytes(String(str));
  const bitLen = bytes.length * 8;
  bytes.push(0x80);
  while (bytes.length % 64 !== 56) bytes.push(0);
  const hi = Math.floor(bitLen / 4294967296), lo = bitLen >>> 0;
  bytes.push((hi >>> 24) & 255, (hi >>> 16) & 255, (hi >>> 8) & 255, hi & 255,
             (lo >>> 24) & 255, (lo >>> 16) & 255, (lo >>> 8) & 255, lo & 255);
  const H = _H0.slice();
  const w = new Array(64);
  const rotr = (x, n) => (x >>> n) | (x << (32 - n));
  for (let off = 0; off < bytes.length; off += 64) {
    for (let i = 0; i < 16; i++) {
      const j = off + i * 4;
      w[i] = ((bytes[j] << 24) | (bytes[j + 1] << 16) | (bytes[j + 2] << 8) | bytes[j + 3]) >>> 0;
    }
    for (let i = 16; i < 64; i++) {
      const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3);
      const s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
    }
    let [a, b, c, d, e, f, g, h] = H;
    for (let i = 0; i < 64; i++) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const t1 = (h + S1 + ch + _K[i] + w[i]) >>> 0;
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (S0 + maj) >>> 0;
      h = g; g = f; f = e; e = (d + t1) >>> 0; d = c; c = b; b = a; a = (t1 + t2) >>> 0;
    }
    H[0] = (H[0] + a) >>> 0; H[1] = (H[1] + b) >>> 0; H[2] = (H[2] + c) >>> 0; H[3] = (H[3] + d) >>> 0;
    H[4] = (H[4] + e) >>> 0; H[5] = (H[5] + f) >>> 0; H[6] = (H[6] + g) >>> 0; H[7] = (H[7] + h) >>> 0;
  }
  return H.map(x => ("00000000" + x.toString(16)).slice(-8)).join("");
}

// ─── توقيت موحّد ومعرّفات ────────────────────────────────────────────
/** يقبل Date | رقم (ms) | نص ISO. يُرجع "YYYY-MM-DDTHH:mm:ss.sssZ" أو null. */
function canonicalTime(x) {
  let d;
  if (x instanceof Date) d = x;
  else if (typeof x === "number" && isFinite(x)) d = new Date(x);
  else if (isStr(x) && LOOSE_TS_RE.test(x)) d = new Date(x);
  else return null;
  const t = d.getTime();
  return isNaN(t) ? null : d.toISOString();
}

function randTag(n, rnd) {
  const r = typeof rnd === "function" ? rnd : Math.random;
  let s = "";
  while (s.length < n) s += r().toString(36).slice(2).toUpperCase().replace(/[^A-Z0-9]/g, "");
  return s.slice(0, n);
}
const nowMs = now => (typeof now === "function" ? +now() : (now instanceof Date ? +now : Date.now()));

function newIncidentId(opts)           { opts = opts || {}; return "SH_"  + nowMs(opts.now) + "_" + randTag(4, opts.rnd); }
function newAttemptId(opts)            { opts = opts || {}; return "SHA_" + nowMs(opts.now) + "_" + randTag(6, opts.rnd); }
function newRunId(opts)                { opts = opts || {}; return "SHR_" + nowMs(opts.now) + "_" + randTag(6, opts.rnd); }
const isoNow = now => new Date(nowMs(now)).toISOString();

// ─── محاولات الإصلاح وربط الأدلة ─────────────────────────────────────

/**
 * ينشئ محاولة إصلاح لحادثة. baseCode = الكود قبل التعديل، patchedCode = المقترح.
 * لا يخزّن أيًّا من النصّين — الأختام فقط.
 */
function makeAttempt(o) {
  o = o || {};
  const n = o.n > 0 ? o.n : 1;
  return {
    attemptId: newAttemptId(o),
    incidentId: o.incidentId,
    n,
    startedAt: isoNow(o.now),
    finishedAt: null,
    baseSha: isStr(o.baseCode) ? sha256(o.baseCode) : null,
    patchSha: isStr(o.patchedCode) ? sha256(o.patchedCode) : null,
    patchReason: isStr(o.reason) ? o.reason.slice(0, 2000) : "",
    healingResult: "SKIPPED",
    testRun: null
  };
}

/**
 * يُلحق نتيجة اختبار بمحاولة. الختم يُؤخذ من المحاولة نفسها (ما اختُبر) لا من المنادي.
 * يُرجع نسخة جديدة؛ لا يعدّل الأصل.
 */
function recordTestRun(attempt, results, o) {
  o = o || {};
  const passed = o.passed === true;
  const at = isoNow(o.now);
  return Object.assign({}, attempt, {
    finishedAt: at,
    healingResult: passed ? "PASS" : "FAIL",
    testRun: {
      runId: newRunId(o),
      attemptId: attempt.attemptId,
      baseSha: attempt.baseSha,
      patchSha: attempt.patchSha,
      startedAt: attempt.startedAt,
      finishedAt: at,
      passed,
      results: results === undefined ? null : results
    }
  });
}

/**
 * هل نتيجة اختبار هذه المحاولة دليلٌ على هذا الزوج (baseCode, patchedCode) بالذات؟
 * يعيد حساب الأختام من النصّين الفعليين ويقارنها بما اختُبر.
 * @returns {{ok:boolean, reasons:string[]}}
 */
function verifyEvidence(attempt, baseCode, patchedCode) {
  const reasons = [];
  if (!isObj(attempt)) return { ok: false, reasons: ["NO_ATTEMPT"] };
  const run = attempt.testRun;
  if (attempt.legacy === true || (run && run.unbound === true)) reasons.push("LEGACY_UNBOUND");
  if (!isObj(run)) reasons.push("NO_TESTS");
  if (!isStr(baseCode) || !isStr(patchedCode)) reasons.push("CODE_MISSING");
  if (reasons.length) return { ok: false, reasons };

  if (run.passed !== true) reasons.push("TESTS_NOT_PASSED");
  if (run.attemptId !== attempt.attemptId) reasons.push("RUN_FOR_OTHER_ATTEMPT");
  if (!SHA_RE.test(String(run.baseSha)) || !SHA_RE.test(String(run.patchSha))) reasons.push("RUN_NOT_STAMPED");
  if (run.baseSha !== attempt.baseSha || run.patchSha !== attempt.patchSha) reasons.push("RUN_STAMP_MISMATCH_ATTEMPT");
  if (sha256(baseCode) !== run.baseSha) reasons.push("BASE_CODE_CHANGED_SINCE_TEST");
  if (sha256(patchedCode) !== run.patchSha) reasons.push("PATCH_DIFFERS_FROM_TESTED");
  return { ok: reasons.length === 0, reasons };
}

/**
 * هل يجوز اعتماد حادثة بهذا الكود؟ شروط: الحالة PENDING_REVIEW، ودليل المحاولة *الأحدث* فقط
 * (نتائج محاولة أقدم لا تبرّر تعديلًا أحدث)، وتطابق الأختام.
 * @returns {{ok:boolean, reasons:string[], attemptId?:string}}
 */
function approvalCheck(entry, baseCode, patchedCode, attemptId) {
  if (!isObj(entry)) return { ok: false, reasons: ["NO_ENTRY"] };
  if (entry.status !== "PENDING_REVIEW") return { ok: false, reasons: ["STATUS_" + entry.status] };
  const list = Array.isArray(entry.attempts) ? entry.attempts : [];
  if (!list.length) return { ok: false, reasons: ["NO_ATTEMPTS"] };
  const latest = list.reduce((m, a) => (a.n > m.n ? a : m), list[0]);
  const target = attemptId || latest.attemptId;
  if (target !== latest.attemptId) return { ok: false, reasons: ["ATTEMPT_SUPERSEDED"], attemptId: target };
  const ev = verifyEvidence(latest, baseCode, patchedCode);
  return { ok: ev.ok, reasons: ev.reasons, attemptId: latest.attemptId };
}

function canTransition(from, to) {
  return Object.prototype.hasOwnProperty.call(TRANSITIONS, from) && TRANSITIONS[from].indexOf(to) >= 0;
}

// ─── تحقق وهجرة ──────────────────────────────────────────────────────

function validateAttempt(a, incidentId, errors, path) {
  if (!isObj(a)) { errors.push(path + ": ليست كائنًا"); return; }
  if (!ATTEMPT_ID_RE.test(String(a.attemptId))) errors.push(path + ".attemptId غير صالح");
  if (a.incidentId !== incidentId) errors.push(path + ".incidentId لا يطابق الحادثة");
  if (!(a.n >= 1) || Math.floor(a.n) !== a.n) errors.push(path + ".n غير صالح");
  if (!CANON_TS_RE.test(String(a.startedAt))) errors.push(path + ".startedAt ليس بالصيغة الموحّدة");
  if (a.finishedAt !== null && a.finishedAt !== undefined && !CANON_TS_RE.test(String(a.finishedAt))) errors.push(path + ".finishedAt ليس بالصيغة الموحّدة");
  for (const k of ["baseSha", "patchSha"]) {
    if (a[k] !== null && a[k] !== undefined && !SHA_RE.test(String(a[k]))) errors.push(path + "." + k + " ليس SHA-256");
  }
  if (RESULTS.indexOf(a.healingResult) < 0) errors.push(path + ".healingResult غير معروف");
  for (const k of Object.keys(a)) if (ATTEMPT_FIELDS.indexOf(k) < 0) errors.push(path + ": حقل غير معروف " + k);
  const r = a.testRun;
  if (r !== null && r !== undefined) {
    if (!isObj(r)) { errors.push(path + ".testRun ليس كائنًا"); return; }
    for (const k of Object.keys(r)) if (TESTRUN_FIELDS.indexOf(k) < 0) errors.push(path + ".testRun: حقل غير معروف " + k);
    if (r.unbound !== true) {
      if (!RUN_ID_RE.test(String(r.runId))) errors.push(path + ".testRun.runId غير صالح");
      if (r.attemptId !== a.attemptId) errors.push(path + ".testRun.attemptId لا يطابق المحاولة");
      if (r.baseSha !== a.baseSha || r.patchSha !== a.patchSha) errors.push(path + ".testRun مختوم بكود غير كود المحاولة");
      if (typeof r.passed !== "boolean") errors.push(path + ".testRun.passed ليس منطقيًا");
    }
  }
}

/**
 * يتحقق من مدخل سجل (v1 القديم أو v2). v1 صالح إن طابق قوائم التعداد؛ attempts اختيارية.
 * @returns {{ok:boolean, errors:string[]}}
 */
function validateEntry(e) {
  const errors = [];
  if (!isObj(e)) return { ok: false, errors: ["المدخل ليس كائنًا"] };
  if (!INCIDENT_ID_RE.test(String(e.id))) errors.push("id غير صالح");
  if (!isStr(e.timestamp) || canonicalTime(e.timestamp) === null) errors.push("timestamp غير صالح");
  if (TYPES.indexOf(e.type) < 0) errors.push("type غير معروف");
  if (STATUSES.indexOf(e.status) < 0) errors.push("status غير معروف");
  if (RESULTS.indexOf(e.healingResult) < 0) errors.push("healingResult غير معروف");
  for (const k of Object.keys(e)) if (ENTRY_FIELDS.indexOf(k) < 0) errors.push("حقل غير معروف: " + k);
  if (e.attempts !== undefined) {
    if (!Array.isArray(e.attempts)) errors.push("attempts ليست مصفوفة");
    else {
      const ids = new Set();
      e.attempts.forEach((a, i) => {
        validateAttempt(a, e.id, errors, "attempts[" + i + "]");
        if (isObj(a)) {
          if (ids.has(a.attemptId)) errors.push("attempts[" + i + "]: attemptId مكرر");
          ids.add(a.attemptId);
          if (a.n !== i + 1) errors.push("attempts[" + i + "].n يجب أن يكون " + (i + 1));
        }
      });
      if (e.currentAttemptId !== undefined && e.attempts.length && !ids.has(e.currentAttemptId)) {
        errors.push("currentAttemptId ليس ضمن attempts");
      }
    }
  }
  return { ok: errors.length === 0, errors };
}

/**
 * يهاجر مدخل v1 إلى v2 دون فقد: لا يعدّل الأصل، ولا يخترع أختامًا لا نملك مصدرها.
 * محاولة الهجرة تُوسَم legacy ونتيجة اختبارها unbound فلا تصلح دليل اعتماد.
 */
function migrateEntry(e) {
  if (!isObj(e) || Array.isArray(e.attempts)) return e;
  const out = Object.assign({}, e);
  out.updatedAt = canonicalTime(e.approvedAt) || canonicalTime(e.rejectedAt) || canonicalTime(e.timestamp) || null;
  const hasWork = e.healingResult !== "SKIPPED" || e.patch || e.patchedCode;
  if (hasWork && INCIDENT_ID_RE.test(String(e.id))) {
    const attemptId = "SHA_" + String(e.id).slice(3);          // اشتقاق ثابت: نفس الإدخال ⇒ نفس المعرّف
    const attempt = {
      attemptId: ATTEMPT_ID_RE.test(attemptId) ? attemptId : "SHA_" + sha256(String(e.id)).slice(0, 13).replace(/[a-f]/g, c => c.toUpperCase()),
      incidentId: e.id, n: 1,
      startedAt: canonicalTime(e.timestamp) || "1970-01-01T00:00:00.000Z",
      finishedAt: canonicalTime(e.timestamp),
      baseSha: null,
      patchSha: isStr(e.patchedCode) ? sha256(e.patchedCode) : null,
      patchReason: isStr(e.patchReason) ? e.patchReason : "",
      healingResult: RESULTS.indexOf(e.healingResult) >= 0 ? e.healingResult : "SKIPPED",
      testRun: e.testResults ? { unbound: true, passed: e.healingResult === "PASS", results: e.testResults } : null,
      legacy: true
    };
    out.attempts = [attempt];
    out.currentAttemptId = attempt.attemptId;
  } else {
    out.attempts = [];
  }
  return out;
}

function describe() {
  return { schemaVersion: SCHEMA_VERSION, types: TYPES.slice(), statuses: STATUSES.slice(), results: RESULTS.slice(),
           transitions: TRANSITIONS, legacyFields: LEGACY_FIELDS.slice(), v2Fields: V2_FIELDS.slice(),
           attemptFields: ATTEMPT_FIELDS.slice(), testRunFields: TESTRUN_FIELDS.slice() };
}

const HealingLogSchema = {
  SCHEMA_VERSION, TYPES, STATUSES, RESULTS, TRANSITIONS, LEGACY_FIELDS, V2_FIELDS, ENTRY_FIELDS,
  ATTEMPT_FIELDS, TESTRUN_FIELDS,
  sha256, canonicalTime, newIncidentId, newAttemptId, newRunId,
  makeAttempt, recordTestRun, verifyEvidence, approvalCheck, canTransition,
  validateEntry, migrateEntry, describe
};

global.HealingLogSchema = HealingLogSchema;
if (typeof module !== "undefined" && module.exports) module.exports = HealingLogSchema;

})(typeof window !== "undefined" ? window : (typeof global !== "undefined" ? global : {}));
