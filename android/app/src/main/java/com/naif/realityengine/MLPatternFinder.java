package com.naif.realityengine;

import java.util.*;
import java.util.regex.*;

/**
 * MLPatternFinder — يكتشف patterns معقدة
 * Race Condition, Memory Leak, Magic Numbers, God Functions, Dead Code
 */
public class MLPatternFinder {

    public static class MLIssue {
        public String title, fix, severity;
        public int    line;
        public MLIssue(String title, String fix, int line, String sev) {
            this.title = title; this.fix = fix;
            this.line  = line;  this.severity = sev;
        }
    }

    public static List<MLIssue> analyze(String code, String fileName) {
        List<MLIssue> issues = new ArrayList<>();
        String[] lines = code.split("\n");
        String ext = fileName.contains(".") ?
            fileName.substring(fileName.lastIndexOf('.') + 1).toLowerCase() : "";

        detectMagicNumbers(lines, issues, ext);
        detectGodFunctions(lines, issues);
        detectDeadCode(lines, issues);
        detectMemoryLeaks(lines, issues, ext);
        detectCallbackHell(lines, issues, ext);

        return issues;
    }

    // ─── Magic Numbers ────────────────────────────────────

    private static void detectMagicNumbers(String[] lines, List<MLIssue> issues, String ext) {
        if (!ext.equals("py") && !ext.equals("js") && !ext.equals("java") &&
            !ext.equals("ts") && !ext.equals("kt")) return;

        Pattern p = Pattern.compile("(?<![\\w.'\"])\\b([2-9]\\d{1,4}|1[1-9]\\d{0,3})\\b(?![\\w'\"])");
        Set<String> allowed = new HashSet<>(Arrays.asList(
            "100", "1000", "200", "404", "500", "24", "60", "1024", "256", "128"
        ));

        for (int i = 0; i < lines.length; i++) {
            String t = lines[i].trim();
            if (t.startsWith("//") || t.startsWith("#") || t.startsWith("*")) continue;
            if (t.contains("=") && (t.contains("MAX") || t.contains("MIN") ||
                t.contains("SIZE") || t.contains("LIMIT"))) continue;

            Matcher m = p.matcher(t);
            while (m.find()) {
                String num = m.group(1);
                if (!allowed.contains(num)) {
                    issues.add(new MLIssue(
                        "🔵 Magic Number: " + num + " — استخدم ثابت مسمى",
                        "const MAX_VALUE = " + num + "; // ثم استخدم MAX_VALUE",
                        i + 1, "LOW"
                    ));
                    break;
                }
            }
        }
    }

    // ─── God Functions ────────────────────────────────────

    private static void detectGodFunctions(String[] lines, List<MLIssue> issues) {
        int funcStart  = -1;
        int funcLines  = 0;
        String funcName = "";

        for (int i = 0; i < lines.length; i++) {
            String t = lines[i].trim();

            // اكتشف بداية دالة
            Pattern funcPat = Pattern.compile(
                "(?:function\\s+(\\w+)|def\\s+(\\w+)|public\\s+\\w+\\s+(\\w+)\\s*\\()"
            );
            Matcher m = funcPat.matcher(t);
            if (m.find()) {
                if (funcStart >= 0 && funcLines > 50) {
                    issues.add(new MLIssue(
                        "🟡 God Function: " + funcName + "() — " + funcLines + " سطر",
                        "// قسّم الدالة لدوال أصغر",
                        funcStart + 1, "MEDIUM"
                    ));
                }
                funcStart = i;
                funcLines = 0;
                funcName = m.group(1) != null ? m.group(1) :
                           m.group(2) != null ? m.group(2) : m.group(3);
            }

            if (funcStart >= 0) funcLines++;
        }

        // آخر دالة
        if (funcStart >= 0 && funcLines > 50) {
            issues.add(new MLIssue(
                "🟡 God Function: " + funcName + "() — " + funcLines + " سطر",
                "// قسّم الدالة لدوال أصغر",
                funcStart + 1, "MEDIUM"
            ));
        }
    }

    // ─── Dead Code ────────────────────────────────────────

    private static void detectDeadCode(String[] lines, List<MLIssue> issues) {
        for (int i = 0; i < lines.length - 1; i++) {
            String t = lines[i].trim();

            // كود بعد return
            if ((t.equals("return;") || t.matches("return\\s+.+;")) && i + 1 < lines.length) {
                String next = lines[i + 1].trim();
                if (!next.isEmpty() && !next.startsWith("//") &&
                    !next.startsWith("}") && !next.startsWith("*")) {
                    issues.add(new MLIssue(
                        "🔵 Dead Code بعد return",
                        "// احذف الكود غير القابل للوصول",
                        i + 2, "LOW"
                    ));
                }
            }

            // TODO/FIXME قديمة
            if (Pattern.compile("(?i)//\\s*(TODO|FIXME|HACK|XXX):?\\s+.{10,}").matcher(t).find()) {
                issues.add(new MLIssue(
                    "🔵 " + t.substring(0, Math.min(t.length(), 60)),
                    "// عالج هذا الـ TODO أو احذفه",
                    i + 1, "LOW"
                ));
            }
        }
    }

    // ─── Memory Leaks ─────────────────────────────────────

    private static void detectMemoryLeaks(String[] lines, List<MLIssue> issues, String ext) {
        if (!ext.equals("js") && !ext.equals("ts") && !ext.equals("java")) return;

        for (int i = 0; i < lines.length; i++) {
            String t = lines[i].trim();

            // addEventListener بدون removeEventListener
            if (t.contains("addEventListener(") && !t.startsWith("//")) {
                boolean hasRemove = false;
                for (int j = i + 1; j < Math.min(i + 30, lines.length); j++) {
                    if (lines[j].contains("removeEventListener(")) {
                        hasRemove = true; break;
                    }
                }
                if (!hasRemove) {
                    issues.add(new MLIssue(
                        "🟡 Memory Leak محتمل: addEventListener بدون removeEventListener",
                        "// أضف removeEventListener في cleanup/componentWillUnmount",
                        i + 1, "MEDIUM"
                    ));
                }
            }

            // setInterval بدون clearInterval
            if (t.contains("setInterval(") && !t.startsWith("//")) {
                boolean hasClear = false;
                for (String line : lines) {
                    if (line.contains("clearInterval(")) { hasClear = true; break; }
                }
                if (!hasClear) {
                    issues.add(new MLIssue(
                        "🟡 Memory Leak: setInterval بدون clearInterval",
                        "// احفظ ID: const id = setInterval(...); clearInterval(id);",
                        i + 1, "MEDIUM"
                    ));
                }
            }
        }
    }

    // ─── Callback Hell ────────────────────────────────────

    private static void detectCallbackHell(String[] lines, List<MLIssue> issues, String ext) {
        if (!ext.equals("js") && !ext.equals("ts")) return;

        int maxDepth = 0;
        int depth    = 0;
        int startLine = -1;

        for (int i = 0; i < lines.length; i++) {
            String t = lines[i];
            if (t.contains("function(") || t.contains("=> {")) {
                depth++;
                if (depth == 1) startLine = i + 1;
                maxDepth = Math.max(maxDepth, depth);
            }
            if (t.contains("});") || t.contains("})")) {
                if (depth > 0) depth--;
            }
        }

        if (maxDepth >= 4) {
            issues.add(new MLIssue(
                "🟠 Callback Hell — تداخل " + maxDepth + " مستويات",
                "// استخدم async/await أو Promises بدل callbacks متداخلة",
                startLine >= 0 ? startLine : 1, "HIGH"
            ));
        }
    }
}
