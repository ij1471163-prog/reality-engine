const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { RealityOrchestrator } = require('../public/server_engine_registration.js');

const analyzeLimits = new Map();

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();
  
  // Rate limit: 20 requests per IP per 10min
  const ip = req.headers['x-forwarded-for']?.split(',')[0] || 'unknown';
  const now = Date.now();
  const limits = (analyzeLimits.get(ip) || []).filter(t => now - t < 600000);
  if (limits.length >= 20) return res.status(429).json({ error: 'Rate limit exceeded' });
  analyzeLimits.set(ip, [...limits, now]);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  // Session authentication — same rotating HMAC token used by /api/chat.
  const auth = req.headers['authorization'] || '';
  const token = auth.replace(/^Bearer\s+/i, '').trim();
  if (!token) return res.status(401).json({ error: 'No token' });

  const master = process.env.MASTER_SECRET || '';
  if (!master) return res.status(500).json({ error: 'Server authentication is not configured' });

  const crypto = require('crypto');
  let valid = false;

  for (let w = 0; w <= 1; w++) {
    const window = Math.floor(Date.now() / (10 * 60 * 1000)) - w;
    const expected = crypto.createHmac('sha256', master)
      .update('web_' + window)
      .digest('hex');

    if (token === expected) {
      valid = true;
      break;
    }
  }

  if (!valid) return res.status(401).json({ error: 'Invalid token' });

  const { code, fileName, fix } = req.body;
  if (!code || !fileName) return res.status(400).json({ error: 'code and fileName required' });

  try {
    const ctx = vm.createContext({ console, window: {}, global: {}, F: {}, R: {} });

    const engines = [
      'engine_java.js', 'c_cpp_analyzer.js', 'analyzer.js', 'security_scanner.js',
      'secret_detector.js', 'taint_core.js', 'taint_js.js',
      'taint_py.js', 'taint_php.js', 'context_analyzer.js',
      'repair_engine.js', 'fallback_fixes.js', 'emergency_fixes.js',
      'smart_repair.js', 'fixers_orchestrator.js', 'repair_sql.js', 'self_healing_engine.js',
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
      return res.status(500).json({
        error: 'analyzeCode is not defined in VM',
        available: Object.keys(ctx).filter(k => /analyze|engine|taint/i.test(k))
      });
    }

    if (engineLoadErrors.length) {
      return res.status(500).json({
        error: 'Engine load errors',
        details: engineLoadErrors
      });
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
      orchestrator: fix ? orchestratorResult : undefined,
    });

  } catch(e) {
    res.status(500).json({ error: e.message });
  }
};
