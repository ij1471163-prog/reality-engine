package com.naif.realityengine;

import java.util.*;
import java.util.regex.*;

/**
 * BugDetector — كاشف الأخطاء المنطقية الشائعة
 * يكتشف:
 * 1. أخطاء المنطق (= بدل ==، += بدل =)
 * 2. forEach/map بدون return خارجي
 * 3. متغيرات غير معرّفة
 * 4. division by zero محتمل
 * 5. null/undefined checks ناقصة
 * 6. infinite loops محتملة
 * 7. أخطاء شائعة في Python وJS وJava
 */
public class BugDetector {

    public enum Severity { CRITICAL, HIGH, MEDIUM, LOW }

    public static class Bug {
        public String title;
        public String description;
        public String evidence;
        public String fix;
        public int line;
        public Severity severity;

        public Bug(String title, String desc, String evidence, String fix, int line, Severity sev) {
            this.title = title;
            this.description = desc;
            this.evidence = evidence;
            this.fix = fix;
            this.line = line;
            this.severity = sev;
        }
    }

    public static class BugReport {
        public List<Bug> bugs = new ArrayList<>();
        public String language = "unknown";
        public int score = 100; // 100 = no bugs

        public void addBug(Bug b) {
            bugs.add(b);
            score -= b.severity == Severity.CRITICAL ? 25
                   : b.severity == Severity.HIGH ? 15
                   : b.severity == Severity.MEDIUM ? 8 : 3;
            score = Math.max(0, score);
        }
    }

    // ═══════════════════════════════════════════════════
    // الكشف الرئيسي
    // ═══════════════════════════════════════════════════

    public static BugReport detect(String code) {
        BugReport report = new BugReport();
        report.language = detectLanguage(code);
        String[] lines = code.split("\\n");

        // كشف عام لكل اللغات
        detectAssignmentInCondition(code, lines, report);
        detectDivisionByZero(code, lines, report);
        detectInfiniteLoop(code, lines, report);
        detectEmptyErrorHandling(code, lines, report);

        // كشف حسب اللغة
        if (report.language.equals("javascript") || report.language.equals("typescript")) {
            detectJSBugs(code, lines, report);
        } else if (report.language.equals("python")) {
            detectPythonBugs(code, lines, report);
        } else if (report.language.equals("java")) {
            detectJavaBugs(code, lines, report);
        }

        return report;
    }

    // ═══════════════════════════════════════════════════
    // كشف اللغة
    // ═══════════════════════════════════════════════════

    private static String detectLanguage(String code) {
        if (code.contains("function ") || code.contains("const ") || code.contains("let ") || code.contains("=>")) return "javascript";
        if (code.contains("def ") && code.contains("import ")) return "python";
        if (code.contains("def ") || code.contains("pass") || code.contains("elif ")) return "python";
        if (code.contains("public class") || code.contains("private ") || code.contains("System.out")) return "java";
        return "unknown";
    }

    // ═══════════════════════════════════════════════════
    // أخطاء عامة
    // ═══════════════════════════════════════════════════

    // = بدل == في if/while
    private static void detectAssignmentInCondition(String code, String[] lines, BugReport report) {
        Pattern p = Pattern.compile("\\b(if|while)\\s*\\(([^)]*[^=!<>])=([^=][^)]*)\\)");
        for (int i = 0; i < lines.length; i++) {
            Matcher m = p.matcher(lines[i]);
            if (m.find() && !lines[i].trim().startsWith("//") && !lines[i].trim().startsWith("#")) {
                report.addBug(new Bug(
                    "تعيين داخل شرط",
                    "استخدام = بدل == في شرط — يعيّن قيمة بدل مقارنة",
                    lines[i].trim(),
                    lines[i].trim().replace(m.group(), m.group().replace("=", "==")),
                    i + 1, Severity.HIGH
                ));
            }
        }
    }

    // قسمة على صفر محتملة
    private static void detectDivisionByZero(String code, String[] lines, BugReport report) {
        Pattern p = Pattern.compile("/\\s*(\\w+)");
        for (int i = 0; i < lines.length; i++) {
            String line = lines[i];
            if (line.trim().startsWith("//") || line.trim().startsWith("#")) continue;
            Matcher m = p.matcher(line);
            while (m.find()) {
                String numerator = m.group(1);
                String divisor = m.group(2);
                // تجاهل: أرقام ثابتة، keywords، CSS values
                if (divisor.matches("\\d+") || divisor.length() <= 1) continue;
                if (divisor.equals("len") || divisor.equals("length") || divisor.equals("size")) continue;
                // لازم يكون في سياق حساب حقيقي
                if (!line.contains("=") && !line.contains("return")) continue;
                boolean hasCheck = code.contains("if " + divisor + " != 0")
                    || code.contains("if " + divisor + " > 0")
                    || code.contains("if len(" + divisor)
                    || code.contains("if " + divisor + ":");
                if (!hasCheck) {
                    report.addBug(new Bug(
                        "قسمة على صفر محتملة",
                        "القسمة على '" + divisor + "' بدون التحقق أنه ليس صفراً",
                        line.trim(),
                        "if " + divisor + " != 0:\n    " + line.trim(),
                        i + 1, Severity.MEDIUM
                    ));
                    break;
                }
            }
        }
    }

    // حلقة لا نهائية محتملة
    private static void detectInfiniteLoop(String code, String[] lines, BugReport report) {
        Pattern whilePat = Pattern.compile("while\\s*\\(\\s*true\\s*\\)|while\\s+True:");
        for (int i = 0; i < lines.length; i++) {
            if (whilePat.matcher(lines[i]).find()) {
                // تحقق إن فيه break داخل الحلقة
                boolean hasBreak = false;
                for (int j = i+1; j < Math.min(i+20, lines.length); j++) {
                    if (lines[j].contains("break")) { hasBreak = true; break; }
                    if (j > i+1 && lines[j].trim().startsWith("def ")) break;
                }
                if (!hasBreak) {
                    report.addBug(new Bug(
                        "حلقة لا نهائية",
                        "while True بدون break — قد تُجمّد البرنامج",
                        lines[i].trim(),
                        "أضف break أو شرط خروج",
                        i + 1, Severity.CRITICAL
                    ));
                }
            }
        }
    }

    // catch/except فارغ
    private static void detectEmptyErrorHandling(String code, String[] lines, BugReport report) {
        for (int i = 0; i < lines.length - 1; i++) {
            String line = lines[i].trim();
            String next = i+1 < lines.length ? lines[i+1].trim() : "";
            boolean isEmptyCatch = (line.startsWith("except:") || line.startsWith("catch (") || line.equals("catch(e)"))
                && (next.equals("pass") || next.equals("{}") || next.isEmpty());
            if (isEmptyCatch) {
                report.addBug(new Bug(
                    "معالجة أخطاء فارغة",
                    "catch/except بدون معالجة — الأخطاء تُخفى",
                    line,
                    "أضف logging أو معالجة مناسبة للخطأ",
                    i + 1, Severity.MEDIUM
                ));
            }
        }
    }

    // ═══════════════════════════════════════════════════
    // أخطاء JavaScript
    // ═══════════════════════════════════════════════════

    private static void detectJSBugs(String code, String[] lines, BugReport report) {

        // forEach/map/filter بدون return خارج
        detectForEachWithReturn(code, lines, report);

        // == بدل ===
        detectLooseEquality(code, lines, report);

        // var بدل let/const
        detectVarUsage(code, lines, report);

        // async بدون await
        detectAsyncWithoutAwait(code, lines, report);

        // undefined check ناقص
        detectMissingNullCheck(code, lines, report);

        // += بدل = في accumulator
        detectMissingAccumulation(code, lines, report);
    }

    private static void detectForEachWithReturn(String code, String[] lines, BugReport report) {
        Pattern forEach = Pattern.compile("\\.(forEach|map|filter|find)\\s*\\(");
        for (int i = 0; i < lines.length; i++) {
            Matcher m = forEach.matcher(lines[i]);
            if (m.find()) {
                String method = m.group(1);
                // تحقق forEach مع return داخلها — هذا خطأ شائع
                if (method.equals("forEach")) {
                    for (int j = i; j < Math.min(i+5, lines.length); j++) {
                        if (lines[j].contains("return ") && !lines[j].trim().startsWith("//")) {
                            // return داخل forEach لا يعمل كما يتوقع المطور
                            String outerFunc = findContainingFunction(lines, i);
                            if (outerFunc != null) {
                                report.addBug(new Bug(
                                    "return داخل forEach لا يعمل",
                                    "return داخل forEach لا يُرجع قيمة للدالة الخارجية — استخدم find() أو for...of",
                                    lines[j].trim(),
                                    "استخدم: return array.find(item => condition) بدل forEach",
                                    j + 1, Severity.HIGH
                                ));
                            }
                            break;
                        }
                    }
                }
            }
        }
    }

    private static void detectLooseEquality(String code, String[] lines, BugReport report) {
        Pattern p = Pattern.compile("[^=!<>]==(?!=)[^=]|[^=!<>]!=(?!=)[^=]");
        for (int i = 0; i < lines.length; i++) {
            if (lines[i].trim().startsWith("//")) continue;
            Matcher m = p.matcher(lines[i]);
            if (m.find()) {
                report.addBug(new Bug(
                    "مقارنة غير صارمة ==",
                    "استخدام == بدل === يمكن أن يسبب مقارنة خاطئة بين أنواع مختلفة",
                    lines[i].trim(),
                    lines[i].trim().replaceAll("([^=!<>])==([^=])", "$1===$2"),
                    i + 1, Severity.MEDIUM
                ));
            }
        }
    }

    private static void detectVarUsage(String code, String[] lines, BugReport report) {
        Pattern p = Pattern.compile("^\\s*var\\s+\\w+");
        for (int i = 0; i < lines.length; i++) {
            if (p.matcher(lines[i]).find()) {
                report.addBug(new Bug(
                    "استخدام var",
                    "var لها مشاكل في الـ scope — استخدم let أو const",
                    lines[i].trim(),
                    lines[i].trim().replaceFirst("var ", "const "),
                    i + 1, Severity.LOW
                ));
            }
        }
    }

    private static void detectAsyncWithoutAwait(String code, String[] lines, BugReport report) {
        for (int i = 0; i < lines.length; i++) {
            if (lines[i].contains("async function") || lines[i].contains("async (")) {
                // تحقق إن فيه await داخل الدالة
                boolean hasAwait = false;
                for (int j = i+1; j < Math.min(i+30, lines.length); j++) {
                    if (lines[j].contains("await ")) { hasAwait = true; break; }
                    if (j > i+1 && (lines[j].trim().startsWith("function ") || lines[j].trim().startsWith("async "))) break;
                }
                if (!hasAwait) {
                    report.addBug(new Bug(
                        "async بدون await",
                        "دالة async بدون await — لا فائدة من async هنا",
                        lines[i].trim(),
                        "أزل async أو أضف await للعمليات غير المتزامنة",
                        i + 1, Severity.LOW
                    ));
                }
            }
        }
    }

    private static void detectMissingNullCheck(String code, String[] lines, BugReport report) {
        Pattern accessPat = Pattern.compile("(\\w+)\\.(\\w+)");
        for (int i = 0; i < lines.length; i++) {
            if (lines[i].trim().startsWith("//")) continue;
            Matcher m = accessPat.matcher(lines[i]);
            while (m.find()) {
                String obj = m.group(1);
                // تحقق إن الكائن قد يكون null
                if (code.contains(obj + " = null") || code.contains(obj + " = undefined")
                        || code.contains(obj + " = find(") || code.contains(obj + " = findProduct(")
                        || code.contains(obj + " = getUser(")) {
                    boolean hasCheck = code.contains("if (" + obj + ")")
                        || code.contains("if (" + obj + " !=")
                        || code.contains(obj + "?.");
                    if (!hasCheck) {
                        report.addBug(new Bug(
                            "وصول بدون فحص null",
                            "'" + obj + "' قد يكون null — وصول مباشر يسبب TypeError",
                            lines[i].trim(),
                            "if (" + obj + ") { " + lines[i].trim() + " }",
                            i + 1, Severity.HIGH
                        ));
                        break;
                    }
                }
            }
        }
    }

    private static void detectMissingAccumulation(String code, String[] lines, BugReport report) {
        // total = x بدل total += x داخل loop
        Pattern totalPat = Pattern.compile("^\\s*(total|sum|count|result)\\s*=\\s*(?!0|null|\\[|\\{)[^=\\+\\-]");
        for (int i = 0; i < lines.length; i++) {
            Matcher m = totalPat.matcher(lines[i]);
            if (m.find()) {
                // تحقق إن هذا السطر داخل loop
                boolean inLoop = false;
                for (int j = Math.max(0, i-5); j < i; j++) {
                    if (lines[j].contains("forEach") || lines[j].contains("for (")
                            || lines[j].contains("for(") || lines[j].contains("while")) {
                        inLoop = true; break;
                    }
                }
                if (inLoop) {
                    String varName = m.group(1);
                    report.addBug(new Bug(
                        "خطأ في التراكم",
                        "'" + varName + " = x' داخل loop بدل '" + varName + " += x' — يُعيّن بدل أن يتراكم",
                        lines[i].trim(),
                        lines[i].trim().replaceFirst(varName + "\\s*=\\s*", varName + " += "),
                        i + 1, Severity.CRITICAL
                    ));
                }
            }
        }
    }

    // ═══════════════════════════════════════════════════
    // أخطاء Python
    // ═══════════════════════════════════════════════════

    private static void detectPythonBugs(String code, String[] lines, BugReport report) {

        // مقارنة بـ None بدون is
        detectNoneComparison(code, lines, report);

        // mutable default argument
        detectMutableDefault(code, lines, report);

        // list كـ set (بحث بطيء)
        detectSlowSearch(code, lines, report);

        // string concatenation في loop
        detectStringConcatInLoop(code, lines, report);

        // bare except
        detectBareExcept(code, lines, report);

        // تعديل list أثناء iteration
        detectModifyDuringIteration(code, lines, report);
    }

    private static void detectNoneComparison(String code, String[] lines, BugReport report) {
        Pattern p = Pattern.compile("(==|!=)\\s*None|None\\s*(==|!=)");
        for (int i = 0; i < lines.length; i++) {
            if (lines[i].trim().startsWith("#")) continue;
            Matcher m = p.matcher(lines[i]);
            if (m.find()) {
                report.addBug(new Bug(
                    "مقارنة None بـ ==",
                    "استخدم 'is None' أو 'is not None' بدل '== None'",
                    lines[i].trim(),
                    lines[i].trim().replace("== None", "is None").replace("!= None", "is not None"),
                    i + 1, Severity.MEDIUM
                ));
            }
        }
    }

    private static void detectMutableDefault(String code, String[] lines, BugReport report) {
        Pattern p = Pattern.compile("def\\s+\\w+\\s*\\([^)]*=\\s*(\\[|\\{)");
        for (int i = 0; i < lines.length; i++) {
            Matcher m = p.matcher(lines[i]);
            if (m.find()) {
                report.addBug(new Bug(
                    "Mutable Default Argument",
                    "استخدام list أو dict كقيمة افتراضية — يُشارك بين كل استدعاءات الدالة",
                    lines[i].trim(),
                    "استخدم None كافتراضي ثم: if arg is None: arg = []",
                    i + 1, Severity.HIGH
                ));
            }
        }
    }

    private static void detectSlowSearch(String code, String[] lines, BugReport report) {
        // ابحث عن "x in list_var" حيث list_var معرّفة كـ list كبيرة
        Pattern inPat = Pattern.compile("\\bif\\s+(\\w+)\\s+in\\s+(\\w+)");
        for (int i = 0; i < lines.length; i++) {
            Matcher m = inPat.matcher(lines[i]);
            if (m.find()) {
                String container = m.group(2);
                // تحقق إن الـ container list كبيرة (فيها عناصر كثيرة)
                int listSize = countListElements(code, container);
                if (listSize > 10) {
                    report.addBug(new Bug(
                        "بحث بطيء في قائمة كبيرة",
                        "البحث في list بـ 'in' بطيء O(n) — استخدم set للبحث السريع O(1)",
                        lines[i].trim(),
                        container + "_set = set(" + container + ")  # أضف هذا مرة واحدة\nif " + m.group(1) + " in " + container + "_set:",
                        i + 1, Severity.LOW
                    ));
                }
            }
        }
    }

    private static void detectStringConcatInLoop(String code, String[] lines, BugReport report) {
        boolean inLoop = false;
        for (int i = 0; i < lines.length; i++) {
            String t = lines[i].trim();
            if (t.startsWith("for ") || t.startsWith("while ")) inLoop = true;
            if (inLoop && t.matches("\\w+\\s*\\+=\\s*['\"].*['\"].*") ) {
                report.addBug(new Bug(
                    "تجميع strings داخل loop",
                    "strings += داخل loop بطيء — استخدم list.append ثم ''.join()",
                    t,
                    "parts = []\nfor ...: parts.append(item)\nresult = ''.join(parts)",
                    i + 1, Severity.MEDIUM
                ));
                inLoop = false;
            }
            if (t.isEmpty()) inLoop = false;
        }
    }

    private static void detectBareExcept(String code, String[] lines, BugReport report) {
        for (int i = 0; i < lines.length; i++) {
            if (lines[i].trim().equals("except:")) {
                report.addBug(new Bug(
                    "Bare except",
                    "'except:' بدون نوع Exception — يمسك كل الأخطاء بما فيها KeyboardInterrupt",
                    "except:",
                    "except Exception as e:",
                    i + 1, Severity.MEDIUM
                ));
            }
        }
    }

    private static void detectModifyDuringIteration(String code, String[] lines, BugReport report) {
        for (int i = 0; i < lines.length; i++) {
            Pattern forPat = Pattern.compile("for\\s+(\\w+)\\s+in\\s+(\\w+)");
            Matcher m = forPat.matcher(lines[i]);
            if (m.find()) {
                String collection = m.group(2);
                // تحقق إن فيه remove/append على نفس الـ collection داخل الحلقة
                for (int j = i+1; j < Math.min(i+10, lines.length); j++) {
                    if (lines[j].contains(collection + ".remove(") || lines[j].contains(collection + ".append(")) {
                        report.addBug(new Bug(
                            "تعديل قائمة أثناء iteration",
                            "تعديل '" + collection + "' داخل for loop يسبب سلوك غير متوقع",
                            lines[j].trim(),
                            "استخدم نسخة: for item in " + collection + ".copy():",
                            j + 1, Severity.HIGH
                        ));
                        break;
                    }
                }
            }
        }
    }

    // ═══════════════════════════════════════════════════
    // أخطاء Java
    // ═══════════════════════════════════════════════════

    private static void detectJavaBugs(String code, String[] lines, BugReport report) {

        // == لمقارنة Strings
        detectStringEqualityWithEquals(code, lines, report);

        // NullPointerException محتمل
        detectNPE(code, lines, report);

        // resource leak
        detectResourceLeak(code, lines, report);
    }

    private static void detectStringEqualityWithEquals(String code, String[] lines, BugReport report) {
        Pattern p = Pattern.compile("\"[^\"]*\"\\s*==|==\\s*\"[^\"]*\"");
        for (int i = 0; i < lines.length; i++) {
            if (lines[i].trim().startsWith("//")) continue;
            if (p.matcher(lines[i]).find()) {
                report.addBug(new Bug(
                    "مقارنة String بـ ==",
                    "مقارنة Strings بـ == تقارن المرجع لا القيمة — استخدم .equals()",
                    lines[i].trim(),
                    lines[i].trim().replace("==", ".equals(") + ")",
                    i + 1, Severity.CRITICAL
                ));
            }
        }
    }

    private static void detectNPE(String code, String[] lines, BugReport report) {
        Pattern callPat = Pattern.compile("(\\w+)\\.(\\w+)\\(");
        for (int i = 0; i < lines.length; i++) {
            if (lines[i].trim().startsWith("//")) continue;
            Matcher m = callPat.matcher(lines[i]);
            while (m.find()) {
                String obj = m.group(1);
                if (code.contains(obj + " = null") || code.contains("Optional<")) {
                    boolean hasCheck = code.contains("if (" + obj + " != null)")
                        || code.contains(obj + " != null &&");
                    if (!hasCheck) {
                        report.addBug(new Bug(
                            "NullPointerException محتمل",
                            "'" + obj + "' قد يكون null — أضف فحص قبل الاستخدام",
                            lines[i].trim(),
                            "if (" + obj + " != null) { " + lines[i].trim() + " }",
                            i + 1, Severity.HIGH
                        ));
                        break;
                    }
                }
            }
        }
    }

    private static void detectResourceLeak(String code, String[] lines, BugReport report) {
        Pattern openPat = Pattern.compile("new\\s+(FileInputStream|FileOutputStream|BufferedReader|Connection|Socket)");
        for (int i = 0; i < lines.length; i++) {
            Matcher m = openPat.matcher(lines[i]);
            if (m.find()) {
                boolean hasTryResources = code.contains("try (") || code.contains("try(");
                boolean hasClose = code.contains(".close()");
                if (!hasTryResources && !hasClose) {
                    report.addBug(new Bug(
                        "Resource Leak محتمل",
                        m.group(1) + " مفتوح بدون close() — استخدم try-with-resources",
                        lines[i].trim(),
                        "try (" + m.group(1) + " resource = new " + m.group(1) + "()) { ... }",
                        i + 1, Severity.HIGH
                    ));
                }
            }
        }
    }

    // ═══════════════════════════════════════════════════
    // مساعدات
    // ═══════════════════════════════════════════════════

    private static String findContainingFunction(String[] lines, int lineIndex) {
        for (int i = lineIndex; i >= 0; i--) {
            if (lines[i].trim().startsWith("function ") || lines[i].contains("function(")
                    || lines[i].trim().startsWith("def ")) {
                return lines[i].trim();
            }
        }
        return null;
    }

    private static int countListElements(String code, String varName) {
        Pattern p = Pattern.compile(Pattern.quote(varName) + "\\s*=\\s*\\[([^\\]]+)\\]");
        Matcher m = p.matcher(code);
        if (m.find()) {
            return m.group(1).split(",").length;
        }
        return 0;
    }


    // ═══════════════════════════════════════════════════
    // إصلاح تلقائي للأخطاء المكتشفة
    // ═══════════════════════════════════════════════════

    public static String autoFix(String code, BugReport report) {
        String[] lines = code.split("\n");
        String[] fixed = lines.clone();
        boolean changed = false;

        for (Bug bug : report.bugs) {
            int idx = bug.line - 1;
            if (idx < 0 || idx >= fixed.length) continue;

            // صلح: = بدل += في accumulator
            if (bug.title.contains("التراكم")) {
                String line = fixed[idx];
                String fixedLine = line.replaceFirst(
                    "^(\\s*)(total|sum|count|result)\\s*=\\s*(.+)",
                    "$1$2 += $3"
                );
                if (!fixedLine.equals(line)) {
                    fixed[idx] = fixedLine;
                    changed = true;
                }
            }

            // صلح: forEach → find لو فيه return
            if (bug.title.contains("forEach")) {
                for (int i = Math.max(0, idx - 5); i < idx; i++) {
                    if (fixed[i].contains(".forEach(")) {
                        fixed[i] = fixed[i].replace(".forEach(", ".find(");
                        changed = true;
                        break;
                    }
                }
            }

            // صلح: == → === في JavaScript
            if (bug.title.contains("مقارنة غير صارمة")) {
                fixed[idx] = fixed[idx].replaceAll("([^=!<>])==([^=])", "$1===$2");
                changed = true;
            }

            // صلح: var → const
            if (bug.title.contains("استخدام var")) {
                fixed[idx] = fixed[idx].replaceFirst("var ", "const ");
                changed = true;
            }

            // صلح: == None → is None في Python
            if (bug.title.contains("مقارنة None")) {
                fixed[idx] = fixed[idx].replace("== None", "is None").replace("!= None", "is not None");
                changed = true;
            }
        }

        return changed ? String.join("\n", fixed) : null;
    }
}
}
}
}
}
}
}
