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

        return new StubResult(stubs, totalFunctions);
    }
}
