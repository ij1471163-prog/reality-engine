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
        public Risk risk;
        public String reason;
        public String snippet;
        public String suggestion;

        public StubFunction(String name, int line, Risk risk,
                           String reason, String snippet, String suggestion) {
            this.name       = name;
            this.line       = line;
            this.risk       = risk;
            this.reason     = reason;
            this.snippet    = snippet;
            this.suggestion = suggestion;
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

    // تحليل context الكود لاقتراح أفضل
    public static String suggestWithContext(String name, String fullCode) {
        String n = name.toLowerCase();

        boolean hasRe = fullCode.contains("import re");
        boolean hasHashlib = fullCode.contains("import hashlib");
        boolean hasOs = fullCode.contains("import os");

        java.util.regex.Pattern paramPat = java.util.regex.Pattern.compile("def " + name + "\\(([^)]*)\\)");
        java.util.regex.Matcher paramMat = paramPat.matcher(fullCode);
        String params = "";
        if (paramMat.find()) params = paramMat.group(1);

        String firstParam = params.contains(",") ? params.split(",")[0].trim() : params.trim();
        if (firstParam.contains(":")) firstParam = firstParam.split(":")[0].trim();
        if (firstParam.equals("self") || firstParam.equals("cls") || firstParam.isEmpty())
            firstParam = params.contains(",") ? params.split(",")[1].trim() : "value";

        if (n.contains("email") && (n.startsWith("is_") || n.startsWith("validate_") || n.startsWith("check_"))) {
            return "import re\n    p = r\"[\\w._%+-]+@[\\w.-]+\\.[a-zA-Z]{2,}\"\n    return bool(re.match(p, str(" + firstParam + ")))";
        }
        if (n.contains("hash") || (n.contains("password") && n.contains("hash"))) {
            return "import hashlib\n    return hashlib.sha256(str(" + firstParam + ").encode()).hexdigest()";
        }
        if (n.contains("password") && (n.startsWith("is_") || n.startsWith("check_") || n.startsWith("validate_"))) {
            return "p = str(" + firstParam + ")\n    return len(p) >= 8 and p != p.lower() and any(c.isdigit() for c in p)";
        }
        if (n.startsWith("is_") || n.startsWith("has_") || n.startsWith("can_") || n.startsWith("validate_") || n.startsWith("check_")) {
            return "return bool(" + firstParam + ") if " + firstParam + " is not None else False";
        }
        if (n.contains("palindrome")) {
            return "s = str(" + firstParam + ").lower().replace(\" \", \"\")\n    return s == s[::-1]";
        }
        if (n.contains("calculate") || n.contains("sum") || n.contains("total")) {
            return "return sum(" + firstParam + ") if " + firstParam + " else 0";
        }
        if (n.contains("average") || n.contains("avg") || n.contains("mean")) {
            return "return sum(" + firstParam + ") / len(" + firstParam + ") if " + firstParam + " else 0";
        }
        if (n.contains("sort")) {
            return "return sorted(" + firstParam + ")";
        }
        if (n.contains("unique") || n.contains("distinct")) {
            return "return list(dict.fromkeys(" + firstParam + "))";
        }
        if (n.contains("read") || n.contains("load")) {
            return "import os\n    if not os.path.exists(" + firstParam + "): return None\n    with open(" + firstParam + ") as f:\n        return f.read()";
        }
        if (n.contains("write") || n.contains("save")) {
            String dataParam = params.contains(",") ? params.split(",")[1].trim() : "data";
            if (dataParam.contains(":")) dataParam = dataParam.split(":")[0].trim();
            return "with open(" + firstParam + ", \"w\") as f:\n        f.write(str(" + dataParam + "))\n    return True";
        }
        if (n.contains("find") || n.contains("search") || n.contains("get")) {
            return "return next((x for x in " + firstParam + "s if x == " + firstParam + "), None)";
        }
        if (n.contains("json") || n.contains("parse")) {
            return "import json\n    try:\n        return json.loads(str(" + firstParam + "))\n    except Exception:\n        return None";
        }
        if (n.contains("log")) {
            return "print(str(" + firstParam + "))\n    return True";
        }
        if (n.contains("send") || n.contains("email")) {
            return "return {\"status\": \"pending\", \"to\": str(" + firstParam + ")}";
        }

        return "raise NotImplementedError(\"" + name + " not implemented\")";
    }


    private static String suggest(String name) {
        String n = name.toLowerCase();
        if (n.matches("^(is_|has_|can_|validate_|check_|verify_).*"))
            return "return bool(value)  # أضف منطق التحقق";
        if (n.contains("calculate") || n.contains("sum") || n.contains("total"))
            return "return sum(items)  # أضف منطق الحساب";
        if (n.contains("read") || n.contains("load"))
            return "with open(filepath, 'r') as f:\n        return f.read()";
        if (n.contains("write") || n.contains("save"))
            return "with open(filepath, 'w') as f:\n        f.write(data)";
        if (n.contains("send") || n.contains("email"))
            return "# أضف كود الإرسال هنا";
        if (n.contains("hash") || n.contains("encrypt"))
            return "import hashlib\n    return hashlib.sha256(data.encode()).hexdigest()";
        if (n.contains("log") || n.contains("debug"))
            return "print(f'[LOG] {message}')";
        if (n.contains("find") || n.contains("search"))
            return "return [x for x in items if query in str(x)]";
        if (n.contains("delete") || n.contains("remove"))
            return "return [x for x in items if x != target]";
        return "raise NotImplementedError('" + name + " not implemented')";
    }

    private static void detectJavaScriptStubs(String code, List<StubFunction> stubs) {
        // function name() { } or () => { }
        Pattern jsFunc = Pattern.compile(
            "(?:function\\s+(\\w+)\\s*\\([^)]*\\)\\s*\\{\\s*\\}|" +
            "(?:const|let|var)\\s+(\\w+)\\s*=\\s*(?:function\\s*\\([^)]*\\)|[^=]+=>)\\s*\\{\\s*\\})",
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
                    name, lineNo, Risk.CONFIRMED,
                    "دالة JS فارغة",
                    jsMatcher.group().substring(0, Math.min(80, jsMatcher.group().length())),
                    "// أضف كود الدالة هنا"
                ));
            }
        }
    }

    public static StubResult detect(String code) {
        List<StubFunction> stubs = new ArrayList<>();
        String[] lines = code.split("\n");
        int totalFunctions = 0;

        // Count total functions
        Pattern funcPattern = Pattern.compile("^\\s*(?:async\\s+)?def\\s+(\\w+)\\s*\\(", Pattern.MULTILINE);
        Matcher funcMatcher = funcPattern.matcher(code);
        while (funcMatcher.find()) totalFunctions++;

        // Detect confirmed stubs: pass / ... / NotImplementedError
        Pattern[] confirmed = {
            Pattern.compile("^(\\s*)def\\s+(\\w+)\\s*\\([^)]*\\).*:\\s*\\n\\1    pass\\s*$", Pattern.MULTILINE),
            Pattern.compile("^(\\s*)def\\s+(\\w+)\\s*\\([^)]*\\).*:\\s*\\n\\1    \\.\\.\\.\\s*$", Pattern.MULTILINE),
            Pattern.compile("^(\\s*)def\\s+(\\w+)\\s*\\([^)]*\\).*:\\s*\\n\\1    raise\\s+NotImplementedError", Pattern.MULTILINE),
        };

        for (Pattern p : confirmed) {
            Matcher m = p.matcher(code);
            while (m.find()) {
                String funcName = m.group(2);
                String before   = code.substring(0, m.start());
                int lineNo      = before.split("\n", -1).length;
                String snippet  = lines[lineNo - 1].trim();

                boolean exists = stubs.stream().anyMatch(s -> s.name.equals(funcName));
                if (!exists) {
                    stubs.add(new StubFunction(
                        funcName, lineNo, Risk.CONFIRMED,
                        "pass / ... / NotImplementedError",
                        snippet, suggest(funcName)
                    ));
                }
            }
        }

        // Detect suspicious stubs: return 0/[]/{}
        Pattern suspicious = Pattern.compile(
            "^(\\s*)def\\s+(\\w+)\\s*\\([^)]*\\).*:\\s*\\n(?:\\1    \"\"\"[^\"]*\"\"\"\\s*\\n)?\\1    return\\s+(?:0|0\\.0|\\[\\]|\\{\\}|None|False|\"\")\\s*$",
            Pattern.MULTILINE
        );
        Matcher sm = suspicious.matcher(code);
        while (sm.find()) {
            String funcName = sm.group(2);
            String before   = code.substring(0, sm.start());
            int lineNo      = before.split("\n", -1).length;
            String snippet  = lines[lineNo - 1].trim();

            boolean exists = stubs.stream().anyMatch(s -> s.name.equals(funcName));
            if (!exists) {
                stubs.add(new StubFunction(
                    funcName, lineNo, Risk.SUSPICIOUS,
                    "return قيمة فاضية",
                    snippet, suggest(funcName)
                ));
            }
        }

        // Sort: CONFIRMED first
        stubs.sort((a, b) -> a.risk.compareTo(b.risk));

        // JavaScript detection
        detectJavaScriptStubs(code, stubs);

        return new StubResult(stubs, totalFunctions);
    }
}
