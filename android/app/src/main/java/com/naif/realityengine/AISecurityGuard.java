package com.naif.realityengine;

import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * AISecurityGuard — حارس أمني قبل تطبيق أي تعديل على ملف حقيقي
 *
 * المعمارية الجديدة:
 *   1. يستقبل الملف الأصلي الكامل + الملف المعدل الكامل
 *   2. يتحقق من سلامة الملف (لم يُحذف كود خارج النطاق)
 *   3. يتحقق من النطاق (scope) — التعديل داخل المنطقة المسموحة فقط
 *   4. يفحص الأمان على الملف المعدل كاملاً
 *   5. يتحقق من صحة النحو الهيكلية
 *   6. يُرجع تقريراً يقرر: SAFE / WARNING / BLOCKED
 *
 * طبقة التوافق (Compatibility Bridge):
 *   inspect(String) و inspectWithContext(...) موجودة تحت لتبقى
 *   ApprovalWorkflow.java و AIAnalysisActivity.java تشتغل بدون أي تعديل عليها.
 */
public class AISecurityGuard {

    public enum GuardVerdict { SAFE, WARNING, BLOCKED }

    public enum Language { JAVA, PYTHON, JAVASCRIPT, KOTLIN, HTML, UNKNOWN }

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
            this.verdict        = verdict;
            this.safetyScore    = safetyScore;
            this.checks         = checks;
            this.canProceed     = verdict != GuardVerdict.BLOCKED;
            this.blockedReason  = blockedReason;
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

    // ═══════════════════════════════════════════════════════════
    // كشف اللغة
    // ═══════════════════════════════════════════════════════════

    public static Language detectLanguage(String code) {
        return detectLanguage(code, null);
    }

    public static Language detectLanguage(String code, String fileName) {
        if (fileName != null && !fileName.isEmpty()) {
            String lower = fileName.toLowerCase();
            if (lower.endsWith(".java")) return Language.JAVA;
            if (lower.endsWith(".py")) return Language.PYTHON;
            if (lower.endsWith(".js") || lower.endsWith(".mjs") || lower.endsWith(".cjs")) return Language.JAVASCRIPT;
            if (lower.endsWith(".kt") || lower.endsWith(".kts")) return Language.KOTLIN;
            if (lower.endsWith(".html") || lower.endsWith(".htm")) return Language.HTML;
        }

        if (code == null || code.trim().isEmpty()) return Language.UNKNOWN;
        String trimmed = code.trim().toLowerCase();

        if (trimmed.startsWith("<!doctype html") || trimmed.contains("<html") || trimmed.contains("<body")) {
            return Language.HTML;
        }
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

    // ═══════════════════════════════════════════════════════════
    // فحوصات النطاق والملف الكامل
    // ═══════════════════════════════════════════════════════════

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
        int lineDiff = modLines.length - origLines.length;

        for (int i = 0; i < startLine && i < origLines.length && i < modLines.length; i++) {
            if (!origLines[i].equals(modLines[i])) {
                return new ScopeValidationResult(false,
                    "تعديل خارج النطاق قبل السطر " + (i + 1));
            }
        }

        for (int i = endLine + 1; i < origLines.length; i++) {
            int modIdx = i + lineDiff;
            if (modIdx < 0 || modIdx >= modLines.length) {
                return new ScopeValidationResult(false,
                    "تعديل خارج النطاق — حذف/إضافة أسطر بعد السطر " + (endLine + 1));
            }
            if (!origLines[i].equals(modLines[modIdx])) {
                return new ScopeValidationResult(false,
                    "تعديل خارج النطاق بعد السطر " + (i + 1));
            }
        }

        return new ScopeValidationResult(true, "النطاق صالح — prefix و suffix ثابتان");
    }

    public static Check validateFileIntegrity(String originalCode, String modifiedCode,
                                               Language lang) {
        if (originalCode == null || modifiedCode == null) {
            return new Check("AI012", "File Integrity", false,
                "أحد الأكواد فارغ", true);
        }

        Set<String> origFunctions = extractFunctionSignatures(originalCode, lang);
        Set<String> modFunctions = extractFunctionSignatures(modifiedCode, lang);

        Set<String> missing = new HashSet<>(origFunctions);
        missing.removeAll(modFunctions);
        if (!missing.isEmpty()) {
            return new Check("AI012", "File Integrity", false,
                "دوال مفقودة في الملف المعدل: " + missing, true);
        }

        return new Check("AI012", "File Integrity", true,
            "لم تُحذف دوال وهيكل الملف محفوظ ✓", false);
    }

    private static Set<String> extractFunctionSignatures(String code, Language lang) {
        Set<String> sigs = new HashSet<>();
        if (code == null) return sigs;
        String[] lines = code.split("\n");

        for (String line : lines) {
            String trimmed = line.trim();
            if (lang == Language.PYTHON) {
                if (trimmed.startsWith("def ") || trimmed.startsWith("async def ")) {
                    int colon = trimmed.indexOf(':');
                    if (colon > 0) {
                        sigs.add(trimmed.substring(0, colon).trim());
                    }
                }
            } else if (lang == Language.JAVA || lang == Language.KOTLIN) {
                if (trimmed.contains("(") && trimmed.contains(")")) {
                    sigs.add(trimmed.replaceAll("\\s+", " "));
                }
            } else if (lang == Language.JAVASCRIPT) {
                if (trimmed.contains("function") || trimmed.contains("=>")) {
                    sigs.add(trimmed.replaceAll("\\s+", " "));
                }
            }
        }
        return sigs;
    }

    // ═══════════════════════════════════════════════════════════
    // فحص النحو الهيكلي
    // ═══════════════════════════════════════════════════════════

    public static boolean structuralSyntaxCheck(String code, Language lang) {
        if (code == null || code.trim().isEmpty()) return false;

        int braces = 0, parens = 0, brackets = 0;
        boolean inString = false;
        boolean inComment = false;
        boolean inBlockComment = false;
        boolean inTripleString = false;
        boolean inTemplateLiteral = false;
        boolean inRegexLiteral = false;
        int templateBraceDepth = 0;
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

            if (lang == Language.JAVASCRIPT && inTemplateLiteral) {
                if (c == '$' && i + 1 < code.length() && code.charAt(i + 1) == '{') {
                    templateBraceDepth++;
                    i++;
                    continue;
                }
                if (templateBraceDepth > 0) {
                    if (c == '{') templateBraceDepth++;
                    else if (c == '}') templateBraceDepth--;
                    continue;
                }
                if (c == '`') inTemplateLiteral = false;
                continue;
            }

            if (lang == Language.JAVASCRIPT && inRegexLiteral) {
                if (c == '\\') { escape = true; continue; }
                if (c == '/') {
                    while (i + 1 < code.length() && "gimsuy".indexOf(code.charAt(i + 1)) >= 0) i++;
                    inRegexLiteral = false;
                }
                continue;
            }

            if (inComment) {
                if (inBlockComment) {
                    if (i > 0 && code.charAt(i - 1) == '*' && c == '/') {
                        inComment = false;
                        inBlockComment = false;
                    }
                } else {
                    if (c == '\n') inComment = false;
                }
                continue;
            }

            if (inTripleString) {
                if (c == stringChar && i + 2 < code.length()
                    && code.charAt(i + 1) == stringChar && code.charAt(i + 2) == stringChar) {
                    inTripleString = false;
                    i += 2;
                }
                continue;
            }

            if (!inString) {
                if (lang == Language.PYTHON && i + 2 < code.length()
                    && (c == '"' || c == '\'')
                    && code.charAt(i + 1) == c && code.charAt(i + 2) == c) {
                    inTripleString = true;
                    stringChar = c;
                    i += 2;
                } else if (lang == Language.JAVASCRIPT && c == '`') {
                    inTemplateLiteral = true;
                } else if (lang == Language.JAVASCRIPT && c == '/') {
                    boolean regexContext = false;
                    for (int j = i - 1; j >= 0; j--) {
                        char prev = code.charAt(j);
                        if (Character.isWhitespace(prev)) continue;
                        if ("=(:,;[{(return+-*/%!&|^~<>?".indexOf(prev) >= 0) regexContext = true;
                        break;
                    }
                    if (regexContext) {
                        inRegexLiteral = true;
                    } else {
                        if (i + 1 < code.length() && code.charAt(i + 1) == '/') {
                            inComment = true;
                            i++;
                        } else if (i + 1 < code.length() && code.charAt(i + 1) == '*') {
                            inComment = true;
                            inBlockComment = true;
                            i++;
                        }
                    }
                    continue;
                } else if (c == '"' || c == '\'') {
                    inString = true;
                    stringChar = c;
                } else if (c == '#') {
                    inComment = true;
                } else if ((lang == Language.JAVA || lang == Language.JAVASCRIPT || lang == Language.KOTLIN)
                        && c == '/' && i + 1 < code.length()) {
                    char next = code.charAt(i + 1);
                    if (next == '/') {
                        inComment = true;
                        i++;
                    } else if (next == '*') {
                        inComment = true;
                        inBlockComment = true;
                        i++;
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

            if (braces < 0 || parens < 0 || brackets < 0) return false;
        }

        if (inString || inTripleString || inTemplateLiteral || inRegexLiteral
            || braces != 0 || parens != 0 || brackets != 0) {
            return false;
        }
        return true;
    }

    public static boolean pythonSyntaxHeuristics(String code) {
        if (code == null) return false;
        String[] lines = code.split("\n");
        int lastIndent = 0;
        boolean expectIndent = false;

        for (String line : lines) {
            String trimmed = line.trim();
            if (trimmed.isEmpty() || trimmed.startsWith("#")) continue;

            int currentIndent = 0;
            for (char c : line.toCharArray()) {
                if (c == ' ') currentIndent++;
                else if (c == '\t') currentIndent += 4;
                else break;
            }

            if (expectIndent) {
                if (currentIndent <= lastIndent && !trimmed.startsWith("def ") && !trimmed.startsWith("class ")) {
                    return false;
                }
                expectIndent = false;
            }

            if ((trimmed.startsWith("def ") || trimmed.startsWith("class ") || trimmed.startsWith("if ")
                || trimmed.startsWith("for ") || trimmed.startsWith("while ") || trimmed.startsWith("try:")
                || trimmed.startsWith("with ") || trimmed.startsWith("elif ") || trimmed.startsWith("else:"))
                && trimmed.endsWith(":")) {
                expectIndent = true;
                lastIndent = currentIndent;
            }
        }
        return true;
    }

    // ═══════════════════════════════════════════════════════════
    // فحص سلامة الدالة المستهدفة
    // ═══════════════════════════════════════════════════════════

    public static Check validateFunctionIntegrity(String originalCode, String modifiedCode,
                                                   String functionName, Language lang) {
        if (functionName == null || functionName.isEmpty()) {
            return new Check("AI011", "Function Integrity", true,
                "لا يوجد اسم دالة للتحقق", false);
        }

        String origSig = extractFunctionSignature(originalCode, functionName, lang);
        String modSig = extractFunctionSignature(modifiedCode, functionName, lang);

        if (origSig == null && modSig == null) {
            return new Check("AI011", "Function Integrity", false,
                "الدالة '" + functionName + "' غير موجودة في الأصل والمعدل", true);
        }
        if (origSig == null) {
            return new Check("AI011", "Function Integrity", false,
                "الدالة '" + functionName + "' غير موجودة في الكود الأصلي", true);
        }
        if (modSig == null) {
            return new Check("AI011", "Function Integrity", false,
                "الدالة '" + functionName + "' حُذفت من الكود المعدل", true);
        }
        if (!origSig.equals(modSig)) {
            return new Check("AI011", "Function Integrity", false,
                "توقيع الدالة '" + functionName + "' تغيّر", true);
        }
        return new Check("AI011", "Function Integrity", true,
            "توقيع الدالة '" + functionName + "' محفوظ ✓", false);
    }

    private static String extractFunctionSignature(String code, String functionName, Language lang) {
        if (code == null) return null;
        String pattern;
        if (lang == Language.PYTHON) {
            pattern = "(def\\s+" + Pattern.quote(functionName) + "\\s*\\([^)]*\\)\\s*(?:->\\s*[^:]*)?:)";
        } else if (lang == Language.JAVA || lang == Language.KOTLIN) {
            pattern = "((?:public|private|protected|static|final|abstract|synchronized|\\s)*\\s*(?:<[^>]+>\\s*)?(?:[\\w<>\\[\\]]+\\s+)?" +
                      Pattern.quote(functionName) + "\\s*\\([^)]*\\)\\s*(?:throws\\s+[\\w,\\s]+)?\\s*\\{?)";
        } else if (lang == Language.JAVASCRIPT) {
            pattern = "((?:function\\s+" + Pattern.quote(functionName) + "|" +
                      Pattern.quote(functionName) + "\\s*=\\s*(?:function|\\([^)]*\\)\\s*=>|async\\s*\\([^)]*\\)\\s*=>))\\s*\\(?[^)]*\\)?\\s*\\{?)";
        } else {
            return null;
        }
        Matcher m = Pattern.compile(pattern, Pattern.CASE_INSENSITIVE).matcher(code);
        if (m.find()) return m.group(1).trim().replaceAll("\\s+", " ");
        return null;
    }

    // ═══════════════════════════════════════════════════════════
    // فحوصات لغوية — تُطبق على الكود المعطى كاملاً
    // ═══════════════════════════════════════════════════════════

    public static List<Check> performLanguageChecks(String code, Language lang) {
        List<Check> checks = new ArrayList<>();

        if (lang == Language.JAVA || lang == Language.KOTLIN) {
            boolean hasReflection = Pattern.compile(
                "(?i)\\b(Class\\.forName|Method\\.invoke|Field\\.set|Constructor\\.newInstance|" +
                "setAccessible|defineClass)\\b"
            ).matcher(code).find();
            checks.add(new Check("AI101", "Java Reflection Abuse",
                !hasReflection,
                hasReflection ? "استخدام Reflection — قد يكون مشروعاً لكنه خطير" : "لا Reflection مشبوه ✓",
                false));

            boolean hasNative = Pattern.compile("(?i)\\b(System\\.loadLibrary|Runtime\\.load|JNI|native\\s+)\\b")
                .matcher(code).find();
            checks.add(new Check("AI102", "Native Code Execution",
                !hasNative,
                hasNative ? "استدعاء كود أصلي (Native) — راجع السياق" : "لا native code ✓",
                false));

            boolean hasSerialization = Pattern.compile(
                "(?i)\\b(ObjectInputStream|readObject|readUnshared)\\b"
            ).matcher(code).find();
            checks.add(new Check("AI103", "Deserialization Risk",
                !hasSerialization,
                hasSerialization ? "Deserialization غير آمن — خطر واضح" : "لا deserialization مشبوه ✓",
                true));

            boolean hasProcessExec = Pattern.compile(
                "(?i)\\b(ProcessBuilder|Runtime\\.getRuntime\\.exec|Runtime\\.exec)\\b"
            ).matcher(code).find();
            checks.add(new Check("AI104", "Process Execution",
                !hasProcessExec,
                hasProcessExec ? "تنفيذ عمليات نظام — خطر واضح" : "لا process execution ✓",
                true));

        } else if (lang == Language.PYTHON) {
            boolean hasDynamicImport = Pattern.compile(
                "(?i)\\b(__import__|importlib|imp\\.import_module)\\b",
                // إضافات للهجمات المتخفية
                "(?i)\\bgetattr\\s*\\([^)]*,\\s*[\'\"](?:system|popen|exec|eval)",
                "(?i)\\bglobals\\s*\\(\\)\\s*\\[",
                "(?i)\\b(?:base64\\.b64decode|base64\\.decode)\\s*\\([^)]+\\)\\s*(?:\\)|,)",
                "(?i)compile\\s*\\([^)]+,\\s*[\'\"]exec[\'\"]"
            ).matcher(code).find();
            checks.add(new Check("AI201", "Dynamic Import",
                !hasDynamicImport,
                hasDynamicImport ? "استيراد ديناميكي — راجع السياق" : "لا dynamic import ✓",
                false));

            boolean hasUnsafeDeserialize = Pattern.compile(
                "(?i)\\b(pickle\\.loads|yaml\\.load\\s*\\(|marshal\\.loads|marshal\\.load)\\b"
            ).matcher(code).find();
            checks.add(new Check("AI202", "Unsafe Deserialization",
                !hasUnsafeDeserialize,
                hasUnsafeDeserialize ? "Deserialization غير آمن — خطر واضح" : "لا deserialization مشبوه ✓",
                true));

            boolean hasCtypes = Pattern.compile("(?i)\\b(ctypes|cffi|ctypes\\.CDLL)\\b")
                .matcher(code).find();
            checks.add(new Check("AI203", "C Interface",
                !hasCtypes,
                hasCtypes ? "واجهة C مباشرة — راجع السياق" : "لا C interface ✓",
                false));

        } else if (lang == Language.JAVASCRIPT) {
            boolean hasFunctionCtor = Pattern.compile(
                "(?i)\\bnew\\s+Function\\s*\\("
            ).matcher(code).find();
            checks.add(new Check("AI301", "Function Constructor",
                !hasFunctionCtor,
                hasFunctionCtor ? "Function constructor — خطر واضح" : "لا Function constructor ✓",
                true));

            boolean hasEval = Pattern.compile(
                "(?i)\\beval\\s*\\("
            ).matcher(code).find();
            checks.add(new Check("AI302", "Eval Usage",
                !hasEval,
                hasEval ? "استخدام eval() — خطر واضح (code injection)" : "لا eval() ✓",
                true));

            boolean hasChildProcess = Pattern.compile(
                "(?i)\\b(child_process|require\\s*\\(\\s*['\"]child_process['\"]\\s*\\)|exec\\s*\\(|execSync|spawn\\s*\\()\\b"
            ).matcher(code).find();
            checks.add(new Check("AI303", "Process Execution (Node)",
                !hasChildProcess,
                hasChildProcess ? "تنفيذ عمليات نظام عبر child_process — خطر واضح" : "لا process execution ✓",
                true));

            boolean hasDangerousDom = Pattern.compile(
                "(?i)\\b(document\\.write\\s*\\(|innerHTML\\s*=|outerHTML\\s*=|dangerouslySetInnerHTML)\\b"
            ).matcher(code).find();
            checks.add(new Check("AI304", "Unsafe DOM Injection",
                !hasDangerousDom,
                hasDangerousDom ? "كتابة مباشرة في DOM (document.write/innerHTML) — خطر XSS محتمل" : "لا DOM injection مشبوه ✓",
                false));

            boolean hasPrototypePollution = Pattern.compile(
                "(?i)(__proto__|prototype\\s*\\[|Object\\.setPrototypeOf)"
            ).matcher(code).find();
            checks.add(new Check("AI305", "Prototype Pollution Pattern",
                !hasPrototypePollution,
                hasPrototypePollution ? "تلاعب مباشر بالـ prototype — راجع السياق" : "لا prototype pollution ✓",
                false));

            boolean hasHardcodedSecret = Pattern.compile(
                "(?i)(api[_-]?key|secret|password|token)\\s*[:=]\\s*['\"][A-Za-z0-9_\\-]{12,}['\"]"
            ).matcher(code).find();
            checks.add(new Check("AI306", "Hardcoded Secret",
                !hasHardcodedSecret,
                hasHardcodedSecret ? "مفتاح/سر مكتوب مباشرة بالكود — خطر تسريب" : "لا secrets مكتوبة مباشرة ✓",
                true));

        } else if (lang == Language.HTML) {
            boolean hasScriptTag = Pattern.compile("(?i)<script\\b").matcher(code).find();
            checks.add(new Check("AI401", "HTML Script Tag",
                !hasScriptTag,
                hasScriptTag ? "يحتوي على <script> — راجع السياق" : "لا <script> ✓",
                false));

            boolean hasInlineEvent = Pattern.compile("(?i)\\s(on\\w+)\\s*=").matcher(code).find();
            checks.add(new Check("AI402", "HTML Inline Event Handler",
                !hasInlineEvent,
                hasInlineEvent ? "inline event handlers — قد يكون XSS" : "لا inline events ✓",
                false));

            boolean hasJsProtocol = Pattern.compile("(?i)javascript\\s*:").matcher(code).find();
            checks.add(new Check("AI403", "JavaScript Protocol",
                !hasJsProtocol,
                hasJsProtocol ? "javascript: protocol — خطر واضح" : "لا javascript: ✓",
                true));

            boolean hasIframe = Pattern.compile("(?i)<iframe\\b").matcher(code).find();
            checks.add(new Check("AI404", "HTML Iframe",
                !hasIframe,
                hasIframe ? "يحتوي على <iframe> — راجع السياق" : "لا <iframe> ✓",
                false));
        }

        return checks;
    }

    // ═══════════════════════════════════════════════════════════
    // Orchestrators — الجديد + طبقة التوافق
    // ═══════════════════════════════════════════════════════════

    /**
     * inspect(String) — التوافق الكامل مع الاستدعاء القديم:
     *   AISecurityGuard.inspect(suggestion)
     * ما فيه original للمقارنة → فحص مباشر على الكود المعطى.
     */
    public static GuardReport inspect(String code) {
        return inspect(code, null);
    }

    public static GuardReport inspect(String code, String fileName) {
        Language lang = detectLanguage(code, fileName);
        List<Check> checks = new ArrayList<>();

        checks.add(new Check("AI001", "Scope Validation", true,
            "لا يوجد original للمقارنة — فحص مباشر على الكود الكامل", false));

        boolean syntaxOk = structuralSyntaxCheck(code, lang);
        checks.add(new Check("AI010", "Structural Syntax", syntaxOk,
            syntaxOk ? "الأقواس والسلاسل متوازنة ✓" : "خطأ هيكلي — أقواس/سلاسل غير متوازنة", true));

        if (lang == Language.PYTHON) {
            boolean pyOk = pythonSyntaxHeuristics(code);
            checks.add(new Check("AI010b", "Python Indentation Heuristic", pyOk,
                pyOk ? "المسافات البادئة متسقة ✓" : "احتمال خطأ indentation بعد سطر ينتهي بـ ':'", false));
        }

        checks.addAll(performLanguageChecks(code, lang));

        return buildReport(checks);
    }

    /**
     * inspectWithContext(...) — bridge توافقي مع النسخة القديمة.
     * يحوّل الاستدعاء لمنطق analyze() الجديد (فحص scope + سلامة ملف).
     * لو ما فيه originalCode/startLine/endLine كافية، يرجع لفحص inspect() المباشر.
     */
    public static GuardReport inspectWithContext(String suggestion, String originalCode,
                                                  int startLine, int endLine) {
        return inspectWithContext(suggestion, originalCode, startLine, endLine, null, null);
    }

    public static GuardReport inspectWithContext(String suggestion, String originalCode,
                                                  int startLine, int endLine, String functionName) {
        return inspectWithContext(suggestion, originalCode, startLine, endLine, functionName, null);
    }

    public static GuardReport inspectWithContext(String suggestion, String originalCode,
                                                  int startLine, int endLine, String functionName,
                                                  String fileName) {
        if (originalCode == null || startLine < 0 || endLine < 0) {
            return inspect(suggestion, fileName);
        }
        return analyze(originalCode, suggestion, fileName, startLine, endLine, functionName);
    }

    /**
     * analyze() — الواجهة الأساسية الجديدة: مقارنة original مقابل modified كاملين.
     */
    public static GuardReport analyze(String originalCode, String modifiedCode,
                                       String fileName, int startLine, int endLine,
                                       String functionName) {

        Language lang = detectLanguage(modifiedCode, fileName);
        List<Check> checks = new ArrayList<>();

        ScopeValidationResult scope = validateScope(originalCode, modifiedCode, startLine, endLine);
        checks.add(new Check("AI001", "Scope Validation", scope.valid, scope.reason, true));

        checks.add(validateFileIntegrity(originalCode, modifiedCode, lang));

        if (functionName != null && !functionName.isEmpty()) {
            checks.add(validateFunctionIntegrity(originalCode, modifiedCode, functionName, lang));
        }

        boolean syntaxOk = structuralSyntaxCheck(modifiedCode, lang);
        checks.add(new Check("AI010", "Structural Syntax", syntaxOk,
            syntaxOk ? "الأقواس والسلاسل متوازنة ✓" : "خطأ هيكلي — أقواس/سلاسل غير متوازنة", true));

        if (lang == Language.PYTHON) {
            boolean pyOk = pythonSyntaxHeuristics(modifiedCode);
            checks.add(new Check("AI010b", "Python Indentation Heuristic", pyOk,
                pyOk ? "المسافات البادئة متسقة ✓" : "احتمال خطأ indentation بعد سطر ينتهي بـ ':'", false));
        }

        checks.addAll(performLanguageChecks(modifiedCode, lang));

        return buildReport(checks);
    }

    private static GuardReport buildReport(List<Check> checks) {
        boolean hasCriticalFailure = false;
        int totalChecks = checks.size();
        int passedChecks = 0;

        for (Check ch : checks) {
            if (ch.passed) {
                passedChecks++;
            } else if (ch.critical) {
                hasCriticalFailure = true;
            }
        }

        int safetyScore = totalChecks == 0 ? 0 : (int) Math.round((passedChecks * 100.0) / totalChecks);

        GuardVerdict verdict;
        String blockedReason = null;

        if (hasCriticalFailure) {
            verdict = GuardVerdict.BLOCKED;
            StringBuilder reasons = new StringBuilder();
            for (Check ch : checks) {
                if (!ch.passed && ch.critical) {
                    if (reasons.length() > 0) reasons.append(" | ");
                    reasons.append(ch.name).append(": ").append(ch.details);
                }
            }
            blockedReason = reasons.toString();
        } else if (safetyScore < 100) {
            verdict = GuardVerdict.WARNING;
        } else {
            verdict = GuardVerdict.SAFE;
        }

        return new GuardReport(verdict, safetyScore, checks, blockedReason);
    }
}

