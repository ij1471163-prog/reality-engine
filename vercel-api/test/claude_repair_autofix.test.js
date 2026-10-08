"use strict";

// Regression (C): _claudeRepairEngineAutoFix() returns SAFE_AUTO_FIX for any
// CLAUDE_REPAIR_ENGINE candidate that FixVerifier accepts (valid && improved).
// "improved" means ONE issue fewer, not "nothing left": each Claude candidate
// is generated per issue against the same base, and only the first verified
// one drives decide(). The result is SAFE_AUTO_FIX while other critical issues
// remain in the patch, meta.aiNeeded still lists the pre-Claude issues, and
// fileFullyResolved is not set at all. reanalysisFailed is ignored too.
//
// Target invariant: SAFE_AUTO_FIX only with fileFullyResolved === true, empty
// aiNeeded, and no critical issue left in the applied patch.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const ORCH = require.resolve("../public/reality_orchestrator.js");
const CRE = "CLAUDE_REPAIR_ENGINE";

function assertNotFalseSafe(d, label) {
  if (d.decision !== "SAFE_AUTO_FIX") return;
  assert.equal(d.meta.fileFullyResolved, true, `${label}: SAFE_AUTO_FIX without fileFullyResolved=true — ${d.reason}`);
  assert.equal((d.meta.aiNeeded || []).length, 0, `${label}: SAFE_AUTO_FIX with aiNeeded — ${d.reason}`);
  assert.notEqual(d.meta.reanalysisFailed, true, `${label}: SAFE_AUTO_FIX after failed re-analysis`);
}

// ─── 1. Real engines, GameServer sample, Claude fixes eval() only ─────────
test("C1 real engines: Claude fixes eval only → SQL injection left → not SAFE_AUTO_FIX", async () => {
  const { RealityOrchestrator: O } = require("../public/server_engine_registration.js");
  const src = fs.readFileSync(path.join(__dirname, "unclaimed_critical.test.js"), "utf8");
  const CODE = eval(src.match(/const CODE = (`[\s\S]*?`);/)[1]);
  const CLAUDE_FIX = CODE.replace("var query", "let query")
    .replace("var cheatCode", "let cheatCode")
    .replace("eval(cheatCode);", "JSON.parse(cheatCode);");

  const prev = process.env.ANTHROPIC_API_KEY;
  process.env.ANTHROPIC_API_KEY = "test_dummy_key_12345";
  let r;
  try {
    r = await O.runPipelineAsync(CODE, "GameServer.js", { useFallbackChain: true,
      _fetchFn: async () => ({ ok: true, status: 200,
        json: async () => ({ model: "m", content: [{ type: "text", text: CLAUDE_FIX }] }) }) });
  } finally {
    if (prev === undefined) delete process.env.ANTHROPIC_API_KEY; else process.env.ANTHROPIC_API_KEY = prev;
  }
  const d = r.decision;
  // precondition: the CRE candidate verified and still holds the SQL injection
  assert.equal(r.phases.aiVerifiedCount, 1);
  const leftCritical = O.runAnalysis(r.phases.aiPhase.patch, "GameServer.js").issues
    .filter(i => i.sev === "c" && /SQL/i.test(i.title));
  assert.ok(leftCritical.length > 0, "precondition: SQL injection remains in the Claude patch");

  assert.notEqual(d.decision, "SAFE_AUTO_FIX", d.reason);
  assertNotFalseSafe(d, "C1");
  assert.equal(d.meta.fileFullyResolved, false);
});

// ─── Stub engines (fresh orchestrator) for the two decide() paths ─────────
function freshOrchestrator() {
  delete require.cache[ORCH];
  return require(ORCH);
}

const SQL  = { line: 2, title: "SQL Injection", sev: "c", type: "js", aiRequired: true, ev: "q(a)" };
const EVAL = { line: 3, title: "eval", sev: "c", type: "js", aiRequired: true, ev: "eval(b)" };
const VAR  = { line: 1, title: "var usage", sev: "l", type: "js", ev: "var x = 1;" };

const CODE     = "var x = 1;\nq(a)\neval(b)\n";
const DET      = "let x = 1;\nq(a)\neval(b)\n";          // deterministic patch
const AI_ONE   = "let x = 1;\nq(a)\nJSON.parse(b)\n";    // Claude fixes eval only
const AI_ONE_3 = "var x = 1;\nq(a)\nJSON.parse(b)\n";    // Path 3 variant (no det patch)
const AI_ALL   = "let x = 1;\nsafeQ(a)\nJSON.parse(b)\n";

function issuesFor(code) {
  const out = [];
  if (code.startsWith("var ")) out.push(VAR);
  if (code.includes("\nq(a)")) out.push(SQL);
  if (code.includes("eval(b)")) out.push(EVAL);
  return out;
}

function setup(O, { withDeterministic, claudePatch, reanalysisFail }) {
  let detCalls = 0;
  O.registerEngine("an", O.EngineType.ANALYZER, (code) => {
    if (reanalysisFail && code === DET && ++detCalls === 2) throw new Error("analyzer crashed");
    return issuesFor(code);
  }, ["*"]);
  O.registerEngine("rep", O.EngineType.REPAIR, (code, issues) => {
    const fixVar = withDeterministic && code === CODE;
    return {
      repaired: fixVar ? DET : code,
      repairs: fixVar ? [{ line: 1, title: "var usage", strategy: "VAR_USAGE" }] : [],
      aiNeeded: issues.filter(i => i.aiRequired)
        .map(i => ({ line: i.line, title: i.title, strategy: "SECURITY", ev: i.ev })),
    };
  }, ["*"]);
  O.registerEngine("ver", O.EngineType.VERIFIER, (before, after, fn) => {
    const b = issuesFor(before).length;
    const a = O.getEngine("an").fn(after, fn).length;
    return { valid: true, improved: a < b, reason: a < b ? "ACCEPTED" : "NO_IMPROVEMENT" };
  }, ["code-verification"]);
  O.registerEngine("cre", O.EngineType.AI, async (aiNeeded) =>
    aiNeeded.map(issue => ({ status: "SUGGESTION", suggestion: claudePatch, issue, source: CRE })), ["*"]);
}

test("C2 Path 0: deterministic patch + CRE fixes one of two critical → not SAFE_AUTO_FIX", async () => {
  const O = freshOrchestrator();
  setup(O, { withDeterministic: true, claudePatch: AI_ONE });
  const r = await O.runPipelineAsync(CODE, "x.js", { useFallbackChain: true });
  const d = r.decision;
  assert.equal(r.phases.aiVerifiedCount > 0, true, "precondition: CRE candidate verified");
  assert.ok(issuesFor(r.phases.aiPhase.patch).some(i => i.sev === "c"), "precondition: critical left");

  assert.notEqual(d.decision, "SAFE_AUTO_FIX", d.reason);
  assertNotFalseSafe(d, "C2");
});

test("C3 Path 3: no deterministic patch + CRE fixes one of two critical → not SAFE_AUTO_FIX", async () => {
  const O = freshOrchestrator();
  setup(O, { withDeterministic: false, claudePatch: AI_ONE_3 });
  const r = await O.runPipelineAsync(CODE, "x.js", { useFallbackChain: true });
  const d = r.decision;
  assert.equal(r.phases.fallback.verifiedCode, null, "precondition: Path 3 (no deterministic patch)");
  assert.equal(r.phases.aiVerifiedCount > 0, true, "precondition: CRE candidate verified");

  assert.notEqual(d.decision, "SAFE_AUTO_FIX", d.reason);
  assertNotFalseSafe(d, "C3");
});

test("C4 Path 0 after failed re-analysis: CRE patch must not be SAFE_AUTO_FIX", async () => {
  const O = freshOrchestrator();
  setup(O, { withDeterministic: true, claudePatch: AI_ALL, reanalysisFail: true });
  const r = await O.runPipelineAsync(CODE, "x.js", { useFallbackChain: true });
  const d = r.decision;
  assert.equal(r.phases.fallback.reanalysisFailed, true, "precondition: re-analysis failed");
  assert.equal(r.phases.aiVerifiedCount > 0, true, "precondition: CRE candidate verified");

  assert.notEqual(d.decision, "SAFE_AUTO_FIX", d.reason);
  assert.equal(d.meta.reanalysisFailed, true);
});

test("C control: CRE patch that resolves everything stays SAFE_AUTO_FIX", async () => {
  const O = freshOrchestrator();
  setup(O, { withDeterministic: true, claudePatch: AI_ALL });
  const r = await O.runPipelineAsync(CODE, "x.js", { useFallbackChain: true });
  const d = r.decision;
  assert.equal(d.decision, "SAFE_AUTO_FIX", d.reason);
  assert.equal(d.meta.origin, CRE);
  assert.equal(d.patch, AI_ALL.trim());   // the orchestrator trims suggestions
});
