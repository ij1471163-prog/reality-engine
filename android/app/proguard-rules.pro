# ── Reality Engine — ProGuard Rules ──────────────────────

# ── Android Components (Google Required) ─────────────────
-keep public class * extends android.app.Activity
-keep public class * extends android.app.Service
-keep public class * extends android.content.BroadcastReceiver
-keep public class * extends android.content.ContentProvider

# ── Reality Engine Classes ────────────────────────────────
-keep class com.naif.realityengine.BuildConfig { *; }

# JavascriptInterface (لو ضفنا WebView مستقبلاً)
-keepclassmembers class com.naif.realityengine.** {
    @android.webkit.JavascriptInterface <methods>;
}

# ── AndroidX ──────────────────────────────────────────────
-dontwarn androidx.**
-keep class androidx.core.app.CoreComponentFactory { *; }

# ── JSON ──────────────────────────────────────────────────
-keep class org.json.** { *; }

# ── Google Play Billing (للاشتراك المدفوع لاحقاً) ────────
-keep class com.android.billingclient.api.** { *; }
-keep interface com.android.billingclient.api.** { *; }
-dontwarn com.android.billingclient.**

# ── Google Services ───────────────────────────────────────
-keep class com.google.android.gms.tasks.** { *; }
-dontwarn com.google.android.gms.**

# ── Annotations + Signatures ──────────────────────────────
-keepattributes *Annotation*
-keepattributes Exceptions,InnerClasses,Signature

# ── Enums ─────────────────────────────────────────────────
-keepclassmembers enum * {
    public static **[] values();
    public static ** valueOf(java.lang.String);
}

# ── Parcelable ────────────────────────────────────────────
-keep class * implements android.os.Parcelable {
    public static final android.os.Parcelable$Creator *;
}

# ── حذف Logs في Release ──────────────────────────────────
-assumenosideeffects class android.util.Log {
    public static int d(...);
    public static int v(...);
    public static int i(...);
}

# ── R8 Optimization ───────────────────────────────────────
-optimizationpasses 5
-allowaccessmodification
-mergeinterfacesaggressively
-repackageclasses 'r'

# ── إخفاء Source Info ─────────────────────────────────────
-renamesourcefileattribute SourceFile

# Keep networking classes
-keep class java.net.** { *; }
-keep class javax.net.** { *; }
-dontwarn java.net.**

# Keep AIEngine
-keep class com.naif.realityengine.AIEngine { *; }
-keepclassmembers class com.naif.realityengine.AIEngine { *; }
