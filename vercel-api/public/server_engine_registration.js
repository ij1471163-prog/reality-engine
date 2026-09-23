"use strict";

const RealityOrchestrator = require("./reality_orchestrator.js");
const FixVerifier = require("./fix_verifier.js");
const { createRepairEngine } = require("./server_repair_adapter.js");

// ─── فحص syntax نسبي بعد fullVerify ─────────────────────
// FixVerifier في السيرفر لا يملك acorn ولا compiler لـTS ولا فاحصًا لـPHP، و
// allowUnverifiedLanguages يمرّرها (و fallback الـnew Function يعتبر "Unexpected token"
// مع كلمة import/export "ESM لا يمكن فحصه"). يُرفض الـcandidate فقط إذا كان الأصل
// سليمًا بنفس الفحص والـcandidate مكسورًا؛ أصل لا يمر بالفحص ⇒ لا حكم.
const acorn = require("./acorn.min.js");

function jsSyntax(code) {
  const opts = { ecmaVersion: "latest", allowReturnOutsideFunction: true, allowHashBang: true };
  try { acorn.parse(code, { ...opts, sourceType: "script" }); return "ok"; } catch (e) {}
  try { acorn.parse(code, { ...opts, sourceType: "module" }); return "ok"; }
  catch (e) { return "broken: " + e.message; }
}

// توازن الأقواس والنصوص والتعليقات لـTS/PHP. ليس parser: يُرجع "unknown" عند أي
// بنية لا يفهمها بثقة (regex غامض، heredoc، ملف PHP فيه ?>) بدل التخمين.
function structuralSyntax(code, lang) {
  const php = lang === "php";
  if (php && (/<<<\s*['"]?\w/.test(code) || /\?>/.test(code))) return "unknown";
  const stack = [];
  const close = { ")": "(", "]": "[", "}": "{" };
  let i = 0, prev = "";           // prev = آخر رمز مهم (لتمييز regex عن القسمة)
  const n = code.length;
  const tpl = [];                 // مستويات ${ داخل template literal
  const exprBefore = () => prev === "" || /[(,=:[!&|?{};+\-*%<>~^]$/.test(prev) ||
    /^(return|typeof|case|in|of|delete|void|throw|new|instanceof|yield|await)$/.test(prev);
  while (i < n) {
    const c = code[i], d = code[i + 1];
    if (c === "/" && d === "/" || (php && c === "#" && d !== "[")) { while (i < n && code[i] !== "\n") i++; continue; }
    if (c === "/" && d === "*") { const e = code.indexOf("*/", i + 2); if (e < 0) return "broken: unterminated comment"; i = e + 2; continue; }
    if (c === "'" || c === '"' || (!php && c === "`")) {
      const q = c; i++;
      while (i < n) {
        const ch = code[i];
        if (ch === "\\") { i += 2; continue; }
        if (ch === q) break;
        if (!php && q !== "`" && ch === "\n") return "broken: unterminated string";
        if (q === "`" && ch === "$" && code[i + 1] === "{") { tpl.push(stack.length); stack.push("${"); i += 2; break; }
        i++;
      }
      if (i >= n) return "broken: unterminated string";
      if (code[i] === q) { i++; prev = "str"; }
      continue;
    }
    if (!php && c === "/" && exprBefore()) {          // regex literal
      i++; let cls = false;
      while (i < n) {
        const ch = code[i];
        if (ch === "\n") return "unknown";
        if (ch === "\\") { i += 2; continue; }
        if (ch === "[") cls = true; else if (ch === "]") cls = false;
        else if (ch === "/" && !cls) break;
        i++;
      }
      if (i >= n) return "unknown";
      i++; while (i < n && /[a-z]/i.test(code[i])) i++;
      prev = "re"; continue;
    }
    if ("([{".includes(c)) { stack.push(c); prev = c; i++; continue; }
    if (")]}".includes(c)) {
      const top = stack.pop();
      if (c === "}" && top === "${") {                 // عودة إلى داخل template literal
        tpl.pop(); i++;
        while (i < n) {
          const ch = code[i];
          if (ch === "\\") { i += 2; continue; }
          if (ch === "`") break;
          if (ch === "$" && code[i + 1] === "{") { tpl.push(stack.length); stack.push("${"); i += 2; break; }
          i++;
        }
        if (i >= n) return "broken: unterminated template";
        if (code[i] === "`") { i++; prev = "str"; }
        continue;
      }
      if (top !== close[c]) return `broken: unexpected '${c}'`;
      prev = c; i++; continue;
    }
    if (/\s/.test(c)) { i++; continue; }
    if (/[A-Za-z_$]/.test(c)) { let j = i; while (j < n && /[\w$]/.test(code[j])) j++; prev = code.slice(i, j); i = j; continue; }
    prev = c; i++;
  }
  if (stack.length) return `broken: unclosed '${stack[stack.length - 1]}'`;
  return "ok";
}

function check(code, lang) {
  if (lang === "javascript") return jsSyntax(code);
  if (lang === "typescript" || lang === "php") return structuralSyntax(code, lang);
  return "unknown";
}

// يُرجع سبب الرفض أو null
function serverSyntaxProblem(before, after, fileName) {
  const lang = FixVerifier.detectLanguage(fileName);
  if (!["javascript", "typescript", "php"].includes(lang)) return null;
  if (check(before, lang) !== "ok") return null;
  const a = check(after, lang);
  return a.startsWith("broken") ? `REJECTED_SYNTAX_BROKEN [${lang}]: ${a.slice(8)}` : null;
}

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
      (originalCode, fixedCode, fileName) => {
        const result = FixVerifier.fullVerify(originalCode, fixedCode, fileName, engine.analyze, { allowUnverifiedLanguages: true });
        if (result.valid !== true) return result;
        const problem = serverSyntaxProblem(originalCode, fixedCode, fileName);
        return problem ? { ...result, valid: false, improved: false, reason: problem } : result;
      },
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
