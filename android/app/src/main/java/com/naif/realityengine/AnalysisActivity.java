package com.naif.realityengine;

import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.view.View;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.TextView;
import android.widget.Toast;
import androidx.appcompat.app.AppCompatActivity;
import java.io.BufferedReader;
import java.io.InputStream;
import java.io.InputStreamReader;

public class AnalysisActivity extends AppCompatActivity {

    private String fileCode = "";
    private String fileName = "";
    private EngineAnalyzer.EngineReport report;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_analysis);

        Uri uri = getIntent().getData();
        if (uri == null) { finish(); return; }

        // Read file
        String rawName = uri.getLastPathSegment();
        // استخرج اسم الملف فقط
        if (rawName != null) {
            rawName = rawName.replace("%2F", "/").replace("%3A", ":");
            int slash = rawName.lastIndexOf('/');
            if (slash >= 0) rawName = rawName.substring(slash + 1);
            int colon = rawName.lastIndexOf(':');
            if (colon >= 0) rawName = rawName.substring(colon + 1);
        }
        fileName = rawName != null ? rawName : "unknown";
        fileCode = readFile(uri);

        if (fileCode.isEmpty()) {
            Toast.makeText(this, "الملف فاضي أو تعذّر قراءته", Toast.LENGTH_SHORT).show();
            finish();
            return;
        }

        // Legal check first
        LegalGuard.LegalResult legal = LegalGuard.check(fileCode);
        if (legal.blocked) {
            Toast.makeText(this, legal.userMessage, Toast.LENGTH_LONG).show();
            finish();
            return;
        }

        // Analyze - محرك Java المحلي
        report = EngineAnalyzer.analyze(fileCode, fileName);



        // Show results
        TextView tvFileName      = findViewById(R.id.tvFileName);
        TextView tvEngineMessage = findViewById(R.id.tvEngineMessage);
        TextView tvIssueCount    = findViewById(R.id.tvIssueCount);
        TextView tvSummaryBugs   = findViewById(R.id.tvSummaryBugs);
        TextView tvSummaryStubs  = findViewById(R.id.tvSummaryStubs);
        TextView tvSummaryTotal  = findViewById(R.id.tvSummaryTotal);
        LinearLayout llStubs     = findViewById(R.id.llStubs);
        Button btnProceed        = findViewById(R.id.btnProceed);
        Button btnCancel         = findViewById(R.id.btnCancel);

        int bugCount  = report.bugCount;
        int stubCount = report.stubs != null ? report.stubs.size() : 0;
        int total     = bugCount + stubCount;

        tvFileName.setText("📄 " + fileName);
        tvIssueCount.setText(total + " مشكلة");
        tvSummaryBugs.setText("🐛 " + bugCount + " أخطاء");
        tvSummaryStubs.setText("⚠️ " + stubCount + " ناقصة");
        tvSummaryTotal.setText(total == 0 ? "✅ نظيف" : "🔍 يحتاج مراجعة");
        tvEngineMessage.setText(report.recommendation);

        // Add stub cards
        // DataFlow warnings
        if (report.securityNotes != null && !report.securityNotes.isEmpty()) {
            android.widget.TextView tvFlow = new android.widget.TextView(this);
            tvFlow.setText("\uD83D\uDD0D تدفق البيانات:\n" + String.join("\n", report.securityNotes));
            tvFlow.setTextColor(0xFFFF9800);
            tvFlow.setTextSize(12);
            tvFlow.setPadding(16, 8, 16, 8);
            llStubs.addView(tvFlow);
        }

        for (EngineAnalyzer.FunctionAnalysis fn : report.stubs) {
            android.widget.LinearLayout row = new android.widget.LinearLayout(this);
            row.setOrientation(android.widget.LinearLayout.HORIZONTAL);
            row.setBackgroundColor(0xFF1C2128);
            android.widget.LinearLayout.LayoutParams rowParams = new android.widget.LinearLayout.LayoutParams(
                android.widget.LinearLayout.LayoutParams.MATCH_PARENT,
                android.widget.LinearLayout.LayoutParams.WRAP_CONTENT);
            rowParams.setMargins(0, 8, 0, 0);
            row.setLayoutParams(rowParams);
            row.setPadding(16, 12, 16, 12);

            TextView tv = new TextView(this);
            String color = fn.fixability == EngineAnalyzer.Fixability.HIGH   ? "✅"
                         : fn.fixability == EngineAnalyzer.Fixability.MEDIUM ? "⚠️"
                         : "❌";
            tv.setText(color + " " + fn.name + "()  — " + fn.intent + "\n" + fn.fixReason);
            tv.setTextColor(0xFFE6EDF3);
            tv.setTextSize(13);
            android.widget.LinearLayout.LayoutParams tvParams = new android.widget.LinearLayout.LayoutParams(
                0, android.widget.LinearLayout.LayoutParams.WRAP_CONTENT, 1f);
            tv.setLayoutParams(tvParams);

            row.addView(tv);
            llStubs.addView(row);
        }

        btnCancel.setOnClickListener(v -> finish());

        // نص توضيحي
        android.widget.TextView tvHint = new android.widget.TextView(this);
        tvHint.setText("💡 مستخدم الموقع يحصل على تحليل أعمق وأدق باستخدام محركات Reality Engine المتقدمة، مقارنةً بالمحرك المحلي في الجوال.");
        tvHint.setTextSize(11);
        tvHint.setTextColor(0xFF888888);
        tvHint.setPadding(8, 8, 8, 8);
        ((android.widget.LinearLayout) btnCancel.getParent()).addView(tvHint, ((android.widget.LinearLayout) btnCancel.getParent()).indexOfChild(btnCancel) + 1);

        // زر AI محذوف — يوصل من MainActivity

        // زر PDF (Pro)
        android.widget.Button btnPDF = new android.widget.Button(this);
        btnPDF.setText("📄 تصدير PDF");
        btnPDF.setBackgroundColor(0xFF6E40C9);
        btnPDF.setTextColor(0xFFFFFFFF);
        btnPDF.setTextSize(13);
        android.widget.LinearLayout.LayoutParams pdfLP = new android.widget.LinearLayout.LayoutParams(
            android.widget.LinearLayout.LayoutParams.MATCH_PARENT, android.widget.LinearLayout.LayoutParams.WRAP_CONTENT);
        pdfLP.setMargins(0, 8, 0, 0);
        btnPDF.setLayoutParams(pdfLP);
        btnPDF.setVisibility(android.view.View.GONE); // يظهر بعد الإصلاح
        ((android.view.ViewGroup) btnProceed.getParent()).addView(btnPDF);
        btnPDF.setOnClickListener(v -> {
            android.content.Intent pdfIntent = new android.content.Intent(this, PDFReportActivity.class);
            pdfIntent.putExtra("fileCode", fileCode);
            pdfIntent.putExtra("fileName", fileName);
            startActivity(pdfIntent);
        });

        btnProceed.setOnClickListener(v -> {
            if (report.stubs.isEmpty() && report.bugCount == 0) {
                Toast.makeText(this, "✅ الكود نظيف — لا يحتاج إصلاح", Toast.LENGTH_SHORT).show();
                return;
            }
            try {
                java.io.File tmp = new java.io.File(getCacheDir(), "temp_code.txt");
                java.io.FileWriter fw = new java.io.FileWriter(tmp);
                fw.write(fileCode);
                fw.close();
            } catch (Exception e) { e.printStackTrace(); }
            Intent intent = new Intent(this, ApprovalActivity.class);
            intent.putExtra("fileName", fileName);
            startActivity(intent);
        });
    }

    private String readFile(Uri uri) {
        StringBuilder sb = new StringBuilder();
        try {
            InputStream is = getContentResolver().openInputStream(uri);
            BufferedReader br = new BufferedReader(new InputStreamReader(is));
            String line;
            while ((line = br.readLine()) != null) {
                sb.append(line).append("\n");
            }
            br.close();
        } catch (Exception e) {
            return "";
        }
        return sb.toString();
    }

    private void showAIResult(String result) {
        new android.app.AlertDialog.Builder(this)
            .setTitle("نتيجة تحليل الذكاء الاصطناعي")
            .setMessage(result)
            .setPositiveButton("حسناً", null)
            .setNeutralButton("ابدأ الإصلاح", (d, w) -> {
                try {
                    java.io.File tmp = new java.io.File(getCacheDir(), "ai_result.txt");
                    java.io.FileWriter fw = new java.io.FileWriter(tmp);
                    fw.write(result);
                    fw.close();
                } catch (Exception e) { e.printStackTrace(); }
                Intent intent = new Intent(this, ApprovalActivity.class);
                // كتابة temp_code.txt عشان ApprovalActivity يقدر يقرأه
                try {
                    java.io.File tmp = new java.io.File(getCacheDir(), "temp_code.txt");
                    java.io.FileWriter fw = new java.io.FileWriter(tmp);
                    fw.write(fileCode);
                    fw.close();
                } catch (Exception ignored) {}
                intent.putExtra("fileName", fileName);
                intent.putExtra("useAI", true);
                startActivity(intent);
            })
            .show();
    }
}

