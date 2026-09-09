// ═══════════════════════════════════════════════════════
// learning_engine.js v2.1 — Evidence-based Learning
// يتعلم فقط من إصلاحات تحقق منها Ghost Mode
// ═══════════════════════════════════════════════════════
"use strict";

var LearningEngine = (() => {

  const STORAGE_KEY = 're_learned_patterns_v2';

  const THRESHOLDS = {
    MIN_VERIFIED:   2,     // أدنى تحققات قبل الموافقة
    MIN_CONFIDENCE: 0.20,  // أدنى confidence
    MAX_CONFIDENCE: 0.97,  // حد أقصى
    DECAY_ON_FAIL:  0.15,  // خفض confidence عند الفشل
  };

  // Evidence curve — verified فقط ترفع confidence
  function calcConfidence(verified, failures) {
    if (verified < THRESHOLDS.MIN_VERIFIED) return 0;
    const total = verified + failures;
    const successRate = verified / total;

    let base;
    if (verified >= 50) base = 0.95;
    else if (verified >= 20) base = 0.90;
    else if (verified >= 10) base = 0.80;
    else if (verified >= 5)  base = 0.70;
    else                      base = 0.60;

    return Math.min(THRESHOLDS.MAX_CONFIDENCE, base * successRate);
  }

  // ─── Storage ────────────────────────────────────────
  function load() {
    try {
      const data = localStorage.getItem(STORAGE_KEY);
      return data ? JSON.parse(data) : { patterns: [], safe: [], meta: { total: 0 } };
    } catch(e) {
      return { patterns: [], safe: [], meta: { total: 0 } };
    }
  }

  function save(db) {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(db)); } catch(e) {}
  }

  // ─── Safe Whitelist ─────────────────────────────────
  const SAFE_SIGNATURES = [
    /process\.env\.\w+/,
    /os\.environ(?:\.get)?\s*\(/,
    /getenv\s*\(/,
    /\.textContent\s*=/,
    /htmlspecialchars/,
    /execFile\s*\(/,
    /sha256|bcrypt|argon2/i,
    /\?\s*\]/,
    /expiresIn/,
    /\.catch\s*\(/,
    /req\.user/,
    /res\.status\(401\)/,
  ];

  function isSafe(line) {
    return SAFE_SIGNATURES.some(p => p.test(line));
  }

  // ─── Extract Pair ───────────────────────────────────
  function extractPair(codeBefore, codeAfter, issue) {
    const linesBefore = codeBefore.split('\n');
    const linesAfter  = codeAfter.split('\n');
    const ln = (issue.line || 1) - 1;

    const before = linesBefore[ln]?.trim() || '';
    const after  = linesAfter[ln]?.trim()  || '';

    if (!before || before === after) return null;
    if (isSafe(before)) return null; // لا تتعلم من كود صح

    return {
      type:     issue.type || issue.cAct || 'unknown',
      severity: issue.sev  || 'c',
      before,
      after,
    };
  }

  // ─── Learn ──────────────────────────────────────────
  function learn(codeBefore, codeAfter, issues, fileName) {
    if (!codeBefore || !codeAfter || codeBefore === codeAfter) return 0;

    const db = load();
    let learned = 0;

    issues.forEach(issue => {
      const pair = extractPair(codeBefore, codeAfter, issue);
      if (!pair) return;

      const existing = db.patterns.find(p =>
        p.type === pair.type && p.before === pair.before
      );

      if (existing) {
        existing.observed = (existing.observed || 0) + 1;
        existing.lastSeen = Date.now();
      } else {
        db.patterns.push({
          id:         `${Date.now()}-${Math.random().toString(36).slice(2,7)}`,
          type:       pair.type,
          severity:   pair.severity,
          before:     pair.before,
          after:      pair.after,
          fileName:   fileName || '',
          observed:   1,
          verified:   0,
          failures:   0,
          confidence: 0,
          approved:   false,
          created:    Date.now(),
          lastSeen:   Date.now(),
        });
        learned++;
      }
    });

    db.meta.total++;
    save(db);
    return learned;
  }

  // ─── Verify (Ghost Mode calls this with patternId) ──
  function verify(patternId, success) {
    const db = load();
    const p = db.patterns.find(p => p.id === patternId);
    if (!p) return;

    if (success) {
      p.verified  = (p.verified  || 0) + 1;
    } else {
      p.failures  = (p.failures  || 0) + 1;
      // decay — فشل يخفض confidence
      p.confidence = Math.max(0, (p.confidence || 0) - THRESHOLDS.DECAY_ON_FAIL);
      // revoke approval لو فشل كثير
      if (p.failures >= 3) p.approved = false;
    }

    p.confidence = calcConfidence(p.verified || 0, p.failures || 0);

    // موافقة تلقائية
    if (p.verified >= THRESHOLDS.MIN_VERIFIED && p.confidence >= THRESHOLDS.MIN_CONFIDENCE) {
      p.approved = true;
    }

    save(db);
    return p.id;
  }

  // ─── markResult (deprecated — use verify instead) ───
  // @deprecated استخدم verify(patternId, success)
  function markResult(type, success) {
    // intentionally empty — لا يرفع verified بشكل جماعي
    console.warn('[LearningEngine] markResult deprecated. Use verify(patternId, success)');
  }

  // ─── Apply Learned ──────────────────────────────────
  function applyLearned(code, fileName) {
    const db = load();
    if (!db.patterns.length) return { fixed: code, applied: 0 };

    const goodPatterns = db.patterns.filter(p =>
      p.approved &&
      p.confidence >= THRESHOLDS.MIN_CONFIDENCE &&
      p.verified   >= THRESHOLDS.MIN_VERIFIED
    );

    if (!goodPatterns.length) return { fixed: code, applied: 0 };

    const lines = code.split('\n');
    let applied = 0;

    lines.forEach((line, i) => {
      const t = line.trim();
      if (!t || t.startsWith('//') || t.startsWith('#')) return;
      if (isSafe(t)) return;

      goodPatterns.forEach(p => {
        if (t !== p.before) return;
        lines[i] = line.replace(p.before, p.after);
        p.lastUsed = Date.now();
        applied++;
      });
    });

    save(db);
    return { fixed: lines.join('\n'), applied };
  }

  // ─── Learn Safe ─────────────────────────────────────
  function learnSafe(code, fileName) {
    const db = load();
    db.safe = db.safe || [];
    let learned = 0;

    code.split('\n').forEach(line => {
      const t = line.trim();
      if (!t || t.startsWith('//')) return;
      if (!isSafe(t)) return;
      if (db.safe.find(s => s.pattern === t.substring(0, 80))) return;

      db.safe.push({ pattern: t.substring(0, 80), created: Date.now() });
      learned++;
    });

    if (learned > 0) save(db);
    return learned;
  }

  // ─── Stats ──────────────────────────────────────────
  function getStats() {
    const db = load();
    return {
      total:    db.patterns.length,
      approved: db.patterns.filter(p => p.approved).length,
      pending:  db.patterns.filter(p => !p.approved).length,
      safe:     (db.safe || []).length,
      patterns: db.patterns.map(p => ({
        id:         p.id,
        type:       p.type,
        before:     p.before?.slice(0, 60),
        after:      p.after?.slice(0, 60),
        observed:   p.observed,
        verified:   p.verified,
        failures:   p.failures,
        confidence: p.confidence?.toFixed(2),
        approved:   p.approved,
      }))
    };
  }

  function getBoosts() {
    const db = load();
    const boosts = new Map();
    db.patterns
      .filter(p => p.approved && p.confidence >= 0.8)
      .forEach(p => {
        const cur = boosts.get(p.type) || 0;
        boosts.set(p.type, Math.max(cur, p.confidence));
      });
    return boosts;
  }

  function reset() {
    try { localStorage.removeItem(STORAGE_KEY); } catch(e) {}
  }

  return { learn, learnSafe, applyLearned, verify, markResult, getStats, getBoosts, reset };
})();

if (typeof window !== 'undefined') window.LearningEngine = LearningEngine;
if (typeof module !== 'undefined') module.exports = LearningEngine;
