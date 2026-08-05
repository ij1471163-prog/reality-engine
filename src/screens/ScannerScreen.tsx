import React, { useState, useCallback } from 'react';
import {
  View, Text, TextInput, TouchableOpacity,
  StyleSheet, ScrollView, ActivityIndicator,
  KeyboardAvoidingView, Platform, Alert,
} from 'react-native';
import { Ionicons }            from '@expo/vector-icons';
import * as Clipboard          from 'expo-clipboard';
import * as DocumentPicker     from 'expo-document-picker';
import * as FileSystem         from 'expo-file-system';
import { colors }              from '../theme/colors';
import { IoniconsName }        from '../types/icons';
import { checkLegal }          from '../engines/LegalGuard';
import { storeCode, storeResult, clearAll } from '../utils/CodeStore';
import { scanCode }            from '../utils/securityScanner';
import { detectStubs }         from '../utils/stubDetector';
import { ScannerScreenProps }  from '../types/navigation';

interface ModeMeta { label: string; color: string; icon: IoniconsName; }
const MODE_META: Record<'security' | 'stubs' | 'full', ModeMeta> = {
  security: { label: 'Security Scanner', color: colors.success, icon: 'shield-checkmark' as IoniconsName },
  stubs:    { label: 'Stub Detector',    color: colors.purple,  icon: 'code-slash' as IoniconsName },
  full:     { label: 'Full Analysis',    color: colors.warning, icon: 'flash' as IoniconsName },
};

export default function ScannerScreen({ navigation, route }: ScannerScreenProps) {
  const mode = route.params?.mode ?? 'full';
  const meta = MODE_META[mode];
  const [code,    setCode]    = useState('');
  const [loading, setLoading] = useState(false);

  const runScan = useCallback(async () => {
    if (!code.trim()) {
      Alert.alert('تنبيه', 'الصق كودك أولاً في المربع');
      return;
    }

    // ── Legal check ──────────────────────────────────────────────
    const legal = checkLegal(code);
    if (legal.blocked) {
      Alert.alert('طلب محظور ⛔', legal.userMessage);
      return;
    }

    setLoading(true);
    try {
      // Fix: store code in AsyncStorage instead of passing in params
      await clearAll();
      await storeCode(code);

      // Run analysis
      const secResult  = (mode === 'security' || mode === 'full') ? scanCode(code)    : null;
      const stubResult = (mode === 'stubs'    || mode === 'full') ? detectStubs(code) : null;

      // Store result (not passed in params)
      await storeResult({ secResult, stubResult });

      // Navigate with only mode — no code in params
      navigation.navigate('Results', { mode });
    } catch {
      Alert.alert('خطأ في التحليل', 'تعذّر فحص الكود. تحقق من صحة الصياغة.');
    } finally {
      setLoading(false);
    }
  }, [code, mode, navigation]);

  const pasteFromClipboard = async () => {
    const text = await Clipboard.getStringAsync();
    if (text) setCode(text);
    else Alert.alert('الحافظة فاضية', 'انسخ الكود أولاً ثم ألصق');
  };

  const pickFile = async () => {
    try {
      const res = await DocumentPicker.getDocumentAsync({
        type: [
          'text/plain',
          'text/x-python',
          'text/x-python-script',
          'text/javascript',
          'text/typescript',
          'application/octet-stream',
        ],
        copyToCacheDirectory: true,
      });
      if (res.canceled || !res.assets?.length) return;
      const content = await FileSystem.readAsStringAsync(res.assets[0].uri);
      setCode(content);
    } catch {
      Alert.alert('خطأ', 'تعذّر قراءة الملف');
    }
  };

  const charCount = code.length;
  const lineCount = code ? code.split('\n').length : 0;

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity
          onPress={() => navigation.goBack()}
          style={styles.backBtn}
          accessibilityLabel="رجوع"
          accessibilityRole="button"
        >
          <Ionicons name={"arrow-back" as IoniconsName} size={22} color={colors.text_primary} />
        </TouchableOpacity>
        <View style={[styles.modeBadge, { backgroundColor: meta.color + '22' }]}>
          <Ionicons name={meta.icon} size={14} color={meta.color} />
          <Text style={[styles.modeLabel, { color: meta.color }]}>{meta.label}</Text>
        </View>
      </View>

      <ScrollView
        contentContainerStyle={styles.scroll}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {/* Action buttons */}
        <View style={styles.btnRow}>
          <TouchableOpacity
            style={styles.actionBtn}
            onPress={() => { void pasteFromClipboard(); }}
            accessibilityLabel="لصق من الحافظة"
            accessibilityRole="button"
          >
            <Ionicons name={"clipboard-outline" as IoniconsName} size={16} color={colors.accent} />
            <Text style={styles.actionBtnText}>لصق</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.actionBtn}
            onPress={() => { void pickFile(); }}
            accessibilityLabel="رفع ملف كود"
            accessibilityRole="button"
          >
            <Ionicons name={"document-outline" as IoniconsName} size={16} color={colors.accent} />
            <Text style={styles.actionBtnText}>رفع ملف</Text>
          </TouchableOpacity>

          {code.length > 0 && (
            <TouchableOpacity
              style={styles.actionBtn}
              onPress={() => setCode('')}
              accessibilityLabel="مسح الكود"
              accessibilityRole="button"
            >
              <Ionicons name={"trash-outline" as IoniconsName} size={16} color={colors.danger} />
              <Text style={[styles.actionBtnText, { color: colors.danger }]}>مسح</Text>
            </TouchableOpacity>
          )}
        </View>

        {/* Code input */}
        <View style={styles.inputContainer}>
          <TextInput
            style={styles.codeInput}
            value={code}
            onChangeText={setCode}
            placeholder={'# الصق أو اكتب الكود هنا...\ndef my_function():\n    pass'}
            placeholderTextColor={colors.text_muted}
            multiline
            textAlignVertical="top"
            autoCorrect={false}
            autoCapitalize="none"
            spellCheck={false}
            accessibilityLabel="مدخل الكود"
            accessibilityHint="الصق كودك هنا للتحليل"
          />
          {code.length > 0 && (
            <View style={styles.codeStats}>
              <Text style={styles.codeStat}>{lineCount} سطر</Text>
              <Text style={styles.codeStat}>•</Text>
              <Text style={styles.codeStat}>{charCount.toLocaleString()} حرف</Text>
              {charCount > 100_000 && (
                <Text style={[styles.codeStat, { color: colors.warning }]}>
                  ⚠️ ملف كبير
                </Text>
              )}
            </View>
          )}
        </View>

        {/* Scan button */}
        <TouchableOpacity
          style={[styles.scanBtn, { backgroundColor: meta.color }, loading && styles.scanBtnDisabled]}
          onPress={() => { void runScan(); }}
          disabled={loading}
          activeOpacity={0.85}
          accessibilityLabel="ابدأ التحليل"
          accessibilityRole="button"
          accessibilityState={{ disabled: loading }}
        >
          {loading ? (
            <ActivityIndicator color="#fff" size="small" />
          ) : (
            <>
              <Ionicons name={"scan-outline" as IoniconsName} size={20} color="#fff" />
              <Text style={styles.scanBtnText}>ابدأ التحليل</Text>
            </>
          )}
        </TouchableOpacity>

        <Text style={styles.hint}>
          الكود يُعالج محلياً — لا يُرسل لأي خادم
        </Text>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container:       { flex: 1, backgroundColor: colors.bg_primary },
  scroll:          { padding: 20, paddingBottom: 40 },
  header:          {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingTop: 12, paddingBottom: 8,
    borderBottomWidth: 1, borderBottomColor: colors.border,
  },
  backBtn:         { padding: 6 },
  modeBadge:       {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20,
  },
  modeLabel:       { fontSize: 13, fontWeight: '600' },
  btnRow:          { flexDirection: 'row', gap: 10, marginBottom: 14 },
  actionBtn:       {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: colors.bg_secondary, paddingHorizontal: 14, paddingVertical: 9,
    borderRadius: 10, borderWidth: 1, borderColor: colors.border,
  },
  actionBtnText:   { fontSize: 13, color: colors.accent, fontWeight: '500' },
  inputContainer:  {
    backgroundColor: colors.bg_input, borderRadius: 14,
    borderWidth: 1, borderColor: colors.border, marginBottom: 16, overflow: 'hidden',
  },
  codeInput:       {
    minHeight: 260, padding: 16, fontSize: 13, color: colors.text_primary,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace', lineHeight: 22,
  },
  codeStats:       {
    flexDirection: 'row', gap: 8, padding: 10, paddingTop: 0,
    borderTopWidth: 1, borderTopColor: colors.border,
  },
  codeStat:        { fontSize: 11, color: colors.text_muted },
  scanBtn:         {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 10, borderRadius: 14, paddingVertical: 16, marginBottom: 14,
  },
  scanBtnDisabled: { opacity: 0.6 },
  scanBtnText:     { fontSize: 16, fontWeight: '700', color: '#fff' },
  hint:            { textAlign: 'center', fontSize: 11, color: colors.text_muted },
});
