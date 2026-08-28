package com.naif.realityengine;

import java.util.*;
import java.util.regex.*;

public class BugDetector {

    public enum Severity { CRITICAL, HIGH, MEDIUM, LOW }

    public static class Bug {
        public String title, description, fix;
        public int line;
        public Severity severity;

        public Bug(String title, String description, String fix, int line, Severity severity) {
            this.title = title;
            this.description = description;
            this.fix = fix;
            this.line = line;
            this.severity = severity;
        }
    }

    public static class BugReport {
        public List<Bug> bugs = new ArrayList<>();
        public String language = "unknown";
        public int score = 100;

        public void addBug(Bug b) {
            bugs.add(b);
            int penalty = b.severity == Severity.CRITICAL ? 25
                : b.severity == Severity.HIGH ? 15
                : b.severity == Severity.MEDIUM ? 8 : 3;
            score = Math.max(0, score - penalty);
        }
    }

    public static BugReport detect(String code) {
        BugReport report = new BugReport();
        if (code == null || code.isEmpty()) return report;
        report.language = detectLanguage(code);
        String[] lines = code.split("\n");
        detectAccumulation(lines, report);
        detectNoneComparison(lines, report);
        detectModifyIteration(code, lines, report);
        if ("javascript".equals(report.language)) {
            detectForEachReturn(lines, report);
            detectLooseEquality(lines, report);
        }
        return report;
    }

    public static String autoFix(String code, BugReport report) {
        if (code == null || report == null) return null;
        String[] lines = code.split("\n");
        String[] fixed = Arrays.copyOf(lines, lines.length);
        boolean changed = false;
        for (Bug bug : report.bugs) {
            int idx = bug.line - 1;
            if (idx < 0 || idx >= fixed.length) continue;
            if (bug.title.contains("\u0627\u0644\u062a\u0631\u0627\u0643\u0645")) {
                String n = fixed[idx].replaceFirst("^(\\s*)(total|sum|count|revenue|result)\\s*=\\s*(.+)", "$1$2 += $3");
                if (!n.equals(fixed[idx])) { fixed[idx] = n; changed = true; }
            } else if (bug.title.contains("None")) {
                fixed[idx] = fixed[idx].replace("== None", "is None").replace("!= None", "is not None");
                changed = true;
            } else if (bug.title.contains("forEach")) {
                for (int i = Math.max(0, idx - 5); i < idx; i++) {
                    if (fixed[i].contains(".forEach(")) {
                        fixed[i] = fixed[i].replace(".forEach(", ".find(");
                        changed = true; break;
                    }
                }
            }
        }
        return changed ? String.join("\n", fixed) : null;
    }

    private static String detectLanguage(String code) {
        if (code.contains("function ") || code.contains("const ") || code.contains("=>")) return "javascript";
        if (code.contains("def ") || code.contains("pass")) return "python";
        if (code.contains("public class") || code.contains("System.out")) return "java";
        return "unknown";
    }

    private static void detectAccumulation(String[] lines, BugReport report) {
        boolean inLoop = false;
        for (int i = 0; i < lines.length; i++) {
            String t = lines[i].trim();
            if (t.startsWith("for ") || t.startsWith("for(") || t.contains(".forEach(")) inLoop = true;
            if (inLoop && Pattern.compile("^\\s*(total|sum|count|revenue|result)\\s*=\\s*[^=+\\-\\n]").matcher(lines[i]).find()) {
                report.addBug(new Bug("\u062e\u0637\u0623 \u0641\u064a \u0627\u0644\u062a\u0631\u0627\u0643\u0645: = \u0628\u062f\u0644 +=",
                    "\u0627\u0644\u0645\u062a\u063a\u064a\u0631 \u064a\u064f\u0639\u064a\u064e\u0651\u0646 \u0628\u062f\u0644 \u0623\u0646 \u064a\u062a\u0631\u0627\u0643\u0645",
                    lines[i].trim(), i + 1, Severity.CRITICAL));
            }
            if (t.isEmpty() || t.equals("}")) inLoop = false;
        }
    }

    private static void detectNoneComparison(String[] lines, BugReport report) {
        Pattern p = Pattern.compile("(==|!=)\\s*None");
        for (int i = 0; i < lines.length; i++) {
            if (!lines[i].trim().startsWith("#") && p.matcher(lines[i]).find()) {
                report.addBug(new Bug("\u0645\u0642\u0627\u0631\u0646\u0629 None \u0628\u0640 ==",
                    "\u0627\u0633\u062a\u062e\u062f\u0645 is None",
                    lines[i].trim().replace("== None", "is None"),
                    i + 1, Severity.MEDIUM));
            }
        }
    }

    private static void detectModifyIteration(String code, String[] lines, BugReport report) {
        for (int i = 0; i < lines.length; i++) {
            Matcher m = Pattern.compile("for\\s+\\w+\\s+in\\s+(\\w+)").matcher(lines[i]);
            if (m.find()) {
                String coll = m.group(1);
                for (int j = i + 1; j < Math.min(i + 8, lines.length); j++) {
                    if (lines[j].contains(coll + ".remove(")) {
                        report.addBug(new Bug("\u062a\u0639\u062f\u064a\u0644 \u0642\u0627\u0626\u0645\u0629 \u0623\u062b\u0646\u0627\u0621 iteration",
                            "\u0627\u0633\u062a\u062e\u062f\u0645 .copy()",
                            "for item in " + coll + ".copy():",
                            i + 1, Severity.HIGH));
                        break;
                    }
                }
            }
        }
    }

    private static void detectForEachReturn(String[] lines, BugReport report) {
        for (int i = 0; i < lines.length; i++) {
            if (lines[i].contains(".forEach(")) {
                for (int j = i + 1; j < Math.min(i + 6, lines.length); j++) {
                    if (lines[j].trim().startsWith("return ")) {
                        report.addBug(new Bug("return \u062f\u0627\u062e\u0644 forEach \u0644\u0627 \u064a\u0639\u0645\u0644",
                            "\u0627\u0633\u062a\u062e\u062f\u0645 .find()",
                            lines[i].trim().replace(".forEach(", ".find("),
                            j + 1, Severity.HIGH));
                        break;
                    }
                }
            }
        }
    }

    private static void detectLooseEquality(String[] lines, BugReport report) {
        Pattern p = Pattern.compile("[^=!<>]==[^=]");
        for (int i = 0; i < lines.length; i++) {
            String t = lines[i].trim();
            if (!t.startsWith("//") && p.matcher(lines[i]).find() && t.contains("if ")) {
                report.addBug(new Bug("\u0645\u0642\u0627\u0631\u0646\u0629 == \u0628\u062f\u0644 ===",
                    "\u0627\u0633\u062a\u062e\u062f\u0645 ===",
                    t.replaceAll("([^=!<>])==([^=])", "$1===$2"),
                    i + 1, Severity.MEDIUM));
            }
        }
    }
