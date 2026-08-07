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
        ApprovalWorkflow.WorkflowItem item = ApprovalWorkflow.process(stub, code);

        tvFuncName.setText(stub.name + "()  —  " + (currentIndex + 1) + "/" + stubs.size());
        tvSafetyScore.setText("Safety Score: " + item.safetyScore + "/100");
        tvBefore.setText(item.before != null ? item.before : stub.snippet);
        tvAfter.setText(item.after  != null ? item.after  : "لا اقتراح");
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
        ApprovalWorkflow.WorkflowItem item = ApprovalWorkflow.process(stub, code);

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
    private void saveFiles() {
        try {
            // Create RealityEngine folder in Downloads
            File downloads = Environment.getExternalStoragePublicDirectory(
                Environment.DIRECTORY_DOWNLOADS);
            File dir = new File(downloads, "RealityEngine");
            if (!dir.exists()) dir.mkdirs();

            // Save fixed file
            String fixedName = "fixed_" + fileName;
            File fixedFile = new File(dir, fixedName);
            FileWriter fw = new FileWriter(fixedFile);
            fw.write(code);
            fw.close();

            // Save original file
            String origName = "original_" + fileName;
            File origFile = new File(dir, origName);
            FileWriter origFw = new FileWriter(origFile);
            origFw.write(originalCode);
            origFw.close();

            Toast.makeText(this,
                "✅ انتهى — موافق: " + approved + " | مرفوض: " + rejected +
                "\n📁 Downloads/RealityEngine/" + fixedName,
                Toast.LENGTH_LONG).show();

        } catch (Exception e) {
            Toast.makeText(this,
                "✅ انتهى — موافق: " + approved + " | مرفوض: " + rejected +
                "\n⚠️ خطأ في الحفظ: " + e.getMessage(),
                Toast.LENGTH_LONG).show();
        }
        finish();
    }

    // ── Show error ────────────────────────────────────────
    private void showError(String msg) {
        Toast.makeText(this, msg, Toast.LENGTH_LONG).show();
        finish();
    }
}
