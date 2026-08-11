package com.naif.realityengine;

import java.util.*;
import java.util.regex.*;

public class LegalGuard {

    public enum Verdict { LEGAL, ILLEGAL, RESTRICTED }

    public static class Violation {
        public String category, description, evidence;
        public boolean critical;
        public Violation(String c, String d, String e, boolean cr) {
            category=c; description=d; evidence=e; critical=cr;
        }
    }

    public static class LegalResult {
        public Verdict verdict;
        public List<Violation> violations;
        public boolean blocked;
        public String userMessage;
        public LegalResult(Verdict v, List<Violation> vl) {
            verdict=v; violations=vl;
            blocked = v == Verdict.ILLEGAL;
            userMessage = blocked ? "هذا الملف محظور — يحتوي على محتوى غير قانوني"
                        : v == Verdict.RESTRICTED ? "تحذير — يحتوي على محتوى مقيد"
                        : "الملف مقبول";
        }
    }

    // ── Language detection ────────────────────────────────
    private static String detectLanguage(String code) {
        if (code.contains("package ") && code.contains("import android.")) return "java_android";
        if (code.contains("package ") && code.contains("public class "))   return "java";
        if (code.contains("import React") || code.contains("useState"))    return "jsx";
        if (code.contains("def ") && code.contains("import "))             return "python";
        if (code.contains("function ") || code.contains("const ") || code.contains("=>")) return "javascript";
        if (code.contains("<?php"))  return "php";
        if (code.contains("#include")) return "cpp";
        return "unknown";
    }

    // ── Context check: is this a string literal or comment? ──
    private static boolean isInStringOrComment(String code, int pos) {
        String before = code.substring(0, pos);
        // Check single-line comment
        int lastNewline = before.lastIndexOf('\n');
        String currentLine = before.substring(lastNewline + 1);
        if (currentLine.contains("//") || currentLine.trim().startsWith("#"))
            return true;
        // Rough string check
        long quotes = currentLine.chars().filter(c -> c == '"').count();
        return quotes % 2 != 0;
    }

    // ── Rules ─────────────────────────────────────────────
    // Format: {category, description, pattern, critical, skip_for_languages}
    private static final String[][] RULES = {
        // أسلحة حقيقية
        {"Weapons", "كود لتصنيع أسلحة أو متفجرات",
         "(?i)\\b(synthesize|manufacture|detonate|build).{0,30}(bomb|explosive|C4|TNT|TATP|weapon)",
         "true", ""},

        // مخدرات
        {"Narcotics", "كود لتصنيع مواد مخدرة",
         "(?i)\\b(synthesize|manufacture|cook).{0,30}(meth|fentanyl|heroin|cocaine|drug)",
         "true", ""},

        // تصيد حقيقي
        {"Phishing", "صفحة تصيد أو سرقة بيانات",
         "(?i)(fake.?login|credential.?harvest|phishing.?page|steal.?password)",
         "true", ""},

        // keylogger حقيقي
        {"Keylogger", "كود لتسجيل مدخلات المستخدم خفية",
         "(?i)(keylog|keystroke.capture|hook.keyboard).{0,50}(send|upload|exfil)",
         "true", "java_android,java"},

        // malware صريح
        {"Malware", "كود لإنشاء برمجيات خبيثة صريحة",
         "(?i)(create|build|write).{0,20}(ransomware|rootkit|botnet|trojan.payload)",
         "true", ""},

        // اختراق بنية تحتية
        {"Infrastructure", "استهداف بنية تحتية حيوية",
         "(?i)(attack|exploit|compromise).{0,30}(power.grid|water.supply|hospital.system)",
         "true", ""},

        // CSAM
        {"CSAM", "محتوى يستغل الأطفال",
         "(?i)(child.{0,10}(porn|abuse|exploit)|CSAM|minor.{0,10}sexual)",
         "true", ""},
    };

    // ── Main check ────────────────────────────────────────
    public static LegalResult check(String code) {
        List<Violation> violations = new ArrayList<>();
        String lang = detectLanguage(code);

        // Android/Java code — تمريره مباشرة بعد فحص خفيف
        boolean isAndroid = lang.equals("java_android") || lang.equals("java");

        for (String[] rule : RULES) {
            String skipLangs = rule[4];

            // تخطي إذا اللغة مستثناة
            if (!skipLangs.isEmpty()) {
                boolean skip = false;
                for (String sl : skipLangs.split(",")) {
                    if (lang.equals(sl.trim())) { skip = true; break; }
                }
                if (skip) continue;
            }

            Pattern p = Pattern.compile(rule[2], Pattern.DOTALL);
            Matcher m = p.matcher(code);

            while (m.find()) {
                // تجاهل لو داخل comment أو string
                if (isInStringOrComment(code, m.start())) continue;

                String evidence = m.group();
                if (evidence.length() > 100) evidence = evidence.substring(0, 100);

                violations.add(new Violation(
                    rule[0], rule[1], evidence,
                    Boolean.parseBoolean(rule[3])
                ));
                break;
            }
        }

        boolean hasCritical = violations.stream().anyMatch(v -> v.critical);
        Verdict verdict = hasCritical ? Verdict.ILLEGAL
                        : !violations.isEmpty() ? Verdict.RESTRICTED
                        : Verdict.LEGAL;

        return new LegalResult(verdict, violations);
    }
}
