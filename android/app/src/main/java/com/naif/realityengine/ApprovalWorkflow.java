package com.naif.realityengine;

public class ApprovalWorkflow {

    public enum Stage {
        IDLE, ANALYZING, SECURITY_CHECK, DIFF_READY,
        AWAITING_APPROVAL, DONE, REJECTED, BLOCKED
    }

    public static class WorkflowItem {
        public String id;
        public String functionName;
        public Stage stage;
        public String stageLabel;
        public int progress;
        public String suggestion;
        public String before;
        public String after;
        public String explanation;
        public int safetyScore;
        public AISecurityGuard.GuardVerdict guardVerdict;
        public String blockedReason;
        public boolean requiresClarify;
    }

    public static WorkflowItem process(
            StubDetector.StubFunction stub,
            String fullCode) {

        WorkflowItem item = new WorkflowItem();
        item.id           = stub.name + "_" + System.currentTimeMillis();
        item.functionName = stub.name;
        item.before       = stub.snippet;

        // 1. Legal check
        LegalGuard.LegalResult legal = LegalGuard.check(fullCode);
        if (legal.blocked) {
            item.stage        = Stage.BLOCKED;
            item.stageLabel   = "محظور قانونياً";
            item.progress     = 100;
            item.blockedReason= legal.userMessage;
            return item;
        }

        // 2. Policy check
        PolicyEngine.PolicyResult policy = PolicyEngine.check(fullCode);
        if (policy.verdict == PolicyEngine.PolicyVerdict.BLOCKED) {
            item.stage        = Stage.BLOCKED;
            item.stageLabel   = "انتهاك سياسة";
            item.progress     = 100;
            item.blockedReason= policy.summary;
            return item;
        }

        // 3. Generate suggestion
        item.stage    = Stage.ANALYZING;
        item.progress = 30;
        // 1. CodeIntelligence — تحليل عميق بأدلة متعددة
        CodeIntelligence.IntelligenceResult intel =
            CodeIntelligence.analyze(fullCode, stub.name);

        String suggestion = null;

        // 2. لو confidence عالي — استخدم اقتراح CodeIntelligence
        if (intel.finalConfidence >= 0.35 && intel.bestSuggestion != null) {
            suggestion = intel.bestSuggestion;
        }

        // 3. fallback — StubDetector الاعتيادي
        if (suggestion == null || suggestion.isEmpty()) {
            ContextAnalyzer.CodeContext ctx = ContextAnalyzer.analyze(fullCode, stub.name);
            suggestion = StubDetector.suggestWithContext(stub.name, fullCode);
            java.util.List<String> params = ctx.functionParams.getOrDefault(stub.name, new java.util.ArrayList<>());
            if (!params.isEmpty()) {
                suggestion = ContextAnalyzer.refineSuggestion(suggestion, ctx, params.get(0));
            }
        }
        item.after = suggestion;

        // 4. Security check on suggestion
        AISecurityGuard.GuardReport guard = AISecurityGuard.inspect(suggestion);
        item.safetyScore  = guard.safetyScore;
        item.guardVerdict = guard.verdict;

        if (guard.verdict == AISecurityGuard.GuardVerdict.BLOCKED) {
            item.stage        = Stage.BLOCKED;
            item.stageLabel   = "محظور أمنياً";
            item.progress     = 100;
            item.blockedReason= guard.blockedReason;
            return item;
        }

        // 5. Build explanation
        item.explanation = "الدالة \"" + stub.name + "()\" اكتُشفت كـ stub (" + stub.reason + ").\n"
            + "Safety Score: " + guard.safetyScore + "/100\n"
            + "الاقتراح مبني على اسم الدالة وسياق الكود.";

        item.suggestion = suggestion;
        item.stage      = Stage.AWAITING_APPROVAL;
        item.stageLabel = "بانتظار موافقتك";
        item.progress   = 90;

        return item;
    }

    public static String applyChange(String code, String funcName, String suggestion) {
        String[] lines = code.split("\n");
        StringBuilder result = new StringBuilder();
        boolean inFunc = false;
        boolean replaced = false;
        int funcIndent = 0;
        boolean skipBody = false;

        // لو الاقتراح يحتوي def كاملة — استبدل الدالة كلها
        boolean suggestionHasDef = suggestion.trim().startsWith("def " + funcName);

        for (int i = 0; i < lines.length; i++) {
            String line = lines[i];
            String trimmed = line.trim();

            if (!replaced && trimmed.startsWith("def " + funcName + "(")) {
                inFunc = true;
                funcIndent = line.indexOf("def");

                if (suggestionHasDef) {
                    // استبدل الدالة كاملة
                    String indent = " ".repeat(funcIndent);
                    for (String sl : suggestion.split("\n"))
                        result.append(indent).append(sl).append("\n");
                    replaced = true;
                    skipBody = true;
                } else {
                    result.append(line).append("\n");
                }
                continue;
            }

            if (skipBody) {
                // تخطى جسم الدالة القديمة
                if (!trimmed.isEmpty() && line.length() - line.stripLeading().length() <= funcIndent) {
                    skipBody = false;
                    result.append(line).append("\n");
                }
                continue;
            }

            if (inFunc && !replaced) {
                if (trimmed.equals("pass") || trimmed.equals("...") ||
                    trimmed.startsWith("raise NotImplementedError")) {
                    String indent = " ".repeat(funcIndent + 4);
                    for (String sl : suggestion.split("\n"))
                        result.append(indent).append(sl).append("\n");
                    replaced = true;
                    inFunc = false;
                    continue;
                }
                if (!trimmed.isEmpty() && line.length() - line.stripLeading().length() <= funcIndent) {
                    inFunc = false;
                }
            }

            result.append(line).append("\n");
        }

        return result.toString();
    }
}
