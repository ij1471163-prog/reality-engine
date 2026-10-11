/**
 * engine_self_diagnosis.js v1.0
 * ══════════════════════════════════════════════════════════════════════
 * الحلقة الناقصة في التشخيص الذاتي.
 *
 * الموجود قبل هذا الملف:
 *   • self_healing_engine.js — دورة حياة كاملة: PENDING_REVIEW / APPROVED /
 *     REJECTED / ROLLED_BACK، سجل (sh_log)، لقطات مع diff (sh_snaps)،
 *     approve() يتحقق أن الـpatch يطابق ما اختُبر، وrollback تلقائي عند الفشل.
 *   • reality_orchestrator.js — سجل محركات وسياسة موافقة.
 *   • fix_verifier.js — البوابة.
 * والناقص أن كل هذا يعالج **كود المستخدم**: Patcher يعرف RepairSQL وXSSFixer
 * فقط، وTests.regression يقيس بلاغات المحلل على ملف المستخدم. فلا شيء يكتشف
 * خللًا في **وحدة من وحدات المحرك نفسه**، ولا يحدد سببه، ولا يختبر إصلاحًا لها
 * في بيئة معزولة. وmonitor() يمسك الاستثناءات وحدها: محرك يُعيد جوابًا **خاطئًا**
 * بلا استثناء يمرّ بلا أن يلاحظه أحد.
 *
 * ما يضيفه هذا الملف — ولا شيء غيره:
 *   1. اكتشاف: بطارية مِجسّات بأجوبة معروفة على وحدات المحرك. فشل مِجسّ = خلل
 *      داخلي مكتشَف، بدليل: الوحدة، والمدخل، والمتوقَّع، والفعلي.
 *   2. تحديد السبب: المِجسّ يُعاد تشغيله على نسخة المرجع (git HEAD) للوحدة.
 *      نجح هناك وفشل هنا ⇒ السبب في فرق النسختين. يُقسَّم الفرق إلى hunks،
 *      ويُبحَث عن **أصغر** مجموعة يُعيد التراجع عنها المِجسّ إلى النجاح.
 *   3. اقتراح إصلاح: الـcandidate = الشجرة الحالية مع التراجع عن تلك الـhunks.
 *      لا مولّد كود: مصدر الإصلاح هو git، فما نقترحه قابل للمراجعة سطرًا بسطر.
 *   4. اختبار في بيئة معزولة: سياق vm جديد في كل مرة، يُحمَّل فيه الـcandidate
 *      بدل الوحدة الأصلية. لا يُكتب أي ملف، ولا يُلمس السياق الحيّ.
 *   5. التحقق من عدم تراجع غيره: **كل** البطارية تُعاد في العزل، ويُشترط ألا
 *      يسقط أي مِجسّ كان ناجحًا. سقوط واحد ⇒ regression ⇒ لا اقتراح.
 *   6. الحالة: PENDING_REVIEW افتراضًا عبر SelfHealing نفسه — نفس السجل ونفس
 *      اللقطات ونفس approve/reject. لا تطبيق تلقائي ولا كتابة على القرص أبدًا.
 *
 * حدود معلنة:
 *   • Node فقط: يحتاج vm وfs وgit. في المتصفح يُعيد available:false بصراحة
 *     ولا يُظهر قدرة لا يملكها.
 *   • لا يُصلح إلا الخلل الذي يستطيع عزوه إلى فرق بين الشجرة والمرجع. الخلل
 *     القديم المُودع في المرجع نفسه يُكتشف ويُسجَّل ويُشخَّص بأنه ليس تراجعًا،
 *     ولا يُقترح له إصلاح.
 *   • لا يكتب على القرص في أي مسار. التطبيق بيد الإنسان عبر applyCallback.
 * ══════════════════════════════════════════════════════════════════════
 */

"use strict";

var EngineSelfDiagnosis = (() => {

  const VERSION = "1.0.0";

  // حدود البحث — تمنع انفجار الزمن على فرق كبير
  const MAX_DIFF_LINES  = 6000;      // أكبر من ذلك ⇒ hunk واحد للملف كله
  const MAX_LCS_CELLS   = 4_000_000; // سقف جدول LCS ≈ 16MB (4 بايت للخلية)
  const MAX_PAIR_TRIALS = 60;        // سقف محاولات الأزواج

  // ═════════════════════════════════════════════════════════════════
  // قائمة وحدات المحرك
  // ═════════════════════════════════════════════════════════════════
  // مطابقة لترتيب api/analyze.js: acorn أولًا لأن GhostMode.syntaxOk تُعطِّل
  // نفسها بدونه، وfix_verifier قبل ghost_mode وfix_engine_pipeline.
  // اختبار drift يثبّت أن هذه القائمة لا تتباعد عن قائمة الخادم.

  const MODULES = Object.freeze([
    "acorn.min.js",
    "engine_java.js", "c_cpp_analyzer.js", "analyzer.js", "security_scanner.js",
    "secret_detector.js", "taint_core.js", "taint_js.js",
    "taint_py.js", "taint_php.js", "context_analyzer.js",
    "repair_engine.js", "fallback_fixes.js", "emergency_fixes.js",
    "smart_repair.js", "fixers_orchestrator.js", "repair_sql.js", "self_healing_engine.js",
    "repair_html.js", "repair_advanced.js", "fix_verifier.js",
    "ghost_mode.js", "learning_engine.js", "fix_engine_pipeline.js",
  ]);

  // ═════════════════════════════════════════════════════════════════
  // بطارية المِجسّات
  // ═════════════════════════════════════════════════════════════════
  //
  // كل مِجسّ عقدٌ قائم فعلًا، قيست قيمته قبل كتابته — لا توقّع مفترض.
  // ويُنفَّذ **داخل** سياق العزل كنصّ، ويُعيد JSON فقط: لا كائنات تعبر الحدود
  // بين العوالم (خطأ قديم: deepStrictEqual يفشل على مصفوفة أُنشئت داخل vm).
  //
  // الحقول: id، module (الوحدة التي يستجوبها)، title، expr.
  // وexpr يُعيد { ok, expected, actual }.

  const PROBES = Object.freeze([

    // ── fix_verifier.js : البوابة ────────────────────────────────
    {
      id: "gate.empty-output-rejected",
      module: "fix_verifier.js",
      title: "البوابة ترفض ناتجًا فارغًا",
      expr: `(function () {
        var r = FixVerifier.verifyFix("var a = 1;", "", "a.js", analyzeCode);
        return {
          ok: r.accepted === false && r.reason === "REJECTED_EMPTY_OUTPUT",
          expected: "accepted=false reason=REJECTED_EMPTY_OUTPUT",
          actual: "accepted=" + r.accepted + " reason=" + r.reason
        };
      })()`,
    },
    {
      id: "gate.broken-syntax-rejected",
      module: "fix_verifier.js",
      title: "البوابة ترفض إصلاحًا يكسر الصياغة",
      expr: `(function () {
        var r = FixVerifier.verifyFix("function f(){ return 1; }", "function f(){ return 1; ", "a.js", analyzeCode);
        var pre = "REJECTED_SYNTAX_BROKEN";
        return {
          ok: r.accepted === false && String(r.reason).indexOf(pre) === 0,
          expected: "accepted=false reason يبدأ بـ" + pre,
          actual: "accepted=" + r.accepted + " reason=" + String(r.reason).slice(0, 60)
        };
      })()`,
    },
    {
      id: "gate.no-improvement-rejected",
      module: "fix_verifier.js",
      title: "البوابة ترفض تغييرًا لا يُنقص أي مشكلة",
      expr: `(function () {
        var b = 'app.get("/u", (q, s) => { db.query("SELECT * FROM u WHERE id=" + q.query.id); });';
        var a = b.replace("q.query.id", "String(q.query.id)");
        var r = FixVerifier.verifyFix(b, a, "a.js", analyzeCode);
        var pre = "REJECTED_NO_IMPROVEMENT";
        return {
          ok: r.accepted === false && String(r.reason).indexOf(pre) === 0,
          expected: "accepted=false reason يبدأ بـ" + pre,
          actual: "accepted=" + r.accepted + " reason=" + String(r.reason).slice(0, 60)
        };
      })()`,
    },
    {
      id: "gate.sql-not-parameterized-rejected",
      module: "fix_verifier.js",
      title: "البوابة ترفض إصلاح SQL يُخفي الإشارة بلا معاملات",
      expr: `(function () {
        var b = 'def g(uid):\\n    cursor.execute("SELECT * FROM t WHERE id=" + uid)\\n';
        var a = 'def g(uid):\\n    cursor.execute("SELECT * FROM t WHERE id=%s" % uid)\\n';
        var r = FixVerifier.verifyFix(b, a, "a.py", analyzeCode);
        var pre = "REJECTED_SQL_NOT_PARAMETERIZED";
        return {
          ok: r.accepted === false && String(r.reason).indexOf(pre) === 0,
          expected: "accepted=false reason يبدأ بـ" + pre,
          actual: "accepted=" + r.accepted + " reason=" + String(r.reason).slice(0, 60)
        };
      })()`,
    },
    {
      id: "gate.sql-parameterized-accepted",
      module: "fix_verifier.js",
      title: "البوابة تقبل معالجة SQL صحيحة — ليست رافضةً لكل شيء",
      expr: `(function () {
        var b = 'def g(uid):\\n    cursor.execute("SELECT * FROM t WHERE id=" + uid)\\n';
        var a = 'def g(uid):\\n    cursor.execute("SELECT * FROM t WHERE id=%s", (uid,))\\n';
        var r = FixVerifier.verifyFix(b, a, "a.py", analyzeCode);
        return {
          ok: r.accepted === true && r.syntaxStatus === "verified",
          expected: "accepted=true syntaxStatus=verified",
          actual: "accepted=" + r.accepted + " syntaxStatus=" + r.syntaxStatus + " reason=" + String(r.reason).slice(0, 40)
        };
      })()`,
    },
    {
      id: "gate.php-valid-ok",
      module: "fix_verifier.js",
      title: "فاحص PHP يحكم ok على كود سليم",
      expr: `(function () {
        var v = FixVerifier.syntaxCheck('<?php\\n$a = 1;\\nfunction f($x) { return $x + 1; }\\n', "a.php");
        return {
          ok: v.ok === true && v.available === true && v.language === "php",
          expected: "ok=true available=true language=php",
          actual: "ok=" + v.ok + " available=" + v.available + " language=" + v.language
        };
      })()`,
    },
    {
      id: "gate.php-broken-detected",
      module: "fix_verifier.js",
      title: "فاحص PHP يكشف قوسًا غير مغلق",
      expr: `(function () {
        var v = FixVerifier.syntaxCheck('<?php\\nfunction f($x) { return $x;\\n', "a.php");
        return {
          ok: v.ok === false && v.available === true && /^broken/.test(String(v.reason)),
          expected: "ok=false available=true reason يبدأ بـbroken",
          actual: "ok=" + v.ok + " available=" + v.available + " reason=" + v.reason
        };
      })()`,
    },
    {
      id: "gate.php-heredoc-undecidable",
      module: "fix_verifier.js",
      title: "فاحص PHP لا يحكم على heredoc — fail closed لا تخمين",
      expr: `(function () {
        var v = FixVerifier.syntaxCheck('<?php\\n$s = <<<SQL\\nSELECT 1\\nSQL;\\n', "a.php");
        return {
          ok: v.available === false && v.ok === false,
          expected: "available=false ok=false (لا حكم)",
          actual: "available=" + v.available + " ok=" + v.ok + " reason=" + v.reason
        };
      })()`,
    },
    {
      id: "gate.language-detection",
      module: "fix_verifier.js",
      title: "تحديد اللغة من الامتداد",
      expr: `(function () {
        var got = ["a.php", "a.js", "a.py", "a.ts"].map(function (f) { return FixVerifier.detectLanguage(f); }).join(",");
        var want = "php,javascript,python,typescript";
        return { ok: got === want, expected: want, actual: got };
      })()`,
    },

    // ── learning_engine.js ──────────────────────────────────────
    {
      id: "learning.first-observation-not-approved",
      module: "learning_engine.js",
      title: "ملاحظة واحدة تُسجَّل ولا تُعتمد — عتبة الأدلة قائمة",
      expr: `(function () {
        if (LearningEngine.reset) LearningEngine.reset();
        var ids = LearningEngine.learn("var a = eval(x);", "var a = JSON.parse(x);",
          [{ type: "DANGEROUS_EVAL", line: 1, sev: "h" }], "a.js");
        var s = LearningEngine.getStats();
        return {
          ok: (ids || []).length === 1 && s.total === 1 && s.approved === 0,
          expected: "ids=1 total=1 approved=0",
          actual: "ids=" + (ids || []).length + " total=" + s.total + " approved=" + s.approved
        };
      })()`,
    },
    {
      id: "learning.evidence-threshold-holds",
      module: "learning_engine.js",
      title: "تحقّق واحد لا يكفي للاعتماد — عتبة الأدلة لم تُخفَّض",
      // مقيس: MIN_VERIFIED=2 ⇒ approved يبقى 0 بعد تحقّق واحد. وخفضها إلى 1
      // أو 0 يجعله 1 ⇒ يسقط هذا المِجسّ. وهذا هو الفرق الذي يحمي من اعتماد
      // نمط بدليل واحد.
      expr: `(function () {
        if (LearningEngine.reset) LearningEngine.reset();
        var ids = LearningEngine.learn("var a = eval(x);", "var a = JSON.parse(x);",
          [{ type: "DANGEROUS_EVAL", line: 1, sev: "h" }], "a.js");
        var id = (ids || [])[0];
        LearningEngine.verify(id, true);
        var s = LearningEngine.getStats();
        return {
          ok: (ids || []).length === 1 && s.approved === 0,
          expected: "ids=1 approved=0 بعد تحقّق واحد",
          actual: "ids=" + (ids || []).length + " approved=" + s.approved
        };
      })()`,
    },
    {
      id: "learning.approves-on-second-evidence",
      module: "learning_engine.js",
      title: "تحقّقان يعتمدان النمط بثقة 0.60 — مسار التعلّم ليس ميتًا",
      // الاتجاه المقابل: رفع العتبة أو كسر حساب الثقة يُسقط هذا المِجسّ، فلا
      // يمرّ «تشديدٌ» يُعطّل التعلّم كله بحجة الأمان.
      expr: `(function () {
        if (LearningEngine.reset) LearningEngine.reset();
        var ids = LearningEngine.learn("var a = eval(x);", "var a = JSON.parse(x);",
          [{ type: "DANGEROUS_EVAL", line: 1, sev: "h" }], "a.js");
        var id = (ids || [])[0];
        LearningEngine.verify(id, true);
        LearningEngine.verify(id, true);
        var s = LearningEngine.getStats();
        var p = (s.patterns || [])[0] || {};
        var conf = parseFloat(p.confidence);
        return {
          ok: s.approved === 1 && p.verified === 2 && conf >= 0.60,
          expected: "approved=1 verified=2 confidence>=0.60",
          actual: "approved=" + s.approved + " verified=" + p.verified + " confidence=" + p.confidence
        };
      })()`,
    },
    {
      id: "learning.unknown-language-refused",
      module: "learning_engine.js",
      title: "applyLearned يرفض لغة غير معروفة",
      expr: `(function () {
        if (LearningEngine.reset) LearningEngine.reset();
        var r = LearningEngine.applyLearned("var a = eval(x);", "a.zzz");
        return {
          ok: r.applied === 0 && (r.uses || []).length === 0,
          expected: "applied=0 uses=0",
          actual: "applied=" + r.applied + " uses=" + (r.uses || []).length
        };
      })()`,
    },

    // ── analyzer.js ─────────────────────────────────────────────
    {
      id: "analyzer.sql-concat-detected",
      module: "analyzer.js",
      title: "المحلل يكشف SQL Injection بلصق النصوص بشدة critical",
      expr: `(function () {
        var r = analyzeCode('app.get("/u", (q, s) => { db.query("SELECT * FROM u WHERE id=" + q.query.id); });', "a.js") || [];
        var hit = r.filter(function (i) { return String(i.title).indexOf("SQL Injection") >= 0 && i.sev === "c"; });
        return {
          ok: hit.length >= 1,
          expected: "بلاغ SQL Injection واحد على الأقل بشدة c",
          actual: "عدد البلاغات=" + r.length + " منها SQL critical=" + hit.length
        };
      })()`,
    },

    // ── ghost_mode.js ───────────────────────────────────────────
    {
      id: "ghost.structural-check-present",
      module: "ghost_mode.js",
      title: "GhostMode يعرض structuralCheck وverdict",
      expr: `(function () {
        var ok = typeof GhostMode === "object" && GhostMode !== null &&
                 typeof GhostMode.structuralCheck === "function" &&
                 typeof GhostMode.fix === "function";
        return {
          ok: ok,
          expected: "GhostMode.structuralCheck و GhostMode.fix دالتان",
          actual: "structuralCheck=" + typeof (GhostMode || {}).structuralCheck +
                  " fix=" + typeof (GhostMode || {}).fix
        };
      })()`,
    },
  ]);

  // ═════════════════════════════════════════════════════════════════
  // بيئة Node
  // ═════════════════════════════════════════════════════════════════

  let _deps = undefined;
  function nodeDeps() {
    if (_deps !== undefined) return _deps;
    _deps = null;
    if (typeof require === "function") {
      try {
        _deps = {
          fs: require("fs"),
          path: require("path"),
          vm: require("vm"),
          cp: require("child_process"),
        };
      } catch (_) { _deps = null; }
    }
    return _deps;
  }

  function resolvePublicDir(opts) {
    if (opts && opts.publicDir) return opts.publicDir;
    if (typeof __dirname === "string" && __dirname) return __dirname;
    const d = nodeDeps();
    if (d && typeof process !== "undefined" && process.cwd) {
      for (const c of [d.path.join(process.cwd(), "public"),
                       d.path.join(process.cwd(), "vercel-api", "public")]) {
        try { if (d.fs.existsSync(c)) return c; } catch (_) {}
      }
    }
    return null;
  }

  // ═════════════════════════════════════════════════════════════════
  // مصادر الكود: الشجرة الحالية، والمرجع (git HEAD)
  // ═════════════════════════════════════════════════════════════════
  //
  // قابلة للحقن: الاختبار من البداية للنهاية يمرّر مصدرًا فيه خلل مزروع، فيمرّ
  // المسار الحقيقي كله بلا تعديل أي ملف إنتاج. وgit يُنادى بـexecFileSync
  // بمصفوفة وسائط ولا shell — لا تفسير ولا تمرير نصّ.

  function defaultSources(opts) {
    const d = nodeDeps();
    const publicDir = resolvePublicDir(opts);
    if (!d || !publicDir) return null;
    const repoRoot = d.path.resolve(publicDir, "..", "..");

    return {
      kind: "fs+git",
      publicDir,
      repoRoot,
      current(mod) {
        try { return d.fs.readFileSync(d.path.join(publicDir, mod), "utf8"); }
        catch (_) { return null; }
      },
      reference(mod) {
        const rel = d.path.relative(repoRoot, d.path.join(publicDir, mod)).split(d.path.sep).join("/");
        try {
          return d.cp.execFileSync("git", ["show", "HEAD:" + rel],
            { cwd: repoRoot, encoding: "utf8", maxBuffer: 32 * 1024 * 1024, stdio: ["ignore", "pipe", "ignore"] });
        } catch (_) { return null; }
      },
    };
  }

  function resolveSources(opts) {
    if (opts && opts.sources) return opts.sources;
    return defaultSources(opts);
  }

  // ═════════════════════════════════════════════════════════════════
  // بيئة العزل
  // ═════════════════════════════════════════════════════════════════
  //
  // سياق vm جديد في كل تشغيل. الشكل مطابق لسياق api/analyze.js
  // ({console, window:{}, global:{}, F:{}, R:{}}) — بلا module ولا exports،
  // لأن وجودهما يحوّل UMD acorn إلى module.exports فيصير acorn غير معرّف،
  // فتُعطّل GhostMode.syntaxOk نفسها ويرفض learn كل زوج. (مقيس.)
  //
  // والإضافة الوحيدة localStorage في الذاكرة: مخزن التعلّم يحتاجه، ومسار
  // الخادم لا يوفّره. بدونه تقيس مِجسّات التعلّم غياب واجهة متصفح لا سلوك محرك.

  function buildIsolate(sources, overrides, opts) {
    const d = nodeDeps();
    if (!d) return { available: false, reason: "vm/fs غير متاحين — Node فقط" };

    const store = new Map();
    const ctx = d.vm.createContext({
      console: (opts && opts.verbose) ? console : { log() {}, warn() {}, error() {}, info() {} },
      window: {}, global: {}, F: {}, R: {},
      localStorage: {
        getItem(k) { return store.has(k) ? store.get(k) : null; },
        setItem(k, v) { store.set(k, String(v)); },
        removeItem(k) { store.delete(k); },
        clear() { store.clear(); },
      },
    });

    const loadErrors = [];
    const missing = [];
    for (const mod of MODULES) {
      let src = (overrides && Object.prototype.hasOwnProperty.call(overrides, mod))
        ? overrides[mod]
        : sources.current(mod);
      if (typeof src !== "string") { missing.push(mod); continue; }
      try { d.vm.runInContext(src, ctx, { filename: mod }); }
      catch (e) { loadErrors.push({ module: mod, error: String(e && e.message || e) }); }
    }

    // نفس ربط api/analyze.js للـexports التي تمرّ عبر window
    try {
      d.vm.runInContext(
        "if (window.RepairSQL) RepairSQL = window.RepairSQL;" +
        "if (window.SelfHealing) SelfHealing = window.SelfHealing;" +
        "if (window.XSSFixer) XSSFixer = window.XSSFixer;", ctx);
    } catch (_) {}

    return { available: true, ctx, loadErrors, missing, vm: d.vm };
  }

  // ═════════════════════════════════════════════════════════════════
  // تشغيل البطارية في العزل
  // ═════════════════════════════════════════════════════════════════

  function runBattery(opts) {
    opts = opts || {};
    const sources = resolveSources(opts);
    if (!sources) {
      return { available: false, reason: "لا مصدر كود: Node وgit مطلوبان، أو مرّر opts.sources" };
    }

    const iso = buildIsolate(sources, opts.overrides, opts);
    if (!iso.available) return { available: false, reason: iso.reason };

    const only = Array.isArray(opts.only) && opts.only.length ? new Set(opts.only) : null;
    const results = {};

    for (const probe of PROBES) {
      if (only && !only.has(probe.id)) continue;
      let verdict;
      try {
        verdict = JSON.parse(iso.vm.runInContext("JSON.stringify(" + probe.expr + ")", iso.ctx,
          { filename: "probe:" + probe.id, timeout: 10000 }));
      } catch (e) {
        verdict = { ok: false, expected: "تشغيل المِجسّ بلا استثناء",
                    actual: "استثناء: " + String(e && e.message || e), threw: true };
      }
      results[probe.id] = {
        id: probe.id,
        module: probe.module,
        title: probe.title,
        ok: verdict && verdict.ok === true,
        expected: verdict ? verdict.expected : null,
        actual: verdict ? verdict.actual : null,
        threw: !!(verdict && verdict.threw),
      };
    }

    const ids = Object.keys(results);
    return {
      available: true,
      version: VERSION,
      loadErrors: iso.loadErrors,
      missingModules: iso.missing,
      results,
      total: ids.length,
      passed: ids.filter(k => results[k].ok).length,
      failed: ids.filter(k => !results[k].ok).map(k => k),
    };
  }

  // ═════════════════════════════════════════════════════════════════
  // انحراف بيان الصفحة — صنف خلل لا تراه البطارية
  // ═════════════════════════════════════════════════════════════════
  //
  // البطارية تقيس وحدات **الخادم** (قائمة api/analyze.js). وpublic/index.html
  // تُعلن قائمتها بوسوم <script src>، وغياب ملف منها فشلٌ **صامت** في
  // المتصفح: لا استثناء يصل إلى أي مراقب، والصفحة تعمل ناقصةً وتبدو سليمة.
  // وهذا بالضبط الصنف الذي من أجله لا يكفي monitor().
  //
  // اكتشافٌ فقط بقرار: الإصلاح إمّا حذف الوسم أو إضافة الملف، وكلاهما قرار عن
  // النية لا استنتاج آلي. فتُسجَّل الحادثة بدليلها — رقم السطر — ولا يُقترح لها
  // patch: diagnose يُعيد NOT_PROBEABLE، وpropose يُعيد null.

  const MANIFESTS = Object.freeze(["index.html"]);

  function detectManifestDrift(opts) {
    const d = nodeDeps();
    const publicDir = resolvePublicDir(opts);
    if (!d || !publicDir) return { available: false, incidents: [], declared: 0 };

    const incidents = [];
    let declared = 0;

    for (const page of MANIFESTS) {
      let html;
      try { html = d.fs.readFileSync(d.path.join(publicDir, page), "utf8"); }
      catch (_) { continue; }

      const lines = html.replace(/\r\n?/g, "\n").split("\n");
      for (let i = 0; i < lines.length; i++) {
        const m = /<script\s+src="\/([^"]+\.js)"/.exec(lines[i]);
        if (!m) continue;
        declared++;
        const file = m[1];
        let exists = false;
        try { exists = d.fs.existsSync(d.path.join(publicDir, file)); } catch (_) {}
        if (!exists) {
          incidents.push({
            probeId: "manifest." + page + ":" + file,
            module: file,
            title: "سكربت معلن في " + page + " وغير موجود على القرص",
            kind: "MANIFEST_MISSING_SCRIPT",
            evidence: {
              expected: "public/" + file + " موجود",
              actual: "غير موجود — " + page + ":" + (i + 1) + "  ⇒ فشل تحميل صامت في المتصفح",
            },
          });
        }
      }
    }
    return { available: true, incidents, declared };
  }

  // ═════════════════════════════════════════════════════════════════
  // 1) الاكتشاف
  // ═════════════════════════════════════════════════════════════════

  function detect(opts) {
    // opts.battery: نتيجة بطارية محسوبة سابقًا — تُستعمل كما هي بلا إعادة تشغيل
    const battery = (opts && opts.battery) || runBattery(opts);
    if (!battery.available) return { available: false, reason: battery.reason, incidents: [] };

    const incidents = battery.failed.map(id => {
      const r = battery.results[id];
      return {
        probeId: id,
        module: r.module,
        title: r.title,
        kind: r.threw ? "PROBE_THREW" : "CONTRACT_VIOLATION",
        evidence: { expected: r.expected, actual: r.actual },
      };
    });

    // خلل تحميل وحدة أو غيابها عن القرص: خلل داخلي أيضًا، بدليله الخاص
    for (const le of battery.loadErrors) {
      incidents.push({
        probeId: "load." + le.module, module: le.module,
        title: "الوحدة لا تُحمَّل", kind: "MODULE_LOAD_ERROR",
        evidence: { expected: "تحميل بلا استثناء", actual: le.error },
      });
    }
    for (const m of battery.missingModules) {
      incidents.push({
        probeId: "missing." + m, module: m,
        title: "وحدة معلنة وغير موجودة", kind: "MODULE_MISSING",
        evidence: { expected: "ملف موجود في public/", actual: "غير موجود" },
      });
    }

    // انحراف بيان الصفحة — آخرًا كي تتقدّم حوادث البطارية القابلة للإصلاح
    const manifest = (opts && opts.manifest === false)
      ? { available: false, incidents: [], declared: 0 }
      : detectManifestDrift(opts);
    for (const inc of manifest.incidents) incidents.push(inc);

    return {
      available: true, version: VERSION,
      battery: { total: battery.total, passed: battery.passed, failed: battery.failed.length },
      manifest: { checked: manifest.available, declared: manifest.declared,
                  missing: manifest.incidents.length },
      incidents,
    };
  }

  // ═════════════════════════════════════════════════════════════════
  // diff سطري → hunks
  // ═════════════════════════════════════════════════════════════════

  function splitLines(src) {
    return String(src).replace(/\r\n?/g, "\n").split("\n");
  }

  // نهاية السطر الغالبة في المصدر. السبب: splitLines تُسوّي \r\n إلى \n، فلو
  // أُعيد البناء بـ\n دائمًا لصار الـpatch على ملف CRLF إعادةَ كتابةٍ كاملة
  // صامتة — تغييرٌ في كل سطر لا علاقة له بالخلل. كل ملفات public اليوم LF
  // (مقيس)، والحفظ هنا احتياطٌ لئلا يكسرها محرّر على Windows لاحقًا.
  function dominantEol(src) {
    const s = String(src);
    const crlf = (s.match(/\r\n/g) || []).length;
    if (!crlf) return "\n";
    const lf = (s.match(/\n/g) || []).length;
    return crlf * 2 >= lf ? "\r\n" : "\n";
  }

  // a = المرجع، b = الحالي. '-' سطرٌ في المرجع وحده، '+' سطرٌ في الحالي وحده.
  function lcsOps(a, b) {
    const n = a.length, m = b.length;
    const W = m + 1;
    const dp = new Uint32Array((n + 1) * W);
    for (let i = n - 1; i >= 0; i--) {
      for (let j = m - 1; j >= 0; j--) {
        dp[i * W + j] = a[i] === b[j]
          ? dp[(i + 1) * W + (j + 1)] + 1
          : Math.max(dp[(i + 1) * W + j], dp[i * W + (j + 1)]);
      }
    }
    const ops = [];
    let i = 0, j = 0;
    while (i < n && j < m) {
      if (a[i] === b[j]) { ops.push({ t: "=", a: i, b: j }); i++; j++; }
      else if (dp[(i + 1) * W + j] >= dp[i * W + (j + 1)]) { ops.push({ t: "-", a: i }); i++; }
      else { ops.push({ t: "+", b: j }); j++; }
    }
    while (i < n) { ops.push({ t: "-", a: i }); i++; }
    while (j < m) { ops.push({ t: "+", b: j }); j++; }
    return ops;
  }

  function buildHunks(refLines, curLines) {
    // سقف الذاكرة: جدول LCS حجمه (n+1)×(m+1) من Uint32 — أي 4 بايت للخلية.
    // السقف على **الحاصل** لا على طول كل جانب، وإلا فملفان بـ6000 سطر يطلبان
    // 144MB. 4M خلية ≈ 16MB، وأكبر وحدة اليوم 1797 سطرًا (3.2M خلية مع نفسها).
    // وفوق السقف لا نخمّن: hunk واحد للملف كله، فيصير الاقتراح تراجعًا كاملًا
    // بثقة LOW — وهو صادقٌ لا صامت.
    if (refLines.length > MAX_DIFF_LINES || curLines.length > MAX_DIFF_LINES ||
        (refLines.length + 1) * (curLines.length + 1) > MAX_LCS_CELLS) {
      return {
        whole: true,
        ops: null,
        hunks: [{ opStart: 0, opEnd: 0, refStart: 0, refEnd: refLines.length,
                  curStart: 0, curEnd: curLines.length }],
      };
    }
    const ops = lcsOps(refLines, curLines);
    const hunks = [];
    let ai = 0, bi = 0, k = 0;
    while (k < ops.length) {
      if (ops[k].t === "=") { ai++; bi++; k++; continue; }
      const opStart = k, refStart = ai, curStart = bi;
      while (k < ops.length && ops[k].t !== "=") {
        if (ops[k].t === "-") ai++; else bi++;
        k++;
      }
      hunks.push({ opStart, opEnd: k, refStart, refEnd: ai, curStart, curEnd: bi });
    }
    return { whole: false, ops, hunks };
  }

  // يعيد بناء الملف: الـhunks في revertSet تأخذ أسطر المرجع، وغيرها أسطر الحالي.
  function rebuild(diff, revertSet, refLines, curLines, eol) {
    const EOL = eol || "\n";
    if (diff.whole) {
      return revertSet.has(0) ? refLines.join(EOL) : curLines.join(EOL);
    }
    const startAt = new Map();
    diff.hunks.forEach((h, idx) => startAt.set(h.opStart, idx));
    const out = [];
    let k = 0;
    while (k < diff.ops.length) {
      if (startAt.has(k)) {
        const idx = startAt.get(k);
        const h = diff.hunks[idx];
        if (revertSet.has(idx)) {
          for (let x = h.refStart; x < h.refEnd; x++) out.push(refLines[x]);
        } else {
          for (let x = h.curStart; x < h.curEnd; x++) out.push(curLines[x]);
        }
        k = h.opEnd;
        continue;
      }
      out.push(curLines[diff.ops[k].b]);
      k++;
    }
    return out.join(EOL);
  }

  function describeHunk(h, refLines, curLines) {
    const peek = (arr, s, e) => {
      const n = e - s;
      if (n <= 0) return [];
      return arr.slice(s, Math.min(e, s + 3)).map(l => String(l).slice(0, 120));
    };
    return {
      refLines: [h.refStart + 1, h.refEnd],
      curLines: [h.curStart + 1, h.curEnd],
      removed: h.refEnd - h.refStart,
      added: h.curEnd - h.curStart,
      refSample: peek(refLines, h.refStart, h.refEnd),
      curSample: peek(curLines, h.curStart, h.curEnd),
    };
  }

  // ═════════════════════════════════════════════════════════════════
  // 2) تحديد السبب بالأدلة
  // ═════════════════════════════════════════════════════════════════

  function diagnose(incident, opts) {
    opts = opts || {};
    const sources = resolveSources(opts);
    if (!sources) return { cause: "NO_SOURCES", reason: "Node وgit مطلوبان أو opts.sources" };

    const mod = incident.module;
    const probeId = incident.probeId;

    // حوادث لا مِجسّ لها: تُحكَم قبل أي قراءة مصدر، كي يُذكر سببها الصحيح لا
    // «الوحدة غائبة» (وهو صحيح لفظًا ومضلِّل: الغياب هو المشكلة لا سببها).
    if (incident.kind === "MANIFEST_MISSING_SCRIPT") {
      return { cause: "NOT_PROBEABLE", module: mod, kind: incident.kind,
               reason: "سكربت معلن في الصفحة وغير موجود: الإصلاح إمّا حذف الوسم أو إضافة الملف، " +
                       "وكلاهما قرار عن النية لا استنتاج آلي — تُسجَّل بدليلها ولا يُقترح لها إصلاح آلي",
               evidence: incident.evidence };
    }

    const cur = sources.current(mod);
    const ref = sources.reference(mod);

    if (typeof cur !== "string") return { cause: "MODULE_MISSING", module: mod };
    if (typeof ref !== "string") {
      return { cause: "NO_REFERENCE", module: mod,
               reason: "لا نسخة مرجعية للوحدة في git HEAD — لا أساس للمقارنة" };
    }

    const probeOf = id => PROBES.some(p => p.id === id) ? [id] : null;
    const only = probeOf(probeId);
    if (!only) {
      const why = incident.kind === "MANIFEST_MISSING_SCRIPT"
        ? "سكربت معلن وغير موجود: الإصلاح إمّا حذف الوسم أو إضافة الملف، وكلاهما قرار عن النية لا استنتاج آلي"
        : "الحادثة ليست فشل مِجسّ (خلل تحميل أو وحدة غائبة)";
      return { cause: "NOT_PROBEABLE", module: mod,
               reason: why + " — تُسجَّل بدليلها ولا يُقترح لها إصلاح آلي" };
    }

    const runOne = (src) => {
      const o = Object.assign({}, opts, { only, overrides: Object.assign({}, opts.overrides, { [mod]: src }) });
      const b = runBattery(o);
      return b.available && b.results[probeId] ? b.results[probeId].ok : false;
    };

    const failsNow = !runOne(cur);
    const passesAtRef = runOne(ref);

    if (!failsNow) {
      return { cause: "NOT_REPRODUCIBLE", module: mod,
               reason: "المِجسّ ينجح عند إعادة التشغيل منفردًا — لا يُعزى الفشل إلى هذه الوحدة" };
    }
    if (!passesAtRef) {
      return { cause: "PRE_EXISTING", module: mod,
               reason: "المِجسّ يفشل على نسخة المرجع أيضًا — خلل قديم لا تراجع. مكتشَف ومُسجَّل، ولا إصلاح آلي.",
               evidence: incident.evidence };
    }
    if (cur === ref) {
      return { cause: "IDENTICAL_SOURCE", module: mod,
               reason: "الشجرة والمرجع متطابقان نصًّا والنتيجتان مختلفتان — السبب خارج هذه الوحدة" };
    }

    const refLines = splitLines(ref), curLines = splitLines(cur);
    const eol  = dominantEol(cur);
    const diff = buildHunks(refLines, curLines);

    // أصغر مجموعة تراجع تُعيد المِجسّ إلى النجاح: الأفراد، ثم الأزواج، ثم الكل.
    const trials = [];
    for (let i = 0; i < diff.hunks.length; i++) trials.push([i]);
    let pairs = 0;
    for (let i = 0; i < diff.hunks.length && pairs < MAX_PAIR_TRIALS; i++) {
      for (let j = i + 1; j < diff.hunks.length && pairs < MAX_PAIR_TRIALS; j++) {
        trials.push([i, j]); pairs++;
      }
    }
    if (diff.hunks.length > 2) trials.push(diff.hunks.map((_, i) => i));

    let found = null, attempts = 0;
    for (const subset of trials) {
      attempts++;
      const candidate = rebuild(diff, new Set(subset), refLines, curLines, eol);
      if (candidate === cur) continue;
      if (runOne(candidate)) { found = subset; break; }
    }

    if (!found) {
      return {
        cause: "CAUSE_NOT_IN_DELTA", module: mod, attempts,
        hunkCount: diff.hunks.length,
        reason: "لا تراجع عن أي hunk (ولا عنها كلها) يُعيد المِجسّ إلى النجاح — السبب ليس في فرق هذه الوحدة وحدها",
      };
    }

    return {
      cause: "HUNK_REGRESSION",
      module: mod,
      probeId,
      attempts,
      hunkCount: diff.hunks.length,
      revertSet: found,
      confidence: found.length === 1 ? "HIGH" : (found.length === diff.hunks.length ? "LOW" : "MEDIUM"),
      hunks: found.map(i => describeHunk(diff.hunks[i], refLines, curLines)),
      evidence: incident.evidence,
      _diff: diff, _refLines: refLines, _curLines: curLines, _current: cur, _eol: eol,
    };
  }

  // ═════════════════════════════════════════════════════════════════
  // 3) اقتراح الإصلاح
  // ═════════════════════════════════════════════════════════════════

  function propose(diagnosis) {
    if (!diagnosis || diagnosis.cause !== "HUNK_REGRESSION") return null;
    const patched = rebuild(diagnosis._diff, new Set(diagnosis.revertSet),
                            diagnosis._refLines, diagnosis._curLines, diagnosis._eol);
    if (patched === diagnosis._current) return null;
    return {
      module: diagnosis.module,
      originalCode: diagnosis._current,
      patchedCode: patched,
      confidence: diagnosis.confidence,
      reason: "تراجع عن " + diagnosis.revertSet.length + " من " + diagnosis.hunkCount +
              " hunk في " + diagnosis.module + " — مصدر الإصلاح git HEAD لا مولّد كود",
      revertSet: diagnosis.revertSet,
      hunks: diagnosis.hunks,
    };
  }

  // ═════════════════════════════════════════════════════════════════
  // 4+5) اختبار معزول + التحقق من عدم تراجع بقية القدرات
  // ═════════════════════════════════════════════════════════════════
  //
  // يُعيد **نفس شكل** Tests.runAll في self_healing_engine.js كي يعمل
  // Tests.allPassed بلا أي تعديل عليه:
  //   syntax     — الـcandidate يُحلَّل
  //   engines    — المِجسّ المستهدف صار ناجحًا
  //   regression — لا مِجسّ كان ناجحًا سقط
  //   security   — Tests.security نفسه، مقارنةً نسبية
  //   taint      — لا تنطبق على مصدر محرك ⇒ skipped

  function makeTestRunner(targetProbeId, baseline, opts) {
    const d = nodeDeps();
    const SH = resolveSelfHealing(opts);

    return function (originalCode, patchedCode, fileName /*, targetIssues */) {
      const mod = fileName;

      // syntax: هل يُحلَّل مصدر الوحدة؟
      let syntax;
      try {
        if (d) { new d.vm.Script(patchedCode, { filename: mod }); }
        else { /* بلا vm: لا حكم */ }
        syntax = { pass: true };
      } catch (e) {
        syntax = { pass: false, error: String(e && e.message || e) };
      }

      if (!syntax.pass) {
        return {
          syntax,
          engines: { candidate: { pass: false, error: "لم يُحلَّل — لم تُشغَّل البطارية" } },
          taint: { pass: true, skipped: true, reason: "لا تنطبق على مصدر محرك" },
          regression: { pass: false, regressionMsg: "مصدر الـcandidate لا يُحلَّل" },
          security: { pass: false, vulnerabilities: [], newVulnerabilities: [], preExisting: [] },
        };
      }

      // البطارية كاملة في سياق معزول جديد، بالـcandidate بدل الوحدة
      const after = runBattery(Object.assign({}, opts, {
        overrides: Object.assign({}, opts && opts.overrides, { [mod]: patchedCode }),
      }));

      if (!after.available) {
        return {
          syntax,
          engines: { candidate: { pass: false, error: after.reason } },
          taint: { pass: true, skipped: true, reason: "لا تنطبق على مصدر محرك" },
          regression: { pass: false, regressionMsg: "تعذّر تشغيل البطارية: " + after.reason },
          security: { pass: false, vulnerabilities: [], newVulnerabilities: [], preExisting: [] },
        };
      }

      const targetFixed = !!(after.results[targetProbeId] && after.results[targetProbeId].ok);

      // تراجع = مِجسّ كان ناجحًا في خط الأساس وصار فاشلًا
      const regressed = [];
      const recovered = [];
      for (const id of Object.keys(after.results)) {
        const was = !!(baseline && baseline.results[id] && baseline.results[id].ok);
        const now = after.results[id].ok;
        if (was && !now) regressed.push({ id, module: after.results[id].module, actual: after.results[id].actual });
        if (!was && now && id !== targetProbeId) recovered.push(id);
      }

      // خلل تحميل جديد ظهر بسبب الـcandidate
      const baseLoad = new Set((baseline && baseline.loadErrors || []).map(e => e.module));
      const newLoadErrors = after.loadErrors.filter(e => !baseLoad.has(e.module));

      const regression = {
        pass: regressed.length === 0 && newLoadErrors.length === 0,
        probesTotal: after.total,
        probesPassedBefore: baseline ? baseline.passed : null,
        probesPassedAfter: after.passed,
        regressed,
        recovered,
        newLoadErrors,
        regressionMsg: (regressed.length || newLoadErrors.length)
          ? [regressed.length ? regressed.length + " مِجسّ كان ناجحًا وسقط" : null,
             newLoadErrors.length ? newLoadErrors.length + " وحدة لم تُحمَّل" : null]
            .filter(Boolean).join(" — ")
          : null,
      };

      const security = (SH && SH.Tests && typeof SH.Tests.security === "function")
        ? SH.Tests.security(patchedCode, originalCode)
        : { pass: true, skipped: true, reason: "Tests.security غير متاح" };

      return {
        syntax,
        engines: {
          targetProbe: {
            pass: targetFixed, id: targetProbeId,
            actual: after.results[targetProbeId] ? after.results[targetProbeId].actual : null,
          },
        },
        taint: { pass: true, skipped: true, reason: "لا تنطبق على مصدر محرك" },
        regression,
        security,
      };
    };
  }

  // ═════════════════════════════════════════════════════════════════
  // 6) الدورة كاملة — عبر SelfHealing نفسه
  // ═════════════════════════════════════════════════════════════════

  let _shCache = undefined;
  function resolveSelfHealing(opts) {
    if (opts && opts.selfHealing) return opts.selfHealing;
    if (_shCache !== undefined) return _shCache;
    _shCache = null;
    // require أولًا: هو وحده يُعطي Tests وSelfHealing من **نفس** الوحدة.
    if (typeof require === "function") {
      try {
        const m = require("./self_healing_engine.js");
        if (m && m.SelfHealing) { _shCache = { SelfHealing: m.SelfHealing, Tests: m.Tests || null }; return _shCache; }
      } catch (_) {}
    }
    // مسار الخادم: self_healing_engine.js مُحمَّل في السياق، فـSelfHealing عالمي
    // لكن Tests ليس مكشوفًا هناك — نُصرّح بذلك بـnull لا بتخمين.
    const g = (typeof globalThis !== "undefined" && globalThis) || null;
    const sh = (typeof SelfHealing !== "undefined" && SelfHealing) ||
               (g && g.SelfHealing) || (g && g.window && g.window.SelfHealing) || null;
    if (sh) _shCache = { SelfHealing: sh, Tests: null };
    return _shCache;
  }

  /**
   * الدورة: اكتشاف ← تشخيص ← اقتراح ← اختبار معزول ← عدم تراجع ← PENDING_REVIEW
   *
   * لا يكتب أي ملف. ولا يطبّق أي شيء: الحالة النهائية PENDING_REVIEW دائمًا عند
   * النجاح، وROLLED_BACK عند فشل الاختبارات. التطبيق لاحقًا بيد الإنسان عبر
   * SelfHealing.approve(id, patchedCode, applyCallback).
   */
  function runCycle(opts) {
    opts = opts || {};
    const sh = resolveSelfHealing(opts);
    if (!sh || !sh.SelfHealing) {
      return { available: false, reason: "SelfHealing غير متاح — لا سجل ولا حالة" };
    }
    const SelfHeal = sh.SelfHealing;
    if (typeof SelfHeal.registerPatchProvider !== "function") {
      return { available: false,
               reason: "self_healing_engine.js بلا registerPatchProvider — النسخة قديمة" };
    }

    const sources = resolveSources(opts);
    if (!sources) return { available: false, reason: "لا مصدر كود: Node وgit مطلوبان، أو opts.sources" };

    const baseline = runBattery(opts);
    if (!baseline.available) return { available: false, reason: baseline.reason };

    // نفس البطارية تُغذّي الاكتشاف — لا تشغيل ثانٍ
    const found = detect(Object.assign({}, opts, { battery: baseline }));
    const incidents = found.incidents || [];

    const out = {
      available: true, version: VERSION,
      battery: { total: baseline.total, passed: baseline.passed, failed: baseline.failed.length },
      manifest: found.manifest || null,
      incidents: incidents.length,
      cycles: [],
    };

    const limit = Number.isFinite(opts.maxIncidents) ? opts.maxIncidents : 5;

    for (const incident of incidents.slice(0, limit)) {
      const diagnosis = diagnose(incident, opts);
      const proposal = propose(diagnosis);

      // مزوّد الـpatch: SelfHealing.heal يسأل المزوّدين قبل RepairSQL/XSSFixer.
      // نُسجّل مزوّدًا يخصّ هذه الحادثة وحدها، ويتعرّف عليها بالـmodule والنصّ.
      const token = "ESD_" + incident.probeId;
      const provider = (code, problem) => {
        if (!proposal) return null;
        if (!problem || problem.__esdToken !== token) return null;
        if (code !== proposal.originalCode) return null;
        return {
          patchedCode: proposal.patchedCode,
          confidence: proposal.confidence,
          reason: proposal.reason,
          changedCount: proposal.revertSet.length,
        };
      };
      SelfHeal.registerPatchProvider(provider);

      // finally لا سطرٌ بعد النداء: استثناء من heal كان يُبقي المزوّد مُسجَّلًا،
      // فيَرى حوادثَ لاحقة لا تخصّه (يرفضها بالـtoken، لكن التسرّب يتراكم).
      let healed;
      try {
        healed = SelfHeal.heal({
          type: "ENGINE_SELF_DEFECT",
          engine: incident.module,
          fileName: incident.module,
          code: (proposal && proposal.originalCode) || sources.current(incident.module) || "",
          detail: incident.title + " — " + (incident.evidence && incident.evidence.actual),
          targetIssues: [],
          __esdToken: token,
          testRunner: makeTestRunner(incident.probeId, baseline, opts),
        });
      } finally {
        if (typeof SelfHeal.unregisterPatchProvider === "function") {
          SelfHeal.unregisterPatchProvider(provider);
        }
      }

      out.cycles.push({
        probeId: incident.probeId,
        module: incident.module,
        kind: incident.kind,
        evidence: incident.evidence,
        cause: diagnosis && diagnosis.cause,
        causeReason: diagnosis && diagnosis.reason,
        revertSet: diagnosis && diagnosis.revertSet,
        hunks: diagnosis && diagnosis.hunks,
        confidence: diagnosis && diagnosis.confidence,
        healingId: healed && healed.id,
        status: healed && healed.status,
        result: healed && healed.result,
        testResults: healed && healed.testResults,
        // الـpatch للمراجعة البشرية — لا يُطبَّق هنا
        patchedCode: healed && healed.patchedCode,
      });
    }

    return out;
  }

  // ═════════════════════════════════════════════════════════════════
  // الواجهة
  // ═════════════════════════════════════════════════════════════════

  return {
    VERSION,
    MODULES,
    MANIFESTS,
    PROBES,
    // مراحل مفردة — كل واحدة قابلة للاستدعاء والقياس وحدها
    runBattery,
    detectManifestDrift,
    detect,
    diagnose,
    propose,
    makeTestRunner,
    // الدورة كاملة
    runCycle,
    // أدوات معروضة للاختبار والمراجعة
    _internals: { splitLines, dominantEol, lcsOps, buildHunks, rebuild, describeHunk,
                  buildIsolate, defaultSources, MAX_LCS_CELLS },
  };
})();

if (typeof globalThis !== "undefined" && typeof globalThis.window !== "undefined" && globalThis.window) {
  globalThis.window.EngineSelfDiagnosis = EngineSelfDiagnosis;
}
if (typeof module !== "undefined" && module.exports) module.exports = EngineSelfDiagnosis;
