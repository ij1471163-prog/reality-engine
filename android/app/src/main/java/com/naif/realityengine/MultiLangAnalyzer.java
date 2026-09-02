package com.naif.realityengine;

import java.util.*;
import java.util.regex.*;

public class MultiLangAnalyzer {

    public static class Issue {
        public String title, description, fix, severity, file;
        public int line;
        public Issue(String title, String desc, String fix, int line, String sev) {
            this.title = title; this.description = desc;
            this.fix = fix; this.line = line; this.severity = sev;
        }
    }

    public static List<Issue> analyze(String code, String fileName) {
        String ext = fileName.contains(".") ?
            fileName.substring(fileName.lastIndexOf('.') + 1).toLowerCase() : "";
        List<Issue> issues = new ArrayList<>();
        switch (ext) {
            case "ts": case "tsx": analyzeTypeScript(code, issues); break;
            case "kt":             analyzeKotlin(code, issues);     break;
            case "php":            analyzePHP(code, issues);        break;
        }
        return issues;
    }

    // ─── TypeScript ───────────────────────────────────────

    private static void analyzeTypeScript(String code, List<Issue> issues) {
        String[] lines = code.split("\n");
        for (int i = 0; i < lines.length; i++) {
            String t = lines[i].trim();
            int ln = i + 1;

            // any type
            if (Pattern.compile(":\\s*any\\b").matcher(t).find()) {
                issues.add(new Issue("any يُفقد فائدة TypeScript",
                    "استخدم نوعاً محدداً", "// حدد النوع الصحيح بدل any", ln, "MEDIUM"));
            }

            // Non-null assertion !!
            if (Pattern.compile("\\w+!!").matcher(t).find()) {
                issues.add(new Issue("!! خطير — يسبب NullPointerException",
                    "استخدم ?.", t.replaceAll("(\\w+)!!", "$1?."), ln, "HIGH"));
            }

            // Promise بدون catch
            if (t.contains(".then(") && !t.contains(".catch(")) {
                boolean hasCatch = false;
                for (int j = i; j < Math.min(i + 5, lines.length); j++) {
                    if (lines[j].contains(".catch(") || lines[j].contains("try {")) { hasCatch = true; break; }
                }
                if (!hasCatch) {
                    issues.add(new Issue("Promise بدون .catch()",
                        "أضف error handling", t + ".catch(err => console.error(err))", ln, "MEDIUM"));
                }
            }

            // any as assertion
            if (Pattern.compile("\\bas\\s+\\w+").matcher(t).find() &&
                !t.contains("as const") && !t.startsWith("//")) {
                issues.add(new Issue("Type assertion قد يخفي أخطاء",
                    "تحقق من النوع قبل الـ assertion",
                    "// استخدم type guard بدل as", ln, "LOW"));
            }
        }
    }

    // ─── Kotlin ───────────────────────────────────────────

    private static void analyzeKotlin(String code, List<Issue> issues) {
        String[] lines = code.split("\n");
        for (int i = 0; i < lines.length; i++) {
            String t = lines[i].trim();
            int ln = i + 1;

            // !! double bang
            if (Pattern.compile("\\w+!!").matcher(t).find()) {
                issues.add(new Issue("!! يسبب NullPointerException",
                    "استخدم ?: أو let",
                    t.replaceAll("(\\w+)!!", "$1 ?: return"), ln, "HIGH"));
            }

            // Thread.sleep
            if (t.contains("Thread.sleep(")) {
                issues.add(new Issue("Thread.sleep في Coroutine",
                    "استخدم delay()",
                    t.replace("Thread.sleep(", "delay("), ln, "HIGH"));
            }

            // GlobalScope
            if (Pattern.compile("GlobalScope\\.(launch|async)").matcher(t).find()) {
                issues.add(new Issue("GlobalScope — Memory Leak محتمل",
                    "استخدم viewModelScope",
                    "// استخدم viewModelScope.launch { }", ln, "MEDIUM"));
            }

            // runBlocking
            if (t.contains("runBlocking {")) {
                issues.add(new Issue("runBlocking — ANR محتمل",
                    "استخدم lifecycleScope",
                    "// استخدم lifecycleScope.launch { }", ln, "HIGH"));
            }

            // Room SQL Injection
            if (t.contains("@Query") && (t.contains("+") || t.contains("${"))) {
                issues.add(new Issue("SQL Injection في Room Query",
                    "استخدم :parameter",
                    "// @Query(\"SELECT * FROM t WHERE id = :id\")", ln, "CRITICAL"));
            }

            // Log sensitive
            if (Pattern.compile("Log\\.[divew]\\s*\\(").matcher(t).find() &&
                Pattern.compile("(?i)(password|token|secret|key)").matcher(t).find()) {
                issues.add(new Issue("تسجيل بيانات حساسة في Log",
                    "احذف هذا الـ log",
                    "// لا تسجّل passwords أو tokens", ln, "HIGH"));
            }
        }
    }

    // ─── PHP ──────────────────────────────────────────────

    private static void analyzePHP(String code, List<Issue> issues) {
        String[] lines = code.split("\n");
        boolean isLaravel   = code.contains("Route::") || code.contains("Eloquent");
        boolean isWordPress = code.contains("wp_") || code.contains("wpdb");

        for (int i = 0; i < lines.length; i++) {
            String t = lines[i].trim();
            int ln = i + 1;

            // SQL Injection
            if (Pattern.compile("(?i)(mysql_query|mysqli_query|->query\\s*\\()").matcher(t).find() &&
                Pattern.compile("\\$_(GET|POST|REQUEST|COOKIE)").matcher(t).find()) {
                issues.add(new Issue("SQL Injection من User Input",
                    "استخدم Prepared Statements",
                    "// $stmt = $pdo->prepare('SELECT * FROM users WHERE id = ?');", ln, "CRITICAL"));
            }

            // XSS
            if (Pattern.compile("echo\\s+\\$_(GET|POST|REQUEST)").matcher(t).find() &&
                !t.contains("htmlspecialchars") && !t.contains("esc_html")) {
                issues.add(new Issue("XSS: echo مباشر من User Input",
                    "استخدم htmlspecialchars()",
                    t.replaceAll("echo\\s+(\\$_\\w+\\[.*?\\])",
                        "echo htmlspecialchars($1, ENT_QUOTES, 'UTF-8')"), ln, "CRITICAL"));
            }

            // eval()
            if (Pattern.compile("\\beval\\s*\\(").matcher(t).find()) {
                issues.add(new Issue("eval() خطير في PHP",
                    "احذف eval()",
                    "// احذف eval() — استخدم بديل آمن", ln, "CRITICAL"));
            }

            // MD5 passwords
            if (t.contains("md5(") && Pattern.compile("(?i)(password|passwd)").matcher(t).find()) {
                issues.add(new Issue("MD5 لكلمة المرور — مكسور",
                    "استخدم password_hash()",
                    t.replaceAll("md5\\(([^)]+)\\)",
                        "password_hash($1, PASSWORD_BCRYPT)"), ln, "CRITICAL"));
            }

            // Hardcoded credentials
            if (Pattern.compile("(?i)(password|secret|api_key)\\s*=\\s*['\"][^'\"]{4,}['\"]").matcher(t).find()) {
                issues.add(new Issue("كلمة مرور مُضمَّنة في الكود",
                    "استخدم .env",
                    "// استخدم $_ENV['PASSWORD'] بدل hardcoded", ln, "CRITICAL"));
            }

            // WordPress SQL
            if (isWordPress &&
                Pattern.compile("\\$wpdb->query\\s*\\(").matcher(t).find() &&
                Pattern.compile("\\$_(GET|POST|REQUEST)").matcher(t).find()) {
                issues.add(new Issue("WordPress SQL بدون prepare()",
                    "استخدم $wpdb->prepare()",
                    "// $wpdb->query($wpdb->prepare('SELECT...', $param))", ln, "CRITICAL"));
            }

            // Laravel Mass Assignment
            if (isLaravel && t.contains("::create(") && t.contains("$request->all()")) {
                issues.add(new Issue("Laravel Mass Assignment",
                    "استخدم $fillable",
                    "// $request->only(['field1', 'field2'])", ln, "HIGH"));
            }
        }
    }
}
    }
}
