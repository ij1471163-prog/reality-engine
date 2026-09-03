package com.naif.realityengine;

import java.util.*;

/**
 * IndentAnalyzer — يكتشف أخطاء الـ indentation في Python
 */
public class IndentAnalyzer {

    public static class IndentIssue {
        public String title;
        public String fix;
        public String severity;
        public int line;

        public IndentIssue(String title, String fix, int line, String severity) {
            this.title    = title;
            this.fix      = fix;
            this.line     = line;
            this.severity = severity;
        }
    }

    public static List<IndentIssue> analyze(String code, String fileName) {
        List<IndentIssue> issues = new ArrayList<>();
        if (!fileName.endsWith(".py")) return issues;

        String[] lines = code.split("\n");

        for (int i = 0; i < lines.length; i++) {
            String curr = lines[i];
            String t    = curr.trim();
            int ln      = i + 1;

            if (t.isEmpty() || t.startsWith("#")) continue;

            // 1. كود بعد return في نفس السطر
            if (i + 1 < lines.length) {
                String next  = lines[i + 1];
                String nextT = next.trim();
                if ((t.startsWith("if ") || t.startsWith("if(")) && t.endsWith(":")
                        && nextT.startsWith("return ")) {
                    int currIndent = getIndent(curr);
                    int nextIndent = getIndent(next);
                    if (nextIndent <= currIndent) {
                        issues.add(new IndentIssue(
                            "indent خاطئ بعد if: " + nextT,
                            spaces(currIndent + 4) + nextT,
                            i + 2, "MEDIUM"
                        ));
                    }
                }
            }

            // 2. indent غير متسق داخل دالة
            if (t.startsWith("def ") && t.endsWith(":")) {
                int defIndent = getIndent(curr);
                int expectedBody = defIndent + 4;
                for (int j = i + 1; j < Math.min(i + 20, lines.length); j++) {
                    String bodyLine = lines[j];
                    String bodyT    = bodyLine.trim();
                    if (bodyT.isEmpty() || bodyT.startsWith("#")) continue;
                    if (bodyT.startsWith("def ")) break;
                    int bodyIndent = getIndent(bodyLine);
                    if (bodyIndent > 0 && bodyIndent != expectedBody
                            && bodyIndent != defIndent
                            && !bodyT.startsWith("return")
                            && bodyIndent == expectedBody + 4) {
                        issues.add(new IndentIssue(
                            "indent زائد في دالة: " + bodyT,
                            spaces(expectedBody) + bodyT,
                            j + 1, "MEDIUM"
                        ));
                        break;
                    }
                }
            }

            // 3. mixed tabs and spaces
            if (curr.contains("\t") && curr.startsWith(" ")) {
                issues.add(new IndentIssue(
                    "خلط tabs وspaces في السطر",
                    curr.replace("\t", "    "),
                    ln, "HIGH"
                ));
            }

            // 4. unexpected indent
            if (i > 0) {
                String prev  = lines[i - 1];
                String prevT = prev.trim();
                if (!prevT.endsWith(":") && !prevT.endsWith("\\")
                        && !prevT.isEmpty() && !prevT.startsWith("#")
                        && getIndent(curr) > getIndent(prev) + 4) {
                    issues.add(new IndentIssue(
                        "indent مفاجئ غير متوقع",
                        spaces(getIndent(prev)) + t,
                        ln, "MEDIUM"
                    ));
                }
            }
        }

        return issues;
    }

    private static int getIndent(String line) {
        int count = 0;
        for (char c : line.toCharArray()) {
            if (c == ' ')  count++;
            else if (c == '\t') count += 4;
            else break;
        }
        return count;
    }

    private static String spaces(int n) {
        StringBuilder sb = new StringBuilder();
        for (int i = 0; i < n; i++) sb.append(' ');
        return sb.toString();
    }
}
