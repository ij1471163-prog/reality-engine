package com.naif.realityengine;

import android.app.Activity;
import android.os.Bundle;
import android.widget.*;
import org.json.*;

public class WebEngineActivity extends Activity {

    private String code, fileName;
    private TextView tvResults;
    private Button btnFix, btnDownload;
    private String fixedCode = null;

    @Override
    protected void onCreate(Bundle b) {
        super.onCreate(b);

        // Layout
        LinearLayout layout = new LinearLayout(this);
        layout.setOrientation(LinearLayout.VERTICAL);
        layout.setBackgroundColor(0xFF0D1117);
        layout.setPadding(24,24,24,24);

        TextView tvTitle = new TextView(this);
        tvTitle.setText("🛡️ Reality Engine");
        tvTitle.setTextColor(0xFFA371F7);
        tvTitle.setTextSize(20);
        layout.addView(tvTitle);

        tvResults = new TextView(this);
        tvResults.setText("⏳ جاري التحليل...");
        tvResults.setTextColor(0xFFE6EDF3);
        tvResults.setPadding(0,16,0,16);
        layout.addView(tvResults);

        btnFix = new Button(this);
        btnFix.setText("🔧 إصلاح بالمحرك");
        btnFix.setBackgroundColor(0xFF238636);
        btnFix.setTextColor(0xFFFFFFFF);
        btnFix.setVisibility(android.view.View.GONE);
        layout.addView(btnFix);

        btnDownload = new Button(this);
        btnDownload.setText("💾 تنزيل الملف المصلح");
        btnDownload.setBackgroundColor(0xFF6E40C9);
        btnDownload.setTextColor(0xFFFFFFFF);
        btnDownload.setVisibility(android.view.View.GONE);
        layout.addView(btnDownload);

        setContentView(layout);

        // استقبل الكود
        code = getIntent().getStringExtra("code");
        fileName = getIntent().getStringExtra("fileName");
        if (fileName == null) fileName = "code.js";

        // حلل
        analyze(code, false);

        btnFix.setOnClickListener(v -> analyze(code, true));
        btnDownload.setOnClickListener(v -> downloadFile());
    }

    private void analyze(String c, boolean fix) {
        tvResults.setText("⏳ " + (fix ? "جاري الإصلاح..." : "جاري التحليل..."));
        btnFix.setVisibility(android.view.View.GONE);

        AIEngine.analyzeWithEngine(c, fileName, new AIEngine.Callback() {
            @Override public void onResult(String r) {
                runOnUiThread(() -> showResults(r, fix));
            }
            @Override public void onError(String e) {
                runOnUiThread(() -> tvResults.setText("❌ خطأ: " + e));
            }
        });
    }

    private void showResults(String r, boolean wasFix) {
        try {
            JSONObject j = new JSONObject(r);
            int score = j.optInt("score", 0);
            JSONObject stats = j.optJSONObject("stats");
            int total = stats != null ? stats.optInt("total", 0) : 0;
            int critical = stats != null ? stats.optInt("critical", 0) : 0;
            int high = stats != null ? stats.optInt("high", 0) : 0;

            StringBuilder sb = new StringBuilder();
            sb.append("📊 Score: ").append(score).append("/100\n");
            sb.append("🔴 حرج: ").append(critical).append(" | 🟠 عالي: ").append(high).append("\n");
            sb.append("📁 ").append(fileName).append(" — ").append(total).append(" مشكلة\n\n");

            JSONArray issues = j.optJSONArray("issues");
            if (issues != null) {
                for (int i = 0; i < Math.min(issues.length(), 10); i++) {
                    JSONObject issue = issues.getJSONObject(i);
                    String sev = issue.optString("severity","?");
                    String icon = "c".equals(sev) ? "🔴" : "h".equals(sev) ? "🟠" : "🟡";
                    sb.append(icon).append(" ").append(issue.optString("title","")).append("\n");
                    sb.append("  س").append(issue.optInt("line",0)).append("\n");
                }
            }

            tvResults.setText(sb.toString());

            if (wasFix && j.has("fixed")) {
                fixedCode = j.optString("fixed", null);
                if (fixedCode != null) {
                    btnDownload.setVisibility(android.view.View.VISIBLE);
                }
            } else if (!wasFix) {
                btnFix.setVisibility(android.view.View.VISIBLE);
            }

        } catch (Exception e) {
            tvResults.setText("❌ " + e.getMessage());
        }
    }

    private void downloadFile() {
        if (fixedCode == null) return;
        android.content.Intent intent = new android.content.Intent(
            android.content.Intent.ACTION_CREATE_DOCUMENT);
        intent.addCategory(android.content.Intent.CATEGORY_OPENABLE);
        intent.setType("text/plain");
        intent.putExtra(android.content.Intent.EXTRA_TITLE, "fixed_" + fileName);
        startActivityForResult(intent, 99);
    }

    @Override
    protected void onActivityResult(int req, int res, android.content.Intent data) {
        if (req == 99 && res == RESULT_OK && data != null && fixedCode != null) {
            try {
                java.io.OutputStream os = getContentResolver().openOutputStream(data.getData());
                os.write(fixedCode.getBytes("UTF-8"));
                os.close();
                Toast.makeText(this, "✅ تم الحفظ", Toast.LENGTH_SHORT).show();
            } catch (Exception e) {
                Toast.makeText(this, "❌ " + e.getMessage(), Toast.LENGTH_SHORT).show();
            }
        }
    }
}
