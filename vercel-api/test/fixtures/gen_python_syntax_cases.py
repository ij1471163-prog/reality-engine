#!/usr/bin/env python3
# ═══════════════════════════════════════════════════════
# يولّد python_syntax_cases.json: حالات بايثون مع حكم CPython عليها.
# التوقعات في الاختبار مستمدة من هذا الحكم، لا مكتوبة يدويًا.
#
# إعادة التوليد:
#   python3 -I vercel-api/test/fixtures/gen_python_syntax_cases.py \
#     > vercel-api/test/fixtures/python_syntax_cases.json
# ═══════════════════════════════════════════════════════
import ast, json, sys

CASES = {
  # ── أساسيات ──
  "simple function":            'def f():\n    return 1\n',
  "class two methods":          'class A:\n    def a(self):\n        return 1\n    def b(self):\n        return 2\n',
  "decorator":                  '@app.route("/x")\ndef f():\n    return 1\n',
  "async await":                'async def f():\n    r = await g()\n    return r\n',
  "with block":                 'def f():\n    with open("f") as h:\n        return h.read()\n',
  "try except finally":         'def f():\n    try:\n        return g()\n    except ValueError:\n        return 0\n    finally:\n        c()\n',
  "match case":                 'def f(x):\n    match x:\n        case 1:\n            return "a"\n        case _:\n            return "b"\n',
  "tab indentation":            'def f(x):\n\tif x:\n\t\treturn 1\n\treturn 2\n',
  "global statement":           'x = 1\ndef f():\n    global x\n    x = 2\n    return x\n',
  "assert":                     'def f(x):\n    assert x, "msg"\n    return x\n',
  "yield":                      'def f():\n    yield 1\n    yield 2\n',
  "nested def":                 'def o():\n    def i():\n        return 1\n    return i()\n',
  "elif chain":                 'def f(x):\n    if x == 1:\n        return 1\n    elif x == 2:\n        return 2\n    else:\n        return 0\n',
  "for else":                   'def f(xs):\n    for x in xs:\n        return x\n    else:\n        return None\n',
  # ── نصوص متعددة الأسطر ──
  "docstring triple double":    'def f():\n    """\n    d\n    """\n    return 1\n',
  "docstring triple single":    "def f():\n    '''d\n    e'''\n    return 1\n",
  "triple with bracket inside": 'def f():\n    s = """(\n"""\n    return s\n',
  "triple with colon inside":   'def f():\n    s = """x:\n"""\n    return s\n',
  "triple with def inside":     'def f():\n    s = """\ndef g():\n"""\n    return s\n',
  "triple single line":         'def f():\n    s = """x"""\n    return s\n',
  "triple with inner quotes":   'def f():\n    s = """he said "hi"\n    ok"""\n    return s\n',
  "rb triple string":           'def f():\n    s = rb"""\nx\n"""\n    return s\n',
  # ── استمرار بالأقواس والـbackslash ──
  "dict continuation":          'def f():\n    d = {\n        "a": 1,\n    }\n    return d\n',
  "dict arbitrary indent":      'def f():\n    d = {\n"a": 1,\n            "b": 2,\n    }\n    return d\n',
  "call back indent":           'def f():\n    g(\n1,\n  2,\n)\n    return 1\n',
  "nested brackets":            'def f():\n    d = {\n        "a": [\n1,\n        ],\n    }\n    return d\n',
  "blank line in brackets":     'def f():\n    d = [\n\n        1,\n    ]\n    return d\n',
  "comment in brackets":        'def f():\n    d = [\n        # c\n        1,\n    ]\n    return d\n',
  "backslash arbitrary indent": 'def f(a, b):\n    t = a + \\\nb\n    return t\n',
  "backslash deeper indent":    'def f(a, b):\n    t = a + \\\n            b\n    return t\n',
  "backslash then brackets":    'def f(a):\n    t = a + \\\n        g(\n1,\n        )\n    return t\n',
  "dict key ends with colon":   'def f():\n    d = {\n        "a":\n            1,\n    }\n    return d\n',
  "block header spans lines":   'def f():\n    if foo(\n        1\n    ):\n        return 1\n',
  "lambda ends with colon":     'def f(x):\n    g = sorted(x, key=lambda v:\n        v.k)\n    return g\n',
  "conditional expr spans":     'def f(a):\n    v = (1 if a\n         else 2)\n    return v\n',
  "import spans lines":         'from os import (\n    path,\n    sep,\n)\nprint(path, sep)\n',
  # ── f-string وأشكال النصوص المفردة ──
  "fstring single line":        'def f(x):\n    return f"v={x}"\n',
  "fstring nested":             'def f(x):\n    return f"{f\'{x}\'}"\n',
  "fstring triple spans":       'def f(x):\n    s = f"""\n    {x}\n    """\n    return s\n',
  "fstring spans braces":       'def f(x):\n    s = f"{\n        x\n    }"\n    return s\n',
  "fstring spans single quote": "def f(x):\n    s = f'{\n        x\n    }'\n    return s\n",
  "fstring spans with expr":    'def f(x):\n    s = f"{\n        x + 1\n    }"\n    return s\n',
  "plain string backslash join":'def f():\n    s = "abc\\\ndef"\n    return s\n',
  "comment with apostrophe":    "def f():\n    # it's ok\n    return 1\n",
  "string containing hash":     'def f():\n    s = "a # b"\n    return s\n',
  # ── [PY-QUOTE-CARRY] حملُ الاقتباس المفرد: مميِّزاتُه، سالبةً وموجبة ──
  # الفاحص يحمل الاقتباس المفرد حين تُجيز بايثون استمرارَه وحدها: ‎\‎ في آخر
  # السطر، أو حقلُ استبدالِ f-string مفتوح. وهذه الحالات تُمسك بالتمييز نفسه:
  # ‎\\‎ يُغلق النصّ ولا يُمدّه، و‎\\\‎ يُمدّه، و‎{{‎ قوسٌ حرفي لا حقلٌ مفتوح،
  # وعلامةُ الاقتباس داخل حقلٍ مفتوح ليست إغلاقًا (3.12+)، والبادئةُ ‎f‎ لا
  # تُقرأ من ذيل معرِّفٍ أطول.
  "str double backslash end":   'def f():\n    s = "abc\\\\"\n    return s\n',
  "str triple backslash join":  'def f():\n    s = "abc\\\\\\\ndef"\n    return s\n',
  "str escaped quote":          'def f():\n    s = "a\\"b"\n    return s\n',
  "fstring literal braces":     'def f(x):\n    s = f"{{x}}"\n    return s\n',
  "fstring quote in field":     'def f(d):\n    s = f"{d[\'k\']}"\n    return s\n',
  "fstring same quote field":   'def f(d):\n    s = f"{d["k"]}"\n    return s\n',
  "fstring rf prefix spans":    'def f(x):\n    s = rf"{\n        x\n    }\\d"\n    return s\n',
  "fstring F upper spans":      'def f(x):\n    s = F"{\n        x\n    }"\n    return s\n',
  "fstring bracket in field":   'def f(a):\n    s = f"{a[0]}"\n    return s\n',
  # ثلاثٌ منها تُميّز مُطلِقات [PY-QUOTE-CARVY] التي لا تُميّزها غيرُها —
  # أُضيفت لأن تحوّراتها نجت بدونها (قياسُ تحوّرٍ لا تخمين):
  #   • قوسٌ داخل حقلٍ بعلامةِ الاقتباس نفسها: بلا شرطِ العمق تُقرأ العلامةُ
  #     إغلاقًا، فيخرج ‎]‎ إلى الكود فيُرفض كودٌ صحيح.
  #   • ‎{{‎ وحدها: لو عُدّت حقلًا مفتوحًا لما أغلقت العلامةُ النصَّ.
  #   • نصٌّ عاديّ فيه ‎{‎: لو عُدّ كلُّ نصٍّ f-string لصار ‎"{"‎ حقلًا مفتوحًا
  #     فلا يُغلق — وهو أشيعُ شكلٍ في الكود الحقيقي.
  "fstring quote br in field":  'def f(d):\n    s = f"{d["]"]}"\n    return s\n',
  "fstring literal brace only": 'def f():\n    s = f"{{"\n    return s\n',
  "plain brace then concat":    'def f(x):\n    s = "{" + x\n    return s\n',
  "implicit concat lines":      'def f():\n    s = ("a"\n         "b")\n    return s\n',
  # ── أخطاء صياغة حقيقية ──
  "err dbl backslash then eol": 'def f():\n    s = "abc\\\\\n    return s\n',
  "err fstring field unclosed": 'def f(x):\n    s = f"{\n        x\n    return s\n',
  "err fstring lit brace open": 'def f(x):\n    s = f"{{\n    return s\n',
  "err bytes prefix unterm":    'def f():\n    s = b"abc\n    return s\n',
  # ونصٌّ **غيرُ** f فيه ‎{‎ لا يمتدّ: فبادئةُ ‎f‎ شرطٌ حامل، لا تزيين
  "err plain brace then eol":   'def f():\n    s = "{\n    return s\n',
  "err unclosed bracket":       'def f():\n    g(1\n    return 2\n',
  "err extra bracket":          'def f():\n    g(1))\n',
  "err unexpected indent":      'def f():\n    return 1\n        x = 2\n',
  "err no block after colon":   'def f():\nreturn 1\n',
  "err inconsistent indent":    'def f():\n    if x:\n            return 1\n      return 2\n',
  "err unterminated string":    'def f():\n    s = "abc\n    return s\n',
  "err unterminated triple":    'def f():\n    s = """abc\n    return s\n',
  "err colon no body eof":      'def f():\n',
  "err indent after brackets":  'def f():\n    d = {\n        "a": 1,\n    }\n        x = 2\n',
  "err indent after backslash": 'def f(a, b):\n    t = a + \\\n        b\n        x = 2\n',
  "err spanned header no body": 'def f():\n    if foo(\n        1\n    ):\n    return 1\n',
  "err indent after triple":    'def f():\n    s = """\nx\n"""\n        y = 1\n',
  "err plain string spans":     'def f():\n    s = "abc\ndef"\n    return s\n',
}

out = {"_python": sys.version.split()[0], "cases": {}}
for label, code in CASES.items():
    try:
        ast.parse(code)
        out["cases"][label] = {"valid": True, "code": code}
    except SyntaxError as e:
        out["cases"][label] = {"valid": False, "code": code, "msg": e.msg, "line": e.lineno}

print(json.dumps(out, ensure_ascii=False, indent=1, sort_keys=True))
