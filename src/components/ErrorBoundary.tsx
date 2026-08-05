import React from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet,
  ScrollView, Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors }       from '../theme/colors';
import { IoniconsName } from '../types/icons';

// ===== Error State =====
interface ErrorState {
  hasError:   boolean;
  error:      Error | null;
  errorInfo:  React.ErrorInfo | null;
}

// ===== Props =====
interface Props {
  children:    React.ReactNode;
  fallbackTitle?: string;
}

// ===== ErrorBoundary Class Component =====
// Must be class — React hooks don't support componentDidCatch
export class ErrorBoundary extends React.Component<Props, ErrorState> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null, errorInfo: null };
  }

  static getDerivedStateFromError(error: Error): Partial<ErrorState> {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo): void {
    this.setState({ errorInfo });

    // In production: send to crash reporting (Sentry, Bugsnag, etc.)
    // crashReporter.captureException(error, { extra: errorInfo });
    console.error('[ErrorBoundary] Caught:', error.message);
    console.error('[ErrorBoundary] Stack:', errorInfo.componentStack);
  }

  handleReset = (): void => {
    this.setState({ hasError: false, error: null, errorInfo: null });
  };

  render(): React.ReactNode {
    if (!this.state.hasError) return this.props.children;

    const { error, errorInfo } = this.state;
    const title = this.props.fallbackTitle ?? 'حدث خطأ غير متوقع';

    return (
      <View style={styles.container}>
        <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>

          {/* Icon */}
          <View style={styles.iconWrapper}>
            <Ionicons name={"warning" as IoniconsName} size={56} color={colors.danger} />
          </View>

          {/* Title */}
          <Text style={styles.title}>{title}</Text>
          <Text style={styles.subtitle}>
            التطبيق واجه خطأً غير متوقع. كودك محفوظ — لا شيء ضاع.
          </Text>

          {/* Error message */}
          {error && (
            <View style={styles.errorBox}>
              <Text style={styles.errorLabel}>رسالة الخطأ</Text>
              <Text style={styles.errorText}>{error.message}</Text>
            </View>
          )}

          {/* Stack trace — dev only */}
          {__DEV__ && errorInfo && (
            <View style={styles.stackBox}>
              <Text style={styles.stackLabel}>Stack Trace (dev only)</Text>
              <ScrollView horizontal>
                <Text style={styles.stackText} numberOfLines={12}>
                  {errorInfo.componentStack}
                </Text>
              </ScrollView>
            </View>
          )}

          {/* Actions */}
          <TouchableOpacity style={styles.primaryBtn} onPress={this.handleReset}>
            <Ionicons name={"refresh" as IoniconsName} size={20} color="#fff" />
            <Text style={styles.primaryBtnText}>حاول مجدداً</Text>
          </TouchableOpacity>

          <Text style={styles.hint}>
            إذا تكرر الخطأ، أغلق التطبيق وأعد فتحه.
          </Text>

        </ScrollView>
      </View>
    );
  }
}

// ===== Screen-level wrapper (functional) =====
// استخدمه حول شاشات بعينها لعزل الأخطاء
export function ScreenErrorBoundary({
  children,
  screenName,
}: {
  children:   React.ReactNode;
  screenName: string;
}) {
  return (
    <ErrorBoundary fallbackTitle={`خطأ في شاشة ${screenName}`}>
      {children}
    </ErrorBoundary>
  );
}

const styles = StyleSheet.create({
  container:    { flex: 1, backgroundColor: colors.bg_primary },
  scroll:       { flexGrow: 1, alignItems: 'center', justifyContent: 'center',
                  padding: 24, paddingBottom: 48 },

  iconWrapper:  { width: 96, height: 96, borderRadius: 48,
                  backgroundColor: colors.danger + '11', alignItems: 'center',
                  justifyContent: 'center', marginBottom: 20,
                  borderWidth: 2, borderColor: colors.danger + '33' },

  title:        { fontSize: 22, fontWeight: '700', color: colors.text_primary,
                  textAlign: 'center', marginBottom: 10 },
  subtitle:     { fontSize: 14, color: colors.text_secondary, textAlign: 'center',
                  lineHeight: 22, marginBottom: 24 },

  errorBox:     { width: '100%', backgroundColor: colors.danger + '11',
                  borderRadius: 12, padding: 16, marginBottom: 16,
                  borderWidth: 1, borderColor: colors.danger + '33' },
  errorLabel:   { fontSize: 11, color: colors.danger, fontWeight: '700',
                  textTransform: 'uppercase', marginBottom: 6 },
  errorText:    { fontSize: 13, color: colors.text_primary,
                  fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
                  lineHeight: 20 },

  stackBox:     { width: '100%', backgroundColor: colors.bg_input,
                  borderRadius: 10, padding: 12, marginBottom: 20,
                  borderWidth: 1, borderColor: colors.border },
  stackLabel:   { fontSize: 10, color: colors.text_muted, marginBottom: 6,
                  textTransform: 'uppercase' },
  stackText:    { fontSize: 10, color: colors.text_muted,
                  fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
                  lineHeight: 16 },

  primaryBtn:   { flexDirection: 'row', alignItems: 'center', gap: 10,
                  backgroundColor: colors.accent, paddingHorizontal: 28,
                  paddingVertical: 14, borderRadius: 12, marginBottom: 16 },
  primaryBtnText:{ fontSize: 16, fontWeight: '700', color: '#fff' },

  hint:         { fontSize: 12, color: colors.text_muted, textAlign: 'center' },
});
