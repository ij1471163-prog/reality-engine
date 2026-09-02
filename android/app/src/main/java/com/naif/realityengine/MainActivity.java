package com.naif.realityengine;

import android.app.AlertDialog;
import android.content.Intent;
import java.io.InputStream;
import android.content.ClipData;
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

    private static final int PICK_MULTIPLE = 300;
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

        // زر Pro
        android.widget.Button btnPro = new android.widget.Button(this);
        btnPro.setText("⭐ Pro");
        btnPro.setBackgroundColor(0xFF6E40C9);
        btnPro.setTextColor(0xFFFFFFFF);
        btnPro.setTextSize(13);
        android.widget.LinearLayout.LayoutParams proLP = new android.widget.LinearLayout.LayoutParams(
            android.widget.LinearLayout.LayoutParams.WRAP_CONTENT,
            android.widget.LinearLayout.LayoutParams.WRAP_CONTENT);
        proLP.setMargins(16, 0, 0, 0);
        btnPro.setLayoutParams(proLP);
        ((android.widget.LinearLayout) btnHistory.getParent()).addView(btnPro);
        btnPro.setOnClickListener(v -> startActivity(new android.content.Intent(this, SubscriptionActivity.class)));

        btnHistory.setOnClickListener(v -> {
            Intent hi = new Intent(this, HistoryActivity.class);
            startActivity(hi);
        });

        // زر تحليل AI مستقل
        android.widget.Button btnAI = new android.widget.Button(this);
        btnAI.setText(getString(R.string.btn_ai_analyze));
        btnAI.setBackgroundColor(0xFF6E40C9);
        btnAI.setTextColor(0xFFFFFFFF);
        btnAI.setTextSize(15);
        android.widget.LinearLayout.LayoutParams aiParams = new android.widget.LinearLayout.LayoutParams(
            android.widget.LinearLayout.LayoutParams.MATCH_PARENT,
            android.widget.LinearLayout.LayoutParams.WRAP_CONTENT);
        aiParams.setMargins(0, 12, 0, 0);
        btnAI.setLayoutParams(aiParams);
        ((android.widget.LinearLayout) btnPickFile.getParent()).addView(btnAI);

        btnAI.setOnClickListener(v -> {
            Intent intent = new Intent(this, AIAnalysisActivity.class);
            startActivity(intent);
        });

        // زر الموقع الويب
        android.widget.Button btnWeb = new android.widget.Button(this);
        btnWeb.setText(getString(R.string.btn_web_analyze));
        btnWeb.setBackgroundColor(0xFF0D1117);
        btnWeb.setTextColor(0xFF58A6FF);
        btnWeb.setTextSize(15);
        android.widget.LinearLayout.LayoutParams webParams = new android.widget.LinearLayout.LayoutParams(
            android.widget.LinearLayout.LayoutParams.MATCH_PARENT,
            android.widget.LinearLayout.LayoutParams.WRAP_CONTENT);
        webParams.setMargins(0, 8, 0, 0);
        btnWeb.setLayoutParams(webParams);
        ((android.widget.LinearLayout) btnPickFile.getParent()).addView(btnWeb);

        btnWeb.setOnClickListener(v -> {
            new Thread(() -> {
                try {
                    java.net.URL url = new java.net.URL("https://reality-engine-api-livid.vercel.app/api/webtoken");
                    java.net.HttpURLConnection conn = (java.net.HttpURLConnection) url.openConnection();
                    conn.setRequestMethod("POST");
                    conn.setDoOutput(true);
                    conn.getOutputStream().write("{}".getBytes());
                    java.io.BufferedReader br = new java.io.BufferedReader(new java.io.InputStreamReader(conn.getInputStream()));
                    String res = br.readLine();
                    org.json.JSONObject json = new org.json.JSONObject(res);
                    String token = json.optString("token", "");
                    String webUrl = "https://reality-engine-api-livid.vercel.app?t=" + token + "&dev=1";
                    android.os.Handler h = new android.os.Handler(android.os.Looper.getMainLooper());
                    h.post(() -> {
                        // تحقق من WebView quota
                        if (!PremiumManager.canUseWeb(MainActivity.this)) {
                            new android.app.AlertDialog.Builder(MainActivity.this)
                                .setTitle("انتهت تحليلاتك اليوم")
                                .setMessage("استخدمت كل ملفاتك المجانية اليوم.\nيتجدد +1 غداً (حد أقصى 10)\nأو اشترك Pro للوصول غير المحدود.")
                                .setPositiveButton("⭐ اشترك Pro", (d, w) -> {
                                    startActivity(new Intent(MainActivity.this, SubscriptionActivity.class));
                                })
                                .setNegativeButton("حسناً", null)
                                .show();
                            return;
                        }
                        PremiumManager.decrementWebQuota(MainActivity.this);
                        Intent webIntent = new Intent(MainActivity.this, WebViewActivity.class);
                        webIntent.putExtra("url", webUrl);
                        startActivity(webIntent);
                    });
                } catch (Exception e) {
                    android.os.Handler h = new android.os.Handler(android.os.Looper.getMainLooper());
                    h.post(() -> android.widget.Toast.makeText(MainActivity.this, "❌ " + e.getMessage(), android.widget.Toast.LENGTH_SHORT).show());
                }
            }).start();
        });

        // زر رفع مشروع (ملفات متعددة)
        android.widget.Button btnProject = new android.widget.Button(this);
        btnProject.setText(getString(R.string.btn_upload_project));
        btnProject.setBackgroundColor(0xFF1C2128);
        btnProject.setTextColor(0xFF58A6FF);
        btnProject.setTextSize(15);
        android.widget.LinearLayout.LayoutParams projParams = new android.widget.LinearLayout.LayoutParams(
            android.widget.LinearLayout.LayoutParams.MATCH_PARENT,
            android.widget.LinearLayout.LayoutParams.WRAP_CONTENT);
        projParams.setMargins(0, 8, 0, 0);
        btnProject.setLayoutParams(projParams);
        ((android.widget.LinearLayout) btnPickFile.getParent()).addView(btnProject);

        btnProject.setOnClickListener(v -> {
            if (!prefs.getBoolean(AGREED, false)) {
                showWelcomeDialog(prefs);
            } else {
                openMultiFilePicker();
            }
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

    private void openMultiFilePicker() {
        Intent intent = new Intent(Intent.ACTION_GET_CONTENT);
        intent.setType("*/*");
        String[] mimeTypes = {"text/plain","text/x-python","text/javascript",
            "text/html","application/zip","application/x-zip-compressed"};
        intent.putExtra(Intent.EXTRA_MIME_TYPES, mimeTypes);
        intent.addCategory(Intent.CATEGORY_OPENABLE);
        intent.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true);
        startActivityForResult(intent, PICK_MULTIPLE);
    }

    private void handleZipFile(android.net.Uri uri) {
        try {
            InputStream is = getContentResolver().openInputStream(uri);
            ZipHandler.ZipResult result = ZipHandler.extract(is);
            if (result.error != null) {
                Toast.makeText(this, result.error, Toast.LENGTH_SHORT).show();
                return;
            }
            for (ZipHandler.ZipFile zf : result.files) {
                // TODO: عرض الملف في واجهة التحليل
                Toast.makeText(this, "📄 " + zf.name, Toast.LENGTH_SHORT).show();
            }
            if (!result.skipped.isEmpty()) {
                Toast.makeText(this, "تم تخطي " + result.skipped.size() + " ملف", Toast.LENGTH_SHORT).show();
            }
            Toast.makeText(this, "✅ تم فتح " + result.files.size() + " ملف", Toast.LENGTH_SHORT).show();
        } catch (Exception e) {
            Toast.makeText(this, "خطأ: " + e.getMessage(), Toast.LENGTH_SHORT).show();
        }
    }

    @Override
    protected void onActivityResult(int req, int res, Intent data) {
        super.onActivityResult(req, res, data);
        if (req == PICK_FILE && res == RESULT_OK && data != null) {
            openAnalysis(data.getData());
        } else if (req == PICK_MULTIPLE && res == RESULT_OK && data != null) {
            // رفع ملفات متعددة — نفتح AIAnalysisActivity مع الملف الرئيسي
            ClipData clipData = data.getClipData();
            android.net.Uri mainUri = data.getData();

            if (clipData != null && clipData.getItemCount() > 0) {
                mainUri = clipData.getItemAt(0).getUri();
            }

            if (mainUri != null) {
                // فحص لو ZIP
                String uriStr = mainUri.toString().toLowerCase();
                String mimeType = getContentResolver().getType(mainUri);
                boolean isZip = uriStr.endsWith(".zip") || 
                    "application/zip".equals(mimeType) ||
                    "application/x-zip-compressed".equals(mimeType);
                
                if (isZip) {
                    handleZipFile(mainUri);
                    return;
                }
                
                Intent intent = new Intent(this, AIAnalysisActivity.class);
                intent.setData(mainUri);
                // أضف الملفات الإضافية كـ related files
                if (clipData != null) {
                    java.util.ArrayList<String> uriStrings = new java.util.ArrayList<>();
                    for (int i = 1; i < clipData.getItemCount(); i++) {
                        uriStrings.add(clipData.getItemAt(i).getUri().toString());
                    }
                    intent.putStringArrayListExtra("related_uris", uriStrings);
                }
                startActivity(intent);
            }
        }
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
