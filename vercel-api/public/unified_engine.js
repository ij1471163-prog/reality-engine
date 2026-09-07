// ═══════════════════════════════════════════════════════
// unified_engine.js v1.0 — المحرك الموحد
// يجمع كل الـ layers ويغذي بعضها
// ═══════════════════════════════════════════════════════
"use strict";

var UnifiedEngine = (() => {

  // ─── Shared Knowledge Base ────────────────────────
  // قاعدة المعرفة المشتركة بين كل الـ layers
  class KnowledgeBase {
    constructor() {
      this.vars     = new Map(); // varName → {type, safe, source, line}
      this.funcs    = new Map(); // funcName → {returnType, transforms, safe}
      this.flows    = new Map(); // varName → [flow history]
      this.sinks    = [];        // sink detections
      this.issues   = [];        // confirmed issues
      this.safe     = [];        // confirmed safe patterns
    }

    // يضيف معرفة من layer
    addVar(name, info, source) {
      const existing = this.vars.get(name);
      // لو موجود - ادمج المعلومات
      if (existing) {
        // الأخطر يكسب
        if (info.dangerous && !existing.dangerous) {
          this.vars.set(name, { ...existing, ...info, source });
        } else if (!info.safe && existing.safe) {
          this.vars.set(name, { ...existing, safe: false, source });
        }
      } else {
        this.vars.set(name, { ...info, source });
      }
    }

    // يسجل flow
    addFlow(from, to, line) {
      if (!this.flows.has(from)) this.flows.set(from, []);
      this.flows.get(from).push({ to, line });
    }

    // يضيف issue مؤكد
    addIssue(issue, confidence) {
      // تجنب التكرار
      if (!this.issues.some(i => i.line === issue.line && i.type === issue.type)) {
        this.issues.push({ ...issue, confidence });
      }
    }

    // يضيف pattern آمن
    addSafe(pattern) {
      this.safe.push(pattern);
    }

    // هل المتغير آمن؟
    isSafe(name) {
      const info = this.vars.get(name);
      if (!info) return true; // unknown = assume safe
      return info.safe === true;
    }

    isDangerous(name) {
      const info = this.vars.get(name);
      return info?.dangerous === true || info?.type === 'user_input';
    }
  }

  // ─── Layer Runner ─────────────────────────────────
  async function analyze(code, fileName) {
    const kb = new KnowledgeBase();
    const ext = (fileName || '').split('.').pop().toLowerCase();
    const lang = ext === 'py' ? 'py' : ext === 'php' ? 'php' : 'js';

    // ── Layer 1: TypeInference ─────────────────────
    if (typeof TypeInference !== 'undefined') {
      try {
        const { registry } = TypeInference.analyze(code, fileName);
        registry.vars.forEach((info, name) => {
          kb.addVar(name, {
            type: info.type,
            safe: info.safe,
            dangerous: info.dangerous,
            source: 'TypeInference',
          }, 'TypeInference');
        });
      } catch(e) {}
    }

    // ── Layer 2: SmartContext ──────────────────────
    if (typeof SmartContext !== 'undefined') {
      try {
        const scResult = SmartContext.analyzeCode(code, fileName);
        scResult.issues.forEach(i => kb.addIssue(i, i.conf || 80));
      } catch(e) {}
    }

    // ── Layer 3: DeepFlow ─────────────────────────
    if (typeof DeepFlow !== 'undefined') {
      try {
        const df = DeepFlow.analyze(code, fileName);
        // اضف المتغيرات من DeepFlow
        df.varTypes.forEach((type, name) => {
          kb.addVar(name, {
            type,
            safe: ['hash','env','constant','sql_safe','sanitized'].includes(type),
            dangerous: ['user_input','sql_unsafe','secret'].includes(type),
            source: 'DeepFlow',
          }, 'DeepFlow');
        });
        df.issues.forEach(i => kb.addIssue(i, i.conf || 85));
      } catch(e) {}
    }

    // ── Layer 4: Taint Analysis ───────────────────
    if (typeof TaintAnalyzer !== 'undefined') {
      try {
        const taint = TaintAnalyzer.analyze(code, fileName);
        taint.issues?.forEach(i => kb.addIssue(i, i.conf || 88));
      } catch(e) {}
    }

    // ── Layer 5: BabelAnalyzer (JS only) ──────────
    if (typeof BabelAnalyzer !== 'undefined' && ['js','ts','jsx','tsx'].includes(ext)) {
      try {
        const babel = BabelAnalyzer.analyze(code, fileName);
        babel.forEach(i => kb.addIssue(i, i.conf || 90));
      } catch(e) {}
    }

    // ── Layer 6: Cross-Layer Validation ───────────
    // يستخدم kb للتحقق من كل issue
    const validated = kb.issues.filter(issue => {
      // لو DeepFlow قال آمن لكن TypeInference قال خطر → خطر
      // لو كل الـ layers وافقت → confirmed
      return true; // الحين نقبل كل شيء - نحسنه لاحقاً
    });

    // ── Layer 7: Learning Integration ─────────────
    if (typeof LearningEngine !== 'undefined') {
      try {
        const boosts = LearningEngine.getBoosts();
        validated.forEach(issue => {
          const boost = boosts.get(issue.type || '');
          if (boost && boost > 0.7) {
            issue.conf = Math.min(99, Math.round((issue.conf || 80) * (1 + boost * 0.1)));
            issue.boosted = true;
          }
        });
      } catch(e) {}
    }

    // ── Final Dedup ───────────────────────────────
    const seen = new Set();
    const final = validated.filter(issue => {
      const key = `${issue.line}:${issue.type}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    return {
      issues: final,
      kb,
      score: calcScore(final),
      lang,
    };
  }

  // ─── Score Calculator ─────────────────────────────
  function calcScore(issues) {
    const c = issues.filter(i => i.sev === 'c').length;
    const h = issues.filter(i => i.sev === 'h').length;
    const m = issues.filter(i => i.sev === 'm').length;
    const l = issues.filter(i => i.sev === 'l' || i.sev === 'w').length;
    return Math.max(0, Math.round(100 - Math.min(90, c*10 + h*5 + m*2 + l*1)));
  }

  // ─── Export ───────────────────────────────────────
  return { analyze, KnowledgeBase, calcScore };
})();

if (typeof window !== 'undefined') window.UnifiedEngine = UnifiedEngine;
