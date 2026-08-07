package com.naif.realityengine;

import android.os.Bundle;
import android.widget.Button;
import android.widget.TextView;
import android.widget.Toast;
import androidx.appcompat.app.AppCompatActivity;
import java.util.List;

public class ApprovalActivity extends AppCompatActivity {

    private String code;
    private String fileName;
    private List<StubDetector.StubFunction> stubs;
    private int currentIndex = 0;
    private BackupManager backupManager;
    private String sessionId;
    private int approved = 0;
    private int rejected = 0;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        try {
        setContentView(R.layout.activity_approval);

        // Read code from temp file
        try {
            java.io.File tmp = new java.io.File(getCacheDir(), "temp_code.txt");
            java.io.BufferedReader br = new java.io.BufferedReader(new java.io.FileReader(tmp));
            StringBuilder sb = new StringBuilder();
            String line;
            while ((line = br.readLine()) != null) sb.append(line).append("\n");
            br.close();
            code = sb.toString();
        } catch (Exception e) { code = ""; }
        fileName = getIntent().getStringExtra("fileName");

        if (code == null || code.trim().isEmpty()) { Toast.makeText(this, "تعذّر قراءة الكود", Toast.LENGTH_SHORT).show(); finish(); return; }

        // Detect stubs
        StubDetector.StubResult result = StubDetector.detect(code);
        stubs = result.stubs;

        if (stubs.isEmpty()) {
            Toast.makeText(this, "لا دوال ناقصة", Toast.LENGTH_SHORT).show();
            finish();
            return;
        }

        // Create backup session
        backupManager = new BackupManager(this);
        BackupManager.Session session = backupManager.createSession(fileName, code);
        sessionId = session.sessionId;

        showCurrent();

        Button btnApprove = findViewById(R.id.btnApprove);
        Button btnReject  = findViewById(R.id.btnReject);

        btnApprove.setOnClickListener(v -> handleApprove());
        btnReject.setOnClickListener(v  -> handleReject());

        // Backup - manual save handled via BackupManager
        } catch (Exception e) {
            Toast.makeText(this, "خطأ: " + e.getMessage(), Toast.LENGTH_LONG).show();
            finish();
        }
    }

    private void showCurrent() {
        if (currentIndex >= stubs.size()) {
            // حفظ الملف في التخزين الداخلي
        try {
            String outName = fileName != null ? "fixed_" + fileName : "fixed_code.py";
            String origName = fileName != null ? "original_" + fileName : "original_code.py";

            // حفظ في مجلد التطبيق الداخلي
            // حفظ في Downloads العام
            java.io.File dir;
            if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.Q) {
                dir = new java.io.File(android.os.Environment.getExternalStoragePublicDirectory(
                    android.os.Environment.DIRECTORY_DOWNLOADS), "RealityEngine");
            } else {
                dir = new java.io.File(android.os.Environment.getExternalStoragePublicDirectory(
                    android.os.Environment.DIRECTORY_DOWNLOADS), "RealityEngine");
            }
            if (!dir.exists()) dir.mkdirs();

            // النسخة المعدّلة
            java.io.File outFile = new java.io.File(dir, outName);
            java.io.FileWriter fw = new java.io.FileWriter(outFile);
            fw.write(code);
            fw.close();

            // النسخة الأصلية
            BackupManager.Session s = backupManager.getSession(sessionId);
            if (s != null) {
                java.io.File origFile = new java.io.File(dir, origName);
                java.io.FileWriter origFw = new java.io.FileWriter(origFile);
                origFw.write(s.originalCode);
                origFw.close();
            }

            Toast.makeText(this,
                "✅ انتهى — موافق: " + approved + " | مرفوض: " + rejected +
                "\nحُفظ: " + outFile.getAbsolutePath(),
                Toast.LENGTH_LONG).show();
        } catch (Exception e) {
            Toast.makeText(this,
                "✅ انتهى — موافق: " + approved + " | مرفوض: " + rejected +
                "\nخطأ في الحفظ: " + e.getMessage(),
                Toast.LENGTH_LONG).show();
        }
        finish();
            return;
        }

        StubDetector.StubFunction stub = stubs.get(currentIndex);

        // Run workflow
        ApprovalWorkflow.WorkflowItem item = ApprovalWorkflow.process(stub, code);

        TextView tvFuncName    = findViewById(R.id.tvFuncName);
        TextView tvSafetyScore = findViewById(R.id.tvSafetyScore);
        TextView tvBefore      = findViewById(R.id.tvBefore);
        TextView tvAfter       = findViewById(R.id.tvAfter);
        TextView tvExplanation = findViewById(R.id.tvExplanation);
        Button   btnApprove    = findViewById(R.id.btnApprove);

        tvFuncName.setText(stub.name + "()  — " + (currentIndex + 1) + "/" + stubs.size());
        tvSafetyScore.setText("Safety Score: " + item.safetyScore + "/100");
        tvBefore.setText(item.before);
        tvAfter.setText(item.after != null ? item.after : "لا اقتراح");
        tvExplanation.setText(item.explanation != null ? item.explanation : "");

        // Blocked
        if (item.stage == ApprovalWorkflow.Stage.BLOCKED) {
            tvAfter.setText("⛔ " + item.blockedReason);
            tvAfter.setTextColor(0xFFF85149);
            btnApprove.setEnabled(false);
        } else {
            tvAfter.setTextColor(0xFF3FB950);
            btnApprove.setEnabled(true);
        }
    }

    private void handleApprove() {
        StubDetector.StubFunction stub = stubs.get(currentIndex);
        ApprovalWorkflow.WorkflowItem item = ApprovalWorkflow.process(stub, code);

        if (item.suggestion != null) {
            code = ApprovalWorkflow.applyChange(code, stub.name, item.suggestion);
            backupManager.recordVersion(
                sessionId, stub.name,
                "تطبيق " + stub.name + "()",
                stub.snippet, item.suggestion,
                true, item.safetyScore
            );
            // حفظ الكود المعدّل في الملف المؤقت
            try {
                java.io.File tmp = new java.io.File(getCacheDir(), "temp_code.txt");
                java.io.FileWriter fw = new java.io.FileWriter(tmp);
                fw.write(code);
                fw.close();
            } catch (Exception e) { e.printStackTrace(); }
        }

        approved++;
        currentIndex++;
        showCurrent();
    }

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
}
