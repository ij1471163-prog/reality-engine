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
            String fullCode,
            java.util.Map<String, String> relatedFiles) {

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
        // دمج الملفات المرتبطة مع الكود الرئيسي
        String contextCode = fullCode;
        if (relatedFiles != null && !relatedFiles.isEmpty()) {
            StringBuilder ctx = new StringBuilder(fullCode);
            for (java.util.Map.Entry<String, String> e : relatedFiles.entrySet()) {
                ctx.append("\n# --- ").append(e.getKey()).append(" ---\n");
                ctx.append(e.getValue());
            }
            contextCode = ctx.toString();
        }

        CodeIntelligence.IntelligenceResult intel =
            CodeIntelligence.analyze(contextCode, stub.name);

        String suggestion = null;

        // 2. SemanticEngine — فهم النية
        java.util.List<String> sparams = CodeIntelligence.extractParams(fullCode, stub.name);
        SemanticEngine.SemanticResult semantic = SemanticEngine.analyze(stub.name, sparams, intel);
        if (semantic.confidence >= 0.4 && semantic.suggestedCode != null) {
            suggestion = semantic.suggestedCode;
        }

        // 3. لو SemanticEngine ما اقترح — استخدم CodeIntelligence
        if (suggestion == null && intel.finalConfidence >= 0.45
                && intel.bestSuggestion != null && !intel.bestSuggestion.contains("نمط مشابه")) {
            suggestion = intel.bestSuggestion;
        }

        // 4. CodeValidator — تحقق من الكود قبل عرضه
        if (suggestion != null) {
            CodeValidator.ValidationResult validation =
                CodeValidator.validate(suggestion, stub.name, sparams, fullCode);

            if (validation.status == CodeValidator.ValidationStatus.INVALID) {
                // لو فيه إصلاح تلقائي — استخدمه
                if (validation.fixedCode != null) {
                    suggestion = validation.fixedCode;
                } else {
                    // ارفض الاقتراح
                    suggestion = null;
                }
            }
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
                    // احذف الـ indent الزيادة من الـ suggestion
                    String[] suggLines = suggestion.split("\n");
                    // استخرج الـ indent الموجود في أول سطر من الـ suggestion
                    int existingIndent = 0;
                    for (String sl : suggLines) {
                        if (!sl.trim().isEmpty()) {
                            existingIndent = sl.length() - sl.stripLeading().length();
                            break;
                        }
                    }
                    for (String sl : suggLines) {
                        if (sl.trim().isEmpty()) {
                            result.append("\n");
                        } else {
                            // احذف الـ indent الموجود وأضف الصحيح
                            String stripped = sl.length() >= existingIndent ? sl.substring(existingIndent) : sl.stripLeading();
                            // تجاهل الـ indent الزيادة في السطور الداخلية
                            result.append(indent).append(stripped.stripLeading()).append("\n");
                        }
                    }
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
