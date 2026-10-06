import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { Pressable, StyleSheet, TextInput, View, type TextInputProps } from 'react-native';
import { useSettings } from '@/lib/settings';
import { AppText } from './Text';
import { radius } from './theme';

interface FieldProps extends Omit<TextInputProps, 'style'> {
  label: string;
  /** Mensaje ya traducido. */
  error?: string;
  hint?: string;
  prefix?: string;
  password?: boolean;
}

export function Field({ label, error, hint, prefix, password, multiline, ...input }: FieldProps) {
  const { colors } = useSettings();
  const [focused, setFocused] = useState(false);
  const [hidden, setHidden] = useState(true);

  return (
    <View style={styles.wrapper}>
      <AppText variant="label" tone="muted" style={styles.label}>
        {label}
      </AppText>
      <View
        style={[
          styles.box,
          { backgroundColor: colors.surface, borderColor: error ? colors.danger : focused ? colors.gold : colors.border },
          multiline && styles.multiline,
        ]}>
        {prefix ? (
          <AppText tone="muted" variant="bodyStrong" style={styles.prefix}>
            {prefix}
          </AppText>
        ) : null}
        <TextInput
          {...input}
          multiline={multiline}
          secureTextEntry={password && hidden}
          onFocus={(e) => {
            setFocused(true);
            input.onFocus?.(e);
          }}
          onBlur={(e) => {
            setFocused(false);
            input.onBlur?.(e);
          }}
          placeholderTextColor={colors.textMuted}
          accessibilityLabel={label}
          style={[styles.input, { color: colors.text }, multiline && styles.inputMultiline]}
        />
        {password ? (
          <Pressable accessibilityRole="button" accessibilityLabel={hidden ? 'Show password' : 'Hide password'} onPress={() => setHidden((v) => !v)} hitSlop={10}>
            <Ionicons name={hidden ? 'eye-outline' : 'eye-off-outline'} size={20} color={colors.textMuted} />
          </Pressable>
        ) : null}
      </View>
      {error ? (
        <AppText variant="small" tone="danger" style={styles.message}>
          {error}
        </AppText>
      ) : hint ? (
        <AppText variant="small" tone="muted" style={styles.message}>
          {hint}
        </AppText>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: { marginBottom: 14 },
  label: { marginBottom: 6 },
  box: { flexDirection: 'row', alignItems: 'center', borderWidth: 1.5, borderRadius: radius.md, paddingHorizontal: 14, minHeight: 50 },
  multiline: { alignItems: 'flex-start', paddingVertical: 10 },
  prefix: { marginRight: 6 },
  input: { flex: 1, fontSize: 15.5, paddingVertical: 10, outlineStyle: 'none' } as never,
  inputMultiline: { minHeight: 84, textAlignVertical: 'top' },
  message: { marginTop: 5 },
});
