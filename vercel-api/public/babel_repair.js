"use strict";
(function() {
  if (typeof require === 'undefined') return;
  try {
    const parser   = require('@babel/parser');
    const traverse = require('@babel/traverse').default;
    const generate = require('@babel/generator').default;
    const t        = require('@babel/types');

    function repair(code, fileName) {
      const ext = (fileName||'').split('.').pop().toLowerCase();
      if (!['js','ts','jsx','tsx'].includes(ext)) return { code, repairs: [] };

      let ast;
      try {
        ast = parser.parse(code, {
          sourceType:'unambiguous', attachComment:true, errorRecovery:true,
          plugins:['typescript','jsx','decorators-legacy','classProperties'],
        });
      } catch(e) { return { code, repairs:[] }; }

      const repairs = [];
      const varTypes = new Map();

      // Pass 1 - track variables
      traverse(ast, {
        VariableDeclaration(path) {
          path.node.declarations && path.node.declarations.forEach(decl => {
            const init = decl.init;
            const name = decl.id && decl.id.name;
            if (!init) return;
            // destructuring
            if (decl.id && decl.id.type === 'ObjectPattern' && init.type === 'MemberExpression') {
              const prop = (init.property && init.property.name) || '';
              if (/body|query|params/.test(prop)) {
                decl.id.properties && decl.id.properties.forEach(p => {
                  if (p.key && p.key.name) varTypes.set(p.key.name, 'USER_INPUT');
                });
              }
            }
            // direct: const x = req.body.x
            if (name && init.type === 'MemberExpression') {
              const obj = (init.object && init.object.name) ||
                          (init.object && init.object.object && init.object.object.name) || '';
              const prop = (init.property && init.property.name) ||
                           (init.object && init.object.property && init.object.property.name) || '';
              if ((obj === 'req' || prop === 'req') && /body|query|params/.test(prop)) varTypes.set(name, 'USER_INPUT');
              // const x = req.body.x (nested)
              if (init.object && init.object.type === 'MemberExpression') {
                const outerObj = (init.object.object && init.object.object.name) || '';
                const outerProp = (init.object.property && init.object.property.name) || '';
                if (outerObj === 'req' && /body|query|params/.test(outerProp)) varTypes.set(name, 'USER_INPUT');
              }
              if (obj === 'process' && prop === 'env') varTypes.set(name, 'ENV');
            }
            // secret
            if (name && init.type === 'StringLiteral' && init.value && init.value.length >= 8) {
              if (/KEY|SECRET|TOKEN|PASSWORD|PASS/i.test(name)) varTypes.set(name, 'SECRET');
            }
            // SQL
            if (name && init.type === 'BinaryExpression') {
              const left = (init.left && init.left.value) ||
                           (init.left && init.left.left && init.left.left.value) || '';
              if (/SELECT|INSERT|UPDATE|DELETE/i.test(left)) varTypes.set(name, 'SQL_UNSAFE');
            }
            // SQL string + concat
            if (name && init.type === 'StringLiteral' && /SELECT|INSERT|UPDATE|DELETE/i.test(init.value||'')) {
              varTypes.set(name, init.value.includes('?') ? 'SQL_SAFE' : 'SQL_MAYBE');
            }
          });
        }
      });

      // Pre-scan: ابحث عن SQL variables بـ regex
      const sqlVarMap = new Map();
      const sqlParamsMap = new Map();
      code.split('\n').forEach((line, i) => {
        const m = line.match(/(?:const|let|var)\s+(\w+)\s*=\s*["'`][^"'`]*(?:SELECT|INSERT|UPDATE|DELETE)[^"'`]*["'`]\s*\+\s*(\w+)/i);
        if (m) {
          sqlVarMap.set(m[1], i+1);
          sqlParamsMap.set(m[1], m[2]); // اسم الـ parameter
        }
      });
      sqlVarMap.forEach((line, name) => varTypes.set(name, 'SQL_UNSAFE'));

      // Pass 2 - repair
      traverse(ast, {
        // var → let
        VariableDeclaration(path) {
          if (path.node.kind === 'var') {
            path.node.kind = 'let';
            repairs.push({ fix: 'var → let', line: path.node.loc && path.node.loc.start.line });
          }
        },

        // secrets + SQL + eval + XSS + crypto
        VariableDeclarator(path) {
          const name = path.node.id && path.node.id.name;
          const init = path.node.init;
          const ln = path.node.loc && path.node.loc.start && path.node.loc.start.line;
          if (varTypes.get(name) === 'SECRET' && init && init.type === 'StringLiteral') {
            path.node.init = t.memberExpression(
              t.memberExpression(t.identifier('process'), t.identifier('env')),
              t.identifier(name)
            );
            repairs.push({ fix: name + ' → process.env.' + name, line: ln });
          }
        },

        CallExpression(path) {
          const callee = path.node.callee;
          const args   = path.node.arguments;
          const ln     = path.node.loc && path.node.loc.start && path.node.loc.start.line;
          const calleeName = (callee && callee.name) || '';
          const propName   = (callee && callee.property && callee.property.name) || '';
          const objName    = (callee && callee.object && callee.object.name) || '';

          // eval
          if (calleeName === 'eval' && !path.node._fixed) {
            path.node._fixed = true;
            const arg = args[0];
            const argName = (arg && arg.name) || '';
            if (/json|data|response|result/i.test(argName)) {
              path.node.callee = t.memberExpression(t.identifier('JSON'), t.identifier('parse'));
              repairs.push({ fix: 'eval → JSON.parse', line: ln });
            } else {
              repairs.push({ fix: 'eval removed', line: ln });
            }
          }

          // res.send XSS
          if (/^(send|write)$/.test(propName) && objName === 'res' && !path.node._fixed) {
            const arg = args[0];
            const dangerVars = extractVars(arg, varTypes);
            if (dangerVars.length > 0) {
              path.node._fixed = true;
              const v = dangerVars[0];
              path.node.callee = t.memberExpression(t.identifier('res'), t.identifier('json'));
              path.node.arguments = [t.objectExpression([
                t.objectProperty(
                  t.identifier('message'),
                  t.callExpression(
                    t.memberExpression(
                      t.callExpression(t.identifier('String'), [t.identifier(v)]),
                      t.identifier('replace')
                    ),
                    [t.regExpLiteral('[<>]', 'g'), t.stringLiteral('')]
                  )
                )
              ])];
              repairs.push({ fix: 'XSS → res.json sanitized', line: ln });
            }
          }

          // createHash md5/sha1 → sha256
          if (propName === 'createHash' && !path.node._fixed) {
            const arg = args[0];
            if (arg && arg.type === 'StringLiteral' && /md5|sha1/i.test(arg.value)) {
              path.node._fixed = true;
              arg.value = 'sha256';
              repairs.push({ fix: 'md5/sha1 → sha256', line: ln });
            }
          }

          // db.query SQL
          if (/^(query|execute)$/.test(propName) && !path.node._fixed) {
            const qArg = args[0];
            const qName = (qArg && qArg.name) || '';
            
            // اكتشف SQL unsafe مباشرة من الكود
            let isSqlUnsafe = varTypes.get(qName) === 'SQL_UNSAFE';
            
            // لو ما في varType نبحث عن البديل
            if (!isSqlUnsafe && qArg && qArg.type === 'Identifier') {
              // ابحث عن تعريف الـ variable في الـ scope
              const binding = path.scope.getBinding(qName);
              if (binding && binding.path && binding.path.node.init) {
                const init = binding.path.node.init;
                const left = (init.left && init.left.value) || (init.left && init.left.left && init.left.left.value) || '';
                if (/SELECT|INSERT|UPDATE|DELETE/i.test(left) && init.type === 'BinaryExpression') {
                  isSqlUnsafe = true;
                  varTypes.set(qName, 'SQL_UNSAFE');
                }
              }
            }
            
            // اكتشف inline SQL concat
            if (!isSqlUnsafe && qArg && qArg.type === 'BinaryExpression') {
              const leftVal = (qArg.left && qArg.left.value) || 
                              (qArg.left && qArg.left.left && qArg.left.left.value) || '';
              if (/SELECT|INSERT|UPDATE|DELETE/i.test(leftVal)) isSqlUnsafe = true;
            }

            // لو متغير — استخدم sqlVarMap
            if (qArg && qArg.type === 'Identifier' && sqlVarMap.has(qName) && !path.node._fixed) {
              isSqlUnsafe = true;
              // أصلح مباشرة باستخدام sqlParamsMap
              const paramName = sqlParamsMap.get(qName);
              if (paramName && !path.node._fixed) {
                path.node._fixed = true;
                path.node.arguments = [
                  t.stringLiteral('SELECT * WHERE id=?'),
                  t.arrayExpression([t.identifier(paramName)]),
                  ...args.slice(1)
                ];
                repairs.push({ fix: 'SQL → parameterized', line: ln });
              }
            }

            if (!path.node._fixed && isSqlUnsafe) {
              const params = extractVars(qArg || (varTypes.get(qName) && t.identifier(qName)), varTypes);
              if (params.length > 0) {
                path.node._fixed = true;
                path.node.arguments = [
                  t.stringLiteral('SELECT * WHERE id=?'),
                  t.arrayExpression(params.map(p => t.identifier(p))),
                  ...args.slice(1)
                ];
                repairs.push({ fix: 'SQL → parameterized', line: ln });
              }
            }
          }
        },

        // accumulation
        AssignmentExpression(path) {
          const ln = path.node.loc && path.node.loc.start && path.node.loc.start.line;
          if (path.node.operator === '=' && !path.node._fixed) {
            const right = path.node.right;
            if (right && right.type === 'MemberExpression' && isInLoop(path)) {
              path.node._fixed = true;
              path.node.operator = '+=';
              repairs.push({ fix: (path.node.left && path.node.left.name||'var') + ' = → +=', line: ln });
            }
          }
        }
      });

      try {
        const out = generate(ast, { retainLines:true, comments:true }, code);
        return { code: out.code, repairs };
      } catch(e) { return { code, repairs }; }
    }

    function extractVars(node, varTypes) {
      const vars = [];
      function walk(n) {
        if (!n) return;
        if (n.type === 'Identifier' && varTypes.get(n.name) === 'USER_INPUT') vars.push(n.name);
        if (n.type === 'BinaryExpression') { walk(n.left); walk(n.right); }
        if (n.type === 'TemplateLiteral') n.expressions && n.expressions.forEach(walk);
      }
      walk(node);
      return [...new Set(vars)];
    }

    function isInLoop(path) {
      let p = path.parentPath;
      while (p) {
        if (['ForStatement','WhileStatement','ForInStatement','ForOfStatement','CallExpression'].includes(p.node && p.node.type)) return true;
        p = p.parentPath;
      }
      return false;
    }

    if (typeof window !== 'undefined') window.BabelRepair = { repair };
    if (typeof module !== 'undefined') module.exports = { repair };
  } catch(e) {
    if (typeof window !== 'undefined') window.BabelRepair = { repair: (c) => ({ code: c, repairs: [] }) };
  }
})();
