package com.naif.realityengine;

import java.util.ArrayList;
import java.util.List;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import java.util.Set;

/**
 * StubDetector — كاشف الدوال الناقصة + مولّد اقتراحات مبدئية
 *
 * مسؤوليته:
 *   1. اكتشاف الدوال الناقصة (Stubs) في Python و JavaScript
 *   2. تحديد موقعها بالضبط (startLine, endLine)
 *   3. استخراج السياق المحيط (Context) لإرساله للـ AIEngine (المعمارية الجديدة)
 *   4. توليد اقتراح مبدئي بسيط (suggestion) — طبقة توافق فقط، ليست بديلاً عن AIEngine
 *
 * ⚠️ suggestion هنا اقتراح سريع مبني على اسم الدالة فقط (heuristic)، مو تحليل AI حقيقي.
 *    القرار النهائي والتوليد الدقيق يفترض يمر عبر AIEngine.analyzeFile() + AISecurityGuard.
 */
public class StubDetector {

    public enum Risk { CONFIRMED, SUSPICIOUS }

    /** نتيجة الكشف — للعرض في UI وللتوافق مع الاستدعاءات القديمة */
    public static class StubFunction {
        public String name;
        public int line;             // سطر تعريف الدالة
        public int startLine;        // بداية جسم الدالة
        public int endLine;          // نهاية جسم الدالة
        public Risk risk;
        public String reason;        // سبب الاشتباه
        public String snippet;       // السطر الناقص نفسه (pass, return None, ...)
        public String context;       // السياق المحيط (يُرسل للـ AIEngine الجديد)
        public String suggestion;    // اقتراح heuristic سريع — توافق فقط
        public String requiredImport;

        public StubFunction(String name, int line, int startLine, int endLine,
                           Risk risk, String reason, String snippet, String context,
                           String suggestion, String requiredImport) {
            this.name           = name;
            this.line           = line;
            this.startLine      = startLine;
            this.endLine        = endLine;
            this.risk           = risk;
            this.reason         = reason;
            this.snippet        = snippet;
            this.context        = context;
            this.suggestion     = suggestion;
            this.requiredImport = requiredImport;
        }
    }

    /** مرشح للـ AIEngine الجديد — يحتوي السياق الكامل */
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

    public static class SuggestionResult {
        public String code;
        public String requiredImport;
        public SuggestionResult(String code, String requiredImport) {
            this.code = code;
            this.requiredImport = requiredImport;
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

    private static boolean isDocstringStart(String line) {
        String t = line.trim();
        return t.startsWith("\"\"\"") || t.startsWith("'''");
    }

    private static boolean isDocstringEnd(String line) {
        String t = line.trim();
        return t.endsWith("\"\"\"") || t.endsWith("'''");
    }

    // ═══════════════════════════════════════════════════════════
    // استخراج السياق المحيط (Context) — للـ AIEngine الجديد
    // ═══════════════════════════════════════════════════════════

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

    private static String extractFunctionCode(String[] lines, int defLineIdx, int endLineIdx) {
        StringBuilder sb = new StringBuilder();
        for (int i = defLineIdx; i < endLineIdx && i < lines.length; i++) {
            sb.append(lines[i]).append("\n");
        }
        return sb.toString();
    }

    // ═══════════════════════════════════════════════════════════
    // تحويل StubFunction إلى Candidate (لـ AIEngine.analyzeFile الجديدة)
    // ═══════════════════════════════════════════════════════════

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
    // توليد اقتراح مبدئي (heuristic) — طبقة توافق مع الاستدعاءات القديمة
    // ═══════════════════════════════════════════════════════════

    public static SuggestionResult suggestWithContextEx(String name, String fullCode) {
        String n = name.toLowerCase();

        Matcher pm = Pattern
            .compile("def " + Pattern.quote(name) + "\\(([\\s\\S]*?)\\)")
            .matcher(fullCode);
        List<String> paramList = new ArrayList<>();
        if (pm.find()) {
            String paramsRaw = pm.group(1).replaceAll("\\s+", " ");
            for (String p : paramsRaw.split(",")) {
                String pname = p.trim().split(":")[0].trim().split("=")[0].trim();
                if (!pname.equals("self") && !pname.equals("cls") && !pname.isEmpty())
                    paramList.add(pname);
            }
        }
        String p1 = paramList.size() > 0 ? paramList.get(0) : "value";
        String p2 = paramList.size() > 1 ? paramList.get(1) : "items";

        if (n.contains("email") && (n.startsWith("is_") || n.startsWith("validate_") || n.startsWith("check_") || n.startsWith("verify_")))
            return new SuggestionResult("    return bool(re.match(r\"^[\\w._%+-]+@[\\w.-]+\\.[a-zA-Z]{2,}$\", str(" + p1 + ")))", "re");

        if (n.contains("hash") && n.contains("password"))
            return new SuggestionResult("    return hashlib.sha256(str(" + p1 + ").encode(\"utf-8\")).hexdigest()", "hashlib");

        if (n.contains("hash") || n.contains("encrypt") || n.contains("digest"))
            return new SuggestionResult("    return hashlib.sha256(str(" + p1 + ").encode()).hexdigest()", "hashlib");

        if (n.contains("password") && (n.startsWith("is_") || n.startsWith("validate_") || n.startsWith("check_")))
            return new SuggestionResult("    p = str(" + p1 + ")\n    return len(p) >= 8 and any(c.isupper() for c in p) and any(c.isdigit() for c in p)", null);

        if (n.contains("normalize") || n.contains("clean") || n.contains("sanitize"))
            return new SuggestionResult("    return str(" + p1 + ").strip().lower().replace(\"  \", \" \")", null);

        if (n.contains("palindrome"))
            return new SuggestionResult("    s = str(" + p1 + ").lower().replace(\" \", \"\")\n    return s == s[::-1]", null);

        if (n.startsWith("is_") || n.startsWith("has_") || n.startsWith("can_") || n.startsWith("validate_") || n.startsWith("check_") || n.startsWith("verify_"))
            return new SuggestionResult("    return " + p1 + " is not None and bool(" + p1 + ")", null);

        if (n.contains("calculate") || n.contains("total") || n.contains("count"))
            return new SuggestionResult("    return sum(" + p1 + ") if " + p1 + " else 0", null);

        if (n.contains("average") || n.contains("avg") || n.contains("mean"))
            return new SuggestionResult("    items = list(" + p1 + ")\n    return sum(items) / len(items) if items else 0.0", null);

        if (n.contains("sort"))
            return new SuggestionResult("    return sorted(" + p1 + ")", null);

        if (n.contains("unique") || n.contains("distinct") || n.contains("dedup"))
            return new SuggestionResult("    return list(dict.fromkeys(" + p1 + "))", null);

        if (n.contains("read") || n.contains("load"))
            return new SuggestionResult("    if not os.path.exists(str(" + p1 + ")):\n        return None\n    with open(" + p1 + ", \"r\", encoding=\"utf-8\") as f:\n        return f.read()", "os");

        if (n.contains("write") || n.contains("save"))
            return new SuggestionResult("    with open(" + p1 + ", \"w\", encoding=\"utf-8\") as f:\n        f.write(str(" + p2 + "))\n    return True", null);

        if (n.contains("find") || n.contains("search") || n.contains("fetch"))
            return new SuggestionResult("    return next((x for x in " + p2 + " if x == " + p1 + "), None)", null);

        if (n.contains("delete") || n.contains("remove"))
            return new SuggestionResult("    return [x for x in " + p2 + " if x != " + p1 + "]", null);

        if (n.contains("format") || n.contains("convert") || n.contains("parse"))
            return new SuggestionResult("    return str(" + p1 + ").strip()", null);

        if (n.contains("json"))
            return new SuggestionResult("    try:\n        return json.loads(str(" + p1 + "))\n    except Exception:\n        return None", "json");

        if (n.contains("log") || n.contains("debug"))
            return new SuggestionResult("    print(str(" + p1 + "))\n    return True", null);

        if (n.contains("send") || n.contains("notify"))
            return new SuggestionResult("    return {\"status\": \"pending\", \"to\": str(" + p1 + "), \"sent\": False}", null);

        return new SuggestionResult("    raise NotImplementedError(f\"" + name + "() not implemented - requires manual implementation\")", null);
    }

    /**
     * الواجهة القديمة المتوافقة — تُستخدم من ApprovalWorkflow.java و AIAnalysisActivity.java
     */
    public static String suggestWithContext(String name, String fullCode) {
        return suggestWithContextEx(name, fullCode).code;
    }

    // ═══════════════════════════════════════════════════════════
    // كشف JavaScript — O(n) line-by-line
    // ═══════════════════════════════════════════════════════════

    private static void detectJavaScriptStubs(String code, List<StubFunction> stubs) {
        String[] lines = code.split("\n", -1);
        int i = 0;
        while (i < lines.length) {
            String line = lines[i].trim();
            String name = null;

            if (line.matches("^(?:async\\s+)?function\\s+\\w+.*")) {
                String afterFunc = line.replaceFirst("^(?:async\\s+)?function\\s+", "");
                int paren = afterFunc.indexOf('(');
                if (paren > 0) {
                    name = afterFunc.substring(0, paren).trim();
                }
            } else if (line.matches("^(?:const|let|var)\\s+\\w+\\s*=.*")) {
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
                        context,
                        "// TODO: implement " + name,
                        null
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
                    SuggestionResult sr = suggestWithContextEx(funcName, code);
                    stubs.add(new StubFunction(
                        funcName, defLine, bodyStartIdx + 1, endLine,
                        risk, reason, snippet, context,
                        sr.code, sr.requiredImport
                    ));
                }
            }

            i = endLine > signatureEnd ? endLine : signatureEnd + 1;
        }

        stubs.sort((a, b) -> a.risk.compareTo(b.risk));
        detectJavaScriptStubs(code, stubs);
        detectJavaStubs(code, stubs);

        return new StubResult(stubs, totalFunctions);
    }



    // كشف Java stubs - نهج بسيط سطر بسطر
    private static void detectJavaStubs(String code, List<StubFunction> stubs) {
        if (!code.contains("public class") && !code.contains("private ")
            && !code.contains("protected ")) return;

        java.util.Set<String> skip = new java.util.HashSet<>(java.util.Arrays.asList(
            "main","toString","hashCode","equals","onCreate","onStart",
            "onResume","onPause","onStop","onDestroy","getView","onClick"
        ));

        String[] lines = code.split("\n");
        for (int i = 0; i < lines.length; i++) {
            String line = lines[i].trim();

            // تحقق إن السطر فيه method signature
            if (!line.startsWith("public ") && !line.startsWith("private ")
                && !line.startsWith("protected ")) continue;

            // استخرج اسم الدالة
            // استخرج اسم الدالة
            Pattern sig = Pattern.compile(
                "(?:public|private|protected)\\s+(?:static\\s+)?[\\w<>\\[\\]]+\\s+(\\w+)\\s*\\("
            );
            Matcher sm = sig.matcher(line);
            if (!sm.find()) continue;

            String name = sm.group(1);
            if (skip.contains(name)) continue;
            boolean exists = stubs.stream().anyMatch(s -> s.name.equals(name));
            if (exists) continue;

            // جمع جسم الدالة
            StringBuilder body = new StringBuilder(line);
            int braces = 0;
            boolean started = false;
            int j = i;
            while (j < lines.length) {
                String bl = lines[j];
                for (char c : bl.toCharArray()) {
                    if (c == '{') { braces++; started = true; }
                    else if (c == '}') braces--;
                }
                body.append("\n").append(bl);
                j++;
                if (started && braces <= 0) break;
            }

            String bodyStr = body.toString();

            // هل هي stub؟
            boolean isEmpty = bodyStr.contains("{ }") || bodyStr.matches("(?s).*\\{\\s*\\}.*");
            boolean hasTodo = bodyStr.contains("// TODO") || bodyStr.contains("//TODO");
            boolean hasUnsupported = bodyStr.contains("UnsupportedOperationException");

            if (isEmpty || hasTodo || hasUnsupported) {
                stubs.add(new StubFunction(
                    name, i + 1, i + 1, i + 1,
                    Risk.CONFIRMED,
                    "Java method stub",
                    line.substring(0, Math.min(100, line.length())),
                    "",
                    "// TODO: implement " + name + "()",
                    ""
                ));
            }
        }
    }

}
