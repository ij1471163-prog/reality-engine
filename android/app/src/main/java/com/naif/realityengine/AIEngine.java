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
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import org.json.JSONArray;
import org.json.JSONObject;

public class AIEngine {

    private static String API_URL = "https://api.mistral.ai/v1/chat/completions";
    private static final String MODEL = "mistral-small-latest";
    private static final int MAX_TOKENS = 4000;
    private static final int CONNECT_TIMEOUT_MS = 30000;
    private static final int READ_TIMEOUT_MS = 60000;
    private static final int MAX_ATTEMPTS = 3;
    private static final long RETRY_BASE_DELAY_MS = 1000;

    private static final ExecutorService executor = Executors.newCachedThreadPool();
    private static final Handler mainHandler = new Handler(Looper.getMainLooper());
    private static final String API_KEY = decryptKey();

    // ============================================================
    // نفس الواجهة القديمة بالضبط — صفر تغيير على أي Activity يستخدمها
    // ============================================================
    public interface Callback {
        void onResult(String result);
        void onError(String error);
    }

    public static void analyze(String code, String fileName, Callback callback) {
        executor.submit(() -> {
            try {
                String prompt = buildPrompt(code, fileName);
                String result = callAPIWithRetry(prompt);
                mainHandler.post(() -> callback.onResult(result));
            } catch (Exception e) {
                mainHandler.post(() -> callback.onError(
                    "خطأ: " + e.getClass().getSimpleName() + ": " + e.getMessage()));
            }
        });
    }

    // ============================================================
    // إعدادات (اختياري — للتبديل إلى Vercel لاحقاً)
    // ============================================================

    /** غيّر رابط الـAPI (مثلاً إلى Vercel Proxy لاحقاً) */
    public static void setApiUrl(String url) {
        API_URL = url;
    }

    /**
     * تستخرج مصفوفة التعديلات من نتيجة AI.
     * تبحث عن JSON داخل أي نص إضافي (Markdown أو كلام قبل/بعد).
     * ترجع null لو النص لا يحتوي JSON صالح.
     */
    public static JSONArray extractFixes(String aiResult) {
        if (aiResult == null) return null;
        String cleaned = aiResult.trim();

        // إزالة تغليف Markdown إن وجد (```json ... ``` أو ``` ... ```)
        if (cleaned.startsWith("```")) {
            int firstNewline = cleaned.indexOf('\n');
            if (firstNewline != -1) {
                cleaned = cleaned.substring(firstNewline + 1);
            }
            if (cleaned.endsWith("```")) {
                cleaned = cleaned.substring(0, cleaned.lastIndexOf("```")).trim();
            }
        }

        // البحث عن أول '{' وآخر '}' لاستخراج JSON من داخل أي نص إضافي
        int firstBrace = cleaned.indexOf('{');
        int lastBrace = cleaned.lastIndexOf('}');
        if (firstBrace != -1 && lastBrace != -1 && lastBrace > firstBrace) {
            cleaned = cleaned.substring(firstBrace, lastBrace + 1);
        }

        try {
            JSONObject root = new JSONObject(cleaned);
            return root.optJSONArray("fixes");
        } catch (Exception e) {
            return null;
        }
    }

    // ============================================================
    // داخلي — تعديلات وإصلاحات
    // ============================================================

    /** الخوارزمية الأصلية — XOR ثابت 0x4E */
    private static String decryptKey() {
        String enc = "3c281e1c291e7b2808217b773a05087b2a17077c3721062d39342f7f25291637";
        StringBuilder sb = new StringBuilder();
        for (int i = 0; i < enc.length(); i += 2) {
            int b = Integer.parseInt(enc.substring(i, i + 2), 16) ^ 0x4E;
            sb.append((char) b);
        }
        return sb.toString();
    }

    private static String buildPrompt(String code, String fileName) {
        return "أنت Senior Software Engineer خبير في Python وJavaScript وHTML وJava وKotlin.\n" +
            "مهمتك: تحليل الكود التالي وإصلاح الدوال الناقصة فقط بكود حقيقي يعمل.\n\n" +
            "تعريف الدالة الناقصة (Stub) — لا تعتبر أي دالة ناقصة إلا إذا تحقق واحد مما يلي:\n" +
            "- جسمها فارغ تماماً\n" +
            "- تحتوي فقط على pass أو TODO أو FIXME\n" +
            "- ترجع return null أو return 0 أو return \"\" أو return [] أو return {}\n" +
            "- ترمي throw new UnsupportedOperationException()\n" +
            "- تحتوي على تعليق واضح يشير إلى أنها غير مكتملة\n\n" +
            "قواعد صارمة:\n" +
            "1. لا تُعدّل أي دالة مكتملة أو صحيحة\n" +
            "2. اقرأ توقيع الدالة واستخدم نفس أسماء المعاملات حرفياً\n" +
            "3. الكود يجب أن يعمل بدون NameError أو IndentationError أو SyntaxError\n" +
            "4. استخدم المكتبات المناسبة (re, hashlib, os, json)\n" +
            "5. كل متغير تستخدمه يجب أن يكون معرّفاً\n\n" +
            "أمثلة صحيحة:\n" +
            "def validate_email(email):\n" +
            "    import re\n" +
            "    return bool(re.match(r'[\\w.]+@[\\w.]+\\.[a-z]{2,}', str(email)))\n\n" +
            "def hash_password(password):\n" +
            "    import hashlib\n" +
            "    return hashlib.sha256(password.encode()).hexdigest()\n\n" +
            "def calculate_total(items):\n" +
            "    return sum(items) if items else 0\n\n" +
            "الملف: " + fileName + "\n\n" +
            "```\n" + code + "\n```\n\n" +
            "مهم جداً: أرجع النتيجة كـJSON فقط بدون أي نص إضافي أو شرح:\n" +
            "{\n" +
            "  \"fixes\": [\n" +
            "    {\n" +
            "      \"function_name\": \"اسم الدالة\",\n" +
            "      \"before\": \"الكود القديم بالضبط\",\n" +
            "      \"after\": \"الكود المصلح الكامل\",\n" +
            "      \"reason\": \"سبب التعديل\"\n" +
            "    }\n" +
            "  ]\n" +
            "}";
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
        HttpURLConnection conn = null;
        try {
            URL url = new URL(API_URL);
            conn = (HttpURLConnection) url.openConnection();
            conn.setRequestMethod("POST");
            conn.setRequestProperty("Content-Type", "application/json");
            conn.setRequestProperty("Authorization", "Bearer " + API_KEY);
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
            return "{\"fixes\":[]}";

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
