package com.naif.realityengine;

import java.util.*;
import java.util.regex.*;

public class SecurityScanner {

    // ─── OWASP Map ───────────────────────────────────────
    public static final java.util.Map<String, String> OWASP_MAP = new java.util.HashMap<String, String>() {{
        put("SQL",     "OWASP A03:2021 | CWE-89  | CVSS 9.8");
        put("XSS",     "OWASP A03:2021 | CWE-79  | CVSS 7.2");
        put("SECRET",  "OWASP A02:2021 | CWE-798 | CVSS 9.1");
        put("CMD",     "OWASP A03:2021 | CWE-78  | CVSS 9.8");
        put("CRYPTO",  "OWASP A02:2021 | CWE-327 | CVSS 7.4");
        put("AUTH",    "OWASP A07:2021 | CWE-287 | CVSS 8.1");
        put("LOG",     "OWASP A09:2021 | CWE-532 | CVSS 5.3");
        put("HTTP",    "OWASP A02:2021 | CWE-319 | CVSS 7.5");
    }};

    public static class SecurityIssue {
        public String title;
        public String description;
        public String fix;
        public int line;
        public String severity;

        public SecurityIssue(String title, String desc, String fix, int line, String sev) {
            this.title = title;
            this.description = desc;
            this.fix = fix;
            this.line = line;
            this.severity = sev;
        }
    }

    public static List<SecurityIssue> scan(String code, String fileName) {
        List<SecurityIssue> issues = new ArrayList<>();
        if (code == null || code.isEmpty()) { return issues; }
        String[] lines = code.split("\n");
        String ext = fileName.contains(".") ? fileName.substring(fileName.lastIndexOf('.') + 1).toLowerCase() : "";
        boolean isJS = ext.equals("js") || ext.equals("jsx") || ext.equals("ts");

        for (int i = 0; i < lines.length; i++) {
            String t = lines[i].trim();
            if (t.isEmpty() || t.startsWith("//") || t.startsWith("#") || t.startsWith("*")) { continue; }
            int ln = i + 1;

            // 1. Hardcoded Password
            if (Pattern.compile("(?i)(password|secret|api_key|apikey|token)\\s*=\\s*[\"'][^\"']{4,}[\"']").matcher(t).find()) {
                if (!Pattern.compile("(?i)(test|example|placeholder)").matcher(t).find()) {
                    issues.add(new SecurityIssue("كلمة مرور مُضمَّنة في الكود",
                        "استخدم Environment Variables", "// استخدم BuildConfig أو Secrets", ln, "CRITICAL"));
                }
            }

            // 2. SQL Injection
            if (Pattern.compile("(?i)(query|execute|sql)").matcher(t).find()) {
                if (Pattern.compile("\"\\s*\\+\\s*\\w+").matcher(t).find()) {
                    issues.add(new SecurityIssue("SQL Injection محتمل",
                        "استخدم Prepared Statements", "// استخدم ? placeholders", ln, "CRITICAL"));
                }
            }

            // 3. eval()
            if (Pattern.compile("\\beval\\s*\\(").matcher(t).find()) {
                issues.add(new SecurityIssue("eval() خطير",
                    "eval() يسمح بتنفيذ أي كود", "// احذف eval()", ln, "CRITICAL"));
            }

            // 4. XSS
            if (isJS && Pattern.compile("innerHTML|document\\.write").matcher(t).find()) {
                issues.add(new SecurityIssue("XSS محتمل: innerHTML",
                    "استخدم textContent", t.replace("innerHTML", "textContent"), ln, "HIGH"));
            }

            // 5. HTTP
            if (Pattern.compile("http://(?!localhost|127)").matcher(t).find()) {
                issues.add(new SecurityIssue("HTTP غير مشفر",
                    "استخدم HTTPS", t.replace("http://", "https://"), ln, "MEDIUM"));
            }

            // 6. Log Secrets
            if (Pattern.compile("(?i)(Log\\.|System\\.out|println)").matcher(t).find()) {
                if (Pattern.compile("(?i)(password|token|secret|key)").matcher(t).find()) {
                    issues.add(new SecurityIssue("تسجيل بيانات حساسة",
                        "لا تسجّل secrets في الـ logs", "// احذف هذا السطر", ln, "HIGH"));
                }
            }

            // 7. Command Injection
            if (Pattern.compile("(?i)(Runtime\\.exec|ProcessBuilder)").matcher(t).find()) {
                if (Pattern.compile("\\+").matcher(t).find()) {
                    issues.add(new SecurityIssue("Command Injection محتمل",
                        "لا تدمج input في shell commands",
                        "// استخدم ProcessBuilder مع List<String>", ln, "CRITICAL"));
                }
            }
        }
        return issues;
    }
}
