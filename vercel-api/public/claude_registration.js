"use strict";

const RealityOrchestrator = require("./reality_orchestrator.js");
const ClaudeRepairEngine = require("./claude_repair_engine.js");

// يُقرأ في RealityOrchestrator.decide(): هذا المصدر وحده يصل إلى SAFE_AUTO_FIX
// بعد FixVerifier. أي مصدر آخر يبقى AI_SUGGESTION بموافقة بشرية.
const CLAUDE_REPAIR_ENGINE_SOURCE = "CLAUDE_REPAIR_ENGINE";

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
      source: CLAUDE_REPAIR_ENGINE_SOURCE,
      model: item.model || ClaudeRepairEngine.MODEL,
      baseCode: code,
    }));
}

if (!RealityOrchestrator.hasEngine("claude-repair-engine")) {
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
  CLAUDE_REPAIR_ENGINE_SOURCE,
};
