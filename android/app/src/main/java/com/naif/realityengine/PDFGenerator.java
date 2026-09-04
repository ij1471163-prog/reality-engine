package com.naif.realityengine;

import android.content.Context;
import android.graphics.*;
import android.graphics.pdf.PdfDocument;
import android.os.Environment;
import java.io.*;
import java.text.SimpleDateFormat;
import java.util.*;

/**
 * PDFGenerator v2.0 — تقرير PDF احترافي بالعربية
 * بدون مكتبات خارجية — Android PdfDocument
 */
public class PDFGenerator {

    // ─── Colors ───────────────────────────────────────────
    private static final int BG       = Color.parseColor("#0D1117");
    private static final int SURFACE  = Color.parseColor("#161B22");
    private static final int BORDER   = Color.parseColor("#30363D");
    private static final int TEXT     = Color.parseColor("#E6EDF3");
    private static final int MUTED    = Color.parseColor("#8B949E");
    private static final int CRITICAL = Color.parseColor("#F85149");
    private static final int HIGH     = Color.parseColor("#F0883E");
    private static final int MEDIUM   = Color.parseColor("#D29922");
    private static final int LOW      = Color.parseColor("#58A6FF");
    private static final int GREEN    = Color.parseColor("#3FB950");
    private static final int PURPLE   = Color.parseColor("#A371F7");

    private static final int W = 595; // A4
    private static final int H = 842;
    private static final int M = 36;  // margin

    // ─── Models ───────────────────────────────────────────

    public static class ReportData {
        public String fileName   = "";
        public String analysisDate;
        public int    totalIssues, critical, high, medium, low, securityScore;
        public List<Issue> issues = new ArrayList<>();

        public ReportData(String fileName) {
            this.fileName     = fileName != null ? fileName : "";
            this.analysisDate = new SimpleDateFormat("yyyy/MM/dd HH:mm", Locale.US).format(new Date());
        }
    }

    public static class Issue {
        public String title, severity, fix, cwe;
        public int    line;
        public Issue(String title, String severity, String fix, int line, String cwe) {
            this.title    = title    != null ? title    : "";
            this.severity = severity != null ? severity : "LOW";
            this.fix      = fix      != null ? fix      : "";
            this.line     = line;
            this.cwe      = cwe      != null ? cwe      : "";
        }
    }


    // ─── Localization ─────────────────────────────────────

    private static class Strings {
        String reportTitle, securityReport, securityScore, secure, review, critical;
        String summary, findings, noIssues, generatedBy, page, line;
        String levelCritical, levelHigh, levelMedium, levelLow;
        String fix;

        static Strings get() {
            String lang = java.util.Locale.getDefault().getLanguage();
            Strings s = new Strings();
            switch (lang) {
                case "ar":
                    s.reportTitle   = "تقرير الأمان";
                    s.securityReport= "تقرير تحليل الكود";
                    s.securityScore = "نتيجة الأمان";
                    s.secure        = "آمن ✅";
                    s.review        = "يحتاج مراجعة ⚠️";
                    s.critical      = "خطر ❌";
                    s.summary       = "ملخص";
                    s.findings      = "النتائج";
                    s.noIssues      = "✅ لم يتم اكتشاف أي مشاكل أمنية";
                    s.generatedBy   = "أُنشئ بواسطة Reality Engine";
                    s.page          = "صفحة";
                    s.line          = "السطر";
                    s.fix           = "الإصلاح";
                    s.levelCritical = "🔴 حرج";
                    s.levelHigh     = "🟠 عالي";
                    s.levelMedium   = "🟡 متوسط";
                    s.levelLow      = "🔵 منخفض";
                    break;
                case "hi":
                    s.reportTitle   = "सुरक्षा रिपोर्ट";
                    s.securityReport= "कोड विश्लेषण रिपोर्ट";
                    s.securityScore = "सुरक्षा स्कोर";
                    s.secure        = "सुरक्षित ✅";
                    s.review        = "समीक्षा करें ⚠️";
                    s.critical      = "खतरनाक ❌";
                    s.summary       = "सारांश";
                    s.findings      = "निष्कर्ष";
                    s.noIssues      = "✅ कोई सुरक्षा समस्या नहीं मिली";
                    s.generatedBy   = "Reality Engine द्वारा निर्मित";
                    s.page          = "पृष्ठ";
                    s.line          = "पंक्ति";
                    s.fix           = "सुधार";
                    s.levelCritical = "🔴 गंभीर";
                    s.levelHigh     = "🟠 उच्च";
                    s.levelMedium   = "🟡 मध्यम";
                    s.levelLow      = "🔵 निम्न";
                    break;
                case "fr":
                    s.reportTitle   = "Rapport de Sécurité";
                    s.securityReport= "Rapport d'Analyse de Code";
                    s.securityScore = "Score de Sécurité";
                    s.secure        = "Sécurisé ✅";
                    s.review        = "À Revoir ⚠️";
                    s.critical      = "Critique ❌";
                    s.summary       = "Résumé";
                    s.findings      = "Résultats";
                    s.noIssues      = "✅ Aucun problème de sécurité détecté";
                    s.generatedBy   = "Généré par Reality Engine";
                    s.page          = "Page";
                    s.line          = "Ligne";
                    s.fix           = "Correction";
                    s.levelCritical = "🔴 Critique";
                    s.levelHigh     = "🟠 Élevé";
                    s.levelMedium   = "🟡 Moyen";
                    s.levelLow      = "🔵 Faible";
                    break;
                case "es":
                    s.reportTitle   = "Informe de Seguridad";
                    s.securityReport= "Informe de Análisis de Código";
                    s.securityScore = "Puntuación de Seguridad";
                    s.secure        = "Seguro ✅";
                    s.review        = "Revisar ⚠️";
                    s.critical      = "Crítico ❌";
                    s.summary       = "Resumen";
                    s.findings      = "Hallazgos";
                    s.noIssues      = "✅ No se detectaron problemas de seguridad";
                    s.generatedBy   = "Generado por Reality Engine";
                    s.page          = "Página";
                    s.line          = "Línea";
                    s.fix           = "Corrección";
                    s.levelCritical = "🔴 Crítico";
                    s.levelHigh     = "🟠 Alto";
                    s.levelMedium   = "🟡 Medio";
                    s.levelLow      = "🔵 Bajo";
                    break;
                case "de":
                    s.reportTitle   = "Sicherheitsbericht";
                    s.securityReport= "Code-Analysebericht";
                    s.securityScore = "Sicherheitspunktzahl";
                    s.secure        = "Sicher ✅";
                    s.review        = "Überprüfen ⚠️";
                    s.critical      = "Kritisch ❌";
                    s.summary       = "Zusammenfassung";
                    s.findings      = "Ergebnisse";
                    s.noIssues      = "✅ Keine Sicherheitsprobleme gefunden";
                    s.generatedBy   = "Erstellt von Reality Engine";
                    s.page          = "Seite";
                    s.line          = "Zeile";
                    s.fix           = "Korrektur";
                    s.levelCritical = "🔴 Kritisch";
                    s.levelHigh     = "🟠 Hoch";
                    s.levelMedium   = "🟡 Mittel";
                    s.levelLow      = "🔵 Niedrig";
                    break;
                default: // English
                    s.reportTitle   = "Security Report";
                    s.securityReport= "Code Analysis Report";
                    s.securityScore = "Security Score";
                    s.secure        = "Secure ✅";
                    s.review        = "Needs Review ⚠️";
                    s.critical      = "Critical ❌";
                    s.summary       = "Summary";
                    s.findings      = "Findings";
                    s.noIssues      = "✅ No security issues found";
                    s.generatedBy   = "Generated by Reality Engine";
                    s.page          = "Page";
                    s.line          = "Line";
                    s.fix           = "Fix";
                    s.levelCritical = "🔴 Critical";
                    s.levelHigh     = "🟠 High";
                    s.levelMedium   = "🟡 Medium";
                    s.levelLow      = "🔵 Low";
            }
            return s;
        }
    }

    // ─── Generate ─────────────────────────────────────────

    public static File generate(Context ctx, ReportData data) throws IOException {
        PdfDocument doc = new PdfDocument();
        int pageNum = 1;

        PdfDocument.PageInfo info = new PdfDocument.PageInfo.Builder(W, H, pageNum).create();
        PdfDocument.Page page = doc.startPage(info);
        Canvas c = page.getCanvas();
        int y = drawPage(c, data, pageNum);

        // صفحات إضافية لو كثير issues
        if (data.issues.size() > 8) {
            drawFooter(c, data.analysisDate, pageNum);
            doc.finishPage(page);
            pageNum++;
            info = new PdfDocument.PageInfo.Builder(W, H, pageNum).create();
            page = doc.startPage(info);
            c = page.getCanvas();
            fillBG(c);
            y = M + 10;
            y = drawRemainingIssues(c, data, y, 8);
        }

        drawFooter(c, data.analysisDate, pageNum);
        doc.finishPage(page);

        File file = getFile(ctx, data.fileName);
        try (FileOutputStream fos = new FileOutputStream(file)) {
            doc.writeTo(fos);
        } finally {
            doc.close();
        }
        return file;
    }

    private static int drawPage(Canvas c, ReportData data, int pageNum) {
        fillBG(c);
        Strings s = Strings.get();
        int y = drawHeader(c, data, s);
        y = drawScoreCard(c, data, y, s);
        y = drawSummaryCards(c, data, y, s);
        y = drawIssuesSection(c, data, y, 0, 8, s);
        return y;
    }

    // ─── Header ───────────────────────────────────────────

    private static int drawHeader(Canvas c, ReportData data, Strings s) {
        Paint p = new Paint(Paint.ANTI_ALIAS_FLAG);

        // Header bar
        p.setColor(SURFACE);
        c.drawRect(0, 0, W, 70, p);

        // شريط ملون
        p.setColor(PURPLE);
        c.drawRect(0, 0, 5, 70, p);

        // Logo
        p.setColor(PURPLE);
        p.setTextSize(18);
        p.setTypeface(Typeface.DEFAULT_BOLD);
        c.drawText("Reality Engine", M, 28, p);

        p.setColor(MUTED);
        p.setTextSize(10);
        p.setTypeface(Typeface.DEFAULT);
        c.drawText(s.securityReport, M, 44, p);
        c.drawText("Security Analysis Report", M, 58, p);

        // File + date (right side)
        p.setTextAlign(Paint.Align.RIGHT);
        p.setColor(TEXT);
        p.setTextSize(11);
        String fname = data.fileName.length() > 30
            ? "..." + data.fileName.substring(data.fileName.length() - 27)
            : data.fileName;
        c.drawText(fname, W - M, 32, p);
        p.setColor(MUTED);
        p.setTextSize(10);
        c.drawText(data.analysisDate, W - M, 50, p);
        p.setTextAlign(Paint.Align.LEFT);

        return 85;
    }

    // ─── Score Card ───────────────────────────────────────

    private static int drawScoreCard(Canvas c, ReportData data, int y, Strings s) {
        Paint p = new Paint(Paint.ANTI_ALIAS_FLAG);

        // Card
        p.setColor(SURFACE);
        c.drawRoundRect(new RectF(M, y, W - M, y + 75), 10, 10, p);

        // Score color
        int score = data.securityScore;
        int sc = score >= 80 ? GREEN : score >= 50 ? MEDIUM : CRITICAL;

        p.setColor(sc);
        p.setTextSize(38);
        p.setTypeface(Typeface.DEFAULT_BOLD);
        c.drawText(score + "/100", M + 16, y + 50, p);

        p.setColor(MUTED);
        p.setTextSize(10);
        p.setTypeface(Typeface.DEFAULT);
        String label = score >= 80 ? s.secure : score >= 50 ? s.review : s.critical;
        c.drawText(s.securityScore + " — " + label, M + 16, y + 65, p);

        // Mini stats (right)
        int[][] stats = {
            {data.critical, CRITICAL},
            {data.high,     HIGH},
            {data.medium,   MEDIUM},
            {data.low,      LOW}
        };
        String[] labels = {s.levelCritical, s.levelHigh, s.levelMedium, s.levelLow};
        int sx = W - M - 200;
        for (int i = 0; i < 4; i++) {
            int x = sx + i * 50;
            p.setColor(stats[i][1]);
            p.setTextSize(22);
            p.setTypeface(Typeface.DEFAULT_BOLD);
            c.drawText(String.valueOf(stats[i][0]), x, y + 42, p);
            p.setColor(MUTED);
            p.setTextSize(8);
            p.setTypeface(Typeface.DEFAULT);
            c.drawText(labels[i], x, y + 55, p);
        }

        return y + 90;
    }

    // ─── Summary Cards ────────────────────────────────────

    private static int drawSummaryCards(Canvas c, ReportData data, int y, Strings s) {
        Paint p = new Paint(Paint.ANTI_ALIAS_FLAG);

        p.setColor(TEXT);
        p.setTextSize(12);
        p.setTypeface(Typeface.DEFAULT_BOLD);
        c.drawText(s.summary, M, y + 14, p);

        y += 22;

        // Cards row
        int cw = (W - M * 2 - 12) / 4;
        int[][] cards = {
            {data.critical, CRITICAL},
            {data.high,     HIGH},
            {data.medium,   MEDIUM},
            {data.low,      LOW}
        };
        String[] cLabels = {s.levelCritical, s.levelHigh, s.levelMedium, s.levelLow};

        for (int i = 0; i < 4; i++) {
            int x = M + i * (cw + 4);
            p.setColor(SURFACE);
            c.drawRoundRect(new RectF(x, y, x + cw, y + 44), 8, 8, p);
            p.setColor(cards[i][1]);
            p.setTextSize(20);
            p.setTypeface(Typeface.DEFAULT_BOLD);
            c.drawText(String.valueOf(cards[i][0]), x + 10, y + 28, p);
            p.setColor(MUTED);
            p.setTextSize(9);
            p.setTypeface(Typeface.DEFAULT);
            c.drawText(cLabels[i], x + 10, y + 40, p);
        }

        return y + 58;
    }

    // ─── Issues ───────────────────────────────────────────

    private static int drawIssuesSection(Canvas c, ReportData data, int y, int from, int to, Strings s) {
        Paint p = new Paint(Paint.ANTI_ALIAS_FLAG);

        p.setColor(TEXT);
        p.setTextSize(12);
        p.setTypeface(Typeface.DEFAULT_BOLD);
        c.drawText(s.findings + " (" + data.totalIssues + ")", M, y + 14, p);

        // Divider
        p.setColor(BORDER);
        p.setStrokeWidth(1);
        c.drawLine(M, y + 20, W - M, y + 20, p);
        y += 30;

        if (data.issues.isEmpty()) {
            p.setColor(GREEN);
            p.setTextSize(13);
            p.setTypeface(Typeface.DEFAULT_BOLD);
            c.drawText(s.noIssues, M, y + 20, p);
            return y + 40;
        }

        int end = Math.min(to, data.issues.size());
        for (int i = from; i < end; i++) {
            if (y > H - 90) break;
            y = drawIssueCard(c, data.issues.get(i), y);
            y += 8;
        }
        return y;
    }

    private static int drawRemainingIssues(Canvas c, ReportData data, int y, int from) {
        Strings s = Strings.get();
        return drawIssuesSection(c, data, y, from, data.issues.size(), s);
    }

    private static int drawIssueCard(Canvas c, Issue issue, int y) {
        Paint p = new Paint(Paint.ANTI_ALIAS_FLAG);
        int sevColor = sevColor(issue.severity);
        int cardH = 58;

        // Card BG
        p.setColor(SURFACE);
        c.drawRoundRect(new RectF(M, y, W - M, y + cardH), 6, 6, p);

        // Severity stripe
        p.setColor(sevColor);
        c.drawRoundRect(new RectF(M, y, M + 4, y + cardH), 3, 3, p);

        // Severity label
        p.setColor(sevColor);
        p.setTextSize(8);
        p.setTypeface(Typeface.DEFAULT_BOLD);
        c.drawText(sevLabel(issue.severity), M + 10, y + 13, p);

        // Line number
        p.setColor(MUTED);
        p.setTextSize(8);
        p.setTypeface(Typeface.DEFAULT);
        p.setTextAlign(Paint.Align.RIGHT);
        c.drawText(Strings.get().line + " " + issue.line, W - M - 6, y + 13, p);
        p.setTextAlign(Paint.Align.LEFT);

        // Title
        p.setColor(TEXT);
        p.setTextSize(11);
        p.setTypeface(Typeface.DEFAULT_BOLD);
        String title = issue.title.length() > 68 ? issue.title.substring(0, 65) + "..." : issue.title;
        c.drawText(title, M + 10, y + 28, p);

        // Fix
        if (!issue.fix.isEmpty()) {
            p.setColor(MUTED);
            p.setTextSize(9);
            p.setTypeface(Typeface.DEFAULT);
            String fix = issue.fix.length() > 80 ? issue.fix.substring(0, 77) + "..." : issue.fix;
            c.drawText("✏️ " + fix, M + 10, y + 44, p);
        }

        // CWE
        if (!issue.cwe.isEmpty()) {
            p.setColor(LOW);
            p.setTextSize(8);
            p.setTextAlign(Paint.Align.RIGHT);
            c.drawText(issue.cwe, W - M - 6, y + 44, p);
            p.setTextAlign(Paint.Align.LEFT);
        }

        return y + cardH;
    }

    // ─── Footer ───────────────────────────────────────────

    private static void drawFooter(Canvas c, String date, int pageNum) {
        Strings s = Strings.get();
        Paint p = new Paint(Paint.ANTI_ALIAS_FLAG);
        p.setColor(SURFACE);
        c.drawRect(0, H - 28, W, H, p);
        p.setColor(MUTED);
        p.setTextSize(8);
        c.drawText(s.generatedBy + "  |  " + date, M, H - 10, p);
        p.setTextAlign(Paint.Align.RIGHT);
        c.drawText(s.page + " " + pageNum, W - M, H - 10, p);
    }

    // ─── Helpers ──────────────────────────────────────────

    private static void fillBG(Canvas c) {
        Paint p = new Paint();
        p.setColor(BG);
        c.drawRect(0, 0, W, H, p);
    }

    private static int sevColor(String s) {
        if (s == null) return LOW;
        switch (s.toUpperCase()) {
            case "CRITICAL": return CRITICAL;
            case "HIGH":     return HIGH;
            case "MEDIUM":   return MEDIUM;
            default:         return LOW;
        }
    }

    private static String sevLabel(String s) {
        if (s == null) return "منخفض";
        switch (s.toUpperCase()) {
            case "CRITICAL": return "🔴 حرج";
            case "HIGH":     return "🟠 عالي";
            case "MEDIUM":   return "🟡 متوسط";
            default:         return "🔵 منخفض";
        }
    }

    private static File getFile(Context ctx, String fileName) {
        String base = (fileName != null ? fileName : "report").replaceAll("[^a-zA-Z0-9._\\-]", "_");
        String name = "RealityEngine_" + base + "_"
            + new SimpleDateFormat("yyyyMMdd_HHmm", Locale.US).format(new Date()) + ".pdf";
        File dir = ctx.getExternalFilesDir(Environment.DIRECTORY_DOCUMENTS);
        if (dir == null) dir = ctx.getFilesDir();
        return new File(dir, name);
    }

    // ─── Convert from SecurityScanner ─────────────────────

    public static ReportData fromEngineReport(
            String fileName,
            String engineMessage,
            List<SecurityScanner.SecurityIssue> secIssues) {

        ReportData data = new ReportData(fileName);

        if (secIssues != null) {
            for (SecurityScanner.SecurityIssue si : secIssues) {
                String sev = si.severity != null ? si.severity.toUpperCase() : "MEDIUM";
                data.issues.add(new Issue(si.title, sev,
                    si.fix != null ? si.fix : "", si.line, ""));
                switch (sev) {
                    case "CRITICAL": data.critical++; break;
                    case "HIGH":     data.high++;     break;
                    case "MEDIUM":   data.medium++;   break;
                    default:         data.low++;      break;
                }
            }
        }

        data.totalIssues   = data.issues.size();
        data.securityScore = Math.max(0, 100
            - data.critical * 20
            - data.high     * 10
            - data.medium   * 5
            - data.low      * 2);

        return data;
    }
}

