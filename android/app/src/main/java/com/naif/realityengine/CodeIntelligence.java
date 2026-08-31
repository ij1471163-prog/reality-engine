package com.naif.realityengine;

import java.util.*;
import java.util.regex.*;

/**
 * CodeIntelligence v2.1 — إصلاحات:
 * ✅ حذف if(false) dead code
 * ✅ classifyParams تُنادى مرة واحدة فقط
 * ✅ extractFunctionBody يدعم Python + Java + JS
 * ✅ Magic strings → Constants
 * ✅ Regex patterns مُعاد استخدامها (compiled once)
 * ✅ findKey مع confidence ranking
 */
public class CodeIntelligence {

    // ═══════════════════════════════════════════════════
    // Constants — بدل magic strings متكررة
    // ═══════════════════════════════════════════════════

    private static final List<String> KNOWN_COLLECTIONS = Arrays.asList(
        "orders", "products", "users", "items", "records", "entries", "files",
        "purchases", "transactions", "employees", "categories", "tags"
    );

    private static final List<String> PRICE_KEYS = Arrays.asList(
        "price", "unit_price", "cost", "value", "amount", "rate", "salary", "total"
    );

    private static final List<String> QTY_KEYS = Arrays.asList(
        "qty", "quantity", "count", "num", "units", "sales", "amount"
    );

    private static final List<String> ID_KEYS = Arrays.asList(
        "id", "key", "code", "ref", "name", "username", "email"
    );

    private static final List<String> SCORE_KEYS = Arrays.asList(
        "score", "rating", "points", "rank", "level"
    );

    private static final List<String> SCALAR_RATE_WORDS = Arrays.asList(
        "rate", "ratio", "percent", "factor", "discount", "tax", "fee", "limit", "threshold"
    );

    // ═══════════════════════════════════════════════════
    // Compiled Regex Cache
    // ═══════════════════════════════════════════════════

    private static final Pattern PAT_LIST_OF_DICT  = Pattern.compile("(\\w+)\\s*=\\s*\\[\\s*\\{", Pattern.MULTILINE);
    private static final Pattern PAT_DICT_ASSIGN   = Pattern.compile("(\\w+)\\s*=\\s*\\{", Pattern.MULTILINE);
    private static final Pattern PAT_LIST_ASSIGN   = Pattern.compile("(\\w+)\\s*=\\s*\\[", Pattern.MULTILINE);
    private static final Pattern PAT_FOR_IN        = Pattern.compile("for\\s+(\\w+)\\s+in\\s+(\\w+)", Pattern.MULTILINE);
    private static final Pattern PAT_DICT_ACCESS   = Pattern.compile("(\\w+)\\s*\\[\\s*['\"]([^'\"]+)['\"]", Pattern.MULTILINE);
    private static final Pattern PAT_KEYS_IN_DICT  = Pattern.compile("['\"]([\\w_]+)['\"]\\s*:", Pattern.MULTILINE);
    private static final Pattern PAT_FUNC_CALLS    = Pattern.compile("(\\w+)\\s*\\(", Pattern.MULTILINE);
    private static final Pattern PAT_NESTED_DICT   = Pattern.compile("\"(\\w+)\"\\s*:\\s*\\[\\s*\\{([^}]+)\\}");
    private static final Pattern PAT_FIRST_DICT    = Pattern.compile("\\{([^{}]*(?:\\{[^{}]*\\}[^{}]*)*)\\}");

    // ═══════════════════════════════════════════════════
    // Enums & Data Classes
    // ═══════════════════════════════════════════════════

    public enum DataType { LIST_OF_DICT, LIST, DICT, STRING, NUMBER, BOOL, UNKNOWN }

    public enum Language { PYTHON, JAVA, JAVASCRIPT, UNKNOWN }

    public static class Evidence {
        public final String source, detail;
        public final double weight;
        public Evidence(String source, String detail, double weight) {
            this.source = source; this.detail = detail; this.weight = weight;
        }
        @Override public String toString() { return source + ": " + detail + " (+" + weight + ")"; }
    }

    public static class DataShape {
        public DataType      type               = DataType.UNKNOWN;
        public List<String>  keys               = new ArrayList<>();
        public double        heuristicConfidence = 0.0;
        public List<Evidence> evidences         = new ArrayList<>();

        public void addEvidence(String source, String detail, double weight) {
            evidences.add(new Evidence(source, detail, weight));
            heuristicConfidence = Math.min(0.7, heuristicConfidence + weight);
        }
    }

    public static class IntelligenceResult {
        public Map<String, DataShape>   paramShapes     = new LinkedHashMap<>();
        public Map<String, List<String>> callers        = new HashMap<>();
        public Map<String, List<String>> callees        = new HashMap<>();
        public List<String>             listParams      = new ArrayList<>();
        public List<String>             scalarParams    = new ArrayList<>();
        public Map<String, String>      similarFuncs    = new LinkedHashMap<>();
        public double                   similarConfidence = 0.0;
        public String                   bestSuggestion  = null;
        public double                   finalConfidence = 0.0;
        public List<String>             evidenceSummary = new ArrayList<>();
    }

    // ═══════════════════════════════════════════════════
    // Entry Point
    // ═══════════════════════════════════════════════════

    public static IntelligenceResult analyze(String fullCode, String targetFunc) {
        IntelligenceResult result = new IntelligenceResult();
        if (fullCode == null || targetFunc == null) return result;

        List<String> params  = extractParams(fullCode, targetFunc);
        String       body    = extractFunctionBody(fullCode, targetFunc, detectLanguage(fullCode));
        String       scope   = body != null ? body : "";

        // 1. شكل كل parameter
        for (String param : params) {
            result.paramShapes.put(param, buildDataShape(fullCode, scope, param));
        }

        // 2. تصنيف params (مرة واحدة فقط هنا)
        classifyParams(params, result);

        // 3. العلاقات
        analyzeRelationships(fullCode, targetFunc, result);

        // 4. دوال مشابهة
        findSimilarFunctions(fullCode, targetFunc, params, result);

        // 5. اقتراح ذكي
        generateSuggestion(fullCode, targetFunc, params, result);

        return result;
    }

    // ═══════════════════════════════════════════════════
    // Language Detection
    // ═══════════════════════════════════════════════════

    public static Language detectLanguage(String code) {
        if (code == null) return Language.UNKNOWN;
        String c = code.toLowerCase();
        int java = 0, js = 0, py = 0;
        if (c.contains("public ") || c.contains("System.out") || c.contains("import java")) java += 3;
        if (c.contains("@override") || c.contains("new ArrayList"))                         java += 2;
        if (c.contains("const ") || c.contains("let ") || c.contains("console.log"))        js   += 3;
        if (c.contains("=>") || c.contains("document.") || c.contains("async "))            js   += 2;
        if (c.contains("def ") || c.contains("self.") || c.contains("elif "))               py   += 3;
        if (c.contains("print(") || c.contains("import ") || c.contains(":"))               py   += 1;
        int max = Math.max(java, Math.max(js, py));
        if (max == 0)    return Language.UNKNOWN;
        if (java == max) return Language.JAVA;
        if (js   == max) return Language.JAVASCRIPT;
        return Language.PYTHON;
    }

    // ═══════════════════════════════════════════════════
    // DataShape Builder
    // ═══════════════════════════════════════════════════

    private static DataShape buildDataShape(String fullCode, String scope, String param) {
        DataShape shape = new DataShape();
        Map<DataType, Double> scores = new EnumMap<>(DataType.class);
        for (DataType t : DataType.values()) scores.put(t, 0.0);

        String escaped = Pattern.quote(param);

        // ── دليل 1: Assignment ──
        if (Pattern.compile(escaped + "\\s*=\\s*\\[\\s*\\{", Pattern.MULTILINE).matcher(fullCode).find()) {
            scores.merge(DataType.LIST_OF_DICT, 0.6, Double::sum);
            shape.addEvidence("assignment", param + " = [{...}]", 0.6);
        } else if (Pattern.compile(escaped + "\\s*=\\s*\\{", Pattern.MULTILINE).matcher(fullCode).find()) {
            scores.merge(DataType.DICT, 0.5, Double::sum);
            shape.addEvidence("assignment", param + " = {...}", 0.5);
        } else if (Pattern.compile(escaped + "\\s*=\\s*\\[", Pattern.MULTILINE).matcher(fullCode).find()) {
            scores.merge(DataType.LIST, 0.4, Double::sum);
            shape.addEvidence("assignment", param + " = [...]", 0.4);
        }

        // ── دليل 2: Usage ──
        String ctx = scope.isEmpty() ? fullCode : scope;

        Matcher forM = Pattern.compile("for\\s+(\\w+)\\s+in\\s+" + escaped, Pattern.MULTILINE).matcher(ctx);
        if (forM.find()) {
            String iterVar = forM.group(1);
            scores.merge(DataType.LIST, 0.3, Double::sum);
            shape.addEvidence("usage", "for " + iterVar + " in " + param, 0.3);
            if (Pattern.compile(Pattern.quote(iterVar) + "\\s*(?:\\.get\\(|\\[\\s*['\"])", Pattern.MULTILINE).matcher(ctx).find()) {
                scores.merge(DataType.LIST_OF_DICT, 0.4, Double::sum);
                shape.addEvidence("usage", iterVar + "[\"key\"] inside loop", 0.4);
            }
        }
        if (ctx.contains(param + ".get("))    { scores.merge(DataType.DICT,   0.4, Double::sum); shape.addEvidence("usage", param + ".get()", 0.4); }
        if (ctx.contains("len(" + param + ")")) { scores.merge(DataType.LIST, 0.2, Double::sum); shape.addEvidence("usage", "len(" + param + ")", 0.2); }
        if (ctx.contains(param + ".split(") || ctx.contains(param + ".lower(") || ctx.contains(param + ".strip(")) {
            scores.merge(DataType.STRING, 0.5, Double::sum); shape.addEvidence("usage", param + ".split/lower/strip", 0.5);
        }
        if (ctx.contains("int(" + param + ")") || ctx.contains("float(" + param + ")")) {
            scores.merge(DataType.NUMBER, 0.5, Double::sum); shape.addEvidence("usage", "int/float(" + param + ")", 0.5);
        }

        // dict key access
        Matcher dm = Pattern.compile(escaped + "\\s*\\[\\s*['\"]([^'\"]+)['\"]", Pattern.MULTILINE).matcher(ctx);
        while (dm.find()) {
            if (!shape.keys.contains(dm.group(1))) shape.keys.add(dm.group(1));
            scores.merge(DataType.DICT, 0.3, Double::sum);
            shape.addEvidence("usage", param + "[\"" + dm.group(1) + "\"]", 0.3);
        }

        // ── دليل 3: Keys من التعريف ──
        List<String> defKeys = extractKeysFromDefinition(fullCode, param);
        for (String k : defKeys) if (!shape.keys.contains(k)) shape.keys.add(k);
        if (!defKeys.isEmpty()) {
            scores.merge(DataType.LIST_OF_DICT, 0.2, Double::sum);
            shape.addEvidence("definition", "keys: " + defKeys, 0.2);
        }

        // ── اختر النوع الأعلى ──
        DataType best = DataType.UNKNOWN;
        double   bestScore = 0.15;
        for (Map.Entry<DataType, Double> e : scores.entrySet()) {
            if (e.getValue() > bestScore) { bestScore = e.getValue(); best = e.getKey(); }
        }

        // إضافة keys من أي dict في الكود لو list_of_dict بلا keys
        if (best == DataType.LIST_OF_DICT && shape.keys.isEmpty()) {
            Matcher km = PAT_KEYS_IN_DICT.matcher(fullCode);
            while (km.find() && shape.keys.size() < 10)
                if (!shape.keys.contains(km.group(1))) shape.keys.add(km.group(1));
        }

        shape.type = (bestScore >= 0.15) ? best : DataType.UNKNOWN;
        shape.heuristicConfidence = Math.min(0.7, bestScore);
        return shape;
    }

    // ═══════════════════════════════════════════════════
    // Classify Params (مرة واحدة)
    // ═══════════════════════════════════════════════════

    static void classifyParams(List<String> params, IntelligenceResult result) {
        result.listParams.clear();
        result.scalarParams.clear();

        for (String p : params) {
            String pl = p.toLowerCase();
            DataShape shape = result.paramShapes.getOrDefault(p, new DataShape());

            boolean isCollByType = shape.type == DataType.LIST || shape.type == DataType.LIST_OF_DICT;
            boolean isCollByName = KNOWN_COLLECTIONS.contains(pl)
                || (pl.endsWith("s") && pl.length() > 3 && !SCALAR_RATE_WORDS.stream().anyMatch(pl::contains));
            boolean isScalarByName = pl.endsWith("_id") || pl.endsWith("_ref")
                || SCALAR_RATE_WORDS.stream().anyMatch(pl::contains);

            if (isScalarByName) {
                result.scalarParams.add(p);
            } else if (isCollByType || isCollByName) {
                result.listParams.add(p);
            } else {
                result.scalarParams.add(p);
            }
        }
    }

    // ═══════════════════════════════════════════════════
    // Relationships
    // ═══════════════════════════════════════════════════

    private static void analyzeRelationships(String code, String targetFunc,
                                              IntelligenceResult result) {
        // Callers
        Pattern callerPat = Pattern.compile(
            "def\\s+(\\w+)\\s*\\([^)]*\\)[^:]*:[\\s\\S]{0,2000}?" + Pattern.quote(targetFunc) + "\\s*\\(",
            Pattern.MULTILINE);
        List<String> callers = new ArrayList<>();
        Matcher cm = callerPat.matcher(code);
        while (cm.find()) if (!cm.group(1).equals(targetFunc)) callers.add(cm.group(1));
        result.callers.put(targetFunc, callers);

        // Callees
        String body = extractFunctionBody(code, targetFunc, detectLanguage(code));
        if (body != null) {
            Set<String> stdBuiltins = new HashSet<>(Arrays.asList(
                "print","len","str","int","float","list","dict","range","enumerate",
                "zip","map","filter","sorted","sum","max","min","next","iter","open",
                "type","isinstance","bool","set","tuple","hasattr","getattr"
            ));
            Matcher calls = PAT_FUNC_CALLS.matcher(body);
            List<String> callees = new ArrayList<>();
            while (calls.find()) {
                String name = calls.group(1);
                if (!stdBuiltins.contains(name) && !name.equals(targetFunc) && !callees.contains(name))
                    callees.add(name);
            }
            result.callees.put(targetFunc, callees);
        }
    }

    // ═══════════════════════════════════════════════════
    // Similar Functions
    // ═══════════════════════════════════════════════════

    private static void findSimilarFunctions(String code, String targetFunc,
                                              List<String> targetParams,
                                              IntelligenceResult result) {
        Set<String> targetTokens = new HashSet<>(Arrays.asList(targetFunc.toLowerCase().split("_")));

        Pattern allFuncs = Pattern.compile(
            "def\\s+(\\w+)\\s*\\(([^)]*)\\)[^:]*:\\s*\\n((?:[ \\t]+[^\\n]+\\n)+)",
            Pattern.MULTILINE);
        Matcher fm = allFuncs.matcher(code);

        while (fm.find()) {
            String fname = fm.group(1);
            if (fname.equals(targetFunc)) continue;
            String fbody = fm.group(3).trim();
            if (fbody.equals("pass") || fbody.equals("...")) continue;

            // Token similarity
            int commonTokens = 0;
            for (String t : fname.toLowerCase().split("_"))
                if (targetTokens.contains(t) && t.length() > 2) commonTokens++;

            // Param similarity
            List<String> fparams = new ArrayList<>();
            for (String p : fm.group(2).split(",")) {
                String pn = p.trim().split(":")[0].trim().split("=")[0].trim();
                if (!pn.isEmpty() && !pn.equals("self") && !pn.equals("cls"))
                    fparams.add(pn.toLowerCase());
            }
            long commonParams = targetParams.stream().filter(tp -> fparams.contains(tp.toLowerCase())).count();

            double simScore = (commonTokens * 0.3) + (commonParams * 0.25);
            if (simScore >= 0.3 && fbody.length() > 10) {
                result.similarFuncs.put(fname, fbody);
                result.similarConfidence = Math.min(0.5, simScore);
                result.evidenceSummary.add("similar: " + fname + " (tokens=" + commonTokens + ", params=" + commonParams + ")");
            }
        }
    }

    // ═══════════════════════════════════════════════════
    // Suggestion Generator
    // ═══════════════════════════════════════════════════

    private static void generateSuggestion(String code, String funcName,
                                            List<String> params, IntelligenceResult result) {
        if (params.isEmpty()) return;

        // classifyParams سبق استُدعيت في analyze() — نستخدم النتيجة مباشرة
        String collectionParam = result.listParams.isEmpty() ? params.get(0) : result.listParams.get(0);
        String scalarParam     = result.scalarParams.isEmpty()
            ? (params.size() > 1 ? params.get(1) : "value")
            : result.scalarParams.get(0);

        DataShape collShape = result.paramShapes.getOrDefault(collectionParam, new DataShape());
        String n = funcName.toLowerCase();

        Map<String, List<String>> nestedKeys = new LinkedHashMap<>();
        for (String lp : result.listParams) nestedKeys.putAll(extractNestedKeys(code, lp));
        for (String cn : KNOWN_COLLECTIONS) {
            if (code.contains(cn + " =") || code.contains(cn + "="))
                nestedKeys.putAll(extractNestedKeys(code, cn));
        }

        List<String> topKeys  = nestedKeys.getOrDefault("__top__", collShape.keys);
        List<String> itemKeys = nestedKeys.getOrDefault("items", new ArrayList<>());

        boolean returnsCollection = n.endsWith("s") || n.contains("_list") || n.contains("_all")
            || KNOWN_COLLECTIONS.stream().anyMatch(n::contains)
            || n.contains("filter") || n.contains("search") || n.contains("top");

        // ── get/find/fetch entity ──
        String targetEntity = null, explicitCollection = null;
        String[] nParts = funcName.split("_");
        for (String part : nParts)
            for (String coll : KNOWN_COLLECTIONS)
                if (part.equals(coll)) { explicitCollection = coll; break; }
        for (String part : nParts)
            if (!Arrays.asList("get","find","fetch","search","calculate","apply","set","add","list","all").contains(part)
                && part.length() > 2 && !part.equals(explicitCollection)) { targetEntity = part; break; }

        // resolve entity → collection
        if (targetEntity != null && !result.scalarParams.isEmpty()
                && (n.startsWith("get_") || n.startsWith("find_") || n.startsWith("fetch_"))) {
            String searchParam = result.scalarParams.get(0);
            String entityColl = null; DataShape entityShape = null;
            final String te = targetEntity;
            for (String lp : result.listParams) {
                if (lp.contains(te) || te.contains(lp.replace("s","")) || lp.equals(te+"s") || lp.equals(te+"es")) {
                    entityColl = lp; entityShape = result.paramShapes.get(lp); break;
                }
            }
            if (entityShape == null && result.paramShapes.containsKey(te + "s")) {
                entityColl = te + "s"; entityShape = result.paramShapes.get(entityColl);
            }
            if (entityShape == null) {
                for (Map.Entry<String, DataShape> e : result.paramShapes.entrySet()) {
                    if (e.getKey().contains(te) || te.contains(e.getKey().replace("s",""))) {
                        entityColl = e.getKey(); entityShape = e.getValue(); break;
                    }
                }
            }
            if (entityShape != null && entityShape.type == DataType.LIST_OF_DICT) {
                List<String> idCandidates = new ArrayList<>(ID_KEYS);
                idCandidates.add(0, te + "_id");
                String idKey = findKeyRanked(entityShape.keys, idCandidates);
                if (idKey != null) {
                    result.bestSuggestion = returnsCollection
                        ? "return [x for x in self." + entityColl + " if x.get(\"" + idKey + "\") == " + searchParam + "]"
                        : "return next((x for x in self." + entityColl + " if x.get(\"" + idKey + "\") == " + searchParam + "), None)";
                    result.finalConfidence = 0.65;
                    result.evidenceSummary.add("entity: " + te + " → " + entityColl + "." + idKey);
                    return;
                }
            }
        }

        // explicit collection
        if (explicitCollection != null && !result.scalarParams.isEmpty()) {
            DataShape ds = result.paramShapes.get(explicitCollection);
            if (ds != null && ds.type == DataType.LIST_OF_DICT) {
                String searchParam = result.scalarParams.get(0);
                List<String> linkCandidates = new ArrayList<>(Arrays.asList(searchParam, searchParam + "_id"));
                if (targetEntity != null) linkCandidates.add(targetEntity + "_id");
                linkCandidates.add("owner_id");
                String linkKey = findKeyRanked(ds.keys, linkCandidates);
                if (linkKey != null) {
                    result.bestSuggestion = "return [x for x in self." + explicitCollection
                        + " if x.get(\"" + linkKey + "\") == " + searchParam + "]";
                    result.finalConfidence = 0.68;
                    result.evidenceSummary.add("explicit: " + explicitCollection + "." + linkKey);
                    return;
                }
            }
        }

        // total / calculate / sum
        if (n.contains("total") || n.contains("calculate") || n.contains("sum")) {
            if (collShape.type == DataType.LIST_OF_DICT && collShape.heuristicConfidence >= 0.3) {
                String priceKey = findKeyRanked(collShape.keys, PRICE_KEYS);
                String qtyKey   = findKeyRanked(collShape.keys, QTY_KEYS);
                if (priceKey != null && qtyKey != null && !priceKey.equals(qtyKey)) {
                    result.bestSuggestion = "return sum(x[\"" + priceKey + "\"] * x[\"" + qtyKey + "\"] for x in " + collectionParam + ")";
                    result.finalConfidence = 0.65;
                } else if (priceKey != null) {
                    result.bestSuggestion = "return sum(x[\"" + priceKey + "\"] for x in " + collectionParam + ")";
                    result.finalConfidence = 0.60;
                } else {
                    result.bestSuggestion = "return sum(x.get(\"value\", 0) for x in " + collectionParam + ")  # تحقق من اسم الـ key";
                    result.finalConfidence = 0.30;
                }
                return;
            }
        }

        // filter / search / find in list_of_dict
        if (collShape.type == DataType.LIST_OF_DICT && collShape.heuristicConfidence >= 0.3) {
            boolean isFilter = n.contains("expensive") || n.contains("cheap") || n.contains("filter")
                || n.contains("active") || n.contains("above") || n.contains("below");
            boolean hasThreshold = scalarParam.toLowerCase().matches(".*(min|max|price|threshold|limit).*");

            if (isFilter || hasThreshold) {
                String priceK = findKeyRanked(collShape.keys, PRICE_KEYS);
                if (priceK != null) {
                    String op = (n.contains("cheap") || n.contains("below")) ? "<=" : ">=";
                    result.bestSuggestion = "return [x for x in " + collectionParam + " if x.get(\"" + priceK + "\", 0) " + op + " " + scalarParam + "]";
                    result.finalConfidence = Math.min(0.65, collShape.heuristicConfidence + 0.1);
                    return;
                }
            }
            if (n.contains("find") || n.contains("search") || n.contains("get")) {
                String idKey = findKeyRanked(collShape.keys, ID_KEYS);
                if (idKey != null) {
                    result.bestSuggestion = "return next((x for x in " + collectionParam + " if x.get(\"" + idKey + "\") == " + scalarParam + "), None)";
                    result.finalConfidence = Math.min(0.65, collShape.heuristicConfidence + 0.1);
                } else {
                    result.bestSuggestion = "return next((x for x in " + collectionParam + " if x == " + scalarParam + "), None)";
                    result.finalConfidence = 0.30;
                }
                return;
            }
            if (n.contains("count")) {
                result.bestSuggestion = "return len([x for x in " + collectionParam + " if x])";
                result.finalConfidence = 0.50;
                return;
            }
        }

        // list عادي
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

        // discount / tax
        if (n.contains("discount") || n.contains("tax") || n.contains("rate") || n.contains("fee")) {
            String tierParam = null, amountParam = null;
            for (String p : params) {
                String pl = p.toLowerCase();
                if (Arrays.asList("tier","type","level","class","grade","rank").stream().anyMatch(pl::contains)) tierParam = p;
                else if (PRICE_KEYS.stream().anyMatch(pl::contains) || pl.contains("total") || pl.contains("sum")) amountParam = p;
            }
            if (tierParam != null && amountParam != null) {
                result.bestSuggestion = "rates = {\"gold\": 0.20, \"silver\": 0.10, \"basic\": 0.0}\n"
                    + "    rate = rates.get(" + tierParam + ", 0.0)\n"
                    + "    return " + amountParam + " * (1 - rate)";
                result.finalConfidence = 0.65;
                return;
            }
        }

        // best / top single
        if ((n.contains("best") || n.contains("top")) && !result.listParams.isEmpty()) {
            String cp = result.listParams.get(0);
            String sk = findKeyRanked(result.paramShapes.getOrDefault(cp, new DataShape()).keys, SCORE_KEYS);
            if (sk != null) {
                result.bestSuggestion = "return max(" + cp + ", key=lambda x: x.get(\"" + sk + "\", 0)) if " + cp + " else None";
                result.finalConfidence = 0.68;
                return;
            }
        }

        // aggregation / top by quantity with optional cross-join
        if (n.contains("top") || n.contains("popular") || n.contains("most") || n.contains("highest") || n.contains("lowest")) {
            String aggColl = null, aggQtyKey = null, aggIdKey = null;
            for (Map.Entry<String, DataShape> e : result.paramShapes.entrySet()) {
                DataShape ds = e.getValue();
                if (ds.type != DataType.LIST_OF_DICT) continue;
                String qk = findKeyRanked(ds.keys, QTY_KEYS);
                String ik = findKeyRanked(ds.keys, Arrays.asList("product_id","item_id","category_id","tag_id","key","code","name"));
                if (qk != null && ik != null) { aggColl = e.getKey(); aggQtyKey = qk; aggIdKey = ik; break; }
            }
            String limitParam = params.stream().filter(p -> p.matches("limit|n|top|count")).findFirst().orElse("5");

            if (aggColl != null) {
                // Cross-collection join?
                String fkEntity = aggIdKey.replaceAll("_id$|_ref$|_key$", "");
                for (Map.Entry<String, DataShape> e2 : result.paramShapes.entrySet()) {
                    if (e2.getKey().equals(aggColl)) continue;
                    DataShape ds2 = e2.getValue();
                    if (ds2.type != DataType.LIST_OF_DICT) continue;
                    String jik = findKeyRanked(ds2.keys, Arrays.asList("id", fkEntity+"_id", "ref", "code", "key"));
                    String jpk = findKeyRanked(ds2.keys, PRICE_KEYS);
                    if (jik != null && jpk != null) {
                        String iterVar = aggColl.replaceAll("s$", "");
                        result.bestSuggestion = "totals = {}\n"
                            + "    for " + iterVar + " in self." + aggColl + ":\n"
                            + "        item = next((x for x in self." + e2.getKey() + " if x.get(\"" + jik + "\") == " + iterVar + ".get(\"" + aggIdKey + "\")), None)\n"
                            + "        if item:\n"
                            + "            key = " + iterVar + ".get(\"" + aggIdKey + "\")\n"
                            + "            totals[key] = totals.get(key, 0) + " + iterVar + ".get(\"" + aggQtyKey + "\", 1) * item.get(\"" + jpk + "\", 0)\n"
                            + "    return sorted(totals.items(), key=lambda x: x[1], reverse=True)[:" + limitParam + "]";
                        result.finalConfidence = 0.68;
                        result.evidenceSummary.add("cross-join: " + aggColl + " → " + e2.getKey());
                        return;
                    }
                }
                // Simple aggregation
                result.bestSuggestion = "counts = {}\n"
                    + "    for x in self." + aggColl + ":\n"
                    + "        key = x.get(\"" + aggIdKey + "\")\n"
                    + "        counts[key] = counts.get(key, 0) + x.get(\"" + aggQtyKey + "\", 1)\n"
                    + "    return sorted(counts, key=counts.get, reverse=" + (!n.contains("lowest") ? "True" : "False") + ")[:" + limitParam + "]";
                result.finalConfidence = 0.62;
                return;
            }
        }

        // normalize / clean / format
        if (n.contains("normalize") || n.contains("clean") || n.contains("format") || n.contains("sanitize")) {
            String sp = params.isEmpty() ? "value" : params.get(0);
            result.bestSuggestion = "if not " + sp + ": return None\n    return str(" + sp + ").strip().lower()";
            result.finalConfidence = 0.55;
            return;
        }

        // similar function pattern — فقط لو confidence عالية كافية
        if (!result.similarFuncs.isEmpty() && result.similarConfidence >= 0.45) {
            Map.Entry<String, String> sim = result.similarFuncs.entrySet().iterator().next();
            result.bestSuggestion = "# نمط مشابه لـ " + sim.getKey() + "()\n" + sim.getValue();
            result.finalConfidence = result.similarConfidence;
            result.evidenceSummary.add("similar fallback: " + sim.getKey());
            return;
        }

        // لا اقتراح موثوق
        result.bestSuggestion = null;
        result.finalConfidence = 0.0;
        result.evidenceSummary.add("لا يوجد دليل كافٍ — يُفضّل مراجعة يدوية");
    }

    // ═══════════════════════════════════════════════════
    // findKey مع Confidence Ranking
    // ═══════════════════════════════════════════════════

    /**
     * يرجع أول key موجود في القائمة بحسب الأولوية (أعلى أولوية = index أصغر)
     */
    static String findKeyRanked(List<String> keys, List<String> candidates) {
        for (String c : candidates)
            if (keys.contains(c)) return c;
        return null;
    }

    /** Legacy overload للتوافق */
    static String findKey(List<String> keys, String... candidates) {
        return findKeyRanked(keys, Arrays.asList(candidates));
    }

    // ═══════════════════════════════════════════════════
    // extractFunctionBody — Python + Java + JS
    // ═══════════════════════════════════════════════════

    public static String extractFunctionBody(String code, String funcName, Language lang) {
        if (code == null || funcName == null) return null;

        if (lang == Language.JAVA || lang == Language.JAVASCRIPT) {
            return extractBraceBody(code, funcName);
        }
        return extractIndentBody(code, funcName);
    }

    /** Python: indentation-based */
    private static String extractIndentBody(String code, String funcName) {
        String[] lines = code.split("\n");
        StringBuilder body = new StringBuilder();
        boolean inFunc = false;
        int funcIndent = -1;

        for (String line : lines) {
            if (!inFunc) {
                Matcher m = Pattern.compile("^(\\s*)(?:async\\s+)?def\\s+" + Pattern.quote(funcName) + "\\s*\\(").matcher(line);
                if (m.find()) { inFunc = true; funcIndent = m.group(1).length(); body.append(line).append("\n"); }
            } else {
                if (line.trim().isEmpty() || line.trim().startsWith("#")) { body.append(line).append("\n"); continue; }
                int indent = 0;
                for (char c : line.toCharArray()) { if (c == ' ') indent++; else break; }
                if (indent <= funcIndent) break;
                body.append(line).append("\n");
            }
        }
        return inFunc ? body.toString() : null;
    }

    /** Java/JS: brace-counting */
    private static String extractBraceBody(String code, String funcName) {
        Pattern funcPat = Pattern.compile(
            "(?:public|private|protected|static|\\basync\\b|\\bfunction\\b)?[^\\n]*\\b" + Pattern.quote(funcName) + "\\s*\\([^)]*\\)[^{]*\\{",
            Pattern.MULTILINE
        );
        Matcher m = funcPat.matcher(code);
        if (!m.find()) return null;

        int start = m.end() - 1;
        int depth = 0;
        boolean inStr = false; char strCh = 0;
        StringBuilder body = new StringBuilder();

        for (int i = start; i < code.length(); i++) {
            char c = code.charAt(i);
            body.append(c);
            if (inStr) { if (c == strCh && (i == 0 || code.charAt(i-1) != '\\')) inStr = false; continue; }
            if (c == '"' || c == '\'') { inStr = true; strCh = c; continue; }
            if (c == '{') depth++;
            else if (c == '}') { depth--; if (depth == 0) break; }
        }
        return body.toString();
    }

    // ═══════════════════════════════════════════════════
    // Nested Keys
    // ═══════════════════════════════════════════════════

    static Map<String, List<String>> extractNestedKeys(String code, String var) {
        Map<String, List<String>> result = new LinkedHashMap<>();
        Matcher am = Pattern.compile("\\b" + Pattern.quote(var) + "\\s*=\\s*\\[", Pattern.MULTILINE).matcher(code);
        if (!am.find()) return result;
        String block = code.substring(am.start());

        Matcher dm = PAT_FIRST_DICT.matcher(block);
        if (dm.find()) {
            List<String> topKeys = new ArrayList<>();
            Matcher km = PAT_KEYS_IN_DICT.matcher(dm.group(1));
            while (km.find()) topKeys.add(km.group(1));
            result.put("__top__", topKeys);
        }
        Matcher nm = PAT_NESTED_DICT.matcher(block);
        while (nm.find()) {
            List<String> nk = new ArrayList<>();
            Matcher nkm = PAT_KEYS_IN_DICT.matcher(nm.group(2));
            while (nkm.find()) nk.add(nkm.group(1));
            result.put(nm.group(1), nk);
        }
        return result;
    }

    // ═══════════════════════════════════════════════════
    // extractParams & extractKeysFromDefinition
    // ═══════════════════════════════════════════════════

    public static List<String> extractParams(String code, String funcName) {
        List<String> params = new ArrayList<>();
        Matcher m = Pattern.compile(
            "def\\s+" + Pattern.quote(funcName) + "\\s*\\(([^)]*)\\)", Pattern.MULTILINE
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

    private static List<String> extractKeysFromDefinition(String code, String varName) {
        List<String> keys = new ArrayList<>();
        Matcher mat = Pattern.compile(
            Pattern.quote(varName) + "\\s*=\\s*[\\[\\{][\\s\\S]{0,800}?[\\]\\}]", Pattern.MULTILINE
        ).matcher(code);
        if (mat.find()) {
            Matcher km = PAT_KEYS_IN_DICT.matcher(mat.group());
            while (km.find() && keys.size() < 15)
                if (!keys.contains(km.group(1))) keys.add(km.group(1));
        }
        return keys;
    }
}
