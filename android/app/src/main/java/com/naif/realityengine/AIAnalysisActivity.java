package com.naif.realityengine;

import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.os.Environment;
import android.widget.*;
import androidx.appcompat.app.AppCompatActivity;
import java.io.*;
import java.util.*;

public class AIAnalysisActivity extends AppCompatActivity {

    private static final int PICK_FILE = 1;
    private String fileCode = "";
    private String fileName = "";
    private String originalCode = "";

    // نتائج AI — قائمة اقتراحات
    private List<AIProposal> proposals = new ArrayList<>();
    private int currentIndex = 0;
    private int approved = 0;
    private int rejected = 0;

    // Views
    private TextView tvStatus;
    private TextView tvFuncName;
    private TextView tvBefore;
    private TextView tvAfter;
    private TextView tvExplanation;
    private Button btnApprove;
    private Button btnReject;
    private LinearLayout layoutReview;
    private LinearLayout layoutMain;

    static class AIProposal {
        String functionName;
        String before;
        String after;
        String explanation;
        int safetyScore;
    }

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        ScrollView scroll = new ScrollView(this);
        scroll.setBackgroundColor(0xFF0D1117);

        layoutMain = new LinearLayout(this);
        layoutMain.setOrientation(LinearLayout.VERTICAL);
        layoutMain.setPadding(24, 24, 24, 24);
        scroll.addView(layoutMain);
        setContentView(scroll);

        buildMainUI();
    }

    private void buildMainUI() {
        layoutMain.removeAllViews();

        // Title
        TextView tvTitle = new TextView(this);
        tvTitle.setText("✨ تحليل بالذكاء الاصطناعي");
        tvTitle.setTextColor(0xFF6E40C9);
        tvTitle.setTextSize(20);
        tvTitle.setPadding(0, 0, 0, 16);
        layoutMain.addView(tvTitle);

        // Back
        Button btnBack = new Button(this);
        btnBack.setText("← رجوع");
        btnBack.setBackgroundColor(0xFF21262D);
        btnBack.setTextColor(0xFF8B949E);
        btnBack.setOnClickListener(v -> finish());
        addView(btnBack, 120, 0, 16);

        // Status
        tvStatus = new TextView(this);
        tvStatus.setText("اختر ملف كود للبدء");
        tvStatus.setTextColor(0xFF8B949E);
        tvStatus.setTextSize(13);
        tvStatus.setPadding(0, 0, 0, 16);
        layoutMain.addView(tvStatus);

        // Upload button
        Button btnUpload = new Button(this);
        btnUpload.setText("📂 اختر ملف كود");
        btnUpload.setBackgroundColor(0xFF1C2128);
        btnUpload.setTextColor(0xFF58A6FF);
        btnUpload.setOnClickListener(v -> pickFile());
        addView(btnUpload, 130, 0, 12);

        // Analyze button
        Button btnAnalyze = new Button(this);
        btnAnalyze.setText("✨ تحليل وإصلاح بالذكاء الاصطناعي");
        btnAnalyze.setBackgroundColor(0xFF6E40C9);
        btnAnalyze.setTextColor(0xFFFFFFFF);
        btnAnalyze.setEnabled(false);
        btnAnalyze.setId(android.R.id.button1);
        addView(btnAnalyze, 140, 0, 16);

        btnAnalyze.setOnClickListener(v -> {
            if (fileCode.isEmpty()) return;
            btnAnalyze.setEnabled(false);
            btnAnalyze.setText("⏳ جاري التحليل...");
            tvStatus.setText("جاري إرسال الكود لـ Mistral AI...");
            runAI(btnAnalyze);
        });
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
            originalCode = fileCode;

            if (!fileCode.isEmpty()) {
                tvStatus.setText("✅ " + fileName + " — " + fileCode.split("\n").length + " سطر");
                Button btnAnalyze = findViewById(android.R.id.button1);
                if (btnAnalyze != null) btnAnalyze.setEnabled(true);
            }
        }
    }

    private void runAI(Button btnAnalyze) {
        // Legal check
        LegalGuard.LegalResult legal = LegalGuard.check(fileCode);
        if (legal.blocked) {
            tvStatus.setText("⛔ " + legal.userMessage);
            btnAnalyze.setText("✨ تحليل وإصلاح بالذكاء الاصطناعي");
            btnAnalyze.setEnabled(true);
            return;
        }

        // Detect stubs first
        StubDetector.StubResult stubs = StubDetector.detect(fileCode);
        if (stubs.stubs.isEmpty()) {
            tvStatus.setText("ما وجدنا دوال ناقصة — AI سيحلل الملف بحثاً عن تحسينات");
        }

        // Build AI prompt
        String prompt = buildPrompt(fileCode, fileName, stubs.stubs);

        AIEngine.analyze(fileCode, fileName, new AIEngine.Callback() {
            @Override
            public void onResult(String result) {
                runOnUiThread(() -> {
                    parseAndShowProposals(result, btnAnalyze);
                });
            }
            @Override
            public void onError(String error) {
                runOnUiThread(() -> {
                    tvStatus.setText("❌ خطأ: " + error);
                    btnAnalyze.setText("✨ تحليل وإصلاح بالذكاء الاصطناعي");
                    btnAnalyze.setEnabled(true);
                });
            }
        });
    }

    private String buildPrompt(String code, String name, List<StubDetector.StubFunction> stubs) {
        StringBuilder sb = new StringBuilder();
        sb.append("أنت مطور خبير. حلّل هذا الكود Python وأصلح كل دالة ناقصة.\n\n");
        sb.append("الملف: ").append(name).append("\n\n");
        sb.append("```python\n").append(code).append("\n```\n\n");
        if (!stubs.isEmpty()) {
            sb.append("الدوال الناقصة المكتشفة:\n");
            for (StubDetector.StubFunction s : stubs)
                sb.append("- ").append(s.name).append("() السطر ").append(s.line).append("\n");
        }
        sb.append("\nلكل دالة ناقصة اكتب:\n");
        sb.append("FUNCTION: اسم_الدالة\n");
        sb.append("BEFORE:\n```\ndef اسم_الدالة(...):\n    pass\n```\n");
        sb.append("AFTER:\n```\ndef اسم_الدالة(...):\n    # الكود الحقيقي\n```\n");
        sb.append("REASON: سبب الاقتراح بالعربي\n");
        sb.append("---\n");
        return sb.toString();
    }

    private void parseAndShowProposals(String aiResult, Button btnAnalyze) {
        proposals.clear();
        currentIndex = 0;
        approved = 0;
        rejected = 0;

        // Parse AI response
        String[] sections = aiResult.split("---");
        for (String section : sections) {
            if (section.contains("FUNCTION:") && section.contains("AFTER:")) {
                AIProposal p = new AIProposal();
                try {
                    p.functionName = extractBetween(section, "FUNCTION:", "\n").trim();
                    p.before = extractCode(section, "BEFORE:");
                    p.after = extractCode(section, "AFTER:");
                    p.explanation = extractBetween(section, "REASON:", "\n").trim();

                    // Security check
                    AISecurityGuard.GuardReport guard = AISecurityGuard.inspect(p.after);
                    p.safetyScore = guard.safetyScore;

                    if (guard.verdict != AISecurityGuard.GuardVerdict.BLOCKED) {
                        proposals.add(p);
                    }
                } catch (Exception ignored) {}
            }
        }

        btnAnalyze.setText("✨ تحليل وإصلاح بالذكاء الاصطناعي");
        btnAnalyze.setEnabled(true);

        if (proposals.isEmpty()) {
            // Show raw result
            tvStatus.setText("AI قال:");
            showRawResult(aiResult);
        } else {
            tvStatus.setText("وجد AI " + proposals.size() + " اقتراح — راجع كل واحد");
            showReviewUI();
        }
    }

    private void showReviewUI() {
        layoutMain.removeAllViews();

        // Header
        TextView tvHeader = new TextView(this);
        tvHeader.setText("مراجعة اقتراحات AI");
        tvHeader.setTextColor(0xFF6E40C9);
        tvHeader.setTextSize(18);
        tvHeader.setPadding(0, 0, 0, 16);
        layoutMain.addView(tvHeader);

        // Progress
        tvStatus = new TextView(this);
        layoutMain.addView(tvStatus);

        // Function name
        tvFuncName = new TextView(this);
        tvFuncName.setTextColor(0xFF58A6FF);
        tvFuncName.setTextSize(16);
        tvFuncName.setTypeface(null, android.graphics.Typeface.BOLD);
        tvFuncName.setPadding(0, 8, 0, 8);
        layoutMain.addView(tvFuncName);

        // Safety score
        TextView tvScore = new TextView(this);
        tvScore.setId(android.R.id.text1);
        tvScore.setTextColor(0xFF3FB950);
        tvScore.setTextSize(13);
        layoutMain.addView(tvScore);

        // Before label
        TextView lblBefore = new TextView(this);
        lblBefore.setText("قبل:");
        lblBefore.setTextColor(0xFFF85149);
        lblBefore.setTextSize(12);
        layoutMain.addView(lblBefore);

        // Before code
        tvBefore = new TextView(this);
        tvBefore.setTextColor(0xFFF85149);
        tvBefore.setBackgroundColor(0xFF1C2128);
        tvBefore.setPadding(12, 12, 12, 12);
        tvBefore.setTextSize(12);
        tvBefore.setTypeface(android.graphics.Typeface.MONOSPACE);
        addView(tvBefore, LinearLayout.LayoutParams.WRAP_CONTENT, 0, 8);

        // After label
        TextView lblAfter = new TextView(this);
        lblAfter.setText("بعد (اقتراح AI):");
        lblAfter.setTextColor(0xFF3FB950);
        lblAfter.setTextSize(12);
        layoutMain.addView(lblAfter);

        // After code
        tvAfter = new TextView(this);
        tvAfter.setTextColor(0xFF3FB950);
        tvAfter.setBackgroundColor(0xFF1C2128);
        tvAfter.setPadding(12, 12, 12, 12);
        tvAfter.setTextSize(12);
        tvAfter.setTypeface(android.graphics.Typeface.MONOSPACE);
        addView(tvAfter, LinearLayout.LayoutParams.WRAP_CONTENT, 0, 8);

        // Explanation
        tvExplanation = new TextView(this);
        tvExplanation.setTextColor(0xFF8B949E);
        tvExplanation.setTextSize(13);
        tvExplanation.setPadding(0, 0, 0, 16);
        layoutMain.addView(tvExplanation);

        // Buttons row
        LinearLayout btnRow = new LinearLayout(this);
        btnRow.setOrientation(LinearLayout.HORIZONTAL);

        btnReject = new Button(this);
        btnReject.setText("❌ رفض");
        btnReject.setBackgroundColor(0xFF1C2128);
        btnReject.setTextColor(0xFFF85149);
        LinearLayout.LayoutParams rp = new LinearLayout.LayoutParams(0, 140, 1);
        rp.setMargins(0, 0, 8, 0);
        btnReject.setLayoutParams(rp);
        btnReject.setOnClickListener(v -> handleReject());
        btnRow.addView(btnReject);

        btnApprove = new Button(this);
        btnApprove.setText("✅ موافقة وتطبيق");
        btnApprove.setBackgroundColor(0xFF3FB950);
        btnApprove.setTextColor(0xFFFFFFFF);
        btnApprove.setLayoutParams(new LinearLayout.LayoutParams(0, 140, 2));
        btnApprove.setOnClickListener(v -> handleApprove());
        btnRow.addView(btnApprove);

        layoutMain.addView(btnRow);

        showCurrentProposal();
    }

    private void showCurrentProposal() {
        if (currentIndex >= proposals.size()) {
            saveAndFinish();
            return;
        }

        AIProposal p = proposals.get(currentIndex);
        tvStatus.setText((currentIndex + 1) + " / " + proposals.size() +
            "  ✅ " + approved + "  ❌ " + rejected);
        tvFuncName.setText(p.functionName + "()");

        TextView tvScore = findViewById(android.R.id.text1);
        if (tvScore != null)
            tvScore.setText("Safety Score: " + p.safetyScore + "/100");

        tvBefore.setText(p.before != null ? p.before : "");
        tvAfter.setText(p.after != null ? p.after : "");
        tvExplanation.setText(p.explanation != null ? p.explanation : "");
    }

    private void handleApprove() {
        AIProposal p = proposals.get(currentIndex);
        if (p.after != null && !p.after.isEmpty()) {
            fileCode = ApprovalWorkflow.applyChange(fileCode, p.functionName, p.after);
        }
        approved++;
        currentIndex++;
        showCurrentProposal();
    }

    private void handleReject() {
        rejected++;
        currentIndex++;
        showCurrentProposal();
    }

    private void saveAndFinish() {
        try {
            File dir = new File(
                Environment.getExternalStoragePublicDirectory(
                    Environment.DIRECTORY_DOWNLOADS), "RealityEngine");
            if (!dir.exists()) dir.mkdirs();

            // Fixed file
            File fixed = new File(dir, "ai_fixed_" + fileName);
            new FileWriter(fixed).write(fileCode);

            // Original file
            File orig = new File(dir, "ai_original_" + fileName);
            new FileWriter(orig).write(originalCode);

            Toast.makeText(this,
                "✅ انتهى — موافق: " + approved + " | مرفوض: " + rejected +
                "\n📁 Downloads/RealityEngine/ai_fixed_" + fileName,
                Toast.LENGTH_LONG).show();
        } catch (Exception e) {
            Toast.makeText(this,
                "✅ انتهى — موافق: " + approved + " | مرفوض: " + rejected,
                Toast.LENGTH_LONG).show();
        }
        finish();
    }

    private void showRawResult(String result) {
        layoutMain.removeAllViews();

        TextView tvTitle = new TextView(this);
        tvTitle.setText("نتيجة تحليل AI");
        tvTitle.setTextColor(0xFF6E40C9);
        tvTitle.setTextSize(18);
        tvTitle.setPadding(0, 0, 0, 16);
        layoutMain.addView(tvTitle);

        ScrollView sv = new ScrollView(this);
        TextView tvRes = new TextView(this);
        tvRes.setText(result);
        tvRes.setTextColor(0xFFE6EDF3);
        tvRes.setTextSize(13);
        tvRes.setPadding(16, 16, 16, 16);
        tvRes.setBackgroundColor(0xFF1C2128);
        sv.addView(tvRes);
        layoutMain.addView(sv);

        Button btnBack = new Button(this);
        btnBack.setText("← رجوع");
        btnBack.setBackgroundColor(0xFF21262D);
        btnBack.setTextColor(0xFF8B949E);
        btnBack.setOnClickListener(v -> finish());
        addView(btnBack, 120, 0, 0);
    }

    // Helpers
    private void addView(android.view.View v, int h, int mt, int mb) {
        LinearLayout.LayoutParams p = new LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.MATCH_PARENT,
            h == 0 ? LinearLayout.LayoutParams.WRAP_CONTENT : h);
        p.setMargins(0, mt, 0, mb);
        v.setLayoutParams(p);
        layoutMain.addView(v);
    }

    private String extractBetween(String text, String start, String end) {
        int s = text.indexOf(start);
        if (s < 0) return "";
        s += start.length();
        int e = text.indexOf(end, s);
        return e < 0 ? text.substring(s) : text.substring(s, e);
    }

    private String extractCode(String text, String label) {
        int s = text.indexOf(label);
        if (s < 0) return "";
        int codeStart = text.indexOf("```", s);
        if (codeStart < 0) return "";
        codeStart = text.indexOf("\n", codeStart) + 1;
        int codeEnd = text.indexOf("```", codeStart);
        if (codeEnd < 0) return text.substring(codeStart);
        return text.substring(codeStart, codeEnd).trim();
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

    private void setTextStyle(TextView tv, int style) {
        tv.setTypeface(null, android.graphics.Typeface.BOLD);
    }
}
