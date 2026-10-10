#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""مولّد أزواج before/after من ملفات بايثون حقيقية، مع حقيقة أرضية للضرر.

التحويل يجري على شجرة AST، والناتج يُخرَج بـast.unparse، فالطرفان بايثون صحيح
بالتأكيد، وبالتنسيق نفسه — فأي فرق بينهما هو التحويل وحده.

الحقيقة الأرضية تُحسب من الشجرة لا من النص: لكل عبارة معرّف ثابت يُنقل مع
النسخة، فنعرف بالضبط أي عبارة كانت تُنفَّذ وتوقّفت، وأي عبارة ميتة أُنشئت.
"""
import ast
import collections
import copy
import json
import random
import sys
import zlib

TERMINATORS = (ast.Return, ast.Raise, ast.Break, ast.Continue)
BODY_FIELDS = ('body', 'orelse', 'finalbody')


def is_terminator(node):
    if isinstance(node, TERMINATORS):
        return True
    # sys.exit(...) / os._exit(...) كعبارة مستقلة
    if isinstance(node, ast.Expr) and isinstance(node.value, ast.Call):
        f = node.value.func
        if isinstance(f, ast.Attribute) and isinstance(f.value, ast.Name):
            return (f.value.id, f.attr) in (('sys', 'exit'), ('os', '_exit'))
    return False


def each_body(tree):
    """كل (العبارة الحاوية، اسم الحقل، قائمة العبارات)."""
    out = []
    for node in ast.walk(tree):
        for field in BODY_FIELDS:
            body = getattr(node, field, None)
            if isinstance(body, list) and body and all(isinstance(s, ast.stmt) for s in body):
                out.append((node, field, body))
    return out


def tag(tree):
    n = 0
    for node in ast.walk(tree):
        if isinstance(node, ast.stmt):
            node._mid = n
            n += 1
    return n


def dead_nodes(tree):
    """هوية العُقد غير القابلة للوصول — بهوية العقدة لا بمعرّفها المنطقي،
    كي تُحسب النسخ المكرّرة كل واحدة على حالها."""
    out = set()
    for _, _, body in each_body(tree):
        dead = False
        for st in body:
            if dead:
                if not is_bare_string(st):
                    out.add(id(st))
                for sub in ast.walk(st):
                    if isinstance(sub, ast.stmt) and sub is not st and not is_bare_string(sub):
                        out.add(id(sub))
            elif is_terminator(st):
                dead = True
    return out


def dead_instances(tree):
    d = dead_nodes(tree)
    return [getattr(s, '_mid', None) for s in ast.walk(tree)
            if isinstance(s, ast.stmt) and id(s) in d]


def unreachable_mids(tree):
    return set(dead_instances(tree))


def reachable_mids(tree):
    """معرّف له نسخة واحدة قابلة للوصول على الأقل ⇒ ما زال يُنفَّذ."""
    d = dead_nodes(tree)
    return {getattr(s, '_mid', None) for s in ast.walk(tree)
            if isinstance(s, ast.stmt) and id(s) not in d and not is_bare_string(s)}


def scope_name(node):
    if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
        return node.name
    return None


def is_bare_string(st):
    """عبارة نصّية مجرّدة (docstring أو نص معلّق): بلا أثر جانبي.

    ماسح البوابة يُعمّي محتوى النصوص إلى مسافات، فلا يراها عبارةً أصلًا — وهذا
    سليم: إسكات docstring ليس إسكات تنفيذ. فنُخرجها من الحقيقة الأرضية كي يقيس
    الاختبار المطابقة لا الخلاف على تعريف "عبارة".
    """
    return isinstance(st, ast.Expr) and isinstance(st.value, ast.Constant) \
        and isinstance(st.value.value, str)


def simple(st):
    """عبارة بسيطة سطر واحد، آمنة للنقل، ولها أثر فعلي."""
    if is_bare_string(st):
        return False
    return isinstance(st, (ast.Expr, ast.Assign, ast.AugAssign, ast.Pass)) \
        and not isinstance(getattr(st, 'value', None), (ast.Yield, ast.YieldFrom, ast.Await))


def funcs(tree):
    return [n for n in ast.walk(tree) if isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef))]


def bodies_with_terminator(tree):
    """كتل فيها مُنهٍ، مع موضعه."""
    out = []
    for owner, field, body in each_body(tree):
        for i, st in enumerate(body):
            if is_terminator(st):
                out.append((owner, field, body, i))
                break
    return out


def new_call(name):
    return ast.parse(f'{name}()').body[0]


# ─────────────── التحويلات ───────────────
# كل تحويل يُعيد اسمًا أو None إذا لم ينطبق. يعمل على الشجرة المُعطاة مباشرة.

def mut_swap_return(t, rnd):
    """يبادل مُنهيًا مع عبارة بسيطة قبله ⇒ تلك العبارة تموت."""
    cands = [(b, i) for _, _, b, i in bodies_with_terminator(t) if i >= 1 and simple(b[i - 1])]
    if not cands:
        return None
    body, i = rnd.choice(cands)
    body[i - 1], body[i] = body[i], body[i - 1]
    return 'swap_return'


def mut_move_after_return(t, rnd):
    """ينقل عبارة حيّة إلى ما بعد المُنهي في الكتلة نفسها."""
    cands = [(b, i) for _, _, b, i in bodies_with_terminator(t) if i >= 2 and simple(b[i - 1])]
    if not cands:
        return None
    body, i = rnd.choice(cands)
    st = body.pop(i - 1)
    body.insert(i, st)
    return 'move_after_return'


def mut_move_across_scopes(t, rnd):
    """ينقل عبارة حيّة من دالة إلى موضع ميت في دالة أخرى."""
    src = [(b, i) for _, _, b, i in bodies_with_terminator(t) if i >= 2 and simple(b[i - 1])]
    dst = [(b, i) for _, _, b, i in bodies_with_terminator(t)]
    if not src or len(dst) < 2:
        return None
    sb, si = rnd.choice(src)
    others = [(b, i) for b, i in dst if b is not sb]
    if not others:
        return None
    db, di = rnd.choice(others)
    st = sb.pop(si - 1)
    db.insert(di + 1, st)
    return 'move_across_scopes'


def mut_move_across_scopes_and_drop_dead(t, rnd):
    """ينقل عبارة حيّة إلى موضع ميت في كتلة أخرى، ويحذف ميتًا من تلك الكتلة.
    العدد الكلي يبقى ثابتًا، والنطاق الهدف لم يكن فيه ذلك النص حيًّا ⇒ ضغط على
    القاعدة المحلّية بالنطاق."""
    src = [(b, i) for _, _, b, i in bodies_with_terminator(t) if i >= 2 and simple(b[i - 1])]
    dst = [(b, i) for _, _, b, i in bodies_with_terminator(t) if len(b) > i + 1]
    if not src or not dst:
        return None
    sb, si = rnd.choice(src)
    others = [(b, i) for b, i in dst if b is not sb]
    if not others:
        return None
    db, di = rnd.choice(others)
    st = sb.pop(si - 1)
    del db[di + 1]                  # ميت من كتلة الوصول يُحذف
    db.insert(di + 1, st)           # والحيّ يُدفن مكانه
    return 'move_across_and_drop_dead'


def mut_insert_dead(t, rnd):
    """يُلحق عبارة جديدة تمامًا بعد المُنهي — شكل خلل القَولَبة."""
    cands = bodies_with_terminator(t)
    if not cands:
        return None
    _, _, body, i = rnd.choice(cands)
    body.insert(i + 1, new_call('_injected_tail'))
    return 'insert_dead'


def mut_dup_live_after_return(t, rnd):
    """يُلحق نسخة من عبارة حيّة بعد المُنهي (الأصل يبقى حيًّا)."""
    cands = [(b, i) for _, _, b, i in bodies_with_terminator(t) if i >= 1 and simple(b[i - 1])]
    if not cands:
        return None
    body, i = rnd.choice(cands)
    body.insert(i + 1, copy.deepcopy(body[i - 1]))
    return 'dup_live_after_return'


def mut_kill_live_rewrite_drop_dead(t, rnd):
    """الحالة المتبقية: يقتل سطرًا حيًّا، ويغيّر نصه، ويحذف ميتًا في النطاق نفسه."""
    cands = []
    for _, _, body, i in bodies_with_terminator(t):
        after = body[i + 1:]
        if i >= 1 and simple(body[i - 1]) and after:
            cands.append((body, i))
    if not cands:
        return None
    body, i = rnd.choice(cands)
    victim = body.pop(i - 1)          # العبارة الحيّة تُسحب
    del body[i:i + 1]                 # وميت سابق واحد يُحذف (الفهرس أزيح بـ-1)
    # تُعاد مقتولة وبنصّ مختلف
    renamed = new_call('_rewritten_victim')
    renamed._mid = getattr(victim, '_mid', None)   # الهوية تبقى: نفس العبارة، نصّ جديد
    body.append(renamed)
    return 'kill_live_rewrite_drop_dead'


def mut_kill_rewrite_drop_add_live(t, rnd):
    """ح6: يقتل سطرًا حيًّا ويُعيد كتابته، ويحذف ميتًا، ويضيف سطرًا حيًّا
    جديدًا فيبقى عدد الأحياء في النطاق كما هو ⇒ قاعدة الاشتباه لا تراه."""
    cands = []
    for _, _, body, i in bodies_with_terminator(t):
        if i >= 1 and simple(body[i - 1]) and len(body) > i + 1:
            cands.append((body, i))
    if not cands:
        return None
    body, i = rnd.choice(cands)
    victim = body.pop(i - 1)          # الحيّ يُسحب
    del body[i:i + 1]                 # وميت سابق يُحذف
    body.insert(i - 1, new_call('_added_live'))   # وحيّ جديد يحلّ محلّه
    renamed = new_call('_rewritten_victim')
    renamed._mid = getattr(victim, '_mid', None)
    body.append(renamed)              # والضحيّة تُدفن بنصّ جديد
    return 'kill_rewrite_drop_add_live'


def mut_kill_across_rewrite_drop(t, rnd):
    """ح7: ينقل حيًّا إلى موضع ميت في كتلة أخرى بنصّ مختلف، ويحذف ميتًا من
    كتلة الوصول، ويضيف حيًّا في كتلة المصدر ⇒ العدّ والأحياء ثابتان."""
    src = [(b, i) for _, _, b, i in bodies_with_terminator(t) if i >= 1 and simple(b[i - 1])]
    dst = [(b, i) for _, _, b, i in bodies_with_terminator(t) if len(b) > i + 1]
    if not src or not dst:
        return None
    sb, si = rnd.choice(src)
    others = [(b, i) for b, i in dst if b is not sb]
    if not others:
        return None
    db, di = rnd.choice(others)
    victim = sb.pop(si - 1)
    sb.insert(si - 1, new_call('_pad_live'))
    del db[di + 1]
    renamed = new_call('_moved_victim')
    renamed._mid = getattr(victim, '_mid', None)
    db.insert(di + 1, renamed)
    return 'kill_across_rewrite_drop'


def mut_rename_scopes(t, rnd):
    """إعادة تسمية كل الدوال والأصناف — لا ضرر."""
    n = 0
    for node in ast.walk(t):
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
            node.name = node.name + '_v2'
            n += 1
    return 'rename_scopes' if n else None


def mut_collide_scope_names(t, rnd):
    """يجعل دالتين مختلفتين تحملان الاسم نفسه — اختبار اندماج النطاقات."""
    fs = funcs(t)
    if len(fs) < 2:
        return None
    a, b = rnd.sample(fs, 2)
    b.name = a.name
    return 'collide_scope_names'


def mut_collide_and_move(t, rnd):
    """يوحّد اسم دالتين، ثم ينقل حيًّا من إحداهما إلى موضع ميت في الأخرى."""
    fs = [f for f in funcs(t) if any(is_terminator(s) for s in f.body)]
    if len(fs) < 2:
        return None
    a, b = rnd.sample(fs, 2)
    ai = next(i for i, s in enumerate(a.body) if is_terminator(s))
    bi = next(i for i, s in enumerate(b.body) if is_terminator(s))
    if ai < 1 or not simple(a.body[ai - 1]):
        return None
    b.name = a.name
    st = a.body.pop(ai - 1)
    b.body.insert(bi + 1, st)
    return 'collide_and_move'


def mut_swap_dead_between_scopes(t, rnd):
    """يبادل عبارتين ميتتين بين كتلتين — لا ضرر."""
    pairs = []
    for _, _, body, i in bodies_with_terminator(t):
        if len(body) > i + 1:
            pairs.append((body, i + 1))
    if len(pairs) < 2:
        return None
    (b1, i1), (b2, i2) = rnd.sample(pairs, 2)
    b1[i1], b2[i2] = b2[i2], b1[i1]
    return 'swap_dead_between_scopes'


def mut_move_dead_across_scopes(t, rnd):
    """ينقل عبارة ميتة من كتلة إلى كتلة أخرى — سليم: الميت بقي ميتًا.
    وهو الضغط المباشر على العدّ لكل نطاق: عدّ نطاق ينقص وعدّ آخر يرتفع."""
    src = [(b, i + 1) for _, _, b, i in bodies_with_terminator(t) if len(b) > i + 1]
    dst = [(b, i) for _, _, b, i in bodies_with_terminator(t)]
    if not src or len(dst) < 2:
        return None
    sb, si = rnd.choice(src)
    others = [(b, i) for b, i in dst if b is not sb]
    if not others:
        return None
    db, di = rnd.choice(others)
    st = sb.pop(si)
    db.insert(di + 1, st)
    return 'move_dead_across_scopes'


def mut_rewrite_dead(t, rnd):
    """يغيّر نص عبارة ميتة — لا ضرر."""
    cands = [(b, i + 1) for _, _, b, i in bodies_with_terminator(t) if len(b) > i + 1]
    if not cands:
        return None
    body, i = rnd.choice(cands)
    old = body[i]
    repl = new_call('_rewritten_dead')
    repl._mid = getattr(old, '_mid', None)
    body[i] = repl
    return 'rewrite_dead'


def mut_drop_dead(t, rnd):
    """يحذف عبارة ميتة — تحسين، لا ضرر."""
    cands = [(b, i + 1) for _, _, b, i in bodies_with_terminator(t) if len(b) > i + 1]
    if not cands:
        return None
    body, i = rnd.choice(cands)
    del body[i]
    return 'drop_dead'


def mut_delete_live(t, rnd):
    """يحذف عبارة حيّة تمامًا — ليس قتلًا بالوصول."""
    cands = []
    for _, _, body in each_body(t):
        dead_from = next((i for i, st in enumerate(body) if is_terminator(st)), len(body))
        for i, st in enumerate(body[:dead_from]):
            if simple(st) and len(body) > 1:
                cands.append((body, i))
    if not cands:
        return None
    body, i = rnd.choice(cands)
    del body[i]
    return 'delete_live'


def _live_and_dead_in_body(t):
    """كتل فيها عبارة حيّة بسيطة وعبارة ميتة واحدة على الأقل."""
    out = []
    for _, _, body in each_body(t):
        term = next((i for i, st in enumerate(body) if is_terminator(st)), None)
        if term is None or len(body) <= term + 1 or term < 1:
            continue
        live = [i for i, st in enumerate(body[:term]) if simple(st)]
        if live:
            out.append((body, live, term))
    return out


def mut_delete_live_and_rewrite_dead(t, rnd):
    """حذف سطر حيّ + تغيير نصّ ميت في الكتلة نفسها — سليم، وهو ضغط على مرشَّح 7."""
    cands = _live_and_dead_in_body(t)
    if not cands:
        return None
    body, live, term = rnd.choice(cands)
    i = rnd.choice(live)
    old_dead = body[term + 1]
    repl = new_call('_rewritten_dead')
    repl._mid = getattr(old_dead, '_mid', None)
    body[term + 1] = repl
    del body[i]
    return 'delete_live_and_rewrite_dead'


def mut_delete_live_and_drop_dead(t, rnd):
    """حذف سطر حيّ + إزالة ميت في الكتلة نفسها — سليم."""
    cands = _live_and_dead_in_body(t)
    if not cands:
        return None
    body, live, term = rnd.choice(cands)
    i = rnd.choice(live)
    del body[term + 1]
    del body[i]
    return 'delete_live_and_drop_dead'


def mut_move_dead_within_scope(t, rnd):
    """تبديل موضع ميتين في الكتلة نفسها — سليم."""
    cands = []
    for _, _, body in each_body(t):
        term = next((i for i, st in enumerate(body) if is_terminator(st)), None)
        if term is not None and len(body) >= term + 3:
            cands.append((body, term))
    if not cands:
        return None
    body, term = rnd.choice(cands)
    body[term + 1], body[term + 2] = body[term + 2], body[term + 1]
    return 'move_dead_within_scope'


def mut_wrap_try(t, rnd):
    """يلفّ جسم دالة في try/except — تغيّر بنية وإزاحة بلا ضرر."""
    fs = [f for f in funcs(t) if len(f.body) >= 2]
    if not fs:
        return None
    f = rnd.choice(fs)
    handler = ast.ExceptHandler(type=ast.Name(id='Exception', ctx=ast.Load()), name=None,
                                body=[ast.Raise(exc=None, cause=None)])
    f.body = [ast.Try(body=list(f.body), handlers=[handler], orelse=[], finalbody=[])]
    return 'wrap_try'


def mut_reorder_top(t, rnd):
    """يعكس ترتيب كتل المستوى الأعلى — لا ضرر في الوصول."""
    if len(t.body) < 2:
        return None
    t.body = list(reversed(t.body))
    return 'reorder_top'


def mut_change_strings(t, rnd):
    """يغيّر محتوى النصوص الحرفية — لا ضرر."""
    n = 0
    for node in ast.walk(t):
        if isinstance(node, ast.Constant) and isinstance(node.value, str):
            node.value = 'X' * max(1, len(node.value))
            n += 1
    return 'change_strings' if n else None


# حقن كود ميت سابق، لتفعيل منطق الرصيد على ملفات حقيقية
def pre_inject_dead(t, rnd, count=3):
    cands = bodies_with_terminator(t)
    rnd.shuffle(cands)
    k = 0
    for n, (_, _, body, i) in enumerate(cands[:count]):
        body.insert(i + 1, new_call(f'_pre_dead_{k}'))
        k += 1
        if n == 0:                      # كتلة واحدة بميتين، لتفعيل النقل داخل النطاق
            body.insert(i + 2, new_call(f'_pre_dead_{k}'))
            k += 1
    return k


MUTATIONS = [
    mut_swap_return, mut_move_after_return, mut_move_across_scopes, mut_insert_dead,
    mut_dup_live_after_return, mut_kill_live_rewrite_drop_dead, mut_rename_scopes,
    mut_collide_scope_names, mut_collide_and_move, mut_swap_dead_between_scopes,
    mut_rewrite_dead, mut_drop_dead, mut_delete_live, mut_wrap_try, mut_reorder_top,
    mut_change_strings, mut_delete_live_and_rewrite_dead, mut_delete_live_and_drop_dead,
    mut_move_dead_within_scope, mut_move_across_scopes_and_drop_dead,
    mut_move_dead_across_scopes, mut_kill_rewrite_drop_add_live,
    mut_kill_across_rewrite_drop,
]


def build(path, seed, inject):
    try:
        src = open(path, encoding='utf-8', errors='strict').read()
    except Exception:
        return []
    try:
        base = ast.parse(src)
    except SyntaxError:
        return []

    rnd = random.Random(seed)
    if inject:
        tag(base)
        if not pre_inject_dead(base, rnd):
            return []
    tag(base)
    try:
        before = ast.unparse(base)
        ast.parse(before)
    except Exception:
        return []

    before_dead_inst = collections.Counter(dead_instances(base))
    before_live = reachable_mids(base)
    out = []
    for mut in MUTATIONS:
        t2 = copy.deepcopy(base)
        # crc32 لا hash(): الأخيرة مُبعثرة لكل عملية، فتختلف الأرقام بين تشغيلين
        r = random.Random(seed ^ (zlib.crc32(mut.__name__.encode()) & 0xffff))
        try:
            name = mut(t2, r)
        except Exception:
            name = None
        if not name:
            continue
        try:
            ast.fix_missing_locations(t2)
            after = ast.unparse(t2)
            ast.parse(after)
        except Exception:
            continue
        if after == before:
            continue

        after_dead_inst = collections.Counter(dead_instances(t2))
        after_dead = set(after_dead_inst)
        after_live = reachable_mids(t2)

        # (ب) عبارة كانت تُنفَّذ وتوقّفت تمامًا — بالهوية لا بالنص.
        #     نسخة باقية حيّة تنفي القتل (حالة التكرار إلى موضع ميت).
        killed = sorted(m for m in after_dead
                        if m is not None and m in before_live and m not in after_live)
        # (أ) نُسخ ميتة زائدة على ما كان: جديدة، أو مكرّرة، أو ميت تضاعف.
        excess = sum(max(0, after_dead_inst[m] - before_dead_inst.get(m, 0)) for m in after_dead_inst)
        excess_new = sum(max(0, after_dead_inst[m] - before_dead_inst.get(m, 0))
                         for m in after_dead_inst if m not in before_live)
        out.append({
            'file': path.rsplit('/', 1)[-1],
            'mutation': name,
            'inject': bool(inject),
            'before': before,
            'after': after,
            'killed_live': len(killed),
            'added_dead': excess - len(killed) if excess > len(killed) else 0,
            'excess_dead': excess,
            'harm': bool(killed) or excess > 0,
            'before_dead': sum(before_dead_inst.values()),
            'after_dead': sum(after_dead_inst.values()),
        })
    return out


def main():
    seed = int(sys.argv[1])
    inject = sys.argv[2] == '1'
    paths = sys.argv[3:]
    rows = []
    for p in paths:
        rows.extend(build(p, seed, inject))
    json.dump(rows, sys.stdout)


if __name__ == '__main__':
    main()
