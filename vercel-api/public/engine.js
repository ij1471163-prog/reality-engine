function escRe(s){return s.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')}

function calcConf(issue,code){
  let score=20,ev=['النمط مكتشف +20'];
  if(issue.type==='stub'){score+=20;ev.push('pass مؤكد +20')}
  else if(issue.title.includes('forEach')&&code.includes('.forEach(')){score+=20;ev.push('forEach موجود +20')}
  else if(issue.title.includes('None')&&/==\s*None/.test(code)){score+=20;ev.push('None موجودة +20')}
  else if(issue.title.includes('التراكم')){
    const v=issue.ev&&issue.ev.match(/^(\w+)\s*=/)?.[1];
    if(v&&new RegExp('\\b'+escRe(v)+'\\s*=\\s*0\\b').test(code)){score+=20;ev.push('متغير مهيأ بـ 0 +20')}
  }else{score+=10;ev.push('سياق جزئي +10')}
  if(issue.fix&&issue.fix.length<120&&!issue.fix.startsWith('#')){score+=10;ev.push('إصلاح مباشر +10')}
  if(issue.fix){
    const o=(issue.fix.match(/[{[(]/g)||[]).length;
    const c=(issue.fix.match(/[}\])]/g)||[]).length;
    if(o===c){score+=25;ev.push('أقواس متوازنة +25')}
  }
  if(issue.verified){score+=5;ev.push('تم التحقق +5')}
  score=Math.min(100,score);
  const icon=score>=90?'🟢':score>=60?'🟡':'🔴';
  const action=score>=90?'ثقة عالية':score>=60?'مشكلة محتملة':'غير مؤكد';
  return{score,icon,action,ev};
}

function analyzeCode(code,fileName){
  if(typeof analyzeJava!=='undefined'&&fileName.endsWith('.java'))return analyzeJava(code,fileName);
  const issues=[];
  const ext=fileName.split('.').pop();
  
  if(ext==='py'){
    const lines=code.split('\n');
    let loopInd=-1;
    lines.forEach((line,i)=>{
      const t=line.trim();
      const ind=line.search(/\S|$/);
      // stub
      const n1=lines[i+1]?.trim()||'';
      const n2=lines[i+2]?.trim()||'';
      if(/^def\s+\w+.*:$/.test(t)&&(n1==='pass'||n2==='pass'))
        issues.push({type:'stub',sev:'m',title:'دالة ناقصة',line:i+2,ev:t,fix:null});
      // = بدل +=
      if(/^for\s+\w+\s+in\s+/.test(t))loopInd=ind;
      const inLoop=loopInd>=0&&ind>loopInd;
      if(inLoop&&/^(total|sum|count|revenue|result)\s*=\s*[^=+\-\n]/.test(t)){
        const v=t.match(/^(\w+)\s*=/)?.[1];
        if(v&&new RegExp('\\b'+v+'\\s*=\\s*0\\b').test(code)){
          const fix=line.replace(/^(\s*)(\w+)\s*=\s*(.+)/,'$1$2 += $3').trim();
          issues.push({type:'bug',sev:'c',title:'خطأ في التراكم: = بدل +=',line:i+1,ev:t,fix});
        }
      }
      if(t.startsWith('def ')&&i>0)loopInd=-1;
      // == None
      if(/[=!]=\s*None/.test(line)&&!t.startsWith('#'))
        issues.push({type:'bug',sev:'m',title:'قارن بـ is None',line:i+1,ev:t,
          fix:t.replace('== None','is None').replace('!= None','is not None')});
      // bare except
      if(t==='except:')
        issues.push({type:'bug',sev:'m',title:'Bare except',line:i+1,ev:t,fix:'except Exception as e:'});
    });
  }

  if(ext==='js'||ext==='ts'||ext==='jsx'||ext==='html'){
    let work=code;
    if(ext==='html'){
      const sc=[];const re=/<script[^>]*>([\s\S]*?)<\/script>/gi;let m;
      while((m=re.exec(code))!==null)sc.push(m[1]);
      work=sc.join('\n');
    }
    const lines=work.split('\n');
    let inLoop=false;
    lines.forEach((line,i)=>{
      const t=line.trim();
      if(line.includes('.forEach(')){
        let hasR=false,hasSE=false;
        for(let j=i+1;j<Math.min(i+8,lines.length);j++){
          const jt=lines[j].trim();
          if(jt.startsWith('return '))hasR=true;
          if(/^[a-zA-Z_]\w*\s*\(/.test(jt)&&!jt.startsWith('return ')&&!jt.startsWith('//'))hasSE=true;
          if(/^\}\)/.test(jt))break;
        }
        if(hasR)issues.push({type:'bug',sev:'h',
          title:hasSE?'return داخل forEach مع side effects':'return داخل forEach',
          line:i+2,ev:line.trim(),fix:hasSE?null:line.replace('.forEach(','.find(').trim()});
        inLoop=true;
      }
      if(/for\s*\(/.test(line))inLoop=true;
      if(inLoop&&/^\s*(total|sum|count)\s*=\s*[^=+\-]/.test(line)){
        const fix=line.replace(/(\s*)(\w+)\s*=\s*(.+)/,'$1$2 += $3').trim();
        issues.push({type:'bug',sev:'c',title:'خطأ في التراكم: = بدل +=',line:i+1,ev:t,fix});
      }
      if(/[^=!<>]==[^=]/.test(line)&&/if\s*\(/.test(line))
        issues.push({type:'bug',sev:'m',title:'استخدم ===',line:i+1,ev:t,
          fix:t.replace(/([^=!<>])==([^=])/g,'$1===$2')});
      if(/^\}\)$|^\}$/.test(t))inLoop=false;
    });
  }

  enhanceStubs(issues, code);
  issues.forEach(iss=>{
    const c=calcConf(iss,code);
    if(!iss.fix||iss.conf<72){iss.conf=c.score;iss.cIcon=c.icon;iss.cAct=c.action;}
    iss.cEv=c.ev;
  });
  return issues;
}

// ─── Semantic Engine ─────────────────────────────────
function extractKeys(code, varName) {
  const keys = [], nested = {};
  const m = new RegExp('\\b' + varName + '\\s*=\\s*\\[').exec(code);
  if (!m) return {keys, nested};
  const block = code.slice(m.index, m.index + 1000);
  const dm = /\{([^{}]*(?:\{[^{}]*\}[^{}]*)*)\}/.exec(block);
  if (dm) {
    let km; const re = /"(\w+)"\s*:/g;
    while ((km = re.exec(dm[1])) !== null) keys.push(km[1]);
  }
  const nm = /"(\w+)"\s*:\s*\[\s*\{([^}]+)\}/g; let nm2;
  while ((nm2 = nm.exec(block)) !== null) {
    const nk = []; let nkm; const re2 = /"(\w+)"\s*:/g;
    while ((nkm = re2.exec(nm2[2])) !== null) nk.push(nkm[1]);
    nested[nm2[1]] = nk;
  }
  return {keys, nested};
}

function fk(keys, ...candidates) {
  return candidates.find(c => keys.includes(c)) || null;
}

function suggestFix(funcName, params, code) {
  const n = funcName.toLowerCase();
  const RATE = ['rate','ratio','discount','tax','fee','percent','factor','limit'];
  const COLL = ['orders','items','users','products','records','entries','list'];
  const DICT = ['order','item','user','product','record','entry'];

  const listP = params.filter(p => COLL.includes(p.toLowerCase()) || (p.endsWith('s') && p.length > 3 && !RATE.some(r => p.toLowerCase().includes(r))));
  const scalarP = params.filter(p => !listP.includes(p));
  const coll = listP[0] || null;
  const scalar = scalarP.find(p => RATE.some(r => p.toLowerCase().includes(r)) || p.endsWith('_id') || p.endsWith('_ref')) || scalarP[0] || null;
  const dictP = params.find(p => DICT.includes(p.toLowerCase())) || null;

  const allColls = [...new Set([...params.filter(p => p.endsWith('s')), ...COLL])];
  let keys = [], nested = {}, itemKeys = [];
  for (const c of allColls) {
    const {keys: k, nested: nk} = extractKeys(code, c);
    if (k.length) { keys = k; nested = nk; break; }
  }
  itemKeys = nested.items || nested.products || nested.entries || [];

  const idK = fk(keys, 'id', 'order_id', 'user_id', 'product_id');
  const customerK = fk(keys, 'username', 'customer', 'user', 'owner', 'name');
  const statusK = fk(keys, 'status', 'state', 'type');
  const activeK = fk(keys, 'active', 'enabled', 'is_active');
  const scoreK = fk(keys, 'score', 'rating', 'points', 'value');
  const priceK = fk(itemKeys, 'price', 'cost', 'amount') || fk(keys, 'price', 'cost', 'amount');
  const qtyK = fk(itemKeys, 'qty', 'quantity', 'count', 'units') || 'quantity';

  const c = coll || 'items';
  const d = dictP || 'item';
  const s = scalar || 'value';

  // Intent detection
  if (n.includes('best') || n.includes('top')) {
    if (scoreK) return `return max(${c}, key=lambda x: x.get("${scoreK}", 0))`;
    if (priceK) return `return max(${c}, key=lambda x: x.get("${priceK}", 0))`;
    return `return max(${c}, key=lambda x: x.get("score", 0))`;
  }
  if (n.includes('average') || n.includes('avg')) {
    const k = priceK || 'price';
    return `return sum(x["${k}"] for x in ${c}) / len(${c}) if ${c} else 0`;
  }
  if (n.includes('total') || n.includes('revenue') || n.includes('sum')) {
    if (priceK && qtyK && itemKeys.length)
      return `return sum(i["${priceK}"] * i["${qtyK}"] for i in ${d}["items"])`;
    if (priceK) {
      const qt = qtyK || 'quantity';
      return `return sum(x["${priceK}"] * x.get("${qt}", 1) for x in ${c})`;
    }
    return `return sum(x.get("price", 0) * x.get("quantity", 1) for x in ${c})`;
  }
  if (n.includes('expensive') || n.includes('cheap') || n.includes('minimum') || n.includes('maximum')) {
    const pk = priceK || 'price';
    if (scalar) return `return [x for x in ${c} if x.get("${pk}", 0) >= ${scalar}]`;
    return `return [x for x in ${c} if x.get("${pk}", 0) > 0]`;
  }
  if ((n.includes('filter') || n.includes('active') || n.includes('pending') || n.includes('available')) && coll) {
    const filterStatuses = ['active','pending','delivered','cancelled','available'];
    const st = filterStatuses.find(s => n.includes(s));
    if (st && statusK) return `return [x for x in ${c} if x.get("${statusK}") == "${st}"]`;
    if (activeK) return `return [x for x in ${c} if x.get("${activeK}")]`;
    if (statusK) return `return [x for x in ${c} if x.get("${statusK}") == "${st||'active'}"]`;
  }
  if (n.includes('find') || n.includes('get') || n.includes('search')) {
    // get_X_orders → ارجع list بفلتر customerK
    if (n.endsWith('_orders') && scalar && customerK)
      return `return [x for x in ${c} if x.get("${customerK}") == ${scalar}]`;
    if (scalar && idK && !n.endsWith('_orders')) return `return next((x for x in ${c} if x.get("${idK}") == ${scalar}), None)`;
    // لو scalar اسمه يطابق key في البيانات استخدمه مباشرة
    const matchKey = keys.find(k => k === scalar);
    // لكن لو n.includes orders/by استخدم customerK
    // get_customer_orders: لو يطلب orders بفلتر customer ارجع list
    if ((n.includes('orders') || n.startsWith('get_') && n.endsWith('_orders')) && scalar && customerK)
      return `return [x for x in ${c} if x.get("${customerK}") == ${scalar}]`;
    if (scalar && matchKey) return `return next((x for x in ${c} if x.get("${matchKey}") == ${scalar}), None)`;
    if (scalar && customerK) return `return next((x for x in ${c} if x.get("${customerK}") == ${scalar}), None)`;
  }
  if (n.includes('count')) {
    if (activeK) return `return sum(1 for x in ${c} if x.get("${activeK}"))`;
    return `return len(${c})`;
  }
  if (n.includes('discount') || n.includes('tax')) {
    return `return ${d}["price"] * (1 - ${s})`;
  }
  if (n.includes('normalize') || n.includes('format') || n.includes('clean')) {
    const nameK = customerK || 'username';
    if (dictP) return `return ${d}.get("${nameK}", "").strip().lower() if isinstance(${d}, dict) else str(${d}).strip().lower()`;
    return `return ${d}.strip().lower() if isinstance(${d}, str) else str(${d}).strip().lower()`;
  }
  if (n.includes('validate') || n.includes('check') || n.includes('verify')) {
    return `return ${d} is not None and bool(${d})`;
  }
  if (n.includes('email')) {
    const emailK = fk(keys, 'email', 'mail', 'contact');
    if (emailK && scalar) return `user = next((x for x in ${c} if x.get("${customerK||'username'}") == ${scalar}), None)\n    return user["${emailK}"] if user else None`;
  }
  if ((n.includes('orders') || n.includes('by')) && scalar) {
    const searchK = keys.find(k => k === scalar) || customerK || 'customer';
    return `return [x for x in ${c} if x.get("${searchK}") == ${scalar}]`;
  }
  return null;
}

function enhanceStubs(issues, code) {
  issues.forEach(issue => {
    if (issue.type !== 'stub') return;
    const m = issue.ev.match(/^def\s+(\w+)\s*\(([^)]*)\)/);
    if (!m) return;
    const funcName = m[1];
    const params = m[2].split(',').map(p => p.trim().split('=')[0].trim()).filter(Boolean);
    const fix = suggestFix(funcName, params, code);
    if (fix) {
      issue.fix = fix;
      issue.conf = 72;
      issue.cIcon = '🟡';
      issue.cAct = 'اقتراح محرك';
    }
  });
  return issues;
}
// ─── Java Analyzer ───────────────────────────────────

function suggestJavaFix(issue, code) {
  const n = issue.title.toLowerCase();
  const ev = issue.ev;
  
  // دالة فارغة - اقترح بناءً على الاسم والـ return type
  if (issue.title.includes('دالة فارغة')) {
    const m = ev.match(/(\w+)\s+(\w+)\s*\(([^)]*)\)/);
    if (!m) return null;
    const returnType = m[1], name = m[2], params = m[3];
    const nl = name.toLowerCase();
    
    if (returnType === 'void') return '// TODO: implement ' + name;
    if (returnType === 'boolean') {
      if (nl.includes('valid') || nl.includes('check')) return 'return ' + (params.split(',')[0]?.trim().split(' ').pop()||'value') + ' != null;';
      return 'return false;';
    }
    if (returnType === 'String') {
      if (nl.includes('get') || nl.includes('find')) return 'return null; // TODO: implement';
      if (nl.includes('format') || nl.includes('to')) return 'return String.valueOf(' + (params.split(',')[0]?.trim().split(' ').pop()||'value') + ');';
      return 'return "";';
    }
    if (returnType === 'int' || returnType === 'long') {
      if (nl.includes('count') || nl.includes('size')) return 'return 0;';
      if (nl.includes('total') || nl.includes('sum')) return 'return 0; // TODO: calculate';
      return 'return 0;';
    }
    if (returnType === 'double' || returnType === 'float') {
      if (nl.includes('total') || nl.includes('sum') || nl.includes('calculate')) return 'return 0.0; // TODO: calculate';
      return 'return 0.0;';
    }
    if (returnType.startsWith('List') || returnType.startsWith('ArrayList')) return 'return new ArrayList<>();';
    if (returnType.startsWith('Map')) return 'return new HashMap<>();';
    return 'return null;';
  }
  
  if (n.includes('catch')) return 'e.printStackTrace();';
  if (n.includes('equals')) return ev.replace(/(\w+)\s*==\s*(".*?")/, '$1.equals($2)');
  return null;
}

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
    if (!t.startsWith('//') && /"[^"]*"\s*==|==\s*"[^"]*"/.test(line))
      issues.push({type:'bug', sev:'h', title:'قارن String بـ .equals() بدل ==', line:i+1, ev:t,
        fix:t.replace(/([\w.]+)\s*==\s*("[^"]*")/, '$1.equals($2)').replace(/("[^"]*")\s*==\s*([\w.]+)/, '$2.equals($1)')});
  });

  // 7. catch فارغ
  lines.forEach((line, i) => {
    if (/catch\s*\(/.test(line)) {
      const next = lines[i+1]?.trim() || '';
      if (next === '}' || next === '// ignore' || next === '')
        issues.push({type:'bug', sev:'m', title:'catch فارغ يخفي الأخطاء', line:i+1, ev:line.trim(),
          fix:'    e.printStackTrace();'});
    }
  });

  issues.forEach(iss => {
    if (!iss.fix) iss.fix = suggestJavaFix(iss, code);
    const c = calcConf(iss, code);
    iss.conf = c.score; iss.cIcon = c.icon; iss.cAct = c.action; iss.cEv = c.ev;
  });

  return issues;
}
