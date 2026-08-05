import React, { useState } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet,
  ActivityIndicator, Alert, Platform,
} from 'react-native';
import { Ionicons }              from '@expo/vector-icons';
import * as DocumentPicker       from 'expo-document-picker';
import * as FileSystem           from 'expo-file-system';
import { colors }                from '../theme/colors';
import { IoniconsName }          from '../types/icons';
import { FileUploadScreenProps } from '../types/navigation';
import { storeCode, clearAll }   from '../utils/CodeStore';
import { checkLegal }            from '../engines/LegalGuard';
import { analyzeFile }           from '../engines/EngineAnalyzer';
import AsyncStorage              from '@react-native-async-storage/async-storage';

const REPORT_KEY = '@reality_engine/engine_report';

export default function FileUploadScreen({ navigation }: FileUploadScreenProps) {
  const [loading,  setLoading]  = useState(false);
  const [fileName, setFileName] = useState<string | null>(null);

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

      const asset   = res.assets[0];
      const content = await FileSystem.readAsStringAsync(asset.uri);

      if (!content.trim()) {
        Alert.alert('الملف فاضي', 'اختر ملف يحتوي على كود.');
        return;
      }

      // Legal check
      const legal = checkLegal(content);
      if (legal.blocked) {
        Alert.alert('ملف محظور ⛔', legal.userMessage);
        return;
      }

      setLoading(true);
      setFileName(asset.name);

      // Store code
      await clearAll();
      await storeCode(content);

      // Deep analysis BEFORE any code generation
      const report = analyzeFile(content, asset.name);
      await AsyncStorage.setItem(REPORT_KEY, JSON.stringify(report));

      // Navigate to preview — let user decide
      navigation.navigate('AnalysisPreview');

    } catch {
      Alert.alert('خطأ', 'تعذّر قراءة الملف.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <View style={styles.container}>
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
        <Text style={styles.headerTitle}>رفع ملف كود</Text>
        <View style={{ width: 34 }} />
      </View>

      <View style={styles.body}>
        {/* Icon */}
        <View style={styles.iconWrap}>
          <Ionicons name={"document-text" as IoniconsName} size={64} color={colors.accent} />
        </View>

        <Text style={styles.title}>ارفع ملف الكود</Text>
        <Text style={styles.subtitle}>
          المحرك يحلل الملف أولاً ويشرح لك وش يقدر يصلح — قبل أي تعديل
        </Text>

        {/* Supported formats */}
        <View style={styles.formatsRow}>
          {['.py', '.js', '.ts', '.txt'].map(ext => (
            <View key={ext} style={styles.formatBadge}>
              <Text style={styles.formatText}>{ext}</Text>
            </View>
          ))}
        </View>

        {/* Upload button */}
        <TouchableOpacity
          style={styles.uploadBtn}
          onPress={() => { void pickFile(); }}
          disabled={loading}
          activeOpacity={0.85}
          accessibilityLabel="اختر ملف للتحليل"
          accessibilityRole="button"
        >
          {loading ? (
            <>
              <ActivityIndicator color="#fff" size="small" />
              <Text style={styles.uploadBtnText}>يتم التحليل…</Text>
            </>
          ) : (
            <>
              <Ionicons name={"cloud-upload-outline" as IoniconsName} size={22} color="#fff" />
              <Text style={styles.uploadBtnText}>اختر ملف</Text>
            </>
          )}
        </TouchableOpacity>

        {fileName && !loading && (
          <Text style={styles.fileName}>📄 {fileName}</Text>
        )}

        {/* Flow explanation */}
        <View style={styles.flowCard}>
          <Text style={styles.flowTitle}>كيف يشتغل المحرك</Text>
          {[
            { icon: 'search-outline',          text: 'يحلل الملف ويكتشف الدوال الناقصة' },
            { icon: 'chatbubble-outline',       text: 'يشرح لك وش لقى ووش يقدر يصلح' },
            { icon: 'checkmark-circle-outline', text: 'أنت تقرر: تكمل أو لا' },
            { icon: 'shield-checkmark-outline', text: 'فحص أمني لكل اقتراح' },
            { icon: 'finger-print-outline',     text: 'موافقتك على كل دالة لوحدها' },
          ].map((step, i) => (
            <View key={i} style={styles.flowStep}>
              <View style={styles.flowNum}>
                <Text style={styles.flowNumText}>{i + 1}</Text>
              </View>
              <Ionicons name={step.icon as IoniconsName} size={16} color={colors.accent} />
              <Text style={styles.flowText}>{step.text}</Text>
            </View>
          ))}
        </View>

        <Text style={styles.hint}>
          الكود يبقى على جهازك — لا يُرسل لأي خادم
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container:    { flex: 1, backgroundColor: colors.bg_primary },
  header:       {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingTop: 12, paddingBottom: 12,
    borderBottomWidth: 1, borderBottomColor: colors.border,
  },
  backBtn:      { padding: 6 },
  headerTitle:  { fontSize: 16, fontWeight: '600', color: colors.text_primary },
  body:         { flex: 1, padding: 24, alignItems: 'center', justifyContent: 'center', gap: 16 },

  iconWrap:     {
    width: 110, height: 110, borderRadius: 28,
    backgroundColor: colors.accent_dim, alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: colors.border,
  },
  title:        { fontSize: 22, fontWeight: '700', color: colors.text_primary, textAlign: 'center' },
  subtitle:     { fontSize: 14, color: colors.text_secondary, textAlign: 'center', lineHeight: 22 },

  formatsRow:   { flexDirection: 'row', gap: 8 },
  formatBadge:  {
    backgroundColor: colors.bg_secondary, paddingHorizontal: 12, paddingVertical: 5,
    borderRadius: 8, borderWidth: 1, borderColor: colors.border,
  },
  formatText:   { fontSize: 12, color: colors.accent, fontWeight: '600' },

  uploadBtn:    {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: colors.accent, paddingHorizontal: 36, paddingVertical: 16,
    borderRadius: 16, width: '100%', justifyContent: 'center',
  },
  uploadBtnText:{ fontSize: 17, fontWeight: '700', color: '#fff' },
  fileName:     { fontSize: 13, color: colors.success, fontWeight: '500' },

  flowCard:     {
    width: '100%', backgroundColor: colors.bg_card, borderRadius: 16,
    padding: 16, gap: 12, borderWidth: 1, borderColor: colors.border,
  },
  flowTitle:    { fontSize: 13, color: colors.text_muted, fontWeight: '600',
                  textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 4 },
  flowStep:     { flexDirection: 'row', alignItems: 'center', gap: 10 },
  flowNum:      {
    width: 22, height: 22, borderRadius: 11, backgroundColor: colors.accent_dim,
    alignItems: 'center', justifyContent: 'center',
  },
  flowNumText:  { fontSize: 11, color: colors.accent, fontWeight: '700' },
  flowText:     { fontSize: 13, color: colors.text_secondary, flex: 1 },

  hint:         { fontSize: 11, color: colors.text_muted, textAlign: 'center' },
});
