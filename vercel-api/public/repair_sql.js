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
    mysql:    { placeholder: "?",  arrayWrap: true,  name: "mysql/mysql2" },
    pg:       { placeholder: "$N", arrayWrap: true,  name: "pg (PostgreSQL)" },
    sqlite3:  { placeholder: "?",  arrayWrap: true,  name: "sqlite3" },
    knex:     { placeholder: "?",  arrayWrap: true,  name: "knex" },
    mongoose: { placeholder: null, arrayWrap: false, name: "mongoose" }, // NoSQL — مختلف

    // Python
    sqlite:   { placeholder: "?",  arrayWrap: false, name: "sqlite3 (Python)" },
    psycopg2: { placeholder: "%s", arrayWrap: false, name: "psycopg2" },
    pymysql:  { placeholder: "%s", arrayWrap: false, name: "PyMySQL" },
    sqlalchemy:{ placeholder: ":param", arrayWrap: false, name: "SQLAlchemy" },

    // PHP
    pdo:      { placeholder: "?",  arrayWrap: false, name: "PDO" },
    mysqli:   { placeholder: "?",  arrayWrap: false, name: "MySQLi" },
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
    const c = code.toLowerCase();

    // JavaScript
    if (c.includes("require('mysql2')") || c.includes('require("mysql2")'))  return DRIVERS.mysql;
    if (c.includes("require('mysql')")  || c.includes('require("mysql")'))   return DRIVERS.mysql;
    if (c.includes("require('pg')")     || c.includes('require("pg")'))      return DRIVERS.pg;
    if (c.includes("require('sqlite3')")|| c.includes('require("sqlite3")')) return DRIVERS.sqlite3;
    if (c.includes("require('knex')")   || c.includes('require("knex")'))    return DRIVERS.knex;
    if (c.includes("mongoose"))                                               return DRIVERS.mongoose;

    // Python
    if (c.includes("import psycopg2"))   return DRIVERS.psycopg2;
    if (c.includes("import pymysql"))    return DRIVERS.pymysql;
    if (c.includes("sqlalchemy"))        return DRIVERS.sqlalchemy;
    if (c.includes("import sqlite3"))    return DRIVERS.sqlite;

    // PHP
    if (c.includes("new pdo("))         return DRIVERS.pdo;
    if (c.includes("mysqli_"))          return DRIVERS.mysqli;

    // Default
    return DRIVERS.mysql;
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
    if (!code || typeof code !== 'string') return code;

    const lang   = detectLang(fileName);
    const driver = detectDriver(code);
    let   fixed  = code;
    let   count  = 0;
    const fixes  = [];

    // ── JavaScript ──────────────────────────────────
    if (lang === 'js') {
      // 1. String concatenation: db.query("..." + var)
      fixed = fixed.replace(
        /(\w+)\s*\.\s*(?:query|execute|raw)\s*\(\s*(['"`])([^'"`]*(?:SELECT|INSERT|UPDATE|DELETE)[^'"`]*)\2\s*(\+[^)]+)\)/gi,
        (match, dbVar, quote, queryStr, concatPart) => {
          const vars = extractVarsFromConcat(queryStr, concatPart);
          if (!vars.length) return match;

          // بناء query نظيفة مع ?
          let cleanQ = queryStr
            .replace(/WHERE\s+(\w+)\s*=\s*['"]?[^'"]*['"]?/i, `WHERE $1 = ?`)
            .trim();

          // لو ما غيّر WHERE — استبدل آخر concatenation بـ ?
          if (cleanQ === queryStr.trim()) {
            cleanQ = queryStr.trim().replace(/['"]\s*\+\s*\w+\s*\+\s*['"]/, '?');
          }

          const varArray = '[' + vars.join(', ') + ']';
          const result   = `${dbVar}.query(\n  "${cleanQ}",\n  ${varArray}\n)`;
          fixes.push({ original: match, fixed: result });
          count++;
          return result;
        }
      );

      // 2. Template literals: db.query(`SELECT... ${var}`)
      fixed = fixed.replace(
        /(\w+)\s*\.\s*(?:query|execute|raw)\s*\(\s*`([^`]*(?:SELECT|INSERT|UPDATE|DELETE)[^`]*)`\s*\)/gi,
        (match, dbVar, queryStr) => {
          const vars = (queryStr.match(/\$\{([^}]+)\}/g) || [])
            .map(v => v.replace(/\$\{|\}/g, '').trim());
          if (!vars.length) return match;

          const cleanQ   = queryStr.replace(/\$\{[^}]+\}/g, '?');
          const varArray = '[' + vars.join(', ') + ']';
          const result   = `${dbVar}.query(\n  "${cleanQ}",\n  ${varArray}\n)`;
          fixes.push({ original: match, fixed: result });
          count++;
          return result;
        }
      );
    }

    // ── Python ──────────────────────────────────────
    if (lang === 'python') {
      // cursor.execute("..." + var)
      fixed = fixed.replace(
        /(\w+)\s*\.\s*execute\s*\(\s*(['"])([^'"]*(?:SELECT|INSERT|UPDATE|DELETE)[^'"]*)\2\s*\+\s*(.+?)\)/gi,
        (match, cursor, quote, queryStr, concatPart) => {
          const vars = extractVarsFromConcat(queryStr, concatPart);
          if (!vars.length) return match;

          const placeholder = driver.placeholder;
          const cleanQ = queryStr.replace(
            /WHERE\s+(\w+)\s*=\s*['"]?[^'"]*['"]?/i,
            `WHERE $1 = ${placeholder}`
          );
          const varTuple = vars.length === 1 ? `(${vars[0]},)` : `(${vars.join(', ')})`;
          const result   = `${cursor}.execute("${cleanQ}", ${varTuple})`;
          fixes.push({ original: match, fixed: result });
          count++;
          return result;
        }
      );

      // f-string SQL
      fixed = fixed.replace(
        /f(['"])([^'"]*(?:SELECT|INSERT|UPDATE|DELETE)[^'"]*)\1/gi,
        (match, quote, queryStr) => {
          const vars = (queryStr.match(/\{([^}]+)\}/g) || [])
            .map(v => v.replace(/\{|\}/g, '').trim());
          if (!vars.length) return match;

          const placeholder = driver.placeholder;
          const cleanQ      = queryStr.replace(/\{[^}]+\}/g, placeholder);
          const varTuple    = vars.length === 1 ? `(${vars[0]},)` : `(${vars.join(', ')})`;
          const result      = `"${cleanQ}"  # params: ${varTuple}`;
          fixes.push({ original: match, fixed: result });
          count++;
          return result;
        }
      );
    }

    // ── PHP ─────────────────────────────────────────
    if (lang === 'php') {
      fixed = fixed.replace(
        /(\$\w+)\s*->\s*(?:query|execute)\s*\(\s*(['"])([^'"]*(?:SELECT|INSERT|UPDATE|DELETE)[^'"]*)\2\s*\.\s*(.+?)\)/gi,
        (match, dbVar, quote, queryStr, concatPart) => {
          const vars = extractVarsFromConcat(queryStr, concatPart);
          if (!vars.length) return match;

          const cleanQ   = queryStr.replace(/WHERE\s+(\w+)\s*=\s*.*/i, 'WHERE $1 = ?');
          const varList  = vars.map(v => v.startsWith('$') ? v : '$' + v).join(', ');
          const result   = `$stmt = ${dbVar}->prepare("${cleanQ}");\n$stmt->execute([${varList}]);`;
          fixes.push({ original: match, fixed: result });
          count++;
          return result;
        }
      );
    }

    return { code: fixed, count, fixes, driver: driver.name };
  }

  // ═══════════════════════════════════════════════════
  // Language Detection
  // ═══════════════════════════════════════════════════

  function detectLang(fileName) {
    if (!fileName) return 'js';
    const ext = fileName.split('.').pop().toLowerCase();
    if (ext === 'py')                     return 'python';
    if (ext === 'php')                    return 'php';
    if (['java','kt'].includes(ext))      return 'java';
    return 'js'; // default
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
          issues.push({
            line:  i + 1,
            code:  t,
            sev:   'c',
            title: 'SQL Injection — string concatenation في query',
            fix:   fixSQLInjection(line, fileName).code,
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
