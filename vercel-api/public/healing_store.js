/**
 * healing_store.js v2.0 — تخزين دائم لسجل self_healing_engine (مخطط v2: محاولات + أختام أدلة)
 * ══════════════════════════════════════════════════════════════════════
 * لماذا ملف مستقل؟ self_healing_engine.js فوق 1000 سطر، والتخزين الدائم له أسباب
 * تغيّر مستقلة (متصفح / ملف / حصة / ترحيل مخطط). فُصل كي لا يكبر المحرك ولا يتأثر
 * عند تغيير طريقة الحفظ.
 *
 * عقود الأمان (لا تُخفَّف):
 *  1. السجل المستعاد تاريخٌ للقراءة لا مصدر ثقة. patchedCode لا يُحفظ ولا يُستعاد أبدًا،
 *     فـapprove() على حادثة مستعادة تُرفض (لا patch مُختبَر) — fail-closed.
 *  2. كل مدخل يُتحقَّق منه بقائمة حقول بيضاء ولا تُنسخ حقول مجهولة (يمنع تلويث الكائنات).
 *  3. التخزين لا يرمي أبدًا: أي فشل (حصة، قرص، ملف تالف) يُرجَع كحالة {ok:false,error}
 *     ولا يعطّل المحرك. الملف التالف يُحفظ بنسخة .bad ولا يُكتب فوقه بصمت.
 *  4. لا require ولا fs داخل الملف: الواجهات تُمرَّر حقنًا، فيعمل في vm والمتصفح وNode.
 *  5. [v2] أدلة الاختبار لا تضيع ولا تُزوَّر عبر التخزين: attempts/أختام SHA-256 تُحفظ
 *     وتُستعاد كما هي، وأي محاولة ختمها لا يطابق محاولتها (أو معرّفاتها/تسلسلها مكسور)
 *     ترفض معها الحادثة كلها وتظهر في dropped/skipped — لا حفظ صامت لدليل مشكوك فيه،
 *     ولا إسقاط صامت لحادثة.
 *  6. [v2] ملف بإصدار مخطط 2.x لا يقرؤه مخزن قديم (يرفضه بدل أن يُسقط attempts بصمت).
 *
 * مسؤوليات المكوّنات (لا تداخل):
 *  • وحدة السياسة (HealingLogPolicy) = *ماذا* يُحفظ: حجب الأسرار (sanitizeEntry) وقرار البقاء/الأرشفة/
 *    الحذف (applyRetention: عمر، عدد، حجم، حماية PENDING_REVIEW، أرشيف مضغوط).
 *  • healing_store.js (هذا الملف) = *كيف* يُحفظ: تحقق وتسلسل وكتابة ذرّية واستعادة.
 *    سقفاه (maxEntries/maxBytes) شبكة أمان لحصة الوسيط فقط، وقيمتاهما الافتراضيتان تساويان
 *    افتراضيّي السياسة، فلا يُفعَّلان فعليًا إن طُبّقت السياسة قبل الحفظ. وإن فُعِّلا فلا
 *    حذف صامت: يُذكر في النتيجة (trimmedIds) ويُقدَّم حذف غير المعلّق، ثم الأقدم.
 *    والأرشيف الذي تُنتجه السياسة يُحفظ هنا (حقل archive) ولا يُقرَّر هنا.
 *  • الترتيب المتوقع عند الربط: sanitize → applyRetention → store.save(live, archive).
 *    ويمكن تمرير sanitize لـcreateStore كي يُطبَّق داخل save فلا يُنسى.
 *
 * غير مربوط بأي شيء: لا يُحمَّل من index.html ولا من قوائم الخادم. المحرك يستعمله
 * فقط إذا استُدعيت SelfHealing.attachStore(...) صراحةً.
 * ══════════════════════════════════════════════════════════════════════
 */
"use strict";

(function (global) {

const SCHEMA_VERSION = "2.0.0";
const DEFAULT_MAX_ENTRIES = 200;
const DEFAULT_MAX_ARCHIVE = 1000;
const DEFAULT_MAX_BYTES   = 1500000;   // أقل بكثير من حصة localStorage (~5MB)
const MAX_FIELD_BYTES     = 100000;    // سقف لكل حقل مركّب (testResults / patch / testRun.results)
const MAX_ATTEMPTS        = 50;        // محاولات لكل حادثة (n متسلسل، فلا قصّ جزئي)

const TYPES    = ["ENGINE_ERROR", "ENGINE_CONFLICT", "REGRESSION", "ACCUMULATION",
                  "FOREACH_RETURN", "SQL_INJECTION", "SYNTAX", "RUNTIME_ERROR", "ENGINE_SELF_DEFECT"];
const STATUSES = ["PENDING_REVIEW", "APPROVED", "REJECTED", "ROLLED_BACK"];
const RESULTS  = ["PASS", "FAIL", "SKIPPED"];

// نفس نصّ القالب healing_log.json (توثيق الحقول) + حقول v2 — يُكتب في كل ملف محفوظ
const FIELDS_DOC = {
  id:            "معرف فريد SH_{timestamp}_{random}",
  timestamp:     "وقت الحادثة ISO8601",
  type:          "نوع المشكلة: " + TYPES.join(" | "),
  engine:        "المحرك المتأثر",
  fileName:      "اسم الملف",
  detail:        "وصف المشكلة",
  status:        STATUSES.join(" | "),
  healingResult: RESULTS.join(" | "),
  testResults:   "نتائج كل الاختبارات",
  patch:         "الـ diff (سطور متغيرة)",
  patchedCode:   "الكود المقترح (قبل الموافقة فقط) — لا يُحفظ في التخزين الدائم",
  approvedAt:    "وقت الموافقة (إذا أُقرّ)",
  rejectedAt:    "وقت الرفض (إذا رُفض)",
  rollbackMsg:   "سبب الـ Rollback (إذا فشل)",
  updatedAt:     "آخر تحديث للحادثة ISO8601 [v2]",
  attempts:      "محاولات الإصلاح؛ لكل منها معرّف SHA_… وأختام SHA-256 للكود الأصلي والمعدَّل ونتيجة اختبار مختومة بهما [v2]",
  currentAttemptId: "معرّف المحاولة الحالية ضمن attempts [v2]",
  redaction:     "ملخّص ما حُجب من أسرار: عدد وفئات فقط، بلا قيم [v2]"
};

// الحقول المقبولة (تُقارَن في الاختبارات بـHealingLogSchema كي لا يتفرّق المخزن عن المخطط)
const ENTRY_FIELDS   = ["id", "timestamp", "type", "engine", "fileName", "detail", "status", "healingResult",
  "testResults", "patch", "approvedAt", "rejectedAt", "applyFailedAt", "rollbackMsg", "applyError", "note",
  "patchReason", "restored", "updatedAt", "attempts", "currentAttemptId", "redaction"];
const ATTEMPT_FIELDS = ["attemptId", "incidentId", "n", "startedAt", "finishedAt", "baseSha", "patchSha",
  "patchReason", "healingResult", "testRun", "legacy"];
const TESTRUN_FIELDS = ["runId", "attemptId", "baseSha", "patchSha", "startedAt", "finishedAt", "passed", "results", "unbound"];
const ARCHIVE_FIELDS = ["id", "timestamp", "type", "engine", "fileName", "status", "healingResult",
  "approvedAt", "rejectedAt", "archivedAt", "archiveReason", "attemptId", "patchSha"];

const ID_RE         = /^SH_\d{10,16}_[A-Z0-9]{1,8}$/;
const ATTEMPT_ID_RE = /^SHA_\d{10,16}_[A-Z0-9]{4,8}$/;
const RUN_ID_RE     = /^SHR_\d{10,16}_[A-Z0-9]{4,8}$/;
const SHA_RE        = /^[0-9a-f]{64}$/;
const CANON_TS_RE   = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/;
const TS_RE         = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d/;

const isStr = v => typeof v === "string";
const isObj = v => v !== null && typeof v === "object" && !Array.isArray(v);
const cap   = (s, n) => (s.length > n ? s.slice(0, n) : s);
const tsOk  = v => isStr(v) && TS_RE.test(v) && !isNaN(Date.parse(v));

function jsonSize(v) {
  try { const s = JSON.stringify(v); return s === undefined ? 0 : s.length; } catch (_) { return Infinity; }
}
/** حقل مركّب آمن للتسلسل وبحجم محدود، وإلا علامة truncated. */
function boundedJson(v) {
  if (v === null || v === undefined) return null;
  const n = jsonSize(v);
  if (n === Infinity) return { truncated: true, reason: "غير قابل للتسلسل" };
  if (n > MAX_FIELD_BYTES) return { truncated: true, reason: "أكبر من " + MAX_FIELD_BYTES + " حرف", originalSize: n };
  return JSON.parse(JSON.stringify(v));   // نسخة عميقة تقطع أي مرجع خارجي
}

// ─── محاولات الإصلاح (v2) ────────────────────────────────────────────

/** @returns {{ok:true, attempt:Object}|{ok:false, error:string}} */
function normalizeAttempt(a, incidentId, n) {
  const bad = m => ({ ok: false, error: "attempts[" + (n - 1) + "]: " + m });
  if (!isObj(a)) return bad("ليست كائنًا");
  if (!isStr(a.attemptId) || !ATTEMPT_ID_RE.test(a.attemptId)) return bad("attemptId غير صالح");
  if (a.incidentId !== incidentId) return bad("incidentId لا يطابق الحادثة");
  if (a.n !== n) return bad("n يجب أن يكون " + n);
  if (!isStr(a.startedAt) || !CANON_TS_RE.test(a.startedAt)) return bad("startedAt ليس بالصيغة الموحّدة");
  if (a.finishedAt !== null && a.finishedAt !== undefined && !(isStr(a.finishedAt) && CANON_TS_RE.test(a.finishedAt))) return bad("finishedAt ليس بالصيغة الموحّدة");
  for (const k of ["baseSha", "patchSha"]) {
    if (a[k] !== null && a[k] !== undefined && !(isStr(a[k]) && SHA_RE.test(a[k]))) return bad(k + " ليس SHA-256");
  }
  if (RESULTS.indexOf(a.healingResult) < 0) return bad("healingResult غير معروف");

  const out = {
    attemptId: a.attemptId, incidentId, n,
    startedAt: a.startedAt,
    finishedAt: a.finishedAt === undefined ? null : a.finishedAt,
    baseSha: a.baseSha === undefined ? null : a.baseSha,
    patchSha: a.patchSha === undefined ? null : a.patchSha,
    patchReason: isStr(a.patchReason) ? cap(a.patchReason, 2000) : "",
    healingResult: a.healingResult
  };
  if (a.legacy === true) out.legacy = true;

  const r = a.testRun;
  if (r === null || r === undefined) { out.testRun = null; return { ok: true, attempt: out }; }
  if (!isObj(r)) return bad("testRun ليس كائنًا");
  if (r.unbound === true) {
    // سجل مهاجَر من v1: نتيجة بلا أختام. تُحفظ كما هي موسومة، ولا تصلح دليل اعتماد.
    out.testRun = { unbound: true, passed: r.passed === true, results: boundedJson(r.results) };
    return { ok: true, attempt: out };
  }
  if (!isStr(r.runId) || !RUN_ID_RE.test(r.runId)) return bad("testRun.runId غير صالح");
  if (r.attemptId !== a.attemptId) return bad("testRun.attemptId لا يطابق المحاولة");
  if (r.baseSha !== out.baseSha || r.patchSha !== out.patchSha) return bad("testRun مختوم بكود غير كود المحاولة");
  if (typeof r.passed !== "boolean") return bad("testRun.passed ليس منطقيًا");
  for (const k of ["startedAt", "finishedAt"]) {
    if (r[k] !== null && r[k] !== undefined && !(isStr(r[k]) && CANON_TS_RE.test(r[k]))) return bad("testRun." + k + " ليس بالصيغة الموحّدة");
  }
  out.testRun = {
    runId: r.runId, attemptId: r.attemptId, baseSha: r.baseSha, patchSha: r.patchSha,
    startedAt: r.startedAt === undefined ? null : r.startedAt,
    finishedAt: r.finishedAt === undefined ? null : r.finishedAt,
    passed: r.passed, results: boundedJson(r.results)
  };
  return { ok: true, attempt: out };
}

/**
 * يتحقق من مدخل ويُرجِع نسخة نظيفة بالحقول البيضاء فقط.
 * @returns {{ok:true, entry:Object}|{ok:false, error:string}}
 */
function normalizeEntry(raw, opts) {
  opts = opts || {};
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { ok: false, error: "المدخل ليس كائنًا" };
  if (!isStr(raw.id) || !ID_RE.test(raw.id)) return { ok: false, error: "id غير صالح" };
  if (!isStr(raw.timestamp) || !TS_RE.test(raw.timestamp) || isNaN(Date.parse(raw.timestamp))) {
    return { ok: false, error: "timestamp غير صالح" };
  }
  if (TYPES.indexOf(raw.type) < 0)             return { ok: false, error: "type غير معروف: " + String(raw.type).slice(0, 40) };
  if (STATUSES.indexOf(raw.status) < 0)        return { ok: false, error: "status غير معروف" };
  if (RESULTS.indexOf(raw.healingResult) < 0)  return { ok: false, error: "healingResult غير معروف" };

  const e = {
    id: raw.id,
    timestamp: raw.timestamp,
    type: raw.type,
    engine:   isStr(raw.engine)   ? cap(raw.engine, 200)   : "unknown",
    fileName: isStr(raw.fileName) ? cap(raw.fileName, 500) : "unknown",
    detail:   isStr(raw.detail)   ? cap(raw.detail, 4000)  : "",
    status: raw.status,
    healingResult: raw.healingResult,
    testResults: boundedJson(raw.testResults),
    patch: boundedJson(raw.patch)
  };
  for (const k of ["approvedAt", "rejectedAt", "applyFailedAt"]) {
    if (isStr(raw[k]) && TS_RE.test(raw[k])) e[k] = raw[k];
  }
  for (const k of ["rollbackMsg", "applyError", "note", "patchReason"]) {
    if (isStr(raw[k])) e[k] = cap(raw[k], 2000);
  }
  // patchedCode: لا يُحفظ ولا يُستعاد (عقد 1). يبقى فقط عند opts.keepPatchedCode (تصدير يدوي في الذاكرة)
  if (opts.keepPatchedCode && isStr(raw.patchedCode)) e.patchedCode = raw.patchedCode;

  // ── حقول v2 ──
  if (raw.updatedAt !== undefined) {
    if (!tsOk(raw.updatedAt)) return { ok: false, error: "updatedAt غير صالح" };
    e.updatedAt = raw.updatedAt;
  }
  if (raw.attempts !== undefined) {
    if (!Array.isArray(raw.attempts)) return { ok: false, error: "attempts ليست مصفوفة" };
    if (raw.attempts.length > MAX_ATTEMPTS) return { ok: false, error: "attempts أكثر من " + MAX_ATTEMPTS };
    const list = [], ids = new Set();
    for (let i = 0; i < raw.attempts.length; i++) {
      const r = normalizeAttempt(raw.attempts[i], raw.id, i + 1);
      if (!r.ok) return { ok: false, error: r.error };
      if (ids.has(r.attempt.attemptId)) return { ok: false, error: "attempts[" + i + "]: attemptId مكرر" };
      ids.add(r.attempt.attemptId);
      list.push(r.attempt);
    }
    e.attempts = list;
    if (raw.currentAttemptId !== undefined) {
      if (!isStr(raw.currentAttemptId) || !ids.has(raw.currentAttemptId)) return { ok: false, error: "currentAttemptId ليس ضمن attempts" };
      e.currentAttemptId = raw.currentAttemptId;
    }
  } else if (raw.currentAttemptId !== undefined) {
    return { ok: false, error: "currentAttemptId بلا attempts" };
  }
  if (raw.redaction !== undefined) {
    const r = raw.redaction;
    if (!isObj(r) || !(Number.isInteger(r.count) && r.count >= 0) || !Array.isArray(r.kinds) ||
        r.kinds.length > 50 || r.kinds.some(k => !isStr(k) || k.length > 40)) {
      return { ok: false, error: "redaction غير صالح" };
    }
    e.redaction = { count: r.count, kinds: r.kinds.slice() };
  }
  if (opts.restored) e.restored = true;
  return { ok: true, entry: e };
}

/** سجل أرشيف مضغوط (تُنتجه السياسة). يُرجع null إن لم يصلح. لا يحمل patch ولا كودًا. */
function normalizeArchiveRecord(raw) {
  if (!isObj(raw) || !isStr(raw.id) || !ID_RE.test(raw.id) || !tsOk(raw.timestamp) || !tsOk(raw.archivedAt)) return null;
  if (TYPES.indexOf(raw.type) < 0 || STATUSES.indexOf(raw.status) < 0 || RESULTS.indexOf(raw.healingResult) < 0) return null;
  const r = {
    id: raw.id, timestamp: raw.timestamp, type: raw.type,
    engine: isStr(raw.engine) ? cap(raw.engine, 200) : "unknown",
    fileName: isStr(raw.fileName) ? cap(raw.fileName, 500) : "unknown",
    status: raw.status, healingResult: raw.healingResult,
    approvedAt: tsOk(raw.approvedAt) ? raw.approvedAt : null,
    rejectedAt: tsOk(raw.rejectedAt) ? raw.rejectedAt : null,
    archivedAt: raw.archivedAt,
    archiveReason: isStr(raw.archiveReason) ? cap(raw.archiveReason, 200) : ""
  };
  if (isStr(raw.attemptId) && ATTEMPT_ID_RE.test(raw.attemptId)) r.attemptId = raw.attemptId;
  if (isStr(raw.patchSha) && SHA_RE.test(raw.patchSha)) r.patchSha = raw.patchSha;
  return r;
}

function restoreArchive(rawList, max) {
  const out = [], seen = new Set();
  let dropped = 0;
  for (const raw of Array.isArray(rawList) ? rawList : []) {
    const r = normalizeArchiveRecord(raw);
    if (!r || seen.has(r.id)) { dropped++; continue; }
    seen.add(r.id);
    out.push(r);
  }
  out.sort((a, b) => Date.parse(b.archivedAt) - Date.parse(a.archivedAt));
  const limit = max || DEFAULT_MAX_ARCHIVE;
  if (out.length > limit) { dropped += out.length - limit; out.length = limit; }
  return { archive: out, dropped };
}

/**
 * فهارس ما يُحذف عند تجاوز السقف: غير المعلّق الأقدم أولًا، ثم المعلّق الأقدم.
 * (نفس منطق السياسة: PENDING_REVIEW ينتظر قرارًا بشريًا فلا يُضحّى به قبل غيره)
 */
function pickDrops(list, n) {
  return list.map((e, i) => ({ i, pending: e && e.status === "PENDING_REVIEW" ? 1 : 0, t: Date.parse(e && e.timestamp) || 0 }))
    .sort((a, b) => (a.pending - b.pending) || (a.t - b.t) || (b.i - a.i))
    .slice(0, n).map(x => x.i);
}

/** @returns {{entries:Array, dropped:Array<{index:number, reason:string}>}} */
function restoreEntries(rawList, max) {
  let entries = [];
  const dropped = [];
  const seen = new Set();
  const list = Array.isArray(rawList) ? rawList : [];
  list.forEach((raw, index) => {
    const r = normalizeEntry(raw, { restored: true });
    if (!r.ok) { dropped.push({ index, reason: r.error }); return; }
    if (seen.has(r.entry.id)) { dropped.push({ index, reason: "id مكرر" }); return; }
    seen.add(r.entry.id);
    entries.push(r.entry);
  });
  const limit = max || DEFAULT_MAX_ENTRIES;
  if (entries.length > limit) {
    const kill = new Set(pickDrops(entries, entries.length - limit));
    entries.forEach((e, i) => { if (kill.has(i)) dropped.push({ index: -1, reason: "تجاوز الحد الأقصى — " + e.id }); });
    entries = entries.filter((_, i) => !kill.has(i));
  }
  entries.sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp));
  return { entries, dropped };
}

/**
 * يُسلسل السجل (والأرشيف). لا يرمي. يُرجع النص وما تعذّر حفظه صراحةً.
 * @param {Object} [opts] { sanitize(entry)→entry|null, maxArchive }
 */
function serializeDetailed(entries, meta, archive, opts) {
  opts = opts || {};
  const clean = [], kept = [], skipped = [];
  for (const raw of entries || []) {
    let src = raw;
    if (typeof opts.sanitize === "function") {
      try { src = opts.sanitize(raw); } catch (e) { skipped.push({ id: raw && raw.id, error: "sanitize فشل: " + e.message }); continue; }
      if (!src) { skipped.push({ id: raw && raw.id, error: "sanitize أعاد فارغًا" }); continue; }
    }
    const r = normalizeEntry(src, {});
    if (!r.ok) { skipped.push({ id: raw && raw.id, error: r.error }); continue; }
    if (raw && raw.restored === true) r.entry.restored = true;
    clean.push(r.entry);
    kept.push(raw);
  }
  const arch = restoreArchive(archive, opts.maxArchive);
  const text = JSON.stringify({
    _meta: {
      version: SCHEMA_VERSION,
      description: "Reality Engine — Self-Healing Log",
      engineVersion: (meta && meta.engineVersion) || null,
      savedAt: new Date().toISOString(),
      fields: FIELDS_DOC
    },
    entries: clean,
    archive: arch.archive
  }, null, 2);
  return { text, skipped, kept, archive: arch.archive };
}

function serialize(entries, meta, archive, opts) {
  return serializeDetailed(entries, meta, archive, opts).text;
}

/** يقبل {_meta, entries[, archive]} أو مصفوفة خام. لا يرمي أبدًا. */
function parse(text, max, maxArchive) {
  if (!isStr(text) || !text.trim()) return { ok: false, error: "نص فارغ", entries: [], dropped: [], archive: [] };
  let data;
  try { data = JSON.parse(text); } catch (e) { return { ok: false, error: "JSON تالف: " + e.message, entries: [], dropped: [], archive: [], corrupt: true }; }
  let list, archRaw = [];
  if (Array.isArray(data)) list = data;
  else if (data && typeof data === "object" && Array.isArray(data.entries)) {
    const v = data._meta && data._meta.version;
    if (isStr(v) && parseInt(v, 10) > parseInt(SCHEMA_VERSION, 10)) {
      return { ok: false, error: "إصدار مخطط أحدث (" + v + ") من المدعوم (" + SCHEMA_VERSION + ")", entries: [], dropped: [], archive: [] };
    }
    list = data.entries;
    if (Array.isArray(data.archive)) archRaw = data.archive;
  } else {
    return { ok: false, error: "الشكل غير معروف (لا entries)", entries: [], dropped: [], archive: [], corrupt: true };
  }
  const r = restoreEntries(list, max);
  const a = restoreArchive(archRaw, maxArchive);
  return { ok: true, entries: r.entries, dropped: r.dropped, archive: a.archive, archiveDropped: a.dropped };
}

// ─── Backends ────────────────────────────────────────────────────────
// الواجهة: { kind, read():string|null, write(text), clear(), quarantine?(text) } — قد ترمي؛ الـstore يلتقط.

function memoryBackend() {
  let cell = null;
  return { kind: "memory", read: () => cell, write: t => { cell = String(t); }, clear: () => { cell = null; }, quarantine: () => {} };
}

function localStorageBackend(storage, key) {
  const k = key || "re_healing_log_v1";
  if (!storage || typeof storage.getItem !== "function") throw new Error("storage غير صالح");
  return {
    kind: "localStorage",
    read:  () => storage.getItem(k),
    write: t => storage.setItem(k, t),
    clear: () => storage.removeItem(k),
    quarantine: t => { storage.setItem(k + ":bad", cap(String(t), 200000)); }
  };
}

/** fileBackend({fs, file}) — fs يُمرَّر حقنًا؛ كتابة ذرّية (tmp ثم rename). */
function fileBackend(o) {
  if (!o || !o.fs || !isStr(o.file)) throw new Error("fs وfile مطلوبان");
  const fs = o.fs, file = o.file;
  return {
    kind: "file",
    read:  () => (fs.existsSync(file) ? fs.readFileSync(file, "utf8") : null),
    write: t => {
      const tmp = file + ".tmp-" + Date.now() + "-" + Math.random().toString(36).slice(2, 8);
      try { fs.writeFileSync(tmp, t, "utf8"); fs.renameSync(tmp, file); }
      catch (e) { try { fs.unlinkSync(tmp); } catch (_) { /* لا شيء */ } throw e; }
    },
    clear: () => { if (fs.existsSync(file)) fs.unlinkSync(file); },
    quarantine: () => { if (fs.existsSync(file)) fs.renameSync(file, file + ".bad-" + Date.now()); }
  };
}

// ─── Store ───────────────────────────────────────────────────────────

/**
 * @param {Object} [opts] { backend, max, maxBytes, maxArchive, engineVersion,
 *                          sanitize(entry)→entry|null  // يُطبَّق على كل مدخل داخل save }
 */
function createStore(opts) {
  opts = opts || {};
  const backend = opts.backend || memoryBackend();
  const max = opts.max > 0 ? opts.max : DEFAULT_MAX_ENTRIES;
  const maxBytes = opts.maxBytes > 0 ? opts.maxBytes : DEFAULT_MAX_BYTES;
  const maxArchive = opts.maxArchive > 0 ? opts.maxArchive : DEFAULT_MAX_ARCHIVE;
  const engineVersion = opts.engineVersion || null;
  const sanitize = typeof opts.sanitize === "function" ? opts.sanitize : null;
  const store = { lastError: null, kind: backend.kind, lastTrim: null };
  let archiveCache = null;     // آخر أرشيف محمَّل/محفوظ — يُحفظ كما هو عندما يستدعي المحرك save(list) بلا أرشيف

  store.load = function () {
    let text;
    try { text = backend.read(); } catch (e) { store.lastError = "قراءة: " + e.message; return { ok: false, error: store.lastError, entries: [], dropped: [], archive: [] }; }
    if (text === null || text === undefined || text === "") { store.lastError = null; archiveCache = []; return { ok: true, entries: [], dropped: [], archive: [] }; }
    const r = parse(text, max, maxArchive);
    if (!r.ok) {
      store.lastError = r.error;
      let quarantined = false;
      if (r.corrupt && typeof backend.quarantine === "function") {
        try { backend.quarantine(text); quarantined = true; } catch (_) { /* نبقي الأصل */ }
      }
      return { ok: false, error: r.error, entries: [], dropped: [], archive: [], quarantined };
    }
    store.lastError = null;
    archiveCache = r.archive;
    return r;
  };

  function existingArchive() {
    if (archiveCache) return archiveCache;
    try {
      const t = backend.read();
      if (isStr(t) && t) { const r = parse(t, max, maxArchive); if (r.ok) return r.archive; }
    } catch (_) { /* لا أرشيف سابق قابل للقراءة */ }
    return [];
  }

  /**
   * @param {Array} entries السجل الحي (الأحدث أولًا)
   * @param {Array} [archive] أرشيف السياسة. إن حُذف يُحفظ الأرشيف السابق كما هو (لا يُمحى بصمت).
   */
  store.save = function (entries, archive) {
    let list = (entries || []).slice();
    const trimmedIds = [];
    const dropOldest = n => {
      const kill = new Set(pickDrops(list, n));
      list.forEach((e, i) => { if (kill.has(i)) trimmedIds.push(e && e.id); });
      list = list.filter((_, i) => !kill.has(i));
    };
    if (list.length > max) dropOldest(list.length - max);

    const arch = archive === undefined ? existingArchive() : archive;
    const sopts = { sanitize, maxArchive };
    let res = serializeDetailed(list, { engineVersion }, arch, sopts);
    while (res.text.length > maxBytes && list.length > 0) {
      dropOldest(Math.max(1, Math.ceil(list.length / 4)));
      res = serializeDetailed(list, { engineVersion }, arch, sopts);
    }
    store.lastTrim = trimmedIds.length ? { ids: trimmedIds.slice(), at: new Date().toISOString() } : null;
    try { backend.write(res.text); }
    catch (e) {
      store.lastError = "كتابة: " + e.message;
      return { ok: false, error: store.lastError, saved: 0, trimmed: trimmedIds.length, trimmedIds, skipped: res.skipped };
    }
    archiveCache = res.archive;
    store.lastError = null;
    return { ok: true, saved: res.kept.length, trimmed: trimmedIds.length, trimmedIds, skipped: res.skipped, archived: res.archive.length };
  };

  store.clear = function () {
    try { backend.clear(); store.lastError = null; archiveCache = null; return { ok: true }; }
    catch (e) { store.lastError = "مسح: " + e.message; return { ok: false, error: store.lastError }; }
  };

  store.parse = text => parse(text, max, maxArchive);
  store.serialize = (list, archive) => serialize(list, { engineVersion }, archive, { sanitize, maxArchive });
  return store;
}

const HealingStore = {
  SCHEMA_VERSION, TYPES, STATUSES, RESULTS, FIELDS_DOC,
  FIELDS: { entry: ENTRY_FIELDS, attempt: ATTEMPT_FIELDS, testRun: TESTRUN_FIELDS, archive: ARCHIVE_FIELDS },
  DEFAULTS: { maxEntries: DEFAULT_MAX_ENTRIES, maxArchive: DEFAULT_MAX_ARCHIVE, maxBytes: DEFAULT_MAX_BYTES },
  normalizeEntry, normalizeAttempt, normalizeArchiveRecord, restoreEntries, restoreArchive,
  serialize, serializeDetailed, parse,
  memoryBackend, localStorageBackend, fileBackend, createStore
};

global.HealingStore = HealingStore;
if (typeof module !== "undefined" && module.exports) module.exports = HealingStore;

})(typeof window !== "undefined" ? window : (typeof global !== "undefined" ? global : {}));
