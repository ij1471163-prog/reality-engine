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
    // API Key — يُمرر من الخارج (لا يُخزن داخل الكود أبدًا)
    // ═══════════════════════════════════════════════════════════
    private static String apiKey = null;

    /**
     * يُعيّن مفتاح API من الخارج (مثلاً من BuildConfig أو Secure Storage)
     * ⚠️ لا تُخزن المفتاح داخل الكود المصدري — استخدم Proxy Backend إن أمكن
     */
    public static void setApiKey(String key) {
        apiKey = key;
    }

    /** تغيير رابط الـAPI (للتبديل إلى Vercel Proxy لاحقًا)
     *  ⚠️ مقيّد بـHTTPS فقط لمنع تحويل الطلبات لرابط غير موثوق */
    public static void setApiUrl(String url) {
        if (url == null || !url.toLowerCase().startsWith("https://")) {
            throw new IllegalArgumentException("API URL يجب أن يبدأ بـ https:// فقط");
        }
        API_URL = url;
    }

    // ═══════════════════════════════════════════════════════════
    // واجهات الاستدعاء (Callbacks)
    // ═══════════════════════════════════════════════════════════
    public interface Callback {
        void onResult(String result);
        void onError(String error);
    }

    /** نتيجة التعديل المُنظمة */
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

    // ═══════════════════════════════════════════════════════════
    // الواجهة العامة — تحليل ملف كامل مع مرشحات
    // ═══════════════════════════════════════════════════════════

    /**
     * يحلل ملفًا كاملًا ويولد تعديلات دقيقة.
     *
     * @param fullCode       محتوى الملف الكامل
     * @param fileName       اسم الملف
     * @param candidates     قائمة المرشحات من StubDetector (منطقة + سياق)
     * @param callback       نتيجة التحليل
     */
    public static void analyzeFile(String fullCode, String fileName,
                                    List<StubDetector.Candidate> candidates,
                                    Callback callback) {
        if (apiKey == null || apiKey.isEmpty()) {
            mainHandler.post(() -> callback.onError(
                "خطأ: لم يتم تعيين API Key. استخدم AIEngine.setApiKey()"));
            return;
        }

        executor.submit(() -> {
            try {
                String prompt = buildContextualPrompt(fullCode, fileName, candidates);
                String aiResponse = callAPIWithRetry(prompt);
                List<ModificationResult> modifications = parseModifications(aiResponse);

                // ─────────────────────────────────────────────
                // طبقة تحقق أساسية قبل قبول أي تعديل من الـAI.
                // هذا لا يغني عن AISecurityGuard منفصل، لكنه يمنع
                // قبول أي Patch غير مطابق حرفيًا أو خارج الـCandidates.
                // ─────────────────────────────────────────────
                JSONArray fixesArray = new JSONArray();
                int rejectedCount = 0;
                for (ModificationResult mod : modifications) {
                    String rejectReason = validateModification(fullCode, mod, candidates);
                    if (rejectReason != null) {
                        rejectedCount++;
                        continue; // نرفض التعديل بأمان بدل تطبيقه أو تخمين مكانه
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

    /**
     * تحقق أساسي قبل قبول أي Patch من الـAI.
     * يرجع null إذا التعديل مقبول، أو سبب الرفض كنص إذا مرفوض.
     *
     * ⚠️ هذا تحقق أولي داخل AIEngine فقط. لا يغني عن AISecurityGuard
     * كطبقة مستقلة تتحقق أيضًا وقت التطبيق الفعلي في CodeApplier.
     */
    private static String validateModification(String fullCode, ModificationResult mod,
                                                 List<StubDetector.Candidate> candidates) {
        if (mod.originalCode == null || mod.originalCode.trim().isEmpty()) {
            return "before فارغ";
        }
        if (mod.modifiedCode == null || mod.modifiedCode.trim().isEmpty()) {
            return "after فارغ";
        }

        // 1) before يجب أن يطابق نصًا موجودًا فعلًا داخل الملف الحقيقي (حرفيًا)
        if (!fullCode.contains(mod.originalCode)) {
            return "before غير مطابق حرفيًا لأي نص داخل الملف";
        }

        // 2) الدالة المستهدفة يجب أن تكون ضمن الـCandidates التي اكتشفها StubDetector فعلًا
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

        // 3) حدود الأسطر يجب أن تكون منطقية وداخل الملف (0-based داخليًا)
        int totalLines = fullCode.split("\n", -1).length;
        if (mod.startLine < 0 || mod.endLine < 0 || mod.startLine > mod.endLine
                || mod.endLine > totalLines) {
            return "أرقام الأسطر start_line/end_line خارج حدود الملف أو غير منطقية";
        }

        // 4) رفض أي Patch يضيف import جديد لم يكن موجودًا أصلًا في الملف
        //    (فحص مبسّط: أي سطر import في after غير موجود في fullCode يُرفض)
        for (String line : mod.modifiedCode.split("\n")) {
            String trimmed = line.trim();
            if ((trimmed.startsWith("import ") || trimmed.startsWith("using "))
                    && !fullCode.contains(trimmed)) {
                return "التعديل يحاول إضافة import غير مصرح به: " + trimmed;
            }
        }

        return null; // مقبول
    }

    // ═══════════════════════════════════════════════════════════
    // الواجهة القديمة — للتوافق مع الأكواد السابقة
    // ⚠️ لم تعد ترسل الملف كامل كـ Candidate وهمي.
    // الآن تستخدم StubDetector.detect() لاستخراج المناطق الناقصة الحقيقية فقط،
    // حتى لا يعتبر الـAI أن الملف كامل منطقة قابلة للتعديل.
    // ═══════════════════════════════════════════════════════════
    public static void analyze(String code, String fileName, Callback callback) {
        StubDetector.StubResult result = StubDetector.detect(code);
        List<StubDetector.Candidate> candidates =
                StubDetector.toCandidates(code, result);

        if (candidates == null || candidates.isEmpty()) {
            // ما فيه stubs حقيقية مكتشفة — لا نرسل الملف كامل كـ candidate.
            // نرجع نتيجة فارغة بدل المخاطرة بفتح الملف كامل للتعديل.
            mainHandler.post(() -> callback.onResult("{\"fixes\":[],\"file_name\":\"" + fileName + "\"}"));
            return;
        }

        analyzeFile(code, fileName, candidates, callback);
    }

    // ═══════════════════════════════════════════════════════════
    // بناء الـPrompt الذكي — مع سياق المشروع الكامل
    // ═══════════════════════════════════════════════════════════

    private static String buildContextualPrompt(String fullCode, String fileName,
                                                   List<StubDetector.Candidate> candidates) {
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
        prompt.append("7. لا تُضف import إلا إذا كان ضرورياً وغير موجود\n\n");

        prompt.append("📁 الملف: ").append(fileName).append("\n\n");

        prompt.append("═══════════════════════════════════════\n");
        prompt.append("المحتوى الكامل للملف:\n");
        prompt.append("═══════════════════════════════════════\n");
        prompt.append("```\n").append(fullCode).append("\n```\n\n");

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
        prompt.append("أرجع JSON فقط بدون أي نص إضافي:\n");
        prompt.append("{\n");
        prompt.append("  \"fixes\": [\n");
        prompt.append("    {\n");
        prompt.append("      \"function_name\": \"اسم الدالة\",\n");
        prompt.append("      \"before\": \"الكود القديم بالضبط (للـdiff)\",\n");
        prompt.append("      \"after\": \"الكود المصلح الكامل\",\n");
        prompt.append("      \"reason\": \"سبب التعديل ولماذا هذا هو الحل الصحيح\",\n");
        prompt.append("      \"start_line\": رقم_سطر_البداية,\n");
        prompt.append("      \"end_line\": رقم_سطر_النهاية\n");
        prompt.append("    }\n");
        prompt.append("  ]\n");
        prompt.append("}\n\n");

        prompt.append("⚠️ مهم: أرقام الأسطر (start_line, end_line) تبدأ من 0 (0-based)، ");
        prompt.append("أي أن السطر الأول في الملف رقمه 0 وليس 1.\n");

        prompt.append("⚠️ مهم: إذا لم يكن هناك تعديل مطلوب، أرجع {\"fixes\":[]}.\n");
        prompt.append("⚠️ مهم: 'after' يجب أن يكون كوداً كاملاً يستبدل 'before' بالضبط.\n");

        return prompt.toString();
    }

    // ═══════════════════════════════════════════════════════════
    // استخراج التعديلات من رد الـAI
    // ═══════════════════════════════════════════════════════════

    private static List<ModificationResult> parseModifications(String aiResult) {
        List<ModificationResult> results = new ArrayList<>();

        if (aiResult == null) return results;

        String cleaned = aiResult.trim();

        // إزالة تغليف Markdown فقط (هذا شكل شائع ومتوقع من ردود الـAI)
        if (cleaned.startsWith("```")) {
            int firstNewline = cleaned.indexOf('\n');
            if (firstNewline != -1) {
                cleaned = cleaned.substring(firstNewline + 1);
            }
            if (cleaned.endsWith("```")) {
                cleaned = cleaned.substring(0, cleaned.lastIndexOf("```")).trim();
            }
        }

        // لا نستخرج JSON من منتصف نص عشوائي بصمت — إذا الرد لا يبدأ ولا ينتهي
        // بأقواس JSON صريحة بعد إزالة الـMarkdown، نعتبره ردًا غير صالح ونفشل بأمان
        if (!cleaned.startsWith("{") || !cleaned.endsWith("}")) {
            return results; // فشل آمن: قائمة فارغة بدل تخمين مكان الـJSON
        }

        try {
            JSONObject root = new JSONObject(cleaned);
            JSONArray fixes = root.optJSONArray("fixes");
            if (fixes == null) return results;

            for (int i = 0; i < fixes.length(); i++) {
                JSONObject fix = fixes.getJSONObject(i);
                String functionName = fix.optString("function_name", "unknown");
                String before = fix.optString("before", "");
                String after = fix.optString("after", "");
                String reason = fix.optString("reason", "");
                int startLine = fix.optInt("start_line", -1);
                int endLine = fix.optInt("end_line", -1);

                results.add(new ModificationResult(
                    functionName, before, after, reason, startLine, endLine));
            }
        } catch (JSONException e) {
            // فشل في التحليل — نرجع قائمة فارغة
        }

        return results;
    }

    // ═══════════════════════════════════════════════════════════
    // توليد Diff (للعرض على المستخدم قبل الموافقة)
    // ═══════════════════════════════════════════════════════════

    /**
     * يولد نص Diff بسيط يُعرض للمستخدم قبل الموافقة على التعديل
     */
    public static String generateDiff(String originalCode, ModificationResult mod) {
        // تحقق أساسي: لا نبني Diff إذا الكود المستهدف غير موجود فعلًا في الملف الأصلي
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

        String[] originalLines = originalCode.split("\n");
        String[] afterLines = mod.modifiedCode.split("\n");

        // نعرض السطور المحيطة للسياق
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

    // ═══════════════════════════════════════════════════════════
    // الاتصال بالـAPI — مع Retry وError Handling
    // ═══════════════════════════════════════════════════════════

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
            conn.setRequestProperty("Authorization", "Bearer " + apiKey);
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
            body.put("temperature", 0.1); // منخفض للدقة

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

