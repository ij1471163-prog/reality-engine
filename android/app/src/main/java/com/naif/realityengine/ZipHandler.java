package com.naif.realityengine;

import android.content.Context;
import java.io.*;
import java.util.*;
import java.util.zip.*;

public class ZipHandler {

    public static class ZipFile {
        public String name;
        public String content;
        public String language;

        public ZipFile(String name, String content) {
            this.name = name;
            this.content = content;
            this.language = detectLanguage(name);
        }

        private String detectLanguage(String fileName) {
            if (fileName.endsWith(".py")) return "Python";
            if (fileName.endsWith(".js") || fileName.endsWith(".jsx")) return "JavaScript";
            if (fileName.endsWith(".java")) return "Java";
            if (fileName.endsWith(".html")) return "HTML";
            return "Unknown";
        }
    }

    public static class ZipResult {
        public List<ZipFile> files = new ArrayList<>();
        public List<String> skipped = new ArrayList<>();
        public String error = null;
    }

    private static final int MAX_FILES = 10;
    private static final long MAX_FILE_SIZE = 500 * 1024; // 500KB
    private static final Set<String> SUPPORTED = new HashSet<>(Arrays.asList(
        ".py", ".js", ".jsx", ".java", ".html", ".ts"
    ));

    public static ZipResult extract(InputStream zipStream) {
        ZipResult result = new ZipResult();
        try {
            ZipInputStream zis = new ZipInputStream(zipStream);
            ZipEntry entry;

            while ((entry = zis.getNextEntry()) != null) {
                if (entry.isDirectory()) continue;
                if (result.files.size() >= MAX_FILES) {
                    result.skipped.add(entry.getName() + " (تجاوز الحد)");
                    continue;
                }

                String name = getFileName(entry.getName());
                if (!isSupportedFile(name)) {
                    result.skipped.add(name + " (نوع غير مدعوم)");
                    continue;
                }

                byte[] bytes = readEntry(zis, MAX_FILE_SIZE);
                if (bytes == null) {
                    result.skipped.add(name + " (حجم كبير)");
                    continue;
                }

                String content = new String(bytes, "UTF-8");
                result.files.add(new ZipFile(name, content));
                zis.closeEntry();
            }
            zis.close();

        } catch (Exception e) {
            result.error = "خطأ في فتح الملف: " + e.getMessage();
        }
        return result;
    }

    private static byte[] readEntry(ZipInputStream zis, long maxSize) throws IOException {
        ByteArrayOutputStream baos = new ByteArrayOutputStream();
        byte[] buffer = new byte[4096];
        long total = 0;
        int len;
        while ((len = zis.read(buffer)) > 0) {
            total += len;
            if (total > maxSize) return null;
            baos.write(buffer, 0, len);
        }
        return baos.toByteArray();
    }

    private static boolean isSupportedFile(String name) {
        for (String ext : SUPPORTED) {
            if (name.toLowerCase().endsWith(ext)) return true;
        }
        return false;
    }

    private static String getFileName(String path) {
        int slash = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'));
        return slash >= 0 ? path.substring(slash + 1) : path;
    }
}
