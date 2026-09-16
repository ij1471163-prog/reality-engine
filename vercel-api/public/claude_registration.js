"use strict";

const RealityOrchestrator = require("./reality_orchestrator.js");
const ClaudeEngine = require("./claude_engine.js");

RealityOrchestrator.registerEngine(
  "claude",
  RealityOrchestrator.EngineType.AI,
  ClaudeEngine.suggest,
  ["*"],
  { priority: 100 }
);

module.exports = {
  RealityOrchestrator,
  ClaudeEngine,
};
