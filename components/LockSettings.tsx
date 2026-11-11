import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, StyleSheet, TouchableOpacity, View } from 'react-native';
import { useI18n } from '../i18n/LanguageContext';
import { useTheme } from '../theme/ThemeContext';
import {
  PASSWORD_LENGTH,
  changePassword,
  changePin,
  clearPin,
  isPasswordSet,
  isPinSet,
  isValidMasterPassword,
  setPassword,
  setPin,
} from '../services/appLock';
import { isWeakPin } from '../utils/pinPolicy';
import { fallbackAuthIfNeeded } from '../services/authPrefs';
import { hasSecurityConfirmMethod } from '../services/fundsConfirm';
import { useFundsConfirm } from './FundsConfirmHost';
import { SecretInput } from './SecretInput';
import { AppText } from './AppText';

type LockSettingsMode = 'pin' | 'password';

export const LockSettings: React.FC<{
  mode?: LockSettingsMode;
  onChanged?: () => void;
}> = ({ mode = 'pin', onChanged }) => {
  const { t } = useI18n();
  const { colors } = useTheme();
  const { confirmFunds } = useFundsConfirm();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [currentPassword, setCurrentPassword] = useState('');
  const [nextPassword, setNextPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [message, setMessage] = useState('');
  const [passwordMessage, setPasswordMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [passwordBusy, setPasswordBusy] = useState(false);
  const [hasPin, setHasPin] = useState(false);
  const [hasPassword, setHasPassword] = useState(false);

  const refresh = () => {
    isPinSet()
      .then(setHasPin)
      .catch(() => {});
    isPasswordSet()
      .then(setHasPassword)
      .catch(() => {});
  };

  useEffect(() => {
    refresh();
  }, []);

  const savePin = async () => {
    if (next !== confirm) {
      setMessage(t('lockPinMismatch'));
      return;
    }
    if (isWeakPin(next)) {
      setMessage(t('lockPinWeak'));
      return;
    }
    setBusy(true);
    try {
      if (hasPin || (await hasSecurityConfirmMethod())) {
        if (!(await confirmFunds('security'))) return;
      }
      if (!hasPin) {
        await setPin(next);
        setHasPin(true);
      } else {
        const ok = await changePin(current, next);
        if (!ok) {
          setMessage(t('lockPinWrong'));
          return;
        }
      }
      setCurrent('');
      setNext('');
      setConfirm('');
      setMessage(t('lockPinChanged'));
      onChanged?.();
      Alert.alert(t('ready'), t('settingsSaved'));
    } catch (error) {
      setMessage(
        error instanceof Error && error.message === 'weak-pin'
          ? t('lockPinWeak')
          : error instanceof Error && error.message === 'pbkdf2-missing'
            ? t('lockKdfMissing')
            : error instanceof Error && error.message === 'locked'
              ? t('lockUnlockLead')
              : t('lockPinWrong')
      );
    } finally {
      setBusy(false);
    }
  };

  const removePin = async () => {
    if (current.length !== 6) {
      setMessage(t('lockPinWrong'));
      return;
    }
    Alert.alert(t('lockRemovePin'), t('lockRemovePinConfirm'), [
      { text: t('cancel'), style: 'cancel' },
      {
        text: t('lockRemovePin'),
        style: 'destructive',
        onPress: async () => {
          setBusy(true);
          try {
            if (!(await confirmFunds('security'))) return;
            const ok = await clearPin(current);
            if (!ok) {
              setMessage(t('lockPinWrong'));
              return;
            }
            setHasPin(false);
            setCurrent('');
            setNext('');
            setConfirm('');
            await fallbackAuthIfNeeded('pin');
            setMessage(t('lockPinRemoved'));
            onChanged?.();
          } catch (error) {
            setMessage(
              error instanceof Error && error.message === 'need-password'
                ? t('lockPinNeedPassword')
                : t('lockPinWrong')
            );
          } finally {
            setBusy(false);
          }
        },
      },
    ]);
  };

  const passwordFail = (error: unknown) => {
    const code = error instanceof Error ? error.message : '';
    if (code === 'password-key') return t('lockPasswordPrivateKey');
    if (code === 'pbkdf2-missing') return t('lockKdfMissing');
    return t('lockPasswordWeak');
  };

  const savePassword = async () => {
    if (nextPassword !== confirmPassword) {
      setPasswordMessage(t('lockPasswordMismatch'));
      return;
    }
    setPasswordBusy(true);
    try {
      if (hasPassword || (await hasSecurityConfirmMethod())) {
        if (!(await confirmFunds('security'))) return;
      }
      if (!hasPassword) {
        await setPassword(nextPassword, current || undefined);
        setHasPassword(true);
      } else {
        const ok = await changePassword(currentPassword, nextPassword, current || undefined);
        if (!ok) {
          setPasswordMessage(t('lockPasswordWrong'));
          return;
        }
      }
      setCurrentPassword('');
      setNextPassword('');
      setConfirmPassword('');
      setPasswordMessage(t('lockPasswordChanged'));
      onChanged?.();
      Alert.alert(t('ready'), t('settingsSaved'));
    } catch (error) {
      const code = error instanceof Error ? error.message : '';
      setPasswordMessage(code === 'wrong-pin' ? t('lockPinWrong') : passwordFail(error));
    } finally {
      setPasswordBusy(false);
    }
  };

  const pinBlock = (
    <View>
      {hasPin ? (
        <>
          <AppText style={[styles.label, { color: colors.text }]}>{t('lockCurrentPin')}</AppText>
          <SecretInput
            value={current}
            onChangeText={(value) => setCurrent(value.replace(/\D/g, '').slice(0, 6))}
            keyboardType="number-pad"
            maxLength={6}
            placeholder="••••••"
          />
        </>
      ) : null}
      <AppText style={[styles.label, { color: colors.text }]}>{t('lockNewPin')}</AppText>
      <SecretInput
        value={next}
        onChangeText={(value) => setNext(value.replace(/\D/g, '').slice(0, 6))}
        keyboardType="number-pad"
        maxLength={6}
        startVisible
        placeholder="••••••"
      />
      <AppText style={[styles.label, { color: colors.text }]}>{t('lockConfirmPin')}</AppText>
      <SecretInput
        value={confirm}
        onChangeText={(value) => setConfirm(value.replace(/\D/g, '').slice(0, 6))}
        keyboardType="number-pad"
        maxLength={6}
        startVisible
        placeholder="••••••"
      />
      <TouchableOpacity
        disabled={
          busy || (hasPin && current.length !== 6) || next.length !== 6 || confirm.length !== 6
        }
        onPress={savePin}
        style={[
          styles.button,
          { backgroundColor: colors.connect },
          (busy || (hasPin && current.length !== 6) || next.length !== 6) && {
            backgroundColor: colors.chip,
          },
        ]}
      >
        {busy ? (
          <>
            <ActivityIndicator color="#111" />
            <AppText style={styles.buttonText}>{t('lockKdfWait')}</AppText>
          </>
        ) : (
          <AppText style={styles.buttonText}>{t('settingsSave')}</AppText>
        )}
      </TouchableOpacity>
      {hasPin ? (
        <TouchableOpacity
          disabled={busy || current.length !== 6}
          onPress={() => void removePin()}
          style={[
            styles.button,
            styles.remove,
            (busy || current.length !== 6) && styles.removeDisabled,
          ]}
        >
          <AppText style={styles.buttonText}>{t('lockRemovePin')}</AppText>
        </TouchableOpacity>
      ) : null}
      {message ? (
        <AppText style={[styles.note, { color: colors.textMuted }]}>{message}</AppText>
      ) : null}
    </View>
  );

  const passwordBlock = hasPassword ? (
    <View style={[styles.locked, { borderColor: colors.border, backgroundColor: colors.surface }]}>
      <AppText style={[styles.lockedTitle, { color: colors.text }]}>
        {t('lockPasswordTitle')}
      </AppText>
      <AppText style={[styles.note, { color: colors.textMuted, marginBottom: 0 }]}>
        {t('lockPasswordLocked')}
      </AppText>
    </View>
  ) : (
    <View>
      {hasPin ? (
        <>
          <AppText style={[styles.label, { color: colors.text }]}>{t('lockCurrentPin')}</AppText>
          <SecretInput
            value={current}
            onChangeText={(value) => setCurrent(value.replace(/\D/g, '').slice(0, 6))}
            keyboardType="number-pad"
            maxLength={6}
            placeholder="••••••"
          />
        </>
      ) : null}
      <AppText style={[styles.label, { color: colors.text }]}>{t('lockNewPassword')}</AppText>
      <SecretInput
        value={nextPassword}
        onChangeText={(value) =>
          setNextPassword(value.replace(/\s/g, '').slice(0, PASSWORD_LENGTH))
        }
        maxLength={PASSWORD_LENGTH}
      />
      <AppText style={[styles.counter, { color: colors.textMuted }]}>
        {t('lockPasswordCount', { count: nextPassword.length })}
      </AppText>
      <AppText style={[styles.label, { color: colors.text }]}>{t('lockPasswordConfirm')}</AppText>
      <SecretInput
        value={confirmPassword}
        onChangeText={(value) =>
          setConfirmPassword(value.replace(/\s/g, '').slice(0, PASSWORD_LENGTH))
        }
        maxLength={PASSWORD_LENGTH}
      />
      <TouchableOpacity
        disabled={
          passwordBusy ||
          !isValidMasterPassword(nextPassword) ||
          confirmPassword !== nextPassword ||
          (hasPassword && !currentPassword) ||
          (hasPin && current.length !== 6)
        }
        onPress={() => void savePassword()}
        style={[styles.button, { backgroundColor: colors.connect }]}
      >
        {passwordBusy ? (
          <>
            <ActivityIndicator color="#111" />
            <AppText style={styles.buttonText}>{t('lockKdfWait')}</AppText>
          </>
        ) : (
          <AppText style={styles.buttonText}>{t('settingsSave')}</AppText>
        )}
      </TouchableOpacity>
      {passwordMessage ? (
        <AppText style={[styles.note, { color: colors.textMuted }]}>{passwordMessage}</AppText>
      ) : null}
    </View>
  );

  return <View>{mode === 'password' ? passwordBlock : pinBlock}</View>;
};

const styles = StyleSheet.create({
  lead: {
    fontSize: 13,
    lineHeight: 18,
    marginBottom: 10,
  },
  note: {
    fontSize: 12,
    lineHeight: 17,
    marginBottom: 10,
  },
  section: {
    fontSize: 16,
    fontWeight: '700',
    marginTop: 22,
    marginBottom: 8,
  },
  label: {
    fontSize: 12,
    fontWeight: '600',
    marginBottom: 6,
  },
  input: {
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 10,
    fontSize: 16,
    letterSpacing: 4,
  },
  passwordInput: {
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 10,
    fontSize: 13,
  },
  counter: {
    fontSize: 12,
    textAlign: 'right',
    marginTop: -6,
    marginBottom: 10,
  },
  button: {
    borderRadius: 12,
    paddingVertical: 13,
    alignItems: 'center',
    marginTop: 4,
    marginBottom: 8,
  },
  buttonText: {
    color: '#111',
    fontSize: 15,
    fontWeight: '600',
  },
  remove: {
    backgroundColor: '#B42318',
  },
  removeDisabled: {
    backgroundColor: '#9CA3AF',
  },
  locked: {
    borderWidth: 1,
    borderRadius: 12,
    padding: 14,
  },
  lockedTitle: {
    fontSize: 15,
    fontWeight: '700',
    marginBottom: 6,
  },
});
