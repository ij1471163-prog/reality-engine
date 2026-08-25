package com.naif.realityengine;

import java.util.*;
import java.util.regex.*;

/**
 * CodeIntelligence — محرك استدلال الكود
 * نظام أدلة متعدد المصادر بدل قرار واحد
 *
 * Evidence Pipeline:
 * Assignment → Usage → Caller → Similar → Name/Semantic
 *      ↓
 * Confidence Score (max 0.7 بدون AST)
 *      ↓
 * Suggestion
 */
public class CodeIntelligence {

    // ── أنواع البيانات ─────────────────────────────────
    public enum DataType {
        LIST_OF_DICT, LIST, DICT, STRING, NUMBER, BOOL, UNKNOWN
    }

    // ── دليل واحد ──────────────────────────────────────
    public static class Evidence {
        public String source;   // assignment / usage / caller / similar / semantic
        public String detail;
        public double weight;
        public Evidence(String source, String detail, double weight) {
            this.source = source; this.detail = detail; this.weight = weight;
        }
    }

    // ── شكل البيانات مع الأدلة ─────────────────────────
    public static class DataShape {
        public DataType type = DataType.UNKNOWN;
        public List<String> keys = new ArrayList<>();
        public double heuristicConfidence = 0.0; // max 0.7 بدون AST
        public List<Evidence> evidences = new ArrayList<>();

        public void addEvidence(String source, String detail, double weight) {
            evidences.add(new Evidence(source, detail, weight));
            heuristicConfidence = Math.min(0.7, heuristicConfidence + weight);
        }
    }

    // ── نتيجة التحليل الكاملة ──────────────────────────
    public static class IntelligenceResult {
        public Map<String, DataShape> paramShapes  = new LinkedHashMap<>();
        public Map<String, List<String>> callers   = new HashMap<>();
        public Map<String, List<String>> callees   = new HashMap<>();
        public List<String> listParams             = new ArrayList<>(); // params هي collections
        public List<String> scalarParams           = new ArrayList<>(); // params هي قيم بحث
        public Map<String, String> similarFuncs    = new LinkedHashMap<>();
        public double similarConfidence            = 0.0;
        public String bestSuggestion               = null;
        public double finalConfidence              = 0.0;
        public List<String> evidenceSummary        = new ArrayList<>();
    }

    // ═══════════════════════════════════════════════════
    // التحليل الرئيسي
    // ═══════════════════════════════════════════════════

    public static IntelligenceResult analyze(String fullCode, String targetFunc) {
        IntelligenceResult result = new IntelligenceResult();

        List<String> params = extractParams(fullCode, targetFunc);
        String funcBody = extractFunctionBody(fullCode, targetFunc);
        String scopedCode = funcBody != null ? funcBody : "";

        // 1. حلل كل parameter
        for (String param : params) {
            DataShape shape = buildDataShape(fullCode, scopedCode, param);
            result.paramShapes.put(param, shape);
        }

        // 2. صنّف params: list params vs scalar params
        classifyParams(params, result);

        // 3. حلل العلاقات
        analyzeRelationships(fullCode, targetFunc, result);

        // 4. ابحث عن دوال مشابهة بأدلة متعددة
        findSimilarFunctions(fullCode, targetFunc, params, result);

        // 5. ولّد اقتراح ذكي
        generateSuggestion(fullCode, targetFunc, params, result);

        return result;
    }

    // ═══════════════════════════════════════════════════
    // بناء DataShape بنظام أدلة متعدد
    // ═══════════════════════════════════════════════════

    private static DataShape buildDataShape(String fullCode, String scopedCode, String param) {
        DataShape shape = new DataShape();
        Map<DataType, Double> scores = new EnumMap<>(DataType.class);
        for (DataType t : DataType.values()) scores.put(t, 0.0);

        // ── دليل 1: Assignment (أقوى دليل) ──
        // param = [{...}] → list_of_dict
        if (Pattern.compile(Pattern.quote(param) + "\\s*=\\s*\\[\\s*\\{",
                Pattern.MULTILINE).matcher(fullCode).find()) {
            scores.merge(DataType.LIST_OF_DICT, 0.6, Double::sum);
            shape.addEvidence("assignment", param + " = [{...}]", 0.6);
        }
        // param = {...} → dict
        else if (Pattern.compile(Pattern.quote(param) + "\\s*=\\s*\\{",
                Pattern.MULTILINE).matcher(fullCode).find()) {
            scores.merge(DataType.DICT, 0.5, Double::sum);
            shape.addEvidence("assignment", param + " = {...}", 0.5);
        }
        // param = [...] → list
        else if (Pattern.compile(Pattern.quote(param) + "\\s*=\\s*\\[",
                Pattern.MULTILINE).matcher(fullCode).find()) {
            scores.merge(DataType.LIST, 0.4, Double::sum);
            shape.addEvidence("assignment", param + " = [...]", 0.4);
        }

        // ── دليل 2: استخدام (في جسم الدالة فقط) ──
        String scope = scopedCode.isEmpty() ? fullCode : scopedCode;

        // for x in param → list or list_of_dict
        Matcher forMat = Pattern.compile(
            "for\\s+(\\w+)\\s+in\\s+" + Pattern.quote(param),
            Pattern.MULTILINE).matcher(scope);
        if (forMat.find()) {
            String iterVar = forMat.group(1);
            scores.merge(DataType.LIST, 0.3, Double::sum);
            shape.addEvidence("usage", "for " + iterVar + " in " + param, 0.3);

            // iterVar["key"] → list_of_dict
            if (Pattern.compile(Pattern.quote(iterVar) + "\\s*\\.get\\(|" +
                Pattern.quote(iterVar) + "\\s*\\[\\s*['\"]",
                Pattern.MULTILINE).matcher(scope).find()) {
                scores.merge(DataType.LIST_OF_DICT, 0.4, Double::sum);
                shape.addEvidence("usage", iterVar + "[\"key\"] inside loop", 0.4);
            }
        }

        // param.get() → dict
        if (scope.contains(param + ".get(")) {
            scores.merge(DataType.DICT, 0.4, Double::sum);
            shape.addEvidence("usage", param + ".get()", 0.4);
        }

        // param["key"] → dict
        Matcher dictAccess = Pattern.compile(
            Pattern.quote(param) + "\\s*\\[\\s*['\"]([^'\"]+)['\"]",
            Pattern.MULTILINE).matcher(scope);
        while (dictAccess.find()) {
            if (!shape.keys.contains(dictAccess.group(1)))
                shape.keys.add(dictAccess.group(1));
            scores.merge(DataType.DICT, 0.3, Double::sum);
            shape.addEvidence("usage", param + "[\"" + dictAccess.group(1) + "\"]", 0.3);
        }

        // len(param) → list
        if (scope.contains("len(" + param + ")")) {
            scores.merge(DataType.LIST, 0.2, Double::sum);
            shape.addEvidence("usage", "len(" + param + ")", 0.2);
        }

        // param.split/strip/lower → string
        if (scope.contains(param + ".split(") || scope.contains(param + ".lower(")
                || scope.contains(param + ".strip(")) {
            scores.merge(DataType.STRING, 0.5, Double::sum);
            shape.addEvidence("usage", param + ".split/lower/strip", 0.5);
        }

        // int/float(param) → number
        if (scope.contains("int(" + param + ")") || scope.contains("float(" + param + ")")) {
            scores.merge(DataType.NUMBER, 0.5, Double::sum);
            shape.addEvidence("usage", "int/float(" + param + ")", 0.5);
        }

        // ── دليل 3: استخراج keys من تعريفات البيانات ──
        List<String> defKeys = extractKeysFromDefinition(fullCode, param);
        for (String k : defKeys) {
            if (!shape.keys.contains(k)) shape.keys.add(k);
        }
        if (!defKeys.isEmpty()) {
            scores.merge(DataType.LIST_OF_DICT, 0.2, Double::sum);
            shape.addEvidence("definition", "keys: " + defKeys, 0.2);
        }

        // ── اختر النوع الأعلى ──
        DataType bestType = DataType.UNKNOWN;
        double bestScore = 0.15;
        for (Map.Entry<DataType, Double> e : scores.entrySet()) {
            if (e.getValue() > bestScore) {
                bestScore = e.getValue();
                bestType = e.getKey();
            }
        }

        // لو list_of_dict وما عندها keys — استخدم DICT keys
        if (bestType == DataType.LIST_OF_DICT && shape.keys.isEmpty()) {
            Matcher km = Pattern.compile(
                "\\{\\s*['\"]([\\w_]+)['\"]\\s*:",
                Pattern.MULTILINE).matcher(fullCode);
            while (km.find() && shape.keys.size() < 10)
                if (!shape.keys.contains(km.group(1)))
                    shape.keys.add(km.group(1));
        }

        shape.type = (bestScore >= 0.15) ? bestType : DataType.UNKNOWN;
        shape.heuristicConfidence = Math.min(0.7, bestScore);
        return shape;
    }

    // ═══════════════════════════════════════════════════
    // تصنيف Parameters: collection vs scalar
    // ═══════════════════════════════════════════════════

    private static void classifyParams(List<String> params, IntelligenceResult result) {
        for (String param : params) {
            DataShape shape = result.paramShapes.getOrDefault(param, new DataShape());
            boolean isCollection = shape.type == DataType.LIST
                || shape.type == DataType.LIST_OF_DICT
                || shape.type == DataType.DICT;

            // اسم المتغير كدليل إضافي
            String pl = param.toLowerCase();
            boolean nameIsCollection = pl.endsWith("s") || pl.contains("list")
                || pl.contains("items") || pl.contains("users") || pl.contains("data")
                || pl.contains("records") || pl.contains("orders");

            if (isCollection || nameIsCollection)
                result.listParams.add(param);
            else
                result.scalarParams.add(param);
        }
    }

    // ═══════════════════════════════════════════════════
    // تحليل العلاقات
    // ═══════════════════════════════════════════════════

    private static void analyzeRelationships(String code, String targetFunc,
                                              IntelligenceResult result) {
        // من يستدعي targetFunc
        Pattern callerPat = Pattern.compile(
            "def\\s+(\\w+)\\s*\\([^)]*\\)[^:]*:[\\s\\S]{0,2000}?" +
            Pattern.quote(targetFunc) + "\\s*\\(",
            Pattern.MULTILINE
        );
        List<String> callers = new ArrayList<>();
        Matcher cm = callerPat.matcher(code);
        while (cm.find())
            if (!cm.group(1).equals(targetFunc)) callers.add(cm.group(1));
        result.callers.put(targetFunc, callers);

        // ماذا يستدعي targetFunc
        String body = extractFunctionBody(code, targetFunc);
        if (body != null) {
            Set<String> builtins = new HashSet<>(Arrays.asList(
                "print","len","str","int","float","list","dict","range",
                "enumerate","zip","map","filter","sorted","sum","max","min",
                "next","iter","open","type","isinstance","bool","set","tuple"
            ));
            Matcher calls = Pattern.compile("(\\w+)\\s*\\(").matcher(body);
            List<String> callees = new ArrayList<>();
            while (calls.find()) {
                String name = calls.group(1);
                if (!builtins.contains(name) && !name.equals(targetFunc))
                    callees.add(name);
            }
            result.callees.put(targetFunc, callees);
        }
    }

    // ═══════════════════════════════════════════════════
    // البحث عن دوال مشابهة بأدلة متعددة (مو اسم فقط)
    // ═══════════════════════════════════════════════════

    private static void findSimilarFunctions(String code, String targetFunc,
                                              List<String> targetParams,
                                              IntelligenceResult result) {
        // استخرج tokens من اسم الدالة المستهدفة
        String[] targetTokens = targetFunc.toLowerCase().split("_");
        Set<String> targetTokenSet = new HashSet<>(Arrays.asList(targetTokens));

        Pattern allFuncs = Pattern.compile(
            "def\\s+(\\w+)\\s*\\(([^)]*)\\)[^:]*:\\s*\\n((?:[ \\t]+[^\\n]+\\n)+)",
            Pattern.MULTILINE
        );
        Matcher fm = allFuncs.matcher(code);

        while (fm.find()) {
            String fname = fm.group(1);
            String fparams = fm.group(2);
            String fbody = fm.group(3).trim();

            if (fname.equals(targetFunc)) continue;
            if (fbody.trim().equals("pass") || fbody.trim().equals("...")) continue;

            // عدّ الـ tokens المشتركة
            String[] fnameTokens = fname.toLowerCase().split("_");
            int commonTokens = 0;
            for (String t : fnameTokens)
                if (targetTokenSet.contains(t) && t.length() > 2) commonTokens++;

            // تشابه في الـ parameters
            List<String> fparamList = new ArrayList<>();
            for (String p : fparams.split(",")) {
                String pname = p.trim().split(":")[0].trim().split("=")[0].trim();
                if (!pname.equals("self") && !pname.equals("cls") && !pname.isEmpty())
                    fparamList.add(pname.toLowerCase());
            }
            int commonParams = 0;
            for (String tp : targetParams)
                if (fparamList.contains(tp.toLowerCase())) commonParams++;

            // confidence المشابهة = tokens + params (مو اسم فقط)
            double simScore = (commonTokens * 0.3) + (commonParams * 0.25);

            // لازم يكون فيه دليلان على الأقل
            if (simScore >= 0.3 && fbody.length() > 10) {
                result.similarFuncs.put(fname, fbody);
                result.similarConfidence = Math.min(0.5, simScore); // max 0.5 للمشابهة
                result.evidenceSummary.add("دالة مشابهة: " + fname
                    + " (tokens=" + commonTokens + ", params=" + commonParams + ")");
            }
        }
    }

    // ═══════════════════════════════════════════════════
    // توليد اقتراح ذكي
    // ═══════════════════════════════════════════════════

    private static void generateSuggestion(String code, String funcName,
                                            List<String> params,
                                            IntelligenceResult result) {
        if (params.isEmpty()) {
            result.bestSuggestion = null;
            result.finalConfidence = 0.0;
            return;
        }

        // اختر collection param و scalar param بشكل صحيح
        String collectionParam = result.listParams.isEmpty() ? params.get(0) : result.listParams.get(0);
        String scalarParam = result.scalarParams.isEmpty()
            ? (params.size() > 1 ? params.get(1) : "value")
            : result.scalarParams.get(0);

        DataShape collShape = result.paramShapes.getOrDefault(collectionParam, new DataShape());
        String n = funcName.toLowerCase();

        // ── اقتراح من دالة مشابهة — موقوف مؤقتاً لأنه غير موثوق ──
        if (false && !result.similarFuncs.isEmpty() && result.similarConfidence >= 0.4) {
            Map.Entry<String, String> similar = result.similarFuncs.entrySet().iterator().next();
            result.bestSuggestion = "# نمط مشابه لـ " + similar.getKey() + "()\n" + similar.getValue();
            result.finalConfidence = result.similarConfidence;
            result.evidenceSummary.add("اقتراح من " + similar.getKey() + " بثقة " + result.similarConfidence);
            return;
        }

        // ── list_of_dict ──
        if (collShape.type == DataType.LIST_OF_DICT && collShape.heuristicConfidence >= 0.3) {

            if (n.contains("total") || n.contains("calculate") || n.contains("sum")) {
                String priceKey = findKey(collShape.keys, "price","value","amount","cost","salary","total");
                String qtyKey   = findKey(collShape.keys, "qty","quantity","count","num","units","amount");
                if (priceKey != null && qtyKey != null && !priceKey.equals(qtyKey)) {
                    result.bestSuggestion = "return sum(x[\"" + priceKey + "\"] * x[\"" + qtyKey + "\"] for x in " + collectionParam + ")";
                    result.finalConfidence = Math.min(0.65, collShape.heuristicConfidence + 0.1);
                } else if (priceKey != null) {
                    result.bestSuggestion = "return sum(x[\"" + priceKey + "\"] for x in " + collectionParam + ")";
                    result.finalConfidence = Math.min(0.6, collShape.heuristicConfidence);
                } else {
                    result.bestSuggestion = "return sum(x.get(\"value\", 0) for x in " + collectionParam + ")  # تحقق من اسم الـ key";
                    result.finalConfidence = 0.3;
                }
                return;
            }

            if (n.contains("find") || n.contains("search") || n.contains("get")) {
                String idKey = findKey(collShape.keys, "id","username","name","email","key","code","user_id");
                if (idKey != null) {
                    result.bestSuggestion = "return next((x for x in " + collectionParam + " if x.get(\"" + idKey + "\") == " + scalarParam + "), None)";
                    result.finalConfidence = Math.min(0.65, collShape.heuristicConfidence + 0.1);
                } else {
                    result.bestSuggestion = "return next((x for x in " + collectionParam + " if x == " + scalarParam + "), None)";
                    result.finalConfidence = 0.35;
                }
                return;
            }

            if (n.contains("filter") || n.contains("expensive") || n.contains("cheap")
                    || n.contains("active") || n.contains("top")) {
                String priceKey = findKey(collShape.keys, "price","value","amount","cost","score","rating");
                String threshold = scalarParam.equals("value") ? "threshold" : scalarParam;
                if (priceKey != null) {
                    result.bestSuggestion = "return [x for x in " + collectionParam + " if x.get(\"" + priceKey + "\", 0) >= " + threshold + "]";
                    result.finalConfidence = Math.min(0.6, collShape.heuristicConfidence);
                } else {
                    result.bestSuggestion = "return [x for x in " + collectionParam + " if x]";
                    result.finalConfidence = 0.25;
                }
                return;
            }

            if (n.contains("count")) {
                result.bestSuggestion = "return len([x for x in " + collectionParam + " if x])";
                result.finalConfidence = 0.5;
                return;
            }
        }

        // ── list عادي ──
        if (collShape.type == DataType.LIST && collShape.heuristicConfidence >= 0.3) {
            if (n.contains("total") || n.contains("sum"))
                result.bestSuggestion = "return sum(" + collectionParam + ") if " + collectionParam + " else 0";
            else if (n.contains("average") || n.contains("avg") || n.contains("mean"))
                result.bestSuggestion = "return sum(" + collectionParam + ") / len(" + collectionParam + ") if " + collectionParam + " else 0.0";
            else if (n.contains("sort"))
                result.bestSuggestion = "return sorted(" + collectionParam + ")";
            else if (n.contains("unique") || n.contains("distinct"))
                result.bestSuggestion = "return list(dict.fromkeys(" + collectionParam + "))";
            else
                result.bestSuggestion = "return list(" + collectionParam + ")";
            result.finalConfidence = Math.min(0.55, collShape.heuristicConfidence);
            return;
        }

        // ── لا اقتراح موثوق ──
        result.bestSuggestion = null;
        result.finalConfidence = 0.0;
        result.evidenceSummary.add("لا يوجد دليل كافٍ — يُفضّل مراجعة يدوية أو استخدام AI");
    }

    // ═══════════════════════════════════════════════════
    // مساعدات
    // ═══════════════════════════════════════════════════

    private static String findKey(List<String> keys, String... candidates) {
        for (String c : candidates)
            if (keys.contains(c)) return c;
        return null;
    }

    private static List<String> extractKeysFromDefinition(String code, String varName) {
        List<String> keys = new ArrayList<>();
        Pattern pat = Pattern.compile(
            Pattern.quote(varName) + "\\s*=\\s*[\\[\\{][\\s\\S]{0,800}?[\\]\\}]",
            Pattern.MULTILINE
        );
        Matcher mat = pat.matcher(code);
        if (mat.find()) {
            Matcher km = Pattern.compile("['\"]([\\w_]+)['\"]\\s*:").matcher(mat.group());
            while (km.find() && keys.size() < 15)
                if (!keys.contains(km.group(1))) keys.add(km.group(1));
        }
        return keys;
    }

    public static List<String> extractParams(String code, String funcName) {
        List<String> params = new ArrayList<>();
        Matcher m = Pattern.compile(
            "def\\s+" + Pattern.quote(funcName) + "\\s*\\(([^)]*)\\)",
            Pattern.MULTILINE
        ).matcher(code);
        if (m.find()) {
            for (String p : m.group(1).split(",")) {
                String clean = p.trim().split(":")[0].trim().split("=")[0].trim();
                if (!clean.isEmpty() && !clean.equals("self") && !clean.equals("cls"))
                    params.add(clean);
            }
        }
        return params;
    }

    public static String extractFunctionBody(String code, String funcName) {
        String[] lines = code.split("\n");
        StringBuilder body = new StringBuilder();
        boolean inFunc = false;
        int funcIndent = -1;

        for (String line : lines) {
            if (!inFunc) {
                Matcher m = Pattern.compile(
                    "^(\\s*)(?:async\\s+)?def\\s+" + Pattern.quote(funcName) + "\\s*\\("
                ).matcher(line);
                if (m.find()) {
                    inFunc = true;
                    funcIndent = m.group(1).length();
                    body.append(line).append("\n");
                }
            } else {
                String trimmed = line.trim();
                if (trimmed.isEmpty() || trimmed.startsWith("#")) {
                    body.append(line).append("\n");
                    continue;
                }
                int indent = 0;
                for (char c : line.toCharArray()) { if (c == ' ') indent++; else break; }
                if (indent <= funcIndent) break;
                body.append(line).append("\n");
            }
        }
        return inFunc ? body.toString() : null;
    }
}
