package com.naif.realityengine;

import java.util.*;
import java.util.regex.*;

/**
 * DataFlowAnalyzer — يتتبع تدفق البيانات داخل الكود:
 * Source → Variable → Function → Transformation → Sink
 *
 * يبني على ContextAnalyzer.FlowNode الموجود.
 */
public class DataFlowAnalyzer {

    // ─── أنواع المصادر ───────────────────────────────────
    public enum SourceType {
        USER_INPUT,    // مدخلات المستخدم
        NETWORK,       // بيانات الشبكة/API
        DATABASE,      // قاعدة البيانات
        FILE,          // ملف
        ENVIRONMENT,   // متغيرات البيئة
        UNKNOWN
    }

    // ─── أنواع المصارف (Sinks) ────────────────────────────
    public enum SinkType {
        DATABASE,      // حفظ في قاعدة البيانات
        HTML_OUTPUT,   // عرض في HTML/WebView
        NETWORK,       // إرسال عبر الشبكة
        FILE,          // كتابة في ملف
        LOG,           // تسجيل (logging)
        EXEC,          // تنفيذ أمر
        UNKNOWN
    }

    // ─── نقطة تدفق ───────────────────────────────────────
    public static class FlowPoint {
        public String variable;     // اسم المتغير
        public String expression;   // التعبير الكامل
        public int line;
        public String role;         // "source" | "transform" | "sink"
        public double confidence;

        public FlowPoint(String variable, String expression, int line, String role, double confidence) {
            this.variable   = variable;
            this.expression = expression;
            this.line       = line;
            this.role       = role;
            this.confidence = confidence;
        }
    }

    // ─── مسار تدفق كامل ──────────────────────────────────
    public static class DataFlow {
        public SourceType source   = SourceType.UNKNOWN;
        public SinkType   sink     = SinkType.UNKNOWN;
        public List<FlowPoint> chain = new ArrayList<>(); // Source→...→Sink
        public double confidence   = 0.0;
        public boolean isTainted   = false; // هل البيانات ملوثة؟
        public List<String> warnings = new ArrayList<>();

        @Override public String toString() {
            return source + " → " + sink
                + " (conf:" + String.format("%.0f", confidence * 100) + "%"
                + (isTainted ? " ⚠️TAINTED" : "") + ")";
        }
    }

    // ─── نتيجة التحليل الكاملة ───────────────────────────
    public static class DataFlowResult {
        public List<DataFlow>  flows    = new ArrayList<>();
        public List<String>    sources  = new ArrayList<>();
        public List<String>    sinks    = new ArrayList<>();
        public List<String>    warnings = new ArrayList<>();
        public int             taintedCount = 0;
    }

    // ─── Patterns المصادر ────────────────────────────────
    private static final Map<SourceType, String[]> SOURCE_PATTERNS = new EnumMap<>(SourceType.class);
    static {
        SOURCE_PATTERNS.put(SourceType.USER_INPUT, new String[]{
            "request\\.body", "req\\.body", "request\\.params", "req\\.params",
            "request\\.query", "req\\.query", "\\$_GET", "\\$_POST", "\\$_REQUEST",
            "getParam\\(", "getQueryParam\\(", "EditText", "getText\\(", "input\\.value",
            "location\\.hash", "location\\.search", "document\\.cookie",
            "getIntent\\(\\)\\.get", "getStringExtra", "getIntExtra",
            "System\\.in", "Scanner\\(", "readLine\\("
        });
        SOURCE_PATTERNS.put(SourceType.NETWORK, new String[]{
            "fetch\\(", "axios\\.", "http\\.", "https\\.", "XMLHttpRequest",
            "response\\.json", "response\\.text", "response\\.data",
            "HttpURLConnection", "OkHttpClient", "Retrofit", "volley"
        });
        SOURCE_PATTERNS.put(SourceType.DATABASE, new String[]{
            "cursor\\.getString", "cursor\\.getInt", "resultSet\\.get",
            "db\\.query", "executeQuery\\(", "fetchOne\\(", "fetchAll\\(",
            "findOne\\(", "findAll\\(", "SELECT"
        });
        SOURCE_PATTERNS.put(SourceType.FILE, new String[]{
            "readFile\\(", "fs\\.read", "FileReader", "BufferedReader",
            "FileInputStream", "openFileInput\\("
        });
        SOURCE_PATTERNS.put(SourceType.ENVIRONMENT, new String[]{
            "process\\.env", "System\\.getenv\\(", "os\\.environ", "getenv\\("
        });
    }

    // ─── Patterns المصارف ────────────────────────────────
    private static final Map<SinkType, String[]> SINK_PATTERNS = new EnumMap<>(SinkType.class);
    static {
        SINK_PATTERNS.put(SinkType.DATABASE, new String[]{
            "db\\.query\\(", "execute\\(", "INSERT", "UPDATE", "DELETE",
            "save\\(", "insert\\(", "update\\(", "execSQL\\("
        });
        SINK_PATTERNS.put(SinkType.HTML_OUTPUT, new String[]{
            "innerHTML", "outerHTML", "document\\.write", "insertAdjacentHTML",
            "loadUrl\\(", "loadData\\(", "evaluateJavascript\\(",
            "webView\\.load", "setText\\(", "setHtml"
        });
        SINK_PATTERNS.put(SinkType.NETWORK, new String[]{
            "fetch\\(", "axios\\.post", "axios\\.put", "http\\.post",
            "send\\(", "emit\\(", "publish\\(", "HttpURLConnection.*output"
        });
        SINK_PATTERNS.put(SinkType.FILE, new String[]{
            "writeFile\\(", "fs\\.write", "FileWriter", "BufferedWriter",
            "FileOutputStream", "openFileOutput\\("
        });
        SINK_PATTERNS.put(SinkType.LOG, new String[]{
            "console\\.log", "console\\.error", "Log\\.d", "Log\\.e",
            "print\\(", "System\\.out\\.print", "logger\\."
        });
        SINK_PATTERNS.put(SinkType.EXEC, new String[]{
            "eval\\(", "exec\\(", "Runtime\\.getRuntime\\(\\)\\.exec",
            "os\\.system", "subprocess", "ProcessBuilder", "shell_exec"
        });
    }

    /**
     * التحليل الرئيسي
     */
    public static DataFlowResult analyze(String code, String fileName) {
        DataFlowResult result = new DataFlowResult();
        if (code == null || code.isEmpty()) return result;

        String[] lines = code.split("\n");

        // 1. اكتشف المصادر
        List<FlowPoint> sourcePoints = detectSources(lines);
        // 2. اكتشف المصارف
        List<FlowPoint> sinkPoints = detectSinks(lines);

        // 3. بناء مسارات التدفق
        for (FlowPoint src : sourcePoints) {
            result.sources.add(src.expression + " [L" + src.line + "]");

            for (FlowPoint snk : sinkPoints) {
                if (snk.line >= src.line) { // Sink بعد Source
                    DataFlow flow = new DataFlow();
                    flow.source     = detectSourceType(src.expression);
                    flow.sink       = detectSinkType(snk.expression);
                    flow.confidence = (src.confidence + snk.confidence) / 2.0;
                    flow.chain.add(src);
                    flow.chain.add(snk);

                    // هل البيانات تمر مباشرة بدون sanitization؟
                    flow.isTainted = !hasSanitization(code, src.line, snk.line);

                    if (flow.isTainted) {
                        result.taintedCount++;
                        flow.warnings.add("⚠️ بيانات ملوثة تصل إلى " + flow.sink.name() + " بدون sanitization");
                        result.warnings.add(flow.warnings.get(0));
                    }

                    result.flows.add(flow);
                }
            }
        }

        // 4. Sinks
        for (FlowPoint snk : sinkPoints) {
            result.sinks.add(snk.expression + " [L" + snk.line + "]");
        }

        // 5. استخدم ContextAnalyzer للتعمق
        try {
            ContextAnalyzer.CodeContext ctx = ContextAnalyzer.analyze(code, null);
            if (ctx != null) {
                for (ContextAnalyzer.FlowNode node : ctx.flowNodes) {
                    if (node.role != null && node.role.contains("taint")) {
                        result.warnings.add("⚠️ Taint: " + node.name + " [L" + node.line + "]");
                    }
                }
            }
        } catch (Exception ignored) {}

        return result;
    }

    // ─── اكتشاف المصادر ──────────────────────────────────
    private static List<FlowPoint> detectSources(String[] lines) {
        List<FlowPoint> points = new ArrayList<>();
        for (int i = 0; i < lines.length; i++) {
            String line = lines[i];
            for (Map.Entry<SourceType, String[]> entry : SOURCE_PATTERNS.entrySet()) {
                for (String pattern : entry.getValue()) {
                    if (Pattern.compile(pattern, Pattern.CASE_INSENSITIVE).matcher(line).find()) {
                        String varName = extractVarName(line);
                        points.add(new FlowPoint(
                            varName, line.trim(), i + 1, "source", 0.75
                        ));
                        break;
                    }
                }
            }
        }
        return points;
    }

    // ─── اكتشاف المصارف ──────────────────────────────────
    private static List<FlowPoint> detectSinks(String[] lines) {
        List<FlowPoint> points = new ArrayList<>();
        for (int i = 0; i < lines.length; i++) {
            String line = lines[i];
            for (Map.Entry<SinkType, String[]> entry : SINK_PATTERNS.entrySet()) {
                for (String pattern : entry.getValue()) {
                    if (Pattern.compile(pattern, Pattern.CASE_INSENSITIVE).matcher(line).find()) {
                        points.add(new FlowPoint(
                            null, line.trim(), i + 1, "sink", 0.75
                        ));
                        break;
                    }
                }
            }
        }
        return points;
    }

    // ─── هل يوجد sanitization بين Source وSink؟ ─────────
    private static boolean hasSanitization(String code, int srcLine, int sinkLine) {
        String[] sanitizers = {
            "sanitize", "escape", "encode", "htmlspecialchars",
            "encodeURIComponent", "DOMPurify", "strip_tags",
            "PreparedStatement", "parameterized", "bindParam",
            "TextUtils.htmlEncode", "Html.escapeHtml"
        };
        String[] codeLines = code.split("\n");
        for (int i = srcLine; i < Math.min(sinkLine, codeLines.length); i++) {
            String line = codeLines[i].toLowerCase();
            for (String san : sanitizers) {
                if (line.contains(san.toLowerCase())) return true;
            }
        }
        return false;
    }

    // ─── Helpers ─────────────────────────────────────────
    private static String extractVarName(String line) {
        Pattern p = Pattern.compile("(?:const|let|var|String|int|Object)\\s+(\\w+)");
        Matcher m = p.matcher(line);
        return m.find() ? m.group(1) : "?";
    }

    private static SourceType detectSourceType(String expr) {
        String lower = expr.toLowerCase();
        for (Map.Entry<SourceType, String[]> e : SOURCE_PATTERNS.entrySet()) {
            for (String pat : e.getValue()) {
                if (Pattern.compile(pat, Pattern.CASE_INSENSITIVE).matcher(expr).find()) return e.getKey();
            }
        }
        return SourceType.UNKNOWN;
    }

    private static SinkType detectSinkType(String expr) {
        for (Map.Entry<SinkType, String[]> e : SINK_PATTERNS.entrySet()) {
            for (String pat : e.getValue()) {
                if (Pattern.compile(pat, Pattern.CASE_INSENSITIVE).matcher(expr).find()) return e.getKey();
            }
        }
        return SinkType.UNKNOWN;
    }
}
