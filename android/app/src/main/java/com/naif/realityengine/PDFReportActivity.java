package com.naif.realityengine;

import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.view.*;
import android.widget.*;
import androidx.appcompat.app.AppCompatActivity;
import androidx.core.content.FileProvider;
import java.io.File;
import java.util.List;

/**
 * PDFReportActivity v2.0
 * ✅ AppCompatActivity بدل Activity
 * ✅ Thread يُلغى لو الـ Activity اتدمّرت
 * ✅ onBackPressed محدّث لـ Android 13+
 */
public class PDFReportActivity extends AppCompatActivity {

    private String   fileCode;
    private String   fileName;
    private TextView tvStatus;
    private Button   btnExport;
    private File     pdfFile;
    private Thread   generatorThread; // ✅ نحتفظ بالـ thread لإلغائه

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        requestWindowFeature(Window.FEATURE_NO_TITLE);

        // تحقق Pro
        if (!PremiumManager.isPremium(this)) {
            new androidx.appcompat.app.AlertDialog.Builder(this)
                .setTitle("ميزة Pro")
                .setMessage("تصدير PDF متاح لمشتركي Pro فقط.")
                .setPositiveButton("⭐ اشترك Pro", (d, w) ->
                    startActivity(new Intent(this, SubscriptionActivity.class)))
                .setNegativeButton("رجوع", (d, w) -> finish())
                .setCancelable(false)
                .show();
            return;
        }

        fileCode = getIntent().getStringExtra("fileCode");
        fileName = getIntent().getStringExtra("fileName");
        if (fileName == null) fileName = "code.js";

        buildUI();
        generateReport();
    }

    // ✅ إلغاء الـ thread لو الـ Activity اتدمّرت
    @Override
    protected void onDestroy() {
        super.onDestroy();
        if (generatorThread != null && generatorThread.isAlive()) {
            generatorThread.interrupt();
        }
    }

    private void buildUI() {
        ScrollView scroll = new ScrollView(this);
        scroll.setBackgroundColor(0xFF0D1117);

        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setPadding(48, 64, 48, 48);
        scroll.addView(root);

        // Header
        TextView tvTitle = new TextView(this);
        tvTitle.setText("📄 تقرير PDF");
        tvTitle.setTextSize(22);
        tvTitle.setTypeface(null, android.graphics.Typeface.BOLD);
        tvTitle.setTextColor(0xFFE6EDF3);
        tvTitle.setPadding(0, 0, 0, 8);
        root.addView(tvTitle);

        TextView tvFile = new TextView(this);
        tvFile.setText(fileName);
        tvFile.setTextSize(13);
        tvFile.setTextColor(0xFF8B949E);
        tvFile.setPadding(0, 0, 0, 32);
        root.addView(tvFile);

        // Status
        tvStatus = new TextView(this);
        tvStatus.setText("⏳ جاري إنشاء التقرير...");
        tvStatus.setTextSize(14);
        tvStatus.setTextColor(0xFF8B949E);
        tvStatus.setGravity(android.view.Gravity.CENTER);
        tvStatus.setPadding(0, 0, 0, 24);
        root.addView(tvStatus);

        // Export Button
        LinearLayout.LayoutParams btnLP = new LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.MATCH_PARENT,
            LinearLayout.LayoutParams.WRAP_CONTENT);
        btnLP.setMargins(0, 16, 0, 0);
        btnExport = new Button(this);
        btnExport.setText("📤 مشاركة PDF");
        btnExport.setLayoutParams(btnLP);
        btnExport.setBackgroundColor(0xFF238636);
        btnExport.setTextColor(0xFFFFFFFF);
        btnExport.setTextSize(16);
        btnExport.setTypeface(null, android.graphics.Typeface.BOLD);
        btnExport.setPadding(0, 28, 0, 28);
        btnExport.setEnabled(false);
        btnExport.setOnClickListener(v -> sharePDF());
        root.addView(btnExport);

        // Back
        LinearLayout.LayoutParams backLP = new LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.MATCH_PARENT,
            LinearLayout.LayoutParams.WRAP_CONTENT);
        backLP.setMargins(0, 16, 0, 32);
        Button btnBack = new Button(this);
        btnBack.setText("↩ رجوع");
        btnBack.setLayoutParams(backLP);
        btnBack.setBackgroundColor(0xFF21262D);
        btnBack.setTextColor(0xFF8B949E);
        btnBack.setPadding(0, 20, 0, 20);
        btnBack.setOnClickListener(v -> finish());
        root.addView(btnBack);

        setContentView(scroll);
    }

    private void generateReport() {
        // ✅ نحفظ الـ thread لإلغائه في onDestroy
        generatorThread = new Thread(() -> {
            try {
                PDFGenerator.ReportData data = new PDFGenerator.ReportData(fileName);

                if (fileCode != null && !fileCode.isEmpty()) {
                    List<SecurityScanner.SecurityIssue> secIssues =
                        SecurityScanner.scan(fileCode, fileName);

                    data = PDFGenerator.fromEngineReport(fileName, "", secIssues);

                    BugDetector.BugReport bugReport = BugDetector.detect(fileCode);
                    for (BugDetector.Bug bug : bugReport.bugs) {
                        if (Thread.currentThread().isInterrupted()) return; // ✅ تحقق من الإلغاء
                        String sev = bug.severity == BugDetector.Severity.CRITICAL ? "CRITICAL"
                            : bug.severity == BugDetector.Severity.HIGH ? "HIGH" : "MEDIUM";
                        data.issues.add(new PDFGenerator.Issue(
                            bug.title, sev,
                            bug.fix != null ? bug.fix : "",
                            bug.line, ""));
                        data.totalIssues++;
                        switch (sev) {
                            case "CRITICAL": data.critical++; break;
                            case "HIGH":     data.high++;     break;
                            default:         data.medium++;   break;
                        }
                    }

                    data.securityScore = Math.max(0, 100
                        - data.critical * 20
                        - data.high     * 10
                        - data.medium   * 5
                        - data.low      * 2);
                }

                if (Thread.currentThread().isInterrupted()) return;

                final PDFGenerator.ReportData finalData = data;
                pdfFile = PDFGenerator.generate(PDFReportActivity.this, finalData);

                runOnUiThread(() -> {
                    if (isDestroyed()) return; // ✅ تحقق إن الـ Activity لا تزال موجودة
                    tvStatus.setTextColor(0xFF3FB950);
                    tvStatus.setText("✅ تقرير جاهز — "
                        + finalData.totalIssues + " مشكلة | Score: "
                        + finalData.securityScore + "/100");
                    btnExport.setEnabled(true);
                    btnExport.setBackgroundColor(0xFF238636);
                });

            } catch (Exception e) {
                runOnUiThread(() -> {
                    if (isDestroyed()) return;
                    tvStatus.setTextColor(0xFFE74C3C);
                    tvStatus.setText("❌ فشل إنشاء التقرير: " + e.getMessage());
                });
            }
        });
        generatorThread.start();
    }

    private void sharePDF() {
        if (pdfFile == null || !pdfFile.exists()) {
            Toast.makeText(this, "التقرير غير موجود", Toast.LENGTH_SHORT).show();
            return;
        }
        try {
            Uri uri = FileProvider.getUriForFile(this,
                getPackageName() + ".provider", pdfFile);

            Intent share = new Intent(Intent.ACTION_SEND);
            share.setType("application/pdf");
            share.putExtra(Intent.EXTRA_STREAM, uri);
            share.putExtra(Intent.EXTRA_SUBJECT, "Reality Engine Report — " + fileName);
            share.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            startActivity(Intent.createChooser(share, "مشاركة التقرير"));
        } catch (Exception e) {
            Toast.makeText(this, "خطأ في المشاركة", Toast.LENGTH_SHORT).show();
        }
    }

    // ✅ الطريقة الصحيحة في Android 13+
    @Override
    public void onBackPressed() {
        super.onBackPressed();
        finish();
    }
}


