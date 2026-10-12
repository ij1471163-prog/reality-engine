#!/usr/bin/env node
/**
 * self_diagnose.js — مدخل تشغيل التشخيص الذاتي
 * ══════════════════════════════════════════════════════════════════════
 * التشغيل:
 *   node vercel-api/tools/self_diagnose.js              # الدورة كاملة
 *   node vercel-api/tools/self_diagnose.js --battery    # البطارية وحدها
 *   node vercel-api/tools/self_diagnose.js --json       # ناتج JSON للأتمتة
 *   node vercel-api/tools/self_diagnose.js --export-log # سجل SelfHealing
 *
 * لماذا مدخل مستقل ولا ربطٌ في api/analyze.js: الدورة تبني سياقات vm متعددة،
 * فتشغيلها مع كل طلب تحليل يضيف تأخيرًا بلا سبب ويغيّر مسار طلب المستخدم. وهي
 * تشخيصٌ مقصود يُستدعى عند الحاجة أو في CI، لا عملٌ ضمني في كل نداء.
 *
 * ولا يكتب هذا المدخل أي ملف ولا يطبّق أي إصلاح. أقصى ما يفعله: عرض ما يُقترح،
 * وتسجيله PENDING_REVIEW في سجل SelfHealing. التطبيق يحتاج نداءً صريحًا من
 * إنسان: SelfHealing.approve(id, patchedCode, applyCallback).
 *
 * رمز الخروج: 0 إذا لم تُكتشف حادثة، 1 إذا اكتُشفت — كي يصلح للاستعمال في CI.
 * ══════════════════════════════════════════════════════════════════════
 */
'use strict';

const path = require('path');
const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const ESD = require(path.join(PUBLIC_DIR, 'engine_self_diagnosis.js'));
const SH  = require(path.join(PUBLIC_DIR, 'self_healing_engine.js'));

const argv       = process.argv.slice(2);
const asJSON     = argv.includes('--json');
const batteryOnly = argv.includes('--battery');
const exportLog  = argv.includes('--export-log');

const opts = { publicDir: PUBLIC_DIR };

function out(s) { process.stdout.write(s + '\n'); }

// ─── السجل فقط ────────────────────────────────────────────────────────
if (exportLog) {
  out(SH.SelfHealing.exportLog());
  process.exit(0);
}

// ─── البطارية فقط ─────────────────────────────────────────────────────
if (batteryOnly) {
  const b = ESD.runBattery(opts);
  if (asJSON) { out(JSON.stringify(b, null, 2)); process.exit(b.available && !b.failed.length ? 0 : 1); }

  if (!b.available) { out('غير متاح: ' + b.reason); process.exit(1); }
  out('بطارية مِجسّات المحرك — v' + b.version);
  out('─'.repeat(72));
  for (const id of Object.keys(b.results)) {
    const r = b.results[id];
    out((r.ok ? '  ✓ ' : '  ✗ ') + id.padEnd(42) + '[' + r.module + ']');
    if (!r.ok) {
      out('      متوقَّع: ' + r.expected);
      out('      فعلي  : ' + r.actual);
    }
  }
  out('─'.repeat(72));
  out('  ' + b.passed + '/' + b.total + ' ناجح' +
      (b.loadErrors.length ? '  |  ' + b.loadErrors.length + ' خطأ تحميل' : '') +
      (b.missingModules.length ? '  |  ' + b.missingModules.length + ' وحدة غائبة' : ''));
  process.exit(b.failed.length ? 1 : 0);
}

// ─── الدورة كاملة ─────────────────────────────────────────────────────
const res = ESD.runCycle(opts);

if (asJSON) {
  out(JSON.stringify(res, null, 2));
  process.exit(res.available && !res.incidents ? 0 : 1);
}

if (!res.available) { out('غير متاح: ' + res.reason); process.exit(1); }

out('تشخيص ذاتي — Reality Engine  (v' + res.version + ')');
out('═'.repeat(72));
out('البطارية : ' + res.battery.passed + '/' + res.battery.total + ' ناجح، ' +
    res.battery.failed + ' فاشل');
if (res.manifest) {
  out('بيان الصفحة: ' + res.manifest.declared + ' سكربتًا معلنًا، ' +
      res.manifest.missing + ' غائب');
}
out('الحوادث  : ' + res.incidents);

if (!res.incidents) {
  out('');
  out('لا خلل داخلي مكتشَف. ولا يعني ذلك سلامةً مطلقة: يعني أن كل مِجسّ في');
  out('البطارية الحالية يُعطي جوابه المتوقَّع. ما لا مِجسّ له لم يُفحص.');
  process.exit(0);
}

for (const c of res.cycles) {
  out('');
  out('─'.repeat(72));
  out('حادثة   : ' + c.probeId + '   [' + c.module + ']');
  out('النوع   : ' + c.kind);
  out('الدليل  : متوقَّع ' + (c.evidence && c.evidence.expected));
  out('          فعلي   ' + (c.evidence && c.evidence.actual));
  out('السبب   : ' + c.cause + (c.causeReason ? ' — ' + c.causeReason : ''));

  if (c.cause === 'NOT_PROBEABLE' || c.cause === 'PRE_EXISTING' ||
      c.cause === 'NO_REFERENCE'  || c.cause === 'CAUSE_NOT_IN_DELTA') {
    out('الحالة  : ' + c.status + '   /   ' + c.result +
        (c.healingId ? '   [' + c.healingId + ']' : '') + '   — اكتشافٌ فقط، لا إصلاح مقترح');
    continue;
  }

  if (c.hunks && c.hunks.length) {
    out('الثقة   : ' + c.confidence + '   (تراجع عن ' + c.revertSet.length + ' hunk)');
    for (const h of c.hunks) {
      out('  أسطر الشجرة ' + h.curLines.join('..') + '  →  أسطر المرجع ' + h.refLines.join('..'));
      for (const l of h.curSample) out('    -  ' + l);
      for (const l of h.refSample) out('    +  ' + l);
    }
  }

  out('الحالة  : ' + c.status + '   /   ' + c.result +
      (c.healingId ? '   [' + c.healingId + ']' : ''));

  const t = c.testResults;
  if (t) {
    out('الاختبار في بيئة معزولة:');
    out('  صياغة الـcandidate : ' + (t.syntax && t.syntax.pass ? 'سليمة' : 'مكسورة — ' + (t.syntax && t.syntax.error)));
    if (t.engines && t.engines.targetProbe) {
      out('  المِجسّ المستهدف    : ' + (t.engines.targetProbe.pass ? 'صار ناجحًا' : 'ما زال فاشلًا'));
    }
    if (t.regression) {
      out('  بقية القدرات       : ' + (t.regression.pass ? 'بلا تراجع' : 'تراجع — ' + t.regression.regressionMsg));
      if (t.regression.probesPassedAfter != null) {
        out('                       ' + t.regression.probesPassedBefore + ' → ' +
            t.regression.probesPassedAfter + ' من ' + t.regression.probesTotal);
      }
      for (const r of (t.regression.regressed || [])) out('    ✗ سقط: ' + r.id);
    }
    if (t.security) {
      out('  أنماط خطرة جديدة  : ' + (t.security.pass ? 'لا شيء'
          : (t.security.newVulnerabilities || []).join(', ')));
    }
  }
}

out('');
out('═'.repeat(72));
out('لم يُطبَّق أي إصلاح ولم يُكتب أي ملف. المقترَح منها حالته PENDING_REVIEW في');
out('سجل SelfHealing، ويُطبَّق بنداء صريح:');
out('  SelfHealing.approve(id, patchedCode, applyCallback)');
out('ولعرض السجل:  node vercel-api/tools/self_diagnose.js --export-log');

process.exit(1);
