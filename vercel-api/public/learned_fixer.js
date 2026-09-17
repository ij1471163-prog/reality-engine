// ═══════════════════════════════════════════════════════
// learned_fixer.js v2.1 — يطبق ما تعلمه المحرك (Candidate Generator فقط)
// © 2025 Naif Lucena — Reality Engine
//
// الدور في المعمارية:
//
//   RealityOrchestrator / Pipeline / GhostMode
//            ↓
//   LearnedFixer (هذا الملف)   ← يولّد candidate فقط
//            ↓
//   candidate code (نص)
//            ↓
//   FixVerifier                ← بوابة التحقق الوحيدة
//            ↓
//   ACCEPT / REJECT
//
// ⚠️ هذا الملف **لا يطبّق شيئًا على المشروع**: لا يكتب إلى F ولا R، ولا
// يحفظ في localStorage، ولا يستدعي FixVerifier. يُرجع { code, applied }
// ويترك القبول كاملًا للمستدعي عبر البوابة.
//
// ⚠️ confidence/verified/approved شروط **اختيار candidate** فقط. تعني
// "هذا النوع من الإصلاح مسموح بتجربته"، ولا تعني إطلاقًا "هذا التعديل
// بعينه سليم". إثبات السلامة وظيفة FixVerifier وحده.
//
// ═══ تغييرات v2.1 — إصلاح مشاكل مُثبَتة بالتشغيل ═══
//
//   [1] smartApply لم يعد يشترط وجود LearningEngine.
//       كان: if (typeof LearningEngine === 'undefined') return {code, applied:0};
//       بينما الدالة لا تستخدمه إطلاقًا — البيانات تأتي من localStorage.
//       أُثبت أن LearningEngine = {} فارغًا تمامًا يجعلها تعمل كاملة، أي
//       أنها كانت بوابة وجود لا أكثر. النتيجة: ترتيب تحميل يضع هذا الملف
//       قبل learning_engine.js كان يعطّل smartApply بصمت.
//
//   [2] secret: ext كانت ['js','ts','py','php','java'] بينما fix يولّد
//       process.env.X وهي صيغة JavaScript. لم ينفجر الخطأ إلا لأن detect
//       يشترط const|let|var فحَجَب الصيغ الأصلية بالصدفة — أي أن الحارسين
//       كانا يحرسان بعضهما. أُثبت الفساد فعليًا: ملف .py فيه سطر بصيغة
//       const أنتج "const API_KEY = process.env.API_KEY" داخل Python.
//       الآن: ext = ['js','ts'] فقط، وdetect يشترط بداية سطر بـconst/let/var.
//
//   [3] sql: مُعطَّل (enabled:false). أُثبت أنه ينتج SQL مكسورًا:
//         - فقدان مسافة: "WHERE id = " + uid  →  "WHERE id =?"
//         - تعليم مواضع لا تقبله: "ORDER BY " + col → "ORDER BY?"
//           و "FROM " + table → "FROM?" (SQL لا يسمح بمعاملات مرتبطة
//           لأسماء الأعمدة/الجداول)
//         - placeholder واحد لكل الـdrivers: ? بينما pg يحتاج $1
//         - php في ext رغم أنه يستخدم "." لا "+" فلا يطابق أصلاً
//       ولا يمكن إصلاحه بتعديل regex: يحتاج تمييز موضع القيمة داخل
//       الاستعلام ومعرفة الـdriver — وهذا موجود فعلاً في fallback_fixes.js
//       (fbBuildParamQuery/fbValuePositionOk/FB_SQL_DRIVERS). تكراره هنا
//       بصيغة أضعف يعني مصدرين متعارضين. يبقى معرَّفًا للتوافق ولا يُشغَّل.
//
//   [4] xss_dom: كان يستبدل .innerHTML بـ.textContent أعمى. أُثبتت حالتان
//       فاسدتان:
//         box.innerHTML = box.innerHTML + row;
//           → box.textContent = box.innerHTML + row;   (قراءة/كتابة مختلطتان)
//         container.innerHTML = renderTemplate(data);
//           → يحوّل HTML مقصودًا إلى نص حرفي
//       الآن: إسناد مباشر لمعرّف بسيط فقط، ولا يلمس أي سطر فيه innerHTML
//       مرة أخرى أو + أو استدعاء دالة أو template literal.
//
//   [5] crypto: قُيّد بسياق أمني صريح. كان يبدّل md5/sha1 في ETag أو
//       checksum أو توافق مع نظام خارجي — وهذا كسر توافق لا إصلاح أمني.
//
// الواجهة العامة (بلا تغيير):
//   LearnedFixer.apply / smartApply / GENERALIZERS
//   window.LearnedFixer / module.exports كما كانا.
// ═══════════════════════════════════════════════════════
"use strict";

var LearnedFixer = (() => {

  const VERSION = '2.1';

  // ─── Pattern Generalizers ─────────────────────────
  //
  // كل generalizer: { ext, detect, fix, validate, enabled? }
  //   enabled:false ⇒ معرَّف للتوافق لكنه لا يُشغَّل إطلاقًا (انظر apply).
  //
  // قاعدة عامة بعد v2.1: الـgeneralizer يرفض الحالة عند أدنى غموض ويُرجع
  // السطر كما هو. مرشّح لم يُولَّد أفضل من مرشّح مكسور يستهلك دورة تحقق.
  const GENERALIZERS = {
    accumulation: {
      ext:      ['js', 'ts', 'py', 'php'],
      detect:   /(\w+)\s*=(?!=|\+)\s*(\w+\.\w+)\s*;/,
      fix:      (line, m) => line.replace(`${m[1]} = ${m[2]}`, `${m[1]} += ${m[2]}`),
      validate: (before, after) => after.includes('+=') && !before.includes('+='),
    },

    // [v2.1] معطَّل — ينتج SQL مكسورًا. انظر الشرح [3] في الترويسة.
    // إصلاح SQL الصحيح موجود في fallback_fixes.js مع تمييز موضع القيمة
    // واستنتاج الـdriver من استيرادات الملف.
    sql: {
      enabled:  false,
      reason:   'produces_broken_sql_no_driver_or_value_position_awareness',
      ext:      ['js', 'ts', 'py', 'php', 'java'],
      detect:   /["'`]([^"'`]*(?:SELECT|INSERT|UPDATE|DELETE)[^"'`]*)["'`]\s*\+\s*(\w+)/i,
      fix:      (line, m) => {
        const base = m[1].replace(/['"]/g, '').trimEnd();
        const param = m[2];
        return line.replace(m[0], `"${base}?" , [${param}]`);
      },
      validate: (before, after) => after.includes('?') && after.includes('['),
    },

    secret: {
      // [v2.1] JS/TS فقط — process.env صيغة JavaScript.
      // Python تحتاج os.environ.get، PHP تحتاج getenv، Java تحتاج System.getenv،
      // وكلها تحتاج استيرادات/سياقًا مختلفًا. إصلاحها ليس استبدال نص.
      ext:      ['js', 'ts'],
      // [v2.1] مربوط ببداية السطر: إعلان JS حقيقي لا نص يشبهه داخل لغة أخرى.
      detect:   /^\s*(?:const|let|var)\s+(\w+)\s*=\s*["'][^"']{6,}["']\s*;?\s*$/,
      fix:      (line, m) => {
        if (!/KEY|SECRET|TOKEN|PASSWORD|PASS|API/i.test(m[1])) return line;
        return line.replace(/=\s*["'][^"']+["']/, `= process.env.${m[1]}`);
      },
      validate: (before, after) =>
        after.includes('process.env') && before !== after &&
        // لا نُدخل process.env في سطر فيه أصلاً (تفادي التداخل)
        !before.includes('process.env'),
    },

    crypto: {
      ext:      ['js', 'ts'],
      detect:   /createHash\s*\(\s*['"](?:md5|sha1)['"]\s*\)/i,
      fix:      (line) => {
        // [v2.1] سياق أمني صريح فقط. md5/sha1 في ETag أو checksum أو
        // cache-key أو توافق مع نظام خارجي ليست ثغرة — وتبديلها يكسر
        // التوافق. لا نستطيع إثبات النية من سطر واحد، فنشترط دليلاً نصيًا.
        if (!/password|passwd|pwd|secret|token|credential|signature|hmac|auth/i.test(line)) return line;
        // ولا نلمس سطرًا يُصرّح بأنه للتوافق/legacy
        if (/legacy|compat|etag|checksum|cache|fingerprint|non[-_ ]?crypto/i.test(line)) return line;
        return line.replace(/['"](?:md5|sha1)['"]/i, '"sha256"');
      },
      validate: (before, after) => after.includes('sha256') && before !== after,
    },

    xss_dom: {
      ext:      ['js', 'ts', 'html'],
      // [v2.1] إسناد مباشر فقط: x.innerHTML = ident;
      // القيمة معرّف بسيط (مع وصول خصائص) — لا استدعاء دالة، لا +، لا
      // template literal، لا سلسلة حرفية.
      detect:   /^(\s*)([\w$]+(?:\.[\w$]+)*)\.innerHTML\s*=\s*([A-Za-z_$][\w$]*(?:\.[\w$]+)*)\s*;?\s*$/,
      fix:      (line, m) => {
        const target = m[2];
        const value  = m[3];
        // الحالة المُثبَتة الفاسدة: box.innerHTML = box.innerHTML + row
        // (يحجبها detect أصلاً، وهذا حزام ثانٍ)
        if (/innerHTML/.test(value)) return line;
        // لا نلمس سطرًا يقرأ ويكتب نفس العنصر
        if (value === target) return line;
        return m[1] + target + '.textContent = ' + value + ';';
      },
      validate: (before, after) =>
        after.includes('textContent') &&
        // بعد التحويل يجب ألا يبقى innerHTML في السطر — يمنع الخلط
        !after.includes('innerHTML') &&
        before !== after,
    },
  };

  // ─── Apply ─────────────────────────────────────────
  // يُرجع candidate فقط. لا يكتب ولا يطبّق ولا يستدعي FixVerifier.
  function apply(code, fileName, learnedPatterns) {
    if (typeof code !== 'string') return { code, applied: 0 };
    if (!learnedPatterns || learnedPatterns.length === 0) return { code, applied: 0 };

    const ext = (fileName || '').split('.').pop().toLowerCase();
    const lines = code.split('\n');
    let applied = 0;

    // فلتر patterns موثوقة فقط.
    // ⚠️ هذه شروط اختيار candidate — ليست إثبات سلامة. FixVerifier هو من
    // يقرر إن كان التعديل الناتج مقبولاً.
    const approved = learnedPatterns.filter(p =>
      p && p.approved === true &&
      p.confidence >= 0.20 &&
      p.verified >= 2 &&
      p.before && p.after &&
      p.before !== p.after
    );
    if (!approved.length) return { code, applied: 0 };

    // [v2.1] الـgeneralizers المشغَّلة فقط
    const activeGens = Object.entries(GENERALIZERS).filter(([, g]) => g.enabled !== false);

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const t = line.trim();
      if (!t || t.startsWith('//') || t.startsWith('#') || t.startsWith('*')) continue;

      // 1. Exact match أولاً — مرة وحدة
      const exactMatch = approved.find(p => t === p.before);
      if (exactMatch) {
        lines[i] = line.replace(exactMatch.before, exactMatch.after);
        applied++;
        continue; // لا تكمل Generalizers على نفس السطر
      }

      // 2. Generalizers — فقط لو ext مناسب ولو في pattern موافق
      for (const [type, gen] of activeGens) {
        // تحقق ext
        if (gen.ext && !gen.ext.includes(ext)) continue;

        // تحقق وجود approved pattern من نفس النوع
        const hasApproved = approved.some(p =>
          p.type && p.type.toLowerCase().includes(type.split('_')[0])
        );
        if (!hasApproved) continue;

        // [v2.1] detect يُطبَّق على السطر كاملاً لا على trim()، لأن أنماط
        // v2.1 مربوطة ببداية/نهاية السطر (^…$) للحفاظ على المسافة البادئة.
        const m = line.match(gen.detect) || t.match(gen.detect);
        if (!m) continue;

        let fixed;
        try { fixed = gen.fix(line, m); }
        catch (e) { continue; }                 // generalizer رمى ⇒ تجاهل
        if (typeof fixed !== 'string' || fixed === line) continue;
        if (gen.validate && !gen.validate(line, fixed)) continue;

        lines[i] = fixed;
        applied++;
        break; // سطر واحد → generalizer واحد فقط
      }
    }

    return { code: lines.join('\n'), applied };
  }

  // ─── Smart Apply ──────────────────────────────────
  // [v2.1] لا يشترط LearningEngine — لم يكن يستخدمه إطلاقًا، وكان وجوده
  // شرطًا يعطّل الدالة بصمت حسب ترتيب تحميل السكربتات.
  // المصدر الفعلي للأنماط هو localStorage، وغيابه يعني ببساطة صفر أنماط.
  function smartApply(code, fileName) {
    try {
      const raw = (typeof localStorage !== 'undefined' && localStorage)
        ? localStorage.getItem('re_learned_patterns_v2')
        : null;
      if (!raw) return { code, applied: 0 };
      const db = JSON.parse(raw);
      const patterns = (db && Array.isArray(db.patterns)) ? db.patterns : [];
      return apply(code, fileName, patterns);
    } catch(e) {
      return { code, applied: 0 };
    }
  }

  return { apply, smartApply, GENERALIZERS, VERSION };
})();

if (typeof window !== 'undefined') window.LearnedFixer = LearnedFixer;
if (typeof module !== 'undefined') module.exports = LearnedFixer;
