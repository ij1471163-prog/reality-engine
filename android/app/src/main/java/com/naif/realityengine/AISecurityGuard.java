package com.naif.realityengine;

import java.util.ArrayList;
import java.util.List;
import java.util.regex.Pattern;

public class AISecurityGuard {

    public enum GuardVerdict { SAFE, WARNING, BLOCKED }

    public static class Check {
        public String id;
        public String name;
        public boolean passed;
        public String details;
        public boolean critical;

        public Check(String id, String name, boolean passed, String details, boolean critical) {
            this.id       = id;
            this.name     = name;
            this.passed   = passed;
            this.details  = details;
            this.critical = critical;
        }
    }

    public static class GuardReport {
        public GuardVerdict verdict;
        public int safetyScore;
        public List<Check> checks;
        public boolean canProceed;
        public String blockedReason;
        public String recommendation;

        public GuardReport(GuardVerdict verdict, int safetyScore,
                          List<Check> checks, String blockedReason) {
            this.verdict       = verdict;
            this.safetyScore   = safetyScore;
            this.checks        = checks;
            this.canProceed    = verdict != GuardVerdict.BLOCKED;
            this.blockedReason = blockedReason;
            this.recommendation = verdict == GuardVerdict.BLOCKED
                ? "مرفوض تلقائياً — انتهاك أمني حرج"
                : verdict == GuardVerdict.WARNING
                ? "يحتاج مراجعة دقيقة قبل التطبيق"
                : "اجتاز الفحوصات — مراجعتك إلزامية";
        }
    }

    public static GuardReport inspect(String suggestion) {
        List<Check> checks = new ArrayList<>();

        // 1. Readability
        String[] lines = suggestion.split("\n");
        int nonEmpty = 0;
        int totalLen = 0;
        for (String l : lines) {
            if (!l.trim().isEmpty()) { nonEmpty++; totalLen += l.length(); }
        }
        double avgLen = nonEmpty > 0 ? (double) totalLen / nonEmpty : 0;
        checks.add(new Check("AI001", "Code Readability",
            avgLen < 200,
            avgLen < 200 ? "مقروء ✓" : "سطور طويلة مشبوهة",
            false));

        // 2. Suspicious variable names
        boolean hasSuspicious = Pattern.compile(
            "(?i)\\b(payload|shellcode|exploit|inject|bypass|backdoor|trojan|rat|c2)\\b"
        ).matcher(suggestion).find();
        checks.add(new Check("AI002", "Variable Names Safety",
            !hasSuspicious,
            hasSuspicious ? "أسماء متغيرات مشبوهة" : "أسماء آمنة ✓",
            true));

        // 3. Shell execution
        int shellCount = countMatches(suggestion, "(?:os\\.system|subprocess|Popen|shell=True)");
        checks.add(new Check("AI003", "Shell Execution",
            shellCount == 0,
            shellCount > 0 ? shellCount + " استدعاء shell" : "لا shell ✓",
            false));

        // 4. Error handling
        boolean hasTry = suggestion.contains("try:") && suggestion.contains("except");
        checks.add(new Check("AI004", "Error Handling",
            hasTry || lines.length <= 5,
            hasTry ? "يحتوي try/except ✓" : "لا error handling",
            false));

        // 5. Hardcoded credentials
        boolean hasCreds = Pattern.compile(
            "(?i)(?:password|secret|api_key)\\s*=\\s*['\"][^'\"]{4,}['\"]"
        ).matcher(suggestion).find();
        checks.add(new Check("AI005", "No Hardcoded Credentials",
            !hasCreds,
            hasCreds ? "credentials مكشوفة!" : "لا credentials ✓",
            true));

        // 6. eval/exec
        int evalCount = countMatches(suggestion, "\\b(?:eval|exec|compile)\\s*\\(");
        checks.add(new Check("AI006", "No Dynamic Execution",
            evalCount == 0,
            evalCount > 0 ? evalCount + " استخدام eval/exec" : "لا eval/exec ✓",
            true));

        // 7. Network calls
        int netCount = countMatches(suggestion, "(?:requests\\.|urllib\\.|socket\\.|http\\.)");
        checks.add(new Check("AI007", "Network Usage",
            netCount <= 2,
            netCount > 0 ? netCount + " استدعاء شبكي" : "لا اتصالات شبكية ✓",
            false));

        // Calculate score
        int deductions = 0;
        String blockedReason = null;
        for (Check c : checks) {
            if (!c.passed) {
                deductions += c.critical ? 30 : 10;
                if (c.critical && blockedReason == null)
                    blockedReason = c.details;
            }
        }
        int score = Math.max(0, 100 - deductions);

        // Verdict
        boolean failedCritical = checks.stream().anyMatch(c -> !c.passed && c.critical);
        GuardVerdict verdict = failedCritical ? GuardVerdict.BLOCKED
                             : score < 70      ? GuardVerdict.WARNING
                             : GuardVerdict.SAFE;

        return new GuardReport(verdict, score, checks, blockedReason);
    }

    private static int countMatches(String text, String regex) {
        Pattern p = Pattern.compile(regex);
        java.util.regex.Matcher m = p.matcher(text);
        int count = 0;
        while (m.find()) count++;
        return count;
    }
}
