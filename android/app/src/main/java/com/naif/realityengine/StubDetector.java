package com.naif.realityengine;

import java.util.ArrayList;
import java.util.List;
import java.util.regex.Pattern;
import java.util.regex.Matcher;

public class StubDetector {

    public enum Risk { CONFIRMED, SUSPICIOUS }

    public static class StubFunction {
        public String name;
        public int line;
        public int startLine;
        public int endLine;
        public Risk risk;
        public String reason;
        public String snippet;
        public String suggestion;
        public String requiredImport;

        public StubFunction(String name, int line, int startLine, int endLine,
                           Risk risk, String reason, String snippet, String suggestion, String requiredImport) {
            this.name           = name;
            this.line           = line;
            this.startLine      = startLine;
            this.endLine        = endLine;
            this.risk           = risk;
            this.reason         = reason;
            this.snippet        = snippet;
            this.suggestion     = suggestion;
            this.requiredImport = requiredImport;
        }

        public StubFunction(String name, int line, Risk risk,
                           String reason, String snippet, String suggestion) {
            this(name, line, line, line, risk, reason, snippet, suggestion, null);
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

    private static int getIndentLevel(String line) {
        int count = 0;
        for (char c : line.toCharArray()) {
            if (c == ' ') count++;
            else if (c == '\t') count += 4;
            else break;
        }
        return count;
    }

    // NEW: strip inline Python comments, respecting # inside strings (basic)
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

    public static SuggestionResult suggestWithContextEx(String name, String fullCode) {
        String n = name.toLowerCase();

        java.util.regex.Matcher pm = java.util.regex.Pattern
            .compile("def " + java.util.regex.Pattern.quote(name) + "\\(([\\s\\S]*?)\\)")
            .matcher(fullCode);
        java.util.List<String> paramList = new java.util.ArrayList<>();
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

    public static String suggestWithContext(String name, String fullCode) {
        return suggestWithContextEx(name, fullCode).code;
    }

    // PRESERVED: original suggest() — not deleted per user request
    private static String suggest(String name) {
        String n = name.toLowerCase();
        if (n.matches("^(is_|has_|can_|validate_|check_|verify_).*"))
            return "    return bool(value)  # أضف منطق التحقق";
        if (n.contains("calculate") || n.contains("sum") || n.contains("total"))
            return "    return sum(items)  # أضف منطق الحساب";
        if (n.contains("read") || n.contains("load"))
            return "    with open(filepath, 'r') as f:\n        return f.read()";
        if (n.contains("write") || n.contains("save"))
            return "    with open(filepath, 'w') as f:\n        f.write(data)";
        if (n.contains("send") || n.contains("email"))
            return "    # أضف كود الإرسال هنا";
        if (n.contains("hash") || n.contains("encrypt"))
            return "    return hashlib.sha256(data.encode()).hexdigest()";
        if (n.contains("log") || n.contains("debug"))
            return "    print(f'[LOG] {message}')";
        if (n.contains("find") || n.contains("search"))
            return "    return [x for x in items if query in str(x)]";
        if (n.contains("delete") || n.contains("remove"))
            return "    return [x for x in items if x != target]";
        return "    raise NotImplementedError('" + name + " not implemented')";
    }

    // REWRITTEN: O(n) line-by-line JS stub detector — zero complex regex
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
                // Single-line arrow without block: () => expr; — skip
                if (lines[s].contains("=>") && !lines[s].contains("{")) {
                    hasBlock = false;
                    break;
                }
            }
            if (!hasBlock) {
                i++;
                continue;
            }

            // Find opening brace line
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

            // Brace counting to find exact end
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

            // Check if body is empty/trivial
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
                // FIXED: نسخة final من name عشان يصلح استخدامها جوه lambda
                // (السبب الأصلي لخطأ compile: "local variables referenced
                // from a lambda expression must be final or effectively final")
                final String finalName = name;
                boolean exists = stubs.stream().anyMatch(s -> s.name.equals(finalName));
                if (!exists) {
                    stubs.add(new StubFunction(
                        name, i + 1, i + 1, endLine + 1, Risk.CONFIRMED,
                        "دالة JS فارغة",
                        line.substring(0, Math.min(80, line.length())),
                        "// TODO: implement " + name, null
                    ));
                }
            }
            i = endLine + 1;
        }
    }

    // O(n) line-by-line Python parser — zero complex regex
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

            // FIXED: strip inline comments before checking for colon
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
                    SuggestionResult sr = suggestWithContextEx(funcName, code);
                    stubs.add(new StubFunction(
                        funcName, defLine, bodyStartIdx + 1, endLine,
                        risk, reason, snippet, sr.code, sr.requiredImport
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

