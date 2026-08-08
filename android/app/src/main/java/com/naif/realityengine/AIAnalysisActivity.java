package com.naif.realityengine;

import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.widget.Button;
import android.widget.ScrollView;
import android.widget.TextView;
import android.widget.Toast;
import androidx.appcompat.app.AppCompatActivity;
import java.io.BufferedReader;
import java.io.InputStream;
import java.io.InputStreamReader;

public class AIAnalysisActivity extends AppCompatActivity {

    private static final int PICK_FILE = 1;
    private TextView tvResult;
    private Button btnAnalyze;
    private String fileCode = "";
    private String fileName = "";

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        // Layout
        android.widget.LinearLayout layout = new android.widget.LinearLayout(this);
        layout.setOrientation(android.widget.LinearLayout.VERTICAL);
        layout.setBackgroundColor(0xFF0D1117);
        layout.setPadding(24, 24, 24, 24);

        // Title
        TextView tvTitle = new TextView(this);
        tvTitle.setText("✨ تحليل بالذكاء الاصطناعي");
        tvTitle.setTextColor(0xFF6E40C9);
        tvTitle.setTextSize(20);
        tvTitle.setPadding(0, 0, 0, 16);
        layout.addView(tvTitle);

        // Back button
        Button btnBack = new Button(this);
        btnBack.setText("← رجوع");
        btnBack.setBackgroundColor(0xFF21262D);
        btnBack.setTextColor(0xFF8B949E);
        btnBack.setOnClickListener(v -> finish());
        android.widget.LinearLayout.LayoutParams bp = new android.widget.LinearLayout.LayoutParams(
            android.widget.LinearLayout.LayoutParams.MATCH_PARENT, 120);
        bp.setMargins(0, 0, 0, 16);
        btnBack.setLayoutParams(bp);
        layout.addView(btnBack);

        // Upload button
        Button btnUpload = new Button(this);
        btnUpload.setText("📂 اختر ملف كود");
        btnUpload.setBackgroundColor(0xFF1C2128);
        btnUpload.setTextColor(0xFF58A6FF);
        android.widget.LinearLayout.LayoutParams up = new android.widget.LinearLayout.LayoutParams(
            android.widget.LinearLayout.LayoutParams.MATCH_PARENT, 130);
        up.setMargins(0, 0, 0, 12);
        btnUpload.setLayoutParams(up);
        btnUpload.setOnClickListener(v -> pickFile());
        layout.addView(btnUpload);

        // Analyze button
        btnAnalyze = new Button(this);
        btnAnalyze.setText("✨ تحليل بالذكاء الاصطناعي");
        btnAnalyze.setBackgroundColor(0xFF6E40C9);
        btnAnalyze.setTextColor(0xFFFFFFFF);
        btnAnalyze.setEnabled(false);
        android.widget.LinearLayout.LayoutParams ap = new android.widget.LinearLayout.LayoutParams(
            android.widget.LinearLayout.LayoutParams.MATCH_PARENT, 140);
        ap.setMargins(0, 0, 0, 16);
        btnAnalyze.setLayoutParams(ap);
        btnAnalyze.setOnClickListener(v -> runAI());
        layout.addView(btnAnalyze);

        // Result area
        ScrollView scroll = new ScrollView(this);
        tvResult = new TextView(this);
        tvResult.setText("اختر ملف كود ثم اضغط تحليل");
        tvResult.setTextColor(0xFF8B949E);
        tvResult.setTextSize(13);
        tvResult.setPadding(16, 16, 16, 16);
        tvResult.setBackgroundColor(0xFF1C2128);
        tvResult.setLineSpacing(4, 1);
        scroll.addView(tvResult);
        android.widget.LinearLayout.LayoutParams sp = new android.widget.LinearLayout.LayoutParams(
            android.widget.LinearLayout.LayoutParams.MATCH_PARENT, 0, 1);
        scroll.setLayoutParams(sp);
        layout.addView(scroll);

        setContentView(layout);
    }

    private void pickFile() {
        Intent intent = new Intent(Intent.ACTION_GET_CONTENT);
        intent.setType("*/*");
        intent.addCategory(Intent.CATEGORY_OPENABLE);
        startActivityForResult(intent, PICK_FILE);
    }

    @Override
    protected void onActivityResult(int req, int res, Intent data) {
        super.onActivityResult(req, res, data);
        if (req == PICK_FILE && res == RESULT_OK && data != null) {
            Uri uri = data.getData();
            fileName = uri.getLastPathSegment();
            fileCode = readFile(uri);
            if (!fileCode.isEmpty()) {
                tvResult.setText("✅ تم تحميل: " + fileName + "\n\nاضغط تحليل للبدء");
                tvResult.setTextColor(0xFF3FB950);
                btnAnalyze.setEnabled(true);
            }
        }
    }

    private void runAI() {
        // Legal check first
        LegalGuard.LegalResult legal = LegalGuard.check(fileCode);
        if (legal.blocked) {
            Toast.makeText(this, "⛔ " + legal.userMessage, Toast.LENGTH_LONG).show();
            return;
        }

        btnAnalyze.setText("⏳ جاري التحليل...");
        btnAnalyze.setEnabled(false);
        tvResult.setText("جاري إرسال الكود للذكاء الاصطناعي...");
        tvResult.setTextColor(0xFF58A6FF);

        AIEngine.analyze(fileCode, fileName, new AIEngine.Callback() {
            @Override
            public void onResult(String result) {
                runOnUiThread(() -> {
                    btnAnalyze.setText("✨ تحليل بالذكاء الاصطناعي");
                    btnAnalyze.setEnabled(true);
                    tvResult.setText(result);
                    tvResult.setTextColor(0xFFE6EDF3);
                });
            }

            @Override
            public void onError(String error) {
                runOnUiThread(() -> {
                    btnAnalyze.setText("✨ تحليل بالذكاء الاصطناعي");
                    btnAnalyze.setEnabled(true);
                    tvResult.setText("❌ خطأ: " + error);
                    tvResult.setTextColor(0xFFF85149);
                });
            }
        });
    }

    private String readFile(Uri uri) {
        StringBuilder sb = new StringBuilder();
        try {
            InputStream is = getContentResolver().openInputStream(uri);
            BufferedReader br = new BufferedReader(new InputStreamReader(is));
            String line;
            while ((line = br.readLine()) != null) sb.append(line).append("\n");
            br.close();
        } catch (Exception e) { return ""; }
        return sb.toString();
    }
}
