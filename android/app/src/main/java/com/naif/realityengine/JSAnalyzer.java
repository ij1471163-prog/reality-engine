package com.naif.realityengine;

import java.util.*;
import java.util.regex.*;

/**
 * JSAnalyzer v3.0
 * ✅ forEach + return detection (brace depth)
 * ✅ Accumulation bug (stack-based loop tracking)
 * ✅ Loose equality (== → ===)
 * ✅ Null usage detection
 * ✅ autoFix (bottom-up, no index drift)
 * ✅ Arrow functions — missing return, implicit void, body-block confusion
 * ✅ Confidence scoring — per-issue weighted score
 */
public class JSAnalyzer {

    // ═══════════════════════════════════════════════════
    // Enums
    // ═══════════════════════════════════════════════════

    public enum IssueType { STUB, BUG }
    public enum Severity  { CRITICAL, HIGH, MEDIUM, LOW }

    // ═══════════════════════════════════════════════════
    // Issue — immutable
    // ═══════════════════════════════════════════════════

    public static class Issue {
        public final String    title;
        public final String    evidence;
        public final String    fix;
        public final int       line;
        public final IssueType type;
        public final Severity  severity;
        public final double    confidence; // 0.0 – 1.0

        public Issue(String title, String evidence, String fix,
                     int line, IssueType type, Severity severity,
                     double confidence) {
            this.title      = title;
            this.evidence   = evidence;
            this.fix        = fix;
            this.line       = line;
            this.type       = type;
            this.severity   = severity;
            this.confidence = Math.max(0.0, Math.min(1.0, confidence));
        }

        /** Legacy constructor — confidence افتراضي بناءً على severity */
        public Issue(String title, String evidence, String fix,
                     int line, IssueType type, Severity severity) {
            this(title, evidence, fix, line, type, severity,
                defaultConfidence(severity));
        }

        private static double defaultConfidence(Severity s) {
            switch (s) {
                case CRITICAL: return 0.90;
                case HIGH:     return 0.75;
                case MEDIUM:   return 0.60;
                default:       return 0.45;
            }
        }

        public String confidenceIcon() {
            return confidence >= 0.85 ? "🟢" : confidence >= 0.60 ? "🟡" : "🔴";
        }

        @Override public String toString() {
            return String.format("[%s/%s] س%d %s %.0f%%: %s",
                severity, type, line,
                confidenceIcon(), confidence * 100, title);
        }
    }

    // ═══════════════════════════════════════════════════
    // AnalysisResult
    // ═══════════════════════════════════════════════════

    public static class AnalysisResult {
        public final List<Issue> issues = new ArrayList<>();
        public String fixedCode = null;

        public void add(Issue i) { issues.add(i); }
        public boolean hasIssues() { return !issues.isEmpty(); }

        public long countBySeverity(Severity s) {
            return issues.stream().filter(i -> i.severity == s).count();
        }

        /** متوسط confidence لكل الـ issues */
        public double averageConfidence() {
            return issues.stream()
                .mapToDouble(i -> i.confidence)
                .average().orElse(1.0);
        }

        /** issues فوق threshold confidence فقط */
        public List<Issue> highConfidenceIssues(double threshold) {
            List<Issue> out = new ArrayList<>();
            for (Issue i : issues) if (i.confidence >= threshold) out.add(i);
            return out;
        }
    }

    // ═══════════════════════════════════════════════════
    // Compiled Patterns — مرة واحدة
    // ═══════════════════════════════════════════════════

    // تراكم: total/sum/count/result = (بدون =+, +=, ==, <=, >=, !=)
    private static final Pattern PAT_ACCUM = Pattern.compile(
        "^\\s*(total|sum|count|result)\\s*=(?![=+\\-<>!])");

    // مقارنة loose: x == y (مو ===, !==, <=, >=)
    private static final Pattern PAT_LOOSE_EQ = Pattern.compile(
        "[^=!<>]==[^=]");

    // تعريف متغير من find/get مع فحص اسم دقيق
    private static final Pattern PAT_NULL_ASSIGN = Pattern.compile(
        "(?:const|let|var)\\s+(\\w+)\\s*=\\s*\\w+\\.(?:find|get|getElementById|querySelector)\\s*\\(");

    // بداية loop/forEach
    private static final Pattern PAT_LOOP_START = Pattern.compile(
        "\\.forEach\\s*\\(|\\bfor\\s*\\(|\\bwhile\\s*\\(");

    // Arrow: دالة سهم بجسم block تحتوي return
    // مثال: const f = (x) => { ... }
    private static final Pattern PAT_ARROW_BLOCK = Pattern.compile(
        "(?:const|let|var)\\s+(\\w+)\\s*=\\s*(?:\\([^)]*\\)|\\w+)\\s*=>\\s*\\{");

    // Arrow: دالة سهم expression بدون {} — implicit return
    // مثال: const f = x => x * 2
    private static final Pattern PAT_ARROW_EXPR = Pattern.compile(
        "(?:const|let|var)\\s+(\\w+)\\s*=\\s*(?:\\([^)]*\\)|\\w+)\\s*=>\\s*(?!\\{)(.+)");

    // Arrow void: callback سهم يُستخدم كـ event handler / forEach
    // مثال: btn.addEventListener('click', () => { ... })
    private static final Pattern PAT_ARROW_CALLBACK = Pattern.compile(
        "(?:addEventListener|setTimeout|setInterval|then|catch)\\s*\\(\\s*(?:[^,]+,\\s*)?(?:\\([^)]*\\)|\\w*)\\s*=>");

    // ═══════════════════════════════════════════════════
    // Entry Point
    // ═══════════════════════════════════════════════════

    public static AnalysisResult analyze(String code) {
        AnalysisResult result = new AnalysisResult();
        if (code == null || code.isEmpty()) return result;

        String[] lines = code.split("\n");

        detectForEachReturn(lines, result);
        detectAccumulation(lines, result);
        detectLooseEquality(lines, result);
        detectNullUsage(lines, result);
        detectArrowFunctions(lines, result);   // ✅ جديد

        // ✅ حساب confidence لكل issue بعد الاكتشاف
        applyConfidenceScoring(lines, result);

        if (result.hasIssues()) {
            result.fixedCode = autoFix(code, result);
        }

        return result;
    }

    // ═══════════════════════════════════════════════════
    // 5. Arrow Functions — 3 حالات
    // ═══════════════════════════════════════════════════

    private static void detectArrowFunctions(String[] lines, AnalysisResult result) {
        for (int i = 0; i < lines.length; i++) {
            String line = lines[i];
            String t    = line.trim();
            if (t.startsWith("//")) continue;

            // ── حالة A: block arrow بدون return ──
            // const fn = (x) => { ... } لكن ما فيه return داخلها
            Matcher mBlock = PAT_ARROW_BLOCK.matcher(line);
            if (mBlock.find()) {
                String fnName  = mBlock.group(1);
                boolean hasReturn = false;
                int depth = 0;
                for (int j = i; j < Math.min(i + 20, lines.length); j++) {
                    depth += countChar(lines[j], '{') - countChar(lines[j], '}');
                    String jt = lines[j].trim();
                    if (j > i && jt.startsWith("return ")) { hasReturn = true; break; }
                    if (j > i && depth <= 0) break;
                }
                // لو اسم الدالة يوحي بقيمة لكن ما فيه return
                boolean impliesValue = fnName.startsWith("get") || fnName.startsWith("calc")
                    || fnName.startsWith("compute") || fnName.startsWith("find")
                    || fnName.startsWith("build") || fnName.startsWith("create");
                if (!hasReturn && impliesValue) {
                    result.add(new Issue(
                        "arrow function '" + fnName + "' بلا return رغم أنها تُرجع قيمة",
                        t,
                        t.replace("=> {", "=> {\n  return /* القيمة */;"),
                        i + 1, IssueType.BUG, Severity.HIGH, 0.72
                    ));
                }
            }

            // ── حالة B: expression arrow تُستخدم في forEach (implicit void) ──
            // arr.forEach(x => doSomething(x)) — OK
            // arr.forEach(x => x.value) — عديمة الفائدة (expression مهملة)
            if (line.contains(".forEach(") && line.contains("=>")) {
                // لو الـ arrow expression لا تحتوي استدعاء دالة (مجرد property access)
                int arrowIdx = line.indexOf("=>");
                String afterArrow = arrowIdx >= 0 && arrowIdx + 2 < line.length()
                    ? line.substring(arrowIdx + 2).trim() : "";
                boolean hasCall    = afterArrow.contains("(");
                boolean hasBlock   = afterArrow.startsWith("{");
                boolean isBareExpr = !hasCall && !hasBlock && afterArrow.length() > 0
                    && !afterArrow.startsWith("//");
                if (isBareExpr) {
                    result.add(new Issue(
                        "forEach arrow تُقيّم expression بدون تأثير",
                        t,
                        null, // لا fix تلقائي — السياق مجهول
                        i + 1, IssueType.BUG, Severity.MEDIUM, 0.65
                    ));
                }
            }

            // ── حالة C: async arrow بدون await أو try/catch ──
            // const fn = async () => { fetch(...) }  بدون await
            if (line.contains("async") && line.contains("=>") && line.contains("{")) {
                boolean hasAwait    = false;
                boolean hasTryCatch = false;
                int depth = 0;
                for (int j = i; j < Math.min(i + 25, lines.length); j++) {
                    String jt = lines[j].trim();
                    depth += countChar(lines[j], '{') - countChar(lines[j], '}');
                    if (jt.contains("await "))    hasAwait    = true;
                    if (jt.startsWith("try") || jt.startsWith("catch")) hasTryCatch = true;
                    if (j > i && depth <= 0) break;
                }
                if (!hasAwait) {
                    result.add(new Issue(
                        "async arrow بدون await — async غير ضروري",
                        t, null,
                        i + 1, IssueType.BUG, Severity.LOW, 0.58
                    ));
                } else if (hasAwait && !hasTryCatch) {
                    result.add(new Issue(
                        "async arrow بـ await بدون try/catch — unhandled rejection",
                        t,
                        t.replace("async", "async /* أضف try/catch */"),
                        i + 1, IssueType.BUG, Severity.MEDIUM, 0.70
                    ));
                }
            }
        }
    }

    // ═══════════════════════════════════════════════════
    // Confidence Scoring — يُعدّل confidence بعد الاكتشاف
    // ═══════════════════════════════════════════════════

    /**
     * نظام أدلة مُركّب — يُعدّل confidence كل issue بناءً على:
     * 1. هل الـ fix موجود وقصير (دليل دقة)
     * 2. هل الـ evidence طويل (سياق أوضح)
     * 3. هل نفس الـ pattern موجود أكثر من مرة في الكود
     * 4. هل السطر داخل comment (يُخفّض)
     *
     * يُعيد list جديدة — لا يُعدّل الـ issues الموجودة (immutable)
     * لذا نُضيف الـ issues المعدّلة لـ result جديد ونستبدل القائمة.
     */
    private static void applyConfidenceScoring(String[] lines, AnalysisResult result) {
        String fullCode = String.join("\n", lines);

        // استبدل كل issue بنسخة مُعدّلة الـ confidence
        List<Issue> rescored = new ArrayList<>();
        for (Issue iss : result.issues) {
            double conf = iss.confidence;

            // +0.10 لو الـ fix موجود وقصير (< 100 حرف) — دليل دقة
            if (iss.fix != null && iss.fix.length() < 100) conf += 0.10;

            // +0.05 لو الـ evidence طويل (> 20 حرف) — سياق واضح
            if (iss.evidence != null && iss.evidence.length() > 20) conf += 0.05;

            // +0.08 لو نفس النمط يتكرر في الكود أكثر من مرة
            if (iss.evidence != null && fullCode.indexOf(iss.evidence) != fullCode.lastIndexOf(iss.evidence))
                conf += 0.08;

            // -0.30 لو السطر داخل comment (نادر — لكن احتياط)
            int li = iss.line - 1;
            if (li >= 0 && li < lines.length && lines[li].trim().startsWith("//"))
                conf -= 0.30;

            // -0.15 لو الـ title يحتوي "قد يكون" (تقدير غير مؤكد)
            if (iss.title.contains("قد يكون")) conf -= 0.15;

            conf = Math.max(0.0, Math.min(1.0, conf));
            conf = Math.round(conf * 100.0) / 100.0;

            rescored.add(new Issue(
                iss.title, iss.evidence, iss.fix,
                iss.line, iss.type, iss.severity, conf
            ));
        }

        result.issues.clear();
        result.issues.addAll(rescored);
    }

    // ═══════════════════════════════════════════════════
    // 1. forEach + return — مع brace depth
    // ═══════════════════════════════════════════════════

    private static void detectForEachReturn(String[] lines, AnalysisResult result) {
        for (int i = 0; i < lines.length; i++) {
            if (!lines[i].contains(".forEach(")) continue;

            // ابدأ عدّ الـ braces من سطر forEach
            int depth = 0;
            boolean foundReturn     = false;
            boolean foundSideEffect = false;

            for (int j = i; j < Math.min(i + 30, lines.length); j++) {
                String line = lines[j];
                String t    = line.trim();

                depth += countChar(line, '{') - countChar(line, '}');

                // خرجنا من forEach body
                if (j > i && depth <= 0) break;

                if (j > i && t.startsWith("return ") && !t.startsWith("//")) {
                    foundReturn = true;
                }
                // side effect: استدعاء دالة بدون return/if/console
                if (j > i && depth > 0
                        && t.matches("[a-zA-Z_]\\w*\\s*\\(.*")
                        && !t.startsWith("return")
                        && !t.startsWith("if")
                        && !t.startsWith("console")) {
                    foundSideEffect = true;
                }
            }

            if (foundReturn) {
                String fix = foundSideEffect ? null
                    : lines[i].trim().replace(".forEach(", ".find(");
                result.add(new Issue(
                    foundSideEffect
                        ? "return داخل forEach مع side effects"
                        : "return داخل forEach لا يعمل",
                    lines[i].trim(), fix,
                    i + 1, IssueType.BUG, Severity.HIGH
                ));
            }
        }
    }

    // ═══════════════════════════════════════════════════
    // 2. Accumulation — brace-depth stack
    // ═══════════════════════════════════════════════════

    private static void detectAccumulation(String[] lines, AnalysisResult result) {
        // Stack يحتفظ بـ brace depth عند دخول كل loop
        Deque<Integer> loopDepths = new ArrayDeque<>();
        int braceDepth = 0;

        for (int i = 0; i < lines.length; i++) {
            String line = lines[i];
            String t    = line.trim();
            if (t.startsWith("//")) continue;

            // افتح loop → ادفع depth الحالي
            if (PAT_LOOP_START.matcher(line).find()) {
                loopDepths.push(braceDepth);
            }

            braceDepth += countChar(line, '{') - countChar(line, '}');

            // أغلق loop لو depth رجع لمستوى ما قبل الدخول
            while (!loopDepths.isEmpty() && braceDepth <= loopDepths.peek()) {
                loopDepths.pop();
            }

            // داخل loop؟
            if (loopDepths.isEmpty()) continue;

            // تحقق من تراكم خاطئ
            if (PAT_ACCUM.matcher(line).find()) {
                // ✅ fix دقيق: استبدل فقط = الأول بعد اسم المتغير
                String fixed = line.replaceFirst(
                    "(total|sum|count|result)\\s*=(?![=+\\-<>!])",
                    "$1 +="
                );
                result.add(new Issue(
                    "خطأ في التراكم: = بدل +=",
                    t, fixed.trim(),
                    i + 1, IssueType.BUG, Severity.CRITICAL
                ));
            }
        }
    }

    // ═══════════════════════════════════════════════════
    // 3. Loose Equality
    // ═══════════════════════════════════════════════════

    private static void detectLooseEquality(String[] lines, AnalysisResult result) {
        for (int i = 0; i < lines.length; i++) {
            String t = lines[i].trim();
            if (t.startsWith("//") || t.startsWith("*")) continue;
            if (!PAT_LOOSE_EQ.matcher(lines[i]).find()) continue;
            if (!t.contains("if ") && !t.contains("while ") && !t.contains("? ")) continue;

            result.add(new Issue(
                "مقارنة == بدل ===",
                t,
                t.replaceAll("([^=!<>])==([^=])", "$1===$2"),
                i + 1, IssueType.BUG, Severity.MEDIUM
            ));
        }
    }

    // ═══════════════════════════════════════════════════
    // 4. Null Usage — أدق
    // ═══════════════════════════════════════════════════

    private static void detectNullUsage(String[] lines, AnalysisResult result) {
        for (int i = 0; i < lines.length - 1; i++) {
            Matcher m = PAT_NULL_ASSIGN.matcher(lines[i]);
            if (!m.find()) continue;

            String varName = m.group(1);
            String next    = lines[i + 1].trim();

            // تحقق إن السطر التالي يستخدم varName مع . (method/property access)
            // ولم يبدأ بـ if أو null check
            boolean isDirectAccess = next.contains(varName + ".")
                && !next.startsWith("if")
                && !next.contains("?.")         // optional chaining
                && !next.contains("?? ")        // nullish coalescing
                && !next.contains("!= null")
                && !next.contains("!== null")
                && !next.contains("== null")
                && !next.contains("=== null");

            if (isDirectAccess) {
                result.add(new Issue(
                    varName + " قد يكون null — استخدم ?. أو تحقق أولاً",
                    next,
                    "if (" + varName + ") { " + next + " }",
                    i + 2, IssueType.BUG, Severity.HIGH
                ));
            }
        }
    }

    // ═══════════════════════════════════════════════════
    // autoFix — من الأسفل للأعلى (no index drift)
    // ═══════════════════════════════════════════════════

    public static String autoFix(String code, AnalysisResult result) {
        String[] lines  = code.split("\n");
        String[] fixed  = Arrays.copyOf(lines, lines.length);
        boolean changed = false;

        // ✅ من الأسفل للأعلى — تغيير سطر لا يؤثر على indices ما فوقه
        List<Issue> sorted = new ArrayList<>(result.issues);
        sorted.sort((a, b) -> b.line - a.line);

        for (Issue issue : sorted) {
            int idx = issue.line - 1;
            if (idx < 0 || idx >= fixed.length) continue;

            if (issue.title.contains("forEach")) {
                // ابحث عن سطر forEach قبل السطر الحالي
                for (int i = Math.max(0, idx - 5); i < idx; i++) {
                    if (fixed[i].contains(".forEach(")) {
                        fixed[i] = fixed[i].replace(".forEach(", ".find(");
                        changed  = true;
                        break;
                    }
                }

            } else if (issue.title.contains("التراكم")) {
                // ✅ regex دقيق — مو replaceFirst("=\\s*")
                String newLine = fixed[idx].replaceFirst(
                    "(total|sum|count|result)\\s*=(?![=+\\-<>!])",
                    "$1 +="
                );
                if (!newLine.equals(fixed[idx])) {
                    fixed[idx] = newLine;
                    changed    = true;
                }

            } else if (issue.title.contains("==")) {
                String newLine = fixed[idx].replaceAll(
                    "([^=!<>])==([^=])", "$1===$2");
                if (!newLine.equals(fixed[idx])) {
                    fixed[idx] = newLine;
                    changed    = true;
                }
            }
            // null usage — ما نُطبّق fix تلقائياً (قد يكسر الـ logic)
        }

        return changed ? String.join("\n", fixed) : null;
    }

    // ═══════════════════════════════════════════════════
    // Helper — عدّ حرف في سطر
    // ═══════════════════════════════════════════════════

    private static int countChar(String s, char ch) {
        int count = 0;
        for (int i = 0; i < s.length(); i++)
            if (s.charAt(i) == ch) count++;
        return count;
    }
}
