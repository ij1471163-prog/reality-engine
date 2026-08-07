package com.naif.realityengine;

import android.app.AlertDialog;
import android.os.Bundle;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;
import android.widget.Button;
import android.widget.Toast;
import androidx.appcompat.app.AppCompatActivity;
import java.util.List;

public class HistoryActivity extends AppCompatActivity {

    private BackupManager backupManager;
    private LinearLayout llSessions;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        ScrollView scroll = new ScrollView(this);
        scroll.setBackgroundColor(0xFF0D1117);
        llSessions = new LinearLayout(this);
        llSessions.setOrientation(LinearLayout.VERTICAL);
        llSessions.setPadding(32, 32, 32, 32);
        scroll.addView(llSessions);
        setContentView(scroll);

        backupManager = new BackupManager(this);
        loadSessions();
    }

    private void loadSessions() {
        llSessions.removeAllViews();

        // Header
        TextView tvTitle = new TextView(this);
        tvTitle.setText("📋 السجل والنسخ الاحتياطية");
        tvTitle.setTextColor(0xFF58A6FF);
        tvTitle.setTextSize(20);
        tvTitle.setPadding(0, 0, 0, 32);
        llSessions.addView(tvTitle);

        // Back button
        Button btnBack = new Button(this);
        btnBack.setText("← رجوع");
        btnBack.setBackgroundColor(0xFF21262D);
        btnBack.setTextColor(0xFF8B949E);
        LinearLayout.LayoutParams bp = new LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.MATCH_PARENT, 120);
        bp.setMargins(0, 0, 0, 24);
        btnBack.setLayoutParams(bp);
        btnBack.setOnClickListener(v -> finish());
        llSessions.addView(btnBack);

        List<BackupManager.Session> sessions = backupManager.getAllSessions();

        if (sessions.isEmpty()) {
            TextView tvEmpty = new TextView(this);
            tvEmpty.setText("لا يوجد سجل بعد\n\nسيظهر هنا تاريخ جميع التعديلات بعد استخدام التطبيق.");
            tvEmpty.setTextColor(0xFF8B949E);
            tvEmpty.setTextSize(14);
            tvEmpty.setPadding(0, 40, 0, 0);
            llSessions.addView(tvEmpty);
            return;
        }

        for (BackupManager.Session session : sessions) {
            addSessionCard(session);
        }
    }

    private void addSessionCard(BackupManager.Session session) {
        LinearLayout card = new LinearLayout(this);
        card.setOrientation(LinearLayout.VERTICAL);
        card.setBackgroundColor(0xFF1C2128);
        card.setPadding(24, 24, 24, 24);
        LinearLayout.LayoutParams cp = new LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.MATCH_PARENT,
            LinearLayout.LayoutParams.WRAP_CONTENT);
        cp.setMargins(0, 0, 0, 16);
        card.setLayoutParams(cp);

        // File name
        TextView tvFile = new TextView(this);
        tvFile.setText("📄 " + session.fileName);
        tvFile.setTextColor(0xFFE6EDF3);
        tvFile.setTextSize(15);
        tvFile.setPadding(0, 0, 0, 8);
        card.addView(tvFile);

        // Date
        TextView tvDate = new TextView(this);
        tvDate.setText("🕐 " + session.createdAt);
        tvDate.setTextColor(0xFF8B949E);
        tvDate.setTextSize(12);
        tvDate.setPadding(0, 0, 0, 8);
        card.addView(tvDate);

        // Versions count
        int approved = (int) session.versions.stream().filter(v -> v.approved).count();
        int rejected = session.versions.size() - approved;
        TextView tvStats = new TextView(this);
        tvStats.setText("✅ موافق: " + approved + "  ❌ مرفوض: " + rejected);
        tvStats.setTextColor(0xFF58A6FF);
        tvStats.setTextSize(13);
        tvStats.setPadding(0, 0, 0, 16);
        card.addView(tvStats);

        // Versions list
        for (BackupManager.Version v : session.versions) {
            TextView tvV = new TextView(this);
            String icon = v.approved ? "✅" : "❌";
            tvV.setText(icon + " " + v.functionName + "() — " + v.timestamp);
            tvV.setTextColor(0xFF8B949E);
            tvV.setTextSize(11);
            tvV.setPadding(0, 4, 0, 4);
            card.addView(tvV);
        }

        // Restore button
        Button btnRestore = new Button(this);
        btnRestore.setText("↩ استرجاع الكود الأصلي");
        btnRestore.setBackgroundColor(0xFF21262D);
        btnRestore.setTextColor(0xFFD29922);
        LinearLayout.LayoutParams rp = new LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.MATCH_PARENT, 100);
        rp.setMargins(0, 8, 0, 0);
        btnRestore.setLayoutParams(rp);
        btnRestore.setOnClickListener(v -> {
            new AlertDialog.Builder(this)
                .setTitle("استرجاع الكود الأصلي")
                .setMessage("هل تريد الرجوع للكود قبل أي تعديل؟")
                .setPositiveButton("استرجاع", (d, w) -> {
                    backupManager.restoreOriginal(session.sessionId);
                    Toast.makeText(this, "✅ تم الاسترجاع", Toast.LENGTH_SHORT).show();
                    loadSessions();
                })
                .setNegativeButton("إلغاء", null)
                .show();
        });
        card.addView(btnRestore);

        // Delete button
        Button btnDelete = new Button(this);
        btnDelete.setText("🗑 حذف هذا السجل");
        btnDelete.setBackgroundColor(0xFF21262D);
        btnDelete.setTextColor(0xFFF85149);
        LinearLayout.LayoutParams dp = new LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.MATCH_PARENT, 100);
        dp.setMargins(0, 8, 0, 0);
        btnDelete.setLayoutParams(dp);
        btnDelete.setOnClickListener(v -> {
            new AlertDialog.Builder(this)
                .setTitle("حذف السجل")
                .setMessage("هل تريد حذف سجل \"" + session.fileName + "\"؟")
                .setPositiveButton("حذف", (d, w) -> {
                    backupManager.deleteSession(session.sessionId);
                    Toast.makeText(this, "تم الحذف", Toast.LENGTH_SHORT).show();
                    loadSessions();
                })
                .setNegativeButton("إلغاء", null)
                .show();
        });
        card.addView(btnDelete);

        llSessions.addView(card);
    }
}
