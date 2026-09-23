"use strict";

const RealityOrchestrator = require("./reality_orchestrator.js");
const FixVerifier = require("./fix_verifier.js");
const { createRepairEngine } = require("./server_repair_adapter.js");

function registerServerEngines() {
  const engine = createRepairEngine();

  if (!RealityOrchestrator.hasEngine("server-analyzer")) {
    RealityOrchestrator.registerEngine(
      "server-analyzer",
      RealityOrchestrator.EngineType.ANALYZER,
      engine.analyze,
      ["*"],
      { priority: 100 }
    );
  }

  if (!RealityOrchestrator.hasEngine("server-repair")) {
    RealityOrchestrator.registerEngine(
      "server-repair",
      RealityOrchestrator.EngineType.REPAIR,
      engine.repair,
      ["*"],
      { priority: 100 }
    );
  }

  if (!RealityOrchestrator.hasEngine("fix-verifier")) {
    RealityOrchestrator.registerEngine(
      "fix-verifier",
      RealityOrchestrator.EngineType.VERIFIER,
      (originalCode, fixedCode, fileName) =>
        FixVerifier.fullVerify(originalCode, fixedCode, fileName, engine.analyze, { allowUnverifiedLanguages: true }),
      ["code-verification"],
      { priority: 100 }
    );
  }

  if (!RealityOrchestrator.hasEngine("claude")) {
    require("./claude_registration.js");
  }
}

registerServerEngines();

module.exports = {
  RealityOrchestrator,
  FixVerifier,
};
