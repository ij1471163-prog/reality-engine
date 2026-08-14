package com.naif.realityengine;

import java.util.ArrayList;
import java.util.List;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * LocalEngine — محرك ذكاء اصطناعي خفيف محلي.
 * يعمل بدون إنترنت. يتعرف على أنماط الدوال الشائعة ويولد كوداً فورياً.
 * يستخدم كـprimary للدوال البسيطة، وكـfallback لو AI السحابي فشل.
 */
public class LocalEngine {

    public static class LocalFix {
        public String functionName;
        public String generatedCode;
        public double confidence; // 0.0 ~ 1.0
        public String patternUsed;

        public LocalFix(String name, String code, double conf, String pattern) {
            this.functionName = name;
            this.generatedCode = code;
            this.confidence = conf;
            this.patternUsed = pattern;
        }
    }

    /**
     * يحاول إكمال دالة ناقصة محلياً.
     * يرجع null إذا ما قدر يتعرف على النمط.
     */
    public static LocalFix tryFix(String functionName, String[] parameters, String fileContext, AISecurityGuard.Language lang) {
        if (lang != AISecurityGuard.Language.PYTHON) return null; // حالياً يدعم Python فقط

        // 1. نحلل اسم الدالة
        String lowerName = functionName.toLowerCase();

        // 2. نستخرج أسماء المعاملات
        String p0 = parameters.length > 0 ? parameters[0] : null;
        String p1 = parameters.length > 1 ? parameters[1] : null;

        // 3. نحاول الأنماط حسب الأولوية

        // Pattern: calculate_total / calculate_sum / calculate_average
        if (lowerName.startsWith("calculate_")) {
            return handleCalculate(functionName, parameters, fileContext, lowerName);
        }

        // Pattern: find_user / find_item / find_xxx
        if (lowerName.startsWith("find_")) {
            return handleFind(functionName, parameters, lowerName);
        }

        // Pattern: get_email / get_name / get_xxx
        if (lowerName.startsWith("get_")) {
            return handleGet(functionName, parameters, lowerName);
        }

        // Pattern: count_active / count_items / count_xxx
        if (lowerName.startsWith("count_")) {
            return handleCount(functionName, parameters, lowerName);
        }

        // Pattern: is_active / is_valid / has_xxx
        if (lowerName.startsWith("is_") || lowerName.startsWith("has_")) {
            return handleBoolean(functionName, parameters, lowerName);
        }

        // Pattern: normalize_xxx / format_xxx
        if (lowerName.startsWith("normalize_") || lowerName.startsWith("format_")) {
            return handleFormat(functionName, parameters, lowerName);
        }

        // Pattern: validate_xxx
        if (lowerName.startsWith("validate_")) {
            return handleValidate(functionName, parameters, lowerName);
        }

        // Pattern: filter_xxx
        if (lowerName.startsWith("filter_") || lowerName.startsWith("get_expensive_")) {
            return handleFilter(functionName, parameters, lowerName);
        }

        // Pattern: sort_xxx / order_xxx
        if (lowerName.startsWith("sort_") || lowerName.startsWith("order_")) {
            return handleSort(functionName, parameters, lowerName);
        }

        // Pattern: max / min / best
        if (lowerName.contains("best") || lowerName.contains("max") || lowerName.contains("top")) {
            return handleBest(functionName, parameters, lowerName);
        }

        return null; // ما قدر نتعرف
    }

    // ============================================================
    // الأنماط
    // ============================================================

    private static LocalFix handleCalculate(String func, String[] params, String context, String lower) {
        String p0 = params.length > 0 ? params[0] : "items";
        String body;

        if (lower.contains("average") || lower.contains("mean")) {
            body = "    if not " + p0 + ":\n        return 0\n    return sum(" + p0 + ") / len(" + p0 + ")";
            return new LocalFix(func, buildFunc(func, params, body), 0.85, "calculate_average");
        }

        if (lower.contains("total") || lower.contains("sum")) {
            // نبحث في السياق عن دالة مساعدة
            String helper = findHelper(context, "calculate_item_total|item_total");
            if (helper != null) {
                body = "    if not " + p0 + ":\n        return 0\n    return sum(" + helper + "(item) for item in " + p0 + ")";
            } else {
                body = "    return sum(" + p0 + ") if " + p0 + " else 0";
            }
            return new LocalFix(func, buildFunc(func, params, body), 0.90, "calculate_total");
        }

        return null;
    }

    private static LocalFix handleFind(String func, String[] params, String lower) {
        String p0 = params.length > 0 ? params[0] : "key";
        String p1 = params.length > 1 ? params[1] : "items";
        String field = lower.replace("find_", "");

        String body = "    return next((x for x in " + p1 + " if x.get(\"" + field + "\") == " + p0 + "), None)";
        return new LocalFix(func, buildFunc(func, params, body), 0.88, "find_by_field");
    }

    private static LocalFix handleGet(String func, String[] params, String lower) {
        String p0 = params.length > 0 ? params[0] : "obj";
        String field = lower.replace("get_", "");

        // لو الدالة تستدعي find_ أولاً
        if (field.contains("email") || field.contains("name") || field.contains("id")) {
            String findFunc = "find_" + field.replace("_email", "").replace("_name", "");
            if (params.length >= 2) {
                String body = "    obj = " + findFunc + "(" + params[0] + ", " + params[1] + ")\n    return obj.get(\"" + field + "\") if obj else None";
                return new LocalFix(func, buildFunc(func, params, body), 0.82, "get_via_find");
            }
        }

        String body = "    return " + p0 + ".get(\"" + field + "\") if isinstance(" + p0 + ", dict) else getattr(" + p0 + ", \"" + field + "\", None)";
        return new LocalFix(func, buildFunc(func, params, body), 0.80, "get_field");
    }

    private static LocalFix handleCount(String func, String[] params, String lower) {
        String p0 = params.length > 0 ? params[0] : "items";
        String condition = lower.replace("count_", "");

        String body = "    return sum(1 for x in " + p0 + " if x.get(\"" + condition + "\", False))";
        return new LocalFix(func, buildFunc(func, params, body), 0.85, "count_condition");
    }

    private static LocalFix handleBoolean(String func, String[] params, String lower) {
        String p0 = params.length > 0 ? params[0] : "obj";
        String field = lower.replace("is_", "").replace("has_", "");

        String body = "    return bool(" + p0 + ".get(\"" + field + "\", False)) if isinstance(" + p0 + ", dict) else bool(getattr(" + p0 + ", \"" + field + "\", False))";
        return new LocalFix(func, buildFunc(func, params, body), 0.78, "boolean_check");
    }

    private static LocalFix handleFormat(String func, String[] params, String lower) {
        String p0 = params.length > 0 ? params[0] : "value";
        String body;

        if (lower.contains("username") || lower.contains("name")) {
            body = "    return str(" + p0 + ").strip().lower()";
        } else if (lower.contains("email")) {
            body = "    return str(" + p0 + ").strip().lower()";
        } else {
            body = "    return str(" + p0 + ").strip().lower().replace(\"  \", \" \")";
        }
        return new LocalFix(func, buildFunc(func, params, body), 0.75, "format_string");
    }

    private static LocalFix handleValidate(String func, String[] params, String lower) {
        String p0 = params.length > 0 ? params[0] : "value";
        String body;

        if (lower.contains("email")) {
            body = "    import re\n    return bool(re.match(r'^[\\w.]+@[\\w.]+\\.[a-z]{2,}$', str(" + p0 + ")))";
        } else if (lower.contains("password")) {
            body = "    return len(str(" + p0 + ")) >= 6";
        } else {
            body = "    return bool(" + p0 + ")";
        }
        return new LocalFix(func, buildFunc(func, params, body), 0.70, "validate_simple");
    }

    private static LocalFix handleFilter(String func, String[] params, String lower) {
        String p0 = params.length > 0 ? params[0] : "items";
        String p1 = params.length > 1 ? params[1] : "threshold";
        String field = lower.replace("filter_", "").replace("get_expensive_", "").replace("get_cheap_", "");

        String op = lower.contains("cheap") || lower.contains("min") ? "<=" : ">=";
        String body = "    return [x for x in " + p0 + " if x.get(\"" + field.replace("items", "price") + "\", 0) " + op + " " + p1 + "]";
        return new LocalFix(func, buildFunc(func, params, body), 0.82, "filter_list");
    }

    private static LocalFix handleSort(String func, String[] params, String lower) {
        String p0 = params.length > 0 ? params[0] : "items";
        String field = lower.replace("sort_", "").replace("order_by_", "");

        String body = "    return sorted(" + p0 + ", key=lambda x: x.get(\"" + field + "\", 0), reverse=True)";
        return new LocalFix(func, buildFunc(func, params, body), 0.80, "sort_by_field");
    }

    private static LocalFix handleBest(String func, String[] params, String lower) {
        String p0 = params.length > 0 ? params[0] : "items";
        String field = "score"; // افتراضي

        if (lower.contains("price")) field = "price";
        else if (lower.contains("score")) field = "score";
        else if (lower.contains("rating")) field = "rating";

        String body = "    return max(" + p0 + ", key=lambda x: x.get(\"" + field + "\", 0)) if " + p0 + " else None";
        return new LocalFix(func, buildFunc(func, params, body), 0.83, "find_best");
    }

    // ============================================================
    // أدوات مساعدة
    // ============================================================

    private static String buildFunc(String name, String[] params, String body) {
        StringBuilder sb = new StringBuilder();
        sb.append("def ").append(name).append("(");
        for (int i = 0; i < params.length; i++) {
            if (i > 0) sb.append(", ");
            sb.append(params[i]);
        }
        sb.append("):\n").append(body).append("\n");
        return sb.toString();
    }

    private static String findHelper(String context, String pattern) {
        if (context == null) return null;
        Matcher m = Pattern.compile("(\\w+)\\s*\\(").matcher(context);
        while (m.find()) {
            String name = m.group(1);
            if (name.matches(pattern)) return name;
        }
        return null;
    }

    /**
     * يستخرج اسم الدالة + المعاملات من سطر التعريف.
     * مثال: "def calculate_total(items):" → ["calculate_total", ["items"]]
     */
    public static String[] extractSignature(String line) {
        Matcher m = Pattern.compile("^\\s*def\\s+(\\w+)\\s*\\(([^)]*)\\)").matcher(line);
        if (!m.find()) return null;
        String name = m.group(1);
        String paramsRaw = m.group(2).trim();
        String[] params = paramsRaw.isEmpty() ? new String[0] : paramsRaw.split("\\s*,\\s*");
        String[] result = new String[1 + params.length];
        result[0] = name;
        System.arraycopy(params, 0, result, 1, params.length);
        return result;
    }

    // ============================================================
    // Orchestrator Integration
    // ============================================================

    /**
     * يحاول إصلاح كل الـstubs محلياً أولاً.
     * يرجع قائمة باللي نجح، والباقي يرسل للـAI السحابي.
     */
    public static List<LocalFix> tryFixAll(String code, String fileName) {
        List<LocalFix> fixed = new ArrayList<>();
        List<StubDetector.StubInfo> stubs = StubDetector.findStubs(code, fileName);

        for (StubDetector.StubInfo stub : stubs) {
            String[] sig = extractSignature(code.split("\n")[stub.startLine]);
            if (sig == null) continue;

            String funcName = sig[0];
            String[] params = new String[sig.length - 1];
            System.arraycopy(sig, 1, params, 0, params.length);

            LocalFix fix = tryFix(funcName, params, code, AISecurityGuard.detectLanguage(code, fileName));
            if (fix != null && fix.confidence >= 0.75) {
                fixed.add(fix);
            }
        }
        return fixed;
    }
}

