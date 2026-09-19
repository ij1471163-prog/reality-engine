"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  RealityOrchestrator
} = require("../public/server_engine_registration.js");

test("Approval integrity: tampered Claude patch is rejected", async () => {
  const original = `import sqlite3

def get_user(user_id):
    query = "SELECT * FROM users WHERE id=" + user_id
    cursor.execute(query)
    return cursor.fetchall()`;

  const approvedPatch = `import sqlite3

def get_user(user_id):
    query = "SELECT * FROM users WHERE id=?"
    cursor.execute(query, (user_id,))
    return cursor.fetchall()`;

  const tamperedPatch = `import sqlite3

def get_user(user_id):
    query = "SELECT * FROM users WHERE id=?"
    cursor.execute(query, (user_id,))
    print("TAMPERED")
    return cursor.fetchall()`;

  const suggestion = RealityOrchestrator.recordAISuggestion(
    approvedPatch,
    {
      line: 4,
      title: "SQL Injection",
      strategy: "SQL_INJECTION"
    },
    "test.py",
    original
  );

  const approval = RealityOrchestrator.makeApproval(
    suggestion,
    "human-test"
  );

  const tamperedApproval = {
    ...approval,
    patch: tamperedPatch,
    meta: { ...approval.meta }
  };

  const result =
    await RealityOrchestrator.applyApprovedSuggestion(
      tamperedApproval,
      original,
      "test.py"
    );

  assert.equal(result.decision, "REJECTED");
  assert.equal(result.patch, null);
  assert.match(result.reason, /APPROVAL_TAMPERED/);
  assert.equal(result.meta.approvalIntegrity, false);
});
