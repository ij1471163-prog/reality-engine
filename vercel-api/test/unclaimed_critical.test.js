"use strict";

// Regression: critical issues that deterministic repair leaves behind must be
// forwarded to AI, and password hashing must not be "fixed" to bare SHA-256.
// Found by running a small game-server sample through /api/analyze: the result
// was SAFE_AUTO_FIX with "1 issue still require AI" while SQL injection and
// eval() were still in the patch and never forwarded.

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  RealityOrchestrator
} = require("../public/server_engine_registration.js");

const CODE = `const crypto = require('crypto');

function loginPlayer(username, password) {
    var query = "SELECT * FROM players WHERE username='" + username + "' AND password='" + password + "'";
    db.execute(query);
}

function purchaseItem() {
    var cheatCode = document.getElementById("cheatInput").value;
    eval(cheatCode);
}

function hashPassword(pass) {
    return crypto.createHash('md5').update(pass).digest('hex');
}
`;

test("Unclaimed critical: SQL injection and eval() reach aiNeeded", async () => {
  const previousKey = process.env.ANTHROPIC_API_KEY;
  delete process.env.ANTHROPIC_API_KEY;
  try {
    const r = await RealityOrchestrator.runPipelineAsync(CODE, "game.js",
      { useFallbackChain: true });
    const d = r.decision;
    const titles = (d.meta.aiNeeded || []).map(a => a.title).join("\n");

    assert.match(titles, /SQL Injection/);
    assert.match(titles, /eval/);
    assert.equal(d.meta.fileFullyResolved, false);
    assert.ok(d.meta.aiRequiredCount >= 3, d.reason);
  } finally {
    if (previousKey !== undefined) process.env.ANTHROPIC_API_KEY = previousKey;
  }
});

test("WEAK_CRYPTO: password hash is not rewritten to SHA-256", async () => {
  const previousKey = process.env.ANTHROPIC_API_KEY;
  delete process.env.ANTHROPIC_API_KEY;
  try {
    const r = await RealityOrchestrator.runPipelineAsync(CODE, "game.js",
      { useFallbackChain: true });
    const d = r.decision;
    const patch = d.patch || CODE;

    assert.doesNotMatch(patch, /createHash\("sha256"\)\.update\(pass\)/);
    assert.ok((d.meta.aiNeeded || []).some(a => /MD5|تشفير/.test(a.title)));
  } finally {
    if (previousKey !== undefined) process.env.ANTHROPIC_API_KEY = previousKey;
  }
});

// ─── PARTIAL_FIX ───────────────────────────────────────
// Verified deterministic repairs with critical issues left over must not be
// reported as SAFE_AUTO_FIX: the decision is PARTIAL_FIX, `patch` is null, and
// the verified code is only in meta.deterministicPatch.

const FixVerifier = require("../public/fix_verifier.js");

async function runGameServer() {
  const previousKey = process.env.ANTHROPIC_API_KEY;
  delete process.env.ANTHROPIC_API_KEY;
  try {
    return await RealityOrchestrator.runPipelineAsync(CODE, "GameServer.js",
      { useFallbackChain: true });
  } finally {
    if (previousKey !== undefined) process.env.ANTHROPIC_API_KEY = previousKey;
  }
}

test("PARTIAL_FIX: SQL injection / eval / MD5 left → not SAFE_AUTO_FIX", async () => {
  const d = (await runGameServer()).decision;

  assert.equal(d.decision, "PARTIAL_FIX", d.reason);
  assert.equal(d.patch, null);
  assert.equal(d.meta.partial, true);
  assert.equal(d.meta.fileFullyResolved, false);

  const titles = d.meta.aiNeeded.map(a => a.title).join("\n");
  assert.match(titles, /SQL Injection/);
  assert.match(titles, /eval/);
  assert.match(titles, /MD5/);
  assert.equal(d.meta.aiRequiredCount, d.meta.aiNeeded.length);
});

test("PARTIAL_FIX: meta.deterministicPatch carries only the verified repairs", async () => {
  const d = (await runGameServer()).decision;
  const det = d.meta.deterministicPatch;

  assert.equal(typeof det, "string");
  assert.notEqual(det, CODE);
  assert.equal(d.meta.deterministicVerified, true);
  assert.equal(d.meta.deterministicRepairCount, d.meta.safeRepairs.length);
  assert.ok(d.meta.safeRepairs.length > 0);
  assert.ok(FixVerifier.syntaxCheck(det, "GameServer.js").ok);
  // the verified var → let repairs are in
  assert.match(det, /let query = /);
  assert.match(det, /let cheatCode = /);
  // and the unresolved issues are honestly still there
  assert.match(det, /username='" \+ username/);
  assert.match(det, /eval\(cheatCode\)/);
});

test("SAFE_AUTO_FIX stays for a fully resolved file", async () => {
  const previousKey = process.env.ANTHROPIC_API_KEY;
  delete process.env.ANTHROPIC_API_KEY;
  try {
    const code = 'var x = 1;\nfetch("http://api.example.com/a");\n';
    const d = (await RealityOrchestrator.runPipelineAsync(code, "a.js",
      { useFallbackChain: true })).decision;
    assert.equal(d.decision, "SAFE_AUTO_FIX", d.reason);
    assert.equal(typeof d.patch, "string");
    assert.equal(d.meta.fileFullyResolved, true);
    assert.equal(d.meta.aiNeeded.length, 0);
  } finally {
    if (previousKey !== undefined) process.env.ANTHROPIC_API_KEY = previousKey;
  }
});

test("/api/analyze: PARTIAL_FIX is returned as partialFix, never as `fixed`", async () => {
  const crypto = require("crypto");
  const handler = require("../api/analyze.js");
  const prevKey = process.env.ANTHROPIC_API_KEY;
  const prevMaster = process.env.MASTER_SECRET;
  delete process.env.ANTHROPIC_API_KEY;
  process.env.MASTER_SECRET = "test_master_secret";
  try {
    const window = Math.floor(Date.now() / (10 * 60 * 1000));
    const token = crypto.createHmac("sha256", "test_master_secret")
      .update("web_" + window).digest("hex");

    let status = 0, body = null;
    const res = {
      setHeader() {},
      status(s) { status = s; return this; },
      json(b) { body = b; return this; },
      end() { return this; },
    };
    await handler({
      method: "POST",
      headers: { authorization: "Bearer " + token, "x-forwarded-for": "10.9.9.9" },
      body: { code: CODE, fileName: "GameServer.js", fix: true },
    }, res);

    assert.equal(status, 200, JSON.stringify(body));
    assert.equal(body.healing.status, "PARTIAL_FIX");
    assert.equal(body.fixed, undefined);
    assert.equal(body.partialFix.fileFullyResolved, false);
    assert.equal(body.partialFix.patch,
      body.orchestrator.decision.meta.deterministicPatch);
    assert.match(body.partialFix.aiNeeded.map(a => a.title).join("\n"), /SQL Injection/);
  } finally {
    if (prevKey !== undefined) process.env.ANTHROPIC_API_KEY = prevKey;
    if (prevMaster !== undefined) process.env.MASTER_SECRET = prevMaster;
    else delete process.env.MASTER_SECRET;
  }
});
