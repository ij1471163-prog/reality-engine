package com.naif.realityengine;

import java.util.ArrayList;
import java.util.List;
import java.util.regex.Pattern;
import java.util.regex.Matcher;

public class PolicyEngine {

    public enum PolicyVerdict { ALLOWED, WARNING, BLOCKED }

    public static class PolicyViolation {
        public String rule;
        public String description;
        public String evidence;
        public boolean critical;

        public PolicyViolation(String rule, String description, String evidence, boolean critical) {
            this.rule        = rule;
            this.description = description;
            this.evidence    = evidence;
            this.critical    = critical;
        }
    }

    public static class PolicyResult {
        public PolicyVerdict verdict;
        public List<PolicyViolation> violations;
        public int riskScore;
        public String summary;

        public PolicyResult(PolicyVerdict verdict, List<PolicyViolation> violations, int riskScore) {
            this.verdict    = verdict;
            this.violations = violations;
            this.riskScore  = riskScore;
            this.summary    = verdict == PolicyVerdict.BLOCKED  ? "مرفوض: انتهاك حرج"
                            : verdict == PolicyVerdict.WARNING  ? "تحذير: يحتاج مراجعة"
                            : "نظيف";
        }
    }

    private static final String[][] RULES = {
        {"POL001","حذف ملفات النظام",         "(?i)(shutil\\.rmtree|os\\.remove).*(/etc|/sys|/bin)", "true"},
        {"POL002","سرقة بيانات المستخدم",     "(?i)(keylog|keystroke|capture.*password)",             "true"},
        {"POL003","ransomware",                "(?i)(encrypt|AES|Fernet).*(walk|glob).*\\.(doc|pdf)",  "true"},
        {"POL004","أدوات اختراق",             "(?i)(brute.?force|reverse.?shell|bind.?shell)",        "true"},
        {"POL005","إخفاء كود obfuscation",    "(?i)(exec|eval)\\s*\\(\\s*(base64|b64|decode)",        "true"},
        {"POL006","تجاوز صلاحيات النظام",     "(?i)(setuid|chmod.*777|sudo.*silent)",                 "true"},
        {"POL007","تحميل وتشغيل ملفات خارجية","(?i)(download|fetch).*(exe|sh|bat).*run",              "false"},
        {"POL008","إرسال بيانات مخفي",        "(?i)(requests\\.(post|put)).*(password|key|secret)",   "false"},
        {"POL009","تعديل ملفات النظام",       "(?i)open.*(/etc/hosts|/etc/crontab|/etc/sudoers)",     "false"},
        {"POL010","أوامر خطيرة",              "(dd if=|mkfs\\.|fork bomb|> /dev/sd)",                 "false"},
    };

    public static PolicyResult check(String code) {
        List<PolicyViolation> violations = new ArrayList<>();

        for (String[] rule : RULES) {
            Pattern p = Pattern.compile(rule[2]);
            Matcher m = p.matcher(code);
            if (m.find()) {
                String evidence = m.group();
                violations.add(new PolicyViolation(
                    rule[0], rule[1],
                    evidence.substring(0, Math.min(80, evidence.length())),
                    Boolean.parseBoolean(rule[3])
                ));
            }
        }

        int riskScore = 0;
        for (PolicyViolation v : violations)
            riskScore += v.critical ? 40 : 20;
        riskScore = Math.min(100, riskScore);

        boolean hasCritical = violations.stream().anyMatch(v -> v.critical);
        PolicyVerdict verdict = hasCritical           ? PolicyVerdict.BLOCKED
                              : !violations.isEmpty() ? PolicyVerdict.WARNING
                              : PolicyVerdict.ALLOWED;

        return new PolicyResult(verdict, violations, riskScore);
    }
}
