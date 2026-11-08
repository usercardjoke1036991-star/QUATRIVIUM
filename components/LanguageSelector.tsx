import React, { useEffect, useState } from 'react';
import { Alert, View, StyleSheet, TouchableOpacity } from 'react-native';
import { LANGUAGES, type Lang } from '../i18n/languages';
import { useI18n } from '../i18n/LanguageContext';
import { useTheme } from '../theme/ThemeContext';
import { AppIcon } from './icons';
import { AppText } from './AppText';

export const LanguageSelector: React.FC<{ hideLabel?: boolean }> = ({ hideLabel = false }) => {
  const { lang, setLang, t, rtl } = useI18n();
  const { colors } = useTheme();
  const [draft, setDraft] = useState<Lang>(lang);

  useEffect(() => {
    setDraft(lang);
  }, [lang]);

  const dirty = draft !== lang;

  return (
    <View style={styles.wrap}>
      {!hideLabel && (
        <AppText style={[styles.label, rtl && styles.rtlText, { color: colors.textMuted }]}>
          {t('language')}
        </AppText>
      )}
      {LANGUAGES.map((item) => {
        const active = item.code === draft;
        return (
          <TouchableOpacity
            key={item.code}
            style={[
              styles.option,
              {
                backgroundColor: colors.card,
                borderColor: active ? colors.text : colors.border,
                flexDirection: rtl ? 'row-reverse' : 'row',
              },
            ]}
            onPress={() => setDraft(item.code)}
          >
            <AppText style={styles.flag}>{item.flag}</AppText>
            <View style={styles.optionTextWrap}>
              <AppText
                style={[
                  styles.optionText,
                  { color: colors.text, textAlign: rtl ? 'right' : 'left' },
                ]}
              >
                {item.native}
              </AppText>
              <AppText
                style={[
                  styles.optionSub,
                  { color: colors.textMuted, textAlign: rtl ? 'right' : 'left' },
                ]}
              >
                {item.english}
              </AppText>
            </View>
            {active ? <AppIcon name="check" size={16} color={colors.text} /> : null}
          </TouchableOpacity>
        );
      })}
      <TouchableOpacity
        disabled={!dirty}
        onPress={() => {
          if (!dirty) return;
          setLang(draft);
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
    alignSelf: 'stretch',
  },
  label: {
    fontSize: 12,
    marginBottom: 6,
    fontWeight: '600',
  },
  rtlText: {
    textAlign: 'right',
    writingDirection: 'rtl',
  },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 6,
  },
  flag: {
    fontSize: 22,
    marginRight: 10,
  },
  optionTextWrap: {
    flex: 1,
  },
  optionText: {
    fontSize: 15,
    fontWeight: '500',
  },
  optionSub: {
    fontSize: 11,
    marginTop: 1,
  },
  save: {
    marginTop: 8,
    borderRadius: 12,
    paddingVertical: 13,
    alignItems: 'center',
  },
  saveText: {
    color: '#111',
    fontSize: 15,
    fontWeight: '600',
  },
  disabled: {
    opacity: 0.45,
  },
});
