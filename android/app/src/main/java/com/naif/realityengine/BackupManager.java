package com.naif.realityengine;

import android.content.Context;
import android.content.SharedPreferences;
import android.util.Log;

import androidx.security.crypto.EncryptedFile;
import androidx.security.crypto.MasterKey;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.io.OutputStreamWriter;
import java.security.GeneralSecurityException;
import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Comparator;
import java.util.Date;
import java.util.List;
import java.util.Locale;
import java.util.UUID;
import java.util.zip.GZIPInputStream;
import java.util.zip.GZIPOutputStream;
import java.util.zip.ZipEntry;
import java.util.zip.ZipInputStream;
import java.util.zip.ZipOutputStream;

import java.nio.charset.StandardCharsets;

/**
 * Persists AI-fix session/version history.
 *
 * Storage layout:
 *  - SharedPreferences: lightweight metadata only (ids, timestamps, function
 *    names, approval flags, safety scores).
 *  - filesDir/reality_backup/<sessionId>/...: the actual code text
 *    (originalCode / currentCode / before / after), each file gzip-compressed
 *    then AES-256-GCM encrypted via an Android Keystore-backed key
 *    (androidx.security.crypto). Compress-before-encrypt on purpose —
 *    encrypted bytes are high-entropy and won't compress afterward.
 *  - externalFilesDir/backups/backup_<ts>.zip: periodic exports of the above
 *    for disaster recovery (see exportBackup/restoreFromBackup).
 *
 * Gradle: implementation("androidx.security:security-crypto:1.1.0-alpha06")
 * Requires minSdk 23 (Keystore-backed AES key generation).
 *
 * Note on exported backups: the Keystore key never leaves the device, so an
 * exported zip is only restorable on the same device + app install (same
 * applicationId + signing config that owns the Keystore entry). This is a
 * disaster-recovery backup (uninstall/reinstall, storage wipe), not a
 * portable/shareable encrypted backup — reinstalling on another device or
 * after a factory reset makes the original key unrecoverable, and old
 * backups become unreadable by design (that's what makes it real
 * encryption, not just obfuscation).
 */
public class BackupManager {

    private static final String TAG = "BackupManager";

    private static final String PREFS_NAME   = "reality_backup";
    private static final String KEY_SESSIONS = "sessions";
    private static final String KEY_LAST_AUTO_BACKUP = "last_auto_backup_ms";
    private static final int    MAX_SESSIONS = 20;
    private static final int    MAX_VERSIONS = 50;
    private static final long   AUTO_BACKUP_INTERVAL_MS = 24L * 60 * 60 * 1000; // 24h
    private static final int    MAX_AUTO_BACKUPS = 5;

    private final Object lock = new Object();

    public static class Version {
        public String id;
        public String timestamp;
        public String functionName;
        public String description;
        public String before; // populated only when loaded via getSession()
        public String after;  // populated only when loaded via getSession()
        public boolean approved;
        public int safetyScore;
    }

    public static class Session {
        public String sessionId;
        public String createdAt;
        public String fileName;
        public String originalCode; // populated only when loaded via getSession()
        public String currentCode;  // populated only when loaded via getSession()
        public List<Version> versions = new ArrayList<>();
    }

    private final Context appContext;
    private final SharedPreferences prefs;
    private final File backupDir;
    private final MasterKey masterKey;

    public BackupManager(Context context) {
        this.appContext = context.getApplicationContext();
        this.prefs      = appContext.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
        this.backupDir  = new File(appContext.getFilesDir(), "reality_backup");
        try {
            this.masterKey = new MasterKey.Builder(appContext)
                    .setKeyScheme(MasterKey.KeyScheme.AES256_GCM)
                    .build();
        } catch (GeneralSecurityException | IOException e) {
            // Fail loudly: silently falling back to plaintext storage for code
            // backups is a worse outcome than crashing at construction time.
            throw new RuntimeException("BackupManager: failed to initialize encryption key", e);
        }
    }

    // ── Create session ────────────────────────────────────
    public Session createSession(String fileName, String originalCode) {
        synchronized (lock) {
            Session s      = new Session();
            s.sessionId    = newId("session");
            s.createdAt    = now();
            s.fileName     = fileName;
            s.originalCode = originalCode;
            s.currentCode  = originalCode;

            File dir = sessionDir(s.sessionId);
            boolean ok = writeFile(originalFile(dir), originalCode)
                    && writeFile(currentFile(dir), originalCode);
            if (!ok) {
                Log.e(TAG, "createSession: failed writing code files for " + s.sessionId);
                return null;
            }
            saveMetadata(s);
            maybeAutoBackup();
            return s;
        }
    }

    // ── Record version ────────────────────────────────────
    public boolean recordVersion(String sessionId, String functionName,
                                  String description, String before,
                                  String after, boolean approved, int safetyScore) {
        synchronized (lock) {
            List<Session> sessions = readMetadata();
            Session s = findById(sessions, sessionId);
            if (s == null) {
                Log.w(TAG, "recordVersion: unknown session " + sessionId);
                return false;
            }

            Version v      = new Version();
            v.id           = newId("v");
            v.timestamp    = now();
            v.functionName = functionName;
            v.description  = description;
            v.approved     = approved;
            v.safetyScore  = safetyScore;

            File dir = sessionDir(sessionId);
            if (!writeFile(beforeFile(dir, v.id), before) || !writeFile(afterFile(dir, v.id), after)) {
                Log.e(TAG, "recordVersion: failed writing version files for " + sessionId + "/" + v.id);
                return false;
            }

            s.versions.add(v);
            if (approved) {
                if (!writeFile(currentFile(dir), after)) {
                    Log.e(TAG, "recordVersion: failed updating currentCode for " + sessionId);
                    // metadata + version files still valid; caller can retry the approve step
                }
            }

            // Keep last MAX_VERSIONS — delete files for any versions we drop.
            if (s.versions.size() > MAX_VERSIONS) {
                int dropCount = s.versions.size() - MAX_VERSIONS;
                for (int i = 0; i < dropCount; i++) {
                    Version dropped = s.versions.get(i);
                    beforeFile(dir, dropped.id).delete();
                    afterFile(dir, dropped.id).delete();
                }
                s.versions = new ArrayList<>(s.versions.subList(dropCount, s.versions.size()));
            }

            writeMetadata(reorderToFront(sessions, s));
            maybeAutoBackup();
            return true;
        }
    }

    // ── Restore to original ───────────────────────────────
    public String restoreOriginal(String sessionId) {
        synchronized (lock) {
            File dir = sessionDir(sessionId);
            String original = readFile(originalFile(dir));
            if (original == null) {
                Log.w(TAG, "restoreOriginal: no original code found for " + sessionId);
                return null;
            }
            if (!writeFile(currentFile(dir), original)) {
                Log.e(TAG, "restoreOriginal: failed writing currentCode for " + sessionId);
                return null;
            }
            return original;
        }
    }

    // ── Get all sessions (lightweight — no code text, cheap for list UIs) ──
    public List<Session> getAllSessions() {
        synchronized (lock) {
            return readMetadata();
        }
    }

    // ── Get single session, fully loaded with code text ───
    public Session getSession(String sessionId) {
        synchronized (lock) {
            Session s = findById(readMetadata(), sessionId);
            if (s == null) return null;

            File dir = sessionDir(sessionId);
            s.originalCode = readFile(originalFile(dir));
            s.currentCode  = readFile(currentFile(dir));
            for (Version v : s.versions) {
                v.before = readFile(beforeFile(dir, v.id));
                v.after  = readFile(afterFile(dir, v.id));
            }
            return s;
        }
    }

    // ── Delete session ────────────────────────────────────
    public void deleteSession(String sessionId) {
        synchronized (lock) {
            List<Session> sessions = readMetadata();
            sessions.removeIf(s -> s.sessionId.equals(sessionId));
            writeMetadata(sessions);
            deleteRecursive(sessionDir(sessionId));
        }
    }

    // ── Manual export / restore ────────────────────────────
    /** Zips metadata + all encrypted session files. Returns the zip file, or null on failure. */
    public File exportBackup() {
        synchronized (lock) {
            return exportBackupInternal();
        }
    }

    /**
     * Restores metadata + session files from a zip produced by exportBackup().
     * Only usable on the device/app install that created it (see class javadoc).
     */
    public boolean restoreFromBackup(File zipFile) {
        synchronized (lock) {
            if (zipFile == null || !zipFile.exists()) return false;
            try (ZipInputStream zis = new ZipInputStream(new FileInputStream(zipFile))) {
                String metadataJson = null;
                ZipEntry entry;
                while ((entry = zis.getNextEntry()) != null) {
                    if (entry.getName().equals("metadata.json")) {
                        metadataJson = readAllUtf8(zis);
                    } else if (!entry.isDirectory() && entry.getName().startsWith("data/")) {
                        File target = new File(backupDir, entry.getName().substring("data/".length()));
                        File parent = target.getParentFile();
                        if (parent != null) parent.mkdirs();
                        try (FileOutputStream fos = new FileOutputStream(target)) {
                            byte[] buf = new byte[8192];
                            int n;
                            while ((n = zis.read(buf)) != -1) fos.write(buf, 0, n);
                        }
                    }
                    zis.closeEntry();
                }
                if (metadataJson == null) {
                    Log.e(TAG, "restoreFromBackup: zip has no metadata.json");
                    return false;
                }
                boolean ok = prefs.edit().putString(KEY_SESSIONS, metadataJson).commit();
                if (!ok) Log.e(TAG, "restoreFromBackup: failed writing restored metadata");
                return ok;
            } catch (IOException e) {
                Log.e(TAG, "restoreFromBackup: failed", e);
                return false;
            }
        }
    }

    // ── Auto backup ─────────────────────────────────────────
    private void maybeAutoBackup() {
        long last = prefs.getLong(KEY_LAST_AUTO_BACKUP, 0);
        if (System.currentTimeMillis() - last < AUTO_BACKUP_INTERVAL_MS) return;
        File exported = exportBackupInternal();
        if (exported != null) {
            prefs.edit().putLong(KEY_LAST_AUTO_BACKUP, System.currentTimeMillis()).apply();
            pruneOldAutoBackups();
        }
    }

    private File exportBackupInternal() {
        File exportDir = new File(appContext.getExternalFilesDir(null), "backups");
        if (!exportDir.exists() && !exportDir.mkdirs()) {
            Log.e(TAG, "exportBackup: could not create export dir " + exportDir);
            return null;
        }
        File zipFile = new File(exportDir, "backup_" + System.currentTimeMillis() + ".zip");
        try (FileOutputStream fos = new FileOutputStream(zipFile);
             ZipOutputStream zos = new ZipOutputStream(fos)) {
            zos.putNextEntry(new ZipEntry("metadata.json"));
            zos.write(prefs.getString(KEY_SESSIONS, "[]").getBytes(StandardCharsets.UTF_8));
            zos.closeEntry();
            zipDirectory(backupDir, backupDir, zos);
            return zipFile;
        } catch (IOException e) {
            Log.e(TAG, "exportBackup: failed", e);
            zipFile.delete();
            return null;
        }
    }

    private void zipDirectory(File root, File current, ZipOutputStream zos) throws IOException {
        File[] children = current.listFiles();
        if (children == null) return;
        for (File f : children) {
            String relPath = root.toURI().relativize(f.toURI()).getPath();
            if (f.isDirectory()) {
                zipDirectory(root, f, zos);
            } else {
                zos.putNextEntry(new ZipEntry("data/" + relPath));
                try (FileInputStream fis = new FileInputStream(f)) {
                    byte[] buf = new byte[8192];
                    int n;
                    while ((n = fis.read(buf)) != -1) zos.write(buf, 0, n);
                }
                zos.closeEntry();
            }
        }
    }

    private void pruneOldAutoBackups() {
        File exportDir = new File(appContext.getExternalFilesDir(null), "backups");
        File[] backups = exportDir.listFiles((d, name) -> name.startsWith("backup_") && name.endsWith(".zip"));
        if (backups == null || backups.length <= MAX_AUTO_BACKUPS) return;
        Arrays.sort(backups, Comparator.comparingLong(File::lastModified));
        int toDelete = backups.length - MAX_AUTO_BACKUPS;
        for (int i = 0; i < toDelete; i++) backups[i].delete();
    }

    // ── Metadata read/write ────────────────────────────────
    private List<Session> readMetadata() {
        List<Session> result = new ArrayList<>();
        try {
            String raw = prefs.getString(KEY_SESSIONS, "[]");
            JSONArray arr = new JSONArray(raw);
            for (int i = arr.length() - 1; i >= 0; i--)
                result.add(jsonToSession(arr.getJSONObject(i)));
        } catch (Exception e) {
            Log.e(TAG, "readMetadata: corrupted sessions prefs, returning empty list", e);
        }
        return result;
    }

    private void saveMetadata(Session session) {
        List<Session> sessions = readMetadata();
        writeMetadata(reorderToFront(sessions, session));
    }

    private List<Session> reorderToFront(List<Session> sessions, Session s) {
        sessions.removeIf(x -> x.sessionId.equals(s.sessionId));
        sessions.add(0, s);
        return sessions;
    }

    private void writeMetadata(List<Session> sessions) {
        // Trim oldest sessions past the cap and clean up their files on disk.
        while (sessions.size() > MAX_SESSIONS) {
            Session dropped = sessions.remove(sessions.size() - 1);
            deleteRecursive(sessionDir(dropped.sessionId));
        }
        try {
            JSONArray arr = new JSONArray();
            for (Session s : sessions) arr.put(sessionToJson(s));
            boolean ok = prefs.edit().putString(KEY_SESSIONS, arr.toString()).commit();
            if (!ok) Log.e(TAG, "writeMetadata: SharedPreferences commit failed");
        } catch (Exception e) {
            Log.e(TAG, "writeMetadata: failed serializing sessions", e);
        }
    }

    private Session findById(List<Session> sessions, String sessionId) {
        for (Session s : sessions)
            if (s.sessionId.equals(sessionId)) return s;
        return null;
    }

    private JSONObject sessionToJson(Session s) throws Exception {
        JSONObject obj = new JSONObject();
        obj.put("sessionId", s.sessionId);
        obj.put("createdAt", s.createdAt);
        obj.put("fileName", s.fileName);
        JSONArray versions = new JSONArray();
        for (Version v : s.versions) {
            JSONObject vObj = new JSONObject();
            vObj.put("id", v.id);
            vObj.put("timestamp", v.timestamp);
            vObj.put("functionName", v.functionName);
            vObj.put("description", v.description);
            vObj.put("approved", v.approved);
            vObj.put("safetyScore", v.safetyScore);
            versions.put(vObj);
        }
        obj.put("versions", versions);
        return obj;
    }

    private Session jsonToSession(JSONObject obj) throws Exception {
        Session s     = new Session();
        s.sessionId   = obj.getString("sessionId");
        s.createdAt   = obj.getString("createdAt");
        s.fileName    = obj.getString("fileName");
        JSONArray arr = obj.getJSONArray("versions");
        for (int i = 0; i < arr.length(); i++) {
            JSONObject vObj = arr.getJSONObject(i);
            Version v      = new Version();
            v.id           = vObj.getString("id");
            v.timestamp    = vObj.getString("timestamp");
            v.functionName = vObj.getString("functionName");
            v.description  = vObj.getString("description");
            v.approved     = vObj.getBoolean("approved");
            v.safetyScore  = vObj.getInt("safetyScore");
            s.versions.add(v);
        }
        return s;
    }

    // ── File-backed, compressed + encrypted content storage ───
    private File sessionDir(String sessionId) { return new File(backupDir, sessionId); }
    private File originalFile(File dir) { return new File(dir, "original.enc"); }
    private File currentFile(File dir) { return new File(dir, "current.enc"); }
    private File beforeFile(File dir, String versionId) { return new File(new File(dir, "versions"), versionId + "_before.enc"); }
    private File afterFile(File dir, String versionId) { return new File(new File(dir, "versions"), versionId + "_after.enc"); }

    private boolean writeFile(File file, String content) {
        if (content == null) content = "";
        File parent = file.getParentFile();
        if (parent != null && !parent.exists() && !parent.mkdirs()) {
            Log.e(TAG, "writeFile: could not create directory " + parent);
            return false;
        }
        // EncryptedFile refuses to write over an existing file — this path is also
        // hit when overwriting current.enc on approve/restore, so clear it first.
        if (file.exists() && !file.delete()) {
            Log.e(TAG, "writeFile: could not clear existing file " + file);
            return false;
        }
        try {
            EncryptedFile ef = new EncryptedFile.Builder(
                    appContext, file, masterKey, EncryptedFile.FileEncryptionScheme.AES256_GCM_HKDF_4KB).build();
            try (OutputStream os = ef.openFileOutput();
                 GZIPOutputStream gz = new GZIPOutputStream(os);
                 OutputStreamWriter w = new OutputStreamWriter(gz, StandardCharsets.UTF_8)) {
                w.write(content);
            }
            return true;
        } catch (GeneralSecurityException | IOException e) {
            Log.e(TAG, "writeFile: failed writing " + file, e);
            return false;
        }
    }

    private String readFile(File file) {
        if (!file.exists()) return null;
        try {
            EncryptedFile ef = new EncryptedFile.Builder(
                    appContext, file, masterKey, EncryptedFile.FileEncryptionScheme.AES256_GCM_HKDF_4KB).build();
            try (InputStream is = ef.openFileInput();
                 GZIPInputStream gz = new GZIPInputStream(is);
                 InputStreamReader r = new InputStreamReader(gz, StandardCharsets.UTF_8)) {
                StringBuilder sb = new StringBuilder();
                char[] buf = new char[8192];
                int n;
                while ((n = r.read(buf)) != -1) sb.append(buf, 0, n);
                return sb.toString();
            }
        } catch (GeneralSecurityException | IOException e) {
            Log.e(TAG, "readFile: failed reading " + file, e);
            return null;
        }
    }

    private String readAllUtf8(InputStream is) throws IOException {
        ByteArrayOutputStream bos = new ByteArrayOutputStream();
        byte[] buf = new byte[8192];
        int n;
        while ((n = is.read(buf)) != -1) bos.write(buf, 0, n);
        return bos.toString("UTF-8");
    }

    private void deleteRecursive(File file) {
        if (file == null || !file.exists()) return;
        File[] children = file.listFiles();
        if (children != null) for (File c : children) deleteRecursive(c);
        if (!file.delete()) Log.w(TAG, "deleteRecursive: failed to delete " + file);
    }

    private String newId(String prefix) {
        return prefix + "_" + System.currentTimeMillis() + "_" + UUID.randomUUID().toString().substring(0, 8);
    }

    private String now() {
        return new SimpleDateFormat("yyyy-MM-dd HH:mm:ss", Locale.getDefault()).format(new Date());
    }
}
