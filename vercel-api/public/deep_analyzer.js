// ═══════════════════════════════════════════════════════
// deep_analyzer.js v1.0 — Advanced Static Analysis
// Type Inference + Data Flow + Call Graph + Scope Analysis
// ═══════════════════════════════════════════════════════

"use strict";

// ═══════════════════════════════════════════════════════
// 1. TYPE INFERENCE ENGINE
// ═══════════════════════════════════════════════════════

class TypeInference {
    constructor() {
        this.types = new Map(); // varName → type info
    }

    infer(code) {
        const lines = code.split('\n');
        lines.forEach((line, i) => {
            this._inferLine(line.trim(), i + 1);
        });
        return this.types;
    }

    _inferLine(line, ln) {
        // Array literal: x = [...]
        let m = line.match(/(?:const|let|var)?\s*(\w+)\s*=\s*\[/);
        if (m) {
            this.types.set(m[1], { type: 'array', line: ln, items: this._inferArrayItems(line) });
            return;
        }

        // Object literal: x = {...}
        m = line.match(/(?:const|let|var)?\s*(\w+)\s*=\s*\{/);
        if (m && !line.includes('=>')) {
            this.types.set(m[1], { type: 'object', line: ln, keys: this._inferObjectKeys(line) });
            return;
        }

        // Number: x = 0 or x = 3.14
        m = line.match(/(?:const|let|var)?\s*(\w+)\s*=\s*(-?\d+\.?\d*)\s*[;,]?$/);
        if (m) {
            this.types.set(m[1], { type: 'number', value: parseFloat(m[2]), line: ln });
            return;
        }

        // String: x = "..." or x = '...'
        m = line.match(/(?:const|let|var)?\s*(\w+)\s*=\s*["'`][^"'`]*["'`]/);
        if (m) {
            this.types.set(m[1], { type: 'string', line: ln });
            return;
        }

        // Boolean
        m = line.match(/(?:const|let|var)?\s*(\w+)\s*=\s*(true|false)/);
        if (m) {
            this.types.set(m[1], { type: 'boolean', value: m[2] === 'true', line: ln });
            return;
        }

        // Function result: x = someFunc()
        m = line.match(/(?:const|let|var)?\s*(\w+)\s*=\s*(\w+)\s*\(/);
        if (m) {
            this.types.set(m[1], { type: 'function_result', source: m[2], line: ln });
            return;
        }

        // forEach/map parameter: items.forEach(item => ...)
        m = line.match(/(\w+)\.forEach\s*\(\s*(\w+)\s*=>/);
        if (m) {
            const arrType = this.types.get(m[1]);
            if (arrType && arrType.type === 'array' && arrType.items) {
                this.types.set(m[2], { type: 'array_element', parent: m[1], keys: arrType.items, line: ln });
            }
        }

        // for...of parameter
        m = line.match(/for\s*\(\s*(?:const|let)?\s*(\w+)\s+of\s+(\w+)/);
        if (m) {
            const arrType = this.types.get(m[2]);
            if (arrType) {
                this.types.set(m[1], { type: 'array_element', parent: m[2], line: ln });
            }
        }
    }

    _inferArrayItems(line) {
        // استنتج keys من array of objects: [{price: 10, name: "x"}]
        const objMatch = line.match(/\[\s*\{([^}]+)\}/);
        if (!objMatch) return null;
        const keys = [];
        const keyMatches = objMatch[1].matchAll(/(\w+)\s*:/g);
        for (const km of keyMatches) keys.push(km[1]);
        return keys.length ? keys : null;
    }

    _inferObjectKeys(line) {
        const keys = [];
        const keyMatches = line.matchAll(/(\w+)\s*:/g);
        for (const km of keyMatches) keys.push(km[1]);
        return keys;
    }

    getType(varName) {
        return this.types.get(varName) || { type: 'unknown' };
    }
}

// ═══════════════════════════════════════════════════════
// 2. DATA FLOW ANALYSIS
// ═══════════════════════════════════════════════════════

class DataFlowAnalyzer {
    constructor(typeMap) {
        this.typeMap   = typeMap;
        this.issues    = [];
        this.defUseMap = new Map(); // varName → [{line, op}]
    }

    analyze(code) {
        const lines = code.split('\n');

        lines.forEach((line, i) => {
            const t  = line.trim();
            const ln = i + 1;

            // تتبع التعريفات
            this._trackDefinition(t, ln);

            // اكتشف مشاكل تدفق البيانات
            this._detectAccumulationError(t, ln, lines, i);
            this._detectUseBeforeDefine(t, ln);
            this._detectTypeViolation(t, ln);
            this._detectDeadAssignment(t, ln, lines, i);
        });

        return this.issues;
    }

    _trackDefinition(line, ln) {
        const m = line.match(/(\w+)\s*=\s*(.+)/);
        if (!m) return;
        const varName = m[1];
        if (!this.defUseMap.has(varName)) this.defUseMap.set(varName, []);
        this.defUseMap.get(varName).push({ line: ln, op: 'def', value: m[2] });
    }

    _detectAccumulationError(line, ln, lines, idx) {
        // x = y.prop بدل x += y.prop داخل loop
        const assignMatch = line.match(/^(\w+)\s*=\s*(\w+)\.(\w+)\s*[;]?$/);
        if (!assignMatch) return;

        const [, varName, obj, prop] = assignMatch;
        const varType = this.typeMap.get(varName);

        // تحقق إن المتغير number
        if (!varType || varType.type !== 'number') return;

        // تحقق إننا داخل loop
        const prevCode = lines.slice(Math.max(0, idx - 8), idx).join('\n');
        const inLoop = /forEach|for\s*\(|while\s*\(|\.map\s*\(/.test(prevCode);
        if (!inLoop) return;

        // تحقق نوع obj
        const objType = this.typeMap.get(obj);
        const isNumericProp = objType && objType.keys && objType.keys.includes(prop);

        this.issues.push({
            type: 'dataflow', sev: 'h', line: ln, ev: line,
            title: `🟠 Data Flow: ${varName} = ${obj}.${prop} داخل loop — يجب +=`,
            fix:   `${varName} += ${obj}.${prop};`,
            conf:  isNumericProp ? 95 : 82,
            cIcon: '🟠', cAct: 'Accumulation Error (Data Flow)',
            cEv:   [`${varName} نوعه number، يُعاد تعيينه بدل التراكم`],
        });
    }

    _detectUseBeforeDefine(line, ln) {
        // استخدام متغير قبل تعريفه
        const useMatch = line.match(/\b(\w+)\.([\w]+)\s*[;)]/);
        if (!useMatch) return;
        const [, varName] = useMatch;
        if (['console','Math','Object','Array','JSON','Promise'].includes(varName)) return;
        const def = this.defUseMap.get(varName);
        if (!def) return; // ما نعرف عنه شيء
    }

    _detectTypeViolation(line, ln) {
        // استخدام string method على number
        const m = line.match(/(\w+)\.(\w+)\s*\(/);
        if (!m) return;
        const [, varName, method] = m;
        const type = this.typeMap.get(varName);
        if (!type) return;

        const stringMethods = ['toUpperCase','toLowerCase','split','trim','replace','includes','startsWith'];
        const arrayMethods  = ['forEach','map','filter','reduce','find','some','every','push','pop'];
        const numberMethods = ['toFixed','toPrecision','toExponential'];

        if (type.type === 'number' && stringMethods.includes(method)) {
            this.issues.push({
                type: 'dataflow', sev: 'm', line: ln, ev: line,
                title: `🟡 Type Error: ${varName} هو number لكن يستخدم string method .${method}()`,
                fix:   `// تحقق من نوع ${varName} أو حوّله: String(${varName}).${method}()`,
                conf:  88, cIcon: '🟡', cAct: 'Type Violation',
                cEv:   [`${varName} معرّف كـ number في السطر ${type.line}`],
            });
        }

        if (type.type === 'string' && arrayMethods.includes(method)) {
            this.issues.push({
                type: 'dataflow', sev: 'm', line: ln, ev: line,
                title: `🟡 Type Error: ${varName} هو string لكن يستخدم array method .${method}()`,
                fix:   `// حوّل ${varName} لـ array أولاً`,
                conf:  85, cIcon: '🟡', cAct: 'Type Violation',
                cEv:   [`${varName} معرّف كـ string في السطر ${type.line}`],
            });
        }
    }

    _detectDeadAssignment(line, ln, lines, idx) {
        // تعيين متغير لا يُستخدم
        const assignMatch = line.match(/^(?:const|let|var)\s+(\w+)\s*=/);
        if (!assignMatch) return;
        const varName = assignMatch[1];
        const restCode = lines.slice(idx + 1).join('\n');
        if (!restCode.includes(varName)) {
            this.issues.push({
                type: 'dataflow', sev: 'l', line: ln, ev: line,
                title: `🔵 Dead Assignment: ${varName} معرّف لكن لا يُستخدم`,
                fix:   `// احذف ${varName} إذا لم تكن تحتاجه`,
                conf:  72, cIcon: '🔵', cAct: 'Dead Code',
                cEv:   [`${varName} لا يُستخدم بعد السطر ${ln}`],
            });
        }
    }
}

// ═══════════════════════════════════════════════════════
// 3. CALL GRAPH ANALYZER
// ═══════════════════════════════════════════════════════

class CallGraphAnalyzer {
    constructor() {
        this.functions = new Map(); // funcName → {params, calls, line}
        this.issues    = [];
    }

    analyze(code) {
        const lines = code.split('\n');

        // استخرج كل الدوال
        lines.forEach((line, i) => {
            this._extractFunction(line.trim(), i + 1, lines, i);
        });

        // اكتشف مشاكل
        this._detectRecursion();
        this._detectUnusedFunctions(code);
        this._detectLongParamList();

        return this.issues;
    }

    _extractFunction(line, ln, lines, idx) {
        let m = line.match(/function\s+(\w+)\s*\(([^)]*)\)/);
        if (!m) m = line.match(/(?:const|let)\s+(\w+)\s*=\s*(?:async\s*)?\(([^)]*)\)\s*=>/);
        if (!m) m = line.match(/(?:const|let)\s+(\w+)\s*=\s*function\s*\(([^)]*)\)/);
        if (!m) return;

        const funcName = m[1];
        const params   = m[2].split(',').map(p => p.trim()).filter(Boolean);

        // استخرج الدوال المستدعاة
        const body = lines.slice(idx, Math.min(idx + 50, lines.length)).join('\n');
        const calls = [];
        const callMatches = body.matchAll(/(\w+)\s*\(/g);
        for (const cm of callMatches) {
            if (cm[1] !== funcName && !['if','for','while','switch'].includes(cm[1]))
                calls.push(cm[1]);
        }

        this.functions.set(funcName, { params, calls, line: ln });
    }

    _detectRecursion() {
        this.functions.forEach((info, funcName) => {
            if (info.calls.includes(funcName)) {
                // تحقق إن فيه base case
                this.issues.push({
                    type: 'callgraph', sev: 'l', line: info.line, ev: funcName,
                    title: `🔵 Call Graph: ${funcName}() recursive — تأكد من base case`,
                    fix:   `// تأكد إن فيه حالة إيقاف لتجنب stack overflow`,
                    conf:  78, cIcon: '🔵', cAct: 'Recursion Check',
                    cEv:   [`${funcName} تستدعي نفسها`],
                });
            }
        });
    }

    _detectUnusedFunctions(code) {
        this.functions.forEach((info, funcName) => {
            if (funcName === 'main' || funcName === 'init' || funcName === 'setup') return;
            // تحقق إن الدالة مستدعاة في مكان آخر
            const pattern = new RegExp(`\\b${funcName}\\s*\\(`, 'g');
            const matches = [...code.matchAll(pattern)];
            if (matches.length <= 1) { // فقط التعريف نفسه
                this.issues.push({
                    type: 'callgraph', sev: 'l', line: info.line, ev: funcName,
                    title: `🔵 Call Graph: ${funcName}() معرّفة لكن لا تُستدعى`,
                    fix:   `// احذف ${funcName}() أو استدعِها`,
                    conf:  65, cIcon: '🔵', cAct: 'Dead Code',
                    cEv:   [`${funcName} لا تُستدعى في أي مكان`],
                });
            }
        });
    }

    _detectLongParamList() {
        this.functions.forEach((info, funcName) => {
            if (info.params.length > 4) {
                this.issues.push({
                    type: 'callgraph', sev: 'm', line: info.line, ev: funcName,
                    title: `🟡 Call Graph: ${funcName}() لها ${info.params.length} parameters — كثير`,
                    fix:   `// استخدم object parameter: function ${funcName}({${info.params.slice(0,3).join(', ')}, ...}) {}`,
                    conf:  80, cIcon: '🟡', cAct: 'Code Quality',
                    cEv:   [`${info.params.length} parameters أكثر من المعتاد (max 4)`],
                });
            }
        });
    }
}

// ═══════════════════════════════════════════════════════
// 4. SCOPE ANALYZER
// ═══════════════════════════════════════════════════════

class ScopeAnalyzer {
    constructor() {
        this.scopes = [];
        this.issues = [];
    }

    analyze(code) {
        const lines  = code.split('\n');
        const global = { name: 'global', vars: new Map(), start: 0, end: lines.length };
        this.scopes.push(global);

        let currentScope = global;
        const scopeStack = [global];

        lines.forEach((line, i) => {
            const t  = line.trim();
            const ln = i + 1;

            // دخول scope جديد
            if (/function\s+\w+|=>\s*\{|\)\s*\{/.test(t) && t.includes('{')) {
                const newScope = { name: this._getScopeName(t), vars: new Map(), start: ln, end: null, parent: currentScope };
                this.scopes.push(newScope);
                scopeStack.push(newScope);
                currentScope = newScope;
            }

            // خروج scope
            if (t === '}' || t === '};') {
                if (scopeStack.length > 1) {
                    currentScope.end = ln;
                    scopeStack.pop();
                    currentScope = scopeStack[scopeStack.length - 1];
                }
            }

            // تسجيل المتغيرات
            const varMatch = t.match(/(?:const|let|var)\s+(\w+)/);
            if (varMatch) {
                currentScope.vars.set(varMatch[1], { line: ln, scope: currentScope.name });
                // اكتشف var في block scope
                if (t.startsWith('var ') && currentScope.name !== 'global') {
                    this.issues.push({
                        type: 'scope', sev: 'm', line: ln, ev: t,
                        title: `🟡 Scope: var ${varMatch[1]} — استخدم let أو const`,
                        fix:   t.replace(/^var\s+/, 'let '),
                        conf:  90, cIcon: '🟡', cAct: 'Scope Issue',
                        cEv:   [`var يتجاوز block scope — استخدم let/const`],
                    });
                }
            }

            // اكتشف global variable contamination
            const assignMatch = t.match(/^(\w+)\s*=\s*/);
            if (assignMatch && !t.startsWith('//')) {
                const varName = assignMatch[1];
                if (!this._isDefinedInScope(varName, currentScope) &&
                    !['module','exports','window','document','console','process'].includes(varName)) {
                    // ربما global contamination
                }
            }
        });

        return this.issues;
    }

    _getScopeName(line) {
        const m = line.match(/function\s+(\w+)|(?:const|let)\s+(\w+)\s*=/);
        return m ? (m[1] || m[2] || 'anonymous') : 'anonymous';
    }

    _isDefinedInScope(varName, scope) {
        let current = scope;
        while (current) {
            if (current.vars.has(varName)) return true;
            current = current.parent;
        }
        return false;
    }
}

// ═══════════════════════════════════════════════════════
// 5. MAIN DEEP ANALYZER — يجمع كل الأنظمة
// ═══════════════════════════════════════════════════════

function deepAnalyze(code, fileName) {
    const ext = fileName.split('.').pop().toLowerCase();
    if (!['js','ts','jsx','tsx'].includes(ext)) return [];

    const issues = [];

    try {
        // 1. Type Inference
        const ti = new TypeInference();
        const typeMap = ti.infer(code);

        // 2. Data Flow
        const df = new DataFlowAnalyzer(typeMap);
        const dfIssues = df.analyze(code);
        issues.push(...dfIssues);

        // 3. Call Graph
        const cg = new CallGraphAnalyzer();
        const cgIssues = cg.analyze(code);
        issues.push(...cgIssues);

        // 4. Scope
        const sa = new ScopeAnalyzer();
        const saIssues = sa.analyze(code);
        issues.push(...saIssues);

    } catch(e) {
        console.warn('[DeepAnalyzer] Error:', e.message);
    }

    return issues;
}
