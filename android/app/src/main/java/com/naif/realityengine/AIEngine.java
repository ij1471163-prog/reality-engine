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
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

/**
 * AIEngine — محرك الذكاء الاصطناعي لتعديل الملفات الحقيقية (نسخة Google Gemini)
 *
 * المعمارية الكاملة:
 *   1. StubDetector يحدد المرشحات (Candidate Regions) الحقيقية فقط — مو الملف كامل
 *   2. AIEngine يبني prompt يحتوي: الملف الكامل + ملفات مرتبطة (سياق) + المرشحات
 *   3. Gemini API (function calling) يولد Patch دقيق ومنظم البنية
 *   4. طبقة تحقق داخلية (validateModification + detectFakeImplementation + كشف نسخ-لصق)
 *   5. AISecurityGuard (خارجي) يتحقق أمنيًا على مستوى الملف الكامل
 *   6. CodeApplier يطبق التعديل الفعلي على الملف
 *   7. BackupManager يحفظ نسخة احتياطية
 *   8. DiffViewer يعرض الفرق للمستخدم
 *   9. المستخدم يوافق → الحفظ النهائي
 *
 * ⚠️ قبل الاستخدام الفعلي تأكد بنفسك من:
 *   - MODEL: اسم موديل Gemini بالضبط من ai.google.dev — ما قدرت أتحقق منه هنا لعدم توفر بحث ويب
 *   - API_URL: تأكد إنه يطابق أحدث نسخة v1beta/v1 بتوثيق Gemini
 *   - apiKey: مفتاح Google AI (يبدأ عادة بـ AIzaSy...) — تأكد إنه صحيح ونشط
 */
public class AIEngine {

    // ═══════════════════════════════════════════════════════════
    // إعدادات الاتصال — Google Gemini API
    // ═══════════════════════════════════════════════════════════

    // ⚠️ تأكد من اسم الموديل بالضبط من https://ai.google.dev/gemini-api/docs/models
    // قبل الاعتماد عليه — ما قدرت أتحقق منه هنا.
    private static final String MODEL = "gemini-3.6-flash";

    private static String API_URL =
        "https://generativelanguage.googleapis.com/v1beta/models/" + MODEL + ":generateContent";

    private static final int MAX_TOKENS = 8000;
    private static final int CONNECT_TIMEOUT_MS = 30000;
    private static final int READ_TIMEOUT_MS = 90000;
    private static final int MAX_ATTEMPTS = 3;
    private static final long RETRY_BASE_DELAY_MS = 1000;

    // ─── Function Calling (structured output بدل الاعتماد على تنسيق نصي حر) ───
    private static final String TOOL_NAME = "submit_fixes";

    private static final ExecutorService executor = Executors.newCachedThreadPool();
    private static final Handler mainHandler = new Handler(Looper.getMainLooper());

    // ═══════════════════════════════════════════════════════════
    // API Key — يُمرر من الخارج
    // ═══════════════════════════════════════════════════════════
    // ⚠️ لا تكتب المفتاح هنا مباشرة أبدًا — GitHub Secret Scanning يرفض الـpush
    // إذا لقى مفتاح حقيقي بالكود. استخدم AIEngine.setApiKey(...) من BuildConfig
    // (مقروء من local.properties المستثنى بـ.gitignore) أو من GitHub Actions secret.
    private static String apiKey = null;

    /** يُعيّن مفتاح Google AI (Gemini) API */
    public static void setApiKey(String key) {
        apiKey = key;
    }

    /** تغيير رابط الـAPI — مقيّد بـHTTPS فقط */
    public static void setApiUrl(String url) {
        if (url == null || !url.toLowerCase().startsWith("https://")) {
            throw new IllegalArgumentException("API URL يجب أن يبدأ بـ https:// فقط");
        }
        API_URL = url;
    }

    // ═══════════════════════════════════════════════════════════
    // واجهات الاستدعاء
    // ═══════════════════════════════════════════════════════════
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

    // ═══════════════════════════════════════════════════════════
    // الواجهة العامة — تحليل ملف كامل مع مرشحات (+ملفات سياق اختيارية)
    // ═══════════════════════════════════════════════════════════

    public static void analyzeFile(String fullCode, String fileName,
                                    List<StubDetector.Candidate> candidates,
                                    Callback callback) {
        analyzeFile(fullCode, fileName, candidates, new LinkedHashMap<>(), callback);
    }

    public static void analyzeFile(String fullCode, String fileName,
                                    List<StubDetector.Candidate> candidates,
                                    Map<String, String> relatedFiles,
                                    Callback callback) {
        executor.submit(() -> {
            // جلب المفتاح داخل background thread
            if (apiKey == null || apiKey.isEmpty()) {
                try {
                    apiKey = fetchKeyFromServer();
                } catch (Exception ignored) {}
            }
            if (apiKey == null || apiKey.isEmpty()) {
                mainHandler.post(() -> callback.onError("خطأ: لم يتم تعيين API Key"));
                return;
            }
            // Debug: أظهر أول 6 أحرف من المفتاح
            final String keyHint = apiKey.length() > 6 ? apiKey.substring(0,6)+"..." : "SHORT";
            mainHandler.post(() -> android.util.Log.d("AIEngine", "Key OK: " + keyHint));
            try {
                String prompt = buildContextualPrompt(fullCode, fileName, candidates, relatedFiles);
                String rawResponse = callAPIWithRetry(prompt);
                List<ModificationResult> modifications = extractModifications(rawResponse);

                JSONArray fixesArray = new JSONArray();
                int rejectedCount = 0;
                Set<String> acceptedBodies = new HashSet<>();

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

                final String resultString;
                try {
                    resultString = result.toString(2);
                } catch (JSONException e) {
                    mainHandler.post(() -> callback.onError(
                        "خطأ بتحويل النتيجة: " + e.getMessage()));
                    return;
                }
                mainHandler.post(() -> callback.onResult(resultString));

            } catch (Exception e) {
                mainHandler.post(() -> callback.onError(
                    "خطأ: " + e.getClass().getSimpleName() + ": " + e.getMessage()));
            }
        });
    }

    // ═══════════════════════════════════════════════════════════
    // الواجهة القديمة المتوافقة
    // ═══════════════════════════════════════════════════════════
    public static void analyze(String code, String fileName, Callback callback) {
        StubDetector.StubResult result = StubDetector.detect(code);
        List<StubDetector.Candidate> candidates = StubDetector.toCandidates(code, result);

        if (candidates == null || candidates.isEmpty()) {
            mainHandler.post(() -> callback.onResult(
                "{\"fixes\":[],\"file_name\":\"" + fileName + "\",\"rejected_count\":0}"));
            return;
        }

        analyzeFile(code, fileName, candidates, callback);
    }

    // ═══════════════════════════════════════════════════════════
    // طبقة التحقق الداخلية (قبل قبول أي Patch من الـAI)
    // ═══════════════════════════════════════════════════════════

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
            "notimplementederror", "not implemented", "todo", "fixme",
            "raise notimplemented", "throw new unsupportedoperationexception",
            "// stub", "# ناقصة", "pass  #",
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

    // ═══════════════════════════════════════════════════════════
    // بناء الـPrompt الذكي
    // ═══════════════════════════════════════════════════════════

    private static String buildContextualPrompt(String fullCode, String fileName,
                                                   List<StubDetector.Candidate> candidates,
                                                   Map<String, String> relatedFiles) {
        StringBuilder prompt = new StringBuilder();

        // لو ما في stubs → وضع تدقيق الأخطاء
        boolean hasStubs = !candidates.isEmpty();

        prompt.append("أنت Senior Software Engineer خبير في تحليل الأكواد وإصلاحها.\n");
        if (hasStubs) {
            prompt.append("مهمتك: إصلاح الدوال الناقصة (Stubs) في ملف حقيقي من مشروع حقيقي.\n\n");
        } else {
            prompt.append("مهمتك: تدقيق الكود وإصلاح الأخطاء المنطقية.\n");
            prompt.append("لا توجد دوال ناقصة — ابحث عن:\n");
            prompt.append("• أخطاء في المنطق (= بدل ==، += بدل =)\n");
            prompt.append("• forEach مع return لا يعمل\n");
            prompt.append("• null/undefined بدون فحص\n");
            prompt.append("• أخطاء في الحسابات\n");
            prompt.append("• أي خطأ منطقي آخر\n\n");
            prompt.append("أرجع الإصلاحات بنفس format الدوال الناقصة:\n\n");
        }

        // استخرج البيانات الموجودة في الكود وأضفها للـ prompt
        java.util.regex.Matcher dataMatcher = java.util.regex.Pattern.compile(
            "^(\\w+)\\s*=\\s*\\[\\s*\\{[^]]{0,500}\\]",
            java.util.regex.Pattern.MULTILINE
        ).matcher(fullCode);
        StringBuilder dataContext = new StringBuilder();
        while (dataMatcher.find()) {
            String varName = dataMatcher.group(1);
            String sample = dataMatcher.group().substring(0, Math.min(200, dataMatcher.group().length()));
            dataContext.append("- ").append(varName).append(" = ").append(sample).append("\n");
        }
        if (dataContext.length() > 0) {
            prompt.append("\n🔴 مهم جداً — البيانات الحقيقية في الكود:\n");
            prompt.append(dataContext.toString());
            prompt.append("\n⚠️ استخدم هذه البيانات لفهم أشكال المتغيرات وأنواعها.\n");
            prompt.append("مثلاً: items هي list[dict] فيها price وquantity وname.\n");
            prompt.append("و users هي list[dict] فيها username وemail وscore وactive.\n\n");
        }

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
        prompt.append("استخدم هذا الفهم بدل التخمين\n");
        prompt.append("12. استخدم دالة (function) ").append(TOOL_NAME).append(" حصرًا لإرجاع نتيجتك\n");
        prompt.append("13. لكل دالة ناقصة، فكّر: وش النية؟ (بحث/حساب/فلتر/ترتيب) ثم اكتب كود يتماشى مع هذه النية\n");
        prompt.append("14. لو الدالة اسمها find_best_X → استخدم max(), لو find_worst_X → min()\n");
        prompt.append("15. لو الدالة اسمها calculate_average → اقسم على len(), لا تعيد نفس كود calculate_total\n\n");

        // تحليل SemanticEngine للدوال الناقصة
        prompt.append("🧠 تحليل ذكي للدوال الناقصة:\n");
        for (StubDetector.Candidate c : candidates) {
            java.util.List<String> cparams = CodeIntelligence.extractParams(fullCode, c.functionName);
            SemanticEngine.SemanticResult sem = SemanticEngine.analyze(c.functionName, cparams,
                CodeIntelligence.analyze(fullCode, c.functionName));
            prompt.append("- ").append(c.functionName).append("() → النية: ")
                  .append(sem.intent.name()).append(" (").append(String.format("%.0f%%", sem.confidence*100)).append(")\n");
            if (sem.suggestedCode != null) {
                prompt.append("  اقتراح المحرك: ").append(sem.suggestedCode.replace("\n","↵")).append("\n");
            }
        }
        prompt.append("\n");

        prompt.append("📁 الملف الرئيسي المستهدف بالتعديل: ").append(fileName).append("\n\n");

        prompt.append("═══════════════════════════════════════\n");
        prompt.append("المحتوى الكامل للملف الرئيسي:\n");
        prompt.append("═══════════════════════════════════════\n");
        prompt.append("```\n").append(fullCode).append("\n```\n\n");

        if (relatedFiles != null && !relatedFiles.isEmpty()) {
            prompt.append("═══════════════════════════════════════\n");
            prompt.append("ملفات مرتبطة من نفس المشروع (للفهم فقط — لا تُعدّلها):\n");
            prompt.append("═══════════════════════════════════════\n");
            for (Map.Entry<String, String> entry : relatedFiles.entrySet()) {
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
        prompt.append("⚠️ مهم: أرقام الأسطر (start_line, end_line) تبدأ من 0 (0-based)، ");
        prompt.append("أي أن السطر الأول في الملف رقمه 0 وليس 1.\n");
        prompt.append("⚠️ مهم: إذا لم يكن هناك تعديل مطلوب، استدعِ الدالة بمصفوفة fixes فارغة.\n");
        prompt.append("⚠️ مهم: 'after' يجب أن يكون كوداً كاملاً يستبدل 'before' بالضبط.\n");

        return prompt.toString();
    }

    // ═══════════════════════════════════════════════════════════
    // تحليل ردود الـAI (function calling + fallback نصي)
    // ═══════════════════════════════════════════════════════════

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

    /**
     * يستخرج التعديلات من رد Gemini API.
     * صيغة الرد: {"candidates":[{"content":{"parts":[{"functionCall":{"name":..,"args":{...}}}]}}]}
     * المسار الأساسي: functionCall باسم TOOL_NAME → args.fixes مباشرة (structured، موثوق).
     * المسار الاحتياطي: part.text يُحلَّل كـJSON إذا الموديل ما استدعى الدالة.
     */
    private static List<ModificationResult> extractModifications(String rawResponseJson) {
        List<ModificationResult> results = new ArrayList<>();
        if (rawResponseJson == null) return results;

        try {
            JSONObject responseJson = new JSONObject(rawResponseJson);
            JSONArray candidatesArray = responseJson.optJSONArray("candidates");
            if (candidatesArray == null || candidatesArray.length() == 0) return results;

            JSONObject firstCandidate = candidatesArray.getJSONObject(0);
            JSONObject content = firstCandidate.optJSONObject("content");
            if (content == null) return results;

            JSONArray parts = content.optJSONArray("parts");
            if (parts == null) return results;

            StringBuilder fallbackText = new StringBuilder();

            for (int i = 0; i < parts.length(); i++) {
                JSONObject part = parts.getJSONObject(i);

                JSONObject functionCall = part.optJSONObject("functionCall");
                if (functionCall != null && TOOL_NAME.equals(functionCall.optString("name"))) {
                    JSONObject args = functionCall.optJSONObject("args");
                    if (args != null) {
                        return parseFixesArray(args.optJSONArray("fixes"));
                    }
                } else if (part.has("text")) {
                    fallbackText.append(part.optString("text", ""));
                }
            }

            if (fallbackText.length() > 0) {
                return parseModifications(fallbackText.toString());
            }

        } catch (JSONException e) {
            // فشل تحليل الرد بالكامل — نرجع قائمة فارغة بأمان
        }

        return results;
    }

    /** تعريف دالة (Function Declaration) بصيغة Gemini لضمان بنية الرد */
    private static JSONObject buildFixesFunctionDeclaration() throws JSONException {
        JSONObject fixItemProps = new JSONObject();
        fixItemProps.put("function_name", new JSONObject().put("type", "STRING"));
        fixItemProps.put("before", new JSONObject().put("type", "STRING"));
        fixItemProps.put("after", new JSONObject().put("type", "STRING"));
        fixItemProps.put("reason", new JSONObject().put("type", "STRING"));
        fixItemProps.put("start_line", new JSONObject().put("type", "INTEGER"));
        fixItemProps.put("end_line", new JSONObject().put("type", "INTEGER"));

        JSONObject fixItemSchema = new JSONObject();
        fixItemSchema.put("type", "OBJECT");
        fixItemSchema.put("properties", fixItemProps);
        fixItemSchema.put("required", new JSONArray()
            .put("function_name").put("before").put("after")
            .put("reason").put("start_line").put("end_line"));

        JSONObject fixesArraySchema = new JSONObject();
        fixesArraySchema.put("type", "ARRAY");
        fixesArraySchema.put("items", fixItemSchema);

        JSONObject topProps = new JSONObject();
        topProps.put("fixes", fixesArraySchema);

        JSONObject paramsSchema = new JSONObject();
        paramsSchema.put("type", "OBJECT");
        paramsSchema.put("properties", topProps);
        paramsSchema.put("required", new JSONArray().put("fixes"));

        JSONObject functionDecl = new JSONObject();
        functionDecl.put("name", TOOL_NAME);
        functionDecl.put("description",
            "يُرسل قائمة التعديلات (fixes) الدقيقة للدوال الناقصة المكتشفة. " +
            "استخدم مصفوفة فارغة إذا لا يوجد تعديل مطلوب أو لم تستطع تحديد الحل الصحيح بثقة.");
        functionDecl.put("parameters", paramsSchema);

        return functionDecl;
    }

    // ═══════════════════════════════════════════════════════════
    // توليد Diff (للعرض قبل الموافقة)
    // ═══════════════════════════════════════════════════════════

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

    // ═══════════════════════════════════════════════════════════
    // الاتصال بـGemini API — مع Retry وError Handling
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

    private static String fetchKeyFromServer() {
        try {
            java.net.URL url = new java.net.URL("https://reality-engine-api-livid.vercel.app/api/key");
            java.net.HttpURLConnection conn = (java.net.HttpURLConnection) url.openConnection();
            conn.setConnectTimeout(5000);
            conn.setReadTimeout(5000);
            java.io.BufferedReader br = new java.io.BufferedReader(
                new java.io.InputStreamReader(conn.getInputStream()));
            String response = br.readLine();
            br.close();
            if (response != null) {
                org.json.JSONObject json = new org.json.JSONObject(response);
                return json.optString("key", "");
            }
        } catch (Exception e) {
            android.util.Log.e("AIEngine", "Key fetch: " + e.getMessage());
        }
        return "";
    }

    private static String callAPI(String prompt) throws Exception {
        if (apiKey == null || apiKey.isEmpty()) {
            apiKey = fetchKeyFromServer();
        }
        if (apiKey == null || apiKey.isEmpty()) {
            throw new Exception("API Key غير معيّن");
        }

        HttpURLConnection conn = null;
        try {
            // ⚠️ جربنا x-goog-api-key header وطلع 401/ACCESS_TOKEN_TYPE_UNSUPPORTED.
            // رجعنا لطريقة ?key= بالـURL — الطريقة الكلاسيكية الأكثر توثيقًا تاريخيًا لـGemini.
            URL url = new URL(API_URL + "?key=" + apiKey);
            conn = (HttpURLConnection) url.openConnection();
            conn.setRequestMethod("POST");
            conn.setRequestProperty("Content-Type", "application/json");
            // Gemini يقبل المفتاح كـheader بدل ما يكون بالـURL (أنظف من ناحية اللوقات)
            // المفتاح صار بالـURL (?key=) بدل الـheader — شوف السطر اللي بنى url فوق
            conn.setDoOutput(true);
            conn.setConnectTimeout(CONNECT_TIMEOUT_MS);
            conn.setReadTimeout(READ_TIMEOUT_MS);

            String systemPrompt =
                "أنت Senior Software Engineer دقيق جدًا. تلتزم حرفيًا بالتعليمات المعطاة. " +
                "لا ترجع أبدًا كودًا وهميًا (NotImplementedError/TODO/pass) ولا تنسخ منطق دالة لدالة أخرى. " +
                "استخدم دالة " + TOOL_NAME + " دائمًا لإرجاع نتيجتك النهائية.";

            JSONObject part = new JSONObject().put("text", prompt);
            JSONObject content = new JSONObject()
                .put("role", "user")
                .put("parts", new JSONArray().put(part));

            JSONObject systemInstruction = new JSONObject()
                .put("parts", new JSONArray().put(new JSONObject().put("text", systemPrompt)));

            JSONObject functionDeclarations = new JSONObject()
                .put("functionDeclarations", new JSONArray().put(buildFixesFunctionDeclaration()));

            // نجبر الموديل يستدعي الدالة دائمًا بدل ما يرجع نص حر
            JSONObject functionCallingConfig = new JSONObject()
                .put("mode", "ANY")
                .put("allowedFunctionNames", new JSONArray().put(TOOL_NAME));
            JSONObject toolConfig = new JSONObject()
                .put("functionCallingConfig", functionCallingConfig);

            JSONObject generationConfig = new JSONObject()
                .put("temperature", 0.1)
                .put("maxOutputTokens", MAX_TOKENS);

            JSONObject body = new JSONObject();
            body.put("contents", new JSONArray().put(content));
            body.put("systemInstruction", systemInstruction);
            body.put("tools", new JSONArray().put(functionDeclarations));
            body.put("toolConfig", toolConfig);
            body.put("generationConfig", generationConfig);

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
