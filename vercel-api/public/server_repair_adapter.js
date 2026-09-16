"use strict";

const fs = require("fs");
const path = require("path");
const vm = require("vm");

function createRepairEngine() {
  const ctx = vm.createContext({
    console,
    window: {},
    global: {},
    F: {},
    R: {},
  });

  const engines = [
    "engine_java.js",
    "c_cpp_analyzer.js",
    "analyzer.js",
    "security_scanner.js",
    "secret_detector.js",
    "taint_core.js",
    "taint_js.js",
    "taint_py.js",
    "taint_php.js",
    "context_analyzer.js",
    "repair_engine.js",
  ];

  for (const file of engines) {
    const p = path.join(__dirname, file);
    if (!fs.existsSync(p)) continue;
    vm.runInContext(fs.readFileSync(p, "utf8"), ctx, { filename: file });
  }

  if (typeof ctx.analyzeCode !== "function") {
    throw new Error("analyzeCode is not available");
  }

  if (typeof ctx.repairCode !== "function") {
    throw new Error("repairCode is not available");
  }

  function analyze(code, fileName) {
    if (typeof code !== "string" || !fileName) {
      return [];
    }

    ctx.F = { [fileName]: code };
    ctx.R = { [fileName]: { issues: [] } };

    return ctx.analyzeCode(code, fileName) || [];
  }

  function repair(code, issues, fileName) {
    ctx.F = { [fileName]: code };
    ctx.R = { [fileName]: { issues } };

    const result = ctx.repairCode(code, issues, fileName);

    if (!result || typeof result !== "object") {
      return {
        repaired: code,
        repairs: [],
        aiNeeded: [],
      };
    }

    return {
      repaired: typeof result.repaired === "string"
        ? result.repaired
        : code,
      repairs: Array.isArray(result.repairs)
        ? result.repairs
        : [],
      aiNeeded: Array.isArray(result.aiNeeded)
        ? result.aiNeeded
        : [],
    };
  }

  return { analyze, repair };
}

module.exports = {
  createRepairEngine,
};
