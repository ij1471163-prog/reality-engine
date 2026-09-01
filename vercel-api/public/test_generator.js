// ─── Test Generator ──────────────────────────────────
// يولد Unit Tests تلقائياً للكود

function generateTests(code, fileName) {
  const ext = fileName.split('.').pop().toLowerCase();
  const functions = extractFunctions(code, ext);
  
  if (functions.length === 0) return '// ما وجدنا دوال لاختبارها';
  
  if (ext === 'py') return generatePyTests(functions, fileName);
  if (['js','jsx','ts'].includes(ext)) return generateJSTests(functions, fileName);
  if (ext === 'java') return generateJavaTests(functions, fileName);
  
  return '// نوع الملف غير مدعوم';
}

// ─── استخراج الدوال ───────────────────────────────────
function extractFunctions(code, ext) {
  const functions = [];
  const lines = code.split('\n');
  
  if (ext === 'py') {
    lines.forEach((line, i) => {
      const m = line.match(/^def (\w+)\(([^)]*)\)/);
      if (m && !m[1].startsWith('_')) {
        functions.push({
          name: m[1],
          params: m[2].split(',').map(p => p.trim()).filter(Boolean),
          line: i + 1
        });
      }
    });
  } else if (['js','jsx','ts'].includes(ext)) {
    lines.forEach((line, i) => {
      const m = line.match(/(?:function (\w+)|(?:const|let) (\w+)\s*=\s*(?:async\s*)?\(([^)]*)\)\s*=>)\s*[({]/);
      if (m) {
        const name = m[1] || m[2];
        if (name && !name.startsWith('_')) {
          functions.push({ name, params: [], line: i + 1 });
        }
      }
    });
  } else if (ext === 'java') {
    lines.forEach((line, i) => {
      const m = line.match(/(?:public|private|protected)\s+(?:static\s+)?\w[\w<>\[\]]*\s+(\w+)\s*\(([^)]*)\)/);
      if (m && !['main','toString','hashCode','equals'].includes(m[1])) {
        functions.push({
          name: m[1],
          params: m[2].split(',').map(p => p.trim()).filter(Boolean),
          line: i + 1
        });
      }
    });
  }
  
  return functions;
}

// ─── Python Tests ─────────────────────────────────────
function generatePyTests(functions, fileName) {
  const moduleName = fileName.replace('.py', '');
  let out = `import pytest\nfrom ${moduleName} import *\n\n`;
  
  functions.forEach(fn => {
    out += `# ═══ Tests for ${fn.name}() ═══\n`;
    out += `class Test${capitalize(fn.name)}:\n\n`;
    
    // Test 1: Basic call
    out += `    def test_${fn.name}_basic(self):\n`;
    out += `        """${fn.name} يرجع نتيجة صحيحة"""\n`;
    const args = generatePyArgs(fn.params);
    out += `        result = ${fn.name}(${args})\n`;
    out += `        assert result is not None\n\n`;
    
    // Test 2: Edge case - empty
    if (fn.params.length > 0) {
      out += `    def test_${fn.name}_empty(self):\n`;
      out += `        """${fn.name} يتعامل مع قيم فارغة"""\n`;
      out += `        # TODO: أضف منطق الاختبار\n`;
      out += `        pass\n\n`;
    }
    
    // Test 3: Edge case - null
    out += `    def test_${fn.name}_none(self):\n`;
    out += `        """${fn.name} يتعامل مع None"""\n`;
    out += `        # TODO: تحقق من behavior مع None\n`;
    out += `        pass\n\n`;
  });
  
  return out;
}

// ─── JavaScript Tests ─────────────────────────────────
function generateJSTests(functions, fileName) {
  const moduleName = fileName.replace(/\.(js|jsx|ts)$/, '');
  let out = `const { ${functions.map(f => f.name).join(', ')} } = require('./${moduleName}');\n\n`;
  
  functions.forEach(fn => {
    out += `// ═══ Tests for ${fn.name}() ═══\n`;
    out += `describe('${fn.name}', () => {\n\n`;
    
    // Test 1: Basic
    out += `  test('يرجع نتيجة صحيحة', () => {\n`;
    out += `    const result = ${fn.name}();\n`;
    out += `    expect(result).toBeDefined();\n`;
    out += `  });\n\n`;
    
    // Test 2: Null input
    out += `  test('يتعامل مع null', () => {\n`;
    out += `    expect(() => ${fn.name}(null)).not.toThrow();\n`;
    out += `  });\n\n`;
    
    // Test 3: Empty array
    out += `  test('يتعامل مع قيم فارغة', () => {\n`;
    out += `    // TODO: أضف منطق الاختبار\n`;
    out += `  });\n\n`;
    
    out += `});\n\n`;
  });
  
  return out;
}

// ─── Java Tests ───────────────────────────────────────
function generateJavaTests(functions, fileName) {
  const className = fileName.replace('.java', '');
  let out = `import org.junit.jupiter.api.*;\n`;
  out += `import static org.junit.jupiter.api.Assertions.*;\n\n`;
  out += `public class ${className}Test {\n\n`;
  out += `    private ${className} instance;\n\n`;
  out += `    @BeforeEach\n`;
  out += `    void setUp() {\n`;
  out += `        instance = new ${className}();\n`;
  out += `    }\n\n`;
  
  functions.forEach(fn => {
    out += `    // ═══ Tests for ${fn.name}() ═══\n\n`;
    
    // Test 1: Basic
    out += `    @Test\n`;
    out += `    @DisplayName("${fn.name} يرجع نتيجة صحيحة")\n`;
    out += `    void test${capitalize(fn.name)}Basic() {\n`;
    out += `        // TODO: أضف setup\n`;
    out += `        // var result = instance.${fn.name}(...);\n`;
    out += `        // assertNotNull(result);\n`;
    out += `    }\n\n`;
    
    // Test 2: Null
    out += `    @Test\n`;
    out += `    @DisplayName("${fn.name} يتعامل مع null")\n`;
    out += `    void test${capitalize(fn.name)}Null() {\n`;
    out += `        assertThrows(Exception.class, () -> instance.${fn.name}(null));\n`;
    out += `    }\n\n`;
  });
  
  out += `}\n`;
  return out;
}

// ─── Helpers ──────────────────────────────────────────
function capitalize(str) {
  return str.charAt(0).toUpperCase() + str.slice(1);
}

function generatePyArgs(params) {
  return params.map(p => {
    const name = p.split(':')[0].trim().replace('*','').replace('*','');
    if (name === 'self') return null;
    if (name.includes('list') || name.includes('orders') || name.includes('items')) return '[]';
    if (name.includes('str') || name.includes('name') || name.includes('id')) return '"test"';
    if (name.includes('int') || name.includes('num') || name.includes('count')) return '0';
    return 'None';
  }).filter(Boolean).join(', ');
}
