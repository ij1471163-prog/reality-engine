package com.naif.realityengine;

import android.content.Context;
import android.util.Log;

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.regex.Pattern;

/**
 * SelfRepairEngine
 * -----------------
 * ⚠️ اسم الملف يوحي بأكثر من قدرته الفعلية، لذا هذا التوضيح إلزامي:
 *
 * هذا المحرك لا "يصلح" ملف المصدر الحقيقي. BackupManager (يُعاد استخدامه هنا
 * كما هو دون تعديل) يكتب فقط إلى تخزين نسخ احتياطي/staging خاص بالتطبيق
 * (originalFile/currentFile/beforeFile/afterFile داخل مجلد الجلسة)، وليس إلى
 * android/app/src/main/java/com/naif/realityengine/<file>.java الفعلي.
 * لا يوجد أي مسار في هذا الملف يكتب إلى ملف المصدر الحقيقي على القرص.
 *
 * "CANDIDATE_ACCEPTED" يعني حصرًا: مرشّح تحقق ثابتًا/أمنيًا بنجاح وتم قبوله
 * *داخل جلسة backup/staging فقط*. لا يعني أن مشروعك الفعلي تغيّر، ولا يعني
 * أن المشروع تم بناؤه (compile) بنجاح.
 *
 * القدرة الحقيقية لهذا الملف:
 *   Detect -> Diagnose -> Assess Confidence -> Plan -> Safety Check
 *   -> Stage Backup Session -> Generate Patch -> Static+Security Validate
 *   -> Accept-as-Candidate (داخل الجلسة فقط) / Rollback -> Learn (محلي)
 *
 * حدود مقصودة (Capability Boundaries):
 *  - لا Runtime.exec / ProcessBuilder / shell execution.
 *  - لا رفع كود مصدري لأي API خارجي.
 *  - لا يوجد build validator حقيقي؛ الحالة الوحيدة الممكنة هي UNAVAILABLE،
 *    ولا تدخل هذه النتيجة في قرار القبول/الرفض إطلاقًا (لا تُستخدم كإثبات نجاح
 *    ولا كسبب رفض - هي معلومة سياقية إلزامية الظهور فقط).
 *  - CodeValidator.validate يُستدعى بدون قائمة parameters حقيقية لأن
 *    EngineAnalyzer.FunctionAnalysis لا يوفرها؛ لذلك أي نتيجة منه تُعتبر
 *    تحققًا جزئيًا (PARTIAL) وليس تحققًا كاملًا من صحة توقيع الدالة.
 *  - ربط Bug↔Function: FunctionAnalysis لا يوفر startLine/endLine حقيقيين،
 *    فلا يوجد أي أساس موثوق لإثبات أن bug معيّن "داخل" دالة معيّنة.
 *    لذلك هذا الإصدار **لا يطبّق أي ربط تخميني بالقرب من السطر إطلاقًا** -
 *    المسار العملي الوحيد المتاح حاليًا يرفض دائمًا بـ UNSUPPORTED_OPERATION
 *    مع توضيح السبب، إلى أن تتوفر حدود دالة حقيقية من EngineAnalyzer (تعديل
 *    من هذا النوع خارج نطاق هذا الملف تمامًا ولم يُجرَ).
 *  - allowlist صارم ومتعمد: يسمح فقط بملفات .java مباشرة داخل
 *    com/naif/realityengine (وليس أي مجلد فرعي)، ويرفض أي مسار يحتوي
 *    path traversal ("..").
 */
public final class SelfRepairEngine {

    private static final String TAG = "SelfRepairEngine";

    // ============================================================
    // Limits
    // ============================================================
    public static final int MAX_REPAIR_ATTEMPTS_PER_RUN = 5;
    public static final int MAX_STAGED_FILES_PER_RUN     = 3;
    public static final int MAX_PATCH_SIZE_CHARS         = 4000;
    public static final double CONFIDENCE_THRESHOLD      = 0.65;

    // Denylist مطلق - يمنع أي تعديل بغض النظر عن السياق
    private static final List<Pattern> DENYLIST = Collections.unmodifiableList(Arrays_asList(
            Pattern.compile(".*/\\.git/.*"),
            Pattern.compile("(?i).*\\.(keystore|jks)$"),
            Pattern.compile("(?i).*(secret|credential|password|api[_-]?key)s?.*"),
            Pattern.compile("(?i).*\\.github/workflows/.*"),
            Pattern.compile("(?i).*AndroidManifest\\.xml$"),
            Pattern.compile("(?i).*build\\.gradle(\\.kts)?$"),
            Pattern.compile("(?i).*gradle\\.properties$"),
            Pattern.compile("(?i).*local\\.properties$"),
            Pattern.compile("(?i).*settings\\.gradle(\\.kts)?$")
    ));

    /**
     * allowlist متعمدة: فقط ملفات .java مباشرة داخل حزمة
     * com/naif/realityengine (بدون أي مجلد فرعي إضافي بعد اسم الحزمة).
     * هذا قيد مقصود وليس سهوًا: توسيعه لاحقًا قرار صريح منفصل خارج هذا الملف.
     */
    private static final Pattern ALLOWLIST_ROOT =
            Pattern.compile(".*android/app/src/main/java/com/naif/realityengine/[^/]+\\.java$");

    @SafeVarargs
    private static <T> List<T> Arrays_asList(T... items) {
        List<T> l = new ArrayList<>();
        Collections.addAll(l, items);
        return l;
    }

    // ============================================================
    // Status vocabulary — each name is deliberately literal about
    // what actually happened, nothing more.
    // ============================================================
    public enum RepairStatus {
        NO_ISSUES_FOUND,
        DIAGNOSED,                      // "أعتقد أنني وجدت المشكلة"
        PLAN_READY,                     // خطة موجودة، لم يُنشأ كود بعد
        PATCH_GENERATED,                // تم إنتاج نص الكود البديل في الذاكرة فقط
        PATCH_STAGED,                   // تم تسجيله داخل BackupManager session (ليس الملف الحقيقي)
        STATIC_VALIDATION_PASSED,       // CodeValidator (جزئي) + AISecurityGuard مرّا بدون أخطاء/حجب
        BUILD_VALIDATION_UNAVAILABLE,   // قدرة غير متاحة إطلاقًا في هذه البيئة - معلومة سياقية دائمة الظهور
        STATIC_REPAIR_VERIFIED,         // static+security فقط. لا تعني بناء ناجح ولا كتابة ملف حقيقي
        CANDIDATE_ACCEPTED,             // مقبول كمرشّح نهائي *داخل جلسة backup فقط*. المصدر الحقيقي لم يتغيّر.
        LOW_CONFIDENCE,
        UNSUPPORTED_OPERATION,
        DO_NOT_TOUCH,
        ROLLED_BACK,                    // استعادة داخل الجلسة (backup) بعد فشل تحقق
        REPAIR_LIMIT_REACHED
    }

    public enum RepairClassification {
        AUTO_REPAIR_SAFE, AUTO_REPAIR_REVIEW, UNSUPPORTED,
        REQUIRES_EXTERNAL_BUILD, DO_NOT_TOUCH
    }

    // ============================================================
    // Repair Plan
    // ============================================================
    public static final class RepairPlan {
        public final String targetFile;
        public final String functionName;
        public final int approxLine;
        public final String detectedIssue;
        public final String reason;
        public final String proposedChange;
        public final EngineAnalyzer.Fixability confidence;
        public final String risk;
        public final RepairClassification classification;
        public final String expectedResult;

        public RepairPlan(String targetFile, String functionName, int approxLine,
                           String detectedIssue, String reason, String proposedChange,
                           EngineAnalyzer.Fixability confidence, String risk,
                           RepairClassification classification, String expectedResult) {
            this.targetFile = targetFile;
            this.functionName = functionName;
            this.approxLine = approxLine;
            this.detectedIssue = detectedIssue;
            this.reason = reason;
            this.proposedChange = proposedChange;
            this.confidence = confidence;
            this.risk = risk;
            this.classification = classification;
            this.expectedResult = expectedResult;
        }
    }

    public static final class RepairAttempt {
        public final RepairPlan plan;
        public RepairStatus status;
        public String message;
        public String sessionId;
        public CodeValidator.ValidationResult validation;
        public AISecurityGuard.GuardReport guardReport;
        public String diff;
        /** true دائمًا حاليًا: FunctionAnalysis لا يوفر قائمة parameters حقيقية،
         *  لذلك أي نتيجة CodeValidator هنا جزئية وليست تحققًا كاملًا من توقيع الدالة. */
        public boolean validationParamsUnknown = false;
        /** true إذا كانت هذه النتيجة النهائية تمثل مرشّحًا داخل backup session فقط،
         *  وليس تعديلًا على المصدر الحقيقي. */
        public boolean isBackupSessionCandidateOnly = false;

        RepairAttempt(RepairPlan plan) { this.plan = plan; }
    }

    public static final class RunSummary {
        public final String fileName;
        public final List<RepairAttempt> attempts = new ArrayList<>();
        public boolean limitReached = false;
        public String limitReason = null;
        /** 0 أو 1 لهذا الملف: هل تم قبول أي مرشّح تعديل داخل جلسة backup لهذا الملف.
         *  هذا عدد الملفات، وليس عدد الدوال التي عولجت. */
        public int stagedFileCount = 0;

        RunSummary(String fileName) { this.fileName = fileName; }
    }

    // ============================================================
    // Build validation — intentionally unimplementable boundary
    // ============================================================
    public enum BuildValidationOutcome { UNAVAILABLE }

    public interface BuildValidator {
        BuildValidationOutcome validate(String fileName, String candidateCode);
    }

    /**
     * التطبيق الوحيد المتاح: يُعلن بصراحة أن القدرة غير متوفرة.
     * لا يوجد أي تطبيق آخر داخل هذا الملف يشغّل Gradle أو ينفّذ عملية بناء
     * حقيقية. النتيجة UNAVAILABLE لا تُستخدم أبدًا كدليل نجاح أو فشل.
     */
    public static final class UnavailableBuildValidator implements BuildValidator {
        @Override
        public BuildValidationOutcome validate(String fileName, String candidateCode) {
            return BuildValidationOutcome.UNAVAILABLE;
        }
    }

    // ============================================================
    // Local-first learning log
    // ============================================================
    public static final class RepairLogEntry {
        public final long timestamp;
        public final String fileName, functionName, issue, repairType;
        public final EngineAnalyzer.Fixability confidence;
        public final RepairStatus outcome;
        public final String failureReason;

        RepairLogEntry(String fileName, String functionName, String issue, String repairType,
                       EngineAnalyzer.Fixability confidence, RepairStatus outcome, String failureReason) {
            this.timestamp = System.currentTimeMillis();
            this.fileName = fileName; this.functionName = functionName;
            this.issue = issue; this.repairType = repairType;
            this.confidence = confidence; this.outcome = outcome; this.failureReason = failureReason;
        }
    }

    // ============================================================
    // Instance
    // ============================================================
    private final Context context;
    private final BackupManager backupManager;
    private final BuildValidator buildValidator;
    private final List<RepairLogEntry> localLog = new ArrayList<>();

    public SelfRepairEngine(Context context) {
        this(context, new BackupManager(context), new UnavailableBuildValidator());
    }

    public SelfRepairEngine(Context context, BackupManager backupManager, BuildValidator buildValidator) {
        this.context = context;
        this.backupManager = backupManager;
        this.buildValidator = buildValidator;
    }

    public List<RepairLogEntry> getLocalLog() {
        return Collections.unmodifiableList(localLog);
    }

    // ============================================================
    // Entry point
    // ============================================================
    public RunSummary repairFile(String fileName, String fullCode) {
        RunSummary summary = new RunSummary(fileName);

        if (!isInScope(fileName)) {
            summary.attempts.add(terminal(null, RepairStatus.DO_NOT_TOUCH,
                    "الملف خارج allowlist، ضمن denylist، أو يحتوي path traversal: " + fileName));
            log(fileName, null, "scope-check", "none", null, RepairStatus.DO_NOT_TOUCH, "scope");
            return summary;
        }
        if (fullCode == null || fullCode.isBlank()) {
            summary.attempts.add(terminal(null, RepairStatus.UNSUPPORTED_OPERATION, "محتوى الملف فارغ."));
            return summary;
        }

        EngineAnalyzer.EngineReport report;
        try {
            report = EngineAnalyzer.analyze(fullCode, fileName);
        } catch (Exception e) {
            summary.attempts.add(terminal(null, RepairStatus.UNSUPPORTED_OPERATION,
                    "فشل EngineAnalyzer.analyze: " + e.getMessage()));
            return summary;
        }
        if (report == null || report.stubs.isEmpty()) {
            summary.attempts.add(terminal(null, RepairStatus.NO_ISSUES_FOUND,
                    "لم يجد EngineAnalyzer أي دوال قابلة للفحص."));
            return summary;
        }

        boolean anyCandidateAccepted = false;

        for (EngineAnalyzer.FunctionAnalysis fn : report.stubs) {
            if (summary.attempts.size() >= MAX_REPAIR_ATTEMPTS_PER_RUN) {
                summary.limitReached = true;
                summary.limitReason = "بلغ عدد المحاولات الحد الأقصى " + MAX_REPAIR_ATTEMPTS_PER_RUN;
                summary.attempts.add(terminal(null, RepairStatus.REPAIR_LIMIT_REACHED, summary.limitReason));
                break;
            }
            RepairAttempt attempt = handleFunction(fileName, fullCode, fn);
            summary.attempts.add(attempt);
            if (attempt.status == RepairStatus.CANDIDATE_ACCEPTED) {
                anyCandidateAccepted = true;
            }
        }

        // stagedFileCount يمثّل عدد الملفات (0 أو 1 هنا لأن repairFile يعالج ملفًا واحدًا)
        // التي لديها مرشّح تعديل مقبول داخل جلسة backup — وليس عدد الدوال.
        summary.stagedFileCount = anyCandidateAccepted ? 1 : 0;
        if (summary.stagedFileCount > MAX_STAGED_FILES_PER_RUN) {
            // غير ممكن فعليًا هنا (حد أقصى ملف واحد لكل استدعاء)، محتفظ به كحارس دفاعي فقط.
            summary.limitReached = true;
            summary.limitReason = "REPAIR_LIMIT_REACHED: تجاوز عدد الملفات المسموح";
        }
        return summary;
    }

    // ============================================================
    // Per-function pipeline
    // ============================================================
    private RepairAttempt handleFunction(String fileName, String fullCode,
                                          EngineAnalyzer.FunctionAnalysis fn) {

        RepairClassification classification = classify(fn);
        String detectedIssue = fn.intent != null ? fn.intent : "غير محدد";
        String reason = fn.fixReason != null ? fn.fixReason : "لا يوجد سبب مسجل من EngineAnalyzer";

        RepairPlan plan = new RepairPlan(
                fileName, fn.name, fn.line, detectedIssue, reason,
                "توليد مرشّح داخل backup session فقط - لا كتابة على المصدر الحقيقي",
                fn.fixability, fn.risk, classification,
                "دالة خالية من الأنماط المكتشفة حاليًا مع الحفاظ على سلوكها"
        );
        RepairAttempt attempt = new RepairAttempt(plan);
        attempt.status = RepairStatus.DIAGNOSED;

        // ---- Section 7: تصنيف متوازن، DO_NOT_TOUCH فقط للحالات الحساسة فعلًا ----
        if (classification == RepairClassification.DO_NOT_TOUCH) {
            return finish(attempt, fileName, fn, detectedIssue, "none",
                    RepairStatus.DO_NOT_TOUCH, "تصنيف DO_NOT_TOUCH (خطورة HIGH/CRITICAL مُعلنة): " + reason);
        }
        if (classification == RepairClassification.REQUIRES_EXTERNAL_BUILD) {
            return finish(attempt, fileName, fn, detectedIssue, "none",
                    RepairStatus.UNSUPPORTED_OPERATION, "يتطلب تحقق بناء فعلي (Gradle) غير متاح هنا.");
        }
        if (classification == RepairClassification.UNSUPPORTED) {
            return finish(attempt, fileName, fn, detectedIssue, "none",
                    RepairStatus.UNSUPPORTED_OPERATION, "لا مسار إصلاح تلقائي موثوق لهذه الحالة.");
        }

        double confidenceScore = confidenceToScore(fn.fixability);
        if (confidenceScore < CONFIDENCE_THRESHOLD) {
            return finish(attempt, fileName, fn, detectedIssue, "none",
                    RepairStatus.LOW_CONFIDENCE,
                    "الثقة (" + fn.fixability + ") أقل من العتبة " + CONFIDENCE_THRESHOLD + ".");
        }
        if (classification == RepairClassification.AUTO_REPAIR_REVIEW) {
            attempt.status = RepairStatus.PLAN_READY;
            return finish(attempt, fileName, fn, detectedIssue, "none",
                    RepairStatus.PLAN_READY, "يتطلب مراجعة بشرية قبل أي توليد فعلي للكود (AUTO_REPAIR_REVIEW).");
        }

        // ---- Section 3: ربط Bug↔Function ----
        // FunctionAnalysis لا يوفر startLine/endLine حقيقيين لهذه الدالة، لذلك لا
        // يوجد أساس موثوق لإثبات أن أي Bug مكتشف "داخل" حدود هذه الدالة تحديدًا.
        // القرب من رقم السطر وحده ليس دليلاً كافيًا (قد يكون Bug في دالة مجاورة).
        // لذلك: نرفض التخمين صراحةً بدل تطبيق إصلاح قد يستهدف الدالة الخاطئة.
        // (المسار applyPatchPipeline أدناه يوضّح ماذا سيحدث لو توفر ربط موثوق
        // مستقبلاً، لكنه غير مستدعى من هنا في هذا الإصدار.)
        return finish(attempt, fileName, fn, detectedIssue, "none",
                RepairStatus.UNSUPPORTED_OPERATION,
                "لا تتوفر حدود دالة حقيقية (startLine/endLine) من EngineAnalyzer لإثبات ارتباط "
                        + "أي Bug مكتشف بهذه الدالة تحديدًا. تم رفض أي ربط قائم على قرب السطر "
                        + "لتفادي تطبيق إصلاح على دالة خاطئة. هذا حد قدرة حالي، وليس فشلًا عرضيًا.");
    }

    // ============================================================
    // Reserved pipeline (currently unreachable من handleFunction أعلاه):
    // يبقى هذا الجزء موثّقًا ليوضح ماذا سيحدث *إذا* توفر مستقبلاً ربط
    // Bug↔Function موثوق (مثلاً حدود دالة حقيقية من EngineAnalyzer، بتعديل
    // في ملف آخر لا علاقة له بهذا الملف). لا يُستدعى حاليًا.
    // ============================================================
    @SuppressWarnings("unused")
    private RepairAttempt applyPatchPipeline(String fileName, String fullCode,
                                              EngineAnalyzer.FunctionAnalysis fn,
                                              RepairAttempt attempt, String reason,
                                              String detectedIssue, BugDetector.Bug verifiedBug) {

        String patchedCode;
        String repairType;
        try {
            BugDetector.BugReport singleBug = new BugDetector.BugReport();
            singleBug.language = "unknown";
            singleBug.bugs.add(verifiedBug);
            patchedCode = BugDetector.autoFix(fullCode, singleBug);
            repairType = "BugDetector.autoFix";
        } catch (Exception e) {
            return finish(attempt, fileName, fn, detectedIssue, "none",
                    RepairStatus.UNSUPPORTED_OPERATION, "فشل توليد الإصلاح: " + e.getMessage());
        }

        if (patchedCode == null || patchedCode.equals(fullCode)) {
            return finish(attempt, fileName, fn, detectedIssue, repairType,
                    RepairStatus.NO_ISSUES_FOUND, "لم ينتج تغيير فعلي.");
        }
        attempt.status = RepairStatus.PATCH_GENERATED;

        int patchSize = Math.abs(patchedCode.length() - fullCode.length());
        if (patchSize > MAX_PATCH_SIZE_CHARS) {
            return finish(attempt, fileName, fn, detectedIssue, repairType,
                    RepairStatus.REPAIR_LIMIT_REACHED,
                    "حجم التغيير (~" + patchSize + " حرف) يتجاوز الحد " + MAX_PATCH_SIZE_CHARS + ".");
        }

        // ---- Staging عبر BackupManager فقط - Section 6: هذا ليس تعديلاً للمصدر الحقيقي ----
        BackupManager.Session session = backupManager.createSession(fileName, fullCode);
        if (session == null) {
            return finish(attempt, fileName, fn, detectedIssue, repairType,
                    RepairStatus.UNSUPPORTED_OPERATION, "تعذّر إنشاء جلسة backup - لن يُنشأ أي مرشّح.");
        }
        attempt.sessionId = session.sessionId;

        boolean recorded = backupManager.recordVersion(
                session.sessionId, fn.name, "self-repair-candidate:" + repairType,
                fullCode, patchedCode, /*approved*/ false, /*safetyScore*/ 0);
        if (!recorded) {
            return finish(attempt, fileName, fn, detectedIssue, repairType,
                    RepairStatus.UNSUPPORTED_OPERATION, "فشل تسجيل المرشّح داخل جلسة backup.");
        }
        // ⚠️ PATCH_STAGED يعني: مسجّل داخل backup session فقط، وليس مكتوبًا إلى
        // android/app/src/main/java/... الفعلي. BackupManager لا يملك أي قدرة
        // كتابة إلى هناك في هذا الإصدار.
        attempt.status = RepairStatus.PATCH_STAGED;

        // ---- Section 2: Validation جزئي - بدون اختراع parameters ----
        attempt.validationParamsUnknown = true;
        CodeValidator.ValidationResult validation =
                CodeValidator.validate(patchedCode, fn.name, new ArrayList<>(), patchedCode);
        attempt.validation = validation;

        AISecurityGuard.GuardReport guardReport = AISecurityGuard.analyze(
                fullCode, patchedCode, fileName, fn.line, fn.line, fn.name);
        attempt.guardReport = guardReport;

        try {
            AIEngine.ModificationResult modResult = new AIEngine.ModificationResult(
                    fn.name, fullCode, patchedCode, reason, fn.line, fn.line);
            attempt.diff = AIEngine.generateDiff(fullCode, modResult);
        } catch (Exception e) {
            attempt.diff = null;
        }

        boolean staticOk = validation != null && !validation.hasErrors() && !validation.hasSecurity();
        boolean guardOk = guardReport != null
                && guardReport.verdict != AISecurityGuard.GuardVerdict.BLOCKED
                && guardReport.canProceed;

        // ---- Section 5: Build Validation - سياقي فقط، لا يدخل في القرار إطلاقًا ----
        BuildValidationOutcome buildOutcome = buildValidator.validate(fileName, patchedCode);
        String buildNote = (buildOutcome == BuildValidationOutcome.UNAVAILABLE)
                ? "BUILD_VALIDATION_UNAVAILABLE: لا قدرة على تشغيل Gradle أو تأكيد نجاح compile في هذه البيئة."
                : "حالة build غير متوقعة: " + buildOutcome; // احتياط دفاعي، غير متاح فعليًا حاليًا

        if (!staticOk || !guardOk) {
            String restored = backupManager.restoreOriginal(session.sessionId);
            String msg = "فشل التحقق (" + (!staticOk ? "CodeValidator " : "") + (!guardOk ? "AISecurityGuard" : "")
                    + ") - تمت استعادة جلسة backup فقط (لا وجود لتغيير على الملف الحقيقي أصلًا). " + buildNote
                    + (restored == null ? " تحذير: قد تكون استعادة الجلسة غير مؤكدة." : "");
            return finish(attempt, fileName, fn, detectedIssue, repairType, RepairStatus.ROLLED_BACK, msg);
        }

        attempt.status = RepairStatus.STATIC_VALIDATION_PASSED;

        // ---- Section 1: القبول لا يعتمد على Build إطلاقًا، ويبقى موصوفًا بدقة ----
        String finalMsg = "STATIC_REPAIR_VERIFIED: نجح فحص CodeValidator (جزئي - بدون parameters حقيقية) "
                + "و AISecurityGuard فقط. " + buildNote + " "
                + "المرشّح موجود فقط داخل جلسة backup [" + session.sessionId
                + "] ولم يُكتب إلى ملف المصدر الحقيقي، ولم يتم تأكيد نجاح بناء المشروع.";

        RepairAttempt result = finish(attempt, fileName, fn, detectedIssue, repairType,
                RepairStatus.STATIC_REPAIR_VERIFIED, finalMsg);
        result.status = RepairStatus.CANDIDATE_ACCEPTED; // مرشّح مقبول داخل backup session فقط
        result.isBackupSessionCandidateOnly = true;
        return result;
    }

    // ============================================================
    // Helpers
    // ============================================================

    /**
     * فحص نطاق صارم:
     *  - يرفض null/فارغ.
     *  - يرفض أي مسار يحتوي على path traversal ("..") بأي شكل.
     *  - يرفض denylist (git/keystore/secrets/CI/manifest/gradle...).
     *  - يقبل فقط ما يطابق allowlist بالضبط (ملف .java مباشر داخل الحزمة).
     */
    private boolean isInScope(String fileName) {
        if (fileName == null || fileName.isBlank()) return false;
        if (fileName.contains("..")) return false; // path traversal - رفض مطلق
        for (Pattern p : DENYLIST) {
            if (p.matcher(fileName).matches()) return false;
        }
        return ALLOWLIST_ROOT.matcher(fileName).matches();
    }

    /**
     * Section 7: تصنيف متوازن - لا يجعل كل شيء DO_NOT_TOUCH.
     * DO_NOT_TOUCH محجوزة فقط لخطورة HIGH/CRITICAL معلنة من EngineAnalyzer.
     */
    private RepairClassification classify(EngineAnalyzer.FunctionAnalysis fn) {
        if ("HIGH".equalsIgnoreCase(fn.risk) || "CRITICAL".equalsIgnoreCase(fn.risk)) {
            return RepairClassification.DO_NOT_TOUCH;
        }
        if (fn.canAutoFix && fn.fixability == EngineAnalyzer.Fixability.HIGH) {
            return RepairClassification.AUTO_REPAIR_SAFE;
        }
        if (fn.canAutoFix && fn.fixability == EngineAnalyzer.Fixability.MEDIUM) {
            return RepairClassification.AUTO_REPAIR_REVIEW;
        }
        if (!fn.canAutoFix) {
            return RepairClassification.UNSUPPORTED;
        }
        return RepairClassification.AUTO_REPAIR_REVIEW;
    }

    private double confidenceToScore(EngineAnalyzer.Fixability f) {
        if (f == null) return 0.0;
        switch (f) { case HIGH: return 0.9; case MEDIUM: return 0.6; default: return 0.3; }
    }

    private RepairAttempt terminal(RepairPlan plan, RepairStatus status, String msg) {
        RepairAttempt a = new RepairAttempt(plan);
        a.status = status; a.message = msg;
        return a;
    }

    private RepairAttempt finish(RepairAttempt attempt, String fileName, EngineAnalyzer.FunctionAnalysis fn,
                                  String issue, String repairType, RepairStatus status, String msg) {
        attempt.status = status;
        attempt.message = msg;
        log(fileName, fn.name, issue, repairType, fn.fixability, status, msg);
        return attempt;
    }

    private void log(String fileName, String functionName, String issue, String repairType,
                      EngineAnalyzer.Fixability confidence, RepairStatus outcome, String failureReason) {
        localLog.add(new RepairLogEntry(fileName, functionName, issue, repairType, confidence, outcome, failureReason));
        Log.i(TAG, "[" + outcome + "] " + fileName + (functionName != null ? "#" + functionName : "")
                + (failureReason != null ? " - " + failureReason : ""));
    }
}
