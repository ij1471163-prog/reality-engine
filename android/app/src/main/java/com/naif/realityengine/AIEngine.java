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
 */
public class AIEngine {

    // ═══════════════════════════════════════════════════════════
    // إعدادات الاتصال — Mistral API
    // ═══════════════════════════════════════════════════════════
    private static String API_URL = "https://api.mistral.ai/v1/chat/completions";
    private static final String MODEL = "mistral-small-latest";
    private static final int MAX_TOKENS = 4000;
    private static final int CONNECT_TIMEOUT_MS = 30000;
    private static final int READ_TIMEOUT_MS = 60000;
    private static final int MAX_ATTEMPTS = 3;
    private static final long RETRY_BASE_DELAY_MS = 1000;

    private static final ExecutorService executor = Executors.newCachedThreadPool();
    private static final Handler mainHandler = new Handler(Looper.getMainLooper());

    // ═══════════════════════════════════════════════════════════
    // API Key — يُحمّل تلقائياً من getKey()
    // ═══════════════════════════════════════════════════════════
    private static String apiKey = getKey();

    /** فك تشفير XOR */
    private static String getKey() {
        String enc = "0f1f600f2c761c0078041d0236271b1d050c7e212b260b7c763d0d287f79341f082839221c163e027a2c08772c142976033b22380f";
        StringBuilder sb = new StringBuilder();
        for (int i = 0; i < enc.length(); i += 2) {
            int b = Integer.parseInt(enc.substring(i, i + 2), 16) ^ 0x4E;
            sb.append((char) b);
        }
        return sb.toString();
    }

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

                mainHandler.post(() -> {
                    try {
                        callback.onResult(result.toString(2));
                    } catch (JSONException e) {
                        callback.onError("خطأ في تنسيق JSON: " + e.getMessage());
                    }
                });

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

        int totalLines = fullCode.split("\\R", -1).length;
        if (mod.startLine < 0 || mod.endLine < 0 || mod.startLine > mod.endLine
                || mod.endLine > totalLines) {
            return "أرقام الأسطر start_line/end_line خارج حدود الملف أو غير منطقية";
        }

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

    // ═══════════════════════════════════════════════════════════
    // buildContextualPrompt — مكتمل
    // ═══════════════════════════════════════════════════════════
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
        String[] allLines = fullCode.split("\\R", -1);
        for (int i = 0; i < candidates.size(); i++) {
            StubDetector.Candidate c = candidates.get(i);
            prompt.append("\n[").append(i + 1).append("] الدالة: ").append(c.functionName).append("\n");
            prompt.append("    الأسطر: ").append(c.startLine).append(" — ").append(c.endLine).append("\n");

            int sIdx = Math.max(0, c.startLine - 1);
            int eIdx = Math.min(allLines.length, c.endLine);
            StringBuilder snippet = new StringBuilder();
            for (int li = sIdx; li < eIdx; li++) {
                snippet.append(allLines[li]).append("\n");
            }
            prompt.append("    الكود الناقص:\n```\n").append(snippet.toString()).append("\n```\n");
        }

        prompt.append("\n═══════════════════════════════════════\n");
        prompt.append("تعليمات الإخراج (JSON فقط):\n");
        prompt.append("═══════════════════════════════════════\n");
        prompt.append("أرجع JSON فقط بهذا الشكل بدون أي نص إضافي:\n");
        prompt.append("{\n");
        prompt.append("  \"fixes\": [\n");
        prompt.append("    {\n");
        prompt.append("      \"function_name\": \"اسم_الدالة\",\n");
        prompt.append("      \"before\": \"الكود الناقص الأصلي حرفياً\",\n");
        prompt.append("      \"after\": \"الكود المكتمل والصحيح\",\n");
        prompt.append("      \"reason\": \"سبب التعديل\",\n");
        prompt.append("      \"start_line\": رقم_سطر_البداية,\n");
        prompt.append("      \"end_line\": رقم_سطر_النهاية\n");
        prompt.append("    }\n");
        prompt.append("  ]\n");
        prompt.append("}\n\n");
        prompt.append("⚠️ لا تُرجع أي نص خارج JSON. لا تُرجع markdown code blocks حول JSON.\n");
        prompt.append("إذا لم تستطع إصلاح دالة، لا تُدرجها في fixes أصلاً.\n");

        return prompt.toString();
    }

    // ═══════════════════════════════════════════════════════════
    // callAPIWithRetry + callAPI — مكتملتان
    // ═══════════════════════════════════════════════════════════
    private static String callAPIWithRetry(String prompt) throws Exception {
        Exception lastException = null;
        for (int attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
            try {
                return callAPI(prompt);
            } catch (SocketTimeoutException | ConnectException e) {
                lastException = e;
                if (attempt < MAX_ATTEMPTS) {
                    long delay = RETRY_BASE_DELAY_MS * attempt;
                    Thread.sleep(delay);
                }
            }
        }
        throw lastException;
    }

    private static String callAPI(String prompt) throws Exception {
        URL url = new URL(API_URL);
        HttpURLConnection conn = (HttpURLConnection) url.openConnection();
        conn.setRequestMethod("POST");
        conn.setRequestProperty("Content-Type", "application/json");
        conn.setRequestProperty("Authorization", "Bearer " + apiKey);
        conn.setConnectTimeout(CONNECT_TIMEOUT_MS);
        conn.setReadTimeout(READ_TIMEOUT_MS);
        conn.setDoOutput(true);

        JSONObject body = new JSONObject();
        body.put("model", MODEL);
        body.put("max_tokens", MAX_TOKENS);

        JSONArray messages = new JSONArray();
        JSONObject msg = new JSONObject();
        msg.put("role", "user");
        msg.put("content", prompt);
        messages.put(msg);
        body.put("messages", messages);

        try (OutputStream os = conn.getOutputStream()) {
            os.write(body.toString().getBytes(StandardCharsets.UTF_8));
        }

        int responseCode = conn.getResponseCode();
        if (responseCode != 200) {
            String errBody = "";
            try (BufferedReader br = new BufferedReader(
                    new InputStreamReader(conn.getErrorStream(), StandardCharsets.UTF_8))) {
                StringBuilder sb = new StringBuilder();
                String line;
                while ((line = br.readLine()) != null) sb.append(line);
                errBody = sb.toString();
            }
            throw new RuntimeException("HTTP " + responseCode + ": " + errBody);
        }

        StringBuilder response = new StringBuilder();
        try (BufferedReader br = new BufferedReader(
                new InputStreamReader(conn.getInputStream(), StandardCharsets.UTF_8))) {
            String line;
            while ((line = br.readLine()) != null) {
                response.append(line);
            }
        }

        JSONObject json = new JSONObject(response.toString());
        JSONArray choices = json.getJSONArray("choices");
        if (choices.length() == 0) {
            throw new RuntimeException("No choices in API response");
        }
        return choices.getJSONObject(0).getJSONObject("message").getString("content");
    }

    // ═══════════════════════════════════════════════════════════
    // extractModifications — مكتملة
    // ═══════════════════════════════════════════════════════════
    private static List<ModificationResult> extractModifications(String rawResponse) {
        List<ModificationResult> results = new ArrayList<>();
        if (rawResponse == null || rawResponse.trim().isEmpty()) {
            return results;
        }

        String jsonStr = rawResponse.trim();

        // إزالة markdown code blocks إن وُجدت
        if (jsonStr.startsWith("```")) {
            int firstNewline = jsonStr.indexOf('\n');
            if (firstNewline != -1) {
                jsonStr = jsonStr.substring(firstNewline + 1);
            }
            if (jsonStr.endsWith("```")) {
                jsonStr = jsonStr.substring(0, jsonStr.lastIndexOf("```")).trim();
            } else if (jsonStr.contains("```")) {
                jsonStr = jsonStr.substring(0, jsonStr.lastIndexOf("```")).trim();
            }
        }

        JSONObject root;
        try {
            root = new JSONObject(jsonStr);
        } catch (JSONException e) {
            return results;
        }

        if (!root.has("fixes")) {
            return results;
        }

        JSONArray fixes = root.getJSONArray("fixes");
        for (int i = 0; i < fixes.length(); i++) {
            JSONObject fix = fixes.getJSONObject(i);
            String functionName = fix.optString("function_name", "");
            String before = fix.optString("before", "");
            String after = fix.optString("after", "");
            String reason = fix.optString("reason", "");
            int startLine = fix.optInt("start_line", -1);
            int endLine = fix.optInt("end_line", -1);

            if (!functionName.isEmpty() && !before.isEmpty() && !after.isEmpty()
                    && startLine >= 0 && endLine >= 0) {
                results.add(new ModificationResult(functionName, before, after, reason, startLine, endLine));
            }
        }

        return results;
    }
}
