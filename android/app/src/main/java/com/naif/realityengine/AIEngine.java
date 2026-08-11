package com.naif.realityengine;

import android.util.Base64;
import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;

public class AIEngine {

    private static String getKey() {
        // مفتاح مشفر بـ XOR
        String enc = "3c281e1c291e7b2808217b773a05087b2a17077c3721062d39342f7f25291637";
        StringBuilder sb = new StringBuilder();
        for (int i = 0; i < enc.length(); i += 2) {
            int b = Integer.parseInt(enc.substring(i, i+2), 16) ^ 0x4E;
            sb.append((char) b);
        }
        return sb.toString();
    }

    public interface Callback {
        void onResult(String result);
        void onError(String error);
    }

    public static void analyze(String code, String fileName, Callback callback) {
        new Thread(() -> {
            try {
                String prompt = buildPrompt(code, fileName);
                String result = callAPI(prompt);
                callback.onResult(result);
            } catch (Exception e) {
                callback.onError("خطأ: " + e.getClass().getSimpleName() + ": " + e.getMessage());
            }
        }).start();
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

    private static String callAPI(String prompt) throws Exception {
        URL url = new URL("https://api.mistral.ai/v1/chat/completions");
        HttpURLConnection conn = (HttpURLConnection) url.openConnection();
        conn.setRequestMethod("POST");
        conn.setRequestProperty("Content-Type", "application/json");
        conn.setRequestProperty("Authorization", "Bearer " + getKey());
        conn.setRequestProperty("HTTP-Referer", "https://github.com/reality-engine");
        conn.setRequestProperty("X-Title", "Reality Engine");
        conn.setDoOutput(true);
        conn.setConnectTimeout(30000);
        conn.setReadTimeout(60000);

        // تنظيف الـ prompt من characters خاطئة
        String safePrompt = prompt
            .replace("\\", "\\\\")
            .replace("\"", "\\\"")
            .replace("\n", "\\n")
            .replace("\r", "\\r")
            .replace("\t", "\\t");

        String body = "{"
            + "\"model\":\"mistral-small-latest\","
            + "\"messages\":[{\"role\":\"user\",\"content\":\"" + safePrompt + "\"}],"
            + "\"max_tokens\":2000"
            + "}";

        OutputStream os = conn.getOutputStream();
        os.write(body.getBytes(StandardCharsets.UTF_8));
        os.close();

        // تحقق من response code
        int responseCode = conn.getResponseCode();
        if (responseCode != 200) {
            BufferedReader err = new BufferedReader(
                new InputStreamReader(conn.getErrorStream(), StandardCharsets.UTF_8));
            StringBuilder errSb = new StringBuilder();
            String errLine;
            while ((errLine = err.readLine()) != null) errSb.append(errLine);
            err.close();
            throw new Exception("HTTP " + responseCode + ": " + errSb.toString());
        }

        BufferedReader br = new BufferedReader(
            new InputStreamReader(conn.getInputStream(), StandardCharsets.UTF_8));
        StringBuilder sb = new StringBuilder();
        String line;
        while ((line = br.readLine()) != null) sb.append(line);
        br.close();

        // Extract content from JSON response
        String response = sb.toString();
        int start = response.indexOf("\"content\":\"") + 11;
        int end   = response.indexOf("\",\"refusal\"", start);
        if (end == -1) end = response.indexOf("\"}", start);
        if (start > 10 && end > start)
            return response.substring(start, end)
                .replace("\\n", "\n")
                .replace("\\\"", "\"");

        return "تعذّر تحليل الاستجابة";
    }
}
