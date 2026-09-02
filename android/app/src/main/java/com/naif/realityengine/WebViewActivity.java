package com.naif.realityengine;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.os.Bundle;
import android.webkit.*;
import android.view.*;

public class WebViewActivity extends Activity {

    @SuppressLint("SetJavaScriptEnabled")
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        requestWindowFeature(Window.FEATURE_NO_TITLE);

        WebView webView = new WebView(this);
        setContentView(webView);

        WebSettings s = webView.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setAllowFileAccess(false);
        s.setUserAgentString(s.getUserAgentString() + " RealityEngine/1.0");

        // دعم رفع الملفات
        webView.setWebChromeClient(new android.webkit.WebChromeClient() {
            @Override
            public boolean onShowFileChooser(android.webkit.WebView webView,
                android.webkit.ValueCallback<android.net.Uri[]> filePathCallback,
                android.webkit.WebChromeClient.FileChooserParams fileChooserParams) {
                fileCallback = filePathCallback;
                android.content.Intent intent = fileChooserParams.createIntent();
                try {
                    startActivityForResult(intent, 1001);
                } catch (Exception e) {
                    fileCallback = null;
                    return false;
                }
                return true;
            }
        });

        webView.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest req) {
                String url = req.getUrl().toString();
                if (url.contains("reality-engine-api-livid.vercel.app")) {
                    view.loadUrl(url);
                    return true;
                }
                return true;
            }
        });

        String url = getIntent().getStringExtra("url");
        if (url != null) webView.loadUrl(url);
    }

    private android.webkit.ValueCallback<android.net.Uri[]> fileCallback;

    @Override
    protected void onActivityResult(int req, int res, android.content.Intent data) {
        if (req == 1001) {
            android.net.Uri[] results = null;
            if (res == RESULT_OK && data != null) {
                results = new android.net.Uri[]{data.getData()};
            }
            if (fileCallback != null) {
                fileCallback.onReceiveValue(results);
                fileCallback = null;
            }
        }
    }

    @Override
    public void onBackPressed() { finish(); }
}
