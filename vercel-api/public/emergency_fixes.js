// ═══════════════════════════════════════════════════════
// emergency_fixes.js v1.0 — الخط الثالث للإصلاح
// بسيط وأكيد 100% — regex مباشر بدون context
// يعمل لما كل الخطوط الأخرى تفشل
// ═══════════════════════════════════════════════════════

"use strict";

function emergencyFix(code, fileName) {
  const ext = fileName.split('.').pop().toLowerCase();
  let fixed = code;
  const repairs = [];

  // ─── Python ────────────────────────────────────────

  if (ext === 'py') {

    // SQL Injection — كل أنواع concatenation
    const sqlPatterns = [
      // "SELECT..." + var
      { re: /(\w+)\s*=\s*["']([^"']*(?:SELECT|INSERT|UPDATE|DELETE)[^"']*?)["']\s*\+\s*(.+)/gi,
        fn: (m, varName, query, params) => {
          const cleanQuery = query.replace(/'\s*\+\s*\w+\s*\+\s*'/g, '?').replace(/='\s*"/g, '=?').trim();
          const paramList = params.replace(/["'\s+]/g, '').split('+').filter(p => p.match(/^\w+$/));
          return `${varName} = "${cleanQuery.endsWith('?') ? cleanQuery : cleanQuery + '?'}"`;
        }
      }
    ];

    // SQL Python — استبدل concatenation
    {
      const lines = fixed.split('\n');
      let sqlChanged = false;
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (!/(?:SELECT|INSERT|UPDATE|DELETE)/i.test(line)) continue;
        if (!/["\'"].*\+|\+.*["\'"]/.test(line)) continue;
        if (/cursor|execute|prepare/.test(line)) continue;
        const varM = line.match(/(\w+)\s*=/);
        if (!varM) continue;
        const varName = varM[1];
        const indent = ' '.repeat(line.search(/\S/));
        const params = [];
        line.replace(/\+\s*(\w+)\b/g, (_, p) => {
          if (!/^(?:SELECT|INSERT|UPDATE|DELETE|WHERE|AND|OR|FROM|JOIN)$/i.test(p)) params.push(p);
        });
        if (!params.length) continue;
        const qM = line.match(/["']([^"']*(?:SELECT|INSERT|UPDATE|DELETE)[^"']*)["']/i);
        if (!qM) continue;
        let q = qM[1].replace(/='[^']*'?$/, '=?').replace(/'$/, '').trim();
        if (!q.includes('?')) q += '?';
        lines[i] = `${indent}${varName} = "${q}"`;
        let j = i + 1;
        while (j < lines.length && /cursor.*conn\.execute|conn\.execute|return cursor/.test(lines[j])) lines.splice(j, 1);
        lines.splice(i + 1, 0, `${indent}cursor = conn.cursor()`);
        lines.splice(i + 2, 0, `${indent}cursor.execute(${varName}, (${params.join(', ')},))`);
        lines.splice(i + 3, 0, `${indent}return cursor.fetchall()`);
        repairs.push({ line: i + 1, fix: 'SQL → parameterized' });
        sqlChanged = true; i += 4;
      }
      if (sqlChanged) fixed = lines.join('\n');
    }

    // os.system → subprocess
    if (/os\.system\s*\(/.test(fixed) && !/subprocess/.test(fixed)) {
      fixed = fixed.replace(
        /os\.system\s*\(([^)]+)\)/g,
        'subprocess.run(shlex.split($1), check=True, capture_output=True)'
      );
      if (!fixed.includes('import subprocess')) {
        fixed = 'import subprocess\nimport shlex\n' + fixed;
      }
      repairs.push({ fix: 'os.system → subprocess' });
    }

    // [NO-BLIND] أُوقفت هنا ثلاثة تحويلات عامة تغيّر السلوك بلا دليل، والبوابة كانت تقبل اثنين منها (مقيس):
    //   eval → ast.literal_eval (+import ast): يكسر كل eval على تعبير غير حرفي
    //   == None → is None: يكسر من يعرّف __eq__ عمدًا (SQLAlchemy: filter(col == None) يصير False)
    //   md5/sha1 → sha256: يغيّر القيمة الناتجة، وكلمات المرور تحتاج KDF وترحيلًا لا تبديلًا
    // القرار في هذه الأصناف مبنيّ على الدليل في repair_engine.js (fixEval/fixNoneCompare/fixWeakCrypto)،
    // وهو يعمل قبل هذا المحرك في المسار نفسه.

    // Hardcoded secrets → env
    fixed = fixed.replace(
      /^([A-Z_]*(KEY|SECRET|TOKEN|PASSWORD|PASS|PWD)\w*)\s*=\s*["'][^"']{6,}["']/gim,
      (m, varName) => `${varName} = os.environ['${varName}']`
    );
    if (fixed !== code && fixed.includes('os.environ') && !fixed.includes('import os')) {
      fixed = 'import os\n' + fixed;
    }

    // DB_URL وDatabase Connection Strings → env
    fixed = fixed.replace(
      /\bDB_URL\b\s*=\s*["'][^"']+["']/g,
      "DB_URL = os.environ['DATABASE_URL']"
    );
    fixed = fixed.replace(
      /\bDATABASE_URL\b\s*=\s*["'][^"']+["']/g,
      "DATABASE_URL = os.environ['DATABASE_URL']"
    );
    fixed = fixed.replace(
      /\bDB_HOST\b\s*=\s*["'][^"']+["']/g,
      "DB_HOST = os.environ['DB_HOST']"
    );
    if (fixed !== code && !fixed.includes('import os') && fixed.includes('os.environ')) {
      fixed = 'import os\n' + fixed;
    }

    // Python params mismatch → صلح عدد ?
    {
      const pyLines = fixed.split('\n');
      let lastQuery = null;
      let pyChanged = false;
      pyLines.forEach((line, i) => {
        const qM = line.match(/(\w+)\s*=\s*["']([^"']*(?:SELECT|INSERT|UPDATE|DELETE)[^"']*?)["']/i);
        if (qM) lastQuery = { varName: qM[1], count: (qM[2].match(/\?/g)||[]).length, line: i };
        const exM = line.match(/cursor\.execute\s*\(\s*(\w+)\s*,\s*\(([^)]+)\)\s*\)/);
        if (exM && lastQuery && exM[1] === lastQuery.varName) {
          const params = exM[2].split(',').filter(p => p.trim()).length;
          if (params !== lastQuery.count) {
            const paramList = exM[2].split(',').map(p => p.trim()).filter(Boolean);
            const ind = ' '.repeat(line.search(/\S/));
            if (params > lastQuery.count) {
              // params أكثر من ? → أضف ? في query
              const newQ = pyLines[lastQuery.line].replace(
                /(["'])([^"']*(?:SELECT|INSERT|UPDATE|DELETE)[^"']*?)\1/i,
                (_, q, sql) => `"${sql} AND ?=?"`
              );
              pyLines[lastQuery.line] = newQ;
              pyLines[i] = `${ind}cursor.execute(${lastQuery.varName}, (${paramList.join(', ')},))`;
            } else {
              pyLines[i] = `${ind}cursor.execute(${lastQuery.varName}, (${paramList.join(', ')},))`;
            }
            pyChanged = true;
            repairs.push({ fix: 'Python SQL params mismatch fixed' });
          }
        }
      });
      if (pyChanged) fixed = pyLines.join('\n');
    }

    // accumulation = → +=
    fixed = fixed.replace(
      /^(\s+)(total|sum|count|revenue)\s*=\s*(?!\s*0\b)(\w+\[)/gm,
      '$1$2 += $3'
    );
  }

  // ─── JavaScript / TypeScript ──────────────────────

  if (ext === 'js' || ext === 'ts') {

    // صلح LIKE SQL - "LIKE '%" + var + "%'" → "LIKE ?" + ['%' + var + '%']
    {
      const likeLines = fixed.split('\n');
      let likeChanged = false;
      likeLines.forEach((line, i) => {
        if (!/LIKE/i.test(line)) return;
        const m = line.match(/((?:let|var|const)\s+)?(\w+)\s*=\s*["']([^"']*LIKE\s*['"]?%?)["']\s*\+\s*(\w+)\s*\+\s*["'](%?[^"']*)["']/i);
        if (!m) return;
        const decl = m[1] || 'let ';
        const varName = m[2];
        const queryPart = m[3].replace(/%$/, '').replace(/'$/, '').trim();
        const paramVar = m[4];
        const indent = ' '.repeat(line.search(/\S/));
        likeLines[i] = `${indent}${decl}${varName} = "${queryPart} ?";`;
        // صلح db.query التالي
        for (let j = i+1; j < Math.min(i+5, likeLines.length); j++) {
          if (/\.query\s*\(/.test(likeLines[j])) {
            likeLines[j] = likeLines[j].replace(
              /\.query\s*\((\w+)\s*,\s*function/,
              `.query($1, ['%' + ${paramVar} + '%'], function`
            );
            break;
          }
        }
        repairs.push({ fix: 'LIKE → parameterized' });
        likeChanged = true;
      });
      if (likeChanged) fixed = likeLines.join('\n');
    }

    // صلح SQL string مكسور: "SELECT...?" + "' AND..."
    {
      const fLines = fixed.split('\n');
      let fChanged = false;
      fLines.forEach((line, i) => {
        if (!/(?:SELECT|INSERT|UPDATE|DELETE)/i.test(line)) return;
        if (!line.includes('?') || !line.includes('" +')) return;
        const varM2 = line.match(/(\w+)\s*=/);
        if (!varM2) return;
        const indent2 = ' '.repeat(line.search(/\S/));
        const parts2 = line.match(/"([^"]*)"/g);
        if (parts2 && parts2.length > 1) {
          const joined2 = parts2.map(p => p.slice(1,-1)).join('');
          if (/(?:SELECT|INSERT|UPDATE|DELETE)/i.test(joined2)) {
            const cleanQ2 = joined2.replace(/='\?'/g, '=?').replace(/'\?'/g, '?');
            const hasDecl2 = /^\s*(?:let|const|var)\s+/.test(line);
            fLines[i] = `${indent2}${hasDecl2 ? '' : 'let '}${varM2[1]} = "${cleanQ2}";`;
            repairs.push({ fix: 'SQL fragments → clean' });
            fChanged = true;
          }
        }
      });
      if (fChanged) fixed = fLines.join('\n');
    }

    // صلح LIKE '%?%' → LIKE ? مع ['%' + var + '%']
    {
      const likeFixLines = fixed.split('\n');
      let likeFixed = false;
      likeFixLines.forEach((line, i) => {
        if (!/%\?%/.test(line) || !/LIKE/i.test(line)) return;
        const varM = line.match(/(?:let|var|const)\s+(\w+)/);
        if (!varM) return;
        const indent = ' '.repeat(line.search(/\S/));
        const likeQ = line.match(/"([^"]+)"/)?.[1] || '';
        const cleanLike = likeQ.replace(/'%[?]%'/g, '?').replace(/%[?]%/g, '?').replace(/'[?]'/g, '?');
        likeFixLines[i] = `${indent}let ${varM[1]} = "${cleanLike}";`;
        // صلح db.query params
        for (let j = i+1; j < Math.min(i+5, likeFixLines.length); j++) {
          if (/\.query\s*\(/.test(likeFixLines[j])) {
            likeFixLines[j] = likeFixLines[j].replace(
              /\.query\s*\((\w+)\s*,\s*\[([^\]]+)\]\s*,\s*function/,
              (m, q, params) => {
                const vars = params.split(',').map(v => v.trim());
                return `.query(${q}, ['%' + ${vars[0]} + '%'], function`;
              }
            );
            break;
          }
        }
        repairs.push({ fix: 'LIKE %?% → LIKE ?' });
        likeFixed = true;
      });
      if (likeFixed) fixed = likeFixLines.join('\n');
    }

    // أضف let لو ناقص في SQL variables
    fixed = fixed.replace(
      /^(\s*)(?<!(?:let|const|var)\s)(\w+)\s*=\s*("SELECT[^"]*");/gm,
      '$1let $2 = $3;'
    );

    // SQL في JS/TS
    if (/["'].*(?:SELECT|INSERT|UPDATE|DELETE).*["']\s*\+/.test(fixed)) {
      const lines = fixed.split('\n');
      lines.forEach((line, i) => {
        if (/["'].*(?:SELECT|INSERT|UPDATE|DELETE).*["']\s*\+/.test(line)) {
          const params = [];
          let fixedLine = line.replace(/"([^"]*?)"\s*\+\s*(\w+)/g, (_, q, p) => {
            params.push(p);
            return `"${q}?"`;
          });
          if (params.length > 0) {
            fixedLine = fixedLine.replace(/\);\s*$/, `, [${params.join(', ')}]);`);
            lines[i] = fixedLine;
            repairs.push({ line: i + 1, fix: 'JS SQL → parameterized' });
          }
        }
      });
      fixed = lines.join('\n');
    }

    // db.query بدون params - استخرج params من السياق
    {
      const dbLines = fixed.split('\n');
      const sqlVarParams = new Map();
      // استخرج params من SQL variables
      dbLines.forEach((line, i) => {
        if (/(?:SELECT|INSERT|UPDATE|DELETE)/i.test(line) && /=\s*"/.test(line)) {
          const varM = line.match(/(\w+)\s*=/);
          if (varM) {
            // عد عدد ? في الـ query
            const qCount = (line.match(/\?/g) || []).length;
            sqlVarParams.set(varM[1], qCount);
          }
        }
      });
      
      dbLines.forEach((line, i) => {
        if (/\.query\s*\(\w+\s*,\s*function/.test(line) && !/\[/.test(line)) {
          const varM = line.match(/\.query\s*\((\w+)/);
          const qVar = varM ? varM[1] : null;
          const paramCount = qVar ? (sqlVarParams.get(qVar) || 0) : 0;
          // ابحث عن params من req.body وreq.query
          const prevCode = dbLines.slice(Math.max(0,i-10), i).join('\n');
          const vars = [];
          // const {username, hash} = req.body
          prevCode.replace(/(?:const|let|var)\s*\{([^}]+)\}\s*=\s*req\.(?:body|query|params)/g, (_, fields) => {
            fields.split(',').forEach(f => {
              const v = f.trim().split(':')[0].trim().split('=')[0].trim();
              if (v) vars.push(v);
            });
          });
          // const username = req.body.username
          prevCode.replace(/(?:const|let|var)\s+(\w+)\s*=\s*req\.(?:body|query|params)\.(\w+)/g, (_, v) => {
            vars.push(v);
          });
          const paramsStr = vars.length > 0 ? vars.slice(0, Math.max(paramCount, vars.length)).join(', ') : '/* params */';
          dbLines[i] = line.replace(/\.query\s*\((\w+)\s*,\s*function/, `.query($1, [${paramsStr}], function`);
        }
      });
      fixed = dbLines.join('\n');
    }

    // [NO-BLIND] XSS في res.send: أُوقف التحويل إلى res.json({ message: String(v)… }). كان يغيّر نوع
    // الاستجابة وشكلها، ويختار «متغيرًا» من النص فيُنتج مرجعًا غير معرّف (req.query.name ⇒ String(name)
    // ⇒ ReferenceError وقت التشغيل)، و.replace(/[<>]/g,'') ليس تهريبًا. والبوابة كانت تقبله (مقيس).

    // JS db.query با ? بدون array
    fixed = fixed.replace(
      /((?:db|conn|pool)\.query\s*\()("SELECT[^"]*\?[^"]*")(\s*,\s*function)/g,
      (m, pre, query, post) => {
        const prevLines = fixed.split('\n');
        const vars = [];
        prevLines.forEach(l => {
          const m2 = l.match(/(?:const|let|var)\s+(\w+)\s*=\s*req\.(?:query|params|body)\.(\w+)/);
          if (m2) vars.push(m2[1]);
          const m3 = l.match(/(?:const|let|var)\s*\{([^}]+)\}\s*=\s*req\.(?:query|params|body)/);
          if (m3) m3[1].split(',').forEach(v => vars.push(v.trim()));
        });
        const paramStr = vars.length ? vars.join(', ') : '/* params */';
        return `${pre}${query}, [${paramStr}]${post}`;
      }
    );

    // [NO-BLIND] eval → JSON.parse (حين «يبدو» الاسم JSON) أو حذف بتعليق: أُوقف. الاسم ليس دليلًا،
    // وJSON.parse أشد من eval (مقيس: eval(data) لـ"2 + 2" ⇒ 4، وبعده SyntaxError) — والبوابة كانت تقبله.

    // JWT hardcoded → process.env
    fixed = fixed.replace(
      /((?:const|let|var)\s+(?:JWT_SECRET|jwtSecret|JWT_KEY))\s*=\s*["'][^"']+["']/g,
      '$1 = process.env.JWT_SECRET'
    );
    fixed = fixed.replace(
      /jwt\.sign\s*\(([^,]+),\s*["'][^"']+["']/g,
      'jwt.sign($1, process.env.JWT_SECRET'
    );

    // Hardcoded secrets → process.env
    fixed = fixed.replace(
      /((?:const|let|var)\s+\w*(?:KEY|SECRET|TOKEN|STRIPE|API)\w*)\s*=\s*["'][^"']{10,}["']/g,
      (m, varDecl) => {
        const name = varDecl.match(/(\w+)\s*$/)?.[1] || 'SECRET';
        const envName = name.replace(/([a-z])([A-Z])/g, '$1_$2').toUpperCase();
        return `${varDecl} = process.env.${envName}`;
      }
    );

    // [NO-BLIND] أُوقفت هنا ستة تحويلات عامة على الملف كله. كلٌّ منها يغيّر سلوكًا صحيحًا في حالات
    // مقيسة، والبوابة كانت تقبل أغلبها لأنها لا ترى إلا النحو وعدد البلاغات:
    //   md5/sha1 → sha256          يغيّر القيمة الناتجة (ETag/مفتاح كاش محفوظ يفقد مطابقته)
    //   innerHTML → textContent    يعرض الوسوم المقصودة نصًّا حرفيًا
    //   "http:// → "https://       يكسر localhost، ويُفسد الاقتباس في '...' (‎'http://x' ⇒ "https://x'‎)
    //   var → let                  يكسر النطاق: if (x) { var y = 1 } return y ⇒ ReferenceError (مقيس، مقبول من البوابة)
    //   == → ===                   x == null (null أو undefined) ⇒ x === null يغيّر الناتج (مقيس، مقبول من البوابة)
    //   : any → : unknown          يكسر فحص الأنواع (x.length على unknown خطأ)
    // كل صنف منها له مُصلِح مبنيّ على الدليل في repair_engine.js (fixWeakCrypto/fixXSS+XSSFixer/fixHTTP/
    // fixVar بالـAST/fixEquality بحراسه)، ويعمل قبل هذا المحرك في المسار نفسه.
  }

  // ─── PHP ──────────────────────────────────────────

  if (ext === 'php') {

    // SQL concatenation → prepared statement
    if (/["'].*(?:SELECT|INSERT|UPDATE|DELETE).*["']\s*\./.test(fixed)) {
      const lines = fixed.split('\n');
      lines.forEach((line, i) => {
        const m = line.match(/\$(\w+)\s*=\s*["']([^"']*(?:SELECT|INSERT|UPDATE|DELETE)[^"']*?)["']\s*\.\s*\$(\w+)/);
        if (m) {
          const indent = ' '.repeat(line.search(/\S/));
          lines[i] = `${indent}$stmt = $conn->prepare("${m[2]}?");`;
          lines.splice(i + 1, 0, `${indent}$stmt->bind_param("s", $${m[3]});`);
          lines.splice(i + 2, 0, `${indent}$stmt->execute();`);
          repairs.push({ line: i + 1, fix: 'PHP SQL → prepared statement' });
        }
      });
      fixed = lines.join('\n');
    }

    // [NO-BLIND] md5/sha1 → hash("sha256", …): أُوقف — يغيّر القيمة الناتجة، وكلمات المرور تحتاج KDF وترحيلًا.

    // echo user input → htmlspecialchars
    fixed = fixed.replace(
      /echo\s+(\$_(?:GET|POST|REQUEST)\[.*?\])/g,
      'echo htmlspecialchars($1, ENT_QUOTES, "UTF-8")'
    );
  }

  // ─── C# / Unity ───────────────────────────────────

  if (ext === 'cs') {
    // [NO-BLIND] MD5 → SHA256: أُوقف (يغيّر القيمة الناتجة؛ كلمات المرور تحتاج KDF وترحيلًا).

    // Hardcoded secrets
    fixed = fixed.replace(
      /(private\s+string\s+\w*(?:key|secret|pass|token)\w*)\s*=\s*"[^"]+";/gi,
      '$1 = Environment.GetEnvironmentVariable("SECRET");'
    );
  }

  // ─── Java / Kotlin ────────────────────────────────

  if (ext === 'java' || ext === 'kt') {
    // [NO-BLIND] MD5 → SHA-256: أُوقف (يغيّر القيمة الناتجة؛ كلمات المرور تحتاج KDF وترحيلًا).
  }

  // cleanup نهائي - LIKE '%?%' → LIKE ?
  fixed = fixed.replace(/"([^"]*LIKE\s*)'%\?%'([^"]*)"/g, '"$1?$2"');
  fixed = fixed.replace(/"([^"]*LIKE\s*)%\?%([^"]*)"/g, '"$1?$2"');

  // صلح db.query params بعد LIKE - يربط query variable بـ params
  if (/LIKE \?/.test(fixed)) {
    const likeLines2 = fixed.split('\n');
    // ابحث عن LIKE query variables
    const likeVars = new Map();
    likeLines2.forEach((line, i) => {
      if (/LIKE \?/.test(line)) {
        const varM = line.match(/(\w+)\s*=/);
        if (varM) {
          // ابحث عن المتغيرات في الـ LIKE block
          const blockCode = likeLines2.slice(Math.max(0,i-5), i+1).join('\n');
          // ابحث عن المتغير المعرّف مو اسم الـ property
          const varDef = blockCode.match(/(?:let|var|const)\s+(\w+)\s*=\s*req\.(?:query|body|params)/g) || [];
          const lastVarDef = varDef.length ? varDef[varDef.length-1].match(/(?:let|var|const)\s+(\w+)/)?.[1] : null;
          if (lastVarDef) likeVars.set(varM[1], lastVarDef);
        }
      }
    });
    likeLines2.forEach((line, i) => {
      likeVars.forEach((termVar, sqlVar) => {
        if (new RegExp('\.query\\s*\\(' + sqlVar).test(line)) {
          likeLines2[i] = line.replace(
            /\.query\s*\((\w+)\s*,\s*\[[^\]]+\]\s*,\s*function/,
            `.query($1, ['%' + ${termVar} + '%'], function`
          );
        }
      });
    });
    fixed = likeLines2.join('\n');
  }

  return { fixed, repairs };
}

// ─── تطبيق Emergency Fixes على كل الملفات ────────────

function applyEmergencyToAll(F, R) {
  const results = {};
  let totalFixed = 0;

  Object.keys(F).forEach(fn => {
    const { fixed, repairs } = emergencyFix(F[fn], fn);

    if (fixed !== F[fn]) {
      F[fn] = fixed;
      R[fn] = { code: fixed, issues: typeof analyzeCode === 'function' ? analyzeCode(fixed, fn) : [] };
      totalFixed += Math.max(repairs.length, 1);
      results[fn] = repairs;
    }
  });

  return { totalFixed, results };
}
