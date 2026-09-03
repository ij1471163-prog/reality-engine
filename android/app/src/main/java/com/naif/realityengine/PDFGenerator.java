package com.naif.realityengine;

import android.content.Context;
import android.graphics.*;
import android.graphics.pdf.PdfDocument;
import android.os.Environment;
import java.io.*;
import java.text.SimpleDateFormat;
import java.util.*;

/**
 * PDFGenerator — يولد تقرير PDF احترافي من نتائج التحليل
 * لا يحتاج مكتبات خارجية — يستخدم Android PdfDocument
 */
public class PDFGenerator {

    // ─── Colors ───────────────────────────────────────────
    private static final int COLOR_BG       = Color.parseColor("#0D1117");
    private static final int COLOR_SURFACE  = Color.parseColor("#161B22");
    private static final int COLOR_BORDER   = Color.parseColor("#30363D");
    private static final int COLOR_TEXT     = Color.parseColor("#E6EDF3");
    private static final int COLOR_MUTED    = Color.parseColor("#8B949E");
    private static final int COLOR_CRITICAL = Color.parseColor("#FF4444");
    private static final int COLOR_HIGH     = Color.parseColor("#FF8C00");
    private static final int COLOR_MEDIUM   = Color.parseColor("#FFD700");
    private static final int COLOR_LOW      = Color.parseColor("#58A6FF");
    private static final int COLOR_GREEN    = Color.parseColor("#3FB950");
    private static final int COLOR_PURPLE   = Color.parseColor("#A371F7");

    private static final int PAGE_WIDTH  = 595; // A4
    private static final int PAGE_HEIGHT = 842;
    private static final int MARGIN      = 40;
    private static final int LINE_HEIGHT = 20;

    // ─── Report Model ─────────────────────────────────────

    public static class ReportData {
        public String fileName;
        public String language;
        public int    totalIssues;
        public int    critical;
        public int    high;
        public int    medium;
        public int    low;
        public int    securityScore;
        public List<Issue> issues = new ArrayList<>();
        public String analysisDate;

        public ReportData(String fileName) {
            this.fileName     = fileName;
            this.analysisDate = new SimpleDateFormat("yyyy-MM-dd HH:mm",
                Locale.US).format(new Date());
        }
    }

    public static class Issue {
        public final String title;
        public final String severity;
        public final String fix;
        public final int    line;
        public final String cwe;

        public Issue(String title, String severity, String fix, int line, String cwe) {
            this.title    = title;
            this.severity = severity;
            this.fix      = fix;
            this.line     = line;
            this.cwe      = cwe;
        }
    }

    // ─── Main Generate ────────────────────────────────────

    public static File generate(Context ctx, ReportData data) throws IOException {
        PdfDocument doc  = new PdfDocument();
        int pageNum = 1;
        int y       = MARGIN;

        PdfDocument.PageInfo pageInfo = new PdfDocument.PageInfo.Builder(
            PAGE_WIDTH, PAGE_HEIGHT, pageNum).create();
        PdfDocument.Page page = doc.startPage(pageInfo);
        Canvas canvas = page.getCanvas();

        drawBackground(canvas);
        y = drawHeader(canvas, data, y);
        y += 20;
        y = drawScoreCard(canvas, data, y);
        y += 20;
        y = drawSummary(canvas, data, y);
        y += 20;

        for (Issue issue : data.issues) {
            if (y > PAGE_HEIGHT - 100) {
                // ✅ Footer على كل صفحة
                drawFooter(canvas, data, pageNum);
                doc.finishPage(page);
                pageNum++;
                pageInfo = new PdfDocument.PageInfo.Builder(
                    PAGE_WIDTH, PAGE_HEIGHT, pageNum).create();
                page   = doc.startPage(pageInfo);
                canvas = page.getCanvas();
                drawBackground(canvas);
                y = MARGIN;
            }
            y = drawIssue(canvas, issue, y);
            y += 12;
        }

        // Footer آخر صفحة
        drawFooter(canvas, data, pageNum);
        doc.finishPage(page);

        // ✅ try-with-resources — لا resource leak
        File file = getSaveFile(ctx, data.fileName);
        try (FileOutputStream fos = new FileOutputStream(file)) {
            doc.writeTo(fos);
        } finally {
            doc.close();
        }

        return file;
    }

    // ─── Draw Functions ───────────────────────────────────

    private static void drawBackground(Canvas c) {
        Paint bg = new Paint();
        bg.setColor(COLOR_BG);
        c.drawRect(0, 0, PAGE_WIDTH, PAGE_HEIGHT, bg);
    }

    private static int drawHeader(Canvas c, ReportData data, int y) {
        Paint p = new Paint();

        // Title bar
        p.setColor(COLOR_SURFACE);
        c.drawRect(0, 0, PAGE_WIDTH, 80, p);

        // Title
        p.setColor(COLOR_PURPLE);
        p.setTextSize(22);
        p.setTypeface(Typeface.DEFAULT_BOLD);
        c.drawText("Reality Engine", MARGIN, 35, p);

        p.setColor(COLOR_MUTED);
        p.setTextSize(12);
        p.setTypeface(Typeface.DEFAULT);
        c.drawText("Security Analysis Report", MARGIN, 55, p);

        // Date
        p.setColor(COLOR_MUTED);
        p.setTextSize(10);
        p.setTextAlign(Paint.Align.RIGHT);
        c.drawText(data.analysisDate, PAGE_WIDTH - MARGIN, 35, p);
        c.drawText(data.fileName, PAGE_WIDTH - MARGIN, 50, p);
        p.setTextAlign(Paint.Align.LEFT);

        return 95;
    }

    private static int drawScoreCard(Canvas c, ReportData data, int y) {
        Paint p = new Paint();

        // Card background
        p.setColor(COLOR_SURFACE);
        RectF card = new RectF(MARGIN, y, PAGE_WIDTH - MARGIN, y + 70);
        p.setAntiAlias(true);
        c.drawRoundRect(card, 8, 8, p);

        // Score
        int score = data.securityScore;
        int scoreColor = score >= 80 ? COLOR_GREEN :
                         score >= 60 ? COLOR_MEDIUM : COLOR_CRITICAL;
        p.setColor(scoreColor);
        p.setTextSize(36);
        p.setTypeface(Typeface.DEFAULT_BOLD);
        c.drawText(score + "/100", MARGIN + 16, y + 48, p);

        p.setColor(COLOR_MUTED);
        p.setTextSize(11);
        p.setTypeface(Typeface.DEFAULT);
        c.drawText("Security Score", MARGIN + 16, y + 62, p);

        // Stats
        int[] counts = {data.critical, data.high, data.medium, data.low};
        int[] colors = {COLOR_CRITICAL, COLOR_HIGH, COLOR_MEDIUM, COLOR_LOW};
        String[] labels = {"Critical", "High", "Medium", "Low"};
        int sx = PAGE_WIDTH - MARGIN - 240;

        for (int i = 0; i < 4; i++) {
            int x = sx + i * 60;
            p.setColor(colors[i]);
            p.setTextSize(20);
            p.setTypeface(Typeface.DEFAULT_BOLD);
            c.drawText(String.valueOf(counts[i]), x, y + 40, p);
            p.setColor(COLOR_MUTED);
            p.setTextSize(9);
            p.setTypeface(Typeface.DEFAULT);
            c.drawText(labels[i], x, y + 55, p);
        }

        return y + 85;
    }

    private static int drawSummary(Canvas c, ReportData data, int y) {
        Paint p = new Paint();

        p.setColor(COLOR_TEXT);
        p.setTextSize(13);
        p.setTypeface(Typeface.DEFAULT_BOLD);
        c.drawText("Findings (" + data.totalIssues + ")", MARGIN, y + 14, p);

        // Divider
        p.setColor(COLOR_BORDER);
        p.setStrokeWidth(1);
        c.drawLine(MARGIN, y + 20, PAGE_WIDTH - MARGIN, y + 20, p);

        return y + 30;
    }

    private static int drawIssue(Canvas c, Issue issue, int y) {
        Paint p = new Paint();
        p.setAntiAlias(true);

        int sevColor = getSeverityColor(issue.severity);

        // Issue card
        p.setColor(COLOR_SURFACE);
        RectF card = new RectF(MARGIN, y, PAGE_WIDTH - MARGIN, y + 60);
        c.drawRoundRect(card, 6, 6, p);

        // Severity bar
        p.setColor(sevColor);
        RectF bar = new RectF(MARGIN, y, MARGIN + 4, y + 60);
        c.drawRoundRect(bar, 3, 3, p);

        // Severity badge
        p.setColor(sevColor);
        p.setTextSize(9);
        p.setTypeface(Typeface.DEFAULT_BOLD);
        c.drawText(issue.severity.toUpperCase(), MARGIN + 14, y + 14, p);

        // Line number
        p.setColor(COLOR_MUTED);
        p.setTextSize(9);
        p.setTypeface(Typeface.DEFAULT);
        p.setTextAlign(Paint.Align.RIGHT);
        c.drawText("L" + issue.line, PAGE_WIDTH - MARGIN - 8, y + 14, p);
        p.setTextAlign(Paint.Align.LEFT);

        // Title
        p.setColor(COLOR_TEXT);
        p.setTextSize(12);
        p.setTypeface(Typeface.DEFAULT_BOLD);
        c.drawText(truncate(issue.title, 65), MARGIN + 14, y + 30, p);

        // Fix
        p.setColor(COLOR_MUTED);
        p.setTextSize(10);
        p.setTypeface(Typeface.DEFAULT);
        c.drawText(truncate(issue.fix, 75), MARGIN + 14, y + 46, p);

        // CWE
        if (issue.cwe != null && !issue.cwe.isEmpty()) {
            p.setColor(COLOR_LOW);
            p.setTextSize(9);
            p.setTextAlign(Paint.Align.RIGHT);
            c.drawText(issue.cwe, PAGE_WIDTH - MARGIN - 8, y + 46, p);
            p.setTextAlign(Paint.Align.LEFT);
        }

        return y + 65;
    }

    private static void drawFooter(Canvas c, ReportData data, int pageNum) {
        Paint p = new Paint();

        // Footer bar
        p.setColor(COLOR_SURFACE);
        c.drawRect(0, PAGE_HEIGHT - 35, PAGE_WIDTH, PAGE_HEIGHT, p);

        p.setColor(COLOR_MUTED);
        p.setTextSize(9);
        c.drawText("Generated by Reality Engine | " + data.analysisDate,
            MARGIN, PAGE_HEIGHT - 15, p);

        p.setTextAlign(Paint.Align.RIGHT);
        c.drawText("Page " + pageNum, PAGE_WIDTH - MARGIN, PAGE_HEIGHT - 15, p);
    }

    // ─── Helpers ──────────────────────────────────────────

    private static int getSeverityColor(String severity) {
        if (severity == null) return COLOR_LOW;
        switch (severity.toUpperCase()) {
            case "CRITICAL": return COLOR_CRITICAL;
            case "HIGH":     return COLOR_HIGH;
            case "MEDIUM":   return COLOR_MEDIUM;
            default:         return COLOR_LOW;
        }
    }

    private static String truncate(String s, int max) {
        if (s == null) return "";
        return s.length() > max ? s.substring(0, max - 3) + "..." : s;
    }

    private static File getSaveFile(Context ctx, String fileName) {
        String base = fileName.replaceAll("[^a-zA-Z0-9._\\-]", "_");
        String name = "RealityEngine_" + base + "_"
            + new SimpleDateFormat("yyyyMMdd_HHmm", Locale.US).format(new Date()) + ".pdf";
        File dir = ctx.getExternalFilesDir(Environment.DIRECTORY_DOCUMENTS);
        if (dir == null) dir = ctx.getFilesDir();
        return new File(dir, name);
    }

    // ─── Convert from EngineAnalyzer Report ───────────────

    public static ReportData fromEngineReport(
            String fileName,
            String engineMessage,
            List<SecurityScanner.SecurityIssue> secIssues) {

        ReportData data = new ReportData(fileName); // ✅ fileName يُعيَّن في الـ constructor

        if (secIssues != null) {
            for (SecurityScanner.SecurityIssue si : secIssues) {
                String sev = si.severity != null ? si.severity : "MEDIUM";
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
