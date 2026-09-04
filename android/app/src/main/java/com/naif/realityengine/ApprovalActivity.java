package com.naif.realityengine;

import android.os.Bundle;
import android.os.Environment;
import android.widget.Button;
import android.widget.TextView;
import android.widget.Toast;
import androidx.appcompat.app.AppCompatActivity;
import java.io.BufferedReader;
import java.io.File;
import java.io.FileReader;
import java.io.FileWriter;
import java.util.List;

public class ApprovalActivity extends AppCompatActivity {

    private String code         = "";
    private String fileName     = "";
    private String originalCode = "";
    private List<StubDetector.StubFunction> stubs;
    private int    currentIndex = 0;
    private int    approved     = 0;
    private ApprovalWorkflow.WorkflowItem currentItem = null;
    private int    rejected     = 0;
    private BackupManager backupManager;
    private String sessionId;

    // Views
    private TextView tvFuncName;
    private TextView tvSafetyScore;
    private TextView tvBefore;
    private TextView tvAfter;
    private TextView tvExplanation;
    private Button   btnApprove;
    private Button   btnReject;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        try {
            setContentView(R.layout.activity_approval);

            // Find views
            tvFuncName    = findViewById(R.id.tvFuncName);
            tvSafetyScore = findViewById(R.id.tvSafetyScore);
            tvBefore      = findViewById(R.id.tvBefore);
            tvAfter       = findViewById(R.id.tvAfter);
            tvExplanation = findViewById(R.id.tvExplanation);
            btnApprove    = findViewById(R.id.btnApprove);
            btnReject     = findViewById(R.id.btnReject);

            // Read code from temp file
            code = readTempFile();
            originalCode = code;
            fileName = getIntent().getStringExtra("fileName");
            if (fileName == null) fileName = "code.py";

            if (code.trim().isEmpty()) {
                showError("تعذّر قراءة الكود");
                return;
            }

            // Detect stubs
            StubDetector.StubResult result = StubDetector.detect(code);
            stubs = result.stubs;

            if (stubs.isEmpty()) {
                Toast.makeText(this, "لا دوال ناقصة", Toast.LENGTH_SHORT).show();
                finish();
                return;
            }

            // Create backup
            backupManager = new BackupManager(this);
            BackupManager.Session session = backupManager.createSession(fileName, code);
            sessionId = session.sessionId;

            // Button listeners
            btnApprove.setOnClickListener(v -> handleApprove());
            btnReject.setOnClickListener(v  -> handleReject());

            // Show first stub
            showCurrent();

        } catch (Exception e) {
            showError("خطأ: " + e.getMessage());
        }
    }

    // ── Read code from cache file ─────────────────────────
    private String readTempFile() {
        try {
            File tmp = new File(getCacheDir(), "temp_code.txt");
            if (!tmp.exists()) return "";
            StringBuilder sb = new StringBuilder();
            BufferedReader br = new BufferedReader(new FileReader(tmp));
            String line;
            while ((line = br.readLine()) != null) sb.append(line).append("\n");
            br.close();
            return sb.toString();
        } catch (Exception e) {
            return "";
        }
    }

    // ── Show current stub ─────────────────────────────────
    private void showCurrent() {
        if (currentIndex >= stubs.size()) {
            saveFiles();
            return;
        }

        StubDetector.StubFunction stub = stubs.get(currentIndex);
        ApprovalWorkflow.WorkflowItem item = ApprovalWorkflow.process(stub, code, new java.util.LinkedHashMap<>());

        currentItem = ApprovalWorkflow.process(stub, code, new java.util.LinkedHashMap<>());
        tvFuncName.setText(stub.name + "()  —  " + (currentIndex + 1) + "/" + stubs.size());
        tvSafetyScore.setText("Safety Score: " + item.safetyScore + "/100");
        tvBefore.setText(item.before != null ? item.before : stub.snippet);
        tvAfter.setText(item.suggestion  != null ? item.suggestion  : "لا اقتراح");
        tvExplanation.setText(item.explanation != null ? item.explanation : "");

        if (item.stage == ApprovalWorkflow.Stage.BLOCKED) {
            tvAfter.setText("⛔ " + item.blockedReason);
            tvAfter.setTextColor(0xFFF85149);
            btnApprove.setEnabled(false);
        } else {
            tvAfter.setTextColor(0xFF3FB950);
            btnApprove.setEnabled(true);
        }
    }

    // ── Approve ───────────────────────────────────────────
    private void handleApprove() {
        StubDetector.StubFunction stub = stubs.get(currentIndex);
        // استخدم الـ item المعروض مو تولد جديد
        ApprovalWorkflow.WorkflowItem item = currentItem;
        if (item == null) return;

        if (item.suggestion != null) {
            String before = code;
            code = ApprovalWorkflow.applyChange(code, stub.name, item.suggestion);
            backupManager.recordVersion(
                sessionId, stub.name,
                "تطبيق " + stub.name + "()",
                before, item.suggestion, true, item.safetyScore
            );
        }

        approved++;
        currentIndex++;
        // أظهر زر PDF لو خلصنا كل الموافقات
        if (currentIndex >= stubs.size() && PremiumManager.isPremium(this)) {
            android.widget.Button btnPDF = new android.widget.Button(this);
            btnPDF.setText("📄 تصدير PDF");
            btnPDF.setBackgroundColor(0xFF6E40C9);
            btnPDF.setTextColor(0xFFFFFFFF);
            btnPDF.setPadding(0, 20, 0, 20);
            android.widget.LinearLayout.LayoutParams lp = new android.widget.LinearLayout.LayoutParams(-1, -2);
            lp.setMargins(0, 16, 0, 0);
            btnPDF.setLayoutParams(lp);
            btnPDF.setOnClickListener(v -> {
                android.content.Intent i = new android.content.Intent(this, PDFReportActivity.class);
                i.putExtra("fileCode", code);
                i.putExtra("fileName", fileName);
                startActivity(i);
            });
            ((android.widget.LinearLayout) findViewById(android.R.id.content)).addView(btnPDF);
        }
        showCurrent();
    }

    // ── Reject ────────────────────────────────────────────
    private void handleReject() {
        StubDetector.StubFunction stub = stubs.get(currentIndex);
        backupManager.recordVersion(
            sessionId, stub.name,
            "رُفض " + stub.name + "()",
            stub.snippet, "", false, 0
        );
        rejected++;
        currentIndex++;
        showCurrent();
    }

    // ── Save files to Downloads/RealityEngine ─────────────
    private static final int SAVE_FILE = 99;

    private void saveFiles() {
        android.app.AlertDialog.Builder builder = new android.app.AlertDialog.Builder(this);
        builder.setTitle("✅ تم الإصلاح");
        builder.setMessage("موافق: " + approved + " | مرفوض: " + rejected);
        builder.setCancelable(false);

        android.widget.LinearLayout layout = new android.widget.LinearLayout(this);
        layout.setOrientation(android.widget.LinearLayout.VERTICAL);
        layout.setPadding(48, 16, 48, 16);

        // زر تنزيل ملف
        android.widget.Button btnSave = new android.widget.Button(this);
        btnSave.setText("💾 تنزيل الملف المصلح");
        btnSave.setBackgroundColor(0xFF238636);
        btnSave.setTextColor(0xFFFFFFFF);
        btnSave.setPadding(0, 20, 0, 20);
        android.widget.LinearLayout.LayoutParams lp1 = new android.widget.LinearLayout.LayoutParams(-1, -2);
        lp1.setMargins(0, 0, 0, 12);
        btnSave.setLayoutParams(lp1);
        layout.addView(btnSave);

        // زر PDF
        android.widget.Button btnPDF = new android.widget.Button(this);
        btnPDF.setText("📄 تصدير PDF");
        btnPDF.setBackgroundColor(0xFF6E40C9);
        btnPDF.setTextColor(0xFFFFFFFF);
        btnPDF.setPadding(0, 20, 0, 20);
        layout.addView(btnPDF);

        builder.setView(layout);
        builder.setNegativeButton("إغلاق", (d, w) -> finish());

        android.app.AlertDialog dialog = builder.create();

        btnSave.setOnClickListener(v -> {
            dialog.dismiss();
            android.content.Intent intent = new android.content.Intent(
                android.content.Intent.ACTION_CREATE_DOCUMENT);
            intent.addCategory(android.content.Intent.CATEGORY_OPENABLE);
            intent.setType("text/plain");
            intent.putExtra(android.content.Intent.EXTRA_TITLE, "fixed_" + fileName);
            startActivityForResult(intent, SAVE_FILE);
        });

        btnPDF.setOnClickListener(v -> {
            dialog.dismiss();
            if (PremiumManager.isPremium(this)) {
                android.content.Intent i = new android.content.Intent(this, PDFReportActivity.class);
                i.putExtra("fileCode", code);
                i.putExtra("fileName", fileName);
                startActivity(i);
            } else {
                startActivity(new android.content.Intent(this, SubscriptionActivity.class));
            }
        });

        dialog.show();
    }

    @Override
    protected void onActivityResult(int req, int res, android.content.Intent data) {
        super.onActivityResult(req, res, data);
        if (req == SAVE_FILE) {
            if (res == RESULT_OK && data != null) {
                try {
                    java.io.OutputStream os = getContentResolver().openOutputStream(data.getData());
                    os.write(code.getBytes("UTF-8"));
                    os.close();
                    Toast.makeText(this,
                        "✅ موافق: " + approved + " | مرفوض: " + rejected + "\n💾 تم الحفظ",
                        Toast.LENGTH_LONG).show();
                } catch (Exception e) {
                    Toast.makeText(this, "خطأ: " + e.getMessage(), Toast.LENGTH_LONG).show();
                }
            } else {
                Toast.makeText(this,
                    "✅ موافق: " + approved + " | مرفوض: " + rejected,
                    Toast.LENGTH_SHORT).show();
            }
            finish();
        }
    }

    // ── Show error ────────────────────────────────────────
    private void showError(String msg) {
        Toast.makeText(this, msg, Toast.LENGTH_LONG).show();
        finish();
    }
}

