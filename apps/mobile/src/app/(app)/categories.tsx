import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { Pressable, View } from 'react-native';
import { api } from '@/lib/api';
import { apiErrors } from '@/lib/forms';
import { useCategories, useInvalidateCatalog } from '@/lib/queries';
import { useSettings } from '@/lib/settings';
import { Button } from '@/ui/Button';
import { useDialogs } from '@/ui/Dialogs';
import { Field } from '@/ui/Field';
import { Card, EmptyState } from '@/ui/Kit';
import { Header, Screen } from '@/ui/Screen';
import { AppText } from '@/ui/Text';

export default function Categories() {
  const { t, colors } = useSettings();
  const { confirm } = useDialogs();
  const categories = useCategories();
  const invalidate = useInvalidateCatalog();
  const [draft, setDraft] = useState('');
  const [editing, setEditing] = useState<string | null>(null);
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  async function run(action: () => Promise<unknown>) {
    setBusy(true);
    setError(undefined);
    try {
      await action();
      await invalidate();
      return true;
    } catch (e) {
      const result = apiErrors(e, t);
      setError(result.general ?? Object.values(result.fields)[0]);
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function submit() {
    const name = draft.trim();
    if (!name) return setError(t('required'));
    const ok = await run(() => (editing ? api.renameCategory(editing, name) : api.addCategory(name)));
    if (ok) {
      setDraft('');
      setEditing(null);
    }
  }

  async function remove(id: string, name: string) {
    if (await confirm({ title: t('confirm_delete_title'), message: name, confirmLabel: t('delete'), destructive: true })) await run(() => api.deleteCategory(id));
  }

  return (
    <Screen header={<Header title={t('manage_categories')} />}>
      <Field label={editing ? t('rename_category') : t('new_category')} value={draft} onChangeText={setDraft} error={error} maxLength={40} onSubmitEditing={submit} />
      <View style={{ flexDirection: 'row', gap: 10 }}>
        <Button label={editing ? t('save') : t('add')} onPress={submit} loading={busy} compact style={{ flex: 1 }} />
        {editing ? (
          <Button
            label={t('cancel')}
            variant="ghost"
            compact
            onPress={() => {
              setEditing(null);
              setDraft('');
              setError(undefined);
            }}
          />
        ) : null}
      </View>

      <View style={{ height: 18 }} />
      {categories.data?.length === 0 ? (
        <EmptyState icon="pricetags-outline" message={t('create_category_first')} />
      ) : (
        <Card>
          {categories.data?.map((category, index) => (
            <View key={category.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 10, borderTopWidth: index === 0 ? 0 : 1, borderTopColor: colors.border }}>
              <View style={{ flex: 1 }}>
                <AppText variant="bodyStrong">{category.name}</AppText>
                <AppText variant="small" tone="muted">
                  {category.itemCount}
                </AppText>
              </View>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t('edit')}
                hitSlop={8}
                onPress={() => {
                  setEditing(category.id);
                  setDraft(category.name);
                  setError(undefined);
                }}>
                <Ionicons name="create-outline" size={20} color={colors.gold} />
              </Pressable>
              <Pressable accessibilityRole="button" accessibilityLabel={t('delete')} hitSlop={8} onPress={() => remove(category.id, category.name)}>
                <Ionicons name="trash-outline" size={20} color={colors.danger} />
              </Pressable>
            </View>
          ))}
        </Card>
      )}
    </Screen>
  );
}
