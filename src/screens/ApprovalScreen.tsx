import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet,
  FlatList, ActivityIndicator, Alert, Platform,
  ScrollView, InteractionManager,
} from 'react-native';
import * as Haptics            from 'expo-haptics';
import { Ionicons }            from '@expo/vector-icons';
import { colors }              from '../theme/colors';
import { detectStubs }         from '../utils/stubDetector';
import { loadCode }            from '../utils/CodeStore';
import { checkLegal }          from '../engines/LegalGuard';
import {
  processWorkflow, applyApprovedChange,
  WorkflowItem, WorkflowStage,
} from '../engines/ApprovalWorkflow';
import { createSession, recordVersion } from '../engines/BackupManager';
import { ApprovalScreenProps }          from '../types/navigation';

// ── Pipeline Bar ─────────────────────────────────────────────
const STEPS: { stage: WorkflowStage; label: string }[] = [
  { stage: 'analyzing',         label: 'تحليل'  },
  { stage: 'security_check',    label: 'أمان'   },
  { stage: 'test_simulation',   label: 'اختبار' },
  { stage: 'diff_ready',        label: 'مقارنة' },
  { stage: 'explaining',        label: 'شرح'    },
  { stage: 'awaiting_approval', label: 'موافقة' },
];
const STAGE_ORDER: WorkflowStage[] = [
  'idle','analyzing','generating','security_check',
  'test_simulation','diff_ready','explaining','awaiting_approval','applying','done',
];

function PipelineBar({ currentStage }: { currentStage: WorkflowStage }) {
  const currentIdx = STAGE_ORDER.indexOf(currentStage);
  return (
    <View style={pip.container}>
      {STEPS.map((step, i) => {
        const stepIdx   = STAGE_ORDER.indexOf(step.stage);
        const isDone    = currentIdx > stepIdx;
        const isCurrent = currentIdx === stepIdx;
        return (
          <React.Fragment key={step.stage}>
            <View style={pip.step}>
              <View style={[pip.dot, isDone && pip.dotDone, isCurrent && pip.dotCurrent]}>
                {isDone
                  ? <Ionicons name={"checkmark" as IoniconsName} size={10} color="#fff" />
                  : <Text style={pip.dotNum}>{i + 1}</Text>}
              </View>
              <Text style={[pip.label, (isDone || isCurrent) && pip.labelActive]}>{step.label}</Text>
            </View>
            {i < STEPS.length - 1 && (
              <View style={[pip.connector, isDone && pip.connectorDone]} />
            )}
          </React.Fragment>
        );
      })}
    </View>
  );
}
const pip = StyleSheet.create({
  container:     { flexDirection: 'row', alignItems: 'center', paddingVertical: 12, paddingHorizontal: 4 },
  step:          { alignItems: 'center', gap: 4 },
  dot:           { width: 22, height: 22, borderRadius: 11, backgroundColor: colors.bg_input,
                   alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: colors.border },
  dotDone:       { backgroundColor: colors.success, borderColor: colors.success },
  dotCurrent:    { backgroundColor: colors.accent,  borderColor: colors.accent },
  dotNum:        { fontSize: 9, color: colors.text_muted },
  label:         { fontSize: 9, color: colors.text_muted, textAlign: 'center' },
  labelActive:   { color: colors.text_secondary },
  connector:     { flex: 1, height: 1, backgroundColor: colors.border, marginBottom: 14 },
  connectorDone: { backgroundColor: colors.success },
});

// ── Diff Viewer (Fix: nestedScrollEnabled + maxHeight) ───────
function DiffViewer({ before, after }: { before: string; after: string }) {
  const [showFull, setShowFull] = useState(false);
  return (
    <View style={dv.container}>
      {(['before', 'after'] as const).map(side => (
        <View key={side} style={[dv.panel,
          { borderColor: (side === 'before' ? colors.danger : colors.success) + '55' }]}>
          <View style={dv.panelHeader}>
            <Text style={[dv.panelLabel, { color: side === 'before' ? colors.danger : colors.success }]}>
              {side === 'before' ? 'قبل' : 'بعد'}
            </Text>
            <TouchableOpacity
              onPress={() => setShowFull(f => !f)}
              accessibilityLabel={showFull ? 'إخفاء الكود الكامل' : 'عرض الكود الكامل'}
              accessibilityRole="button"
            >
              <Text style={dv.toggleText}>{showFull ? 'طيّ' : 'عرض الكامل'}</Text>
            </TouchableOpacity>
          </View>
          <ScrollView
            nestedScrollEnabled
            style={{ maxHeight: showFull ? 400 : 160 }}
            showsVerticalScrollIndicator={showFull}
          >
            <Text style={[dv.code, { color: side === 'before' ? colors.danger : colors.success }]}>
              {side === 'before' ? before : after}
            </Text>
          </ScrollView>
        </View>
      ))}
    </View>
  );
}
const dv = StyleSheet.create({
  container:   { gap: 8 },
  panel:       { backgroundColor: colors.bg_input, borderRadius: 10, padding: 12,
                 borderWidth: 1, overflow: 'hidden' },
  panelHeader: { flexDirection: 'row', justifyContent: 'space-between',
                 alignItems: 'center', marginBottom: 6 },
  panelLabel:  { fontSize: 10, fontWeight: '700', textTransform: 'uppercase' },
  toggleText:  { fontSize: 11, color: colors.accent },
  code:        { fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
                 fontSize: 11, lineHeight: 18 },
});

// ── Safety Badge ──────────────────────────────────────────────
function SafetyBadge({ score }: { score: number }) {
  const color = score >= 80 ? colors.success : score >= 60 ? colors.warning : colors.danger;
  return (
    <View style={[sb.wrap, { borderColor: color }]}>
      <Text style={[sb.score, { color }]}>{score}</Text>
      <Text style={sb.label}>Safety</Text>
    </View>
  );
}
const sb = StyleSheet.create({
  wrap:  { alignItems: 'center', borderRadius: 8, borderWidth: 2,
           paddingHorizontal: 10, paddingVertical: 6, minWidth: 52 },
  score: { fontSize: 20, fontWeight: '800' },
  label: { fontSize: 9, color: colors.text_muted, textTransform: 'uppercase' },
});

// ── Item Card ─────────────────────────────────────────────────
function ItemCard({
  item,
  expanded,
  onToggle,
  onApprove,
  onReject,
}: {
  item:      WorkflowItem;
  expanded:  boolean;
  onToggle:  () => void;
  onApprove: (item: WorkflowItem) => Promise<void>;
  onReject:  (item: WorkflowItem) => Promise<void>;
}) {
  const stageColor = item.stage === 'blocked'  ? colors.danger
                   : item.stage === 'done'     ? colors.success
                   : item.stage === 'rejected' ? colors.text_muted
                   : colors.accent;

  return (
    <View style={[
      ic.card,
      item.stage === 'blocked'  && ic.cardBlocked,
      item.stage === 'done'     && ic.cardDone,
      item.stage === 'rejected' && ic.cardRejected,
    ]}>
      <TouchableOpacity
        style={ic.header}
        onPress={onToggle}
        accessibilityLabel={`${item.functionName} — ${item.stageLabel}`}
        accessibilityRole="button"
      >
        <View style={ic.titleRow}>
          <Text style={ic.funcName}>{item.functionName}()</Text>
          <Text style={[ic.stageLabel, { color: stageColor }]}>{item.stageLabel}</Text>
        </View>
        {!['done','rejected','blocked'].includes(item.stage) && (
          <PipelineBar currentStage={item.stage} />
        )}
        <View style={ic.progress}>
          <View style={[ic.fill, {
            width: `${item.stageProgress}%` as `${number}%`,
            backgroundColor: item.stage === 'blocked' ? colors.danger
                           : item.stage === 'done'    ? colors.success
                           : colors.accent,
          }]} />
        </View>
      </TouchableOpacity>

      {expanded && (
        <View style={ic.body}>
          {item.stage === 'blocked' && (
            <View style={ic.blockedBox}>
              <Ionicons name={"ban" as IoniconsName} size={20} color={colors.danger} />
              <Text style={ic.blockedText}>{item.error ?? 'انتهاك أمني — مرفوض تلقائياً'}</Text>
            </View>
          )}

          {item.guardReport && (
            <View style={ic.section}>
              <Text style={ic.sectionTitle}>نتيجة الفحص الأمني</Text>
              <View style={ic.row}>
                <SafetyBadge score={item.guardReport.safetyScore} />
                <View style={{ flex: 1 }}>
                  <Text style={ic.guardText}>{item.guardReport.recommendation}</Text>
                  {item.guardReport.warningMessages.map((w, i) => (
                    <Text key={`w${i}`} style={ic.warnMsg}>⚠️ {w}</Text>
                  ))}
                </View>
              </View>
            </View>
          )}

          {item.intentResult && (
            <View style={ic.section}>
              <Text style={ic.sectionTitle}>النية المُحللة</Text>
              <View style={ic.row}>
                <View style={ic.confBox}>
                  <Text style={ic.confNum}>{item.intentResult.confidence}%</Text>
                  <Text style={ic.confLabel}>ثقة</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={ic.intentDesc}>{item.intentResult.description}</Text>
                  <Text style={ic.ctxSummary}>{item.intentResult.contextSummary}</Text>
                  {item.intentResult.signals.slice(0, 3).map((sig, i) => (
                    <Text key={`sig${i}`} style={ic.signal}>• {sig.signal}</Text>
                  ))}
                </View>
              </View>
              {item.intentResult.requiresClarify && (
                <View style={ic.clarifyBox}>
                  <Text style={ic.clarifyText}>{item.intentResult.clarifyQuestion}</Text>
                </View>
              )}
            </View>
          )}

          {item.explanation && (
            <View style={ic.section}>
              <Text style={ic.sectionTitle}>لماذا هذا الاقتراح؟</Text>
              <Text style={ic.explainText}>{item.explanation.why}</Text>
              <Text style={ic.impactText}>{item.explanation.impact}</Text>
              {item.explanation.needsReview && (
                <View style={ic.reviewRow}>
                  <Ionicons name={"eye-outline" as IoniconsName} size={13} color={colors.warning} />
                  <Text style={ic.reviewText}>يحتاج مراجعة يدوية دقيقة</Text>
                </View>
              )}
            </View>
          )}

          {item.diff && (
            <View style={ic.section}>
              <Text style={ic.sectionTitle}>
                مقارنة (+{item.diff.addedLines} / -{item.diff.removedLines} سطر)
              </Text>
              <DiffViewer before={item.diff.before} after={item.diff.after} />
            </View>
          )}

          {item.stage === 'awaiting_approval' && !item.intentResult?.requiresClarify && (
            <View style={ic.approvalRow}>
              <TouchableOpacity
                style={ic.rejectBtn}
                onPress={() => { void onReject(item); }}
                accessibilityLabel={`رفض تعديل ${item.functionName}`}
                accessibilityRole="button"
              >
                <Ionicons name={"close-circle" as IoniconsName} size={20} color={colors.danger} />
                <Text style={ic.rejectText}>رفض</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[ic.approveBtn, item.guardReport?.verdict === 'warning' && ic.approveBtnWarn]}
                onPress={() => { void onApprove(item); }}
                accessibilityLabel={`موافقة على تعديل ${item.functionName}`}
                accessibilityRole="button"
              >
                <Ionicons name={"checkmark-circle" as IoniconsName} size={20} color="#fff" />
                <Text style={ic.approveText}>
                  {item.guardReport?.verdict === 'warning' ? 'موافقة (مع تحذير)' : 'موافقة وتطبيق'}
                </Text>
              </TouchableOpacity>
            </View>
          )}
        </View>
      )}
    </View>
  );
}

const ic = StyleSheet.create({
  card:        { backgroundColor: colors.bg_card, borderRadius: 14, marginBottom: 12,
                 borderWidth: 1, borderColor: colors.border, overflow: 'hidden' },
  cardBlocked: { borderColor: colors.danger  + '55' },
  cardDone:    { borderColor: colors.success + '55' },
  cardRejected:{ borderColor: colors.text_muted + '44', opacity: 0.7 },
  header:      { padding: 14 },
  titleRow:    { flexDirection: 'row', justifyContent: 'space-between',
                 alignItems: 'center', marginBottom: 8 },
  funcName:    { fontSize: 15, fontWeight: '700', color: colors.text_primary,
                 fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace' },
  stageLabel:  { fontSize: 12, fontWeight: '600' },
  progress:    { height: 3, backgroundColor: colors.border, borderRadius: 2, overflow: 'hidden' },
  fill:        { height: '100%', borderRadius: 2 },
  body:        { padding: 14, paddingTop: 0, borderTopWidth: 1,
                 borderTopColor: colors.border, gap: 14 },
  blockedBox:  { flexDirection: 'row', gap: 10, backgroundColor: colors.danger + '11',
                 borderRadius: 10, padding: 12, borderWidth: 1,
                 borderColor: colors.danger + '33', alignItems: 'flex-start' },
  blockedText: { flex: 1, fontSize: 13, color: colors.danger, lineHeight: 20 },
  section:     { gap: 8 },
  sectionTitle:{ fontSize: 11, color: colors.text_muted,
                 textTransform: 'uppercase', letterSpacing: 0.8 },
  row:         { flexDirection: 'row', gap: 12, alignItems: 'flex-start' },
  guardText:   { fontSize: 12, color: colors.text_secondary, lineHeight: 18 },
  warnMsg:     { fontSize: 11, color: colors.warning, marginTop: 3 },
  confBox:     { alignItems: 'center', minWidth: 52 },
  confNum:     { fontSize: 22, fontWeight: '800', color: colors.accent },
  confLabel:   { fontSize: 9, color: colors.text_muted },
  intentDesc:  { fontSize: 13, color: colors.text_primary, fontWeight: '500' },
  ctxSummary:  { fontSize: 11, color: colors.text_muted, marginTop: 2 },
  signal:      { fontSize: 11, color: colors.text_secondary, marginTop: 2 },
  clarifyBox:  { backgroundColor: colors.warning + '11', borderRadius: 10,
                 padding: 12, borderWidth: 1, borderColor: colors.warning + '33' },
  clarifyText: { fontSize: 12, color: colors.warning, lineHeight: 20 },
  explainText: { fontSize: 12, color: colors.text_secondary, lineHeight: 20 },
  impactText:  { fontSize: 12, color: colors.text_primary, lineHeight: 20 },
  reviewRow:   { flexDirection: 'row', gap: 6, alignItems: 'center' },
  reviewText:  { fontSize: 11, color: colors.warning },
  approvalRow: { flexDirection: 'row', gap: 10, marginTop: 4 },
  rejectBtn:   { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
                 gap: 8, paddingVertical: 13, borderRadius: 10,
                 borderWidth: 1, borderColor: colors.danger + '66' },
  rejectText:  { color: colors.danger, fontWeight: '600', fontSize: 14 },
  approveBtn:  { flex: 2, flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
                 gap: 8, paddingVertical: 13, borderRadius: 10, backgroundColor: colors.success },
  approveBtnWarn: { backgroundColor: colors.warning },
  approveText: { color: '#fff', fontWeight: '700', fontSize: 14 },
});

// ── Main Screen ───────────────────────────────────────────────
export default function ApprovalScreen({ navigation }: ApprovalScreenProps) {
  const [items,         setItems]         = useState<WorkflowItem[]>([]);
  const [processing,    setProcessing]    = useState(false);
  const [expandedId,    setExpandedId]    = useState<string | null>(null);
  const [approvedCount, setApprovedCount] = useState(0);
  const [rejectedCount, setRejectedCount] = useState(0);

  // Fix: refs to avoid stale closures + memory leaks
  const liveCodeRef  = useRef<string>('');
  const sessionIdRef = useRef<string | null>(null);
  const mountedRef   = useRef<boolean>(true);

  useEffect(() => {
    mountedRef.current = true;
    void startAnalysis();
    // Fix: cleanup on unmount — stops async loop from updating unmounted component
    return () => { mountedRef.current = false; };
  }, []);

  const startAnalysis = async () => {
    // Load code from AsyncStorage (not params)
    const code = await loadCode();
    if (!code) { navigation.goBack(); return; }

    // Legal check
    const legal = checkLegal(code);
    if (legal.blocked) {
      Alert.alert('طلب محظور ⛔', legal.userMessage);
      navigation.goBack();
      return;
    }

    liveCodeRef.current = code;
    setProcessing(true);

    try {
      const session = await createSession('code_analysis.py', code);
      if (!mountedRef.current) return;
      sessionIdRef.current = session.sessionId;

      const { stubs } = detectStubs(code);
      if (stubs.length === 0) {
        Alert.alert('لا دوال ناقصة', 'لم يتم اكتشاف أي stub في الكود.');
        navigation.goBack();
        return;
      }

      // Fix: defer heavy loop so UI renders first (InteractionManager)
      await new Promise<void>(resolve => {
        InteractionManager.runAfterInteractions(() => resolve());
      });

      // Fix: batch re-renders — collect all items first, then single setItems
      const collectedItems: WorkflowItem[] = [];

      for (const stub of stubs) {
        if (!mountedRef.current) break;   // stop if screen unmounted

        // Yield between stubs to keep UI responsive
        await new Promise<void>(resolve => setTimeout(resolve, 0));

        await processWorkflow(
          stub, liveCodeRef.current, code,
          (updated) => {
            if (!mountedRef.current) return;
            // Update existing or add new
            const idx = collectedItems.findIndex(i => i.id === updated.id);
            if (idx === -1) collectedItems.push(updated);
            else collectedItems[idx] = updated;
            // Single batched update
            setItems([...collectedItems]);
          },
        );
      }
    } finally {
      if (mountedRef.current) setProcessing(false);
    }
  };

  const handleApprove = useCallback(async (item: WorkflowItem) => {
    if (!item.suggestion || !sessionIdRef.current) return;
    await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);

    const stub = { name: item.functionName, line: 0,
                   risk: 'confirmed' as const, reason: '', snippet: '', suggestion: '' };

    // Fix: always read from ref — no stale closure
    liveCodeRef.current = applyApprovedChange(liveCodeRef.current, stub, item.suggestion);

    await recordVersion(
      sessionIdRef.current, item.functionName,
      `تطبيق ${item.functionName}()`,
      item.diff?.before ?? '', item.suggestion,
      true, item.guardReport?.safetyScore ?? 100,
    );

    if (mountedRef.current) {
      setApprovedCount(c => c + 1);
      setItems(prev => prev.map(i =>
        i.id === item.id ? { ...i, stage: 'done', stageLabel: 'اكتمل ✓', stageProgress: 100 } : i
      ));
    }
  }, []);

  const handleReject = useCallback(async (item: WorkflowItem) => {
    await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    if (sessionIdRef.current) {
      await recordVersion(
        sessionIdRef.current, item.functionName, `رُفض ${item.functionName}()`,
        item.diff?.before ?? '', item.suggestion ?? '', false,
        item.guardReport?.safetyScore ?? 0,
      );
    }
    if (mountedRef.current) {
      setRejectedCount(c => c + 1);
      setItems(prev => prev.map(i =>
        i.id === item.id ? { ...i, stage: 'rejected', stageLabel: 'رُفض', stageProgress: 100 } : i
      ));
    }
  }, []);

  const handleBatchApprove = useCallback(() => {
    const safe = items.filter(
      i => i.stage === 'awaiting_approval' &&
           (i.guardReport?.safetyScore ?? 0) >= 80 &&
           i.guardReport?.verdict === 'safe',
    );
    if (!safe.length) {
      Alert.alert('لا يوجد', 'لا توجد دوال بـ safety ≥ 80 وverdect = safe');
      return;
    }
    Alert.alert(
      'موافقة جماعية',
      `موافقة على ${safe.length} دوال آمنة؟`,
      [
        { text: 'إلغاء', style: 'cancel' },
        { text: 'موافقة', onPress: () => { void Promise.all(safe.map(i => handleApprove(i))); } },
      ],
    );
  }, [items, handleApprove]);

  const pendingCount = items.filter(i => i.stage === 'awaiting_approval').length;
  const allDone = !processing && items.length > 0 &&
                  items.every(i => ['done','rejected','blocked'].includes(i.stage));

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
        <Text style={styles.headerTitle}>Approval Workflow</Text>
        <View style={styles.headerStats}>
          <Text style={[styles.stat, { color: colors.success }]}>{approvedCount}✓</Text>
          <Text style={[styles.stat, { color: colors.danger }]}>{rejectedCount}✗</Text>
        </View>
      </View>

      {/* Batch approve bar */}
      {pendingCount > 1 && (
        <TouchableOpacity
          style={styles.batchBar}
          onPress={handleBatchApprove}
          accessibilityLabel="موافقة جماعية على الدوال الآمنة"
          accessibilityRole="button"
        >
          <Ionicons name={"checkmark-done" as IoniconsName} size={16} color={colors.success} />
          <Text style={styles.batchText}>وافق على الكل الآمن (safety ≥ 80)</Text>
          <Text style={styles.batchCount}>{pendingCount} دالة</Text>
        </TouchableOpacity>
      )}

      {processing && (
        <View style={styles.loadingBar}>
          <ActivityIndicator color={colors.accent} size="small" />
          <Text style={styles.loadingText}>يتم تشغيل pipeline الأمني…</Text>
        </View>
      )}

      {/* Fix: FlatList instead of ScrollView + map */}
      <FlatList
        data={items}
        keyExtractor={item => item.id}
        contentContainerStyle={styles.list}
        showsVerticalScrollIndicator={false}
        renderItem={({ item }) => (
          <ItemCard
            item={item}
            expanded={expandedId === item.id}
            onToggle={() => setExpandedId(id => id === item.id ? null : item.id)}
            onApprove={handleApprove}
            onReject={handleReject}
          />
        )}
        ListEmptyComponent={
          !processing ? (
            <View style={styles.empty}>
              <Ionicons name={"checkmark-circle" as IoniconsName} size={48} color={colors.success} />
              <Text style={styles.emptyText}>لا يوجد شيء للمراجعة</Text>
            </View>
          ) : null
        }
        ListFooterComponent={
          allDone ? (
            <View style={styles.summary}>
              <Text style={styles.summaryTitle}>اكتملت جميع المراجعات</Text>
              <Text style={styles.summaryStat}>✓ موافق: {approvedCount}</Text>
              <Text style={styles.summaryStat}>✗ مرفوض: {rejectedCount}</Text>
              <Text style={styles.summaryStat}>
                ⛔ محظور: {items.filter(i => i.stage === 'blocked').length}
              </Text>
            </View>
          ) : null
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container:    { flex: 1, backgroundColor: colors.bg_primary },
  list:         { padding: 16, paddingBottom: 40 },
  header:       { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
                  paddingHorizontal: 16, paddingTop: 12, paddingBottom: 12,
                  borderBottomWidth: 1, borderBottomColor: colors.border },
  backBtn:      { padding: 6 },
  headerTitle:  { fontSize: 16, fontWeight: '600', color: colors.text_primary },
  headerStats:  { flexDirection: 'row', gap: 10 },
  stat:         { fontSize: 14, fontWeight: '700' },
  batchBar:     { flexDirection: 'row', alignItems: 'center', gap: 10,
                  backgroundColor: colors.success + '11', paddingHorizontal: 16, paddingVertical: 10,
                  borderBottomWidth: 1, borderBottomColor: colors.success + '33' },
  batchText:    { flex: 1, fontSize: 13, color: colors.success, fontWeight: '600' },
  batchCount:   { fontSize: 12, color: colors.text_muted },
  loadingBar:   { flexDirection: 'row', alignItems: 'center', gap: 10,
                  backgroundColor: colors.accent + '11', paddingHorizontal: 16, paddingVertical: 10 },
  loadingText:  { fontSize: 12, color: colors.text_secondary },
  empty:        { alignItems: 'center', paddingVertical: 60, gap: 12 },
  emptyText:    { fontSize: 16, color: colors.text_secondary },
  summary:      { backgroundColor: colors.bg_card, borderRadius: 14, padding: 20,
                  alignItems: 'center', gap: 8, borderWidth: 1, borderColor: colors.border },
  summaryTitle: { fontSize: 16, fontWeight: '700', color: colors.text_primary },
  summaryStat:  { fontSize: 14, color: colors.text_secondary },
});
