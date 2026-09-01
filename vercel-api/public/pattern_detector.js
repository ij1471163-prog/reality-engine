// ─── Pattern Detector ────────────────────────────
// يكتشف أنماط خطأ شائعة لم يغطها المحرك الرئيسي

function detectPatterns(code, fileName) {
  const issues = [];
  const lines = code.split('\n');
  const ext = fileName.split('.').pop().toLowerCase();
  const isPy = ext === 'py';
  const isJS = ['js','ts','jsx'].includes(ext);

  lines.forEach((line, i) => {
    const t = line.trim();
    if (!t || t.startsWith('//') || t.startsWith('#') || t.startsWith('*')) return;

    // 1. == بدل === في JS
    if (isJS && /[^!=<>]==[^=]/.test(t) && !/['"`]/.test(t.split('==')[0].slice(-1))) {
      if (!/https?:/.test(t)) {
        issues.push({
          type: 'bug', sev: 'm',
          title: 'مقارنة غير دقيقة: == بدل ===',
          line: i + 1, ev: t,
          fix: t.replace(/([^!=<>])==([^=])/g, '$1===$2'),
          conf: 80, cIcon: '🟡',
          cAct: '== لا يتحقق من النوع',
          cEv: ['استخدم === للمقارنة الدقيقة']
        });
      }
    }

    // 2. != بدل !== في JS
    if (isJS && /[^!]!=[^=]/.test(t) && !/['"`]/.test(t)) {
      issues.push({
        type: 'bug', sev: 'm',
        title: 'مقارنة غير دقيقة: != بدل !==',
        line: i + 1, ev: t,
        fix: t.replace(/([^!])!=([^=])/g, '$1!==$2'),
        conf: 75, cIcon: '🟡',
        cAct: '!= لا يتحقق من النوع',
        cEv: ['استخدم !== للمقارنة الدقيقة']
      });
    }

    // 3. catch فارغ JS
    if (isJS && (t === 'catch(e){}' || t === 'catch (e) {}' || t === 'catch{}')) {
      issues.push({
        type: 'bug', sev: 'h',
        title: 'catch فارغ يخفي الأخطاء',
        line: i + 1, ev: t,
        fix: t.replace('{}', '{ console.error(e); }'),
        conf: 95, cIcon: '🔴',
        cAct: 'الأخطاء مخفية',
        cEv: ['أضف console.error أو معالجة حقيقية']
      });
    }

    // 4. except فارغ Python
    if (isPy && (t === 'except:' || t === 'except Exception:')) {
      const nextLine = lines[i + 1] ? lines[i + 1].trim() : '';
      if (nextLine === 'pass' || nextLine === '') {
        issues.push({
          type: 'bug', sev: 'h',
          title: 'except فارغ يخفي الأخطاء',
          line: i + 1, ev: t,
          fix: t + '\n    logging.error(e)',
          conf: 90, cIcon: '🔴',
          cAct: 'الأخطاء مخفية',
          cEv: ['أضف logging.error أو معالجة حقيقية']
        });
      }
    }

    // 5. قسمة على صفر محتملة
    if (/\/\s*\w+/.test(t) && !/\/\/|https?:/.test(t) && !t.includes("'") && !t.includes('"') && !t.includes('`')) {
      const divisor = t.match(/\/\s*(\w+)/)?.[1];
      if (divisor && !['2','10','100','1000'].includes(divisor)) {
        const defined = lines.slice(0, i).some(l =>
          new RegExp(`${divisor}\\s*=\\s*[^=]`).test(l)
        );
        if (defined) {
          issues.push({
            type: 'bug', sev: 'l',
            title: `قسمة على ${divisor} — تحقق من الصفر`,
            line: i + 1, ev: t,
            fix: t.replace(
              new RegExp(`/\\s*${divisor}`),
              `/ (${divisor} || 1)`
            ),
            conf: 60, cIcon: '🟡',
            cAct: 'ممكن يسبب NaN أو Infinity',
            cEv: [`تحقق أن ${divisor} ≠ 0`]
          });
        }
      }
    }

    // 6. console.log في production JS
    if (isJS && t.startsWith('console.log(') && !t.includes('//')) {
      issues.push({
        type: 'bug', sev: 'l',
        title: 'console.log في الكود النهائي',
        line: i + 1, ev: t,
        fix: '// ' + t,
        conf: 70, cIcon: '🟡',
        cAct: 'احذف أو علّق قبل النشر',
        cEv: ['console.log يبطئ الأداء في production']
      });
    }

    // 7. var بدل let/const في JS
    if (isJS && t.startsWith('var ')) {
      issues.push({
        type: 'bug', sev: 'l',
        title: 'var قديم — استخدم let أو const',
        line: i + 1, ev: t,
        fix: t.replace(/^var /, 'let '),
        conf: 85, cIcon: '🟡',
        cAct: 'var له مشاكل في الـ scope',
        cEv: ['استخدم const للثوابت، let للمتغيرات']
      });
    }

    // 8. دوال ناقصة JS - جسم فارغ
    if (isJS && (/function\s+\w+\s*\([^)]*\)\s*\{/.test(t) || /function\s+\w+\s*\([^)]*\)\s*\{\s*\}/.test(t))) {
      const nextLines = lines.slice(i + 1, i + 4).map(l => l.trim());
      // كشف {} في نفس السطر
      const sameLineEmpty = /function\s+\w+\s*\([^)]*\)\s*\{\s*\}/.test(t);
      const isEmpty = sameLineEmpty || nextLines[0] === '}' ||
        (nextLines[0] === '' && nextLines[1] && nextLines[1] === '}') ||
        (nextLines[0] && nextLines[0].startsWith('//') && nextLines[1] && nextLines[1] === '}');
      if (isEmpty) {
        const funcName = t.match(/function\s+(\w+)/)?.[1];
        issues.push({
          type: 'stub', sev: 'h',
          title: `دالة ناقصة: ${funcName}()`,
          line: i + 1, ev: t,
          fix: null,
          conf: 90, cIcon: '🔴',
          cAct: 'الدالة فارغة',
          cEv: ['أضف المنطق المطلوب']
        });
      }
    }
  });

  return issues;
}

// دمج مع analyzeCode
const _origAnalyze = typeof analyzeCode === 'function' ? analyzeCode : null;
if (_origAnalyze) {
  window._patternDetectorLoaded = true;
}
