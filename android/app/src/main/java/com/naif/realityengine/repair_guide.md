# 🔧 Reality Engine — AI Repair Guide v2.0
# دليل الإصلاح الذكي الشامل

## 📋 قواعد ذهبية قبل أي إصلاح
1. **اقرأ الكود كاملاً أولاً** — افهم السياق قبل التعديل
2. **صلح المشكلة المحددة فقط** — لا تغير باقي الكود
3. **احفظ نفس indentation** — Python حساس جداً
4. **لا تحذف كود موجود** — بدّله فقط
5. **لا تضف imports** إلا لو ضرورية وغير موجودة
6. **لو ما تعرف** — لا تصلح أفضل من خطأ جديد
7. **التعليقات في Python = #** — ممنوع // في Python
8. **ممنوع TODO أو placeholder** — كود حقيقي فقط
9. **ممنوع تغيير أسماء المتغيرات** — استخدم نفس الأسماء
10. **ممنوع تغيير أكثر من 5 أسطر** في كل مشكلة

---

## 🔴 CRITICAL — Command Injection

### Python — os.system (الأكثر شيوعاً)
```python
# ❌ خطر — تنفيذ أوامر مباشر
os.system("ping " + user_input)
os.system(cmd)
os.system("ls " + path)

# ✅ آمن — subprocess مع shlex
import subprocess
import shlex
subprocess.run(shlex.split("ping " + user_input), check=True, capture_output=True)
subprocess.run(shlex.split(cmd), check=True, capture_output=True)
subprocess.run(["ls", path], check=True, capture_output=True)
```

### Python — subprocess.call بـ shell=True
```python
# ❌ خطر
subprocess.call(cmd, shell=True)

# ✅ آمن
subprocess.run(shlex.split(cmd), check=True)
```

### PHP — exec/system
```php
// ❌ خطر
exec("ping " . $_GET['host']);
system($user_cmd);

// ✅ آمن
$safe = escapeshellarg($_GET['host']);
exec("ping " . $safe);
```

---

## 🔴 CRITICAL — SQL Injection

### Python — sqlite3 (simple)
```python
# ❌ خطر
query = "SELECT * FROM users WHERE id=" + user_id
cursor = conn.execute(query)

# ✅ آمن
query = "SELECT * FROM users WHERE id=?"
cursor = conn.cursor()
cursor.execute(query, (user_id,))
return cursor.fetchall()
```

### Python — sqlite3 (multiple params)
```python
# ❌ خطر
query = "SELECT * FROM users WHERE username='" + username + "' AND password='" + password + "'"

# ✅ آمن
query = "SELECT * FROM users WHERE username=? AND password=?"
cursor = conn.cursor()
cursor.execute(query, (username, password))
return cursor.fetchone()
```

### Python — SQLAlchemy
```python
# ❌ خطر
db.execute("SELECT * FROM users WHERE id=" + user_id)

# ✅ آمن
db.execute(text("SELECT * FROM users WHERE id=:id"), {"id": user_id})
```

### JavaScript — MySQL/PostgreSQL
```javascript
// ❌ خطر
db.query("SELECT * FROM users WHERE id=" + userId)
connection.query("SELECT * FROM users WHERE name='" + name + "'")

// ✅ آمن
db.query("SELECT * FROM users WHERE id=?", [userId])
connection.query("SELECT * FROM users WHERE name=?", [name])
```

### PHP — MySQLi
```php
// ❌ خطر
$query = "SELECT * FROM users WHERE id=" . $id;
$query = "SELECT * FROM users WHERE name='" . $_GET['name'] . "'";

// ✅ آمن
$stmt = $conn->prepare("SELECT * FROM users WHERE id=?");
$stmt->bind_param("i", $id);
$stmt->execute();
$result = $stmt->get_result();

// أو مع string
$stmt = $conn->prepare("SELECT * FROM users WHERE name=?");
$stmt->bind_param("s", $_GET['name']);
$stmt->execute();
```

### PHP — PDO
```php
// ❌ خطر
$pdo->query("SELECT * FROM users WHERE id=" . $id);

// ✅ آمن
$stmt = $pdo->prepare("SELECT * FROM users WHERE id=?");
$stmt->execute([$id]);
$result = $stmt->fetchAll();
```

### C# — SqlCommand
```csharp
// ❌ خطر
string query = "SELECT * FROM users WHERE id=" + userId;
SqlCommand cmd = new SqlCommand(query, conn);

// ✅ آمن
SqlCommand cmd = new SqlCommand("SELECT * FROM users WHERE id=@id", conn);
cmd.Parameters.AddWithValue("@id", userId);
SqlDataReader reader = cmd.ExecuteReader();
```

---

## 🔴 CRITICAL — XSS (Cross-Site Scripting)

### JavaScript
```javascript
// ❌ خطر
element.innerHTML = userInput;
document.getElementById('div').innerHTML = data.username;

// ✅ آمن
element.textContent = userInput;
document.getElementById('div').textContent = data.username;
// لو تحتاج HTML حقيقي:
element.innerHTML = DOMPurify.sanitize(userInput);
```

### PHP
```php
// ❌ خطر
echo $_GET['name'];
echo $username;

// ✅ آمن
echo htmlspecialchars($_GET['name'], ENT_QUOTES, 'UTF-8');
echo htmlspecialchars($username, ENT_QUOTES, 'UTF-8');
```

---

## 🔴 CRITICAL — eval() Dangerous

### JavaScript
```javascript
// ❌ خطر
eval(userInput);
eval(code);
new Function(userInput)();

// ✅ آمن — لو JSON
JSON.parse(userInput);
// ✅ آمن — لو expressions محدودة
// استخدم library آمنة مثل math.js
import { evaluate } from 'mathjs';
evaluate(userInput);
```

### Python
```python
# ❌ خطر
eval(user_input)
eval(data["formula"])
exec(code)

# ✅ آمن — لو literals فقط
import ast
ast.literal_eval(user_input)
# ✅ آمن — لو math expressions
import numexpr
numexpr.evaluate(formula)
```

---

## 🟠 HIGH — Weak Cryptography

### Python — MD5/SHA1
```python
# ❌ ضعيف
hashlib.md5(data.encode()).hexdigest()
hashlib.sha1(password.encode()).hexdigest()

# ✅ قوي — للبيانات العامة
hashlib.sha256(data.encode()).hexdigest()
# ✅ أقوى — للكلمات المرور
import bcrypt
bcrypt.hashpw(password.encode(), bcrypt.gensalt())
```

### JavaScript
```javascript
// ❌ ضعيف
crypto.createHash('md5').update(data).digest('hex')
crypto.createHash('sha1').update(password).digest('hex')

// ✅ قوي
crypto.createHash('sha256').update(data).digest('hex')
// للكلمات المرور:
const bcrypt = require('bcrypt');
await bcrypt.hash(password, 12);
```

### PHP
```php
// ❌ ضعيف
md5($password)
sha1($data)

// ✅ للكلمات المرور
password_hash($password, PASSWORD_BCRYPT, ['cost' => 12])
// ✅ للبيانات
hash('sha256', $data)
```

### C# / Unity
```csharp
// ❌ ضعيف
MD5.Create()
new MD5CryptoServiceProvider()

// ✅ قوي
SHA256.Create()
new SHA256Managed()
```

### Java / Android
```java
// ❌ ضعيف
MessageDigest.getInstance("MD5")
MessageDigest.getInstance("SHA-1")

// ✅ قوي
MessageDigest.getInstance("SHA-256")
MessageDigest.getInstance("SHA-512")
```

---

## 🟠 HIGH — Hardcoded Secrets & API Keys

### JavaScript / TypeScript / Node.js
```javascript
// ❌ مكشوف
const API_KEY = "sk_live_abc123def456ghi789";
const JWT_SECRET = "mysecretkey123";
const DB_PASSWORD = "admin1234";
const STRIPE_KEY = "sk_live_xyz789";

// ✅ آمن
const API_KEY = process.env.API_KEY;
const JWT_SECRET = process.env.JWT_SECRET;
const DB_PASSWORD = process.env.DB_PASSWORD;
const STRIPE_KEY = process.env.STRIPE_KEY;
// .env file: API_KEY=your_actual_key_here
```

### Python
```python
# ❌ مكشوف
API_KEY = "sk-ant-api03-abc123def456"
SECRET_KEY = "super_secret_jwt_key_2024"
AWS_KEY = "AKIAIOSFODNN7EXAMPLE"
DB_URL = "postgresql://admin:password123@localhost/mydb"

# ✅ آمن
import os
API_KEY = os.environ.get('API_KEY', '')
SECRET_KEY = os.environ.get('SECRET_KEY', '')
AWS_KEY = os.environ.get('AWS_ACCESS_KEY_ID', '')
DB_URL = os.environ.get('DATABASE_URL', '')
# .env file: API_KEY=your_actual_key_here
```

### PHP
```php
// ❌ مكشوف
define('API_SECRET', 'my_api_secret_key_2024');
$db_pass = 'admin123';

// ✅ آمن
define('API_SECRET', getenv('API_SECRET'));
$db_pass = getenv('DB_PASSWORD');
// أو استخدم .env مع vlucas/phpdotenv
```

### C# / Unity
```csharp
// ❌ مكشوف
private string apiKey = "sk_live_abc123";
private string dbPass = "admin123";

// ✅ آمن
private string apiKey = Environment.GetEnvironmentVariable("API_KEY");
private string dbPass = Environment.GetEnvironmentVariable("DB_PASSWORD");
```

### Java / Android
```java
// ❌ مكشوف
String API_KEY = "sk_live_abc123";

// ✅ آمن — Android
String API_KEY = BuildConfig.API_KEY; // في gradle.properties
// أو من Keystore
```

---

## 🟠 HIGH — JWT Weak Secret

```javascript
// ❌ خطر
jwt.sign(payload, "mysecretkey123");
jwt.sign(payload, "secret");
jwt.sign(payload, "password");

// ✅ آمن — secret قوي من env
jwt.sign(payload, process.env.JWT_SECRET, { 
    expiresIn: '1h',
    algorithm: 'HS256'
});
// JWT_SECRET يجب أن يكون 256+ bit random string
```

---

## 🟡 MEDIUM — TypeScript any Type

```typescript
// ❌ خطر — any يلغي type safety
let userData: any = null;
var userScore: any = 0;
function process(data: any) {}
const result: any = await fetch(url);

// ✅ آمن — استخدم types محددة
let userData: UserData | null = null;    // لو تعرف الـ type
let userData: Record<string, unknown> | null = null;  // لو ما تعرف
let userScore: number = 0;
function process(data: unknown) {}       // unknown أفضل من any
const result: Response = await fetch(url);

// Interface للـ objects
interface UserData {
    id: number;
    username: string;
    email: string;
}
```

---

## 🟡 MEDIUM — Optional Chaining

```typescript
// ❌ crash لو قيمة null/undefined
const name = user.profile.name;
const city = user.address.city.name;
document.getElementById('btn').addEventListener('click', fn);

// ✅ آمن مع optional chaining
const name = user?.profile?.name ?? 'Unknown';
const city = user?.address?.city?.name ?? 'Unknown';
document.getElementById('btn')?.addEventListener('click', fn);
```

---

## 🟡 MEDIUM — Empty Catch Blocks

```javascript
// ❌ أخطاء مخفية
try {
    doSomething();
} catch (e) {}

// ✅ سجّل الخطأ دائماً
try {
    doSomething();
} catch (error) {
    console.error('Error in doSomething:', error);
    // أو throw error; لو تريد propagate
}
```

```python
# ❌ أخطاء مخفية
try:
    do_something()
except:
    pass

# ✅ سجّل الخطأ
try:
    do_something()
except Exception as e:
    logging.error("Error: %s", str(e))
```

---

## 🔵 LOW — var في JavaScript

```javascript
// ❌ قديم ومشاكل scope
var count = 0;
var name = "test";

// ✅ حديث
let count = 0;       // لو ستتغير
const name = "test"; // لو لن تتغير
```

---

## 🔵 LOW — HTTP بدل HTTPS

```javascript
// ❌ غير آمن
fetch("http://api.example.com/data")
axios.get("http://api.example.com/user")

// ✅ آمن
fetch("https://api.example.com/data")
axios.get("https://api.example.com/user")
```

---

## 🔵 LOW — Accumulation Bug

```python
# ❌ خطأ — يعيد تعيين بدل التراكم
total = 0
for item in items:
    total = item["price"]  # يضيع الأرقام السابقة!

# ✅ صح — يتراكم
total = 0
for item in items:
    total += item["price"]
```

```javascript
// ❌ خطأ
let total = 0;
items.forEach(item => {
    total = item.price; // خطأ!
});

// ✅ صح
let total = 0;
items.forEach(item => {
    total += item.price;
});
```

---

## 🔵 LOW — None/Null Comparison

```python
# ❌ خطأ
if value == None:
    return False

# ✅ صح
if value is None:
    return False
if value is not None:
    process(value)
```

---

## ⚡ Unity / C# خاص

### Performance Issues
```csharp
// ❌ بطيء — في كل frame
void Update() {
    Rigidbody rb = GetComponent<Rigidbody>();
    Player p = FindObjectOfType<Player>();
    Instantiate(prefab, pos, rot);
}

// ✅ سريع — Cache في Start
private Rigidbody _rb;
private Player _player;
private ObjectPool _pool;

void Start() {
    _rb = GetComponent<Rigidbody>();
    _player = FindObjectOfType<Player>();
}

void Update() {
    // استخدم _rb و _player المحفوظين
    // استخدم Object Pool بدل Instantiate
}
```

### Debug.Log في Production
```csharp
// ❌ أبطأ في production
Debug.Log("Score: " + score);

// ✅ فقط في Editor
#if UNITY_EDITOR
Debug.Log("Score: " + score);
#endif
```

---

## 🌐 Dart / Flutter خاص

### setState بعد async
```dart
// ❌ crash لو Widget disposed
void fetchData() async {
    await Future.delayed(Duration(seconds: 1));
    setState(() { _data = 'loaded'; }); // crash!
}

// ✅ آمن
void fetchData() async {
    await Future.delayed(Duration(seconds: 1));
    if (mounted) {
        setState(() { _data = 'loaded'; });
    }
}
```

### StreamSubscription Memory Leak
```dart
// ❌ memory leak
StreamSubscription sub = stream.listen((_) {});

// ✅ cancel في dispose
StreamSubscription? _sub;

void initState() {
    _sub = stream.listen((_) {});
}

void dispose() {
    _sub?.cancel();
    super.dispose();
}
```

---

## 🔒 قائمة Regex للكشف السريع

```
SQL Injection:    ["']\s*\+\s*\w+  أو  \.\s*\$\w+  مع SELECT/INSERT
XSS:             innerHTML\s*=  أو  echo\s+\$_(GET|POST)
eval():          \beval\s*\(
os.system:       os\.system\s*\(
Hardcoded:       (API_KEY|SECRET|PASSWORD)\s*=\s*["'][^"']{6,}["']
MD5:             hashlib\.md5\(  أو  md5\s*\(  أو  createHash\(['"]md5
HTTP:            http://  (بدون s)
var:             \bvar\s+\w+
== None:         ==\s*None
Accumulation:    \w+\s*=\s*\w+\["  داخل loop
```

---

## 📊 مستويات الثقة في الإصلاح

| الثقة | متى تصلح |
|-------|----------|
| 95%+  | SQL parameterized, XSS textContent, HTTPS |
| 85%+  | subprocess بدل os.system, SHA256 بدل MD5 |
| 75%+  | env vars بدل hardcoded secrets |
| 60%+  | TypeScript types, Optional chaining |
| <60%  | لا تصلح — اترك للمطور |

---

## 🚫 ممنوع مطلقاً
- حذف دوال كاملة أو functions
- تغيير logic الكود
- إضافة كود غير مطلوب
- تغيير أسماء المتغيرات أو الدوال
- إضافة TODO/placeholder/pass فقط
- استخدام // في Python
- تغيير أكثر من 5 أسطر في كل مشكلة
- إضافة imports غير ضرورية
- تغيير indentation اللغة
