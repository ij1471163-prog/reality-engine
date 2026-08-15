package com.naif.realityengine;

import java.util.ArrayList;
import java.util.List;

/**
 * StubDetector — كاشف الدوال الناقصة فقط
 *
 * مسؤوليته الوحيدة:
 *   1. اكتشاف الدوال الناقصة (Stubs) في Python و JavaScript
 *   2. تحديد موقعها بالضبط (startLine, endLine)
 *   3. استخراج السياق المحيط (Context) لإرساله للـ AIEngine
 *
 * ما ليس من مسؤوليته:
 *   - توليد كود (لا يخمّن من الاسم)
 *   - تعديل الملف
 *   - قرار التنفيذ النهائي
 */
public class StubDetector {

    public enum Risk { CONFIRMED, SUSPICIOUS }

    /** نتيجة الكشف — للعرض في UI */
    public static class StubFunction {
        public String name;
        public int line;           // سطر تعريف الدالة
        public int startLine;      // بداية جسم الدالة
        public int endLine;        // نهاية جسم الدالة
        public Risk risk;
        public String reason;      // سبب الاشتباه
        public String snippet;     // السطر الناقص نفسه (pass, return None, ...)
        public String context;     // السياق المحيط (يُرسل للـ AI)

        public StubFunction(String name, int line, int startLine, int endLine,
                           Risk risk, String reason, String snippet, String context) {
            this.name      = name;
            this.line      = line;
            this.startLine = startLine;
            this.endLine   = endLine;
            this.risk      = risk;
            this.reason    = reason;
            this.snippet   = snippet;
            this.context   = context;
        }
    }

    /** مرشح للـ AIEngine — يحتوي السياق الكامل */
    public static class Candidate {
        public final String functionName;
        public final String codeSnippet;   // الكود الناقص فقط
        public final String context;       // السياق المحيط (قبل + بعد)
        public final int startLine;
        public final int endLine;

        public Candidate(String functionName, String codeSnippet,
                         String context, int startLine, int endLine) {
            this.functionName = functionName;
            this.codeSnippet  = codeSnippet;
            this.context      = context;
            this.startLine    = startLine;
            this.endLine      = endLine;
        }
    }

    public static class StubResult {
        public List<StubFunction> stubs;
        public int totalFunctions;
        public StubResult(List<StubFunction> stubs, int totalFunctions) {
            this.stubs          = stubs;
            this.totalFunctions = totalFunctions;
        }
    }

    // ═══════════════════════════════════════════════════════════
    // أدوات مساعدة
    // ═══════════════════════════════════════════════════════════

    private static int getIndentLevel(String line) {
        int count = 0;
        for (char c : line.toCharArray()) {
            if (c == ' ') count++;
            else if (c == '\t') count += 4;
            else break;
        }
        return count;
    }

    private static String stripInlineComment(String line) {
        int hash = line.indexOf('#');
        if (hash < 0) return line;
        boolean inSingle = false, inDouble = false;
        for (int i = 0; i < hash; i++) {
            char c = line.charAt(i);
            if (c == '"' && !inSingle) {
                if (i + 2 < line.length() && line.charAt(i+1) == '"' && line.charAt(i+2) == '"') {
                    i += 2; continue;
                }
                inDouble = !inDouble;
            } else if (c == '\'' && !inDouble) {
                if (i + 2 < line.length() && line.charAt(i+1) == '\'' && line.charAt(i+2) == '\'') {
                    i += 2; continue;
                }
                inSingle = !inSingle;
            }
        }
        if (inSingle || inDouble) return line;
        return line.substring(0, hash);
    }

    private static boolean isBlankOrComment(String line) {
        String t = line.trim();
        return t.isEmpty() || t.startsWith("#");
    }

    private static boolean isDocstringStart(String line) {
        String t = line.trim();
        return t.startsWith("\"\"\"") || t.startsWith("'''");
    }

    private static boolean isDocstringEnd(String line) {
        String t = line.trim();
        return t.endsWith("\"\"\"") || t.endsWith("'''");
    }

    // ═══════════════════════════════════════════════════════════
    // استخراج السياق المحيط (Context) — للـ AIEngine
    // ═══════════════════════════════════════════════════════════

    /**
     * يستخرج عددًا من الأسطر قبل وبعد المنطقة المحددة
     * ليعطي الـ AI فهمًا للسياق الكامل.
     */
    private static String extractContext(String[] lines, int startLine, int endLine,
                                          int contextLines) {
        int ctxStart = Math.max(0, startLine - contextLines - 1);
        int ctxEnd   = Math.min(lines.length, endLine + contextLines);

        StringBuilder ctx = new StringBuilder();
        for (int i = ctxStart; i < ctxEnd; i++) {
            ctx.append(String.format("%4d | ", i + 1)).append(lines[i]).append("\n");
        }
        return ctx.toString();
    }

    /**
     * يستخرج الكود الكامل للدالة (من التعريف حتى النهاية)
     */
    private static String extractFunctionCode(String[] lines, int defLineIdx, int endLineIdx) {
        StringBuilder sb = new StringBuilder();
        for (int i = defLineIdx; i < endLineIdx && i < lines.length; i++) {
            sb.append(lines[i]).append("\n");
        }
        return sb.toString();
    }

    // ═══════════════════════════════════════════════════════════
    // تحويل StubFunction إلى Candidate (للـ AIEngine)
    // ═══════════════════════════════════════════════════════════

    /**
     * يحول نتائج الكشف إلى قائمة مرشحات يفهمها AIEngine
     */
    public static List<Candidate> toCandidates(String fullCode, StubResult result) {
        List<Candidate> candidates = new ArrayList<>();
        String[] lines = fullCode.split("\n", -1);

        for (StubFunction stub : result.stubs) {
            String funcCode = extractFunctionCode(lines, stub.line - 1, stub.endLine);
            String context  = extractContext(lines, stub.startLine, stub.endLine, 5);

            candidates.add(new Candidate(
                stub.name,
                funcCode,
                context,
                stub.startLine,
                stub.endLine
            ));
        }
        return candidates;
    }

    // ═══════════════════════════════════════════════════════════
    // كشف JavaScript — O(n) line-by-line
    // ═══════════════════════════════════════════════════════════

    private static void detectJavaScriptStubs(String code, List<StubFunction> stubs) {
        String[] lines = code.split("\n", -1);
        int i = 0;
        while (i < lines.length) {
            String line = lines[i].trim();
            boolean isFuncDecl = false;
            boolean isVarAssign = false;
            String name = null;

            // Pattern 1: function name(...) or async function name(...)
            if (line.matches("^(?:async\\s+)?function\\s+\\w+.*")) {
                isFuncDecl = true;
                String afterFunc = line.replaceFirst("^(?:async\\s+)?function\\s+", "");
                int paren = afterFunc.indexOf('(');
                if (paren > 0) {
                    name = afterFunc.substring(0, paren).trim();
                }
            }
            // Pattern 2: const/let/var name = function(...) or (...) => ...
            else if (line.matches("^(?:const|let|var)\\s+\\w+\\s*=.*")) {
                isVarAssign = true;
                String afterVar = line.replaceFirst("^(?:const|let|var)\\s+", "");
                int eq = afterVar.indexOf('=');
                if (eq > 0) {
                    name = afterVar.substring(0, eq).trim();
                }
            }

            if (name == null || name.isEmpty()) {
                i++;
                continue;
            }

            // Only match block-style functions (contains { )
            boolean hasBlock = false;
            int searchLimit = Math.min(i + 3, lines.length);
            for (int s = i; s < searchLimit; s++) {
                if (lines[s].contains("{")) {
                    hasBlock = true;
                    break;
                }
                if (lines[s].contains("=>") && !lines[s].contains("{")) {
                    hasBlock = false;
                    break;
                }
            }
            if (!hasBlock) {
                i++;
                continue;
            }

            int braceLine = -1;
            for (int s = i; s < searchLimit && s < lines.length; s++) {
                if (lines[s].contains("{")) {
                    braceLine = s;
                    break;
                }
            }
            if (braceLine < 0) {
                i++;
                continue;
            }

            int braceCount = 0;
            int endLine = braceLine;
            boolean foundOpen = false;
            for (int s = braceLine; s < lines.length; s++) {
                String sl = lines[s];
                for (int c = 0; c < sl.length(); c++) {
                    if (sl.charAt(c) == '{') { braceCount++; foundOpen = true; }
                    else if (sl.charAt(c) == '}') braceCount--;
                }
                endLine = s;
                if (foundOpen && braceCount == 0) break;
            }

            StringBuilder bodyBuilder = new StringBuilder();
            for (int s = braceLine; s <= endLine; s++) {
                bodyBuilder.append(lines[s]).append("\n");
            }
            String bodyContent = bodyBuilder.toString()
                .replaceAll("[\\{\\}]", "").replaceAll("\\s+", " ").trim();

            boolean isEmpty = bodyContent.isEmpty()
                || bodyContent.equals(";")
                || bodyContent.matches("^return\\s*;?$")
                || bodyContent.matches("^return\\s+undefined\\s*;?$")
                || bodyContent.matches("^return\\s+null\\s*;?$")
                || bodyContent.matches("^return\\s+false\\s*;?$")
                || bodyContent.matches("^return\\s+0\\s*;?$")
                || bodyContent.matches("^return\\s+''\\s*;?$")
                || bodyContent.matches("^return\\s+\"\"\\s*;?$");

            if (isEmpty) {
                final String finalName = name;
                boolean exists = stubs.stream().anyMatch(s -> s.name.equals(finalName));
                if (!exists) {
                    String context = extractContext(lines, i + 1, endLine + 1, 5);
                    stubs.add(new StubFunction(
                        name, i + 1, i + 1, endLine + 1, Risk.CONFIRMED,
                        "دالة JS فارغة",
                        line.substring(0, Math.min(80, line.length())),
                        context
                    ));
                }
            }
            i = endLine + 1;
        }
    }

    // ═══════════════════════════════════════════════════════════
    // كشف Python — O(n) line-by-line
    // ═══════════════════════════════════════════════════════════

    public static StubResult detect(String code) {
        List<StubFunction> stubs = new ArrayList<>();
        if (code == null || code.trim().isEmpty()) {
            return new StubResult(stubs, 0);
        }

        String[] lines = code.split("\n", -1);
        int totalFunctions = 0;

        int i = 0;
        while (i < lines.length) {
            String line = lines[i];
            String trimmed = line.trim();

            if (trimmed.startsWith("@")) {
                i++;
                continue;
            }

            boolean isAsync = trimmed.startsWith("async def ");
            boolean isDef = trimmed.startsWith("def ");
            if (!isAsync && !isDef) {
                i++;
                continue;
            }

            totalFunctions++;

            String afterDef = isAsync ? trimmed.substring(10).trim() : trimmed.substring(4).trim();
            int parenIdx = afterDef.indexOf('(');
            if (parenIdx < 0) { i++; continue; }
            String funcName = afterDef.substring(0, parenIdx).trim();

            if (funcName.equals("__init__") || funcName.equals("__del__") ||
                funcName.equals("__repr__") || funcName.equals("__str__") ||
                funcName.equals("__eq__") || funcName.equals("__hash__")) {
                i++;
                continue;
            }

            int defLine = i + 1;
            int baseIndent = getIndentLevel(line);
            int signatureEnd = i;

            while (signatureEnd < lines.length) {
                String clean = stripInlineComment(lines[signatureEnd]).trim();
                if (clean.endsWith(":")) break;
                signatureEnd++;
            }
            if (signatureEnd >= lines.length) { i++; continue; }

            int bodyStartIdx = signatureEnd + 1;
            while (bodyStartIdx < lines.length) {
                String bl = lines[bodyStartIdx].trim();
                if (bl.isEmpty() || bl.startsWith("#")) {
                    bodyStartIdx++;
                } else if (isDocstringStart(lines[bodyStartIdx])) {
                    if (!isDocstringEnd(lines[bodyStartIdx]) || bl.length() < 6) {
                        bodyStartIdx++;
                        while (bodyStartIdx < lines.length && !isDocstringEnd(lines[bodyStartIdx])) {
                            bodyStartIdx++;
                        }
                    }
                    bodyStartIdx++;
                } else {
                    break;
                }
            }

            int endLine = bodyStartIdx;
            if (bodyStartIdx < lines.length) {
                int scan = bodyStartIdx;
                while (scan < lines.length) {
                    String sl = lines[scan];
                    String slTrim = sl.trim();
                    if (slTrim.isEmpty() || slTrim.startsWith("#")) {
                        scan++;
                        continue;
                    }
                    int ind = getIndentLevel(sl);
                    if (ind <= baseIndent) {
                        endLine = scan;
                        break;
                    }
                    endLine = scan + 1;
                    scan++;
                }
                if (endLine < bodyStartIdx) endLine = bodyStartIdx;
            } else {
                endLine = signatureEnd + 1;
            }

            boolean isStub = false;
            Risk risk = Risk.SUSPICIOUS;
            String reason = "";
            String snippet = "";

            if (bodyStartIdx < lines.length && bodyStartIdx < endLine) {
                String firstBody = lines[bodyStartIdx].trim();

                if (firstBody.equals("pass") || firstBody.equals("...") || firstBody.equals("Ellipsis")) {
                    isStub = true;
                    risk = Risk.CONFIRMED;
                    reason = "pass / ... / NotImplementedError";
                    snippet = firstBody;
                } else if (firstBody.startsWith("raise NotImplementedError")) {
                    isStub = true;
                    risk = Risk.CONFIRMED;
                    reason = "raise NotImplementedError";
                    snippet = firstBody;
                } else if (firstBody.matches("^return\\s+(?:0|0\\.0|\\[\\]|\\{\\}|None|False|\"\"|''|\\\"\\\"\\\".*\\\"\\\"\\\"|'''.*''')\\s*$")) {
                    isStub = true;
                    risk = Risk.SUSPICIOUS;
                    reason = "return قيمة فاضية";
                    snippet = firstBody;
                }
            } else {
                isStub = true;
                risk = Risk.CONFIRMED;
                reason = "جسم الدالة فارغ";
            }

            if (isStub) {
                boolean exists = stubs.stream().anyMatch(s -> s.name.equals(funcName));
                if (!exists) {
                    String context = extractContext(lines, bodyStartIdx + 1, endLine, 5);
                    stubs.add(new StubFunction(
                        funcName, defLine, bodyStartIdx + 1, endLine,
                        risk, reason, snippet, context
                    ));
                }
            }

            i = endLine > signatureEnd ? endLine : signatureEnd + 1;
        }

        stubs.sort((a, b) -> a.risk.compareTo(b.risk));
        detectJavaScriptStubs(code, stubs);

        return new StubResult(stubs, totalFunctions);
    }
}

