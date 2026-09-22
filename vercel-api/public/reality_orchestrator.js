// ═══════════════════════════════════════════════════════
// reality_orchestrator.js v0.4.1 — RealityOrchestrator
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
//
// v0.4 changes:
//   7. Both runRepair() and runFallbackChain() now ITERATE over all engines,
//      accumulating only VERIFIED patches. Neither stops at first success.
//   8. After every accepted patch the analyzer RE-RUNS on the verified code.
//      The next engine receives only the REMAINING issues — an issue that was
//      already fixed is never handed to a later engine.
//   9. aiNeeded is recomputed from the final verified state, so it reflects
//      what is actually still broken rather than a stale pre-repair list.
//  10. decide() reports partial vs fully-resolved. SAFE_AUTO_FIX means "this
//      patch is safe to apply", NOT "the file is now clean".
//  11. Claude receives ALL remaining AI_REQUIRED issues, and every suggestion
//      is verified individually. Claude still can never reach SAFE_AUTO_FIX.
// ═══════════════════════════════════════════════════════

"use strict";

var RealityOrchestrator = (() => {

  // ─── Version ─────────────────────────────────────────
  const VERSION = '0.4.1';

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

  // Sources that can NEVER appear in allowedSources.
  //
  // [v0.4 FIX] The original `new Set([Source.CLAUDE, Source.AI])` was broken:
  // Source.AI does not exist (AI is an EngineType, not a Source), so it
  // evaluated to `undefined` and the Set silently held `undefined`.
  //
  // [v0.4.1] Rather than blocking EngineType.AI here — which conflated two
  // different vocabularies — allowedSources is now VALIDATED in setPolicy():
  // every entry must be a real Source value, so an EngineType can never get in
  // regardless of what the caller passes. This Set lists only genuine Sources
  // that are forbidden on policy grounds.
  const _FORBIDDEN_SOURCES = new Set([Source.CLAUDE]);

  // Every legal Source value — used to reject foreign vocabulary in setPolicy.
  const _ALL_SOURCES = new Set(Object.values(Source));

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
    // allowedSources: must contain ONLY real Source values, and never a
    // forbidden one. [v0.4.1] Anything that is not a Source (an EngineType, a
    // typo, undefined) is dropped rather than silently trusted.
    if (merged.allowedSources instanceof Set) {
      const cleaned = new Set();
      merged.allowedSources.forEach(s => {
        if (!_ALL_SOURCES.has(s)) return;          // foreign vocabulary
        if (_FORBIDDEN_SOURCES.has(s)) return;     // policy-forbidden
        cleaned.add(s);
      });
      merged.allowedSources = cleaned;
    } else {
      // A non-Set allowedSources would disable the guard entirely — Fail-Closed
      // back to the previous value instead of accepting it.
      merged.allowedSources = new Set(_policy.allowedSources);
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

  // ─── Apply approved Claude suggestion ──────────────────
  // Human approval is required, then the patch is re-verified
  // immediately before application.
  //
  // [v0.4.1] STALENESS GUARD.
  // runPipelineAsync verifies every Claude candidate against the SAME base
  // (the verified deterministic code). That is correct for independent
  // alternatives, but it means two suggestions can both be "verified" while
  // being mutually destructive: applying A then B silently discards A,
  // because B was computed from the pre-A text.
  //
  // `originalCode` must therefore be the CURRENT on-disk content at the moment
  // of application, not the base the suggestion was generated from. When the
  // suggestion records its base (meta.baseCode) and that base no longer
  // matches, the patch is refused as STALE and must be regenerated against the
  // new state. Re-verification alone cannot catch this: the patch may still
  // "improve" the old base while erasing an already-applied fix.
  function applyApprovedSuggestion(approvedResult, originalCode, fileName) {
    if (!approvedResult ||
        approvedResult.decision !== Decision.AI_SUGGESTION) {
      return _makeResult(
        _INTERNAL,
        Decision.REJECTED,
        Source.ORCHESTRATOR,
        null,
        'applyApprovedSuggestion: input must be an AI_SUGGESTION result'
      );
    }

    if (!approvedResult.meta ||
        !approvedResult.meta.approvedBy ||
        typeof approvedResult.meta.approvedBy !== 'string') {
      return _makeResult(
        _INTERNAL,
        Decision.PENDING_REVIEW,
        Source.ORCHESTRATOR,
        null,
        'applyApprovedSuggestion: explicit human approval is required'
      );
    }

    if (typeof originalCode !== 'string' ||
        !originalCode.trim() ||
        typeof approvedResult.patch !== 'string' ||
        !approvedResult.patch.trim() ||
        !fileName) {
      return _makeResult(
        _INTERNAL,
        Decision.REJECTED,
        Source.ORCHESTRATOR,
        null,
        'applyApprovedSuggestion: missing originalCode, patch, or fileName'
      );
    }

    // [v0.4.1] Staleness check BEFORE verification.
    // If the suggestion recorded the base it was generated from, that base
    // must still be the current content. Otherwise another patch has landed
    // in between and this one would overwrite it.
    const recordedBase = approvedResult.meta && approvedResult.meta.baseCode;
    if (typeof recordedBase === 'string' && recordedBase !== originalCode) {
      return _makeResult(
        _INTERNAL,
        Decision.REJECTED,
        Source.ORCHESTRATOR,
        null,
        'STALE_SUGGESTION — the file changed after this suggestion was generated; ' +
        'regenerate it against the current content before applying',
        {
          approvedBy: approvedResult.meta.approvedBy,
          stale: true,
          baseLength: recordedBase.length,
          currentLength: originalCode.length,
        }
      );
    }

    // Re-run verification immediately before application, against the CURRENT
    // content that was passed in.
    const verifyResult = runVerification(
      originalCode,
      approvedResult.patch,
      fileName
    );

    if (verifyResult.valid !== true || verifyResult.improved !== true) {
      return _makeResult(
        _INTERNAL,
        Decision.REJECTED,
        Source.ORCHESTRATOR,
        null,
        'Approved Claude suggestion failed final verification',
        {
          approvedBy: approvedResult.meta.approvedBy,
          verifyResult,
        }
      );
    }

    // Return the verified patch as APPLY-READY.
    // The caller performs the actual persistence/write.
    //
    // [v0.4.1] NAMING CAVEAT — read before consuming this result.
    // The decision is SAFE_AUTO_FIX because that is the only apply-ready
    // decision in the current vocabulary, but this patch is NOT a
    // deterministic engine fix. Its provenance is:
    //     AI-generated → human-approved → re-verified
    // A consumer that treats every SAFE_AUTO_FIX as "machine-certain" would
    // misread it. The meta fields below make the provenance explicit, and
    // `origin` is the field to branch on:
    //     origin === 'AI_APPROVED'    → this path
    //     origin === 'DETERMINISTIC'  → decide() Path 1
    //
    // A dedicated Decision.APPROVED_AI_FIX would be clearer, but adding a
    // decision value changes the public vocabulary and every consumer's
    // switch — deferred deliberately rather than slipped in here.
    return _makeResult(
      _INTERNAL,
      Decision.SAFE_AUTO_FIX,
      Source.ORCHESTRATOR,
      approvedResult.patch,
      `AI-generated, human-approved by "${approvedResult.meta.approvedBy}", ` +
      `and re-verified — NOT a deterministic engine repair`,
      {
        approvedBy: approvedResult.meta.approvedBy,
        approvedAt: approvedResult.meta.approvedAt,
        verifyResult,
        applied: false,
        // [v0.4.1] provenance — branch on this, not on decision alone
        origin: 'AI_APPROVED',
        aiGenerated: true,
        humanApproved: true,
        deterministic: false,
        originalSource: approvedResult.source || Source.CLAUDE,
      }
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

  // ─── [v0.4] Re-analysis helper ────────────────────────
  // After a patch is VERIFIED we must re-run the analyzer on the new code.
  // Reason: issues carry line numbers and identities that go stale the moment
  // the file changes, and an issue that the patch already resolved must not be
  // handed to the next engine. Returns null when analysis is unavailable or
  // fails, and callers then Fail-Closed by keeping the previous issue list
  // rather than assuming "no issues remain".
  function _reanalyze(code, fileName) {
    const res = runAnalysis(code, fileName);
    // runAnalysis returns an orchestrator result (not an ANALYZE phase) when it
    // cannot run — e.g. no analyzer registered.
    if (!res || res.phase !== 'ANALYZE') return null;
    if (!Array.isArray(res.issues)) return null;
    // [v0.4.1] runAnalysis CATCHES analyzer exceptions and still returns a
    // well-formed ANALYZE phase with issues:[] plus an errors entry. Treating
    // that as "zero issues remain" would be exactly the false confidence this
    // guard exists to prevent — a crashed analyzer would look like a clean
    // file. Any analyzer error therefore counts as a failed re-analysis.
    if (Array.isArray(res.errors) && res.errors.length > 0) return null;
    return res.issues;
  }

  // ─── [v0.4.1] Issue identity ──────────────────────────
  // Two identities are needed, and conflating them was a real defect:
  //
  //   _issueKind(i)     — the CLASS of problem (SQL, EVAL, …). Line-independent.
  //   _issueIdentity(i) — a SPECIFIC occurrence, including where it is.
  //
  // v0.4 used kind-only identity everywhere. With two SQL issues on different
  // lines, fixing the first one left the second in the list under the same key,
  // so the ALREADY-FIXED occurrence still looked unresolved and was forwarded
  // to Claude — asking it to repair something that no longer existed.
  //
  // Location is therefore part of the identity. Because a patch shifts line
  // numbers, matching is done in two tiers: exact identity first, then a
  // kind+count fallback that survives shifting (see _stillUnresolved).
  function _issueKind(i) {
    if (!i) return 'UNKNOWN';
    const t = i.type || i.cAct || i.rule || i.id || i.title || 'issue';
    return String(t).toUpperCase();
  }

  // Textual evidence of the occurrence, when the analyzer supplies it.
  // Preferred over the line number because it survives line shifting.
  function _issueEvidence(i) {
    if (!i) return '';
    const ev = i.ev || i.evidence || i.snippet || i.code || i.match || '';
    return String(ev).replace(/\s+/g, '').toLowerCase().slice(0, 80);
  }

  function _issueIdentity(i) {
    if (!i) return 'unknown';
    const ev = _issueEvidence(i);
    // Evidence, when present, identifies the occurrence without a line number.
    if (ev) return _issueKind(i) + '|ev:' + ev;
    const line = (i.line !== undefined && i.line !== null) ? i.line : '?';
    return _issueKind(i) + '|ln:' + line + '|' + String(i.title || '');
  }

  // Deduplicates AI_REQUIRED entries — several engines may report the same
  // OCCURRENCE. Distinct occurrences of the same kind are preserved.
  function _dedupeIssues(list) {
    const seen = new Set(), out = [];
    (list || []).forEach(i => {
      const k = _issueIdentity(i);
      if (seen.has(k)) return;
      seen.add(k); out.push(i);
    });
    return out;
  }

  // Keeps only the AI_REQUIRED entries that are STILL unresolved after repair.
  //
  // Tier 1 — exact identity match: the occurrence is still present verbatim.
  // Tier 2 — kind budget: line numbers shift when code is patched, so an
  //   occurrence may be real yet no longer match by identity. For each kind we
  //   keep at most as many entries as the analyzer still reports for that kind.
  //   Fixing 1 of 2 SQL issues therefore forwards exactly 1, never 0 and never 2.
  function _stillUnresolved(aiNeeded, currentIssues) {
    const deduped = _dedupeIssues(aiNeeded);
    if (!Array.isArray(currentIssues)) return deduped;

    const presentIds = new Set(currentIssues.map(_issueIdentity));
    const presentEvidence = new Set(
      currentIssues
        .map(_issueEvidence)
        .filter(Boolean)
    );

    const budget = new Map();
    currentIssues.forEach(i => {
      const k = _issueKind(i);
      budget.set(k, (budget.get(k) || 0) + 1);
    });

    const kept = [];
    const deferred = [];
    const usedMatches = new Set();   // each current issue matches at most once

    // Tier 1: evidence identifies the same occurrence even when
    // AI_REQUIRED uses strategy=SQL_INJECTION while the analyzer uses
    // type=js/py/taint or another issue kind.
    deduped.forEach(i => {
      const kind = _issueKind(i);
      const ev = _issueEvidence(i);

      if (ev && presentEvidence.has(ev)) {
        const freshMatch = currentIssues.find(ci =>
          !usedMatches.has(ci) && _issueEvidence(ci) === ev
        );
        const matched = freshMatch || currentIssues.find(ci =>
          _issueEvidence(ci) === ev
        );
        const matchedKind = matched ? _issueKind(matched) : kind;

        if ((budget.get(matchedKind) || 0) > 0) {
          budget.set(matchedKind, budget.get(matchedKind) - 1);
          // Carry the CURRENT line: Claude receives the post-repair code, so
          // the pre-repair line would point _extractContext() at the wrong window.
          if (freshMatch) usedMatches.add(freshMatch);
          kept.push(freshMatch && freshMatch.line !== undefined && freshMatch.line !== i.line
            ? Object.assign({}, i, { line: freshMatch.line })
            : i);
          return;
        }
      }

      if (
        presentIds.has(_issueIdentity(i)) &&
        (budget.get(kind) || 0) > 0
      ) {
        budget.set(kind, budget.get(kind) - 1);
        kept.push(i);
      } else {
        deferred.push(i);
      }
    });

    // Tier 2: remaining budget absorbs shifted occurrences of the same kind.
    deferred.forEach(i => {
      const kind = _issueKind(i);
      if ((budget.get(kind) || 0) > 0) {
        budget.set(kind, budget.get(kind) - 1);
        kept.push(i);
      }
      // else: this kind is fully accounted for — the entry was fixed. Dropped.
    });

    return kept;
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
  // All engines are tried, in priority order.
  //
  // [v0.4] Every engine now operates on the last VERIFIED code, and every
  // patch must pass runVerification() before it becomes the new base.
  // Previously the loop did `if (r.hasChanges) repairedCode = r.repairedCode`
  // with no verification at all, so engine #2 built on top of engine #1's
  // unverified output — which contradicted the file's own stated guarantee
  // that "unverified patches never stack".
  //
  // After each accepted patch the analyzer re-runs and the NEXT engine sees
  // only the remaining issues. A failed patch is discarded; the chain
  // continues from the last verified base.
  //
  // runRepair() vs runFallbackChain(): both now iterate all engines and
  // accumulate verified patches. runFallbackChain() additionally reports
  // per-stage results and signals claudeFallback when nothing verified.
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

    let safeRepairs   = [];
    let aiNeeded      = [];
    let verifiedBase  = code;           // only ever advances on a VERIFIED patch
    let remaining     = issues;         // issues still open against verifiedBase
    let lastVerify    = null;
    let reanalysisFailed = false;   // [v0.4.1] set when the chain stops early
    const errors      = [];
    const stages      = [];

    for (const engine of engines) {
      // Nothing left to fix — stop early rather than re-running engines on a
      // clean file (they would produce no changes anyway).
      if (Array.isArray(remaining) && remaining.length === 0) {
        stages.push(_deepFreeze({ engineId: engine.id, attempted: false,
          accepted: false, error: 'No remaining issues' }));
        continue;
      }

      const r = _tryRepair(engine, verifiedBase, remaining, fileName);
      if (!r) continue;

      if (r.error) {
        errors.push({ engine: r.engineId, error: r.error });
        stages.push(_deepFreeze({ engineId: r.engineId, attempted: true,
          accepted: false, error: r.error }));
        continue;
      }

      // AI_REQUIRED is collected regardless of whether a patch was produced.
      aiNeeded = [...aiNeeded, ...r.aiNeeded];

      if (!r.hasChanges) {
        stages.push(_deepFreeze({ engineId: r.engineId, attempted: true,
          accepted: false, error: 'No changes produced' }));
        continue;
      }

      // Verify against the CURRENT verified base, not the original file.
      const vr = runVerification(verifiedBase, r.repairedCode, fileName);

      if (vr.valid === true && vr.improved === true) {
        verifiedBase = r.repairedCode;                  // new verified base
        lastVerify   = vr;
        safeRepairs  = [...safeRepairs, ...r.safeRepairs];

        // Re-analyze so the next engine only sees what is still broken.
        //
        // [v0.4.1] If re-analysis FAILS we stop the deterministic chain here.
        // Previously the loop continued using the stale pre-patch list, which
        // meant the next engine could act on issues that no longer existed —
        // the exact error this whole redesign set out to remove. Not knowing
        // the new state is safer than assuming it equals the old one. The
        // verified patch so far is kept; the remainder is surfaced for review.
        const re = _reanalyze(verifiedBase, fileName);
        if (re === null) {
          reanalysisFailed = true;
          stages.push(_deepFreeze({ engineId: r.engineId, attempted: true,
            accepted: true, verifyResult: vr,
            error: 'Re-analysis failed after verified patch — chain stopped (Fail-Closed)',
            remainingAfter: null }));
          break;
        }
        remaining = re;

        stages.push(_deepFreeze({ engineId: r.engineId, attempted: true,
          accepted: true, verifyResult: vr,
          remainingAfter: Array.isArray(remaining) ? remaining.length : null }));
      } else {
        // Discard the unverified patch entirely — it never becomes a base.
        stages.push(_deepFreeze({ engineId: r.engineId, attempted: true,
          accepted: false, verifyResult: vr }));
      }
    }

    // aiNeeded must describe the FINAL state, not the pre-repair state.
    const finalRemaining = Array.isArray(remaining) ? remaining : issues;
    const unresolvedAi   = _stillUnresolved(aiNeeded, finalRemaining);

    return _deepFreeze({
      phase: 'REPAIR', fileName, original: code,
      repairedCode: verifiedBase !== code ? verifiedBase : null,
      safeRepairs,
      aiNeeded: unresolvedAi,
      hasChanges: verifiedBase !== code,
      errors,
      // [v0.4] additions — do not remove existing fields above
      stages,
      verifyResult: lastVerify,
      remainingIssues: finalRemaining,
      allPatchesVerified: true,
      // [v0.4.1] true when the chain stopped because re-analysis failed.
      // remainingIssues is then NOT a confirmed picture of the current state.
      reanalysisFailed,
      remainingIssuesStale: reanalysisFailed,
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
  // [v0.4.1] `baseCode` (optional) records the exact content the suggestion
  // was generated and verified against. applyApprovedSuggestion() compares it
  // to the current content and refuses the patch if the file moved on. Callers
  // that omit it lose the staleness guard — it cannot be reconstructed later.
  function recordAISuggestion(suggestion, issue, fileName, baseCode) {
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
      { issue, fileName, requiresApproval: true, requiresVerification: true,
        // Recorded so staleness can be detected at apply time.
        baseCode: typeof baseCode === 'string' ? baseCode : undefined }
    );
  }

  // ─── Fallback Chain — cumulative verified repair ──────────────────
  // [v0.4] BEHAVIOUR CHANGE: the chain no longer stops at the first verified
  // success. A file containing SQL + eval + secret used to stop right after
  // the SQL engine verified, so the secret engine was never invoked and the
  // hardcoded secret survived in `verifiedCode`. That is the opposite of the
  // intent: fix everything the deterministic engines can fix, and send only
  // the true remainder to Claude.
  //
  // Current behaviour:
  //   - Every engine is tried, in priority order.
  //   - Each engine starts from the last VERIFIED code (never from an
  //     unverified patch — the no-stacking guarantee is preserved).
  //   - After each accepted patch the analyzer re-runs; the next engine
  //     receives only the REMAINING issues.
  //   - A patch that fails verification is discarded and the chain continues
  //     from the last verified base — one engine's failure never undoes an
  //     earlier verified patch.
  //   - claudeFallback is true only when NO engine produced a verified patch.
  //
  // Returns a FallbackResult:
  // {
  //   phase: 'FALLBACK',
  //   stages: [{ engineId, attempted, succeeded, verifyResult, remainingAfter }],
  //   safeRepairs: [],  aiNeeded: [],   // aiNeeded = still-unresolved only
  //   verifiedCode: string | null,
  //   verifyResult: object | null,
  //   remainingIssues: [],
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
    let base           = code;        // last VERIFIED code
    let remaining      = issues;      // issues still open against `base`
    let reanalysisFailed = false;     // [v0.4.1] chain stopped early?

    for (const engine of engines) {
      // Nothing left to fix — record and skip rather than re-running engines.
      if (Array.isArray(remaining) && remaining.length === 0) {
        stages.push(_deepFreeze({ engineId: engine.id, attempted: false,
          succeeded: false, verifyResult: null, error: 'No remaining issues',
          remainingAfter: 0 }));
        continue;
      }

      // Start from the last VERIFIED code — no unverified stacking.
      const attempt = _tryRepair(engine, base, remaining, fileName);
      const stage   = { engineId: engine.id, attempted: true, succeeded: false,
                        verifyResult: null, error: attempt ? attempt.error : 'null result',
                        remainingAfter: Array.isArray(remaining) ? remaining.length : null };

      // Collect AI_REQUIRED even when no deterministic patch was produced.
      if (attempt && Array.isArray(attempt.aiNeeded)) {
        allAiNeeded = [...allAiNeeded, ...attempt.aiNeeded];
      }

      if (!attempt || attempt.error || !attempt.hasChanges) {
        stage.error = (attempt && attempt.error) || 'No changes produced';
        stages.push(_deepFreeze(stage));
        continue;
      }

      // Verify this engine's patch against the CURRENT verified base.
      const vr = runVerification(base, attempt.repairedCode, fileName);
      stage.verifyResult = vr;

      if (vr.valid === true && vr.improved === true) {
        stage.succeeded = true;
        allSafeRepairs  = [...allSafeRepairs, ...attempt.safeRepairs];
        base            = attempt.repairedCode;   // advance the verified base
        verifiedCode    = base;
        verifyResult    = vr;

        // Re-analyze so the next engine only sees what is still broken.
        // [v0.4.1] Re-analysis failure STOPS the chain — see runRepair() for
        // the rationale. Continuing on a stale list would let a later engine
        // act on an issue that the patch just removed.
        const re = _reanalyze(base, fileName);
        if (re === null) {
          reanalysisFailed = true;
          stage.error = 'Re-analysis failed after verified patch — chain stopped (Fail-Closed)';
          stage.remainingAfter = null;
          stages.push(_deepFreeze(stage));
          break;
        }
        remaining = re;
        stage.remainingAfter = Array.isArray(remaining) ? remaining.length : null;
      }
      // else: unverified patch discarded; `base` untouched, chain continues.

      stages.push(_deepFreeze(stage));
    }

    // aiNeeded must reflect the FINAL verified state, not the original scan.
    const finalRemaining = Array.isArray(remaining) ? remaining : issues;
    const unresolvedAi   = _stillUnresolved(allAiNeeded, finalRemaining);

    return _deepFreeze({
      phase: 'FALLBACK', fileName, stages,
      safeRepairs: allSafeRepairs,
      aiNeeded: unresolvedAi,
      verifiedCode, verifyResult,
      remainingIssues: finalRemaining,
      // Claude is the fallback only when nothing at all verified.
      claudeFallback: verifiedCode === null,
      // [v0.4.1] true when the chain stopped because re-analysis failed.
      reanalysisFailed,
      remainingIssuesStale: reanalysisFailed,
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

  // ─── Claude Repair Engine → SAFE_AUTO_FIX ─────────────
  // The only AI path that may auto-apply. Requires: the candidate was tagged
  // CLAUDE_REPAIR_ENGINE by its adapter, FixVerifier returned valid && improved,
  // and policy accepts Source.REPAIR_ENGINE. Source.CLAUDE is never used here.
  const CLAUDE_REPAIR_ENGINE_SOURCE = 'CLAUDE_REPAIR_ENGINE';

  function _claudeRepairEngineAutoFix(aiPhase, aiVerify, aiNeeded, extraMeta) {
    if (!aiPhase || aiPhase.source !== CLAUDE_REPAIR_ENGINE_SOURCE) return null;
    if (typeof aiPhase.patch !== 'string' || !aiPhase.patch.trim()) return null;
    if (!aiVerify || aiVerify.valid !== true || aiVerify.improved !== true) return null;
    if (!_checkPolicy(Source.REPAIR_ENGINE, 1, aiVerify)) return null;

    return _makeResult(_INTERNAL,
      Decision.SAFE_AUTO_FIX,
      Source.REPAIR_ENGINE,
      aiPhase.patch,
      'Claude Repair Engine patch verified by FixVerifier — auto-applied',
      Object.assign({
        aiNeeded,
        requiresApproval: false,
        origin: CLAUDE_REPAIR_ENGINE_SOURCE,
        aiSource: CLAUDE_REPAIR_ENGINE_SOURCE,
        aiVerifyResult: aiVerify,
        verifyResult: aiVerify,
        aiGenerated: true,
        humanApproved: false,
        deterministic: false,
      }, extraMeta || {})
    );
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

    // ── [v0.4] Path 0: deterministic patch AND a Claude suggestion ──
    // Pre-existing ordering bug: Path 1 returned SAFE_AUTO_FIX as soon as a
    // verified deterministic patch existed, so when Claude ALSO produced a
    // patch for the remaining issues, `aiPhase` was never examined and the
    // suggestion was silently dropped. It was invisible before v0.4 only
    // because the chain stopped at the first engine and rarely reached this
    // combination.
    //
    // The two patches cannot be merged here — that is a semantic decision this
    // layer is not entitled to make — so the result reports BOTH: the verified
    // deterministic patch is carried in meta.deterministicPatch (apply-ready),
    // while the decision itself stays AI_SUGGESTION because a Claude patch is
    // pending human approval. Claude still never reaches SAFE_AUTO_FIX.
    const aiPatchPresent = aiPhase && aiPhase.decision === Decision.AI_SUGGESTION && aiPhase.patch;
    if (hasChanges && effectiveVerify && aiPatchPresent) {
      const detOk = _checkPolicy(source, safeRepairs.length, effectiveVerify);
      const aiVerified = verifyPhase &&
        verifyPhase.valid === true && verifyPhase.improved === true;

      if (!aiVerified) {
        // Claude's patch failed verification — fall through to the normal
        // deterministic path below by reporting only the verified part.
        return _makeResult(_INTERNAL,
          detOk ? Decision.SAFE_AUTO_FIX : Decision.REJECTED,
          detOk ? source : Source.ORCHESTRATOR,
          detOk ? repairedCode : null,
          detOk
            ? `${safeRepairs.length} repair(s) verified — Claude suggestion failed verification`
            : 'Claude suggestion failed verification and policy blocked the deterministic patch',
          { safeRepairs, aiNeeded, verifyResult: effectiveVerify,
            partial: aiNeeded.length > 0,
            deterministicRepairCount: safeRepairs.length,
            aiRequiredCount: aiNeeded.length,
            fileFullyResolved: false,
            aiSuggestionRejected: true }
        );
      }

      // Claude Repair Engine: patch generated and verified on the verified
      // deterministic base, so it already contains the deterministic fixes.
      // No merge is needed and the verified Claude patch is apply-ready.
      const creAutoFix = _claudeRepairEngineAutoFix(aiPhase, verifyPhase, aiNeeded, {
        deterministicPatch: detOk ? repairedCode : null,
        deterministicVerified: detOk,
        deterministicVerifyResult: effectiveVerify,
        deterministicRepairCount: safeRepairs.length,
        remainingIssues: repairOrFallback.remainingIssues || null,
      });
      if (creAutoFix) return creAutoFix;

      return _makeResult(_INTERNAL,
        Decision.AI_SUGGESTION,
        Source.CLAUDE,
        aiPhase.patch,
        `${safeRepairs.length} deterministic repair(s) verified; Claude patch for ` +
        `${aiNeeded.length} remaining issue(s) awaits explicit human approval`,
        { safeRepairs, aiNeeded,
          requiresApproval: true,
          // apply-ready deterministic part, kept separate from the AI patch
          deterministicPatch: detOk ? repairedCode : null,
          deterministicVerified: detOk,
          deterministicVerifyResult: effectiveVerify,
          aiVerifyResult: verifyPhase,
          deterministicRepairCount: safeRepairs.length,
          aiRequiredCount: aiNeeded.length,
          partial: true,
          fileFullyResolved: false,
          remainingIssues: repairOrFallback.remainingIssues || null }
      );
    }

    // ── Path 1: SAFE_AUTO_FIX (policy gated) ──────────
    if (hasChanges && effectiveVerify) {
      if (_checkPolicy(source, safeRepairs.length, effectiveVerify)) {
        // [v0.4] SAFE_AUTO_FIX describes THE PATCH, not the whole file.
        // When AI_REQUIRED issues remain, `partial` is true and the caller
        // must apply the verified patch AND then continue with Claude for the
        // remainder. `fileFullyResolved` is the single field to read when the
        // question is "is this file done?".
        const partial = aiNeeded.length > 0;
        return _makeResult(_INTERNAL,
          Decision.SAFE_AUTO_FIX,
          source,
          repairedCode,
          partial
            ? `${safeRepairs.length} repair(s) verified — ${aiNeeded.length} issue(s) still require AI`
            : `${safeRepairs.length} repair(s) verified and policy-approved`,
          { safeRepairs, aiNeeded, verifyResult: effectiveVerify,
            partial,
            deterministicRepairCount: safeRepairs.length,
            aiRequiredCount: aiNeeded.length,
            fileFullyResolved: !partial,
            remainingIssues: repairOrFallback.remainingIssues || null,
            // [v0.4.1] provenance — mirrors applyApprovedSuggestion()
            origin: 'DETERMINISTIC',
            aiGenerated: false,
            humanApproved: false,
            deterministic: true }
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
    // [v0.4] Uses verifyPhase — the verification of CLAUDE's patch — rather
    // than effectiveVerify, which may carry a deterministic engine's result
    // and would wrongly vouch for an unverified AI patch.
    const aiSugg = aiPhase && aiPhase.decision === Decision.AI_SUGGESTION && aiPhase.patch;
    const aiOwnVerify = verifyPhase || effectiveVerify;
    if (aiSugg && aiOwnVerify) {
      if (aiOwnVerify.valid === true && aiOwnVerify.improved === true) {
        // Only the Claude Repair Engine reaches SAFE_AUTO_FIX after FixVerifier.
        const creAutoFix = _claudeRepairEngineAutoFix(aiPhase, aiOwnVerify, aiNeeded, {});
        if (creAutoFix) return creAutoFix;

        // Any other AI source stays approval-only even when verified.
        return _makeResult(_INTERNAL,
          Decision.AI_SUGGESTION,
          Source.CLAUDE,
          aiPhase.patch,
          'Claude suggestion verified — awaits explicit human approval',
          {
            aiNeeded,
            requiresApproval: true,
            aiVerifyResult: aiOwnVerify,
            origin: 'CLAUDE_VERIFIED',
            aiGenerated: true,
            humanApproved: false,
            deterministic: false
          }
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

    // Use fallback chain by default if option set, else single repair pass.
    // [v0.4] Both paths now accumulate only VERIFIED patches and re-analyze
    // between engines, so neither can produce unverified stacking.
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

  // Async pipeline for AI fallback.
  // Claude suggestions are verified and never auto-applied.
  async function runPipelineAsync(code, fileName, options) {
    options = options || {};

    if (typeof code !== 'string' || !code.trim() || !fileName) {
      return _deepFreeze({
        version: VERSION,
        fileName: fileName || null,
        phases: {},
        decision: _makeResult(
          _INTERNAL,
          Decision.PENDING_REVIEW,
          Source.ORCHESTRATOR,
          null,
          'runPipelineAsync: invalid arguments'
        ),
      });
    }

    const phases = {};

    // 1. Analyze
    const analyzeResult = runAnalysis(code, fileName);
    phases.analyze = analyzeResult;

    const issues = analyzeResult.issues || [];

    if (issues.length === 0 && !(analyzeResult.errors || []).length) {
      const decision = _makeResult(
        _INTERNAL,
        Decision.REJECTED,
        Source.ORCHESTRATOR,
        null,
        'No issues found'
      );

      phases.decision = decision;

      return _deepFreeze({
        version: VERSION,
        fileName,
        phases,
        decision,
      });
    }

    // 2. Deterministic repair first.
    //    [v0.4] The chain now applies EVERY verified fix it can, so
    //    fallback.verifiedCode is the cumulative verified state rather than
    //    the output of a single engine.
    const fallback = runFallbackChain(code, issues, fileName);
    phases.fallback = fallback;

    // Never give Claude an unverified patch.
    const aiBaseCode = fallback.verifiedCode || code;

    // 3. Send only unresolved AI_REQUIRED issues to Claude.
    //    [v0.4] fallback.aiNeeded is already filtered against the re-analyzed
    //    remaining issues, so anything the deterministic engines fixed is not
    //    forwarded here.
    if (Array.isArray(fallback.aiNeeded) && fallback.aiNeeded.length > 0) {
      const aiResult = await runAI(
        fallback.aiNeeded,
        aiBaseCode,
        fileName,
        options
      );

      phases.ai = aiResult;

      const suggestions =
        aiResult && Array.isArray(aiResult.result)
          ? aiResult.result
          : [];

      // [v0.4] ALL usable suggestions are considered, not just the first.
      // Previously `suggestions.find(...)` took suggestion #1 and silently
      // discarded the rest, so a file with three AI_REQUIRED issues could only
      // ever surface one Claude patch. Each candidate is now verified
      // independently against the verified deterministic base, and the full
      // set of outcomes is reported so the caller can review them.
      //
      // Claude is STILL never auto-applied: every entry below is a suggestion
      // awaiting explicit human approval (makeApproval →
      // applyApprovedSuggestion), and Source.CLAUDE can never reach
      // SAFE_AUTO_FIX because of the policy invariant in _makeResult().
      const usable = suggestions.filter(
        item =>
          item &&
          item.status === 'SUGGESTION' &&
          typeof item.suggestion === 'string' &&
          item.suggestion.trim()
      );

      const candidates = [];
      for (const item of usable) {
        // Claude may return Markdown code fences. Strip them before verification.
        const patch = item.suggestion
          .replace(/^```[a-zA-Z0-9_-]*\s*\n?/, '')
          .replace(/\n?```\s*$/, '')
          .trim();
        if (!patch) continue;

        // 4. Verify each suggestion against the verified deterministic base.
        //    Note: candidates are verified in parallel against the SAME base,
        //    never chained onto one another — an unverified or merely
        //    "suggested" patch must never become the base for the next one.
        const vr = runVerification(aiBaseCode, patch, fileName);
        candidates.push(_deepFreeze({
          issue: item.issue || null,
          patch,
          source: typeof item.source === 'string' ? item.source : null,
          verifyResult: vr,
          verified: vr.valid === true && vr.improved === true,
        }));
      }

      phases.aiCandidates = _deepFreeze(candidates);

      const verifiedCandidates = candidates.filter(c => c.verified);
      phases.aiVerifiedCount   = verifiedCandidates.length;
      phases.aiRejectedCount   = candidates.length - verifiedCandidates.length;

      // [v0.4.1] Every verified candidate becomes its own reviewable
      // suggestion record, so a file with three AI_REQUIRED issues yields
      // three independently approvable entries rather than one.
      //
      // Honest limitation: decide() returns a SINGLE decision object, so one
      // candidate must drive it. The others are NOT discarded — they are in
      // phases.aiSuggestions, each already verified and each ready for
      // makeApproval() → applyApprovedSuggestion(). They are deliberately not
      // merged: combining independent patches is a semantic decision this
      // layer is not entitled to make, and each was verified against the same
      // base rather than chained.
      // Each record carries the base it was verified against, so that applying
      // one and then another is caught as STALE rather than silently undoing
      // the first. [v0.4.1]
      phases.aiSuggestions = _deepFreeze(
        verifiedCandidates.map(c => recordAISuggestion(
          c.patch,
          c.issue || { title: 'AI_REQUIRED' },
          fileName,
          aiBaseCode
        ))
      );

      if (verifiedCandidates.length > 0) {
        const chosen = verifiedCandidates[0];

        phases.aiVerify = chosen.verifyResult;

        // 5. Convert to the shape expected by decide().
        const aiPhase = {
          decision: Decision.AI_SUGGESTION,
          patch: chosen.patch,
          source: chosen.source || null,
        };

        phases.aiPhase = aiPhase;

        const decision = decide(
          fallback,
          chosen.verifyResult,
          aiPhase
        );

        phases.decision = decision;

        return _deepFreeze({
          version: VERSION,
          fileName,
          phases,
          decision,
          // [v0.4.1] All verified suggestions, each independently approvable.
          // decision reflects only the first; read this for the full set.
          aiSuggestions: phases.aiSuggestions,
          aiSuggestionCount: verifiedCandidates.length,
        });
      }

      if (candidates.length > 0) {
        // Claude produced patches but none of them verified.
        phases.aiVerify = candidates[0].verifyResult;
        const decision = _makeResult(
          _INTERNAL,
          Decision.REJECTED,
          Source.ORCHESTRATOR,
          null,
          `All ${candidates.length} Claude suggestion(s) failed verification`,
          { aiNeeded: fallback.aiNeeded, candidates }
        );
        phases.decision = decision;
        return _deepFreeze({ version: VERSION, fileName, phases, decision });
      }
    }

    // Claude failed, returned no usable suggestion, or no AI issue existed.
    const decision = decide(fallback, null, null);
    phases.decision = decision;

    return _deepFreeze({
      version: VERSION,
      fileName,
      phases,
      decision,
    });
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
    applyApprovedSuggestion,
    // Full pipeline
    runPipeline,
    runPipelineAsync,
  });

})();

if (typeof globalThis !== 'undefined' && typeof globalThis.window !== 'undefined') globalThis.window.RealityOrchestrator = RealityOrchestrator;
if (typeof module !== 'undefined') module.exports = RealityOrchestrator;
