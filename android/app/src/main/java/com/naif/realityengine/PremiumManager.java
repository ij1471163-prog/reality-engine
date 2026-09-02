package com.naif.realityengine;

import android.content.Context;
import android.content.SharedPreferences;

/**
 * PremiumManager — يحفظ حالة الاشتراك محلياً
 */
public class PremiumManager {

    private static final String PREFS = "reality_engine_prefs";
    private static final String KEY_PREMIUM = "is_premium";
    private static final String KEY_AI_COUNT = "ai_count_today";
    private static final String KEY_AI_DATE = "ai_date";
    private static final int FREE_AI_LIMIT = 3;
    private static final int WEB_MAX_QUOTA   = 10;
    private static final String KEY_WEB_COUNT = "web_count";
    private static final String KEY_WEB_DATE  = "web_date";
    private static final String KEY_WEB_LAST  = "web_last_refill";

    public static void setPremium(Context ctx, boolean premium) {
        getPrefs(ctx).edit().putBoolean(KEY_PREMIUM, premium).apply();
    }

    public static boolean isPremium(Context ctx) {
        return getPrefs(ctx).getBoolean(KEY_PREMIUM, false);
    }

    // ─── WebView Quota ─────────────────────────────────

    public static int getWebQuota(Context ctx) {
        android.content.SharedPreferences p = ctx.getSharedPreferences(PREFS, 0);
        String today = new java.text.SimpleDateFormat("yyyy-MM-dd",
            java.util.Locale.US).format(new java.util.Date());
        String lastRefill = p.getString(KEY_WEB_LAST, "");
        int quota = p.getInt(KEY_WEB_COUNT, WEB_MAX_QUOTA);

        // أضف +1 كل يوم جديد (حد أقصى 10)
        if (!today.equals(lastRefill)) {
            quota = Math.min(WEB_MAX_QUOTA, quota + 1);
            p.edit().putInt(KEY_WEB_COUNT, quota)
                    .putString(KEY_WEB_LAST, today).apply();
        }
        return quota;
    }

    public static boolean canUseWeb(Context ctx) {
        if (isPremium(ctx)) return true;
        return getWebQuota(ctx) > 0;
    }

    public static void decrementWebQuota(Context ctx) {
        android.content.SharedPreferences p = ctx.getSharedPreferences(PREFS, 0);
        int quota = getWebQuota(ctx);
        p.edit().putInt(KEY_WEB_COUNT, Math.max(0, quota - 1)).apply();
    }

    public static boolean canUseAI(Context ctx) {
        if (isPremium(ctx)) { return true; }
        String today = getTodayDate();
        SharedPreferences prefs = getPrefs(ctx);
        String savedDate = prefs.getString(KEY_AI_DATE, "");
        if (!today.equals(savedDate)) {
            prefs.edit().putInt(KEY_AI_COUNT, 0).putString(KEY_AI_DATE, today).apply();
        }
        return prefs.getInt(KEY_AI_COUNT, 0) < FREE_AI_LIMIT;
    }

    public static void incrementAICount(Context ctx) {
        SharedPreferences prefs = getPrefs(ctx);
        int count = prefs.getInt(KEY_AI_COUNT, 0);
        prefs.edit().putInt(KEY_AI_COUNT, count + 1).apply();
    }

    public static int getRemainingAI(Context ctx) {
        if (isPremium(ctx)) { return 999; }
        SharedPreferences prefs = getPrefs(ctx);
        String today = getTodayDate();
        if (!today.equals(prefs.getString(KEY_AI_DATE, ""))) { return FREE_AI_LIMIT; }
        return Math.max(0, FREE_AI_LIMIT - prefs.getInt(KEY_AI_COUNT, 0));
    }

    private static SharedPreferences getPrefs(Context ctx) {
        return ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    private static String getTodayDate() {
        return new java.text.SimpleDateFormat("yyyy-MM-dd",
            java.util.Locale.getDefault()).format(new java.util.Date());
    }
}
