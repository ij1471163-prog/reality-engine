"use strict";

// Regression (B): decide() called with a deterministic patch AND a Claude
// suggestion that failed verification. When nothing is left in aiNeeded and
// re-analysis succeeded, the result was SAFE_AUTO_FIX with a hard-coded
// fileFullyResolved=false — a contradiction a consumer cannot interpret.
// runPipelineAsync never reaches this branch (it only passes verified
// candidates), but decide() is public API.

const test = require("node:test");
const assert = require("node:assert/strict");

const O = require("../public/reality_orchestrator.js");

const PATCHED = "let a = 1;\n";
const AI_PHASE = { decision: "AI_SUGGESTION", patch: "const a = 1;\n", source: null };
const FAILED_AI_VERIFY = { valid: false, improved: false, reason: "REJECTED" };
const DET_VERIFY = { valid: true, improved: true };

function fallback(extra) {
  return Object.assign({ phase: "FALLBACK", safeRepairs: [{ line: 1, title: "var" }],
    aiNeeded: [], verifiedCode: PATCHED, verifyResult: DET_VERIFY,
    remainingIssues: [], claudeFallback: false, reanalysisFailed: false }, extra);
}

test("B: rejected Claude patch, nothing left → SAFE_AUTO_FIX is consistent", () => {
  const d = O.decide(fallback(), FAILED_AI_VERIFY, AI_PHASE);

  assert.equal(d.decision, "SAFE_AUTO_FIX", d.reason);
  assert.equal(d.patch, PATCHED);                    // deterministic, not Claude's
  assert.equal(d.meta.fileFullyResolved, true);
  assert.equal(d.meta.partial, false);
  assert.equal(d.meta.aiRequiredCount, 0);
  assert.equal(d.meta.reanalysisFailed, false);
  assert.equal(d.meta.aiSuggestionRejected, true);
  assert.equal(d.meta.origin, "DETERMINISTIC");
  assert.equal(d.meta.aiGenerated, false);
});

test("B invariant: SAFE_AUTO_FIX never carries fileFullyResolved=false or aiNeeded", () => {
  const cases = [
    [fallback(), FAILED_AI_VERIFY, AI_PHASE],
    [fallback({ aiNeeded: [{ line: 2, title: "X" }] }), FAILED_AI_VERIFY, AI_PHASE],
    [fallback({ reanalysisFailed: true }), FAILED_AI_VERIFY, AI_PHASE],
    [fallback(), null, null],
    [fallback({ aiNeeded: [{ line: 2, title: "X" }] }), null, null],
  ];
  for (const [f, v, a] of cases) {
    const d = O.decide(f, v, a);
    if (d.decision === "SAFE_AUTO_FIX") {
      assert.equal(d.meta.fileFullyResolved, true, d.reason);
      assert.equal((d.meta.aiNeeded || []).length, 0, d.reason);
    }
  }
});

test("B: unchanged — aiNeeded left → PARTIAL_FIX; reanalysisFailed → PARTIAL_FIX", () => {
  assert.equal(O.decide(fallback({ aiNeeded: [{ line: 2, title: "X" }] }),
    FAILED_AI_VERIFY, AI_PHASE).decision, "PARTIAL_FIX");
  const d = O.decide(fallback({ reanalysisFailed: true }), FAILED_AI_VERIFY, AI_PHASE);
  assert.equal(d.decision, "PARTIAL_FIX");
  assert.equal(d.meta.reanalysisFailed, true);
});

test("B: unchanged — policy blocks the deterministic patch → REJECTED", () => {
  const d = O.decide(fallback({ verifyResult: { valid: false, improved: false } }),
    FAILED_AI_VERIFY, AI_PHASE);
  assert.equal(d.decision, "REJECTED");
  assert.equal(d.patch, null);
  assert.equal(d.meta.fileFullyResolved, false);
});
