package com.naif.realityengine;

import java.util.*;
import java.util.regex.*;

/**
 * IntentAnalyzer — يفهم نية الدالة من:
 * 1. اسم الدالة (fallback)
 * 2. محتوى الكود داخلها
 * 3. المعاملات (parameters)
 * 4. العمليات التي تنفذها
 *
 * يبني على SemanticEngine + ContextAnalyzer الموجودين.
 */
public class IntentAnalyzer {

    public static class IntentResult {
        public String intent;           // النية المكتشفة
        public double confidence;       // 0.0 - 1.0
        public String source;           // "semantic" | "context" | "fallback"
        public List<String> evidence = new ArrayList<>(); // أدلة الاستنتاج

        public IntentResult(String intent, double confidence, String source) {
            this.intent = intent;
            this.confidence = confidence;
            this.source = source;
        }

        @Override public String toString() {
            return intent + " (" + String.format("%.0f", confidence * 100) + "%) [" + source + "]";
        }
    }

    // ─── Patterns للكشف من محتوى الكود ──────────────────
    private static final Map<String, String[]> CODE_PATTERNS = new LinkedHashMap<>();
    static {
        CODE_PATTERNS.put("أمان/تشفير",   new String[]{"encrypt","decrypt","hash","bcrypt","sha","md5","hmac","jwt","token","sign","verify"});
        CODE_PATTERNS.put("قاعدة بيانات", new String[]{"SELECT","INSERT","UPDATE","DELETE","query","execute","cursor","db\\.","database","sql","sqlite"});
        CODE_PATTERNS.put("شبكة/API",     new String[]{"fetch\\(","http","axios","request","response","url","endpoint","api","socket"});
        CODE_PATTERNS.put("ملف/تخزين",   new String[]{"File","readFile","writeFile","open\\(","close\\(","read\\(","write\\(","stream","FileWriter","FileReader"});
        CODE_PATTERNS.put("واجهة المستخدم", new String[]{"innerHTML","textContent","document\\.","element","render","view","display","show","hide","DOM"});
        CODE_PATTERNS.put("تحقق/تحليل",  new String[]{"validate","check","verify","assert","test","match","pattern","regex","parse"});
        CODE_PATTERNS.put("حساب/معالجة", new String[]{"sum\\(","total","average","count","calculate","compute","Math\\.","reduce","map\\(","filter\\("});
        CODE_PATTERNS.put("إرسال/تسليم", new String[]{"send","emit","publish","notify","email","message","push","broadcast"});
        CODE_PATTERNS.put("جلب بيانات",  new String[]{"get","fetch","load","retrieve","find","search","select","read"});
        CODE_PATTERNS.put("تحويل بيانات",new String[]{"convert","transform","format","serialize","deserialize","encode","decode","parse","stringify"});
    }

    // ─── مصادر البيانات الخطرة ─────────────────────────
    private static final String[] SENSITIVE_SOURCES = {
        "user_input","request\\.body","req\\.body","getParam","getQuery",
        "getIntent\\(","editText","input\\.","form\\.","$_GET","$_POST","$_REQUEST",
        "System\\.in","Scanner","BufferedReader","readline"
    };

    /**
     * التحليل الرئيسي — يدمج SemanticEngine + تحليل محتوى + fallback
     */
    public static IntentResult analyze(String funcName, List<String> params, String funcBody) {

        // 1. SemanticEngine — الأقوى
        try {
            SemanticEngine.SemanticResult sem = SemanticEngine.analyze(
                funcName, params,
                CodeIntelligence.analyze(funcBody != null ? funcBody : "", funcName)
            );
            if (sem != null && sem.intent != SemanticEngine.Intent.UNKNOWN && sem.confidence >= 0.5) {
                IntentResult r = new IntentResult(
                    intentToArabic(sem.intent.name()),
                    sem.confidence,
                    "semantic"
                );
                r.evidence.add("SemanticEngine: " + sem.intent.name());
                return r;
            }
        } catch (Exception ignored) {}

        // 2. تحليل محتوى الكود
        if (funcBody != null && !funcBody.isEmpty()) {
            IntentResult contentResult = analyzeFromContent(funcBody);
            if (contentResult != null && contentResult.confidence >= 0.6) {
                return contentResult;
            }
        }

        // 3. ContextAnalyzer — تتبع تدفق البيانات
        try {
            ContextAnalyzer.CodeContext ctx = ContextAnalyzer.analyze(
                funcBody != null ? funcBody : "", funcName
            );
            if (ctx != null && !ctx.flowNodes.isEmpty()) {
                IntentResult r = analyzeFromFlowNodes(ctx);
                if (r != null && r.confidence >= 0.5) return r;
            }
        } catch (Exception ignored) {}

        // 4. Fallback — اسم الدالة فقط
        return fallbackFromName(funcName);
    }

    // ─── تحليل من محتوى الكود ────────────────────────────
    private static IntentResult analyzeFromContent(String code) {
        String lower = code.toLowerCase();
        Map<String, Integer> scores = new LinkedHashMap<>();

        for (Map.Entry<String, String[]> entry : CODE_PATTERNS.entrySet()) {
            int score = 0;
            for (String kw : entry.getValue()) {
                Pattern p = Pattern.compile(kw, Pattern.CASE_INSENSITIVE);
                Matcher m = p.matcher(code);
                while (m.find()) score++;
            }
            if (score > 0) scores.put(entry.getKey(), score);
        }

        if (scores.isEmpty()) return null;

        String best = Collections.max(scores.entrySet(), Map.Entry.comparingByValue()).getKey();
        int maxScore = scores.get(best);
        int total = scores.values().stream().mapToInt(i->i).sum();
        double confidence = Math.min(0.95, (double) maxScore / Math.max(total, 1) + 0.3);

        IntentResult r = new IntentResult(best, confidence, "context");
        r.evidence.add("Keyword matches: " + maxScore + "/" + total);

        // هل يحتوي على بيانات حساسة؟
        for (String src : SENSITIVE_SOURCES) {
            if (Pattern.compile(src, Pattern.CASE_INSENSITIVE).matcher(code).find()) {
                r.evidence.add("⚠️ Sensitive source: " + src);
                r.confidence = Math.min(0.95, r.confidence + 0.1);
            }
        }

        return r;
    }

    // ─── تحليل من FlowNodes ───────────────────────────────
    private static IntentResult analyzeFromFlowNodes(ContextAnalyzer.CodeContext ctx) {
        boolean hasSink = false, hasSource = false;
        for (ContextAnalyzer.FlowNode node : ctx.flowNodes) {
            if (node.role != null) {
                if (node.role.contains("sink"))   hasSink   = true;
                if (node.role.contains("source")) hasSource = true;
            }
        }

        if (hasSource && hasSink) {
            IntentResult r = new IntentResult("تدفق بيانات (Source→Sink)", 0.75, "flow");
            r.evidence.add("FlowNodes: " + ctx.flowNodes.size());
            return r;
        }
        return null;
    }

    // ─── Fallback — اسم الدالة ──────────────────────────
    private static IntentResult fallbackFromName(String name) {
        String n = name.toLowerCase();
        String intent = "غير محدد";
        double confidence = 0.3;

        if (n.matches("^(is_|has_|can_|check_|verify_|validate_).*")) { intent = "تحقق من صحة"; confidence = 0.5; }
        else if (n.contains("encrypt") || n.contains("hash"))           { intent = "تشفير"; confidence = 0.6; }
        else if (n.contains("calculate") || n.contains("compute"))      { intent = "حساب"; confidence = 0.6; }
        else if (n.contains("read") || n.contains("load"))              { intent = "قراءة"; confidence = 0.5; }
        else if (n.contains("write") || n.contains("save"))             { intent = "كتابة"; confidence = 0.5; }
        else if (n.contains("send") || n.contains("email"))             { intent = "إرسال"; confidence = 0.5; }
        else if (n.contains("get") || n.contains("fetch"))              { intent = "جلب بيانات"; confidence = 0.4; }
        else if (n.contains("delete") || n.contains("remove"))          { intent = "حذف"; confidence = 0.5; }
        else if (n.contains("create") || n.contains("build"))           { intent = "إنشاء"; confidence = 0.5; }
        else if (n.contains("find") || n.contains("search"))            { intent = "بحث"; confidence = 0.5; }

        IntentResult r = new IntentResult(intent, confidence, "fallback");
        r.evidence.add("Function name: " + name);
        return r;
    }

    // ─── ترجمة SemanticEngine.Intent → عربي ──────────────
    private static String intentToArabic(String intentName) {
        switch (intentName) {
            case "FIND_ONE":       return "جلب عنصر واحد";
            case "FIND_MANY":      return "جلب عناصر متعددة";
            case "CALCULATE_TOTAL":return "حساب المجموع";
            case "CALCULATE_AVG":  return "حساب المتوسط";
            case "CALCULATE_COUNT":return "عدّ العناصر";
            case "FIND_BEST":      return "إيجاد الأفضل";
            case "FIND_WORST":     return "إيجاد الأدنى";
            case "FILTER":         return "تصفية بيانات";
            case "NORMALIZE":      return "تنظيف/تنسيق";
            case "VALIDATE":       return "تحقق من صحة";
            case "SORT":           return "ترتيب";
            case "EXISTS":         return "التحقق من الوجود";
            case "TRANSFORM":      return "تحويل بيانات";
            case "AGGREGATE":      return "تجميع وترتيب";
            default:               return "غير محدد";
        }
    }
}
