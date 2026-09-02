// ═══════════════════════════════════════════════════════
// project_intelligence.js v1.0
// Project Graph + Framework Detection + API Mapping
// يبني فهم كامل لبنية المشروع
// ═══════════════════════════════════════════════════════

// ─── Framework Signatures ─────────────────────────────
const FRAMEWORK_SIGNATURES = {
  express: {
    patterns: [/require\(['"]express['"]\)/, /app\.(get|post|put|delete|use)\s*\(/],
    name: 'Express.js', lang: 'js', type: 'backend',
  },
  fastapi: {
    patterns: [/from\s+fastapi\s+import/, /@app\.(get|post|put|delete)\s*\(/],
    name: 'FastAPI', lang: 'py', type: 'backend',
  },
  flask: {
    patterns: [/from\s+flask\s+import/, /@app\.route\s*\(/],
    name: 'Flask', lang: 'py', type: 'backend',
  },
  django: {
    patterns: [/from\s+django\b/, /urlpatterns\s*=\s*\[/],
    name: 'Django', lang: 'py', type: 'backend',
  },
  spring: {
    patterns: [/@RestController/, /@RequestMapping/, /@SpringBootApplication/],
    name: 'Spring Boot', lang: 'java', type: 'backend',
  },
  react: {
    patterns: [/from\s+['"]react['"]/, /import\s+React/, /jsx/i],
    name: 'React', lang: 'js', type: 'frontend',
  },
  nextjs: {
    patterns: [/from\s+['"]next\//, /export\s+default\s+function\s+\w+Page/],
    name: 'Next.js', lang: 'js', type: 'fullstack',
  },
  vue: {
    patterns: [/from\s+['"]vue['"]/, /createApp\s*\(/],
    name: 'Vue.js', lang: 'js', type: 'frontend',
  },
  laravel: {
    patterns: [/use\s+Illuminate\\/, /Route::(get|post|put|delete)\s*\(/],
    name: 'Laravel', lang: 'php', type: 'backend',
  },
};

// ─── API Patterns ──────────────────────────────────────
const API_PATTERNS = {
  express: [
    { rx: /app\.(get|post|put|delete|patch)\s*\(\s*['"]([^'"]+)['"]/g,   method: 1, path: 2 },
    { rx: /router\.(get|post|put|delete|patch)\s*\(\s*['"]([^'"]+)['"]/g, method: 1, path: 2 },
  ],
  flask: [
    { rx: /@app\.route\s*\(\s*['"]([^'"]+)['"][^)]*methods\s*=\s*\[([^\]]+)\]/g, path: 1, method: 2 },
    { rx: /@app\.route\s*\(\s*['"]([^'"]+)['"]\)/g, path: 1, method: null },
  ],
  fastapi: [
    { rx: /@app\.(get|post|put|delete|patch)\s*\(\s*['"]([^'"]+)['"]/g, method: 1, path: 2 },
  ],
  django: [
    { rx: /path\s*\(\s*['"]([^'"]+)['"]\s*,\s*(\w+)/g, path: 1, view: 2 },
  ],
  spring: [
    { rx: /@(Get|Post|Put|Delete|Patch)Mapping\s*\(\s*['"]([^'"]+)['"]/g, method: 1, path: 2 },
    { rx: /@RequestMapping\s*\(\s*(?:value\s*=\s*)?['"]([^'"]+)['"]/g, path: 1 },
  ],
};

// ═══════════════════════════════════════════════════════
// 1. File Parser — يستخرج بنية الملف
// ═══════════════════════════════════════════════════════

function parseFile(code, fileName) {
  const ext  = fileName.split('.').pop().toLowerCase();
  const lines = code.split('\n');

  const imports   = extractImports(lines, ext);
  const exports   = extractExports(lines, ext);
  const functions = extractFunctions(lines, ext);
  const variables = extractVariables(lines, ext);
  const calls     = extractCalls(lines, ext);

  return { fileName, ext, imports, exports, functions, variables, calls, lines: lines.length };
}

function extractImports(lines, ext) {
  const imports = [];
  lines.forEach((line, i) => {
    const t = line.trim();
    // JS/TS
    let m = t.match(/(?:import\s+.*?\s+from\s+|require\s*\(\s*)['"]([^'"]+)['"]/);
    if (m) { imports.push({ module: m[1], line: i + 1, type: 'import' }); return; }
    // Python
    m = t.match(/^(?:import\s+(\w+)|from\s+(\w[\w.]*)\s+import)/);
    if (m) { imports.push({ module: m[1] || m[2], line: i + 1, type: 'import' }); return; }
    // Java
    m = t.match(/^import\s+([\w.]+);/);
    if (m) { imports.push({ module: m[1], line: i + 1, type: 'import' }); }
  });
  return imports;
}

function extractExports(lines, ext) {
  const exports = [];
  lines.forEach((line, i) => {
    const t = line.trim();
    const m = t.match(/^export\s+(?:default\s+)?(?:function|class|const|let|var)?\s+(\w+)/);
    if (m) exports.push({ name: m[1], line: i + 1 });
    const m2 = t.match(/module\.exports\s*=\s*\{([^}]+)\}/);
    if (m2) {
      m2[1].split(',').forEach(name => {
        const n = name.trim();
        if (n) exports.push({ name: n, line: i + 1 });
      });
    }
  });
  return exports;
}

function extractFunctions(lines, ext) {
  const functions = [];
  lines.forEach((line, i) => {
    const t = line.trim();
    let m;
    // JS
    m = t.match(/(?:async\s+)?function\s+(\w+)\s*\(([^)]*)\)/);
    if (m) { functions.push({ name: m[1], params: parseParams(m[2]), line: i + 1, async: t.includes('async') }); return; }
    // Arrow function
    m = t.match(/(?:const|let)\s+(\w+)\s*=\s*(?:async\s*)?\(([^)]*)\)\s*=>/);
    if (m) { functions.push({ name: m[1], params: parseParams(m[2]), line: i + 1, async: t.includes('async') }); return; }
    // Arrow in route handler
    m = t.match(/(?:async\s*)?\(([^)]*)\)\s*=>\s*\{/);
    if (m && !t.includes('function')) {
      const routeMatch = t.match(/app\.\w+\s*\([^,]+,\s*(?:async\s*)?\(([^)]*)\)/);
      if (routeMatch) {
        functions.push({ name: 'handler', params: parseParams(routeMatch[1]), line: i + 1, async: t.includes('async') });
      }
    }
    // Python
    m = t.match(/^(?:async\s+)?def\s+(\w+)\s*\(([^)]*)\)/);
    if (m) { functions.push({ name: m[1], params: parseParams(m[2]), line: i + 1, async: t.startsWith('async') }); return; }
    // Java
    m = t.match(/(?:public|private|protected)\s+(?:static\s+)?(?:async\s+)?\w[\w<>[\]]*\s+(\w+)\s*\(([^)]*)\)/);
    if (m && !['if','while','for','switch'].includes(m[1])) {
      functions.push({ name: m[1], params: parseParams(m[2]), line: i + 1, async: false });
    }
  });
  return functions;
}

function extractVariables(lines, ext) {
  const vars = [];
  lines.forEach((line, i) => {
    const t = line.trim();
    // JS
    let m = t.match(/(?:const|let|var)\s+(\w+)\s*=\s*(.+)/);
    if (m) { vars.push({ name: m[1], value: m[2].trim(), line: i + 1, kind: 'declaration' }); return; }
    // Python
    m = t.match(/^(\w+)\s*=\s*(?!=)(.+)/);
    if (m && !['if','for','while','return','class','def'].some(k => t.startsWith(k))) {
      vars.push({ name: m[1], value: m[2].trim(), line: i + 1, kind: 'assignment' });
    }
  });
  return vars;
}

function extractCalls(lines, ext) {
  const calls = [];
  lines.forEach((line, i) => {
    const t = line.trim();
    const matches = [...t.matchAll(/(\w+)\s*\(/g)];
    matches.forEach(m => {
      if (!['if','for','while','switch','function','def','class'].includes(m[1])) {
        calls.push({ callee: m[1], line: i + 1 });
      }
    });
  });
  return calls;
}

function parseParams(paramStr) {
  if (!paramStr.trim()) return [];
  return paramStr.split(',').map(p => p.trim().split(/[=:]/)[0].trim()).filter(Boolean);
}

// ═══════════════════════════════════════════════════════
// 2. Framework Detector
// ═══════════════════════════════════════════════════════

function detectFramework(code, fileName) {
  const results = [];
  Object.entries(FRAMEWORK_SIGNATURES).forEach(([key, fw]) => {
    const matches = fw.patterns.filter(p => p.test(code)).length;
    if (matches > 0) {
      results.push({ key, name: fw.name, lang: fw.lang, type: fw.type, confidence: matches / fw.patterns.length });
    }
  });
  results.sort((a, b) => b.confidence - a.confidence);
  return results[0] || null;
}

// ═══════════════════════════════════════════════════════
// 3. API Endpoint Mapper
// ═══════════════════════════════════════════════════════

function mapAPIEndpoints(code, framework) {
  const endpoints = [];
  if (!framework) return endpoints;

  const patterns = API_PATTERNS[framework.key] || [];

  patterns.forEach(({ rx, method, path, view }) => {
    const regex = new RegExp(rx.source, rx.flags);
    let match;
    while ((match = regex.exec(code)) !== null) {
      const endpoint = {
        method: method ? (match[method] || 'GET').toUpperCase() : 'GET',
        path:   path ? match[path] : match[1],
        line:   code.slice(0, match.index).split('\n').length,
      };
      if (view) endpoint.handler = match[view];
      if (!endpoints.some(e => e.path === endpoint.path && e.method === endpoint.method)) {
        endpoints.push(endpoint);
      }
    }
  });

  return endpoints;
}

// ═══════════════════════════════════════════════════════
// 4. Call Graph Builder
// ═══════════════════════════════════════════════════════

function buildCallGraph(fileInfo) {
  const graph = new Map();
  const { functions, calls } = fileInfo;

  functions.forEach(fn => {
    graph.set(fn.name, { ...fn, calledBy: [], calls: [] });
  });

  // ابنِ العلاقات
  functions.forEach(fn => {
    const nextFn = functions.find(f => f.line > fn.line);
    const fnEnd  = nextFn ? nextFn.line : fileInfo.lines + 1;

    calls.filter(c => c.line >= fn.line && c.line < fnEnd).forEach(call => {
      if (graph.has(call.callee)) {
        graph.get(fn.name).calls.push(call.callee);
        graph.get(call.callee).calledBy.push(fn.name);
      }
    });
  });

  return graph;
}

// ═══════════════════════════════════════════════════════
// 5. Risk Reasoner — يربط الأدلة ببعض
// ═══════════════════════════════════════════════════════

function buildEvidenceChain(taintIssues, callGraph, fileInfo, framework, endpoints) {
  return taintIssues.map(issue => {
    const chain = {
      issue:     issue.title,
      severity:  issue.sev,
      cwe:       issue.taintInfo?.cwe,
      evidence:  [],
      dataFlow:  [],
      context:   {},
    };

    // أضف الأدلة
    if (issue.taintInfo) {
      chain.evidence.push(`Source: ${issue.taintInfo.source} (line ${issue.taintInfo.sourceLine})`);
      chain.evidence.push(`Sink: ${issue.taintInfo.sink} (line ${issue.taintInfo.sinkLine})`);
      chain.evidence.push(`Variable: ${issue.taintInfo.variable}`);

      // Data Flow
      chain.dataFlow = [
        { step: 1, desc: `User input enters via ${issue.taintInfo.source}` },
        { step: 2, desc: `Stored in variable: ${issue.taintInfo.variable}` },
        { step: 3, desc: `Reaches dangerous sink: ${issue.taintInfo.sink}` },
        { step: 4, desc: `Result: ${issue.title}` },
      ];
    }

    // Context من الـ framework
    if (framework) {
      chain.context.framework = framework.name;
    }

    // أضف endpoint إذا موجود
    const relatedEndpoint = endpoints.find(e => Math.abs(e.line - (issue.line || 0)) < 30);
    if (relatedEndpoint) {
      chain.context.endpoint = `${relatedEndpoint.method} ${relatedEndpoint.path}`;
      chain.evidence.push(`Endpoint: ${relatedEndpoint.method} ${relatedEndpoint.path}`);
    }

    return chain;
  });
}

// ═══════════════════════════════════════════════════════
// 6. Context Pack Builder — للـ AI
// ═══════════════════════════════════════════════════════

function buildContextPack(code, fileName, taintIssues) {
  const fileInfo  = parseFile(code, fileName);
  const framework = detectFramework(code, fileName);
  const endpoints = mapAPIEndpoints(code, framework);
  const callGraph = buildCallGraph(fileInfo);
  const evidence  = buildEvidenceChain(taintIssues || [], callGraph, fileInfo, framework, endpoints);

  const contextPack = {
    file:       fileName,
    framework:  framework ? framework.name : 'Unknown',
    language:   fileInfo.ext,
    stats: {
      lines:     fileInfo.lines,
      functions: fileInfo.functions.length,
      imports:   fileInfo.imports.length,
      endpoints: endpoints.length,
    },
    endpoints,
    issues: evidence,
    functions: fileInfo.functions.map(f => ({
      name:   f.name,
      params: f.params,
      line:   f.line,
      calls:  callGraph.get(f.name)?.calls || [],
    })),
    imports: fileInfo.imports,
    aiPromptHint: buildAIPrompt(evidence, framework, endpoints),
  };

  return contextPack;
}

function buildAIPrompt(evidence, framework, endpoints) {
  if (!evidence.length) return null;

  const critical = evidence.filter(e => e.severity === 'c');
  if (!critical.length) return null;

  const issue = critical[0];
  return {
    framework:  framework?.name || 'Unknown',
    endpoint:   issue.context?.endpoint || 'Unknown',
    issue:      issue.issue,
    severity:   'CRITICAL',
    dataFlow:   issue.dataFlow?.map(d => d.desc) || [],
    evidence:   issue.evidence,
    task:       'Fix the vulnerability with minimal code changes. Preserve existing architecture.',
  };
}

// ═══════════════════════════════════════════════════════
// 7. Main Function
// ═══════════════════════════════════════════════════════

function analyzeProject(code, fileName, taintIssues) {
  const fileInfo   = parseFile(code, fileName);
  const framework  = detectFramework(code, fileName);
  const endpoints  = mapAPIEndpoints(code, framework);
  const callGraph  = buildCallGraph(fileInfo);
  const contextPack = buildContextPack(code, fileName, taintIssues || []);

  return {
    fileInfo,
    framework,
    endpoints,
    callGraph:   Object.fromEntries(callGraph),
    contextPack,
    summary: {
      framework:   framework?.name || 'Unknown',
      endpoints:   endpoints.length,
      functions:   fileInfo.functions.length,
      imports:     fileInfo.imports.length,
      hasAPI:      endpoints.length > 0,
    },
  };
}
