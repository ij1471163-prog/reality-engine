export type StubRisk = 'confirmed' | 'suspicious';

export interface StubFunction {
  name:    string;
  line:    number;
  risk:    StubRisk;
  reason:  string;
  snippet: string;
  suggestion: string;
}

export interface StubResult {
  stubs:      StubFunction[];
  totalFuncs: number;
}

// ===== Pattern-based stub detection =====

// Matches: def func_name(args): <newline> <indent> pass/...
const CONFIRMED_PATTERNS: RegExp[] = [
  /^\s*def\s+(\w+)\s*\([^)]*\)\s*(?:->[^:]+)?:\s*\n\s+pass\s*$/m,
  /^\s*def\s+(\w+)\s*\([^)]*\)\s*(?:->[^:]+)?:\s*\n\s+\.\.\.\s*$/m,
  /^\s*def\s+(\w+)\s*\([^)]*\)\s*(?:->[^:]+)?:\s*\n\s+raise\s+NotImplementedError/m,
];

// Matches: def func(): \n [optional docstring] \n return 0/[]/{}
const SUSPICIOUS_PATTERN =
  /^\s*def\s+(\w+)\s*\([^)]*\)\s*(?:->[^:]+)?:\s*\n(?:\s+"""[^"]*"""\s*\n)?\s+return\s+(?:0|0\.0|\[\]|\{\}|None|False|"")\s*$/m;

// ===== Code suggester based on function name =====
function suggestImplementation(name: string): string {
  const n = name.toLowerCase();

  if (/^(is_|has_|can_|should_|validate_|check_|verify_)/.test(n))
    return `return bool(value)  # أضف منطق التحقق هنا`;

  if (/(calculate|compute|sum|total|avg|mean|count)/.test(n))
    return `return sum(items)  # أو الحساب المطلوب`;

  if (/(save|write|export)/.test(n))
    return `with open(filepath, 'w') as f:\n        f.write(data)`;

  if (/(load|read|import|fetch)/.test(n))
    return `with open(filepath, 'r') as f:\n        return f.read()`;

  if (/(send|email|notify|alert)/.test(n))
    return `# أضف كود الإرسال هنا (SMTP / API)`;

  if (/(hash|encrypt|sign|encode)/.test(n))
    return `import hashlib\n    return hashlib.sha256(data.encode()).hexdigest()`;

  if (/(parse|decode|deserialize)/.test(n))
    return `import json\n    return json.loads(data)`;

  if (/(format|serialize|encode)/.test(n))
    return `import json\n    return json.dumps(data, ensure_ascii=False)`;

  if (/(log|record|track)/.test(n))
    return `print(f"[LOG] {message}")  # استبدله بـ logging module`;

  if (/(find|search|lookup|filter)/.test(n))
    return `return [x for x in items if condition(x)]  # أضف شرط البحث`;

  if (/(sort|order)/.test(n))
    return `return sorted(items, key=lambda x: x)  # حدد مفتاح الترتيب`;

  if (/(delete|remove|clean)/.test(n))
    return `items = [x for x in items if x != target]\n    return items`;

  if (/(create|make|build|generate)/.test(n))
    return `return {"created": True, "data": {}}  # أضف منطق الإنشاء`;

  if (/(get|fetch|retrieve)/.test(n))
    return `return None  # أضف منطق الجلب`;

  if (/(update|modify|edit|set)/.test(n))
    return `# أضف منطق التحديث هنا\n    return True`;

  return `# TODO: implement ${name}\n    raise NotImplementedError("${name} not implemented yet")`;
}

// ===== Extract function blocks from code =====
function extractFunctions(code: string): Array<{name: string; line: number; block: string}> {
  const lines   = code.split('\n');
  const results = [];

  for (let i = 0; i < lines.length; i++) {
    const match = lines[i].match(/^(\s*)def\s+(\w+)\s*\(/);
    if (!match) continue;

    const indent    = match[1];
    const funcName  = match[2];
    const blockLines: string[] = [lines[i]];

    for (let j = i + 1; j < lines.length; j++) {
      const l = lines[j];
      if (l.trim() === '') { blockLines.push(l); continue; }
      // Stop when we hit something at same or lower indent (next def or class)
      if (l.length > 0 && !l.startsWith(indent + ' ') && l !== indent) break;
      blockLines.push(l);
    }

    results.push({ name: funcName, line: i + 1, block: blockLines.join('\n') });
  }

  return results;
}

// ===== Check if a function block is a stub =====
function classifyBlock(name: string, line: number, block: string): StubFunction | null {
  const bodyLines = block.split('\n').slice(1).filter(l => l.trim() !== '');

  if (bodyLines.length === 0) {
    return {
      name, line, risk: 'confirmed',
      reason: 'دالة فاضية بالكامل',
      snippet: block.split('\n')[0].trim(),
      suggestion: suggestImplementation(name),
    };
  }

  const bodyText = bodyLines.map(l => l.trim()).join('\n');

  // Confirmed stubs
  if (/^pass$/.test(bodyText))
    return { name, line, risk: 'confirmed', reason: 'pass فقط',
             snippet: block.split('\n')[0].trim(), suggestion: suggestImplementation(name) };

  if (/^\.\.\.$/.test(bodyText))
    return { name, line, risk: 'confirmed', reason: 'Ellipsis (...) فقط',
             snippet: block.split('\n')[0].trim(), suggestion: suggestImplementation(name) };

  if (/^raise\s+NotImplementedError/.test(bodyText))
    return { name, line, risk: 'confirmed', reason: 'NotImplementedError',
             snippet: block.split('\n')[0].trim(), suggestion: suggestImplementation(name) };

  // Docstring only
  const noDoc = bodyText.replace(/^"""[\s\S]*?"""|^'''[\s\S]*?'''|^#[^\n]*/gm, '').trim();
  if (noDoc === '' || noDoc === 'pass' || noDoc === '...')
    return { name, line, risk: 'confirmed', reason: 'docstring فقط بدون تنفيذ',
             snippet: block.split('\n')[0].trim(), suggestion: suggestImplementation(name) };

  // Suspicious stubs
  if (/^(?:return\s+(?:0|0\.0|\[\]|\{\}|None|False|""|'')|pass)$/m.test(noDoc))
    return { name, line, risk: 'suspicious', reason: 'return قيمة فاضية (0/[]/{})',
             snippet: block.split('\n')[0].trim(), suggestion: suggestImplementation(name) };

  return null;
}

// ===== Main detection function =====
export function detectStubs(code: string): StubResult {
  const functions = extractFunctions(code);
  const stubs: StubFunction[] = [];

  for (const fn of functions) {
    const stub = classifyBlock(fn.name, fn.line, fn.block);
    if (stub) stubs.push(stub);
  }

  // Sort: confirmed first
  stubs.sort((a, b) => (a.risk === b.risk ? 0 : a.risk === 'confirmed' ? -1 : 1));

  return { stubs, totalFuncs: functions.length };
}
