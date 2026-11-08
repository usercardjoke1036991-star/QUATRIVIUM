import React, { useEffect, useState } from 'react';
import {
  Alert,
  AppState,
  StyleSheet,
  TouchableOpacity,
  View,
} from 'react-native';
import { useI18n } from '../i18n/LanguageContext';
import { useTheme } from '../theme/ThemeContext';
import { AppIcon, type IconName } from './icons';
import { LockSettings } from './LockSettings';
import { useAppWallet } from '../wallet/AppWalletContext';
import {
  verifyPin,
  isPinSet,
  isPasswordSet,
  isBiometricEnabled,
  getBiometricStatus,
  checkPassword,
} from '../services/appLock';
import { BiometricLockSection } from './BiometricLockSection';
import { AuthMethodPicker } from './AuthMethodPicker';
import { AuthenticatorSetup } from './AuthenticatorSetup';
import { isAuthenticatorEnabled } from '../services/authenticator';
import {
  loadAuthPrefs,
  type AuthMethod,
  type AuthPrefs,
  type AuthPurpose,
} from '../services/authPrefs';
import { SecretInput } from './SecretInput';
import { subscribeScreenshot } from './ScreenGuard';
import {
  getSecretPhrase,
  hasSecretPhrase,
  isPhraseBackedUp,
  markPhraseBackedUp,
} from '../services/appWallet';
import { useAppMode } from '../wallet/AppModeContext';
import type { TranslationKey } from '../i18n/translations';
import { AppText } from './AppText';

type RowStatus = 'done' | 'todo' | 'warn';
type Panel =
  | 'menu'
  | 'pin'
  | 'fingerprint'
  | 'phrase'
  | 'methods'
  | 'authenticator';

export const SecuritySettings: React.FC = () => {
  const { t } = useI18n();
  const { colors } = useTheme();
  const { mode } = useAppMode();
  const demoAccount = mode === 'demo';
  const { address } = useAppWallet();

  const [panel, setPanel] = useState<Panel>('menu');
  const [phrase, setPhrase] = useState<string | null>(null);
  const [backedUp, setBackedUp] = useState(false);
  const [hasPhrase, setHasPhrase] = useState(false);
  const [revealPin, setRevealPin] = useState('');
  const [revealPassword, setRevealPassword] = useState('');
  const [shown, setShown] = useState(false);
  const [pinSet, setPinSet] = useState(false);
  const [passwordSet, setPasswordSet] = useState(false);
  const [bioOn, setBioOn] = useState(false);
  const [authOn, setAuthOn] = useState(false);
  const [authPrefs, setAuthPrefs] = useState<AuthPrefs>({
    signin: { on: false, methods: ['password'], method: 'password', primaryOnly: true },
    unlock: { on: true, methods: ['password'], method: 'password', primaryOnly: true },
    funds: { on: false, methods: [], method: 'password', primaryOnly: true },
    loanRequest: { on: false, methods: ['password'], method: 'password', primaryOnly: true },
    loanPay: { on: false, methods: ['password'], method: 'password', primaryOnly: true },
  });

  const refreshPhrase = async () => {
    const [
      exists,
      ack,
      pin,
      password,
      bioStatus,
      bioEnabled,
      authenticator,
      prefs,
    ] = await Promise.all([
      hasSecretPhrase(),
      isPhraseBackedUp(),
      isPinSet(),
      isPasswordSet(),
      getBiometricStatus(),
      isBiometricEnabled(),
      isAuthenticatorEnabled(),
      loadAuthPrefs(),
    ]);
    setHasPhrase(exists);
    setBackedUp(ack);
    setPinSet(pin);
    setPasswordSet(password);
    setBioOn(bioEnabled && bioStatus.available);
    setAuthOn(authenticator);
    setAuthPrefs(prefs);
    setPhrase(null);
    setShown(false);
  };

  useEffect(() => {
    refreshPhrase().catch(() => {});
  }, [address]);

  useEffect(() => {
    if (!shown) return undefined;
    const hide = () => {
      setShown(false);
      setPhrase(null);
    };
    const timer = setTimeout(hide, 45_000);
    const sub = AppState.addEventListener('change', (state) => {
      if (state !== 'active') hide();
    });
    const shot = subscribeScreenshot(hide);
    return () => {
      clearTimeout(timer);
      sub.remove();
      shot();
    };
  }, [shown]);

  const reveal = async () => {
    if (passwordSet) {
      const checked = await checkPassword(revealPassword);
      if (!checked.ok) {
        Alert.alert(t('error'), t('lockPasswordWrong'));
        return;
      }
    } else if (pinSet) {
      if (!(await verifyPin(revealPin))) {
        Alert.alert(t('error'), t('lockPinWrong'));
        return;
      }
    } else {
      Alert.alert(t('error'), t('lockPasswordWrong'));
      return;
    }
    const secret = await getSecretPhrase();
    if (!secret) {
      Alert.alert(t('seedTitle'), t('seedMissing'));
      return;
    }
    setPhrase(secret);
    setShown(true);
    setRevealPin('');
    setRevealPassword('');
  };

  const confirmBackup = async () => {
    await markPhraseBackedUp();
    setBackedUp(true);
    setShown(false);
    Alert.alert(t('ready'), t('seedSavedAck'));
  };

  const Row = ({
    label,
    hint,
    status,
    icon,
    onPress,
  }: {
    label: string;
    hint: string;
    status: RowStatus;
    icon: IconName;
    onPress: () => void;
  }) => (
    <TouchableOpacity
      onPress={onPress}
      style={[styles.row, { borderColor: colors.border, backgroundColor: colors.surface }]}
      accessibilityRole="button"
      accessibilityLabel={label}
    >
      <AppIcon
        name={status === 'done' ? 'check' : status === 'warn' ? 'warning' : icon}
        size={16}
        color={
          status === 'done' ? colors.success : status === 'warn' ? colors.danger : colors.primary
        }
      />
      <View style={styles.rowText}>
        <AppText style={[styles.rowLabel, { color: colors.text }]}>{label}</AppText>
        <AppText style={[styles.rowHint, { color: colors.textMuted }]}>{hint}</AppText>
      </View>
      <AppText style={[styles.chevron, { color: colors.textMuted }]}>›</AppText>
    </TouchableOpacity>
  );

  const panelTitle: Record<Exclude<Panel, 'menu'>, TranslationKey> = {
    pin: 'securityPin',
    fingerprint: 'securityFingerprint',
    phrase: 'seedTitle',
    methods: 'authMethodsTitle',
    authenticator: 'authenticatorTitle',
  };

  const methodLabel = (method: AuthMethod) => {
    if (method === 'email') return t('authMethodEmail');
    if (method === 'pin') return t('authMethodPin');
    if (method === 'biometric') return t('authMethodBiometric');
    if (method === 'authenticator') return t('authMethodAuthenticator');
    return t('authMethodPassword');
  };

  const methodHint = (purpose: AuthPurpose) => {
    const slot = authPrefs[purpose];
    if (!slot.on) return t('loanConfirmOff');
    const methods = slot.methods?.length ? slot.methods : [slot.method];
    return methods.map(methodLabel).join(', ');
  };

  if (panel !== 'menu') {
    return (
      <View>
        <TouchableOpacity
          onPress={() => {
            setPanel('menu');
            void refreshPhrase();
          }}
          accessibilityRole="button"
        >
          <AppText style={[styles.back, { color: colors.primary }]}>{t('settingsBack')}</AppText>
        </TouchableOpacity>
        <AppText style={[styles.section, { color: colors.text }]}>{t(panelTitle[panel])}</AppText>
        {panel === 'pin' ? (
          <LockSettings mode="pin" onChanged={() => void refreshPhrase()} />
        ) : null}
        {panel === 'fingerprint' ? <BiometricLockSection compact onChanged={setBioOn} /> : null}
        {panel === 'methods' ? <AuthMethodPicker onChanged={() => void refreshPhrase()} /> : null}
        {panel === 'authenticator' ? (
          <AuthenticatorSetup
            account={address || 'cuenta'}
            onChanged={() => void refreshPhrase()}
          />
        ) : null}
        {panel === 'phrase' ? (
          <View>
            <AppText style={[styles.lead, { color: colors.textMuted }]}>{t('seedLead')}</AppText>
            {!hasPhrase ? (
              <AppText style={[styles.lead, { color: colors.warnText }]}>
                {t('seedMissing')}
              </AppText>
            ) : shown && phrase ? (
              <View
                style={[
                  styles.phraseBox,
                  { borderColor: colors.border, backgroundColor: colors.surface },
                ]}
              >
                <AppText selectable={false} style={[styles.phrase, { color: colors.text }]}>
                  {phrase}
                </AppText>
                <TouchableOpacity
                  onPress={confirmBackup}
                  style={[styles.button, { backgroundColor: colors.primary }]}
                >
                  <AppText style={styles.buttonText}>{t('seedConfirmSaved')}</AppText>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={() => {
                    setShown(false);
                    setPhrase(null);
                  }}
                  style={[
                    styles.button,
                    { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
                  ]}
                >
                  <AppText style={[styles.buttonText, { color: colors.text }]}>
                    {t('seedHide')}
                  </AppText>
                </TouchableOpacity>
              </View>
            ) : (
              <>
                {passwordSet ? (
                  <SecretInput
                    value={revealPassword}
                    onChangeText={setRevealPassword}
                    placeholder={t('lockCurrentPassword')}
                  />
                ) : pinSet ? (
                  <SecretInput
                    value={revealPin}
                    onChangeText={(value) => setRevealPin(value.replace(/\D/g, '').slice(0, 6))}
                    keyboardType="number-pad"
                    maxLength={6}
                    placeholder={t('lockCurrentPin')}
                  />
                ) : null}
                <TouchableOpacity
                  disabled={passwordSet ? !revealPassword : pinSet ? revealPin.length !== 6 : true}
                  onPress={reveal}
                  style={[
                    styles.button,
                    { backgroundColor: colors.connect },
                    (passwordSet ? !revealPassword : pinSet ? revealPin.length !== 6 : true) && {
                      backgroundColor: colors.chip,
                    },
                  ]}
                >
                  <AppText style={styles.buttonText}>{t('seedReveal')}</AppText>
                </TouchableOpacity>
              </>
            )}
          </View>
        ) : null}
      </View>
    );
  }

  return (
    <View>
      <AppText style={[styles.lead, { color: colors.textMuted }]}>
        {demoAccount ? t('securityLeadDemo') : t('securityLead')}
      </AppText>
      <Row
        icon="lock"
        label={t('securityPin')}
        hint={pinSet ? t('securityPinHint') : t('securityPinTodo')}
        status={pinSet ? 'done' : 'todo'}
        onPress={() => setPanel('pin')}
      />
      <Row
        icon="unlock"
        label={t('securityFingerprint')}
        hint={bioOn ? t('securityFingerprintDone') : t('securityFingerprintTodo')}
        status={bioOn ? 'done' : 'todo'}
        onPress={() => setPanel('fingerprint')}
      />
      <Row
        icon="shield"
        label={t('securityPhrase')}
        hint={backedUp ? t('securityPhraseDone') : t('securityPhraseTodo')}
        status={backedUp ? 'done' : 'todo'}
        onPress={() => setPanel('phrase')}
      />
      <Row
        icon="lock"
        label={t('authMethodsTitle')}
        hint={`${t('authUnlock')} ${methodHint('unlock')} · ${t('authFunds')} ${methodHint('funds')} · ${t('loanConfirmRequest')} ${methodHint('loanRequest')} · ${t('loanConfirmPay')} ${methodHint('loanPay')}`}
        status="done"
        onPress={() => setPanel('methods')}
      />
      <Row
        icon="shield"
        label={t('authenticatorTitle')}
        hint={authOn ? t('authenticatorOn') : t('authenticatorOff')}
        status={authOn ? 'done' : 'todo'}
        onPress={() => setPanel('authenticator')}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  lead: {
    fontSize: 13,
    lineHeight: 18,
    marginBottom: 10,
  },
  section: {
    fontSize: 15,
    fontWeight: '700',
    marginTop: 16,
    marginBottom: 8,
  },
  back: {
    fontSize: 15,
    fontWeight: '600',
    marginBottom: 8,
  },
  row: {
    borderWidth: 1,
    borderRadius: 12,
    padding: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 8,
  },
  rowText: {
    flex: 1,
  },
  rowLabel: {
    fontSize: 14,
    fontWeight: '600',
  },
  rowHint: {
    fontSize: 12,
    lineHeight: 17,
    marginTop: 2,
  },
  chevron: {
    fontSize: 22,
    lineHeight: 24,
  },
  phraseBox: {
    borderWidth: 1,
    borderRadius: 12,
    padding: 12,
    marginBottom: 10,
  },
  phrase: {
    fontSize: 15,
    lineHeight: 22,
    fontWeight: '600',
    marginBottom: 12,
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
});
