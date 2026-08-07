package com.naif.realityengine;

import android.app.AlertDialog;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.widget.Button;
import android.widget.Toast;
import androidx.appcompat.app.AppCompatActivity;
import androidx.core.content.ContextCompat;
import android.content.pm.PackageManager;
import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;

public class MainActivity extends AppCompatActivity {

    private static final int PICK_FILE    = 1;
    private static final int PERM_REQUEST = 2;
    private static final String PREFS     = "reality_prefs";
    private static final String AGREED    = "user_agreed";

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_main);

        SharedPreferences prefs = getSharedPreferences(PREFS, MODE_PRIVATE);

        // أول تشغيل — اعرض سياسة الاستخدام
        if (!prefs.getBoolean(AGREED, false)) {
            showWelcomeDialog(prefs);
        }

        Button btnPickFile = findViewById(R.id.btnPickFile);
        Button btnHistory  = findViewById(R.id.btnHistory);

        btnPickFile.setOnClickListener(v -> {
            if (!prefs.getBoolean(AGREED, false)) {
                showWelcomeDialog(prefs);
            } else {
                pickFile();
            }
        });

        btnHistory.setOnClickListener(v -> {
            Intent hi = new Intent(this, HistoryActivity.class);
            startActivity(hi);
        });

        // طلب إذن الكتابة
        if (android.os.Build.VERSION.SDK_INT < android.os.Build.VERSION_CODES.Q) {
            if (ContextCompat.checkSelfPermission(this,
                    android.Manifest.permission.WRITE_EXTERNAL_STORAGE)
                    != PackageManager.PERMISSION_GRANTED) {
                androidx.core.app.ActivityCompat.requestPermissions(this,
                    new String[]{android.Manifest.permission.WRITE_EXTERNAL_STORAGE}, 3);
            }
        }
        handleIncomingFile(getIntent());
    }

    // ── نافذة الترحيب وسياسة الاستخدام ──────────────────
    private void showWelcomeDialog(SharedPreferences prefs) {
        new AlertDialog.Builder(this)
            .setTitle("مرحباً في Reality Engine")
            .setMessage(
                "قبل البدء، يرجى قراءة سياسة الاستخدام:\n\n" +

                "✅ ما يفعله التطبيق:\n" +
                "• يحلل ملفات الكود البرمجي محلياً\n" +
                "• يكتشف الدوال الناقصة ويقترح تنفيذاً\n" +
                "• يفحص الكود أمنياً بدون إنترنت\n\n" +

                "⛔ ما لا يُسمح به:\n" +
                "• رفع ملفات تحتوي على كود ضار\n" +
                "• محاولة اختراق أنظمة أو أجهزة\n" +
                "• إنشاء برمجيات خبيثة أو فيروسات\n" +
                "• أي استخدام غير قانوني\n\n" +

                "🔒 الخصوصية:\n" +
                "• كودك يبقى على جهازك فقط\n" +
                "• لا يُرسل أي بيانات للإنترنت\n" +
                "• لا نجمع أي معلومات شخصية\n\n" +

                "📂 إذن الملفات:\n" +
                "• مطلوب فقط لقراءة ملف الكود\n" +
                "• لا نعدّل أي ملف على جهازك"
            )
            .setPositiveButton("أوافق وأبدأ", (d, w) -> {
                prefs.edit().putBoolean(AGREED, true).apply();
                pickFile();
            })
            .setNegativeButton("إلغاء", null)
            .setCancelable(false)
            .show();
    }

    // ── طلب صلاحية القراءة ────────────────────────────────
    private void pickFile() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) {
            if (ContextCompat.checkSelfPermission(this,
                    android.Manifest.permission.READ_EXTERNAL_STORAGE)
                    != PackageManager.PERMISSION_GRANTED) {
                showPermissionDialog();
                return;
            }
        }
        openFilePicker();
    }

    private void showPermissionDialog() {
        new AlertDialog.Builder(this)
            .setTitle("إذن الوصول للملفات")
            .setMessage(
                "يحتاج التطبيق إذن قراءة الملفات لتحليل كودك.\n\n" +
                "• يُستخدم فقط لفتح ملف الكود الذي تختاره\n" +
                "• لا يصل لأي ملف آخر\n" +
                "• الكود يُحلَّل محلياً ولا يُرفع لأي خادم"
            )
            .setPositiveButton("منح الإذن", (d, w) ->
                ActivityCompat.requestPermissions(this,
                    new String[]{android.Manifest.permission.READ_EXTERNAL_STORAGE},
                    PERM_REQUEST)
            )
            .setNegativeButton("إلغاء", null)
            .show();
    }

    @Override
    public void onRequestPermissionsResult(int req, String[] perms, int[] results) {
        super.onRequestPermissionsResult(req, perms, results);
        if (req == PERM_REQUEST && results.length > 0
                && results[0] == PackageManager.PERMISSION_GRANTED) {
            openFilePicker();
        } else {
            Toast.makeText(this, "بدون الإذن لا يمكن فتح الملفات", Toast.LENGTH_LONG).show();
        }
    }

    private void openFilePicker() {
        Intent intent = new Intent(Intent.ACTION_GET_CONTENT);
        intent.setType("*/*");
        intent.addCategory(Intent.CATEGORY_OPENABLE);
        startActivityForResult(intent, PICK_FILE);
    }

    @Override
    protected void onActivityResult(int req, int res, Intent data) {
        super.onActivityResult(req, res, data);
        if (req == PICK_FILE && res == RESULT_OK && data != null)
            openAnalysis(data.getData());
    }

    private void handleIncomingFile(Intent intent) {
        if (intent != null && Intent.ACTION_VIEW.equals(intent.getAction())) {
            Uri uri = intent.getData();
            if (uri != null) openAnalysis(uri);
        }
    }

    private void openAnalysis(Uri uri) {
        Intent intent = new Intent(this, AnalysisActivity.class);
        intent.setData(uri);
        startActivity(intent);
    }
}
