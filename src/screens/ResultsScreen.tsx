import React, { useState, useEffect } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet,
  FlatList, Share, Platform, ActivityIndicator,
} from 'react-native';
import { Ionicons }          from '@expo/vector-icons';
import { IoniconsName }   from '../types/icons';
import { colors }            from '../theme/colors';
import { loadResult, loadCode } from '../utils/CodeStore';
import { ScanResult, SecurityIssue, Severity } from '../utils/securityScanner';
import { StubResult, StubFunction }             from '../utils/stubDetector';
import { ResultsScreenProps }                   from '../types/navigation';

// ── Helpers ──────────────────────────────────────────────────
const SEVERITY_COLOR: Record<Severity, string> = {
  critical: colors.critical, high: colors.high,
  medium: colors.medium,     low: colors.low, info: colors.info,
};
const SEVERITY_LABEL: Record<Severity, string> = {
  critical: 'حرج', high: 'عالي', medium: 'متوسط', low: 'منخفض', info: 'معلومة',
};

function ScoreRing({ score }: { score: number }) {
  const color = score >= 80 ? colors.success : score >= 60 ? colors.warning : colors.danger;
  return (
    <View style={[ring.wrap, { borderColor: color }]}>
      <Text style={[ring.num, { color }]}>{score}</Text>
      <Text style={ring.label}>/ 100</Text>
    </View>
  );
}
const ring = StyleSheet.create({
  wrap:  { width: 56, height: 56, borderRadius: 28, borderWidth: 3,
           alignItems: 'center', justifyContent: 'center', marginBottom: 2 },
  num:   { fontSize: 18, fontWeight: '700' },
  label: { fontSize: 9, color: colors.text_muted },
});

// ── IssueCard ─────────────────────────────────────────────────
function IssueCard({ item: issue }: { item: SecurityIssue }) {
  const [expanded, setExpanded] = useState(false);
  const c = SEVERITY_COLOR[issue.severity];
  return (
    <TouchableOpacity
      style={[styles.card, { borderLeftColor: c }]}
      onPress={() => setExpanded(e => !e)}
      activeOpacity={0.85}
      accessibilityLabel={`مشكلة أمنية: ${issue.title}`}
      accessibilityRole="button"
    >
      <View style={styles.cardHeader}>
        <View style={[styles.sevBadge, { backgroundColor: c + '22' }]}>
          <Text style={[styles.sevText, { color: c }]}>{SEVERITY_LABEL[issue.severity]}</Text>
        </View>
        <Text style={styles.cardTitle} numberOfLines={expanded ? 0 : 1}>{issue.title}</Text>
        <Ionicons name={expanded ? 'chevron-up' : 'chevron-down'} size={16} color={colors.text_muted} />
      </View>
      <Text style={styles.cardMeta}>سطر {issue.line} • {issue.category}</Text>
      {expanded && (
        <View style={styles.cardBody}>
          <View style={styles.snippetBox}>
            <Text style={styles.snippetText} numberOfLines={4}>{issue.snippet}</Text>
          </View>
          <Text style={styles.descText}>{issue.description}</Text>
          <View style={styles.fixBox}>
            <Ionicons name={"bulb-outline" as IoniconsName} size={14} color={colors.success} />
            <Text style={styles.fixText}>{issue.fix}</Text>
          </View>
        </View>
      )}
    </TouchableOpacity>
  );
}

// ── StubCard ──────────────────────────────────────────────────
function StubCard({ item: stub }: { item: StubFunction }) {
  const [expanded, setExpanded] = useState(false);
  const c = stub.risk === 'confirmed' ? colors.danger : colors.warning;
  return (
    <TouchableOpacity
      style={[styles.card, { borderLeftColor: c }]}
      onPress={() => setExpanded(e => !e)}
      activeOpacity={0.85}
      accessibilityLabel={`دالة ناقصة: ${stub.name}`}
      accessibilityRole="button"
    >
      <View style={styles.cardHeader}>
        <View style={[styles.sevBadge, { backgroundColor: c + '22' }]}>
          <Text style={[styles.sevText, { color: c }]}>
            {stub.risk === 'confirmed' ? 'ناقصة' : 'مشبوهة'}
          </Text>
        </View>
        <Text style={styles.cardTitle}>{stub.name}()</Text>
        <Ionicons name={expanded ? 'chevron-up' : 'chevron-down'} size={16} color={colors.text_muted} />
      </View>
      <Text style={styles.cardMeta}>سطر {stub.line} • {stub.reason}</Text>
      {expanded && (
        <View style={styles.cardBody}>
          <View style={styles.snippetBox}>
            <Text style={styles.snippetText}>{stub.snippet}</Text>
          </View>
          <Text style={styles.sectionMini}>اقتراح التنفيذ:</Text>
          <View style={[styles.snippetBox, { backgroundColor: colors.success + '11',
                                            borderColor: colors.success + '33' }]}>
            <Text style={[styles.snippetText, { color: colors.success }]}>{stub.suggestion}</Text>
          </View>
        </View>
      )}
    </TouchableOpacity>
  );
}

// ── Main Screen ───────────────────────────────────────────────
interface StoredResult {
  secResult:  ScanResult  | null;
  stubResult: StubResult  | null;
}

export default function ResultsScreen({ navigation, route }: ResultsScreenProps) {
  const { mode } = route.params;
  const [data,    setData]    = useState<StoredResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [tab,     setTab]     = useState<'security' | 'stubs'>(
    mode === 'stubs' ? 'stubs' : 'security'
  );

  // Fix: load from AsyncStorage, not from params
  useEffect(() => {
    void (async () => {
      const result = await loadResult<StoredResult>();
      setData(result);
      setLoading(false);
    })();
  }, []);

  const secIssues     = data?.secResult?.issues ?? [];
  const stubs         = data?.stubResult?.stubs ?? [];
  const score         = data?.secResult?.score ?? null;
  const language      = data?.secResult?.language;
  const scannedLines  = data?.secResult?.scannedLines ?? data?.stubResult?.totalFuncs;
  const criticalCount = secIssues.filter(i => i.severity === 'critical').length;
  const showTabs      = mode === 'full';

  const exportReport = async () => {
    const code = await loadCode();
    let text = '=== Reality Engine Report ===\n';
    if (data?.secResult)
      text += `\nSecurity Score: ${score}/100\nLanguage: ${language}\nIssues: ${secIssues.length}\n`;
    if (data?.stubResult)
      text += `\nStub Functions: ${stubs.length}\n`;
    secIssues.forEach(i => { text += `[${i.severity.toUpperCase()}] ${i.title} (line ${i.line})\n`; });
    stubs.forEach(s =>     { text += `[${s.risk}] ${s.name}() (line ${s.line})\n`; });
    await Share.share({ message: text, title: 'Reality Engine Report' });
  };

  if (loading) {
    return (
      <View style={styles.loadingScreen}>
        <ActivityIndicator color={colors.accent} size="large" />
      </View>
    );
  }

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
        <Text style={styles.headerTitle}>نتائج التحليل</Text>
        <TouchableOpacity
          onPress={() => { void exportReport(); }}
          style={styles.exportBtn}
          accessibilityLabel="تصدير التقرير"
          accessibilityRole="button"
        >
          <Ionicons name={"share-outline" as IoniconsName} size={22} color={colors.accent} />
        </TouchableOpacity>
      </View>

      {/* Summary row */}
      <View style={styles.summaryRow}>
        {score !== null && (
          <View style={styles.summaryCard}>
            <ScoreRing score={score} />
            <Text style={styles.summaryLabel}>Security</Text>
          </View>
        )}
        {secIssues.length > 0 && (
          <View style={styles.summaryCard}>
            <Text style={[styles.summaryBig, { color: criticalCount > 0 ? colors.danger : colors.warning }]}>
              {criticalCount > 0 ? criticalCount : secIssues.length}
            </Text>
            <Text style={styles.summaryLabel}>{criticalCount > 0 ? 'حرجة' : 'مشاكل'}</Text>
          </View>
        )}
        {stubs.length > 0 && (
          <View style={styles.summaryCard}>
            <Text style={[styles.summaryBig, { color: colors.purple }]}>{stubs.length}</Text>
            <Text style={styles.summaryLabel}>دوال ناقصة</Text>
          </View>
        )}
        <View style={styles.summaryCard}>
          <Text style={[styles.summaryBig, { color: colors.accent }]}>{scannedLines ?? 0}</Text>
          <Text style={styles.summaryLabel}>{mode === 'stubs' ? 'دالة' : 'سطر'}</Text>
        </View>
      </View>

      {/* Language badge */}
      {language && (
        <View style={styles.langBadge}>
          <Ionicons name={"code-outline" as IoniconsName} size={14} color={colors.accent} />
          <Text style={styles.langText}>{language}</Text>
        </View>
      )}

      {/* Tabs */}
      {showTabs && (
        <View style={styles.tabs}>
          {(['security', 'stubs'] as const).map(t => (
            <TouchableOpacity
              key={t}
              style={[styles.tab, tab === t && styles.tabActive]}
              onPress={() => setTab(t)}
              accessibilityRole="tab"
              accessibilityState={{ selected: tab === t }}
            >
              <Ionicons
                name={t === 'security' ? 'shield-checkmark' : 'code-slash'}
                size={14}
                color={tab === t ? (t === 'security' ? colors.success : colors.purple) : colors.text_muted}
              />
              <Text style={[styles.tabText, tab === t && {
                color: t === 'security' ? colors.success : colors.purple,
              }]}>
                {t === 'security' ? `Security (${secIssues.length})` : `Stubs (${stubs.length})`}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      )}

      {/* Security issues — FlatList for performance */}
      {(tab === 'security' || !showTabs) && secIssues.length > 0 && (
        <FlatList
          data={secIssues}
          keyExtractor={issue => `${issue.id}-${issue.line}`}
          renderItem={({ item }) => <IssueCard item={item} />}
          contentContainerStyle={styles.list}
          showsVerticalScrollIndicator={false}
          ListHeaderComponent={<Text style={styles.sectionTitle}>المشاكل الأمنية</Text>}
        />
      )}

      {/* Clean security */}
      {(tab === 'security' || !showTabs) && secIssues.length === 0 && data?.secResult && (
        <View style={styles.cleanBox}>
          <Ionicons name={"shield-checkmark" as IoniconsName} size={40} color={colors.success} />
          <Text style={styles.cleanTitle}>الكود نظيف أمنياً ✓</Text>
          <Text style={styles.cleanSub}>لم يتم اكتشاف أي مشاكل أمنية</Text>
        </View>
      )}

      {/* Stub results — FlatList for performance */}
      {(tab === 'stubs' || !showTabs) && stubs.length > 0 && (
        <FlatList
          data={stubs}
          keyExtractor={stub => `stub-${stub.name}-${stub.line}`}
          renderItem={({ item }) => <StubCard item={item} />}
          contentContainerStyle={styles.list}
          showsVerticalScrollIndicator={false}
          ListHeaderComponent={<Text style={styles.sectionTitle}>الدوال الناقصة</Text>}
        />
      )}

      {/* Clean stubs */}
      {(tab === 'stubs' || !showTabs) && stubs.length === 0 && data?.stubResult && (
        <View style={styles.cleanBox}>
          <Ionicons name={"checkmark-circle" as IoniconsName} size={40} color={colors.success} />
          <Text style={styles.cleanTitle}>كل الدوال مكتملة ✓</Text>
          <Text style={styles.cleanSub}>لا توجد دوال stub أو ناقصة</Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container:    { flex: 1, backgroundColor: colors.bg_primary },
  loadingScreen:{ flex: 1, backgroundColor: colors.bg_primary,
                  justifyContent: 'center', alignItems: 'center' },
  list:         { padding: 16, paddingBottom: 40 },

  header:       { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
                  paddingHorizontal: 16, paddingTop: 12, paddingBottom: 12,
                  borderBottomWidth: 1, borderBottomColor: colors.border },
  backBtn:      { padding: 6 },
  headerTitle:  { fontSize: 16, fontWeight: '600', color: colors.text_primary },
  exportBtn:    { padding: 6 },

  summaryRow:   { flexDirection: 'row', gap: 10, padding: 16, paddingBottom: 8, flexWrap: 'wrap' },
  summaryCard:  { flex: 1, minWidth: 70, backgroundColor: colors.bg_card, borderRadius: 12,
                  padding: 14, alignItems: 'center', borderWidth: 1, borderColor: colors.border },
  summaryBig:   { fontSize: 28, fontWeight: '700' },
  summaryLabel: { fontSize: 10, color: colors.text_secondary, marginTop: 4, textAlign: 'center' },

  langBadge:    { flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start',
                  backgroundColor: colors.accent_dim, paddingHorizontal: 10, paddingVertical: 5,
                  borderRadius: 20, marginHorizontal: 16, marginBottom: 10 },
  langText:     { fontSize: 12, color: colors.accent, fontWeight: '500' },

  tabs:         { flexDirection: 'row', backgroundColor: colors.bg_secondary, borderRadius: 10,
                  padding: 4, marginHorizontal: 16, marginBottom: 4,
                  borderWidth: 1, borderColor: colors.border },
  tab:          { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
                  gap: 6, paddingVertical: 8, borderRadius: 8 },
  tabActive:    { backgroundColor: colors.bg_card },
  tabText:      { fontSize: 12, color: colors.text_muted, fontWeight: '500' },

  sectionTitle: { fontSize: 12, color: colors.text_muted, marginBottom: 10,
                  textTransform: 'uppercase', letterSpacing: 1 },

  card:         { backgroundColor: colors.bg_card, borderRadius: 12, padding: 14,
                  marginBottom: 10, borderWidth: 1, borderColor: colors.border, borderLeftWidth: 3 },
  cardHeader:   { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 4 },
  sevBadge:     { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },
  sevText:      { fontSize: 10, fontWeight: '700', textTransform: 'uppercase' },
  cardTitle:    { flex: 1, fontSize: 13, fontWeight: '600', color: colors.text_primary },
  cardMeta:     { fontSize: 11, color: colors.text_muted },

  cardBody:     { marginTop: 10, gap: 8 },
  snippetBox:   { backgroundColor: colors.bg_input, borderRadius: 8, padding: 10,
                  borderWidth: 1, borderColor: colors.border },
  snippetText:  { fontSize: 11, color: colors.text_secondary,
                  fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace', lineHeight: 18 },
  descText:     { fontSize: 12, color: colors.text_secondary, lineHeight: 18 },
  fixBox:       { flexDirection: 'row', gap: 8, backgroundColor: colors.success + '11',
                  borderRadius: 8, padding: 10, borderWidth: 1, borderColor: colors.success + '33' },
  fixText:      { flex: 1, fontSize: 12, color: colors.success, lineHeight: 18 },
  sectionMini:  { fontSize: 11, color: colors.text_secondary },

  cleanBox:     { alignItems: 'center', paddingVertical: 60, margin: 16,
                  backgroundColor: colors.bg_card, borderRadius: 16,
                  borderWidth: 1, borderColor: colors.border },
  cleanTitle:   { fontSize: 18, fontWeight: '700', color: colors.text_primary, marginTop: 12 },
  cleanSub:     { fontSize: 13, color: colors.text_secondary, marginTop: 6 },
});
