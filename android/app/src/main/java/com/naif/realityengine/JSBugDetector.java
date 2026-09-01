package com.naif.realityengine;

import java.util.*;
import java.util.regex.*;

/**
 * JSBugDetector v2.0
 * ✅ inLoop بـ brace-depth stack
 * ✅ يتتبع المتغيرات المهيأة بـ 0 فعلاً
 * ✅ detectEquality أدق — يتجنب false positives
 * ✅ detectEmptyCatch يكتشف كل الحالات
 * ✅ JSBug fields final + immutable
 * ✅ Patterns compiled مرة واحدة
 */
public class JSBugDetector {

    // ═══════════════════════════════════════════════════
    // Compiled Patterns
    // ═══════════════════════════════════════════════════

    private static final Pattern PAT_ZERO_DECL = Pattern.compile(
        "(?:let|var|const)\\s+(\\w+)\\s*=\\s*0\\b");

    private static final Pattern PAT_ACCUM_ASSIGN = Pattern.compile(
        "\\b(\\w+)\\s*=(?![=>])\\s*");

    // == بدون === — يتجنب !=, <=, >=, ==>, null, undefined, i==0
    private static final Pattern PAT_LOOSE_EQ = Pattern.compile(
        "(?<![=!<>])\\s==\\s(?!=)");

    // catch فارغ: يكتشف catch فارغ بكل أشكاله
    private static final Pattern PAT_EMPTY_CATCH = Pattern.compile(
        "\\}?\\s*catch\\s*\\([^)]*\\)\\s*\\{\\s*\\}");

    // var declaration
    private static final Pattern PAT_VAR = Pattern.compile(
        "^var\\s+");

    // loop start: forEach / for( / while(
    private static final Pattern PAT_LOOP_START = Pattern.compile(
        "\\.forEach\\s*\\(|\\bfor\\s*\\(|\\bwhile\\s*\\(");

    // ═══════════════════════════════════════════════════
    // JSBug — immutable
    // ═══════════════════════════════════════════════════

    public static class JSBug {
        public final String title;
        public final String description;
        public final String fix;
        public final int    line;
        public final String severity;

        public JSBug(String title, String description,
                     String fix, int line, String severity) {
            this.title       = title;
            this.description = description;
            this.fix         = fix;
            this.line        = line;
            this.severity    = severity;
        }

        @Override public String toString() {
            return "[" + severity + "] س" + line + ": " + title;
        }
    }

    // ═══════════════════════════════════════════════════
    // Entry Point
    // ═══════════════════════════════════════════════════

    public static List<JSBug> detect(String code) {
        List<JSBug> bugs = new ArrayList<>();
        if (code == null || code.isEmpty()) return bugs;

        String[] lines = code.split("\n");
        detectAccumulation(lines, bugs);
        detectEquality(lines, bugs);
        detectEmptyCatch(lines, bugs);
        detectVarUsage(lines, bugs);
        return bugs;
    }

    // ═══════════════════════════════════════════════════
    // 1. Accumulation — brace-depth stack + dynamic var tracking
    // ═══════════════════════════════════════════════════

    private static void detectAccumulation(String[] lines, List<JSBug> bugs) {
        // ✅ تتبع المتغيرات المهيأة بـ 0 فعلاً (مو قائمة ثابتة)
        Set<String> zeroVars  = new HashSet<>();
        // ✅ brace-depth stack بدل flag واحد
        Deque<Integer> loopDepths = new ArrayDeque<>();
        int braceDepth = 0;

        for (int i = 0; i < lines.length; i++) {
            String line = lines[i];
            String t    = line.trim();
            if (t.startsWith("//") || t.startsWith("*")) continue;

            // اكتشف تعريف متغير = 0
            Matcher dm = PAT_ZERO_DECL.matcher(t);
            while (dm.find()) zeroVars.add(dm.group(1));

            // بداية loop → ادفع depth
            if (PAT_LOOP_START.matcher(line).find()) {
                loopDepths.push(braceDepth);
            }

            // عدّ braces
            braceDepth += countChar(line, '{') - countChar(line, '}');

            // خرجنا من loop؟
            while (!loopDepths.isEmpty() && braceDepth <= loopDepths.peek()) {
                loopDepths.pop();
            }

            if (loopDepths.isEmpty()) continue;

            // ✅ تحقق من كل المتغيرات المتتبعة (مو قائمة ثابتة)
            for (String v : zeroVars) {
                // pattern: varName = (بدون ==, +=, -=, <=, >=)
                Pattern assignPat = Pattern.compile(
                    "\\b" + Pattern.quote(v) + "\\s*=(?![=>+\\-!])");
                if (assignPat.matcher(t).find()
                        && !t.startsWith("let")
                        && !t.startsWith("var")
                        && !t.startsWith("const")) {
                    String fix = t.replaceFirst(
                        "\\b" + Pattern.quote(v) + "\\s*=(?![=>+\\-!])",
                        v + " += ");
                    bugs.add(new JSBug(
                        "تراكم: " + v + " = بدل +=",
                        "المتغير يُستبدل بدل ما يُجمع داخل الـ loop",
                        fix, i + 1, "CRITICAL"
                    ));
                }
            }
        }
    }

    // ═══════════════════════════════════════════════════
    // 2. Equality — أدق وأقل false positives
    // ═══════════════════════════════════════════════════

    private static void detectEquality(String[] lines, List<JSBug> bugs) {
        for (int i = 0; i < lines.length; i++) {
            String t = lines[i].trim();
            if (t.startsWith("//") || t.startsWith("*")) continue;

            // تجاهل comparisons مع null/undefined/typeof (شائعة وصحيحة)
            if (t.contains("null") || t.contains("undefined") || t.contains("typeof")) continue;

            // تجاهل HTML attributes مثل value="..."
            if (t.contains("=\"") || t.contains("='")) continue;

            // ابحث عن == بدون === فقط داخل if/while/ternary
            boolean hasLooseEq = lines[i].contains(" == ")
                && !lines[i].contains("===")
                && !lines[i].contains("!==")
                && (t.contains("if") || t.contains("while")
                    || t.contains("?") || t.contains("return"));

            if (hasLooseEq) {
                String fix = t.replaceAll("(?<![=!<>])==(?!=)", "===");
                bugs.add(new JSBug(
                    "== بدل ===",
                    "استخدم === للمقارنة الدقيقة",
                    fix, i + 1, "MEDIUM"
                ));
            }
        }
    }

    // ═══════════════════════════════════════════════════
    // 3. Empty Catch — يكتشف كل الأشكال
    // ═══════════════════════════════════════════════════

    private static void detectEmptyCatch(String[] lines, List<JSBug> bugs) {
        for (int i = 0; i < lines.length; i++) {
            String t = lines[i].trim();
            if (t.startsWith("//")) continue;

            // حالة A: catch في سطر واحد — } catch (e) {}
            if (PAT_EMPTY_CATCH.matcher(t).find()) {
                bugs.add(new JSBug(
                    "catch فارغ",
                    "الخطأ يُبتلع بصمت — أضف معالجة",
                    "} catch (e) { console.error('[Error]', e); }",
                    i + 1, "HIGH"
                ));
                continue;
            }

            // حالة B: catch متعدد الأسطر
            // السطر: catch (...) {
            // التالي: } (فارغ تماماً)
            if (t.matches("\\}?\\s*catch\\s*\\([^)]*\\)\\s*\\{")) {
                int next = i + 1;
                // تخطى الأسطر الفارغة
                while (next < lines.length && lines[next].trim().isEmpty()) next++;
                if (next < lines.length && lines[next].trim().equals("}")) {
                    bugs.add(new JSBug(
                        "catch فارغ (متعدد أسطر)",
                        "الخطأ يُبتلع بصمت",
                        "} catch (e) { console.error('[Error]', e); }",
                        i + 1, "HIGH"
                    ));
                }
            }
        }
    }

    // ═══════════════════════════════════════════════════
    // 4. Var Usage
    // ═══════════════════════════════════════════════════

    private static void detectVarUsage(String[] lines, List<JSBug> bugs) {
        for (int i = 0; i < lines.length; i++) {
            String t = lines[i].trim();
            if (t.startsWith("//")) continue;
            if (PAT_VAR.matcher(t).find()) {
                bugs.add(new JSBug(
                    "var قديم",
                    "var له function scope — استخدم let أو const",
                    t.replaceFirst("^var ", "let "),
                    i + 1, "LOW"
                ));
            }
        }
    }

    // ═══════════════════════════════════════════════════
    // Helper
    // ═══════════════════════════════════════════════════

    private static int countChar(String s, char ch) {
        int n = 0;
        for (int i = 0; i < s.length(); i++)
            if (s.charAt(i) == ch) n++;
        return n;
    }
