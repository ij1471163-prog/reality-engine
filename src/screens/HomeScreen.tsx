import React from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet,
  ScrollView,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors }         from '../theme/colors';
import { IoniconsName }   from '../types/icons';
import { HomeScreenProps, RootStackParamList } from '../types/navigation';



interface Feature {
  icon:        IoniconsName;
  color:       string;
  title:       string;
  subtitle:    string;
  description: string;
  screen:      keyof RootStackParamList;
  mode:        'security' | 'stubs' | 'full';
}

const FEATURES: Feature[] = [
  {
    icon: 'shield-checkmark' as IoniconsName,
    color: colors.success,
    title: 'Security Scanner',
    subtitle: 'فحص أمني شامل للكود',
    description: '18+ قاعدة أمنية • كشف secrets • SQL injection • تشفير ضعيف',
    screen: 'Scanner',
    mode: 'security',
  },
  {
    icon: 'code-slash',
    color: colors.purple,
    title: 'Stub Detector',
    subtitle: 'اكتشاف الدوال الناقصة',
    description: 'pass • NotImplementedError • return فاضي • اقتراح تنفيذ',
    screen: 'Scanner',
    mode: 'stubs',
  },
  {
    icon: 'flash',
    color: colors.warning,
    title: 'Full Analysis',
    subtitle: 'فحص شامل مرة واحدة',
    description: 'Security + Stub + تقرير كامل مع نقاط',
    screen: 'Scanner',
    mode: 'full',
  },
];

const STATS = [
  { value: '18+', label: 'قاعدة أمنية' },
  { value: '12+', label: 'نمط stub' },
  { value: '100%', label: 'Offline' },
];

export default function HomeScreen({ navigation }: HomeScreenProps) {
  return (
    <View style={styles.container}>
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>

        {/* Header */}
        <View style={styles.header}>
          <View style={styles.logoRow}>
            <Ionicons name={"analytics" as IoniconsName} size={32} color={colors.accent} />
            <Text style={styles.logoText}>Reality Engine</Text>
          </View>
          <Text style={styles.tagline}>محلل الكود الذكي • أمني • بدون إنترنت</Text>
        </View>

        {/* Stats bar */}
        <View style={styles.statsRow}>
          {STATS.map((s, i) => (
            <View key={i} style={styles.statItem}>
              <Text style={styles.statValue}>{s.value}</Text>
              <Text style={styles.statLabel}>{s.label}</Text>
            </View>
          ))}
        </View>

        {/* Feature cards */}
        <Text style={styles.sectionTitle}>اختر وضع التحليل</Text>

        {FEATURES.map((feat, i) => (
          <TouchableOpacity
            key={i}
            style={styles.card}
            activeOpacity={0.8}
            onPress={() => navigation.navigate('Scanner', { mode: feat.mode })}
          >
            <View style={[styles.cardIcon, { backgroundColor: feat.color + '22' }]}>
              <Ionicons name={feat.icon} size={26} color={feat.color} />
            </View>

            <View style={styles.cardContent}>
              <Text style={styles.cardTitle}>{feat.title}</Text>
              <Text style={styles.cardSubtitle}>{feat.subtitle}</Text>
              <Text style={styles.cardDesc}>{feat.description}</Text>
            </View>

            <Ionicons name={"chevron-forward" as IoniconsName} size={20} color={colors.text_muted} />
          </TouchableOpacity>
        ))}

        {/* Recent scans placeholder */}
        <View style={styles.tipBox}>
          <Ionicons name={"bulb-outline" as IoniconsName} size={18} color={colors.warning} />
          <Text style={styles.tipText}>
            الأداة تعمل بالكامل بدون إنترنت — كودك يبقى عندك فقط
          </Text>
        </View>

      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container:   { flex: 1, backgroundColor: colors.bg_primary },
  scroll:      { padding: 20, paddingBottom: 40 },

  header:      { alignItems: 'center', paddingVertical: 28 },
  logoRow:     { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 8 },
  logoText:    { fontSize: 26, fontWeight: '700', color: colors.text_primary, letterSpacing: 0.5 },
  tagline:     { fontSize: 13, color: colors.text_secondary, textAlign: 'center' },

  statsRow:    {
    flexDirection: 'row', backgroundColor: colors.bg_secondary,
    borderRadius: 12, padding: 16, marginBottom: 28,
    borderWidth: 1, borderColor: colors.border,
  },
  statItem:    { flex: 1, alignItems: 'center' },
  statValue:   { fontSize: 22, fontWeight: '700', color: colors.accent },
  statLabel:   { fontSize: 11, color: colors.text_secondary, marginTop: 2 },

  sectionTitle: { fontSize: 13, color: colors.text_muted, marginBottom: 12, textTransform: 'uppercase', letterSpacing: 1 },

  card: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: colors.bg_card,
    borderRadius: 14, padding: 16, marginBottom: 12,
    borderWidth: 1, borderColor: colors.border,
    gap: 14,
  },
  cardIcon:    { width: 50, height: 50, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  cardContent: { flex: 1 },
  cardTitle:   { fontSize: 16, fontWeight: '600', color: colors.text_primary, marginBottom: 2 },
  cardSubtitle:{ fontSize: 13, color: colors.accent, marginBottom: 4 },
  cardDesc:    { fontSize: 11, color: colors.text_secondary, lineHeight: 16 },

  tipBox: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: colors.warning + '11',
    borderRadius: 10, padding: 14, marginTop: 8,
    borderWidth: 1, borderColor: colors.warning + '33',
  },
  tipText: { flex: 1, fontSize: 12, color: colors.text_secondary, lineHeight: 18 },
});
