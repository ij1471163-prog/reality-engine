package com.naif.realityengine;

import android.util.Base64;
import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;

public class AIEngine {

    // المفتاح مشفر بـ XOR
    private static final String EK = "ITl/PSB/JGN/azYxYTYzM2oxYzBnZTQ2ZmU3MTBqY2JrZWY3ZGVnazBrM2pramphZ2U2N2Q2ZDMxYmFkNmtha2E0ZzM3MWBnMA==";
    private static final byte  XK = 0x52;

    private static String getKey() {
        byte[] decoded  = Base64.decode(EK, Base64.DEFAULT);
        byte[] original = new byte[decoded.length];
        for (int i = 0; i < decoded.length; i++)
            original[i] = (byte)(decoded[i] ^ XK);
        return new String(original, StandardCharsets.UTF_8);
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
                callback.onError("خطأ في الاتصال: " + e.getMessage());
            }
        }).start();
    }

    private static String buildPrompt(String code, String fileName) {
        return "أنت محلل كود متخصص. حلّل هذا الملف بدقة:\n\n" +
            "اسم الملف: " + fileName + "\n\n" +
            "```\n" + code + "\n```\n\n" +
            "ابحث عن:\n" +
            "1. الدوال الناقصة (pass / NotImplementedError)\n" +
            "2. الكود الوهمي أو المحاكي (Mock/Fake)\n" +
            "3. الأخطاء المنطقية\n" +
            "4. المشاكل الأمنية\n" +
            "5. أماكن التحسين\n\n" +
            "لكل مشكلة أعطني:\n" +
            "- السطر\n" +
            "- وصف المشكلة\n" +
            "- الكود المقترح\n" +
            "- سبب الاقتراح\n\n" +
            "أجب بالعربي. لا تعدل أي شيء مباشرة — فقط اقترح.";
    }

    private static String callAPI(String prompt) throws Exception {
        URL url = new URL("https://openrouter.ai/api/v1/chat/completions");
        HttpURLConnection conn = (HttpURLConnection) url.openConnection();
        conn.setRequestMethod("POST");
        conn.setRequestProperty("Content-Type", "application/json");
        conn.setRequestProperty("Authorization", "Bearer " + getKey());
        conn.setDoOutput(true);
        conn.setConnectTimeout(30000);
        conn.setReadTimeout(60000);

        String body = "{"
            + "\"model\":\"anthropic/claude-haiku-4-5\","
            + "\"messages\":[{\"role\":\"user\",\"content\":"
            + "\"" + prompt.replace("\"","\\\"").replace("\n","\\n") + "\""
            + "}],"
            + "\"max_tokens\":2000"
            + "}";

        OutputStream os = conn.getOutputStream();
        os.write(body.getBytes(StandardCharsets.UTF_8));
        os.close();

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
