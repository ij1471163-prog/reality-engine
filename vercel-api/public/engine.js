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
    // لو فيه nested items احسب التوتال
    if (n.includes('customer') || n.includes('user')) {
      const pk = priceK || 'price'; const qk = qtyK || 'quantity';
      return `totals = {}
for o in ${c}:
    k = o.get("${customerK||'customer'}")
    totals[k] = totals.get(k, 0) + sum(i["${pk}"]*i.get("${qk}",1) for i in o.get("items",[]))
return max(totals, key=totals.get) if totals else None`;
    }
    const byKey = scoreK || 'score';
    return `return max(${c}, key=lambda x: x.get("${byKey}", 0))`;
  }
  if (n.includes('average') || n.includes('avg')) {
    const k = priceK || 'price';
    return `return sum(x["${k}"] for x in ${c}) / len(${c}) if ${c} else 0`;
  }
  if (n.includes('total') || n.includes('revenue') || n.includes('sum')) {
    if (priceK && qtyK && itemKeys.length)
      return `return sum(i["${priceK}"] * i["${qtyK}"] for i in ${d}["items"])`;
    if (priceK)
      return `return sum(x["${priceK}"] for x in ${c})`;
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
    if (scalar && idK) return `return next((x for x in ${c} if x.get("${idK}") == ${scalar}), None)`;
    // لو scalar نفس اسم key في البيانات استخدمه مباشرة
    const matchKey = keys.find(k => k === scalar);
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
    return `return str(${d}).strip().lower()`;
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
