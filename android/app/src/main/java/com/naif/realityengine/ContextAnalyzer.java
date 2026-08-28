package com.naif.realityengine;

import java.util.*;
import java.util.regex.*;

public class ContextAnalyzer {

    public static class CodeContext {
        public List<String> imports = new ArrayList<>();
        public List<String> classes = new ArrayList<>();
        public boolean isInsideClass = false;
        public Map<String, List<String>> functionParams = new HashMap<>();
        public Map<String, Double> typeConfidence = new HashMap<>();
        public String dominantType = "unknown";
        public String functionBody = "";
    }

    public static CodeContext analyze(String code, String targetFunc) {
        CodeContext ctx = new CodeContext();

        // imports
        Matcher im = Pattern.compile("^(?:import|from)\\s+(.+)", Pattern.MULTILINE).matcher(code);
        while (im.find()) ctx.imports.add(im.group(1).trim());

        // classes
        Matcher cl = Pattern.compile("^class\\s+(\\w+)", Pattern.MULTILINE).matcher(code);
        while (cl.find()) ctx.classes.add(cl.group(1));

        // all function params
        Matcher fn = Pattern.compile("def\\s+(\\w+)\\s*\\(([^)]*)\\)", Pattern.MULTILINE).matcher(code);
        while (fn.find()) {
            List<String> ps = new ArrayList<>();
            for (String p : fn.group(2).split(",")) {
                String pn = p.trim().split(":")[0].trim().split("=")[0].trim();
                if (!pn.equals("self") && !pn.equals("cls") && !pn.isEmpty()) ps.add(pn);
            }
            ctx.functionParams.put(fn.group(1), ps);
        }

        // inside class?
        ctx.isInsideClass = checkInsideClass(code, targetFunc);

        // extract ONLY target function body
        ctx.functionBody = extractFunctionBody(code, targetFunc);

        // type confidence on function body only (not full file)
        List<String> params = ctx.functionParams.getOrDefault(targetFunc, new ArrayList<>());
        if (!params.isEmpty()) {
            String scope = ctx.functionBody.isEmpty() ? code : ctx.functionBody;
            ctx.typeConfidence = inferConfidence(scope, params.get(0));
            ctx.dominantType = bestType(ctx.typeConfidence);
        }

        return ctx;
    }

    // استخرج جسم الدالة المستهدفة فقط
    public static String extractFunctionBody(String code, String funcName) {
        String[] lines = code.split("\n");
        StringBuilder body = new StringBuilder();
        boolean inFunc = false;
        int funcIndent = -1;

        for (String line : lines) {
            String trimmed = line.trim();

            // ابحث عن بداية الدالة
            if (!inFunc) {
                Pattern defPat = Pattern.compile("^(\\s*)def\\s+" + Pattern.quote(funcName) + "\\s*\\(");
                Matcher m = defPat.matcher(line);
                if (m.find()) {
                    inFunc = true;
                    funcIndent = m.group(1).length();
                    body.append(line).append("\n");
                }
                continue;
            }

            // داخل الدالة
            if (trimmed.isEmpty()) {
                body.append(line).append("\n");
                continue;
            }

            // حساب indent السطر الحالي
            int currentIndent = 0;
            for (char c : line.toCharArray()) {
                if (c == ' ') currentIndent++;
                else break;
            }

            // لو indent رجع لنفس مستوى def أو أقل → خرجنا من الدالة
            if (currentIndent <= funcIndent && !trimmed.startsWith("#")) {
                break;
            }

            body.append(line).append("\n");
        }

        return body.toString();
    }

    public static Map<String, Double> inferConfidence(String scope, String param) {
        Map<String, Double> s = new HashMap<>();
        s.put("dict", 0.0); s.put("list", 0.0);
        s.put("string", 0.0); s.put("number", 0.0);

        if (scope.contains(param + ".get("))        s.put("dict",   s.get("dict")   + 0.5);
        if (scope.contains(param + "[\""))          s.put("dict",   s.get("dict")   + 0.4);
        if (scope.contains(param + "['"))           s.put("dict",   s.get("dict")   + 0.4);
        if (scope.contains(" in " + param))         s.put("list",   s.get("list")   + 0.5);
        if (scope.contains("len(" + param + ")"))   s.put("list",   s.get("list")   + 0.3);
        if (scope.contains(param + ".append("))     s.put("list",   s.get("list")   + 0.4);
        if (scope.contains(param + "[0]"))          s.put("list",   s.get("list")   + 0.3);
        if (scope.contains(param + ".split("))      s.put("string", s.get("string") + 0.5);
        if (scope.contains(param + ".strip("))      s.put("string", s.get("string") + 0.4);
        if (scope.contains(param + ".lower("))      s.put("string", s.get("string") + 0.3);
        if (scope.contains(param + ".replace("))    s.put("string", s.get("string") + 0.3);
        if (scope.contains("int(" + param + ")"))   s.put("number", s.get("number") + 0.5);
        if (scope.contains("float(" + param + ")")) s.put("number", s.get("number") + 0.5);
        if (scope.contains(param + " + ") || scope.contains(param + " * "))
            s.put("number", s.get("number") + 0.3);

        return s;
    }

    private static String bestType(Map<String, Double> scores) {
        String best = "unknown"; double max = 0.15;
        for (Map.Entry<String, Double> e : scores.entrySet())
            if (e.getValue() > max) { max = e.getValue(); best = e.getKey(); }
        return best;
    }

    private static boolean checkInsideClass(String code, String funcName) {
        String[] lines = code.split("\n");
        boolean inClass = false;
        for (String line : lines) {
            String t = line.trim();
            if (t.startsWith("class ")) inClass = true;
            if (inClass && t.startsWith("def " + funcName + "(")) return true;
            if (inClass && !line.startsWith(" ") && !line.startsWith("\t") && !t.isEmpty())
                inClass = false;
        }
        return false;
    }

    public static String refineSuggestion(String suggestion, CodeContext ctx, String param) {
        if (ctx.dominantType.equals("dict") && suggestion.contains("sum(" + param + ")")) {
            return suggestion.replace(
                "sum(" + param + ")",
                "sum(x.get('value', x.get('price', x.get('amount', 0))) for x in " + param + ")"
            );
        }
        return suggestion;
    }
}
}
