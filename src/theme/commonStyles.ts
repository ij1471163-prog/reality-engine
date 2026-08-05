/**
 * commonStyles — أنماط مشتركة بين جميع الشاشات
 * تقلل التكرار وتضمن تناسق UI
 */
import { StyleSheet } from 'react-native';
import { colors }     from '../theme/colors';

export const commonStyles = StyleSheet.create({
  // ── Containers ─────────────────────────────────────────
  screen: {
    flex: 1,
    backgroundColor: colors.bg_primary,
  },
  scrollContent: {
    padding: 16,
    paddingBottom: 48,
  },

  // ── Header ─────────────────────────────────────────────
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  headerTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.text_primary,
  },
  backBtn: {
    padding: 6,
  },

  // ── Cards ──────────────────────────────────────────────
  card: {
    backgroundColor: colors.bg_card,
    borderRadius: 14,
    padding: 14,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: colors.border,
  },
  cardBorderLeft: {
    borderLeftWidth: 3,
  },

  // ── Section title ──────────────────────────────────────
  sectionTitle: {
    fontSize: 11,
    color: colors.text_muted,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginBottom: 10,
  },

  // ── Snippet box ────────────────────────────────────────
  snippetBox: {
    backgroundColor: colors.bg_input,
    borderRadius: 8,
    padding: 10,
    borderWidth: 1,
    borderColor: colors.border,
  },

  // ── Buttons ────────────────────────────────────────────
  primaryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    borderRadius: 14,
    paddingVertical: 16,
  },
  primaryBtnText: {
    fontSize: 16,
    fontWeight: '700',
    color: '#fff',
  },
  secondaryBtn: {
    alignItems: 'center',
    paddingVertical: 14,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
  },
  secondaryBtnText: {
    fontSize: 14,
    color: colors.text_secondary,
  },

  // ── Loading ────────────────────────────────────────────
  loadingScreen: {
    flex: 1,
    backgroundColor: colors.bg_primary,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 14,
  },
  loadingText: {
    fontSize: 13,
    color: colors.text_secondary,
  },

  // ── Empty state ────────────────────────────────────────
  emptyState: {
    alignItems: 'center',
    paddingVertical: 60,
    gap: 12,
  },
  emptyTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.text_secondary,
  },
  emptySubtitle: {
    fontSize: 13,
    color: colors.text_muted,
    textAlign: 'center',
    lineHeight: 20,
  },

  // ── Info rows ──────────────────────────────────────────
  infoRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
  },
  hint: {
    textAlign: 'center',
    fontSize: 11,
    color: colors.text_muted,
  },
});
