package com.naif.realityengine;

import android.app.AlertDialog;
import android.content.Intent;
import android.os.Bundle;
import android.text.InputType;
import android.view.*;
import android.webkit.*;
import android.widget.*;
import androidx.appcompat.app.AppCompatActivity;
import java.util.List;
import org.json.*;

/**
 * GitHubScanActivity v2.0 — مبسّط
 * ✅ رابط واحد فقط بدل 4 حقول
 * ✅ بدون Token للمستودعات العامة
 * ✅ Token اختياري للمستودعات الخاصة
 * ✅ AppCompatActivity
 * ✅ لا نخزن أي بيانات — متوافق مع Google Play
 */
public class GitHubScanActivity extends AppCompatActivity {

    // ── UI ──────────────────────────────────────────────
    private EditText    etUrl;
    private EditText    etToken;       // مخفي افتراضياً
    private TextView    tvTokenLabel;
    private LinearLayout layoutToken;  // يظهر عند الضغط على "مستودع خاص"
    private Button      btnScan;
    private TextView    tvStatus;
    private ProgressBar progressBar;
    private LinearLayout layoutForm, layoutWeb;
    private WebView     webView;

    private static final String WEB_URL = "https://reality-engine-api-livid.vercel.app";
    private String pendingFilesJson = null;

    // ═══════════════════════════════════════════════════
    // onCreate
    // ═══════════════════════════════════════════════════

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        requestWindowFeature(Window.FEATURE_NO_TITLE);

        if (!PremiumManager.isPremium(this)) {
            new AlertDialog.Builder(this)
                .setTitle("ميزة Pro")
                .setMessage("GitHub Scan متاح لمشتركي Pro فقط.")
                .setPositiveButton("⭐ اشترك Pro", (d, w) ->
                    startActivity(new Intent(this, SubscriptionActivity.class)))
                .setNegativeButton("رجوع", (d, w) -> finish())
                .setCancelable(false)
                .show();
            return;
        }

        buildUI();
    }

    // ═══════════════════════════════════════════════════
    // UI
    // ═══════════════════════════════════════════════════

    private void buildUI() {
        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setBackgroundColor(0xFF0D1117);

        // ── Form ────────────────────────────────────────
        ScrollView scroll = new ScrollView(this);
        layoutForm = new LinearLayout(this);
        layoutForm.setOrientation(LinearLayout.VERTICAL);
        layoutForm.setPadding(dp(24), dp(48), dp(24), dp(32));
        scroll.addView(layoutForm);

        // Title
        TextView tvTitle = new TextView(this);
        tvTitle.setText("🐙 فحص مستودع GitHub");
        tvTitle.setTextSize(20);
        tvTitle.setTypeface(null, android.graphics.Typeface.BOLD);
        tvTitle.setTextColor(0xFFE6EDF3);
        tvTitle.setPadding(0, 0, 0, dp(6));
        layoutForm.addView(tvTitle);

        // Subtitle
        TextView tvSub = new TextView(this);
        tvSub.setText("الصق رابط المستودع وابدأ الفحص فوراً");
        tvSub.setTextSize(13);
        tvSub.setTextColor(0xFF8B949E);
        tvSub.setPadding(0, 0, 0, dp(28));
        layoutForm.addView(tvSub);

        // URL field
        addLabel(layoutForm, "🔗 رابط المستودع");
        etUrl = addInput(layoutForm,
            "https://github.com/owner/repo", false);

        // Example hint
        TextView tvHint = new TextView(this);
        tvHint.setText("مثال: https://github.com/microsoft/vscode");
        tvHint.setTextSize(11);
        tvHint.setTextColor(0xFF58A6FF);
        tvHint.setPadding(0, dp(2), 0, dp(20));
        layoutForm.addView(tvHint);

        // Private repo toggle
        Button btnPrivate = new Button(this);
        btnPrivate.setText("🔒 مستودع خاص؟ أضف Token");
        btnPrivate.setBackgroundColor(0xFF21262D);
        btnPrivate.setTextColor(0xFF8B949E);
        btnPrivate.setTextSize(12);
        LinearLayout.LayoutParams privLP = new LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.WRAP_CONTENT,
            LinearLayout.LayoutParams.WRAP_CONTENT);
        privLP.setMargins(0, 0, 0, dp(12));
        btnPrivate.setLayoutParams(privLP);
        layoutForm.addView(btnPrivate);

        // Token section (مخفي افتراضياً)
        layoutToken = new LinearLayout(this);
        layoutToken.setOrientation(LinearLayout.VERTICAL);
        layoutToken.setVisibility(View.GONE);

        addLabel(layoutToken, "🔑 GitHub Token (Fine-grained PAT)");
        etToken = addInput(layoutToken, "github_pat_...", true);

        TextView tvTokenInfo = new TextView(this);
        tvTokenInfo.setText("github.com/settings/tokens ← Fine-grained ← Contents: Read-only");
        tvTokenInfo.setTextSize(10);
        tvTokenInfo.setTextColor(0xFF58A6FF);
        tvTokenInfo.setPadding(0, dp(2), 0, dp(16));
        layoutToken.addView(tvTokenInfo);
        layoutForm.addView(layoutToken);

        // toggle token visibility
        btnPrivate.setOnClickListener(v -> {
            if (layoutToken.getVisibility() == View.GONE) {
                layoutToken.setVisibility(View.VISIBLE);
                btnPrivate.setText("🔓 إخفاء Token");
            } else {
                layoutToken.setVisibility(View.GONE);
                etToken.setText("");
                btnPrivate.setText("🔒 مستودع خاص؟ أضف Token");
            }
        });

        // Scan button
        LinearLayout.LayoutParams btnLP = new LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.MATCH_PARENT,
            LinearLayout.LayoutParams.WRAP_CONTENT);
        btnLP.setMargins(0, dp(8), 0, 0);
        btnScan = new Button(this);
        btnScan.setText("🔍 بدء الفحص");
        btnScan.setLayoutParams(btnLP);
        btnScan.setBackgroundColor(0xFF238636);
        btnScan.setTextColor(0xFFFFFFFF);
        btnScan.setTextSize(15);
        btnScan.setTypeface(null, android.graphics.Typeface.BOLD);
        btnScan.setPadding(0, dp(18), 0, dp(18));
        btnScan.setOnClickListener(v -> startScan());
        layoutForm.addView(btnScan);

        // Progress
        progressBar = new ProgressBar(this, null,
            android.R.attr.progressBarStyleHorizontal);
        progressBar.setIndeterminate(true);
        LinearLayout.LayoutParams pbLP = new LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.MATCH_PARENT,
            LinearLayout.LayoutParams.WRAP_CONTENT);
        pbLP.setMargins(0, dp(12), 0, 0);
        progressBar.setLayoutParams(pbLP);
        progressBar.setVisibility(View.GONE);
        layoutForm.addView(progressBar);

        // Status
        tvStatus = new TextView(this);
        tvStatus.setTextSize(12);
        tvStatus.setTextColor(0xFF8B949E);
        tvStatus.setPadding(0, dp(8), 0, 0);
        layoutForm.addView(tvStatus);

        // Privacy note
        TextView tvPrivacy = new TextView(this);
        tvPrivacy.setText("🔒 لا نخزن أي بيانات — التحليل يتم محلياً");
        tvPrivacy.setTextSize(11);
        tvPrivacy.setTextColor(0xFF3FB950);
        tvPrivacy.setGravity(android.view.Gravity.CENTER);
        LinearLayout.LayoutParams privacyLP = new LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.MATCH_PARENT,
            LinearLayout.LayoutParams.WRAP_CONTENT);
        privacyLP.setMargins(0, dp(24), 0, 0);
        tvPrivacy.setLayoutParams(privacyLP);
        layoutForm.addView(tvPrivacy);

        // Back
        LinearLayout.LayoutParams backLP = new LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.MATCH_PARENT,
            LinearLayout.LayoutParams.WRAP_CONTENT);
        backLP.setMargins(0, dp(12), 0, dp(24));
        Button btnBack = new Button(this);
        btnBack.setText("↩ رجوع");
        btnBack.setLayoutParams(backLP);
        btnBack.setBackgroundColor(0xFF21262D);
        btnBack.setTextColor(0xFF8B949E);
        btnBack.setPadding(0, dp(16), 0, dp(16));
        btnBack.setOnClickListener(v -> finish());
        layoutForm.addView(btnBack);

        root.addView(scroll);

        // ── WebView ─────────────────────────────────────
        layoutWeb = new LinearLayout(this);
        layoutWeb.setOrientation(LinearLayout.VERTICAL);
        layoutWeb.setVisibility(View.GONE);

        LinearLayout webBar = new LinearLayout(this);
        webBar.setBackgroundColor(0xFF161B22);
        webBar.setPadding(dp(16), dp(12), dp(16), dp(12));

        Button btnWebBack = new Button(this);
        btnWebBack.setText("← رجوع");
        btnWebBack.setBackgroundColor(0xFF21262D);
        btnWebBack.setTextColor(0xFF8B949E);
        btnWebBack.setTextSize(12);
        btnWebBack.setPadding(dp(16), dp(8), dp(16), dp(8));
        btnWebBack.setOnClickListener(v -> showForm());
        webBar.addView(btnWebBack);

        TextView tvWebTitle = new TextView(this);
        tvWebTitle.setText("  🐙 GitHub Scan");
        tvWebTitle.setTextColor(0xFF8B949E);
        tvWebTitle.setTextSize(12);
        webBar.addView(tvWebTitle);
        layoutWeb.addView(webBar);

        webView = new WebView(this);
        webView.setLayoutParams(new LinearLayout.LayoutParams(-1, -1));
        WebSettings ws = webView.getSettings();
        ws.setJavaScriptEnabled(true);
        ws.setDomStorageEnabled(true);
        ws.setUserAgentString(ws.getUserAgentString() + " RealityEngine/1.0");
        webView.setWebViewClient(new WebViewClient() {
            @Override
            public void onPageFinished(WebView view, String url) {
                if (pendingFilesJson != null) {
                    injectFiles(pendingFilesJson);
                    pendingFilesJson = null;
                }
            }
        });
        layoutWeb.addView(webView);
        root.addView(layoutWeb);

        setContentView(root);
    }

    // ═══════════════════════════════════════════════════
    // Scan Logic
    // ═══════════════════════════════════════════════════

    private void startScan() {
        String url   = etUrl.getText().toString().trim();
        String token = etToken.getText().toString().trim();

        if (url.isEmpty()) {
            Toast.makeText(this, "أدخل رابط المستودع", Toast.LENGTH_SHORT).show();
            return;
        }

        // ✅ parse owner/repo من الرابط
        String[] parsed = parseGitHubUrl(url);
        if (parsed == null) {
            Toast.makeText(this, "رابط غير صحيح — مثال: https://github.com/owner/repo",
                Toast.LENGTH_LONG).show();
            return;
        }

        String owner  = parsed[0];
        String repo   = parsed[1];
        String branch = parsed.length > 2 ? parsed[2] : "main";

        new AlertDialog.Builder(this)
            .setTitle("تأكيد الفحص")
            .setMessage("سيتم فحص " + owner + "/" + repo
                + "\nالفرع: " + branch
                + "\n(أول 20 ملف كحد أقصى)")
            .setPositiveButton("فحص", (d, w) ->
                doScan(token.isEmpty() ? null : token, owner, repo, branch))
            .setNegativeButton("إلغاء", null)
            .show();
    }

    /**
     * يستخرج owner/repo/branch من رابط GitHub
     * يقبل:
     *   https://github.com/owner/repo
     *   https://github.com/owner/repo/tree/branch
     */
    private String[] parseGitHubUrl(String url) {
        try {
            String cleaned = url
                .replace("https://github.com/", "")
                .replace("http://github.com/", "")
                .replaceAll("/$", "");
            String[] parts = cleaned.split("/");
            if (parts.length < 2) return null;
            String owner  = parts[0];
            String repo   = parts[1];
            // /tree/branch
            String branch = "main";
            if (parts.length >= 4 && parts[2].equals("tree")) {
                branch = parts[3];
            }
            return new String[]{owner, repo, branch};
        } catch (Exception e) {
            return null;
        }
    }

    private void doScan(String token, String owner, String repo, String branch) {
        btnScan.setEnabled(false);
        progressBar.setVisibility(View.VISIBLE);
        tvStatus.setTextColor(0xFF8B949E);
        tvStatus.setText("جاري الاتصال بـ GitHub...");

        // token يمكن أن يكون null للمستودعات العامة
        String effectiveToken = (token != null && !token.isEmpty()) ? token : null;

        GitHubScanner.scanRepository(effectiveToken, owner, repo, branch,
            new GitHubScanner.ScanCallback() {
                @Override public void onProgress(String message) {
                    runOnUiThread(() -> tvStatus.setText(message));
                }
                @Override public void onComplete(List<GitHubScanner.ScannedFile> files) {
                    runOnUiThread(() -> {
                        progressBar.setVisibility(View.GONE);
                        btnScan.setEnabled(true);
                        tvStatus.setTextColor(0xFF3FB950);
                        tvStatus.setText("✅ " + files.size() + " ملف — جاري التحليل...");
                        openWebAnalysis(files);
                    });
                }
                @Override public void onError(String error) {
                    runOnUiThread(() -> {
                        progressBar.setVisibility(View.GONE);
                        btnScan.setEnabled(true);
                        tvStatus.setTextColor(0xFFE74C3C);
                        // لو خطأ 401 — اقترح إضافة Token
                        String msg = error.contains("401") || error.contains("403")
                            ? "❌ المستودع خاص — أضف Token للوصول"
                            : "❌ " + error;
                        tvStatus.setText(msg);
                    });
                }
            });
    }

    private void openWebAnalysis(List<GitHubScanner.ScannedFile> files) {
        try {
            JSONObject filesObj = new JSONObject();
            for (GitHubScanner.ScannedFile f : files) filesObj.put(f.name, f.content);
            pendingFilesJson = filesObj.toString();
            layoutForm.setVisibility(View.GONE);
            layoutWeb.setVisibility(View.VISIBLE);
            webView.loadUrl(WEB_URL);
        } catch (Exception e) {
            tvStatus.setText("❌ خطأ في تجهيز الملفات");
        }
    }

    private void injectFiles(String filesJson) {
        String js = "javascript:(function(){" +
            "try{var f=" + filesJson + ";" +
            "Object.keys(f).forEach(function(n){F[n]=f[n];});" +
            "renderFiles();" +
            "if(typeof refreshStats==='function')refreshStats();" +
            "}catch(e){console.error(e);}" +
            "})();";
        webView.evaluateJavascript(js, null);
    }

    private void showForm() {
        layoutWeb.setVisibility(View.GONE);
        layoutForm.setVisibility(View.VISIBLE);
    }

    // ═══════════════════════════════════════════════════
    // Helpers
    // ═══════════════════════════════════════════════════

    private void addLabel(LinearLayout parent, String text) {
        TextView tv = new TextView(this);
        tv.setText(text);
        tv.setTextSize(12);
        tv.setTextColor(0xFF8B949E);
        tv.setPadding(0, 0, 0, dp(6));
        parent.addView(tv);
    }

    private EditText addInput(LinearLayout parent, String hint, boolean password) {
        EditText et = new EditText(this);
        et.setHint(hint);
        et.setHintTextColor(0xFF30363D);
        et.setTextColor(0xFFE6EDF3);
        et.setTextSize(13);
        et.setBackgroundColor(0xFF161B22);
        et.setPadding(dp(16), dp(14), dp(16), dp(14));
        if (password) et.setInputType(
            InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_PASSWORD);
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.MATCH_PARENT,
            LinearLayout.LayoutParams.WRAP_CONTENT);
        lp.setMargins(0, 0, 0, dp(10));
        et.setLayoutParams(lp);
        parent.addView(et);
        return et;
    }

    private int dp(int v) {
        return Math.round(v * getResources().getDisplayMetrics().density);
    }

    @Override
    public void onBackPressed() {
        if (layoutWeb != null && layoutWeb.getVisibility() == View.VISIBLE) {
            showForm();
        } else {
            super.onBackPressed();
            finish();
        }
    }
}
