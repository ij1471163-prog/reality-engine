// ─── Accumulation Detector ───────────────────────
// يكتشف = بدل += في حلقات forEach و for

const ACCUM_VARS = ['total','sum','count','revenue','sales','discount',
  'value','amount','price','cost','profit','balance','score','qty','quantity',
  'inventory','items','records'];

function detectAccumulation(code, fileName) {
  const issues = [];
  const lines = code.split('\n');
  const ext = fileName.split('.').pop().toLowerCase();
  
  if (!['js','ts','jsx','py'].includes(ext)) return issues;

  let inLoop = false;
  let loopDepth = 0;
  let declaredVars = new Set(); // متغيرات مُعرَّفة = 0

  lines.forEach((line, i) => {
    const t = line.trim();
    
    // تجاهل التعليقات
    if (t.startsWith('//') || t.startsWith('#') || t.startsWith('*')) return;

    // اكتشف المتغيرات المُهيَّأة بـ 0
    const declMatch = t.match(/(?:let|var|const|int|double|float)\s+(\w+)\s*=\s*0/);
    if (declMatch) declaredVars.add(declMatch[1]);

    // دخول حلقة
    if (t.includes('.forEach(') || t.includes('for (') || t.includes('for(')) {
      inLoop = true;
      loopDepth++;
    }

    // خروج من حلقة
    if (inLoop && (t === '});' || t === '}' || t === '});')) {
      loopDepth = Math.max(0, loopDepth - 1);
      if (loopDepth === 0) inLoop = false;
    }

    // اكتشف = بدل += داخل حلقة
    if (inLoop) {
      ACCUM_VARS.forEach(varName => {
        const accumPattern = new RegExp(`\\b${varName}\\s*=(?!=|\\+|-|\\*|/)\\s*\\S`);
        if (accumPattern.test(t) && !t.match(/(?:let|var|const|int|double|float)\s+/)) {
          // تحقق إن المتغير معرّف قبلاً بـ 0
          const isDeclared = declaredVars.has(varName) || 
            lines.slice(0, i).some(l => new RegExp(`\\b${varName}\\s*=\\s*0`).test(l));
          
          if (isDeclared) {
            const fix = t.replace(
              new RegExp(`(${varName})\\s*=(?!=)`),
              `$1 +=`
            );
            issues.push({
              type: 'bug',
              sev: 'c',
              title: `خطأ تراكم: ${varName} = بدل +=`,
              line: i + 1,
              ev: t,
              fix: fix,
              conf: 90,
              cIcon: '🟢',
              cAct: 'خطأ تراكم مؤكد',
              cEv: [`${varName} مُهيَّأ بـ 0 قبل الحلقة`, 'يُستبدل بدل يُجمع']
            });
          }
        }
      });
    }
  });

  return issues;
}

// دمج مع analyzeCode الرئيسي
const _originalAnalyzeCode = typeof analyzeCode !== 'undefined' ? analyzeCode : null;
function analyzeCodeEnhanced(code, fileName) {
  const baseIssues = _originalAnalyzeCode ? _originalAnalyzeCode(code, fileName) : [];
  const accumIssues = detectAccumulation(code, fileName);
  
  // تجنب التكرار
  const merged = [...baseIssues];
  accumIssues.forEach(ai => {
    const dup = baseIssues.some(bi => Math.abs(bi.line - ai.line) <= 1);
    if (!dup) merged.push(ai);
  });
  
  return merged;
}
