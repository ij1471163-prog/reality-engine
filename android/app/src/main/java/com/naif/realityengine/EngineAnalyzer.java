package com.naif.realityengine;

import java.util.ArrayList;
import java.util.List;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

public class EngineAnalyzer {

    public enum Fixability { HIGH, MEDIUM, LOW }

    public static class FunctionAnalysis {
        public String name;
        public int line;
        public String risk;
        public Fixability fixability;
        public String fixReason;
        public String intent;
        public List<String> signals = new ArrayList<>();
        public boolean canAutoFix;
        public String warningNote;
    }

    public static class EngineReport {
        public String fileName;
        public int totalLines;
        public int totalFunctions;
        public List<FunctionAnalysis> stubs = new ArrayList<>();
        public int highFixable;
        public int mediumFixable;
        public int lowFixable;
        public String engineMessage;
        public String recommendation;
        public String language;
    }

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
        if (n.contains("read") || n.contains("load")) return "قراءة ملف";
        if (n.contains("write") || n.contains("save")) return "كتابة ملف";
        if (n.contains("send") || n.contains("email")) return "إرسال";
        if (n.contains("get") || n.contains("fetch")) return "جلب بيانات";
        if (n.contains("hash") || n.contains("encrypt")) return "تشفير";
        if (n.contains("log") || n.contains("debug")) return "تسجيل";
        if (n.contains("parse") || n.contains("format")) return "تحويل بيانات";
        if (n.contains("delete") || n.contains("remove")) return "حذف";
        if (n.contains("create") || n.contains("build")) return "إنشاء";
        return "غير محدد";
    }

    public static EngineReport analyze(String code, String fileName) {
        EngineReport report = new EngineReport();
        report.fileName       = fileName;
        report.totalLines     = code.split("\n").length;
        report.language       = code.contains("def ") ? "Python" : "Unknown";

        // Count total functions
        Matcher fm = Pattern.compile("^\\s*def\\s+\\w+", Pattern.MULTILINE).matcher(code);
        int total = 0;
        while (fm.find()) total++;
        report.totalFunctions = total;

        // Find stubs
        Pattern p = Pattern.compile(
            "^(\\s*)def\\s+(\\w+)\\s*\\([^)]*\\).*:\\s*\\n(?:.*\\n)*?\\1    (?:pass|\\.\\.\\.)",
            Pattern.MULTILINE
        );
        Matcher m = p.matcher(code);

        while (m.find()) {
            String name = m.group(2);
            String before = code.substring(0, m.start());
            int lineNo = before.split("\n", -1).length;

            FunctionAnalysis fa = new FunctionAnalysis();
            fa.name        = name;
            fa.line        = lineNo;
            fa.risk        = "confirmed";
            fa.fixability  = getFixability(name);
            fa.intent      = getIntent(name);
            fa.canAutoFix  = fa.fixability == Fixability.HIGH;

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
                    fa.warningNote = "ينصح بإعادة تسمية الدالة أولاً";
                    fa.signals.add("اسم غير وصفي");
                    break;
            }

            report.stubs.add(fa);
        }

        report.highFixable   = (int) report.stubs.stream().filter(s -> s.fixability == Fixability.HIGH).count();
        report.mediumFixable = (int) report.stubs.stream().filter(s -> s.fixability == Fixability.MEDIUM).count();
        report.lowFixable    = (int) report.stubs.stream().filter(s -> s.fixability == Fixability.LOW).count();

        // Bug Detection دائماً
        BugDetector.BugReport bugReport = BugDetector.detect(code);
        StringBuilder bugSummary = new StringBuilder();
        if (!bugReport.bugs.isEmpty()) {
            bugSummary.append("\n\n🐛 أخطاء مكتشفة (").append(bugReport.bugs.size()).append("):\n");
            for (BugDetector.Bug bug : bugReport.bugs) {
                String icon = bug.severity == BugDetector.Severity.CRITICAL ? "🔴"
                    : bug.severity == BugDetector.Severity.HIGH ? "🟠" : "🟡";
                bugSummary.append(icon).append(" ").append(bug.title)
                    .append(" — السطر ").append(bug.line).append("\n");
            }
        }

        // JSAnalyzer للملفات JS/HTML
        if (fileName.endsWith(".js") || fileName.endsWith(".html") || fileName.endsWith(".jsx")) {
            JSAnalyzer.AnalysisResult jsResult = JSAnalyzer.analyze(code);
            if (jsResult.hasIssues()) {
                StringBuilder jsMsg = new StringBuilder("\n\n🐛 أخطاء JavaScript (").append(jsResult.issues.size()).append("):\n");
                for (JSAnalyzer.Issue issue : jsResult.issues) {
                    String icon = issue.severity == JSAnalyzer.Severity.CRITICAL ? "🔴"
                        : issue.severity == JSAnalyzer.Severity.HIGH ? "🟠" : "🟡";
                    jsMsg.append(icon).append(" ").append(issue.title)
                        .append(" — السطر ").append(issue.line).append("\n");
                }
                report.engineMessage = (report.stubs.isEmpty() ? "ما وجد المحرك دوال ناقصة." : report.engineMessage) + jsMsg;
                report.recommendation = "يوجد أخطاء — استخدم AI للإصلاح.";
            }
        }

        if (report.stubs.isEmpty()) {
            report.engineMessage  = "ما وجد المحرك أي دوال ناقصة." + bugSummary;
            report.recommendation = bugReport.bugs.isEmpty() ? "الملف يبدو مكتملاً." : "يوجد أخطاء — استخدم AI للإصلاح.";
        } else {
            report.engineMessage  = "وجد المحرك " + report.stubs.size() + " دالة ناقصة:\n"
                + report.highFixable   + " واضحة ✓  •  "
                + report.mediumFixable + " راجع ⚠️  •  "
                + report.lowFixable    + " صعب ✗";
            report.recommendation = "راجع كل اقتراح قبل الموافقة.";
            report.engineMessage += bugSummary;
        }

        return report;
    }
}
