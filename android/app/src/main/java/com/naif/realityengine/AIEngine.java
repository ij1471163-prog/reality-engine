package com.naif.realityengine;

import android.os.Handler;
import android.os.Looper;

import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.ConnectException;
import java.net.HttpURLConnection;
import java.net.SocketTimeoutException;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

/**
 * AIEngine — محرك الذكاء الاصطناعي لتعديل الملفات الحقيقية
 *
 * التدفق الجديد:
 *   1. StubDetector يحدد المرشحات (Candidate Regions)
 *   2. AIEngine يأخذ: الملف الكامل + المرشحات + السياق
 *   3. AI يولد تعديلًا دقيقًا (Patch) — وليس اقتراحًا عامًا
 *   4. AISecurityGuard يتحقق أمنيًا
 *   5. CodeApplier يطبق التعديل
 *   6. BackupManager يحفظ نسخة احتياطية
 *   7. DiffViewer يعرض الفرق للمستخدم
 *   8. المستخدم يوافق → الحفظ النهائي
 */
public class AIEngine {

    // ═══════════════════════════════════════════════════════════
    // إعدادات الاتصال
    // ═══════════════════════════════════════════════════════════
    private static String API_URL = "https://api.anthropic.com/v1/messages";
    private static final String MODEL = "claude-sonnet-4-20250514"; // ← تاريخ إصدار صحيح
    private static final String ANTHROPIC_VERSION = "2025-01-01"; // ← إصدار أحدث وأكثر استقراراً
    private static final int MAX_TOKENS = 8000;
    private static final int CONNECT_TIMEOUT_MS = 30000;
    private static final int READ_TIMEOUT_MS = 90000;
    private static final int MAX_ATTEMPTS = 3;
    private static final long RETRY_BASE_DELAY_MS = 1000;

    // ─── Extended Thinking ───
    private static final boolean ENABLE_EXTENDED_THINKING = true;
    private static final int THINKING_BUDGET_TOKENS = 3000;

    // ─── Tool Use ───
    private static final String TOOL_NAME = "submit_fixes";

    private static final ExecutorService executor = Executors.newCachedThreadPool();
    private static final Handler mainHandler = new Handler(Looper.getMainLooper());

    // ═══════════════════════════════════════════════════════════
    // API Key — يُمرر من الخارج
    // ═══════════════════════════════════════════════════════════
    private static String apiKey = null;

    public static void setApiKey(String key) {
        apiKey = key;
    }

    public static void setApiUrl(String url) {
        if (url == null || !url.toLowerCase().startsWith("https://")) {
            throw new IllegalArgumentException("API URL يجب أن يبدأ بـ https:// فقط");
        }
        API_URL = url;
    }

    public interface Callback {
        void onResult(String result);
        void onError(String error);
    }

    public static class ModificationResult {
        public final String functionName;
        public final String originalCode;
        public final String modifiedCode;
        public final String reason;
        public final int startLine;
        public final int endLine;

        public ModificationResult(String functionName, String originalCode,
                                  String modifiedCode, String reason,
                                  int startLine, int endLine) {
            this.functionName = functionName;
            this.originalCode = originalCode;
            this.modifiedCode = modifiedCode;
            this.reason = reason;
            this.startLine = startLine;
            this.endLine = endLine;
        }
    }

    public static void analyzeFile(String fullCode, String fileName,
                                    List<StubDetector.Candidate> candidates,
                                    Callback callback) {
        analyzeFile(fullCode, fileName, candidates, new java.util.LinkedHashMap<>(), callback);
    }

    public static void analyzeFile(String fullCode, String fileName,
                                    List<StubDetector.Candidate> candidates,
                                    java.util.Map<String, String> relatedFiles,
                                    Callback callback) {
        if (apiKey == null || apiKey.isEmpty()) {
            mainHandler.post(() -> callback.onError(
                "خطأ: لم يتم تعيين API Key. استخدم AIEngine.setApiKey()"));
            return;
        }

        executor.submit(() -> {
            try {
                String prompt = buildContextualPrompt(fullCode, fileName, candidates, relatedFiles);
                String rawResponse = callAPIWithRetry(prompt);
                List<ModificationResult> modifications = extractModifications(rawResponse);

                JSONArray fixesArray = new JSONArray();
                int rejectedCount = 0;
                java.util.Set<String> acceptedBodies = new java.util.HashSet<>();
                for (ModificationResult mod : modifications) {
                    String rejectReason = validateModification(fullCode, mod, candidates);

                    if (rejectReason == null) {
                        rejectReason = detectFakeImplementation(mod.modifiedCode);
                    }

                    if (rejectReason == null) {
                        String normalizedBody = mod.modifiedCode.trim().replaceAll("\\s+", " ");
                        if (!acceptedBodies.add(normalizedBody)) {
                            rejectReason = "الكود مطابق حرفيًا لتعديل آخر مقبول سابقًا (احتمال نسخ-لصق خاطئ)";
                        }
                    }

                    if (rejectReason != null) {
                        rejectedCount++;
                        continue;
                    }
                    JSONObject fix = new JSONObject();
                    fix.put("function_name", mod.functionName);
                    fix.put("before", mod.originalCode);
                    fix.put("after", mod.modifiedCode);
                    fix.put("reason", mod.reason);
                    fix.put("start_line", mod.startLine);
                    fix.put("end_line", mod.endLine);
                    fixesArray.put(fix);
                }

                JSONObject result = new JSONObject();
                result.put("fixes", fixesArray);
                result.put("file_name", fileName);
                result.put("rejected_count", rejectedCount);

                mainHandler.post(() -> callback.onResult(result.toString(2)));

            } catch (Exception e) {
                mainHandler.post(() -> callback.onError(
                    "خطأ: " + e.getClass().getSimpleName() + ": " + e.getMessage()));
            }
        });
    }

    private static String validateModification(String fullCode, ModificationResult mod,
                                                 List<StubDetector.Candidate> candidates) {
        if (mod.originalCode == null || mod.originalCode.trim().isEmpty()) {
            return "before فارغ";
        }
        if (mod.modifiedCode == null || mod.modifiedCode.trim().isEmpty()) {
            return "after فارغ";
        }

        if (!fullCode.contains(mod.originalCode)) {
            return "before غير مطابق حرفيًا لأي نص داخل الملف";
        }

        boolean functionAllowed = false;
        for (StubDetector.Candidate c : candidates) {
            if (c.functionName != null && c.functionName.equals(mod.functionName)) {
                functionAllowed = true;
                break;
            }
        }
        if (!functionAllowed) {
            return "الدالة '" + mod.functionName + "' ليست ضمن المرشحين الذين اكتشفهم StubDetector";
        }

        // ← إصلاح: استخدام \\R بدلاً من \n لدعم \r\n و \n و \r
        int totalLines = fullCode.split("\\R", -1).length;
        if (mod.startLine < 0 || mod.endLine < 0 || mod.startLine > mod.endLine
                || mod.endLine > totalLines) {
            return "أرقام الأسطر start_line/end_line خارج حدود الملف أو غير منطقية";
        }

        // ← إصلاح: استخدام \\R بدلاً من \n
        for (String line : mod.modifiedCode.split("\\R")) {
            String trimmed = line.trim();
            if ((trimmed.startsWith("import ") || trimmed.startsWith("using "))
                    && !fullCode.contains(trimmed)) {
                return "التعديل يحاول إضافة import غير مصرح به: " + trimmed;
            }
        }

        return null;
    }

    private static String detectFakeImplementation(String afterCode) {
        if (afterCode == null) return "after فارغ";
        String normalized = afterCode.toLowerCase();

        String[] fakeMarkers = {
            "notimplementederror",
            "not implemented",
            "todo",
            "fixme",
            "raise notimplemented",
            "throw new unsupportedoperationexception",
            "// stub",
            "# ناقصة",
            "pass  #",
        };

        for (String marker : fakeMarkers) {
            if (normalized.contains(marker)) {
                return "الـAI رجع تنفيذًا وهميًا (يحتوي '" + marker + "') وليس حلًا فعليًا";
            }
        }

        // ← إصلاح: استخدام \\R بدلاً من \n
        String[] lines = afterCode.trim().split("\\R");
        boolean onlyPassOrEmpty = true;
        for (String line : lines) {
            String t = line.trim();
            if (t.isEmpty() || t.equals("pass") || t.startsWith("def ")
                    || t.startsWith("public ") || t.startsWith("private ")
                    || t.startsWith("{") || t.startsWith("}")) {
                continue;
            }
            onlyPassOrEmpty = false;
            break;
        }
        if (onlyPassOrEmpty) {
            return "التعديل شبه فارغ (لا يحتوي منطقًا حقيقيًا)";
        }

        return null;
    }

    public static void analyze(String code, String fileName, Callback callback) {
        StubDetector.StubResult result = StubDetector.detect(code);
        List<StubDetector.Candidate> candidates =
                StubDetector.toCandidates(code, result);

        if (candidates == null || candidates.isEmpty()) {
            mainHandler.post(() -> callback.onResult("{\"fixes\":[],\"file_name\":\"" + fileName + "\"}"));
            return;
        }

        analyzeFile(code, fileName, candidates, callback);
    }

    private static String buildContextualPrompt(String fullCode, String fileName,
                                                   List<StubDetector.Candidate> candidates,
                                                   java.util.Map<String, String> relatedFiles) {
        StringBuilder prompt = new StringBuilder();

        prompt.append("أنت Senior Software Engineer خبير في تحليل الأكواد وإصلاحها.\n");
        prompt.append("مهمتك: إصلاح الدوال الناقصة (Stubs) في ملف حقيقي من مشروع حقيقي.\n\n");

        prompt.append("⚠️ قواعد صارمة جداً:\n");
        prompt.append("1. اقرأ الملف الكامل أولاً لفهم السياق والمتغيرات والدوال الأخرى\n");
        prompt.append("2. لا تُعدّل أي دالة مكتملة أو صحيحة\n");
        prompt.append("3. استخدم نفس أسماء المعاملات والمتغيرات الموجودة حرفياً\n");
        prompt.append("4. الكود يجب أن يعمل بدون أخطاء (SyntaxError, NameError, IndentationError)\n");
        prompt.append("5. إذا items هو list of dicts، لا تفترض أنه list of numbers\n");
        prompt.append("6. استنتج المنطق الصحيح من بقية الملف وليس من اسم الدالة فقط\n");
        prompt.append("7. لا تُضف import إلا إذا كان ضرورياً وغير موجود\n");
        prompt.append("8. ممنوع منعاً باتاً إرجاع كود يحتوي NotImplementedError أو TODO أو pass فقط — ");
        prompt.append("إذا لم تستطع تحديد المنطق الصحيح، لا تُرجع هذا fix ضمن fixes أصلاً بدل إرجاع حل وهمي\n");
        prompt.append("9. كل دالة لها منطقها الخاص المستقل — ممنوع نسخ جسم دالة أخرى ولصقه لدالة مختلفة ");
        prompt.append("حتى لو الأسماء متشابهة (مثال: find_user و find_best_user دالتان مختلفتان تمامًا)\n");
        prompt.append("10. تحقق من كل متغير تستخدمه أنه فعلاً موجود ضمن معاملات (parameters) نفس الدالة ");
        prompt.append("قبل استخدامه — استخدام متغير من دالة أخرى يسبب NameError\n");
        prompt.append("11. إذا كانت الملفات المرتبطة أدناه توضح بنية بيانات أو دالة يتم استدعاؤها، ");
        prompt.append("استخدم هذا الفهم بدل التخمين\n\n");

        prompt.append("📁 الملف الرئيسي المستهدف بالتعديل: ").append(fileName).append("\n\n");

        prompt.append("═══════════════════════════════════════\n");
        prompt.append("المحتوى الكامل للملف الرئيسي:\n");
        prompt.append("═══════════════════════════════════════\n");
        prompt.append("```\n").append(fullCode).append("\n```\n\n");

        if (relatedFiles != null && !relatedFiles.isEmpty()) {
            prompt.append("═══════════════════════════════════════\n");
            prompt.append("ملفات مرتبطة من نفس المشروع (للفهم فقط — لا تُعدّلها):\n");
            prompt.append("═══════════════════════════════════════\n");
            for (java.util.Map.Entry<String, String> entry : relatedFiles.entrySet()) {
                prompt.append("\n📄 ملف مرتبط: ").append(entry.getKey()).append("\n");
                prompt.append("```\n").append(entry.getValue()).append("\n```\n");
            }
            prompt.append("\n⚠️ الملفات أعلاه للسياق فقط. أي fix يجب أن يكون حصرًا داخل الملف الرئيسي ")
                  .append(fileName).append(".\n\n");
        }

        prompt.append("═══════════════════════════════════════\n");
        prompt.append("المناطق الناقصة المكتشفة (Candidates):\n");
        prompt.append("═══════════════════════════════════════\n");

        for (int i = 0; i < candidates.size(); i++) {
            StubDetector.Candidate c = candidates.get(i);
            prompt.append("\n--- Candidate #").append(i + 1).append(" ---\n");
            prompt.append("الدالة: ").append(c.functionName).append("\n");
            prompt.append("السطر: ").append(c.startLine).append(" إلى ").append(c.endLine).append("\n");
            prompt.append("الكود:\n```\n").append(c.codeSnippet).append("\n```\n");
        }

        prompt.append("\n═══════════════════════════════════════\n");
        prompt.append("المطلوب:\n");
        prompt.append("═══════════════════════════════════════\n");
        prompt.append("استخدم أداة (Tool) ").append(TOOL_NAME).append(" حصرًا لإرجاع نتيجتك. ");
        prompt.append("لا ترجع نصًا عاديًا أو JSON خارج الأداة.\n");
        prompt.append("⚠️ مهم: أرقام الأسطر (start_line, end_line) تبدأ من 0 (0-based)، ");
        prompt.append("أي أن السطر الأول في الملف رقمه 0 وليس 1.\n");
        prompt.append("⚠️ مهم: إذا لم يكن هناك تعديل مطلوب، استدعِ الأداة بمصفوفة fixes فارغة.\n");
        prompt.append("⚠️ مهم: 'after' يجب أن يكون كوداً كاملاً يستبدل 'before' بالضبط.\n");

        return prompt.toString();
    }

    private static List<ModificationResult> parseModifications(String aiResult) {
        List<ModificationResult> results = new ArrayList<>();

        if (aiResult == null) return results;

        String cleaned = aiResult.trim();

        if (cleaned.startsWith("```")) {
            int firstNewline = cleaned.indexOf('\n');
            if (firstNewline != -1) {
                cleaned = cleaned.substring(firstNewline + 1);
            }
            if (cleaned.endsWith("```")) {
                cleaned = cleaned.substring(0, cleaned.lastIndexOf("```")).trim();
            }
        }

        if (!cleaned.startsWith("{") || !cleaned.endsWith("}")) {
            return results;
        }

        try {
            JSONObject root = new JSONObject(cleaned);
            return parseFixesArray(root.optJSONArray("fixes"));
        } catch (JSONException e) {
            return results;
        }
    }

    private static List<ModificationResult> parseFixesArray(JSONArray fixes) {
        List<ModificationResult> results = new ArrayList<>();
        if (fixes == null) return results;

        for (int i = 0; i < fixes.length(); i++) {
            try {
                JSONObject fix = fixes.getJSONObject(i);
                String functionName = fix.optString("function_name", "unknown");
                String before = fix.optString("before", "");
                String after = fix.optString("after", "");
                String reason = fix.optString("reason", "");
                int startLine = fix.optInt("start_line", -1);
                int endLine = fix.optInt("end_line", -1);

                results.add(new ModificationResult(
                    functionName, before, after, reason, startLine, endLine));
            } catch (JSONException e) {
                // نتخطى هذا العنصر فقط
            }
        }
        return results;
    }

    private static List<ModificationResult> extractModifications(String rawResponseJson) {
        List<ModificationResult> results = new ArrayList<>();
        if (rawResponseJson == null) return results;

        try {
            JSONObject responseJson = new JSONObject(rawResponseJson);
            JSONArray contentArray = responseJson.optJSONArray("content");
            if (contentArray == null) return results;

            StringBuilder fallbackText = new StringBuilder();

            for (int i = 0; i < contentArray.length(); i++) {
                JSONObject block = contentArray.getJSONObject(i);
                String type = block.optString("type");

                if ("tool_use".equals(type) && TOOL_NAME.equals(block.optString("name"))) {
                    JSONObject input = block.optJSONObject("input");
                    if (input != null) {
                        return parseFixesArray(input.optJSONArray("fixes"));
                    }
                } else if ("text".equals(type)) {
                    fallbackText.append(block.optString("text", ""));
                }
            }

            if (fallbackText.length() > 0) {
                return parseModifications(fallbackText.toString());
            }

        } catch (JSONException e) {
            // فشل تحليل الرد الخام بالكامل
        }

        return results;
    }

    private static JSONObject buildFixesTool() throws JSONException {
        JSONObject fixItemProps = new JSONObject();
        fixItemProps.put("function_name", new JSONObject().put("type", "string"));
        fixItemProps.put("before", new JSONObject().put("type", "string"));
        fixItemProps.put("after", new JSONObject().put("type", "string"));
        fixItemProps.put("reason", new JSONObject().put("type", "string"));
        fixItemProps.put("start_line", new JSONObject().put("type", "integer"));
        fixItemProps.put("end_line", new JSONObject().put("type", "integer"));

        JSONObject fixItemSchema = new JSONObject();
        fixItemSchema.put("type", "object");
        fixItemSchema.put("properties", fixItemProps);
        fixItemSchema.put("required", new JSONArray()
            .put("function_name").put("before").put("after")
            .put("reason").put("start_line").put("end_line"));

        JSONObject fixesArraySchema = new JSONObject();
        fixesArraySchema.put("type", "array");
        fixesArraySchema.put("items", fixItemSchema);

        JSONObject topProps = new JSONObject();
        topProps.put("fixes", fixesArraySchema);

        JSONObject inputSchema = new JSONObject();
        inputSchema.put("type", "object");
        inputSchema.put("properties", topProps);
        inputSchema.put("required", new JSONArray().put("fixes"));

        JSONObject tool = new JSONObject();
        tool.put("name", TOOL_NAME);
        tool.put("description",
            "يُرسل قائمة التعديلات (fixes) الدقيقة للدوال الناقصة المكتشفة. " +
            "استخدم مصفوفة فارغة إذا لا يوجد تعديل مطلوب أو لم تستطع تحديد الحل الصحيح بثقة.");
        tool.put("input_schema", inputSchema);

        return tool;
    }

    public static String generateDiff(String originalCode, ModificationResult mod) {
        if (originalCode == null || mod.originalCode == null
                || !originalCode.contains(mod.originalCode)) {
            return "⚠️ تعذّر توليد Diff: mod.originalCode غير مطابق للملف الأصلي المُعطى.";
        }

        StringBuilder diff = new StringBuilder();
        diff.append("--- ").append(mod.functionName).append("\n");
        diff.append("+++ ").append(mod.functionName).append(" (مُعدّل)\n");
        diff.append("@@ -").append(mod.startLine).append(",")
            .append(mod.endLine - mod.startLine).append(" +")
            .append(mod.startLine).append(",? @@\n");

        // ← إصلاح: استخدام \\R بدلاً من \n
        String[] originalLines = originalCode.split("\\R");
        String[] afterLines = mod.modifiedCode.split("\\R");

        int contextStart = Math.max(0, mod.startLine - 3);
        int contextEnd = Math.min(originalLines.length, mod.endLine + 3);

        for (int i = contextStart; i < contextEnd; i++) {
            if (i >= mod.startLine && i < mod.endLine) {
                diff.append("- ").append(originalLines[i]).append("\n");
            } else {
                diff.append("  ").append(originalLines[i]).append("\n");
            }
        }

        diff.append("--- التعديل ---\n");
        for (String line : afterLines) {
            diff.append("+ ").append(line).append("\n");
        }

        return diff.toString();
    }

    private static String callAPIWithRetry(String prompt) throws Exception {
        Exception lastError = null;
        for (int attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
            try {
                return callAPI(prompt);
            } catch (RetryableException e) {
                lastError = e;
                if (attempt < MAX_ATTEMPTS - 1) {
                    Thread.sleep(RETRY_BASE_DELAY_MS * (1L << attempt));
                }
            }
        }
        throw new Exception("فشل الاتصال بعد " + MAX_ATTEMPTS + " محاولات: " +
            (lastError != null ? lastError.getMessage() : "غير معروف"));
    }

    private static class RetryableException extends Exception {
        RetryableException(String msg) { super(msg); }
        RetryableException(Throwable cause) { super(cause); }
    }

    private static String callAPI(String prompt) throws Exception {
        if (apiKey == null || apiKey.isEmpty()) {
            throw new Exception("API Key غير معيّن");
        }

        HttpURLConnection conn = null;
        try {
            URL url = new URL(API_URL);
            conn = (HttpURLConnection) url.openConnection();
            conn.setRequestMethod("POST");
            conn.setRequestProperty("Content-Type", "application/json");
            conn.setRequestProperty("x-api-key", apiKey);
            conn.setRequestProperty("anthropic-version", ANTHROPIC_VERSION);
            conn.setDoOutput(true);
            conn.setConnectTimeout(CONNECT_TIMEOUT_MS);
            conn.setReadTimeout(READ_TIMEOUT_MS);

            JSONObject message = new JSONObject();
            message.put("role", "user");
            message.put("content", prompt);

            JSONObject body = new JSONObject();
            body.put("model", MODEL);
            body.put("max_tokens", MAX_TOKENS);
            body.put("messages", new JSONArray().put(message));
            body.put("system",
                "أنت Senior Software Engineer دقيق جدًا. تلتزم حرفيًا بالتعليمات المعطاة. " +
                "لا ترجع أبدًا كودًا وهميًا (NotImplementedError/TODO/pass) ولا تنسخ منطق دالة لدالة أخرى. " +
                "استخدم أداة " + TOOL_NAME + " دائمًا لإرجاع نتيجتك النهائية.");

            body.put("tools", new JSONArray().put(buildFixesTool()));

            if (ENABLE_EXTENDED_THINKING) {
                JSONObject thinking = new JSONObject();
                thinking.put("type", "enabled");
                thinking.put("budget_tokens", THINKING_BUDGET_TOKENS);
                body.put("thinking", thinking);
                body.put("tool_choice", new JSONObject().put("type", "auto"));
            } else {
                body.put("temperature", 0.1);
                body.put("tool_choice", new JSONObject().put("type", "tool").put("name", TOOL_NAME));
            }

            try (OutputStream os = conn.getOutputStream()) {
                os.write(body.toString().getBytes(StandardCharsets.UTF_8));
            }

            int responseCode;
            try {
                responseCode = conn.getResponseCode();
            } catch (SocketTimeoutException e) {
                throw new RetryableException("انتهت مهلة الاتصال");
            } catch (ConnectException e) {
                throw new RetryableException("فشل الاتصال بالشبكة");
            }

            if (responseCode == 429 || responseCode >= 500) {
                throw new RetryableException("HTTP " + responseCode);
            }

            if (responseCode < 200 || responseCode >= 300) {
                String errBody = readStream(conn.getErrorStream());
                throw new Exception("HTTP " + responseCode + ": " + errBody);
            }

            return readStream(conn.getInputStream());

        } finally {
            if (conn != null) conn.disconnect();
        }
    }

    private static String readStream(java.io.InputStream stream) throws Exception {
        if (stream == null) return "";
        try (BufferedReader br = new BufferedReader(
                new InputStreamReader(stream, StandardCharsets.UTF_8))) {
            StringBuilder sb = new StringBuilder();
            String line;
            while ((line = br.readLine()) != null) sb.append(line).append("\n");
            return sb.toString();
        }
    }
}

