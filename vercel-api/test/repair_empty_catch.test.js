// ═══════════════════════════════════════════════════════
// [CATCH-SHAPE] الحالةُ الأصليةُ ١: كاشفٌ لا يرى شكلَ الشفرةِ الشائع
// ═══════════════════════════════════════════════════════
//
// ‎catchSwallow.js‎ — ‎} catch (e) {\n  }‎ — كانت تُعَدّ «فجوةَ اكتشاف»، أي
// ميزةً غائبة. والقياسُ يقول غيرَ ذلك: المسارُ كاملٌ وسليمٌ من أوّله إلى
// آخره، ويُقبل من البوابة، على أشكالِ Allman الثلاثة:
//
//     try {
//       …
//     }
//     catch (e) {}          ⇒ يُكتشَف ويُوجَّه ويُصلَح وتقبله البوابة  3/3
//
// والمانعُ شرطُ مطابقةٍ واحدٌ في ‎pattern_detector.js‎: مساواةٌ نصّيةٌ تامّة
//     t === 'catch(e){}' || t === 'catch (e) {}' || t === 'catch{}'
// وهي لا تتحقّق في النمطِ الشائع (K&R) لأن السطرَ يبدأ بـ‎}‎:
//     } catch (e) {}      } catch (e) { }      } catch (e) {\n  }
//
// فالعطبُ في شرطِ الاستدعاءِ لا في غيابِ قدرة. ومقيسٌ أن ‎fixEmptyCatch‎
// يُنتج إصلاحًا صحيحًا لشكلَي K&R ذوي السطرِ الواحد أصلًا، وأُضيف له
// شكلُ السطرين (وهو شكلُ الحالةِ الأصلية) بـ‎splice‎ كما يفعل فرعُ بايثون.
//
// وبايثون كانت عطبًا آخر في الحلقةِ نفسِها: البلاغُ يُكتشَف
// (‎except فارغ يخفي الأخطاء‎) ولا يُوجَّه، لأن ‎detectStrategy‎ يستنتج من
// العنوان وقائمتُه تحمل ‎catch‎ ولا تحمل ‎except‎ — وهي كلمةُ بايثون.
'use strict';

const test   = require('node:test');
const assert = require('node:assert');
const fs     = require('node:fs');
const os     = require('node:os');
const path   = require('node:path');
const vm     = require('node:vm');
const { execFileSync } = require('node:child_process');

const PUBLIC_DIR = path.join(__dirname, '..', 'public');

function loadCtx() {
  const noop = () => {};
  const store = new Map();
  const ctx = {
    console: { log: noop, warn: noop, error: noop, info: noop },
    setTimeout, clearTimeout, TextEncoder, TextDecoder, URL,
    document: { getElementById: () => ({ style: {} }), addEventListener: noop,
                createElement: () => ({ style: {} }), querySelector: () => null, querySelectorAll: () => [] },
    localStorage: { getItem: k => (store.has(k) ? store.get(k) : null),
                    setItem: (k, v) => store.set(k, String(v)), removeItem: k => store.delete(k) },
    navigator: {}, location: { search: '' },
  };
  ctx.window = ctx;
  vm.createContext(ctx);
  const html = fs.readFileSync(path.join(PUBLIC_DIR, 'index.html'), 'utf8');
  for (const m of html.matchAll(/<script src="\/([^"]+)"/g)) {
    const f = path.join(PUBLIC_DIR, m[1]);
    if (!fs.existsSync(f)) continue;
    try { vm.runInContext(fs.readFileSync(f, 'utf8'), ctx, { filename: m[1] }); } catch (e) { /* ملف واجهة */ }
  }
  return ctx;
}
const run = (ctx, code, file) => {
  const iss = ctx.analyzeCode(code, file) || [];
  return { iss, out: ctx.repairCode(code, iss.map(x => Object.assign({}, x)), file) };
};
const hasPython = (() => {
  try { execFileSync('python3', ['-c', 'pass'], { stdio: 'ignore' }); return true; }
  catch (e) { return false; }
})();

// الحالةُ الأصليةُ بنصِّها، ثم بقيةُ أشكالِ الجسمِ الفارغ
const JS_SHAPES = [
  ['الأصلية: قوسان في سطرين', 'function s(fn) {\n  try {\n    return fn();\n  } catch (e) {\n  }\n}\nmodule.exports = { s };\n'],
  ['K&R: } catch (e) {}',      'function s(fn) {\n  try {\n    return fn();\n  } catch (e) {}\n}\nmodule.exports = { s };\n'],
  ['K&R: } catch (e) { }',     'function s(fn) {\n  try {\n    return fn();\n  } catch (e) { }\n}\nmodule.exports = { s };\n'],
  ['Allman: catch (e) {}',     'function s(fn) {\n  try {\n    return fn();\n  }\n  catch (e) {}\n}\nmodule.exports = { s };\n'],
  ['Allman: catch(e){}',       'function s(fn) {\n  try {\n    return fn();\n  }\n  catch(e){}\n}\nmodule.exports = { s };\n'],
  ['بلا ربط: catch{}',         'function s(fn) {\n  try {\n    return fn();\n  }\n  catch{}\n}\nmodule.exports = { s };\n'],
];

for (const [label, code] of JS_SHAPES) {
  test('[EC-1] يُكتشَف ويُوجَّه ويُصلَح — ' + label, () => {
    const ctx = loadCtx();
    const { iss, out } = run(ctx, code, 'catchSwallow.js');

    const mine = iss.filter(i => /catch/i.test(String(i.title || '')));
    assert.ok(mine.length > 0, 'لا بلاغَ على جسمِ catch فارغ — شرطُ المطابقةِ هو المانع');
    assert.ok(mine.every(i => i.strategy === 'EMPTY_CATCH'),
      'البلاغُ بلا ‎strategy‎ صريح: ' + JSON.stringify(mine.map(i => i.strategy)));
    assert.ok(mine.some(i => ctx.detectStrategy(i, 'js') === 'EMPTY_CATCH'),
      'البلاغُ لا يُوجَّه إلى EMPTY_CATCH');

    assert.ok((out.repairs || []).some(r => r.strategy === 'EMPTY_CATCH'),
      'لم يُطبَّق إصلاح — رُفض: ' +
      (out.rejected || []).map(r => r.reason).join(' | ').slice(0, 150) +
      '  مُسقَط: ' + (out.dropped || []).map(d => d.kind).join(','));

    // جسمُ الـcatch لم يبقَ فارغًا، والبلاغُ زال
    assert.ok(/console\.error/.test(out.repaired), 'لا تسجيلَ في الناتج');
    const after = (ctx.analyzeCode(out.repaired, 'catchSwallow.js') || [])
      .filter(i => /catch/i.test(String(i.title || '')));
    assert.strictEqual(after.length, 0, 'بلاغُ الـcatch الفارغ باقٍ بعد الإصلاح');
  });
}

test('[EC-2] والسلوكُ محفوظ: نفسُ قيمِ الإرجاع، والخطأُ المكتومُ صار ظاهرًا', () => {
  // النجاحُ بالقيمةِ لا باختفاءِ البلاغ: تُشغَّل الوحدتان فعلًا.
  const ctx = loadCtx();
  const code = 'function s(fn) {\n  try {\n    return fn();\n  } catch (e) {\n  }\n}\nmodule.exports = { s };\n';
  const { out } = run(ctx, code, 'catchSwallow.js');
  assert.notStrictEqual(out.repaired, code, 'tripwire: لم يُطبَّق إصلاح');

  const exec = src => {
    const logged = [];
    const sb = { module: { exports: {} },
                 console: { error: (...a) => logged.push(a.map(String).join(' ')), log: () => {}, warn: () => {} } };
    sb.exports = sb.module.exports;
    vm.createContext(sb);
    vm.runInContext(src, sb, { filename: 'm.js' });
    const api = sb.module.exports;
    const ok = api.s(() => 42);
    logged.length = 0;
    const fail = api.s(() => { throw new Error('boom-7'); });
    return { ok, fail, logged: logged.slice() };
  };
  const A = exec(code), B = exec(out.repaired);
  assert.strictEqual(B.ok, A.ok, 'قيمةُ مسارِ النجاح تغيّرت');
  assert.strictEqual(B.fail, A.fail, 'قيمةُ مسارِ الفشل تغيّرت — تدفّقُ التحكّم تأثّر');
  assert.strictEqual(A.logged.length, 0, 'tripwire: الأصلُ كان يُسجّل');
  assert.ok(B.logged.some(l => /boom-7/.test(l)),
    'الخطأُ ما زال مكتومًا بعد «الإصلاح»: ' + JSON.stringify(B.logged));
});

test('[EC-3] وما ليس فارغًا لا يُمَسّ', () => {
  const ctx = loadCtx();
  const KEEP = [
    ['جسمٌ فيه شفرة',      'function s(fn) {\n  try {\n    return fn();\n  } catch (e) {\n    report(e);\n  }\n}\n'],
    ['تعليقٌ = تجاهلٌ مقصود', 'function s(fn) {\n  try {\n    return fn();\n  } catch (e) {\n    // مقصود: لا يهمّ\n  }\n}\n'],
    ['تعليقٌ في السطرِ نفسِه', 'function s(fn) {\n  try {\n    return fn();\n  } catch (e) { /* مقصود */ }\n}\n'],
    ['finally بعده',        'function s(fn) {\n  try {\n    return fn();\n  } catch (e) {\n    report(e);\n  } finally {\n    done();\n  }\n}\n'],
    ['كائنٌ فارغٌ لا catch', 'function s() {\n  const empty = {};\n  return empty;\n}\n'],
  ];
  for (const [label, code] of KEEP) {
    const { out } = run(ctx, code, 'keep.js');
    assert.ok(!(out.repairs || []).some(r => r.strategy === 'EMPTY_CATCH'),
      'أُصلح ما ليس فارغًا (' + label + '): ' + out.repaired);
  }
});

test('[EC-4] بايثون: البلاغُ كان يُكتشَف ولا يُوجَّه — والتوجيهُ الآن صريح', () => {
  const ctx = loadCtx();
  for (const code of ['def s(fn):\n    try:\n        return fn()\n    except Exception:\n        pass\n',
                      'def s(fn):\n    try:\n        return fn()\n    except:\n        pass\n']) {
    const { iss, out } = run(ctx, code, 'a.py');
    // ‎except:‎ يحمل بلاغًا ثانيًا مستقلًّا: ‎"Bare except"‎ — صنفٌ آخر
    // (يلتقط ‎SystemExit‎/‎KeyboardInterrupt‎) لا إصلاحَ حتميًّا له، لأن
    // تحويلَه إلى ‎except Exception:‎ يغيّر ما يُلتقَط. فلا يُوجَّه، وهذا صحيح.
    const mine = iss.filter(i => /except فارغ/.test(String(i.title || '')));
    assert.strictEqual(mine.length, 1, 'tripwire: كاشفُ «except فارغ» لا يعمل');
    assert.strictEqual(mine[0].strategy, 'EMPTY_CATCH',
      'البلاغُ بلا ‎strategy‎ صريح — والعنوانُ لا يحمل كلمةَ catch فلا يُوجَّه');
    assert.strictEqual(ctx.detectStrategy(mine[0], 'py'), 'EMPTY_CATCH');
    assert.ok((out.repairs || []).some(r => r.strategy === 'EMPTY_CATCH'),
      'لم يُطبَّق إصلاحُ بايثون');
    assert.ok(/logging\.error/.test(out.repaired), 'لا تسجيلَ في ناتجِ بايثون');
  }
});

test('[PC-1] وإصلاحُ بايثون لا يُنتج ‎NameError‎ — تشغيلٌ فعليّ',
  { skip: hasPython ? false : 'python3 غيرُ متاح' }, () => {
  // العيبُ المُقاس: كان المُصلِحُ يكتب ‎str(e)‎ دائمًا، و‎e‎ غيرُ مربوطٍ في
  // ‎except Exception:‎ ⇒ ‎py_compile‎ يمرّ (فحصٌ نحويٌّ لا يرى الأسماء)
  // ويرمي ‎NameError‎ وقتَ تنفيذِ مسارِ الاستثناء:
  //     قبل: RET=None     بعد: NameError: name 'e' is not defined
  // أي إصلاحٌ يُخفي البلاغَ ويُفسد الشفرة. وكان مستورًا لأن البلاغَ لم
  // يكن يُوجَّه أصلًا — فالتوجيهُ وحدَه كان سيُطلق إصلاحًا مكسورًا.
  const ctx = loadCtx();
  const HARNESS = '\n\nif __name__ == "__main__":\n' +
    '    def boom():\n        raise ValueError("boom-7")\n' +
    '    try:\n        print("RET=" + repr(s(boom)))\n' +
    '    except BaseException as exc:\n        print("RAISED=" + type(exc).__name__)\n' +
    '    print("OK=" + repr(s(lambda: 42)))\n';
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pycatch-'));
  const runPy = (src, name) => {
    const f = path.join(dir, name);
    fs.writeFileSync(f, src + HARNESS);
    try { return String(execFileSync('python3', ['-I', f], { stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8' })).trim(); }
    catch (e) { return 'EXIT: ' + String(e.stdout || '') + String(e.stderr || '').trim().split('\n').pop(); }
  };
  try {
    for (const [i, code] of [
      'def s(fn):\n    try:\n        return fn()\n    except Exception:\n        pass\n',
      'def s(fn):\n    try:\n        return fn()\n    except:\n        pass\n',
    ].entries()) {
      const { out } = run(ctx, code, 'a.py');
      assert.ok((out.repairs || []).length > 0, 'tripwire: لم يُطبَّق إصلاح');
      const before = runPy(code, 'b' + i + '.py');
      const after = runPy(out.repaired, 'a' + i + '.py');
      assert.ok(!/NameError/.test(after), 'الإصلاحُ أدخل NameError: ' + after);
      assert.strictEqual(after, before,
        'سلوكُ التشغيل تغيّر — قبل: ' + before + '  بعد: ' + after);
      assert.ok(/logging\.error/.test(out.repaired), 'لا تسجيلَ مُضاف');
    }
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('[PC-2] والموضعُ من رقمِ السطرِ لا ببحثٍ نصّيّ — موضعان متطابقان', () => {
  // ‎indexOf(catchLine)‎ كان يُصيب أوّلَ سطرٍ مطابقٍ، فملفٌّ فيه
  // ‎except Exception:‎ مرتين يُعالَج موضعُه الأوّلُ مرتين ويبقى الثاني.
  const ctx = loadCtx();
  const code = 'def s(fn):\n    try:\n        return fn()\n    except Exception:\n        pass\n\n' +
               'def t(fn):\n    try:\n        return fn()\n    except Exception:\n        pass\n';
  const { out } = run(ctx, code, 'two.py');
  const added = out.repaired.split('\n').filter(l => /logging\.error/.test(l));
  assert.strictEqual(added.length, 2, 'لم يُعالَج الموضعان: ' + out.repaired);
  const idx = out.repaired.split('\n').map((l, i) => /logging\.error/.test(l) ? i : -1).filter(i => i >= 0);
  assert.notStrictEqual(idx[0], idx[1]);
  assert.ok(idx[1] - idx[0] > 3, 'السطران المُضافان متجاوران — عُولج موضعٌ واحدٌ مرتين');
});

test('[PC-3] و‎import logging‎ يُحترَم رأسُ الملفّ ولا يُكرَّر', () => {
  const ctx = loadCtx();
  const BODY = '\ndef s(fn):\n    try:\n        return fn()\n    except Exception:\n        pass\n';
  const CASES = [
    ['shebang + coding', '#!/usr/bin/env python3\n# -*- coding: utf-8 -*-' + BODY, 2],
    ['docstring + __future__', '"""وحدة."""\nfrom __future__ import annotations' + BODY, 2],
    ['موجودٌ أصلًا', 'import logging' + BODY, 0],
    ['تعليقٌ يذكره', '# import logging يومًا ما' + BODY, 0],
  ];
  for (const [label, code, minBefore] of CASES) {
    const { out } = run(ctx, code, 'h.py');
    const L = out.repaired.split('\n');
    const imports = L.filter(l => /^import logging\s*$/.test(l));
    assert.strictEqual(imports.length, 1, 'عددُ أسطرِ الاستيراد (' + label + '): ' + imports.length);
    const at = L.findIndex(l => /^import logging\s*$/.test(l));
    assert.ok(at >= minBefore, 'الاستيرادُ قبل رأسِ الملفّ (' + label + ') في السطر ' + (at + 1));
    // ‎from __future__‎ يجب أن يبقى قبله
    const fut = L.findIndex(l => /^from __future__/.test(l));
    if (fut >= 0) assert.ok(fut < at, 'الاستيرادُ قبل __future__ ⇒ SyntaxError');
  }
});

test('[EC-5] ولا تراجُع: الإصلاحاتُ القائمةُ على الملفِّ نفسِه تبقى', () => {
  // ملفٌّ يحمل catch فارغًا ومشكلاتٍ أخرى: الإصلاحُ الجديدُ لا يُزاحم غيرَه.
  const ctx = loadCtx();
  const code = 'function s(fn, password) {\n' +
               '  var n = 1;\n' +
               '  console.log(password);\n' +
               '  try {\n    return fn(n);\n  } catch (e) {\n  }\n}\n' +
               'module.exports = { s };\n';
  const { out } = run(ctx, code, 'mix.js');
  const got = new Set((out.repairs || []).map(r => r.strategy));
  for (const want of ['EMPTY_CATCH', 'VAR_USAGE', 'LOG_SECRET'])
    assert.ok(got.has(want), want + ' غائبٌ عن الإصلاحات: ' + [...got].join(','));
  assert.ok(/\[REDACTED\]/.test(out.repaired) && /console\.error/.test(out.repaired) &&
            /\blet n\b/.test(out.repaired), 'أحدُ الإصلاحاتِ لم يظهر في الناتج');
});
