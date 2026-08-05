/**
 * CodeStore — مخزن مؤقت للكود عبر الشاشات
 * يحل مشكلة تمرير الكود الكبير في Navigation params
 * بدلاً من params → AsyncStorage key فقط
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

const KEY_PREFIX = '@reality_engine/';
const CODE_KEY   = `${KEY_PREFIX}temp_code`;
const RESULT_KEY = `${KEY_PREFIX}temp_result`;

// ===== Code Store =====
export async function storeCode(code: string): Promise<void> {
  await AsyncStorage.setItem(CODE_KEY, code);
}

export async function loadCode(): Promise<string> {
  return (await AsyncStorage.getItem(CODE_KEY)) ?? '';
}

export async function clearCode(): Promise<void> {
  await AsyncStorage.removeItem(CODE_KEY);
}

// ===== Scan Result Store (JSON) =====
export async function storeResult<T>(data: T): Promise<void> {
  await AsyncStorage.setItem(RESULT_KEY, JSON.stringify(data));
}

export async function loadResult<T>(): Promise<T | null> {
  const raw = await AsyncStorage.getItem(RESULT_KEY);
  return raw ? (JSON.parse(raw) as T) : null;
}

export async function clearResult(): Promise<void> {
  await AsyncStorage.removeItem(RESULT_KEY);
}

// ===== Clear all temp data =====
export async function clearAll(): Promise<void> {
  await AsyncStorage.multiRemove([CODE_KEY, RESULT_KEY]);
}
