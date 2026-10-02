"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  RealityOrchestrator
} = require("../public/server_engine_registration.js");

// التصميم الآمن: Source.CLAUDE لا يصل SAFE_AUTO_FIX أبدًا (forbidClaudeAutoFix ثابت).
// المسار الوحيد للتطبيق التلقائي: ClaudeRepairEngine → FixVerifier (valid && improved)
// → _checkPolicy(Source.REPAIR_ENGINE) → SAFE_AUTO_FIX، مع origin = CLAUDE_REPAIR_ENGINE.

const code = `import sqlite3

def get_user(user_id):
    query = "SELECT * FROM users WHERE id=" + user_id
    cursor.execute(query)
    return cursor.fetchall()`;

const fixedCode = `import sqlite3

def get_user(user_id):
    query = "SELECT * FROM users WHERE id=?"
    cursor.execute(query, (user_id,))
    return cursor.fetchall()`;

const claudeReturns = text => ({
  _fetchFn: async () => ({
    ok: true,
    status: 200,
    json: async () => ({ model: "claude-sonnet-4-6", content: [{ type: "text", text }] })
  })
});

async function withDummyKey(fn) {
  const previousKey = process.env.ANTHROPIC_API_KEY;
  process.env.ANTHROPIC_API_KEY = "test_dummy_key_12345";
  try {
    return await fn();
  } finally {
    if (previousKey === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = previousKey;
  }
}

test("Claude E2E: verified suggestion is auto-applied", async () => {
  const result = await withDummyKey(() =>
    RealityOrchestrator.runPipelineAsync(code, "test.py", claudeReturns(fixedCode)));

  assert.equal(result.decision.decision, "SAFE_AUTO_FIX");
  assert.equal(result.decision.source, "REPAIR_ENGINE");
  assert.notEqual(result.decision.source, "CLAUDE");
  assert.equal(result.decision.meta.requiresApproval, false);

  assert.equal(result.phases.ai.engine, "claude-repair-engine");
  assert.equal(result.phases.ai.result.length, 1);
  assert.equal(result.phases.ai.result[0].status, "SUGGESTION");
  assert.equal(result.phases.ai.result[0].source, "CLAUDE_REPAIR_ENGINE");

  assert.equal(result.phases.aiVerify.valid, true);
  assert.equal(result.phases.aiVerify.improved, true);

  assert.equal(result.decision.meta.origin, "CLAUDE_REPAIR_ENGINE");
  assert.equal(result.decision.meta.aiSource, "CLAUDE_REPAIR_ENGINE");
  assert.equal(result.decision.meta.aiGenerated, true);
  assert.equal(result.decision.meta.humanApproved, false);
  assert.equal(result.decision.meta.deterministic, false);
  assert.equal(result.decision.patch, fixedCode);
});

test("Claude E2E: an unimproved Claude patch is not auto-applied", async () => {
  const result = await withDummyKey(() =>
    RealityOrchestrator.runPipelineAsync(code, "test.py", claudeReturns(code + "\n# reviewed\n")));
  assert.notEqual(result.decision.decision, "SAFE_AUTO_FIX");
});

test("policy: forbidClaudeAutoFix and the CLAUDE source ban cannot be unlocked", () => {
  const S = RealityOrchestrator.Source;
  const saved = RealityOrchestrator.getPolicy();
  try {
    RealityOrchestrator.setPolicy({
      forbidClaudeAutoFix: false,
      allowedSources: new Set(Object.values(S)),
    });
    const p = RealityOrchestrator.getPolicy();
    assert.equal(p.forbidClaudeAutoFix, true);
    assert.equal(p.allowedSources.has(S.CLAUDE), false);
  } finally {
    RealityOrchestrator.setPolicy(saved);
  }
});

test("decide(): a verified AI patch that is not from ClaudeRepairEngine stays AI_SUGGESTION (Source.CLAUDE)", () => {
  const D = RealityOrchestrator.Decision, S = RealityOrchestrator.Source;
  const fallback = { phase: "FALLBACK", safeRepairs: [], aiNeeded: [{ line: 4, strategy: "SQL_INJECTION" }], verifiedCode: null };
  const verified = { valid: true, improved: true, reason: "ACCEPTED" };
  for (const source of [undefined, "CLAUDE", "claude", "CLAUDE_VERIFIED", "LEGACY_CLAUDE_ENGINE"]) {
    const aiPhase = { decision: D.AI_SUGGESTION, patch: fixedCode, source };
    const d = RealityOrchestrator.decide(fallback, verified, aiPhase);
    assert.equal(d.decision, D.AI_SUGGESTION, `source=${source}`);
    assert.equal(d.source, S.CLAUDE, `source=${source}`);
    assert.equal(d.meta.requiresApproval, true, `source=${source}`);
  }
});

test("decide(): ClaudeRepairEngine patch is auto-applied only when FixVerifier says valid && improved", () => {
  const D = RealityOrchestrator.Decision, S = RealityOrchestrator.Source;
  const fallback = { phase: "FALLBACK", safeRepairs: [], aiNeeded: [{ line: 4, strategy: "SQL_INJECTION" }], verifiedCode: null };
  const aiPhase = { decision: D.AI_SUGGESTION, patch: fixedCode, source: "CLAUDE_REPAIR_ENGINE" };

  const ok = RealityOrchestrator.decide(fallback, { valid: true, improved: true, reason: "ACCEPTED" }, aiPhase);
  assert.equal(ok.decision, D.SAFE_AUTO_FIX);
  assert.equal(ok.source, S.REPAIR_ENGINE);

  for (const v of [{ valid: true, improved: false }, { valid: false, improved: true }, { valid: false, improved: false }]) {
    const d = RealityOrchestrator.decide(fallback, v, aiPhase);
    assert.notEqual(d.decision, D.SAFE_AUTO_FIX, JSON.stringify(v));
  }
});
