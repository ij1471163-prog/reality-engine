/**
 * IntentAnalyzer — يحلل نية الدالة من السياق الكامل
 * لا يعتمد على الاسم فقط — يحلل: imports, classes, calls, vars, comments
 */

export type IntentCategory =
  | 'validation'  | 'calculation' | 'file_io'     | 'network'
  | 'database'    | 'auth'        | 'crypto'       | 'logging'
  | 'transform'   | 'search'      | 'display'      | 'event'
  | 'testing'     | 'config'      | 'parsing'      | 'unknown';

export interface IntentSignal {
  source:   'name' | 'imports' | 'class' | 'calls' | 'variables' | 'comments' | 'return_type' | 'args';
  signal:   string;
  weight:   number;   // 1-5, كلما أكبر كلما أهم
}

export interface IntentResult {
  intent:          IntentCategory;
  confidence:      number;         // 0-100
  signals:         IntentSignal[];
  description:     string;         // وصف بالعربي للنية المكتشفة
  suggestedImpl:   string | null;  // null إذا confidence منخفض
  requiresClarify: boolean;        // true إذا confidence < 40
  clarifyQuestion: string | null;  // سؤال للمستخدم إذا غير واضح
  contextSummary:  string;         // ملخص السياق المحلل
}

// ===== Context extraction =====
interface ProjectContext {
  imports:    string[];
  classes:    string[];
  functions:  string[];
  variables:  string[];
  comments:   string[];
  decorators: string[];
}

function extractContext(fullCode: string): ProjectContext {
  return {
    imports:    (fullCode.match(/^(?:import|from)\s+.+/gm) ?? []).map(l => l.trim()),
    classes:    (fullCode.match(/^class\s+(\w+)/gm) ?? []).map(l => l.replace('class ', '')),
    functions:  (fullCode.match(/^(?:\s*)def\s+(\w+)/gm) ?? []).map(l => l.trim()),
    variables:  (fullCode.match(/^\s*(\w+)\s*=/gm) ?? []).map(l => l.trim()),
    comments:   (fullCode.match(/^\s*#.+/gm) ?? []).map(l => l.trim()),
    decorators: (fullCode.match(/^\s*@\w+/gm) ?? []).map(l => l.trim()),
  };
}

// ===== Signal scoring by intent =====
interface IntentRules {
  namePatterns:    RegExp[];
  importKeywords:  string[];
  callKeywords:    string[];
  varKeywords:     string[];
  commentKeywords: string[];
  argKeywords:     string[];
  weight:          number;
}

const INTENT_RULES: Record<IntentCategory, IntentRules> = {
  validation: {
    namePatterns:    [/^(?:is_|has_|can_|should_|check_|verify_|validate_|assert_)/],
    importKeywords:  ['re', 'validators', 'cerberus', 'pydantic', 'marshmallow'],
    callKeywords:    ['match', 'fullmatch', 'search', 'isinstance', 'assert'],
    varKeywords:     ['pattern', 'regex', 'valid', 'invalid', 'error', 'rule'],
    commentKeywords: ['valid', 'check', 'verify', 'must', 'should', 'required'],
    argKeywords:     ['value', 'input', 'data', 'field', 'email', 'phone', 'url'],
    weight:          4,
  },
  calculation: {
    namePatterns:    [/(?:calc|compute|sum|total|avg|mean|max|min|count|rate|ratio)/],
    importKeywords:  ['math', 'numpy', 'scipy', 'statistics', 'decimal'],
    callKeywords:    ['sum', 'len', 'max', 'min', 'round', 'abs'],
    varKeywords:     ['total', 'result', 'count', 'score', 'rate', 'amount'],
    commentKeywords: ['calculate', 'compute', 'formula', 'algorithm'],
    argKeywords:     ['numbers', 'items', 'values', 'data', 'n'],
    weight:          3,
  },
  file_io: {
    namePatterns:    [/(?:read|write|load|save|export|import|open|close|create|delete).*(?:file|csv|json|xml|txt|doc)/],
    importKeywords:  ['os', 'pathlib', 'shutil', 'csv', 'json', 'io', 'glob'],
    callKeywords:    ['open', 'read', 'write', 'close', 'exists', 'makedirs'],
    varKeywords:     ['path', 'filepath', 'filename', 'directory', 'folder', 'ext'],
    commentKeywords: ['file', 'path', 'directory', 'disk', 'storage'],
    argKeywords:     ['path', 'filepath', 'filename', 'directory'],
    weight:          4,
  },
  network: {
    namePatterns:    [/(?:fetch|download|upload|request|get_url|post|send_request|api)/],
    importKeywords:  ['requests', 'urllib', 'httpx', 'aiohttp', 'socket', 'http'],
    callKeywords:    ['get', 'post', 'put', 'delete', 'request', 'urlopen'],
    varKeywords:     ['url', 'endpoint', 'host', 'port', 'response', 'status'],
    commentKeywords: ['api', 'http', 'request', 'response', 'endpoint', 'server'],
    argKeywords:     ['url', 'endpoint', 'headers', 'params', 'data', 'timeout'],
    weight:          4,
  },
  database: {
    namePatterns:    [/(?:db_|database_|sql_|query|insert|update|delete|select|fetch_from)/],
    importKeywords:  ['sqlite3', 'psycopg2', 'mysql', 'pymongo', 'sqlalchemy', 'peewee'],
    callKeywords:    ['execute', 'commit', 'cursor', 'connect', 'fetchall', 'fetchone'],
    varKeywords:     ['conn', 'cursor', 'db', 'query', 'result', 'row', 'table'],
    commentKeywords: ['database', 'sql', 'query', 'table', 'record', 'insert'],
    argKeywords:     ['db', 'conn', 'query', 'table', 'id', 'data'],
    weight:          5,
  },
  auth: {
    namePatterns:    [/(?:login|logout|authenticate|authorize|register|signup|token|session|jwt)/],
    importKeywords:  ['jwt', 'bcrypt', 'hashlib', 'secrets', 'passlib', 'authlib'],
    callKeywords:    ['hash', 'verify', 'encode', 'decode', 'sign', 'check_password'],
    varKeywords:     ['token', 'session', 'user', 'password', 'hash', 'salt', 'claim'],
    commentKeywords: ['auth', 'login', 'user', 'password', 'token', 'session', 'secure'],
    argKeywords:     ['username', 'password', 'token', 'user_id', 'session'],
    weight:          5,
  },
  crypto: {
    namePatterns:    [/(?:encrypt|decrypt|hash|sign|verify_signature|hmac|aes|rsa)/],
    importKeywords:  ['cryptography', 'Crypto', 'nacl', 'hashlib', 'hmac', 'ssl'],
    callKeywords:    ['encrypt', 'decrypt', 'digest', 'hexdigest', 'b64encode'],
    varKeywords:     ['key', 'iv', 'cipher', 'hash', 'digest', 'nonce', 'salt'],
    commentKeywords: ['encrypt', 'decrypt', 'key', 'cipher', 'secure', 'crypto'],
    argKeywords:     ['key', 'data', 'plaintext', 'ciphertext', 'password'],
    weight:          5,
  },
  logging: {
    namePatterns:    [/(?:log|logger|debug|info|warn|error|trace|audit|record)/],
    importKeywords:  ['logging', 'loguru', 'structlog'],
    callKeywords:    ['debug', 'info', 'warning', 'error', 'critical', 'exception'],
    varKeywords:     ['logger', 'log', 'level', 'handler', 'formatter', 'message'],
    commentKeywords: ['log', 'record', 'audit', 'trace', 'monitor'],
    argKeywords:     ['message', 'level', 'logger', 'context'],
    weight:          3,
  },
  transform: {
    namePatterns:    [/(?:parse|format|convert|transform|clean|normalize|sanitize|serialize)/],
    importKeywords:  ['json', 'yaml', 'xml', 'csv', 're', 'unicodedata'],
    callKeywords:    ['strip', 'replace', 'split', 'join', 'format', 'encode'],
    varKeywords:     ['result', 'output', 'transformed', 'cleaned', 'formatted'],
    commentKeywords: ['convert', 'transform', 'parse', 'format', 'clean', 'normalize'],
    argKeywords:     ['text', 'data', 'value', 'input', 'string'],
    weight:          3,
  },
  search: {
    namePatterns:    [/(?:find|search|lookup|filter|match|query|get_by|locate)/],
    importKeywords:  ['re', 'difflib', 'fuzzywuzzy'],
    callKeywords:    ['find', 'filter', 'search', 'match', 'findall'],
    varKeywords:     ['results', 'matches', 'found', 'query', 'pattern', 'criteria'],
    commentKeywords: ['find', 'search', 'filter', 'lookup', 'query'],
    argKeywords:     ['query', 'pattern', 'keyword', 'filter', 'criteria'],
    weight:          3,
  },
  display: {
    namePatterns:    [/(?:show|display|render|print|draw|paint|visualize|format_output)/],
    importKeywords:  ['tkinter', 'pygame', 'matplotlib', 'rich', 'curses'],
    callKeywords:    ['print', 'show', 'render', 'display', 'draw'],
    varKeywords:     ['output', 'screen', 'widget', 'canvas', 'text'],
    commentKeywords: ['display', 'show', 'render', 'output', 'print', 'UI'],
    argKeywords:     ['data', 'text', 'message', 'title', 'content'],
    weight:          2,
  },
  event: {
    namePatterns:    [/(?:on_|handle_|dispatch|emit|trigger|callback|listener|subscribe)/],
    importKeywords:  ['asyncio', 'threading', 'multiprocessing', 'signal', 'queue'],
    callKeywords:    ['emit', 'dispatch', 'trigger', 'subscribe', 'publish'],
    varKeywords:     ['event', 'handler', 'callback', 'listener', 'queue', 'signal'],
    commentKeywords: ['event', 'handler', 'callback', 'trigger', 'async'],
    argKeywords:     ['event', 'data', 'handler', 'callback'],
    weight:          3,
  },
  testing: {
    namePatterns:    [/(?:test_|assert_|mock_|stub_|fixture|setup|teardown)/],
    importKeywords:  ['unittest', 'pytest', 'mock', 'nose', 'hypothesis'],
    callKeywords:    ['assertEqual', 'assertTrue', 'assertRaises', 'mock', 'patch'],
    varKeywords:     ['expected', 'actual', 'mock', 'result', 'fixture'],
    commentKeywords: ['test', 'assert', 'should', 'expected', 'mock'],
    argKeywords:     ['self', 'mock', 'fixture', 'expected'],
    weight:          4,
  },
  config: {
    namePatterns:    [/(?:load_config|get_config|setup|initialize|init_|configure|settings)/],
    importKeywords:  ['configparser', 'dotenv', 'environ', 'yaml', 'toml'],
    callKeywords:    ['environ', 'getenv', 'read', 'load', 'parse'],
    varKeywords:     ['config', 'settings', 'env', 'options', 'defaults'],
    commentKeywords: ['config', 'setting', 'environment', 'initialize', 'setup'],
    argKeywords:     ['config', 'path', 'env', 'defaults'],
    weight:          3,
  },
  parsing: {
    namePatterns:    [/(?:parse_|extract_|scrape_|tokenize|lex|read_)/],
    importKeywords:  ['bs4', 'lxml', 'html.parser', 'ast', 'ply', 'antlr'],
    callKeywords:    ['parse', 'find', 'findall', 'select', 'tokenize'],
    varKeywords:     ['tree', 'token', 'node', 'parsed', 'extracted'],
    commentKeywords: ['parse', 'extract', 'scrape', 'tokenize', 'AST'],
    argKeywords:     ['text', 'html', 'source', 'content', 'raw'],
    weight:          4,
  },
  unknown: {
    namePatterns:    [],
    importKeywords:  [],
    callKeywords:    [],
    varKeywords:     [],
    commentKeywords: [],
    argKeywords:     [],
    weight:          0,
  },
};

// ===== Score a specific intent given the context =====
function scoreIntent(
  intent: IntentCategory,
  funcName: string,
  args: string[],
  context: ProjectContext,
  doc: string,
): { score: number; signals: IntentSignal[] } {
  if (intent === 'unknown') return { score: 0, signals: [] };

  const rules   = INTENT_RULES[intent];
  const signals: IntentSignal[] = [];
  let score = 0;

  // 1. Function name
  for (const pattern of rules.namePatterns) {
    if (pattern.test(funcName.toLowerCase())) {
      const s = { source: 'name' as const, signal: `اسم الدالة يطابق نمط ${intent}`, weight: 5 };
      signals.push(s); score += s.weight;
    }
  }

  // 2. Imports
  for (const imp of context.imports) {
    for (const kw of rules.importKeywords) {
      if (imp.toLowerCase().includes(kw.toLowerCase())) {
        const s = { source: 'imports' as const, signal: `import "${imp}" مرتبط بـ ${intent}`, weight: 4 };
        signals.push(s); score += s.weight; break;
      }
    }
  }

  // 3. Function calls in comments/doc
  const docLower = doc.toLowerCase();
  for (const kw of rules.commentKeywords) {
    if (docLower.includes(kw.toLowerCase())) {
      const s = { source: 'comments' as const, signal: `"${kw}" في التوثيق`, weight: 3 };
      signals.push(s); score += s.weight;
    }
  }

  // 4. Variable names (context)
  for (const varDef of context.variables) {
    for (const kw of rules.varKeywords) {
      if (varDef.toLowerCase().includes(kw.toLowerCase())) {
        const s = { source: 'variables' as const, signal: `متغير "${varDef.split('=')[0].trim()}" مرتبط بـ ${intent}`, weight: 2 };
        signals.push(s); score += s.weight; break;
      }
    }
  }

  // 5. Arg names
  for (const arg of args) {
    for (const kw of rules.argKeywords) {
      if (arg.toLowerCase().includes(kw.toLowerCase())) {
        const s = { source: 'args' as const, signal: `معامل "${arg}" يشير إلى ${intent}`, weight: 3 };
        signals.push(s); score += s.weight; break;
      }
    }
  }

  // 6. Class context
  for (const cls of context.classes) {
    for (const kw of [...rules.importKeywords, ...rules.varKeywords]) {
      if (cls.toLowerCase().includes(kw.toLowerCase())) {
        const s = { source: 'class' as const, signal: `الكلاس "${cls}" مرتبط بـ ${intent}`, weight: 3 };
        signals.push(s); score += s.weight; break;
      }
    }
  }

  // Normalize (max theoretical: name(5) + 3 imports(12) + 3 comments(9) + 3 vars(6) + 3 args(9) + class(3) = ~44)
  const normalizedScore = Math.min(100, Math.round((score / 44) * 100));
  return { score: normalizedScore, signals };
}

// ===== Generate implementation based on confirmed intent =====
function generateForIntent(intent: IntentCategory, funcName: string, args: string[]): string {
  const a0 = args[0] || 'value';
  const a1 = args[1] || 'default';

  const IMPL: Partial<Record<IntentCategory, string>> = {
    validation:  `try:\n    if ${a0} is None:\n        return False\n    # أضف منطق التحقق هنا\n    return bool(${a0})\nexcept Exception:\n    return False`,
    calculation: `try:\n    if not isinstance(${a0}, (list, tuple, set)):\n        return 0\n    nums = [x for x in ${a0} if isinstance(x, (int, float))]\n    return sum(nums) / len(nums) if nums else 0\nexcept Exception:\n    return 0`,
    file_io:     `try:\n    with open(${a0}, 'r', encoding='utf-8') as f:\n        return f.read()\nexcept FileNotFoundError:\n    return None\nexcept Exception as e:\n    raise RuntimeError(f"File error: {e}") from e`,
    network:     `import urllib.request, json\ntry:\n    with urllib.request.urlopen(${a0}, timeout=10) as resp:\n        return json.loads(resp.read())\nexcept Exception as e:\n    return {"error": str(e)}`,
    database:    `import sqlite3\ntry:\n    with sqlite3.connect(${a0}) as conn:\n        cursor = conn.cursor()\n        # أضف query هنا\n        return cursor.fetchall()\nexcept sqlite3.Error as e:\n    raise RuntimeError(f"DB error: {e}") from e`,
    auth:        `import hashlib, secrets\ntry:\n    if not ${a0} or len(${a0}) < 8:\n        return False\n    # في production استخدم bcrypt\n    return hashlib.sha256(${a0}.encode()).hexdigest()\nexcept Exception:\n    return False`,
    crypto:      `import hashlib\ntry:\n    data = ${a0}.encode() if isinstance(${a0}, str) else ${a0}\n    return hashlib.sha256(data).hexdigest()\nexcept Exception:\n    return None`,
    logging:     `import logging, os\ntry:\n    logger = logging.getLogger(__name__)\n    logger.info(str(${a0}))\n    return True\nexcept Exception:\n    return False`,
    transform:   `try:\n    result = str(${a0}).strip()\n    # أضف تحويلات إضافية هنا\n    return result\nexcept Exception:\n    return str(${a0})`,
    search:      `try:\n    return [x for x in ${a0} if ${a1} in str(x).lower()]\nexcept Exception:\n    return []`,
    parsing:     `import json\ntry:\n    return json.loads(${a0}) if isinstance(${a0}, str) else ${a0}\nexcept json.JSONDecodeError as e:\n    raise ValueError(f"Parse error: {e}") from e`,
    config:      `import os\ntry:\n    return {\n        key: os.environ.get(key, default)\n        for key, default in (${a0} or {}).items()\n    }\nexcept Exception as e:\n    return {}`,
    display:     `try:\n    if isinstance(${a0}, dict):\n        for k, v in ${a0}.items():\n            print(f"  {k}: {v}")\n    else:\n        print(${a0})\n    return True\nexcept Exception:\n    return False`,
    testing:     `# اقتراح: أضف test cases هنا\ntry:\n    result = ${a0}\n    assert result is not None, "Result should not be None"\n    return True\nexcept AssertionError as e:\n    raise\nexcept Exception as e:\n    return False`,
    event:       `try:\n    # أضف logic معالجة الحدث هنا\n    data = ${a0}\n    return {"handled": True, "data": data}\nexcept Exception as e:\n    return {"handled": False, "error": str(e)}`,
    calculation: `try:\n    if not hasattr(${a0}, '__iter__'):\n        return 0\n    nums = [x for x in ${a0} if isinstance(x, (int, float))]\n    return sum(nums) / len(nums) if nums else 0\nexcept Exception:\n    return 0`,
  };

  return IMPL[intent] ?? `# لم يتم تحديد تنفيذ محدد لهذه النية\nraise NotImplementedError("${funcName}: يحتاج تنفيذ")`;
}

// ===== Intent descriptions in Arabic =====
const INTENT_DESCRIPTIONS: Record<IntentCategory, string> = {
  validation:  'التحقق من صحة البيانات أو الشروط',
  calculation: 'حسابات رياضية أو إحصائية',
  file_io:     'عمليات قراءة/كتابة الملفات',
  network:     'طلبات شبكية أو HTTP',
  database:    'عمليات قاعدة البيانات',
  auth:        'المصادقة أو إدارة الجلسات',
  crypto:      'تشفير أو hashing',
  logging:     'تسجيل الأحداث والأخطاء',
  transform:   'تحويل أو تنسيق البيانات',
  search:      'البحث أو التصفية',
  display:     'عرض البيانات للمستخدم',
  event:       'معالجة الأحداث',
  testing:     'اختبارات الوحدة',
  config:      'تحميل الإعدادات',
  parsing:     'تحليل البيانات أو النصوص',
  unknown:     'نية غير محددة',
};

// ===== Main analysis function =====
export function analyzeIntent(
  funcName:  string,
  args:      string[],
  doc:       string,
  fullCode:  string,
): IntentResult {
  const context = extractContext(fullCode);
  const scores: Array<{ intent: IntentCategory; score: number; signals: IntentSignal[] }> = [];

  const intents = Object.keys(INTENT_RULES).filter(k => k !== 'unknown') as IntentCategory[];
  for (const intent of intents) {
    const { score, signals } = scoreIntent(intent, funcName, args, context, doc);
    if (score > 0) scores.push({ intent, score, signals });
  }

  scores.sort((a, b) => b.score - a.score);

  const best       = scores[0];
  const runnerUp   = scores[1];
  const confidence = best
    ? best.score - (runnerUp?.score ?? 0) > 10
      ? Math.min(95, best.score)
      : Math.min(75, best.score)
    : 0;

  const requiresClarify = confidence < 40;

  const clarifyQuestion = requiresClarify
    ? `لا أستطيع تحديد نية الدالة "${funcName}" بثقة كافية.\n\nما الذي تفعله هذه الدالة تحديداً؟\n(مثال: "تحقق من صحة البريد الإلكتروني" أو "احسب متوسط المبيعات")`
    : null;

  const chosenIntent = best?.intent ?? 'unknown';
  const allSignals   = best?.signals ?? [];

  const contextSummary = [
    `${context.imports.length} import`,
    `${context.classes.length} كلاس`,
    `${context.functions.length} دالة`,
    `${context.variables.length} متغير`,
    `${context.comments.length} تعليق`,
  ].join(' • ');

  return {
    intent:         chosenIntent,
    confidence,
    signals:        allSignals,
    description:    INTENT_DESCRIPTIONS[chosenIntent],
    suggestedImpl:  requiresClarify ? null : generateForIntent(chosenIntent, funcName, args),
    requiresClarify,
    clarifyQuestion,
    contextSummary,
  };
}
