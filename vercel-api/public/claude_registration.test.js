"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

test("ClaudeEngine is registered as AI engine", () => {
  const { RealityOrchestrator, ClaudeEngine } =
    require("./claude_registration.js");

  const engine = RealityOrchestrator.getEngine("claude");

  assert.ok(engine);
  assert.equal(engine.id, "claude");
  assert.equal(engine.type, RealityOrchestrator.EngineType.AI);
  assert.deepEqual(engine.capabilities, ["*"]);
  assert.equal(engine.priority, 100);
  assert.equal(engine.fn, ClaudeEngine.suggest);
});

test("Claude engine cannot produce SAFE_AUTO_FIX", async () => {
  const { RealityOrchestrator } =
    require("./claude_registration.js");

  const engine = RealityOrchestrator.getEngine("claude");

  const oldKey = process.env.ANTHROPIC_API_KEY;
  process.env.ANTHROPIC_API_KEY = "test-key-123456";

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

  if (oldKey !== undefined) {
    process.env.ANTHROPIC_API_KEY = oldKey;
  } else {
    delete process.env.ANTHROPIC_API_KEY;
  }

  assert.equal(result[0].status, "SUGGESTION");
  assert.notEqual(result[0].status, "SAFE_AUTO_FIX");
});
