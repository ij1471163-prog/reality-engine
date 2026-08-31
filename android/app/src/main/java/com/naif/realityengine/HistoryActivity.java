package com.naif.realityengine;

import android.app.AlertDialog;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.text.Editable;
import android.text.TextWatcher;
import android.util.TypedValue;
import android.view.View;
import android.view.ViewGroup;
import android.widget.*;
import androidx.appcompat.app.AppCompatActivity;
import androidx.core.content.FileProvider;
import androidx.recyclerview.widget.LinearLayoutManager;
import androidx.recyclerview.widget.RecyclerView;
import org.json.JSONArray;
import org.json.JSONObject;
import java.io.*;
import java.text.SimpleDateFormat;
import java.util.*;
import java.util.stream.Collectors;

public class HistoryActivity extends AppCompatActivity {

    // ═══════════════════════════════════════════════════
    // Color Constants — بدل hardcoded في كل مكان
    // ═══════════════════════════════════════════════════

    private static final int COLOR_BG          = 0xFF0D1117;
    private static final int COLOR_CARD        = 0xFF1C2128;
    private static final int COLOR_CARD_DARK   = 0xFF161B22;
    private static final int COLOR_ACCENT      = 0xFF58A6FF;
    private static final int COLOR_TEXT        = 0xFFE6EDF3;
    private static final int COLOR_MUTED       = 0xFF8B949E;
    private static final int COLOR_WARN        = 0xFFD29922;
    private static final int COLOR_DANGER      = 0xFFF85149;
    private static final int COLOR_BTN         = 0xFF21262D;
    private static final int COLOR_APPROVED    = 0xFF3FB950;
    private static final int COLOR_DIVIDER     = 0xFF30363D;

    // ═══════════════════════════════════════════════════
    // State
    // ═══════════════════════════════════════════════════

    private BackupManager              backupManager;
    private SessionAdapter             adapter;
    private List<BackupManager.Session> allSessions   = new ArrayList<>();
    private List<BackupManager.Session> filteredList  = new ArrayList<>();
    private String                     currentFilter  = "";
    private boolean                    sortByNewest   = true;

    // ═══════════════════════════════════════════════════
    // onCreate
    // ═══════════════════════════════════════════════════

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        // Root
        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setBackgroundColor(COLOR_BG);

        // ── Toolbar ──
        root.addView(buildToolbar());

        // ── Search + Sort bar ──
        root.addView(buildSearchBar());

        // ── Stats row ──
        TextView tvStats = new TextView(this);
        tvStats.setTag("tvStats");
        tvStats.setTextColor(COLOR_MUTED);
        tvStats.setTextSize(12);
        tvStats.setPadding(dp(16), dp(8), dp(16), dp(4));
        root.addView(tvStats);

        // ── RecyclerView ──
        RecyclerView rv = new RecyclerView(this);
        rv.setLayoutManager(new LinearLayoutManager(this));
        rv.setPadding(dp(16), dp(8), dp(16), dp(24));
        rv.setClipToPadding(false);
        adapter = new SessionAdapter();
        rv.setAdapter(adapter);
        LinearLayout.LayoutParams rvParams = new LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f);
        rv.setLayoutParams(rvParams);
        root.addView(rv);

        setContentView(root);

        backupManager = new BackupManager(this);
        loadData();
    }

    // ═══════════════════════════════════════════════════
    // Toolbar
    // ═══════════════════════════════════════════════════

    private View buildToolbar() {
        LinearLayout bar = new LinearLayout(this);
        bar.setOrientation(LinearLayout.HORIZONTAL);
        bar.setBackgroundColor(COLOR_CARD_DARK);
        bar.setPadding(dp(16), dp(12), dp(16), dp(12));
        bar.setGravity(android.view.Gravity.CENTER_VERTICAL);

        Button btnBack = new Button(this);
        btnBack.setText("←");
        btnBack.setBackgroundColor(0x00000000);
        btnBack.setTextColor(COLOR_MUTED);
        btnBack.setTextSize(18);
        btnBack.setMinWidth(0);
        btnBack.setPadding(0, 0, dp(12), 0);
        btnBack.setOnClickListener(v -> finish());

        TextView tvTitle = new TextView(this);
        tvTitle.setText("📋 السجل");
        tvTitle.setTextColor(COLOR_ACCENT);
        tvTitle.setTextSize(18);
        tvTitle.setLayoutParams(new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f));

        // Export button
        Button btnExport = new Button(this);
        btnExport.setText("↑ تصدير");
        btnExport.setBackgroundColor(0x00000000);
        btnExport.setTextColor(COLOR_ACCENT);
        btnExport.setTextSize(13);
        btnExport.setMinWidth(0);
        btnExport.setPadding(dp(8), 0, 0, 0);
        btnExport.setOnClickListener(v -> showExportDialog());

        bar.addView(btnBack);
        bar.addView(tvTitle);
        bar.addView(btnExport);
        return bar;
    }

    // ═══════════════════════════════════════════════════
    // Search + Sort bar
    // ═══════════════════════════════════════════════════

    private View buildSearchBar() {
        LinearLayout bar = new LinearLayout(this);
        bar.setOrientation(LinearLayout.HORIZONTAL);
        bar.setPadding(dp(16), dp(8), dp(16), dp(4));
        bar.setGravity(android.view.Gravity.CENTER_VERTICAL);

        // Search field
        EditText etSearch = new EditText(this);
        etSearch.setHint("ابحث باسم الملف...");
        etSearch.setHintTextColor(COLOR_MUTED);
        etSearch.setTextColor(COLOR_TEXT);
        etSearch.setTextSize(13);
        etSearch.setBackgroundColor(COLOR_CARD);
        etSearch.setPadding(dp(12), dp(10), dp(12), dp(10));
        LinearLayout.LayoutParams sp = new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f);
        sp.setMarginEnd(dp(8));
        etSearch.setLayoutParams(sp);
        etSearch.addTextChangedListener(new TextWatcher() {
            public void beforeTextChanged(CharSequence s, int start, int count, int after) {}
            public void onTextChanged(CharSequence s, int start, int before, int count) {}
            public void afterTextChanged(Editable s) {
                currentFilter = s.toString().trim().toLowerCase();
                applyFilter();
            }
        });

        // Sort toggle
        Button btnSort = new Button(this);
        btnSort.setText("🕐 أحدث");
        btnSort.setBackgroundColor(COLOR_BTN);
        btnSort.setTextColor(COLOR_MUTED);
        btnSort.setTextSize(11);
        btnSort.setPadding(dp(10), dp(6), dp(10), dp(6));
        btnSort.setOnClickListener(v -> {
            sortByNewest = !sortByNewest;
            btnSort.setText(sortByNewest ? "🕐 أحدث" : "🕐 أقدم");
            applyFilter();
        });

        bar.addView(etSearch);
        bar.addView(btnSort);
        return bar;
    }

    // ═══════════════════════════════════════════════════
    // Data loading + filtering
    // ═══════════════════════════════════════════════════

    private void loadData() {
        allSessions = backupManager.getAllSessions();
        applyFilter();
    }

    private void applyFilter() {
        filteredList = allSessions.stream()
            .filter(s -> currentFilter.isEmpty()
                || s.fileName.toLowerCase().contains(currentFilter))
            .sorted((a, b) -> sortByNewest
                ? b.createdAt.compareTo(a.createdAt)
                : a.createdAt.compareTo(b.createdAt))
            .collect(Collectors.toList());

        adapter.notifyDataSetChanged();
        updateStats();
    }

    private void updateStats() {
        TextView tv = findViewById(android.R.id.custom);
        // نستخدم tag بدل id لأننا ما عندنا R.id
        View root = getWindow().getDecorView().findViewWithTag("tvStats");
        if (root instanceof TextView) {
            int total    = filteredList.size();
            int versions = filteredList.stream().mapToInt(s -> s.versions.size()).sum();
            ((TextView) root).setText(total + " ملف  ·  " + versions + " نسخة");
        }
    }

    // ═══════════════════════════════════════════════════
    // RecyclerView Adapter
    // ═══════════════════════════════════════════════════

    private class SessionAdapter extends RecyclerView.Adapter<SessionAdapter.VH> {

        // أي cards مفتوحة (expanded)
        private final Set<String> expandedIds = new HashSet<>();

        @Override
        public VH onCreateViewHolder(ViewGroup parent, int viewType) {
            return new VH(buildCardLayout());
        }

        @Override
        public void onBindViewHolder(VH holder, int pos) {
            BackupManager.Session session = filteredList.get(pos);
            holder.bind(session, expandedIds.contains(session.sessionId));
        }

        @Override public int getItemCount() { return filteredList.size(); }

        class VH extends RecyclerView.ViewHolder {
            LinearLayout card;
            TextView tvFile, tvDate, tvStats, tvVersions;
            Button btnExpand, btnExport, btnRestore, btnDelete;

            VH(LinearLayout v) {
                super(v);
                card       = v;
                tvFile     = v.findViewWithTag("tvFile");
                tvDate     = v.findViewWithTag("tvDate");
                tvStats    = v.findViewWithTag("tvStats");
                tvVersions = v.findViewWithTag("tvVersions");
                btnExpand  = v.findViewWithTag("btnExpand");
                btnExport  = v.findViewWithTag("btnExport");
                btnRestore = v.findViewWithTag("btnRestore");
                btnDelete  = v.findViewWithTag("btnDelete");
            }

            void bind(BackupManager.Session session, boolean expanded) {
                int approved = (int) session.versions.stream().filter(v -> v.approved).count();
                int rejected = session.versions.size() - approved;

                tvFile.setText("📄 " + session.fileName);
                tvDate.setText("🕐 " + session.createdAt);
                tvStats.setText("✅ " + approved + "  ❌ " + rejected);

                // Versions list — expand/collapse
                tvVersions.setVisibility(expanded ? View.VISIBLE : View.GONE);
                btnExpand.setText(expanded ? "▲ إخفاء النسخ" : "▼ عرض النسخ (" + session.versions.size() + ")");

                if (expanded) {
                    StringBuilder sb = new StringBuilder();
                    for (BackupManager.Version v : session.versions) {
                        sb.append(v.approved ? "✅ " : "❌ ")
                          .append(v.functionName).append("()")
                          .append("  ").append(v.timestamp).append("\n");
                    }
                    tvVersions.setText(sb.toString().trim());
                }

                btnExpand.setOnClickListener(v -> {
                    if (expandedIds.contains(session.sessionId)) expandedIds.remove(session.sessionId);
                    else expandedIds.add(session.sessionId);
                    notifyItemChanged(getAdapterPosition());
                });

                btnExport.setOnClickListener(v -> showExportDialog(session));

                btnRestore.setOnClickListener(v -> showConfirmDialog(
                    "استرجاع الكود الأصلي",
                    "هل تريد الرجوع للكود قبل أي تعديل؟",
                    "استرجاع", () -> {
                        backupManager.restoreOriginal(session.sessionId);
                        showToast("✅ تم الاسترجاع");
                        loadData();
                    }
                ));

                btnDelete.setOnClickListener(v -> showConfirmDialog(
                    "حذف السجل",
                    "هل تريد حذف سجل \"" + session.fileName + "\"؟",
                    "حذف", () -> {
                        backupManager.deleteSession(session.sessionId);
                        showToast("تم الحذف");
                        loadData();
                    }
                ));
            }
        }
    }

    // ═══════════════════════════════════════════════════
    // Card Layout Builder
    // ═══════════════════════════════════════════════════

    private LinearLayout buildCardLayout() {
        LinearLayout card = new LinearLayout(this);
        card.setOrientation(LinearLayout.VERTICAL);
        card.setBackgroundColor(COLOR_CARD);
        card.setPadding(dp(20), dp(20), dp(20), dp(16));
        LinearLayout.LayoutParams cp = new LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        cp.setMargins(0, 0, 0, dp(12));
        card.setLayoutParams(cp);

        card.addView(makeText("tvFile",    0xFFE6EDF3, 15, dp(0), dp(0), dp(0), dp(6)));
        card.addView(makeText("tvDate",    COLOR_MUTED, 12, dp(0), dp(0), dp(0), dp(6)));
        card.addView(makeText("tvStats",   COLOR_ACCENT, 13, dp(0), dp(0), dp(0), dp(12)));

        // divider
        View div = new View(this);
        div.setBackgroundColor(COLOR_DIVIDER);
        div.setLayoutParams(new LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT, dp(1)));
        card.addView(div);

        // versions (hidden by default)
        TextView tvVersions = makeText("tvVersions", COLOR_MUTED, 11, dp(0), dp(12), dp(0), dp(8));
        tvVersions.setVisibility(View.GONE);
        card.addView(tvVersions);

        card.addView(makeBtn("btnExpand",  "▼ عرض النسخ",           COLOR_BTN, COLOR_ACCENT));
        card.addView(makeBtn("btnExport",  "↑ تصدير هذا السجل",     COLOR_BTN, COLOR_APPROVED));
        card.addView(makeBtn("btnRestore", "↩ استرجاع الكود الأصلي", COLOR_BTN, COLOR_WARN));
        card.addView(makeBtn("btnDelete",  "🗑 حذف هذا السجل",       COLOR_BTN, COLOR_DANGER));

        return card;
    }

    // ═══════════════════════════════════════════════════
    // Export — كل السجلات
    // ═══════════════════════════════════════════════════

    private void showExportDialog() {
        new AlertDialog.Builder(this)
            .setTitle("تصدير السجلات")
            .setMessage("اختر صيغة التصدير لـ " + filteredList.size() + " سجل")
            .setPositiveButton("JSON", (d, w) -> exportAll("json"))
            .setNeutralButton("CSV",  (d, w) -> exportAll("csv"))
            .setNegativeButton("إلغاء", null)
            .show();
    }

    // Export — سجل واحد
    private void showExportDialog(BackupManager.Session session) {
        new AlertDialog.Builder(this)
            .setTitle("تصدير: " + session.fileName)
            .setMessage("اختر صيغة التصدير")
            .setPositiveButton("JSON", (d, w) -> exportSession(session, "json"))
            .setNeutralButton("CSV",  (d, w) -> exportSession(session, "csv"))
            .setNegativeButton("إلغاء", null)
            .show();
    }

    // ── تصدير كل الـ filteredList ──
    private void exportAll(String format) {
        try {
            String content = format.equals("json")
                ? buildJsonAll(filteredList)
                : buildCsvAll(filteredList);
            String filename = "reality_engine_export_" + timestamp() + "." + format;
            shareFile(filename, content, format);
        } catch (Exception e) {
            showToast("❌ فشل التصدير: " + e.getMessage());
        }
    }

    // ── تصدير سجل واحد ──
    private void exportSession(BackupManager.Session session, String format) {
        try {
            String content = format.equals("json")
                ? buildJsonSession(session)
                : buildCsvSession(session);
            String filename = session.fileName.replaceAll("[^a-zA-Z0-9_]", "_")
                + "_" + timestamp() + "." + format;
            shareFile(filename, content, format);
        } catch (Exception e) {
            showToast("❌ فشل التصدير: " + e.getMessage());
        }
    }

    // ── JSON builders ──

    private String buildJsonAll(List<BackupManager.Session> sessions) throws Exception {
        JSONArray arr = new JSONArray();
        for (BackupManager.Session s : sessions) arr.put(sessionToJson(s));
        return new JSONObject()
            .put("exported_at", timestamp())
            .put("total", sessions.size())
            .put("sessions", arr)
            .toString(2);
    }

    private String buildJsonSession(BackupManager.Session s) throws Exception {
        return sessionToJson(s).toString(2);
    }

    private JSONObject sessionToJson(BackupManager.Session s) throws Exception {
        JSONArray versions = new JSONArray();
        for (BackupManager.Version v : s.versions) {
            versions.put(new JSONObject()
                .put("function",  v.functionName)
                .put("timestamp", v.timestamp)
                .put("approved",  v.approved));
        }
        int approved = (int) s.versions.stream().filter(v -> v.approved).count();
        return new JSONObject()
            .put("session_id",  s.sessionId)
            .put("file",        s.fileName)
            .put("created_at",  s.createdAt)
            .put("approved",    approved)
            .put("rejected",    s.versions.size() - approved)
            .put("versions",    versions);
    }

    // ── CSV builders ──

    private String buildCsvAll(List<BackupManager.Session> sessions) {
        StringBuilder sb = new StringBuilder();
        sb.append("session_id,file,created_at,function,timestamp,approved\n");
        for (BackupManager.Session s : sessions) sb.append(csvRows(s));
        return sb.toString();
    }

    private String buildCsvSession(BackupManager.Session s) {
        return "session_id,file,created_at,function,timestamp,approved\n" + csvRows(s);
    }

    private String csvRows(BackupManager.Session s) {
        StringBuilder sb = new StringBuilder();
        for (BackupManager.Version v : s.versions) {
            sb.append(csvEscape(s.sessionId)).append(",")
              .append(csvEscape(s.fileName)).append(",")
              .append(csvEscape(s.createdAt)).append(",")
              .append(csvEscape(v.functionName)).append(",")
              .append(csvEscape(v.timestamp)).append(",")
              .append(v.approved ? "1" : "0").append("\n");
        }
        // لو ما فيه versions — سجّل السطر الرئيسي فقط
        if (s.versions.isEmpty()) {
            sb.append(csvEscape(s.sessionId)).append(",")
              .append(csvEscape(s.fileName)).append(",")
              .append(csvEscape(s.createdAt)).append(",,,\n");
        }
        return sb.toString();
    }

    private String csvEscape(String val) {
        if (val == null) return "";
        if (val.contains(",") || val.contains("\"") || val.contains("\n"))
            return "\"" + val.replace("\"", "\"\"") + "\"";
        return val;
    }

    // ── Share via Android share sheet ──

    private void shareFile(String filename, String content, String format) throws IOException {
        File dir = new File(getCacheDir(), "exports");
        if (!dir.exists()) dir.mkdirs();
        File file = new File(dir, filename);

        try (FileWriter fw = new FileWriter(file)) { fw.write(content); }

        Uri uri = FileProvider.getUriForFile(
            this,
            getPackageName() + ".fileprovider",
            file
        );

        String mime = format.equals("json") ? "application/json" : "text/csv";
        Intent intent = new Intent(Intent.ACTION_SEND)
            .setType(mime)
            .putExtra(Intent.EXTRA_STREAM, uri)
            .putExtra(Intent.EXTRA_SUBJECT, filename)
            .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);

        startActivity(Intent.createChooser(intent, "تصدير عبر..."));
        showToast("✅ جاهز للمشاركة");
    }

    private String timestamp() {
        return new SimpleDateFormat("yyyyMMdd_HHmmss", Locale.US).format(new Date());
    }

    // ═══════════════════════════════════════════════════
    // Dialog helper — بدل تكرار AlertDialog
    // ═══════════════════════════════════════════════════

    private void showConfirmDialog(String title, String msg, String confirmLabel, Runnable onConfirm) {
        new AlertDialog.Builder(this)
            .setTitle(title)
            .setMessage(msg)
            .setPositiveButton(confirmLabel, (d, w) -> onConfirm.run())
            .setNegativeButton("إلغاء", null)
            .show();
    }

    private void showToast(String msg) {
        Toast.makeText(this, msg, Toast.LENGTH_SHORT).show();
    }

    // ═══════════════════════════════════════════════════
    // View factory helpers
    // ═══════════════════════════════════════════════════

    private TextView makeText(String tag, int color, float sizeSp,
                               int pL, int pT, int pR, int pB) {
        TextView tv = new TextView(this);
        tv.setTag(tag);
        tv.setTextColor(color);
        tv.setTextSize(TypedValue.COMPLEX_UNIT_SP, sizeSp);
        tv.setPadding(pL, pT, pR, pB);
        tv.setLayoutParams(new LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));
        return tv;
    }

    private Button makeBtn(String tag, String text, int bgColor, int textColor) {
        Button btn = new Button(this);
        btn.setTag(tag);
        btn.setText(text);
        btn.setBackgroundColor(bgColor);
        btn.setTextColor(textColor);
        btn.setTextSize(TypedValue.COMPLEX_UNIT_SP, 12);
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        lp.setMargins(0, dp(6), 0, 0);
        btn.setLayoutParams(lp);
        return btn;
    }

    // ═══════════════════════════════════════════════════
    // dp → px helper
    // ═══════════════════════════════════════════════════

    private int dp(int value) {
        return Math.round(TypedValue.applyDimension(
            TypedValue.COMPLEX_UNIT_DIP, value,
            getResources().getDisplayMetrics()));
    }
}
