// ─── Typo Detector for Dangerous APIs ────────────────
// يكتشف typos قريبة من APIs حساسة

const DANGEROUS_APIS = [
  // Network
  'urlopen','urllib','requests','fetch','axios','http.get','https.get',
  'XMLHttpRequest','WebSocket','socket.connect',
  // System execution
  'subprocess.run','subprocess.call','subprocess.Popen',
  'os.system','os.popen','exec','execSync','execFile','spawn','spawnSync',
  'child_process','shelljs',
  // File system (destructive)
  'unlinkSync','unlink','rmdir','rmdirSync','rm(','rimraf',
  'writeFileSync','writeFile','appendFile',
  // Code execution
  'eval(','exec(','Function(','compile(','__import__',
  // Scheduling
  'setInterval','setTimeout','cron','schedule',
  // Crypto/Keys
  'createCipher','createDecipher','sign(','verify(',
];

function levenshtein(a, b) {
  const m = a.length, n = b.length;
  const dp = Array.from({length: m+1}, (_, i) => [i]);
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = a[i-1] === b[j-1]
        ? dp[i-1][j-1]
        : 1 + Math.min(dp[i-1][j], dp[i][j-1], dp[i-1][j-1]);
    }
  }
  return dp[m][n];
}

function extractTokens(code) {
  // استخرج كل tokens من الكود
  return code.match(/[a-zA-Z_][a-zA-Z0-9_.]*/g) || [];
}

function detectDangerousTypos(code) {
  const findings = [];
  const tokens = extractTokens(code);
  const seen = new Set();

  tokens.forEach(token => {
    if (token.length < 4) return; // تجاهل tokens قصيرة
    if (seen.has(token)) return;
    seen.add(token);

    DANGEROUS_APIS.forEach(api => {
      // تحقق من التشابه
      const apiBase = api.replace(/[.(]/g, '');
      const tokenClean = token.replace(/[.(]/g, '');

      if (tokenClean === apiBase) return; // نفس الكلمة = مو typo

      const dist = levenshtein(tokenClean.toLowerCase(), apiBase.toLowerCase());
      const threshold = apiBase.length <= 5 ? 1 : apiBase.length <= 8 ? 2 : 3;

      if (dist > 0 && dist <= threshold && tokenClean.length >= apiBase.length - 2) {
        // تأكد إن الـ token موجود في الكود كـ function call
        const callPattern = new RegExp('\\b' + token.replace(/\./g, '\\.') + '\\s*\\(');
        if (callPattern.test(code)) {
          findings.push({
            token,
            similar_to: api,
            distance: dist,
            severity: 'high',
            message: `"${token}" يشبه "${api}" — typo يمنع تنفيذ API حساسة`,
            impact: getApiImpact(api)
          });
        }
      }
    });
  });

  return findings;
}

function getApiImpact(api) {
  if (['urlopen','urllib','requests','fetch','axios','XMLHttpRequest','WebSocket'].some(a => api.includes(a)))
    return '🌐 شبكة — يمكن إرسال بيانات لسيرفر خارجي';
  if (['subprocess','os.system','os.popen','exec','spawn','child_process','shelljs'].some(a => api.includes(a)))
    return '⚙️ نظام — تنفيذ أوامر على الجهاز';
  if (['unlink','rmdir','rm(','rimraf','writeFile'].some(a => api.includes(a)))
    return '📁 ملفات — حذف أو تعديل ملفات';
  if (['eval','exec(','Function(','compile'].some(a => api.includes(a)))
    return '💻 كود — تنفيذ كود ديناميكي';
  if (['setInterval','setTimeout','cron'].some(a => api.includes(a)))
    return '⏰ جدولة — تشغيل تلقائي';
  return '⚠️ API حساسة';
}

function renderTypoWarnings(findings) {
  if (!findings || findings.length === 0) return '';

  let html = `<div style="background:#1a0808;border:1px solid #f8514955;border-radius:8px;padding:12px;margin:8px 0">
    <div style="color:#f85149;font-weight:700;margin-bottom:8px">🔍 Typos قريبة من APIs خطرة</div>`;

  findings.forEach(f => {
    html += `<div style="margin-bottom:8px;padding:8px;background:#0d1117;border-radius:6px">
      <div style="color:#f0883e;font-family:monospace;font-size:13px">"${f.token}" → "${f.similar_to}"</div>
      <div style="color:#8b949e;font-size:12px;margin-top:4px">${f.impact}</div>
      <div style="color:#d29922;font-size:11px;margin-top:2px">⚠️ إصلاح هذا الـ typo سيفعّل هذه الصلاحية</div>
    </div>`;
  });

  html += `<div style="color:#f85149;font-size:12px;margin-top:6px">🚫 Reality Engine لن يصلح هذه الأخطاء تلقائياً</div>
  </div>`;
  return html;
}
