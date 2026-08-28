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
            this.title = title; this.description = description;
            this.fix = fix; this.line = line; this.severity = severity;
        }
    }

    public static class BugReport {
        public List<Bug> bugs = new ArrayList<>();
        public String language = "unknown";
        public int score = 100;
        public void addBug(Bug b) {
            bugs.add(b);
            int p = b.severity==Severity.CRITICAL?25:b.severity==Severity.HIGH?15:b.severity==Severity.MEDIUM?8:3;
            score = Math.max(0, score - p);
        }
        public boolean hasBugs() { return !bugs.isEmpty(); }
    }

    public static BugReport detect(String code) {
        BugReport report = new BugReport();
        if (code == null || code.isEmpty()) return report;
        report.language = detectLanguage(code);
        String[] lines = code.split("\n");
        detectAccumulation(lines, report);
        detectNoneComparison(lines, report);
        detectModifyIteration(lines, report);
        detectBareExcept(lines, report);
        detectMutableDefault(lines, report);
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
            if (bug.title.contains("+=")) {
                String n = fixed[idx].replaceFirst("^(\\s*)(total|sum|count|revenue|result)\\s*=\\s*(.+)", "$1$2 += $3");
                if (!n.equals(fixed[idx])) { fixed[idx] = n; changed = true; }
            } else if (bug.title.contains("None")) {
                fixed[idx] = fixed[idx].replace("== None","is None").replace("!= None","is not None");
                changed = true;
            } else if (bug.title.contains("copy")) {
                for (int i=Math.max(0,idx-3);i<=idx;i++) {
                    if (fixed[i].contains("for ") && fixed[i].contains(" in self.")) {
                        fixed[i] = fixed[i].replaceFirst("in self\\.(\\w+)", "in self.$1.copy()");
                        changed = true; break;
                    }
                }
            }
        }
        return changed ? String.join("\n", fixed) : null;
    }

    private static String detectLanguage(String code) {
        if (code.contains("def ") || code.contains("import ") || code.contains("pass")) return "python";
        if (code.contains("function ") || code.contains("const ") || code.contains("=>")) return "javascript";
        if (code.contains("public class") || code.contains("System.out")) return "java";
        return "unknown";
    }

    private static void detectAccumulation(String[] lines, BugReport report) {
        boolean inLoop = false;
        for (int i = 0; i < lines.length; i++) {
            String t = lines[i].trim();
            if (t.startsWith("for ") && t.contains(" in ")) inLoop = true;
            if (inLoop && Pattern.compile("^\\s*(total|sum|count|revenue|result)\\s*=\\s*[^=+\\-]").matcher(lines[i]).find()) {
                report.addBug(new Bug(
                    "خطأ في التراكم: = بدل +=",
                    "المتغير يُعيَّن بدل أن يتراكم داخل الحلقة",
                    lines[i].trim(), i+1, Severity.CRITICAL));
            }
            if (t.isEmpty() || t.startsWith("return") || (t.startsWith("def ") && i > 0)) inLoop = false;
        }
    }

    private static void detectNoneComparison(String[] lines, BugReport report) {
        Pattern p = Pattern.compile("(==|!=)\\s*None|None\\s*(==|!=)");
        for (int i = 0; i < lines.length; i++) {
            if (!lines[i].trim().startsWith("#") && p.matcher(lines[i]).find()) {
                report.addBug(new Bug(
                    "مقارنة None بـ == بدل is",
                    "استخدم is None",
                    lines[i].trim().replace("== None","is None").replace("!= None","is not None"),
                    i+1, Severity.MEDIUM));
            }
        }
    }

    private static void detectModifyIteration(String[] lines, BugReport report) {
        for (int i = 0; i < lines.length; i++) {
            Matcher m = Pattern.compile("for\\s+\\w+\\s+in\\s+(?:self\\.)?(\\w+)").matcher(lines[i]);
            if (m.find()) {
                String coll = m.group(1);
                for (int j=i+1; j<Math.min(i+8,lines.length); j++) {
                    if (lines[j].contains(coll+".remove(") || lines[j].contains(coll+".append(")) {
                        report.addBug(new Bug(
                            "تعديل قائمة أثناء iteration",
                            "استخدم .copy()",
                            "for item in "+coll+".copy():",
                            i+1, Severity.HIGH));
                        break;
                    }
                }
            }
        }
    }

    private static void detectBareExcept(String[] lines, BugReport report) {
        for (int i = 0; i < lines.length; i++) {
            if (lines[i].trim().equals("except:")) {
                report.addBug(new Bug(
                    "Bare except بدون نوع",
                    "يمسك كل الأخطاء",
                    "except Exception as e:",
                    i+1, Severity.MEDIUM));
            }
        }
    }

    private static void detectMutableDefault(String[] lines, BugReport report) {
        Pattern p = Pattern.compile("def\\s+\\w+\\s*\\([^)]*=\\s*[\\[\\{]");
        for (int i = 0; i < lines.length; i++) {
            if (p.matcher(lines[i]).find()) {
                report.addBug(new Bug(
                    "Mutable Default Argument",
                    "list/dict كقيمة افتراضية خطأ",
                    "استخدم None كافتراضي",
                    i+1, Severity.HIGH));
            }
        }
    }
}
