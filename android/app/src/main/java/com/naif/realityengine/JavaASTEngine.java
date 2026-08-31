package com.naif.realityengine;

import com.github.javaparser.*;
import com.github.javaparser.ast.*;
import com.github.javaparser.ast.body.*;
import com.github.javaparser.ast.expr.*;
import com.github.javaparser.ast.stmt.*;
import com.github.javaparser.ast.visitor.VoidVisitorAdapter;

import java.util.*;

/**
 * JavaASTEngine — محرك تحليل Java بـ AST حقيقي
 * يفهم الكود مو بس يقرأه نصياً
 */
public class JavaASTEngine {

    public static class ASTIssue {
        public String title;
        public String description;
        public int    line;
        public String severity; // CRITICAL, HIGH, MEDIUM, LOW
        public String fix;
        public String category; // accumulation, nullcheck, empty, comparison, scope

        public ASTIssue(String title, String desc, int line, String sev, String fix, String cat) {
            this.title       = title;
            this.description = desc;
            this.line        = line;
            this.severity    = sev;
            this.fix         = fix;
            this.category    = cat;
        }
    }

    // ─── تحليل رئيسي ──────────────────────────────────
    public static List<ASTIssue> analyze(String code) {
        List<ASTIssue> issues = new ArrayList<>();
        try {
            CompilationUnit cu = StaticJavaParser.parse(code);
            
            detectEmptyMethods(cu, issues);
            detectAccumulation(cu, issues);
            detectNullComparison(cu, issues);
            detectEmptyCatch(cu, issues);
            detectReturnInLoop(cu, issues);
            
        } catch (ParseProblemException e) {
            // كود فيه أخطاء syntax
            issues.add(new ASTIssue(
                "خطأ في الـ Syntax",
                e.getProblems().get(0).getMessage(),
                1, "CRITICAL", null, "syntax"
            ));
        }
        return issues;
    }

    // ─── 1. دوال فارغة ────────────────────────────────
    private static void detectEmptyMethods(CompilationUnit cu, List<ASTIssue> issues) {
        cu.findAll(MethodDeclaration.class).forEach(method -> {
            if (!method.getBody().isPresent()) return;
            BlockStmt body = method.getBody().get();
            
            boolean isEmpty = body.getStatements().isEmpty();
            boolean isStub  = body.getStatements().size() == 1 &&
                (body.getStatements().get(0) instanceof ReturnStmt ||
                 isPassStatement(body.getStatements().get(0)));

            if (isEmpty || isStub) {
                String returnType = method.getType().asString();
                String params     = method.getParameters().toString();
                String suggested  = generateStubFix(method.getNameAsString(), returnType, params);
                
                issues.add(new ASTIssue(
                    "دالة ناقصة: " + method.getNameAsString() + "()",
                    "الدالة فارغة أو تُرجع قيمة افتراضية فقط",
                    method.getBegin().map(p -> p.line).orElse(0),
                    "HIGH", suggested, "stub"
                ));
            }
        });
    }

    // ─── 2. أخطاء التراكم ─────────────────────────────
    private static void detectAccumulation(CompilationUnit cu, List<ASTIssue> issues) {
        cu.findAll(MethodDeclaration.class).forEach(method -> {
            // ابحث عن متغيرات مُهيَّأة بـ 0
            Set<String> zeroVars = new HashSet<>();
            method.findAll(VariableDeclarator.class).forEach(v -> {
                if (v.getInitializer().isPresent()) {
                    String init = v.getInitializer().get().toString();
                    if (init.equals("0") || init.equals("0.0") || init.equals("0L")) {
                        zeroVars.add(v.getNameAsString());
                    }
                }
            });

            // ابحث عن = بدل += داخل حلقات
            method.findAll(ForEachStmt.class).forEach(loop -> {
                loop.findAll(AssignExpr.class).forEach(assign -> {
                    if (assign.getOperator() == AssignExpr.Operator.ASSIGN) {
                        String varName = assign.getTarget().toString();
                        if (zeroVars.contains(varName)) {
                            issues.add(new ASTIssue(
                                "خطأ تراكم: " + varName + " = بدل +=",
                                "المتغير " + varName + " مُهيَّأ بـ 0 لكن يُستبدل بدل يُجمع",
                                assign.getBegin().map(p -> p.line).orElse(0),
                                "CRITICAL",
                                varName + " += " + assign.getValue(),
                                "accumulation"
                            ));
                        }
                    }
                });
            });
        });
    }

    // ─── 3. مقارنة null بـ == ─────────────────────────
    private static void detectNullComparison(CompilationUnit cu, List<ASTIssue> issues) {
        cu.findAll(BinaryExpr.class).forEach(expr -> {
            if (expr.getOperator() == BinaryExpr.Operator.EQUALS ||
                expr.getOperator() == BinaryExpr.Operator.NOT_EQUALS) {
                
                boolean leftNull  = expr.getLeft().toString().equals("null");
                boolean rightNull = expr.getRight().toString().equals("null");
                
                // هذا صح في Java — null comparison بـ == مقبول
                // لكن نبحث عن مقارنة String بـ ==
                if (!leftNull && !rightNull) {
                    String left  = expr.getLeft().toString();
                    String right = expr.getRight().toString();
                    if (right.startsWith("\"") || left.startsWith("\"")) {
                        issues.add(new ASTIssue(
                            "مقارنة String بـ == بدل .equals()",
                            "في Java استخدم .equals() لمقارنة الـ Strings",
                            expr.getBegin().map(p -> p.line).orElse(0),
                            "HIGH",
                            left + ".equals(" + right + ")",
                            "comparison"
                        ));
                    }
                }
            }
        });
    }

    // ─── 4. catch فارغ ────────────────────────────────
    private static void detectEmptyCatch(CompilationUnit cu, List<ASTIssue> issues) {
        cu.findAll(CatchClause.class).forEach(catchClause -> {
            if (catchClause.getBody().getStatements().isEmpty()) {
                issues.add(new ASTIssue(
                    "catch فارغ يخفي الأخطاء",
                    "أضف Log.e أو معالجة حقيقية",
                    catchClause.getBegin().map(p -> p.line).orElse(0),
                    "HIGH",
                    "catch(" + catchClause.getParameter().getNameAsString() + ") { Log.e(TAG, \"Error\", " + catchClause.getParameter().getNameAsString() + "); }",
                    "error_handling"
                ));
            }
        });
    }

    // ─── 5. return داخل forEach ───────────────────────
    private static void detectReturnInLoop(CompilationUnit cu, List<ASTIssue> issues) {
        cu.findAll(MethodCallExpr.class).forEach(call -> {
            if (!call.getNameAsString().equals("forEach")) return;
            if (call.getArguments().isEmpty()) return;
            
            call.getArguments().get(0).findAll(ReturnStmt.class).forEach(ret -> {
                if (ret.getExpression().isPresent()) {
                    issues.add(new ASTIssue(
                        "return داخل forEach لا يُرجع قيمة",
                        "forEach يتجاهل الـ return — استخدم find أو filter",
                        ret.getBegin().map(p -> p.line).orElse(0),
                        "CRITICAL",
                        "استبدل forEach بـ stream().filter().findFirst()",
                        "logic"
                    ));
                }
            });
        });
    }

    // ─── Helper Methods ────────────────────────────────
    private static boolean isPassStatement(Statement stmt) {
        if (stmt instanceof ReturnStmt) {
            ReturnStmt ret = (ReturnStmt) stmt;
            if (!ret.getExpression().isPresent()) return true;
            String val = ret.getExpression().get().toString();
            return val.equals("null") || val.equals("0") || 
                   val.equals("false") || val.equals("\"\"") || 
                   val.equals("new ArrayList<>()");
        }
        return false;
    }

    private static String generateStubFix(String name, String returnType, String params) {
        switch (returnType) {
            case "void":    return "// أضف المنطق هنا";
            case "boolean": return "return false; // TODO";
            case "int":
            case "long":
            case "double":  return "return 0; // TODO";
            case "String":  return "return \"\"; // TODO";
            default:        return "return null; // TODO: implement " + name;
        }
    }
}
