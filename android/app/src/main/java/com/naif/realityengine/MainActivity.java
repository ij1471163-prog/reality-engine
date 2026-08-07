package com.naif.realityengine;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.widget.Button;
import android.widget.Toast;
import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;
import androidx.appcompat.app.AppCompatActivity;

public class MainActivity extends AppCompatActivity {

    private static final int PICK_FILE    = 1;
    private static final int PERM_REQUEST = 2;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_main);

        Button btnPickFile = findViewById(R.id.btnPickFile);
        Button btnHistory  = findViewById(R.id.btnHistory);

        btnPickFile.setOnClickListener(v -> pickFile());
        btnHistory.setOnClickListener(v ->
            Toast.makeText(this, "السجل — قريباً", Toast.LENGTH_SHORT).show()
        );

        handleIncomingFile(getIntent());
    }

    private void pickFile() {
        // Android 13+ ما تحتاج صلاحيات للـ file picker
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) {
            if (ContextCompat.checkSelfPermission(this,
                    android.Manifest.permission.READ_EXTERNAL_STORAGE)
                    != PackageManager.PERMISSION_GRANTED) {
                showPermissionRationale();
                return;
            }
        }
        openFilePicker();
    }

    private void showPermissionRationale() {
        new AlertDialog.Builder(this)
            .setTitle("إذن القراءة")
            .setMessage(
                "يحتاج التطبيق إذن الوصول للملفات لتحليل كودك.\n\n" +
                "• لن يتم رفع أي ملف للإنترنت\n" +
                "• الكود يبقى على جهازك فقط\n" +
                "• يُستخدم فقط للتحليل الأمني المحلي"
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
    public void onRequestPermissionsResult(int requestCode,
            String[] permissions, int[] results) {
        super.onRequestPermissionsResult(requestCode, permissions, results);
        if (requestCode == PERM_REQUEST &&
            results.length > 0 &&
            results[0] == PackageManager.PERMISSION_GRANTED) {
            openFilePicker();
        } else {
            Toast.makeText(this,
                "بدون الإذن لا يمكن فتح الملفات",
                Toast.LENGTH_SHORT).show();
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
