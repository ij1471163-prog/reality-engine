package com.naif.realityengine;

import java.util.*;

/**
 * ApprovalWorkflow v2.0 — إصلاحات:
 * ✅ process() مقسّمة لـ sub-methods واضحة
 * ✅ applyChange() منطق indent صحيح
 * ✅ relatedFiles حد أقصى للحجم (MAX_CONTEXT_CHARS)
 * ✅ explanation ديناميكي يعكس مصدر الاقتراح والـ confidence
 * ✅ item.suggestion فقط (حُذف item.after المكرر)
 * ✅ Error handling لكل خطوة
 */
public class ApprovalWorkflow {

    // ─── BackupManager Integration ───────────────────
    private static BackupManager backup = null;

    public static void setBackupManager(BackupManager bm) {
        backup = bm;
    }

    private static void saveVersion(String sessionId, String funcName, 
                                     String before, String after) {
        if (backup != null && after != null && !after.equals(before)) {
            try {
                backup.recordVersion(sessionId, funcName, before, after);
            } catch (Exception ignored) {}
        }
    }


    // ═══════════════════════════════════════════════════
    // Constants
    // ═══════════════════════════════════════════════════

    private static final int MAX_CONTEXT_CHARS = 80_000; // حد حجم الـ context
    private static final int MIN_SAFETY_SCORE  = 60;     // أدنى درجة أمان مقبولة

    // ═══════════════════════════════════════════════════
    // Enums & Data Classes
    // ═══════════════════════════════════════════════════

    public enum Stage {
        IDLE, ANALYZING, SECURITY_CHECK, DIFF_READY,
        AWAITING_APPROVAL, DONE, REJECTED, BLOCKED, ERROR
    }

    public enum SuggestionSource {
        SEMANTIC_ENGINE, CODE_INTELLIGENCE, STUB_DETECTOR, NONE
    }

    public static class WorkflowItem {
        public String                        id;
        public String                        functionName;
        public Stage                         stage          = Stage.IDLE;
        public String                        stageLabel     = "";
        public int                           progress       = 0;
        public String                        suggestion     = null; // الكود المقترح
        public String                        before         = null; // الكود الأصلي
        public String                        explanation    = "";
        public int                           safetyScore    = 0;
        public AISecurityGuard.GuardVerdict  guardVerdict   = null;
        public String                        blockedReason  = null;
        public boolean                       requiresClarify = false;
        public SuggestionSource              source         = SuggestionSource.NONE;
        public double                        confidence     = 0.0;
        public String                        errorMessage   = null;
    }

    // ═══════════════════════════════════════════════════
    // Entry Point
    // ═══════════════════════════════════════════════════

    public static WorkflowItem process(
            StubDetector.StubFunction stub,
            String fullCode,
            Map<String, String> relatedFiles) {

        WorkflowItem item = new WorkflowItem();
        item.id           = stub.name + "_" + System.currentTimeMillis();
        item.functionName = stub.name;
        item.before       = stub.snippet;

        try {
            // 1. Guards
            WorkflowItem blocked = runGuards(fullCode, item);
            if (blocked != null) return blocked;

            // 2. Build context
            item.stage    = Stage.ANALYZING;
            item.stageLabel = "جاري التحليل...";
            item.progress = 20;
            String contextCode = buildContext(fullCode, relatedFiles);

            // 3. Generate suggestion
            item.progress = 40;
            SuggestionResult sr = generateSuggestion(stub, fullCode, contextCode);
            item.suggestion  = sr.code;
            item.source      = sr.source;
            item.confidence  = sr.confidence;

            // 4. Security check
            item.stage    = Stage.SECURITY_CHECK;
            item.stageLabel = "فحص الأمان...";
            item.progress = 75;
            WorkflowItem secBlocked = runSecurityCheck(item);
            if (secBlocked != null) return secBlocked;

            // 5. Build explanation
            item.explanation = buildExplanation(stub, item);

            // 6. Done
            item.stage      = Stage.AWAITING_APPROVAL;
            item.stageLabel = "بانتظار موافقتك";
            item.progress   = 95;

        } catch (Exception e) {
            item.stage        = Stage.ERROR;
            item.stageLabel   = "خطأ في المعالجة";
            item.progress     = 100;
            item.errorMessage = e.getMessage();
        }

        return item;
    }

    // ═══════════════════════════════════════════════════
    // Step 1 — Guards (Legal + Policy)
    // ═══════════════════════════════════════════════════

    private static WorkflowItem runGuards(String fullCode, WorkflowItem item) {
        try {
            LegalGuard.LegalResult legal = LegalGuard.check(fullCode);
            if (legal.blocked) {
                return block(item, Stage.BLOCKED, "محظور قانونياً", legal.userMessage);
            }
        } catch (Exception e) {
            return block(item, Stage.ERROR, "خطأ في الفحص القانوني", e.getMessage());
        }

        try {
            PolicyEngine.PolicyResult policy = PolicyEngine.check(fullCode);
            if (policy.verdict == PolicyEngine.PolicyVerdict.BLOCKED) {
                return block(item, Stage.BLOCKED, "انتهاك سياسة", policy.summary);
            }
        } catch (Exception e) {
            return block(item, Stage.ERROR, "خطأ في فحص السياسة", e.getMessage());
        }

        return null; // لا يوجد حجب
    }

    // ═══════════════════════════════════════════════════
    // Step 2 — Build Context (مع حد أقصى للحجم)
    // ═══════════════════════════════════════════════════

    private static String buildContext(String fullCode, Map<String, String> relatedFiles) {
        if (relatedFiles == null || relatedFiles.isEmpty()) return fullCode;

        StringBuilder ctx = new StringBuilder(fullCode);
        int remaining = MAX_CONTEXT_CHARS - fullCode.length();

        for (Map.Entry<String, String> e : relatedFiles.entrySet()) {
            if (remaining <= 0) break;
            String header  = "\n# --- " + e.getKey() + " ---\n";
            String content = e.getValue();

            // قصّ الملف لو تجاوز المساحة المتبقية
            if (header.length() + content.length() > remaining) {
                content = content.substring(0, Math.max(0, remaining - header.length()));
            }

            ctx.append(header).append(content);
            remaining -= header.length() + content.length();
        }

        return ctx.toString();
    }

    // ═══════════════════════════════════════════════════
    // Step 3 — Generate Suggestion
    // ═══════════════════════════════════════════════════

    private static class SuggestionResult {
        String code;
        SuggestionSource source;
        double confidence;
        SuggestionResult(String code, SuggestionSource source, double confidence) {
            this.code = code; this.source = source; this.confidence = confidence;
        }
    }

    private static SuggestionResult generateSuggestion(
            StubDetector.StubFunction stub,
            String fullCode,
            String contextCode) {

        List<String> params = CodeIntelligence.extractParams(fullCode, stub.name);

        // ── A: SemanticEngine ──
        try {
            CodeIntelligence.IntelligenceResult intel =
                CodeIntelligence.analyze(contextCode, stub.name);
            SemanticEngine.SemanticResult semantic =
                SemanticEngine.analyze(stub.name, params, intel);

            if (semantic.confidence >= 0.4 && semantic.suggestedCode != null) {
                String validated = validateAndFix(semantic.suggestedCode, stub.name, params, fullCode);
                if (validated != null)
                    return new SuggestionResult(validated, SuggestionSource.SEMANTIC_ENGINE, semantic.confidence);
            }

            // ── B: CodeIntelligence ──
            if (intel.finalConfidence >= 0.45
                    && intel.bestSuggestion != null
                    && !intel.bestSuggestion.startsWith("# نمط مشابه")) {
                String validated = validateAndFix(intel.bestSuggestion, stub.name, params, fullCode);
                if (validated != null)
                    return new SuggestionResult(validated, SuggestionSource.CODE_INTELLIGENCE, intel.finalConfidence);
            }
        } catch (Exception ignored) {
            // تقع في StubDetector fallback
        }

        // ── C: StubDetector fallback ──
        try {
            ContextAnalyzer.CodeContext ctx = ContextAnalyzer.analyze(fullCode, stub.name);
            String suggestion = StubDetector.suggestWithContext(stub.name, fullCode);
            if (suggestion != null && !params.isEmpty()) {
                suggestion = ContextAnalyzer.refineSuggestion(suggestion, ctx, params.get(0));
            }
            if (suggestion != null)
                return new SuggestionResult(suggestion, SuggestionSource.STUB_DETECTOR, 0.3);
        } catch (Exception ignored) {}

        return new SuggestionResult(null, SuggestionSource.NONE, 0.0);
    }

    // ── Validate + auto-fix ──
    private static String validateAndFix(String code, String funcName,
                                          List<String> params, String fullCode) {
        try {
            CodeValidator.ValidationResult v =
                CodeValidator.validate(code, funcName, params, fullCode);

            if (v.status == CodeValidator.ValidationStatus.VALID
                    || v.status == CodeValidator.ValidationStatus.WARNING) {
                return code;
            }
            if (v.status == CodeValidator.ValidationStatus.INVALID && v.fixedCode != null) {
                return v.fixedCode;
            }
        } catch (Exception ignored) {}
        return null; // اقتراح مرفوض
    }

    // ═══════════════════════════════════════════════════
    // Step 4 — Security Check
    // ═══════════════════════════════════════════════════

    private static WorkflowItem runSecurityCheck(WorkflowItem item) {
        if (item.suggestion == null) return null;

        try {
            AISecurityGuard.GuardReport guard = AISecurityGuard.inspect(item.suggestion);
            item.safetyScore  = guard.safetyScore;
            item.guardVerdict = guard.verdict;

            if (guard.verdict == AISecurityGuard.GuardVerdict.BLOCKED) {
                return block(item, Stage.BLOCKED, "محظور أمنياً", guard.blockedReason);
            }
            if (guard.safetyScore < MIN_SAFETY_SCORE) {
                return block(item, Stage.BLOCKED,
                    "درجة أمان منخفضة (" + guard.safetyScore + "/100)",
                    "الاقتراح لم يجتز حد الأمان الأدنى (" + MIN_SAFETY_SCORE + ")");
            }
        } catch (Exception e) {
            // فشل فحص الأمان → نحجب احترازياً
            return block(item, Stage.BLOCKED, "تعذّر فحص الأمان", e.getMessage());
        }

        return null;
    }

    // ═══════════════════════════════════════════════════
    // Step 5 — Dynamic Explanation
    // ═══════════════════════════════════════════════════

    private static String buildExplanation(StubDetector.StubFunction stub, WorkflowItem item) {
        StringBuilder sb = new StringBuilder();

        sb.append("الدالة \"").append(stub.name).append("()\" اكتُشفت كـ stub");
        if (stub.reason != null && !stub.reason.isEmpty())
            sb.append(" (").append(stub.reason).append(")");
        sb.append(".\n\n");

        // مصدر الاقتراح
        switch (item.source) {
            case SEMANTIC_ENGINE:
                sb.append("📐 مصدر الاقتراح: SemanticEngine\n");
                break;
            case CODE_INTELLIGENCE:
                sb.append("🔍 مصدر الاقتراح: CodeIntelligence\n");
                break;
            case STUB_DETECTOR:
                sb.append("🔧 مصدر الاقتراح: StubDetector (fallback)\n");
                break;
            default:
                sb.append("⚠️ لم يُوجد اقتراح مناسب\n");
        }

        // Confidence
        if (item.confidence > 0) {
            sb.append(String.format("📊 ثقة الاقتراح: %.0f%%\n", item.confidence * 100));
        }

        // Safety
        if (item.safetyScore > 0) {
            sb.append("🛡 Safety Score: ").append(item.safetyScore).append("/100\n");
        }

        return sb.toString().trim();
    }

    // ═══════════════════════════════════════════════════
    // Block helper
    // ═══════════════════════════════════════════════════

    private static WorkflowItem block(WorkflowItem item, Stage stage,
                                       String label, String reason) {
        item.stage         = stage;
        item.stageLabel    = label;
        item.progress      = 100;
        item.blockedReason = reason;
        return item;
    }

    // ═══════════════════════════════════════════════════
    // applyChange — منطق indent صحيح
    // ═══════════════════════════════════════════════════

    public static String applyChange(String code, String funcName, String suggestion) {
        if (code == null || funcName == null || suggestion == null) return code;

        String[] lines       = code.split("\n");
        StringBuilder result = new StringBuilder();
        boolean inFunc       = false;
        boolean replaced     = false;
        int     funcIndent   = 0;
        boolean skipOldBody  = false;
        boolean suggHasDef   = suggestion.trim().startsWith("def " + funcName);

        for (int i = 0; i < lines.length; i++) {
            String line    = lines[i];
            String trimmed = line.trim();

            // ── وجدنا بداية الدالة ──
            if (!replaced && matchesFuncDef(trimmed, funcName)) {
                inFunc     = true;
                funcIndent = leadingSpaces(line);

                if (suggHasDef) {
                    // استبدل الدالة كاملة بالـ suggestion
                    appendIndented(result, suggestion, funcIndent);
                    replaced    = true;
                    skipOldBody = true;
                } else {
                    // احتفظ بالـ def الأصلية، سنستبدل الجسم فقط
                    result.append(line).append("\n");
                }
                continue;
            }

            // ── تخطّي جسم الدالة القديمة بعد استبدال كامل ──
            if (skipOldBody) {
                int indent = leadingSpaces(line);
                if (!trimmed.isEmpty() && indent <= funcIndent) {
                    skipOldBody = false; // انتهى جسم الدالة القديمة
                    result.append(line).append("\n");
                }
                // سطور داخل الجسم القديم → تجاهل
                continue;
            }

            // ── داخل الدالة، نبحث عن stub placeholder ──
            if (inFunc && !replaced) {
                int indent = leadingSpaces(line);

                // خرجنا من الدالة بدون إيجاد stub
                if (!trimmed.isEmpty() && indent <= funcIndent) {
                    inFunc = false;
                    result.append(line).append("\n");
                    continue;
                }

                // وجدنا stub placeholder
                if (isStubLine(trimmed)) {
                    int bodyIndent = funcIndent + 4;
                    appendIndented(result, suggestion, bodyIndent);
                    replaced = true;
                    inFunc   = false;
                    continue;
                }
            }

            result.append(line).append("\n");
        }

        return result.toString();
    }

    // ═══════════════════════════════════════════════════
    // applyChange helpers
    // ═══════════════════════════════════════════════════

    /** هل السطر هو تعريف الدالة المستهدفة؟ */
    private static boolean matchesFuncDef(String trimmed, String funcName) {
        return trimmed.startsWith("def " + funcName + "(")
            || trimmed.startsWith("async def " + funcName + "(");
    }

    /** هل السطر هو stub placeholder؟ */
    private static boolean isStubLine(String trimmed) {
        return trimmed.equals("pass")
            || trimmed.equals("...")
            || trimmed.startsWith("raise NotImplementedError")
            || trimmed.startsWith("return None  # stub")
            || trimmed.startsWith("# TODO");
    }

    /** عدد المسافات في بداية السطر */
    private static int leadingSpaces(String line) {
        int count = 0;
        for (char c : line.toCharArray()) {
            if (c == ' ') count++;
            else break;
        }
        return count;
    }

    /**
     * يُضيف الـ suggestion بـ indent صحيح:
     * 1. يستخرج الـ indent الأصلي من أول سطر غير فارغ في الـ suggestion
     * 2. يحذفه ويضع الـ targetIndent بدله
     */
    private static void appendIndented(StringBuilder out, String suggestion, int targetIndent) {
        String[] lines       = suggestion.split("\n");
        String   targetPad   = " ".repeat(targetIndent);
        int      existIndent = -1;

        for (String sl : lines) {
            if (sl.trim().isEmpty()) {
                out.append("\n");
                continue;
            }
            // اكتشف الـ indent الأصلي من أول سطر غير فارغ
            if (existIndent < 0) existIndent = leadingSpaces(sl);

            // احذف الـ indent الأصلي وضع الجديد
            String stripped = (sl.length() >= existIndent)
                ? sl.substring(existIndent)
                : sl.stripLeading();

            out.append(targetPad).append(stripped).append("\n");
        }
    }
}
