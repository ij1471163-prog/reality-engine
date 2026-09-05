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
        if (n.matches("^(is_|has_|can_|check_|verify_|validate_).*")) return "\u062a\u062d\u0642\u0642 \u0645\u0646 \u0635\u062d\u0629";
        if (n.contains("calculate") || n.contains("sum") || n.contains("total")) return "\u062d\u0633\u0627\u0628";
        if (n.contains("read")  || n.contains("load"))   return "\u0642\u0631\u0627\u0621\u0629 \u0645\u0644\u0641";
        if (n.contains("write") || n.contains("save"))   return "\u0643\u062a\u0627\u0628\u0629 \u0645\u0644\u0641";
        if (n.contains("send")  || n.contains("email"))  return "\u0625\u0631\u0633\u0627\u0644";
        if (n.contains("get")   || n.contains("fetch"))  return "\u062c\u0644\u0628 \u0628\u064a\u0627\u0646\u0627\u062a";
        if (n.contains("hash")  || n.contains("encrypt"))return "\u062a\u0634\u0641\u064a\u0631";
        if (n.contains("log")   || n.contains("debug"))  return "\u062a\u0633\u062c\u064a\u0644";
        if (n.contains("parse") || n.contains("format")) return "\u062a\u062d\u0648\u064a\u0644 \u0628\u064a\u0627\u0646\u0627\u062a";
        if (n.contains("delete")|| n.contains("remove")) return "\u062d\u0630\u0641";
        if (n.contains("create")|| n.contains("build"))  return "\u0625\u0646\u0634\u0627\u0621";
        return "\u063a\u064a\u0631 \u0645\u062d\u062f\u062f";
    }

    public static EngineReport analyze(String code, String fileName) {
        EngineReport report = new EngineReport();
        report.fileName   = fileName;
        report.totalLines = code.split("\n").length;
        report.language   = code.contains("def ") ? "Python" : "Unknown";

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
            String name   = m.group(2);
            String before = code.substring(0, m.start());
            int lineNo    = before.split("\n", -1).length;

            FunctionAnalysis fa = new FunctionAnalysis();
            fa.name       = name;
            fa.line       = lineNo;
            fa.risk       = "confirmed";
            fa.fixability = getFixability(name);
            fa.intent     = getIntent(name);
            fa.canAutoFix = fa.fixability == Fixability.HIGH;

            switch (fa.fixability) {
                case HIGH:
                    fa.fixReason   = "\u0627\u0644\u0627\u0633\u0645 \u0648\u0627\u0636\u062d \u2014 \u0627\u0644\u0645\u062d\u0631\u0643 \u0648\u0627\u062b\u0642 \u0641\u064a \u0627\u0644\u0625\u0635\u0644\u0627\u062d";
                    fa.warningNote = null;
                    fa.signals.add("\u0627\u0633\u0645 \u0627\u0644\u062f\u0627\u0644\u0629 \u064a\u0637\u0627\u0628\u0642 \u0646\u0645\u0637 \u0645\u0639\u0631\u0648\u0641");
                    break;
                case MEDIUM:
                    fa.fixReason   = "\u064a\u0645\u0643\u0646 \u062a\u0648\u0644\u064a\u062f \u0627\u0642\u062a\u0631\u0627\u062d \u2014 \u0631\u0627\u062c\u0639\u0647 \u0642\u0628\u0644 \u0627\u0644\u0645\u0648\u0627\u0641\u0642\u0629";
                    fa.warningNote = "\u0631\u0627\u062c\u0639 \u0627\u0644\u0627\u0642\u062a\u0631\u0627\u062d \u0628\u0639\u0646\u0627\u064a\u0629";
                    fa.signals.add("\u0627\u0633\u0645 \u0627\u0644\u062f\u0627\u0644\u0629 \u064a\u062d\u062a\u0627\u062c \u0633\u064a\u0627\u0642 \u0625\u0636\u0627\u0641\u064a");
                    break;
                case LOW:
                    fa.fixReason   = "\u0627\u0644\u0627\u0633\u0645 \u063a\u064a\u0631 \u0648\u0635\u0641\u064a \u2014 \u0627\u0644\u0627\u0642\u062a\u0631\u0627\u062d \u0633\u064a\u0643\u0648\u0646 \u0639\u0627\u0645\u0627\u064b";
                    fa.warningNote = "\u064a\u0646\u0635\u062d \u0628\u0625\u0639\u0627\u062f\u0629 \u062a\u0633\u0645\u064a\u0629 \u0627\u0644\u062f\u0627\u0644\u0629 \u0623\u0648\u0644\u0627\u064b";
                    fa.signals.add("\u0627\u0633\u0645 \u063a\u064a\u0631 \u0648\u0635\u0641\u064a");
                    break;
            }

            report.stubs.add(fa);
        }

        report.highFixable   = (int) report.stubs.stream().filter(s -> s.fixability == Fixability.HIGH).count();
        report.mediumFixable = (int) report.stubs.stream().filter(s -> s.fixability == Fixability.MEDIUM).count();
        report.lowFixable    = (int) report.stubs.stream().filter(s -> s.fixability == Fixability.LOW).count();

        // ✅ Security Scan — string literals صحيحة
        java.util.List<SecurityScanner.SecurityIssue> secIssues = SecurityScanner.scan(code, fileName);
        String secSummary = "";
        if (!secIssues.isEmpty()) {
            StringBuilder sb = new StringBuilder("\n\n\uD83D\uDD10 \u062a\u062d\u0630\u064a\u0631\u0627\u062a \u0623\u0645\u0646\u064a\u0629 (")
                .append(secIssues.size()).append("):\n");
            for (SecurityScanner.SecurityIssue si : secIssues) {
                sb.append(si.severity.equals("CRITICAL") ? "\uD83D\uDD34" : "\uD83D\uDFE0")
                  .append(" ").append(si.title)
                  .append(" \u2014 \u0627\u0644\u0633\u0637\u0631 ").append(si.line).append("\n");
            }
            secSummary = sb.toString();
        }

        // MultiLang Analysis (TS/Kotlin/PHP)
        java.util.List<MultiLangAnalyzer.Issue> mlIssues = MultiLangAnalyzer.analyze(code, fileName);
        if (!mlIssues.isEmpty()) {
            StringBuilder mlSummary = new StringBuilder("\n\n[MultiLang] ");
            mlSummary.append(mlIssues.size()).append(" مشاكل:\n");
            for (MultiLangAnalyzer.Issue mi : mlIssues) {
                mlSummary.append("[").append(mi.severity).append("] ")
                    .append(mi.title).append(" — السطر ").append(mi.line).append("\n");
            }
            if (report.engineMessage != null)
                report.engineMessage = report.engineMessage + mlSummary.toString();
        }

        // Java AST Analysis
        if (fileName.endsWith(".java")) {
            java.util.List<JavaASTEngine.ASTIssue> astIssues = JavaASTEngine.analyze(code);
            if (!astIssues.isEmpty()) {
                StringBuilder astSummary = new StringBuilder("\n\n[Java AST] ");
                astSummary.append(astIssues.size()).append(" مشاكل:\n");
                for (JavaASTEngine.ASTIssue ai : astIssues) {
                    astSummary.append("[").append(ai.severity).append("] ")
                        .append(ai.title).append(" — السطر ").append(ai.line).append("\n");
                }
                if (report.engineMessage != null)
                    report.engineMessage = report.engineMessage + astSummary.toString();
            }
        }

        // Indent Analysis (Python)
        if (fileName.endsWith(".py")) {
            java.util.List<IndentAnalyzer.IndentIssue> indentIssues = IndentAnalyzer.analyze(code, fileName);
            if (!indentIssues.isEmpty()) {
                StringBuilder indentSummary = new StringBuilder("\n\n[Indent] ");
                indentSummary.append(indentIssues.size()).append(" مشاكل:\n");
                for (IndentAnalyzer.IndentIssue ii : indentIssues) {
                    indentSummary.append("[").append(ii.severity).append("] ")
                        .append(ii.title).append(" — السطر ").append(ii.line).append("\n");
                }
                if (report.engineMessage != null)
                    report.engineMessage = report.engineMessage + indentSummary.toString();
            }
        }

        // Dart/Flutter Analysis
        if (fileName.endsWith(".dart")) {
            java.util.List<DartAnalyzer.DartIssue> dartIssues = DartAnalyzer.analyze(code, fileName);
            if (!dartIssues.isEmpty()) {
                StringBuilder dartSummary = new StringBuilder("\n\n[Dart] ");
                dartSummary.append(dartIssues.size()).append(" مشاكل:\n");
                for (DartAnalyzer.DartIssue di : dartIssues) {
                    dartSummary.append("[").append(di.severity).append("] ")
                        .append(di.title).append(" — السطر ").append(di.line).append("\n");
                }
                if (report.engineMessage != null)
                    report.engineMessage = report.engineMessage + dartSummary.toString();
            }
        }

        // ML Pattern Detection
        java.util.List<MLPatternFinder.MLIssue> mlPatterns = MLPatternFinder.analyze(code, fileName);
        if (!mlPatterns.isEmpty()) {
            StringBuilder mlSummary = new StringBuilder("\n\n[ML Patterns] ");
            mlSummary.append(mlPatterns.size()).append(" مشاكل:\n");
            for (MLPatternFinder.MLIssue ml : mlPatterns) {
                mlSummary.append("[").append(ml.severity).append("] ")
                    .append(ml.title).append(" — السطر ").append(ml.line).append("\n");
            }
            if (report.engineMessage != null)
                report.engineMessage = report.engineMessage + mlSummary.toString();
        }

        // Secret Detection
        java.util.List<SecretDetector.Secret> secrets = SecretDetector.scan(code, fileName);
        if (!secrets.isEmpty()) {
            StringBuilder secretSummary = new StringBuilder("\n\n[Secrets] ");
            secretSummary.append(secrets.size()).append(" مشاكل:\n");
            for (SecretDetector.Secret s : secrets) {
                secretSummary.append("[").append(s.severity).append("] ")
                    .append(s.title).append(" — السطر ").append(s.line).append("\n");
            }
            if (report.engineMessage != null)
                report.engineMessage = report.engineMessage + secretSummary.toString();
        }

        // ✅ Bug Detection
        BugDetector.BugReport bugReport = BugDetector.detect(code);
        StringBuilder bugSummary = new StringBuilder();
        if (!bugReport.bugs.isEmpty()) {
            bugSummary.append("\n\n\uD83D\uDC1B \u0623\u062e\u0637\u0627\u0621 \u0645\u0643\u062a\u0634\u0641\u0629 (")
                .append(bugReport.bugs.size()).append("):\n");
            for (BugDetector.Bug bug : bugReport.bugs) {
                String icon = bug.severity == BugDetector.Severity.CRITICAL ? "\uD83D\uDD34"
                    : bug.severity == BugDetector.Severity.HIGH ? "\uD83D\uDFE0" : "\uD83D\uDFE1";
                bugSummary.append(icon).append(" ").append(bug.title)
                    .append(" \u2014 \u0627\u0644\u0633\u0637\u0631 ").append(bug.line).append("\n");
            }
        }

        // ✅ JSAnalyzer
        if (fileName.endsWith(".js") || fileName.endsWith(".html") || fileName.endsWith(".jsx")) {
            JSAnalyzer.AnalysisResult jsResult = JSAnalyzer.analyze(code);
            if (jsResult.hasIssues()) {
                StringBuilder jsMsg = new StringBuilder("\n\n\uD83D\uDC1B \u0623\u062e\u0637\u0627\u0621 JavaScript (")
                    .append(jsResult.issues.size()).append("):\n");
                for (JSAnalyzer.Issue issue : jsResult.issues) {
                    String icon = issue.severity == JSAnalyzer.Severity.CRITICAL ? "\uD83D\uDD34"
                        : issue.severity == JSAnalyzer.Severity.HIGH ? "\uD83D\uDFE0" : "\uD83D\uDFE1";
                    jsMsg.append(icon).append(" ").append(issue.title)
                        .append(" \u2014 \u0627\u0644\u0633\u0637\u0631 ").append(issue.line).append("\n");
                }
                report.engineMessage  = (report.stubs.isEmpty()
                    ? "\u0645\u0627 \u0648\u062c\u062f \u0627\u0644\u0645\u062d\u0631\u0643 \u062f\u0648\u0627\u0644 \u0646\u0627\u0642\u0635\u0629."
                    : report.engineMessage) + jsMsg + secSummary + bugSummary;
                report.recommendation = "\u064a\u0648\u062c\u062f \u0623\u062e\u0637\u0627\u0621 \u2014 \u0627\u0633\u062a\u062e\u062f\u0645 AI \u0644\u0644\u0625\u0635\u0644\u0627\u062d.";
                return report;
            }
        }

        if (report.stubs.isEmpty()) {
            report.engineMessage  = "\u0645\u0627 \u0648\u062c\u062f \u0627\u0644\u0645\u062d\u0631\u0643 \u0623\u064a \u062f\u0648\u0627\u0644 \u0646\u0627\u0642\u0635\u0629." + secSummary + bugSummary;
            report.recommendation = bugReport.bugs.isEmpty()
                ? "\u0627\u0644\u0645\u0644\u0641 \u064a\u0628\u062f\u0648 \u0645\u0643\u062a\u0645\u0644\u0627\u064b."
                : "\u064a\u0648\u062c\u062f \u0623\u062e\u0637\u0627\u0621 \u2014 \u0627\u0633\u062a\u062e\u062f\u0645 AI \u0644\u0644\u0625\u0635\u0644\u0627\u062d.";
        } else {
            report.engineMessage = "\u0648\u062c\u062f \u0627\u0644\u0645\u062d\u0631\u0643 " + report.stubs.size() + " \u062f\u0627\u0644\u0629 \u0646\u0627\u0642\u0635\u0629:\n"
                + report.highFixable   + " \u0648\u0627\u0636\u062d\u0629 \u2713  \u2022  "
                + report.mediumFixable + " \u0631\u0627\u062c\u0639 \u26a0\ufe0f  \u2022  "
                + report.lowFixable    + " \u0635\u0639\u0628 \u2717"
                + secSummary + bugSummary;
            report.recommendation = "\u0631\u0627\u062c\u0639 \u0643\u0644 \u0627\u0642\u062a\u0631\u0627\u062d \u0642\u0628\u0644 \u0627\u0644\u0645\u0648\u0627\u0641\u0642\u0629.";
        }

        return report;
    }
}

