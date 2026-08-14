package com.naif.realityengine;

import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

public class CodeApplier {

    /**
     * يستبدل أول مطابقة لـ oldBody بـ newBody.
     * يرجع null إذا لم يجد المطابقة.
     */
    public static String replaceFunction(String code, String oldBody, String newBody) {
        if (code == null || oldBody == null || newBody == null) return null;
        if (!code.contains(oldBody.trim())) return null;

        // نحاول مطابقة دقيقة أولاً
        String result = code.replaceFirst(Pattern.quote(oldBody), Matcher.quoteReplacement(newBody));
        if (!result.equals(code)) return result;

        // fallback: نحاول بـ trim
        String trimmedOld = oldBody.trim();
        int idx = code.indexOf(trimmedOld);
        if (idx >= 0) {
            return code.substring(0, idx) + newBody + code.substring(idx + trimmedOld.length());
        }
        return null;
    }

    public static boolean writeFile(File file, String content) {
        try (FileOutputStream fos = new FileOutputStream(file)) {
            fos.write(content.getBytes(StandardCharsets.UTF_8));
            return true;
        } catch (IOException e) {
            return false;
        }
    }

    public static boolean writeFile(String path, String content) {
        return writeFile(new File(path), content);
    }
}

