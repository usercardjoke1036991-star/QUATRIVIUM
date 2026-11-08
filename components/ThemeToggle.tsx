import React, { useEffect, useState } from 'react';
import { Alert, View, StyleSheet, TouchableOpacity } from 'react-native';
import { useI18n } from '../i18n/LanguageContext';
import { useTheme } from '../theme/ThemeContext';
import { palettes, type ThemePreference } from '../theme/palette';
import { AppIcon, type IconName } from './icons';
import { AppText } from './AppText';

const previews: Record<
  ThemePreference,
  { bg: string; fg: string; border: string; icon: IconName }
> = {
  light: {
    bg: palettes.light.card,
    fg: palettes.light.text,
    border: palettes.light.border,
    icon: 'sun',
  },
  dark: {
    bg: palettes.dark.card,
    fg: palettes.dark.text,
    border: palettes.dark.border,
    icon: 'moon',
  },
  system: {
    bg: palettes.light.card,
    fg: palettes.light.text,
    border: palettes.dark.border,
    icon: 'gear',
  },
  minimalist: {
    bg: palettes.minimalist.card,
    fg: palettes.minimalist.text,
    border: palettes.minimalist.border,
    icon: 'contrast',
  },
};

export const ThemeToggle: React.FC<{ hideLabel?: boolean }> = ({ hideLabel = false }) => {
  const { t } = useI18n();
  const { preference, setTheme, colors } = useTheme();
  const [draft, setDraft] = useState<ThemePreference>(preference);

  useEffect(() => {
    setDraft(preference);
  }, [preference]);

  const dirty = draft !== preference;

  const options: { value: ThemePreference; label: string }[] = [
    { value: 'system', label: t('themeSystem') },
    { value: 'light', label: t('themeLight') },
    { value: 'dark', label: t('themeDark') },
    { value: 'minimalist', label: t('themeMinimalist') },
  ];

  return (
    <View style={styles.wrap}>
      {!hideLabel && (
        <AppText style={[styles.label, { color: colors.textMuted }]}>{t('appearance')}</AppText>
      )}
      <View style={styles.row}>
        {options.map((item) => {
          const active = draft === item.value;
          const preview = previews[item.value];
          return (
            <TouchableOpacity
              key={item.value}
              style={[
                styles.option,
                {
                  backgroundColor: item.value === 'system' ? 'transparent' : preview.bg,
                  borderColor: active ? preview.fg : preview.border,
                  borderWidth: active ? 2 : 1,
                },
              ]}
              onPress={() => setDraft(item.value)}
              accessibilityRole="button"
              accessibilityState={{ selected: active }}
            >
              {item.value === 'system' ? (
                <View style={styles.split} pointerEvents="none">
                  <View style={[styles.splitHalf, { backgroundColor: palettes.light.bg }]} />
                  <View style={[styles.splitHalf, { backgroundColor: palettes.dark.bg }]} />
                </View>
              ) : null}
              <View style={item.value === 'system' ? styles.systemBadge : styles.stack}>
                <AppIcon name={preview.icon} size={16} color={preview.fg} />
                <AppText style={[styles.optionText, { color: preview.fg }]}>{item.label}</AppText>
              </View>
            </TouchableOpacity>
          );
        })}
      </View>
      <TouchableOpacity
        disabled={!dirty}
        onPress={() => {
          if (!dirty) return;
          setTheme(draft);
          Alert.alert(t('ready'), t('settingsSaved'));
        }}
        style={[styles.save, { backgroundColor: colors.connect }, !dirty && styles.disabled]}
        accessibilityRole="button"
        accessibilityState={{ disabled: !dirty }}
        accessibilityLabel={t('settingsSave')}
      >
        <AppText style={styles.saveText}>{t('settingsSave')}</AppText>
      </TouchableOpacity>
    </View>
  );
};

const styles = StyleSheet.create({
  wrap: {
    marginBottom: 8,
  },
  label: {
    fontSize: 12,
    marginBottom: 8,
    fontWeight: '500',
  },
  row: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  option: {
    width: '47%',
    flexGrow: 1,
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  stack: {
    alignItems: 'center',
    gap: 8,
  },
  split: {
    ...StyleSheet.absoluteFillObject,
    flexDirection: 'row',
  },
  splitHalf: {
    flex: 1,
  },
  optionText: {
    fontSize: 13,
    fontWeight: '600',
  },
  systemBadge: {
    alignItems: 'center',
    gap: 8,
    backgroundColor: 'rgba(244,244,241,0.92)',
    borderRadius: 10,
    paddingHorizontal: 8,
    paddingVertical: 6,
  },
  save: {
    marginTop: 12,
    borderRadius: 12,
    paddingVertical: 13,
    alignItems: 'center',
  },
  saveText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '600',
  },
  disabled: {
    opacity: 0.45,
  },
});
