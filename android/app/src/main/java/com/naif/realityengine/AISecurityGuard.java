package com.naif.realityengine;

import java.util.ArrayList;
import java.util.List;
import java.util.regex.Pattern;
import java.util.regex.Matcher;

public class AISecurityGuard {

    public enum GuardVerdict { SAFE, WARNING, BLOCKED }

    public enum Language { JAVA, PYTHON, JAVASCRIPT, KOTLIN, UNKNOWN }

    public static class Check {
        public String id;
        public String name;
        public boolean passed;
        public String details;
        public boolean critical;

        public Check(String id, String name, boolean passed, String details, boolean critical) {
            this.id       = id;
            this.name     = name;
            this.passed   = passed;
            this.details  = details;
            this.critical = critical;
        }
    }

    public static class GuardReport {
        public GuardVerdict verdict;
        public int safetyScore;
        public List<Check> checks;
        public boolean canProceed;
        public String blockedReason;
        public String recommendation;
        public String disclaimer;

        public GuardReport(GuardVerdict verdict, int safetyScore,
                          List<Check> checks, String blockedReason) {
            this.verdict       = verdict;
            this.safetyScore   = safetyScore;
            this.checks        = checks;
            this.canProceed    = verdict != GuardVerdict.BLOCKED;
            this.blockedReason = blockedReason;
            this.recommendation = verdict == GuardVerdict.BLOCKED
                ? "مرفوض تلقائياً — انتهاك أمني حرج"
                : verdict == GuardVerdict.WARNING
                ? "يحتاج مراجعة دقيقة قبل التطبيق"
                : "اجتاز الفحوصات — مراجعتك إلزامية";
            this.disclaimer = "فحص أمني أولي — ليس ضماناً لسلامة الكود. " +
                "الـ Score يقيس مطابقة القواعد فقط، وقد يمر كود خبيث جديد بدون Pattern معروف.";
        }
    }

    public static class ScopeValidationResult {
        public boolean valid;
        public String reason;

        public ScopeValidationResult(boolean valid, String reason) {
            this.valid = valid;
            this.reason = reason;
        }
    }

    public static class ContextAwareScanner {
        private final String code;
        private final Language lang;

        public ContextAwareScanner(String code, Language lang) {
            this.code = code;
            this.lang = lang;
        }

        // FIXED: now properly handles Python triple-quoted strings
        public boolean isInStringOrComment(int matchStart, int matchEnd) {
            String before = code.substring(0, matchStart);
            boolean inString = false;
            boolean inComment = false;
            boolean inTripleString = false;
            boolean escape = false;
            char stringChar = 0;

            for (int i = 0; i < before.length(); i++) {
                char c = before.charAt(i);

                if (escape) {
                    escape = false;
                    continue;
                }
                if (c == '\\') {
                    escape = true;
                    continue;
                }

                if (inComment) {
                    if (lang == Language.PYTHON && c == '\n') {
                        inComment = false;
                    } else if ((lang == Language.JAVA || lang == Language.JAVASCRIPT || lang == Language.KOTLIN)
                            && i < before.length() - 1 && c == '*' && before.charAt(i + 1) == '/') {
                        inComment = false;
                        i++;
                    } else if ((lang == Language.JAVA || lang == Language.JAVASCRIPT || lang == Language.KOTLIN)
                            && c == '\n') {
                        inComment = false;
                    }
                    continue;
                }

                if (inTripleString) {
                    if (c == stringChar && i + 2 < before.length()
                        && before.charAt(i + 1) == stringChar && before.charAt(i + 2) == stringChar) {
                        inTripleString = false;
                        i += 2;
                    }
                    continue;
                }

                if (!inString) {
                    // Check for triple-quoted strings first
                    if (lang == Language.PYTHON && i + 2 < before.length()
                        && (c == '"' || c == '\'')
                        && before.charAt(i + 1) == c && before.charAt(i + 2) == c) {
                        inTripleString = true;
                        stringChar = c;
                        i += 2;
                    } else if (c == '"' || c == '\'') {
                        inString = true;
                        stringChar = c;
                    } else if (c == '#') {
                        inComment = true;
                    } else if ((lang == Language.JAVA || lang == Language.JAVASCRIPT || lang == Language.KOTLIN)
                            && c == '/' && i + 1 < before.length()) {
                        char next = before.charAt(i + 1);
                        if (next == '/' || next == '*') {
                            inComment = true;
                            i++;
                        }
                    }
                } else {
                    if (c == stringChar) {
                        inString = false;
                    }
                }
            }
            return inString || inComment || inTripleString;
        }

        public boolean hasSuspiciousKeywordContextAware() {
            String[] suspicious = {"payload", "shellcode", "exploit", "inject", "bypass",
                                  "backdoor", "trojan", "rat", "c2", "rootkit", "keylogger"};
            String lower = code.toLowerCase();
            for (String kw : suspicious) {
                Pattern p = Pattern.compile("\\b" + kw + "\\b");
                Matcher m = p.matcher(lower);
                while (m.find()) {
                    if (!isInStringOrComment(m.start(), m.end())) {
                        return true;
                    }
                }
            }
            return false;
        }
    }

    // FIXED: better JS detection, var alone is not enough for Kotlin
    public static Language detectLanguage(String code) {
        if (code == null || code.trim().isEmpty()) return Language.UNKNOWN;
        String trimmed = code.trim().toLowerCase();

        if (trimmed.startsWith("import ") && !trimmed.contains(";")) {
            return Language.PYTHON;
        }
        if (trimmed.contains("def ") && trimmed.contains(":") && !trimmed.contains("{")) {
            return Language.PYTHON;
        }
        if (trimmed.contains("print(") || trimmed.contains("if __name__ ==")
            || trimmed.contains("except ") || trimmed.contains("elif ")) {
            return Language.PYTHON;
        }

        if (trimmed.contains("public class") || trimmed.contains("private class")
            || trimmed.contains("system.out.println") || trimmed.contains("@override")
            || trimmed.contains("extends ") || trimmed.contains("implements ")
            || trimmed.contains("package ")) {
            return Language.JAVA;
        }

        if ((trimmed.contains("const ") || trimmed.contains("let ") || trimmed.contains("var "))
            && (trimmed.contains("document.") || trimmed.contains("window.") || trimmed.contains("console.")
                || trimmed.contains("=>") || trimmed.contains("function "))) {
            return Language.JAVASCRIPT;
        }
        if (trimmed.contains("function ") && (trimmed.contains("=>") || trimmed.contains("document.getelement"))) {
            return Language.JAVASCRIPT;
        }

        if (trimmed.contains("fun ") || trimmed.contains("val ")
            || (trimmed.contains("var ") && trimmed.contains(":"))
            || trimmed.contains("companion object")
            || trimmed.contains("data class")) {
            return Language.KOTLIN;
        }

        return Language.UNKNOWN;
    }

    // FIXED: compares tail from end backwards instead of line-by-line
    public static ScopeValidationResult validateScope(String originalCode, String modifiedCode,
                                                      int startLine, int endLine) {
        if (originalCode == null || modifiedCode == null) {
            return new ScopeValidationResult(false, "أحد الأكواد فارغ");
        }
        if (startLine < 0 || endLine < 0 || startLine > endLine) {
            return new ScopeValidationResult(false, "نطاق غير صالح");
        }

        String[] origLines = originalCode.split("\n", -1);
        String[] modLines = modifiedCode.split("\n", -1);

        // Check lines before scope (must be identical)
        for (int i = 0; i < startLine; i++) {
            String origLine = i < origLines.length ? origLines[i] : null;
            String modLine = i < modLines.length ? modLines[i] : null;
            if (origLine == null && modLine == null) continue;
            if (origLine == null || modLine == null || !origLine.equals(modLine)) {
                return new ScopeValidationResult(false,
                    "تعديل خارج النطاق المسموح به قبل السطر " + (i + 1));
            }
        }

        // Check lines after scope (must be identical) — walk from end backwards
        int origBack = origLines.length - 1;
        int modBack = modLines.length - 1;
        int linesAfterScope = origLines.length - (endLine + 1);

        for (int i = 0; i < linesAfterScope; i++) {
            if (origBack < 0 || modBack < 0) break;
            if (!origLines[origBack].equals(modLines[modBack])) {
                return new ScopeValidationResult(false,
                    "تعديل خارج النطاق المسموح به بعد السطر " + (endLine + 1));
            }
            origBack--;
            modBack--;
        }

        return new ScopeValidationResult(true, "النطاق صالح");
    }

    public static boolean structuralSyntaxCheck(String code, Language lang) {
        if (code == null || code.trim().isEmpty()) return false;

        int braces = 0, parens = 0, brackets = 0;
        boolean inString = false;
        char stringChar = 0;
        boolean escape = false;

        for (int i = 0; i < code.length(); i++) {
            char c = code.charAt(i);

            if (escape) {
                escape = false;
                continue;
            }
            if (c == '\\') {
                escape = true;
                continue;
            }

            if (!inString) {
                if (c == '"' || c == '\'') {
                    inString = true;
                    stringChar = c;
                    if (lang == Language.PYTHON && i + 2 < code.length()
                        && code.charAt(i + 1) == c && code.charAt(i + 2) == c) {
                        i += 2;
                    }
                } else if (c == '{') braces++;
                else if (c == '}') braces--;
                else if (c == '(') parens++;
                else if (c == ')') parens--;
                else if (c == '[') brackets++;
                else if (c == ']') brackets--;
            } else {
                if (lang == Language.PYTHON && c == stringChar && i + 2 < code.length()
                    && code.charAt(i + 1) == stringChar && code.charAt(i + 2) == stringChar) {
                    inString = false;
                    i += 2;
                } else if (c == stringChar) {
                    inString = false;
                }
            }

            if (braces < 0 || parens < 0 || brackets < 0) {
                return false;
            }
        }

        if (inString || braces != 0 || parens != 0 || brackets != 0) {
            return false;
        }

        if (lang == Language.JAVA || lang == Language.KOTLIN) {
            boolean hasStructure = code.contains("class") || code.contains("interface")
                || code.contains("enum") || code.contains("void ") || code.contains("public ")
                || code.contains("private ") || code.contains("protected ");
            if (!hasStructure && code.split("\n").length > 3) {
                return false;
            }
        }

        return true;
    }

    public static List<Check> performLanguageChecks(String suggestion, Language lang) {
        List<Check> checks = new ArrayList<>();

        if (lang == Language.JAVA || lang == Language.KOTLIN) {
            boolean hasReflection = Pattern.compile(
                "(?i)\\b(Class\\.forName|Method\\.invoke|Field\\.set|Constructor\\.newInstance|" +
                "setAccessible|defineClass)\\b"
            ).matcher(suggestion).find();
            checks.add(new Check("AI101", "Java Reflection Abuse",
                !hasReflection,
                hasReflection ? "استخدام Reflection — قد يكون مشروعاً لكنه خطير" : "لا Reflection مشبوه ✓",
                false));

            boolean hasNative = Pattern.compile("(?i)\\b(System\\.loadLibrary|Runtime\\.load|JNI|native\\s+)\\b")
                .matcher(suggestion).find();
            checks.add(new Check("AI102", "Native Code Execution",
                !hasNative,
                hasNative ? "استدعاء كود أصلي (Native) — راجع السياق" : "لا native code ✓",
                false));

            boolean hasSerialization = Pattern.compile(
                "(?i)\\b(ObjectInputStream|readObject|readUnshared)\\b"
            ).matcher(suggestion).find();
            checks.add(new Check("AI103", "Deserialization Risk",
                !hasSerialization,
                hasSerialization ? "Deserialization غير آمن — خطر واضح" : "لا deserialization مشبوه ✓",
                true));

            boolean hasProcessExec = Pattern.compile(
                "(?i)\\b(ProcessBuilder|Runtime\\.getRuntime\\.exec|Runtime\\.exec)\\b"
            ).matcher(suggestion).find();
            checks.add(new Check("AI104", "Process Execution",
                !hasProcessExec,
                hasProcessExec ? "تنفيذ عمليات نظام — خطر واضح" : "لا process execution ✓",
                true));

        } else if (lang == Language.PYTHON) {
            boolean hasDynamicImport = Pattern.compile(
                "(?i)\\b(__import__|importlib|imp\\.import_module)\\b"
            ).matcher(suggestion).find();
            checks.add(new Check("AI201", "Dynamic Import",
                !hasDynamicImport,
                hasDynamicImport ? "استيراد ديناميكي — راجع السياق" : "لا dynamic import ✓",
                false));

            boolean hasUnsafeDeserialize = Pattern.compile(
                "(?i)\\b(pickle\\.loads|yaml\\.load\\s*\\(|marshal\\.loads|marshal\\.load)\\b"
            ).matcher(suggestion).find();
            checks.add(new Check("AI202", "Unsafe Deserialization",
                !hasUnsafeDeserialize,
                hasUnsafeDeserialize ? "Deserialization غير آمن — خطر واضح" : "لا deserialization مشبوه ✓",
                true));

            boolean hasCtypes = Pattern.compile("(?i)\\b(ctypes|cffi|ctypes\\.CDLL)\\b")
                .matcher(suggestion).find();
            checks.add(new Check("AI203", "C Interface",
                !hasCtypes,
                hasCtypes ? "واجهة C مباشرة — راجع السياق" : "لا C interface ✓",
                false));

        } else if (lang == Language.JAVASCRIPT) {
            boolean hasFunctionCtor = Pattern.compile(
                "(?i)\\bnew\\s+Function\\s*\\("
            ).matcher(suggestion).find();
            checks.add(new Check("AI301", "Function Constructor",
                !hasFunctionCtor,
                hasFunctionCtor ? "Function constructor — خطر واضح" : "لا Function constructor ✓",
                true));

            boolean hasTimedEval = Pattern.compile(
                "(?i)\\b(setTimeout|setInterval)\\s*\\(\\s*['\"]"
            ).matcher(suggestion).find();
            checks.add(new Check("AI302", "Timed Code Execution",
                !hasTimedEval,
                hasTimedEval ? "setTimeout/setInterval بنص — خطر واضح" : "لا timed eval ✓",
                true));

            boolean hasDomInjection = Pattern.compile(
                "(?i)\\b(innerHTML|outerHTML|document\\.write|document\\.writeln)\\s*="
            ).matcher(suggestion).find();
            checks.add(new Check("AI303", "DOM Injection",
                !hasDomInjection,
                hasDomInjection ? "DOM injection ممكن — راجع السياق" : "لا DOM injection ✓",
                false));

            boolean hasWasm = Pattern.compile("(?i)\\b(WebAssembly|wasm|Wasm)\\b")
                .matcher(suggestion).find();
            checks.add(new Check("AI304", "WebAssembly",
                !hasWasm,
                hasWasm ? "استخدام WebAssembly — راجع السياق" : "لا WebAssembly ✓",
                false));
        }

        return checks;
    }

    public static List<Check> performCoreChecks(String suggestion, Language lang) {
        List<Check> checks = new ArrayList<>();
        ContextAwareScanner scanner = new ContextAwareScanner(suggestion, lang);

        String[] lines = suggestion.split("\n");
        int nonEmpty = 0;
        int totalLen = 0;
        for (String l : lines) {
            if (!l.trim().isEmpty()) { nonEmpty++; totalLen += l.length(); }
        }
        double avgLen = nonEmpty > 0 ? (double) totalLen / nonEmpty : 0;
        checks.add(new Check("AI001", "Code Readability",
            avgLen < 200,
            avgLen < 200 ? "مقروء ✓" : "سطور طويلة مشبوهة",
            false));

        boolean hasSuspicious = scanner.hasSuspiciousKeywordContextAware();
        checks.add(new Check("AI002", "Variable Names Safety",
            !hasSuspicious,
            hasSuspicious ? "أسماء متغيرات مشبوهة (خارج النصوص/التعليقات)" : "أسماء آمنة ✓",
            true));

        int shellCount = countMatches(suggestion, "(?i)(?:os\\.system|subprocess\\.call|subprocess\\.Popen|" +
            "subprocess\\.run|shell=True|Runtime\\.getRuntime\\.exec|ProcessBuilder|" +
            "child_process|execSync|spawnSync)");
        checks.add(new Check("AI003", "Shell Execution",
            shellCount == 0,
            shellCount > 0 ? shellCount + " استدعاء shell" : "لا shell ✓",
            false));

        boolean hasTry = false;
        if (lang == Language.PYTHON) {
            hasTry = suggestion.contains("try:") && suggestion.contains("except");
        } else if (lang == Language.JAVA || lang == Language.KOTLIN) {
            hasTry = (suggestion.contains("try {") || suggestion.contains("try{") || suggestion.contains("try\n"))
                && (suggestion.contains("catch") || suggestion.contains("finally"));
        } else if (lang == Language.JAVASCRIPT) {
            hasTry = (suggestion.contains("try {") || suggestion.contains("try{") || suggestion.contains("try\n"))
                && suggestion.contains("catch");
        }
        boolean shortSnippet = lines.length <= 5;
        checks.add(new Check("AI004", "Error Handling",
            hasTry || shortSnippet,
            hasTry ? "يحتوي try/catch ✓" : (shortSnippet ? "مقتطع قصير — مسموح" : "لا error handling"),
            false));

        boolean hasCreds = Pattern.compile(
            "(?i)(?:password|secret|api_key|apikey|api_secret|auth_token|access_token|" +
            "private_key|secret_key|client_secret|bearer_token)\\s*=\\s*['\"][^'\"]{3,}['\"]"
        ).matcher(suggestion).find();
        checks.add(new Check("AI005", "No Hardcoded Credentials",
            !hasCreds,
            hasCreds ? "credentials مكشوفة!" : "لا credentials ✓",
            true));

        int evalCount = countMatches(suggestion, "(?i)\\b(?:eval|exec|compile)\\s*\\(");
        checks.add(new Check("AI006", "No Dynamic Execution",
            evalCount == 0,
            evalCount > 0 ? evalCount + " استخدام eval/exec" : "لا eval/exec ✓",
            true));

        int netCount = countMatches(suggestion, "(?i)(?:requests\\.|urllib\\.|socket\\.|http\\.|https\\.|fetch\\(|" +
            "XMLHttpRequest|WebSocket|axios\\.|\\.get\\(|\\.post\\()");
        checks.add(new Check("AI007", "Network Usage",
            netCount <= 2,
            netCount > 0 ? netCount + " استدعاء شبكي" : "لا اتصالات شبكية ✓",
            false));

        int fileCount = countMatches(suggestion, "(?i)(?:open\\s*\\(|File\\(|FileInputStream|FileOutputStream|" +
            "FileReader|FileWriter|Files\\.|fs\\.|path\\.|\\.readFile|\\.writeFile)");
        checks.add(new Check("AI008", "File System Access",
            fileCount <= 1,
            fileCount > 0 ? fileCount + " وصول ملفات" : "لا وصول ملفات ✓",
            false));

        boolean hasObfuscation = Pattern.compile(
            "(?i)(?:base64|hex|rot13|chr\\(|ord\\(|fromCharCode|decode|encode)\\s*\\("
        ).matcher(suggestion).find();
        checks.add(new Check("AI009", "Obfuscation Patterns",
            !hasObfuscation,
            hasObfuscation ? "أنماط تعمية/فك تشفير — قد تكون مشروعة" : "لا تعمية مشبوهة ✓",
            false));

        boolean hasInjection = Pattern.compile(
            "(?i)(?:SELECT\\s+.*FROM|INSERT\\s+INTO|DELETE\\s+FROM|DROP\\s+TABLE|UNION\\s+SELECT|" +
            "\\+\\s*['\"]|\\.format\\s*\\(|%\\s*\\(|f['\"].*\\{.*\\})"
        ).matcher(suggestion).find();
        checks.add(new Check("AI010", "Injection Patterns",
            !hasInjection,
            hasInjection ? "أنماط حقن محتملة — خطر واضح" : "لا أنماط حقن ✓",
            true));

        return checks;
    }

    public static GuardReport inspect(String suggestion) {
        return inspectWithContext(suggestion, null, -1, -1);
    }

    public static GuardReport inspectWithContext(String suggestion, String originalCode,
                                                  int startLine, int endLine) {
        List<Check> checks = new ArrayList<>();
        Language lang = detectLanguage(suggestion);

        boolean syntaxValid = structuralSyntaxCheck(suggestion, lang);
        checks.add(new Check("AI000", "Structural Syntax Check",
            syntaxValid,
            syntaxValid ? "الهيكل متوازن ✓" : "خطأ في التوازن الهيكلي — كود غير صالح",
            true));

        if (originalCode != null && startLine >= 0 && endLine >= 0) {
            ScopeValidationResult scopeResult = validateScope(originalCode, suggestion, startLine, endLine);
            checks.add(new Check("AI000-SCOPE", "Scope Validation",
                scopeResult.valid,
                scopeResult.valid ? "النطاق صالح ✓" : scopeResult.reason,
                true));
        }

        checks.addAll(performCoreChecks(suggestion, lang));
        checks.addAll(performLanguageChecks(suggestion, lang));

        int deductions = 0;
        String blockedReason = null;
        for (Check c : checks) {
            if (!c.passed) {
                deductions += c.critical ? 30 : 10;
                if (c.critical && blockedReason == null)
                    blockedReason = c.name + ": " + c.details;
            }
        }
        int score = Math.max(0, 100 - deductions);

        boolean failedCritical = checks.stream().anyMatch(c -> !c.passed && c.critical);
        GuardVerdict verdict = failedCritical ? GuardVerdict.BLOCKED
                             : score < 70      ? GuardVerdict.WARNING
                             : GuardVerdict.SAFE;

        if (verdict == GuardVerdict.SAFE && checks.stream().anyMatch(c -> !c.passed)) {
            verdict = GuardVerdict.WARNING;
        }

        return new GuardReport(verdict, score, checks, blockedReason);
    }

    private static int countMatches(String text, String regex) {
        if (text == null || text.isEmpty()) return 0;
        Pattern p = Pattern.compile(regex);
        java.util.regex.Matcher m = p.matcher(text);
        int count = 0;
        while (m.find()) count++;
        return count;
    }
}

