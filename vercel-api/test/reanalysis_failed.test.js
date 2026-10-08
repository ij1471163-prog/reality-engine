"use strict";

// Regression: when re-analysis fails after a verified patch, the file's state
// is unknown. The result must never be SAFE_AUTO_FIX, the failure must reach
// decision.meta, and critical issues from the last trusted list must stay in
// aiNeeded instead of being hidden.
//
// Before the fix, _withUnclaimedCritical() received null after a failed
// re-analysis and decide() never read reanalysisFailed, so a repair engine
// that fixed `var` and silently declined a critical issue produced
// SAFE_AUTO_FIX with fileFullyResolved=true and the injection still in the patch.

const test = require("node:test");
const assert = require("node:assert/strict");

const ORCH = require.resolve("../public/reality_orchestrator.js");

// Fresh orchestrator (own engine registry) per test.
function freshOrchestrator() {
  delete require.cache[ORCH];
  return require(ORCH);
}

const CODE    = 'var a = 1;\nexec("ls " + input);\n';
const PATCHED = 'let a = 1;\nexec("ls " + input);\n';
const CRITICAL = { line: 2, title: "Command Injection", sev: "c", type: "js", ev: 'exec("ls " + input);' };
const VAR      = { line: 1, title: "var usage", sev: "l", type: "js", ev: "var a = 1;" };

// reanalysis: 'ok' | 'fail'; patchedIssues: what the analyzer reports on PATCHED.
function setup(O, { reanalysis, patchedIssues }) {
  let calls = 0;
  // The verifier analyzes PATCHED first (call 1); the orchestrator's
  // re-analysis is call 2. A transient failure there is the A case.
  O.registerEngine("an", O.EngineType.ANALYZER, (code) => {
    if (code === PATCHED) {
      calls++;
      if (reanalysis === "fail" && calls === 2) throw new Error("analyzer crashed");
      return patchedIssues;
    }
    return [VAR, ...patchedIssues];
  }, ["*"]);
  // Fixes `var`, silently declines the critical issue (no aiNeeded) — the shape
  // of repairCode's `if (!strat) return;` and tracked-line skips.
  O.registerEngine("rep", O.EngineType.REPAIR, (code) => ({
    repaired: code === CODE ? PATCHED : code,
    repairs: code === CODE ? [{ line: 1, title: "var usage", strategy: "VAR_USAGE" }] : [],
    aiNeeded: [],
  }), ["*"]);
  O.registerEngine("ver", O.EngineType.VERIFIER, (before, after, fn) => {
    O.getEngine("an").fn(after, fn);
    return { valid: true, improved: true, reason: "ok" };
  }, ["code-verification"]);
}

function assertStalePartial(d) {
  assert.notEqual(d.decision, "SAFE_AUTO_FIX", d.reason);
  assert.equal(d.decision, "PARTIAL_FIX", d.reason);
  assert.equal(d.patch, null);
  assert.equal(d.meta.fileFullyResolved, false);
  assert.equal(d.meta.reanalysisFailed, true);
  assert.equal(d.meta.remainingIssuesStale, true);
  assert.equal(d.meta.deterministicPatch, PATCHED);
  assert.match(d.reason, /re-analysis failed/);
}

test("A2 runPipelineAsync: failed re-analysis → PARTIAL_FIX, critical stays in aiNeeded", async () => {
  const O = freshOrchestrator();
  setup(O, { reanalysis: "fail", patchedIssues: [CRITICAL] });
  const r = await O.runPipelineAsync(CODE, "x.js", { useFallbackChain: true });

  assert.equal(r.phases.fallback.reanalysisFailed, true);
  assertStalePartial(r.decision);
  assert.match(r.decision.meta.aiNeeded.map(a => a.title).join(), /Command Injection/);
});

test("A3 runPipeline (sync, runRepair path): failed re-analysis → PARTIAL_FIX", () => {
  const O = freshOrchestrator();
  setup(O, { reanalysis: "fail", patchedIssues: [CRITICAL] });
  const r = O.runPipeline(CODE, "x.js", { useFallbackChain: false });

  assert.equal(r.phases.repair.reanalysisFailed, true);
  assertStalePartial(r.decision);
  assert.match(r.decision.meta.aiNeeded.map(a => a.title).join(), /Command Injection/);
});

test("failed re-analysis with no critical issue known → still not SAFE_AUTO_FIX", async () => {
  const O = freshOrchestrator();
  setup(O, { reanalysis: "fail", patchedIssues: [] });
  const r = await O.runPipelineAsync(CODE, "x.js", { useFallbackChain: true });

  assert.equal(r.phases.fallback.reanalysisFailed, true);
  assertStalePartial(r.decision);
});

test("control: successful re-analysis with a critical issue → PARTIAL_FIX, not stale", async () => {
  const O = freshOrchestrator();
  setup(O, { reanalysis: "ok", patchedIssues: [CRITICAL] });
  const d = (await O.runPipelineAsync(CODE, "x.js", { useFallbackChain: true })).decision;

  assert.equal(d.decision, "PARTIAL_FIX", d.reason);
  assert.equal(d.meta.reanalysisFailed, false);
  assert.doesNotMatch(d.reason, /re-analysis failed/);
  assert.match(d.meta.aiNeeded.map(a => a.title).join(), /Command Injection/);
});

test("control: successful re-analysis, nothing left → SAFE_AUTO_FIX unchanged", async () => {
  const O = freshOrchestrator();
  setup(O, { reanalysis: "ok", patchedIssues: [] });
  const d = (await O.runPipelineAsync(CODE, "x.js", { useFallbackChain: true })).decision;

  assert.equal(d.decision, "SAFE_AUTO_FIX", d.reason);
  assert.equal(d.patch, PATCHED);
  assert.equal(d.meta.fileFullyResolved, true);
  assert.equal(d.meta.reanalysisFailed, false);
});
