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
        fileName = uri.getLastPathSegment();
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

        // Analyze
        report = EngineAnalyzer.analyze(fileCode, fileName);

        // Show results
        TextView tvFileName      = findViewById(R.id.tvFileName);
        TextView tvEngineMessage = findViewById(R.id.tvEngineMessage);
        LinearLayout llStubs     = findViewById(R.id.llStubs);
        Button btnProceed        = findViewById(R.id.btnProceed);
        Button btnCancel         = findViewById(R.id.btnCancel);

        tvFileName.setText(fileName);
        tvEngineMessage.setText(report.engineMessage + "\n\n" + report.recommendation);

        // Add stub cards
        for (EngineAnalyzer.FunctionAnalysis fn : report.stubs) {
            TextView tv = new TextView(this);
            String color = fn.fixability == EngineAnalyzer.Fixability.HIGH   ? "✅"
                         : fn.fixability == EngineAnalyzer.Fixability.MEDIUM ? "⚠️"
                         : "❌";
            tv.setText(color + " " + fn.name + "()  — " + fn.intent + "\n" + fn.fixReason);
            tv.setTextColor(0xFFE6EDF3);
            tv.setTextSize(13);
            tv.setPadding(16, 12, 16, 12);
            tv.setBackgroundColor(0xFF1C2128);
            LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT,
                LinearLayout.LayoutParams.WRAP_CONTENT
            );
            params.setMargins(0, 8, 0, 0);
            tv.setLayoutParams(params);
            llStubs.addView(tv);
        }

        btnCancel.setOnClickListener(v -> finish());

                }
                @Override
                public void onError(String error) {
                    runOnUiThread(() -> {
                        btnAI.setText("✨ تحليل بالذكاء الاصطناعي");
                        btnAI.setEnabled(true);
                        android.widget.Toast.makeText(AnalysisActivity.this,
                            "خطأ: " + error, android.widget.Toast.LENGTH_LONG).show();
                    });
                }
            });
        });

        btnProceed.setOnClickListener(v -> {
            if (report.stubs.isEmpty()) {
                Toast.makeText(this, "لا دوال ناقصة", Toast.LENGTH_SHORT).show();
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
