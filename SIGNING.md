# دليل التوقيع — Android Signing Guide

## ⚠️ مهم جداً

كلمة مرور الـ keystore محفوظة في ملف `.env` فقط.
لا تشاركها مع أحد ولا ترفعها على GitHub.

---

## ملفات التوقيع

```
reality-engine.keystore   ← مفتاح التوقيع (27 سنة صلاحية)
credentials.json          ← EAS credentials (يحتوي الـ keystore مشفر)
.env                      ← كلمة المرور (مو في git)
```

---

## معلومات المفتاح

```
Alias:     reality-engine-key
Algorithm: RSA 2048-bit
Validity:  10,000 يوم (حتى 2053)
Owner:     CN=Reality Engine, O=Naif Dev, L=Riyadh, C=SA
```

---

## الاستخدام

```bash
# APK للاختبار
eas build --platform android --profile preview

# AAB للنشر
eas build --platform android --profile production

# رفع مباشر
eas submit --platform android --profile production
```

---

## ⚠️ لو خسرت الـ Keystore

ما تقدر تحدّث التطبيق على Google Play أبداً.
احتفظ بنسخة في 3 أماكن مختلفة.

## تغيير كلمة المرور

```bash
keytool -storepasswd \
  -keystore reality-engine.keystore \
  -storepass $(grep KEYSTORE_PASSWORD .env | cut -d'=' -f2)
# ثم حدّث .env و credentials.json
```
