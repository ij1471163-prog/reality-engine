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

  issues.forEach(iss=>{
    const c=calcConf(iss,code);
    iss.conf=c.score;iss.cIcon=c.icon;iss.cAct=c.action;iss.cEv=c.ev;
  });
  return issues;
}
