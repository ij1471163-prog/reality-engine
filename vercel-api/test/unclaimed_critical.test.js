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
