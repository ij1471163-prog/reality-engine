package com.naif.projectrepair;

import com.naif.projectrepair.ProjectRepairEngine.*;

import java.io.IOException;
import java.nio.file.*;
import java.util.List;

/**
 * Test Harness خارجي (للاختبار فقط، كما سمح المستخدم صراحة) - لا يُضاف كملف
 * Engine جديد، ولا يحتوي أي منطق إصلاح خاص به. كل اختبار يستدعي فعليًا
 * ProjectRepairEngine (الملف الواحد) عبر Classes الداخلية العامة (public static nested).
 */
public final class EngineTests {

    static int passed = 0, failed = 0;

    public static void main(String[] args) throws Exception {
        Path fixturesRoot = Paths.get(args[0]);
        Path workDir = Files.createTempDirectory("projectrepair-single-tests");

        test01_multiFileProjectIndexed(fixturesRoot);
        test02_dependencyDetected(fixturesRoot);
        test03_rootCauseCrossFileEvidence(fixturesRoot);
        test04_realPatchGenerated(fixturesRoot);
        test05_patchAppliedToWorkspaceOnly(fixturesRoot, workDir);
        test06_diffCorrectness(fixturesRoot);
        test07_fullRepairAcceptedWithRealVerification(fixturesRoot, workDir);
        test08_failedRepairDetected(workDir);
        test09_rollbackRestoresOriginal(workDir);
        test10_multipleAttemptsRespectsLimit(workDir);
        test11_noBugProject(fixturesRoot, workDir);
        test12_emptyProject(workDir);
        test13_malformedProjectFailsCompileHonestly(fixturesRoot, workDir);
        test14_unsupportedLanguageReported(fixturesRoot, workDir);
        test15_unaffectedFilesUntouched(fixturesRoot, workDir);
        test16_aiUnavailableReportedHonestly(fixturesRoot, workDir);
        test17_compileOnlyIsNotAcceptedAsFixed(fixturesRoot, workDir);

        // ---- Phase 1: Project Understanding / AST call-graph tests ----
        test18_methodDiscoveredInsideClass(fixturesRoot);
        test19_methodToMethodCallDetected(fixturesRoot);
        test20_callerCalleeDirectionCorrect(fixturesRoot);
        test21_constructorCallDetected(fixturesRoot);
        test22_inheritanceDetected(fixturesRoot);
        test23_interfaceImplementationDetected(fixturesRoot);
        test24_fieldDeclarationDiscovered(fixturesRoot);
        test24b_fieldReferenceEdgeExtracted(fixturesRoot);
        test24c_fieldRefNotCreatedForDeclarationItself(fixturesRoot);
        test24d_inheritedFieldReferenceResolvedToDeclaringClass(fixturesRoot);
        test24e_noFieldRefEdgesForExternalOrUnresolved(workDir);
        test25_crossFileMethodReferenceResolved(fixturesRoot);
        test26_callChainAcrossFourClasses(fixturesRoot);
        test27_noFalseEdgesRecorded(fixturesRoot);
        test28_unresolvedCallHandledHonestly(workDir);
        test29_malformedProjectNoFakeGraph(fixturesRoot);
        test30_originalFilesUntouchedByAstAnalysis(fixturesRoot);

        // ---- FQN Symbol Identity ----
        test31_collisionBothClassesSurvive(fixturesRoot);
        test32_ambiguousSimpleNameNotGuessed(fixturesRoot);
        test33_callEdgesResolveToCorrectPackage(fixturesRoot);
        test34_fqnApisDisambiguate(fixturesRoot);
        test35_fqnCallChainNotConfusedByCollision(fixturesRoot);
        test36_uniqueSimpleNamesStillWorkViaCompatLayer(fixturesRoot);

        System.out.println("\n==== SUMMARY: " + passed + " passed, " + failed + " failed ====");
        if (failed > 0) System.exit(1);
    }

    private static void check(String name, boolean condition, String detail) {
        if (condition) { passed++; System.out.println("PASS - " + name); }
        else { failed++; System.out.println("FAIL - " + name + " :: " + detail); }
    }

    static void test01_multiFileProjectIndexed(Path fixturesRoot) throws IOException {
        ProjectIndexer indexer = new ProjectIndexer();
        ProjectModel model = indexer.index(fixturesRoot.resolve("scenario_basic"));
        check("01_multiFileProjectIndexed", model.files.size() == 3, "expected 3 files, got " + model.files.size());
    }

    static void test02_dependencyDetected(Path fixturesRoot) throws IOException {
        ProjectIndexer indexer = new ProjectIndexer();
        ProjectModel model = indexer.index(fixturesRoot.resolve("scenario_basic"));
        ProjectGraph graph = indexer.buildGraph(model);
        check("02_dependencyDetected", graph.dependenciesOf("ServiceConsumer").contains("Helper"),
                "ServiceConsumer->Helper dependency not found: " + graph.dependenciesOf("ServiceConsumer"));
    }

    static void test03_rootCauseCrossFileEvidence(Path fixturesRoot) throws IOException {
        ProjectIndexer indexer = new ProjectIndexer();
        ProjectModel model = indexer.index(fixturesRoot.resolve("scenario_basic"));
        ProjectGraph graph = indexer.buildGraph(model);
        List<Issue> issues = new UninitializedFieldAnalyzer().analyze(model, graph);
        check("03a_issueDetected", issues.size() == 1, "expected 1 issue, got " + issues.size());
        RootCause rc = new DefaultRootCauseAnalyzer().analyze(issues.get(0), model, graph);
        boolean crossFile = rc != null && rc.evidence.stream()
                .anyMatch(e -> e.kind == Evidence.Kind.GRAPH_RELATIONSHIP && e.detail.contains("Helper.java"));
        check("03b_rootCauseCrossFileEvidence", crossFile, "missing GRAPH_RELATIONSHIP evidence to Helper.java");
        check("03c_rootCauseConfidenceHigh", rc != null && rc.confidence == RootCause.ConfidenceLevel.HIGH,
                "expected HIGH, got " + (rc == null ? "null" : rc.confidence));
    }

    static void test04_realPatchGenerated(Path fixturesRoot) throws IOException {
        ProjectIndexer indexer = new ProjectIndexer();
        ProjectModel model = indexer.index(fixturesRoot.resolve("scenario_basic"));
        ProjectGraph graph = indexer.buildGraph(model);
        Issue issue = new UninitializedFieldAnalyzer().analyze(model, graph).get(0);
        RootCause rc = new DefaultRootCauseAnalyzer().analyze(issue, model, graph);
        RepairPlan plan = new DefaultRepairPlanner().plan(rc, issue, model, graph);
        check("04a_planCreated", plan != null, "plan should not be null");
        Patch patch = new PatchEngine().generate(plan, model);
        check("04b_patchDiffers", !patch.afterContent.equals(patch.beforeContent), "no real change generated");
        check("04c_patchContainsInitializer", patch.afterContent.contains("= new Helper()"),
                "expected 'new Helper()' in: " + patch.afterContent);
    }

    static void test05_patchAppliedToWorkspaceOnly(Path fixturesRoot, Path workDir) throws IOException {
        Path project = fixturesRoot.resolve("scenario_basic");
        String before = Files.readString(project.resolve("com/example/ServiceConsumer.java"));

        ProjectIndexer indexer = new ProjectIndexer();
        ProjectModel model = indexer.index(project);
        ProjectGraph graph = indexer.buildGraph(model);
        Issue issue = new UninitializedFieldAnalyzer().analyze(model, graph).get(0);
        RootCause rc = new DefaultRootCauseAnalyzer().analyze(issue, model, graph);
        RepairPlan plan = new DefaultRepairPlanner().plan(rc, issue, model, graph);
        Patch patch = new PatchEngine().generate(plan, model);

        WorkspaceManager ws = WorkspaceManager.createIsolatedCopy(project, workDir);
        ws.applyPatch(patch);

        String afterOp = Files.readString(project.resolve("com/example/ServiceConsumer.java"));
        String wsContent = ws.readWorkspaceFile("com/example/ServiceConsumer.java");

        check("05a_originalUnchanged", before.equals(afterOp), "original project file was modified!");
        check("05b_workspaceChanged", wsContent.contains("= new Helper()"), "workspace file missing patch");
        ws.dispose();
    }

    static void test06_diffCorrectness(Path fixturesRoot) throws IOException {
        ProjectIndexer indexer = new ProjectIndexer();
        ProjectModel model = indexer.index(fixturesRoot.resolve("scenario_basic"));
        ProjectGraph graph = indexer.buildGraph(model);
        Issue issue = new UninitializedFieldAnalyzer().analyze(model, graph).get(0);
        RootCause rc = new DefaultRootCauseAnalyzer().analyze(issue, model, graph);
        RepairPlan plan = new DefaultRepairPlanner().plan(rc, issue, model, graph);
        Patch patch = new PatchEngine().generate(plan, model);
        boolean ok = patch.unifiedDiff.contains("-    private Helper helper;")
                && patch.unifiedDiff.contains("+    private Helper helper = new Helper();");
        check("06_diffCorrectness", ok, "diff missing expected lines:\n" + patch.unifiedDiff);
    }

    static void test07_fullRepairAcceptedWithRealVerification(Path fixturesRoot, Path workDir) {
        ProjectRepairEngine engine = new ProjectRepairEngine(workDir, 3);
        RepairResult result = engine.repairProject(fixturesRoot.resolve("scenario_basic"), "com.example.Main");
        check("07a_accepted", result.finalStatus == RepairResult.FinalStatus.ACCEPTED,
                "expected ACCEPTED, got " + result.finalStatus + " warnings=" + result.warnings);
        check("07b_verified", result.verificationResult != null
                        && result.verificationResult.status == VerificationResult.Status.VERIFIED,
                "expected VERIFIED, got " + (result.verificationResult == null ? "null" : result.verificationResult.status));
        check("07c_runtimeOutputCorrect", result.verificationResult != null
                        && result.verificationResult.runtimeOutput.contains("done"),
                "expected 'done' in runtime output");
        check("07d_aiUnavailableHonest", result.aiStatus == AIReasoningLayer.AIStatus.AI_UNAVAILABLE,
                "expected AI_UNAVAILABLE since no real provider is connected, got " + result.aiStatus);
    }

    static void test08_failedRepairDetected(Path workDir) throws IOException {
        Path project = Files.createTempDirectory(workDir, "fail_project").resolve("proj");
        Path pkg = project.resolve("com/example");
        Files.createDirectories(pkg);
        Files.writeString(pkg.resolve("NoDefaultCtor.java"),
                "package com.example;\npublic class NoDefaultCtor {\n public NoDefaultCtor(int x) {}\n public String doWork(){return \"x\";}\n}\n");
        Files.writeString(pkg.resolve("Consumer.java"),
                "package com.example;\npublic class Consumer {\n private NoDefaultCtor dep;\n public String run(){return dep.doWork();}\n}\n");
        Files.writeString(pkg.resolve("Main.java"),
                "package com.example;\npublic class Main {\n public static void main(String[] a){System.out.println(new Consumer().run());}\n}\n");

        ProjectRepairEngine engine = new ProjectRepairEngine(workDir, 1);
        RepairResult result = engine.repairProject(project, "com.example.Main");
        check("08_failedRepairDetected", result.finalStatus == RepairResult.FinalStatus.FAILED_ALL_ATTEMPTS,
                "expected FAILED_ALL_ATTEMPTS, got " + result.finalStatus);
        check("08b_compileActuallyFailed",
                result.verificationResult != null && !result.verificationResult.compileSucceeded,
                "expected genuine javac failure");
    }

    static void test09_rollbackRestoresOriginal(Path workDir) throws IOException {
        Path project = Files.createTempDirectory(workDir, "rollback_project").resolve("proj");
        Path pkg = project.resolve("com/example");
        Files.createDirectories(pkg);
        Files.writeString(pkg.resolve("NoDefaultCtor.java"),
                "package com.example;\npublic class NoDefaultCtor {\n public NoDefaultCtor(int x) {}\n public String doWork(){return \"x\";}\n}\n");
        String consumerContent = "package com.example;\npublic class Consumer {\n private NoDefaultCtor dep;\n public String run(){return dep.doWork();}\n}\n";
        Files.writeString(pkg.resolve("Consumer.java"), consumerContent);
        Files.writeString(pkg.resolve("Main.java"),
                "package com.example;\npublic class Main {\n public static void main(String[] a){System.out.println(new Consumer().run());}\n}\n");

        ProjectIndexer indexer = new ProjectIndexer();
        ProjectModel model = indexer.index(project);
        ProjectGraph graph = indexer.buildGraph(model);
        Issue issue = new UninitializedFieldAnalyzer().analyze(model, graph).get(0);
        RootCause rc = new DefaultRootCauseAnalyzer().analyze(issue, model, graph);
        RepairPlan plan = new DefaultRepairPlanner().plan(rc, issue, model, graph);
        Patch patch = new PatchEngine().generate(plan, model);

        WorkspaceManager ws = WorkspaceManager.createIsolatedCopy(project, workDir);
        ws.applyPatch(patch);
        String patched = ws.readWorkspaceFile("com/example/Consumer.java");
        boolean changed = !patched.equals(consumerContent);

        RollbackManager rb = new RollbackManager();
        StringBuilder reason = new StringBuilder();
        boolean ok = rb.rollback(ws, "com/example/Consumer.java", reason);
        String restored = ws.readWorkspaceFile("com/example/Consumer.java");

        check("09a_patchChangedWorkspace", changed, "patch did not change workspace");
        check("09b_rollbackSucceeded", ok, reason.toString());
        check("09c_rollbackExactRestore", restored.equals(consumerContent), "restored content differs from original");
        ws.dispose();
    }

    static void test10_multipleAttemptsRespectsLimit(Path workDir) throws IOException {
        Path project = Files.createTempDirectory(workDir, "limit_project").resolve("proj");
        Path pkg = project.resolve("com/example");
        Files.createDirectories(pkg);
        Files.writeString(pkg.resolve("NoDefaultCtor.java"),
                "package com.example;\npublic class NoDefaultCtor {\n public NoDefaultCtor(int x) {}\n public String doWork(){return \"x\";}\n}\n");
        Files.writeString(pkg.resolve("Consumer.java"),
                "package com.example;\npublic class Consumer {\n private NoDefaultCtor dep;\n public String run(){return dep.doWork();}\n}\n");
        Files.writeString(pkg.resolve("Main.java"),
                "package com.example;\npublic class Main {\n public static void main(String[] a){System.out.println(new Consumer().run());}\n}\n");

        ProjectRepairEngine engine = new ProjectRepairEngine(workDir, 1);
        RepairResult result = engine.repairProject(project, "com.example.Main");
        check("10_attemptsWithinLimit", result.attempts.size() <= 1,
                "expected at most 1 attempt, got " + result.attempts.size());
    }

    static void test11_noBugProject(Path fixturesRoot, Path workDir) {
        ProjectRepairEngine engine = new ProjectRepairEngine(workDir, 3);
        RepairResult result = engine.repairProject(fixturesRoot.resolve("scenario_nobug"), "com.example.Main");
        check("11_noBugProject", result.finalStatus == RepairResult.FinalStatus.NO_ISSUES_FOUND,
                "expected NO_ISSUES_FOUND, got " + result.finalStatus);
    }

    static void test12_emptyProject(Path workDir) throws IOException {
        Path emptyDir = Files.createTempDirectory(workDir, "empty_project");
        ProjectRepairEngine engine = new ProjectRepairEngine(workDir, 3);
        RepairResult result = engine.repairProject(emptyDir, null);
        check("12_emptyProject", result.finalStatus == RepairResult.FinalStatus.NO_ISSUES_FOUND,
                "expected NO_ISSUES_FOUND, got " + result.finalStatus);
    }

    static void test13_malformedProjectFailsCompileHonestly(Path fixturesRoot, Path workDir) throws IOException {
        Path project = fixturesRoot.resolve("scenario_malformed");
        WorkspaceManager ws = WorkspaceManager.createIsolatedCopy(project, workDir);
        VerificationResult vr = new JavacVerificationEngine().verify(ws.getWorkspaceRoot(), null);
        check("13_malformedFailsHonestly", vr.status == VerificationResult.Status.FAILED && !vr.compileSucceeded,
                "expected FAILED/compileSucceeded=false, got status=" + vr.status);
        ws.dispose();
    }

    static void test14_unsupportedLanguageReported(Path fixturesRoot, Path workDir) {
        ProjectRepairEngine engine = new ProjectRepairEngine(workDir, 3);
        RepairResult result = engine.repairProject(fixturesRoot.resolve("scenario_unsupported"), null);
        check("14_unsupportedLanguageReported", result.finalStatus == RepairResult.FinalStatus.UNSUPPORTED,
                "expected UNSUPPORTED, got " + result.finalStatus);
    }

    static void test15_unaffectedFilesUntouched(Path fixturesRoot, Path workDir) {
        ProjectRepairEngine engine = new ProjectRepairEngine(workDir, 3);
        RepairResult result = engine.repairProject(fixturesRoot.resolve("scenario_basic"), "com.example.Main");
        check("15a_affectedFilesMinimal", result.affectedFiles.size() <= 2,
                "expected at most 2 affected files, got " + result.affectedFiles);
        check("15b_patchTargetsOnlyServiceConsumer",
                result.finalPatch != null && result.finalPatch.relativePath.equals("com/example/ServiceConsumer.java"),
                "expected patch on ServiceConsumer.java only, got: " + (result.finalPatch == null ? "null" : result.finalPatch.relativePath));
    }

    // 17. compile فقط (PARTIALLY_VERIFIED) لا يجوز أن يُقبل كإصلاح ناجح - يجب NOT_VERIFIED + rollback حقيقي
    static void test17_compileOnlyIsNotAcceptedAsFixed(Path fixturesRoot, Path workDir) throws IOException {
        Path project = fixturesRoot.resolve("scenario_basic");
        ProjectRepairEngine engine = new ProjectRepairEngine(workDir, 3);
        // لا mainClassFqcn -> الـVerificationEngine سينفّذ compile فقط -> PARTIALLY_VERIFIED
        RepairResult result = engine.repairProject(project, null);

        check("17a_notAcceptedOnCompileOnly", result.finalStatus == RepairResult.FinalStatus.NOT_VERIFIED,
                "compile-only success must NOT be ACCEPTED - got " + result.finalStatus);
        check("17b_verificationWasPartial",
                result.verificationResult != null
                        && result.verificationResult.status == VerificationResult.Status.PARTIALLY_VERIFIED,
                "expected PARTIALLY_VERIFIED, got " + (result.verificationResult == null ? "null" : result.verificationResult.status));
        check("17c_noFinalPatchOnNotVerified", result.finalPatch == null,
                "finalPatch must be null when the repair was not accepted, got: "
                        + (result.finalPatch == null ? "null" : result.finalPatch.relativePath));
        check("17d_originalStillUnchanged",
                Files.readString(project.resolve("com/example/ServiceConsumer.java")).contains("private Helper helper;"),
                "original project file must remain unchanged regardless of verification outcome");
    }

    static void test16_aiUnavailableReportedHonestly(Path fixturesRoot, Path workDir) {
        ProjectRepairEngine engine = new ProjectRepairEngine(workDir, 3); // بدون تمرير AIReasoningLayer -> NoOp
        RepairResult result = engine.repairProject(fixturesRoot.resolve("scenario_basic"), "com.example.Main");
        check("16_aiUnavailableNotFaked", result.aiStatus == AIReasoningLayer.AIStatus.AI_UNAVAILABLE
                        && result.hypotheses.isEmpty(),
                "expected AI_UNAVAILABLE and no fabricated AI hypotheses, got status=" + result.aiStatus
                        + " hypotheses=" + result.hypotheses.size());
    }

    // ================================================================
    // Phase 1: Project Understanding / real AST call-graph tests
    // ================================================================

    static void test18_methodDiscoveredInsideClass(Path fixturesRoot) throws IOException {
        ProjectIndexer indexer = new ProjectIndexer();
        ProjectModel model = indexer.index(fixturesRoot.resolve("scenario_callchain"));
        ProjectGraph graph = indexer.buildAstGraph(model);
        boolean found = graph.methodsOf("Service").stream().anyMatch(m -> m.name.equals("login"));
        check("18_methodDiscoveredInsideClass", found,
                "expected method 'login' in class Service, got: " + graph.methodsOf("Service").stream().map(m -> m.name).toList());
    }

    static void test19_methodToMethodCallDetected(Path fixturesRoot) throws IOException {
        ProjectIndexer indexer = new ProjectIndexer();
        ProjectModel model = indexer.index(fixturesRoot.resolve("scenario_callchain"));
        ProjectGraph graph = indexer.buildAstGraph(model);
        boolean found = graph.callEdgesFrom("Service", "login").stream()
                .anyMatch(e -> e.resolved && e.calleeClass.equals("Repository") && e.calleeMethod.equals("authenticate"));
        check("19_methodToMethodCallDetected", found,
                "expected resolved call Service.login -> Repository.authenticate, got: " + graph.callEdgesFrom("Service", "login"));
    }

    static void test20_callerCalleeDirectionCorrect(Path fixturesRoot) throws IOException {
        ProjectIndexer indexer = new ProjectIndexer();
        ProjectModel model = indexer.index(fixturesRoot.resolve("scenario_callchain"));
        ProjectGraph graph = indexer.buildAstGraph(model);
        CallEdge edge = graph.callEdgesFrom("Service", "login").stream()
                .filter(e -> e.calleeClass.equals("Repository")).findFirst().orElse(null);
        check("20_callerCalleeDirectionCorrect", edge != null
                        && edge.callerClass.equals("Service") && edge.callerMethod.equals("login")
                        && edge.calleeClass.equals("Repository") && edge.calleeMethod.equals("authenticate"),
                "direction wrong or edge missing: " + edge);
    }

    static void test21_constructorCallDetected(Path fixturesRoot) throws IOException {
        ProjectIndexer indexer = new ProjectIndexer();
        ProjectModel model = indexer.index(fixturesRoot.resolve("scenario_callchain"));
        ProjectGraph graph = indexer.buildAstGraph(model);
        // "private ApiClient client = new ApiClient();" هو field initializer -> callerMethod=null.
        // الاسم الدلالي الحقيقي للمُنشئ في Java هو "<init>" (وليس اسم الكلاس) - هذا سلوك javac القياسي.
        boolean found = graph.allCallEdges().stream()
                .anyMatch(e -> e.callerClass.equals("Repository") && e.callerMethod == null
                        && e.calleeClass.equals("ApiClient") && e.calleeMethod.equals("<init>") && e.resolved);
        check("21_constructorCallDetected", found,
                "expected resolved constructor call Repository(field init) -> ApiClient.<init>, got: "
                        + graph.allCallEdges().stream().filter(e -> e.callerClass.equals("Repository")).toList());
    }

    static void test22_inheritanceDetected(Path fixturesRoot) throws IOException {
        ProjectIndexer indexer = new ProjectIndexer();
        ProjectModel model = indexer.index(fixturesRoot.resolve("scenario_callchain"));
        ProjectGraph graph = indexer.buildAstGraph(model);
        check("22_inheritanceDetected", graph.inheritsFrom("Service2", "NamedService"),
                "expected Service2 to inherit from NamedService");
    }

    static void test23_interfaceImplementationDetected(Path fixturesRoot) throws IOException {
        ProjectIndexer indexer = new ProjectIndexer();
        ProjectModel model = indexer.index(fixturesRoot.resolve("scenario_callchain"));
        ProjectGraph graph = indexer.buildAstGraph(model);
        check("23_interfaceImplementationDetected", graph.implementsInterface("Service2", "Greetable"),
                "expected Service2 to implement Greetable");
    }

    // 24: يختبر اكتشاف *تعريف* الحقل فقط (declaration)، وليس وجود مرجع له.
    // أُعيدت التسمية بعد ملاحظة صحيحة بأن الاسم القديم (fieldReferenceDetected)
    // كان يوحي بقدرة لم تكن منفَّذة وقتها.
    static void test24_fieldDeclarationDiscovered(Path fixturesRoot) throws IOException {
        ProjectIndexer indexer = new ProjectIndexer();
        ProjectModel model = indexer.index(fixturesRoot.resolve("scenario_callchain"));
        ProjectGraph graph = indexer.buildAstGraph(model);
        boolean found = graph.fieldsOf("Repository").stream()
                .anyMatch(fld -> fld.name.equals("client") && fld.typeSimpleName.equals("ApiClient"));
        check("24_fieldDeclarationDiscovered", found,
                "expected field declaration 'client:ApiClient' in Repository, got: "
                        + graph.fieldsOf("Repository").stream().map(fl -> fl.name + ":" + fl.typeSimpleName).toList());
    }

    // 24b: يثبت أن new FieldRefEdge(...) تُنشأ فعليًا من AST - وليس مجرد وجود قائمة فارغة.
    static void test24b_fieldReferenceEdgeExtracted(Path fixturesRoot) throws IOException {
        ProjectIndexer indexer = new ProjectIndexer();
        ProjectModel model = indexer.index(fixturesRoot.resolve("scenario_callchain"));
        ProjectGraph graph = indexer.buildAstGraph(model);

        check("24b1_fieldRefEdgesNotEmpty", !graph.allFieldRefEdges().isEmpty(),
                "FieldRefEdge list must not be empty - a dead structure means the capability is not implemented");

        // "public String authenticate(){ return client.request(); }" -> Repository.authenticate يشير إلى Repository.client
        FieldRefEdge edge = graph.fieldRefEdgesFrom("Repository", "authenticate").stream()
                .filter(e -> e.targetClass.equals("Repository") && e.targetField.equals("client"))
                .findFirst().orElse(null);

        check("24b2_specificEdgeExists", edge != null,
                "expected Repository.authenticate -> references Repository.client, got: "
                        + graph.fieldRefEdgesFrom("Repository", "authenticate"));
        if (edge != null) {
            check("24b3_edgeResolved", edge.resolved, "edge must be semantically resolved, got resolved=false");
            check("24b4_edgeHasRealLocation",
                    edge.location != null && edge.location.file.equals("com/example/Repository.java") && edge.location.line > 0,
                    "expected a real source location, got: " + edge.location);
        }

        // مسار عكسي: من الحقل إلى من يشير إليه
        check("24b5_reverseLookupWorks",
                graph.referencesToField("Repository", "client").stream()
                        .anyMatch(e -> e.accessorClass.equals("Repository") && e.accessorMethod.equals("authenticate")),
                "referencesToField must find the accessor, got: " + graph.referencesToField("Repository", "client"));
    }

    // 24c: تعريف الحقل نفسه ("private ApiClient client = new ApiClient();") لا يجوز أن يُسجَّل كمرجع.
    static void test24c_fieldRefNotCreatedForDeclarationItself(Path fixturesRoot) throws IOException {
        ProjectIndexer indexer = new ProjectIndexer();
        ProjectModel model = indexer.index(fixturesRoot.resolve("scenario_callchain"));
        ProjectGraph graph = indexer.buildAstGraph(model);
        // سطر التعريف في Repository.java هو السطر 4؛ أي edge على ذلك السطر يعني أننا سجّلنا التعريف كمرجع
        FieldSymbol decl = graph.fieldsOf("Repository").stream()
                .filter(fl -> fl.name.equals("client")).findFirst().orElse(null);
        check("24c1_declarationFound", decl != null, "field declaration not found");
        if (decl != null) {
            boolean refOnDeclLine = graph.referencesToField("Repository", "client").stream()
                    .anyMatch(e -> e.location.line == decl.location.line);
            check("24c2_noRefEdgeOnDeclarationLine", !refOnDeclLine,
                    "the field declaration line must not be recorded as a reference, got: "
                            + graph.referencesToField("Repository", "client"));
        }
    }

    // 24d: مرجع لحقل موروث يجب أن يُنسب إلى الكلاس الذي *يُعرّفه* فعليًا (NamedService)، لا إلى الكلاس المستخدم.
    static void test24d_inheritedFieldReferenceResolvedToDeclaringClass(Path fixturesRoot) throws IOException {
        ProjectIndexer indexer = new ProjectIndexer();
        ProjectModel model = indexer.index(fixturesRoot.resolve("scenario_callchain"));
        ProjectGraph graph = indexer.buildAstGraph(model);
        // "public String greet(){ return \"hi \" + name; }" في Service2، لكن name معرَّف في NamedService
        FieldRefEdge edge = graph.fieldRefEdgesFrom("Service2", "greet").stream()
                .filter(e -> e.targetField.equals("name")).findFirst().orElse(null);
        check("24d1_inheritedRefFound", edge != null,
                "expected Service2.greet to reference inherited field 'name', got: "
                        + graph.fieldRefEdgesFrom("Service2", "greet"));
        if (edge != null) {
            check("24d2_resolvedToDeclaringClass", edge.targetClass.equals("NamedService"),
                    "inherited field must resolve to its declaring class NamedService, got: " + edge.targetClass);
        }
    }

    // 24e: مراجع لحقول خارج المشروع أو غير محلولة يجب ألا تُنتج edges إطلاقًا.
    static void test24e_noFieldRefEdgesForExternalOrUnresolved(Path workDir) throws IOException {
        Path project = Files.createTempDirectory(workDir, "extfield_project").resolve("proj");
        Path pkg = project.resolve("com/example");
        Files.createDirectories(pkg);
        // يشير إلى حقل من JDK (Integer.MAX_VALUE) وإلى نوع غير موجود إطلاقًا
        Files.writeString(pkg.resolve("Ext.java"),
                "package com.example;\npublic class Ext {\n"
                        + " public int a(){ return Integer.MAX_VALUE; }\n"
                        + " public void b(){ Missing.someField = 1; }\n}\n");

        ProjectIndexer indexer = new ProjectIndexer();
        ProjectModel model = indexer.index(project);
        ProjectGraph graph = indexer.buildAstGraph(model);

        boolean anyExternal = graph.allFieldRefEdges().stream()
                .anyMatch(e -> e.targetClass.equals("Integer") || e.targetClass.equals("Missing")
                        || e.targetField.equals("MAX_VALUE") || e.targetField.equals("someField"));
        check("24e_noExternalOrUnresolvedFieldRefEdges", !anyExternal,
                "must not record field refs to JDK/external or unresolved targets, got: " + graph.allFieldRefEdges());
    }

    static void test25_crossFileMethodReferenceResolved(Path fixturesRoot) throws IOException {
        ProjectIndexer indexer = new ProjectIndexer();
        ProjectModel model = indexer.index(fixturesRoot.resolve("scenario_callchain"));
        ProjectGraph graph = indexer.buildAstGraph(model);
        // Main.java وService.java ملفان مختلفان - التحقق أن الاستدعاء عبر الملفين محلول دلاليًا فعليًا
        boolean found = graph.callEdgesFrom("Main", "main").stream()
                .anyMatch(e -> e.resolved && e.calleeClass.equals("Service") && e.calleeMethod.equals("login"));
        check("25_crossFileMethodReferenceResolved", found,
                "expected resolved cross-file call Main.main -> Service.login, got: " + graph.callEdgesFrom("Main", "main"));
    }

    static void test26_callChainAcrossFourClasses(Path fixturesRoot) throws IOException {
        ProjectIndexer indexer = new ProjectIndexer();
        ProjectModel model = indexer.index(fixturesRoot.resolve("scenario_callchain"));
        ProjectGraph graph = indexer.buildAstGraph(model);
        // Main.main -> Service.login -> Repository.authenticate -> ApiClient.request (4 classes، 3 قفزات)
        List<CallEdge> chain = graph.findCallChain("Main", "main", "ApiClient", "request", 5);
        check("26a_chainFound", chain != null, "expected a real call chain Main->Service->Repository->ApiClient, found none");
        if (chain != null) {
            check("26b_chainLength", chain.size() == 3, "expected 3 hops, got " + chain.size() + ": " + chain);
            check("26c_chainOrder",
                    chain.get(0).calleeClass.equals("Service") && chain.get(1).calleeClass.equals("Repository")
                            && chain.get(2).calleeClass.equals("ApiClient"),
                    "chain order incorrect: " + chain);
        }
    }

    static void test27_noFalseEdgesRecorded(Path fixturesRoot) throws IOException {
        ProjectIndexer indexer = new ProjectIndexer();
        ProjectModel model = indexer.index(fixturesRoot.resolve("scenario_callchain"));
        ProjectGraph graph = indexer.buildAstGraph(model);
        // Service لا يستدعي ApiClient مباشرة (فقط عبر Repository) - يجب ألا تُسجَّل حافة مباشرة وهمية
        boolean falseEdgeExists = graph.callEdgesFrom("Service", "login").stream()
                .anyMatch(e -> e.calleeClass.equals("ApiClient"));
        check("27_noFalseEdgesRecorded", !falseEdgeExists,
                "found a false direct edge Service.login -> ApiClient that does not exist in source: "
                        + graph.callEdgesFrom("Service", "login"));
    }

    static void test28_unresolvedCallHandledHonestly(Path workDir) throws IOException {
        // كود لا يُصرَّف فعليًا (نوع غير موجود) - أي استدعاء عليه لا يجوز أن يُسجَّل resolved=true
        Path project = Files.createTempDirectory(workDir, "unresolved_project").resolve("proj");
        Path pkg = project.resolve("com/example");
        Files.createDirectories(pkg);
        Files.writeString(pkg.resolve("Bad.java"),
                "package com.example;\npublic class Bad {\n public void run(){ Missing.doSomething(); }\n}\n");

        ProjectIndexer indexer = new ProjectIndexer();
        ProjectModel model = indexer.index(project);
        ProjectGraph graph = indexer.buildAstGraph(model);

        boolean anyFakeResolved = graph.allCallEdges().stream()
                .anyMatch(e -> e.callerClass.equals("Bad") && e.resolved && e.calleeClass.equals("Missing"));
        check("28_unresolvedCallHandledHonestly", !anyFakeResolved,
                "a call to a non-existent type must never be recorded as resolved=true");
    }

    static void test29_malformedProjectNoFakeGraph(Path fixturesRoot) throws IOException {
        ProjectIndexer indexer = new ProjectIndexer();
        ProjectModel model = indexer.index(fixturesRoot.resolve("scenario_malformed"));
        ProjectGraph graph = indexer.buildAstGraph(model);

        check("29a_malformedFileMarkedUnparsable", graph.unparsableFiles().containsKey("com/example/Broken.java"),
                "expected Broken.java to be listed as unparsable, got: " + graph.unparsableFiles());
        check("29b_noFakeSymbolsForMalformedFile",
                graph.allClassSymbols().stream().noneMatch(cs -> cs.simpleName.equals("Broken")),
                "must not fabricate a ClassSymbol for a file that failed to compile");
    }

    static void test30_originalFilesUntouchedByAstAnalysis(Path fixturesRoot) throws IOException {
        Path project = fixturesRoot.resolve("scenario_callchain");
        String before = Files.readString(project.resolve("com/example/Service.java"));
        ProjectIndexer indexer = new ProjectIndexer();
        ProjectModel model = indexer.index(project);
        indexer.buildAstGraph(model); // تحليل فقط - لا كتابة متوقعة
        String after = Files.readString(project.resolve("com/example/Service.java"));
        check("30_originalFilesUntouchedByAstAnalysis", before.equals(after),
                "AST analysis must never write to the original project files");
    }

    // ================================================================
    // FQN Symbol Identity tests (collision handling)
    // ================================================================

    // 31: كلاسان بنفس الاسم البسيط في حزمتين مختلفتين - كلاهما يجب أن يبقى في الـgraph.
    // (قبل هذه الدفعة كان أحدهما يُكتب فوق الآخر ويختفي تمامًا.)
    static void test31_collisionBothClassesSurvive(Path fixturesRoot) throws IOException {
        ProjectIndexer indexer = new ProjectIndexer();
        ProjectModel model = indexer.index(fixturesRoot.resolve("scenario_collision"));
        ProjectGraph graph = indexer.buildAstGraph(model);

        check("31a_fooApiClientExists", graph.classSymbolByFqn("com.foo.ApiClient") != null,
                "com.foo.ApiClient must exist, allFqns=" + graph.allFqns());
        check("31b_barApiClientExists", graph.classSymbolByFqn("com.bar.ApiClient") != null,
                "com.bar.ApiClient must exist, allFqns=" + graph.allFqns());
        check("31c_bothDistinctFiles",
                graph.classSymbolByFqn("com.foo.ApiClient").location.file.equals("com/foo/ApiClient.java")
                        && graph.classSymbolByFqn("com.bar.ApiClient").location.file.equals("com/bar/ApiClient.java"),
                "each FQN must map to its own file");
        check("31d_twoFqnsForSameSimpleName", graph.fqnsForSimpleName("ApiClient").size() == 2,
                "expected 2 FQNs for simple name ApiClient, got: " + graph.fqnsForSimpleName("ApiClient"));
    }

    // 32: الاسم البسيط المتضارب لا يجوز أن يُحسم بالتخمين.
    static void test32_ambiguousSimpleNameNotGuessed(Path fixturesRoot) throws IOException {
        ProjectIndexer indexer = new ProjectIndexer();
        ProjectModel model = indexer.index(fixturesRoot.resolve("scenario_collision"));
        ProjectGraph graph = indexer.buildAstGraph(model);

        check("32a_isAmbiguousReported", graph.isAmbiguousSimpleName("ApiClient"),
                "ApiClient must be reported as ambiguous");
        check("32b_classSymbolReturnsNull", graph.classSymbol("ApiClient") == null,
                "ambiguous simple-name lookup must return null, not a guess");
        check("32c_methodsOfReturnsEmpty", graph.methodsOf("ApiClient").isEmpty(),
                "ambiguous methodsOf must return empty, got: " + graph.methodsOf("ApiClient"));
        check("32d_fieldsOfReturnsEmpty", graph.fieldsOf("ApiClient").isEmpty(),
                "ambiguous fieldsOf must return empty");
        check("32e_findCallChainReturnsNull",
                graph.findCallChain("Service", "run", "ApiClient", "request", 5) == null,
                "ambiguous findCallChain must return null instead of a possibly-wrong chain");
    }

    // 33: كل خدمة يجب أن ترتبط بالـApiClient الصحيح حسب الـimport الفعلي.
    static void test33_callEdgesResolveToCorrectPackage(Path fixturesRoot) throws IOException {
        ProjectIndexer indexer = new ProjectIndexer();
        ProjectModel model = indexer.index(fixturesRoot.resolve("scenario_collision"));
        ProjectGraph graph = indexer.buildAstGraph(model);

        boolean serviceToFoo = graph.callEdgesFromFqn("com.app.Service", "run").stream()
                .anyMatch(e -> e.resolved && e.calleeFqn.equals("com.foo.ApiClient") && e.calleeMethod.equals("request"));
        boolean otherToBar = graph.callEdgesFromFqn("com.app.OtherService", "run").stream()
                .anyMatch(e -> e.resolved && e.calleeFqn.equals("com.bar.ApiClient") && e.calleeMethod.equals("request"));

        check("33a_serviceUsesFooApiClient", serviceToFoo,
                "Service.run must resolve to com.foo.ApiClient.request, got: " + graph.callEdgesFromFqn("com.app.Service", "run"));
        check("33b_otherServiceUsesBarApiClient", otherToBar,
                "OtherService.run must resolve to com.bar.ApiClient.request, got: " + graph.callEdgesFromFqn("com.app.OtherService", "run"));

        // والأهم: لا تسرّب بين الاثنين
        boolean serviceWronglyToBar = graph.callEdgesFromFqn("com.app.Service", "run").stream()
                .anyMatch(e -> e.calleeFqn.equals("com.bar.ApiClient"));
        check("33c_noCrossContamination", !serviceWronglyToBar,
                "Service must NOT be linked to com.bar.ApiClient");
    }

    // 34: الـAPIs المؤهلة تحسم ما لا يستطيع الاسم البسيط حسمه.
    static void test34_fqnApisDisambiguate(Path fixturesRoot) throws IOException {
        ProjectIndexer indexer = new ProjectIndexer();
        ProjectModel model = indexer.index(fixturesRoot.resolve("scenario_collision"));
        ProjectGraph graph = indexer.buildAstGraph(model);

        check("34a_methodsOfFqnFoo",
                graph.methodsOfFqn("com.foo.ApiClient").stream().anyMatch(m -> m.name.equals("request")),
                "methodsOfFqn must work for com.foo.ApiClient");
        check("34b_methodsOfFqnBar",
                graph.methodsOfFqn("com.bar.ApiClient").stream().anyMatch(m -> m.name.equals("request")),
                "methodsOfFqn must work for com.bar.ApiClient");
        check("34c_methodOwnerFqnCorrect",
                graph.methodsOfFqn("com.foo.ApiClient").stream()
                        .allMatch(m -> m.ownerFqn.equals("com.foo.ApiClient")),
                "MethodSymbol.ownerFqn must be the qualified owner");
    }

    // 35: تتبع مسار بالهوية المؤهلة لا يخلط بين الحزمتين.
    static void test35_fqnCallChainNotConfusedByCollision(Path fixturesRoot) throws IOException {
        ProjectIndexer indexer = new ProjectIndexer();
        ProjectModel model = indexer.index(fixturesRoot.resolve("scenario_collision"));
        ProjectGraph graph = indexer.buildAstGraph(model);

        var chainFoo = graph.findCallChainByFqn("com.app.Service", "run", "com.foo.ApiClient", "request", 5);
        check("35a_fooChainFound", chainFoo != null && chainFoo.size() == 1,
                "expected 1-hop chain Service.run -> com.foo.ApiClient.request, got: " + chainFoo);

        // لا يوجد مسار من Service إلى com.bar.ApiClient - يجب أن يُرجع null، لا مسارًا مختلقًا
        var chainBar = graph.findCallChainByFqn("com.app.Service", "run", "com.bar.ApiClient", "request", 5);
        check("35b_noFabricatedChainToOtherPackage", chainBar == null,
                "there is no real path Service.run -> com.bar.ApiClient.request; must return null, got: " + chainBar);
    }

    // 36: عدم وجود تضارب => طبقة التوافق بالاسم البسيط تعمل كما كانت تمامًا.
    static void test36_uniqueSimpleNamesStillWorkViaCompatLayer(Path fixturesRoot) throws IOException {
        ProjectIndexer indexer = new ProjectIndexer();
        ProjectModel model = indexer.index(fixturesRoot.resolve("scenario_collision"));
        ProjectGraph graph = indexer.buildAstGraph(model);

        check("36a_uniqueNameNotAmbiguous", !graph.isAmbiguousSimpleName("Service"),
                "Service is unique and must not be ambiguous");
        check("36b_classSymbolWorks", graph.classSymbol("Service") != null,
                "unique simple-name lookup must still work");
        check("36c_fqnMatches", graph.classSymbol("Service").fqn.equals("com.app.Service"),
                "expected com.app.Service, got: " + graph.classSymbol("Service").fqn);
        check("36d_methodsOfWorks", graph.methodsOf("Service").stream().anyMatch(m -> m.name.equals("run")),
                "unique methodsOf must still work");
    }
}
