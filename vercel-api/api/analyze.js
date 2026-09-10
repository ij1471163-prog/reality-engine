const fs = require('fs');
const path = require('path');
const vm = require('vm');

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

  const { code, fileName, fix } = req.body;
  if (!code || !fileName) return res.status(400).json({ error: 'code and fileName required' });

  try {
    const ctx = vm.createContext({ console, window: {}, global: {}, F: {}, R: {} });

    const engines = [
      'engine_java.js', 'analyzer.js', 'security_scanner.js',
      'secret_detector.js', 'taint_core.js', 'taint_js.js',
      'taint_py.js', 'taint_php.js', 'context_analyzer.js',
      'repair_engine.js', 'fallback_fixes.js', 'emergency_fixes.js',
      'smart_repair.js', 'fixers_orchestrator.js', 'repair_sql.js', 'self_healing_engine.js',
    ];

    const engineLoadErrors = [];

    engines.forEach(f => {
      const p = path.join(process.cwd(), 'public', f);
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
    if (fix) {
      const SH = ctx.SelfHealing;
      const sqlIssues = issues.filter(i => (i.type||i.cAct||'').toUpperCase().includes('SQL'));

      let usedSelfHealing = false;

      if (SH && sqlIssues.length > 0) {
        for (const issue of sqlIssues) {
          const problem = {
            type: 'SQL_INJECTION', engine: 'repair_sql',
            fileName, code: ctx.F[fileName],
            detail: issue.title || '',
            targetIssues: [issue]
          };
          const healed = SH.heal(problem);
          if (healed && healed.status === 'PENDING_REVIEW' && healed.result === 'PASS') {
            ctx.F[fileName] = healed.patchedCode;
            healingResult = { id: healed.id, status: 'PENDING_REVIEW', result: 'PASS' };
            usedSelfHealing = true;
            break;
          } else if (healed && healed.status === 'ROLLED_BACK') {
            healingResult = { id: healed.id, status: 'ROLLED_BACK', result: 'FAIL' };
            usedSelfHealing = true;
            break;
          }
        }
      }

      if (!usedSelfHealing) {
        // مسار الإصلاح القديم
        for (let p = 0; p < 5; p++) {
          const iss = vm.runInContext(`analyzeCode(F['${fileName}'], '${fileName}')`, ctx);
          if (!iss.length) break;
          ctx.tmpI = iss;
          const r = vm.runInContext(`repairCode(F['${fileName}'], tmpI, '${fileName}')`, ctx);
          if (!r || r.repaired === ctx.F[fileName] || !r.repairs.length) break;
          ctx.F[fileName] = r.repaired;
        }
        ctx.R[fileName] = { issues: vm.runInContext(`analyzeCode(F['${fileName}'], '${fileName}')`, ctx) };
        vm.runInContext('applyFallbackToAll(F, R)', ctx);
        vm.runInContext('SmartRepairEngine.applySmartRepair(F, R)', ctx);
        vm.runInContext('applyEmergencyToAll(F, R)', ctx);
      }

      fixed = ctx.F[fileName];
      // أضف healingResult للـresponse لاحقاً
      ctx._healingResult = healingResult;

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
      fixed: fix ? fixed : undefined,
    });

  } catch(e) {
    res.status(500).json({ error: e.message });
  }
};
