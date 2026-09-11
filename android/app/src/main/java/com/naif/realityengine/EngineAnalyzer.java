package com.naif.realityengine;

import java.util.ArrayList;
import java.util.List;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * EngineAnalyzer v2.0
 * ✅ engineMessage مُهيَّأ — لا null bug
 * ✅ Pattern.compile static final
 * ✅ Language detection شامل
 * ✅ JS block لا يتجاهل stubs
 * ✅ كل الـ summaries تُجمع أولاً
 * ✅ mlSummary name conflict محلول
 * ✅ FunctionAnalysis + EngineReport fields final حيث ممكن
 */
public class EngineAnalyzer {

    // ═══════════════════════════════════════════════════
    // Compiled Patterns
    // ═══════════════════════════════════════════════════

    private static final Pattern PAT_FUNC_COUNT = Pattern.compile(
        "^\\s*def\\s+\\w+", Pattern.MULTILINE);

    private static final Pattern PAT_PYTHON_STUB = Pattern.compile(
        "^(\\s*)def\\s+(\\w+)\\s*\\(([^)]*)\\).*:\\s*\\n(?:.*\\n)*?\\1    (?:pass|\\.\\.\\.)",
        Pattern.MULTILINE);

    // ═══════════════════════════════════════════════════
    // Enums & Data Classes
    // ═══════════════════════════════════════════════════

    public enum Fixability { HIGH, MEDIUM, LOW }

    public static class FunctionAnalysis {
        public String       name;
        public int          line;
        public String       risk;
        public Fixability   fixability;
        public String       fixReason;
        public String       intent;
        public List<String> signals    = new ArrayList<>();
        public boolean      canAutoFix;
        public String       warningNote;
    }

    public static class EngineReport {
        public String                  fileName;
        public int                     totalLines;
        public int                     totalFunctions;
        public List<FunctionAnalysis>  stubs          = new ArrayList<>();
        public int                     highFixable;
        public int                     mediumFixable;
        public int                     lowFixable;
        public String                  engineMessage  = ""; // ✅ مُهيَّأ بـ ""
        public String                  recommendation = "";
        public String                  language;
        // إحصائيات إضافية
        public int                     securityIssues = 0;
        public int                     bugCount       = 0;
        public List<String>            securityNotes  = new ArrayList<>(); // DataFlow warnings
        public List<DataFlowAnalyzer.DataFlow> dataFlows = new ArrayList<>(); // تدفقات البيانات
    }

    // ═══════════════════════════════════════════════════
    // Language Detection
    // ═══════════════════════════════════════════════════

    private static String detectLanguage(String code, String fileName) {
        if (fileName.endsWith(".py"))   return "Python";
        if (fileName.endsWith(".java")) return "Java";
        if (fileName.endsWith(".kt"))   return "Kotlin";
        if (fileName.endsWith(".dart")) return "Dart";
        if (fileName.endsWith(".php"))  return "PHP";
        if (fileName.endsWith(".ts") || fileName.endsWith(".tsx")) return "TypeScript";
        if (fileName.endsWith(".jsx"))  return "JSX";
        if (fileName.endsWith(".js"))   return "JavaScript";
        if (fileName.endsWith(".html")) return "HTML";
        // Fallback: فحص محتوى
        if (code.contains("def ")    && code.contains(":"))  return "Python";
        if (code.contains("public ") && code.contains(";"))  return "Java";
        if (code.contains("fun ")    && code.contains("{"))  return "Kotlin";
        if (code.contains("<?php"))                          return "PHP";
        return "Unknown";
    }

    // ═══════════════════════════════════════════════════
    // Fixability + Intent
    // ═══════════════════════════════════════════════════

    private static Fixability getFixability(String name) {
        String n = name.toLowerCase();
        if (n.matches("^(is_|has_|can_|validate_|check_|verify_|calculate|compute|sum|total|avg|read_|load_|save_|write_|get_|fetch_|log_|hash_|encrypt_|format_|parse_|send_|email_).*"))
            return Fixability.HIGH;
        if (n.length() > 5 && !n.matches("^(process|handle|run|execute|do|action|work|main).*"))
            return Fixability.MEDIUM;
        return Fixability.LOW;
    }

    private static String getIntent(String name) {
        String n = name.toLowerCase();
        if (n.matches("^(is_|has_|can_|check_|verify_|validate_).*")) return "تحقق من صحة";
        if (n.contains("calculate") || n.contains("sum") || n.contains("total")) return "حساب";
        if (n.contains("read")   || n.contains("load"))   return "قراءة ملف";
        if (n.contains("write")  || n.contains("save"))   return "كتابة ملف";
        if (n.contains("send")   || n.contains("email"))  return "إرسال";
        if (n.contains("get")    || n.contains("fetch"))  return "جلب بيانات";
        if (n.contains("hash")   || n.contains("encrypt"))return "تشفير";
        if (n.contains("log")    || n.contains("debug"))  return "تسجيل";
        if (n.contains("parse")  || n.contains("format")) return "تحويل بيانات";
        if (n.contains("delete") || n.contains("remove")) return "حذف";
        if (n.contains("create") || n.contains("build"))  return "إنشاء";
        if (n.contains("find")   || n.contains("search")) return "بحث";
        if (n.contains("sort")   || n.contains("order"))  return "ترتيب";
        if (n.contains("filter"))                          return "تصفية";
        return "غير محدد";
    }

    // ═══════════════════════════════════════════════════
    // Summary Builder — يجمع كل الـ summaries
    // ═══════════════════════════════════════════════════

    private static String buildAllSummaries(String code, String fileName, EngineReport report) {
        StringBuilder all = new StringBuilder();

        // 1. Security
        try {
            java.util.List<SecurityScanner.SecurityIssue> secIssues =
                SecurityScanner.scan(code, fileName);
            if (!secIssues.isEmpty()) {
                report.securityIssues = secIssues.size();
                all.append("\n\n\uD83D\uDD10 تحذيرات أمنية (")
                   .append(secIssues.size()).append("):\n");
                for (SecurityScanner.SecurityIssue si : secIssues) {
                    all.append(si.severity.equals("CRITICAL") ? "\uD83D\uDD34" : "\uD83D\uDFE0")
                       .append(" ").append(si.title)
                       .append(" — السطر ").append(si.line).append("\n");
                }
            }
        } catch (Exception ignored) {}

        // 2. Bugs
        try {
            BugDetector.BugReport bugReport = BugDetector.detect(code);
            if (!bugReport.bugs.isEmpty()) {
                report.bugCount = bugReport.bugs.size();
                all.append("\n\n\uD83D\uDC1B أخطاء مكتشفة (")
                   .append(bugReport.bugs.size()).append("):\n");
                for (BugDetector.Bug bug : bugReport.bugs) {
                    String icon = bug.severity == BugDetector.Severity.CRITICAL ? "\uD83D\uDD34"
                        : bug.severity == BugDetector.Severity.HIGH ? "\uD83D\uDFE0" : "\uD83D\uDFE1";
                    all.append(icon).append(" ").append(bug.title)
                       .append(" — السطر ").append(bug.line).append("\n");
                }
            }
        } catch (Exception ignored) {}

        // 3. JS Analysis
        if (fileName.endsWith(".js") || fileName.endsWith(".jsx")
                || fileName.endsWith(".ts") || fileName.endsWith(".html")) {
            try {
                JSAnalyzer.AnalysisResult jsResult = JSAnalyzer.analyze(code);
                if (jsResult.hasIssues()) {
                    all.append("\n\n\uD83D\uDC1B أخطاء JavaScript (")
                       .append(jsResult.issues.size()).append("):\n");
                    for (JSAnalyzer.Issue issue : jsResult.issues) {
                        String icon = issue.severity == JSAnalyzer.Severity.CRITICAL ? "\uD83D\uDD34"
                            : issue.severity == JSAnalyzer.Severity.HIGH ? "\uD83D\uDFE0" : "\uD83D\uDFE1";
                        all.append(icon).append(" ").append(issue.title)
                           .append(" — السطر ").append(issue.line).append("\n");
                    }
                }
            } catch (Exception ignored) {}
        }

        // 4. MultiLang (TS/Kotlin/PHP)
        try {
            java.util.List<MultiLangAnalyzer.Issue> mlIssues =
                MultiLangAnalyzer.analyze(code, fileName);
            if (!mlIssues.isEmpty()) {
                all.append("\n\n[MultiLang] ").append(mlIssues.size()).append(" مشاكل:\n");
                for (MultiLangAnalyzer.Issue mi : mlIssues) {
                    all.append("[").append(mi.severity).append("] ")
                       .append(mi.title).append(" — السطر ").append(mi.line).append("\n");
                }
            }
        } catch (Exception ignored) {}

        // 5. Java AST
        if (fileName.endsWith(".java")) {
            try {
                java.util.List<JavaASTEngine.ASTIssue> astIssues = JavaASTEngine.analyze(code);
                if (!astIssues.isEmpty()) {
                    all.append("\n\n[Java AST] ").append(astIssues.size()).append(" مشاكل:\n");
                    for (JavaASTEngine.ASTIssue ai : astIssues) {
                        all.append("[").append(ai.severity).append("] ")
                           .append(ai.title).append(" — السطر ").append(ai.line).append("\n");
                    }
                }
            } catch (Exception ignored) {}
        }

        // 6. Python Indent
        if (fileName.endsWith(".py")) {
            try {
                java.util.List<IndentAnalyzer.IndentIssue> indentIssues =
                    IndentAnalyzer.analyze(code, fileName);
                if (!indentIssues.isEmpty()) {
                    all.append("\n\n[Indent] ").append(indentIssues.size()).append(" مشاكل:\n");
                    for (IndentAnalyzer.IndentIssue ii : indentIssues) {
                        all.append("[").append(ii.severity).append("] ")
                           .append(ii.title).append(" — السطر ").append(ii.line).append("\n");
                    }
                }
            } catch (Exception ignored) {}
        }

        // 7. Dart
        if (fileName.endsWith(".dart")) {
            try {
                java.util.List<DartAnalyzer.Issue> dartIssues =
                    DartAnalyzer.analyze(code, fileName);
                if (!dartIssues.isEmpty()) {
                    all.append("\n\n[Dart] ").append(dartIssues.size()).append(" مشاكل:\n");
                    for (DartAnalyzer.Issue di : dartIssues) {
                        all.append("[").append(di.severity).append("] ")
                           .append(di.title).append(" — السطر ").append(di.line).append("\n");
                    }
                }
            } catch (Exception ignored) {}
        }

        // 8. ML Patterns
        try {
            java.util.List<MLPatternFinder.MLIssue> mlPatterns =
                MLPatternFinder.analyze(code, fileName);
            if (!mlPatterns.isEmpty()) {
                all.append("\n\n[ML Patterns] ").append(mlPatterns.size()).append(" مشاكل:\n");
                for (MLPatternFinder.MLIssue ml : mlPatterns) {
                    all.append("[").append(ml.severity).append("] ")
                       .append(ml.title).append(" — السطر ").append(ml.line).append("\n");
                }
            }
        } catch (Exception ignored) {}

        // 9. Secrets
        try {
            java.util.List<SecretDetector.Secret> secrets =
                SecretDetector.scan(code, fileName);
            if (!secrets.isEmpty()) {
                all.append("\n\n[Secrets] ").append(secrets.size()).append(" مشاكل:\n");
                for (SecretDetector.Secret s : secrets) {
                    all.append("[").append(s.severity).append("] ")
                       .append(s.title).append(" — السطر ").append(s.line).append("\n");
                }
            }
        } catch (Exception ignored) {}

        return all.toString();
    }

    // ═══════════════════════════════════════════════════
    // analyze() — Entry Point
    // ═══════════════════════════════════════════════════

    // ─── استخراج body الدالة ─────────────────────────────
    private static String extractFuncBody(String code, int startPos, String indent) {
        String[] lines = code.substring(startPos).split("\n");
        StringBuilder body = new StringBuilder();
        for (String line : lines) {
            if (!line.isEmpty() && !line.startsWith(indent + "    ") && !line.trim().isEmpty()) break;
            body.append(line).append("\n");
            if (body.length() > 2000) break; // حد أقصى للأداء
        }
        return body.toString().trim();
    }

    public static EngineReport analyze(String code, String fileName) {
        EngineReport report = new EngineReport();
        report.fileName   = fileName;
        report.totalLines = code.split("\n", -1).length;
        report.language   = detectLanguage(code, fileName); // ✅ شامل

        // Count total functions
        Matcher fm = PAT_FUNC_COUNT.matcher(code); // ✅ static final
        int total = 0;
        while (fm.find()) total++;
        report.totalFunctions = total;

        // Find Python stubs
        Matcher m = PAT_PYTHON_STUB.matcher(code); // ✅ static final
        while (m.find()) {
            String name   = m.group(2);
            String before = code.substring(0, m.start());
            int lineNo    = before.split("\n", -1).length;

            // استخرج parameters وbody الدالة
            String rawParams = m.groupCount() >= 3 ? m.group(3) : "";
            java.util.List<String> params = new java.util.ArrayList<>();
            if (rawParams != null && !rawParams.isEmpty()) {
                for (String p : rawParams.split(",")) {
                    String trimmed = p.trim().replaceAll("\\s*=.*", ""); // حذف default values
                    if (!trimmed.isEmpty()) params.add(trimmed);
                }
            }
            // استخرج body الدالة (أسطر بعد def حتى نهاية الـstub)
            String funcBody = extractFuncBody(code, m.end(), m.group(1));

            FunctionAnalysis fa = new FunctionAnalysis();
            fa.name       = name;
            fa.line       = lineNo;
            fa.risk       = "confirmed";
            fa.fixability = getFixability(name);
            // IntentAnalyzer — يحلل اسم + parameters + body
            try {
                IntentAnalyzer.IntentResult ir = IntentAnalyzer.analyze(name, params, funcBody);
                fa.intent = (ir != null && ir.confidence > 0.4) ? ir.intent : getIntent(name);
            } catch (Exception _e) { fa.intent = getIntent(name); }
            fa.canAutoFix = fa.fixability == Fixability.HIGH;

            switch (fa.fixability) {
                case HIGH:
                    fa.fixReason   = "الاسم واضح — المحرك واثق في الإصلاح";
                    fa.warningNote = null;
                    fa.signals.add("اسم الدالة يطابق نمط معروف");
                    break;
                case MEDIUM:
                    fa.fixReason   = "يمكن توليد اقتراح — راجعه قبل الموافقة";
                    fa.warningNote = "راجع الاقتراح بعناية";
                    fa.signals.add("اسم الدالة يحتاج سياق إضافي");
                    break;
                case LOW:
                    fa.fixReason   = "الاسم غير وصفي — الاقتراح سيكون عاماً";
                    fa.warningNote = "يُنصح بإعادة تسمية الدالة أولاً";
                    fa.signals.add("اسم غير وصفي");
                    break;
            }

            report.stubs.add(fa);
        }

        // DataFlowAnalyzer — تحليل تدفق البيانات على مستوى الملف
        try {
            DataFlowAnalyzer.DataFlowResult dfr = DataFlowAnalyzer.analyze(code, fileName);
            if (dfr != null) {
                report.dataFlows.addAll(dfr.flows);
                report.securityNotes.addAll(dfr.warnings);
            }
        } catch (Exception ignored) {}

        report.highFixable   = (int) report.stubs.stream().filter(s -> s.fixability == Fixability.HIGH).count();
        report.mediumFixable = (int) report.stubs.stream().filter(s -> s.fixability == Fixability.MEDIUM).count();
        report.lowFixable    = (int) report.stubs.stream().filter(s -> s.fixability == Fixability.LOW).count();

        // ✅ اجمع كل الـ summaries أولاً ثم أضفها مرة واحدة
        String allSummaries = buildAllSummaries(code, fileName, report);

        // ✅ بناء engineMessage بدون null checks
        if (report.stubs.isEmpty()) {
            boolean hasIssues = !allSummaries.isEmpty();
            report.engineMessage  = hasIssues
                ? "لا دوال ناقصة" + allSummaries
                : "الملف يبدو مكتملاً — لا مشاكل مكتشفة.";
            report.recommendation = hasIssues
                ? "يوجد أخطاء — استخدم AI للإصلاح."
                : "الملف يبدو مكتملاً.";
        } else {
            report.engineMessage =
                "وجد المحرك " + report.stubs.size() + " دالة ناقصة:\n"
                + report.highFixable   + " واضحة ✓  •  "
                + report.mediumFixable + " راجع ⚠️  •  "
                + report.lowFixable    + " صعب ✗"
                + allSummaries;
            report.recommendation = "راجع كل اقتراح قبل الموافقة.";
        }

        return report;
    }
}
