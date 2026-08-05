import React, { useState, useEffect, useCallback } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet,
  FlatList, Alert, ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { IoniconsName }   from '../types/icons';
import { colors }          from '../theme/colors';
import {
  getAllSessions, deleteSession, restoreToOriginal,
  restoreToVersion, formatTimestamp, BackupSession, BackupVersion,
  getStats,
} from '../engines/BackupManager';

// ===== Version Row =====
function VersionRow({
  version, onRestore,
}: { version: BackupVersion; onRestore: (v: BackupVersion) => void }) {
  const isRestore = version.functionName === '__restore__';
  const color     = version.approved ? colors.success : colors.danger;

  return (
    <View style={vrow.container}>
      <View style={[vrow.dot, { backgroundColor: color }]} />
      <View style={vrow.content}>
        <Text style={vrow.name}>
          {isRestore ? '↩ استرجاع' : version.functionName + '()'}
        </Text>
        <Text style={vrow.desc}>{version.description}</Text>
        <View style={vrow.meta}>
          <Text style={vrow.time}>{formatTimestamp(version.timestamp)}</Text>
          {!isRestore && (
            <View style={[vrow.badge, { backgroundColor: color + '22' }]}>
              <Text style={[vrow.badgeText, { color }]}>
                Safety {version.safetyScore}
              </Text>
            </View>
          )}
        </View>
      </View>
      {!isRestore && version.approved && (
        <TouchableOpacity style={vrow.restoreBtn} onPress={() => { void onRestore(version); }}>
          <Ionicons name={"return-up-back" as IoniconsName} size={16} color={colors.accent} />
        </TouchableOpacity>
      )}
    </View>
  );
}

const vrow = StyleSheet.create({
  container:   { flexDirection: 'row', alignItems: 'flex-start', gap: 10, paddingVertical: 10,
                 borderBottomWidth: 1, borderBottomColor: colors.border + '55' },
  dot:         { width: 8, height: 8, borderRadius: 4, marginTop: 5 },
  content:     { flex: 1, gap: 3 },
  name:        { fontSize: 13, fontWeight: '600', color: colors.text_primary },
  desc:        { fontSize: 11, color: colors.text_secondary },
  meta:        { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 2 },
  time:        { fontSize: 10, color: colors.text_muted },
  badge:       { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6 },
  badgeText:   { fontSize: 9, fontWeight: '700' },
  restoreBtn:  { padding: 8 },
});

// ===== Session Card =====
function SessionCard({
  session, onDelete, onRestoreOriginal, onRestoreVersion,
}: {
  session: BackupSession;
  onDelete:         (s: BackupSession) => void;
  onRestoreOriginal:(s: BackupSession) => void;
  onRestoreVersion: (s: BackupSession, v: BackupVersion) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const approvedCount  = session.versions.filter(v => v.approved).length;
  const rejectedCount  = session.versions.filter(v => !v.approved && v.functionName !== '__restore__').length;

  return (
    <View style={scard.container}>
      <TouchableOpacity style={scard.header} onPress={() => setExpanded(e => !e)}>
        <View style={scard.icon}>
          <Ionicons name={"document-text" as IoniconsName} size={20} color={colors.accent} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={scard.filename}>{session.fileName}</Text>
          <Text style={scard.date}>{formatTimestamp(session.createdAt)}</Text>
        </View>
        <View style={scard.badges}>
          <Text style={[scard.badge, { color: colors.success }]}>✓{approvedCount}</Text>
          <Text style={[scard.badge, { color: colors.danger }]}>✗{rejectedCount}</Text>
        </View>
        <Ionicons
          name={expanded ? 'chevron-up' : 'chevron-down'}
          size={16} color={colors.text_muted}
        />
      </TouchableOpacity>

      {expanded && (
        <View style={scard.body}>
          {/* Actions */}
          <View style={scard.actions}>
            <TouchableOpacity
              style={scard.actionBtn}
              onPress={() => { void onRestoreOriginal(session); }}
            >
              <Ionicons name={"refresh" as IoniconsName} size={14} color={colors.warning} />
              <Text style={[scard.actionText, { color: colors.warning }]}>استرجاع الأصلي</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={scard.actionBtn}
              onPress={() => { void onDelete(session); }}
            >
              <Ionicons name={"trash-outline" as IoniconsName} size={14} color={colors.danger} />
              <Text style={[scard.actionText, { color: colors.danger }]}>حذف</Text>
            </TouchableOpacity>
          </View>

          {/* Versions */}
          {session.versions.length === 0 ? (
            <Text style={scard.empty}>لا توجد تعديلات مسجّلة</Text>
          ) : (
            session.versions.slice().reverse().map(v => (
              <VersionRow
                key={v.id}
                version={v}
                onRestore={(ver) => onRestoreVersion(session, ver)}
              />
            ))
          )}
        </View>
      )}
    </View>
  );
}

const scard = StyleSheet.create({
  container: { backgroundColor: colors.bg_card, borderRadius: 14, marginBottom: 12,
               borderWidth: 1, borderColor: colors.border },
  header:    { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 14 },
  icon:      { width: 40, height: 40, borderRadius: 10, backgroundColor: colors.accent_dim,
               alignItems: 'center', justifyContent: 'center' },
  filename:  { fontSize: 14, fontWeight: '600', color: colors.text_primary },
  date:      { fontSize: 11, color: colors.text_muted, marginTop: 2 },
  badges:    { flexDirection: 'row', gap: 8 },
  badge:     { fontSize: 13, fontWeight: '700' },
  body:      { padding: 14, paddingTop: 0, borderTopWidth: 1, borderTopColor: colors.border, gap: 10 },
  actions:   { flexDirection: 'row', gap: 10 },
  actionBtn: { flexDirection: 'row', alignItems: 'center', gap: 6,
               paddingHorizontal: 12, paddingVertical: 7, borderRadius: 8,
               backgroundColor: colors.bg_input },
  actionText:{ fontSize: 12, fontWeight: '500' },
  empty:     { fontSize: 12, color: colors.text_muted, textAlign: 'center', paddingVertical: 10 },
});

// ===== Main Screen =====
import { HistoryScreenProps } from '../types/navigation';

export default function HistoryScreen({ navigation }: HistoryScreenProps) {
  const [sessions,  setSessions]  = useState<BackupSession[]>([]);
  const [loading,   setLoading]   = useState(true);
  const [stats,     setStats]     = useState({ sessions: 0, totalVersions: 0 });

  useEffect(() => { loadData(); }, []);

  const loadData = useCallback(async () => {
    setLoading(true);
    const [s, st] = await Promise.all([getAllSessions(), getStats()]);
    setSessions(s);
    setStats(st);
    setLoading(false);
  };

  const handleDelete = (session: BackupSession) => {
    Alert.alert(
      'حذف الجلسة',
      `هل تريد حذف "${session.fileName}" وجميع نسخه الاحتياطية؟`,
      [
        { text: 'إلغاء', style: 'cancel' },
        {
          text: 'حذف', style: 'destructive',
          onPress: async () => {
            await deleteSession(session.sessionId);
            loadData();
          },
        },
      ],
    );
  };

  const handleRestoreOriginal = async (session: BackupSession) => {
    Alert.alert(
      'استرجاع الأصلي',
      'هذا سيرجع الكود لحالته الأصلية قبل أي تعديل. هل تريد المتابعة؟',
      [
        { text: 'إلغاء', style: 'cancel' },
        {
          text: 'استرجاع',
          onPress: async () => {
            await restoreToOriginal(session.sessionId);
            loadData();
          },
        },
      ],
    );
  };

  const handleRestoreVersion = async (session: BackupSession, version: BackupVersion) => {
    Alert.alert(
      'استرجاع إصدار',
      `هل تريد الرجوع لحالة الكود قبل تعديل "${version.functionName}()"؟`,
      [
        { text: 'إلغاء', style: 'cancel' },
        {
          text: 'استرجاع',
          onPress: async () => {
            await restoreToVersion(session.sessionId, version.id);
            loadData();
          },
        },
      ],
    );
  };

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
          <Ionicons name={"arrow-back" as IoniconsName} size={22} color={colors.text_primary} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>السجل والنسخ الاحتياطية</Text>
        <TouchableOpacity onPress={() => { void loadData(); }} style={styles.refreshBtn}>
          <Ionicons name={"refresh" as IoniconsName} size={20} color={colors.accent} />
        </TouchableOpacity>
      </View>

      {/* Stats */}
      <View style={styles.statsRow}>
        <View style={styles.statItem}>
          <Text style={styles.statVal}>{stats.sessions}</Text>
          <Text style={styles.statLabel}>جلسات</Text>
        </View>
        <View style={styles.statItem}>
          <Text style={styles.statVal}>{stats.totalVersions}</Text>
          <Text style={styles.statLabel}>إصدارات</Text>
        </View>
        <View style={styles.statItem}>
          <Text style={[styles.statVal, { color: colors.success }]}>محمي</Text>
          <Text style={styles.statLabel}>الوضع</Text>
        </View>
      </View>

      {loading ? (
        <View style={styles.loading}>
          <ActivityIndicator color={colors.accent} />
        </View>
      ) : sessions.length === 0 ? (
        <View style={styles.empty}>
          <Ionicons name={"archive-outline" as IoniconsName} size={48} color={colors.text_muted} />
          <Text style={styles.emptyTitle}>لا يوجد سجل بعد</Text>
          <Text style={styles.emptyDesc}>سيظهر هنا تاريخ جميع التعديلات بعد استخدام Approval Workflow</Text>
        </View>
      ) : (
        <FlatList
          data={sessions}
          keyExtractor={s => s.sessionId}
          contentContainerStyle={styles.list}
          renderItem={({ item }) => (
            <SessionCard
              session={item}
              onDelete={handleDelete}
              onRestoreOriginal={handleRestoreOriginal}
              onRestoreVersion={handleRestoreVersion}
            />
          )}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container:   { flex: 1, backgroundColor: colors.bg_primary },
  header:      { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
                 paddingHorizontal: 16, paddingTop: 12, paddingBottom: 12,
                 borderBottomWidth: 1, borderBottomColor: colors.border },
  backBtn:     { padding: 6 },
  headerTitle: { fontSize: 16, fontWeight: '600', color: colors.text_primary },
  refreshBtn:  { padding: 6 },
  statsRow:    { flexDirection: 'row', backgroundColor: colors.bg_secondary,
                 margin: 16, borderRadius: 12, padding: 16,
                 borderWidth: 1, borderColor: colors.border },
  statItem:    { flex: 1, alignItems: 'center' },
  statVal:     { fontSize: 22, fontWeight: '700', color: colors.accent },
  statLabel:   { fontSize: 11, color: colors.text_secondary, marginTop: 2 },
  loading:     { flex: 1, justifyContent: 'center', alignItems: 'center' },
  list:        { padding: 16, paddingTop: 0, paddingBottom: 40 },
  empty:       { flex: 1, justifyContent: 'center', alignItems: 'center', gap: 12, padding: 40 },
  emptyTitle:  { fontSize: 16, fontWeight: '600', color: colors.text_secondary },
  emptyDesc:   { fontSize: 13, color: colors.text_muted, textAlign: 'center', lineHeight: 20 },
});
