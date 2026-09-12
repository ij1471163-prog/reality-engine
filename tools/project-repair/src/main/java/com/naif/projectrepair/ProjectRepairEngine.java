package com.naif.projectrepair;

import java.io.IOException;
import java.nio.file.*;
import java.nio.file.attribute.BasicFileAttributes;
import java.util.*;
import java.util.concurrent.TimeUnit;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import java.util.stream.Stream;

/**
 * ProjectRepairEngine
 * ===================
 * محرك واحد، مستقل بالكامل، في ملف واحد. لا يستدعي ولا يعدّل أي كلاس من
 * محركات Reality Engine الحالية (SelfRepairEngine, BugDetector, CodeValidator,
 * JSAnalyzer, EngineAnalyzer, أو أي منطق auto-fix موجود مسبقًا).
 *
 * ⚠️ إفصاح صادق عن حدود هذا الإصدار (اقرأ قبل الاستخدام):
 *
 *  1) نوع مشكلة واحد فقط منفَّذ فعليًا للاكتشاف/الإصلاح التلقائي:
 *     حقل من نوع معروف بالمشروع، مُعرَّف بدون تهيئة، ويُستخدم مباشرة
 *     (IssueType.UNINITIALIZED_FIELD_NPE_RISK). أي "فهم مشروع كامل كمطوّر"
 *     بمعنى تتبع زر UI -> Activity -> ViewModel -> API تلقائيًا **غير منفَّذ** -
 *     هذا يتطلب فهم Android UI binding/DI framework وهو خارج نطاق هذا الإصدار.
 *     الـProjectGraph هنا يبني علاقات class->class عبر أنواع الحقول فقط (نصيًا).
 *
 *  2) AIReasoningLayer: واجهة Provider-agnostic حقيقية موجودة، لكن **لا يوجد
 *     أي مزود AI حقيقي متصل في هذا الإصدار** (لا API key، لا شبكة لخدمة AI).
 *     التطبيق الافتراضي NoOpAIReasoningLayer يُرجع AI_UNAVAILABLE دائمًا وبصدق -
 *     لا يُختلق تحليل أو root cause من "AI" غير موجود. المحرك يكمل باستخدام
 *     التحليل الحتمي (deterministic) فقط في غياب AI، تمامًا كما طُلب.
 *
 *  3) Verification: يستخدم javac/java حقيقيين عبر ProcessBuilder عندما تكون
 *     متاحة في بيئة التشغيل. **لا يوجد Android/Gradle backend** - أي طلب
 *     تحقق على مشروع يحتاج Gradle يُرجع ANDROID_BUILD_UNAVAILABLE صراحة.
 *
 *  4) ⚠️ ملاحظة معمارية: هذا الملف يستخدم ProcessBuilder داخل
 *     JavacVerificationEngine لاستدعاء javac/java فعليًا. هذا مقبول هنا لأن
 *     هذا الكلاس مصمَّم للعمل من بيئة تطوير/بناء (سطر أوامر)، **وليس ليُشحن
 *     كما هو ليعمل داخل تطبيق Android على جهاز المستخدم**. هذا مختلف جوهريًا
 *     عن القيد الصارم بمنع Runtime.exec/ProcessBuilder في SelfRepairEngine
 *     (الذي يعمل فعليًا داخل تطبيق يُشحن للمستخدمين). إذا أُريد لاحقًا تشغيل
 *     جزء من هذا الملف داخل تطبيق Android، فـJavacVerificationEngine تحديدًا
 *     يجب استبداله بتطبيق لا ينفّذ عمليات نظام - يُعلن عندها UNAVAILABLE بدل ذلك.
 *
 *  5) محاولة بديلة (alternative repair strategy) حقيقية غير موجودة إلا لنمط
 *     واحد فقط. عند فشل هذا النمط، لا تُختلق استراتيجية بديلة غير موجودة -
 *     تُرجع FAILED_ALL_ATTEMPTS بصدق.
 */
public final class ProjectRepairEngine {

    // ================================================================
    // Configuration
    // ================================================================
    private final Path workDir;
    private final int maxAttemptsPerIssue;
    private final AIReasoningLayer aiLayer;

    private final ProjectIndexer indexer = new ProjectIndexer();
    private final List<IssueAnalyzer> analyzers = List.of(new UninitializedFieldAnalyzer());
    private final RootCauseAnalyzer rootCauseAnalyzer = new DefaultRootCauseAnalyzer();
    private final RepairPlanner planner = new DefaultRepairPlanner();
    private final PatchEngine patchEngine = new PatchEngine();
    private final VerificationEngine verificationEngine = new JavacVerificationEngine();
    private final RollbackManager rollbackManager = new RollbackManager();

    public ProjectRepairEngine(Path workDir, int maxAttemptsPerIssue) {
        this(workDir, maxAttemptsPerIssue, new NoOpAIReasoningLayer());
    }

    /** يسمح بحقن AIReasoningLayer بديل (مزود حقيقي) لاحقًا دون تعديل هذا الملف من الخارج. */
    public ProjectRepairEngine(Path workDir, int maxAttemptsPerIssue, AIReasoningLayer aiLayer) {
        this.workDir = workDir;
        this.maxAttemptsPerIssue = maxAttemptsPerIssue;
        this.aiLayer = aiLayer;
    }

    // ================================================================
    // Public API
    // ================================================================

    public ProjectModel indexProject(Path projectRoot) throws IOException {
        return indexer.index(projectRoot);
    }

    /**
     * المسار الكامل: Index -> Graph -> Analyze -> (AI advisory, إن توفر)
     * -> RootCause -> Plan -> Patch -> Workspace -> Verify -> Accept/Rollback -> Result.
     *
     * @param projectRoot جذر المشروع الحقيقي (قراءة فقط، لا يُكتب إليه أبدًا)
     * @param mainClassFqcn الكلاس الذي يحوي main لتشغيل تحقق سلوكي حقيقي، أو null للاكتفاء بالـcompile
     */
    public RepairResult repairProject(Path projectRoot, String mainClassFqcn) {
        RepairResult result = new RepairResult(UUID.randomUUID().toString());

        ProjectModel model;
        try {
            model = indexer.index(projectRoot);
        } catch (IOException e) {
            result.finalStatus = RepairResult.FinalStatus.UNSUPPORTED;
            result.warnings.add("فشلت الفهرسة فعليًا: " + e.getMessage());
            return result;
        }

        if (model.isEmpty()) {
            result.finalStatus = RepairResult.FinalStatus.NO_ISSUES_FOUND;
            result.warnings.add("المشروع فارغ - لا ملفات لتحليلها.");
            return result;
        }

        long unsupportedCount = model.countByLanguage(ProjectFile.Language.UNSUPPORTED);
        if (unsupportedCount > 0) {
            result.warnings.add(unsupportedCount + " ملف(ات) بلغات غير مدعومة تم تجاهلها من التحليل.");
        }
        if (model.countByLanguage(ProjectFile.Language.JAVA) == 0) {
            result.finalStatus = RepairResult.FinalStatus.UNSUPPORTED;
            result.warnings.add("لا توجد ملفات Java قابلة للتحليل في هذا المشروع.");
            return result;
        }

        ProjectGraph graph = indexer.buildGraph(model);

        List<Issue> allIssues = new ArrayList<>();
        for (IssueAnalyzer a : analyzers) allIssues.addAll(a.analyze(model, graph));

        if (allIssues.isEmpty()) {
            result.finalStatus = RepairResult.FinalStatus.NO_ISSUES_FOUND;
            return result;
        }

        Issue issue = allIssues.get(0); // هذا الإصدار يعالج أول Issue مكتشف فقط
        result.issue = issue;
        result.evidence.addAll(issue.evidence);
        result.affectedFiles.add(issue.primaryFile);

        // ---- AI Reasoning Layer (استشاري فقط - لا صلاحية إعلان نجاح) ----
        AIReasoningLayer.AIAnalysis aiAnalysis = aiLayer.analyze(
                new AIReasoningLayer.AIContext(model, graph, issue, null, null));
        result.aiStatus = aiAnalysis.status;
        if (aiAnalysis.status == AIReasoningLayer.AIStatus.AI_UNAVAILABLE) {
            result.warnings.add("AI_UNAVAILABLE: لا يوجد مزود AI متصل في هذا الإصدار - "
                    + "المتابعة بالتحليل الحتمي (deterministic) فقط.");
        } else if (aiAnalysis.status == AIReasoningLayer.AIStatus.AI_ANALYZED) {
            result.hypotheses.addAll(aiAnalysis.hypotheses);
        }

        // ---- Root Cause (حتمي - المصدر الوحيد المعتمد لاختيار السبب فعليًا في هذا الإصدار) ----
        RootCause rootCause = rootCauseAnalyzer.analyze(issue, model, graph);
        if (rootCause == null) {
            result.finalStatus = RepairResult.FinalStatus.NOT_VERIFIED;
            result.warnings.add("لم يُؤكَّد Root Cause بدليل كافٍ - لن يُطبَّق أي إصلاح.");
            return result;
        }
        result.selectedRootCause = rootCause;
        result.confidence = rootCause.confidence;
        if (!result.affectedFiles.contains(rootCause.rootCauseFile)) {
            result.affectedFiles.add(rootCause.rootCauseFile);
        }

        RepairPlan plan = planner.plan(rootCause, issue, model, graph);
        if (plan == null) {
            result.finalStatus = RepairResult.FinalStatus.UNSUPPORTED;
            result.warnings.add("تعذّر بناء خطة إصلاح دنيا موثوقة لهذا الـRootCause.");
            return result;
        }
        result.repairPlan = plan;

        RepairSession session = new RepairSession(issue, rootCause, maxAttemptsPerIssue);
        try {
            session.workspace = WorkspaceManager.createIsolatedCopy(projectRoot, workDir);
        } catch (IOException e) {
            result.finalStatus = RepairResult.FinalStatus.UNSUPPORTED;
            result.warnings.add("تعذّر إنشاء workspace معزولة فعليًا: " + e.getMessage());
            return result;
        }

        while (!session.limitReached()) {
            int attemptNo = session.attempts.size() + 1;
            Patch patch;
            try {
                patch = patchEngine.generate(plan, model);
            } catch (RuntimeException e) {
                result.finalStatus = RepairResult.FinalStatus.FAILED_ALL_ATTEMPTS;
                result.warnings.add("فشل توليد الـpatch: " + e.getMessage());
                break;
            }

            RepairSession.Attempt attempt = new RepairSession.Attempt(attemptNo, patch);
            session.attempts.add(attempt);

            try {
                session.workspace.applyPatch(patch);
            } catch (IOException e) {
                attempt.status = RepairSession.AttemptStatus.FAILED;
                attempt.note = "فشلت كتابة الـpatch فعليًا في الـworkspace: " + e.getMessage();
                break;
            }

            VerificationResult verification = verificationEngine.verify(session.workspace.getWorkspaceRoot(), mainClassFqcn);
            attempt.verification = verification;

            // ---- قرار القبول: VERIFIED فقط يُقبل ----
            // PARTIALLY_VERIFIED (compile فقط، بدون دليل سلوكي) لا يكفي لإثبات أن
            // الإصلاح عالج المشكلة فعليًا - محرك يتصرف "كمطوّر" لا يقبل تعديلاً
            // لمجرد أنه يُصرَّف؛ يحتاج دليلاً على أن السلوك تغيّر كما هو متوقَّع.
            // لذلك: VERIFIED -> ACCEPTED فقط. كل ما عداه -> rollback ثم حالة نهائية
            // صادقة (NOT_VERIFIED لِـ PARTIALLY_VERIFIED/UNAVAILABLE، وFAILED_ALL_ATTEMPTS لِـ FAILED).
            if (verification.status == VerificationResult.Status.VERIFIED) {
                attempt.status = RepairSession.AttemptStatus.ACCEPTED;
                result.finalStatus = RepairResult.FinalStatus.ACCEPTED;
                result.finalPatch = patch;
                result.verificationResult = verification;
                break;
            } else {
                StringBuilder reason = new StringBuilder();
                boolean rolledBack = rollbackManager.rollback(session.workspace, patch.relativePath, reason);
                attempt.status = RepairSession.AttemptStatus.ROLLED_BACK;
                attempt.note = "لم يُقبل التعديل (" + verification.status + ") - "
                        + (rolledBack ? "تمت الاستعادة داخل workspace." : ("تحذير: " + reason));
                result.rolledBack = rolledBack;
                result.finalStatus = switch (verification.status) {
                    case FAILED -> RepairResult.FinalStatus.FAILED_ALL_ATTEMPTS;
                    case PARTIALLY_VERIFIED, UNAVAILABLE, NOT_VERIFIED -> RepairResult.FinalStatus.NOT_VERIFIED;
                    case VERIFIED -> throw new IllegalStateException("unreachable"); // مُعالَج أعلاه
                };
                result.verificationResult = verification;
                break; // لا استراتيجية بديلة حقيقية في هذا الإصدار - لا تكرار وهمي
            }
        }

        if (session.limitReached() && result.finalStatus == null) {
            result.finalStatus = RepairResult.FinalStatus.FAILED_ALL_ATTEMPTS;
            result.warnings.add("بلغت المحاولات الحد الأقصى (" + maxAttemptsPerIssue + ") بدون قبول.");
        }

        result.attempts.addAll(session.attempts);

        try {
            session.workspace.dispose();
        } catch (IOException e) {
            result.warnings.add("تعذّر تنظيف workspace المؤقتة: " + e.getMessage());
        }
        return result;
    }

    /** يبني حزمة يدوية فقط لنتيجة ACCEPTED فعلية بها patch حقيقي. */
    public RepairPackage buildPackage(RepairResult result) {
        if (result.finalStatus != RepairResult.FinalStatus.ACCEPTED || result.finalPatch == null) {
            throw new IllegalStateException("لا يمكن بناء RepairPackage إلا لنتيجة ACCEPTED تحتوي patch فعلي.");
        }
        return new RepairPackage(result.sessionId, result.finalPatch.relativePath,
                result.finalPatch.unifiedDiff, result.repairPlan.description, result.confidence, result.verificationResult);
    }

    // ================================================================
    // ===================== Nested static classes ===================
    // ================================================================

    // ---------------- ProjectFile / ProjectModel ----------------

    public static final class ProjectFile {
        public enum Language { JAVA, UNSUPPORTED }
        public final Path absolutePath;
        public final String relativePath;
        public final Language language;
        public final String content;

        public ProjectFile(Path absolutePath, String relativePath, Language language, String content) {
            this.absolutePath = absolutePath;
            this.relativePath = relativePath;
            this.language = language;
            this.content = content;
        }
    }

    public static final class ProjectModel {
        public final Path rootDir;
        public final List<ProjectFile> files = new ArrayList<>();

        public ProjectModel(Path rootDir) { this.rootDir = rootDir; }

        public ProjectFile findByRelativePath(String relativePath) {
            for (ProjectFile f : files) if (f.relativePath.equals(relativePath)) return f;
            return null;
        }
        public boolean isEmpty() { return files.isEmpty(); }
        public long countByLanguage(ProjectFile.Language lang) {
            return files.stream().filter(f -> f.language == lang).count();
        }
    }

    // ---------------- ProjectGraph ----------------
    //
    // ⚠️ توسعة المرحلة الأولى (Project Understanding):
    // الحقول والدوال الأصلية (classToFile/dependsOn/registerClass/addDependency/
    // dependenciesOf/knowsClass/fileForClass) بقيت كما هي بدون أي تغيير في
    // السلوك - هذا يضمن أن كل الاختبارات القديمة (01-17) تستمر بالعمل حرفيًا.
    // كل ما هو جديد (classSymbols, callEdges, fieldRefEdges, ...) إضافي فقط،
    // ولا يُملأ إلا عبر attachAst(...) التي يستدعيها ProjectIndexer.buildAstGraph()
    // - مسار منفصل تمامًا عن buildGraph() القديم القائم على regex.
    public static final class ProjectGraph {
        private final Map<String, String> classToFile = new HashMap<>();
        private final Map<String, Set<String>> dependsOn = new HashMap<>();

        // ---- توسعة AST (تُملأ فقط عبر attachAst) ----
        // المصدر الأساسي للحقيقة: الخرائط مفهرسة بالـFQN. خريطة simpleName
        // منفصلة تحتفظ بكل الـFQNs التي تحمل نفس الاسم البسيط لكشف التضارب
        // بدل الكتابة فوق بعضها (وهو ما كان يحدث سابقًا ويُفقد كلاسات كاملة).
        private final Map<String, ClassSymbol> classSymbolsByFqn = new HashMap<>();
        private final Map<String, Set<String>> fqnsBySimpleName = new HashMap<>();
        private final Map<String, List<MethodSymbol>> methodsByOwnerFqn = new HashMap<>();
        private final Map<String, List<FieldSymbol>> fieldsByOwnerFqn = new HashMap<>();
        private final List<CallEdge> callEdges = new ArrayList<>();
        private final List<FieldRefEdge> fieldRefEdges = new ArrayList<>();
        private final Map<String, String> unparsableFiles = new HashMap<>(); // relativePath -> سبب الفشل
        private boolean astAttached = false;
        private boolean astToolAvailable = true;

        public void registerClass(String className, String relativePath) {
            classToFile.put(className, relativePath);
            dependsOn.computeIfAbsent(className, k -> new HashSet<>());
        }
        public void addDependency(String fromClass, String toClass) {
            dependsOn.computeIfAbsent(fromClass, k -> new HashSet<>()).add(toClass);
        }
        public String fileForClass(String className) { return classToFile.get(className); }
        public Set<String> dependenciesOf(String className) { return dependsOn.getOrDefault(className, Set.of()); }
        public boolean knowsClass(String className) { return classToFile.containsKey(className); }

        // ---- API جديدة (Project Understanding - المرحلة الأولى) ----

        /** يُستدعى فقط من ProjectIndexer.buildAstGraph(). يدمج نتائج AST حقيقية فوق الـgraph الموجود. */
        void attachAst(AstAnalysisResult r) {
            astAttached = true;
            astToolAvailable = r.toolAvailable;
            for (ClassSymbol cs : r.classes) {
                classSymbolsByFqn.put(cs.fqn, cs);
                fqnsBySimpleName.computeIfAbsent(cs.simpleName, k -> new HashSet<>()).add(cs.fqn);
                // إثراء dependsOn الموجود أصلًا (إضافة فقط، بدون حذف أي علاقة regex القديمة):
                if (cs.superclassSimpleName != null && knowsClass(cs.superclassSimpleName)) {
                    registerClassIfMissing(cs.simpleName, cs.location.file);
                    addDependency(cs.simpleName, cs.superclassSimpleName);
                }
                for (String iface : cs.interfaceSimpleNames) {
                    if (knowsClass(iface)) addDependency(cs.simpleName, iface);
                }
            }
            for (MethodSymbol ms : r.methods) {
                methodsByOwnerFqn.computeIfAbsent(ms.ownerFqn, k -> new ArrayList<>()).add(ms);
            }
            for (FieldSymbol fs : r.fields) {
                fieldsByOwnerFqn.computeIfAbsent(fs.ownerFqn, k -> new ArrayList<>()).add(fs);
            }
            for (CallEdge ce : r.callEdges) {
                callEdges.add(ce);
                if (ce.resolved && knowsClass(ce.callerClass) && knowsClass(ce.calleeClass)) {
                    addDependency(ce.callerClass, ce.calleeClass);
                }
            }
            fieldRefEdges.addAll(r.fieldRefEdges);
            unparsableFiles.putAll(r.unparsableFiles);
        }

        private void registerClassIfMissing(String className, String file) {
            if (!classToFile.containsKey(className)) registerClass(className, file);
        }

        public boolean isAstAttached() { return astAttached; }
        public boolean isAstToolAvailable() { return astToolAvailable; }
        public Map<String, String> unparsableFiles() { return Collections.unmodifiableMap(unparsableFiles); }

        // ================= Simple-name compatibility layer =================
        // هذه الدوال تحافظ على الـAPI القديمة حرفيًا عندما يكون الاسم فريدًا.
        // عند التضارب (أكثر من FQN لنفس الاسم البسيط) لا تُخمّن أبدًا: تُرجع
        // null/فارغ. استخدم النسخ المؤهَّلة (...ByFqn) للحسم.

        /** true إذا كان الاسم البسيط يشير إلى أكثر من كلاس واحد في المشروع. */
        public boolean isAmbiguousSimpleName(String simpleName) {
            Set<String> fqns = fqnsBySimpleName.get(simpleName);
            return fqns != null && fqns.size() > 1;
        }

        /** كل الـFQNs التي تحمل هذا الاسم البسيط (فارغة إذا غير معروف). */
        public Set<String> fqnsForSimpleName(String simpleName) {
            return Collections.unmodifiableSet(fqnsBySimpleName.getOrDefault(simpleName, Set.of()));
        }

        /** @return null إذا غير معروف **أو** إذا كان الاسم متضاربًا (لا تخمين). */
        public ClassSymbol classSymbol(String simpleName) {
            Set<String> fqns = fqnsBySimpleName.get(simpleName);
            if (fqns == null || fqns.size() != 1) return null;
            return classSymbolsByFqn.get(fqns.iterator().next());
        }

        public Collection<ClassSymbol> allClassSymbols() {
            return Collections.unmodifiableCollection(classSymbolsByFqn.values());
        }

        // ================= FQN-qualified API (source of truth) =================

        public ClassSymbol classSymbolByFqn(String fqn) { return classSymbolsByFqn.get(fqn); }
        public boolean knowsFqn(String fqn) { return classSymbolsByFqn.containsKey(fqn); }
        public Set<String> allFqns() { return Collections.unmodifiableSet(classSymbolsByFqn.keySet()); }

        public List<MethodSymbol> methodsOfFqn(String ownerFqn) {
            return Collections.unmodifiableList(methodsByOwnerFqn.getOrDefault(ownerFqn, List.of()));
        }
        public List<FieldSymbol> fieldsOfFqn(String ownerFqn) {
            return Collections.unmodifiableList(fieldsByOwnerFqn.getOrDefault(ownerFqn, List.of()));
        }

        public List<CallEdge> callEdgesFromFqn(String callerFqn, String callerMethod) {
            List<CallEdge> out = new ArrayList<>();
            for (CallEdge ce : callEdges) {
                if (ce.callerFqn.equals(callerFqn) && Objects.equals(ce.callerMethod, callerMethod)) out.add(ce);
            }
            return out;
        }

        public List<FieldRefEdge> fieldRefEdgesFromFqn(String accessorFqn, String accessorMethod) {
            List<FieldRefEdge> out = new ArrayList<>();
            for (FieldRefEdge fe : fieldRefEdges) {
                if (fe.accessorFqn.equals(accessorFqn) && Objects.equals(fe.accessorMethod, accessorMethod)) out.add(fe);
            }
            return out;
        }

        public List<FieldRefEdge> referencesToFieldFqn(String ownerFqn, String fieldName) {
            List<FieldRefEdge> out = new ArrayList<>();
            for (FieldRefEdge fe : fieldRefEdges) {
                if (fe.targetFqn.equals(ownerFqn) && fe.targetField.equals(fieldName)) out.add(fe);
            }
            return out;
        }

        /** نسخة مؤهَّلة من inheritsFrom تعمل على FQNs. */
        public boolean inheritsFromFqn(String classFqn, String ancestorFqn) {
            Set<String> visited = new HashSet<>();
            String current = classFqn;
            while (current != null && visited.add(current)) {
                ClassSymbol cs = classSymbolsByFqn.get(current);
                if (cs == null) return false;
                if (ancestorFqn.equals(cs.superclassFqn)) return true;
                current = cs.superclassFqn;
            }
            return false;
        }

        /** نسخة مؤهَّلة من implementsInterface تعمل على FQNs. */
        public boolean implementsInterfaceFqn(String classFqn, String interfaceFqn) {
            ClassSymbol cs = classSymbolsByFqn.get(classFqn);
            if (cs == null) return false;
            if (cs.interfaceFqns.contains(interfaceFqn)) return true;
            if (cs.superclassFqn != null) return implementsInterfaceFqn(cs.superclassFqn, interfaceFqn);
            return false;
        }

        /**
         * نسخة مؤهَّلة من findCallChain: المطابقة تتم على FQN، فلا تخلط بين
         * كلاسين بنفس الاسم البسيط في حزم مختلفة.
         */
        public List<CallEdge> findCallChainByFqn(String fromFqn, String fromMethod,
                                                  String toFqn, String toMethod, int maxDepth) {
            return callChainInternal(fromFqn, fromMethod, toFqn, toMethod, maxDepth, true);
        }

        public List<MethodSymbol> methodsOf(String className) {
            Set<String> fqns = fqnsBySimpleName.get(className);
            if (fqns == null || fqns.size() != 1) return List.of(); // متضارب أو غير معروف -> لا تخمين
            return Collections.unmodifiableList(methodsByOwnerFqn.getOrDefault(fqns.iterator().next(), List.of()));
        }
        public List<FieldSymbol> fieldsOf(String className) {
            Set<String> fqns = fqnsBySimpleName.get(className);
            if (fqns == null || fqns.size() != 1) return List.of(); // متضارب أو غير معروف -> لا تخمين
            return Collections.unmodifiableList(fieldsByOwnerFqn.getOrDefault(fqns.iterator().next(), List.of()));
        }

        public List<CallEdge> allCallEdges() { return Collections.unmodifiableList(callEdges); }

        /** كل مراجع الحقول المستخرجة فعليًا من AST (محلولة دلاليًا وداخل المشروع فقط). */
        public List<FieldRefEdge> allFieldRefEdges() { return Collections.unmodifiableList(fieldRefEdges); }

        /** مراجع الحقول الصادرة من method محدد. طبقة توافق: تُرجع فارغًا عند تضارب الاسم البسيط. */
        public List<FieldRefEdge> fieldRefEdgesFrom(String accessorClass, String accessorMethod) {
            if (isAmbiguousSimpleName(accessorClass)) return List.of();
            List<FieldRefEdge> out = new ArrayList<>();
            for (FieldRefEdge fe : fieldRefEdges) {
                if (fe.accessorClass.equals(accessorClass) && Objects.equals(fe.accessorMethod, accessorMethod)) out.add(fe);
            }
            return out;
        }

        /** كل المواضع التي تشير إلى حقل معيّن. طبقة توافق: تُرجع فارغًا عند تضارب الاسم البسيط. */
        public List<FieldRefEdge> referencesToField(String ownerClass, String fieldName) {
            if (isAmbiguousSimpleName(ownerClass)) return List.of();
            List<FieldRefEdge> out = new ArrayList<>();
            for (FieldRefEdge fe : fieldRefEdges) {
                if (fe.targetClass.equals(ownerClass) && fe.targetField.equals(fieldName)) out.add(fe);
            }
            return out;
        }

        /** طبقة توافق: تُرجع فارغًا عند تضارب الاسم البسيط بدل خلط كلاسين مختلفين. */
        public List<CallEdge> callEdgesFrom(String callerClass, String callerMethod) {
            if (isAmbiguousSimpleName(callerClass)) return List.of();
            List<CallEdge> out = new ArrayList<>();
            for (CallEdge ce : callEdges) {
                if (ce.callerClass.equals(callerClass) && Objects.equals(ce.callerMethod, callerMethod)) out.add(ce);
            }
            return out;
        }

        /**
         * طبقة توافق بالاسم البسيط. تُرجع false عند التضارب (لا تخمين) -
         * استخدم inheritsFromFqn للحسم.
         */
        public boolean inheritsFrom(String className, String ancestorClassName) {
            if (isAmbiguousSimpleName(className) || isAmbiguousSimpleName(ancestorClassName)) return false;
            Set<String> visited = new HashSet<>();
            String current = className;
            while (current != null && visited.add(current)) {
                ClassSymbol cs = classSymbol(current);
                if (cs == null) return false;
                if (ancestorClassName.equals(cs.superclassSimpleName)) return true;
                current = cs.superclassSimpleName;
            }
            return false;
        }

        /** طبقة توافق بالاسم البسيط. تُرجع false عند التضارب - استخدم implementsInterfaceFqn للحسم. */
        public boolean implementsInterface(String className, String interfaceName) {
            if (isAmbiguousSimpleName(className) || isAmbiguousSimpleName(interfaceName)) return false;
            ClassSymbol cs = classSymbol(className);
            if (cs == null) return false;
            if (cs.interfaceSimpleNames.contains(interfaceName)) return true;
            if (cs.superclassSimpleName != null) return implementsInterface(cs.superclassSimpleName, interfaceName);
            return false;
        }

        /**
         * يتتبع مسار استدعاء حقيقي (BFS) بين method محدد وmethod هدف، عبر
         * callEdges المُستخرجة فعليًا من AST (وليس تخمينًا). يُرجع القائمة
         * المرتبة من نقطة البداية للهدف، أو null إذا لم يوجد مسار ضمن maxDepth.
         * كل خطوة في المسار evidence حقيقي (CallEdge له file/line فعليين).
         *
         * ⚠️ طبقة توافق: تطابق بالاسم البسيط. عند وجود تضارب في اسم البداية أو
         * الهدف تُرجع null بدل إنتاج مسار قد يخلط كلاسين مختلفين.
         * استخدم findCallChainByFqn للحسم القاطع.
         */
        public List<CallEdge> findCallChain(String fromClass, String fromMethod,
                                             String toClass, String toMethod, int maxDepth) {
            if (isAmbiguousSimpleName(fromClass) || isAmbiguousSimpleName(toClass)) return null;
            return callChainInternal(fromClass, fromMethod, toClass, toMethod, maxDepth, false);
        }

        /**
         * التنفيذ المشترك للتتبع. byFqn=true يطابق على callerFqn/calleeFqn
         * (المصدر الأساسي للحقيقة)، وbyFqn=false يطابق على الأسماء البسيطة
         * (طبقة التوافق، بعد استبعاد الحالات المتضاربة في المستدعي).
         */
        private List<CallEdge> callChainInternal(String from, String fromMethod,
                                                  String to, String toMethod, int maxDepth, boolean byFqn) {
            record Node(String cls, String method) {}
            Node start = new Node(from, fromMethod);
            Node target = new Node(to, toMethod);
            if (start.equals(target)) return List.of();

            Map<Node, CallEdge> cameFromEdge = new HashMap<>();
            Map<Node, Node> cameFrom = new HashMap<>();
            Deque<Node> queue = new ArrayDeque<>();
            Map<Node, Integer> depthOf = new HashMap<>();
            queue.add(start);
            depthOf.put(start, 0);

            while (!queue.isEmpty()) {
                Node cur = queue.poll();
                int d = depthOf.get(cur);
                if (d >= maxDepth) continue;
                for (CallEdge ce : callEdges) {
                    if (!ce.resolved) continue;
                    String callerKey = byFqn ? ce.callerFqn : ce.callerClass;
                    String calleeKey = byFqn ? ce.calleeFqn : ce.calleeClass;
                    if (!callerKey.equals(cur.cls) || !Objects.equals(ce.callerMethod, cur.method)) continue;
                    Node next = new Node(calleeKey, ce.calleeMethod);
                    if (depthOf.containsKey(next)) continue;
                    depthOf.put(next, d + 1);
                    cameFrom.put(next, cur);
                    cameFromEdge.put(next, ce);
                    if (next.equals(target)) {
                        List<CallEdge> path = new ArrayList<>();
                        Node walk = next;
                        while (!walk.equals(start)) {
                            path.add(cameFromEdge.get(walk));
                            walk = cameFrom.get(walk);
                        }
                        Collections.reverse(path);
                        return path;
                    }
                    queue.add(next);
                }
            }
            return null; // لا مسار حقيقي موجود ضمن الحد الأقصى - لا يُختلق مسار
        }
    }

    // ---------------- Symbol / Reference model (المرحلة الأولى: Project Understanding) ----------------

    public static final class SourceLocation {
        public final String file; // relativePath
        public final int line;    // -1 إذا غير معروف
        public SourceLocation(String file, int line) { this.file = file; this.line = line; }
        @Override public String toString() { return file + ":" + line; }
    }

    public static final class ClassSymbol {
        public enum Kind { CLASS, INTERFACE, ENUM }
        public final String simpleName;
        public final Kind kind;
        public final SourceLocation location;
        public final String superclassSimpleName;         // null إذا لا يوجد/غير معروف
        public final List<String> interfaceSimpleNames;    // فارغة إذا لا يوجد

        // ---- هوية مؤهَّلة (FQN) - المصدر الأساسي للحقيقة ----
        /** مثال: "com.foo.ApiClient". قد يساوي simpleName فقط إذا كان الكلاس في الحزمة الافتراضية. */
        public final String fqn;
        /** FQN للأب، أو null. */
        public final String superclassFqn;
        /** FQNs للواجهات المطبَّقة. */
        public final List<String> interfaceFqns;

        public ClassSymbol(String simpleName, Kind kind, SourceLocation location,
                            String superclassSimpleName, List<String> interfaceSimpleNames) {
            // مُنشئ توافق قديم: يُبقي السلوك السابق حرفيًا عند غياب معلومات FQN
            this(simpleName, simpleName, kind, location, superclassSimpleName, null,
                    interfaceSimpleNames, List.of());
        }

        public ClassSymbol(String simpleName, String fqn, Kind kind, SourceLocation location,
                            String superclassSimpleName, String superclassFqn,
                            List<String> interfaceSimpleNames, List<String> interfaceFqns) {
            this.simpleName = simpleName; this.fqn = fqn; this.kind = kind; this.location = location;
            this.superclassSimpleName = superclassSimpleName;
            this.superclassFqn = superclassFqn;
            this.interfaceSimpleNames = interfaceSimpleNames;
            this.interfaceFqns = interfaceFqns;
        }

        @Override public String toString() { return fqn + " [" + kind + "] @" + location; }
    }

    public static final class MethodSymbol {
        public final String ownerClass;
        public final String name;               // "<init>" للمُنشئ
        public final List<String> paramTypeSimpleNames;
        public final String returnTypeSimpleName; // null للمُنشئ
        public final SourceLocation location;
        public final boolean isConstructor;

        /** FQN للكلاس المالك - المصدر الأساسي للحقيقة. */
        public final String ownerFqn;

        public MethodSymbol(String ownerClass, String name, List<String> paramTypeSimpleNames,
                             String returnTypeSimpleName, SourceLocation location, boolean isConstructor) {
            this(ownerClass, ownerClass, name, paramTypeSimpleNames, returnTypeSimpleName, location, isConstructor);
        }

        public MethodSymbol(String ownerClass, String ownerFqn, String name, List<String> paramTypeSimpleNames,
                             String returnTypeSimpleName, SourceLocation location, boolean isConstructor) {
            this.ownerClass = ownerClass; this.ownerFqn = ownerFqn; this.name = name;
            this.paramTypeSimpleNames = paramTypeSimpleNames;
            this.returnTypeSimpleName = returnTypeSimpleName; this.location = location; this.isConstructor = isConstructor;
        }

        @Override public String toString() { return ownerFqn + "#" + name + " @" + location; }
    }

    public static final class FieldSymbol {
        public final String ownerClass;
        public final String name;
        public final String typeSimpleName;
        public final SourceLocation location;

        /** FQN للكلاس المالك - المصدر الأساسي للحقيقة. */
        public final String ownerFqn;

        public FieldSymbol(String ownerClass, String name, String typeSimpleName, SourceLocation location) {
            this(ownerClass, ownerClass, name, typeSimpleName, location);
        }

        public FieldSymbol(String ownerClass, String ownerFqn, String name, String typeSimpleName, SourceLocation location) {
            this.ownerClass = ownerClass; this.ownerFqn = ownerFqn; this.name = name;
            this.typeSimpleName = typeSimpleName; this.location = location;
        }

        @Override public String toString() { return ownerFqn + "." + name + ":" + typeSimpleName + " @" + location; }
    }

    /**
     * علاقة استدعاء حقيقية. resolved=true فقط عندما ربطها javac دلاليًا فعليًا
     * (عبر Trees.getElement) والهدف كلاس معروف داخل المشروع. resolved=false
     * تعني: تعذّر التحقق بثقة (overload غامض بسبب خطأ compile آخر، أو الهدف
     * خارج المشروع، أو أي سبب آخر) - ويُذكر السبب في note بدل التخمين.
     *
     * الحقول callerClass/calleeClass أسماء بسيطة (توافق مع الـAPI القديمة)،
     * أما callerFqn/calleeFqn فهي الهوية الحقيقية المستخدمة داخليًا للمطابقة.
     */
    public static final class CallEdge {
        public final String callerClass;
        public final String callerMethod; // null إذا الاستدعاء داخل field initializer خارج أي method
        public final String calleeClass;  // قد يكون "?" إذا لم يُحل
        public final String calleeMethod;
        public final SourceLocation location;
        public final boolean resolved;
        public final String note;

        /** FQNs - المصدر الأساسي للحقيقة عند المطابقة/التتبع. */
        public final String callerFqn;
        public final String calleeFqn;

        public CallEdge(String callerClass, String callerMethod, String calleeClass, String calleeMethod,
                         SourceLocation location, boolean resolved, String note) {
            this(callerClass, callerClass, callerMethod, calleeClass, calleeClass, calleeMethod,
                    location, resolved, note);
        }

        public CallEdge(String callerClass, String callerFqn, String callerMethod,
                         String calleeClass, String calleeFqn, String calleeMethod,
                         SourceLocation location, boolean resolved, String note) {
            this.callerClass = callerClass; this.callerFqn = callerFqn; this.callerMethod = callerMethod;
            this.calleeClass = calleeClass; this.calleeFqn = calleeFqn; this.calleeMethod = calleeMethod;
            this.location = location; this.resolved = resolved; this.note = note;
        }
        @Override public String toString() {
            return callerFqn + "." + callerMethod + " -> " + calleeFqn + "." + calleeMethod
                    + " [resolved=" + resolved + (note != null ? ", note=" + note : "") + "]";
        }
    }

    public static final class FieldRefEdge {
        public final String accessorClass;
        public final String accessorMethod;
        public final String targetClass;
        public final String targetField;
        public final SourceLocation location;
        public final boolean resolved;
        public final String note;

        /** FQNs - المصدر الأساسي للحقيقة. */
        public final String accessorFqn;
        public final String targetFqn;

        public FieldRefEdge(String accessorClass, String accessorMethod, String targetClass, String targetField,
                             SourceLocation location, boolean resolved, String note) {
            this(accessorClass, accessorClass, accessorMethod, targetClass, targetClass, targetField,
                    location, resolved, note);
        }

        public FieldRefEdge(String accessorClass, String accessorFqn, String accessorMethod,
                             String targetClass, String targetFqn, String targetField,
                             SourceLocation location, boolean resolved, String note) {
            this.accessorClass = accessorClass; this.accessorFqn = accessorFqn; this.accessorMethod = accessorMethod;
            this.targetClass = targetClass; this.targetFqn = targetFqn; this.targetField = targetField;
            this.location = location; this.resolved = resolved; this.note = note;
        }
        @Override public String toString() {
            return accessorFqn + "." + accessorMethod + " -> references " + targetFqn + "." + targetField
                    + " [resolved=" + resolved + (note != null ? ", note=" + note : "") + "]";
        }
    }

    public static final class AstAnalysisResult {
        public final List<ClassSymbol> classes = new ArrayList<>();
        public final List<MethodSymbol> methods = new ArrayList<>();
        public final List<FieldSymbol> fields = new ArrayList<>();
        public final List<CallEdge> callEdges = new ArrayList<>();
        public final List<FieldRefEdge> fieldRefEdges = new ArrayList<>();
        /** relativePath -> ملخص الأخطاء التي منعت تحليلًا موثوقًا لهذا الملف تحديدًا. */
        public final Map<String, String> unparsableFiles = new HashMap<>();
        /** false فقط إذا لم يوجد ToolProvider.getSystemJavaCompiler() إطلاقًا في هذه البيئة. */
        public boolean toolAvailable = true;
    }

    /**
     * ⚠️ الأداة الحقيقية المستخدمة: com.sun.source (Compiler Tree API) من نفس
     * JDK - وهذا AST حقيقي صادر عن javac نفسه، وليس regex. الدلالة (symbol
     * resolution) تتم عبر Trees.getElement بعد task.analyze() الفعلي - عندما
     * تُرجع null (بسبب خطأ compile آخر في المشروع، أو نوع غير موجود)، لا نخمّن:
     * نُسجّل الحافة كـ resolved=false مع سبب واضح.
     *
     * حدود مُعلنة صراحة لهذه المرحلة:
     *  - الأسماء تُخزَّن بالاسم البسيط (simple name) فقط، وليس الاسم المؤهَّل
     *    بالكامل (package.Class) - إذا وُجد كلاسان بنفس الاسم البسيط في حزم
     *    مختلفة ضمن نفس المشروع، فقد يحدث تضارب. غير معالَج في هذا الإصدار.
     *  - الاستدعاءات نحو مكتبات خارجية/JDK (مثل System.out.println) تُحل
     *    دلاليًا بنجاح من قبل javac، لكن **لا تُسجَّل كـCallEdge** لأنها ليست
     *    علاقة داخل المشروع - هذا Project Graph وليس Full Call Graph شاملاً
     *    لكل شيء.
     *  - لا حل لـ Kotlin أو أي ملف غير .java، ولا Android view binding، تمامًا
     *    كما طُلب في نطاق هذه المرحلة.
     *  - Enums: تُكتشف كـClassSymbol.Kind.ENUM، لكن قيم الـenum نفسها (constants)
     *    غير مُفهرَسة كـsymbols منفصلة في هذا الإصدار.
     */
    public static final class AstProjectAnalyzer {

        public AstAnalysisResult analyze(ProjectModel model) {
            AstAnalysisResult result = new AstAnalysisResult();

            javax.tools.JavaCompiler compiler = javax.tools.ToolProvider.getSystemJavaCompiler();
            if (compiler == null) {
                result.toolAvailable = false;
                return result; // لا نخمّن - لا يوجد compiler حقيقي في هذه البيئة
            }

            List<ProjectFile> javaFiles = new ArrayList<>();
            for (ProjectFile f : model.files) if (f.language == ProjectFile.Language.JAVA) javaFiles.add(f);
            if (javaFiles.isEmpty()) return result;

            List<InMemorySource> sources = new ArrayList<>();
            Map<String, ProjectFile> byUri = new HashMap<>();
            for (ProjectFile f : javaFiles) {
                InMemorySource src = new InMemorySource(f.relativePath, f.content);
                sources.add(src);
                byUri.put(src.toUri().toString(), f);
            }

            javax.tools.StandardJavaFileManager fm = compiler.getStandardFileManager(null, null, java.nio.charset.StandardCharsets.UTF_8);
            java.io.StringWriter diagWriter = new java.io.StringWriter();
            List<javax.tools.Diagnostic<? extends javax.tools.JavaFileObject>> diagnostics = new ArrayList<>();
            javax.tools.DiagnosticListener<javax.tools.JavaFileObject> diagListener = diagnostics::add;

            com.sun.source.util.JavacTask task;
            Iterable<? extends com.sun.source.tree.CompilationUnitTree> units;
            try {
                javax.tools.JavaCompiler.CompilationTask rawTask = compiler.getTask(
                        diagWriter, fm, diagListener, List.of("-proc:none"), null, sources);
                task = (com.sun.source.util.JavacTask) rawTask;
                units = task.parse();
                task.analyze();
            } catch (Exception e) {
                // فشل تشغيل الأداة نفسها (وليس خطأ في كود المستخدم) - نُبلغ بصدق ولا نُنتج graph جزئي مضلِّل
                result.toolAvailable = false;
                for (ProjectFile f : javaFiles) result.unparsableFiles.put(f.relativePath, "AST tool failure: " + e);
                return result;
            }

            // اجمع الملفات التي فيها ERROR diagnostics حقيقية - نستبعدها من استخراج الرموز لتفادي graph وهمي
            Set<String> filesWithErrors = new HashSet<>();
            for (var d : diagnostics) {
                if (d.getKind() == javax.tools.Diagnostic.Kind.ERROR && d.getSource() != null) {
                    ProjectFile f = byUri.get(d.getSource().toUri().toString());
                    if (f != null) {
                        filesWithErrors.add(f.relativePath);
                        result.unparsableFiles.merge(f.relativePath,
                                "line " + d.getLineNumber() + ": " + d.getMessage(null),
                                (a, b) -> a + " | " + b);
                    }
                }
            }

            com.sun.source.util.Trees trees = com.sun.source.util.Trees.instance(task);

            // مرحلة 1: استخراج ClassSymbol/MethodSymbol/FieldSymbol من الملفات السليمة فقط
            Map<com.sun.source.tree.CompilationUnitTree, ProjectFile> unitToFile = new HashMap<>();
            for (com.sun.source.tree.CompilationUnitTree unit : units) {
                ProjectFile f = byUri.get(unit.getSourceFile().toUri().toString());
                if (f == null) continue;
                unitToFile.put(unit, f);
                if (filesWithErrors.contains(f.relativePath)) continue; // لا نستخرج رموزًا من ملف به أخطاء compile حقيقية

                for (var typeDecl : unit.getTypeDecls()) {
                    if (!(typeDecl instanceof com.sun.source.tree.ClassTree ct)) continue;
                    ClassSymbol.Kind kind = switch (ct.getKind()) {
                        case INTERFACE -> ClassSymbol.Kind.INTERFACE;
                        case ENUM -> ClassSymbol.Kind.ENUM;
                        default -> ClassSymbol.Kind.CLASS;
                    };
                    String simpleName = ct.getSimpleName().toString();
                    int line = lineOf(unit, ct, trees);
                    String superName = ct.getExtendsClause() != null ? simpleTypeName(ct.getExtendsClause().toString()) : null;
                    List<String> ifaces = new ArrayList<>();
                    for (var it : ct.getImplementsClause()) ifaces.add(simpleTypeName(it.toString()));

                    // ---- الهوية المؤهَّلة: من Element الحقيقي إن أمكن، وإلا من package الملف ----
                    var classPath = trees.getPath(unit, ct);
                    javax.lang.model.element.Element classEl = classPath != null ? trees.getElement(classPath) : null;
                    String fqn = fqnOf(classEl, unit, simpleName);

                    String superFqn = null;
                    List<String> ifaceFqns = new ArrayList<>();
                    if (classEl instanceof javax.lang.model.element.TypeElement te) {
                        var sup = te.getSuperclass();
                        if (sup != null && sup.getKind() == javax.lang.model.type.TypeKind.DECLARED) {
                            var supEl = ((javax.lang.model.type.DeclaredType) sup).asElement();
                            String s = fqnOf(supEl, unit, null);
                            // نتجاهل java.lang.Object كأب "حقيقي" لتبقى دلالة superclassFqn متسقة مع superclassSimpleName
                            if (s != null && !s.equals("java.lang.Object")) superFqn = s;
                        }
                        for (var itf : te.getInterfaces()) {
                            if (itf.getKind() == javax.lang.model.type.TypeKind.DECLARED) {
                                String s = fqnOf(((javax.lang.model.type.DeclaredType) itf).asElement(), unit, null);
                                if (s != null) ifaceFqns.add(s);
                            }
                        }
                    }

                    result.classes.add(new ClassSymbol(simpleName, fqn, kind,
                            new SourceLocation(f.relativePath, line), superName, superFqn, ifaces, ifaceFqns));

                    for (var member : ct.getMembers()) {
                        if (member instanceof com.sun.source.tree.MethodTree mt) {
                            boolean isCtor = mt.getName().contentEquals("<init>");
                            List<String> paramTypes = new ArrayList<>();
                            for (var p : mt.getParameters()) paramTypes.add(simpleTypeName(p.getType().toString()));
                            String retType = mt.getReturnType() != null ? simpleTypeName(mt.getReturnType().toString()) : null;
                            int mLine = lineOf(unit, mt, trees);
                            result.methods.add(new MethodSymbol(simpleName, fqn, mt.getName().toString(), paramTypes,
                                    retType, new SourceLocation(f.relativePath, mLine), isCtor));
                        } else if (member instanceof com.sun.source.tree.VariableTree vt) {
                            int vLine = lineOf(unit, vt, trees);
                            result.fields.add(new FieldSymbol(simpleName, fqn, vt.getName().toString(),
                                    simpleTypeName(vt.getType().toString()), new SourceLocation(f.relativePath, vLine)));
                        }
                    }
                }
            }

            // مجموعة الهويات المؤهَّلة للمشروع - المرجع القاطع لتحديد "داخل المشروع"
            Set<String> projectFqns = new HashSet<>();
            for (ClassSymbol cs : result.classes) projectFqns.add(cs.fqn);

            // مرحلة 2: استخراج CallEdge/FieldRefEdge عبر Trees.getElement (دلالي حقيقي)، من الملفات السليمة فقط
            for (var entry : unitToFile.entrySet()) {
                com.sun.source.tree.CompilationUnitTree unit = entry.getKey();
                ProjectFile f = entry.getValue();
                if (filesWithErrors.contains(f.relativePath)) continue;

                new com.sun.source.util.TreePathScanner<Void, Deque<String[]>>() {
                    // كل عنصر بالمكدس: [ownerClassSimpleName, methodNameOrNull]
                    @Override
                    public Void visitClass(com.sun.source.tree.ClassTree node, Deque<String[]> ctxStack) {
                        return super.visitClass(node, ctxStack);
                    }

                    @Override
                    public Void visitMethod(com.sun.source.tree.MethodTree node, Deque<String[]> ctxStack) {
                        return super.visitMethod(node, ctxStack);
                    }

                    @Override
                    public Void visitMethodInvocation(com.sun.source.tree.MethodInvocationTree node, Deque<String[]> ctxStack) {
                        String[] ctx = currentContext(getCurrentPath());
                        if (ctx != null) {
                            var path = getCurrentPath();
                            var el = trees.getElement(path);
                            int line = (int) unit.getLineMap().getLineNumber(trees.getSourcePositions().getStartPosition(unit, node));
                            recordCallFromElement(ctx[0], ctx[1], ctx[2], el, node.toString(), f.relativePath, line);
                        }
                        return super.visitMethodInvocation(node, ctxStack);
                    }

                    @Override
                    public Void visitNewClass(com.sun.source.tree.NewClassTree node, Deque<String[]> ctxStack) {
                        String[] ctx = currentContext(getCurrentPath());
                        if (ctx != null) {
                            var path = getCurrentPath();
                            var el = trees.getElement(path);
                            int line = (int) unit.getLineMap().getLineNumber(trees.getSourcePositions().getStartPosition(unit, node));
                            recordCallFromElement(ctx[0], ctx[1], ctx[2], el, "new " + node.getIdentifier(), f.relativePath, line);
                        }
                        return super.visitNewClass(node, ctxStack);
                    }

                    // ---- استخراج FieldRefEdge حقيقي (هذه الدفعة) ----
                    // نغطي الحالتين النحويتين لقراءة/كتابة حقل:
                    //   1) IdentifierTree      : "client"        (وصول ضمني عبر this)
                    //   2) MemberSelectTree    : "obj.client"    (وصول صريح على كائن/كلاس)
                    // في الحالتين لا نعتمد على النص إطلاقًا - نسأل javac عبر
                    // Trees.getElement، ونقبل فقط ElementKind.FIELD ومالكًا داخل المشروع.

                    @Override
                    public Void visitIdentifier(com.sun.source.tree.IdentifierTree node, Deque<String[]> ctxStack) {
                        maybeRecordFieldRef(node);
                        return super.visitIdentifier(node, ctxStack);
                    }

                    @Override
                    public Void visitMemberSelect(com.sun.source.tree.MemberSelectTree node, Deque<String[]> ctxStack) {
                        maybeRecordFieldRef(node);
                        return super.visitMemberSelect(node, ctxStack);
                    }

                    private void maybeRecordFieldRef(com.sun.source.tree.Tree node) {
                        var path = getCurrentPath();
                        if (path == null) return;

                        // استبعد التعريف نفسه: "private ApiClient client = ...;" ليس مرجعًا للحقل
                        var parent = path.getParentPath() != null ? path.getParentPath().getLeaf() : null;
                        if (parent instanceof com.sun.source.tree.VariableTree vt && vt.getType() == node) return;

                        // استبعد اسم الدالة في استدعاء مثل "h.doWork()" - هذا CallEdge وليس FieldRefEdge.
                        // (العنصر هناك سيكون METHOD وليس FIELD، لكن نتجنب حتى السؤال لتقليل الضجيج.)
                        if (parent instanceof com.sun.source.tree.MethodInvocationTree mit
                                && mit.getMethodSelect() == node) return;

                        javax.lang.model.element.Element el;
                        try { el = trees.getElement(path); }
                        catch (Exception e) { return; } // لا نسجّل شيئًا عند فشل الاستعلام - لا تخمين

                        String[] ctx = currentContext(path);
                        if (ctx == null) return;

                        int line = (int) unit.getLineMap().getLineNumber(
                                trees.getSourcePositions().getStartPosition(unit, node));
                        SourceLocation loc = new SourceLocation(f.relativePath, line);

                        if (el == null) {
                            // غير محلول دلاليًا: لا نُسجّل edge وهمي إطلاقًا لهذا النوع.
                            // (التسجيل كـresolved=false هنا سيُنتج ضجيجًا هائلًا لكل معرّف في الملف،
                            //  لذا نتجاهله بصمت بدل تلويث الـgraph - وهذا حد مُعلن.)
                            return;
                        }
                        if (el.getKind() != javax.lang.model.element.ElementKind.FIELD) return;

                        var enclosing = el.getEnclosingElement();
                        String ownerSimpleName = (enclosing != null) ? enclosing.getSimpleName().toString() : null;
                        String ownerFqn = fqnOf(enclosing, unit, null);
                        if (ownerFqn == null || !projectFqns.contains(ownerFqn)) {
                            return; // حقل من مكتبة/JDK - خارج نطاق Project Graph، لا يُسجَّل
                        }

                        result.fieldRefEdges.add(new FieldRefEdge(
                                ctx[0], ctx[1], ctx[2], ownerSimpleName, ownerFqn,
                                el.getSimpleName().toString(), loc, true, null));
                    }

                    /** @return [ownerSimpleName, ownerFqn, methodNameOrNull] */
                    private String[] currentContext(com.sun.source.util.TreePath path) {
                        String ownerClass = null, methodName = null, ownerFqn = null;
                        for (var p = path; p != null; p = p.getParentPath()) {
                            var leaf = p.getLeaf();
                            if (methodName == null && leaf instanceof com.sun.source.tree.MethodTree mt) {
                                methodName = mt.getName().toString();
                            }
                            if (leaf instanceof com.sun.source.tree.ClassTree ct) {
                                ownerClass = ct.getSimpleName().toString();
                                var el = trees.getElement(p);
                                ownerFqn = fqnOf(el, unit, ownerClass);
                                break;
                            }
                        }
                        return ownerClass == null ? null : new String[]{ownerClass, ownerFqn, methodName};
                    }

                    private void recordCallFromElement(String callerClass, String callerFqn, String callerMethod,
                                                        javax.lang.model.element.Element el, String rawExpr,
                                                        String file, int line) {
                        SourceLocation loc = new SourceLocation(file, line);
                        if (el == null) {
                            result.callEdges.add(new CallEdge(callerClass, callerFqn, callerMethod,
                                    "?", "?", rawExpr, loc, false,
                                    "تعذّر الربط الدلالي (Trees.getElement أرجعت null) - غالبًا بسبب خطأ compile آخر في المشروع أو overload غامض."));
                            return;
                        }
                        var enclosing = el.getEnclosingElement();
                        String ownerSimpleName = (enclosing != null) ? enclosing.getSimpleName().toString() : null;
                        String ownerFqn = fqnOf(enclosing, unit, null);
                        String calleeMethodName = el.getSimpleName().toString();
                        if (ownerFqn == null || !projectFqns.contains(ownerFqn)) {
                            // مكتبة خارجية/JDK - محلولة دلاليًا فعليًا لكن خارج نطاق Project Graph لهذا الإصدار
                            result.callEdges.add(new CallEdge(callerClass, callerFqn, callerMethod,
                                    ownerSimpleName == null ? "?" : ownerSimpleName,
                                    ownerFqn == null ? "?" : ownerFqn, calleeMethodName, loc, false,
                                    "الهدف محلول دلاليًا لكنه خارج المشروع (مكتبة/JDK) - غير مُسجَّل كعلاقة مشروع."));
                            return;
                        }
                        result.callEdges.add(new CallEdge(callerClass, callerFqn, callerMethod,
                                ownerSimpleName, ownerFqn, calleeMethodName, loc, true, null));
                    }
                }.scan(unit, new ArrayDeque<>());
            }

            return result;
        }

        private int lineOf(com.sun.source.tree.CompilationUnitTree unit, com.sun.source.tree.Tree node,
                            com.sun.source.util.Trees trees) {
            long pos = trees.getSourcePositions().getStartPosition(unit, node);
            if (pos < 0) return -1;
            return (int) unit.getLineMap().getLineNumber(pos);
        }

        /**
         * يستخرج الهوية المؤهَّلة (FQN) من Element حقيقي صادر عن javac.
         * إن تعذّر ذلك (Element غير متاح)، يسقط إلى بناء الاسم من إعلان package
         * الخاص بالملف - وهذا لا يزال دقيقًا لأنواع المستوى الأعلى في Java.
         * @return null إذا لم يمكن تحديد هوية موثوقة (لا تخمين).
         */
        private String fqnOf(javax.lang.model.element.Element el,
                              com.sun.source.tree.CompilationUnitTree unit, String fallbackSimpleName) {
            if (el instanceof javax.lang.model.element.TypeElement te) {
                return te.getQualifiedName().toString();
            }
            if (el != null && el.getKind() == javax.lang.model.element.ElementKind.PACKAGE) {
                return null;
            }
            if (fallbackSimpleName == null) return null;
            var pkg = unit.getPackageName();
            return pkg == null ? fallbackSimpleName : pkg.toString() + "." + fallbackSimpleName;
        }

        /** يحوّل "com.example.Helper" أو "Helper<T>" إلى "Helper" - اسم بسيط فقط، كما هو مُعلن في حدود هذا الإصدار. */
        private String simpleTypeName(String raw) {            if (raw == null) return null;
            String s = raw.trim();
            int lt = s.indexOf('<');
            if (lt >= 0) s = s.substring(0, lt);
            int dot = s.lastIndexOf('.');
            if (dot >= 0) s = s.substring(dot + 1);
            return s.trim();
        }

        private static final class InMemorySource extends javax.tools.SimpleJavaFileObject {
            final String code;
            InMemorySource(String relativePath, String code) {
                super(java.net.URI.create("string:///" + relativePath), Kind.SOURCE);
                this.code = code;
            }
            @Override public CharSequence getCharContent(boolean ignoreEncodingErrors) { return code; }
        }
    }

    // ---------------- ProjectIndexer ----------------

    public static final class ProjectIndexer {
        private static final Pattern CLASS_DECL =
                Pattern.compile("\\b(?:public|final|abstract)?\\s*class\\s+([A-Za-z_][A-Za-z0-9_]*)");
        private static final Pattern FIELD_DECL =
                Pattern.compile("(?m)^\\s*(?:private|protected|public)\\s+([A-Za-z_][A-Za-z0-9_]*)\\s+([A-Za-z_][A-Za-z0-9_]*)\\s*(=[^;]*)?;");

        public ProjectModel index(Path rootDir) throws IOException {
            ProjectModel model = new ProjectModel(rootDir);
            if (!Files.exists(rootDir)) return model;
            try (Stream<Path> walk = Files.walk(rootDir)) {
                for (Path p : walk.filter(Files::isRegularFile).toList()) {
                    String rel = rootDir.relativize(p).toString().replace('\\', '/');
                    String content;
                    try { content = Files.readString(p); } catch (IOException e) { continue; }
                    ProjectFile.Language lang = p.toString().endsWith(".java")
                            ? ProjectFile.Language.JAVA : ProjectFile.Language.UNSUPPORTED;
                    model.files.add(new ProjectFile(p, rel, lang, content));
                }
            }
            return model;
        }

        /**
         * السلوك الأصلي (regex فقط) - لم يتغيّر حرفيًا. ProjectRepairEngine.repairProject()
         * ما زال يستخدم هذه بالضبط، حتى لا يتأثر أي سلوك إصلاح موجود بهذه المرحلة.
         */
        public ProjectGraph buildGraph(ProjectModel model) {
            ProjectGraph graph = new ProjectGraph();
            for (ProjectFile f : model.files) {
                if (f.language != ProjectFile.Language.JAVA) continue;
                Matcher m = CLASS_DECL.matcher(f.content);
                if (m.find()) graph.registerClass(m.group(1), f.relativePath);
            }
            for (ProjectFile f : model.files) {
                if (f.language != ProjectFile.Language.JAVA) continue;
                Matcher cm = CLASS_DECL.matcher(f.content);
                if (!cm.find()) continue;
                String owner = cm.group(1);
                Matcher fm = FIELD_DECL.matcher(f.content);
                while (fm.find()) {
                    String fieldType = fm.group(1);
                    if (graph.knowsClass(fieldType) && !fieldType.equals(owner)) {
                        graph.addDependency(owner, fieldType);
                    }
                }
            }
            return graph;
        }

        /**
         * جديد (المرحلة الأولى - Project Understanding): يبني نفس الـgraph القديم
         * (buildGraph) ثم يُثريه بمعلومات AST/دلالية حقيقية عبر AstProjectAnalyzer.
         * لا يُستخدم حاليًا داخل ProjectRepairEngine.repairProject() - قدرة إضافية
         * مستقلة يمكن تفعيلها لاحقًا في مرحلة الإصلاح الفعلي القادمة.
         */
        public ProjectGraph buildAstGraph(ProjectModel model) {
            ProjectGraph graph = buildGraph(model);
            AstAnalysisResult ast = new AstProjectAnalyzer().analyze(model);
            graph.attachAst(ast);
            return graph;
        }
    }

    // ---------------- Evidence / Issue / RootCause ----------------

    public static final class Evidence {
        public enum Kind { STATIC_TEXT_MATCH, COMPILER_OUTPUT, RUNTIME_OUTPUT, GRAPH_RELATIONSHIP, AI_HYPOTHESIS }
        public final Kind kind;
        public final String sourceFile;
        public final int line;
        public final String detail;

        public Evidence(Kind kind, String sourceFile, int line, String detail) {
            this.kind = kind; this.sourceFile = sourceFile; this.line = line; this.detail = detail;
        }
        @Override public String toString() {
            return "[" + kind + "] " + (sourceFile != null ? sourceFile + ":" + line + " - " : "") + detail;
        }
    }

    public static final class Issue {
        public enum Type { UNINITIALIZED_FIELD_NPE_RISK }
        public final Type type;
        public final String primaryFile;
        public final int primaryLine;
        public final String description;
        public final List<Evidence> evidence = new ArrayList<>();

        public Issue(Type type, String primaryFile, int primaryLine, String description) {
            this.type = type; this.primaryFile = primaryFile; this.primaryLine = primaryLine; this.description = description;
        }
        public void addEvidence(Evidence e) { evidence.add(e); }
    }

    public static final class RootCause {
        public enum ConfidenceLevel { HIGH, MEDIUM, LOW }

        public static final class Hypothesis {
            public final String description;
            public final String suspectFile;
            public final List<Evidence> supportingEvidence = new ArrayList<>();
            public boolean confirmed = false;
            public Hypothesis(String description, String suspectFile) {
                this.description = description; this.suspectFile = suspectFile;
            }
        }

        public final Hypothesis confirmedHypothesis;
        public final String rootCauseFile;
        public final int rootCauseLine;
        public final ConfidenceLevel confidence;
        public final List<Evidence> evidence;

        public RootCause(Hypothesis confirmedHypothesis, String rootCauseFile, int rootCauseLine,
                          ConfidenceLevel confidence, List<Evidence> evidence) {
            if (evidence == null || evidence.isEmpty()) {
                throw new IllegalArgumentException("RootCause requires at least one Evidence.");
            }
            this.confirmedHypothesis = confirmedHypothesis;
            this.rootCauseFile = rootCauseFile;
            this.rootCauseLine = rootCauseLine;
            this.confidence = confidence;
            this.evidence = evidence;
        }
    }

    // ---------------- IssueAnalyzer ----------------

    public interface IssueAnalyzer {
        List<Issue> analyze(ProjectModel model, ProjectGraph graph);
        String name();
    }

    public static final class UninitializedFieldAnalyzer implements IssueAnalyzer {
        private static final Pattern FIELD_NO_INIT =
                Pattern.compile("(?m)^(\\s*)(?:private|protected)\\s+([A-Za-z_][A-Za-z0-9_]*)\\s+([A-Za-z_][A-Za-z0-9_]*)\\s*;\\s*$");

        @Override public String name() { return "UninitializedFieldAnalyzer"; }

        @Override
        public List<Issue> analyze(ProjectModel model, ProjectGraph graph) {
            List<Issue> issues = new ArrayList<>();
            for (ProjectFile f : model.files) {
                if (f.language != ProjectFile.Language.JAVA) continue;
                String[] lines = f.content.split("\n", -1);
                Matcher fm = FIELD_NO_INIT.matcher(f.content);
                while (fm.find()) {
                    String fieldType = fm.group(2);
                    String fieldName = fm.group(3);
                    if (!graph.knowsClass(fieldType)) continue;

                    int declLine = lineNumberAt(f.content, fm.start());
                    Pattern assignment = Pattern.compile(Pattern.quote(fieldName) + "\\s*=[^=]");
                    if (assignment.matcher(f.content).find()) continue;

                    Pattern usage = Pattern.compile(Pattern.quote(fieldName) + "\\s*\\.\\s*[A-Za-z_][A-Za-z0-9_]*\\s*\\(");
                    Matcher um = usage.matcher(f.content);
                    if (um.find()) {
                        int useLine = lineNumberAt(f.content, um.start());
                        Issue issue = new Issue(Issue.Type.UNINITIALIZED_FIELD_NPE_RISK, f.relativePath, useLine,
                                "استدعاء method على الحقل '" + fieldName + "' (نوعه " + fieldType
                                        + ") دون أي تعيين ظاهر له في هذا الملف - خطر NullPointerException حقيقي عند التشغيل.");
                        issue.addEvidence(new Evidence(Evidence.Kind.STATIC_TEXT_MATCH, f.relativePath, declLine,
                                "تعريف الحقل بدون تهيئة: " + lines[declLine - 1].trim()));
                        issue.addEvidence(new Evidence(Evidence.Kind.STATIC_TEXT_MATCH, f.relativePath, useLine,
                                "استخدام الحقل دون تعيين سابق: " + lines[useLine - 1].trim()));
                        issue.addEvidence(new Evidence(Evidence.Kind.GRAPH_RELATIONSHIP, f.relativePath, declLine,
                                "النوع '" + fieldType + "' مُعرَّف في الملف: " + graph.fileForClass(fieldType)));
                        issues.add(issue);
                    }
                }
            }
            return issues;
        }

        private int lineNumberAt(String content, int charIndex) {
            int line = 1;
            for (int i = 0; i < charIndex && i < content.length(); i++) if (content.charAt(i) == '\n') line++;
            return line;
        }
    }

    // ---------------- RootCauseAnalyzer ----------------

    public interface RootCauseAnalyzer {
        RootCause analyze(Issue issue, ProjectModel model, ProjectGraph graph);
    }

    public static final class DefaultRootCauseAnalyzer implements RootCauseAnalyzer {
        @Override
        public RootCause analyze(Issue issue, ProjectModel model, ProjectGraph graph) {
            if (issue.type != Issue.Type.UNINITIALIZED_FIELD_NPE_RISK) return null;
            if (issue.evidence.isEmpty()) return null;

            RootCause.Hypothesis hyp = new RootCause.Hypothesis(
                    "الحقل غير مُهيَّأ في نقطة تعريفه ولا يوجد أي تعيين له قبل استخدامه ضمن نفس الملف",
                    issue.primaryFile);
            hyp.supportingEvidence.addAll(issue.evidence);
            hyp.confirmed = true;

            boolean crossFileEvidence = issue.evidence.stream()
                    .anyMatch(e -> e.kind == Evidence.Kind.GRAPH_RELATIONSHIP);

            return new RootCause(hyp, issue.primaryFile, issue.primaryLine,
                    crossFileEvidence ? RootCause.ConfidenceLevel.HIGH : RootCause.ConfidenceLevel.MEDIUM,
                    new ArrayList<>(issue.evidence));
        }
    }

    // ---------------- RepairPlan / RepairPlanner ----------------

    public static final class RepairPlan {
        public final String targetFile;
        public final String description;
        public final int anchorLine;
        public final String proposedLineReplacement;

        public RepairPlan(String targetFile, String description, int anchorLine, String proposedLineReplacement) {
            this.targetFile = targetFile; this.description = description;
            this.anchorLine = anchorLine; this.proposedLineReplacement = proposedLineReplacement;
        }
    }

    public interface RepairPlanner {
        RepairPlan plan(RootCause rootCause, Issue issue, ProjectModel model, ProjectGraph graph);
    }

    public static final class DefaultRepairPlanner implements RepairPlanner {
        private static final Pattern FIELD_LINE =
                Pattern.compile("^(\\s*)(private|protected)\\s+([A-Za-z_][A-Za-z0-9_]*)\\s+([A-Za-z_][A-Za-z0-9_]*)\\s*;\\s*$");

        @Override
        public RepairPlan plan(RootCause rootCause, Issue issue, ProjectModel model, ProjectGraph graph) {
            if (issue.type != Issue.Type.UNINITIALIZED_FIELD_NPE_RISK) return null;
            ProjectFile file = model.findByRelativePath(rootCause.rootCauseFile);
            if (file == null) return null;

            String[] lines = file.content.split("\n", -1);
            int declLine = -1; String type = null, name = null;
            for (Evidence e : issue.evidence) {
                if (e.kind == Evidence.Kind.STATIC_TEXT_MATCH && e.line > 0 && e.line <= lines.length) {
                    Matcher m = FIELD_LINE.matcher(lines[e.line - 1]);
                    if (m.matches()) { declLine = e.line; type = m.group(3); name = m.group(4); break; }
                }
            }
            if (declLine == -1) return null;

            Matcher exact = FIELD_LINE.matcher(lines[declLine - 1]);
            if (!exact.matches()) return null;
            String indent = exact.group(1);
            String modifier = exact.group(2);
            String replacement = indent + modifier + " " + type + " " + name + " = new " + type + "();";

            return new RepairPlan(file.relativePath,
                    "تهيئة الحقل '" + name + "' من النوع '" + type + "' عند التعريف مباشرة (new " + type + "()) "
                            + "بدل تركه بدون تهيئة - إصلاح دنيوي لا يلمس أي سطر آخر.",
                    declLine, replacement);
        }
    }

    // ---------------- Patch / PatchEngine ----------------

    public static final class Patch {
        public final String relativePath;
        public final String beforeContent;
        public final String afterContent;
        public final String unifiedDiff;

        public Patch(String relativePath, String beforeContent, String afterContent, String unifiedDiff) {
            this.relativePath = relativePath; this.beforeContent = beforeContent;
            this.afterContent = afterContent; this.unifiedDiff = unifiedDiff;
        }
    }

    public static final class PatchEngine {
        public Patch generate(RepairPlan plan, ProjectModel model) {
            ProjectFile file = model.findByRelativePath(plan.targetFile);
            if (file == null) throw new IllegalArgumentException("targetFile غير موجود: " + plan.targetFile);

            String[] lines = file.content.split("\n", -1);
            if (plan.anchorLine < 1 || plan.anchorLine > lines.length) {
                throw new IllegalArgumentException("anchorLine خارج حدود الملف: " + plan.anchorLine);
            }
            String beforeLine = lines[plan.anchorLine - 1];
            StringBuilder after = new StringBuilder();
            for (int i = 0; i < lines.length; i++) {
                after.append(i == plan.anchorLine - 1 ? plan.proposedLineReplacement : lines[i]);
                if (i < lines.length - 1) after.append('\n');
            }
            String diff = "--- a/" + plan.targetFile + "\n" + "+++ b/" + plan.targetFile + "\n"
                    + "@@ line " + plan.anchorLine + " @@\n" + "-" + beforeLine + "\n" + "+" + plan.proposedLineReplacement;
            return new Patch(plan.targetFile, file.content, after.toString(), diff);
        }
    }

    // ---------------- WorkspaceManager ----------------

    public static final class WorkspaceManager {
        private final Path originalRoot;
        private final Path workspaceRoot;
        private final Map<String, String> preModificationSnapshot = new HashMap<>();

        private WorkspaceManager(Path originalRoot, Path workspaceRoot) {
            this.originalRoot = originalRoot; this.workspaceRoot = workspaceRoot;
        }

        public static WorkspaceManager createIsolatedCopy(Path originalRoot, Path workDir) throws IOException {
            Path workspace = Files.createDirectories(workDir.resolve("workspace_" + System.nanoTime()));
            if (Files.exists(originalRoot)) {
                Files.walkFileTree(originalRoot, new SimpleFileVisitor<Path>() {
                    @Override public FileVisitResult preVisitDirectory(Path dir, BasicFileAttributes a) throws IOException {
                        Files.createDirectories(workspace.resolve(originalRoot.relativize(dir)));
                        return FileVisitResult.CONTINUE;
                    }
                    @Override public FileVisitResult visitFile(Path file, BasicFileAttributes a) throws IOException {
                        Files.copy(file, workspace.resolve(originalRoot.relativize(file)), StandardCopyOption.REPLACE_EXISTING);
                        return FileVisitResult.CONTINUE;
                    }
                });
            }
            return new WorkspaceManager(originalRoot, workspace);
        }

        public Path getWorkspaceRoot() { return workspaceRoot; }

        public void applyPatch(Patch patch) throws IOException {
            Path target = workspaceRoot.resolve(patch.relativePath);
            if (!preModificationSnapshot.containsKey(patch.relativePath)) {
                preModificationSnapshot.put(patch.relativePath, Files.exists(target) ? Files.readString(target) : null);
            }
            Files.writeString(target, patch.afterContent);
        }

        public void rollback(String relativePath) throws IOException {
            String snapshot = preModificationSnapshot.get(relativePath);
            if (snapshot == null) return;
            Files.writeString(workspaceRoot.resolve(relativePath), snapshot);
        }

        public String readWorkspaceFile(String relativePath) throws IOException {
            return Files.readString(workspaceRoot.resolve(relativePath));
        }

        public boolean isIdenticalToOriginal(String relativePath) throws IOException {
            Path orig = originalRoot.resolve(relativePath);
            Path ws = workspaceRoot.resolve(relativePath);
            if (!Files.exists(orig) || !Files.exists(ws)) return false;
            return Files.readString(orig).equals(Files.readString(ws));
        }

        public void dispose() throws IOException {
            if (!Files.exists(workspaceRoot)) return;
            Files.walkFileTree(workspaceRoot, new SimpleFileVisitor<Path>() {
                @Override public FileVisitResult visitFile(Path file, BasicFileAttributes a) throws IOException {
                    Files.delete(file); return FileVisitResult.CONTINUE;
                }
                @Override public FileVisitResult postVisitDirectory(Path dir, IOException exc) throws IOException {
                    Files.delete(dir); return FileVisitResult.CONTINUE;
                }
            });
        }
    }

    // ---------------- VerificationResult / VerificationEngine ----------------

    public static final class VerificationResult {
        public enum Status { VERIFIED, PARTIALLY_VERIFIED, NOT_VERIFIED, FAILED, UNAVAILABLE }
        public Status status;
        public final List<String> checkLog = new ArrayList<>();
        public boolean compileAttempted = false, compileSucceeded = false;
        public String compilerOutput = "";
        public boolean runtimeAttempted = false, runtimeSucceeded = false;
        public String runtimeOutput = "";
        public void log(String s) { checkLog.add(s); }
    }

    public interface VerificationEngine {
        VerificationResult verify(Path workspaceRoot, String mainClassFqcn);
    }

    /**
     * ⚠️ يستخدم ProcessBuilder فعليًا (javac/java) - انظر الملاحظة المعمارية
     * أعلى الملف حول لماذا هذا مقبول هنا وغير قابل للنقل كما هو داخل تطبيق Android.
     * لا يوجد Gradle/Android backend - أي بيئة تحتاجه تحصل على ANDROID_BUILD_UNAVAILABLE
     * (مُعاد كـ UNAVAILABLE هنا) بدل ادعاء بناء ناجح.
     */
    public static final class JavacVerificationEngine implements VerificationEngine {
        private static final int TIMEOUT_SECONDS = 15;

        @Override
        public VerificationResult verify(Path workspaceRoot, String mainClassFqcn) {
            VerificationResult result = new VerificationResult();

            List<Path> javaFiles;
            try (Stream<Path> walk = Files.walk(workspaceRoot)) {
                javaFiles = walk.filter(p -> p.toString().endsWith(".java")).toList();
            } catch (IOException e) {
                result.status = VerificationResult.Status.UNAVAILABLE;
                result.log("تعذّر قراءة workspace: " + e.getMessage());
                return result;
            }
            if (javaFiles.isEmpty()) {
                result.status = VerificationResult.Status.NOT_VERIFIED;
                result.log("لا توجد ملفات .java للتحقق منها.");
                return result;
            }

            Path outDir;
            try { outDir = Files.createDirectories(workspaceRoot.resolve("_verify_out")); }
            catch (IOException e) {
                result.status = VerificationResult.Status.UNAVAILABLE;
                result.log("تعذّر إنشاء مجلد إخراج compile: " + e.getMessage());
                return result;
            }

            result.compileAttempted = true;
            try {
                List<String> cmd = new ArrayList<>(List.of("javac", "-d", outDir.toString()));
                for (Path p : javaFiles) cmd.add(p.toString());
                ProcessBuilder pb = new ProcessBuilder(cmd);
                pb.redirectErrorStream(true);
                Process proc = pb.start();
                String output = new String(proc.getInputStream().readAllBytes());
                if (!proc.waitFor(TIMEOUT_SECONDS, TimeUnit.SECONDS)) {
                    proc.destroyForcibly();
                    result.status = VerificationResult.Status.FAILED;
                    result.log("انتهت مهلة javac - اعتُبر فشلًا.");
                    return result;
                }
                int exit = proc.exitValue();
                result.compilerOutput = output;
                result.compileSucceeded = (exit == 0);
                result.log("javac exit=" + exit + (output.isBlank() ? "" : "\n" + output));
                if (!result.compileSucceeded) { result.status = VerificationResult.Status.FAILED; return result; }
            } catch (IOException e) {
                result.status = VerificationResult.Status.UNAVAILABLE;
                result.log("javac غير متاح فعليًا في هذه البيئة: " + e.getMessage());
                return result;
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
                result.status = VerificationResult.Status.UNAVAILABLE;
                result.log("انقطع تنفيذ javac: " + e.getMessage());
                return result;
            }

            if (mainClassFqcn == null || mainClassFqcn.isBlank()) {
                result.status = VerificationResult.Status.PARTIALLY_VERIFIED;
                result.log("تحقق compile فقط - لا mainClass محدد لتشغيل سلوكي.");
                return result;
            }

            result.runtimeAttempted = true;
            try {
                ProcessBuilder pb = new ProcessBuilder("java", "-cp", outDir.toString(), mainClassFqcn);
                pb.redirectErrorStream(true);
                Process proc = pb.start();
                String output = new String(proc.getInputStream().readAllBytes());
                if (!proc.waitFor(TIMEOUT_SECONDS, TimeUnit.SECONDS)) {
                    proc.destroyForcibly();
                    result.status = VerificationResult.Status.FAILED;
                    result.log("انتهت مهلة التشغيل.");
                    return result;
                }
                int exit = proc.exitValue();
                result.runtimeOutput = output;
                result.runtimeSucceeded = (exit == 0) && !output.contains("Exception");
                result.log("java exit=" + exit + "\noutput:\n" + output);
                result.status = result.runtimeSucceeded ? VerificationResult.Status.VERIFIED : VerificationResult.Status.FAILED;
                return result;
            } catch (IOException e) {
                result.status = VerificationResult.Status.UNAVAILABLE;
                result.log("java غير متاح فعليًا في هذه البيئة: " + e.getMessage());
                return result;
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
                result.status = VerificationResult.Status.UNAVAILABLE;
                result.log("انقطع تنفيذ java: " + e.getMessage());
                return result;
            }
        }
    }

    // ---------------- RollbackManager ----------------

    public static final class RollbackManager {
        public boolean rollback(WorkspaceManager workspace, String relativePath, StringBuilder reasonOut) {
            try { workspace.rollback(relativePath); return true; }
            catch (IOException e) { reasonOut.append("فشل rollback فعليًا: ").append(e.getMessage()); return false; }
        }
    }

    // ---------------- RepairSession ----------------

    public static final class RepairSession {
        public enum AttemptStatus { PENDING, FAILED, ROLLED_BACK, ACCEPTED }

        public static final class Attempt {
            public final int attemptNumber;
            public final Patch patch;
            public VerificationResult verification;
            public AttemptStatus status;
            public String note;
            public Attempt(int attemptNumber, Patch patch) { this.attemptNumber = attemptNumber; this.patch = patch; }
        }

        public final String sessionId = UUID.randomUUID().toString();
        public final Issue issue;
        public final RootCause rootCause;
        public final List<Attempt> attempts = new ArrayList<>();
        public final int maxAttempts;
        public WorkspaceManager workspace;

        public RepairSession(Issue issue, RootCause rootCause, int maxAttempts) {
            this.issue = issue; this.rootCause = rootCause; this.maxAttempts = maxAttempts;
        }
        public boolean limitReached() { return attempts.size() >= maxAttempts; }
    }

    // ---------------- RepairResult ----------------

    public static final class RepairResult {
        public enum FinalStatus {
            NO_ISSUES_FOUND, ACCEPTED, FAILED_ALL_ATTEMPTS, NOT_VERIFIED, UNSUPPORTED, AI_UNAVAILABLE
        }

        public final String sessionId;
        public FinalStatus finalStatus;
        public Issue issue;
        public final List<RootCause.Hypothesis> hypotheses = new ArrayList<>();
        public RootCause selectedRootCause;
        public final List<Evidence> evidence = new ArrayList<>();
        public final List<String> affectedFiles = new ArrayList<>();
        public RepairPlan repairPlan;
        public Patch finalPatch;
        public VerificationResult verificationResult;
        public boolean rolledBack = false;
        public final List<RepairSession.Attempt> attempts = new ArrayList<>();
        public final List<String> warnings = new ArrayList<>();
        public RootCause.ConfidenceLevel confidence;
        public AIReasoningLayer.AIStatus aiStatus;

        public RepairResult(String sessionId) { this.sessionId = sessionId; }
    }

    // ---------------- RepairPackage ----------------

    public static final class RepairPackage {
        public final String sessionId;
        public final String targetFile;
        public final String unifiedDiff;
        public final String reason;
        public final RootCause.ConfidenceLevel confidence;
        public final VerificationResult verification;
        public final String applyInstructions;

        public RepairPackage(String sessionId, String targetFile, String unifiedDiff, String reason,
                              RootCause.ConfidenceLevel confidence, VerificationResult verification) {
            this.sessionId = sessionId; this.targetFile = targetFile; this.unifiedDiff = unifiedDiff;
            this.reason = reason; this.confidence = confidence; this.verification = verification;
            this.applyInstructions =
                    "1) افتح الملف: " + targetFile + "\n"
                    + "2) طبّق التعديل الموضّح في الـdiff يدويًا.\n"
                    + "3) هذا الـpatch اجتاز compile+runtime verification حقيقيين داخل workspace معزولة فقط - "
                    + "لم يُطبَّق تلقائيًا على مشروعك الأصلي ولا على بيئة Android/Gradle حقيقية.\n"
                    + "4) راجع التعديل قبل تطبيقه على مشروعك الفعلي.";
        }
    }

    // ---------------- AIReasoningLayer ----------------

    /**
     * طبقة استدلال قابلة لاستبدال المزود (Provider-agnostic). دورها فقط:
     * UNDERSTAND -> REASON -> HYPOTHESIZE -> PLAN(اقتراح) -> PROPOSE PATCH(اقتراح).
     * لا تملك أي صلاحية لإعلان نجاح الإصلاح - القرار النهائي دائمًا من
     * VerificationEngine عبر ProjectRepairEngine.repairProject، وليس من هنا.
     */
    public interface AIReasoningLayer {

        enum AIStatus { AI_UNAVAILABLE, AI_ANALYZED }

        final class AIContext {
            public final ProjectModel model;
            public final ProjectGraph graph;
            public final Issue issue;
            public final String stackTrace;   // قد يكون null
            public final String logs;         // قد يكون null
            public AIContext(ProjectModel model, ProjectGraph graph, Issue issue, String stackTrace, String logs) {
                this.model = model; this.graph = graph; this.issue = issue;
                this.stackTrace = stackTrace; this.logs = logs;
            }
        }

        final class AIAnalysis {
            public final AIStatus status;
            public final List<RootCause.Hypothesis> hypotheses;
            public final String unavailableReason; // غير null فقط عند AI_UNAVAILABLE

            private AIAnalysis(AIStatus status, List<RootCause.Hypothesis> hypotheses, String unavailableReason) {
                this.status = status; this.hypotheses = hypotheses; this.unavailableReason = unavailableReason;
            }
            public static AIAnalysis unavailable(String reason) {
                return new AIAnalysis(AIStatus.AI_UNAVAILABLE, List.of(), reason);
            }
            public static AIAnalysis analyzed(List<RootCause.Hypothesis> hypotheses) {
                return new AIAnalysis(AIStatus.AI_ANALYZED, hypotheses, null);
            }
        }

        AIAnalysis analyze(AIContext context);
    }

    /**
     * التطبيق الوحيد المتاح في هذا الإصدار: لا يوجد مزود AI حقيقي متصل
     * (لا API key، لا اتصال شبكي لخدمة استدلال). يُرجع AI_UNAVAILABLE بصدق
     * دائمًا - لا يُختلق أي تحليل. استبداله بمزود حقيقي لاحقًا لا يتطلب تعديل
     * أي شيء آخر في هذا الملف طالما التزم بواجهة AIReasoningLayer.
     */
    public static final class NoOpAIReasoningLayer implements AIReasoningLayer {
        @Override
        public AIAnalysis analyze(AIContext context) {
            return AIAnalysis.unavailable("لا يوجد مزود AI متصل بهذا الإصدار (لا API key / لا اتصال بخدمة استدلال).");
        }
    }
}
