package com.naif.realityengine;

import java.util.*;
import java.util.regex.*;

/**
 * CodeValidator — يتحقق من صحة الكود المقترح قبل عرضه
 * يفحص:
 * 1. المتغيرات معرّفة
 * 2. النوع منطقي
 * 3. لا يوجد undefined variables
 * 4. الكود لا يكسر بقية المشروع
 */
public class CodeValidator {

    public enum ValidationStatus { VALID, INVALID, WARNING }

    public static class ValidationResult {
        public ValidationStatus status;
        public List<String> issues = new ArrayList<>();
        public double score = 1.0; // 0.0 - 1.0
        public String fixedCode = null; // لو أمكن الإصلاح التلقائي

        public ValidationResult(ValidationStatus s) { this.status = s; }
    }

    // ═══════════════════════════════════════════════════
    // التحقق الرئيسي
    // ═══════════════════════════════════════════════════

    public static ValidationResult validate(String suggestedCode, String funcName,
                                             List<String> params, String fullCode) {
        ValidationResult result = new ValidationResult(ValidationStatus.VALID);

        // 1. تحقق من المتغيرات المستخدمة
        checkUndefinedVariables(suggestedCode, params, fullCode, result);

        // 2. تحقق من syntax بسيط
        checkBasicSyntax(suggestedCode, result);

        // 3. تحقق من type consistency
        checkTypeConsistency(suggestedCode, params, fullCode, result);

        // 4. تحقق من return statement
        checkReturnStatement(suggestedCode, funcName, result);

        // 5. حدد الـ status
        if (result.issues.stream().anyMatch(i -> i.startsWith("ERROR"))) {
            result.status = ValidationStatus.INVALID;
            result.score = 0.0;
        } else if (!result.issues.isEmpty()) {
            result.status = ValidationStatus.WARNING;
            result.score = 0.6;
        }

        // 6. حاول إصلاح تلقائي
        if (result.status == ValidationStatus.INVALID) {
            result.fixedCode = tryAutoFix(suggestedCode, params, result);
        }

        return result;
    }

    // ═══════════════════════════════════════════════════
    // 1. تحقق من المتغيرات
    // ═══════════════════════════════════════════════════

    private static void checkUndefinedVariables(String code, List<String> params,
                                                  String fullCode, ValidationResult result) {
        // استخرج المتغيرات المستخدمة في الكود
        Set<String> usedVars = new HashSet<>();
        Matcher m = Pattern.compile("\\b([a-z_][a-z_0-9]*)\\b").matcher(code);
        while (m.find()) usedVars.add(m.group(1));

        // المتغيرات المعرّفة
        Set<String> definedVars = new HashSet<>(params);
        // Python builtins
        definedVars.addAll(Arrays.asList(
            "None","True","False","self","cls",
            "str","int","float","bool","list","dict","set","tuple",
            "len","sum","max","min","sorted","next","iter","zip","map",
            "filter","enumerate","range","print","type","isinstance",
            "hasattr","getattr","setattr","any","all","abs","round",
            "return","for","in","if","else","elif","and","or","not",
            "import","from","as","lambda","x","key","re","hashlib","math"
        ));

        // استخرج المتغيرات المعرّفة في الكود الكامل
        Matcher assignMatcher = Pattern.compile("^(\\w+)\\s*=", Pattern.MULTILINE).matcher(fullCode);
        while (assignMatcher.find()) definedVars.add(assignMatcher.group(1));

        // افحص المتغيرات المستخدمة
        Set<String> keywords = new HashSet<>(Arrays.asList(
            "return","for","in","if","else","elif","and","or","not",
            "import","from","as","lambda","pass","raise","try","except"
        ));

        for (String var : usedVars) {
            if (keywords.contains(var)) continue;
            if (var.length() <= 1) continue; // single chars ok
            if (var.matches("\\d+")) continue; // numbers
            if (!definedVars.contains(var) && !isBuiltin(var)) {
                // تحقق إن الكلمة مو string literal
                if (!code.contains("\"" + var + "\"") && !code.contains("'" + var + "'")) {
                    result.issues.add("WARNING: variable '" + var + "' may be undefined");
                    result.score -= 0.1;
                }
            }
        }
    }

    // ═══════════════════════════════════════════════════
    // 2. تحقق من syntax بسيط
    // ═══════════════════════════════════════════════════

    private static void checkBasicSyntax(String code, ValidationResult result) {
        // تحقق من أقواس متوازنة
        int parens = 0, brackets = 0, braces = 0;
        boolean inString = false;
        char strChar = 0;

        for (int i = 0; i < code.length(); i++) {
            char c = code.charAt(i);
            if (inString) {
                if (c == strChar && (i == 0 || code.charAt(i-1) != '\\')) inString = false;
                continue;
            }
            if (c == '"' || c == '\'') { inString = true; strChar = c; continue; }
            if (c == '(') parens++;
            else if (c == ')') parens--;
            else if (c == '[') brackets++;
            else if (c == ']') brackets--;
            else if (c == '{') braces++;
            else if (c == '}') braces--;
        }

        if (parens != 0) result.issues.add("ERROR: unmatched parentheses (" + parens + ")");
        if (brackets != 0) result.issues.add("ERROR: unmatched brackets (" + brackets + ")");

        // تحقق من indentation أولى
        String[] lines = code.split("\n");
        for (String line : lines) {
            if (line.trim().isEmpty()) continue;
            if (line.startsWith("\t") && code.contains("    ")) {
                result.issues.add("WARNING: mixed indentation (tabs and spaces)");
                break;
            }
        }
    }

    // ═══════════════════════════════════════════════════
    // 3. تحقق من type consistency
    // ═══════════════════════════════════════════════════

    private static void checkTypeConsistency(String code, List<String> params,
                                               String fullCode, ValidationResult result) {
        for (String param : params) {
            // لو الـ param معروف إنه list → تحقق ما يُستخدم كـ scalar
            boolean isCollectionParam = param.endsWith("s") && param.length() > 3
                || fullCode.contains(param + " = [")
                || fullCode.contains(param + "=[");

            if (isCollectionParam) {
                // تحقق ما في x.get() على الـ param مباشرة (يعني يعامله كـ dict مو list)
                if (code.contains(param + ".get(") && !code.contains("for") && !code.contains("next")) {
                    result.issues.add("WARNING: '" + param + "' appears to be a list but used as dict");
                    result.score -= 0.15;
                }
            }
        }

        // لو فيه "value" غير معرّف → مشكلة شائعة
        if (code.contains("== value") || code.contains("= value)")) {
            boolean valueInParams = params.contains("value");
            if (!valueInParams) {
                result.issues.add("ERROR: 'value' is undefined - possible copy-paste error");
                result.score = 0.0;
            }
        }

        // لو فيه "items" غير معرّف في دالة لا تأخذ items
        if (code.contains("for x in items") && !params.contains("items")) {
            result.issues.add("ERROR: 'items' used but not in params");
            result.score = 0.0;
        }
    }

    // ═══════════════════════════════════════════════════
    // 4. تحقق من return statement
    // ═══════════════════════════════════════════════════

    private static void checkReturnStatement(String code, String funcName,
                                               ValidationResult result) {
        String trimmed = code.trim();

        // تحقق فيه return
        if (!trimmed.contains("return") && !trimmed.contains("raise")) {
            result.issues.add("WARNING: no return statement found");
            result.score -= 0.2;
        }

        // تحقق ما يرجع None بدون سبب
        if (trimmed.equals("return None") || trimmed.equals("pass")) {
            result.issues.add("WARNING: stub not implemented");
            result.score -= 0.4;
        }

        // لو calculate/total/sum → يجب أن يرجع number
        String n = funcName.toLowerCase();
        if ((n.contains("calculate") || n.contains("total") || n.contains("count"))
                && (trimmed.contains("return next(") || trimmed.contains("return [x for"))) {
            result.issues.add("WARNING: calculate function returns non-numeric value");
            result.score -= 0.1;
        }
    }

    // ═══════════════════════════════════════════════════
    // 5. إصلاح تلقائي
    // ═══════════════════════════════════════════════════

    private static String tryAutoFix(String code, List<String> params, ValidationResult result) {
        String fixed = code;

        // صلح: "== value" → "== param"
        if (code.contains("== value") && !params.isEmpty()) {
            String firstScalar = params.get(0);
            fixed = fixed.replace("== value", "== " + firstScalar);
            result.issues.add("AUTO-FIXED: replaced 'value' with '" + firstScalar + "'");
            return fixed;
        }

        // صلح: "for x in items" بدون items في params
        if (code.contains("for x in items") && !params.contains("items") && !params.isEmpty()) {
            String collParam = params.stream().filter(p -> p.endsWith("s")).findFirst().orElse(params.get(0));
            fixed = fixed.replace("for x in items", "for x in " + collParam);
            result.issues.add("AUTO-FIXED: replaced 'items' with '" + collParam + "'");
            return fixed;
        }

        return null;
    }

    // ═══════════════════════════════════════════════════
    // مساعدات
    // ═══════════════════════════════════════════════════

    private static boolean isBuiltin(String name) {
        Set<String> builtins = new HashSet<>(Arrays.asList(
            "str","int","float","bool","list","dict","set","tuple","bytes",
            "len","sum","max","min","sorted","next","iter","zip","map","filter",
            "enumerate","range","print","type","isinstance","hasattr","getattr",
            "any","all","abs","round","open","chr","ord","hex","bin","oct",
            "repr","hash","id","vars","dir","help","input","format",
            "re","os","sys","math","json","hashlib","datetime","collections",
            "None","True","False","self","cls","super",
            "get","append","extend","update","pop","remove","add","clear",
            "split","strip","lower","upper","replace","join","format","encode",
            "decode","find","startswith","endswith","count","index","keys","values",
            "items","copy","deepcopy","read","write","close","seek","tell",
            "group","match","search","findall","sub","compile","groups"
        ));
        return builtins.contains(name);
    }
}
