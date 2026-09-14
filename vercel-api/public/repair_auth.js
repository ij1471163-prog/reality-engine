// ═══════════════════════════════════════════════════════
// repair_auth.js v1.0 — إصلاح Auth Middleware
// يضيف auth check للدوال الحساسة
// ═══════════════════════════════════════════════════════
"use strict";

var AuthRepair = (() => {

  // دوال حساسة تحتاج auth
  const SENSITIVE_FUNCS = [
    'updatePlayer','saveGame','deleteUser','updateUser',
    'createOrder','processPayment','adminAction','deletePost',
    'updateProfile','changePassword','transfer','withdraw'
  ];

  // كلمات تدل على حساسية
  const SENSITIVE_OPS = [
    /db\.(query|execute|run)/i,
    /\.delete\s*\(/i,
    /\.update\s*\(/i,
    /\.create\s*\(/i,
    /fs\.(write|unlink|rmdir)/i,
    /stripe\.|payment/i,
    /admin/i,
  ];

  function needsAuth(funcName, funcBody) {
    // لو اسم الدالة حساس
    if (SENSITIVE_FUNCS.some(n => funcName.toLowerCase().includes(n.toLowerCase()))) return true;
    // لو الدالة تحتوي operations حساسة
    if (SENSITIVE_OPS.some(p => p.test(funcBody))) return true;
    return false;
  }

  function hasAuth(funcBody) {
    return /req\.user|auth|middleware|isAuthenticated|verify|token/i.test(funcBody);
  }

  // هل يفتح السطر كتلة تمتد لما بعده؟ (أقواس مفتوحة أكثر من المغلقة)
  // قوس يُفتح ويُغلق في نفس السطر ⇒ الإدراج بعده يضع return خارج الكتلة.
  function opensBlock(line) {
    return ((line || '').split('{').length - (line || '').split('}').length) > 0;
  }

  // فحص الـauth المُدرَج يستعمل req و res، فلا يصحّ إلا في دالة تستقبلهما
  // فعلاً؛ غير ذلك يُنتج كوداً يشير إلى متغيرات غير معرَّفة.
  function isRequestHandler(params) {
    return /\breq\b/.test(params || '') && /\bres\b/.test(params || '');
  }

  function fix(code, fileName) {
    const ext = (fileName || '').split('.').pop().toLowerCase();
    if (!['js','ts','jsx','tsx'].includes(ext)) return { fixed: code, repairs: [] };

    const lines = code.split('\n');
    const repairs = [];
    let i = 0;

    while (i < lines.length) {
      const line = lines[i];
      const routeM = line.match(/app\.(get|post|put|delete|patch)\s*\(/);
      if (routeM && !line.includes("req.user") && !line.includes("auth")) {
        let injected = false;
        for (let j = i; j < Math.min(i+3, lines.length); j++) {
          if (!lines[j].includes("{")) continue;
          // handler في سطر واحد ⇒ الإدراج بعده يضع return خارجه ⇒ نتخطّاه
          if (opensBlock(lines[j])) {
            lines.splice(j+1, 0, '  if (!req.user) return res.status(401).json({ error: "Unauthorized" });');
            repairs.push({ fix: "Auth check added to route" });
            i = j + 2;
            injected = true;
          }
          break;
        }
        // بلا إدراج لا بد أن يتقدّم المؤشر، وإلا دارت الحلقة بلا نهاية
        // (مثال: app.get('/x', handler); بلا قوس فتح في النافذة)
        if (!injected) i++;
        continue;
      }
      const funcMatch = line.match(/(?:async\s+)?function\s+(\w+)\s*\(([^)]*)\)/);

      if (funcMatch) {
        const funcName = funcMatch[1];
        const params = funcMatch[2];

        // ابحث عن نهاية الدالة
        let depth = 0;
        let funcEnd = i;
        let funcBody = '';
        for (let j = i; j < lines.length; j++) {
          for (const ch of lines[j]) {
            if (ch === '{') depth++;
            if (ch === '}') depth--;
          }
          funcBody += lines[j] + '\n';
          if (depth === 0 && j > i) { funcEnd = j; break; }
        }

        // تحقق هل تحتاج auth
        if (isRequestHandler(params) && needsAuth(funcName, funcBody) && !hasAuth(funcBody)) {
          const ind = ' '.repeat(line.search(/\S/) + 4);
          const authLine = `${ind}if (!req || !req.user) return res.status(401).json({ error: 'Unauthorized' });`;

          // أضف بعد السطر الأول من الدالة
          const openBrace = lines.findIndex((l, idx) => idx >= i && l.includes('{'));
          // دالة كاملة في سطر واحد: قوسها يُفتح ويُغلق في نفس السطر،
          // فالإدراج بعده يضع return خارج الدالة ⇒ نتخطّاها
          const braceLine  = openBrace >= 0 ? lines[openBrace] : '';
          if (openBrace >= 0 && opensBlock(braceLine)) {
            lines.splice(openBrace + 1, 0, authLine);
            repairs.push({ line: openBrace + 1, fix: `Auth check added to ${funcName}()` });
            i = openBrace + 2;
            continue;
          }
        }
      }
      i++;
    }

    return { fixed: lines.join('\n'), repairs, changed: repairs.length > 0 };
  }

  return { fix, needsAuth, hasAuth };
})();

if (typeof window !== 'undefined') window.AuthRepair = AuthRepair;
if (typeof module !== 'undefined') module.exports = AuthRepair;
