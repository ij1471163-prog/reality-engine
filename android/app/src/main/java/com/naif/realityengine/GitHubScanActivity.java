package com.naif.realityengine;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.app.AlertDialog;
import android.content.Intent;
import android.os.Bundle;
import android.view.*;
import android.webkit.*;
import android.widget.*;
import java.util.List;
import org.json.*;

/**
 * GitHubScanActivity — GitHub Scan (Pro)
 * يجيب الملفات من GitHub ويحللها في WebView بمحركات JS
 * الكود ما يروح لـ Vercel — JS يشتغل محلياً في المتصفح
 */
public class GitHubScanActivity extends Activity {

    private EditText  etToken, etOwner, etRepo, etBranch;
    private Button    btnScan;
    private TextView  tvStatus;
    private ProgressBar progressBar;
    private WebView   webView;
    private LinearLayout layoutForm, layoutWeb;

    private static final String WEB_URL = "https://reality-engine-api-livid.vercel.app";

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        requestWindowFeature(Window.FEATURE_NO_TITLE);

        // تحقق Pro
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

    @SuppressLint("SetJavaScriptEnabled")
    private void buildUI() {
        // Root layout
        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setBackgroundColor(0xFF0D1117);
        root.setLayoutParams(new LinearLayout.LayoutParams(-1, -1));

        // ─── Form Section ─────────────────────────────────
        ScrollView scroll = new ScrollView(this);
        layoutForm = new LinearLayout(this);
        layoutForm.setOrientation(LinearLayout.VERTICAL);
        layoutForm.setPadding(48, 64, 48, 48);
        scroll.addView(layoutForm);
        scroll.setLayoutParams(new LinearLayout.LayoutParams(-1, -1));

        // Header
        TextView tvTitle = new TextView(this);
        tvTitle.setText("🐙 GitHub Scan");
        tvTitle.setTextSize(22);
        tvTitle.setTypeface(null, android.graphics.Typeface.BOLD);
        tvTitle.setTextColor(0xFFE6EDF3);
        tvTitle.setPadding(0, 0, 0, 8);
        layoutForm.addView(tvTitle);

        TextView tvDesc = new TextView(this);
        tvDesc.setText("أدخل Fine-grained PAT ورابط المستودع");
        tvDesc.setTextSize(12);
        tvDesc.setTextColor(0xFF8B949E);
        tvDesc.setPadding(0, 0, 0, 24);
        layoutForm.addView(tvDesc);

        // Token
        addLabel(layoutForm, "🔑 GitHub Token (Fine-grained PAT)");
        etToken = addInput(layoutForm, "github_pat_...", true);

        TextView tvInfo = new TextView(this);
        tvInfo.setText("github.com/settings/tokens → Fine-grained → Contents: Read-only");
        tvInfo.setTextSize(10);
        tvInfo.setTextColor(0xFF58A6FF);
        tvInfo.setPadding(0, 2, 0, 20);
        layoutForm.addView(tvInfo);

        // Owner
        addLabel(layoutForm, "👤 Owner");
        etOwner = addInput(layoutForm, "مثال: microsoft", false);

        // Repo
        addLabel(layoutForm, "📁 Repository");
        etRepo = addInput(layoutForm, "مثال: vscode", false);

        // Branch
        addLabel(layoutForm, "🌿 Branch");
        etBranch = addInput(layoutForm, "main", false);
        etBranch.setText("main");

        // Scan Button
        LinearLayout.LayoutParams btnLP = new LinearLayout.LayoutParams(-1, -2);
        btnLP.setMargins(0, 24, 0, 0);
        btnScan = new Button(this);
        btnScan.setText("🔍 بدء الفحص");
        btnScan.setLayoutParams(btnLP);
        btnScan.setBackgroundColor(0xFF238636);
        btnScan.setTextColor(0xFFFFFFFF);
        btnScan.setTextSize(15);
        btnScan.setTypeface(null, android.graphics.Typeface.BOLD);
        btnScan.setPadding(0, 24, 0, 24);
        btnScan.setOnClickListener(v -> startScan());
        layoutForm.addView(btnScan);

        // Progress
        progressBar = new ProgressBar(this, null, android.R.attr.progressBarStyleHorizontal);
        progressBar.setIndeterminate(true);
        LinearLayout.LayoutParams pbLP = new LinearLayout.LayoutParams(-1, -2);
        pbLP.setMargins(0, 16, 0, 0);
        progressBar.setLayoutParams(pbLP);
        progressBar.setVisibility(View.GONE);
        layoutForm.addView(progressBar);

        // Status
        tvStatus = new TextView(this);
        tvStatus.setTextSize(12);
        tvStatus.setTextColor(0xFF8B949E);
        tvStatus.setPadding(0, 8, 0, 0);
        layoutForm.addView(tvStatus);

        // Security note
        TextView tvSec = new TextView(this);
        tvSec.setText("🔒 التوكن لا يُخزن — التحليل يتم محلياً في المتصفح");
        tvSec.setTextSize(10);
        tvSec.setTextColor(0xFF3FB950);
        tvSec.setPadding(0, 24, 0, 0);
        tvSec.setGravity(android.view.Gravity.CENTER);
        layoutForm.addView(tvSec);

        // Back
        LinearLayout.LayoutParams backLP = new LinearLayout.LayoutParams(-1, -2);
        backLP.setMargins(0, 16, 0, 32);
        Button btnBack = new Button(this);
        btnBack.setText("↩ رجوع");
        btnBack.setLayoutParams(backLP);
        btnBack.setBackgroundColor(0xFF21262D);
        btnBack.setTextColor(0xFF8B949E);
        btnBack.setPadding(0, 18, 0, 18);
        btnBack.setOnClickListener(v -> finish());
        layoutForm.addView(btnBack);

        root.addView(scroll);

        // ─── WebView Section ──────────────────────────────
        layoutWeb = new LinearLayout(this);
        layoutWeb.setOrientation(LinearLayout.VERTICAL);
        layoutWeb.setVisibility(View.GONE);
        layoutWeb.setLayoutParams(new LinearLayout.LayoutParams(-1, -1));

        // Back bar
        LinearLayout webBar = new LinearLayout(this);
        webBar.setOrientation(LinearLayout.HORIZONTAL);
        webBar.setBackgroundColor(0xFF161B22);
        webBar.setPadding(16, 12, 16, 12);

        Button btnWebBack = new Button(this);
        btnWebBack.setText("← رجوع");
        btnWebBack.setBackgroundColor(0xFF21262D);
        btnWebBack.setTextColor(0xFF8B949E);
        btnWebBack.setTextSize(12);
        btnWebBack.setPadding(16, 8, 16, 8);
        btnWebBack.setOnClickListener(v -> {
            layoutWeb.setVisibility(View.GONE);
            layoutForm.setVisibility(View.VISIBLE);
            scroll.setVisibility(View.VISIBLE);
        });
        webBar.addView(btnWebBack);

        TextView tvWebTitle = new TextView(this);
        tvWebTitle.setText("  🐙 GitHub Scan — Reality Engine");
        tvWebTitle.setTextColor(0xFF8B949E);
        tvWebTitle.setTextSize(12);
        webBar.addView(tvWebTitle);

        layoutWeb.addView(webBar);

        // WebView
        webView = new WebView(this);
        webView.setLayoutParams(new LinearLayout.LayoutParams(-1, -1));
        WebSettings ws = webView.getSettings();
        ws.setJavaScriptEnabled(true);
        ws.setDomStorageEnabled(true);
        ws.setUserAgentString(ws.getUserAgentString() + " RealityEngine/1.0");
        webView.setWebViewClient(new WebViewClient() {
            @Override
            public void onPageFinished(WebView view, String url) {
                // الصفحة حمّلت — أرسل الملفات
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

    private String pendingFilesJson = null;

    private void startScan() {
        String token  = etToken.getText().toString().trim();
        String owner  = etOwner.getText().toString().trim();
        String repo   = etRepo.getText().toString().trim();
        String branch = etBranch.getText().toString().trim();
        if (branch.isEmpty()) branch = "main";

        if (token.isEmpty() || owner.isEmpty() || repo.isEmpty()) {
            Toast.makeText(this, "يرجى تعبئة جميع الحقول", Toast.LENGTH_SHORT).show();
            return;
        }

        final String finalBranch = branch;
        new AlertDialog.Builder(this)
            .setTitle("تأكيد الفحص")
            .setMessage("سيتم فحص " + owner + "/" + repo + "\n(أول 20 ملف كحد أقصى)")
            .setPositiveButton("فحص", (d, w) -> doScan(token, owner, repo, finalBranch))
            .setNegativeButton("إلغاء", null)
            .show();
    }

    private void doScan(String token, String owner, String repo, String branch) {
        btnScan.setEnabled(false);
        progressBar.setVisibility(View.VISIBLE);
        tvStatus.setTextColor(0xFF8B949E);
        tvStatus.setText("جاري الاتصال بـ GitHub...");

        GitHubScanner.scanRepository(token, owner, repo, branch,
            new GitHubScanner.ScanCallback() {

                @Override
                public void onProgress(String message) {
                    runOnUiThread(() -> tvStatus.setText(message));
                }

                @Override
                public void onComplete(List<GitHubScanner.ScannedFile> files) {
                    runOnUiThread(() -> {
                        progressBar.setVisibility(View.GONE);
                        btnScan.setEnabled(true);
                        tvStatus.setTextColor(0xFF3FB950);
                        tvStatus.setText("✅ تم تحميل " + files.size() + " ملف — جاري التحليل...");
                        openWebAnalysis(files);
                    });
                }

                @Override
                public void onError(String error) {
                    runOnUiThread(() -> {
                        progressBar.setVisibility(View.GONE);
                        btnScan.setEnabled(true);
                        tvStatus.setTextColor(0xFFE74C3C);
                        tvStatus.setText("❌ " + error);
                    });
                }
            });
    }

    private void openWebAnalysis(List<GitHubScanner.ScannedFile> files) {
        try {
            // بناء JSON للملفات
            JSONObject filesObj = new JSONObject();
            for (GitHubScanner.ScannedFile f : files) {
                filesObj.put(f.name, f.content);
            }
            pendingFilesJson = filesObj.toString();

            // أظهر WebView وحمّل الموقع
            layoutForm.setVisibility(View.GONE);
            layoutWeb.setVisibility(View.VISIBLE);
            webView.loadUrl(WEB_URL);

        } catch (Exception e) {
            tvStatus.setText("❌ خطأ في تجهيز الملفات");
        }
    }

    private void injectFiles(String filesJson) {
        // أرسل الملفات للـ JS محلياً في المتصفح
        String js = "javascript:(function() {" +
            "try {" +
            "  var files = " + filesJson + ";" +
            "  Object.keys(files).forEach(function(name) {" +
            "    F[name] = files[name];" +
            "  });" +
            "  renderFiles();" +
            "  if (typeof refreshStats === 'function') refreshStats();" +
            "} catch(e) { console.error('inject error:', e); }" +
            "})();";
        webView.evaluateJavascript(js, null);
    }

    // ─── UI Helpers ───────────────────────────────────────

    private void addLabel(LinearLayout parent, String text) {
        TextView tv = new TextView(this);
        tv.setText(text);
        tv.setTextSize(12);
        tv.setTextColor(0xFF8B949E);
        tv.setPadding(0, 0, 0, 6);
        parent.addView(tv);
    }

    private EditText addInput(LinearLayout parent, String hint, boolean password) {
        EditText et = new EditText(this);
        et.setHint(hint);
        et.setHintTextColor(0xFF30363D);
        et.setTextColor(0xFFE6EDF3);
        et.setTextSize(13);
        et.setBackgroundColor(0xFF161B22);
        et.setPadding(20, 18, 20, 18);
        if (password) {
            et.setInputType(android.text.InputType.TYPE_CLASS_TEXT
                | android.text.InputType.TYPE_TEXT_VARIATION_PASSWORD);
        }
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(-1, -2);
        lp.setMargins(0, 0, 0, 14);
        et.setLayoutParams(lp);
        parent.addView(et);
        return et;
    }

    @Override
    public void onBackPressed() {
        if (layoutWeb.getVisibility() == View.VISIBLE) {
            layoutWeb.setVisibility(View.GONE);
            layoutForm.setVisibility(View.VISIBLE);
        } else {
            finish();
        }
    }
}
}
