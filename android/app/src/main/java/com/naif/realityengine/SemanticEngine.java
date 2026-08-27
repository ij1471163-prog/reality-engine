package com.naif.realityengine;

import java.util.*;
import java.util.regex.*;

/**
 * SemanticEngine — محرك فهم المعنى
 * يحلل اسم الدالة والـ parameters ويستنتج النية الحقيقية
 */
public class SemanticEngine {

    // ── نية الدالة ─────────────────────────────────────
    public enum Intent {
        FIND_ONE,        // ابحث عن عنصر واحد
        FIND_MANY,       // ابحث عن عناصر متعددة
        CALCULATE_TOTAL, // احسب مجموع
        CALCULATE_AVG,   // احسب متوسط
        CALCULATE_COUNT, // عدّ
        FIND_BEST,       // أعلى/أفضل عنصر
        FIND_WORST,      // أدنى عنصر
        FILTER,          // فلتر بشرط
        NORMALIZE,       // تنظيف/تنسيق
        VALIDATE,        // تحقق صحة
        SORT,            // ترتيب
        EXISTS,          // هل موجود؟
        TRANSFORM,       // تحويل شكل
        AGGREGATE,       // تجميع + ترتيب
        UNKNOWN
    }

    // ── نتيجة التحليل ──────────────────────────────────
    public static class SemanticResult {
        public Intent intent = Intent.UNKNOWN;
        public double confidence = 0.0;
        public String suggestedCode = null;
        public List<String> evidence = new ArrayList<>();
        public String returnType = "unknown"; // single/list/number/bool/string
        public Map<String, String> paramRoles = new LinkedHashMap<>(); // param → role
    }

    // ── قاموس الكلمات المفتاحية ────────────────────────
    private static final Map<String, Intent> INTENT_WORDS = new LinkedHashMap<>();
    static {
        // FIND_ONE
        for (String w : new String[]{"find","get","fetch","retrieve","lookup","search_one","by_id","by_name"})
            INTENT_WORDS.put(w, Intent.FIND_ONE);

        // FIND_MANY
        for (String w : new String[]{"list","all","getall","fetchall","search","query","filter_by"})
            INTENT_WORDS.put(w, Intent.FIND_MANY);

        // CALCULATE_TOTAL
        for (String w : new String[]{"total","sum","calculate","compute","amount","subtotal","grand"})
            INTENT_WORDS.put(w, Intent.CALCULATE_TOTAL);

        // CALCULATE_AVG
        for (String w : new String[]{"average","avg","mean","median"})
            INTENT_WORDS.put(w, Intent.CALCULATE_AVG);

        // CALCULATE_COUNT
        for (String w : new String[]{"count","num","number","how_many","size"})
            INTENT_WORDS.put(w, Intent.CALCULATE_COUNT);

        // FIND_BEST
        for (String w : new String[]{"best","top","highest","max","maximum","winner","champion","leading"})
            INTENT_WORDS.put(w, Intent.FIND_BEST);

        // FIND_WORST
        for (String w : new String[]{"worst","lowest","min","minimum","bottom","least"})
            INTENT_WORDS.put(w, Intent.FIND_WORST);

        // FILTER
        for (String w : new String[]{"filter","expensive","cheap","active","inactive","available","above","below","between"})
            INTENT_WORDS.put(w, Intent.FILTER);

        // NORMALIZE
        for (String w : new String[]{"normalize","clean","format","sanitize","trim","strip","process"})
            INTENT_WORDS.put(w, Intent.NORMALIZE);

        // VALIDATE
        for (String w : new String[]{"validate","verify","check","is_valid","ensure","assert"})
            INTENT_WORDS.put(w, Intent.VALIDATE);

        // SORT
        for (String w : new String[]{"sort","order","rank","arrange","organize"})
            INTENT_WORDS.put(w, Intent.SORT);

        // EXISTS
        for (String w : new String[]{"exists","has","contains","includes","is_","has_"})
            INTENT_WORDS.put(w, Intent.EXISTS);

        // AGGREGATE
        for (String w : new String[]{"popular","trending","frequent","most_ordered","top_selling","report"})
            INTENT_WORDS.put(w, Intent.AGGREGATE);
    }

    // ── أدوار الـ parameters ────────────────────────────
    private static final Map<String, String> PARAM_ROLES = new LinkedHashMap<>();
    static {
        // Collection roles
        for (String w : new String[]{"users","items","products","orders","records","entries","list","data","collection"})
            PARAM_ROLES.put(w, "collection");

        // Search key roles
        for (String w : new String[]{"username","user_id","id","email","name","key","ref","code","product_id"})
            PARAM_ROLES.put(w, "search_key");

        // Threshold roles
        for (String w : new String[]{"minimum_price","max_price","threshold","limit","min","max","minimum","maximum"})
            PARAM_ROLES.put(w, "threshold");

        // Tier/type roles
        for (String w : new String[]{"tier","type","level","grade","category","class","role"})
            PARAM_ROLES.put(w, "tier");

        // Amount roles
        for (String w : new String[]{"total","amount","price","cost","salary","value","budget"})
            PARAM_ROLES.put(w, "amount");

        // Count roles
        for (String w : new String[]{"limit","n","count","size","top","k"})
            PARAM_ROLES.put(w, "count");
    }

    // ═══════════════════════════════════════════════════
    // التحليل الرئيسي
    // ═══════════════════════════════════════════════════

    public static SemanticResult analyze(String funcName, List<String> params,
                                          CodeIntelligence.IntelligenceResult intel) {
        SemanticResult result = new SemanticResult();
        String n = funcName.toLowerCase();
        String[] tokens = n.split("_");

        // 1. استنتج النية من الكلمات
        Map<Intent, Double> intentScores = new EnumMap<>(Intent.class);
        for (Intent i : Intent.values()) intentScores.put(i, 0.0);

        for (String token : tokens) {
            Intent matched = INTENT_WORDS.get(token);
            if (matched != null) {
                // FIND_BEST و FIND_WORST و CALCULATE_AVG لها أولوية أعلى
                double weight = (matched == Intent.FIND_BEST || matched == Intent.FIND_WORST
                    || matched == Intent.CALCULATE_AVG || matched == Intent.AGGREGATE) ? 0.8 : 0.5;
                intentScores.merge(matched, weight, Double::sum);
                result.evidence.add("token '" + token + "' → " + matched);
            }
            // partial match
            for (Map.Entry<String, Intent> e : INTENT_WORDS.entrySet()) {
                if (token.contains(e.getKey()) || e.getKey().contains(token)) {
                    intentScores.merge(e.getValue(), 0.2, Double::sum);
                }
            }
        }

        // 2. تصنيف الـ parameters
        for (String param : params) {
            String pl = param.toLowerCase();
            String role = PARAM_ROLES.getOrDefault(pl, "unknown");
            if (role.equals("unknown")) {
                // تخمين من الاسم
                if (pl.endsWith("s") && pl.length() > 3) role = "collection";
                else if (pl.endsWith("_id") || pl.endsWith("_ref")) role = "search_key";
                else if (pl.contains("min") || pl.contains("max") || pl.contains("threshold")) role = "threshold";
            }
            result.paramRoles.put(param, role);
        }

        // 3. تعديل النية بناءً على params
        boolean hasCollection = result.paramRoles.containsValue("collection");
        boolean hasSearchKey = result.paramRoles.containsValue("search_key");
        boolean hasThreshold = result.paramRoles.containsValue("threshold");
        boolean hasTier = result.paramRoles.containsValue("tier");
        boolean hasAmount = result.paramRoles.containsValue("amount");

        // لو اسم الدالة يحتوي "average" أو "avg" → CALCULATE_AVG دائماً
        if (n.contains("average") || n.contains("avg") || n.contains("mean")) {
            intentScores.put(Intent.CALCULATE_AVG, 1.0);
            intentScores.put(Intent.CALCULATE_TOTAL, 0.0);
        }

        // لو اسم الدالة يحتوي "best" أو "top" → FIND_BEST دائماً
        if (n.contains("best") || n.contains("highest") || (n.contains("top") && !n.contains("products"))) {
            intentScores.put(Intent.FIND_BEST, 1.0);
            intentScores.put(Intent.FIND_ONE, 0.0);
        }

        // لو اسم الدالة يحتوي "worst" أو "lowest" → FIND_WORST دائماً
        if (n.contains("worst") || n.contains("lowest") || n.contains("minimum_user")) {
            intentScores.put(Intent.FIND_WORST, 1.0);
        }

        // لو اسم الدالة يحتوي "active" → CALCULATE_COUNT
        if (n.contains("active") && n.contains("count")) {
            intentScores.put(Intent.CALCULATE_COUNT, 1.0);
        }

        // لو اسم الدالة يحتوي filter words → FILTER دائماً
        if (n.contains("expensive") || n.contains("cheap") || n.contains("above")
                || n.contains("below") || n.contains("minimum") || n.contains("maximum")
                || (n.contains("filter") && !n.contains("unfilter"))) {
            intentScores.put(Intent.FILTER, 1.0);
            intentScores.put(Intent.FIND_ONE, 0.0);
            intentScores.put(Intent.FIND_MANY, 0.0);
        }

        // لو اسم الدالة يحتوي "search_key → FIND_ONE أقوى
        if (hasSearchKey && hasCollection) {
            intentScores.merge(Intent.FIND_ONE, 0.3, Double::sum);
        }

        // لو اسم الدالة ينتهي بـ s → FIND_MANY
        if (n.endsWith("s") || n.contains("_list") || n.contains("_all")) {
            intentScores.merge(Intent.FIND_MANY, 0.3, Double::sum);
            intentScores.merge(Intent.FIND_ONE, -0.2, Double::sum);
        }

        // لو فيه tier + amount → discount
        if (hasTier && hasAmount) {
            intentScores.put(Intent.CALCULATE_TOTAL, 0.7);
            result.evidence.add("tier + amount → discount calculation");
        }

        // 4. اختر النية الأعلى
        Intent bestIntent = Intent.UNKNOWN;
        double bestScore = 0.1;
        for (Map.Entry<Intent, Double> e : intentScores.entrySet()) {
            if (e.getValue() > bestScore) {
                bestScore = e.getValue();
                bestIntent = e.getKey();
            }
        }

        result.intent = bestIntent;
        result.confidence = Math.min(0.9, bestScore);

        // 5. ولّد الكود المقترح
        result.suggestedCode = generateCode(funcName, params, result, intel);

        return result;
    }

    // ═══════════════════════════════════════════════════
    // توليد الكود بناءً على النية
    // ═══════════════════════════════════════════════════

    private static String generateCode(String funcName, List<String> params,
                                        SemanticResult result,
                                        CodeIntelligence.IntelligenceResult intel) {
        String collParam = getParamByRole(result.paramRoles, "collection");
        String searchParam = getParamByRole(result.paramRoles, "search_key");
        String threshParam = getParamByRole(result.paramRoles, "threshold");
        String tierParam = getParamByRole(result.paramRoles, "tier");
        String amountParam = getParamByRole(result.paramRoles, "amount");
        String countParam = getParamByRole(result.paramRoles, "count");

        // استخرج keys من intel
        CodeIntelligence.DataShape collShape = collParam != null
            ? intel.paramShapes.getOrDefault(collParam, new CodeIntelligence.DataShape())
            : new CodeIntelligence.DataShape();

        String priceKey = findKey(collShape.keys, "price","unit_price","cost","value","salary","amount");
        String qtyKey   = findKey(collShape.keys, "quantity","qty","count","units","num");
        String scoreKey = findKey(collShape.keys, "score","rating","points","rank","grade","level");
        String idKey    = findKey(collShape.keys, "id","username","email","name","ref","code","user_id","product_id");
        String activeKey= findKey(collShape.keys, "active","enabled","is_active","status","available");

        switch (result.intent) {
            case FIND_ONE:
                if (collParam != null && searchParam != null && idKey != null) {
                    // هل الـ searchParam يطابق أحد الـ keys؟
                    String matchKey = idKey;
                    for (String k : collShape.keys) {
                        if (k.equals(searchParam) || searchParam.contains(k) || k.contains(searchParam.replace("_id",""))) {
                            matchKey = k;
                            break;
                        }
                    }
                    return "return next((x for x in " + collParam + " if x.get(\"" + matchKey + "\") == " + searchParam + "), None)";
                }
                if (collParam != null && searchParam != null) {
                    return "return next((x for x in " + collParam + " if x == " + searchParam + "), None)";
                }
                break;

            case FIND_MANY:
                if (collParam != null && searchParam != null && idKey != null) {
                    return "return [x for x in " + collParam + " if x.get(\"" + idKey + "\") == " + searchParam + "]";
                }
                if (collParam != null && activeKey != null) {
                    return "return [x for x in " + collParam + " if x.get(\"" + activeKey + "\")]";
                }
                if (collParam != null) {
                    return "return list(" + collParam + ")";
                }
                break;

            case CALCULATE_TOTAL:
                if (collParam != null && priceKey != null && qtyKey != null) {
                    // لو اسم الدالة يحتوي "order" → ربما cross-collection
                    if (funcName.toLowerCase().contains("order") && !funcName.toLowerCase().contains("total_order")) {
                        return "product = self.get_product(order[\"product_id\"])\n    if not product: return 0\n    return order.get(\"" + qtyKey + "\", 1) * product.get(\"" + priceKey + "\", 0)";
                    }
                    return "return sum(x[\"" + priceKey + "\"] * x.get(\"" + qtyKey + "\", 1) for x in " + collParam + ")";
                }
                if (collParam != null && priceKey != null) {
                    return "return sum(x[\"" + priceKey + "\"] for x in " + collParam + ")";
                }
                // discount calculation
                if (tierParam != null && amountParam != null) {
                    return "rates = {\"gold\": 0.20, \"silver\": 0.10, \"basic\": 0.0}\n    discount = rates.get(" + tierParam + ", 0.0)\n    return " + amountParam + " * (1 - discount)";
                }
                break;

            case CALCULATE_AVG:
                if (collParam != null && priceKey != null) {
                    return "if not " + collParam + ": return 0.0\n    return sum(x[\"" + priceKey + "\"] for x in " + collParam + ") / len(" + collParam + ")";
                }
                if (collParam != null) {
                    return "return sum(" + collParam + ") / len(" + collParam + ") if " + collParam + " else 0.0";
                }
                break;

            case CALCULATE_COUNT:
                if (collParam != null && activeKey != null) {
                    return "return len([x for x in " + collParam + " if x.get(\"" + activeKey + "\")])";
                }
                if (collParam != null) {
                    return "return len(" + collParam + ")";
                }
                break;

            case FIND_BEST:
                if (collParam != null && scoreKey != null) {
                    return "return max(" + collParam + ", key=lambda x: x.get(\"" + scoreKey + "\", 0)) if " + collParam + " else None";
                }
                if (collParam != null && priceKey != null) {
                    return "return max(" + collParam + ", key=lambda x: x.get(\"" + priceKey + "\", 0)) if " + collParam + " else None";
                }
                if (collParam != null) {
                    return "return max(" + collParam + ") if " + collParam + " else None";
                }
                break;

            case FIND_WORST:
                if (collParam != null && scoreKey != null) {
                    return "return min(" + collParam + ", key=lambda x: x.get(\"" + scoreKey + "\", 0)) if " + collParam + " else None";
                }
                break;

            case FILTER:
                if (collParam != null && threshParam != null && priceKey != null) {
                    String op = funcName.toLowerCase().contains("cheap") || funcName.toLowerCase().contains("below") ? "<=" : ">=";
                    return "return [x for x in " + collParam + " if x.get(\"" + priceKey + "\", 0) " + op + " " + threshParam + "]";
                }
                if (collParam != null && activeKey != null) {
                    return "return [x for x in " + collParam + " if x.get(\"" + activeKey + "\")]";
                }
                break;

            case NORMALIZE:
                String p = params.isEmpty() ? "value" : params.get(0);
                return "if not " + p + ": return None\n    return str(" + p + ").strip().lower()";

            case VALIDATE:
                String vp = params.isEmpty() ? "value" : params.get(0);
                if (funcName.contains("email")) {
                    return "import re\n    return bool(re.match(r'^[\\w.+-]+@[\\w.-]+\\.[a-z]{2,}$', str(" + vp + ").lower()))";
                }
                return "return " + vp + " is not None and bool(" + vp + ")";

            case EXISTS:
                if (collParam != null && searchParam != null && idKey != null) {
                    return "return any(x.get(\"" + idKey + "\") == " + searchParam + " for x in " + collParam + ")";
                }
                break;

            case SORT:
                if (collParam != null && scoreKey != null) {
                    return "return sorted(" + collParam + ", key=lambda x: x.get(\"" + scoreKey + "\", 0), reverse=True)";
                }
                if (collParam != null && priceKey != null) {
                    return "return sorted(" + collParam + ", key=lambda x: x.get(\"" + priceKey + "\", 0))";
                }
                break;

            case AGGREGATE:
                if (collParam != null && qtyKey != null && idKey != null) {
                    String lim = countParam != null ? countParam : "5";
                    return "counts = {}\n    for x in " + collParam + ":\n        key = x.get(\"" + idKey + "\")\n        counts[key] = counts.get(key, 0) + x.get(\"" + qtyKey + "\", 1)\n    return sorted(counts, key=counts.get, reverse=True)[:" + lim + "]";
                }
                break;

            default:
                break;
        }

        return null;
    }

    // ── مساعدات ────────────────────────────────────────

    private static String getParamByRole(Map<String, String> roles, String role) {
        for (Map.Entry<String, String> e : roles.entrySet()) {
            if (e.getValue().equals(role)) return e.getKey();
        }
        return null;
    }

    private static String findKey(List<String> keys, String... candidates) {
        for (String c : candidates)
            if (keys.contains(c)) return c;
        return null;
    }
}
