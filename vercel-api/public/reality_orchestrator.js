// ═══════════════════════════════════════════════════════
// reality_orchestrator.js v0.3 — RealityOrchestrator
// Central Engine Manager — Registry + Routing + Fallback + Policy
// ═══════════════════════════════════════════════════════
//
// Architecture:
//   Registry → Routing → FallbackChain → Verification → Policy → Decision
//
// Key guarantees:
//   1. makeResult() is internal — external code cannot forge decisions.
//   2. SAFE_AUTO_FIX requires: REPAIR source + Verification + Policy.
//   3. Claude = suggestion only. Policy forbids Claude → SAFE_AUTO_FIX.
//   4. Fallback chain: each stage starts from original or last VERIFIED code.
//      Unverified patches never stack on top of each other.
//   5. Fail-Closed: any ambiguous state → PENDING_REVIEW.
//   6. Safe repairs and AI_REQUIRED are tracked independently throughout.
// ═══════════════════════════════════════════════════════

"use strict";

var RealityOrchestrator = (() => {

  // ─── Version ─────────────────────────────────────────
  const VERSION = '0.3.0';

  // ─── Internal token — prevents external makeResult calls ──
  const _INTERNAL = Symbol('ORCHESTRATOR_INTERNAL');

  // ─── Decision ────────────────────────────────────────
  const Decision = Object.freeze({
    SAFE_AUTO_FIX:  'SAFE_AUTO_FIX',
    NEEDS_VERIFY:   'NEEDS_VERIFY',
    AI_SUGGESTION:  'AI_SUGGESTION',
    PENDING_REVIEW: 'PENDING_REVIEW',
    REJECTED:       'REJECTED',
  });
  const _VALID_DECISIONS = new Set(Object.values(Decision));

  // ─── Engine Types ─────────────────────────────────────
  const EngineType = Object.freeze({
    ANALYZER:  'ANALYZER',
    REPAIR:    'REPAIR',
    VERIFIER:  'VERIFIER',
    AI:        'AI',
  });

  // ─── Source ───────────────────────────────────────────
  const Source = Object.freeze({
    REPAIR_ENGINE: 'REPAIR_ENGINE',
    FALLBACK:      'FALLBACK',
    EMERGENCY:     'EMERGENCY',
    GHOST_MODE:    'GHOST_MODE',
    CLAUDE:        'CLAUDE',
    ORCHESTRATOR:  'ORCHESTRATOR',
  });

  // ─── Sources allowed to reach SAFE_AUTO_FIX ──────────
  const _SAFE_SOURCES = new Set([
    Source.REPAIR_ENGINE,
    Source.FALLBACK,
    Source.EMERGENCY,
    Source.GHOST_MODE,
  ]);

  // ─── Policy — controls SAFE_AUTO_FIX conditions ──────
  // All fields must pass for SAFE_AUTO_FIX to be issued.
  let _policy = {
    requireVerification: true,   // verification must run and pass
    requireImprovement:  true,   // verifier must report improved=true
    forbidClaudeAutoFix: true,   // Claude source can NEVER be SAFE_AUTO_FIX
    minRepairCount:      1,      // at least N successful repairs
    allowedSources:      new Set([
      Source.REPAIR_ENGINE, Source.FALLBACK,
      Source.EMERGENCY, Source.GHOST_MODE,
    ]),
  };

  // Hard minimums — cannot be weakened below these values
  const _POLICY_MINIMUMS = Object.freeze({
    minRepairCount:      1,       // at least 1 confirmed repair
    requireVerification: true,    // verification is always required
    requireImprovement:  true,    // patch must improve the code
    forbidClaudeAutoFix: true,    // Claude can NEVER produce SAFE_AUTO_FIX
  });

  // Sources that can NEVER appear in allowedSources
  const _FORBIDDEN_SOURCES = new Set([Source.CLAUDE, Source.AI]);

  function setPolicy(overrides) {
    if (!overrides || typeof overrides !== 'object') return;
    // Apply overrides then enforce hard minimums
    const merged = Object.assign({}, _policy, overrides);
    // Hard invariants — cannot be overridden
    merged.forbidClaudeAutoFix = true;
    merged.requireVerification = true;   // always required
    merged.requireImprovement  = true;   // always required
    // minRepairCount floor = 1
    merged.minRepairCount = Math.max(1, merged.minRepairCount || 1);
    // allowedSources cannot include Claude or AI
    if (merged.allowedSources instanceof Set) {
      _FORBIDDEN_SOURCES.forEach(s => merged.allowedSources.delete(s));
    }
    _policy = merged;
  }

  function getPolicy() {
    return Object.assign({}, _policy,
      { allowedSources: new Set(_policy.allowedSources) });
  }

  function _checkPolicy(source, repairCount, verifyResult) {
    if (_policy.forbidClaudeAutoFix && source === Source.CLAUDE) return false;
    if (!_policy.allowedSources.has(source))                    return false;
    if (_policy.requireVerification && !verifyResult)           return false;
    if (_policy.requireVerification && verifyResult.valid !== true) return false;
    if (_policy.requireImprovement  && verifyResult.improved !== true) return false;
    if ((repairCount || 0) < (_policy.minRepairCount || 1))     return false;
    return true;
  }

  // ─── Registry ─────────────────────────────────────────
  const _registry = new Map();

  function _validateEntry(id, type, fn, caps) {
    if (!id || typeof id !== 'string')               throw new TypeError('id must be a non-empty string');
    if (!Object.values(EngineType).includes(type))   throw new TypeError(`Unknown EngineType: ${type}`);
    if (typeof fn !== 'function')                    throw new TypeError('fn must be a function');
    if (!Array.isArray(caps))                        throw new TypeError('capabilities must be an array');
  }

  function registerEngine(id, type, fn, capabilities = [], meta = {}) {
    _validateEntry(id, type, fn, capabilities);
    if (_registry.has(id)) throw new Error(`Engine "${id}" already registered`);
    _registry.set(id, _deepFreeze({ id, type, fn,
      capabilities: [...capabilities], meta,
      registeredAt: Date.now(), priority: meta.priority || 0 }));
    return true;
  }

  function updateEngine(id, type, fn, capabilities = [], meta = {}) {
    _validateEntry(id, type, fn, capabilities);
    if (!_registry.has(id)) throw new Error(`Engine "${id}" not registered`);
    const prev = _registry.get(id);
    _registry.set(id, _deepFreeze({ id, type, fn,
      capabilities: [...capabilities], meta,
      registeredAt: prev.registeredAt,
      updatedAt: Date.now(), priority: meta.priority || 0 }));
    return true;
  }

  function unregisterEngine(id) {
    return _registry.delete(id);
  }

  function getEngine(id)     { return _registry.get(id) || null; }
  function hasEngine(id)     { return _registry.has(id); }
  function listEngines(type) {
    const list = [..._registry.values()];
    const filtered = type ? list.filter(e => e.type === type) : list;
    return filtered.sort((a, b) => (b.priority || 0) - (a.priority || 0));
  }

  // ─── Routing ─────────────────────────────────────────
  function routeIssue(issue) {
    if (!issue || !issue.type) return [];
    const t = String(issue.type).toUpperCase();
    return listEngines(EngineType.REPAIR).filter(e =>
      e.capabilities.some(c => c.toUpperCase() === t || c === '*'));
  }

  function routeAnalyzer(fileName) {
    if (!fileName) return listEngines(EngineType.ANALYZER);
    const ext = fileName.split('.').pop().toLowerCase();
    return listEngines(EngineType.ANALYZER).filter(e =>
      e.capabilities.length === 0 ||
      e.capabilities.some(c => c === '*' || c.toLowerCase() === ext));
  }

  // ─── Immutable helpers ────────────────────────────────
  function _deepFreeze(obj) {
    if (!obj || typeof obj !== 'object') return obj;
    Object.getOwnPropertyNames(obj).forEach(k => {
      const v = obj[k];
      if (v && typeof v === 'object' && !(v instanceof Set)) _deepFreeze(v);
    });
    return Object.freeze(obj);
  }

  // ─── Internal result factory ──────────────────────────
  // token parameter prevents external callers from forging results.
  function _makeResult(token, decision, source, patch, reason, meta) {
    if (token !== _INTERNAL) {
      throw new Error('_makeResult is internal — use makeApproval() for human approvals');
    }
    if (!_VALID_DECISIONS.has(decision)) {
      decision = Decision.PENDING_REVIEW;
      reason   = `Unknown decision "${decision}" — Fail-Closed to PENDING_REVIEW`;
    }
    // Hard constraint: Claude cannot be SAFE_AUTO_FIX
    if (source === Source.CLAUDE && decision === Decision.SAFE_AUTO_FIX) {
      decision = Decision.AI_SUGGESTION;
      reason   = 'Claude source → downgraded to AI_SUGGESTION (Policy invariant)';
    }
    return _deepFreeze({
      version:    VERSION,
      decision,
      source:     source || null,
      patch:      typeof patch === 'string' ? patch : null,
      reason:     String(reason || ''),
      meta:       meta   || {},
      appliedAt:  null,
      approvedBy: null,
    });
  }

  // ─── makeApproval — public, human-approval record only ──
  // Records a human's intent to approve an AI suggestion.
  // The result stays AI_SUGGESTION — approval alone is NOT permission to apply.
  //
  // To reach apply-allowed state, the approved suggestion must STILL pass:
  //   1. runVerification() — technical safety check
  //   2. Policy gate in decide() — structural requirements
  //
  // Intended state machine:
  //   AI_SUGGESTION → makeApproval() → AI_SUGGESTION (with approvedBy)
  //               → runVerification() → decide() → conditional SAFE_AUTO_FIX
  //
  // Note: SAFE_AUTO_FIX from Claude source is blocked by Policy invariant.
  function makeApproval(orchestratorResult, approvedBy) {
    if (!orchestratorResult ||
        orchestratorResult.decision !== Decision.AI_SUGGESTION) {
      return _makeResult(_INTERNAL, Decision.PENDING_REVIEW, Source.ORCHESTRATOR,
        null, 'makeApproval: input must be an AI_SUGGESTION result');
    }
    if (!approvedBy || typeof approvedBy !== 'string') {
      return _makeResult(_INTERNAL, Decision.PENDING_REVIEW, Source.ORCHESTRATOR,
        null, 'makeApproval: approvedBy must be a non-empty string');
    }
    return _makeResult(_INTERNAL,
      Decision.AI_SUGGESTION,        // still AI_SUGGESTION until verified
      orchestratorResult.source,
      orchestratorResult.patch,
      `Human-approved by "${approvedBy}" — still requires Verification before apply`,
      Object.assign({}, orchestratorResult.meta, {
        approvedBy,
        approvedAt: Date.now(),
        requiresVerification: true,   // approval alone is not enough
      })
    );
  }

  // ─── ANALYZE phase ────────────────────────────────────
  function runAnalysis(code, fileName) {
    if (typeof code !== 'string' || !fileName) {
      return _makeResult(_INTERNAL, Decision.PENDING_REVIEW, Source.ORCHESTRATOR,
        null, 'runAnalysis: code must be string and fileName must be provided');
    }
    const engines = routeAnalyzer(fileName);
    if (engines.length === 0) {
      return _makeResult(_INTERNAL, Decision.PENDING_REVIEW, Source.ORCHESTRATOR,
        null, `No ANALYZER registered for "${fileName}"`);
    }
    const allIssues = [], errors = [];
    for (const engine of engines) {
      try {
        const r = engine.fn(code, fileName);
        if (Array.isArray(r)) allIssues.push(...r);
      } catch (e) {
        errors.push({ engine: engine.id, error: String(e.message) });
      }
    }
    return _deepFreeze({
      phase: 'ANALYZE', fileName,
      issues: allIssues, errors,
      engines: engines.map(e => e.id),
    });
  }

  // ─── Single REPAIR attempt (one engine) ───────────────
  function _tryRepair(engine, code, issues, fileName) {
    try {
      const r = engine.fn(code, issues, fileName);
      if (!r || typeof r !== 'object') return null;
      return {
        engineId:    engine.id,
        safeRepairs: Array.isArray(r.repairs)  ? r.repairs  : [],
        aiNeeded:    Array.isArray(r.aiNeeded) ? r.aiNeeded : [],
        repairedCode: typeof r.repaired === 'string' ? r.repaired : code,
        hasChanges:  typeof r.repaired === 'string' && r.repaired !== code,
      };
    } catch (e) {
      return { engineId: engine.id, error: String(e.message),
               safeRepairs: [], aiNeeded: [], repairedCode: code, hasChanges: false };
    }
  }

  // ─── REPAIR phase — aggregates ALL registered repair engines ───
  // All engines are tried and their results are merged (concat).
  // Use runFallbackChain() instead when you want:
  //   - Stop at first verified success (don't call subsequent engines)
  //   - Priority ordering with fallback on failure
  //   - No unverified patch stacking
  // ─────────────────────────────────────────────────────────────
  function runRepair(code, issues, fileName) {
    if (typeof code !== 'string' || !Array.isArray(issues) || !fileName) {
      return _makeResult(_INTERNAL, Decision.PENDING_REVIEW, Source.ORCHESTRATOR,
        null, 'runRepair: invalid arguments');
    }
    const engines = listEngines(EngineType.REPAIR);
    if (engines.length === 0) {
      return _makeResult(_INTERNAL, Decision.PENDING_REVIEW, Source.ORCHESTRATOR,
        null, 'No REPAIR engine registered');
    }
    let safeRepairs = [], aiNeeded = [], repairedCode = code, errors = [];
    for (const engine of engines) {
      const r = _tryRepair(engine, repairedCode, issues, fileName);
      if (!r) continue;
      if (r.error) { errors.push({ engine: r.engineId, error: r.error }); continue; }
      safeRepairs  = [...safeRepairs,  ...r.safeRepairs];
      aiNeeded     = [...aiNeeded,     ...r.aiNeeded];
      if (r.hasChanges) repairedCode = r.repairedCode;
    }
    return _deepFreeze({
      phase: 'REPAIR', fileName, original: code,
      repairedCode: repairedCode !== code ? repairedCode : null,
      safeRepairs, aiNeeded,
      hasChanges: repairedCode !== code,
      errors,
    });
  }

  // ─── VERIFY phase ─────────────────────────────────────
  function runVerification(originalCode, patchedCode, fileName) {
    if (!originalCode || !patchedCode || !fileName) {
      return _deepFreeze({ phase: 'VERIFY', valid: false, improved: false,
        reason: 'runVerification: missing required arguments', errors: [] });
    }
    if (originalCode === patchedCode) {
      return _deepFreeze({ phase: 'VERIFY', valid: true, improved: false,
        reason: 'No change between original and patched', errors: [] });
    }
    const verifiers = listEngines(EngineType.VERIFIER);
    if (verifiers.length === 0) {
      return _deepFreeze({ phase: 'VERIFY', valid: false, improved: false,
        reason: 'No VERIFIER registered — cannot confirm patch safety (Fail-Closed)', errors: [] });
    }
    let valid = true, improved = false, reason = '', errors = [];
    for (const engine of verifiers) {
      try {
        const r = engine.fn(originalCode, patchedCode, fileName);
        if (!r) continue;
        if (r.valid === false) { valid = false; reason = r.reason || 'Verification failed'; break; }
        if (r.improved === true) improved = true;
        if (r.reason) reason = r.reason;
      } catch (e) {
        errors.push({ engine: engine.id, error: String(e.message) });
        valid = false; reason = `Verifier "${engine.id}" threw: ${e.message}`;
      }
    }
    return _deepFreeze({ phase: 'VERIFY', valid, improved, reason, errors });
  }

  // ─── AI phase ────────────────────────────────────────
  function recordAISuggestion(suggestion, issue, fileName) {
    if (!suggestion || typeof suggestion !== 'string' || suggestion.trim().length < 5) {
      return _makeResult(_INTERNAL, Decision.PENDING_REVIEW, Source.CLAUDE,
        null, 'AI suggestion is empty or too short');
    }
    if (!issue || !fileName) {
      return _makeResult(_INTERNAL, Decision.PENDING_REVIEW, Source.CLAUDE,
        null, 'recordAISuggestion: missing issue or fileName');
    }
    return _makeResult(_INTERNAL,
      Decision.AI_SUGGESTION,          // always — Claude never produces SAFE_AUTO_FIX
      Source.CLAUDE,
      suggestion.trim(),
      `Claude suggestion for "${issue.title || 'unknown'}" — requires approval + verification`,
      { issue, fileName, requiresApproval: true, requiresVerification: true }
    );
  }

  // ─── Fallback Chain — first-verified-wins with no-stack guarantee ──
  // KEY differences from runRepair():
  //   - Stops at the FIRST engine whose patch passes verification (don't waste cycles)
  //   - Each engine starts from ORIGINAL code (unverified patches never stack)
  //   - Falls back to claudeFallback:true if ALL engines fail
  //   - Respects engine priority order (higher priority = tried first)
  // ─────────────────────────────────────────────────────────────────
  // Tries repair engines in priority order.
  // Each stage starts from ORIGINAL code (no unverified stacking).
  // Stops at first engine that produces a VERIFIED improvement.
  // Falls back to Claude if all repair engines fail.
  //
  // Returns a FallbackResult:
  // {
  //   phase: 'FALLBACK',
  //   stages: [{ engineId, attempted, succeeded, verifyResult }],
  //   safeRepairs: [],  aiNeeded: [],
  //   verifiedCode: string | null,
  //   verifyResult: object | null,
  //   claudeFallback: bool,
  // }
  function runFallbackChain(code, issues, fileName) {
    if (typeof code !== 'string' || !Array.isArray(issues) || !fileName) {
      return _makeResult(_INTERNAL, Decision.PENDING_REVIEW, Source.ORCHESTRATOR,
        null, 'runFallbackChain: invalid arguments');
    }

    const engines = listEngines(EngineType.REPAIR);
    const stages  = [];
    let allSafeRepairs = [];
    let allAiNeeded    = [];
    let verifiedCode   = null;
    let verifyResult   = null;

    for (const engine of engines) {
      // Each stage starts from ORIGINAL — no unverified stacking
      const attempt = _tryRepair(engine, code, issues, fileName);
      const stage   = { engineId: engine.id, attempted: true, succeeded: false,
                        verifyResult: null, error: attempt ? attempt.error : 'null result' };

      if (!attempt || attempt.error || !attempt.hasChanges) {
        stage.error = (attempt && attempt.error) || 'No changes produced';
        stages.push(_deepFreeze(stage));
        continue;
      }

      // Collect AI_REQUIRED regardless of verify outcome
      allAiNeeded = [...allAiNeeded, ...attempt.aiNeeded];

      // Verify this engine's patch against ORIGINAL
      const vr = runVerification(code, attempt.repairedCode, fileName);
      stage.verifyResult = vr;

      if (vr.valid === true && vr.improved === true) {
        // Success — stop chain
        stage.succeeded = true;
        allSafeRepairs  = [...allSafeRepairs, ...attempt.safeRepairs];
        verifiedCode    = attempt.repairedCode;
        verifyResult    = vr;
        stages.push(_deepFreeze(stage));
        return _deepFreeze({
          phase: 'FALLBACK', fileName, stages,
          safeRepairs: allSafeRepairs, aiNeeded: allAiNeeded,
          verifiedCode, verifyResult,
          claudeFallback: false,
        });
      }

      // This engine's patch didn't verify — try next, discard unverified patch
      stage.succeeded = false;
      stages.push(_deepFreeze(stage));
    }

    // All repair engines failed — Claude fallback
    return _deepFreeze({
      phase: 'FALLBACK', fileName, stages,
      safeRepairs: allSafeRepairs, aiNeeded: allAiNeeded,
      verifiedCode: null, verifyResult: null,
      claudeFallback: true,
    });
  }

  // ─── AI phase — routes AI_REQUIRED issues to registered AI engines ──
  // AI engines may return suggestions only. No patch is applied here.
  async function runAI(aiNeeded, code, fileName, options) {
    if (!Array.isArray(aiNeeded) || aiNeeded.length === 0 ||
        typeof code !== 'string' || !code.trim() || !fileName) {
      return _makeResult(_INTERNAL, Decision.PENDING_REVIEW, Source.ORCHESTRATOR,
        null, 'runAI: invalid arguments');
    }

    const engines = listEngines(EngineType.AI);
    if (engines.length === 0) {
      return _makeResult(_INTERNAL, Decision.PENDING_REVIEW, Source.ORCHESTRATOR,
        null, 'No AI engine registered — Fail-Closed');
    }

    const errors = [];

    for (const engine of engines) {
      try {
        const result = await engine.fn(aiNeeded, code, fileName, options);

        if (result == null) {
          errors.push({ engine: engine.id, error: 'null result' });
          continue;
        }

        return _deepFreeze({
          phase: 'AI',
          engine: engine.id,
          result,
          errors,
        });
      } catch (e) {
        errors.push({
          engine: engine.id,
          error: String(e.message)
        });
      }
    }

    return _deepFreeze({
      phase: 'AI',
      engine: null,
      result: null,
      errors,
      decision: _makeResult(
        _INTERNAL,
        Decision.PENDING_REVIEW,
        Source.ORCHESTRATOR,
        null,
        'All AI engines failed — Fail-Closed'
      ),
    });
  }

  // ─── DECIDE phase (Policy gated) ─────────────────────
  function decide(repairOrFallback, verifyPhase, aiPhase) {
    const phase = repairOrFallback && repairOrFallback.phase;
    if (phase !== 'REPAIR' && phase !== 'FALLBACK') {
      return _makeResult(_INTERNAL, Decision.PENDING_REVIEW, Source.ORCHESTRATOR,
        null, 'decide: first argument must be REPAIR or FALLBACK result');
    }

    const isFallback      = phase === 'FALLBACK';
    const safeRepairs     = repairOrFallback.safeRepairs || [];
    const aiNeeded        = repairOrFallback.aiNeeded    || [];
    const repairedCode    = isFallback
      ? repairOrFallback.verifiedCode
      : repairOrFallback.repairedCode;
    const hasChanges      = !!repairedCode;
    const verifyFromFall  = isFallback ? repairOrFallback.verifyResult : null;
    const effectiveVerify = verifyFromFall || verifyPhase;
    const source          = isFallback ? Source.FALLBACK : Source.REPAIR_ENGINE;

    // ── Path 1: SAFE_AUTO_FIX (policy gated) ──────────
    if (hasChanges && effectiveVerify) {
      if (_checkPolicy(source, safeRepairs.length, effectiveVerify)) {
        return _makeResult(_INTERNAL,
          Decision.SAFE_AUTO_FIX,
          source,
          repairedCode,
          `${safeRepairs.length} repair(s) verified and policy-approved`,
          { safeRepairs, aiNeeded, verifyResult: effectiveVerify }
        );
      }
      // Policy blocked it
      return _makeResult(_INTERNAL, Decision.REJECTED, Source.ORCHESTRATOR, null,
        `Policy blocked SAFE_AUTO_FIX: source=${source} repairCount=${safeRepairs.length}`,
        { safeRepairs, aiNeeded }
      );
    }

    // ── Path 2: Repair proposed but not yet verified ───
    if (hasChanges && !effectiveVerify) {
      return _makeResult(_INTERNAL,
        Decision.NEEDS_VERIFY,
        source,
        repairedCode,
        `${safeRepairs.length} repair(s) proposed — verification pending`,
        { safeRepairs, aiNeeded }
      );
    }

    // ── Path 3: Claude suggestion + verified ──────────
    const aiSugg = aiPhase && aiPhase.decision === Decision.AI_SUGGESTION && aiPhase.patch;
    if (aiSugg && effectiveVerify) {
      if (effectiveVerify.valid === true && effectiveVerify.improved === true) {
        // Claude verified — still needs human approval (never SAFE_AUTO_FIX)
        return _makeResult(_INTERNAL,
          Decision.AI_SUGGESTION,
          Source.CLAUDE,
          aiPhase.patch,
          'Claude suggestion verified — awaiting explicit human approval',
          { aiNeeded, requiresApproval: true }
        );
      }
      return _makeResult(_INTERNAL, Decision.REJECTED, Source.ORCHESTRATOR, null,
        'Claude suggestion failed verification', { aiNeeded });
    }

    // ── Path 4: Only AI_REQUIRED, nothing else ────────
    if (aiNeeded.length > 0 && !hasChanges) {
      return _makeResult(_INTERNAL,
        Decision.AI_SUGGESTION,
        Source.CLAUDE,
        null,
        `${aiNeeded.length} issue(s) require AI — awaiting Claude suggestion`,
        { aiNeeded }
      );
    }

    // ── Path 5: Claude fallback (all repair engines failed) ──
    if (isFallback && repairOrFallback.claudeFallback) {
      return _makeResult(_INTERNAL,
        Decision.AI_SUGGESTION,
        Source.CLAUDE,
        null,
        'All repair engines failed — Claude fallback required',
        { aiNeeded, stages: repairOrFallback.stages }
      );
    }

    // Fail-Closed
    return _makeResult(_INTERNAL, Decision.PENDING_REVIEW, Source.ORCHESTRATOR,
      null, 'decide: could not classify outcome — Fail-Closed');
  }

  // ─── Full Pipeline ───────────────────────────────────────
  // Current flow: ANALYZE → REPAIR/FALLBACK → VERIFY → DECIDE
  //
  // Claude integration (future — not in v0.3):
  //   When decide() returns AI_SUGGESTION with null patch,
  //   caller is responsible for:
  //     1. Calling Claude API with aiNeeded issues
  //     2. Passing suggestion to recordAISuggestion()
  //     3. Human approval via makeApproval()
  //     4. Re-running runVerification() on Claude's patch
  //     5. Calling decide() again with the AI phase result
  //
  // This separation is intentional — Claude is not auto-invoked in v0.3.
  // ─────────────────────────────────────────────────────────────────
  function runPipeline(code, fileName, options) {
    options = options || {};
    if (typeof code !== 'string' || !code.trim() || !fileName) {
      return _deepFreeze({
        version: VERSION, fileName: fileName || null, phases: {},
        decision: _makeResult(_INTERNAL, Decision.PENDING_REVIEW, Source.ORCHESTRATOR,
          null, 'runPipeline: invalid arguments'),
      });
    }

    const phases = {};

    const analyzeResult = runAnalysis(code, fileName);
    phases.analyze = analyzeResult;
    const issues = analyzeResult.issues || [];

    if (issues.length === 0 && !(analyzeResult.errors || []).length) {
      return _deepFreeze({
        version: VERSION, fileName, phases,
        decision: _makeResult(_INTERNAL, Decision.REJECTED, Source.ORCHESTRATOR,
          null, 'No issues found'),
      });
    }

    // Use fallback chain by default if option set, else single repair pass
    if (options.useFallbackChain) {
      const fallback = runFallbackChain(code, issues, fileName);
      phases.fallback = fallback;
      const decision  = decide(fallback, null, null);
      phases.decision = decision;
      return _deepFreeze({ version: VERSION, fileName, phases, decision });
    }

    const repairResult = runRepair(code, issues, fileName);
    phases.repair = repairResult;

    let verifyResult = null;
    if (repairResult.hasChanges && repairResult.repairedCode) {
      verifyResult = runVerification(code, repairResult.repairedCode, fileName);
      phases.verify = verifyResult;
    }

    const decision = decide(repairResult, verifyResult, null);
    phases.decision = decision;

    return _deepFreeze({ version: VERSION, fileName, phases, decision });
  }

  // ─── Public API ───────────────────────────────────────
  // makeResult is NOT exported — use makeApproval() for external approvals.
  return Object.freeze({
    VERSION,
    Decision,
    EngineType,
    Source,
    // Policy
    setPolicy,
    getPolicy,
    // Registry
    registerEngine,
    updateEngine,
    unregisterEngine,
    getEngine,
    listEngines,
    hasEngine,
    // Routing
    routeIssue,
    routeAnalyzer,
    // Pipeline phases
    runAnalysis,
    runRepair,
    runVerification,
    runFallbackChain,
    recordAISuggestion,
    runAI,
    decide,
    // Public approval factory (replaces makeResult)
    makeApproval,
    // Full pipeline
    runPipeline,
  });

})();

if (typeof window !== 'undefined') window.RealityOrchestrator = RealityOrchestrator;
if (typeof module !== 'undefined') module.exports = RealityOrchestrator;
