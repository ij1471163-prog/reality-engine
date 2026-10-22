const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { RealityOrchestrator } = require('../public/server_engine_registration.js');

const sec = require('../lib/api_security.js');

// حدود عديمة الحالة تسري في كل نسخة. القياس على مدخلٍ خبيث (تكرار سطرٍ قصير):
// 50KB بلا إصلاح ≈ 1.3 ثانية و200KB ≈ 18 ثانية، ومع fix: 5KB ≈ 2.7 و10KB ≈ 10.
// النموّ أسرع من خطي، فالحجم يخفّف ولا يضمن: السقف الحاسم maxDuration في vercel.json.
const MAX_CODE_CHARS = 100 * 1024;
const MAX_FIX_CODE_CHARS = 10 * 1024;
const MAX_FILENAME_CHARS = 255;

// احتياطيٌّ داخل نسخةٍ واحدة — ليس حماية. الحدُّ الحقيقي: قاعدة Vercel WAF.
const perIp = sec.bestEffortLimiter(20, 10 * 60 * 1000);

// لا CORS: أندرويد عميلٌ أصلي لا يحتاجه، والويب لا يستدعي هذا المسار.
module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  // رمز الجلسة — نفسه الذي يقبله /api/chat. ليس مصادقة (lib/api_security.js).
  if (!sec.requireSession(req, res)) return;
  if (!perIp(sec.clientIp(req))) return res.status(429).json({ error: 'Rate limit exceeded' });

  const { code, fileName, fix } = req.body || {};
  if (typeof code !== 'string' || !code || typeof fileName !== 'string' || !fileName) {
    return res.status(400).json({ error: 'code and fileName required' });
  }
  if (fileName.length > MAX_FILENAME_CHARS || /[\u0000-\u001f]/.test(fileName)) {
    return res.status(400).json({ error: 'invalid fileName' });
  }
  if (code.length > MAX_CODE_CHARS) {
    return res.status(413).json({ error: 'Code too large', maxChars: MAX_CODE_CHARS });
  }
  if (fix && code.length > MAX_FIX_CODE_CHARS) {
    return res.status(413).json({ error: 'Code too large for fix', maxChars: MAX_FIX_CODE_CHARS });
  }

  try {
    const ctx = vm.createContext({ console, window: {}, global: {}, F: {}, R: {} });

    // acorn أولًا: GhostMode.syntaxOk تُعطِّل نفسها إذا لم يكن acorn معرّفًا،
    // فبدونه يمرّ إصلاح لا يُحلَّل بحكم pass. نفس ترتيب index.html.
    //
    // DETECTOR-PARITY: من deep_analyzer إلى dependency_analyzer كاشفاتٌ كانت
    // في الواجهة وحدها. تفصيلُ السبب والقياس في
    // public/server_repair_adapter.js. بدونها يرى هذا المسار بلاغاتٍ أقلَّ
    // من الواجهة على نفس الملف، فيختلف ما يُعرَض عمّا يُصلَح.
    //
    // ولا أقواسَ مُعقَّفة في تعليقات هذه المصفوفة: اختبار ghost_syntax_gate
    // يستخرج القائمة بـ‎/const engines = \[([\s\S]*?)\]/‎ غيرِ الشَرِه،
    // فأيُّ ‎]‎ داخلها يقطع الاستخراج فتُقرأ القائمة ناقصة.
    const engines = [
      'acorn.min.js',
      'engine_java.js', 'c_cpp_analyzer.js', 'analyzer.js', 'security_scanner.js',
      'secret_detector.js', 'taint_core.js', 'taint_js.js',
      'taint_py.js', 'taint_php.js', 'context_analyzer.js',
      'deep_analyzer.js',
      'typo_detector.js',
      'accumulation_detector.js',
      'pattern_detector.js',
      'csharp_analyzer.js',
      'dart_analyzer.js',
      'smart_context.js',
      'deep_flow.js',
      'knowledge_base.js',
      'cve_patterns.js',
      'extended_patterns.js',
      'crypto_scanner.js',
      'typescript_analyzer.js',
      'kotlin_analyzer.js',
      'php_analyzer.js',
      'advanced_analyzer.js',
      'threat_detector.js',
      'dependency_analyzer.js',
      'repair_engine.js', 'fallback_fixes.js', 'emergency_fixes.js',
      'smart_repair.js', 'fixers_orchestrator.js', 'repair_sql.js', 'healing_log_schema.js', 'healing_log_policy.js', 'healing_store.js', 'self_healing_engine.js',
      'repair_html.js', 'repair_advanced.js', 'fix_verifier.js',
      'ghost_mode.js', 'learning_validation.js', 'learning_knowledge.js', 'learning_engine.js', 'fix_engine_pipeline.js',
    ];

    const engineLoadErrors = [];

    engines.forEach(f => {
      const p = path.join(__dirname, '..', 'public', f);
      if (fs.existsSync(p)) {
        try {
          vm.runInContext(fs.readFileSync(p, 'utf8'), ctx);
        } catch(e) {
          engineLoadErrors.push(f + ': ' + e.message);
        }
      }
    });

    // ربط الـexports التي تستخدم window داخل VM
    if (ctx.window) {
      if (ctx.window.RepairSQL) ctx.RepairSQL = ctx.window.RepairSQL;
      if (ctx.window.SelfHealing) ctx.SelfHealing = ctx.window.SelfHealing;
    }

    // تحقق من المحلل داخل VM
    if (typeof ctx.analyzeCode !== 'function') {
      console.error('[analyze] analyzeCode is not defined in VM');
      return res.status(500).json({ error: 'Analyzer unavailable' });
    }

    if (engineLoadErrors.length) {
      console.error('[analyze] engine load errors:', engineLoadErrors);
      return res.status(500).json({ error: 'Analyzer unavailable' });
    }

    // تحليل
    // fileName يأتي من الطلب: يُمرَّر كقيمة داخل الـcontext ولا يُدمج في نص كود يُنفَّذ
    ctx.__name = fileName;
    ctx.F = { [fileName]: code };
    ctx.R = { [fileName]: { issues: [] } };
    ctx.R[fileName].issues = ctx.analyzeCode(code, fileName);

    const issues = ctx.R[fileName].issues || [];
    const c = issues.filter(i => i.sev==='c').length;
    const h = issues.filter(i => i.sev==='h').length;
    const m = issues.filter(i => i.sev==='m').length;
    const l = issues.filter(i => i.sev==='l').length;
    const score = Math.max(0, Math.round(100 - Math.min(90, c*10+h*5+m*2+l*1)));

      let fixed = code;
    let healingResult = null;
    let orchestratorResult = null;

    if (fix) {
      // Central repair pipeline:
      // Analyzer -> deterministic repair/fallback -> verification -> Claude fallback.
      // Claude suggestions are NEVER auto-applied.
      orchestratorResult = await RealityOrchestrator.runPipelineAsync(
        code,
        fileName,
        { useFallbackChain: true }
      );

      const decision = orchestratorResult && orchestratorResult.decision;

      if (decision && decision.decision === RealityOrchestrator.Decision.SAFE_AUTO_FIX) {
        fixed = decision.patch || code;
      }

      // Preserve the existing healing field while exposing the new
      // orchestrator decision for the client.
      healingResult = {
        status: decision ? decision.decision : 'PENDING_REVIEW',
        result: decision ? decision.reason : 'No orchestrator decision',
      };
    }

    res.status(200).json({ healing: healingResult || null,
      success: true,
      fileName,
      issues: issues.map(i => ({
        title: i.title, line: i.line,
        severity: i.sev, type: i.type,
        fix: i.fix, conf: i.conf,
      })),
      score,
      stats: { critical: c, high: h, medium: m, low: l, total: issues.length },
      fixed: fix && orchestratorResult &&
        orchestratorResult.decision &&
        orchestratorResult.decision.decision === RealityOrchestrator.Decision.SAFE_AUTO_FIX
          ? fixed
          : undefined,
      // ملخّصٌ فقط: الكائن الكامل يكشف داخل المنسّق (مراحل، مسارات، تفاصيل
      // البوابة) ولا عميل يقرؤه — أندرويد يقرأ score/stats/issues/fixed.
      orchestrator: fix ? {
        decision: orchestratorResult && orchestratorResult.decision ? orchestratorResult.decision.decision : null,
        reason: orchestratorResult && orchestratorResult.decision ? orchestratorResult.decision.reason : null,
      } : undefined,
    });

  } catch(e) {
    console.error('[analyze] failed:', e && e.stack || e);
    res.status(500).json({ error: 'Analysis failed' });
  }
};
