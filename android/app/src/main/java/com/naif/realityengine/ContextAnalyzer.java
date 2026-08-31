package com.naif.realityengine;

import java.util.*;
import java.util.regex.*;

/**
 * ContextAnalyzer v3.0
 * ✅ Context extraction
 * ✅ Scope analysis
 * ✅ Import analysis
 * ✅ Variable tracking   — تتبع تعريف واستخدام كل متغير
 * ✅ Call graph          — من يستدعي من داخل الـ scope
 * ✅ Data flow           — تتبع تحويلات القيمة من مصدر لاستخدام
 */
public class ContextAnalyzer {

    // ═══════════════════════════════════════════════════
    // Compiled Patterns (مرة واحدة)
    // ═══════════════════════════════════════════════════

    private static final Pattern PAT_IMPORT      = Pattern.compile("^(?:import|from)\\s+(.+)", Pattern.MULTILINE);
    private static final Pattern PAT_CLASS       = Pattern.compile("^(class\\s+(\\w+))", Pattern.MULTILINE);
    private static final Pattern PAT_DEF         = Pattern.compile("^(\\s*)def\\s+(\\w+)\\s*\\(([^)]*)\\)", Pattern.MULTILINE);
    private static final Pattern PAT_CLASS_BODY  = Pattern.compile("^class\\s+\\w+", Pattern.MULTILINE);

    // Variable tracking
    private static final Pattern PAT_VAR_ASSIGN  = Pattern.compile(
        "^([ \\t]*)(\\w+)\\s*=\\s*(.+)$", Pattern.MULTILINE);
    private static final Pattern PAT_AUG_ASSIGN  = Pattern.compile(
        "^([ \\t]*)(\\w+)\\s*(\\+=|-=|\\*=|/=)\\s*(.+)$", Pattern.MULTILINE);
    private static final Pattern PAT_FOR_VAR     = Pattern.compile(
        "for\\s+(\\w+(?:\\s*,\\s*\\w+)*)\\s+in\\s+(\\w+)", Pattern.MULTILINE);

    // Call graph
    private static final Pattern PAT_CALL        = Pattern.compile(
        "(?<!['\"])\\b(\\w+)\\s*\\(([^)]*)\\)", Pattern.MULTILINE);
    private static final Pattern PAT_METHOD_CALL = Pattern.compile(
        "\\b(\\w+)\\.(\\w+)\\s*\\(([^)]*)\\)", Pattern.MULTILINE);

    // Data flow
    private static final Pattern PAT_RETURN      = Pattern.compile(
        "^[ \\t]*return\\s+(.+)$", Pattern.MULTILINE);
    private static final Pattern PAT_CONDITION   = Pattern.compile(
        "(?:if|elif|while)\\s+(.+?):", Pattern.MULTILINE);

    // ═══════════════════════════════════════════════════
    // CodeContext
    // ═══════════════════════════════════════════════════

    // ── Variable: تعريف متغير واحد ─────────────────────
    public static class VarDefinition {
        public final String name;
        public final String value;     // الجانب الأيمن من التعريف
        public final int    line;
        public final String source;    // "assign" | "for_loop" | "aug_assign" | "param"
        public VarDefinition(String name, String value, int line, String source) {
            this.name = name; this.value = value; this.line = line; this.source = source;
        }
        @Override public String toString() {
            return "[L" + line + "] " + source + ": " + name + " = " + value;
        }
    }

    // ── Call graph: استدعاء واحد ─────────────────────────
    public static class CallEdge {
        public final String caller;
        public final String callee;
        public final String args;
        public final int    line;
        public final boolean isMethod; // obj.method() vs func()
        public CallEdge(String caller, String callee, String args, int line, boolean isMethod) {
            this.caller = caller; this.callee = callee;
            this.args = args; this.line = line; this.isMethod = isMethod;
        }
        @Override public String toString() {
            return caller + " → " + callee + "(" + args + ")" + (isMethod ? " [method]" : "");
        }
    }

    // ── Data flow: تحويل قيمة ──────────────────────────
    public static class FlowNode {
        public enum Kind { SOURCE, TRANSFORM, CONDITION, RETURN, UNKNOWN }
        public final String name;
        public final String expression;
        public final int    line;
        public final Kind   kind;
        public FlowNode(String name, String expression, int line, Kind kind) {
            this.name = name; this.expression = expression;
            this.line = line; this.kind = kind;
        }
        @Override public String toString() {
            return "[L" + line + "] " + kind + ": " + name + " ← " + expression;
        }
    }

    // ── CodeContext الرئيسي ──────────────────────────────
    public static class CodeContext {
        public List<String>              imports        = new ArrayList<>();
        public List<String>              classes        = new ArrayList<>();
        public boolean                   isInsideClass  = false;
        public Map<String, List<String>> functionParams = new LinkedHashMap<>();

        // per-param confidence
        public Map<String, Map<String, Double>> allParamConfidence = new LinkedHashMap<>();
        public Map<String, String>              paramDominantType  = new LinkedHashMap<>();

        // للتوافق مع الكود القديم
        public Map<String, Double> typeConfidence = new HashMap<>();
        public String              dominantType   = "unknown";

        public String functionBody = "";
        public String targetFunc   = "";

        // ✅ Variable tracking
        public Map<String, List<VarDefinition>> varDefinitions = new LinkedHashMap<>(); // name → defs
        public Map<String, List<Integer>>       varUsages      = new LinkedHashMap<>(); // name → lines used
        public Set<String>                      undefinedVars  = new LinkedHashSet<>(); // مستخدمة بدون تعريف

        // ✅ Call graph
        public List<CallEdge>              callEdges   = new ArrayList<>();
        public Map<String, List<String>>   calledBy    = new LinkedHashMap<>(); // callee → callers
        public Map<String, List<String>>   calls       = new LinkedHashMap<>(); // caller → callees

        // ✅ Data flow
        public Map<String, List<FlowNode>> dataFlow    = new LinkedHashMap<>(); // param → flow chain
        public List<String>                returnExprs = new ArrayList<>();     // كل return expressions
    }

    // ═══════════════════════════════════════════════════
    // analyze
    // ═══════════════════════════════════════════════════

    public static CodeContext analyze(String code, String targetFunc) {
        CodeContext ctx = new CodeContext();
        if (code == null || targetFunc == null) return ctx;
        ctx.targetFunc = targetFunc;

        // imports
        Matcher im = PAT_IMPORT.matcher(code);
        while (im.find()) ctx.imports.add(im.group(1).trim());

        // classes
        Matcher cl = PAT_CLASS.matcher(code);
        while (cl.find()) ctx.classes.add(cl.group(2));

        // all function params
        Matcher fn = PAT_DEF.matcher(code);
        while (fn.find()) {
            List<String> ps = new ArrayList<>();
            for (String p : fn.group(3).split(",")) {
                String pn = p.trim().split(":")[0].trim().split("=")[0].trim();
                if (!pn.isEmpty() && !pn.equals("self") && !pn.equals("cls")) ps.add(pn);
            }
            ctx.functionParams.put(fn.group(2), ps);
        }

        // inside class?
        ctx.isInsideClass = checkInsideClass(code, targetFunc);

        // function body — مُفوَّض لـ CodeIntelligence (لا تكرار)
        CodeIntelligence.Language lang = CodeIntelligence.detectLanguage(code);
        String body = CodeIntelligence.extractFunctionBody(code, targetFunc, lang);
        ctx.functionBody = body != null ? body : "";

        // infer confidence لكل param
        List<String> params = ctx.functionParams.getOrDefault(targetFunc, new ArrayList<>());
        String scope = ctx.functionBody.isEmpty() ? code : ctx.functionBody;

        for (String param : params) {
            Map<String, Double> conf = inferConfidence(scope, param);
            ctx.allParamConfidence.put(param, conf);
            ctx.paramDominantType.put(param, bestType(conf));
        }

        // للتوافق: اجعل typeConfidence و dominantType يعكسان أول param
        if (!params.isEmpty()) {
            ctx.typeConfidence = ctx.allParamConfidence.get(params.get(0));
            ctx.dominantType   = ctx.paramDominantType.get(params.get(0));
        }

        // ✅ Variable tracking
        trackVariables(ctx, params);

        // ✅ Call graph
        buildCallGraph(ctx);

        // ✅ Data flow
        analyzeDataFlow(ctx, params);

        return ctx;
    }

    // ═══════════════════════════════════════════════════
    // ✅ Variable Tracking
    // ═══════════════════════════════════════════════════

    private static void trackVariables(CodeContext ctx, List<String> params) {
        String scope = ctx.functionBody.isEmpty() ? "" : ctx.functionBody;
        if (scope.isBlank()) return;

        String[] lines = scope.split("\n");

        // سجّل الـ params كمصادر أولية
        for (String p : params) {
            ctx.varDefinitions.computeIfAbsent(p, k -> new ArrayList<>())
                .add(new VarDefinition(p, "<param>", 0, "param"));
        }

        // امسح كل تعريفات المتغيرات
        for (int i = 0; i < lines.length; i++) {
            String line = lines[i];
            int lineNum = i + 1;

            // x = expr
            Matcher am = PAT_VAR_ASSIGN.matcher(line);
            if (am.find()) {
                String varName = am.group(2);
                String varVal  = am.group(3).trim();
                // تجاهل keywords
                if (!isKeyword(varName)) {
                    ctx.varDefinitions.computeIfAbsent(varName, k -> new ArrayList<>())
                        .add(new VarDefinition(varName, varVal, lineNum, "assign"));
                }
            }

            // x += expr
            Matcher aug = PAT_AUG_ASSIGN.matcher(line);
            if (aug.find()) {
                String varName = aug.group(2);
                String op      = aug.group(3);
                String val     = aug.group(4).trim();
                ctx.varDefinitions.computeIfAbsent(varName, k -> new ArrayList<>())
                    .add(new VarDefinition(varName, op + " " + val, lineNum, "aug_assign"));
            }

            // for x in collection  /  for k, v in dict.items()
            Matcher fm = PAT_FOR_VAR.matcher(line);
            if (fm.find()) {
                for (String forVar : fm.group(1).split(",")) {
                    String fv = forVar.trim();
                    if (!fv.isEmpty()) {
                        ctx.varDefinitions.computeIfAbsent(fv, k -> new ArrayList<>())
                            .add(new VarDefinition(fv, "for in " + fm.group(2), lineNum, "for_loop"));
                    }
                }
            }

            // تتبع usages — كل identifier في السطر
            Matcher used = Pattern.compile("\\b([a-z_]\\w*)\\b").matcher(line);
            while (used.find()) {
                String id = used.group(1);
                if (!isKeyword(id) && id.length() > 1)
                    ctx.varUsages.computeIfAbsent(id, k -> new ArrayList<>()).add(lineNum);
            }
        }

        // اكتشاف المتغيرات المستخدمة بدون تعريف
        Set<String> defined = new HashSet<>(ctx.varDefinitions.keySet());
        defined.addAll(PYTHON_BUILTINS);
        for (String used : ctx.varUsages.keySet()) {
            if (!defined.contains(used))
                ctx.undefinedVars.add(used);
        }
    }

    // ═══════════════════════════════════════════════════
    // ✅ Call Graph
    // ═══════════════════════════════════════════════════

    private static void buildCallGraph(CodeContext ctx) {
        String scope = ctx.functionBody.isEmpty() ? "" : ctx.functionBody;
        if (scope.isBlank()) return;

        String caller = ctx.targetFunc;
        String[] lines = scope.split("\n");

        for (int i = 0; i < lines.length; i++) {
            String line = lines[i];
            int lineNum = i + 1;

            // obj.method(args) — method calls
            Matcher mm = PAT_METHOD_CALL.matcher(line);
            while (mm.find()) {
                String obj    = mm.group(1);
                String method = mm.group(2);
                String args   = mm.group(3).trim();
                String callee = obj + "." + method;

                CallEdge edge = new CallEdge(caller, callee, args, lineNum, true);
                ctx.callEdges.add(edge);
                ctx.calls.computeIfAbsent(caller, k -> new ArrayList<>()).add(callee);
                ctx.calledBy.computeIfAbsent(callee, k -> new ArrayList<>()).add(caller);
            }

            // func(args) — standalone calls (بعد إزالة method calls)
            String lineNoMethods = line.replaceAll("\\w+\\.\\w+\\s*\\(", "");
            Matcher cm = PAT_CALL.matcher(lineNoMethods);
            while (cm.find()) {
                String callee = cm.group(1);
                String args   = cm.group(2).trim();
                if (isKeyword(callee) || PYTHON_BUILTINS.contains(callee)) continue;
                if (callee.equals(caller)) continue; // self-recursion — نسجّلها بشكل خاص

                CallEdge edge = new CallEdge(caller, callee, args, lineNum, false);
                ctx.callEdges.add(edge);
                ctx.calls.computeIfAbsent(caller, k -> new ArrayList<>()).add(callee);
                ctx.calledBy.computeIfAbsent(callee, k -> new ArrayList<>()).add(caller);
            }
        }
    }

    // ═══════════════════════════════════════════════════
    // ✅ Data Flow
    // ═══════════════════════════════════════════════════

    private static void analyzeDataFlow(CodeContext ctx, List<String> params) {
        String scope = ctx.functionBody.isEmpty() ? "" : ctx.functionBody;
        if (scope.isBlank()) return;

        String[] lines = scope.split("\n");

        // ابدأ chain لكل param كـ SOURCE
        for (String param : params) {
            List<FlowNode> chain = new ArrayList<>();
            chain.add(new FlowNode(param, "<input param>", 0, FlowNode.Kind.SOURCE));
            ctx.dataFlow.put(param, chain);
        }

        for (int i = 0; i < lines.length; i++) {
            String line    = lines[i];
            int    lineNum = i + 1;
            String trimmed = line.trim();

            // تجاهل comments
            if (trimmed.startsWith("#")) continue;

            // assignment: var = expr
            Matcher am = PAT_VAR_ASSIGN.matcher(line);
            if (am.find()) {
                String varName = am.group(2);
                String expr    = am.group(3).trim();

                // هل الـ expr يحتوي أي param؟
                for (String param : params) {
                    if (expr.contains(param)) {
                        ctx.dataFlow.computeIfAbsent(param, k -> new ArrayList<>())
                            .add(new FlowNode(varName, expr, lineNum, FlowNode.Kind.TRANSFORM));
                    }
                }
            }

            // condition: if/elif/while يحتوي param
            Matcher cond = PAT_CONDITION.matcher(line);
            if (cond.find()) {
                String condExpr = cond.group(1);
                for (String param : params) {
                    if (condExpr.contains(param)) {
                        ctx.dataFlow.computeIfAbsent(param, k -> new ArrayList<>())
                            .add(new FlowNode("<condition>", condExpr, lineNum, FlowNode.Kind.CONDITION));
                    }
                }
            }

            // return expr
            Matcher ret = PAT_RETURN.matcher(line);
            if (ret.find()) {
                String retExpr = ret.group(1).trim();
                ctx.returnExprs.add(retExpr);
                for (String param : params) {
                    if (retExpr.contains(param)) {
                        ctx.dataFlow.computeIfAbsent(param, k -> new ArrayList<>())
                            .add(new FlowNode("<return>", retExpr, lineNum, FlowNode.Kind.RETURN));
                    }
                }
            }
        }
    }

    // ═══════════════════════════════════════════════════
    // inferConfidence — لكل param
    // ═══════════════════════════════════════════════════

    public static Map<String, Double> inferConfidence(String scope, String param) {
        Map<String, Double> s = new LinkedHashMap<>();
        s.put("list_of_dict", 0.0);
        s.put("dict",   0.0);
        s.put("list",   0.0);
        s.put("string", 0.0);
        s.put("number", 0.0);

        if (scope == null || param == null) return s;

        // dict signals
        add(s, "dict",   scope.contains(param + ".get(")            ? 0.5 : 0.0);
        add(s, "dict",   scope.contains(param + "[\"")              ? 0.4 : 0.0);
        add(s, "dict",   scope.contains(param + "['")               ? 0.4 : 0.0);
        add(s, "dict",   scope.contains(param + ".keys()")          ? 0.4 : 0.0);
        add(s, "dict",   scope.contains(param + ".values()")        ? 0.3 : 0.0);
        add(s, "dict",   scope.contains(param + ".items()")         ? 0.3 : 0.0);
        add(s, "dict",   scope.contains(param + ".update(")         ? 0.3 : 0.0);

        // list signals
        add(s, "list",   scope.contains(" in " + param)             ? 0.5 : 0.0);
        add(s, "list",   scope.contains("len(" + param + ")")       ? 0.3 : 0.0);
        add(s, "list",   scope.contains(param + ".append(")         ? 0.4 : 0.0);
        add(s, "list",   scope.contains(param + ".extend(")         ? 0.4 : 0.0);
        add(s, "list",   scope.contains(param + "[0]")              ? 0.3 : 0.0);
        add(s, "list",   scope.contains(param + "[-1]")             ? 0.3 : 0.0);
        add(s, "list",   scope.contains("sorted(" + param)          ? 0.3 : 0.0);

        // list_of_dict: iteration + dict access
        boolean hasIteration = scope.contains(" in " + param);
        boolean hasDictAccess = scope.contains(".get(") || scope.contains("[\"");
        if (hasIteration && hasDictAccess) {
            add(s, "list_of_dict", 0.6);
            // قلل dict و list لأن list_of_dict أدق
            s.put("dict", s.get("dict") * 0.5);
            s.put("list", s.get("list") * 0.5);
        }

        // string signals
        add(s, "string", scope.contains(param + ".split(")          ? 0.5 : 0.0);
        add(s, "string", scope.contains(param + ".strip(")          ? 0.4 : 0.0);
        add(s, "string", scope.contains(param + ".lower(")          ? 0.3 : 0.0);
        add(s, "string", scope.contains(param + ".upper(")          ? 0.3 : 0.0);
        add(s, "string", scope.contains(param + ".replace(")        ? 0.3 : 0.0);
        add(s, "string", scope.contains(param + ".startswith(")     ? 0.3 : 0.0);
        add(s, "string", scope.contains(param + ".endswith(")       ? 0.3 : 0.0);
        add(s, "string", scope.contains("str(" + param + ")")       ? 0.2 : 0.0);

        // number signals
        add(s, "number", scope.contains("int(" + param + ")")       ? 0.5 : 0.0);
        add(s, "number", scope.contains("float(" + param + ")")     ? 0.5 : 0.0);
        add(s, "number", scope.contains(param + " + ")              ? 0.3 : 0.0);
        add(s, "number", scope.contains(param + " * ")              ? 0.3 : 0.0);
        add(s, "number", scope.contains(param + " > ")              ? 0.2 : 0.0);
        add(s, "number", scope.contains(param + " < ")              ? 0.2 : 0.0);
        add(s, "number", scope.contains(param + " >= ")             ? 0.2 : 0.0);
        add(s, "number", scope.contains(param + " <= ")             ? 0.2 : 0.0);

        return s;
    }

    private static void add(Map<String, Double> map, String key, double val) {
        map.put(key, map.getOrDefault(key, 0.0) + val);
    }

    // ═══════════════════════════════════════════════════
    // bestType
    // ═══════════════════════════════════════════════════

    private static String bestType(Map<String, Double> scores) {
        String best = "unknown"; double max = 0.15;
        for (Map.Entry<String, Double> e : scores.entrySet())
            if (e.getValue() > max) { max = e.getValue(); best = e.getKey(); }
        return best;
    }

    // ═══════════════════════════════════════════════════
    // checkInsideClass — يتجاهل blank lines و comments
    // ═══════════════════════════════════════════════════

    private static boolean checkInsideClass(String code, String funcName) {
        String[] lines = code.split("\n");
        boolean inClass = false;
        int classIndent = 0;

        for (String line : lines) {
            String trimmed = line.trim();

            // تجاهل السطور الفارغة والـ comments
            if (trimmed.isEmpty() || trimmed.startsWith("#")) continue;

            // بداية class جديدة
            if (trimmed.startsWith("class ") && !line.startsWith(" ") && !line.startsWith("\t")) {
                inClass = true;
                classIndent = 0;
                continue;
            }

            if (inClass) {
                // حساب indent
                int indent = 0;
                for (char c : line.toCharArray()) { if (c == ' ') indent++; else break; }

                // لو رجعنا لـ indent == 0 وهذا مو comment ولا blank → خرجنا من الـ class
                if (indent == 0) {
                    inClass = false;
                    continue;
                }

                // هل هذه الدالة داخل الـ class؟
                if (trimmed.startsWith("def " + funcName + "(")
                    || trimmed.startsWith("async def " + funcName + "(")) {
                    return true;
                }
            }
        }
        return false;
    }

    // ═══════════════════════════════════════════════════
    // refineSuggestion — حالات متعددة
    // ═══════════════════════════════════════════════════

    public static String refineSuggestion(String suggestion, CodeContext ctx, String param) {
        if (suggestion == null || suggestion.isBlank()) return suggestion;

        String dominantType = ctx.paramDominantType.getOrDefault(param, ctx.dominantType);

        // حالة 1: sum(param) لكن param هو list_of_dict أو dict
        if ((dominantType.equals("dict") || dominantType.equals("list_of_dict"))
                && suggestion.contains("sum(" + param + ")")) {
            suggestion = suggestion.replace(
                "sum(" + param + ")",
                "sum(x.get('value', x.get('price', x.get('amount', 0))) for x in " + param + ")"
            );
        }

        // حالة 2: len(param) لكن param هو dict → .keys()
        if (dominantType.equals("dict") && suggestion.contains("len(" + param + ")")) {
            suggestion = suggestion.replace(
                "len(" + param + ")",
                "len(" + param + ".keys())"
            );
        }

        // حالة 3: sorted(param) لكن list_of_dict → لازم key
        if (dominantType.equals("list_of_dict") && suggestion.contains("sorted(" + param + ")")) {
            suggestion = suggestion.replace(
                "sorted(" + param + ")",
                "sorted(" + param + ", key=lambda x: x.get('id', 0))"
            );
        }

        // حالة 4: param + 0 أو param * factor لكن param هو list → sum أولاً
        if (dominantType.equals("list")
                && (suggestion.contains(param + " * ") || suggestion.contains(param + " + "))) {
            suggestion = "# ⚠️ param '" + param + "' is a list — consider sum() or indexing\n" + suggestion;
        }

        // حالة 5: اقتراح يستخدم .get() لكن param هو list
        if (dominantType.equals("list") && suggestion.contains(param + ".get(")) {
            suggestion = suggestion.replace(param + ".get(", "# ⚠️ list has no .get() — use x.get( inside loop\n" + param + ".get(");
        }

        // حالة 6: self.param غير موجود في class → تحذير
        if (!ctx.isInsideClass && suggestion.contains("self." + param)) {
            suggestion = "# ⚠️ self." + param + " used but function is not inside a class\n" + suggestion;
        }

        return suggestion;
    }

    // ═══════════════════════════════════════════════════
    // Helpers
    // ═══════════════════════════════════════════════════

    private static boolean isKeyword(String s) { return KEYWORDS.contains(s); }

    private static final Set<String> KEYWORDS = new HashSet<>(Arrays.asList(
        "for","in","if","else","elif","while","return","import","from","as","def","class",
        "and","or","not","is","None","True","False","pass","break","continue","raise",
        "try","except","finally","with","yield","lambda","global","nonlocal","assert",
        "del","async","await"
    ));

    private static final Set<String> PYTHON_BUILTINS = new HashSet<>(Arrays.asList(
        "print","len","str","int","float","bool","list","dict","set","tuple","range",
        "enumerate","zip","map","filter","sorted","sum","max","min","next","iter","open",
        "type","isinstance","hasattr","getattr","setattr","any","all","abs","round",
        "repr","hash","id","input","format","chr","ord","hex","bin","super","object",
        "self","cls","append","extend","update","pop","get","keys","values","items",
        "split","strip","lower","upper","replace","join","find","startswith","endswith"
    ));

    // ═══════════════════════════════════════════════════
    // Summary — شامل
    // ═══════════════════════════════════════════════════

    public static String summarize(CodeContext ctx) {
        StringBuilder sb = new StringBuilder();
        sb.append("╔══════════════════════════════════╗\n");
        sb.append("║    ContextAnalyzer v3.0 Report   ║\n");
        sb.append("╚══════════════════════════════════╝\n");
        sb.append("Target  : ").append(ctx.targetFunc).append("\n");
        sb.append("InClass : ").append(ctx.isInsideClass).append("\n");
        sb.append("Classes : ").append(ctx.classes).append("\n");
        sb.append("Imports : ").append(ctx.imports.size()).append(" → ").append(ctx.imports).append("\n\n");

        // Params
        sb.append("── Params ──\n");
        for (Map.Entry<String, String> e : ctx.paramDominantType.entrySet()) {
            Map<String, Double> conf = ctx.allParamConfidence.getOrDefault(e.getKey(), new HashMap<>());
            sb.append("  ").append(e.getKey())
              .append(" → ").append(e.getValue())
              .append(String.format(" (%.2f)\n", conf.getOrDefault(e.getValue(), 0.0)));
        }

        // Variable tracking
        sb.append("\n── Variable Tracking ──\n");
        for (Map.Entry<String, List<VarDefinition>> e : ctx.varDefinitions.entrySet()) {
            sb.append("  ").append(e.getKey()).append(":\n");
            for (VarDefinition vd : e.getValue())
                sb.append("    ").append(vd).append("\n");
            List<Integer> usages = ctx.varUsages.getOrDefault(e.getKey(), Collections.emptyList());
            if (!usages.isEmpty())
                sb.append("    used at lines: ").append(usages).append("\n");
        }
        if (!ctx.undefinedVars.isEmpty())
            sb.append("  ⚠️ Undefined: ").append(ctx.undefinedVars).append("\n");

        // Call graph
        sb.append("\n── Call Graph ──\n");
        if (ctx.callEdges.isEmpty()) {
            sb.append("  (no calls detected)\n");
        } else {
            for (CallEdge ce : ctx.callEdges)
                sb.append("  ").append(ce).append("\n");
        }

        // Data flow
        sb.append("\n── Data Flow ──\n");
        for (Map.Entry<String, List<FlowNode>> e : ctx.dataFlow.entrySet()) {
            sb.append("  param '").append(e.getKey()).append("':\n");
            for (FlowNode fn : e.getValue())
                sb.append("    ").append(fn).append("\n");
        }
        if (!ctx.returnExprs.isEmpty())
            sb.append("  returns: ").append(ctx.returnExprs).append("\n");

        return sb.toString();
    }
}
