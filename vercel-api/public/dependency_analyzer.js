// ═══════════════════════════════════════════════════════
// dependency_analyzer.js — يكتشف مكتبات خطرة أو قديمة
// ═══════════════════════════════════════════════════════

const KNOWN_VULNERABLE = {
  // npm packages
  'lodash':          { minSafe: '4.17.21', cve: 'CVE-2021-23337', risk: 'HIGH',   desc: 'Prototype Pollution' },
  'axios':           { minSafe: '0.27.2',  cve: 'CVE-2022-1214',  risk: 'HIGH',   desc: 'SSRF vulnerability' },
  'express':         { minSafe: '4.18.2',  cve: 'CVE-2022-24999', risk: 'MEDIUM', desc: 'ReDoS vulnerability' },
  'jsonwebtoken':    { minSafe: '9.0.0',   cve: 'CVE-2022-23529', risk: 'CRITICAL', desc: 'Verification bypass' },
  'node-fetch':      { minSafe: '3.2.10',  cve: 'CVE-2022-0235',  risk: 'HIGH',   desc: 'Exposure of Sensitive Info' },
  'minimist':        { minSafe: '1.2.6',   cve: 'CVE-2021-44906', risk: 'CRITICAL', desc: 'Prototype Pollution' },
  'moment':          { minSafe: '2.29.4',  cve: 'CVE-2022-24785', risk: 'HIGH',   desc: 'Path Traversal' },
  'serialize-javascript': { minSafe: '6.0.1', cve: 'CVE-2022-25878', risk: 'HIGH', desc: 'XSS vulnerability' },
  'qs':              { minSafe: '6.11.0',  cve: 'CVE-2022-24999', risk: 'HIGH',   desc: 'Prototype Pollution' },
  'semver':          { minSafe: '7.5.2',   cve: 'CVE-2022-25883', risk: 'HIGH',   desc: 'ReDoS vulnerability' },
  'vm2':             { minSafe: null,       cve: 'CVE-2023-29017', risk: 'CRITICAL', desc: 'Sandbox escape — deprecated' },
  'eval':            { minSafe: null,       cve: 'N/A',            risk: 'CRITICAL', desc: 'Code injection risk' },

  // Python packages
  'django':          { minSafe: '4.2.0',   cve: 'CVE-2023-23969', risk: 'HIGH',   desc: 'DoS vulnerability' },
  'flask':           { minSafe: '2.3.0',   cve: 'CVE-2023-25577', risk: 'HIGH',   desc: 'DoS via Werkzeug' },
  'requests':        { minSafe: '2.28.2',  cve: 'CVE-2023-32681', risk: 'MEDIUM', desc: 'Proxy auth leak' },
  'pillow':          { minSafe: '9.5.0',   cve: 'CVE-2023-44271', risk: 'HIGH',   desc: 'DoS vulnerability' },
  'cryptography':    { minSafe: '41.0.0',  cve: 'CVE-2023-38325', risk: 'HIGH',   desc: 'OpenSSL vulnerability' },
  'pyyaml':          { minSafe: '6.0',     cve: 'CVE-2022-41717', risk: 'HIGH',   desc: 'Arbitrary code execution' },
  'paramiko':        { minSafe: '3.4.0',   cve: 'CVE-2023-48795', risk: 'HIGH',   desc: 'Terrapin attack' },

  // Java packages
  'log4j':           { minSafe: '2.17.1',  cve: 'CVE-2021-44228', risk: 'CRITICAL', desc: 'Log4Shell — RCE' },
  'spring-core':     { minSafe: '5.3.20',  cve: 'CVE-2022-22965', risk: 'CRITICAL', desc: 'Spring4Shell — RCE' },
  'jackson-databind':{ minSafe: '2.14.0',  cve: 'CVE-2022-42003', risk: 'HIGH',   desc: 'Deserialization attack' },
  'commons-text':    { minSafe: '1.10.0',  cve: 'CVE-2022-42889', risk: 'CRITICAL', desc: 'Text4Shell — RCE' },
  'netty':           { minSafe: '4.1.86',  cve: 'CVE-2022-41881', risk: 'HIGH',   desc: 'Stack overflow' },
};

// ─── Deprecated/Dangerous Patterns ───────────────────
const DEPRECATED_PATTERNS = [
  { pattern: /require\(['"]request['"]\)/,      pkg: 'request',     reason: 'Deprecated — استخدم axios أو node-fetch' },
  { pattern: /require\(['"]crypto-js['"]\)/,    pkg: 'crypto-js',   reason: 'استخدم Node.js crypto built-in' },
  { pattern: /require\(['"]md5['"]\)/,          pkg: 'md5',         reason: 'MD5 ضعيف — استخدم SHA-256' },
  { pattern: /require\(['"]sha1['"]\)/,         pkg: 'sha1',        reason: 'SHA1 ضعيف — استخدم SHA-256' },
  { pattern: /import\s+.*from\s+['"]moment['"]/,pkg: 'moment',      reason: 'Deprecated — استخدم date-fns أو dayjs' },
  { pattern: /from\s+['"]lodash['"]/,           pkg: 'lodash',      reason: 'استخدم native JS أو lodash-es للـ tree-shaking' },
];

// ─── Main Function ────────────────────────────────────

function analyzeDependencies(code, fileName, packageJson) {
  const issues = [];
  const lines  = code.split('\n');
  const detectedDeps = new Set();

  // ─── استخرج المكتبات من الكود ─────────────────────
  lines.forEach((line, i) => {
    const t = line.trim();
    if (t.startsWith('//') || t.startsWith('#')) return;
    const ln = i + 1;

    // require / import
    const reqMatch = t.match(/require\(['"]([^'"@][^'"]*)['"]\)/);
    const impMatch = t.match(/from\s+['"]([^'"@][^'"]*)['"]/);
    const pyMatch  = t.match(/^import\s+(\w+)|^from\s+(\w+)\s+import/);

    const pkg = (reqMatch && reqMatch[1].split('/')[0]) ||
                (impMatch && impMatch[1].split('/')[0]) ||
                (pyMatch && (pyMatch[1] || pyMatch[2]));

    if (!pkg) {
      // فحص deprecated patterns
      DEPRECATED_PATTERNS.forEach(dp => {
        if (dp.pattern.test(t)) {
          issues.push({
            type: 'dependency', sev: 'm', line: ln, ev: t,
            title: `⚠️ مكتبة deprecated: ${dp.pkg}`,
            fix: `// ${dp.reason}`,
            conf: 80, cIcon: '🟡', cAct: 'مكتبة قديمة',
            cEv: [dp.reason],
          });
        }
      });
      return;
    }

    detectedDeps.add(pkg);

    // تحقق من المكتبات الخطرة
    const vulnInfo = KNOWN_VULNERABLE[pkg.toLowerCase()];
    if (vulnInfo) {
      const severity = vulnInfo.risk === 'CRITICAL' ? 'c'
        : vulnInfo.risk === 'HIGH' ? 'h' : 'm';
      const icon = severity === 'c' ? '🔴' : severity === 'h' ? '🟠' : '🟡';

      issues.push({
        type: 'dependency', sev: severity, line: ln, ev: t,
        title: `${icon} ثغرة في مكتبة: ${pkg} (${vulnInfo.cve})`,
        fix: vulnInfo.minSafe
          ? `// حدّث إلى ${pkg}@${vulnInfo.minSafe} أو أحدث`
          : `// احذف ${pkg} — بديل آمن غير متاح`,
        conf: 90, cIcon: icon,
        cAct: `${vulnInfo.risk}: ${vulnInfo.desc}`,
        cEv: [
          `CVE: ${vulnInfo.cve}`,
          `المشكلة: ${vulnInfo.desc}`,
          vulnInfo.minSafe ? `الإصلاح: حدّث إلى ${vulnInfo.minSafe}+` : 'لا يوجد إصلاح — احذف المكتبة',
        ],
      });
    }
  });

  // ─── فحص package.json إذا موجود ──────────────────
  const pkgIssues = [];
  if (packageJson && typeof packageJson === 'object') {
    const allDeps = {
      ...(packageJson.dependencies || {}),
      ...(packageJson.devDependencies || {}),
    };

    Object.entries(allDeps).forEach(([pkg, version]) => {
      const vulnInfo = KNOWN_VULNERABLE[pkg.toLowerCase()];
      if (!vulnInfo) return;

      const severity = vulnInfo.risk === 'CRITICAL' ? 'c'
        : vulnInfo.risk === 'HIGH' ? 'h' : 'm';
      const icon = severity === 'c' ? '🔴' : severity === 'h' ? '🟠' : '🟡';

      pkgIssues.push({
        package:  pkg,
        version:  version,
        cve:      vulnInfo.cve,
        risk:     vulnInfo.risk,
        desc:     vulnInfo.desc,
        minSafe:  vulnInfo.minSafe,
        icon,
      });
    });
  }

  return {
    issues,
    pkgIssues,
    detectedDeps: [...detectedDeps],
    summary: {
      total:    issues.length,
      critical: issues.filter(i => i.sev === 'c').length,
      high:     issues.filter(i => i.sev === 'h').length,
      medium:   issues.filter(i => i.sev === 'm').length,
    },
  };
}
