package com.naif.realityengine;

import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.SocketTimeoutException;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.atomic.AtomicBoolean;
import org.json.JSONArray;
import org.json.JSONObject;

public class AIEngine {

    // ============================================================
    // إعدادات قابلة للتعديل
    // ============================================================
    private static final String API_URL = "https://api.mistral.ai/v1/chat/completions";
    private static final String MODEL = "mistral-small-latest";
    private static final int MAX_TOKENS = 2000;
    private static final int CONNECT_TIMEOUT_MS = 30000;
    private static final int READ_TIMEOUT_MS = 60000;
    private static final int MAX_RETRIES = 3;
    private static final long RETRY_BASE_DELAY_MS = 1000; // يتضاعف: 1s, 2s, 4s

    // Thread pool بدل new Thread() لكل طلب — تحكم وإلغاء أفضل
    private static final ExecutorService executor = Executors.newSingleThreadExecutor();

    // يمنع طلبين متزامنين يبعثرون النتائج
    private static final AtomicBoolean isRunning = new AtomicBoolean(false);
    private static Future<?> currentTask = null;

    private static String getKey() {
        String enc = "3c281e1c291e7b2808217b773a05087b2a17077c3721062d39342f7f25291637";
        StringBuilder sb = new StringBuilder();
        for (int i = 0; i < enc.length(); i += 2) {
            int b = Integer.parseInt(enc.substring(i, i + 2), 16) ^ 0x4E;
            sb.append((char) b);
        }
        return sb.toString();
    }

    // ============================================================
    // نموذج بيانات الاقتراح — منظم وجاهز للاستخدام مباشرة بالـ UI
    // ============================================================
    public static class Suggestion {
        public String functionName;
        public String beforeCode;
        public String afterCode;
        public String reason;
        public AISecurityGuard.GuardReport guardReport; // NEW: مربوط تلقائيًا

        public Suggestion(String functionName, String beforeCode, String afterCode, String reason) {
            this.functionName = functionName;
            this.beforeCode = beforeCode;
            this.afterCode = afterCode;
            this.reason = reason;
        }
    }

    public interface Callback {
        void onResult(List<Suggestion> suggestions);
        void onError(String error);
    }

    // القديمة تفضل شغالة لأي كود موجود يعتمد عليها (نص خام)
    public interface RawCallback {
        void onResult(String result);
        void onError(String error);
    }

    // ============================================================
    // نقطة الدخول الأساسية — ترجع اقتراحات منظمة + Guard report جاهز
    // ============================================================
    public static void analyze(String code, String fileName, Callback callback) {
        if (!isRunning.compareAndSet(false, true)) {
            callback.onError("فيه تحليل شغال حالياً — انتظر لين يخلص أو ألغِه");
            return;
        }

        currentTask = executor.submit(() -> {
            try {
                String prompt = buildPrompt(code, fileName);
                String rawResult = callAPIWithRetry(prompt);
                List<Suggestion> suggestions = parseSuggestions(rawResult);

                // ربط مباشر: كل اقتراح يمر على الـ Guard قبل ما يرجع للمستخدم
                for (Suggestion s : suggestions) {
                    s.guardReport = AISecurityGuard.inspect(s.afterCode);
                }

                callback.onResult(suggestions);
            } catch (Exception e) {
                callback.onError("خطأ: " + e.getClass().getSimpleName() + ": " + e.getMessage());
            } finally {
                isRunning.set(false);
            }
        });
    }

    // إلغاء التحليل الحالي لو المستخدم غيّر رأيه أو غادر الشاشة
    public static void cancel() {
        if (currentTask != null && !currentTask.isDone()) {
            currentTask.cancel(true);
        }
        isRunning.set(false);
    }

    public static boolean isBusy() {
        return isRunning.get();
    }

    private static String buildPrompt(String code, String fileName) {
        return "أنت Senior Software Engineer خبير في Python وJavaScript وHTML.\n" +
            "مهمتك: تحليل الكود التالي وإصلاح كل دالة ناقصة بكود حقيقي يعمل.\n\n" +
            "قواعد صارمة:\n" +
            "1. اقرأ توقيع الدالة واستخدم نفس أسماء المعاملات حرفياً\n" +
            "   مثال: def validate_email(email) → استخدم email وليس value أو data\n" +
            "2. الكود يجب أن يعمل بدون NameError أو IndentationError أو SyntaxError\n" +
            "3. لا تُعدّل الدوال المكتملة\n" +
            "4. استخدم المكتبات المناسبة (re, hashlib, os, json)\n" +
            "5. كل متغير تستخدمه يجب أن يكون معرّفاً\n\n" +
            "أمثلة صحيحة:\n" +
            "def validate_email(email):\n" +
            "    import re\n" +
            "    return bool(re.match(r\'[\\w.]+@[\\w.]+\\.[a-z]{2,}\', str(email)))\n\n" +
            "def hash_password(password):\n" +
            "    import hashlib\n" +
            "    return hashlib.sha256(password.encode()).hexdigest()\n\n" +
            "def calculate_total(items):\n" +
            "    return sum(items) if items else 0\n\n" +
            "الملف: " + fileName + "\n\n" +
            "```\n" + code + "\n```\n\n" +
            "مهم: أرجع كل اقتراح بهذا التنسيق فقط:\n" +
            "FUNCTION: اسم_الدالة\n" +
            "BEFORE:\n```\nالكود القديم\n```\n" +
            "AFTER:\n```\nالكود المصلح الكامل\n```\n" +
            "REASON: سبب التعديل\n" +
            "---\n";
    }

    // ============================================================
    // Retry مع Exponential Backoff — يعيد المحاولة فقط على أخطاء مؤقتة
    // ============================================================
    private static String callAPIWithRetry(String prompt) throws Exception {
        Exception lastError = null;

        for (int attempt = 0; attempt <= MAX_RETRIES; attempt++) {
            if (Thread.currentThread().isInterrupted()) {
                throw new InterruptedException("تم إلغاء العملية");
            }
            try {
                return callAPI(prompt);
            } catch (RetryableException e) {
                lastError = e;
                if (attempt < MAX_RETRIES) {
                    long delay = RETRY_BASE_DELAY_MS * (1L << attempt); // 1s, 2s, 4s
                    Thread.sleep(delay);
                }
            }
            // أخطاء غير مؤقتة (4xx غير 429، JSON parse error) تطلع فورًا بدون إعادة محاولة
        }
        throw new Exception("فشل بعد " + (MAX_RETRIES + 1) + " محاولات: " +
            (lastError != null ? lastError.getMessage() : "سبب غير معروف"));
    }

    // استثناء داخلي يميز الأخطاء المؤقتة (تستاهل إعادة محاولة) عن الدائمة
    private static class RetryableException extends Exception {
        RetryableException(String msg) { super(msg); }
    }

    private static String callAPI(String prompt) throws Exception {
        HttpURLConnection conn = null;
        try {
            URL url = new URL(API_URL);
            conn = (HttpURLConnection) url.openConnection();
            conn.setRequestMethod("POST");
            conn.setRequestProperty("Content-Type", "application/json");
            conn.setRequestProperty("Authorization", "Bearer " + getKey());
            conn.setRequestProperty("HTTP-Referer", "https://github.com/reality-engine");
            conn.setRequestProperty("X-Title", "Reality Engine");
            conn.setDoOutput(true);
            conn.setConnectTimeout(CONNECT_TIMEOUT_MS);
            conn.setReadTimeout(READ_TIMEOUT_MS);

            JSONObject message = new JSONObject();
            message.put("role", "user");
            message.put("content", prompt);

            JSONObject body = new JSONObject();
            body.put("model", MODEL);
            body.put("messages", new JSONArray().put(message));
            body.put("max_tokens", MAX_TOKENS);

            try (OutputStream os = conn.getOutputStream()) {
                os.write(body.toString().getBytes(StandardCharsets.UTF_8));
            }

            int responseCode;
            try {
                responseCode = conn.getResponseCode();
            } catch (SocketTimeoutException e) {
                throw new RetryableException("انتهت مهلة الاتصال");
            }

            if (responseCode == 429 || responseCode >= 500) {
                // Rate limit أو خطأ سيرفر مؤقت — يستاهل إعادة محاولة
                throw new RetryableException("HTTP " + responseCode + " (مؤقت)");
            }

            if (responseCode != 200) {
                String errBody = readStream(conn.getErrorStream());
                throw new Exception("HTTP " + responseCode + ": " + errBody);
            }

            String response = readStream(conn.getInputStream());

            JSONObject responseJson = new JSONObject(response);
            JSONArray choices = responseJson.optJSONArray("choices");
            if (choices != null && choices.length() > 0) {
                JSONObject firstChoice = choices.getJSONObject(0);
                JSONObject msg = firstChoice.optJSONObject("message");
                if (msg != null && msg.has("content")) {
                    return msg.getString("content");
                }
            }
            throw new Exception("تعذّر تحليل الاستجابة — هيكل غير متوقع");

        } finally {
            if (conn != null) conn.disconnect();
        }
    }

    private static String readStream(java.io.InputStream stream) throws Exception {
        if (stream == null) return "";
        try (BufferedReader br = new BufferedReader(new InputStreamReader(stream, StandardCharsets.UTF_8))) {
            StringBuilder sb = new StringBuilder();
            String line;
            while ((line = br.readLine()) != null) sb.append(line).append("\n");
            return sb.toString();
        }
    }

    // ============================================================
    // Parser: يحول النص الخام (FUNCTION/BEFORE/AFTER/REASON) لكائنات منظمة
    // ============================================================
    private static List<Suggestion> parseSuggestions(String raw) {
        List<Suggestion> result = new ArrayList<>();
        if (raw == null || raw.trim().isEmpty()) return result;

        String[] blocks = raw.split("---");
        for (String block : blocks) {
            if (block.trim().isEmpty()) continue;

            String functionName = extractField(block, "FUNCTION:", "\n");
            String beforeCode = extractCodeBlock(block, "BEFORE:");
            String afterCode = extractCodeBlock(block, "AFTER:");
            String reason = extractField(block, "REASON:", "\n");

            if (functionName != null && afterCode != null) {
                result.add(new Suggestion(
                    functionName.trim(),
                    beforeCode != null ? beforeCode.trim() : "",
                    afterCode.trim(),
                    reason != null ? reason.trim() : ""
                ));
            }
        }
        return result;
    }

    private static String extractField(String text, String label, String stopAt) {
        int start = text.indexOf(label);
        if (start < 0) return null;
        start += label.length();
        int end = text.indexOf(stopAt, start);
        if (end < 0) end = text.length();
        return text.substring(start, end);
    }

    private static String extractCodeBlock(String text, String label) {
        int labelIdx = text.indexOf(label);
        if (labelIdx < 0) return null;
        int fenceStart = text.indexOf("```", labelIdx);
        if (fenceStart < 0) return null;
        int codeStart = text.indexOf("\n", fenceStart);
        if (codeStart < 0) return null;
        codeStart += 1;
        int fenceEnd = text.indexOf("```", codeStart);
        if (fenceEnd < 0) return null;
        return text.substring(codeStart, fenceEnd);
    }

    // ============================================================
    // للتوافق مع كود قديم يستخدم الـ String الخام مباشرة
    // ============================================================
    public static void analyzeRaw(String code, String fileName, RawCallback callback) {
        if (!isRunning.compareAndSet(false, true)) {
            callback.onError("فيه تحليل شغال حالياً");
            return;
        }
        currentTask = executor.submit(() -> {
            try {
                String prompt = buildPrompt(code, fileName);
                String result = callAPIWithRetry(prompt);
                callback.onResult(result);
            } catch (Exception e) {
                callback.onError("خطأ: " + e.getClass().getSimpleName() + ": " + e.getMessage());
            } finally {
                isRunning.set(false);
            }
        });
    }
}

