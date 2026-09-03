package com.naif.realityengine;

import android.os.Handler;
import android.os.Looper;
import java.io.*;
import java.net.*;
import java.util.*;
import org.json.*;

/**
 * GitHubScanner — يقرأ ملفات Repository عبر GitHub API
 * Fine-grained PAT (read-only) — لا ينفذ أي كود — لا يخزن التوكن
 */
public class GitHubScanner {

    private static final String API_BASE       = "https://api.github.com";
    private static final int    MAX_FILES      = 20;
    private static final long   MAX_FILE_SIZE  = 500  * 1024L;  // 500KB
    private static final long   MAX_TOTAL_SIZE = 10   * 1024L * 1024L; // 10MB
    private static final int    TIMEOUT_MS     = 15000;

    private static final List<String> ALLOWED_EXTS = Arrays.asList(
        ".py", ".js", ".ts", ".java", ".html", ".jsx", ".tsx", ".kt", ".php"
    );

    // ─── Callback ─────────────────────────────────────────

    public interface ScanCallback {
        void onProgress(String message);
        void onComplete(List<ScannedFile> files);
        void onError(String error);
    }

    public static class ScannedFile {
        public String name, path, content, ext;
        public ScannedFile(String name, String path, String content) {
            this.name    = name;
            this.path    = path;
            this.content = content;
            this.ext     = name.contains(".") ?
                name.substring(name.lastIndexOf('.')).toLowerCase() : "";
        }
    }

    // ─── Main Entry ───────────────────────────────────────

    public static void scanRepository(
            String token,
            String owner,
            String repo,
            String branch,
            ScanCallback callback) {

        if (token == null || token.trim().isEmpty()) {
            callback.onError("التوكن مطلوب"); return;
        }
        if (owner == null || owner.isEmpty() || repo == null || repo.isEmpty()) {
            callback.onError("اسم المستودع مطلوب"); return;
        }

        final String safeOwner  = sanitizeOwnerRepo(owner);
        final String safeRepo   = sanitizeOwnerRepo(repo);
        final String safeBranch = sanitizeBranch(branch != null ? branch : "main");

        new Thread(() -> {
            try {
                callback.onProgress("جاري الاتصال بـ GitHub...");

                // تحقق من المستودع
                String repoInfo = apiGet(token,
                    API_BASE + "/repos/" + safeOwner + "/" + safeRepo);
                if (repoInfo == null) {
                    postError(callback, "المستودع غير موجود أو التوكن غير صالح");
                    return;
                }

                // جيب قائمة الملفات
                callback.onProgress("جاري جلب قائمة الملفات (أول " + MAX_FILES + " ملف)...");
                String treeUrl  = API_BASE + "/repos/" + safeOwner + "/" + safeRepo
                    + "/git/trees/" + safeBranch + "?recursive=1";
                String treeJson = apiGet(token, treeUrl);
                if (treeJson == null) {
                    postError(callback, "فشل في جلب ملفات المستودع"); return;
                }

                JSONObject tree  = new JSONObject(treeJson);
                JSONArray  items = tree.optJSONArray("tree");
                if (items == null || items.length() == 0) {
                    postError(callback, "المستودع فارغ"); return;
                }

                // فلتر الملفات المسموحة مع حد الحجم
                List<String> filePaths = new ArrayList<>();
                long totalSize = 0;

                for (int i = 0; i < items.length(); i++) {
                    if (filePaths.size() >= MAX_FILES) break;
                    JSONObject item = items.getJSONObject(i);
                    if (!"blob".equals(item.optString("type"))) continue;
                    String path = item.optString("path", "");
                    long   size = item.optLong("size", 0);
                    if (size > MAX_FILE_SIZE)          continue;
                    if (totalSize + size > MAX_TOTAL_SIZE) break;
                    if (!isAllowedExt(path))           continue;
                    if (hasPathTraversal(path))        continue;
                    filePaths.add(path);
                    totalSize += size;
                }

                if (filePaths.isEmpty()) {
                    postError(callback, "لا توجد ملفات مدعومة في المستودع"); return;
                }

                // حمّل محتوى الملفات
                List<ScannedFile> result = new ArrayList<>();
                for (int i = 0; i < filePaths.size(); i++) {
                    String path = filePaths.get(i);
                    callback.onProgress("تحميل " + (i+1) + "/" + filePaths.size()
                        + ": " + getFileName(path));

                    String url      = API_BASE + "/repos/" + safeOwner + "/" + safeRepo
                        + "/contents/" + path + "?ref=" + safeBranch;
                    String fileJson = apiGet(token, url);
                    if (fileJson == null) continue;

                    JSONObject obj      = new JSONObject(fileJson);
                    String     encoding = obj.optString("encoding", "");
                    String     b64      = obj.optString("content", "").replace("\n", "");

                    if (!"base64".equals(encoding) || b64.isEmpty()) continue;

                    String decoded = decodeBase64(b64);
                    if (decoded == null || decoded.isEmpty()) continue;

                    result.add(new ScannedFile(getFileName(path), path, decoded));
                }

                if (result.isEmpty()) {
                    postError(callback, "لم يتم تحميل أي ملف"); return;
                }

                final List<ScannedFile> files = result;
                new Handler(Looper.getMainLooper()).post(() -> callback.onComplete(files));

            } catch (Exception e) {
                postError(callback, "خطأ في الاتصال");
            }
        }).start();
    }

    // ─── HTTP ─────────────────────────────────────────────

    private static String apiGet(String token, String urlStr) {
        HttpURLConnection conn = null;
        try {
            URL url = new URL(urlStr);
            conn = (HttpURLConnection) url.openConnection();
            conn.setRequestMethod("GET");
            conn.setConnectTimeout(TIMEOUT_MS);
            conn.setReadTimeout(TIMEOUT_MS);
            conn.setRequestProperty("Authorization", "Bearer " + token);
            conn.setRequestProperty("Accept", "application/vnd.github+json");
            conn.setRequestProperty("X-GitHub-Api-Version", "2022-11-28");
            conn.setRequestProperty("User-Agent", "RealityEngine");
            int code = conn.getResponseCode();
            if (code != 200) return null;
            BufferedReader br = new BufferedReader(
                new InputStreamReader(conn.getInputStream(), "UTF-8"));
            StringBuilder sb = new StringBuilder();
            String line;
            while ((line = br.readLine()) != null) sb.append(line);
            br.close();
            return sb.toString();
        } catch (Exception e) { return null; }
        finally { if (conn != null) conn.disconnect(); }
    }

    // ─── Helpers ──────────────────────────────────────────

    // owner/repo: أحرف وأرقام و . - _
    private static String sanitizeOwnerRepo(String s) {
        return s.trim().replaceAll("[^a-zA-Z0-9._\\-]", "");
    }

    // branch يسمح بـ / للـ feature branches
    private static String sanitizeBranch(String s) {
        return s.trim().replaceAll("[^a-zA-Z0-9._\\-/]", "");
    }

    private static boolean isAllowedExt(String path) {
        String lower = path.toLowerCase();
        for (String ext : ALLOWED_EXTS) if (lower.endsWith(ext)) return true;
        return false;
    }

    private static boolean hasPathTraversal(String path) {
        return path.contains("..") || path.startsWith("/") || path.contains("\\");
    }

    private static String getFileName(String path) {
        int i = path.lastIndexOf('/');
        return i >= 0 ? path.substring(i + 1) : path;
    }

    private static String decodeBase64(String encoded) {
        try {
            byte[] bytes = android.util.Base64.decode(encoded, android.util.Base64.DEFAULT);
            return new String(bytes, "UTF-8");
        } catch (Exception e) { return null; }
    }

    private static void postError(ScanCallback cb, String msg) {
        new Handler(Looper.getMainLooper()).post(() -> cb.onError(msg));
    }
}
}
}
