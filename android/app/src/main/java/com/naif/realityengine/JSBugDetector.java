package com.naif.realityengine;

import java.util.*;
import java.util.regex.*;

public class JSBugDetector {

    public static class JSBug {
        public String title;
        public String description;
        public String fix;
        public int line;
        public String severity;

        public JSBug(String title, String desc, String fix, int line, String sev) {
            this.title = title;
            this.description = desc;
            this.fix = fix;
            this.line = line;
            this.severity = sev;
        }
    }

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

    private static void detectAccumulation(String[] lines, List<JSBug> bugs) {
        Set<String> zeroVars = new HashSet<>();
        boolean inLoop = false;
        Pattern declPat = Pattern.compile("(?:let|var|const|int|double|float)\\s+(\\w+)\\s*=\\s*0");
        String[] vars = {"total","sum","count","revenue","value","amount","price","cost","profit","balance"};

        for (int i = 0; i < lines.length; i++) {
            String t = lines[i].trim();
            if (t.startsWith("//")) { continue; }

            Matcher dm = declPat.matcher(t);
            if (dm.find()) { zeroVars.add(dm.group(1)); }

            if (t.contains(".forEach(") || t.startsWith("for (") || t.startsWith("for(")) {
                inLoop = true;
            }
            if (inLoop && (t.equals("}") || t.equals("});"))) {
                inLoop = false;
            }

            if (inLoop) {
                for (String v : vars) {
                    if (!zeroVars.contains(v)) { continue; }
                    if (t.contains(v + " =") && !t.contains(v + " ==") && !t.contains(v + " +=")) {
                        if (!t.matches(".*(?:let|var|const).*")) {
                            String fix = t.replace(v + " =", v + " +=");
                            bugs.add(new JSBug(
                                "تراكم: " + v + " = بدل +=",
                                "المتغير يُستبدل بدل يُجمع",
                                fix, i + 1, "CRITICAL"));
                        }
                    }
                }
            }
        }
    }

    private static void detectEquality(String[] lines, List<JSBug> bugs) {
        for (int i = 0; i < lines.length; i++) {
            String t = lines[i].trim();
            if (t.startsWith("//") || t.startsWith("*")) { continue; }
            if (t.contains(" == ") && !t.contains("===") && !t.contains("null") && !t.contains("undefined")) {
                String fix = t.replace(" == ", " === ");
                bugs.add(new JSBug(
                    "مقارنة غير دقيقة: == بدل ===",
                    "استخدم === للمقارنة الدقيقة",
                    fix, i + 1, "MEDIUM"));
            }
        }
    }

    private static void detectEmptyCatch(String[] lines, List<JSBug> bugs) {
        for (int i = 0; i < lines.length; i++) {
            String t = lines[i].trim();
            if (t.equals("} catch (e) {}") || t.equals("catch(e){}")) {
                bugs.add(new JSBug(
                    "catch فارغ يخفي الأخطاء",
                    "أضف console.error أو معالجة حقيقية",
                    t.replace("}", "{ console.error(e); }"),
                    i + 1, "HIGH"));
            }
        }
    }

    private static void detectVarUsage(String[] lines, List<JSBug> bugs) {
        for (int i = 0; i < lines.length; i++) {
            String t = lines[i].trim();
            if (t.startsWith("var ") && !t.startsWith("//")) {
                String fix = t.replaceFirst("^var ", "let ");
                bugs.add(new JSBug(
                    "var قديم — استخدم let أو const",
                    "var له مشاكل في الـ scope",
                    fix, i + 1, "LOW"));
            }
        }
    }
}
