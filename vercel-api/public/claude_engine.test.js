"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const ClaudeEngine = require("./claude_engine.js");

function mockResponse(status, data) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(data),
    json: async () => data,
  };
}

const issue = {
  type: "COMMAND_INJECTION",
  title: "Command Injection",
  line: 10,
  strategy: "SAFE_LITERAL",
  ev: "Dynamic command execution detected",
};

const code = `
const input = userInput;
exec(input);
`;

test("exports ClaudeEngine API", () => {
  assert.equal(typeof ClaudeEngine.suggest, "function");
  assert.equal(ClaudeEngine.MODEL, "claude-sonnet-4-6");
  assert.equal(ClaudeEngine.Status.SUGGESTION, "SUGGESTION");
});

test("missing aiNeeded returns PENDING_REVIEW", async () => {
  const result = await ClaudeEngine.suggest([], code, "test.js");
  assert.equal(result.length, 1);
  assert.equal(result[0].status, ClaudeEngine.Status.PENDING_REVIEW);
});

test("missing API key returns PENDING_REVIEW", async () => {
  const oldKey = process.env.ANTHROPIC_API_KEY;
  delete process.env.ANTHROPIC_API_KEY;

  const result = await ClaudeEngine.suggest([issue], code, "test.js");

  if (oldKey !== undefined) process.env.ANTHROPIC_API_KEY = oldKey;

  assert.equal(result.length, 1);
  assert.equal(result[0].status, ClaudeEngine.Status.PENDING_REVIEW);
  assert.match(result[0].reason, /ANTHROPIC_API_KEY/);
});

test("sends aiNeeded issue correctly and returns suggestion", async () => {
  process.env.ANTHROPIC_API_KEY = "test-key-123456";

  let captured = null;

  const fetchMock = async (url, options) => {
    captured = { url, options };

    return mockResponse(200, {
      model: "claude-sonnet-4-6",
      content: [
        {
          type: "text",
          text: "const input = userInput;\\nexec(escape(input));",
        },
      ],
    });
  };

  const result = await ClaudeEngine.suggest(
    [issue],
    code,
    "test.js",
    { _fetchFn: fetchMock }
  );

  assert.equal(result.length, 1);
  assert.equal(result[0].status, ClaudeEngine.Status.SUGGESTION);
  assert.ok(result[0].suggestion);
  assert.equal(captured.url, "https://api.anthropic.com/v1/messages");

  const body = JSON.parse(captured.options.body);

  assert.equal(body.model, "claude-sonnet-4-6");
  assert.equal(body.messages.length, 1);
  assert.match(body.messages[0].content, /Command Injection/);
  assert.match(body.messages[0].content, /test\.js/);
  assert.match(body.messages[0].content, /Fix ONLY the reported issue/);
});

test("CANNOT_FIX returns PENDING_REVIEW", async () => {
  process.env.ANTHROPIC_API_KEY = "test-key-123456";

  const fetchMock = async () =>
    mockResponse(200, {
      model: "claude-sonnet-4-6",
      content: [{ type: "text", text: "CANNOT_FIX" }],
    });

  const result = await ClaudeEngine.suggest(
    [issue],
    code,
    "test.js",
    { _fetchFn: fetchMock }
  );

  assert.equal(result[0].status, ClaudeEngine.Status.PENDING_REVIEW);
  assert.equal(result[0].suggestion, null);
});

test("HTTP API error returns PENDING_REVIEW", async () => {
  process.env.ANTHROPIC_API_KEY = "test-key-123456";

  const fetchMock = async () =>
    mockResponse(500, { error: "server error" });

  const result = await ClaudeEngine.suggest(
    [issue],
    code,
    "test.js",
    { _fetchFn: fetchMock }
  );

  assert.equal(result[0].status, ClaudeEngine.Status.PENDING_REVIEW);
  assert.match(result[0].reason, /HTTP 500/);
});

test("timeout returns PENDING_REVIEW", async () => {
  process.env.ANTHROPIC_API_KEY = "test-key-123456";

  const fetchMock = async (url, options) => {
    await new Promise((resolve, reject) => {
      if (options.signal.aborted) {
        reject(Object.assign(new Error("aborted"), { name: "AbortError" }));
        return;
      }

      options.signal.addEventListener("abort", () => {
        reject(Object.assign(new Error("aborted"), { name: "AbortError" }));
      });
    });
  };

  const result = await ClaudeEngine.suggest(
    [issue],
    code,
    "test.js",
    {
      _fetchFn: fetchMock,
      timeoutMs: 1000,
    }
  );

  assert.equal(result[0].status, ClaudeEngine.Status.PENDING_REVIEW);
  assert.match(result[0].reason, /Timeout after 1000ms/);
});

test("Claude result can never be SAFE_AUTO_FIX", async () => {
  process.env.ANTHROPIC_API_KEY = "test-key-123456";

  const fetchMock = async () =>
    mockResponse(200, {
      model: "claude-sonnet-4-6",
      content: [{ type: "text", text: "fixed code here" }],
    });

  const result = await ClaudeEngine.suggest(
    [issue],
    code,
    "test.js",
    { _fetchFn: fetchMock }
  );

  assert.notEqual(result[0].status, "SAFE_AUTO_FIX");
  assert.equal(result[0].status, ClaudeEngine.Status.SUGGESTION);
});

test("API key is read from environment, not runtime options", () => {
  const oldKey = process.env.ANTHROPIC_API_KEY;
  process.env.ANTHROPIC_API_KEY = "environment-key-123456";

  assert.equal(ClaudeEngine._getApiKey(), "environment-key-123456");

  if (oldKey !== undefined) {
    process.env.ANTHROPIC_API_KEY = oldKey;
  } else {
    delete process.env.ANTHROPIC_API_KEY;
  }
});

test("source code contains no hardcoded secret value", () => {
  const fs = require("node:fs");
  const source = fs.readFileSync(
    require.resolve("./claude_engine.js"),
    "utf8"
  );

  assert.doesNotMatch(source, /sk-ant-api\d+-[A-Za-z0-9_-]{20,}/);
});
