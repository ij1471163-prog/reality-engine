"use strict";

const RealityOrchestrator = require("./reality_orchestrator.js");
const ClaudeRepairEngine = require("./claude_repair_engine.js");

async function claudeRepairAdapter(aiNeeded, code, fileName, options) {
  if (!Array.isArray(aiNeeded) || aiNeeded.length === 0) {
    return [];
  }

  const result = await ClaudeRepairEngine.repairAll(
    code,
    fileName,
    aiNeeded,
    options
  );

  if (!result || !Array.isArray(result.results)) {
    return [];
  }

  return result.results
    .filter(item =>
      item &&
      item.status === ClaudeRepairEngine.Status.FIXED &&
      typeof item.fixedCode === "string" &&
      item.fixedCode.trim() &&
      item.fixedCode !== code
    )
    .map(item => ({
      status: "SUGGESTION",
      suggestion: item.fixedCode,
      issue: item.issue || null,
      source: "CLAUDE_REPAIR_ENGINE",
      model: item.model || ClaudeRepairEngine.MODEL,
    }));
}

if (!RealityOrchestrator.hasEngine("claude")) {
  RealityOrchestrator.registerEngine(
    "claude-repair-engine",
    RealityOrchestrator.EngineType.AI,
    claudeRepairAdapter,
    ["*"],
    { priority: 100 }
  );
}

module.exports = {
  RealityOrchestrator,
  ClaudeRepairEngine,
  claudeRepairAdapter,
};
