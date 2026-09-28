import { Ionicons } from '@expo/vector-icons';
import type { ReactNode } from 'react';
import { KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useSettings } from '@/lib/settings';
import { AppText } from './Text';
import { MAX_CONTENT_WIDTH } from './theme';

/**
 * Pantalla modal a pantalla completa para formularios y fichas (Android, iOS y Web): título, botón de cerrar, contenido con
 * scroll y una barra de acciones fija abajo. Es la base de los formularios de Citas, Mi página web y Servicios.
 */
export function FormModal({ title, subtitle, onClose, children, footer }: { title: string; subtitle?: string; onClose: () => void; children: ReactNode; footer?: ReactNode }) {
  const { colors, t } = useSettings();
  return (
    <Modal animationType="slide" onRequestClose={onClose}>
      <SafeAreaView style={[styles.root, { backgroundColor: colors.background }]}>
        <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <View style={[styles.column, styles.flex]}>
            <View style={styles.head}>
              <View style={styles.flex}>
                <AppText variant="title" numberOfLines={2} accessibilityRole="header">
                  {title}
                </AppText>
                {subtitle ? (
                  <AppText variant="small" tone="muted">
                    {subtitle}
                  </AppText>
                ) : null}
              </View>
              <Pressable accessibilityRole="button" accessibilityLabel={t('close')} onPress={onClose} hitSlop={10} style={[styles.close, { borderColor: colors.border }]}>
                <Ionicons name="close" size={22} color={colors.text} />
              </Pressable>
            </View>
            <ScrollView style={styles.flex} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
              {children}
            </ScrollView>
            {footer ? <View style={[styles.footer, { borderTopColor: colors.border }]}>{footer}</View> : null}
          </View>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  flex: { flex: 1 },
  column: { width: '100%', maxWidth: MAX_CONTENT_WIDTH, alignSelf: 'center' },
  head: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, paddingHorizontal: 20, paddingTop: 16, paddingBottom: 10 },
  close: { width: 44, height: 44, borderRadius: 14, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  content: { paddingHorizontal: 20, paddingBottom: 28, paddingTop: 4 },
  footer: { paddingHorizontal: 20, paddingTop: 10, paddingBottom: 12, gap: 8, borderTopWidth: StyleSheet.hairlineWidth },
});
