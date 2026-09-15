/**
 * repair_sql.js v1.0
 * إصلاح SQL Injection بشكل ذكي
 * ✅ يدعم Python + JavaScript + PHP + Java
 * ✅ يكتشف نوع الـ driver تلقائياً
 * ✅ لا يتعارض مع repair_engine.js
 * ✅ namespace منفصل: window.RepairSQL
 */

(function(global) {
  "use strict";

  // ═══════════════════════════════════════════════════
  // Driver Detection — نوع قاعدة البيانات
  // ═══════════════════════════════════════════════════

  const DRIVERS = {
    // JavaScript
    mysql: {
      placeholder: "?",
      name: "mysql/mysql2",
      family: "mysql"
    },
    pg: {
      placeholder: "$",
      name: "pg (PostgreSQL)",
      family: "postgres"
    },
    sqlite3: {
      placeholder: "?",
      name: "sqlite3",
      family: "sqlite"
    },
    knex: {
      placeholder: "?",
      name: "knex",
      family: "knex"
    },

    // Python
    sqlite: {
      placeholder: "?",
      name: "sqlite3 (Python)",
      family: "sqlite"
    },
    psycopg2: {
      placeholder: "%s",
      name: "psycopg2/psycopg",
      family: "postgres"
    },
    pymysql: {
      placeholder: "%s",
      name: "PyMySQL",
      family: "mysql"
    },

    // PHP
    pdo: {
      placeholder: "?",
      name: "PDO",
      family: "pdo"
    },
    mysqli: {
      placeholder: "?",
      name: "MySQLi",
      family: "mysqli"
    }
  };

  // ═══════════════════════════════════════════════════
  // SQL Patterns — اكتشاف الاستعلامات
  // ═══════════════════════════════════════════════════

  // JS: db.query("SELECT..." + variable)
  const JS_QUERY_CONCAT = /(\w+)\s*\.\s*(?:query|execute|raw)\s*\(\s*(['"`])([^'"`]*(?:SELECT|INSERT|UPDATE|DELETE)[^'"`]*)\2\s*\+\s*(.+?)\)/gi;

  // JS: db.query(`SELECT... ${variable}`)
  const JS_QUERY_TEMPLATE = /(\w+)\s*\.\s*(?:query|execute|raw)\s*\(\s*`([^`]*(?:SELECT|INSERT|UPDATE|DELETE)[^`]*)`\s*\)/gi;

  // Python: cursor.execute("SELECT..." + variable)
  const PY_EXECUTE_CONCAT = /(\w+)\s*\.\s*execute\s*\(\s*(['"])([^'"]*(?:SELECT|INSERT|UPDATE|DELETE)[^'"]*)\2\s*\+\s*(.+?)\)/gi;

  // Python: f"SELECT ... {variable}"
  const PY_FSTRING_SQL = /f(['"])([^'"]*(?:SELECT|INSERT|UPDATE|DELETE)[^'"]*)\1/gi;

  // PHP: $db->query("SELECT..." . $variable)
  const PHP_QUERY_CONCAT = /(\$\w+)\s*->\s*(?:query|execute|prepare)\s*\(\s*(['"])([^'"]*(?:SELECT|INSERT|UPDATE|DELETE)[^'"]*)\2\s*\.\s*(.+?)\)/gi;

  // ═══════════════════════════════════════════════════
  // Driver Detection
  // ═══════════════════════════════════════════════════

  function detectDriver(code) {
    if (!code || typeof code !== 'string') return null;

    const c = code.toLowerCase();
    const found = [];

    // JavaScript
    if (/\b(?:require\s*\(\s*['"]mysql2['"]\s*\)|from\s+['"]mysql2['"]|import\s+.*\s+from\s+['"]mysql2['"])/i.test(code) ||
        /\b(?:require\s*\(\s*['"]mysql['"]\s*\)|from\s+['"]mysql['"]|import\s+.*\s+from\s+['"]mysql['"])/i.test(code)) {
      found.push(DRIVERS.mysql);
    }

    if (/\b(?:require\s*\(\s*['"]pg['"]\s*\)|from\s+['"]pg['"]|import\s+.*\s+from\s+['"]pg['"])/i.test(code)) {
      found.push(DRIVERS.pg);
    }

    if (/\b(?:require\s*\(\s*['"]sqlite3['"]\s*\)|from\s+['"]sqlite3['"]|import\s+.*\s+from\s+['"]sqlite3['"])/i.test(code)) {
      found.push(DRIVERS.sqlite3);
    }

    if (/\b(?:require\s*\(\s*['"]knex['"]\s*\)|from\s+['"]knex['"]|import\s+.*\s+from\s+['"]knex['"])/i.test(code)) {
      found.push(DRIVERS.knex);
    }

    // Python
    if (/\bimport\s+psycopg2\b|\bfrom\s+psycopg2\s+import\b/i.test(code)) {
      found.push(DRIVERS.psycopg2);
    }

    if (/\bimport\s+psycopg\b|\bfrom\s+psycopg\s+import\b/i.test(code)) {
      found.push(DRIVERS.psycopg2);
    }

    if (/\bimport\s+pymysql\b|\bfrom\s+pymysql\s+import\b/i.test(code)) {
      found.push(DRIVERS.pymysql);
    }

    if (/\bimport\s+sqlite3\b|\bfrom\s+sqlite3\s+import\b/i.test(code)) {
      found.push(DRIVERS.sqlite);
    }

    if (/\b(?:import|from)\s+sqlalchemy\b/i.test(code)) {
      found.push(DRIVERS.sqlalchemy);
    }

    // PHP
    if (/\bnew\s+PDO\s*\(/i.test(code) ||
        /\bnew\s+pdo\s*\(/i.test(code)) {
      found.push(DRIVERS.pdo);
    }

    if (/\b(?:mysqli|mysqli_connect|new\s+mysqli)\b/i.test(code)) {
      found.push(DRIVERS.mysqli);
    }

    // إزالة التكرار
    const unique = [...new Set(found)];

    // لا نخمن إذا لا يوجد driver مثبت
    if (unique.length === 0) return null;

    // أكثر من driver مختلف = غير آمن للإصلاح التلقائي
    if (unique.length > 1) return null;

    return unique[0];
  }

  // ═══════════════════════════════════════════════════
  // Variable Extractor — استخراج المتغيرات من الـ query
  // ═══════════════════════════════════════════════════

  function extractVarsFromConcat(queryStr, concatPart) {
    const vars = [];

    // JS: "... '" + username + "' ..."
    const parts = concatPart.split(/\s*\+\s*/);
    parts.forEach(p => {
      const v = p.trim();
      // تجاهل الـ string literals
      if (v.startsWith('"') || v.startsWith("'") || v.startsWith('`')) return;
      if (v.length > 0) vars.push(v);
    });

    // Template literal: ${username}
    const templateVars = queryStr.match(/\$\{([^}]+)\}/g) || [];
    templateVars.forEach(tv => {
      vars.push(tv.replace(/\$\{|\}/g, '').trim());
    });

    return [...new Set(vars)]; // إزالة المكررات
  }

  // ═══════════════════════════════════════════════════
  // Query Builder — بناء الـ parameterized query
  // ═══════════════════════════════════════════════════

  function buildParameterizedQuery(queryStr, vars, driver, lang) {
    let cleanQuery = queryStr
      .replace(/'\s*\+\s*\w+\s*\+\s*'/g, '') // إزالة concatenation
      .replace(/"\s*\+\s*\w+\s*\+\s*"/g, '')
      .replace(/\$\{[^}]+\}/g, '')            // إزالة template vars
      .replace(/'\s*$/,  '')
      .replace(/^\s*'/, '')
      .trim();

    // استبدل القيم بـ placeholders
    let paramQuery = cleanQuery;
    let pgIndex = 1;

    vars.forEach((v, i) => {
      if (driver.placeholder === "$N") {
        // PostgreSQL: $1, $2, ...
        paramQuery += ` WHERE ${v} = $${pgIndex++}`;
      } else {
        paramQuery += ` = ${driver.placeholder}`;
      }
    });

    return buildFixedCode(queryStr, vars, paramQuery, driver, lang);
  }

  function buildFixedCode(original, vars, paramQuery, driver, lang) {
    if (lang === 'python') {
      return buildPythonFix(original, vars, paramQuery, driver);
    } else if (lang === 'php') {
      return buildPHPFix(original, vars, paramQuery, driver);
    } else {
      return buildJSFix(original, vars, paramQuery, driver);
    }
  }

  // ─── JavaScript fix ────────────────────────────────

  function buildJSFix(original, vars, paramQuery, driver) {
    const varArray = '[' + vars.join(', ') + ']';

    if (driver === DRIVERS.pg) {
      // pg: numbered placeholders
      let pgQuery = original;
      vars.forEach((v, i) => {
        pgQuery = pgQuery.replace(/WHERE\s+\w+\s*=\s*['"]?[^'"]+['"]?/i,
          `WHERE ${v} = $${i + 1}`);
      });
      return `db.query(\n  "${pgQuery}",\n  ${varArray}\n)`;
    }

    // mysql/sqlite: ? placeholders
    // استبدل WHERE x = '...' + var بـ WHERE x = ?
    let fixedQuery = original
      .replace(/=\s*['"]\s*'\s*\+\s*\w+\s*\+\s*['"]?\s*['"]/g, '= ?')
      .replace(/=\s*['"`]?\s*\+\s*\w+\s*\+?\s*['"`]?/g, '= ?')
      .replace(/\$\{[^}]+\}/g, '?')
      .replace(/\s+\?\s+/g, ' ? ');

    // نظّف الـ query من الـ concatenation artifacts
    fixedQuery = fixedQuery
      .replace(/'\s*\+\s*'/g, '')
      .replace(/"\s*\+\s*"/g, '')
      .trim();

    return `db.query(\n  "${fixedQuery}",\n  ${varArray}\n)`;
  }

  // ─── Python fix ────────────────────────────────────

  function buildPythonFix(original, vars, paramQuery, driver) {
    const placeholder = driver.placeholder; // ? أو %s
    const varTuple = vars.length === 1
      ? `(${vars[0]},)`
      : `(${vars.join(', ')})`;

    // بناء query نظيفة
    let fixedQuery = original
      .replace(/['"]?\s*\+\s*\w+\s*\+?\s*['"]?/g, `' + ${placeholder} + '`)
      .replace(/f['"]/g, '"')
      .replace(/\$\{[^}]+\}/g, placeholder)
      .replace(/\{[^}]+\}/g, placeholder)
      .trim();

    // تأكد إن الـ placeholder صح
    if (!fixedQuery.includes(placeholder)) {
      // أضف WHERE clause مع placeholder
      fixedQuery = fixedQuery.replace(
        /WHERE\s+(\w+)\s*=\s*.+/i,
        `WHERE $1 = ${placeholder}`
      );
    }

    return `query = "${fixedQuery}"\ncursor.execute(query, ${varTuple})`;
  }

  // ─── PHP fix ───────────────────────────────────────

  function buildPHPFix(original, vars, paramQuery, driver) {
    const varList = vars.join(', $');
    let fixedQuery = original
      .replace(/\.\s*\$\w+\s*\./g, '?')
      .replace(/\.\s*\$\w+/g, '?')
      .trim();

    if (driver === DRIVERS.pdo) {
      return `$stmt = $pdo->prepare("${fixedQuery}");\n$stmt->execute([$${varList}]);`;
    }
    return `$stmt = $mysqli->prepare("${fixedQuery}");\n$stmt->bind_param("s", $${varList});\n$stmt->execute();`;
  }

  // ═══════════════════════════════════════════════════
  // Main Fix Function — Entry Point
  // ═══════════════════════════════════════════════════

  function fixSQLInjection(code, fileName) {
    if (!code || typeof code !== 'string') {
      return {
        code,
        count: 0,
        fixes: [],
        driver: null,
        aiRequired: true,
        reason: 'invalid_code'
      };
    }

    const lang   = detectLang(fileName);
    const driver = detectDriver(code);

    // لا نخمن اللغة أو الـ driver.
    // إذا لم نستطع إثباتهما، لا نعدل الكود.
    if (lang === 'unknown') {
      return {
        code,
        count: 0,
        fixes: [],
        driver: null,
        aiRequired: true,
        reason: 'unsupported_language'
      };
    }

    if (!driver) {
      return {
        code,
        count: 0,
        fixes: [],
        driver: null,
        aiRequired: true,
        reason: 'unknown_or_conflicting_driver'
      };
    }

    // لا تستخدم هذا الـ SQL fixer مع لغات لا يملك لها مسار إصلاح آمن.
    if (!['js', 'python', 'php'].includes(lang)) {
      return {
        code,
        count: 0,
        fixes: [],
        driver: driver.name,
        aiRequired: true,
        reason: 'unsupported_sql_repair_language'
      };
    }

    let   fixed  = code;
    let   count  = 0;
    const fixes  = [];

    // ── JavaScript ──────────────────────────────────
    if (lang === 'js') {

      // نصلح فقط concatenation بسيطة ومباشرة:
      // db.query("SELECT ... WHERE name = '" + username + "'")
      fixed = fixed.replace(
        /(\b[A-Za-z_$][\w$]*)\s*\.\s*(query|execute)\s*\(\s*(["'])(.*?)\3\s*\+\s*([A-Za-z_$][\w$]*)\s*\+\s*(["'])(.*?)\6\s*\)/g,
        (match, dbVar, method, q1, queryPart, variable, q2, suffix) => {

          // إذا كان هناك concatenation إضافية بعد المتغير،
          // فهذا SQL متعدد المتغيرات ولا نصلحه بهذا المسار البسيط.
          if (/['"]\s*\+\s*[A-Za-z_$][\w$]*/.test(suffix)) {
            return match;
          }

          const sql = queryPart + suffix;

          // لازم يكون SQL فعلي
          if (!/\b(SELECT|INSERT|UPDATE|DELETE)\b/i.test(sql)) {
            return match;
          }

          // المتغير يجب أن يكون في سياق قيمة، وليس اسم جدول/عمود.
          // نسمح فقط بـ = ' + variable + '
          const valuePattern =
            /(\b[A-Za-z_][A-Za-z0-9_]*\s*=\s*)['"]?\s*$/i;

          if (!valuePattern.test(queryPart)) {
            return match;
          }

          // لا نصلح إذا كان SQL يحتوي على placeholders مسبقاً.
          if (/[?$]\d*|%s\b|:\w+/.test(sql)) {
            return match;
          }

          const placeholder =
            driver.name === 'pg (PostgreSQL)' ? '$1' : (driver.placeholder || '?');

          const cleanSQL =
            queryPart.replace(/['"]\s*$/i, '') +
            suffix.replace(/^\s*['"]/i, '') +
            placeholder;

          const result =
            `${dbVar}.${method}(${JSON.stringify(cleanSQL)}, [${variable}])`;

          fixes.push({
            original: match,
            fixed: result,
            strategy: 'simple_parameterization',
            driver: driver.name
          });

          count++;
          return result;
        }
      );

      // Template literals:
      // db.query(`SELECT ... WHERE name = '${username}'`)
      //
      // نصلح فقط إذا كان placeholder داخل قيمة مقارنة واضحة.
      fixed = fixed.replace(
        /(\b[A-Za-z_$][\w$]*)\s*\.\s*(query|execute)\s*\(\s*`([^`]*\$\{([A-Za-z_$][\w$]*)\}[^`]*)`\s*\)/g,
        (match, dbVar, method, sql, variable) => {

          if (!/\b(SELECT|INSERT|UPDATE|DELETE)\b/i.test(sql)) {
            return match;
          }

          if (/[?$]\d*|%s\b|:\w+/.test(sql.replace(/\$\{[^}]+\}/g, ''))) {
            return match;
          }

          // نسمح فقط بالمتغير داخل قيمة equality.
          const marker = `\${${variable}}`;
          const escapedMarker = marker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

          const safePattern = new RegExp(
            `(\\b[A-Za-z_][A-Za-z0-9_]*\\s*=\\s*)['"]?\\s*${escapedMarker}\\s*['"]?`,
            'i'
          );

          if (!safePattern.test(sql)) {
            return match;
          }

          const placeholder =
            driver.name === 'pg (PostgreSQL)' ? '$1' : (driver.placeholder || '?');

          const cleanSQL = sql.replace(
            safePattern,
            (_match, prefix) => prefix + placeholder
          );

          const result =
            `${dbVar}.${method}(${JSON.stringify(cleanSQL)}, [${variable}])`;

          fixes.push({
            original: match,
            fixed: result,
            strategy: 'template_parameterization',
            driver: driver.name
          });

          count++;
          return result;
        }
      );
    }

    // ── Python ──────────────────────────────────────
    if (lang === 'python') {

      // نصلح فقط cursor.execute("... = '" + variable + "'")
      // بمتغير واحد وشرط equality واضح.
      fixed = fixed.replace(
        /(\b[A-Za-z_][A-Za-z0-9_]*\s*\.\s*execute\s*\(\s*)(["'])(.*?)\2\s*\+\s*([A-Za-z_][A-Za-z0-9_]*)\s*\+\s*(["'])(.*?)\5\s*\)/g,
        (match, prefix, q1, queryPart, variable, q2, suffix) => {

          const sql = queryPart + suffix;

          // لازم يكون SQL فعلي.
          if (!/\b(SELECT|INSERT|UPDATE|DELETE)\b/i.test(sql)) {
            return match;
          }

          // متغير واحد فقط، ولا نسمح بـ concatenation إضافية.
          if (/[+]\s*[A-Za-z_][A-Za-z0-9_]*/.test(suffix)) {
            return match;
          }

          // لازم يكون المتغير داخل equality لقيمة.
          const valuePattern =
            /(\b[A-Za-z_][A-Za-z0-9_]*\s*=\s*)['"]?\s*$/i;

          if (!valuePattern.test(queryPart)) {
            return match;
          }

          // لا نلمس SQL فيه placeholders مسبقة.
          if (/[?$]\d*|%s\b|:\w+/.test(sql)) {
            return match;
          }

          const placeholder =
            driver.placeholder || '?';

          const cleanSQL =
            queryPart.replace(/['"]\s*$/i, '') +
            suffix.replace(/^\s*['"]/i, '') +
            placeholder;

          const result =
            `${prefix}${JSON.stringify(cleanSQL)}, (${variable},))`;

          fixes.push({
            original: match,
            fixed: result,
            strategy: 'python_simple_parameterization',
            driver: driver.name
          });

          count++;
          return result;
        }
      );

      // f-string و SQL assignment متعمدًا بدون auto-fix هنا.
      // لأنها تحتاج تحليل سياق أعمق، وتذهب لاحقًا إلى AI_REQUIRED.
    }

    // ── PHP ─────────────────────────────────────────
    if (lang === 'php' && driver === DRIVERS.pdo) {

      // PDO فقط: concatenation بسيطة بمتغير واحد.
      // mysqli لا يدخل هذا المسار.
      fixed = fixed.replace(
        /(\$\w+)\s*->\s*query\s*\(\s*"([^"]*(?:SELECT|INSERT|UPDATE|DELETE)[^"]*)"\s*\.\s*(\$[A-Za-z_][A-Za-z0-9_]*)\s*\.\s*"([^"]*)"\s*\)\s*;?/gi,
        (match, dbVar, queryPart, variable, suffix) => {

          if (!/\b(?:SELECT|INSERT|UPDATE|DELETE)\b/i.test(queryPart)) {
            return match;
          }

          // لا نصلح إذا كان فيه placeholder موجود مسبقاً.
          if (/[?$]\d*|%s\b|:\w+/.test(queryPart + suffix)) {
            return match;
          }

          // المتغير يجب أن يكون في نهاية قيمة equality واضحة.
          if (!/\b[A-Za-z_][A-Za-z0-9_]*\s*=\s*'?\s*$/i.test(queryPart)) {
            return match;
          }

          const cleanSQL =
            queryPart.replace(/['"]\s*$/i, '') +
            '?' +
            suffix.replace(/^\s*['"]/, '');

          const result =
            `$stmt = ${dbVar}->prepare(${JSON.stringify(cleanSQL)});\n` +
            `$stmt->execute([${variable}]);`;

          fixes.push({
            original: match,
            fixed: result,
            strategy: 'php_pdo_simple_parameterization',
            driver: driver.name
          });

          count++;
          return result;
        }
      );
    }

    return {
      code: fixed,
      count,
      fixes,
      driver: driver.name,
      aiRequired: count === 0
    };
  }

  // ═══════════════════════════════════════════════════
  // Language Detection
  // ═══════════════════════════════════════════════════

  function detectLang(fileName) {
    if (!fileName || typeof fileName !== 'string') return 'unknown';

    const ext = fileName.split('.').pop().toLowerCase();

    if (['js', 'mjs', 'cjs', 'jsx'].includes(ext)) return 'js';
    if (['ts', 'tsx'].includes(ext)) return 'ts';
    if (ext === 'py') return 'python';
    if (ext === 'php') return 'php';
    if (ext === 'java') return 'java';
    if (ext === 'kt') return 'kotlin';

    return 'unknown';
  }

  // ═══════════════════════════════════════════════════
  // Scan — فحص بدون إصلاح
  // ═══════════════════════════════════════════════════

  function scanForSQLInjection(code, fileName) {
    const issues = [];
    const lines  = code.split('\n');
    const lang   = detectLang(fileName);

    const patterns = lang === 'python'
      ? [/\.execute\s*\(\s*['"].*(?:SELECT|INSERT|UPDATE|DELETE).*['"]\s*\+/gi,
         /f['"].*(?:SELECT|INSERT|UPDATE|DELETE).*\{/gi]
      : lang === 'php'
      ? [/->\s*(?:query|execute)\s*\(.*(?:SELECT|INSERT|UPDATE|DELETE).*\./gi]
      : [/\.(?:query|execute|raw)\s*\(.*(?:SELECT|INSERT|UPDATE|DELETE).*\+/gi,
         /\.(?:query|execute|raw)\s*\(`.*(?:SELECT|INSERT|UPDATE|DELETE).*\$\{/gi];

    lines.forEach((line, i) => {
      const t = line.trim();
      if (t.startsWith('//') || t.startsWith('#') || t.startsWith('*')) return;

      patterns.forEach(pat => {
        pat.lastIndex = 0;

        if (pat.test(line)) {
          const repaired = fixSQLInjection(code, fileName);

          let fixedLine = t;

          if (repaired.code !== code) {
            const fixedLines = repaired.code.split('\n');

            if (fixedLines[i] !== undefined) {
              fixedLine = fixedLines[i].trim();
            }
          }

          issues.push({
            line:  i + 1,
            code:  t,
            sev:   'c',
            title: 'SQL Injection — string concatenation في query',
            fix:   fixedLine,
          });
        }
      });
    });

    return issues;
  }

  // ═══════════════════════════════════════════════════
  // Export — namespace منفصل لا يتعارض
  // ═══════════════════════════════════════════════════

  global.RepairSQL = {
    fix:    fixSQLInjection,
    scan:   scanForSQLInjection,
    drivers: DRIVERS,
    version: '1.0',
  };

  // للتوافق مع repair_engine.js
  if (typeof global.repairFunctions === 'undefined') {
    global.repairFunctions = {};
  }
  global.repairFunctions.sqlInjection = fixSQLInjection;

})(typeof window !== 'undefined' ? window : global);
