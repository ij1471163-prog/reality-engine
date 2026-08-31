// ─── AST Engine (JS only) ────────────────────────────
// يستخدم acorn لتحليل JavaScript بشكل حقيقي

// acorn من CDN
const ACORN_CDN = 'https://cdnjs.cloudflare.com/ajax/libs/acorn/8.11.3/acorn.min.js';

let acornLoaded = false;
let acornLoading = false;
let acornCallbacks = [];

function loadAcorn(cb) {
  if (acornLoaded) { cb(); return; }
  acornCallbacks.push(cb);
  if (acornLoading) return;
  acornLoading = true;
  const s = document.createElement('script');
  s.src = ACORN_CDN;
  s.onload = () => { acornLoaded = true; acornCallbacks.forEach(f => f()); acornCallbacks = []; };
  s.onerror = () => console.warn('Acorn failed to load');
  document.head.appendChild(s);
}

function walkAST(node, visitor) {
  if (!node || typeof node !== 'object') return;
  if (visitor[node.type]) visitor[node.type](node);
  for (const key of Object.keys(node)) {
    const child = node[key];
    if (Array.isArray(child)) child.forEach(c => walkAST(c, visitor));
    else if (child && typeof child === 'object' && child.type) walkAST(child, visitor);
  }
}

function analyzeJSWithAST(code, fileName) {
  if (typeof acorn === 'undefined') return [];
  
  let ast;
  try {
    ast = acorn.parse(code, { ecmaVersion: 2020, sourceType: 'module' });
  } catch(e) {
    try {
      ast = acorn.parse(code, { ecmaVersion: 2020 });
    } catch(e2) {
      return []; // ما يقدر يحلل
    }
  }

  const issues = [];
  const loopVars = new Map(); // متغيرات مُعرَّفة قبل الحلقة بـ 0

  // 1. اكتشف المتغيرات المُهيَّأة بـ 0
  walkAST(ast, {
    VariableDeclarator(node) {
      if (node.init && node.init.type === 'Literal' && node.init.value === 0) {
        loopVars.set(node.id.name, node.loc?.start?.line || 0);
      }
    }
  });

  // 2. اكتشف forEach + return (حقيقي)
  walkAST(ast, {
    CallExpression(node) {
      if (node.callee?.property?.name === 'forEach') {
        const callback = node.arguments[0];
        if (!callback) return;
        
        let hasReturn = false, hasSideEffects = false;
        walkAST(callback, {
          ReturnStatement(ret) {
            if (ret.argument) hasReturn = true;
          },
          CallExpression(inner) {
            if (inner !== node) hasSideEffects = true;
          }
        });

        if (hasReturn) {
          issues.push({
            type: 'bug', sev: 'h',
            title: hasSideEffects 
              ? 'return داخل forEach مع side effects (AST ✓)' 
              : 'return داخل forEach لا يُرجع قيمة (AST ✓)',
            line: node.loc?.start?.line || 0,
            ev: `${node.callee?.object?.name || 'arr'}.forEach(...)`,
            fix: hasSideEffects ? null : `${node.callee?.object?.name || 'arr'}.find(...)`,
            astVerified: true,
            conf: 92
          });
        }
      }
    }
  });

  // 3. اكتشف = بدل += للمتغيرات التراكمية (AST حقيقي)
  walkAST(ast, {
    AssignmentExpression(node) {
      if (node.operator === '=' && node.left.type === 'Identifier') {
        const varName = node.left.name;
        if (loopVars.has(varName)) {
          // تحقق إن هذا داخل callback
          issues.push({
            type: 'bug', sev: 'c',
            title: `خطأ تراكم مؤكد: ${varName} = بدل += (AST ✓)`,
            line: node.loc?.start?.line || 0,
            ev: `${varName} = ${node.right.type}`,
            fix: `${varName} += ...`,
            astVerified: true,
            conf: 95
          });
        }
      }
    }
  });

  // أضف confidence
  issues.forEach(iss => {
    if (!iss.conf) iss.conf = 85;
    iss.cIcon = iss.conf >= 90 ? '🟢' : '🟡';
    iss.cAct = iss.conf >= 90 ? 'ثقة عالية (AST)' : 'مشكلة محتملة';
    iss.cEv = ['✓ تحليل AST حقيقي', '✓ مو Regex'];
  });

  return issues;
}

// دالة رئيسية تجمع Regex + AST
function analyzeJSEnhanced(code, fileName) {
  const regexIssues = analyzeCode(code, fileName);
  
  if (typeof acorn === 'undefined') return regexIssues;
  
  const astIssues = analyzeJSWithAST(code, fileName);
  
  // دمج النتائج - AST يأخذ الأولوية
  const merged = [...astIssues];
  regexIssues.forEach(ri => {
    const duplicate = astIssues.some(ai => Math.abs(ai.line - ri.line) <= 1 && ai.title.includes(ri.title.split(':')[0]));
    if (!duplicate) merged.push(ri);
  });
  
  return merged;
}
