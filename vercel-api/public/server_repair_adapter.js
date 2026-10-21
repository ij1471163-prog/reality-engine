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

  // DETECTOR-PARITY: كاشفاتٌ كانت في الواجهة وحدها.
  //
  // الخادم كان يُحمّل كاشفاتٍ أقلَّ من المتصفح بثمانية عشر ملفًا، منها
  // php_analyzer (كلُّ كشفِ PHP)، ومحلّلات C#/TS/Kotlin/Dart، وknowledge_base
  // وextended_patterns وcve_patterns وcrypto_scanner وdeep_flow
  // وthreat_detector وaccumulation_detector. فما لا يُبلَّغ عنه لا يُصلَح:
  //   db.php (حقنُ SQL بالتسلسل)  : 1 بلاغ → 2، فظهر حقنُ SQL أصلًا
  //   GameServer.js              : 15 بلاغ → 32، منها خللُ تراكمٍ حقيقي
  //                                ‎totalScore = p.score‎ داخل حلقة
  // وهذا بذاته سببُ «الخادم يصلح جزءًا فقط»: يرى جزءًا فقط.
  //
  // والكلفة مقيسة ومهملة: بناءُ الـVM ‎5.0 → 5.9 ms‎ (مرّةً واحدة عند
  // التحميل)، والتحليل ‎3.0 → 7.2 ms‎ للنداء. وكلُّها تُحمَّل بلا خطأ في
  // سياق الخادم (بلا document ولا localStorage) — مقيس ملفًا ملفًا.
  // والترتيب ترتيبُ index.html نفسه كي لا يتباعد المساران.

  // [STEP-SALVAGE] acorn وfix_verifier داخل هذا الـVM تحديدًا.
  //
  // كان الـVM بلا أي بوابة: لا fix_verifier ولا ghost_mode. فـrepairCode هنا
  // يُراكم إصلاحاته بلا تحقّق، ثم يحكم المُنسّق على **المُرشَّح كاملًا** حُكمًا
  // واحدًا عبر محرك fix-verifier المنفصل. فعنصرٌ واحد لا يُثبَت يُلغي كل
  // إصلاحات الملف. والمقيس على ملفٍ فيه خطوة تُثبَت وخطوة لا تُثبَت:
  //     server-repair: attempted=true succeeded=false · safeRepairs 0
  //     ⇒ AI_SUGGESTION ولا يصل العميلَ أي تغيير
  // وبوجود البوابة هنا يُسقِط repairCode الخطوةَ غير المُثبَتة وحدها، فيُسلّم
  // المُنسّقَ مُرشَّحًا مُتحقَّقًا منه أصلًا.
  //
  // وacorn **قبله**: بلا acorn يصير فحصُ JS النحوي غير متوفّر، وسياسة
  // البوابة Fail-Closed فترفض كل شيء. نفس ترتيب api/analyze.js وindex.html.
  const engines = [
    "acorn.min.js",
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
    "deep_analyzer.js",
    "typo_detector.js",
    "accumulation_detector.js",
    "pattern_detector.js",
    "csharp_analyzer.js",
    "dart_analyzer.js",
    "smart_context.js",
    "deep_flow.js",
    "knowledge_base.js",
    "cve_patterns.js",
    "extended_patterns.js",
    "crypto_scanner.js",
    "typescript_analyzer.js",
    "kotlin_analyzer.js",
    "php_analyzer.js",
    "advanced_analyzer.js",
    "threat_detector.js",
    "dependency_analyzer.js",
    "repair_sql.js",
    "fix_verifier.js",
    // مُصلح XSS السياقي: repair_engine.fixXSS يفوّض إليه (يهرّب المقاطع الديناميكية ويُبقي
    // الوسوم) بدل innerHTML → textContent الأعمى. يحتاج acorn المحمَّل أعلاه.
    "xss_fix.js",
    "repair_engine.js",
    "smart_repair.js",
    "sql_injection_fix.js",
    "repair_html.js",
  ];

  for (const file of engines) {
    const p = path.join(__dirname, file);
    if (!fs.existsSync(p)) continue;
    vm.runInContext(fs.readFileSync(p, "utf8"), ctx, { filename: file });

    // repair_sql.js exports through global.RepairSQL inside the VM.
    // Expose it on the VM context so repair_engine.js can use it.
    if (file === "repair_sql.js" && ctx.window?.RepairSQL) {
      ctx.RepairSQL = ctx.window.RepairSQL;
    }
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

    // HTML له Repair Engine متخصص ومستقل.
    // لا نوسّع repair_engine.js ليعالج HTML.
    const ext = String(fileName).split(".").pop().toLowerCase();

    if ((ext === "html" || ext === "htm") &&
        ctx.HTMLRepair &&
        typeof ctx.HTMLRepair.fix === "function") {
      const htmlResult = ctx.HTMLRepair.fix(code, fileName);

      return {
        repaired: typeof htmlResult?.fixed === "string"
          ? htmlResult.fixed
          : code,
        repairs: Array.isArray(htmlResult?.repairs)
          ? htmlResult.repairs
          : [],
        aiNeeded: [],
      };
    }

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
      // ما تُرك عمدًا وسببه وثقته — يبني منه المُنسّق سجل القرار لكل مشكلة
      declined: Array.isArray(result.declined)
        ? result.declined
        : [],
    };
  }

  // [CHAIN] محرك إصلاح ثانٍ للسلسلة — SmartRepair.
  //
  // سلسلةُ المُنسّق مبنيّةٌ على تعدّد المحركات: كلٌّ يعمل على آخر كودٍ
  // مُتحقَّقٍ منه، ويُعاد التحليل بينها فلا يرى التاليُ ما أصلحه السابق.
  // وكان المُسجَّل محركًا **واحدًا**، فالسلسلة بلا بديل: ما لا يُصلحه
  // repair_engine لا يُصلحه شيء.
  //
  // وأثرُ ذلك مقيس: حقنُ SQL في JS. مُصلِحُ repair_engine يُنتج نصًّا
  // بمُعلِّقٍ وبلا ربطِ معاملات، فلا يجتاز البوابة بحال، فيذهب كلُّ حقن SQL
  // إلى مسار AI. وSmartRepair يُنتج الشكل المربوط الذي تُثبته البوابة
  // (استعلامٌ بـ‎?‎ ومعاملاتٌ في نفس الاستدعاء) — وكان غائبًا عن الخادم
  // تمامًا، موجودًا في مسار الواجهة وحده.
  //
  // ولا ازدواج: نفس المحرك الذي يستدعيه fix_engine_pipeline، يُسجَّل هنا
  // بأولوية أدنى فيُجرَّب بعد repair_engine على ما بقي من بلاغات.
  function repairSmart(code, issues, fileName) {
    const E = ctx.SmartRepairEngine ||
      (ctx.window && ctx.window.SmartRepairEngine) || null;
    if (!E || typeof E.repair !== "function") {
      return { repaired: code, repairs: [], aiNeeded: [] };
    }

    ctx.F = { [fileName]: code };
    ctx.R = { [fileName]: { issues } };

    const out = E.repair(code, fileName, Array.isArray(issues) ? issues : []);

    return {
      repaired: typeof out?.fixed === "string" ? out.fixed : code,
      repairs: Array.isArray(out?.repairs) ? out.repairs : [],
      aiNeeded: [],
    };
  }

  // [CHAIN] ومحرك ثالث: RepairSQL.
  //
  // يملك مسارَ PHP/PDO الذي لا يملكه غيره (prepare + execute بمعاملات)، وكان
  // غيرَ مُستدعًى على الخادم إطلاقًا: repair_engine لا يصل إليه إلا كبديلٍ
  // داخلي لاستراتيجية SQL_INJECTION، وبلاغُ php لا يحمل تلك الاستراتيجية.
  // والمقيس قبل تسجيله: حقنُ SQL في PHP يُكتشَف ولا يُصلحه أيُّ محرك
  // (repairCode و SmartRepair كلاهما changed=false).
  function repairSqlEngine(code, issues, fileName) {
    const E = ctx.RepairSQL || (ctx.window && ctx.window.RepairSQL) || null;
    if (!E || typeof E.fix !== "function") {
      return { repaired: code, repairs: [], aiNeeded: [] };
    }

    ctx.F = { [fileName]: code };
    ctx.R = { [fileName]: { issues } };

    let out;
    try { out = E.fix(code, fileName); }
    catch (e) { return { repaired: code, repairs: [], aiNeeded: [] }; }

    return {
      repaired: typeof out?.code === "string" ? out.code : code,
      repairs: Array.isArray(out?.fixes) ? out.fixes : [],
      aiNeeded: [],
    };
  }

  return { analyze, repair, repairSmart, repairSqlEngine };
}

module.exports = {
  createRepairEngine,
};
