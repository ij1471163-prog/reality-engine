package com.naif.realityengine;

import java.util.ArrayList;
import java.util.List;
import java.util.regex.Pattern;

public class LegalGuard {

    public enum Verdict { LEGAL, ILLEGAL, RESTRICTED }

    public static class Violation {
        public String category;
        public String description;
        public String evidence;
        public boolean critical;

        public Violation(String category, String description, String evidence, boolean critical) {
            this.category    = category;
            this.description = description;
            this.evidence    = evidence;
            this.critical    = critical;
        }
    }

    public static class LegalResult {
        public Verdict verdict;
        public List<Violation> violations;
        public boolean blocked;
        public String userMessage;

        public LegalResult(Verdict verdict, List<Violation> violations) {
            this.verdict    = verdict;
            this.violations = violations;
            this.blocked    = verdict == Verdict.ILLEGAL;
            this.userMessage = blocked
                ? "هذا الملف محظور — يحتوي على محتوى غير قانوني"
                : verdict == Verdict.RESTRICTED
                ? "تحذير — يحتوي على محتوى مقيد"
                : "الملف مقبول";
        }
    }

    private static final String[][] RULES = {
        {"Weapons",    "كود مرتبط بأسلحة أو متفجرات",          "(?i)(bomb|explosive|detonat|C4|TNT|TATP)",          "true"},
        {"Narcotics",  "كود لتصنيع مواد مخدرة",                "(?i)(synthesize|manufacture).*(meth|fentanyl|heroin)","true"},
        {"Fraud",      "كود للاحتيال أو التصيد",                "(?i)(phishing|fake.?login|credential.?harvest)",     "true"},
        {"Malware",    "كود لإنشاء برمجيات خبيثة",             "(?i)(write|create|build).*(virus|ransomware|trojan)","true"},
        {"Hacking",    "اختراق أجهزة بدون إذن",                "(?i)(hack|crack).*(someone|victim|account)",         "true"},
        {"Privacy",    "تجسس على أشخاص بدون موافقة",           "(?i)(spy|track).*(without|secret|hidden)",           "true"},
        {"IP",         "تجاوز تراخيص البرمجيات",               "(?i)(crack|bypass|keygen).*(license|activation)",    "false"},
        {"Cheating",   "غش في ألعاب أو اختبارات",              "(?i)(aimbot|wallhack|cheat).*(game|player)",         "false"},
    };

    public static LegalResult check(String code) {
        List<Violation> violations = new ArrayList<>();

        for (String[] rule : RULES) {
            Pattern p = Pattern.compile(rule[2]);
            java.util.regex.Matcher m = p.matcher(code);
            if (m.find()) {
                violations.add(new Violation(
                    rule[0], rule[1],
                    m.group().substring(0, Math.min(80, m.group().length())),
                    Boolean.parseBoolean(rule[3])
                ));
            }
        }

        boolean hasCritical = violations.stream().anyMatch(v -> v.critical);
        Verdict verdict = hasCritical ? Verdict.ILLEGAL
                        : !violations.isEmpty() ? Verdict.RESTRICTED
                        : Verdict.LEGAL;

        return new LegalResult(verdict, violations);
    }
}
