import React, { useState, useEffect } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet,
  ScrollView, ActivityIndicator, Platform,
} from 'react-native';
import { Ionicons }                   from '@expo/vector-icons';
import AsyncStorage                   from '@react-native-async-storage/async-storage';
import { colors }                     from '../theme/colors';
import { IoniconsName }               from '../types/icons';
import { AnalysisPreviewScreenProps } from '../types/navigation';
import { EngineReport, FunctionAnalysis, FixabilityLevel } from '../engines/EngineAnalyzer';

const REPORT_KEY = '@reality_engine/engine_report';

// ── Fixability colors ──────────────────────────────────────
const FIX_COLOR: Record<FixabilityLevel, string> = {
  high:    colors.success,
  medium:  colors.warning,
  low:     colors.danger,
  unknown: colors.text_muted,
};

const FIX_LABEL: Record<FixabilityLevel, string> = {
  high:    'يقدر يصلحها ✓',
  medium:  'يحاول — راجع ⚠️',
  low:     'صعب — تدخل يدوي ✗',
  unknown: 'غير محدد',
};

const FIX_ICON: Record<FixabilityLevel, string> = {
  high:    'checkmark-circle',
  medium:  'alert-circle',
  low:     'close-circle',
  unknown: 'help-circle',
};

// ── Summary Bar ────────────────────────────────────────────
function SummaryBar({ report }: { report: EngineReport }) {
  const total = report.stubFunctions.length;
  if (total === 0) return null;

  return (
    <View style={sb.container}>
      <View style={[sb.segment, { flex: report.highFixable,
        backgroundColor: colors.success }]} />
      <View style={[sb.segment, { flex: report.mediumFixable,
        backgroundColor: colors.warning }]} />
      <View style={[sb.segment, { flex: report.lowFixable,
        backgroundColor: colors.danger }]} />
    </View>
  );
}
const sb = StyleSheet.create({
  container: { flexDirection: 'row', height: 6, borderRadius: 3,
               overflow: 'hidden', backgroundColor: colors.bg_input },
  segment:   { height: '100%' },
});

// ── Function Card ──────────────────────────────────────────
function FunctionCard({ fn }: { fn: FunctionAnalysis }) {
  const [expanded, setExpanded] = useState(false);
  const color = FIX_COLOR[fn.fixability];

  return (
    <TouchableOpacity
      style={[fc.card, { borderLeftColor: color }]}
      onPress={() => setExpanded(e => !e)}
      activeOpacity={0.85}
      accessibilityRole="button"
      accessibilityLabel={`دالة ${fn.name} — ${FIX_LABEL[fn.fixability]}`}
    >
      {/* Header */}
      <View style={fc.header}>
        <Ionicons
          name={FIX_ICON[fn.fixability] as IoniconsName}
          size={18} color={color}
        />
        <View style={{ flex: 1 }}>
          <Text style={fc.name}>{fn.name}()</Text>
          <Text style={fc.meta}>سطر {fn.line} • {fn.intent}</Text>
        </View>
        <View style={[fc.badge, { backgroundColor: color + '22' }]}>
          <Text style={[fc.badgeText, { color }]}>
            {FIX_LABEL[fn.fixability]}
          </Text>
        </View>
        <Ionicons
          name={(expanded ? 'chevron-up' : 'chevron-down') as IoniconsName}
          size={14} color={colors.text_muted}
        />
      </View>

      {/* Expanded */}
      {expanded && (
        <View style={fc.body}>
          {/* Why this fixability */}
          <View style={[fc.reasonBox, { backgroundColor: color + '11',
                                        borderColor: color + '33' }]}>
            <Text style={[fc.reasonLabel, { color }]}>رأي المحرك</Text>
            <Text style={[fc.reasonText, { color }]}>{fn.fixReason}</Text>
          </View>

          {/* Signals */}
          {fn.signals.length > 0 && (
            <View style={fc.signalsBox}>
              <Text style={fc.signalsLabel}>إشارات السياق</Text>
              {fn.signals.map((sig, i) => (
                <Text key={i} style={fc.signal}>• {sig}</Text>
              ))}
            </View>
          )}

          {/* Warning note */}
          {fn.warningNote && (
            <View style={fc.warnBox}>
              <Ionicons name={"warning" as IoniconsName} size={13} color={colors.warning} />
              <Text style={fc.warnText}>{fn.warningNote}</Text>
            </View>
          )}
        </View>
      )}
    </TouchableOpacity>
  );
}
const fc = StyleSheet.create({
  card:        { backgroundColor: colors.bg_card, borderRadius: 12, padding: 14,
                 marginBottom: 10, borderWidth: 1, borderColor: colors.border,
                 borderLeftWidth: 3 },
  header:      { flexDirection: 'row', alignItems: 'center', gap: 10 },
  name:        { fontSize: 14, fontWeight: '700', color: colors.text_primary,
                 fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace' },
  meta:        { fontSize: 11, color: colors.text_muted, marginTop: 2 },
  badge:       { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8 },
  badgeText:   { fontSize: 10, fontWeight: '700' },
  body:        { marginTop: 12, gap: 8 },
  reasonBox:   { borderRadius: 8, padding: 10, borderWidth: 1 },
  reasonLabel: { fontSize: 10, fontWeight: '700', textTransform: 'uppercase', marginBottom: 4 },
  reasonText:  { fontSize: 12, lineHeight: 18 },
  signalsBox:  { gap: 4 },
  signalsLabel:{ fontSize: 10, color: colors.text_muted, textTransform: 'uppercase', marginBottom: 2 },
  signal:      { fontSize: 12, color: colors.text_secondary },
  warnBox:     { flexDirection: 'row', gap: 6, backgroundColor: colors.warning + '11',
                 borderRadius: 8, padding: 10, borderWidth: 1,
                 borderColor: colors.warning + '33', alignItems: 'flex-start' },
  warnText:    { flex: 1, fontSize: 12, color: colors.warning, lineHeight: 18 },
});

// ── Main Screen ────────────────────────────────────────────
export default function AnalysisPreviewScreen({ navigation }: AnalysisPreviewScreenProps) {
  const [report,  setReport]  = useState<EngineReport | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    void (async () => {
      const raw = await AsyncStorage.getItem(REPORT_KEY);
      setReport(raw ? (JSON.parse(raw) as EngineReport) : null);
      setLoading(false);
    })();
  }, []);

  if (loading) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator color={colors.accent} size="large" />
        <Text style={styles.loadingText}>المحرك يحلل الملف…</Text>
      </View>
    );
  }

  if (!report) {
    return (
      <View style={styles.loading}>
        <Text style={styles.loadingText}>لا يوجد تقرير — ارفع ملف أولاً</Text>
      </View>
    );
  }

  const hasStubs   = report.stubFunctions.length > 0;
  const canProceed = report.highFixable > 0 || report.mediumFixable > 0;

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity
          onPress={() => navigation.goBack()}
          style={styles.backBtn}
          accessibilityRole="button"
          accessibilityLabel="رجوع"
        >
          <Ionicons name={"arrow-back" as IoniconsName} size={22} color={colors.text_primary} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>تقرير المحرك</Text>
        <View style={{ width: 34 }} />
      </View>

      <ScrollView
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
      >
        {/* File info */}
        <View style={styles.fileCard}>
          <Ionicons name={"document-text" as IoniconsName} size={20} color={colors.accent} />
          <View style={{ flex: 1 }}>
            <Text style={styles.fileName}>{report.fileName}</Text>
            <Text style={styles.fileMeta}>
              {report.totalLines} سطر  •  {report.totalFunctions} دالة  •  {report.language}
            </Text>
          </View>
        </View>

        {/* Engine message */}
        <View style={styles.messageCard}>
          <View style={styles.messageHeader}>
            <Ionicons name={"analytics" as IoniconsName} size={18} color={colors.accent} />
            <Text style={styles.messageTitle}>ماذا وجد المحرك</Text>
          </View>
          <Text style={styles.messageText}>{report.engineMessage}</Text>
        </View>

        {/* Summary stats */}
        {hasStubs && (
          <View style={styles.statsCard}>
            <SummaryBar report={report} />
            <View style={styles.statsRow}>
              <View style={styles.statItem}>
                <Text style={[styles.statNum, { color: colors.success }]}>
                  {report.highFixable}
                </Text>
                <Text style={styles.statLabel}>واضح ✓</Text>
              </View>
              <View style={styles.statItem}>
                <Text style={[styles.statNum, { color: colors.warning }]}>
                  {report.mediumFixable}
                </Text>
                <Text style={styles.statLabel}>راجع ⚠️</Text>
              </View>
              <View style={styles.statItem}>
                <Text style={[styles.statNum, { color: colors.danger }]}>
                  {report.lowFixable}
                </Text>
                <Text style={styles.statLabel}>صعب ✗</Text>
              </View>
              <View style={styles.statItem}>
                <Text style={[styles.statNum, { color: colors.accent }]}>
                  {report.stubFunctions.length}
                </Text>
                <Text style={styles.statLabel}>المجموع</Text>
              </View>
            </View>
          </View>
        )}

        {/* Recommendation */}
        <View style={styles.recCard}>
          <Ionicons name={"bulb-outline" as IoniconsName} size={16} color={colors.warning} />
          <Text style={styles.recText}>{report.recommendation}</Text>
        </View>

        {/* Function list */}
        {hasStubs && (
          <>
            <Text style={styles.sectionTitle}>
              الدوال الناقصة ({report.stubFunctions.length})
            </Text>
            {report.stubFunctions.map((fn, i) => (
              <FunctionCard key={`${fn.name}-${i}`} fn={fn} />
            ))}
          </>
        )}

        {/* Actions */}
        <View style={styles.actions}>
          {canProceed ? (
            <>
              <TouchableOpacity
                style={styles.proceedBtn}
                onPress={() => navigation.navigate('Approval', { mode: 'fix' })}
                accessibilityRole="button"
                accessibilityLabel="ابدأ الإصلاح"
              >
                <Ionicons name={"flash" as IoniconsName} size={20} color="#fff" />
                <Text style={styles.proceedText}>ابدأ الإصلاح</Text>
                <Text style={styles.proceedSub}>
                  {report.highFixable + report.mediumFixable} دالة
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.cancelBtn}
                onPress={() => navigation.navigate('FileUpload')}
                accessibilityRole="button"
                accessibilityLabel="إلغاء"
              >
                <Text style={styles.cancelText}>إلغاء — ارفع ملف آخر</Text>
              </TouchableOpacity>
            </>
          ) : (
            <>
              <View style={styles.noFixBox}>
                <Ionicons name={"information-circle" as IoniconsName} size={20} color={colors.text_muted} />
                <Text style={styles.noFixText}>
                  {hasStubs
                    ? 'الدوال الموجودة صعبة على المحرك — تحتاج تدخل يدوي'
                    : 'الملف مكتمل — لا توجد دوال ناقصة'}
                </Text>
              </View>
              <TouchableOpacity
                style={styles.cancelBtn}
                onPress={() => navigation.navigate('FileUpload')}
                accessibilityRole="button"
                accessibilityLabel="ارفع ملف آخر"
              >
                <Text style={styles.cancelText}>ارفع ملف آخر</Text>
              </TouchableOpacity>
            </>
          )}
        </View>

      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container:    { flex: 1, backgroundColor: colors.bg_primary },
  loading:      { flex: 1, justifyContent: 'center', alignItems: 'center',
                  backgroundColor: colors.bg_primary, gap: 12 },
  loadingText:  { fontSize: 14, color: colors.text_secondary },
  scroll:       { padding: 16, paddingBottom: 48 },

  header:       { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
                  paddingHorizontal: 16, paddingTop: 12, paddingBottom: 12,
                  borderBottomWidth: 1, borderBottomColor: colors.border },
  backBtn:      { padding: 6 },
  headerTitle:  { fontSize: 16, fontWeight: '600', color: colors.text_primary },

  fileCard:     { flexDirection: 'row', alignItems: 'center', gap: 12,
                  backgroundColor: colors.bg_card, borderRadius: 12, padding: 14,
                  marginBottom: 12, borderWidth: 1, borderColor: colors.border },
  fileName:     { fontSize: 14, fontWeight: '600', color: colors.text_primary },
  fileMeta:     { fontSize: 11, color: colors.text_muted, marginTop: 2 },

  messageCard:  { backgroundColor: colors.bg_secondary, borderRadius: 14, padding: 16,
                  marginBottom: 12, borderWidth: 1, borderColor: colors.border, gap: 8 },
  messageHeader:{ flexDirection: 'row', alignItems: 'center', gap: 8 },
  messageTitle: { fontSize: 13, fontWeight: '600', color: colors.accent },
  messageText:  { fontSize: 13, color: colors.text_primary, lineHeight: 22 },

  statsCard:    { backgroundColor: colors.bg_card, borderRadius: 12, padding: 14,
                  marginBottom: 12, borderWidth: 1, borderColor: colors.border, gap: 10 },
  statsRow:     { flexDirection: 'row' },
  statItem:     { flex: 1, alignItems: 'center' },
  statNum:      { fontSize: 26, fontWeight: '800' },
  statLabel:    { fontSize: 10, color: colors.text_secondary, marginTop: 2 },

  recCard:      { flexDirection: 'row', alignItems: 'flex-start', gap: 10,
                  backgroundColor: colors.warning + '11', borderRadius: 10, padding: 14,
                  marginBottom: 16, borderWidth: 1, borderColor: colors.warning + '33' },
  recText:      { flex: 1, fontSize: 13, color: colors.text_primary, lineHeight: 20 },

  sectionTitle: { fontSize: 12, color: colors.text_muted, textTransform: 'uppercase',
                  letterSpacing: 1, marginBottom: 10 },

  actions:      { gap: 10, marginTop: 8 },
  proceedBtn:   { flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
                  gap: 10, backgroundColor: colors.success, borderRadius: 14,
                  paddingVertical: 16 },
  proceedText:  { fontSize: 17, fontWeight: '700', color: '#fff' },
  proceedSub:   { fontSize: 12, color: '#fff', opacity: 0.8 },

  cancelBtn:    { alignItems: 'center', paddingVertical: 14, borderRadius: 12,
                  borderWidth: 1, borderColor: colors.border },
  cancelText:   { fontSize: 14, color: colors.text_secondary },

  noFixBox:     { flexDirection: 'row', gap: 10, backgroundColor: colors.bg_card,
                  borderRadius: 12, padding: 14, borderWidth: 1,
                  borderColor: colors.border, alignItems: 'flex-start' },
  noFixText:    { flex: 1, fontSize: 13, color: colors.text_secondary, lineHeight: 20 },
});
