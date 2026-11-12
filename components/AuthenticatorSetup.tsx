import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, StyleSheet, TouchableOpacity, View } from 'react-native';
import QRCode from 'react-native-qrcode-svg';
import { useI18n } from '../i18n/LanguageContext';
import { useTheme } from '../theme/ThemeContext';
import {
  authenticatorUri,
  clearAuthenticator,
  confirmAuthenticator,
  createAuthenticatorSecret,
  isAuthenticatorEnabled,
  verifyAuthenticator,
} from '../services/authenticator';
import { fallbackAuthIfNeeded } from '../services/authPrefs';
import { hasSecurityConfirmMethod } from '../services/fundsConfirm';
import { useFundsConfirm } from './FundsConfirmHost';
import { copyText } from '../utils/copyText';
import { SecretInput } from './SecretInput';
import { AppText } from './AppText';

export const AuthenticatorSetup: React.FC<{
  account: string;
  onChanged?: () => void;
}> = ({ account, onChanged }) => {
  const { t } = useI18n();
  const { colors } = useTheme();
  const { confirmFunds } = useFundsConfirm();
  const [enabled, setEnabled] = useState(false);
  const [secret, setSecret] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [qrFailed, setQrFailed] = useState(false);
  const uri = secret ? authenticatorUri(secret, account) : '';

  useEffect(() => {
    let alive = true;
    isAuthenticatorEnabled()
      .then((on) => {
        if (alive) setEnabled(on);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  const requireIdentity = async (): Promise<boolean> => {
    if (!(await hasSecurityConfirmMethod())) {
      Alert.alert(t('error'), t('securityConfirmMissing'));
      return false;
    }
    return confirmFunds('security');
  };

  const beginSetup = async () => {
    if (busy) return;
    setBusy(true);
    try {
      if (!(await requireIdentity())) return;
      setQrFailed(false);
      setCode('');
      setSecret(await createAuthenticatorSecret());
    } finally {
      setBusy(false);
    }
  };

  const cancelReplace = () => {
    setSecret('');
    setCode('');
    setQrFailed(false);
  };

  const confirm = async () => {
    if (!secret || code.length !== 6) return;
    setBusy(true);
    try {
      const ok = await confirmAuthenticator(secret, code);
      if (!ok) {
        Alert.alert(t('error'), t('authenticatorWrong'));
        setCode('');
        return;
      }
      setEnabled(true);
      setSecret('');
      setCode('');
      setQrFailed(false);
      onChanged?.();
      Alert.alert(t('ready'), t('settingsSaved'));
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (code.length !== 6) {
      Alert.alert(t('error'), t('authenticatorWrong'));
      return;
    }
    setBusy(true);
    try {
      if (!(await verifyAuthenticator(code)).ok) {
        Alert.alert(t('error'), t('authenticatorWrong'));
        setCode('');
        return;
      }
      await clearAuthenticator();
      await fallbackAuthIfNeeded('authenticator');
      setEnabled(false);
      setCode('');
      setQrFailed(false);
      setSecret('');
      onChanged?.();
    } finally {
      setBusy(false);
    }
  };

  const copySecret = async () => {
    const result = await copyText(secret);
    if (result === 'copied') Alert.alert(t('ready'), t('authenticatorCopied'));
  };

  return (
    <View>
      <AppText style={[styles.lead, { color: colors.textMuted }]}>{t('authenticatorLead')}</AppText>
      <AppText style={[styles.status, { color: colors.text }]}>
        {enabled ? t('authenticatorOn') : t('authenticatorOff')}
      </AppText>
      {enabled && !secret ? (
        <AppText style={[styles.hint, { color: colors.textMuted }]}>
          {t('authenticatorActiveHint')}
        </AppText>
      ) : null}
      {secret && uri ? (
        <>
          <AppText style={[styles.label, { color: colors.text }]}>{t('authenticatorQr')}</AppText>
          <View
            collapsable={false}
            renderToHardwareTextureAndroid={false}
            style={styles.qrWrap}
            accessibilityLabel={t('authenticatorQr')}
          >
            {qrFailed ? (
              <AppText style={[styles.qrFail, { color: colors.text }]}>
                {t('authenticatorQrFail')}
              </AppText>
            ) : (
              <QRCode
                value={uri}
                size={200}
                ecl="M"
                backgroundColor="#fff"
                color="#111"
                onError={() => setQrFailed(true)}
              />
            )}
          </View>
          <AppText style={[styles.hint, { color: colors.textMuted }]}>
            {t('authenticatorQrHint')}
          </AppText>
          <AppText style={[styles.label, { color: colors.text }]}>
            {t('authenticatorSecret')}
          </AppText>
          <AppText
            selectable
            style={[styles.secret, { color: colors.text, backgroundColor: colors.surface }]}
          >
            {secret}
          </AppText>
          <TouchableOpacity
            onPress={() => void copySecret()}
            style={[styles.button, { backgroundColor: colors.primary }]}
          >
            <AppText style={styles.buttonText}>{t('copyAddress')}</AppText>
          </TouchableOpacity>
        </>
      ) : null}
      {secret || enabled ? (
        <SecretInput
          value={code}
          onChangeText={(value) => setCode(value.replace(/\D/g, '').slice(0, 6))}
          keyboardType="number-pad"
          maxLength={6}
          placeholder={t('authenticatorCode')}
        />
      ) : null}
      {!enabled && !secret ? (
        <TouchableOpacity
          disabled={busy}
          onPress={() => void beginSetup()}
          style={[styles.button, { backgroundColor: colors.connect }]}
        >
          {busy ? (
            <ActivityIndicator color="#111" />
          ) : (
            <AppText style={styles.buttonText}>{t('authenticatorActivate')}</AppText>
          )}
        </TouchableOpacity>
      ) : null}
      {secret ? (
        <>
          <TouchableOpacity
            disabled={busy || code.length !== 6}
            onPress={() => void confirm()}
            style={[
              styles.button,
              { backgroundColor: code.length === 6 ? colors.connect : colors.chip },
            ]}
          >
            {busy ? (
              <ActivityIndicator color="#111" />
            ) : (
              <AppText style={styles.buttonText}>{t('settingsSave')}</AppText>
            )}
          </TouchableOpacity>
          {enabled ? (
            <TouchableOpacity disabled={busy} onPress={cancelReplace}>
              <AppText style={[styles.cancel, { color: colors.textMuted }]}>
                {t('authenticatorCancelReplace')}
              </AppText>
            </TouchableOpacity>
          ) : null}
        </>
      ) : null}
      {enabled && !secret ? (
        <>
          <TouchableOpacity
            disabled={busy}
            onPress={() => void beginSetup()}
            style={[styles.button, { backgroundColor: colors.primary }]}
          >
            {busy ? (
              <ActivityIndicator color="#111" />
            ) : (
              <AppText style={styles.buttonText}>{t('authenticatorReplace')}</AppText>
            )}
          </TouchableOpacity>
          <TouchableOpacity
            disabled={busy || code.length !== 6}
            onPress={() => void remove()}
            style={[
              styles.button,
              styles.remove,
              (busy || code.length !== 6) && styles.removeDisabled,
            ]}
          >
            <AppText style={styles.buttonText}>{t('authenticatorRemove')}</AppText>
          </TouchableOpacity>
        </>
      ) : null}
    </View>
  );
};

const styles = StyleSheet.create({
  lead: {
    fontSize: 13,
    lineHeight: 18,
    marginBottom: 10,
  },
  status: {
    fontSize: 14,
    fontWeight: '700',
    marginBottom: 10,
  },
  label: {
    fontSize: 12,
    fontWeight: '600',
    marginBottom: 6,
  },
  hint: {
    fontSize: 12,
    lineHeight: 18,
    marginBottom: 12,
    textAlign: 'center',
  },
  qrWrap: {
    alignSelf: 'center',
    width: 232,
    height: 232,
    backgroundColor: '#fff',
    padding: 16,
    borderRadius: 12,
    marginBottom: 10,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#111',
  },
  qrFail: {
    fontSize: 13,
    lineHeight: 18,
    textAlign: 'center',
  },
  secret: {
    fontSize: 16,
    letterSpacing: 1,
    borderRadius: 12,
    padding: 12,
    marginBottom: 8,
    fontWeight: '700',
  },
  button: {
    borderRadius: 12,
    paddingVertical: 13,
    alignItems: 'center',
    marginBottom: 8,
  },
  buttonText: {
    color: '#111',
    fontSize: 15,
    fontWeight: '600',
  },
  cancel: {
    textAlign: 'center',
    fontSize: 14,
    fontWeight: '600',
    marginBottom: 12,
  },
  remove: {
    backgroundColor: '#B42318',
  },
  removeDisabled: {
    backgroundColor: '#9CA3AF',
  },
});
