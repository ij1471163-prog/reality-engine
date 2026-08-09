# ── R8 Full Mode ─────────────────────────────────────────
-allowaccessmodification
-repackageclasses 'r'

# ── تشويش كودنا كامل ──────────────────────────────────
-keep class com.naif.realityengine.MainActivity { *; }
-keep class com.naif.realityengine.*Activity { *; }

# ── حذف debug info من release ─────────────────────────
-renamesourcefileattribute SourceFile
-keepattributes Exceptions,InnerClasses,Signature,Deprecated,EnclosingMethod

# ── AndroidX + Material ───────────────────────────────
-keep class androidx.** { *; }
-keep interface androidx.** { *; }
-keep class com.google.android.material.** { *; }
-dontwarn androidx.**
-dontwarn com.google.android.material.**

# ── JSON parsing ──────────────────────────────────────
-keepclassmembers class * {
    @com.google.gson.annotations.SerializedName <fields>;
}

# ── JavaScript Interface ──────────────────────────────
-keepclassmembers class * {
    @android.webkit.JavascriptInterface <methods>;
}

# ── Enums ─────────────────────────────────────────────
-keepclassmembers enum * {
    public static **[] values();
    public static ** valueOf(java.lang.String);
}

# ── Parcelable ────────────────────────────────────────
-keep class * implements android.os.Parcelable {
    public static final android.os.Parcelable$Creator *;
}

# ── حذف logs في release ──────────────────────────────
-assumenosideeffects class android.util.Log {
    public static *** d(...);
    public static *** v(...);
    public static *** i(...);
}

# ── لا lineNumbers في release ────────────────────────
# نحذف LineNumberTable لصعوبة الهندسة العكسية
-keepattributes Exceptions,Signature

# ── لا API keys في الكود ─────────────────────────────
# AI_KEY يجي من BuildConfig فقط
-keep class com.naif.realityengine.BuildConfig { *; }
