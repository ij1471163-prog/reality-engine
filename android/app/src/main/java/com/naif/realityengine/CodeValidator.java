package com.naif.realityengine;

import java.util.*;
import java.util.regex.*;

/**
 * CodeValidator v2.0 — Full Upgrade
 * ════════════════════════════════════════════════════════
 * ✅ Multi-language: Python · Java · JavaScript
 * ✅ Security checks: SQL injection · XSS · hardcoded secrets
 * ✅ Smart auto-fix engine
 * ✅ Weighted scoring system (0.0 – 1.0)
 * ✅ Severity levels: ERROR · WARNING · INFO · SECURITY
 * ════════════════════════════════════════════════════════
 */
public class CodeValidator {

    // ═══════════════════════════════════════════════════
    // Enums & Data Classes
    // ═══════════════════════════════════════════════════

    public enum ValidationStatus { VALID, WARNING, INVALID, SECURITY_RISK }

    public enum Language { PYTHON, JAVA, JAVASCRIPT, UNKNOWN }

    public enum IssueSeverity { INFO, WARNING, ERROR, SECURITY }

    public static class Issue {
        public final IssueSeverity severity;
        public final String message;
        public final int line; // -1 = unknown
        public final String fixHint;

        public Issue(IssueSeverity severity, String message, int line, String fixHint) {
            this.severity = severity;
            this.message  = message;
            this.line     = line;
            this.fixHint  = fixHint;
        }

        @Override
        public String toString() {
            String loc = line >= 0 ? " (line " + line + ")" : "";
            return "[" + severity + "]" + loc + " " + message
                + (fixHint != null ? " → " + fixHint : "");
        }
    }

    public static class ValidationResult {
        public ValidationStatus   status    = ValidationStatus.VALID;
        public List<Issue>        issues    = new ArrayList<>();
        public double             score     = 1.0;   // 0.0 – 1.0
        public String             fixedCode = null;
        public Language           language  = Language.UNKNOWN;
        public Map<String,Object> metadata  = new HashMap<>();

        public void addIssue(IssueSeverity sev, String msg, int line, String hint) {
            issues.add(new Issue(sev, msg, line, hint));
        }

        public boolean hasErrors()    { return issues.stream().anyMatch(i -> i.severity == IssueSeverity.ERROR); }
        public boolean hasSecurity()  { return issues.stream().anyMatch(i -> i.severity == IssueSeverity.SECURITY); }

        public String summary() {
            long errors   = issues.stream().filter(i -> i.severity == IssueSeverity.ERROR).count();
            long warnings = issues.stream().filter(i -> i.severity == IssueSeverity.WARNING).count();
            long security = issues.stream().filter(i -> i.severity == IssueSeverity.SECURITY).count();
            return String.format("Score: %.0f%% | Errors: %d | Warnings: %d | Security: %d",
                score * 100, errors, warnings, security);
        }
    }

    // ═══════════════════════════════════════════════════
    // Entry Point
    // ═══════════════════════════════════════════════════

    public static ValidationResult validate(String suggestedCode,
                                            String funcName,
                                            List<String> params,
                                            String fullCode) {
        ValidationResult result = new ValidationResult();
        if (suggestedCode == null || suggestedCode.isBlank()) {
            result.addIssue(IssueSeverity.ERROR, "Empty code submitted", -1, "Provide non-empty code");
            result.status = ValidationStatus.INVALID;
            result.score  = 0.0;
            return result;
        }

        // 1. Detect language
        result.language = detectLanguage(suggestedCode, fullCode);

        // 2. Structural checks
        checkUndefinedVariables(suggestedCode, params, fullCode, result);
        checkBasicSyntax(suggestedCode, result);
        checkTypeConsistency(suggestedCode, params, fullCode, result);
        checkReturnStatement(suggestedCode, funcName, result);
        checkDeadCode(suggestedCode, result);
        checkCodeSmells(suggestedCode, result);

        // 3. Security checks
        checkSqlInjection(suggestedCode, result);
        checkXss(suggestedCode, result);
        checkHardcodedSecrets(suggestedCode, result);
        checkDangerousPatterns(suggestedCode, result);

        // 4. Language-specific checks
        if (result.language == Language.JAVA) {
            checkJavaSpecific(suggestedCode, result);
        } else if (result.language == Language.JAVASCRIPT) {
            checkJsSpecific(suggestedCode, result);
        } else {
            checkPythonSpecific(suggestedCode, result);
        }

        // 5. Finalize score
        result.score = Math.max(0.0, Math.min(1.0, computeScore(result.issues)));

        // 6. Set status
        if (result.hasSecurity()) {
            result.status = ValidationStatus.SECURITY_RISK;
        } else if (result.hasErrors()) {
            result.status = ValidationStatus.INVALID;
        } else if (!result.issues.isEmpty()) {
            result.status = ValidationStatus.WARNING;
        }

        // 7. Try auto-fix
        if (result.status == ValidationStatus.INVALID || result.status == ValidationStatus.WARNING) {
            result.fixedCode = autoFix(suggestedCode, params, result);
        }

        // 8. Metadata
        result.metadata.put("lineCount", suggestedCode.split("\n").length);
        result.metadata.put("language", result.language.name());
        result.metadata.put("issueCount", result.issues.size());

        return result;
    }

    // ═══════════════════════════════════════════════════
    // Language Detection
    // ═══════════════════════════════════════════════════

    static Language detectLanguage(String code, String fullCode) {
        String combined = (code + " " + (fullCode == null ? "" : fullCode)).toLowerCase();
        int javaScore = 0, jsScore = 0, pyScore = 0;

        if (combined.contains("public ") || combined.contains("private ") || combined.contains("System.out"))  javaScore += 3;
        if (combined.contains("import java") || combined.contains("@override"))                                  javaScore += 2;
        if (combined.contains("const ") || combined.contains("let ") || combined.contains("console.log"))        jsScore += 3;
        if (combined.contains("=>") || combined.contains("document.") || combined.contains("async "))            jsScore += 2;
        if (combined.contains("def ") || combined.contains("import ") || combined.contains("print("))            pyScore += 3;
        if (combined.contains("self.") || combined.contains(":") || combined.contains("elif "))                  pyScore += 2;

        int max = Math.max(javaScore, Math.max(jsScore, pyScore));
        if (max == 0)       return Language.UNKNOWN;
        if (javaScore == max) return Language.JAVA;
        if (jsScore   == max) return Language.JAVASCRIPT;
        return Language.PYTHON;
    }

    // ═══════════════════════════════════════════════════
    // 1. Undefined Variables
    // ═══════════════════════════════════════════════════

    private static void checkUndefinedVariables(String code, List<String> params,
                                                 String fullCode, ValidationResult result) {
        Set<String> defined = new HashSet<>(params == null ? Collections.emptyList() : params);
        defined.addAll(ALL_BUILTINS);

        // Collect names defined in fullCode
        if (fullCode != null) {
            Matcher m = Pattern.compile("(?:^|\\s)(\\w+)\\s*(?:=|:)(?!=)", Pattern.MULTILINE).matcher(fullCode);
            while (m.find()) defined.add(m.group(1));
        }

        // Collect names defined inside the snippet itself
        Matcher localM = Pattern.compile("(?:int|float|double|String|var|let|const|def|\\bself\\.)\\s*(\\w+)").matcher(code);
        while (localM.find()) defined.add(localM.group(1));

        // Find used identifiers
        Set<String> used = new HashSet<>();
        Matcher usedM = Pattern.compile("\\b([a-zA-Z_]\\w*)\\b").matcher(code);
        while (usedM.find()) used.add(usedM.group(1));

        for (String v : used) {
            if (v.length() <= 1) continue;
            if (KEYWORDS.contains(v) || defined.contains(v)) continue;
            if (code.contains("\"" + v + "\"") || code.contains("'" + v + "'")) continue;
            result.addIssue(IssueSeverity.WARNING,
                "Variable '" + v + "' may be undefined",
                findLineOf(code, v),
                "Declare or pass '" + v + "' as a parameter");
        }
    }

    // ═══════════════════════════════════════════════════
    // 2. Basic Syntax
    // ═══════════════════════════════════════════════════

    private static void checkBasicSyntax(String code, ValidationResult result) {
        int parens = 0, brackets = 0, braces = 0;
        boolean inStr = false; char strCh = 0;
        for (int i = 0; i < code.length(); i++) {
            char c = code.charAt(i);
            if (inStr) { if (c == strCh && (i == 0 || code.charAt(i-1) != '\\')) inStr = false; continue; }
            if (c == '"' || c == '\'') { inStr = true; strCh = c; continue; }
            switch (c) {
                case '(': parens++; break;   case ')': parens--; break;
                case '[': brackets++; break; case ']': brackets--; break;
                case '{': braces++; break;   case '}': braces--; break;
            }
        }
        if (parens   != 0) result.addIssue(IssueSeverity.ERROR, "Unmatched parentheses (" + parens + ")", -1, "Check ( )");
        if (brackets != 0) result.addIssue(IssueSeverity.ERROR, "Unmatched brackets ("    + brackets + ")", -1, "Check [ ]");
        if (braces   != 0) result.addIssue(IssueSeverity.ERROR, "Unmatched braces ("      + braces + ")",   -1, "Check { }");

        // Mixed indentation
        if (code.contains("\t") && code.contains("    ")) {
            result.addIssue(IssueSeverity.WARNING, "Mixed tabs and spaces", -1, "Use spaces only");
        }
    }

    // ═══════════════════════════════════════════════════
    // 3. Type Consistency
    // ═══════════════════════════════════════════════════

    private static void checkTypeConsistency(String code, List<String> params,
                                              String fullCode, ValidationResult result) {
        if (params == null) return;
        for (String p : params) {
            boolean isList = p.endsWith("s") && p.length() > 3
                || (fullCode != null && (fullCode.contains(p + " = [") || fullCode.contains(p + "=[")));
            if (isList && code.contains(p + ".get(")) {
                result.addIssue(IssueSeverity.WARNING,
                    "'" + p + "' looks like a list but used as dict (.get())",
                    findLineOf(code, p + ".get("),
                    "Use indexing or check type");
            }
        }
        if ((code.contains("== value") || code.contains("= value)")) && (params == null || !params.contains("value"))) {
            result.addIssue(IssueSeverity.ERROR, "'value' is undefined — possible copy-paste error",
                findLineOf(code, "value"), "Replace with correct variable");
        }
        if (code.contains("for x in items") && (params == null || !params.contains("items"))) {
            result.addIssue(IssueSeverity.ERROR, "'items' used but not in params",
                findLineOf(code, "items"), "Pass 'items' as parameter");
        }
    }

    // ═══════════════════════════════════════════════════
    // 4. Return Statement
    // ═══════════════════════════════════════════════════

    private static void checkReturnStatement(String code, String funcName, ValidationResult result) {
        if (funcName == null) return;
        String t = code.trim();
        if (!t.contains("return") && !t.contains("raise") && !t.contains("throw")) {
            result.addIssue(IssueSeverity.WARNING, "No return/throw statement found", -1, "Add return value");
        }
        if (t.equals("return None") || t.equals("pass") || t.equals("return null;")) {
            result.addIssue(IssueSeverity.WARNING, "Stub not implemented", -1, "Implement logic");
        }
        String fn = funcName.toLowerCase();
        if ((fn.contains("calculate") || fn.contains("total") || fn.contains("count") || fn.contains("sum"))
            && (t.contains("return next(") || t.contains("return [x for"))) {
            result.addIssue(IssueSeverity.WARNING, "Numeric function returns non-numeric value", -1, "Return a number");
        }
    }

    // ═══════════════════════════════════════════════════
    // 5. Dead Code
    // ═══════════════════════════════════════════════════

    private static void checkDeadCode(String code, ValidationResult result) {
        String[] lines = code.split("\n");
        boolean afterReturn = false;
        int retLine = -1;
        for (int i = 0; i < lines.length; i++) {
            String t = lines[i].trim();
            if (t.isEmpty() || t.startsWith("//") || t.startsWith("#")) continue;
            if (afterReturn && !t.isEmpty()) {
                result.addIssue(IssueSeverity.WARNING,
                    "Unreachable code after return (line " + (i+1) + ")",
                    i + 1, "Remove dead code");
                break;
            }
            if (t.startsWith("return ") || t.equals("return;") || t.equals("return")) {
                afterReturn = true; retLine = i + 1;
            }
        }
    }

    // ═══════════════════════════════════════════════════
    // 6. Code Smells
    // ═══════════════════════════════════════════════════

    private static void checkCodeSmells(String code, ValidationResult result) {
        // Magic numbers
        Matcher magic = Pattern.compile("(?<![\\w.])(\\d{3,})(?![\\w.])").matcher(code);
        while (magic.find()) {
            String num = magic.group(1);
            if (!num.equals("100") && !num.equals("200") && !num.equals("404") && !num.equals("500")) {
                result.addIssue(IssueSeverity.INFO, "Magic number: " + num,
                    findLineOf(code, num), "Use a named constant");
                break; // report once
            }
        }
        // Empty catch
        if (code.matches("(?s).*catch\\s*\\([^)]*\\)\\s*\\{\\s*\\}.*")) {
            result.addIssue(IssueSeverity.WARNING, "Empty catch block swallows exceptions", -1,
                "Log or handle the exception");
        }
        // TODO comments
        if (code.contains("TODO") || code.contains("FIXME") || code.contains("HACK")) {
            result.addIssue(IssueSeverity.INFO, "Unresolved TODO/FIXME/HACK comment", -1,
                "Resolve before shipping");
        }
        // Very long line
        for (String line : code.split("\n")) {
            if (line.length() > 120) {
                result.addIssue(IssueSeverity.INFO, "Line exceeds 120 characters", -1, "Break into shorter lines");
                break;
            }
        }
    }

    // ═══════════════════════════════════════════════════
    // SECURITY — SQL Injection
    // ═══════════════════════════════════════════════════

    private static void checkSqlInjection(String code, ValidationResult result) {
        // Detect string concatenation inside SQL queries
        Pattern sqlConcat = Pattern.compile(
            "(?i)(query|sql|select|insert|update|delete).*?[\"'].*?\\+\\s*\\w+",
            Pattern.DOTALL);
        if (sqlConcat.matcher(code).find()) {
            result.addIssue(IssueSeverity.SECURITY,
                "Possible SQL injection — string concatenation in query",
                findLineOf(code, "+"),
                "Use parameterized queries / prepared statements");
        }
        // format() / f-string in SQL
        if ((code.contains("f\"SELECT") || code.contains("f'SELECT")
            || code.contains("format(") && code.toLowerCase().contains("select"))
            && !code.contains("paramstyle")) {
            result.addIssue(IssueSeverity.SECURITY,
                "SQL built with f-string or format() — injection risk",
                -1, "Use ? or %s with parameterized execute()");
        }
    }

    // ═══════════════════════════════════════════════════
    // SECURITY — XSS
    // ═══════════════════════════════════════════════════

    private static void checkXss(String code, ValidationResult result) {
        boolean hasInnerHtml = code.contains("innerHTML") || code.contains("document.write(");
        boolean hasUserInput  = code.contains("req.") || code.contains("request.") || code.contains("getParam");
        if (hasInnerHtml && hasUserInput) {
            result.addIssue(IssueSeverity.SECURITY,
                "Potential XSS — user input written to innerHTML/document.write",
                findLineOf(code, "innerHTML"),
                "Sanitize input with DOMPurify or use textContent");
        }
    }

    // ═══════════════════════════════════════════════════
    // SECURITY — Hardcoded Secrets
    // ═══════════════════════════════════════════════════

    private static void checkHardcodedSecrets(String code, ValidationResult result) {
        Pattern secretPat = Pattern.compile(
            "(?i)(password|passwd|secret|api_key|apikey|token|private_key)\\s*=\\s*[\"'][^\"']{4,}[\"']");
        Matcher m = secretPat.matcher(code);
        if (m.find()) {
            result.addIssue(IssueSeverity.SECURITY,
                "Hardcoded secret detected: '" + m.group(1) + "'",
                findLineOf(code, m.group(0)),
                "Use environment variables or a secrets manager");
        }
        // AWS key pattern
        if (Pattern.compile("AKIA[0-9A-Z]{16}").matcher(code).find()) {
            result.addIssue(IssueSeverity.SECURITY, "AWS Access Key ID found in code", -1,
                "Rotate key and use IAM roles / env vars");
        }
    }

    // ═══════════════════════════════════════════════════
    // SECURITY — Dangerous Patterns
    // ═══════════════════════════════════════════════════

    private static void checkDangerousPatterns(String code, ValidationResult result) {
        // eval / exec
        if (code.matches("(?s).*\\beval\\s*\\(.*") || code.matches("(?s).*\\bexec\\s*\\(.*")) {
            result.addIssue(IssueSeverity.SECURITY, "eval()/exec() usage detected",
                findLineOf(code, "eval"), "Avoid eval/exec; use safe alternatives");
        }
        // Shell injection
        if ((code.contains("Runtime.exec(") || code.contains("ProcessBuilder")
            || code.contains("subprocess.") || code.contains("os.system("))
            && (code.contains("+") || code.contains("format") || code.contains("f\""))) {
            result.addIssue(IssueSeverity.SECURITY, "Possible shell injection via user input",
                -1, "Use fixed command arrays, never build from user strings");
        }
        // Path traversal
        if (code.contains("../") || code.contains("..\\")) {
            result.addIssue(IssueSeverity.SECURITY, "Path traversal pattern detected (../)",
                -1, "Validate and canonicalize file paths");
        }
    }

    // ═══════════════════════════════════════════════════
    // Language-Specific: Java
    // ═══════════════════════════════════════════════════

    private static void checkJavaSpecific(String code, ValidationResult result) {
        // == on String
        if (Pattern.compile("\"[^\"]*\"\\s*==|==\\s*\"[^\"]*\"").matcher(code).find()
            || Pattern.compile("\\bString\\b.*\\b==\\b").matcher(code).find()) {
            result.addIssue(IssueSeverity.ERROR, "Use .equals() to compare Strings, not ==",
                -1, "Replace == with .equals()");
        }
        // NullPointerException risk
        if (code.contains(".length()") && !code.contains("!= null") && !code.contains("null ==")) {
            result.addIssue(IssueSeverity.WARNING, "Possible NPE — no null check before .length()",
                -1, "Add null check");
        }
        // Raw types
        if (Pattern.compile("\\bList\\s+\\w+|\\bMap\\s+\\w+|\\bSet\\s+\\w+").matcher(code).find()) {
            result.addIssue(IssueSeverity.WARNING, "Raw generic type used (e.g., List without <T>)",
                -1, "Use parameterized type: List<String>");
        }
        // printStackTrace
        if (code.contains("printStackTrace()")) {
            result.addIssue(IssueSeverity.INFO, "printStackTrace() used — prefer proper logging",
                -1, "Use a logger (SLF4J, Log4j)");
        }
    }

    // ═══════════════════════════════════════════════════
    // Language-Specific: JavaScript
    // ═══════════════════════════════════════════════════

    private static void checkJsSpecific(String code, ValidationResult result) {
        // == instead of ===
        if (Pattern.compile("[^=!]==[^=]").matcher(code).find()) {
            result.addIssue(IssueSeverity.WARNING, "Loose equality (==) — use === for type-safe comparison",
                -1, "Replace == with ===");
        }
        // var usage
        if (code.contains("var ")) {
            result.addIssue(IssueSeverity.INFO, "var is function-scoped; prefer let/const",
                -1, "Replace var with let or const");
        }
        // console.log in production code
        if (code.contains("console.log(") && !code.contains("// debug")) {
            result.addIssue(IssueSeverity.INFO, "console.log() left in code",
                -1, "Remove or guard with debug flag");
        }
        // Promise without catch
        if ((code.contains(".then(") || code.contains("await ")) && !code.contains(".catch(") && !code.contains("try")) {
            result.addIssue(IssueSeverity.WARNING, "Async operation without error handling",
                -1, "Add .catch() or try/catch");
        }
    }

    // ═══════════════════════════════════════════════════
    // Language-Specific: Python
    // ═══════════════════════════════════════════════════

    private static void checkPythonSpecific(String code, ValidationResult result) {
        // Mutable default argument
        if (Pattern.compile("def\\s+\\w+\\s*\\([^)]*=\\s*[\\[{]").matcher(code).find()) {
            result.addIssue(IssueSeverity.ERROR, "Mutable default argument (list/dict) — shared across calls",
                -1, "Use None as default, set inside function body");
        }
        // bare except
        if (code.contains("except:")) {
            result.addIssue(IssueSeverity.WARNING, "Bare except: catches everything including KeyboardInterrupt",
                -1, "Use except Exception as e:");
        }
        // is instead of == for value comparison
        if (Pattern.compile("is\\s+[\"'\\d]").matcher(code).find()) {
            result.addIssue(IssueSeverity.WARNING, "Use == for value comparison, not 'is'",
                -1, "Replace 'is' with ==");
        }
        // Global variable mutation
        if (code.contains("global ")) {
            result.addIssue(IssueSeverity.WARNING, "global variable mutation — avoid side effects",
                -1, "Pass variable as argument or use class state");
        }
    }

    // ═══════════════════════════════════════════════════
    // Smart Auto-Fix Engine
    // ═══════════════════════════════════════════════════

    static String autoFix(String code, List<String> params, ValidationResult result) {
        String fixed = code;
        boolean changed = false;

        // Fix 1: undefined 'value' → first param
        if (code.contains("== value") && params != null && !params.isEmpty()) {
            fixed = fixed.replace("== value", "== " + params.get(0));
            result.addIssue(IssueSeverity.INFO, "AUTO-FIX: replaced 'value' with '" + params.get(0) + "'", -1, null);
            changed = true;
        }

        // Fix 2: undefined 'items' → first list-like param
        if (code.contains("for x in items") && params != null) {
            String listParam = params.stream().filter(p -> p.endsWith("s") || p.endsWith("list")).findFirst()
                .orElse(params.isEmpty() ? null : params.get(0));
            if (listParam != null) {
                fixed = fixed.replace("for x in items", "for x in " + listParam);
                result.addIssue(IssueSeverity.INFO, "AUTO-FIX: replaced 'items' with '" + listParam + "'", -1, null);
                changed = true;
            }
        }

        // Fix 3: Java String == → equals
        if (result.language == Language.JAVA) {
            Matcher m = Pattern.compile("(\\w+)\\s*==\\s*\"([^\"]*)\"").matcher(fixed);
            StringBuffer sb = new StringBuffer();
            while (m.find()) {
                m.appendReplacement(sb, m.group(1) + ".equals(\"" + m.group(2) + "\")");
                result.addIssue(IssueSeverity.INFO, "AUTO-FIX: String == → .equals()", -1, null);
                changed = true;
            }
            m.appendTail(sb);
            fixed = sb.toString();
        }

        // Fix 4: JS == → ===
        if (result.language == Language.JAVASCRIPT) {
            String patched = fixed.replaceAll("([^=!])==([^=])", "$1===$2");
            if (!patched.equals(fixed)) {
                result.addIssue(IssueSeverity.INFO, "AUTO-FIX: == → ===", -1, null);
                fixed = patched; changed = true;
            }
        }

        // Fix 5: Python bare except → except Exception as e
        if (result.language == Language.PYTHON && fixed.contains("except:")) {
            fixed = fixed.replace("except:", "except Exception as e:");
            result.addIssue(IssueSeverity.INFO, "AUTO-FIX: bare except → except Exception as e:", -1, null);
            changed = true;
        }

        return changed ? fixed : null;
    }

    // ═══════════════════════════════════════════════════
    // Scoring
    // ═══════════════════════════════════════════════════

    private static double computeScore(List<Issue> issues) {
        double score = 1.0;
        for (Issue i : issues) {
            switch (i.severity) {
                case SECURITY: score -= 0.35; break;
                case ERROR:    score -= 0.20; break;
                case WARNING:  score -= 0.08; break;
                case INFO:     score -= 0.02; break;
            }
        }
        return score;
    }

    // ═══════════════════════════════════════════════════
    // Utilities
    // ═══════════════════════════════════════════════════

    private static int findLineOf(String code, String target) {
        String[] lines = code.split("\n");
        for (int i = 0; i < lines.length; i++) {
            if (lines[i].contains(target)) return i + 1;
        }
        return -1;
    }

    // ═══════════════════════════════════════════════════
    // Constants
    // ═══════════════════════════════════════════════════

    private static final Set<String> KEYWORDS = new HashSet<>(Arrays.asList(
        "return","for","in","if","else","elif","and","or","not","import","from","as",
        "lambda","pass","raise","try","except","finally","with","yield","class","def",
        "new","this","super","static","public","private","protected","void","int",
        "double","float","boolean","String","var","let","const","function","async",
        "await","switch","case","break","continue","throw","instanceof","typeof",
        "null","None","true","false","True","False","undefined"
    ));

    private static final Set<String> ALL_BUILTINS = new HashSet<>(Arrays.asList(
        "str","int","float","bool","list","dict","set","tuple","bytes","len","sum",
        "max","min","sorted","next","iter","zip","map","filter","enumerate","range",
        "print","type","isinstance","hasattr","getattr","setattr","any","all","abs",
        "round","open","chr","ord","hex","bin","repr","hash","id","input","format",
        "re","os","sys","math","json","hashlib","datetime","collections","self","cls",
        "super","get","append","extend","update","pop","remove","add","clear",
        "keys","values","items","copy","split","strip","lower","upper","replace",
        "join","find","startswith","endswith","count","index","read","write","close",
        "group","match","search","findall","sub","compile","groups","result","data",
        "response","request","req","res","err","error","e","x","i","j","k","v","n","s"
    ));
}
