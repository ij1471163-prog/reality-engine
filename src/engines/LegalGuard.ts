/**
 * LegalGuard — يمنع أي طلب غير قانوني قبل أي معالجة
 * الطبقة الصفرية: تعمل قبل PolicyEngine وقبل كل شيء
 *
 * تشمل:
 * - أسلحة / مواد متفجرة
 * - مخدرات / مواد خطرة
 * - احتيال / تصيد احتيالي
 * - اختراق غير مصرح
 * - محتوى غير لائق
 * - تجاوز نظم ترخيص البرمجيات
 * - أي كود يستهدف ضرر أفراد
 */

export type LegalVerdict = 'legal' | 'illegal' | 'restricted';

export interface LegalViolation {
  category:    string;
  description: string;
  evidence:    string;
  severity:    'critical' | 'high';
}

export interface LegalResult {
  verdict:    LegalVerdict;
  violations: LegalViolation[];
  blocked:    boolean;
  reason:     string;
  userMessage: string;   // رسالة واضحة للمستخدم
}

// ===== Legal Rule =====
interface LegalRule {
  category:    string;
  description: string;
  severity:    'critical' | 'high';
  patterns:    RegExp[];
  keywords:    string[];
}

const LEGAL_RULES: LegalRule[] = [

  // ── الأسلحة والمتفجرات ─────────────────────────────────────────
  {
    category: 'Weapons',
    description: 'كود مرتبط بصنع أسلحة أو متفجرات',
    severity: 'critical',
    patterns: [
      /(?:bomb|explosive|detonat|C4|TNT|ammonium.?nitrate|TATP|RDX)/i,
      /(?:rifle|pistol|firearm|gun).*(?:print|3d|manufacture|make)/i,
      /(?:silencer|suppressor).*(?:make|build|print|create)/i,
    ],
    keywords: ['صنع قنبلة', 'متفجرات', 'detonator circuit', 'pipe bomb'],
  },

  // ── المخدرات والمواد الخطرة ────────────────────────────────────
  {
    category: 'Narcotics',
    description: 'كود لتصنيع أو توزيع مواد مخدرة',
    severity: 'critical',
    patterns: [
      /(?:synthesize|manufacture|produce).*(?:methamphetamine|fentanyl|heroin|cocaine|MDMA)/i,
      /(?:drug|narcotic).*(?:recipe|formula|synthesis|cook)/i,
      /(?:darkweb|dark.web).*(?:drug|narco|buy|sell)/i,
    ],
    keywords: ['مخدرات', 'drug synthesis', 'cook meth', 'drug recipe'],
  },

  // ── الاحتيال والتصيد ───────────────────────────────────────────
  {
    category: 'Fraud',
    description: 'كود للاحتيال أو سرقة الهوية أو التصيد الاحتيالي',
    severity: 'critical',
    patterns: [
      /(?:phishing|fake.?login|credential.?harvest|spoof)/i,
      /(?:credit.?card|bank.?account).*(?:steal|harvest|clone|skim)/i,
      /(?:identity.?theft|social.?security).*(?:steal|fake|forge)/i,
      /(?:carding|fullz|cvv.?dump|cc.?dump)/i,
    ],
    keywords: ['phishing page', 'fake bank site', 'steal credit card', 'carding'],
  },

  // ── الاختراق غير المصرح ────────────────────────────────────────
  {
    category: 'Unauthorized Access',
    description: 'أدوات اختراق أنظمة بدون إذن صريح',
    severity: 'critical',
    patterns: [
      /(?:hack|crack|bypass).*(?:someone|their|victim|target).*(?:account|system|device)/i,
      /(?:steal|grab|dump).*(?:password|hash|credential).*(?:from|their|victim)/i,
      /(?:remote.?access|RAT|backdoor).*(?:install|deploy|hide|silent)/i,
      /(?:keylogger|spyware|stalkerware).*(?:install|deploy|run|hide)/i,
    ],
    keywords: [
      'hack someone', 'hack my wife', 'spy on phone',
      'اختراق هاتف', 'تجسس', 'hack girlfriend',
    ],
  },

  // ── البرمجيات الخبيثة المتعمدة ────────────────────────────────
  {
    category: 'Malware Creation',
    description: 'كود لإنشاء برمجيات خبيثة متعمدة',
    severity: 'critical',
    patterns: [
      /(?:write|create|build|make).*(?:virus|worm|trojan|ransomware|malware)/i,
      /(?:botnet|C2.server|command.and.control).*(?:create|build|setup)/i,
      /(?:DDoS|DoS).*(?:attack|script|tool|bot)/i,
    ],
    keywords: [
      'write ransomware', 'create virus', 'DDoS script',
      'botnet', 'اكتب فيروس', 'برنامج خبيث',
    ],
  },

  // ── انتهاك الخصوصية ────────────────────────────────────────────
  {
    category: 'Privacy Violation',
    description: 'كود للتجسس على أشخاص بدون موافقتهم',
    severity: 'critical',
    patterns: [
      /(?:track|monitor|spy).*(?:location|gps).*(?:without|secret|hidden)/i,
      /(?:read|access).*(?:message|sms|whatsapp|telegram).*(?:without|secret)/i,
      /(?:camera|microphone).*(?:activate|enable|access).*(?:without|remote|silent)/i,
    ],
    keywords: [
      'spy location', 'track without consent', 'read messages secretly',
      'تتبع الموقع', 'قراءة رسائل', 'مراقبة بدون علم',
    ],
  },

  // ── انتهاك الملكية الفكرية ─────────────────────────────────────
  {
    category: 'IP Violation',
    description: 'كود لتجاوز تراخيص البرمجيات أو حماية النسخ',
    severity: 'high',
    patterns: [
      /(?:crack|bypass|remove|patch).*(?:license|activation|DRM|serial)/i,
      /(?:keygen|serial.?generator|crack.?patch).*(?:software|app|game)/i,
    ],
    keywords: ['crack software', 'bypass license', 'keygen', 'serial generator'],
  },

  // ── الغش في الأنظمة ────────────────────────────────────────────
  {
    category: 'System Cheating',
    description: 'كود للغش في ألعاب أو منصات أو اختبارات',
    severity: 'high',
    patterns: [
      /(?:cheat|aimbot|wallhack|esp).*(?:game|player|enemy)/i,
      /(?:autoclick|bot).*(?:bypass|detect|anti.?cheat)/i,
      /(?:exam|test|quiz).*(?:answer|cheat|bypass|automate)/i,
    ],
    keywords: ['game cheat', 'aimbot', 'exam bot', 'bypass anti-cheat'],
  },
];

// ===== Check function =====
function checkPattern(code: string, rule: LegalRule): LegalViolation | null {
  // Check regex patterns
  for (const pattern of rule.patterns) {
    const m = code.match(pattern);
    if (m) {
      return {
        category:    rule.category,
        description: rule.description,
        evidence:    m[0].substring(0, 100),
        severity:    rule.severity,
      };
    }
  }

  // Check keyword list
  const codeLower = code.toLowerCase();
  for (const kw of rule.keywords) {
    if (codeLower.includes(kw.toLowerCase())) {
      return {
        category:    rule.category,
        description: rule.description,
        evidence:    `Keyword: "${kw}"`,
        severity:    rule.severity,
      };
    }
  }

  return null;
}

// ===== User-facing messages =====
const USER_MESSAGES: Record<string, string> = {
  Weapons:             'لا يمكن المساعدة في كود مرتبط بالأسلحة أو المتفجرات.',
  Narcotics:           'لا يمكن المساعدة في كود مرتبط بتصنيع أو توزيع المخدرات.',
  Fraud:               'لا يمكن المساعدة في كود للاحتيال أو سرقة الهوية.',
  'Unauthorized Access':'لا يمكن المساعدة في اختراق أجهزة أو حسابات أشخاص آخرين.',
  'Malware Creation':  'لا يمكن المساعدة في إنشاء برمجيات خبيثة أو فيروسات.',
  'Privacy Violation': 'لا يمكن المساعدة في التجسس على أشخاص بدون موافقتهم.',
  'IP Violation':      'لا يمكن المساعدة في تجاوز تراخيص البرمجيات أو حماية النسخ.',
  'System Cheating':   'لا يمكن المساعدة في كود للغش في الألعاب أو الاختبارات.',
};

// ===== Main legal check =====
export function checkLegal(code: string): LegalResult {
  const violations: LegalViolation[] = [];

  for (const rule of LEGAL_RULES) {
    const v = checkPattern(code, rule);
    if (v) violations.push(v);
  }

  const hasCritical = violations.some(v => v.severity === 'critical');
  const hasHigh     = violations.some(v => v.severity === 'high');

  let verdict: LegalVerdict = 'legal';
  if (hasCritical)      verdict = 'illegal';
  else if (hasHigh)     verdict = 'restricted';

  const primaryViolation = violations[0];
  const reason = primaryViolation
    ? `${primaryViolation.category}: ${primaryViolation.description}`
    : 'لا انتهاكات قانونية';

  const userMessage = primaryViolation
    ? (USER_MESSAGES[primaryViolation.category] ?? 'هذا الطلب لا يمكن معالجته.')
    : 'الكود مقبول قانونياً.';

  return {
    verdict,
    violations,
    blocked:     verdict === 'illegal',
    reason,
    userMessage,
  };
}

// ===== Scan user intent (from text query, not just code) =====
export function checkUserIntent(userText: string): LegalResult {
  return checkLegal(userText);
}
