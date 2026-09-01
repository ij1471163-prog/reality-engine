package com.naif.realityengine;

import java.util.*;
import java.util.regex.*;

public class BugDetector {

    public enum Severity { CRITICAL, HIGH, MEDIUM, LOW }

    public enum BugType { ACCUMULATION, NONE_COMPARISON, MODIFY_ITERATION, BARE_EXCEPT, MUTABLE_DEFAULT }

    public static class Bug {
        public BugType type;
        public String title, description, fix;
        public int line;      // primary line the bug/report points to
        public int refLine;   // optional: related line needed for autoFix (e.g. the loop's "for" line)
        public String varName;// optional: captured variable/collection name, used by autoFix
        public Severity severity;

        public Bug(BugType type, String title, String description, String fix, int line, Severity severity) {
            this(type, title, description, fix, line, severity, -1, null);
        }

        public Bug(BugType type, String title, String description, String fix, int line, Severity severity,
                   int refLine, String varName) {
            this.type = type; this.title = title; this.description = description;
            this.fix = fix; this.line = line; this.severity = severity;
            this.refLine = refLine; this.varName = varName;
        }
    }

    public static class BugReport {
        public List<Bug> bugs = new ArrayList<>();
        public String language = "unknown";
        public int score = 100;
        public void addBug(Bug b) {
            bugs.add(b);
            int p = b.severity == Severity.CRITICAL ? 25 : b.severity == Severity.HIGH ? 15
                    : b.severity == Severity.MEDIUM ? 8 : 3;
            score = Math.max(0, score - p);
        }
        public boolean hasBugs() { return !bugs.isEmpty(); }
    }

    public static BugReport detect(String code) {
        BugReport report = new BugReport();
        if (code == null || code.isEmpty()) return report;
        report.language = detectLanguage(code);
        String[] lines = code.split("\n", -1);

        // These detectors rely on Python semantics (indentation-based blocks, `is None`,
        // `except:`, self.attr). Running them on Java/JS produces false positives, so gate them.
        if (report.language.equals("python")) {
            detectAccumulation(lines, report);
            detectNoneComparison(lines, report);
        }
        if (report.language.equals("javascript") || report.language.equals("java")) {
            detectJSAccumulation(lines, report);
            detectJSEquality(lines, report);
            detectEmptyCatch(lines, report);
            detectModifyIteration(lines, report);
            detectBareExcept(lines, report);
            detectMutableDefault(lines, report);
        }
        return report;
    }

    public static String autoFix(String code, BugReport report) {
        if (code == null || report == null) return null;
        String[] lines = code.split("\n", -1);
        String[] fixed = Arrays.copyOf(lines, lines.length);
        boolean changed = false;

        for (Bug bug : report.bugs) {
            switch (bug.type) {
                case ACCUMULATION: {
                    int idx = bug.line - 1;
                    if (idx < 0 || idx >= fixed.length || bug.varName == null) break;
                    Matcher mm = Pattern.compile(
                            "^(\\s*)" + Pattern.quote(bug.varName) + "\\s*=\\s*(?!=)(.+)$").matcher(fixed[idx]);
                    if (mm.find()) {
                        fixed[idx] = mm.group(1) + bug.varName + " += " + mm.group(2);
                        changed = true;
                    }
                    break;
                }
                case NONE_COMPARISON: {
                    int idx = bug.line - 1;
                    if (idx < 0 || idx >= fixed.length) break;
                    String n = fixed[idx]
                            .replaceAll("==\\s*None", "is None")
                            .replaceAll("!=\\s*None", "is not None")
                            .replaceAll("None\\s*==", "None is")
                            .replaceAll("None\\s*!=", "None is not");
                    if (!n.equals(fixed[idx])) { fixed[idx] = n; changed = true; }
                    break;
                }
                case MODIFY_ITERATION: {
                    int idx = bug.refLine > 0 ? bug.refLine - 1 : -1;
                    if (idx < 0 || idx >= fixed.length || bug.varName == null) break;
                    Matcher mm = Pattern.compile("in\\s+" + Pattern.quote(bug.varName) + "\\b").matcher(fixed[idx]);
                    if (mm.find()) {
                        fixed[idx] = mm.replaceFirst("in " + Matcher.quoteReplacement(bug.varName) + ".copy()");
                        changed = true;
                    }
                    break;
                }
                case BARE_EXCEPT: {
                    int idx = bug.line - 1;
                    if (idx < 0 || idx >= fixed.length) break;
                    String n = fixed[idx].replaceFirst("except\\s*:", "except Exception as e:");
                    if (!n.equals(fixed[idx])) { fixed[idx] = n; changed = true; }
                    break;
                }
                case MUTABLE_DEFAULT:
                default:
                    // Fixing this properly means changing the signature AND inserting an
                    // init line inside the function body. Too risky to auto-apply — report only.
                    break;
            }
        }
        return changed ? String.join("\n", fixed) : null;
    }

    private static String detectLanguage(String code) {
        if (Pattern.compile("\\bpublic\\s+class\\b").matcher(code).find() || code.contains("System.out")) return "java";
        if (Pattern.compile("\\bdef\\s+\\w+\\s*\\(").matcher(code).find()
                || Pattern.compile("(?m)^\\s*import\\s+\\w+").matcher(code).find()) return "python";
        if (Pattern.compile("\\bfunction\\s+\\w+\\s*\\(").matcher(code).find()
                || code.contains("=>")
                || Pattern.compile("\\bconst\\s+\\w+\\s*=").matcher(code).find()) return "javascript";
        return "unknown";
    }

    private static int indentOf(String line) {
        int i = 0;
        while (i < line.length() && (line.charAt(i) == ' ' || line.charAt(i) == '\t')) i++;
        return i;
    }

    // Tracks accumulation bugs (x = ... instead of x += ...) using real indentation-based
    // loop scope instead of resetting on the first blank line (which broke on loops that
    // contain blank lines, and never popped scope on dedent without a blank line/return).
    private static void detectAccumulation(String[] lines, BugReport report) {
        Deque<Integer> loopIndents = new ArrayDeque<>();
        Pattern forPat = Pattern.compile("^\\s*for\\s+\\w+\\s+in\\s+.+:\\s*(#.*)?$");
        Pattern assignPat = Pattern.compile("^\\s*(total|sum|count|revenue|result)\\s*=\\s*(?!=)(.+)$");

        for (int i = 0; i < lines.length; i++) {
            String line = lines[i];
            String trimmed = line.trim();
            if (trimmed.isEmpty() || trimmed.startsWith("#")) continue;
            int indent = indentOf(line);

            while (!loopIndents.isEmpty() && indent <= loopIndents.peek()) loopIndents.pop();

            if (forPat.matcher(line).find()) {
                loopIndents.push(indent);
                continue;
            }
            if (!loopIndents.isEmpty()) {
                Matcher m = assignPat.matcher(line);
                if (m.find()) {
                    String varName = m.group(1);
                    report.addBug(new Bug(BugType.ACCUMULATION,
                            "خطأ في التراكم: = بدل +=",
                            "المتغير \"" + varName + "\" يُعاد تعيينه بدل أن يتراكم داخل الحلقة",
                            varName + " += " + m.group(2).trim(),
                            i + 1, Severity.CRITICAL, -1, varName));
                }
            }
        }
    }

    private static void detectNoneComparison(String[] lines, BugReport report) {
        Pattern p = Pattern.compile("(==|!=)\\s*None|None\\s*(==|!=)");
        for (int i = 0; i < lines.length; i++) {
            if (!lines[i].trim().startsWith("#") && p.matcher(lines[i]).find()) {
                String fix = lines[i].trim()
                        .replaceAll("==\\s*None", "is None")
                        .replaceAll("!=\\s*None", "is not None")
                        .replaceAll("None\\s*==", "None is")
                        .replaceAll("None\\s*!=", "None is not");
                report.addBug(new Bug(BugType.NONE_COMPARISON,
                        "مقارنة None بـ == بدل is",
                        "استخدم is / is not مع None بدل == / !=",
                        fix, i + 1, Severity.MEDIUM));
            }
        }
    }

    private static class LoopFrame {
        int indent, line;
        String coll; // full collection expression, e.g. "self.items" or "items"
        LoopFrame(int indent, int line, String coll) { this.indent = indent; this.line = line; this.coll = coll; }
    }

    // Extended beyond .remove()/.append() to catch .pop(), .insert(), .clear(), .extend(),
    // and `del coll[...]`, and now scoped by real indentation (nested loops handled correctly)
    // instead of an arbitrary "next 8 lines" window.
    private static void detectModifyIteration(String[] lines, BugReport report) {
        Deque<LoopFrame> stack = new ArrayDeque<>();
        Pattern forPat = Pattern.compile("^\\s*for\\s+\\w+\\s+in\\s+((?:self\\.)?\\w+)\\s*:");
        Set<String> reported = new HashSet<>();

        for (int i = 0; i < lines.length; i++) {
            String line = lines[i];
            String trimmed = line.trim();
            if (trimmed.isEmpty() || trimmed.startsWith("#")) continue;
            int indent = indentOf(line);

            while (!stack.isEmpty() && indent <= stack.peek().indent) stack.pop();

            Matcher fm = forPat.matcher(line);
            if (fm.find()) {
                stack.push(new LoopFrame(indent, i + 1, fm.group(1)));
                continue;
            }

            for (LoopFrame lf : stack) {
                String key = lf.line + ":" + lf.coll;
                if (reported.contains(key)) continue;
                boolean mutated = line.contains(lf.coll + ".remove(")
                        || line.contains(lf.coll + ".append(")
                        || line.contains(lf.coll + ".pop(")
                        || line.contains(lf.coll + ".insert(")
                        || line.contains(lf.coll + ".clear(")
                        || line.contains(lf.coll + ".extend(")
                        || trimmed.startsWith("del " + lf.coll + "[")
                        || trimmed.equals("del " + lf.coll);
                if (mutated) {
                    report.addBug(new Bug(BugType.MODIFY_ITERATION,
                            "تعديل قائمة أثناء iteration",
                            "تُعدَّل \"" + lf.coll + "\" داخل حلقة for تدور عليها — قد يتخطى عناصر أو يسبب سلوك غير متوقع",
                            "for item in " + lf.coll + ".copy():",
                            lf.line, Severity.HIGH, lf.line, lf.coll));
                    reported.add(key);
                }
            }
        }
    }

    private static void detectBareExcept(String[] lines, BugReport report) {
        Pattern p = Pattern.compile("^\\s*except\\s*:\\s*(#.*)?$");
        for (int i = 0; i < lines.length; i++) {
            if (p.matcher(lines[i]).find()) {
                report.addBug(new Bug(BugType.BARE_EXCEPT,
                        "Bare except بدون نوع",
                        "يمسك كل الأخطاء، حتى KeyboardInterrupt وSystemExit",
                        "except Exception as e:", i + 1, Severity.MEDIUM));
            }
        }
    }

    // Now joins multi-line function signatures instead of only checking a single line
    // (the old regex silently missed any def spanning more than one line), and matches
    // multiple mutable defaults on the same signature.
    private static void detectMutableDefault(String[] lines, BugReport report) {
        Pattern defStart = Pattern.compile("^\\s*def\\s+\\w+\\s*\\(");
        Pattern defaultPat = Pattern.compile("(\\w+)\\s*=\\s*(\\[[^\\]]*\\]|\\{[^}]*\\})");

        for (int i = 0; i < lines.length; i++) {
            if (!defStart.matcher(lines[i]).find()) continue;

            StringBuilder sig = new StringBuilder();
            int depth = 0;
            boolean sawOpen = false, closed = false;
            int end = Math.min(lines.length, i + 20);
            for (int j = i; j < end; j++) {
                sig.append(lines[j]).append(' ');
                for (char c : lines[j].toCharArray()) {
                    if (c == '(') { depth++; sawOpen = true; }
                    else if (c == ')') { depth--; if (sawOpen && depth == 0) closed = true; }
                }
                if (closed) break;
            }
            if (!closed) continue;

            Matcher m = defaultPat.matcher(sig.toString());
            while (m.find()) {
                String param = m.group(1);
                String emptyLiteral = m.group(2).startsWith("[") ? "[]" : "{}";
                report.addBug(new Bug(BugType.MUTABLE_DEFAULT,
                        "Mutable Default Argument",
                        "المعامل \"" + param + "\" له قيمة افتراضية list/dict — تُشارَك بين كل الاستدعاءات",
                        "if " + param + " is None: " + param + " = " + emptyLiteral,
                        i + 1, Severity.HIGH));
            }
        }
    }
    private static void detectJSAccumulation(String[] lines, BugReport report) {
        java.util.Set<String> zeroVars = new java.util.HashSet<>();
        boolean inLoop = false;
        for (int i = 0; i < lines.length; i++) {
            String t = lines[i].trim();
            if (t.startsWith("//")) continue;
            // اكتشف متغيرات = 0
            java.util.regex.Matcher dm = java.util.regex.Pattern
                .compile("(?:let|var|const|int|double|float)\s+(\w+)\s*=\s*0")
                .matcher(t);
            if (dm.find()) zeroVars.add(dm.group(1));
            // دخول حلقة
            if (t.contains(".forEach(") || t.matches("for\s*\(.*") || t.matches("for\s+\w+.*:.*")) inLoop = true;
            if (inLoop && (t.equals("}") || t.equals("});") || t.equals("})"))) inLoop = false;
            // كشف = بدل +=
            if (inLoop) {
                for (String v : zeroVars) {
                    java.util.regex.Pattern p = java.util.regex.Pattern.compile("\b" + v + "\s*=(?!=|\+|-)\s*\S");
                    if (p.matcher(t).find() && !t.matches(".*(?:let|var|const|int|double|float).*")) {
                        String fix = t.replaceFirst("(" + v + ")\s*=(?!=)", "$1 +=");
                        report.addBug(new Bug(BugType.ACCUMULATION,
                            "خطأ تراكم: " + v + " = بدل +=",
                            "المتغير " + v + " يُستبدل بدل يُجمع",
                            fix, i + 1, Severity.CRITICAL));
                    }
                }
            }
        }
    }

    private static void detectJSEquality(String[] lines, BugReport report) {
        java.util.regex.Pattern p = java.util.regex.Pattern.compile("(?:get[A-Z]\w*\(\)|\w+)\s*==(?!=)\s*(?:get[A-Z]\w*\(\)|\w+|"[^"]*")");
        for (int i = 0; i < lines.length; i++) {
            String t = lines[i].trim();
            if (t.startsWith("//") || t.startsWith("*")) continue;
            if (p.matcher(t).find() && !t.contains("===") && !t.contains("null")) {
                String fix = t.replaceAll("(\w+(?:\.\w+)?(?:\(\))?\s*)==(?!=)", "$1===");
                report.addBug(new Bug(BugType.NONE_COMPARISON,
                    "مقارنة غير دقيقة: == بدل ===",
                    "استخدم === للمقارنة الدقيقة",
                    fix, i + 1, Severity.MEDIUM));
            }
        }
    }

    private static void detectEmptyCatch(String[] lines, BugReport report) {
        for (int i = 0; i < lines.length; i++) {
            String t = lines[i].trim();
            if ((t.equals("catch(e){}") || t.equals("} catch (Exception e) {")) ) {
                String next = i + 1 < lines.length ? lines[i + 1].trim() : "";
                if (next.equals("}") || next.isEmpty()) {
                    report.addBug(new Bug(BugType.BARE_EXCEPT,
                        "catch فارغ يخفي الأخطاء",
                        "أضف معالجة للخطأ",
                        t.replace("{}", "{ Log.e(TAG, e.getMessage()); }"),
                        i + 1, Severity.HIGH));
                }
            }
        }
    }

}