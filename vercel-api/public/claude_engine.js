// ═══════════════════════════════════════════════════════
// claude_engine.js v0.1 — Claude AI Engine
// Standalone — registers as EngineType.AI in Orchestrator
// ═══════════════════════════════════════════════════════
"use strict";

var ClaudeEngine = (() => {

  const VERSION         = '0.1.0';
  const MODEL           = 'claude-sonnet-4-6';
  const API_URL         = 'https://api.anthropic.com/v1/messages';
  const DEFAULT_TIMEOUT = 15000;
  const MAX_TOKENS      = 1024;

  const Status = Object.freeze({
    SUGGESTION:     'SUGGESTION',
    PENDING_REVIEW: 'PENDING_REVIEW',
    ERROR:          'ERROR',
  });

  function _getApiKey() {
    // ANTHROPIC_API_KEY from environment ONLY — no runtime override allowed
    const key = (typeof process !== 'undefined' && process.env && process.env.ANTHROPIC_API_KEY) || null;
    if (!key || typeof key !== 'string' || key.trim().length < 10) return null;
    return key.trim();
  }

  function _buildPrompt(issue, code, fileName) {
    const lines = [
      'You are a secure code repair assistant. Suggest a minimal, safe fix for ONE specific issue.',
      '',
      'File: ' + fileName,
      'Issue type: ' + (issue.type || issue.cAct || 'UNKNOWN'),
      'Issue title: ' + (issue.title || issue.type || 'unknown'),
      'Line: ' + (issue.line || '?'),
    ];
    if (issue.strategy) lines.push('Strategy: ' + issue.strategy);
    if (issue.ev)       lines.push('Evidence: ' + issue.ev);
    lines.push(
      '',
      'Current code:',
      '```',
      code,
      '```',
      '',
      'Instructions:',
      '- Fix ONLY the reported issue at line ' + (issue.line || '?') + '.',
      '- Do NOT refactor unrelated code.',
      '- Do NOT add explanations — code comments only if essential.',
      '- Return ONLY the fixed code block, no prose before or after.',
      '- If you cannot safely fix it, reply with exactly: CANNOT_FIX'
    );
    return lines.join('\n');
  }

  function _makeClaudeResult(status, suggestion, issue, reason, model) {
    const s = Object.values(Status).includes(status) ? status : Status.PENDING_REVIEW;
    return Object.freeze({
      version:    VERSION,
      status:     s,
      suggestion: (s === Status.SUGGESTION && typeof suggestion === 'string') ? suggestion : null,
      issue:      issue || null,
      reason:     String(reason || ''),
      model:      model || MODEL,
      appliedAt:  null,
      approvedBy: null,
    });
  }

  async function _callAPI(prompt, apiKey, timeoutMs, fetchFn) {
    if (!fetchFn) throw new Error('fetch is not available');
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchFn(API_URL, {
        method:  'POST',
        signal:  controller.signal,
        headers: {
          'Content-Type':      'application/json',
          'x-api-key':         apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model:      MODEL,
          max_tokens: MAX_TOKENS,
          messages:   [{ role: 'user', content: prompt }],
        }),
      });
      if (!response.ok) {
        const body = await response.text().catch(() => '');
        throw new Error('HTTP ' + response.status + ': ' + body.slice(0, 200));
      }
      const data = await response.json();
      const text = data && data.content && data.content[0] && data.content[0].text;
      if (!text || typeof text !== 'string') throw new Error('API returned empty content');
      return { ok: true, text: text.trim(), model: (data.model || MODEL) };
    } finally {
      clearTimeout(timer);
    }
  }

  async function _processIssue(issue, code, fileName, apiKey, timeoutMs, fetchFn) {
    if (!issue || !code || !fileName) {
      return _makeClaudeResult(Status.PENDING_REVIEW, null, issue,
        'processIssue: missing required arguments');
    }
    try {
      const result = await _callAPI(_buildPrompt(issue, code, fileName), apiKey, timeoutMs, fetchFn);
      if (!result.text || result.text === 'CANNOT_FIX') {
        return _makeClaudeResult(Status.PENDING_REVIEW, null, issue,
          result.text === 'CANNOT_FIX'
            ? 'Claude indicated it cannot safely fix this issue'
            : 'Claude returned empty response',
          result.model);
      }
      return _makeClaudeResult(Status.SUGGESTION, result.text, issue,
        'Claude suggestion for "' + (issue.title || issue.type || 'unknown') + '"',
        result.model);
    } catch (err) {
      const reason = err.name === 'AbortError'
        ? 'Timeout after ' + timeoutMs + 'ms'
        : 'API call failed: ' + err.message;
      return _makeClaudeResult(Status.PENDING_REVIEW, null, issue, reason);
    }
  }

  async function suggest(aiNeeded, code, fileName, options) {
    const opts = options || {};
    if (!Array.isArray(aiNeeded) || aiNeeded.length === 0) {
      return [_makeClaudeResult(Status.PENDING_REVIEW, null, null,
        'suggest: aiNeeded must be a non-empty array')];
    }
    if (typeof code !== 'string' || !code.trim()) {
      return [_makeClaudeResult(Status.PENDING_REVIEW, null, null,
        'suggest: code must be a non-empty string')];
    }
    if (!fileName) {
      return [_makeClaudeResult(Status.PENDING_REVIEW, null, null,
        'suggest: fileName is required')];
    }
    const apiKey    = _getApiKey();
    const timeoutMs = Math.max(1000, opts.timeoutMs || DEFAULT_TIMEOUT);
    const fetchFn   = opts._fetchFn || (typeof fetch === 'function' ? fetch : null);

    if (!apiKey) {
      return [_makeClaudeResult(Status.PENDING_REVIEW, null, null,
        'ANTHROPIC_API_KEY is not set — set it in environment variables, not in code')];
    }

    return Promise.all(
      aiNeeded.map(function(issue) {
        return _processIssue(issue, code, fileName, apiKey, timeoutMs, fetchFn)
          .catch(function(err) {
            return _makeClaudeResult(Status.ERROR, null, issue, 'Unexpected error: ' + err.message);
          });
      })
    );
  }

  return Object.freeze({
    VERSION,
    MODEL,
    Status,
    suggest,
    _buildPrompt,
    _makeClaudeResult,
    _getApiKey,
  });

})();

if (typeof window !== 'undefined') window.ClaudeEngine = ClaudeEngine;
if (typeof module !== 'undefined') module.exports = ClaudeEngine;
