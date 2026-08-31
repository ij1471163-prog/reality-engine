package com.naif.realityengine;

import java.util.*;
import java.util.regex.*;

/**
 * PolicyEngine v3.0
 * ✅ Policy check       — check()
 * ✅ Security rules     — 11 rules (POL001–POL011)
 * ✅ Dangerous APIs     — stripCommentsAndStrings()
 * ✅ Allow/Block        — PolicyVerdict
 * ✅ Risk level         — riskScore 0–100
 * ✅ Confidence score   — confidence() per violation
 * ✅ Explain            — explain() تفسير بالعربي
 * ✅ Whitelist          — addWhitelist() / isWhitelisted()
 * ✅ Custom rules       — addRule()
 * ✅ Batch check        — checkAll()
 */
public class PolicyEngine {

    // ═══════════════════════════════════════════════════
    // Enums & Data Classes
    // ═══════════════════════════════════════════════════

    public enum PolicyVerdict { ALLOWED, WARNING, BLOCKED }

    public static class PolicyViolation {
        public final String  rule;
        public final String  description;
        public final String  evidence;
        public final int     line;
        public final boolean critical;
        public final double  confidence; // 0.0 – 1.0

        public PolicyViolation(String rule, String description,
                                String evidence, int line,
                                boolean critical, double confidence) {
            this.rule        = rule;
            this.description = description;
            this.evidence    = evidence;
            this.line        = line;
            this.critical    = critical;
            this.confidence  = confidence;
        }

        @Override public String toString() {
            return String.format("[%s] %s (س%d) conf=%.0f%% %s",
                rule, description, line,
                confidence * 100,
                critical ? "🔴" : "🟡");
        }
    }

    public static class PolicyResult {
        public final PolicyVerdict          verdict;
        public final List<PolicyViolation>  violations;
        public final int                    riskScore;
        public final String                 summary;
        public final double                 overallConfidence; // متوسط confidence الانتهاكات

        public PolicyResult(PolicyVerdict verdict,
                            List<PolicyViolation> violations,
                            int riskScore) {
            this.verdict           = verdict;
            this.violations        = violations;
            this.riskScore         = riskScore;
            this.summary           = buildSummary(verdict, violations);
            this.overallConfidence = violations.isEmpty() ? 1.0
                : violations.stream().mapToDouble(v -> v.confidence).average().orElse(0.0);
        }

        private static String buildSummary(PolicyVerdict verdict,
                                            List<PolicyViolation> violations) {
            if (violations.isEmpty()) return "✅ نظيف";
            StringBuilder sb = new StringBuilder();
            sb.append(verdict == PolicyVerdict.BLOCKED ? "🔴 مرفوض" : "🟡 تحذير");
            sb.append(" — ");
            violations.forEach(v -> sb.append(v.rule).append(' '));
            sb.append("(").append(violations.size()).append(" انتهاك)");
            return sb.toString().trim();
        }

        /** تفسير بالعربي لكل انتهاك */
        public String explain() {
            if (violations.isEmpty()) return "الكود نظيف — لا انتهاكات.";
            StringBuilder sb = new StringBuilder();
            sb.append("تقرير PolicyEngine:\n");
            sb.append("━━━━━━━━━━━━━━━━━━━━━━━━━\n");
            sb.append(String.format("الحكم    : %s\n", verdict));
            sb.append(String.format("مستوى الخطر: %d/100\n", riskScore));
            sb.append(String.format("الثقة العامة: %.0f%%\n\n", overallConfidence * 100));
            for (PolicyViolation v : violations) {
                sb.append(String.format("• %s — %s\n", v.rule, v.description));
                sb.append(String.format("  السطر %d: %s\n", v.line, v.evidence));
                sb.append(String.format("  الخطورة: %s  |  الثقة: %.0f%%\n",
                    v.critical ? "حرج" : "تحذير", v.confidence * 100));
                sb.append("\n");
            }
            return sb.toString().trim();
        }
    }

    // ═══════════════════════════════════════════════════
    // Rule Definition
    // ═══════════════════════════════════════════════════

    private static class Rule {
        final String  id;
        final String  description;
        final Pattern pattern;
        final boolean critical;
        final double  baseConfidence; // ثقة أساسية للـ rule

        Rule(String id, String description, String regex,
             boolean critical, double baseConfidence) {
            this.id             = id;
            this.description    = description;
            this.pattern        = Pattern.compile(regex,
                Pattern.CASE_INSENSITIVE | Pattern.DOTALL);
            this.critical       = critical;
            this.baseConfidence = baseConfidence;
        }
    }

    // ── Whitelist: thread-safe ──────────────────────────
    private static final Set<String> WHITELIST_TERMS = Collections.synchronizedSet(
        new HashSet<>(Arrays.asList(
            "test_keylog", "mock_encrypt", "example_shell", "demo_brute"
        ))
    );

    /** أضف مصطلح للـ whitelist */
    public static void addWhitelist(String term) {
        if (term != null) WHITELIST_TERMS.add(term.toLowerCase());
    }

    /** احذف مصطلح من الـ whitelist */
    public static void removeWhitelist(String term) {
        if (term != null) WHITELIST_TERMS.remove(term.toLowerCase());
    }

    /** امسح كل الـ whitelist */
    public static void clearWhitelist() { WHITELIST_TERMS.clear(); }

    /** تحقق لو الـ evidence يحتوي whitelist term */
    public static boolean isWhitelisted(String evidence) {
        if (evidence == null) return false;
        String ev = evidence.toLowerCase();
        synchronized (WHITELIST_TERMS) {
            return WHITELIST_TERMS.stream().anyMatch(ev::contains);
        }
    }

    // ═══════════════════════════════════════════════════
    // Rules — compiled في static init + thread-safe wrapper
    // ═══════════════════════════════════════════════════

    private static final List<Rule> RULES;

    static {
        List<Rule> base = new ArrayList<>();

        // ── Critical rules (BLOCKED) ──
        base.add(new Rule("POL001", "حذف ملفات النظام",
            "(shutil\\.rmtree|os\\.remove)\\s*\\(.*?(/etc|/sys|/bin|/usr)",
            true, 0.95));

        base.add(new Rule("POL002", "سرقة بيانات المستخدم",
            "(keylog|keystroke|capture_password|hook_keyboard)",
            true, 0.90));

        base.add(new Rule("POL003", "ransomware",
            "(encrypt|AES|Fernet)[\\s\\S]{0,200}(walk|glob)[\\s\\S]{0,100}\\.(doc|pdf|xls|jpg)",
            true, 0.85));

        base.add(new Rule("POL004", "أدوات اختراق",
            "(brute[_\\-\\s]?force|reverse[_\\-\\s]?shell|bind[_\\-\\s]?shell|meterpreter)",
            true, 0.95));

        base.add(new Rule("POL005", "تنفيذ كود مشفر",
            "(exec|eval)\\s*\\(\\s*(base64|b64decode|codecs\\.decode)",
            true, 0.90));

        base.add(new Rule("POL006", "تجاوز صلاحيات النظام",
            "(setuid\\s*\\(0\\)|chmod\\s+[0-7]*7[0-7][0-7]|sudo\\s+.*--no-ask-passwd)",
            true, 0.88));

        // ── Warning rules (WARNING) ──
        base.add(new Rule("POL007", "تحميل وتشغيل ملفات خارجية",
            "(urlretrieve|requests\\.get)[\\s\\S]{0,100}\\.(exe|sh|bat|ps1)[\\s\\S]{0,100}(run|subprocess|exec)",
            false, 0.75));

        base.add(new Rule("POL008", "إرسال بيانات حساسة",
            "requests\\.(post|put)\\s*\\([\\s\\S]{0,200}(password|api_key|secret|token)",
            false, 0.70));

        base.add(new Rule("POL009", "تعديل ملفات النظام",
            "open\\s*\\(\\s*['\"]\\s*(/etc/hosts|/etc/crontab|/etc/sudoers|/etc/passwd)",
            false, 0.85));

        base.add(new Rule("POL010", "أوامر تدمير البيانات",
            "(dd\\s+if=|mkfs\\s*\\.|:\\s*\\(\\s*\\)\\s*\\{|>\\s*/dev/sd[a-z])",
            false, 0.92));

        base.add(new Rule("POL011", "كود obfuscation مشبوه",
            "([A-Za-z0-9+/]{80,}={0,2}|\\\\x[0-9a-fA-F]{2}(\\\\x[0-9a-fA-F]{2}){15,})",
            false, 0.65));

        // ✅ thread-safe wrapper
        RULES = Collections.synchronizedList(base);
    }

    /** أضف rule مخصصة في runtime */
    public static void addRule(String id, String description,
                                String regex, boolean critical,
                                double baseConfidence) {
        if (id == null || regex == null) return;
        RULES.add(new Rule(id, description, regex, critical, baseConfidence));
    }

    /** احذف rule بـ id */
    public static void removeRule(String id) {
        if (id == null) return;
        synchronized (RULES) {
            RULES.removeIf(r -> r.id.equals(id));
        }
    }

    /** هل rule موجودة؟ */
    public static boolean hasRule(String id) {
        synchronized (RULES) {
            return RULES.stream().anyMatch(r -> r.id.equals(id));
        }
    }

    // ═══════════════════════════════════════════════════
    // Preprocessor — يحذف comments و string literals
    // ═══════════════════════════════════════════════════

    /**
     * يُعيد الكود مع استبدال:
     * - Python/JS single-line comments بـ placeholder
     * - string literals بـ placeholder (يحتفظ بالطول)
     * لتجنب false positives من `# keylog` أو `"password"` في الـ docs
     */
    static String stripCommentsAndStrings(String code) {
        // ١. triple-quoted strings أولاً (Python) — قبل single-line comments
        code = code.replaceAll("\"\"\"[\\s\\S]*?\"\"\"|'''[\\s\\S]*?'''", "\"STRIPPED\"");

        // ٢. double-quoted strings
        code = code.replaceAll("\"(?:[^\"\\\\]|\\\\.)*\"", "\"STRIPPED\"");

        // ٣. single-quoted strings
        code = code.replaceAll("'(?:[^'\\\\]|\\\\.)*'", "'STRIPPED'");

        // ٤. multi-line comments /* ... */ — بعد الـ strings لتجنب التعارض
        code = code.replaceAll("/\\*[\\s\\S]*?\\*/", " ");

        // ٥. single-line comments # أو // — أخيراً (لا تعيد معالجة placeholder)
        code = code.replaceAll("(?m)(#|//).*$", " ");

        return code;
    }

    // ═══════════════════════════════════════════════════
    // Evidence Extractor — يُعيد السطر كاملاً مع context
    // ═══════════════════════════════════════════════════

    /** يُعيد رقم السطر الذي يبدأ عند matchStart */
    private static int findLine(String code, int matchStart) {
        int line = 1;
        for (int i = 0; i < matchStart && i < code.length(); i++) {
            if (code.charAt(i) == '\n') line++;
        }
        return line;
    }

    private static String extractLine(String code, int matchStart) {
        int lineStart = matchStart;
        while (lineStart > 0 && code.charAt(lineStart - 1) != '\n') lineStart--;
        int lineEnd = matchStart;
        while (lineEnd < code.length() && code.charAt(lineEnd) != '\n') lineEnd++;
        String line = code.substring(lineStart, lineEnd).trim();
        // قصّ لو طويل جداً
        return line.length() > 120 ? line.substring(0, 117) + "..." : line;
    }

    // ═══════════════════════════════════════════════════
    // Confidence Calculator
    // ═══════════════════════════════════════════════════

    /**
     * يحسب confidence لانتهاك — public API بدون Rule parameter
     * @param baseConfidence  الثقة الأساسية للـ rule (0.0–1.0)
     * @param evidence        النص المكتشف
     * @param matchCount      عدد المرات التي تكرر فيها النمط
     */
    public static double confidence(double baseConfidence, String evidence, int matchCount) {
        double conf = baseConfidence;
        if (matchCount > 1) conf = Math.min(1.0, conf + 0.05 * (matchCount - 1));
        if (isWhitelisted(evidence))          conf *= 0.40;
        if (evidence != null && evidence.trim().length() < 10) conf *= 0.70;
        return Math.round(conf * 100.0) / 100.0;
    }

    /** Internal overload يستخدم Rule مباشرة */
    private static double confidence(Rule rule, String evidence, int matchCount) {
        return confidence(rule.baseConfidence, evidence, matchCount);
    }

    // ═══════════════════════════════════════════════════
    // check() — Entry Point
    // ═══════════════════════════════════════════════════

    public static PolicyResult check(String code) {
        if (code == null || code.isBlank()) {
            return new PolicyResult(PolicyVerdict.ALLOWED, Collections.emptyList(), 0);
        }

        String cleanCode = stripCommentsAndStrings(code);
        List<PolicyViolation> violations = new ArrayList<>();

        synchronized (RULES) {
            for (Rule rule : RULES) {
                Matcher m = rule.pattern.matcher(cleanCode);
                if (!m.find()) continue;

                int matchStart = m.start();

                // عدّ كل الـ matches
                int matchCount = 1;
                while (m.find()) matchCount++;

                // ✅ findLine() مباشرة بدل int[]
                int    line     = findLine(cleanCode, matchStart);
                String evidence = extractLine(code, matchStart);
                // ✅ private overload — Rule مو مكشوفة لـ caller
                double conf     = confidence(rule, evidence, matchCount);

                violations.add(new PolicyViolation(
                    rule.id, rule.description, evidence, line, rule.critical, conf
                ));
            }
        }

        int riskScore = 0;
        for (PolicyViolation v : violations)
            riskScore += v.critical ? (int)(40 * v.confidence) : (int)(20 * v.confidence);
        riskScore = Math.min(100, riskScore);

        boolean hasCritical = violations.stream()
            .anyMatch(v -> v.critical && v.confidence >= 0.5);
        PolicyVerdict verdict = hasCritical           ? PolicyVerdict.BLOCKED
                              : !violations.isEmpty() ? PolicyVerdict.WARNING
                              : PolicyVerdict.ALLOWED;

        return new PolicyResult(verdict, violations, riskScore);
    }

    // ═══════════════════════════════════════════════════
    // checkAll() — فحص مجموعة ملفات
    // ═══════════════════════════════════════════════════

    /**
     * يفحص map من fileName → code بشكل parallel
     * يُعيد map من fileName → PolicyResult (بنفس الترتيب)
     */
    public static Map<String, PolicyResult> checkAll(Map<String, String> files) {
        if (files == null || files.isEmpty()) return Collections.emptyMap();

        // ✅ parallel — كل ملف في thread مستقل
        Map<String, PolicyResult> results = Collections.synchronizedMap(new LinkedHashMap<>());
        List<Thread> threads = new ArrayList<>();

        for (Map.Entry<String, String> entry : files.entrySet()) {
            Thread t = new Thread(() ->
                results.put(entry.getKey(), check(entry.getValue())));
            threads.add(t);
            t.start();
        }
        for (Thread t : threads) {
            try { t.join(); }
            catch (InterruptedException e) { Thread.currentThread().interrupt(); }
        }

        // أعد الترتيب بحسب الأصل
        Map<String, PolicyResult> ordered = new LinkedHashMap<>();
        files.keySet().forEach(k -> { if (results.containsKey(k)) ordered.put(k, results.get(k)); });
        return ordered;
    }

    /**
     * يُعيد true لو أي ملف في الـ map محظور
     */
    public static boolean anyBlocked(Map<String, PolicyResult> results) {
        return results.values().stream()
            .anyMatch(r -> r.verdict == PolicyVerdict.BLOCKED);
    }

    /**
     * يُعيد ملخص نصي لنتائج checkAll
     */
    public static String summarizeAll(Map<String, PolicyResult> results) {
        StringBuilder sb = new StringBuilder();
        sb.append("═══ PolicyEngine Batch Report ═══\n");
        int blocked = 0, warned = 0, clean = 0;
        for (Map.Entry<String, PolicyResult> e : results.entrySet()) {
            PolicyResult r = e.getValue();
            sb.append(String.format("%-30s → %s\n", e.getKey(), r.summary));
            if (r.verdict == PolicyVerdict.BLOCKED)  blocked++;
            else if (r.verdict == PolicyVerdict.WARNING) warned++;
            else clean++;
        }
        sb.append(String.format("\nملخص: 🔴 %d محظور  🟡 %d تحذير  ✅ %d نظيف",
            blocked, warned, clean));
        return sb.toString();
    }
}

