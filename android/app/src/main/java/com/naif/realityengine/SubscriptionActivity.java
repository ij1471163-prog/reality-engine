package com.naif.realityengine;

import android.app.Activity;
import android.os.Bundle;
import android.view.View;
import android.view.Window;
import android.widget.*;
import android.graphics.*;
import android.graphics.drawable.*;

public class SubscriptionActivity extends Activity implements BillingManager.BillingListener {

    private BillingManager billing;
    private TextView tvMonthlyPrice, tvYearlyPrice, tvStatus;
    private Button btnMonthly, btnYearly, btnRestore;
    private boolean isMonthlySelected = true;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        requestWindowFeature(Window.FEATURE_NO_TITLE);
        buildUI();
        billing = BillingManager.getInstance(this);
        billing.setListener(this);
        billing.checkExistingPurchases();
    }

    private void buildUI() {
        ScrollView scroll = new ScrollView(this);
        scroll.setBackgroundColor(0xFF0D1117);

        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setPadding(48, 80, 48, 48);
        scroll.addView(root);

        // ─── Header ───────────────────────────────────────────
        TextView tvIcon = new TextView(this);
        tvIcon.setText("⚡");
        tvIcon.setTextSize(56);
        tvIcon.setGravity(android.view.Gravity.CENTER);
        tvIcon.setPadding(0, 0, 0, 16);
        root.addView(tvIcon);

        TextView tvTitle = new TextView(this);
        tvTitle.setText("Reality Engine Pro");
        tvTitle.setTextSize(26);
        tvTitle.setTypeface(null, Typeface.BOLD);
        tvTitle.setTextColor(0xFFA371F7);
        tvTitle.setGravity(android.view.Gravity.CENTER);
        tvTitle.setPadding(0, 0, 0, 8);
        root.addView(tvTitle);

        TextView tvSub = new TextView(this);
        tvSub.setText("احصل على كامل قدرات المحلل الذكي");
        tvSub.setTextSize(14);
        tvSub.setTextColor(0xFF8B949E);
        tvSub.setGravity(android.view.Gravity.CENTER);
        tvSub.setPadding(0, 0, 0, 40);
        root.addView(tvSub);

        // ─── Features ─────────────────────────────────────────
        String[][] features = {
            {"🤖", "AI بدون حدود", "تحليل وإصلاح غير محدود بالذكاء الاصطناعي"},
            {"📦", "تحليل مشاريع ZIP", "ارفع مشروعك كاملاً بضغطة واحدة"},
            {"📊", "تصدير التقارير", "صدّر نتائجك بصيغة JSON أو CSV"},
            {"🔒", "أولوية الدعم", "نتواصل معك مباشرة عند أي مشكلة"},
            {"⚡", "محرك متقدم", "كشف أدق مع JavaParser AST حقيقي"},
        };

        for (String[] f : features) {
            addFeatureRow(root, f[0], f[1], f[2]);
        }

        // ─── Divider ──────────────────────────────────────────
        View div = new View(this);
        LinearLayout.LayoutParams dp = new LinearLayout.LayoutParams(-1, 1);
        dp.setMargins(0, 32, 0, 32);
        div.setLayoutParams(dp);
        div.setBackgroundColor(0xFF30363D);
        root.addView(div);

        // ─── Plans ────────────────────────────────────────────
        TextView tvChoose = new TextView(this);
        tvChoose.setText("اختر خطتك");
        tvChoose.setTextSize(16);
        tvChoose.setTypeface(null, Typeface.BOLD);
        tvChoose.setTextColor(0xFFE6EDF3);
        tvChoose.setPadding(0, 0, 0, 16);
        root.addView(tvChoose);

        // Monthly Plan
        LinearLayout monthlyCard = createPlanCard(true);
        root.addView(monthlyCard);

        LinearLayout monthlyContent = new LinearLayout(this);
        monthlyContent.setOrientation(LinearLayout.VERTICAL);
        monthlyContent.setPadding(48, 32, 48, 32);
        monthlyCard.addView(monthlyContent);

        TextView tvMonthlyTitle = new TextView(this);
        tvMonthlyTitle.setText("شهري");
        tvMonthlyTitle.setTextColor(0xFFE6EDF3);
        tvMonthlyTitle.setTextSize(15);
        tvMonthlyTitle.setTypeface(null, Typeface.BOLD);
        monthlyContent.addView(tvMonthlyTitle);

        tvMonthlyPrice = new TextView(this);
        tvMonthlyPrice.setText("جاري التحميل...");
        tvMonthlyPrice.setTextColor(0xFFA371F7);
        tvMonthlyPrice.setTextSize(24);
        tvMonthlyPrice.setTypeface(null, Typeface.BOLD);
        monthlyContent.addView(tvMonthlyPrice);

        // Yearly Plan
        LinearLayout.LayoutParams yearlyLP = new LinearLayout.LayoutParams(-1, -2);
        yearlyLP.setMargins(0, 12, 0, 0);
        LinearLayout yearlyCard = createPlanCard(false);
        yearlyCard.setLayoutParams(yearlyLP);
        root.addView(yearlyCard);

        LinearLayout yearlyContent = new LinearLayout(this);
        yearlyContent.setOrientation(LinearLayout.VERTICAL);
        yearlyContent.setPadding(48, 32, 48, 32);
        yearlyCard.addView(yearlyContent);

        LinearLayout yearlyHeader = new LinearLayout(this);
        yearlyHeader.setOrientation(LinearLayout.HORIZONTAL);
        yearlyContent.addView(yearlyHeader);

        TextView tvYearlyTitle = new TextView(this);
        tvYearlyTitle.setText("سنوي");
        tvYearlyTitle.setTextColor(0xFFE6EDF3);
        tvYearlyTitle.setTextSize(15);
        tvYearlyTitle.setTypeface(null, Typeface.BOLD);
        tvYearlyTitle.setLayoutParams(new LinearLayout.LayoutParams(0, -2, 1));
        yearlyHeader.addView(tvYearlyTitle);

        TextView tvBadge = new TextView(this);
        tvBadge.setText("وفّر 30%");
        tvBadge.setTextColor(0xFF0D1117);
        tvBadge.setTextSize(11);
        tvBadge.setTypeface(null, Typeface.BOLD);
        tvBadge.setBackgroundColor(0xFF3FB950);
        tvBadge.setPadding(12, 4, 12, 4);
        yearlyHeader.addView(tvBadge);

        tvYearlyPrice = new TextView(this);
        tvYearlyPrice.setText("جاري التحميل...");
        tvYearlyPrice.setTextColor(0xFF3FB950);
        tvYearlyPrice.setTextSize(24);
        tvYearlyPrice.setTypeface(null, Typeface.BOLD);
        yearlyContent.addView(tvYearlyPrice);

        // ─── CTA Button ───────────────────────────────────────
        LinearLayout.LayoutParams btnLP = new LinearLayout.LayoutParams(-1, -2);
        btnLP.setMargins(0, 32, 0, 0);

        btnMonthly = new Button(this);
        btnMonthly.setText("اشترك شهرياً");
        btnMonthly.setLayoutParams(btnLP);
        btnMonthly.setBackgroundColor(0xFF6E40C9);
        btnMonthly.setTextColor(0xFFFFFFFF);
        btnMonthly.setTextSize(16);
        btnMonthly.setTypeface(null, Typeface.BOLD);
        btnMonthly.setPadding(0, 32, 0, 32);
        btnMonthly.setOnClickListener(v -> billing.launchPurchase(this, BillingManager.PLAN_MONTHLY));
        root.addView(btnMonthly);

        LinearLayout.LayoutParams btnYLP = new LinearLayout.LayoutParams(-1, -2);
        btnYLP.setMargins(0, 12, 0, 0);

        btnYearly = new Button(this);
        btnYearly.setText("اشترك سنوياً");
        btnYearly.setLayoutParams(btnYLP);
        btnYearly.setBackgroundColor(0xFF238636);
        btnYearly.setTextColor(0xFFFFFFFF);
        btnYearly.setTextSize(16);
        btnYearly.setTypeface(null, Typeface.BOLD);
        btnYearly.setPadding(0, 32, 0, 32);
        btnYearly.setOnClickListener(v -> billing.launchPurchase(this, BillingManager.PLAN_YEARLY));
        root.addView(btnYearly);

        // ─── Restore ──────────────────────────────────────────
        LinearLayout.LayoutParams restoreLP = new LinearLayout.LayoutParams(-1, -2);
        restoreLP.setMargins(0, 16, 0, 0);

        btnRestore = new Button(this);
        btnRestore.setText("استعادة الاشتراك");
        btnRestore.setLayoutParams(restoreLP);
        btnRestore.setBackgroundColor(0xFF21262D);
        btnRestore.setTextColor(0xFF58A6FF);
        btnRestore.setTextSize(14);
        btnRestore.setPadding(0, 24, 0, 24);
        btnRestore.setOnClickListener(v -> {
            billing.checkExistingPurchases();
            Toast.makeText(this, "جاري التحقق...", Toast.LENGTH_SHORT).show();
        });
        root.addView(btnRestore);

        // ─── Status ───────────────────────────────────────────
        tvStatus = new TextView(this);
        tvStatus.setText("");
        tvStatus.setTextSize(13);
        tvStatus.setTextColor(0xFF3FB950);
        tvStatus.setGravity(android.view.Gravity.CENTER);
        tvStatus.setPadding(0, 16, 0, 0);
        root.addView(tvStatus);

        // ─── Footer ───────────────────────────────────────────
        TextView tvFooter = new TextView(this);
        tvFooter.setText("يمكن إلغاء الاشتراك في أي وقت من إعدادات Google Play\nالدفع يتم عبر Google Play بشكل آمن");
        tvFooter.setTextSize(11);
        tvFooter.setTextColor(0xFF30363D);
        tvFooter.setGravity(android.view.Gravity.CENTER);
        tvFooter.setPadding(0, 24, 0, 0);
        root.addView(tvFooter);

        // ─── Back ─────────────────────────────────────────────
        LinearLayout.LayoutParams backLP = new LinearLayout.LayoutParams(-1, -2);
        backLP.setMargins(0, 16, 0, 32);

        Button btnBack = new Button(this);
        btnBack.setText("↩ رجوع");
        btnBack.setLayoutParams(backLP);
        btnBack.setBackgroundColor(0xFF21262D);
        btnBack.setTextColor(0xFF8B949E);
        btnBack.setPadding(0, 20, 0, 20);
        btnBack.setOnClickListener(v -> finish());
        root.addView(btnBack);

        setContentView(scroll);
    }

    private LinearLayout createPlanCard(boolean highlighted) {
        LinearLayout card = new LinearLayout(this);
        card.setOrientation(LinearLayout.VERTICAL);
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(-1, -2);
        card.setLayoutParams(lp);
        GradientDrawable bg = new GradientDrawable();
        bg.setColor(0xFF161B22);
        bg.setCornerRadius(16);
        bg.setStroke(2, highlighted ? 0xFF6E40C9 : 0xFF30363D);
        card.setBackground(bg);
        return card;
    }

    private void addFeatureRow(LinearLayout parent, String icon, String title, String desc) {
        LinearLayout row = new LinearLayout(this);
        row.setOrientation(LinearLayout.HORIZONTAL);
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(-1, -2);
        lp.setMargins(0, 0, 0, 20);
        row.setLayoutParams(lp);

        TextView tvIcon = new TextView(this);
        tvIcon.setText(icon);
        tvIcon.setTextSize(22);
        tvIcon.setPadding(0, 0, 24, 0);
        row.addView(tvIcon);

        LinearLayout text = new LinearLayout(this);
        text.setOrientation(LinearLayout.VERTICAL);
        row.addView(text);

        TextView tvTitle = new TextView(this);
        tvTitle.setText(title);
        tvTitle.setTextColor(0xFFE6EDF3);
        tvTitle.setTextSize(14);
        tvTitle.setTypeface(null, Typeface.BOLD);
        text.addView(tvTitle);

        TextView tvDesc = new TextView(this);
        tvDesc.setText(desc);
        tvDesc.setTextColor(0xFF8B949E);
        tvDesc.setTextSize(12);
        text.addView(tvDesc);

        parent.addView(row);
    }

    // ─── Billing Callbacks ────────────────────────────────

    @Override
    public void onPremiumGranted() {
        runOnUiThread(() -> {
            tvStatus.setText("✅ أنت مشترك — شكراً!");
            tvStatus.setTextColor(0xFF3FB950);
            btnMonthly.setText("✅ مشترك بالفعل");
            btnMonthly.setEnabled(false);
            btnYearly.setText("✅ مشترك بالفعل");
            btnYearly.setEnabled(false);
        });
    }

    @Override
    public void onPremiumRevoked() {
        runOnUiThread(() -> {
            tvStatus.setText("الاشتراك غير مفعّل");
            tvStatus.setTextColor(0xFF8B949E);
        });
    }

    @Override
    public void onBillingError(String message) {
        runOnUiThread(() -> Toast.makeText(this, message, Toast.LENGTH_SHORT).show());
    }

    @Override
    public void onPriceLoaded(String monthly, String yearly) {
        runOnUiThread(() -> {
            tvMonthlyPrice.setText(monthly + " / شهر");
            tvYearlyPrice.setText(yearly + " / سنة");
            btnMonthly.setText("اشترك بـ " + monthly + " شهرياً");
            btnYearly.setText("اشترك بـ " + yearly + " سنوياً");
        });
    }

    @Override
    protected void onDestroy() {
        super.onDestroy();
        if (billing != null) { billing.destroy(); }
    }
}
