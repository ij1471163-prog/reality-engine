package com.naif.realityengine;

import java.util.*;
import java.util.regex.*;

/**
 * DartAnalyzer v1.0 — محلل Dart/Flutter
 * ✅ Null safety issues
 * ✅ setState في async
 * ✅ BuildContext بعد await
 * ✅ Memory leaks (StreamSubscription, AnimationController)
 * ✅ print() في production
 * ✅ Hardcoded strings بدل l10n
 * ✅ Magic numbers
 * ✅ Empty catch
 * ✅ SQL Injection في sqflite
 * ✅ Confidence score
 */
public class DartAnalyzer {

    // ═══════════════════════════════════════════════════
    // Compiled Patterns
    // ═══════════════════════════════════════════════════

    private static final Pattern PAT_NULL_BANG     = Pattern.compile("\\w+!\\s*[;,)\\.]");
    private static final Pattern PAT_ASYNC_VOID    = Pattern.compile("\\basync\\s+\\{");
    private static final Pattern PAT_SET_STATE     = Pattern.compile("setState\\s*\\(");
    private static final Pattern PAT_CONTEXT_AWAIT = Pattern.compile("\\bawait\\b");
    private static final Pattern PAT_PRINT         = Pattern.compile("^\\s*print\\s*\\(");
    private static final Pattern PAT_EMPTY_CATCH   = Pattern.compile("catch\\s*\\([^)]*\\)\\s*\\{\\s*\\}");
    private static final Pattern PAT_STREAM_SUB    = Pattern.compile("StreamSubscription\\s+\\w+");
    private static final Pattern PAT_ANIM_CTRL     = Pattern.compile("AnimationController\\s+\\w+");
    private static final Pattern PAT_DISPOSE       = Pattern.compile("\\bdispose\\s*\\(\\)");
    private static final Pattern PAT_SQL_CONCAT    = Pattern.compile("(?i)(rawQuery|execute|rawInsert|rawUpdate).*\\$\\{");
    private static final Pattern PAT_HARDCODED_STR = Pattern.compile("Text\\s*\\(\\s*'[^']{10,}'");
    private static final Pattern PAT_MAGIC_NUM     = Pattern.compile("(?<![\\w.])([0-9]{3,})(?![\\w.])");
    private static final Pattern PAT_DOUBLE_BANG   = Pattern.compile("!!");
    private static final Pattern PAT_MOUNTED_CHECK = Pattern.compile("\\bmounted\\b");
    private static final Pattern PAT_SENSITIVE_LOG = Pattern.compile("(?i)(password|token|secret|key)");

    // ═══════════════════════════════════════════════════
    // Issue
    // ═══════════════════════════════════════════════════

    public static class Issue {
        public final String title;
        public final String description;
        public final String fix;
        public final int    line;
        public final String severity;
        public final String file;
        public final double confidence;

        public Issue(String title, String description, String fix,
                     int line, String severity, String file, double confidence) {
            this.title       = title;
            this.description = description;
            this.fix         = fix;
            this.line        = line;
            this.severity    = severity;
            this.file        = file;
            this.confidence  = Math.max(0.0, Math.min(1.0, confidence));
        }

        public String confidenceIcon() {
            return confidence >= 0.85 ? "🟢" : confidence >= 0.60 ? "🟡" : "🔴";
        }

        @Override public String toString() {
            return String.format("[%s] %s %.0f%% س%d: %s",
                severity, confidenceIcon(), confidence * 100, line, title);
        }
    }

    // ═══════════════════════════════════════════════════
    // Entry Point
    // ═══════════════════════════════════════════════════

    public static List<Issue> analyze(String code, String fileName) {
        List<Issue> issues = new ArrayList<>();
        if (code == null || code.isBlank()) return issues;

        String[] lines = code.split("\n");

        detectNullSafety(lines, issues, fileName);
        detectAsyncIssues(lines, issues, fileName);
        detectMemoryLeaks(code, lines, issues, fileName);
        detectPrintStatements(lines, issues, fileName);
        detectEmptyCatch(lines, issues, fileName);
        detectSQLInjection(lines, issues, fileName);
        detectHardcodedStrings(lines, issues, fileName);
        detectMagicNumbers(lines, issues, fileName);
        detectSensitiveLogging(lines, issues, fileName);

        return issues;
    }

    // ═══════════════════════════════════════════════════
    // 1. Null Safety
    // ═══════════════════════════════════════════════════

    private static void detectNullSafety(String[] lines, List<Issue> issues, String file) {
        for (int i = 0; i < lines.length; i++) {
            String t  = lines[i].trim();
            int    ln = i + 1;
            if (t.startsWith("//") || t.startsWith("*")) continue;

            // ! null assertion operator
            if (PAT_NULL_BANG.matcher(t).find() && !t.contains("!=") && !t.contains("!is")) {
                issues.add(new Issue(
                    "! Null assertion — خطر NullPointerException",
                    "استخدم ?. أو تحقق من null أولاً",
                    t.replaceAll("(\\w+)!([;,)\\.])", "$1?$2"),
                    ln, "HIGH", file, 0.85
                ));
            }

            // !! double bang (نادر في Dart لكن ممكن)
            if (PAT_DOUBLE_BANG.matcher(t).find()) {
                issues.add(new Issue(
                    "!! خطير جداً",
                    "استخدم null-aware operators",
                    t.replace("!!", ""),
                    ln, "CRITICAL", file, 0.95
                ));
            }
        }
    }

    // ═══════════════════════════════════════════════════
    // 2. Async Issues
    // ═══════════════════════════════════════════════════

    private static void detectAsyncIssues(String[] lines, List<Issue> issues, String file) {
        boolean inAsyncBlock = false;
        boolean hasAwait     = false;
        int     asyncLine    = -1;

        for (int i = 0; i < lines.length; i++) {
            String t  = lines[i].trim();
            int    ln = i + 1;
            if (t.startsWith("//")) continue;

            // دخلنا async block
            if (PAT_ASYNC_VOID.matcher(t).find() || t.contains("async {") || t.contains("async=>")) {
                inAsyncBlock = true;
                hasAwait     = false;
                asyncLine    = ln;
            }

            if (inAsyncBlock) {
                // await موجود → نسجّل
                if (PAT_CONTEXT_AWAIT.matcher(t).find()) {
                    hasAwait = true;
                }

                // setState بعد await → خطر
                if (hasAwait && PAT_SET_STATE.matcher(t).find()) {
                    // هل فيه mounted check قريبة؟
                    boolean hasMounted = false;
                    for (int j = Math.max(0, i - 3); j < i; j++) {
                        if (PAT_MOUNTED_CHECK.matcher(lines[j]).find()) {
                            hasMounted = true;
                            break;
                        }
                    }
                    if (!hasMounted) {
                        issues.add(new Issue(
                            "setState بعد await بدون mounted check",
                            "Widget قد يكون disposed — تحقق من mounted أولاً",
                            "if (mounted) { " + t + " }",
                            ln, "HIGH", file, 0.88
                        ));
                    }
                }

                // BuildContext بعد await
                if (hasAwait && (t.contains("context.") || t.contains("Navigator.") || t.contains("ScaffoldMessenger."))) {
                    boolean hasMounted = false;
                    for (int j = Math.max(0, i - 3); j < i; j++) {
                        if (PAT_MOUNTED_CHECK.matcher(lines[j]).find()) {
                            hasMounted = true;
                            break;
                        }
                    }
                    if (!hasMounted) {
                        issues.add(new Issue(
                            "استخدام BuildContext بعد await",
                            "Context قد يكون غير صالح — تحقق من mounted",
                            "if (!mounted) return;\n" + t,
                            ln, "HIGH", file, 0.82
                        ));
                    }
                }

                // خرجنا من الـ block
                if (t.equals("}") || t.equals("};")) {
                    inAsyncBlock = false;
                    hasAwait     = false;
                }
            }
        }
    }

    // ═══════════════════════════════════════════════════
    // 3. Memory Leaks
    // ═══════════════════════════════════════════════════

    private static void detectMemoryLeaks(String code, String[] lines,
                                           List<Issue> issues, String file) {
        boolean hasDispose = PAT_DISPOSE.matcher(code).find();

        for (int i = 0; i < lines.length; i++) {
            String t  = lines[i].trim();
            int    ln = i + 1;
            if (t.startsWith("//")) continue;

            // StreamSubscription بدون dispose
            if (PAT_STREAM_SUB.matcher(t).find() && !hasDispose) {
                issues.add(new Issue(
                    "StreamSubscription بدون dispose() — Memory Leak",
                    "أضف cancel() في dispose()",
                    "// في dispose():\n_subscription?.cancel();",
                    ln, "HIGH", file, 0.80
                ));
            }

            // AnimationController بدون dispose
            if (PAT_ANIM_CTRL.matcher(t).find() && !hasDispose) {
                issues.add(new Issue(
                    "AnimationController بدون dispose() — Memory Leak",
                    "أضف dispose() للـ controller",
                    "// في dispose():\n_controller.dispose();",
                    ln, "HIGH", file, 0.83
                ));
            }

            // Timer بدون cancel
            if (t.contains("Timer.periodic(") || t.contains("Timer(")) {
                boolean hasCancel = false;
                for (int j = i + 1; j < Math.min(i + 50, lines.length); j++) {
                    if (lines[j].contains(".cancel()")) { hasCancel = true; break; }
                }
                if (!hasCancel) {
                    issues.add(new Issue(
                        "Timer بدون cancel() — Memory Leak محتمل",
                        "احفظ الـ Timer وأضف cancel() في dispose()",
                        "// في dispose():\n_timer?.cancel();",
                        ln, "MEDIUM", file, 0.72
                    ));
                }
            }
        }
    }

    // ═══════════════════════════════════════════════════
    // 4. Print Statements
    // ═══════════════════════════════════════════════════

    private static void detectPrintStatements(String[] lines, List<Issue> issues, String file) {
        for (int i = 0; i < lines.length; i++) {
            String t  = lines[i].trim();
            int    ln = i + 1;
            if (t.startsWith("//")) continue;

            if (PAT_PRINT.matcher(lines[i]).find()) {
                // لو فيها بيانات حساسة → HIGH، غيره → LOW
                boolean isSensitive = PAT_SENSITIVE_LOG.matcher(t).find();
                issues.add(new Issue(
                    isSensitive ? "print() يكشف بيانات حساسة" : "print() في production code",
                    isSensitive ? "احذف هذا الـ print فوراً" : "استخدم debugPrint() أو kDebugMode",
                    isSensitive ? "// احذف هذا السطر"
                        : "if (kDebugMode) { " + t + " }",
                    ln,
                    isSensitive ? "HIGH" : "LOW",
                    file,
                    isSensitive ? 0.92 : 0.70
                ));
            }
        }
    }

    // ═══════════════════════════════════════════════════
    // 5. Empty Catch
    // ═══════════════════════════════════════════════════

    private static void detectEmptyCatch(String[] lines, List<Issue> issues, String file) {
        for (int i = 0; i < lines.length; i++) {
            String t  = lines[i].trim();
            int    ln = i + 1;
            if (t.startsWith("//")) continue;

            // catch (...) {} في سطر واحد
            if (PAT_EMPTY_CATCH.matcher(t).find()) {
                issues.add(new Issue(
                    "catch فارغ يبتلع الأخطاء",
                    "أضف معالجة أو على الأقل debugPrint",
                    "} catch (e, stackTrace) { debugPrint('Error: $e\\n$stackTrace'); }",
                    ln, "MEDIUM", file, 0.88
                ));
                continue;
            }

            // catch متعدد أسطر فارغ
            if (t.matches("\\}?\\s*catch\\s*\\([^)]*\\)\\s*\\{")) {
                int next = i + 1;
                while (next < lines.length && lines[next].trim().isEmpty()) next++;
                if (next < lines.length && lines[next].trim().equals("}")) {
                    issues.add(new Issue(
                        "catch فارغ (متعدد أسطر)",
                        "أضف معالجة للخطأ",
                        "} catch (e, stackTrace) { debugPrint('Error: $e'); }",
                        ln, "MEDIUM", file, 0.85
                    ));
                }
            }
        }
    }

    // ═══════════════════════════════════════════════════
    // 6. SQL Injection في sqflite
    // ═══════════════════════════════════════════════════

    private static void detectSQLInjection(String[] lines, List<Issue> issues, String file) {
        for (int i = 0; i < lines.length; i++) {
            String t  = lines[i].trim();
            int    ln = i + 1;
            if (t.startsWith("//")) continue;

            if (PAT_SQL_CONCAT.matcher(t).find()) {
                issues.add(new Issue(
                    "SQL Injection في sqflite — String interpolation في Query",
                    "استخدم parameterized queries",
                    "// db.rawQuery('SELECT * FROM t WHERE id = ?', [id])",
                    ln, "CRITICAL", file, 0.95
                ));
            }
        }
    }

    // ═══════════════════════════════════════════════════
    // 7. Hardcoded Strings
    // ═══════════════════════════════════════════════════

    private static void detectHardcodedStrings(String[] lines, List<Issue> issues, String file) {
        for (int i = 0; i < lines.length; i++) {
            String t  = lines[i].trim();
            int    ln = i + 1;
            if (t.startsWith("//") || t.startsWith("*")) continue;

            if (PAT_HARDCODED_STR.matcher(t).find()) {
                issues.add(new Issue(
                    "نص hardcoded في Widget — صعب الترجمة",
                    "استخدم AppLocalizations أو constants",
                    "// Text(AppLocalizations.of(context)!.yourKey)",
                    ln, "LOW", file, 0.65
                ));
            }
        }
    }

    // ═══════════════════════════════════════════════════
    // 8. Magic Numbers
    // ═══════════════════════════════════════════════════

    private static void detectMagicNumbers(String[] lines, List<Issue> issues, String file) {
        Set<String> reported = new HashSet<>();
        for (int i = 0; i < lines.length; i++) {
            String t  = lines[i].trim();
            int    ln = i + 1;
            if (t.startsWith("//") || t.startsWith("const") || t.startsWith("static")) continue;

            Matcher m = PAT_MAGIC_NUM.matcher(t);
            while (m.find()) {
                String num = m.group(1);
                // تجاهل أرقام شائعة
                if (num.equals("100") || num.equals("200") || num.equals("404")
                    || num.equals("500") || num.equals("255") || num.equals("360")) continue;
                if (reported.contains(num)) continue;
                reported.add(num);
                issues.add(new Issue(
                    "Magic number: " + num,
                    "استخدم constant بدل رقم مباشر",
                    "static const int k" + num + " = " + num + ";",
                    ln, "LOW", file, 0.55
                ));
                break; // واحد لكل سطر
            }
        }
    }

    // ═══════════════════════════════════════════════════
    // 9. Sensitive Logging
    // ═══════════════════════════════════════════════════

    private static void detectSensitiveLogging(String[] lines, List<Issue> issues, String file) {
        for (int i = 0; i < lines.length; i++) {
            String t  = lines[i].trim();
            int    ln = i + 1;
            if (t.startsWith("//")) continue;

            boolean isLog = t.contains("debugPrint(") || t.contains("log(")
                || t.contains("logger.") || t.contains("print(");
            if (isLog && PAT_SENSITIVE_LOG.matcher(t).find()) {
                issues.add(new Issue(
                    "تسجيل بيانات حساسة في Log",
                    "احذف هذا الـ log — لا تسجّل passwords أو tokens",
                    "// احذف هذا السطر",
                    ln, "HIGH", file, 0.90
                ));
            }
        }
    }
}
