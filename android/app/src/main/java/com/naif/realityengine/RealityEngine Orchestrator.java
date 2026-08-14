package com.naif.realityengine;

import android.os.Handler;
import android.os.Looper;
import org.json.JSONArray;
import org.json.JSONObject;
import java.io.File;
import java.util.List;

/**
 * RealityEngineOrchestrator — يدير التدفق الكامل:
 * 1. اكتشاف الدوال الناقصة (StubDetector)
 * 2. إرسال دالة واحدة للـAI (AIEngine)
 * 3. فحص أمني (AISecurityGuard)
 * 4. تطبيق التعديل (CodeApplier)
 * 5. حفظ الملف
 */
public class RealityEngineOrchestrator {

    public interface EngineListener {
        void onDetecting(String message);
        void onAnalyzing(String functionName);
        void onSecurityCheck(String functionName, AISecurityGuard.GuardReport report);
        void onApplied(String functionName, String newCode);
        void onBlocked(String functionName, String reason);
        void onError(String functionName, String error);
        void onComplete(int fixedCount, int blockedCount, int failedCount);
    }

    private final Handler mainHandler = new Handler(Looper.getMainLooper());

    public void fixFile(String code, String fileName, File outputFile, EngineListener listener) {
        new Thread(() -> {
            try {
                // 1. اكتشاف الدوال الناقصة
                post(() -> listener.onDetecting("جاري البحث عن الدوال الناقصة..."));
                List<StubDetector.StubInfo> stubs = StubDetector.findStubs(code, fileName);

                if (stubs.isEmpty()) {
                    post(() -> listener.onComplete(0, 0, 0));
                    return;
                }

                String currentCode = code;
                int fixed = 0, blocked = 0, failed = 0;

                // 2. معالجة كل دالة واحدة واحدة
                for (StubDetector.StubInfo stub : stubs) {
                    post(() -> listener.onAnalyzing(stub.functionName));

                    // نبني prompt محدد للدالة الواحدة
                    String singlePrompt = buildSingleFunctionPrompt(currentCode, stub, fileName);

                    // نستدعي AI (متزامن في هذا الثريد)
                    String aiResult = callAIBlocking(singlePrompt);

                    if (aiResult == null) {
                        post(() -> listener.onError(stub.functionName, "فشل الاتصال بالـAI"));
                        failed++;
                        continue;
                    }

                    // نستخرج الـfix
                    JSONObject fix = extractSingleFix(aiResult, stub.functionName);
                    if (fix == null) {
                        post(() -> listener.onError(stub.functionName, "AI لم يرجع تعديلاً صالحاً"));
                        failed++;
                        continue;
                    }

                    String after = fix.optString("after", "");

                    // 3. فحص أمني
                    AISecurityGuard.GuardReport report = AISecurityGuard.inspectWithContext(
                        after, currentCode, stub.startLine, stub.endLine, stub.functionName, fileName);

                    post(() -> listener.onSecurityCheck(stub.functionName, report));

                    if (report.verdict == AISecurityGuard.GuardVerdict.BLOCKED) {
                        post(() -> listener.onBlocked(stub.functionName, report.blockedReason));
                        blocked++;
                        continue;
                    }

                    // 4. تطبيق التعديل
                    String newCode = CodeApplier.replaceFunction(currentCode, stub.body, after);
                    if (newCode == null) {
                        post(() -> listener.onError(stub.functionName, "فشل استبدال الدالة"));
                        failed++;
                        continue;
                    }

                    // تحقق syntax سريع
                    AISecurityGuard.Language lang = AISecurityGuard.detectLanguage(newCode, fileName);
                    boolean syntaxOk = AISecurityGuard.structuralSyntaxCheck(newCode, lang);
                    if (!syntaxOk) {
                        post(() -> listener.onError(stub.functionName, "الكود المعدل غير متوازن هيكلياً"));
                        failed++;
                        continue;
                    }

                    currentCode = newCode;
                    fixed++;
                    post(() -> listener.onApplied(stub.functionName, after));
                }

                // 5. حفظ الملف النهائي
                CodeApplier.writeFile(outputFile, currentCode);

                int finalFixed = fixed;
                int finalBlocked = blocked;
                int finalFailed = failed;
                post(() -> listener.onComplete(finalFixed, finalBlocked, finalFailed));

            } catch (Exception e) {
                post(() -> listener.onError("?", "استثناء: " + e.getMessage()));
            }
        }).start();
    }

    // ============================================================
    // داخلي
    // ============================================================

    private String buildSingleFunctionPrompt(String fullCode, StubDetector.StubInfo stub, String fileName) {
        return "أنت Senior Software Engineer خبير في Python.\n" +
            "مهمتك: أكمل الدالة الناقصة التالية فقط. لا تعدل أي دالة أخرى.\n\n" +
            "قواعد صارمة:\n" +
            "1. أكمل الدالة: " + stub.functionName + " فقط\n" +
            "2. استخدم نفس أسماء المعاملات\n" +
            "3. الكود يجب أن يعمل بدون أخطاء\n" +
            "4. لا تضيف دوال جديدة\n" +
            "5. لا تغير الدوال المكتملة\n\n" +
            "هيكل البيانات المتوقع:\n" +
            "- users = [{\"username\": \"ali\", \"email\": \"...\", \"active\": true, \"score\": 95}, ...]\n" +
            "- items = [{\"name\": \"...\", \"price\": 2500, \"quantity\": 2}, ...]\n\n" +
            "الملف: " + fileName + "\n\n" +
            "```\n" + fullCode + "\n```\n\n" +
            "أكمل هذه الدالة فقط:\n" +
            "FUNCTION: " + stub.functionName + "\n" +
            "AFTER:\n```\n" +
            "def " + stub.functionName + "(...):\n" +
            "    # أكمل هنا\n" +
            "```\n\n" +
            "أرجع النتيجة كـJSON:\n" +
            "{\"fixes\":[{\"function_name\":\"" + stub.functionName + "\",\"after\":\"الكود الكامل هنا\"}]}";
    }

    private String callAIBlocking(String prompt) throws Exception {
        // نستخدم AIEngine لكن نحتاج نستدعيه بشكل متزامن هنا
        final String[] result = new String[1];
        final Exception[] error = new Exception[1];
        final Object lock = new Object();
        boolean[] done = {false};

        AIEngine.analyze(prompt, "temp.py", new AIEngine.Callback() {
            @Override
            public void onResult(String r) {
                synchronized (lock) {
                    result[0] = r;
                    done[0] = true;
                    lock.notify();
                }
            }
            @Override
            public void onError(String e) {
                synchronized (lock) {
                    error[0] = new Exception(e);
                    done[0] = true;
                    lock.notify();
                }
            }
        });

        synchronized (lock) {
            while (!done[0]) lock.wait();
        }

        if (error[0] != null) throw error[0];
        return result[0];
    }

    private JSONObject extractSingleFix(String aiResult, String expectedFunc) {
        JSONArray fixes = AIEngine.extractFixes(aiResult);
        if (fixes == null || fixes.length() == 0) return null;
        for (int i = 0; i < fixes.length(); i++) {
            JSONObject f = fixes.optJSONObject(i);
            if (f != null && expectedFunc.equals(f.optString("function_name"))) {
                return f;
            }
        }
        return null;
    }

    private void post(Runnable r) {
        mainHandler.post(r);
    }
}

