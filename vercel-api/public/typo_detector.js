// ─── Typo Detector for Dangerous APIs ────────────────
// يكتشف typos قريبة من APIs حساسة

const DANGEROUS_APIS = [
  // Network
  'urlopen','urloepn','urllib','requests','fetch','axios','http.get','https.get',
  'XMLHttpRequest','WebSocket','socket.connect',
  // System execution
  'subprocess.run','subprocess.call','subprocess.Popen',
  // [BARE-IMPORT] ‎from subprocess import Popen‎ ثم ‎Popen(cmd)‎ شكلٌ شائع،
  // وبلا مدخلٍ مجرَّدٍ لا يُدرَك خطؤه المطبعيُّ إطلاقًا — فالمقارنةُ تشترط
  // تطابقَ النطاق، ولا نطاقَ للنداءِ المجرَّد.
  'subprocess','Popen',
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

// مقاطعُ كلِّ APIs الخطرة — تُبنى مرّةً واحدة
const API_SEGMENTS = new Set(
  DANGEROUS_APIS.map(a => String(a).replace(/\($/, '').split('.').pop().toLowerCase())
);

// [DAMERAU] التبديلُ خطوةٌ واحدة، لا خطوتان.
//
// أشيعُ خطأٍ مطبعيٍّ هو قلبُ حرفين متجاورين (‎spwan‎ ↔ ‎spawn‎)، وLevenshtein
// يحسبه حذفًا وإدراجًا = 2. والعتبةُ للأسماءِ القصيرة (‎‎≤5‎‎) هي 1، فكان
// يسقط كلُّ خطأِ تبديلٍ على اسمٍ قصير. مقيسٌ قبل التعديل: 2 من 10 فقط
// تُكتشَف — ‎spwan‎ و‎exce‎ و‎eavl‎ و‎fecth‎ و‎axois‎ و‎Popne‎ كلُّها تفوت.
//
// وإضافةُ خطوةِ التبديل (Damerau) تُدرك العشرةَ **بنفس العتبة**، فلا
// تُشترى التغطيةُ برفعِ عتبةٍ يجلب إيجابياتٍ كاذبة.
function damerauLevenshtein(a, b) {
  const m = a.length, n = b.length;
  const dp = Array.from({length: m+1}, (_, i) => [i]);
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = a[i-1] === b[j-1]
        ? dp[i-1][j-1]
        : 1 + Math.min(dp[i-1][j], dp[i][j-1], dp[i-1][j-1]);
      // قلبُ حرفين متجاورين: خطوةٌ واحدة
      if (i > 1 && j > 1 && a[i-1] === b[j-2] && a[i-2] === b[j-1]) {
        dp[i][j] = Math.min(dp[i][j], dp[i-2][j-2] + 1);
      }
    }
  }
  return dp[m][n];
}

// [NO-ESCAPE] رمزٌ يسبقه ‎\‎ جزءٌ من هروبِ regex لا اسمٌ في الكود.
//
// كان التقطيعُ يمرّ على النصّ الخام، فـ‎\bexecFile‎ داخل حرفيّةِ regex
// يُقرأ رمزًا اسمُه ‎bexecFile‎ — وهو على بُعدِ 1 من ‎execFile‎ فيُبلَّغ
// «خطأٌ مطبعيّ». مقيسٌ في مصادر المشروع نفسِها: ‎bexecFile‎ و‎bspawn‎
// و‎nexec‎ و‎nos.system‎ — أربعةُ بلاغاتٍ كاذبةٍ مصدرُها الهروبُ وحده.
function extractTokens(code) {
  return code.match(/(?<!\\)[a-zA-Z_][a-zA-Z0-9_.]*/g) || [];
}

// آخرُ مقطعٍ من اسمٍ منقوط، بلا قوسٍ لاحق: ‎os.system‎→‎system‎ · ‎exec(‎→‎exec‎
function lastSegment(name) {
  return String(name).replace(/\($/, '').split('.').pop();
}

// النطاقُ قبل آخرِ نقطة: ‎os.system‎→‎os‎ · ‎exec(‎→‎''‎ · ‎Promise.all‎→‎Promise‎
function namespaceOf(name) {
  const parts = String(name).replace(/\($/, '').split('.');
  return parts.length > 1 ? parts.slice(0, -1).join('.') : '';
}

// [DECLARED] اسمٌ عرّفه المبرمجُ عمدًا ليس خطأً مطبعيًّا.
//
// ‎compare‎ و‎verifyFn‎ كلمتان مقصودتان، وتقعان على بُعدٍ قصيرٍ من
// ‎compile(‎ و‎verify(‎ فتُبلَّغان. والتمييزُ أنّ الخطأَ المطبعيَّ يُستدعى
// ولا يُعرَّف: ‎spwan(x)‎ نداءٌ بلا تعريف، و‎function compare(a,b)‎ تعريف.
function declaredNames(code) {
  const out = new Set();
  let m;
  const decl = /\b(?:function|class)\s+([A-Za-z_$][\w$]*)|\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)/g;
  while ((m = decl.exec(code))) out.add(String(m[1] || m[2]).toLowerCase());
  const sig = /\bfunction\b[^(]*\(([^)]*)\)/g;
  while ((m = sig.exec(code))) {
    for (const part of m[1].split(',')) {
      const n = part.trim().replace(/^\.\.\./, '').split(/[=:\s]/)[0];
      if (/^[A-Za-z_$][\w$]*$/.test(n)) out.add(n.toLowerCase());
    }
  }
  return out;
}

const KNOWN_TYPOS = {
  'urloepn': 'urlopen',
  'urllopen': 'urlopen',
  'unlinkSyncc': 'unlinkSync',
  'unlinksyncc': 'unlinkSync',
  'subprocss': 'subprocess',
  'subproces': 'subprocess',
};

const WHITELIST = [
  'request','response','result','reject','resolve','record',
  'require','redirect','replace','render','remove','received',
  'scheduled','selected','started','stopped','status','success',
  'https','mkdirSync','existsSync','statSync','readdirSync',
  'appendFileSync','createWriteStream','readFileSync','writeFileSync',
  'clearInterval','createHash'
];

function detectDangerousTypos(code) {
  // اكتشف known typos أولاً
  const knownFindings = [];
  Object.entries(KNOWN_TYPOS).forEach(([typo, correct]) => {
    const re = new RegExp('\\b' + typo + '\\s*\\(', 'g');
    if (re.test(code)) {
      knownFindings.push({
        token: typo,
        similar_to: correct,
        distance: damerauLevenshtein(typo, correct),
        severity: 'high',
        message: typo + ' يشبه ' + correct,
        impact: getApiImpact(correct)
      });
    }
  });

  const findings = [];
  const tokens = extractTokens(code);
  const seen = new Set();
  const declared = declaredNames(code);

  const COMMON_VARS = ['request','response','result','reject','resolve','record','require',
    'redirect','replace','render','remove','return','received','remaining','reached',
    'scheduled','selected','started','stopped','status','success','source','server',
    // ‎open‎ دالةٌ مدمجةٌ في بايثون واسمٌ شائعٌ جدًّا، وهي على بُعدِ 1 من
    // ‎Popen‎ بعد إضافةِ المدخلِ المجرَّد. إدراجُها هنا يمنع بلاغًا مطبعيًّا
    // كاذبًا ولا يمسّ كشفَ الثغرات: ‎open()‎ يعالجها ‎extended_patterns‎
    // بقاعدةِ Path Traversal المستقلّة.
    'open'];
  
  tokens.forEach(token => {
    if (token.length < 4) return;
    if (seen.has(token)) return;
    seen.add(token);
    // تجاهل المتغيرات الشائعة والـ whitelist
    if (COMMON_VARS.includes(token.toLowerCase())) return;
    if (WHITELIST.some(w => token.toLowerCase().includes(w.toLowerCase()))) return;
    // تجاهل tokens تنتهي بـ .on أو .get (event handlers)
    if (/.(on|get|set|use|end|add|run)$/.test(token)) return;
    // [DECLARED] اسمٌ معرَّفٌ في الملفِّ نفسِه قصدٌ لا خطأٌ مطبعيّ
    if (declared.has(lastSegment(token).toLowerCase())) return;

    const tokSeg = lastSegment(token).toLowerCase();
    // [KNOWN-API] رمزٌ هو بذاته اسمُ API معروفةٍ ليس خطأً مطبعيًّا لأخرى.
    // مقيس: ‎open‎ — وهي مدخلٌ قائمٌ ‎open(‎ — كانت تُبلَّغ خطأً مطبعيًّا
    // لـ‎Popen‎ (بُعدُ 1) بعد إضافةِ المدخلِ المجرَّد.
    if (API_SEGMENTS.has(tokSeg)) return;

    DANGEROUS_APIS.forEach(api => {
      // [SEGMENT] المقارنةُ بآخرِ مقطع، لا بالاسمِ منزوعَ النقطة.
      //
      // كان ‎api.replace(/[.(]/g,'')‎ يحوّل ‎os.system‎ إلى ‎ossystem‎، فيقع
      // ‎system‎ — وهو اسمٌ مشروعٌ وشائع — على بُعدِ 2 منه فيُبلَّغ خطأً
      // مطبعيًّا. وبالمقاطع: ‎system‎ مقابل ‎system‎ ⇒ الاسمُ نفسُه فيُترَك.
      // وبها أيضًا يُدرَك النداءُ المنقوط: ‎cp.exce‎ ⇒ ‎exce‎ مقابل ‎exec‎.
      const apiSeg = lastSegment(api).toLowerCase();
      if (!apiSeg || !tokSeg) return;
      if (tokSeg === apiSeg) return; // نفس الكلمة = مو typo

      // [NAMESPACE] المقاطعُ وحدَها تفقد إشارةَ النطاق.
      //
      // قِيس بعد اعتمادِ المقاطع: ‎Promise.all‎ صار خطأً مطبعيًّا لـ
      // ‎subprocess.call‎ (‎all‎↔‎call‎ بُعدُ 1)، و‎context‎ لـ
      // ‎socket.connect‎، و‎open‎ لـ‎os.popen‎. ولا صلةَ بين أيِّ زوجٍ منها.
      //
      // فإن كان لاسمِ الـAPI نطاقٌ، وجب أن يحملَ الرمزُ النطاقَ نفسَه.
      // وهذا لا يمنع النداءَ المنقوطَ على اسمٍ بلا نطاق: ‎cp.exce‎ يُقارَن
      // بالمدخلِ المجرَّد ‎exec‎ فيُدرَك.
      const apiNs = namespaceOf(api).toLowerCase();
      if (apiNs && apiNs !== namespaceOf(token).toLowerCase()) return;

      // [THRESHOLD-1] عتبةُ 2 للأسماءِ الطويلة كانت تعويضًا عن عجزِ
      // Levenshtein: التبديلُ عنده خطوتان، فلولا رفعُ العتبة لسقط كلُّ
      // خطأِ تبديل. و[DAMERAU] أزال سببَها — مقيسٌ أنّ 9 من الحالاتِ
      // العشرِ المستهدَفة على بُعدِ 1، والعاشرةُ ‎ruqire‎ لا تُكتشَف بحالٍ
      // لأنّ ‎require‎ ليست في قائمةِ الـAPIs الخطرة أصلًا.
      //
      // وثمنُ إبقائِها مقيسٌ أيضًا: ‎compare‎↔‎compile‎ و‎WriteLine‎↔‎writeFile‎
      // كلاهما بُعدُ 2، وكلاهما اسمٌ مشروعٌ لا خطأٌ مطبعيّ. فالعتبةُ 1.
      const threshold = 1;
      // تقليمٌ مطابقٌ للنتيجة: المسافةُ لا تقلّ أبدًا عن فرقِ الطول
      if (Math.abs(tokSeg.length - apiSeg.length) > threshold) return;

      const dist = damerauLevenshtein(tokSeg, apiSeg);

      if (dist > 0 && dist <= threshold && tokSeg.length >= apiSeg.length - 2) {
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

  return [...knownFindings, ...findings];
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
