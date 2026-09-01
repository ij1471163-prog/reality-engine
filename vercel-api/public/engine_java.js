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

  // Java String == detection
  lines.forEach((line, i) => {
    const t = line.trim();
    if (t.startsWith('//')) return;
    // كشف String == بدل .equals()
    if (/==\s*\w/.test(t) && !t.includes('.equals(') && !t.includes('null') && !t.includes('==\s*true') && !t.includes('== false')) {
      const varMatch = t.match(/(\w+(?:\.\w+)?(?:\(\))?)\s*==\s*(\w+(?:\.\w+)?(?:\(\))?)/);
      if (varMatch) {
        const left = varMatch[1], right = varMatch[2];
        // تحقق إن أحدهم String method مثل getStatus, getCategory
        if (/get[A-Z]/.test(left) || /get[A-Z]/.test(right) || left.includes('()') || right.includes('()')) {
          const dup = issues.some(x => x.line === (i+1) && x.title.includes('String =='));
          if (!dup) issues.push({
            type: 'bug', sev: 'h',
            title: 'String == بدل .equals() في Java',
            line: i+1, ev: t,
            fix: t.replace(
              new RegExp('(\w+(?:\.\w+)?)\s*==\s*(\w+(?:\.\w+)?)'),
              '$1.equals($2)'
            )
          });
        }
      }
    }
  });

  // Null chain detection — obj.method().method() بدون null check
  lines.forEach((_l, _i) => {
    const _t = _l.trim();
    if (_t.startsWith('//') || _t.startsWith('*')) return;
    // ابحث عن .method().method() أو .getName().trim() وما شابه
    if (/\.\w+\(\)\.\w+/.test(_t) && !_t.includes('//')) {
      const dup = issues.some(_x => Math.abs(_x.line - (_i+1)) <= 1 && _x.title.includes('null'));
      if (!dup) issues.push({
        type: 'bug', sev: 'h',
        title: 'NPE محتمل: تسلسل methods بدون null check',
        line: _i+1, ev: _t,
        fix: '// أضف null check قبل هذا السطر',
        conf: 70, cIcon: '🟡', cAct: 'ممكن NullPointerException',
        cEv: ['تحقق من null قبل استدعاء الدالة']
      });
    }
  });

  // Java accumulation detection
  const _javaAccumVars = ['total','sum','count','revenue','value','amount','price','cost'];
  const _javaLines = code.split('\n');
  let _jInLoop = false, _jDeclared = new Set();
  _javaLines.forEach((_l, _i) => {
    const _t = _l.trim();
    if (_t.startsWith('//')) return;
    const _dm = _t.match(/(?:int|double|float|long)\s+(\w+)\s*=\s*0/);
    if (_dm) _jDeclared.add(_dm[1]);
    if (/for\s*\(|forEach\s*\(/.test(_t)) _jInLoop = true;
    if (_jInLoop && (_t === '}' || _t === '});')) _jInLoop = false;
    if (_jInLoop) {
      _javaAccumVars.forEach(_v => {
        const _p = new RegExp('\\b' + _v + '\\s*=(?!=|\\+|-)\\s*\\S');
        if (_p.test(_t) && !_t.match(/(?:int|double|float|long)\s+/)) {
          const _known = _jDeclared.has(_v) ||
            _javaLines.slice(0, _i).some(_x => new RegExp('\\b' + _v + '\\s*=\\s*0').test(_x));
          if (_known) {
            const _dup = issues.some(_x => Math.abs(_x.line - (_i+1)) <= 1);
            if (!_dup) issues.push({type:'bug', sev:'c',
              title: 'خطأ تراكم Java: ' + _v + ' = بدل +=',
              line: _i+1, ev: _t,
              fix: _t.replace(new RegExp('(' + _v + ')\\s*=(?!=)'), '$1 +=')});
          }
        }
      });
    }
  });

  issues.forEach(iss => {
    const c = calcConf(iss, code);
    iss.conf = c.score; iss.cIcon = c.icon; iss.cAct = c.action; iss.cEv = c.ev;
  });

  return issues;
}
