import React, { useEffect, useMemo, useState } from 'react';
import { Alert, StyleSheet, Switch, TouchableOpacity, View } from 'react-native';
import { useI18n } from '../i18n/LanguageContext';
import { useTheme } from '../theme/ThemeContext';
import type { TranslationKey } from '../i18n/translations';
import {
  ACTION_AUTH_METHODS,
  AUTH_PURPOSES,
  getAvailableMethods,
  loadAuthPrefs,
  saveAuthPrefs,
  type AuthMethod,
  type AuthPrefs,
  type AuthPurpose,
} from '../services/authPrefs';
import { hasSecurityConfirmMethod } from '../services/fundsConfirm';
import { useFundsConfirm } from './FundsConfirmHost';
import { AppText } from './AppText';
import { hasUnsavedChanges } from '../utils/unsavedChanges';

function methodKey(method: AuthMethod): TranslationKey {
  if (method === 'pin') return 'authMethodPin';
  if (method === 'authenticator') return 'authMethodAuthenticator';
  if (method === 'biometric') return 'authMethodBiometric';
  if (method === 'email') return 'authMethodEmail';
  return 'authMethodPassword';
}

function purposeKey(purpose: AuthPurpose): TranslationKey {
  if (purpose === 'unlock') return 'authUnlock';
  if (purpose === 'funds') return 'authFunds';
  if (purpose === 'loanRequest') return 'loanConfirmRequest';
  return 'loanConfirmPay';
}

function emptyPrefs(): AuthPrefs {
  return {
    signin: { on: false, methods: [], method: 'password', primaryOnly: true },
    unlock: { on: true, methods: ['password'], method: 'password', primaryOnly: true },
    funds: { on: false, methods: [], method: 'password', primaryOnly: true },
    loanRequest: { on: false, methods: [], method: 'password', primaryOnly: true },
    loanPay: { on: false, methods: [], method: 'password', primaryOnly: true },
  };
}

export const AuthMethodPicker: React.FC<{ onChanged?: () => void }> = ({ onChanged }) => {
  const { t } = useI18n();
  const { colors } = useTheme();
  const { confirmFunds } = useFundsConfirm();
  const empty = useMemo(() => emptyPrefs(), []);
  const [draft, setDraft] = useState<AuthPrefs>(empty);
  const [saved, setSaved] = useState<AuthPrefs>(empty);
  const [available, setAvailable] = useState<AuthMethod[]>(['password']);
  const [busy, setBusy] = useState(false);
  const dirty = hasUnsavedChanges(draft, saved);

  useEffect(() => {
    Promise.all([loadAuthPrefs(), getAvailableMethods()])
      .then(([prefs, methods]) => {
        setDraft(prefs);
        setSaved(prefs);
        setAvailable(methods);
      })
      .catch(() => {});
  }, []);

  const setOn = (purpose: AuthPurpose, on: boolean) => {
    setDraft((current) => ({
      ...current,
      [purpose]: { ...current[purpose], on },
    }));
  };

  const toggleMethod = (purpose: AuthPurpose, method: AuthMethod) => {
    setDraft((current) => {
      const selected = current[purpose].methods.filter((item) =>
        ACTION_AUTH_METHODS.includes(item)
      );
      const next = selected.includes(method)
        ? selected.filter((item) => item !== method)
        : [...selected, method];
      return {
        ...current,
        [purpose]: {
          ...current[purpose],
          methods: next,
          method: next[0] || 'password',
          primaryOnly: next.length <= 1,
        },
      };
    });
  };

  const save = async () => {
    if (busy || !dirty) return;
    const missing = AUTH_PURPOSES.filter(
      (purpose) => purpose !== 'signin' && draft[purpose].on && !draft[purpose].methods.length
    );
    if (missing.length) {
      Alert.alert(t('error'), t('authMethodsPickMany'));
      return;
    }
    setBusy(true);
    try {
      if (!(await hasSecurityConfirmMethod())) {
        Alert.alert(t('error'), t('securityConfirmMissing'));
        return;
      }
      if (!(await confirmFunds('security'))) return;
      const next = await saveAuthPrefs(draft);
      setDraft(next);
      setSaved(next);
      onChanged?.();
      Alert.alert(t('ready'), t('settingsSaved'));
    } catch {
      Alert.alert(t('error'), t('authNeedSetup'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <View>
      <AppText style={[styles.lead, { color: colors.textMuted }]}>{t('authMethodsLead')}</AppText>
      {AUTH_PURPOSES.filter((purpose) => purpose !== 'signin').map((purpose) => {
        const slot = draft[purpose];
        return (
          <View
            key={purpose}
            style={[styles.block, { borderColor: colors.border, backgroundColor: colors.surface }]}
          >
            <View style={styles.header}>
              <AppText style={[styles.title, { color: colors.text }]}>
                {t(purposeKey(purpose))}
              </AppText>
              <Switch
                value={slot.on}
                onValueChange={(value) => setOn(purpose, value)}
                trackColor={{ false: colors.border, true: colors.primary }}
                thumbColor="#fff"
                accessibilityLabel={t(purposeKey(purpose))}
              />
            </View>
            <View style={[styles.row, !slot.on && { opacity: 0.45 }]}>
              {ACTION_AUTH_METHODS.map((method) => {
                const selected = slot.methods.includes(method);
                const ready = available.includes(method);
                return (
                  <TouchableOpacity
                    key={method}
                    onPress={() => toggleMethod(purpose, method)}
                    style={[
                      styles.chip,
                      { borderColor: colors.border, backgroundColor: colors.card },
                      selected &&
                        slot.on && { borderColor: colors.primary, backgroundColor: colors.chip },
                    ]}
                    accessibilityRole="button"
                    accessibilityState={{ selected: selected && slot.on }}
                  >
                    <AppText
                      style={[styles.chipText, { color: ready ? colors.text : colors.textMuted }]}
                    >
                      {t(methodKey(method))}
                    </AppText>
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>
        );
      })}
      <TouchableOpacity
        disabled={busy || !dirty}
        onPress={() => void save()}
        style={[
          styles.save,
          { backgroundColor: colors.connect },
          (busy || !dirty) && { opacity: 0.45 },
        ]}
        accessibilityRole="button"
        accessibilityState={{ disabled: busy || !dirty }}
        accessibilityLabel={t('settingsSave')}
      >
        <AppText style={styles.saveText}>{t('settingsSave')}</AppText>
      </TouchableOpacity>
    </View>
  );
};

const styles = StyleSheet.create({
  lead: {
    fontSize: 13,
    lineHeight: 18,
    marginBottom: 12,
  },
  block: {
    borderWidth: 1,
    borderRadius: 12,
    padding: 12,
    marginBottom: 10,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  title: {
    flex: 1,
    fontSize: 14,
    fontWeight: '700',
  },
  row: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 10,
  },
  chip: {
    borderWidth: 1,
    borderRadius: 16,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  chipText: {
    fontSize: 13,
    fontWeight: '600',
  },
  save: {
    borderRadius: 12,
    paddingVertical: 13,
    alignItems: 'center',
    marginTop: 4,
  },
  saveText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '600',
  },
});
