import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  AppState,
  Linking,
  Platform,
  StyleSheet,
  Switch,
  TouchableOpacity,
  View,
} from 'react-native';
import { useI18n } from '../i18n/LanguageContext';
import { useTheme } from '../theme/ThemeContext';
import type { TranslationKey } from '../i18n/translations';
import type { BiometricKind } from '../utils/biometricStatus';
import {
  getBiometricStatus,
  isBiometricEnabled,
  toggleBiometric,
  type BiometricToggleReason,
} from '../services/appLock';
import { fallbackAuthIfNeeded } from '../services/authPrefs';
import { hasSecurityConfirmMethod } from '../services/fundsConfirm';
import { useFundsConfirm } from './FundsConfirmHost';
import { AppText } from './AppText';

function unlockLabel(kinds: BiometricKind[]): TranslationKey {
  const face = kinds.includes('facial');
  const finger = kinds.includes('fingerprint') || kinds.includes('iris');
  if (face && !finger) return 'lockBiometricFace';
  return 'lockBiometric';
}

function statusReasonKey(
  reason: 'ok' | 'native-missing' | 'no-hardware' | 'not-enrolled',
  enabled: boolean
): TranslationKey {
  if (enabled) return 'securityAccessKeyDone';
  if (reason === 'no-hardware') return 'lockBiometricNoHardware';
  if (reason === 'not-enrolled') return 'lockBiometricNotEnrolled';
  if (reason === 'native-missing') return 'lockBiometricNativeMissing';
  return 'lockBiometricLead';
}

function toggleErrorKey(reason: BiometricToggleReason): TranslationKey {
  if (reason === 'no-hardware') return 'lockBiometricNoHardware';
  if (reason === 'not-enrolled') return 'lockBiometricNotEnrolled';
  if (reason === 'native-missing') return 'lockBiometricNativeMissing';
  if (reason === 'no-session') return 'lockBiometricNoSession';
  if (reason === 'store-failed') return 'lockBiometricStoreFailed';
  return 'securityAccessKeyFailed';
}

async function openPhoneSecuritySettings(): Promise<void> {
  if (Platform.OS === 'android') {
    try {
      await Linking.sendIntent('android.settings.BIOMETRIC_ENROLL');
      return;
    } catch {
      try {
        await Linking.sendIntent('android.settings.SECURITY_SETTINGS');
        return;
      } catch {
        // Continúa a los ajustes de la app.
      }
    }
  }
  await Linking.openSettings();
}

export const BiometricLockSection: React.FC<{
  onChanged?: (enabled: boolean) => void;
  compact?: boolean;
}> = ({ onChanged, compact = false }) => {
  const { t } = useI18n();
  const { colors } = useTheme();
  const { confirmFunds } = useFundsConfirm();
  const [bioOn, setBioOn] = useState(false);
  const [draft, setDraft] = useState(false);
  const [busy, setBusy] = useState(false);
  const [kinds, setKinds] = useState<BiometricKind[]>([]);
  const [reason, setReason] = useState<'ok' | 'native-missing' | 'no-hardware' | 'not-enrolled'>(
    'ok'
  );
  const [available, setAvailable] = useState(false);

  const refresh = useCallback(async () => {
    const [status, enabled] = await Promise.all([getBiometricStatus(), isBiometricEnabled()]);
    setKinds(status.kinds);
    setReason(status.reason);
    setAvailable(status.available);
    setBioOn(enabled);
    setDraft(enabled);
  }, []);

  useEffect(() => {
    refresh().catch(() => {});
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') refresh().catch(() => {});
    });
    return () => sub.remove();
  }, [refresh]);

  const dirty = draft !== bioOn;

  const save = async () => {
    if (busy || !dirty) return;
    setBusy(true);
    try {
      if (!(await hasSecurityConfirmMethod())) {
        Alert.alert(t('error'), t('securityConfirmMissing'));
        await refresh();
        return;
      }
      if (!(await confirmFunds('security'))) {
        await refresh();
        return;
      }
      const result = await toggleBiometric(draft);
      if (!result.ok) {
        Alert.alert(t('securityFingerprint'), t(toggleErrorKey(result.reason)));
        await refresh();
        return;
      }
      setBioOn(draft);
      if (!draft) await fallbackAuthIfNeeded('biometric');
      onChanged?.(draft);
      Alert.alert(t('ready'), t('settingsSaved'));
    } finally {
      setBusy(false);
    }
  };

  const hint = t(statusReasonKey(reason, bioOn));

  return (
    <View>
      {compact ? null : (
        <AppText style={[styles.section, { color: colors.text }]}>
          {t('lockBiometricSection')}
        </AppText>
      )}
      {compact ? null : (
        <AppText style={[styles.lead, { color: colors.textMuted }]}>
          {t('lockBiometricLead')}
        </AppText>
      )}
      {reason === 'ok' ? null : (
        <AppText style={[styles.note, { color: colors.warnText }]}>{hint}</AppText>
      )}
      {reason === 'no-hardware' ? (
        <AppText style={[styles.note, { color: colors.warnText }]}>
          {t('walletWrapSoftwareNote')}
        </AppText>
      ) : null}
      {available || bioOn ? (
        <>
          <View style={styles.switchRow}>
            <AppText style={[styles.switchLabel, { color: colors.text }]}>
              {t(unlockLabel(kinds))}
            </AppText>
            <Switch
              value={draft}
              onValueChange={setDraft}
              trackColor={{ false: colors.border, true: colors.primary }}
              thumbColor="#fff"
              accessibilityLabel={t(unlockLabel(kinds))}
            />
          </View>
          <TouchableOpacity
            disabled={busy || !dirty}
            onPress={() => void save()}
            style={[
              styles.button,
              { backgroundColor: colors.connect },
              (busy || !dirty) && { opacity: 0.45 },
            ]}
            accessibilityRole="button"
            accessibilityState={{ disabled: busy || !dirty }}
            accessibilityLabel={t('settingsSave')}
          >
            {busy ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <AppText style={styles.buttonText}>{t('settingsSave')}</AppText>
            )}
          </TouchableOpacity>
        </>
      ) : reason === 'not-enrolled' ? (
        <TouchableOpacity
          onPress={() => void openPhoneSecuritySettings()}
          style={[styles.button, { backgroundColor: colors.connect }]}
          accessibilityRole="button"
          accessibilityLabel={t('lockBiometricOpenSettings')}
        >
          <AppText style={styles.buttonText}>{t('lockBiometricOpenSettings')}</AppText>
        </TouchableOpacity>
      ) : null}
    </View>
  );
};

const styles = StyleSheet.create({
  section: {
    fontSize: 16,
    fontWeight: '700',
    marginTop: 8,
    marginBottom: 8,
  },
  lead: {
    fontSize: 13,
    lineHeight: 18,
    marginBottom: 8,
  },
  note: {
    fontSize: 12,
    lineHeight: 17,
    marginBottom: 10,
  },
  switchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    marginBottom: 12,
  },
  switchLabel: {
    flex: 1,
    fontSize: 14,
    fontWeight: '600',
  },
  button: {
    borderRadius: 12,
    paddingVertical: 13,
    alignItems: 'center',
    marginBottom: 8,
  },
  buttonText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '600',
  },
});
