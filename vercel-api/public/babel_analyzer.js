"use strict";
(function() {
  if (typeof require === 'undefined') return;
  try {
    const parser = require('@babel/parser');
    const traverse = require('@babel/traverse').default;

    const SAFE_RE   = /SAFE|trusted|validated|sanitized|whitelisted/i;
    const DANGER_RE = /TODO|FIXME|HACK|dangerous|unsafe|injection/i;

    function getComments(node, parent) {
      const c = [...(node.leadingComments||[]),...(parent?.leadingComments||[])].map(x=>x.value);
      return { isSafe: c.some(x=>SAFE_RE.test(x)), isDanger: c.some(x=>DANGER_RE.test(x)) };
    }

    function extractVars(node) {
      if (!node) return [];
      if (node.type==='Identifier') return [node.name];
      if (node.type==='BinaryExpression') return [...extractVars(node.left),...extractVars(node.right)];
      if (node.type==='TemplateLiteral') return node.expressions?.flatMap(e=>extractVars(e))||[];
      return [];
    }

    function analyze(code, fileName) {
      const ext = (fileName||'').split('.').pop().toLowerCase();
      if (!['js','ts','jsx','tsx'].includes(ext)) return [];
      let ast;
      try {
        ast = parser.parse(code, {
          sourceType:'unambiguous', attachComment:true, errorRecovery:true,
          plugins:['typescript','jsx','decorators-legacy','classProperties'],
        });
      } catch(e) { return []; }

      const issues = [];
      const varTypes = new Map();

      // Pre-Pass: تتبع destructuring
      traverse(ast, {
        VariableDeclaration(path) {
          path.node.declarations?.forEach(decl => {
            const init = decl.init;
            if (!init || init.type !== 'MemberExpression') return;
            const obj = init.object?.name || '';
            const prop = init.property?.name || '';
            if (obj !== 'req' || !/body|query|params/.test(prop)) return;
            if (decl.id?.type === 'ObjectPattern') {
              decl.id.properties?.forEach(p => {
                if (p.key?.name) varTypes.set(p.key.name, 'USER_INPUT');
              });
            }
          });
        }
      });

      // Pass 1: تتبع المتغيرات
      traverse(ast, {
        VariableDeclarator(path) {
          const name = path.node.id?.name;
          if (!name) return;
          const init = path.node.init;
          if (!init) return;
          if (init.type==='MemberExpression') {
            const obj = init.object?.object?.name||init.object?.name||'';
            const prop = init.object?.property?.name||init.property?.name||'';
            if (obj==='req' && /body|query|params/.test(prop)) varTypes.set(name,'USER_INPUT');
            if (obj==='process' && prop==='env') varTypes.set(name,'ENV_VAR');
          }
          // destructuring: const {x,y} = req.body
          if (path.node.id?.type==='ObjectPattern' && init.type==='MemberExpression') {
            const obj2 = init.object?.name||'';
            const prop2 = init.property?.name||'';
            if (obj2==='req' && /body|query|params/.test(prop2)) {
              path.node.id.properties?.forEach(p => {
                if (p.key?.name) varTypes.set(p.key.name,'USER_INPUT');
              });
            }
          }
          if (path.node.id.type==='ObjectPattern' && init.type==='MemberExpression') {
            const prop = init.property?.name||'';
            if (/body|query|params/.test(prop)) {
              path.node.id.properties?.forEach(p=>{ if(p.key?.name) varTypes.set(p.key.name,'USER_INPUT'); });
            }
          }
          if (init.type==='StringLiteral') {
            const v = init.value||'';
            if (/SELECT|INSERT|UPDATE|DELETE/i.test(v)) varTypes.set(name, v.includes('?')?'SQL_SAFE':'SQL_UNSAFE');
          }
          if (init.type==='BinaryExpression') {
            const left = init.left?.value||init.left?.quasis?.[0]?.value?.raw||'';
            if (/SELECT|INSERT|UPDATE|DELETE/i.test(left)) varTypes.set(name,'SQL_UNSAFE');
          }
          if (init.type==='CallExpression') {
            const fn = init.callee?.name||init.callee?.property?.name||'';
            if (/sha256|bcrypt|argon2|hash/i.test(fn)) varTypes.set(name,'HASH');
          }
        },
        ObjectPattern(path) {
          const parent = path.parent;
          if (!parent) return;
          const init = parent.init;
          if (!init) return;
          // const {x} = req.body
          if (init.type === 'MemberExpression') {
            const obj = init.object?.name || '';
            const prop = init.property?.name || '';
            if (obj === 'req' && /body|query|params/.test(prop)) {
              path.properties?.forEach(p => { if (p.key?.name) varTypes.set(p.key.name, 'USER_INPUT'); });
            }
          }
          // const {x} = req → req itself
          if (init.type === 'Identifier' && init.name === 'req') {
            path.properties?.forEach(p => { if (p.key?.name) varTypes.set(p.key.name, 'USER_INPUT'); });
          }
        }
      });

      // Pass 2: تحليل الـ Sinks
      traverse(ast, {
        CallExpression(path) {
          const callee = path.node.callee;
          const ln = path.node.loc?.start?.line||0;
          const cm = getComments(path.node, path.parent);
          if (cm.isSafe) return;

          // eval
          if (callee.name==='eval') {
            const argName = path.node.arguments[0]?.name||'';
            issues.push({
              type:'CODE_INJECTION', sev:'c', line:ln,
              title:`🔴 eval() خطير${varTypes.get(argName)==='USER_INPUT'?' — user input':''}`,
              ev:`eval(${argName})`, conf:95, cIcon:'🔴', cAct:'CODE_INJECTION',
              note: cm.isDanger?'⚠️ المطور يعرف المشكلة':null,
            });
          }

          // db.query
          if (/^(query|execute)$/.test(callee?.property?.name)) {
            const args = path.node.arguments;
            const qName = args[0]?.name||'';
            const qType = varTypes.get(qName)||'UNKNOWN';
            const hasArray = args[1]?.type==='ArrayExpression';
            if (!hasArray && qType==='SQL_UNSAFE') {
              issues.push({
                type:'SQL_INJECTION', sev:'c', line:ln,
                title:`🔴 SQL Injection: ${qName} غير آمن`,
                ev:`db.query(${qName})`, conf:92, cIcon:'🔴', cAct:'SQL_INJECTION',
              });
            }
          }

          // res.send
          if (/^(send|write)$/.test(callee?.property?.name) && callee?.object?.name==='res') {
            const vars = extractVars(path.node.arguments[0]);
            const dv = vars.filter(v=>varTypes.get(v)==='USER_INPUT');
            if (dv.length>0) issues.push({
              type:'XSS', sev:'c', line:ln,
              title:`🔴 XSS: ${dv[0]} في res.send`,
              ev:`res.send(${dv[0]})`, fix:`res.json({ message: String(${dv[0]}).replace(/[<>]/g,'') })`,
              conf:90, cIcon:'🔴', cAct:'XSS',
            });
          }

          // exec/spawn
          if (/^(exec|execSync|spawn|system)$/.test(callee?.name||callee?.property?.name)) {
            const vars = extractVars(path.node.arguments[0]);
            const dv = vars.filter(v=>varTypes.get(v)==='USER_INPUT');
            if (dv.length>0) issues.push({
              type:'CMD_INJECTION', sev:'c', line:ln,
              title:`🔴 Command Injection: ${dv[0]} في exec`,
              ev:`exec(${dv[0]})`, conf:92, cIcon:'🔴', cAct:'CMD_INJECTION',
            });
          }
        },

        AssignmentExpression(path) {
          const ln = path.node.loc?.start?.line||0;
          const cm = getComments(path.node, path.parent);
          if (cm.isSafe) return;
          const prop = path.node.left?.property?.name||'';
          if (/innerHTML|outerHTML/.test(prop)) {
            const vars = extractVars(path.node.right);
            const dv = vars.filter(v=>varTypes.get(v)==='USER_INPUT');
            if (dv.length>0) issues.push({
              type:'XSS', sev:'c', line:ln,
              title:`🔴 XSS: innerHTML مع ${dv[0]}`,
              fix:`textContent = ${dv[0]}`, conf:93, cIcon:'🔴', cAct:'XSS',
            });
          }
        },

        VariableDeclarator(path) {
          const name = path.node.id?.name||'';
          const init = path.node.init;
          const ln = path.node.loc?.start?.line||0;
          if (varTypes.get(name)==='HARDCODED_SECRET' && init?.type==='StringLiteral') {
            issues.push({
              type:'HARDCODED_SECRET', sev:'h', line:ln,
              title:`🟠 ${name} مُضمَّن — استخدم process.env`,
              fix:`${name} = process.env.${name}`, conf:90, cIcon:'🟠', cAct:'HARDCODED_SECRET',
            });
          }
        }
      });

      return issues;
    }

    if (typeof window!=='undefined') window.BabelAnalyzer = { analyze };
    if (typeof module!=='undefined') module.exports = { analyze };
  } catch(e) {
    if (typeof window!=='undefined') window.BabelAnalyzer = { analyze: () => [] };
  }
})();
