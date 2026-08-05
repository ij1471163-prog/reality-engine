# Reality Engine — Mobile

محلل كود ذكي • أمني • بدون إنترنت  
**Android App — Google Play Ready**

---

## الميزات

| الميزة | التفاصيل |
|---|---|
| Security Scanner | 18+ قاعدة أمنية: secrets, SQL injection, weak crypto, shell injection |
| Stub Detector | كشف pass / NotImplementedError / return فاضي مع اقتراح تنفيذ |
| Full Analysis | الاثنين معاً مع تقرير قابل للمشاركة |
| Offline 100% | لا إنترنت، لا API، الكود يبقى على الجهاز |
| Export Report | مشاركة التقرير عبر أي تطبيق |

---

## الإعداد — خطوة بخطوة

### 1. المتطلبات
```bash
node --version   # >= 18
npm --version    # >= 9
```

### 2. تثبيت Expo CLI و EAS
```bash
npm install -g expo-cli eas-cli
```

### 3. تثبيت dependencies
```bash
cd RealityEngine
npm install
```

### 4. تشغيل على المحاكي أو الجهاز
```bash
npx expo start
# اضغط A للـ Android
```

---

## النشر على Google Play

### الخطوة 1 — إنشاء حساب Expo
```
https://expo.dev → إنشاء حساب مجاني
```

### الخطوة 2 — إعداد EAS Build
```bash
eas login
eas build:configure
```

### الخطوة 3 — بناء APK للاختبار
```bash
eas build --platform android --profile preview
```
→ ينزل ملف .apk تقدر تثبته على جهازك مباشرةً

### الخطوة 4 — بناء AAB للنشر
```bash
eas build --platform android --profile production
```
→ ينتج ملف .aab جاهز لـ Google Play

### الخطوة 5 — رفع على Google Play Console
1. افتح: https://play.google.com/console
2. أنشئ تطبيق جديد
3. ارفع ملف .aab
4. أضف screenshots (4 على الأقل)
5. أكمل Store Listing:
   - Title: Reality Engine - Code Analyzer
   - Short description: فحص أمني ذكي للكود — بدون إنترنت
   - Category: Developer Tools
6. اطلب مراجعة النشر

### الخطوة 6 — الوقت المتوقع
- EAS Build: 10-15 دقيقة
- Google Play Review: 1-3 أيام

---

## هيكل المشروع

```
RealityEngine/
├── App.tsx                          # نقطة البداية + Navigation
├── app.json                         # إعدادات Expo
├── package.json                     # Dependencies
└── src/
    ├── screens/
    │   ├── HomeScreen.tsx           # الشاشة الرئيسية
    │   ├── ScannerScreen.tsx        # إدخال الكود
    │   └── ResultsScreen.tsx        # عرض النتائج
    ├── utils/
    │   ├── securityScanner.ts       # محرك الفحص الأمني (18+ قاعدة)
    │   └── stubDetector.ts          # كشف الدوال الناقصة
    └── theme/
        └── colors.ts                # الألوان
```

---

## التطوير المستقبلي

- [ ] دعم JavaScript / TypeScript
- [ ] دعم Java / Kotlin  
- [ ] History للفحوصات السابقة
- [ ] AI-powered suggestions (Anthropic API اختياري)
- [ ] Dark/Light theme toggle
- [ ] Widget سريع

---

## ملاحظة

الكود يُعالج محلياً بالكامل — لا يُرسل لأي خادم خارجي.
