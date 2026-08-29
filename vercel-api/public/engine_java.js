// ─── Java Analyzer ───────────────────────────────────

function analyzeJava(code, fileName) {
  const issues = [];
  const lines = code.split('\n');

  // 1. دوال ناقصة - جسم فارغ {}
  const emptyMethod = /^\s*(public|private|protected|static)\s+[\w<>\[\]]+\s+\w+\s*\([^)]*\)\s*\{\s*\}/;
  lines.forEach((line, i) => {
    if (emptyMethod.test(line)) {
      const name = line.match(/\s+(\w+)\s*\(/)?.[1];
      if (name && !['main','toString','hashCode','equals'].includes(name))
        issues.push({type:'stub', sev:'m', title:'دالة فارغة: '+name+'()', line:i+1, ev:line.trim(), fix:null});
    }
  });

  // 2. return null بدون منطق
  let inMethod = false, methodName = '', braceCount = 0;
  lines.forEach((line, i) => {
    const t = line.trim();
    if (/^\s*(public|private|protected)\s+\w[\w<>\[\]]*\s+\w+\s*\(/.test(line) && !t.includes('abstract')) {
      inMethod = true; braceCount = 0;
      methodName = line.match(/\s+(\w+)\s*\(/)?.[1] || '';
    }
    if (inMethod) {
      braceCount += (line.match(/\{/g)||[]).length - (line.match(/\}/g)||[]).length;
      if (t === 'return null;' && braceCount <= 1)
        issues.push({type:'stub', sev:'m', title:'return null بدون منطق: '+methodName+'()', line:i+1, ev:t, fix:'// أكمل المنطق هنا'});
      if (braceCount <= 0 && t.includes('}')) inMethod = false;
    }
  });

  // 3. TODO/FIXME
  lines.forEach((line, i) => {
    if (/\/\/\s*(TODO|FIXME|HACK|XXX)/i.test(line))
      issues.push({type:'stub', sev:'m', title:'TODO غير مكتمل', line:i+1, ev:line.trim(), fix:null});
  });

  // 4. throw new UnsupportedOperationException
  lines.forEach((line, i) => {
    if (/throw new UnsupportedOperationException/.test(line))
      issues.push({type:'stub', sev:'h', title:'UnsupportedOperationException', line:i+1, ev:line.trim(), fix:null});
  });

  // 5. NullPointerException risks
  lines.forEach((line, i) => {
    const t = line.trim();
    if (/\w+\.\w+\(/.test(t) && !t.startsWith('//') && !t.startsWith('*')) {
      const obj = t.match(/^(\w+)\./)?.[1];
      if (obj && !['System','Math','String','Integer','Arrays','Collections','Objects'].includes(obj)) {
        const defined = lines.slice(0, i).some(l => l.includes(obj + ' =') || l.includes(obj + '='));
        if (!defined) return; // skip
      }
    }
  });

  // 6. == بدل .equals() للـ String
  lines.forEach((line, i) => {
    const t = line.trim();
    if (!t.startsWith('//') && /String.*==|==.*String/.test(line))
      issues.push({type:'bug', sev:'h', title:'قارن String بـ .equals() بدل ==', line:i+1, ev:t,
        fix:t.replace(/(\w+)\s*==\s*(\w+)/, '$1.equals($2)')});
  });

  // 7. catch فارغ
  lines.forEach((line, i) => {
    if (/catch\s*\(/.test(line)) {
      const next = lines[i+1]?.trim() || '';
      if (next === '}' || next === '// ignore' || next === '')
        issues.push({type:'bug', sev:'m', title:'catch فارغ يخفي الأخطاء', line:i+1, ev:line.trim(),
          fix:line.replace('catch', 'catch').trim() + '\n    e.printStackTrace();'});
    }
  });

  issues.forEach(iss => {
    const c = calcConf(iss, code);
    iss.conf = c.score; iss.cIcon = c.icon; iss.cAct = c.action; iss.cEv = c.ev;
  });

  return issues;
}
