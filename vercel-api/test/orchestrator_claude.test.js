"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  RealityOrchestrator
} = require("../public/server_engine_registration.js");

test("Claude E2E: verified suggestion is auto-applied", async () => {
  const previousKey = process.env.ANTHROPIC_API_KEY;
  process.env.ANTHROPIC_API_KEY = "test_dummy_key_12345";
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

  const result = await RealityOrchestrator.runPipelineAsync(
    code,
    "test.py",
    {
      _fetchFn: async () => ({
        ok: true,
        status: 200,
        json: async () => ({
          model: "claude-sonnet-4-6",
          content: [{
            type: "text",
            text: fixedCode
          }]
        })
      })
    }
  );

  assert.equal(result.decision.decision, "SAFE_AUTO_FIX");
  assert.equal(result.decision.source, "CLAUDE");
  assert.equal(result.decision.meta.requiresApproval, false);

  assert.equal(result.phases.ai.engine, "claude-repair-engine");
  assert.equal(result.phases.ai.result.length, 1);
  assert.equal(result.phases.ai.result[0].status, "SUGGESTION");

  assert.equal(result.phases.aiVerify.valid, true);
  assert.equal(result.phases.aiVerify.improved, true);

  assert.equal(result.decision.meta.origin, "CLAUDE_VERIFIED");
  assert.equal(result.decision.meta.aiGenerated, true);
  assert.equal(result.decision.meta.humanApproved, false);
  assert.equal(result.decision.meta.deterministic, false);
  assert.equal(result.decision.patch, fixedCode);
});
