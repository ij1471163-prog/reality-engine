package com.naif.realityengine;

import android.content.Context;
import android.content.SharedPreferences;
import org.json.JSONArray;
import org.json.JSONObject;
import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.Date;
import java.util.List;
import java.util.Locale;

public class BackupManager {

    private static final String PREFS_NAME    = "reality_backup";
    private static final String KEY_SESSIONS  = "sessions";
    private static final int    MAX_SESSIONS  = 20;

    public static class Version {
        public String id;
        public String timestamp;
        public String functionName;
        public String description;
        public String before;
        public String after;
        public boolean approved;
        public int safetyScore;
    }

    public static class Session {
        public String sessionId;
        public String createdAt;
        public String fileName;
        public String originalCode;
        public String currentCode;
        public List<Version> versions = new ArrayList<>();
    }

    private final SharedPreferences prefs;

    public BackupManager(Context context) {
        this.prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
    }

    // ── Create session ────────────────────────────────────
    public Session createSession(String fileName, String originalCode) {
        Session s       = new Session();
        s.sessionId     = "session_" + System.currentTimeMillis();
        s.createdAt     = now();
        s.fileName      = fileName;
        s.originalCode  = originalCode;
        s.currentCode   = originalCode;
        saveSession(s);
        return s;
    }

    // ── Record version ────────────────────────────────────
    public void recordVersion(String sessionId, String functionName,
                              String description, String before,
                              String after, boolean approved, int safetyScore) {
        Session s = getSession(sessionId);
        if (s == null) return;

        Version v      = new Version();
        v.id           = "v_" + System.currentTimeMillis();
        v.timestamp    = now();
        v.functionName = functionName;
        v.description  = description;
        v.before       = before;
        v.after        = after;
        v.approved     = approved;
        v.safetyScore  = safetyScore;

        s.versions.add(v);
        if (approved) s.currentCode = after;

        // Keep last 50 versions
        if (s.versions.size() > 50)
            s.versions = s.versions.subList(s.versions.size() - 50, s.versions.size());

        saveSession(s);
    }

    // ── Restore to original ───────────────────────────────
    public String restoreOriginal(String sessionId) {
        Session s = getSession(sessionId);
        if (s == null) return null;
        s.currentCode = s.originalCode;
        saveSession(s);
        return s.originalCode;
    }

    // ── Get all sessions ──────────────────────────────────
    public List<Session> getAllSessions() {
        List<Session> result = new ArrayList<>();
        try {
            String raw = prefs.getString(KEY_SESSIONS, "[]");
            JSONArray arr = new JSONArray(raw);
            for (int i = arr.length() - 1; i >= 0; i--)
                result.add(jsonToSession(arr.getJSONObject(i)));
        } catch (Exception ignored) {}
        return result;
    }

    // ── Get single session ────────────────────────────────
    public Session getSession(String sessionId) {
        for (Session s : getAllSessions())
            if (s.sessionId.equals(sessionId)) return s;
        return null;
    }

    // ── Delete session ────────────────────────────────────
    public void deleteSession(String sessionId) {
        List<Session> sessions = getAllSessions();
        sessions.removeIf(s -> s.sessionId.equals(sessionId));
        saveSessions(sessions);
    }

    // ── Private helpers ───────────────────────────────────
    private void saveSession(Session session) {
        List<Session> sessions = getAllSessions();
        sessions.removeIf(s -> s.sessionId.equals(session.sessionId));
        sessions.add(0, session);
        if (sessions.size() > MAX_SESSIONS)
            sessions = sessions.subList(0, MAX_SESSIONS);
        saveSessions(sessions);
    }

    private void saveSessions(List<Session> sessions) {
        try {
            JSONArray arr = new JSONArray();
            for (Session s : sessions) arr.put(sessionToJson(s));
            prefs.edit().putString(KEY_SESSIONS, arr.toString()).apply();
        } catch (Exception ignored) {}
    }

    private JSONObject sessionToJson(Session s) throws Exception {
        JSONObject obj = new JSONObject();
        obj.put("sessionId",    s.sessionId);
        obj.put("createdAt",    s.createdAt);
        obj.put("fileName",     s.fileName);
        obj.put("originalCode", s.originalCode);
        obj.put("currentCode",  s.currentCode);
        JSONArray versions = new JSONArray();
        for (Version v : s.versions) {
            JSONObject vObj = new JSONObject();
            vObj.put("id",           v.id);
            vObj.put("timestamp",    v.timestamp);
            vObj.put("functionName", v.functionName);
            vObj.put("description",  v.description);
            vObj.put("before",       v.before);
            vObj.put("after",        v.after);
            vObj.put("approved",     v.approved);
            vObj.put("safetyScore",  v.safetyScore);
            versions.put(vObj);
        }
        obj.put("versions", versions);
        return obj;
    }

    private Session jsonToSession(JSONObject obj) throws Exception {
        Session s       = new Session();
        s.sessionId     = obj.getString("sessionId");
        s.createdAt     = obj.getString("createdAt");
        s.fileName      = obj.getString("fileName");
        s.originalCode  = obj.getString("originalCode");
        s.currentCode   = obj.getString("currentCode");
        JSONArray arr   = obj.getJSONArray("versions");
        for (int i = 0; i < arr.length(); i++) {
            JSONObject vObj = arr.getJSONObject(i);
            Version v       = new Version();
            v.id            = vObj.getString("id");
            v.timestamp     = vObj.getString("timestamp");
            v.functionName  = vObj.getString("functionName");
            v.description   = vObj.getString("description");
            v.before        = vObj.getString("before");
            v.after         = vObj.getString("after");
            v.approved      = vObj.getBoolean("approved");
            v.safetyScore   = vObj.getInt("safetyScore");
            s.versions.add(v);
        }
        return s;
    }

    private String now() {
        return new SimpleDateFormat("yyyy-MM-dd HH:mm:ss", Locale.getDefault()).format(new Date());
    }
}
