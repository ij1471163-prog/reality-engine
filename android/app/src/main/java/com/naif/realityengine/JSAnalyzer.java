package com.naif.realityengine;

import java.util.*;
import java.util.regex.*;

public class JSAnalyzer {

    public enum IssueType { STUB, BUG }
    public enum Severity { CRITICAL, HIGH, MEDIUM, LOW }

    public static class Issue {
        public String title;
        public String evidence;
        public String fix;
        public int line;
        public IssueType type;
        public Severity severity;

        public Issue(String title, String evidence, String fix, int line, IssueType type, Severity severity) {
            this.title = title;
            this.evidence = evidence;
            this.fix = fix;
            this.line = line;
            this.type = type;
            this.severity = severity;
        }
    }

    public static class AnalysisResult {
        public List<Issue> issues = new ArrayList<>();
        public String fixedCode = null;

        public void add(Issue i) { issues.add(i); }
        public boolean hasIssues() { return !issues.isEmpty(); }
    }

    public static AnalysisResult analyze(String code) {
        AnalysisResult result = new AnalysisResult();
        if (code == null || code.isEmpty()) return result;

        String[] lines = code.split("\n");

        detectForEachReturn(lines, result);
        detectAccumulation(lines, result);
        detectLooseEquality(lines, result);
        detectNullUsage(lines, result);

        if (result.hasIssues()) {
            result.fixedCode = autoFix(code, result);
        }

        return result;
    }

    private static void detectForEachReturn(String[] lines, AnalysisResult result) {
        for (int i = 0; i < lines.length; i++) {
            if (lines[i].contains(".forEach(")) {
                for (int j = i + 1; j < Math.min(i + 6, lines.length); j++) {
                    String t = lines[j].trim();
                    if (t.startsWith("return ") && !t.startsWith("//")) {
                        result.add(new Issue(
                            "return داخل forEach لا يعمل",
                            lines[j].trim(),
                            lines[i].trim().replace(".forEach(", ".find("),
                            j + 1, IssueType.BUG, Severity.HIGH
                        ));
                        break;
                    }
                }
            }
        }
    }

    private static void detectAccumulation(String[] lines, AnalysisResult result) {
        boolean inLoop = false;
        for (int i = 0; i < lines.length; i++) {
            String t = lines[i].trim();
            if (t.contains(".forEach(") || t.startsWith("for (") || t.startsWith("for(")) {
                inLoop = true;
            }
            if (inLoop) {
                Pattern p = Pattern.compile("^\\s*(total|sum|count|result)\\s*=\\s*[^=+\\-]");
                if (p.matcher(lines[i]).find()) {
                    result.add(new Issue(
                        "خطأ في التراكم: = بدل +=",
                        lines[i].trim(),
                        lines[i].trim().replaceFirst("=\\s*", "+= "),
                        i + 1, IssueType.BUG, Severity.CRITICAL
                    ));
                }
            }
            if (t.isEmpty() || t.equals("});") || t.equals("}")) inLoop = false;
        }
    }

    private static void detectLooseEquality(String[] lines, AnalysisResult result) {
        Pattern p = Pattern.compile("[^=!<>]==[^=]");
        for (int i = 0; i < lines.length; i++) {
            String t = lines[i].trim();
            if (t.startsWith("//")) continue;
            if (p.matcher(lines[i]).find() && (t.contains("if ") || t.contains("while "))) {
                result.add(new Issue(
                    "مقارنة == بدل ===",
                    t,
                    t.replaceAll("([^=!<>])==([^=])", "$1===$2"),
                    i + 1, IssueType.BUG, Severity.MEDIUM
                ));
            }
        }
    }

    private static void detectNullUsage(String[] lines, AnalysisResult result) {
        for (int i = 0; i < lines.length; i++) {
            Matcher m = Pattern.compile("const\\s+(\\w+)\\s*=\\s*(?:find\\w*|get\\w*)\\(").matcher(lines[i]);
            if (m.find()) {
                String varName = m.group(1);
                if (i + 1 < lines.length) {
                    String next = lines[i + 1].trim();
                    if (next.contains(varName + ".") && !next.startsWith("if")) {
                        result.add(new Issue(
                            varName + " قد يكون null",
                            next,
                            "if (" + varName + ") { " + next + " }",
                            i + 2, IssueType.BUG, Severity.HIGH
                        ));
                    }
                }
            }
        }
    }

    public static String autoFix(String code, AnalysisResult result) {
        String[] lines = code.split("\n");
        String[] fixed = Arrays.copyOf(lines, lines.length);
        boolean changed = false;

        for (Issue issue : result.issues) {
            int idx = issue.line - 1;
            if (idx < 0 || idx >= fixed.length) continue;

            if (issue.title.contains("forEach")) {
                for (int i = Math.max(0, idx - 5); i < idx; i++) {
                    if (fixed[i].contains(".forEach(")) {
                        fixed[i] = fixed[i].replace(".forEach(", ".find(");
                        changed = true;
                        break;
                    }
                }
            } else if (issue.title.contains("التراكم")) {
                String newLine = fixed[idx].replaceFirst(
                    "^(\\s*)(total|sum|count|result)\\s*=\\s*(.+)",
                    "$1$2 += $3"
                );
                if (!newLine.equals(fixed[idx])) {
                    fixed[idx] = newLine;
                    changed = true;
                }
            } else if (issue.title.contains("==")) {
                fixed[idx] = fixed[idx].replaceAll("([^=!<>])==([^=])", "$1===$2");
                changed = true;
            }
        }

        return changed ? String.join("\n", fixed) : null;
    }
}
