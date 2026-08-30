// ─── Repair Impact Analyzer ──────────────────────────
// يحلل أثر الإصلاح قبل تطبيقه

const IMPACT_APIS = {
  network: ['urlopen','urllib','requests','fetch','axios','http','https','XMLHttpRequest','WebSocket','socket'],
  system:  ['subprocess','exec','spawn','run','popen','system','os.system','shell','cmd','powershell'],
  files:   ['open(','readFile','writeFile','unlink','rmdir','mkdir','fs.','shutil','pathlib'],
  code:    ['eval','exec(','Function(','__import__','compile','importlib','require(','dynamic'],
  crypto:  ['hashlib','crypto','cipher','encrypt','decrypt','sign','verify'],
  process: ['process.env','environ','getenv','setenv','os.environ'],
};

const IMPACT_LABELS = {
  network: '🌐 شبكة',
  system:  '⚙️ نظام',
  files:   '📁 ملفات',
  code:    '💻 تنفيذ كود',
  crypto:  '🔐 تشفير',
  process: '🔧 متغيرات بيئة',
};

function analyzeRepairImpact(original, fixed) {
  const result = {
    added: {},      // APIs مُفعَّلة بعد الإصلاح
    removed: {},    // APIs كانت موجودة وأُزيلت
    riskLevel: 'low',
    warnings: []
  };

  Object.entries(IMPACT_APIS).forEach(([category, apis]) => {
    apis.forEach(api => {
      const wasPresent = original.includes(api);
      const nowPresent = fixed.includes(api);

      if (!wasPresent && nowPresent) {
        if (!result.added[category]) result.added[category] = [];
        result.added[category].push(api);
      }
      if (wasPresent && !nowPresent) {
        if (!result.removed[category]) result.removed[category] = [];
        result.removed[category].push(api);
      }
    });
  });

  // احسب مستوى الخطر
  const addedCategories = Object.keys(result.added);
  if (addedCategories.includes('system') || addedCategories.includes('code')) {
    result.riskLevel = 'high';
    result.warnings.push('الإصلاح يفعّل صلاحيات حساسة جداً');
  } else if (addedCategories.includes('network') || addedCategories.includes('files')) {
    result.riskLevel = 'medium';
    result.warnings.push('الإصلاح يفعّل وصول للشبكة أو الملفات');
  } else if (addedCategories.length > 0) {
    result.riskLevel = 'low';
  }

  return result;
}

function renderImpactBadge(impact) {
  if (Object.keys(impact.added).length === 0) {
    return '<div style="color:#3fb950;font-size:13px">✅ لا تغيير في الصلاحيات</div>';
  }

  const riskColor = impact.riskLevel === 'high' ? '#f85149' : impact.riskLevel === 'medium' ? '#d29922' : '#58a6ff';
  const riskIcon = impact.riskLevel === 'high' ? '🔴' : impact.riskLevel === 'medium' ? '🟡' : '🔵';

  let html = `<div style="background:#1a0a0a;border:1px solid ${riskColor}55;border-radius:8px;padding:10px;margin:8px 0">`;
  html += `<div style="color:${riskColor};font-weight:700;margin-bottom:6px">${riskIcon} الإصلاح يفعّل صلاحيات جديدة</div>`;

  Object.entries(impact.added).forEach(([cat, apis]) => {
    html += `<div style="color:#e6edf3;font-size:12px;margin-bottom:4px">
      ${IMPACT_LABELS[cat] || cat}: <span style="color:${riskColor};font-family:monospace">${apis.join(', ')}</span>
    </div>`;
  });

  if (impact.warnings.length > 0) {
    html += `<div style="color:#d29922;font-size:12px;margin-top:6px">⚠️ ${impact.warnings.join(' | ')}</div>`;
  }

  html += '</div>';
  return html;
}
