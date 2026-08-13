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

        public StubFunction(String name, int line, int startLine, int endLine,
                           Risk risk, String reason, String snippet, String suggestion) {
            this.name       = name;
            this.line       = line;
            this.startLine  = startLine;
            this.endLine    = endLine;
            this.risk       = risk;
            this.reason     = reason;
            this.snippet    = snippet;
            this.suggestion = suggestion;
        }

        public StubFunction(String name, int line, Risk risk,
                           String reason, String snippet, String suggestion) {
            this(name, line, line, line, risk, reason, snippet, suggestion);
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

    private static int getIndentLevel(String line) {
        int count = 0;
        for (char c : line.toCharArray()) {
            if (c == ' ') count++;
            else if (c == '\t') count += 4;
            else break;
        }
        return count;
    }

    public static String suggestWithContext(String name, String fullCode) {
        String n = name.toLowerCase();

        // FIXED: multiline signature support + normalize whitespace before splitting
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
            return "    return bool(re.match(r\"^[\\w._%+-]+@[\\w.-]+\\.[a-zA-Z]{2,}$\", str(" + p1 + ")))";

        if (n.contains("hash") && n.contains("password"))
            return "    return hashlib.sha256(str(" + p1 + ").encode(\"utf-8\")).hexdigest()";

        if (n.contains("hash") || n.contains("encrypt") || n.contains("digest"))
            return "    return hashlib.sha256(str(" + p1 + ").encode()).hexdigest()";

        if (n.contains("password") && (n.startsWith("is_") || n.startsWith("validate_") || n.startsWith("check_")))
            return "    p = str(" + p1 + ")\n    return len(p) >= 8 and any(c.isupper() for c in p) and any(c.isdigit() for c in p)";

        if (n.contains("palindrome"))
            return "    s = str(" + p1 + ").lower().replace(\" \", \"\")\n    return s == s[::-1]";

        if (n.startsWith("is_") || n.startsWith("has_") || n.startsWith("can_") || n.startsWith("validate_") || n.startsWith("check_") || n.startsWith("verify_"))
            return "    return " + p1 + " is not None and bool(" + p1 + ")";

        if (n.contains("calculate") || n.contains("total") || n.contains("count"))
            return "    return sum(" + p1 + ") if " + p1 + " else 0";

        if (n.contains("average") || n.contains("avg") || n.contains("mean"))
            return "    items = list(" + p1 + ")\n    return sum(items) / len(items) if items else 0.0";

        if (n.contains("sort"))
            return "    return sorted(" + p1 + ")";

        if (n.contains("unique") || n.contains("distinct") || n.contains("dedup"))
            return "    return list(dict.fromkeys(" + p1 + "))";

        if (n.contains("read") || n.contains("load"))
            return "    if not os.path.exists(str(" + p1 + ")):\n        return None\n    with open(" + p1 + ", \"r\", encoding=\"utf-8\") as f:\n        return f.read()";

        if (n.contains("write") || n.contains("save"))
            return "    with open(" + p1 + ", \"w\", encoding=\"utf-8\") as f:\n        f.write(str(" + p2 + "))\n    return True";

        if (n.contains("find") || n.contains("search") || n.contains("fetch"))
            return "    return next((x for x in " + p2 + " if x == " + p1 + "), None)";

        if (n.contains("delete") || n.contains("remove"))
            return "    return [x for x in " + p2 + " if x != " + p1 + "]";

        if (n.contains("format") || n.contains("convert") || n.contains("parse"))
            return "    return str(" + p1 + ").strip()";

        if (n.contains("json"))
            return "    try:\n        return json.loads(str(" + p1 + "))\n    except Exception:\n        return None";

        if (n.contains("log") || n.contains("debug"))
            return "    print(str(" + p1 + "))\n    return True";

        if (n.contains("send") || n.contains("notify"))
            return "    return {\"status\": \"pending\", \"to\": str(" + p1 + "), \"sent\": False}";

        return "    raise NotImplementedError(f\"" + name + "() not implemented - requires manual implementation\")";
    }

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

    // FIXED: added async support and multiline param support for JS
    private static void detectJavaScriptStubs(String code, List<StubFunction> stubs) {
        Pattern jsFunc = Pattern.compile(
            "(?:async\\s+)?function\\s+(\\w+)\\s*\\([\\s\\S]*?\\)\\s*\\{\\s*\\}|" +
            "(?:const|let|var)\\s+(\\w+)\\s*=\\s*(?:async\\s+)?(?:function\\s*\\([\\s\\S]*?\\)|[^=]+=>)\\s*\\{\\s*\\}",
            Pattern.MULTILINE
        );
        Matcher jsMatcher = jsFunc.matcher(code);
        while (jsMatcher.find()) {
            String name = jsMatcher.group(1) != null ? jsMatcher.group(1) : jsMatcher.group(2);
            if (name == null) continue;
            String before = code.substring(0, jsMatcher.start());
            int lineNo = before.split("\n", -1).length;
            boolean exists = stubs.stream().anyMatch(s -> s.name.equals(name));
            if (!exists) {
                stubs.add(new StubFunction(
                    name, lineNo, lineNo, lineNo, Risk.CONFIRMED,
                    "دالة JS فارغة",
                    jsMatcher.group().substring(0, Math.min(80, jsMatcher.group().length())),
                    "// TODO: implement " + name
                ));
            }
        }
    }

    public static StubResult detect(String code) {
        List<StubFunction> stubs = new ArrayList<>();
        String[] lines = code.split("\n", -1);
        int totalFunctions = 0;

        Pattern funcPattern = Pattern.compile("^\\s*(?:async\\s+)?def\\s+(\\w+)\\s*\\(", Pattern.MULTILINE);
        Matcher funcMatcher = funcPattern.matcher(code);
        while (funcMatcher.find()) totalFunctions++;

        // FIXED: [\\s\\S]*? instead of [^)]* to support multiline signatures
        Pattern[] confirmed = {
            Pattern.compile("^(\\s*)(?:@\\w+(?:\\([^)]*\\))?\\s*\\n\\s*)*(?:async\\s+)?def\\s+(\\w+)\\s*\\([\\s\\S]*?\\).*:\\s*\\n\\1    pass\\s*$", Pattern.MULTILINE),
            Pattern.compile("^(\\s*)(?:@\\w+(?:\\([^)]*\\))?\\s*\\n\\s*)*(?:async\\s+)?def\\s+(\\w+)\\s*\\([\\s\\S]*?\\).*:\\s*\\n\\1    \\.\\.\\.\\s*$", Pattern.MULTILINE),
            Pattern.compile("^(\\s*)(?:@\\w+(?:\\([^)]*\\))?\\s*\\n\\s*)*(?:async\\s+)?def\\s+(\\w+)\\s*\\([\\s\\S]*?\\).*:\\s*\\n\\1    raise\\s+NotImplementedError", Pattern.MULTILINE),
        };

        for (Pattern p : confirmed) {
            Matcher m = p.matcher(code);
            while (m.find()) {
                String funcName = m.group(2);
                String matchText = m.group();
                String before = code.substring(0, m.start());
                int matchLine = before.split("\n", -1).length;

                // FIXED: find actual def line (skip decorators)
                int defOffset = matchText.indexOf("def ");
                int linesBeforeDef = 0;
                for (int k = 0; k < defOffset; k++) {
                    if (matchText.charAt(k) == '\n') linesBeforeDef++;
                }
                int defLine = matchLine + linesBeforeDef;
                String snippet = lines[defLine - 1].trim();

                // FIXED: endLine calculation starts from defLine, not decorator line
                int baseIndent = getIndentLevel(lines[defLine - 1]);
                int startLine = defLine;
                int endLine = defLine;
                for (int idx = defLine; idx < lines.length; idx++) {
                    String l = lines[idx].trim();
                    if (l.isEmpty() || l.startsWith("#")) continue;
                    int ind = getIndentLevel(lines[idx]);
                    if (ind <= baseIndent) {
                        endLine = idx; // 1-based line number of previous line
                        break;
                    }
                    endLine = idx + 1;
                }
                if (endLine < defLine) endLine = defLine;

                boolean exists = stubs.stream().anyMatch(s -> s.name.equals(funcName));
                if (!exists) {
                    stubs.add(new StubFunction(
                        funcName, defLine, startLine, endLine, Risk.CONFIRMED,
                        "pass / ... / NotImplementedError",
                        snippet, suggestWithContext(funcName, code)
                    ));
                }
            }
        }

        // FIXED: multiline signature support
        Pattern suspicious = Pattern.compile(
            "^(\\s*)(?:@\\w+(?:\\([^)]*\\))?\\s*\\n\\s*)*(?:async\\s+)?def\\s+(\\w+)\\s*\\([\\s\\S]*?\\).*:\\s*\\n(?:\\1    \"\"\"[^\"]*\"\"\"\\s*\\n)?\\1    return\\s+(?:0|0\\.0|\\[\\]|\\{\\}|None|False|\"\")\\s*$",
            Pattern.MULTILINE
        );
        Matcher sm = suspicious.matcher(code);
        while (sm.find()) {
            String funcName = sm.group(2);
            String matchText = sm.group();
            String before = code.substring(0, sm.start());
            int matchLine = before.split("\n", -1).length;

            // FIXED: find actual def line (skip decorators)
            int defOffset = matchText.indexOf("def ");
            int linesBeforeDef = 0;
            for (int k = 0; k < defOffset; k++) {
                if (matchText.charAt(k) == '\n') linesBeforeDef++;
            }
            int defLine = matchLine + linesBeforeDef;
            String snippet = lines[defLine - 1].trim();

            int baseIndent = getIndentLevel(lines[defLine - 1]);
            int startLine = defLine;
            int endLine = defLine;
            for (int idx = defLine; idx < lines.length; idx++) {
                String l = lines[idx].trim();
                if (l.isEmpty() || l.startsWith("#")) continue;
                int ind = getIndentLevel(lines[idx]);
                if (ind <= baseIndent) {
                    endLine = idx;
                    break;
                }
                endLine = idx + 1;
            }
            if (endLine < defLine) endLine = defLine;

            boolean exists = stubs.stream().anyMatch(s -> s.name.equals(funcName));
            if (!exists) {
                stubs.add(new StubFunction(
                    funcName, defLine, startLine, endLine, Risk.SUSPICIOUS,
                    "return قيمة فاضية",
                    snippet, suggestWithContext(funcName, code)
                ));
            }
        }

        stubs.sort((a, b) -> a.risk.compareTo(b.risk));
        detectJavaScriptStubs(code, stubs);

        return new StubResult(stubs, totalFunctions);
    }
}

