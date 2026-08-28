package com.naif.realityengine;

import java.util.ArrayList;
import java.util.List;
import java.util.regex.Pattern;
import java.util.regex.Matcher;

public class SecurityScanner {

    public enum Severity { CRITICAL, HIGH, MEDIUM, LOW, INFO }

    public static class Issue {
        public String id;
        public Severity severity;
        public String title;
        public String description;
        public int line;
        public String snippet;
        public String fix;
        public String category;

        public Issue(String id, Severity severity, String title,
                     String description, int line, String snippet,
                     String fix, String category) {
            this.id          = id;
            this.severity    = severity;
            this.title       = title;
            this.description = description;
            this.line        = line;
            this.snippet     = snippet;
            this.fix         = fix;
            this.category    = category;
        }
    }

    public static class ScanResult {
        public List<Issue> issues;
        public int score;
        public int scannedLines;
        public String language;

        public ScanResult(List<Issue> issues, int score, int scannedLines, String language) {
            this.issues       = issues;
            this.score        = score;
            this.scannedLines = scannedLines;
            this.language     = language;
        }
    }

    private static final Object[][] RULES = {
        {"SEC001", Severity.CRITICAL, "Hardcoded Password",
         "كلمة مرور مكتوبة مباشرة في الكود",
         "(?i)(?:password|passwd|pwd)\\s*=\\s*['\"][^'\"]{3,}['\"]",
         "استخدم environment variables", "Secrets"},

        {"SEC002", Severity.CRITICAL, "Hardcoded API Key",
         "API key مكشوف في الكود",
         "(?i)(?:api[_-]?key|apikey|access[_-]?token)\\s*=\\s*['\"][A-Za-z0-9_\\-\\.]{10,}['\"]",
         "انقل الـ key لـ .env", "Secrets"},

        {"SEC003", Severity.CRITICAL, "AWS Credentials",
         "AWS access key مكشوف",
         "AKIA[0-9A-Z]{16}",
         "أزل الـ key وأعد توليده", "Secrets"},

        {"SEC004", Severity.HIGH, "Use of eval()",
         "eval() خطر Remote Code Execution",
         "\\beval\\s*\\(",
         "استبدل eval() بـ json.loads()", "Code Execution"},

        {"SEC005", Severity.HIGH, "Use of exec()",
         "exec() يشغّل كود ديناميكي",
         "\\bexec\\s*\\(",
         "تجنب exec()", "Code Execution"},

        {"SEC006", Severity.CRITICAL, "SQL Injection",
         "SQL query بـ string concatenation",
         "(?i)(?:execute|query)\\s*\\(\\s*f?[\"'].*(?:\\+|%s|\\{.*\\}).*[\"']",
         "استخدم parameterized queries", "Injection"},

        {"SEC007", Severity.HIGH, "Weak Hashing",
         "MD5 أو SHA1 ضعيفة للـ passwords",
         "hashlib\\.(?:md5|sha1)\\s*\\(",
         "استخدم bcrypt أو SHA256", "Cryptography"},

        {"SEC008", Severity.MEDIUM, "SSL Disabled",
         "verify=False يعطّل SSL",
         "verify\\s*=\\s*False",
         "أزل verify=False", "Network"},

        {"SEC009", Severity.MEDIUM, "HTTP without HTTPS",
         "اتصالات غير مشفرة",
         "http://(?!localhost|127\\.|0\\.0\\.0\\.0)",
         "استخدم https://", "Network"},

        {"SEC010", Severity.MEDIUM, "Debug Mode",
         "debug=True في الكود",
         "(?i)debug\\s*=\\s*True",
         "أوقف debug في production", "Configuration"},

        {"SEC011", Severity.HIGH, "Shell Injection",
         "subprocess مع input ديناميكي",
         "(?i)(?:os\\.system|subprocess).*(?:f?['\"]|.*\\+)",
         "استخدم قائمة بدل string", "Injection"},

        {"SEC012", Severity.HIGH, "Insecure Deserialization",
         "pickle.loads() على بيانات غير موثوقة",
         "pickle\\.(?:loads?|Unpickler)",
         "استخدم json.loads()", "Deserialization"},

        {"SEC013", Severity.LOW, "Print Sensitive Data",
         "print() قد يكشف بيانات حساسة",
         "(?i)print\\s*\\(.*(?:password|token|key|secret)",
         "استخدم logging بدل print", "Information Disclosure"},

        {"SEC014", Severity.CRITICAL, "Private Key",
         "private key في الكود",
         "-----BEGIN\\s(?:RSA\\s)?PRIVATE KEY-----",
         "احذف الـ key من الكود", "Secrets"},

        {"SEC015", Severity.HIGH, "Hardcoded DB URL",
         "بيانات قاعدة البيانات مكشوفة",
         "(?i)(?:mongodb|postgresql|mysql|redis)://[^\"'\\s]{5,}",
         "انقل connection string لـ env", "Secrets"},
    };

    private static String detectLanguage(String code) {
        if (code.contains("def ") || code.contains("import ") && code.contains(":"))
            return "Python";
        if (code.contains("const ") || code.contains("let ") || code.contains("=>"))
            return "JavaScript/TypeScript";
        if (code.contains("public class") || code.contains("void main"))
            return "Java";
        return "Unknown";
    }

    private static int calcScore(List<Issue> issues) {
        int deduction = 0;
        for (Issue i : issues) {
            switch (i.severity) {
                case CRITICAL: deduction += 25; break;
                case HIGH:     deduction += 15; break;
                case MEDIUM:   deduction += 8;  break;
                case LOW:      deduction += 3;  break;
                default:       deduction += 1;
            }
        }
        return Math.max(0, 100 - deduction);
    }

    public static ScanResult scan(String code) {
        List<Issue> issues = new ArrayList<>();
        String[] lines = code.split("\n");

        for (Object[] rule : RULES) {
            String id       = (String) rule[0];
            Severity sev    = (Severity) rule[1];
            String title    = (String) rule[2];
            String desc     = (String) rule[3];
            String pattern  = (String) rule[4];
            String fix      = (String) rule[5];
            String category = (String) rule[6];

            Pattern p = Pattern.compile(pattern, Pattern.MULTILINE);
            Matcher m = p.matcher(code);

            while (m.find()) {
                String before = code.substring(0, m.start());
                int lineNo = before.split("\n", -1).length;
                String snippet = lines[lineNo - 1].trim();
                if (snippet.length() > 120)
                    snippet = snippet.substring(0, 120);

                issues.add(new Issue(id, sev, title, desc, lineNo, snippet, fix, category));
                break; // واحد لكل rule
            }
        }

        // Sort: CRITICAL first
        issues.sort((a, b) -> a.severity.compareTo(b.severity));

        return new ScanResult(
            issues,
            calcScore(issues),
            lines.length,
            detectLanguage(code)
        );
    }
}
}
