"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

test("Claude Repair Engine is registered as AI engine", () => {
  const { RealityOrchestrator, ClaudeRepairEngine, claudeRepairAdapter } =
    require("./claude_registration.js");

  const engine = RealityOrchestrator.getEngine("claude-repair-engine");

  assert.ok(engine);
  assert.equal(engine.id, "claude-repair-engine");
  assert.equal(engine.type, RealityOrchestrator.EngineType.AI);
  assert.deepEqual(engine.capabilities, ["*"]);
  assert.equal(engine.priority, 100);
  assert.equal(engine.fn, claudeRepairAdapter);
  assert.equal(typeof ClaudeRepairEngine.repairAll, "function");
});

test("Claude adapter returns SUGGESTION, never SAFE_AUTO_FIX", async () => {
  const { RealityOrchestrator } =
    require("./claude_registration.js");

  const engine = RealityOrchestrator.getEngine("claude-repair-engine");

  assert.ok(engine);

  const oldKey = process.env.ANTHROPIC_API_KEY;
  process.env.ANTHROPIC_API_KEY = "test-key-123456";

  try {
    const result = await engine.fn(
      [{
        type: "TEST",
        title: "Test issue",
        line: 1
      }],
      "const x = 1;",
      "test.js",
      {
        _fetchFn: async () => ({
          ok: true,
          status: 200,
          json: async () => ({
            model: "claude-sonnet-4-6",
            content: [{ type: "text", text: "const x = 2;" }]
          }),
          text: async () => ""
        })
      }
    );

    assert.ok(Array.isArray(result));
    assert.equal(result.length, 1);
    assert.equal(result[0].status, "SUGGESTION");
    assert.notEqual(result[0].status, "SAFE_AUTO_FIX");
    assert.equal(result[0].source, "CLAUDE_REPAIR_ENGINE");
    assert.equal(result[0].model, "claude-sonnet-4-6");
  } finally {
    if (oldKey !== undefined) {
      process.env.ANTHROPIC_API_KEY = oldKey;
    } else {
      delete process.env.ANTHROPIC_API_KEY;
    }
  }
});
