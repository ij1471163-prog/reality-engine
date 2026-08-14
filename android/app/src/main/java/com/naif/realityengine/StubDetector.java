package com.naif.realityengine;

import java.util.ArrayList;
import java.util.List;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

public class StubDetector {

    public static class StubInfo {
        public String functionName;
        public int startLine;      // 0-based
        public int endLine;        // 0-based
        public String body;        // جسم الدالة كامل

        public StubInfo(String name, int start, int end, String body) {
            this.functionName = name;
            this.startLine = start;
            this.endLine = end;
            this.body = body;
        }
    }

    public static List<StubInfo> findStubs(String code, String fileName) {
        AISecurityGuard.Language lang = AISecurityGuard.detectLanguage(code, fileName);
        if (lang == AISecurityGuard.Language.PYTHON) return findPythonStubs(code);
        if (lang == AISecurityGuard.Language.JAVA || lang == AISecurityGuard.Language.KOTLIN) return findJavaStubs(code);
        if (lang == AISecurityGuard.Language.JAVASCRIPT) return findJsStubs(code);
        return new ArrayList<>();
    }

    // ===== Python =====
    private static List<StubInfo> findPythonStubs(String code) {
        List<StubInfo> stubs = new ArrayList<>();
        String[] lines = code.split("\n", -1);

        // Pattern: def name(...): \n (indent) body
        Pattern defPattern = Pattern.compile("^(\\s*)def\\s+(\\w+)\\s*\\([^)]*\\)\\s*(?:->\\s*[^:]*)?:");

        for (int i = 0; i < lines.length; i++) {
            Matcher m = defPattern.matcher(lines[i]);
            if (!m.find()) continue;

            String baseIndent = m.group(1);
            String funcName = m.group(2);
            int defLine = i;
            int bodyStart = i + 1;

            // نجمع جسم الدالة حتى السطر اللي يرجع لنفس المستوى أو أقل
            StringBuilder body = new StringBuilder();
            int j = bodyStart;
            while (j < lines.length) {
                String line = lines[j];
                if (line.trim().isEmpty()) {
                    body.append(line).append("\n");
                    j++;
                    continue;
                }
                int lineIndent = countLeadingSpaces(line);
                int baseLen = baseIndent.length();

                // لو السطر الجديد أقل أو يساوي indent الدالة → الدالة انتهت
                if (lineIndent <= baseLen && !line.trim().startsWith("#")) {
                    break;
                }
                body.append(line).append("\n");
                j++;
            }

            String bodyStr = body.toString();
            int endLine = j - 1;

            if (isStubBody(bodyStr)) {
                stubs.add(new StubInfo(funcName, defLine, endLine, bodyStr));
            }
        }
        return stubs;
    }

    // ===== Java / Kotlin =====
    private static List<StubInfo> findJavaStubs(String code) {
        List<StubInfo> stubs = new ArrayList<>();
        String[] lines = code.split("\n", -1);
        Pattern methodPattern = Pattern.compile(
            "(?:public|private|protected|static|final|\\s)*\\s*(?:[\\w<>\\[\\]]+\\s+)?(\\w+)\\s*\\([^)]*\\)\\s*(?:throws[^{]+)?\\{"
        );

        for (int i = 0; i < lines.length; i++) {
            Matcher m = methodPattern.matcher(lines[i]);
            if (!m.find()) continue;

            String funcName = m.group(1);
            int startLine = i;

            // نبحث عن القوس المغلق المتوازن
            int braceCount = 0;
            int j = i;
            StringBuilder body = new StringBuilder();
            boolean started = false;

            for (; j < lines.length; j++) {
                String line = lines[j];
                body.append(line).append("\n");
                for (char c : line.toCharArray()) {
                    if (c == '{') { braceCount++; started = true; }
                    else if (c == '}') braceCount--;
                }
                if (started && braceCount == 0) break;
            }

            if (isStubBody(body.toString())) {
                stubs.add(new StubInfo(funcName, startLine, j, body.toString()));
            }
        }
        return stubs;
    }

    // ===== JavaScript =====
    private static List<StubInfo> findJsStubs(String code) {
        List<StubInfo> stubs = new ArrayList<>();
        String[] lines = code.split("\n", -1);
        Pattern funcPattern = Pattern.compile("(?:function\\s+(\\w+)|(?:const|let|var)\\s+(\\w+)\\s*=\\s*(?:function|=>))");

        for (int i = 0; i < lines.length; i++) {
            Matcher m = funcPattern.matcher(lines[i]);
            if (!m.find()) continue;
            String funcName = m.group(1) != null ? m.group(1) : m.group(2);

            int braceCount = 0;
            int j = i;
            StringBuilder body = new StringBuilder();
            boolean started = false;

            for (; j < lines.length; j++) {
                String line = lines[j];
                body.append(line).append("\n");
                for (char c : line.toCharArray()) {
                    if (c == '{') { braceCount++; started = true; }
                    else if (c == '}') braceCount--;
                }
                if (started && braceCount == 0) break;
            }

            if (isStubBody(body.toString())) {
                stubs.add(new StubInfo(funcName, i, j, body.toString()));
            }
        }
        return stubs;
    }

    // ===== هل الجسم ناقص؟ =====
    private static boolean isStubBody(String body) {
        String trimmed = body.trim().toLowerCase();
        if (trimmed.isEmpty()) return true;
        if (trimmed.matches("(?s).*\\bpass\\b.*")) return true;
        if (trimmed.matches("(?s).*\\btodo\\b.*")) return true;
        if (trimmed.matches("(?s).*\\bfixme\\b.*")) return true;
        if (trimmed.matches("(?s).*raise\\s+notimplementederror.*")) return true;
        if (trimmed.matches("(?s).*throw\\s+new\\s+unsupportedoperationexception.*")) return true;
        if (trimmed.matches("(?s).*return\\s+(null|0|\"\"|''|\\[\\]|\\{\\}).*")) return true;
        // جسم فارغ تقريباً (سطر أو سطرين فقط)
        if (trimmed.split("\n").length <= 2 && trimmed.replaceAll("[{}]", "").trim().isEmpty()) return true;
        return false;
    }

    private static int countLeadingSpaces(String s) {
        int count = 0;
        for (char c : s.toCharArray()) {
            if (c == ' ') count++;
            else break;
        }
        return count;
    }
}

