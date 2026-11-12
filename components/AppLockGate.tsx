import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  AppState,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  View,
  type AppStateStatus,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useI18n } from '../i18n/LanguageContext';
import { useTheme } from '../theme/ThemeContext';
import { AppIcon } from './icons';
import { AppText, AppTextInput } from './AppText';
import { BrandSplash, BrandWordmark } from './BrandSplash';
import { DeviceGuardNotice } from './DeviceGuardNotice';
import { SecretInput } from './SecretInput';
import { PasswordRulesHint } from './PasswordRulesHint';
import {
  PASSWORD_LENGTH,
  PIN_LENGTH,
  getBiometricStatus,
  checkPassword,
  checkPin,
  pauseLockWait,
  refreshLockChain,
  resumeLockWait,
  tickLockWait,
  isBiometricEnabled,
  abortOpenAttempt,
  clearRestorePasswordBackup,
  discardCreatedPin,
  isPasswordSet,
  isPinSet,
  probePasswordSet,
  probePinSet,
  loadWrapFromBiometric,
  lockNow,
  setPassword,
  shouldRelockAfterBackground,
} from '../services/appLock';
import { describeLockFailure, lockWaitCopy } from '../utils/lockFailureCopy';
import { raceMs, reportLockFault, setLockFaultReporter } from '../utils/lockRace';
import { beginTap, endTap } from '../utils/tapGuard';
import { isValidMasterPassword } from '../utils/passwordPolicy';
import {
  ensureAppWallet,
  generateSecretPhrase,
  getSecretPhrase,
  isPhraseBackedUp,
  loadAppWallet,
  readRawWallet,
  wipeAppWallet,
  importFromPhrase,
  isValidSecretPhrase,
  markPhraseBackedUp,
} from '../services/appWallet';
import {
  claimUsername,
  loadClaimedUsername,
  saveClaimedUsername,
} from '../services/accountUsername';
import { lookupBoundWalletOnThisDevice } from '../services/deviceClaim';
import { BOUND_UNKNOWN, getBoundWallet } from '../services/deviceBinding';
import { restoreAccountOnDevice } from '../services/restoreAccount';
import { isAuthenticatorEnabled, unlockWithAuthenticator } from '../services/authenticator';
import {
  ensureUnlockEnabled,
  getAuthMethods,
  isAuthEnabled,
  isMethodReady,
  loadAuthPrefs,
  type AuthMethod,
} from '../services/authPrefs';
import { clearWalletSession, getWalletWrapKey } from '../services/walletSession';
import {
  isSessionSaved,
  markSessionSaved,
  purgePersistedWrap,
  restoreSavedSessionWrap,
} from '../services/savedSession';
import { subscribeWalletOpenEscape } from '../services/walletOpenEscape';
import {
  canSubmitDeviceCredentials,
  canSubmitReinstall,
  canSubmitRestorePhrase,
  canSubmitSignIn,
  accountOnPhoneFromProbes,
  nextEntryScreen,
  orderUnlockMethods,
  signInUsernameAllowed,
  unlockPromptMethods,
  nextUnlockAfterBiometricFail,
  phraseRestoreAfterPasswordUnlock,
  restoreFromLockScreen,
  welcomeActions,
  welcomeShowsCreate,
  wrapReadyForApp,
} from '../utils/accountEntry';
import {
  fetchPublicProfiles,
  hasLockedPublicIdentity,
  saveOwnProfile,
  type UserProfile,
} from '../services/userProfile';
import { PublicIdentityForm } from './PublicIdentityForm';
import { isValidUsername, normalizeUsername } from '../utils/usernamePolicy';
import { lockSponsorOnce } from '../services/sponsorLock';
import { resolveSponsorInput } from '../utils/sponsorLock';
import type { BiometricKind } from '../utils/biometricStatus';

type UnlockMode = 'pin' | 'password' | 'authenticator' | 'biometric';

type UnlockFlags = {
  passwordSet: boolean;
  pinSet: boolean;
  authOn: boolean;
  bioEnabled: boolean;
};

function modeFromMethod(
  method: AuthMethod,
  passwordSet: boolean,
  pinSet: boolean,
  authOn: boolean
): UnlockMode {
  if (method === 'biometric') return 'biometric';
  if (method === 'pin' && pinSet) return 'pin';
  if (method === 'authenticator' && authOn) return 'authenticator';
  if (passwordSet) return 'password';
  if (pinSet) return 'pin';
  if (authOn) return 'authenticator';
  return 'password';
}

const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', '⌫'] as const;

async function resolveSessionWrap(): Promise<{ wrapReady: boolean; address: string }> {
  await restoreSavedSessionWrap();
  if (!getWalletWrapKey()) return { wrapReady: false, address: '' };
  const wallet = await raceMs(ensureAppWallet(), 8000, null);
  const address = wallet?.address || '';
  if (address) {
    return { wrapReady: wrapReadyForApp(true, true), address };
  }
  return { wrapReady: false, address: '' };
}

type SetupStage =
  | 'welcome'
  | 'phraseReveal'
  | 'credentials'
  | 'restore'
  | 'signIn'
  | 'publicIdentity';

interface AppLockGateProps {
  children: React.ReactNode;
}

export const AppLockGate: React.FC<AppLockGateProps> = ({ children }) => {
  const { t } = useI18n();
  const { colors } = useTheme();
  const [ready, setReady] = useState(false);
  const [locked, setLocked] = useState(false);
  const [pinBlocked, setPinBlocked] = useState(false);
  const [pin, setPinDigits] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [bioOn, setBioOn] = useState(false);
  const [bioReady, setBioReady] = useState(false);
  const [bioKinds, setBioKinds] = useState<BiometricKind[]>([]);
  const [needsSetup, setNeedsSetup] = useState(true);
  const [setupStage, setSetupStage] = useState<SetupStage>('welcome');
  const [pendingPin, setPendingPin] = useState('');
  const [passwordInput, setPasswordInput] = useState('');
  const [passwordConfirm, setPasswordConfirm] = useState('');
  const [unlockMode, setUnlockMode] = useState<UnlockMode>('password');
  const [hasPassword, setHasPassword] = useState(false);
  const [hasPin, setHasPin] = useState(false);
  const [hasAuth, setHasAuth] = useState(false);
  const [authCode, setAuthCode] = useState('');
  const [lockMs, setLockMs] = useState(0);
  const lockTicket = useRef(0);
  const issueLockTicket = () => {
    lockTicket.current += 1;
    return lockTicket.current;
  };
  const paintLockMs = (ms: number, ticket: number) => {
    if (ticket === lockTicket.current) setLockMs(ms);
  };
  const [recovering, setRecovering] = useState(false);
  const [recoverEmail, setRecoverEmail] = useState('');
  const [recoverCode, setRecoverCode] = useState('');
  const [recoverSent, setRecoverSent] = useState(false);
  const [recoverDayLocked] = useState(false);
  const recoverWait = 0;
  const [sessionReady, setSessionReady] = useState(false);
  const [askingSignIn, setAskingSignIn] = useState(false);
  const [signInExtra, setSignInExtra] = useState(false);
  const [keepOnPhone, setKeepOnPhone] = useState(true);
  const [restorePhrase, setRestorePhrase] = useState('');
  const [deviceClaimed, setDeviceClaimed] = useState(false);
  const [walletMiss, setWalletMiss] = useState(false);
  const [pendingPhrase, setPendingPhrase] = useState('');
  const [phraseAcked, setPhraseAcked] = useState(false);
  const [accountUsername, setAccountUsername] = useState('');
  const [inviteDraft, setInviteDraft] = useState('');
  const [inviteError, setInviteError] = useState('');
  const [setupWallet, setSetupWallet] = useState('');
  const [sessionTaken, setSessionTaken] = useState(false);
  const [methodQueue, setMethodQueue] = useState<AuthMethod[]>([]);
  const [unlockChoices, setUnlockChoices] = useState<AuthMethod[]>(['password']);
  const [unlockPrimaryOnly, setUnlockPrimaryOnly] = useState(true);
  const methodQueueRef = useRef<AuthMethod[]>([]);
  const kickIfSessionMovedRef = useRef<() => Promise<boolean>>(async () => false);
  const backgroundAt = useRef<number | null>(null);
  const backgroundMono = useRef<number | null>(null);
  const passwordCommittedRef = useRef(false);
  const attemptGuard = useRef(false);
  const createGuard = useRef(false);

  useEffect(() => {
    setLockFaultReporter(() => setError(t('lockUnexpected')));
    return () => setLockFaultReporter(null);
  }, [t]);

  const applyQueuedMethod = async (method: AuthMethod, flags: UnlockFlags) => {
    const nextMode = modeFromMethod(method, flags.passwordSet, flags.pinSet, flags.authOn);
    setUnlockMode(nextMode);
    setBioOn(flags.bioEnabled && method === 'biometric');
    setPasswordInput('');
    setAuthCode('');
    setPinDigits('');
    setError('');
  };

  const startMethodQueue = async (purpose: 'unlock' | 'signin', flags: UnlockFlags) => {
    const prefs = await loadAuthPrefs().catch(() => null);
    const preferred = orderUnlockMethods(
      await getAuthMethods(purpose),
      prefs?.[purpose]?.method
    ) as AuthMethod[];
    const methods: AuthMethod[] = [];
    for (const method of preferred) {
      if (!(await isMethodReady(method))) continue;
      if (method === 'biometric' && !flags.bioEnabled) continue;
      if (method === 'pin' && !flags.pinSet) continue;
      if (method === 'authenticator' && !flags.authOn) continue;
      methods.push(method);
    }
    if (!methods.length && preferred.includes('password')) methods.push('password');
    if (!methods.length) return false;
    if (purpose === 'unlock') {
      const primaryOnly = prefs?.unlock.primaryOnly !== false;
      const prompt = unlockPromptMethods(methods, methods[0], primaryOnly) as AuthMethod[];
      methodQueueRef.current = [];
      setMethodQueue([]);
      setUnlockChoices(methods);
      setUnlockPrimaryOnly(primaryOnly);
      await applyQueuedMethod(prompt[0] || 'password', flags);
      return true;
    }
    methodQueueRef.current = methods;
    setMethodQueue(methods);
    setUnlockChoices(methods);
    setUnlockPrimaryOnly(false);
    await applyQueuedMethod(methods[0] || 'password', flags);
    return true;
  };

  const kickIfSessionMoved = async () => false;
  kickIfSessionMovedRef.current = kickIfSessionMoved;

  const resumePhraseRevealIfNeeded = async (): Promise<boolean> => {
    if (await raceMs(isPhraseBackedUp(), 4000, false)) return false;
    const phrase = await raceMs(getSecretPhrase(), 8000, null);
    if (!phrase) return false;
    const wallet = await raceMs(loadAppWallet(), 8000, null);
    setPendingPhrase(phrase);
    setPhraseAcked(false);
    if (wallet?.address) setSetupWallet(wallet.address.toLowerCase());
    setSetupStage('phraseReveal');
    setNeedsSetup(true);
    setLocked(false);
    setAskingSignIn(false);
    setSessionReady(false);
    return true;
  };

  const finishAuthenticated = async (persist = true) => {
    if (persist) await raceMs(markSessionSaved(), 2500, undefined);
    setHasPassword(true);
    setNeedsSetup(false);
    setLocked(false);
    setAskingSignIn(false);
    setSignInExtra(false);
    setRecovering(false);
    setSessionReady(false);
    setSessionTaken(false);
    setPendingPin('');
    setPasswordInput('');
    setPasswordConfirm('');
    setAuthCode('');
    setError('');
  };

  const passQueuedMethod = async (fromSignIn: boolean) => {
    const rest = methodQueueRef.current.slice(1);
    methodQueueRef.current = rest;
    setMethodQueue(rest);
    if (!rest.length) {
      if (await kickIfSessionMoved()) {
        setPinDigits('');
        setPasswordInput('');
        setAuthCode('');
        return;
      }
      if (fromSignIn) {
        await finishAuthenticated(keepOnPhone);
      } else if (await resumePhraseRevealIfNeeded()) {
        setRecovering(false);
        setSessionTaken(false);
      } else {
        let wallet: { address?: string } | null = null;
        try {
          wallet = await ensureAppWallet();
        } catch {
          wallet = null;
        }
        if (!wallet?.address) {
          setWalletMiss(true);
          setError(t('appWalletFailed'));
          setLocked(true);
          return;
        }
        setWalletMiss(false);
        await raceMs(markSessionSaved(), 2500, undefined);
        setLocked(false);
        setNeedsSetup(!(await isPasswordSet()));
        setRecovering(false);
        setSessionTaken(false);
      }
      setPinDigits('');
      setPasswordInput('');
      setAuthCode('');
      setError('');
      setLockMs(0);
      return;
    }
    const [passwordSet, pinSet, authOn, bioEnabled] = await Promise.all([
      isPasswordSet(),
      isPinSet(),
      isAuthenticatorEnabled(),
      isBiometricEnabled(),
    ]);
    await applyQueuedMethod(rest[0], {
      passwordSet,
      pinSet,
      authOn,
      bioEnabled,
    });
  };
  const boot = useCallback(async () => {
    if (__DEV__) console.log('[boot] AppLockGate start');
    setBusy(false);
    const [passwordProbe, pinProbe] = await Promise.all([
      probePasswordSet(4000),
      probePinSet(4000),
    ]);
    const accountOnPhone = accountOnPhoneFromProbes(passwordProbe, pinProbe);
    const pinSet = pinProbe === true;
    const passwordSet = passwordProbe === true;
    if (accountOnPhone === null) {
      setHasPassword(false);
      setHasPin(false);
      setNeedsSetup(false);
      setAskingSignIn(true);
      setLocked(false);
      setReady(true);
      return;
    }
    const authOn = await isAuthenticatorEnabled();
    const opened = await resolveSessionWrap();
    const wrapReady = opened.wrapReady;
    if (__DEV__) {
      console.log('[boot] AppLockGate creds', {
        pinSet,
        passwordSet,
        authOn,
        wrapReady,
      });
    }
    const enabled = passwordSet || pinSet ? await isBiometricEnabled() : false;
    setBioReady(false);
    setBioKinds([]);
    setBioOn(false);
    const bioReadyNow = false;
    setTimeout(() => {
      void getBiometricStatus().then((bioStatus) => {
        const enrolled = bioStatus.available;
        setBioReady(enrolled);
        setBioKinds(bioStatus.kinds);
        setBioOn(Boolean(enabled && enrolled));
      });
    }, 2500);
    setHasPassword(passwordSet);
    setHasPin(pinSet);
    setHasAuth(authOn);
    const savedUser = await raceMs(
      loadClaimedUsername().catch(() => ''),
      2000,
      ''
    );
    if (savedUser) setAccountUsername(savedUser);
    if (!passwordSet && !pinSet) {
      setNeedsSetup(true);
      setSetupStage('welcome');
      setLocked(false);
      setAskingSignIn(false);
      setReady(true);
      return;
    }
    if (wrapReady && (await resumePhraseRevealIfNeeded())) {
      setReady(true);
      setLockMs(await refreshLockChain(true));
      return;
    }
    const sessionSaved = await isSessionSaved();
    if (sessionSaved)
      await raceMs(
        ensureUnlockEnabled().catch(() => undefined),
        2000,
        undefined
      );
    const unlockOn = await raceMs(
      isAuthEnabled('unlock').catch(() => false),
      4000,
      false
    );
    const entry = nextEntryScreen({
      accountOnPhone: passwordSet || pinSet,
      sessionSaved,
      wrapReady,
      unlockOn,
    });
    setNeedsSetup(false);
    if (entry === 'unlock') {
      const asked = await startMethodQueue('unlock', {
        passwordSet,
        pinSet,
        authOn,
        bioEnabled: bioReadyNow,
      });
      setAskingSignIn(false);
      if (!asked) setUnlockMode('password');
      lockNow();
      setLocked(true);
    } else {
      methodQueueRef.current = [];
      setMethodQueue([]);
      setAskingSignIn(entry === 'signIn');
      setLocked(false);
    }
    setReady(true);
    setLockMs(await refreshLockChain(true));
    // startMethodQueue se crea en cada render; incluirlo reabriría el desbloqueo.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const beginPasswordSetup = async (pinValue: string) => {
    setPendingPin(pinValue);
    setPasswordInput('');
    setPasswordConfirm('');
    passwordCommittedRef.current = false;
    setKeepOnPhone(true);
    setSetupStage('credentials');
    setNeedsSetup(true);
    setLocked(false);
    setError('');
    const savedUser = await loadClaimedUsername().catch(() => '');
    if (savedUser) setAccountUsername(savedUser);
  };

  useEffect(() => {
    let settled = false;
    const failOpen = async () => {
      if (settled) return;
      const [passwordProbe, pinProbe] = await Promise.all([
        probePasswordSet(2500),
        probePinSet(2500),
      ]);
      const accountOnPhone = accountOnPhoneFromProbes(passwordProbe, pinProbe);
      if (accountOnPhone === null) {
        if (settled) return;
        settled = true;
        setNeedsSetup(false);
        setAskingSignIn(true);
        setLocked(false);
        setReady(true);
        return;
      }
      settled = true;
      const passwordSet = accountOnPhone === true;
      const sessionSaved = await raceMs(isSessionSaved(), 4000, false);
      const unlockOn = await raceMs(
        isAuthEnabled('unlock').catch(() => false),
        4000,
        false
      );
      setHasPassword(passwordSet);
      let wrapReady = false;
      if (!unlockOn) {
        const opened = await resolveSessionWrap();
        wrapReady = opened.wrapReady;
        if (wrapReady && (await resumePhraseRevealIfNeeded())) {
          setReady(true);
          return;
        }
      }
      const entry = nextEntryScreen({
        accountOnPhone,
        sessionSaved,
        wrapReady,
        unlockOn,
      });
      if (entry === 'welcome') {
        setNeedsSetup(true);
        setSetupStage('welcome');
        setAskingSignIn(false);
        setLocked(false);
        setReady(true);
        return;
      }
      setNeedsSetup(false);
      if (entry === 'unlock') {
        setUnlockMode('password');
        lockNow();
        setAskingSignIn(false);
        setLocked(true);
      } else {
        setAskingSignIn(entry === 'signIn');
        setLocked(false);
      }
      setReady(true);
    };
    const watchdog = setTimeout(() => {
      void failOpen();
    }, 20000);
    boot()
      .then(() => {
        settled = true;
      })
      .catch(() => failOpen())
      .finally(() => clearTimeout(watchdog));
    return () => {
      settled = true;
      clearTimeout(watchdog);
    };
  }, [boot]);

  useEffect(() => {
    return subscribeWalletOpenEscape((kind) => {
      void (async () => {
        clearWalletSession();
        await purgePersistedWrap();
        setError('');
        setAskingSignIn(false);
        setSessionReady(false);
        setBusy(false);
        if (kind === 'restore') {
          setNeedsSetup(true);
          setSetupStage('restore');
          setLocked(false);
          setRestorePhrase('');
          setPasswordInput('');
          setAccountUsername('');
          return;
        }
        setNeedsSetup(false);
        setUnlockMode('password');
        lockNow();
        setLocked(true);
      })();
    });
  }, []);

  // En Xiaomi/MIUI el diálogo de huella al abrir falla. Solo se pide si el usuario pulsa el botón.

  useEffect(() => {
    const onChange = (next: AppStateStatus) => {
      if (next === 'background' || next === 'inactive') {
        backgroundAt.current = Date.now();
        backgroundMono.current = performance.now();
        void pauseLockWait();
        return;
      }
      if (next === 'active') {
        const ticket = issueLockTicket();
        void resumeLockWait().then(() =>
          refreshLockChain(true).then((ms) => paintLockMs(ms, ticket))
        );
      }
      if (
        next === 'active' &&
        shouldRelockAfterBackground(
          backgroundAt.current,
          Date.now(),
          backgroundMono.current,
          performance.now()
        )
      ) {
        Promise.all([
          isPasswordSet(),
          isPinSet(),
          isAuthenticatorEnabled(),
          isAuthEnabled('unlock'),
          isBiometricEnabled(),
          getBiometricStatus(),
        ])
          .then(async ([passwordSet, pinSet, authOn, unlockOn, bioOnPref, bioStatus]) => {
            if (!(passwordSet || pinSet)) return;
            const bioEnabled = Boolean(bioOnPref && bioStatus.available);
            setNeedsSetup(false);
            setRecovering(false);
            setHasAuth(authOn);
            setError('');
            if (unlockOn) {
              const asked = await startMethodQueue('unlock', {
                passwordSet,
                pinSet,
                authOn,
                bioEnabled,
              });
              if (asked) {
                lockNow();
                setLocked(true);
              }
            }
          })
          .catch(() => {
            setPinDigits('');
          });
      }
      backgroundAt.current = null;
      backgroundMono.current = null;
    };
    const sub = AppState.addEventListener('change', onChange);
    return () => sub.remove();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const lockWaiting = lockMs > 0;
  useEffect(() => {
    if (!lockWaiting) return undefined;
    const fast = setInterval(() => {
      const ticket = issueLockTicket();
      void tickLockWait().then((ms) => paintLockMs(ms, ticket));
    }, 1000);
    const slow = setInterval(() => {
      const ticket = issueLockTicket();
      void refreshLockChain(false).then((ms) => paintLockMs(ms, ticket));
    }, 60_000);
    return () => {
      clearInterval(fast);
      clearInterval(slow);
    };
  }, [lockWaiting]);

  const tryBiometric = async () => {
    if (!bioOn || !bioReady || lockMs > 0) return;
    setBusy(true);
    const wrap = await loadWrapFromBiometric();
    setBusy(false);
    if (wrap) {
      await passQueuedMethod(askingSignIn);
      return;
    }
    const next = nextUnlockAfterBiometricFail(unlockChoices, {
      pinSet: hasPin,
      passwordSet: hasPassword,
      authOn: hasAuth,
    });
    if (next) {
      await applyQueuedMethod(next, {
        passwordSet: hasPassword,
        pinSet: hasPin,
        authOn: hasAuth,
        bioEnabled: bioOn,
      });
    }
    setError(t('securityAccessKeyFailed'));
  };

  const finishUnlock = async (usedPin: string) => {
    if (await isPasswordSet()) {
      await passQueuedMethod(askingSignIn);
      return;
    }
    await beginPasswordSetup(usedPin);
  };

  const pressKey = async (key: string) => {
    if (!key || busy || lockMs > 0 || attemptGuard.current) return;
    if (key === '⌫') {
      setPinDigits((value) => value.slice(0, -1));
      setError('');
      return;
    }
    if (pin.length >= PIN_LENGTH) return;
    const next = pin + key;
    setPinDigits(next);
    if (next.length < PIN_LENGTH) return;

    attemptGuard.current = true;
    setBusy(true);
    try {
      const result = await checkPin(next);
      if (result.ok) {
        setPinBlocked(false);
        await finishUnlock(next);
        return;
      }
      if (result.pinBlocked || result.deviceKeyReset || result.deviceSecretLost) {
        setPinBlocked(result.pinBlocked === true);
        setUnlockMode('password');
      }
      setLockMs(result.remainingMs);
      setError(describeLockFailure('pin', result, t));
      setPinDigits('');
    } catch {
      reportLockFault();
    } finally {
      attemptGuard.current = false;
      setBusy(false);
    }
  };

  const submitUnlockAuthenticator = async () => {
    if (busy || lockMs > 0 || attemptGuard.current || authCode.length !== 6) return;
    attemptGuard.current = true;
    setBusy(true);
    try {
      const result = await unlockWithAuthenticator(authCode);
      if (!result.ok && result.busy) return;
      if (result.ok) {
        await passQueuedMethod(askingSignIn);
        return;
      }
      if (result.locked || result.storeUnknown) {
        setLockMs(result.remainingMs);
        setError(describeLockFailure('password', result, t));
      } else {
        setError(t('authenticatorWrong'));
      }
      setAuthCode('');
    } finally {
      attemptGuard.current = false;
      setBusy(false);
    }
  };

  const submitUnlockPassword = async () => {
    if (busy || lockMs > 0 || attemptGuard.current || !passwordInput) return;
    attemptGuard.current = true;
    setBusy(true);
    setError('');
    try {
      const result = await checkPassword(passwordInput);
      if (result.ok) {
        setPinBlocked(false);
        await passQueuedMethod(askingSignIn);
        return;
      }
      setLockMs(result.remainingMs);
      setError(describeLockFailure('password', result, t));
      setPasswordInput('');
    } finally {
      attemptGuard.current = false;
      setBusy(false);
    }
  };

  const beginCreatePhrase = () => {
    setPendingPhrase('');
    setPhraseAcked(false);
    setAccountUsername('');
    setInviteDraft('');
    setInviteError('');
    setPasswordInput('');
    setKeepOnPhone(true);
    passwordCommittedRef.current = false;
    setError('');
    setSetupStage('credentials');
  };

  const rememberUsername = async (walletAddress: string, username: string) => {
    const saved = await saveClaimedUsername(username);
    try {
      await claimUsername(walletAddress, saved);
    } catch {
      // El usuario queda guardado en este teléfono aunque el aviso no lo publique.
    }
    return saved;
  };

  const submitDeviceCredentials = async () => {
    if (!beginTap(createGuard)) return;
    try {
      await submitDeviceCredentialsBody();
    } finally {
      endTap(createGuard);
    }
  };

  const submitDeviceCredentialsBody = async () => {
    const username = normalizeUsername(accountUsername);
    if (!canSubmitDeviceCredentials(passwordInput, username)) {
      setError(isValidUsername(username) ? t('lockPasswordWeak') : t('usernameInvalid'));
      return;
    }
    const sponsor = resolveSponsorInput(inviteDraft, '');
    if (!sponsor.ok) {
      setInviteError(t('invalidSponsor'));
      return;
    }
    setInviteError('');
    setBusy(true);
    setError('');
    const hadPassword = await isPasswordSet().catch(() => true);
    const hadPin = await isPinSet().catch(() => true);
    const hadBound = await getBoundWallet().catch(() => BOUND_UNKNOWN);
    const hadRaw = await readRawWallet().catch(() => 'unreadable' as const);
    try {
      const created = generateSecretPhrase();
      const wrap = await setPassword(passwordInput, pendingPin || undefined, { undoable: true });
      if (!wrap && !getWalletWrapKey()) {
        throw new Error('locked');
      }
      passwordCommittedRef.current = true;
      const wallet = await importFromPhrase(created.phrase, { markBackedUp: false });
      if (!wallet) throw new Error('appWallet');
      await lockSponsorOnce(wallet.address, inviteDraft, true);
      await rememberUsername(wallet.address, username);
      setHasPassword(true);
      setSetupWallet(wallet.address);
      setPendingPhrase(created.phrase);
      setPhraseAcked(false);
      setSetupStage('phraseReveal');
      clearRestorePasswordBackup();
    } catch (err) {
      if (!hadPassword) {
        await abortOpenAttempt().catch(() => {});
      }
      if (!hadPin) {
        await discardCreatedPin().catch(() => {});
      }
      if (!hadPassword && !hadPin && hadBound === '' && hadRaw == null) {
        await wipeAppWallet().catch(() => {});
      }
      passwordCommittedRef.current = false;
      const code = err instanceof Error ? err.message : '';
      setError(
        code === 'pbkdf2-missing'
          ? t('lockKdfMissing')
          : code === 'password-key'
            ? t('lockPasswordPrivateKey')
            : code === 'device-bound'
              ? t('errDeviceBound')
              : code === 'wallet-persist' || code === 'password-persist'
                ? t('errWalletPersist')
                : code === 'wallet-other-app' || code.includes('wallet-other-app')
                  ? t('errWalletOtherApp')
                  : code === 'username'
                    ? t('usernameInvalid')
                    : t('appWalletFailed')
      );
    } finally {
      setBusy(false);
    }
  };

  const confirmCreatedPhrase = async () => {
    if (!phraseAcked || busy) return;
    setBusy(true);
    setError('');
    try {
      await markPhraseBackedUp();
      setPendingPhrase('');
      setPhraseAcked(false);
      setSetupStage('publicIdentity');
    } catch {
      setError(t('appWalletFailed'));
    } finally {
      setBusy(false);
    }
  };

  const sendRecover = async () => {
    setError(t('lockRecoverFail'));
  };

  const submitRecover = async () => {
    setError(t('lockRecoverFail'));
  };

  const submitRestoreAccount = async () => {
    const username = normalizeUsername(accountUsername);
    if (!isValidSecretPhrase(restorePhrase) || !canSubmitRestorePhrase(restorePhrase)) {
      setError(t('seedInvalid'));
      return;
    }
    if (!canSubmitReinstall(restorePhrase, passwordInput, username)) {
      setError(isValidUsername(username) ? t('lockPasswordWeak') : t('usernameInvalid'));
      return;
    }
    setBusy(true);
    setError('');
    try {
      const restored = await restoreAccountOnDevice({
        phrase: restorePhrase,
        password: passwordInput,
      });
      if (!restored.ok) {
        setError(
          restored.reason === 'store-unknown'
            ? t('lockStoreUnknown')
            : restored.reason === 'wallet-other-app'
              ? t('errWalletOtherApp')
              : restored.reason === 'phrase'
                ? t('seedInvalid')
                : restored.reason === 'password-persist' || restored.reason === 'wallet-persist'
                  ? t('errWalletPersist')
                  : restored.reason === 'device-bound'
                    ? t('errDeviceBound')
                    : t('appWalletFailed')
        );
        return;
      }
      const wallet = restored.wallet;
      await rememberUsername(wallet.address, username);
      setHasPassword(true);
      setSetupWallet(wallet.address);
      setRestorePhrase('');
      const remote = await fetchPublicProfiles([wallet.address]).catch(
        () => ({}) as Record<string, UserProfile>
      );
      const found = remote[wallet.address.toLowerCase()];
      if (hasLockedPublicIdentity(found)) {
        await saveOwnProfile({ ...found, publicFace: true }, wallet.address).catch(() => {});
        await finishAuthenticated(keepOnPhone);
        return;
      }
      setSetupStage('publicIdentity');
    } catch (err) {
      const code = err instanceof Error ? err.message : '';
      setError(
        code === 'phrase' || code.includes('phrase')
          ? t('seedInvalid')
          : code === 'device-bound'
            ? t('errDeviceBound')
            : code === 'wallet-persist' || code === 'password-persist'
              ? t('errWalletPersist')
              : code === 'wallet-other-app' || code.includes('wallet-other-app')
                ? t('errWalletOtherApp')
                : t('appWalletFailed')
      );
    } finally {
      setBusy(false);
    }
  };

  const submitSignIn = async () => {
    if (busy || lockMs > 0) return;
    setBusy(true);
    setError('');
    try {
      const checked = await checkPassword(passwordInput);
      if (checked.ok) {
        const saved = await loadClaimedUsername();
        const typed = normalizeUsername(accountUsername);
        if (!signInUsernameAllowed(typed, saved)) {
          setError(t('usernameInvalid'));
          return;
        }
        if (!saved) {
          await saveClaimedUsername(typed).catch(() => {});
        }
        setHasPassword(true);
        await finishAuthenticated(keepOnPhone);
        return;
      }
      {
        const exists = await probePasswordSet(2000);
        setLockMs(checked.remainingMs);
        setError(describeLockFailure('password', checked, t, exists === false));
        return;
      }
    } catch {
      setError(t('lockPasswordWrong'));
    } finally {
      setBusy(false);
    }
  };

  const keepSession = () => {
    void finishAuthenticated(true);
  };

  useEffect(() => {
    const onChange = (next: AppStateStatus) => {
      if (next !== 'active') return;
      if (needsSetup || locked) return;
      void kickIfSessionMovedRef.current();
    };
    const sub = AppState.addEventListener('change', onChange);
    const timer = setInterval(() => {
      if (needsSetup || locked) return;
      void kickIfSessionMovedRef.current();
    }, 40_000);
    return () => {
      sub.remove();
      clearInterval(timer);
    };
  }, [needsSetup, locked]);

  useEffect(() => {
    if (sessionReady) return;
    let live = true;
    void lookupBoundWalletOnThisDevice()
      .then((bound) => {
        if (!live) return;
        if (bound.status === 'wallet') {
          setDeviceClaimed(true);
          return;
        }
        setDeviceClaimed(bound.status === 'unknown');
      })
      .catch(() => {
        if (live) setDeviceClaimed(false);
      });
    return () => {
      live = false;
    };
  }, [sessionReady]);

  if (!ready) {
    return <BrandSplash />;
  }

  if (!needsSetup && !locked && !askingSignIn) {
    return <>{children}</>;
  }

  const setup = needsSetup;
  const accountOnPhone = hasPassword;
  const welcomeStage =
    setup && setupStage === 'welcome' && !recovering && !sessionReady && !accountOnPhone;
  const phraseRevealStage = setup && setupStage === 'phraseReveal' && !recovering && !sessionReady;
  const credentialsStage = setup && setupStage === 'credentials' && !recovering && !sessionReady;
  const publicIdentityStage =
    setup && setupStage === 'publicIdentity' && !recovering && !sessionReady;
  const entryActions = welcomeActions(accountOnPhone, deviceClaimed);
  const canCreateOnDevice = welcomeShowsCreate(accountOnPhone, deviceClaimed);
  const restoreStage =
    setup && (setupStage === 'restore' || setupStage === 'signIn') && !recovering && !sessionReady;
  const signInOnDevice = setupStage === 'signIn';
  const passwordOk = isValidMasterPassword(passwordInput) && passwordInput === passwordConfirm;

  return (
    <SafeAreaView style={[styles.fill, { backgroundColor: colors.bg }]}>
      <KeyboardAvoidingView
        style={styles.fill}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <ScrollView
          style={styles.fill}
          contentContainerStyle={styles.scroll}
          keyboardShouldPersistTaps="handled"
          nestedScrollEnabled
          showsVerticalScrollIndicator
        >
          <View style={styles.hero}>
            {welcomeStage ? (
              <BrandWordmark compact titleColor={colors.text} lineColor={colors.primary} />
            ) : (
              <AppIcon name="lock" size={28} color={colors.primary} />
            )}
            <AppText style={[styles.title, { color: colors.text }]}>
              {sessionReady
                ? t('saveSession')
                : welcomeStage
                  ? t('welcomeTitle')
                  : restoreStage
                    ? t(signInOnDevice ? 'signIn' : 'restoreAccount')
                    : publicIdentityStage
                      ? t('publicIdentityTitle')
                      : phraseRevealStage
                        ? t('createPhrase')
                        : credentialsStage
                          ? t('createCredentialsTitle')
                          : recovering
                            ? t('lockRecoverTitle')
                            : askingSignIn
                              ? t('signIn')
                              : t('lockUnlock')}
            </AppText>
            <AppText style={[styles.lead, { color: colors.textMuted }]}>
              {sessionTaken
                ? t('sessionOpenedElsewhere')
                : sessionReady
                  ? t('saveSessionLead')
                  : welcomeStage
                    ? t(deviceClaimed ? 'deviceAlreadyBoundLead' : 'welcomeLead')
                    : restoreStage
                      ? t(
                          signInOnDevice
                            ? 'signInOnDeviceLead'
                            : deviceClaimed
                              ? 'deviceReinstallLead'
                              : 'restoreAccountLead'
                        )
                      : publicIdentityStage
                        ? t('publicIdentityLead')
                        : phraseRevealStage
                          ? t('createPhraseLead')
                          : credentialsStage
                            ? t('createCredentialsLead')
                            : recovering
                              ? t('lockRecoverLead')
                              : askingSignIn && !signInExtra
                                ? t('signInLead')
                                : lockMs > 0
                                  ? t(
                                      lockWaitCopy(lockMs)?.key || 'lockCooldown',
                                      lockWaitCopy(lockMs)?.vars
                                    )
                                  : unlockMode === 'password'
                                    ? t('lockUnlockLeadPassword')
                                    : unlockMode === 'authenticator'
                                      ? t('lockUnlockLeadAuth')
                                      : unlockMode === 'biometric'
                                        ? t('lockBiometric')
                                        : t('lockUnlockLead')}
            </AppText>
            {!phraseRevealStage &&
            !credentialsStage &&
            !welcomeStage &&
            !restoreStage &&
            !publicIdentityStage &&
            !recovering &&
            setup ? (
              <View style={styles.dots}>
                {Array.from({ length: PIN_LENGTH }).map((_, index) => (
                  <View
                    key={index}
                    style={[
                      styles.dot,
                      { borderColor: colors.border },
                      index < pin.length && {
                        backgroundColor: colors.primary,
                        borderColor: colors.primary,
                      },
                    ]}
                  />
                ))}
              </View>
            ) : null}
            {!setup &&
            !recovering &&
            !sessionReady &&
            (!askingSignIn || signInExtra) &&
            unlockMode === 'pin' ? (
              <View style={styles.dots}>
                {Array.from({ length: PIN_LENGTH }).map((_, index) => (
                  <View
                    key={index}
                    style={[
                      styles.dot,
                      { borderColor: colors.border },
                      index < pin.length && {
                        backgroundColor: colors.primary,
                        borderColor: colors.primary,
                      },
                    ]}
                  />
                ))}
              </View>
            ) : null}
            <DeviceGuardNotice />
            {error ? (
              <AppText style={[styles.error, { color: colors.danger }]}>{error}</AppText>
            ) : null}
            {busy ? (
              <AppText style={[styles.error, { color: colors.textMuted }]}>
                {t('lockKdfWait')}
              </AppText>
            ) : null}
          </View>

          {welcomeStage ? (
            <View style={styles.passwordBlock}>
              {entryActions.includes('createPhrase') ? (
                <TouchableOpacity
                  onPress={beginCreatePhrase}
                  style={[styles.primary, { backgroundColor: colors.connect }]}
                  accessibilityRole="button"
                  accessibilityLabel={t('createAccount')}
                >
                  <AppText style={styles.primaryText}>{t('createAccount')}</AppText>
                </TouchableOpacity>
              ) : null}
              {entryActions.includes('restoreAccount') ? (
                <TouchableOpacity
                  onPress={() => {
                    setSetupStage('restore');
                    setRestorePhrase('');
                    setPasswordInput('');
                    setAccountUsername('');
                    setKeepOnPhone(true);
                    setError('');
                  }}
                  style={[
                    styles.primary,
                    canCreateOnDevice ? styles.secondary : null,
                    canCreateOnDevice
                      ? { borderColor: colors.border, backgroundColor: colors.surface }
                      : { backgroundColor: colors.connect },
                  ]}
                  accessibilityRole="button"
                  accessibilityLabel={t('restoreAccount')}
                >
                  <AppText
                    style={[styles.primaryText, canCreateOnDevice ? { color: colors.text } : null]}
                  >
                    {t('restoreAccount')}
                  </AppText>
                </TouchableOpacity>
              ) : null}
              {entryActions.includes('signIn') ? (
                <TouchableOpacity
                  onPress={() => {
                    setSetupStage('signIn');
                    setRestorePhrase('');
                    setPasswordInput('');
                    setAccountUsername('');
                    setKeepOnPhone(true);
                    setError('');
                  }}
                  style={[styles.primary, { backgroundColor: colors.connect }]}
                  accessibilityRole="button"
                  accessibilityLabel={t('signIn')}
                >
                  <AppText style={styles.primaryText}>{t('signIn')}</AppText>
                </TouchableOpacity>
              ) : null}
            </View>
          ) : null}

          {askingSignIn && !signInExtra && !recovering && !sessionReady ? (
            <View style={styles.passwordBlock}>
              <AppTextInput
                value={accountUsername}
                onChangeText={(value) => setAccountUsername(normalizeUsername(value))}
                autoCapitalize="none"
                autoCorrect={false}
                placeholder={t('usernameField')}
                placeholderTextColor={colors.textMuted}
                style={[
                  styles.passwordInput,
                  {
                    backgroundColor: colors.inputBg,
                    borderColor: colors.inputBorder,
                    color: colors.text,
                  },
                ]}
              />
              <SecretInput
                value={passwordInput}
                onChangeText={(value) =>
                  setPasswordInput(value.replace(/\s/g, '').slice(0, PASSWORD_LENGTH))
                }
                maxLength={PASSWORD_LENGTH}
                editable={lockMs <= 0}
                placeholder={t('lockPasswordGenerated')}
              />
              <TouchableOpacity
                onPress={() => setKeepOnPhone((value) => !value)}
                style={styles.switchMode}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: keepOnPhone }}
              >
                <AppText style={[styles.switchText, { color: colors.primary }]}>
                  {keepOnPhone
                    ? `${t('saveSession')}: ${t('loanConfirmOn')}`
                    : `${t('saveSession')}: ${t('loanConfirmOff')}`}
                </AppText>
              </TouchableOpacity>
              <TouchableOpacity
                disabled={busy || lockMs > 0 || !canSubmitSignIn(passwordInput, accountUsername)}
                onPress={() => void submitSignIn()}
                style={[styles.primary, { backgroundColor: colors.connect }]}
              >
                {busy ? (
                  <>
                    <ActivityIndicator color="#111" />
                    <AppText style={styles.primaryText}>{t('lockKdfWait')}</AppText>
                  </>
                ) : (
                  <AppText style={styles.primaryText}>{t('signIn')}</AppText>
                )}
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => {
                  setError('');
                  setPasswordInput('');
                  setPasswordConfirm('');
                  if (!hasPassword) {
                    setAskingSignIn(false);
                    setNeedsSetup(true);
                    setSetupStage('restore');
                    setRecovering(false);
                    return;
                  }
                  setRecovering(true);
                }}
                style={styles.switchMode}
              >
                <AppText style={[styles.switchText, { color: colors.primary }]}>
                  {t('lockForgotPassword')}
                </AppText>
              </TouchableOpacity>
              {!hasPassword ? (
                <>
                  {!deviceClaimed ? (
                    <TouchableOpacity
                      onPress={() => {
                        setAskingSignIn(false);
                        setNeedsSetup(true);
                        setSetupStage('restore');
                        setError('');
                      }}
                      style={styles.switchMode}
                    >
                      <AppText style={[styles.switchText, { color: colors.primary }]}>
                        {t('restoreAccount')}
                      </AppText>
                    </TouchableOpacity>
                  ) : null}
                  <TouchableOpacity
                    onPress={() => {
                      setAskingSignIn(false);
                      setNeedsSetup(true);
                      setSetupStage('welcome');
                      setError('');
                    }}
                    style={styles.switchMode}
                  >
                    <AppText style={[styles.switchText, { color: colors.primary }]}>
                      {t('lockRecoverBack')}
                    </AppText>
                  </TouchableOpacity>
                </>
              ) : null}
            </View>
          ) : null}

          {restoreStage ? (
            <View style={styles.passwordBlock}>
              <AppTextInput
                value={restorePhrase}
                onChangeText={setRestorePhrase}
                autoCapitalize="none"
                autoCorrect={false}
                autoComplete="off"
                importantForAutofill="no"
                textContentType="none"
                spellCheck={false}
                multiline
                placeholder={t('seedRestorePlaceholder')}
                placeholderTextColor={colors.textMuted}
                style={[
                  styles.passwordInput,
                  styles.phraseInput,
                  {
                    backgroundColor: colors.inputBg,
                    borderColor: colors.inputBorder,
                    color: colors.text,
                  },
                ]}
              />
              <AppTextInput
                value={accountUsername}
                onChangeText={(value) => setAccountUsername(normalizeUsername(value))}
                autoCapitalize="none"
                autoCorrect={false}
                autoComplete="off"
                importantForAutofill="no"
                textContentType="none"
                placeholder={t('usernameField')}
                placeholderTextColor={colors.textMuted}
                style={[
                  styles.passwordInput,
                  {
                    backgroundColor: colors.inputBg,
                    borderColor: colors.inputBorder,
                    color: colors.text,
                  },
                ]}
              />
              <SecretInput
                value={passwordInput}
                onChangeText={(value) =>
                  setPasswordInput(value.replace(/\s/g, '').slice(0, PASSWORD_LENGTH))
                }
                maxLength={PASSWORD_LENGTH}
                placeholder={t('lockNewPassword')}
              />
              <PasswordRulesHint value={passwordInput} />
              <TouchableOpacity
                onPress={() => setKeepOnPhone((value) => !value)}
                style={styles.switchMode}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: keepOnPhone }}
              >
                <AppText style={[styles.switchText, { color: colors.primary }]}>
                  {keepOnPhone
                    ? `${t('saveSession')}: ${t('loanConfirmOn')}`
                    : `${t('saveSession')}: ${t('loanConfirmOff')}`}
                </AppText>
              </TouchableOpacity>
              <TouchableOpacity
                disabled={
                  busy ||
                  !isValidSecretPhrase(restorePhrase) ||
                  !canSubmitReinstall(restorePhrase, passwordInput, accountUsername)
                }
                onPress={() => void submitRestoreAccount()}
                style={[
                  styles.primary,
                  { backgroundColor: colors.connect },
                  (!isValidSecretPhrase(restorePhrase) ||
                    !canSubmitReinstall(restorePhrase, passwordInput, accountUsername)) && {
                    backgroundColor: colors.chip,
                  },
                ]}
              >
                {busy ? (
                  <>
                    <ActivityIndicator color="#111" />
                    <AppText style={styles.primaryText}>{t('lockKdfWait')}</AppText>
                  </>
                ) : (
                  <AppText style={styles.primaryText}>
                    {t(signInOnDevice ? 'signIn' : 'seedRestoreAction')}
                  </AppText>
                )}
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => {
                  setSetupStage('welcome');
                  setRestorePhrase('');
                  setError('');
                }}
                style={styles.switchMode}
              >
                <AppText style={[styles.switchText, { color: colors.primary }]}>
                  {t('lockRecoverBack')}
                </AppText>
              </TouchableOpacity>
            </View>
          ) : null}

          {phraseRevealStage ? (
            <View style={styles.passwordBlock}>
              <AppTextInput
                value={pendingPhrase}
                editable={false}
                multiline
                style={[
                  styles.passwordInput,
                  styles.phraseInput,
                  {
                    backgroundColor: colors.inputBg,
                    borderColor: colors.inputBorder,
                    color: colors.text,
                  },
                ]}
              />
              <TouchableOpacity
                onPress={() => setPhraseAcked((value) => !value)}
                style={styles.switchMode}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: phraseAcked }}
              >
                <AppText style={[styles.switchText, { color: colors.primary }]}>
                  {phraseAcked
                    ? `${t('createPhraseAck')}: ${t('loanConfirmOn')}`
                    : t('createPhraseAck')}
                </AppText>
              </TouchableOpacity>
              <TouchableOpacity
                disabled={!phraseAcked || busy}
                onPress={() => void confirmCreatedPhrase()}
                style={[
                  styles.primary,
                  { backgroundColor: colors.connect },
                  !phraseAcked && { backgroundColor: colors.chip },
                ]}
              >
                <AppText style={styles.primaryText}>{t('createPhraseContinue')}</AppText>
              </TouchableOpacity>
            </View>
          ) : null}

          {publicIdentityStage ? (
            <View style={styles.passwordBlock}>
              <PublicIdentityForm
                walletAddress={setupWallet}
                onSaved={() => finishAuthenticated(keepOnPhone)}
              />
            </View>
          ) : null}

          {credentialsStage ? (
            <View style={styles.passwordBlock}>
              <AppText style={[styles.switchText, { color: colors.text }]}>
                {t('signupInviteLabel')}
              </AppText>
              <AppText style={[styles.switchText, { color: colors.textMuted }]}>
                {t('signupInviteLead')}
              </AppText>
              <AppTextInput
                value={inviteDraft}
                onChangeText={(value) => {
                  setInviteDraft(value);
                  setInviteError('');
                }}
                autoCapitalize="characters"
                autoCorrect={false}
                autoComplete="off"
                placeholder={t('invitePlaceholder')}
                placeholderTextColor={colors.textMuted}
                style={[
                  styles.passwordInput,
                  {
                    backgroundColor: colors.inputBg,
                    borderColor: colors.inputBorder,
                    color: colors.text,
                  },
                ]}
              />
              {inviteError ? (
                <AppText style={[styles.error, { color: colors.danger }]}>{inviteError}</AppText>
              ) : null}
              <AppTextInput
                value={accountUsername}
                onChangeText={(value) => setAccountUsername(normalizeUsername(value))}
                autoCapitalize="none"
                autoCorrect={false}
                autoComplete="off"
                importantForAutofill="no"
                textContentType="none"
                placeholder={t('usernameField')}
                placeholderTextColor={colors.textMuted}
                style={[
                  styles.passwordInput,
                  {
                    backgroundColor: colors.inputBg,
                    borderColor: colors.inputBorder,
                    color: colors.text,
                  },
                ]}
              />
              <SecretInput
                value={passwordInput}
                onChangeText={(value) => {
                  passwordCommittedRef.current = false;
                  setPasswordInput(value.replace(/\s/g, '').slice(0, PASSWORD_LENGTH));
                }}
                maxLength={PASSWORD_LENGTH}
                placeholder={t('lockNewPassword')}
              />
              <PasswordRulesHint value={passwordInput} />
              <TouchableOpacity
                onPress={() => setKeepOnPhone((value) => !value)}
                style={styles.switchMode}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: keepOnPhone }}
              >
                <AppText style={[styles.switchText, { color: colors.primary }]}>
                  {keepOnPhone
                    ? `${t('saveSession')}: ${t('loanConfirmOn')}`
                    : `${t('saveSession')}: ${t('loanConfirmOff')}`}
                </AppText>
              </TouchableOpacity>
              <TouchableOpacity
                disabled={busy || !canSubmitDeviceCredentials(passwordInput, accountUsername)}
                onPress={() => void submitDeviceCredentials()}
                style={[
                  styles.primary,
                  { backgroundColor: colors.connect },
                  !canSubmitDeviceCredentials(passwordInput, accountUsername) && {
                    backgroundColor: colors.chip,
                  },
                ]}
              >
                {busy ? (
                  <>
                    <ActivityIndicator color="#111" />
                    <AppText style={styles.primaryText}>{t('lockKdfWait')}</AppText>
                  </>
                ) : (
                  <AppText style={styles.primaryText}>{t('createContinue')}</AppText>
                )}
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => {
                  setBusy(false);
                  setSetupStage('welcome');
                  setPendingPhrase('');
                  setPasswordInput('');
                  passwordCommittedRef.current = false;
                  setError('');
                }}
                style={styles.switchMode}
              >
                <AppText style={[styles.switchText, { color: colors.primary }]}>
                  {t('lockRecoverBack')}
                </AppText>
              </TouchableOpacity>
            </View>
          ) : null}

          {sessionReady ? (
            <View style={styles.passwordBlock}>
              <TouchableOpacity
                onPress={keepSession}
                style={[styles.primary, { backgroundColor: colors.connect }]}
              >
                <AppText style={styles.primaryText}>{t('saveSession')}</AppText>
              </TouchableOpacity>
            </View>
          ) : null}

          {recovering ? (
            <View style={styles.passwordBlock}>
              <AppTextInput
                value={recoverEmail}
                onChangeText={(value) => setRecoverEmail(value.trim().toLowerCase())}
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="email-address"
                placeholder={t('emailField')}
                placeholderTextColor={colors.textMuted}
                style={[
                  styles.passwordInput,
                  {
                    backgroundColor: colors.inputBg,
                    borderColor: colors.inputBorder,
                    color: colors.text,
                  },
                ]}
              />
              <TouchableOpacity
                disabled={busy || !recoverEmail || recoverWait > 0 || recoverDayLocked}
                onPress={() => void sendRecover()}
                style={[
                  styles.primary,
                  { backgroundColor: colors.connect },
                  (busy || !recoverEmail || recoverWait > 0 || recoverDayLocked) && {
                    backgroundColor: colors.chip,
                  },
                ]}
              >
                {busy && !recoverSent ? (
                  <ActivityIndicator color="#111" />
                ) : (
                  <AppText style={styles.primaryText}>
                    {recoverWait > 0
                      ? t('otpWait', { seconds: recoverWait })
                      : t('lockRecoverSend')}
                  </AppText>
                )}
              </TouchableOpacity>
              {recoverSent ? (
                <>
                  <AppTextInput
                    value={recoverCode}
                    onChangeText={(value) => setRecoverCode(value.replace(/\D/g, '').slice(0, 6))}
                    keyboardType="number-pad"
                    maxLength={6}
                    placeholder={t('lockRecoverCode')}
                    placeholderTextColor={colors.textMuted}
                    style={[
                      styles.passwordInput,
                      {
                        backgroundColor: colors.inputBg,
                        borderColor: colors.inputBorder,
                        color: colors.text,
                      },
                    ]}
                  />
                  <SecretInput
                    value={passwordInput}
                    onChangeText={(value) =>
                      setPasswordInput(value.replace(/\s/g, '').slice(0, PASSWORD_LENGTH))
                    }
                    maxLength={PASSWORD_LENGTH}
                    placeholder={t('lockNewPassword')}
                  />
                  <SecretInput
                    value={passwordConfirm}
                    onChangeText={(value) =>
                      setPasswordConfirm(value.replace(/\s/g, '').slice(0, PASSWORD_LENGTH))
                    }
                    maxLength={PASSWORD_LENGTH}
                    placeholder={t('lockPasswordConfirm')}
                  />
                  <PasswordRulesHint value={passwordInput} />
                  <TouchableOpacity
                    disabled={busy || recoverDayLocked || recoverCode.length !== 6 || !passwordOk}
                    onPress={() => void submitRecover()}
                    style={[
                      styles.primary,
                      { backgroundColor: colors.connect },
                      (busy || recoverDayLocked || recoverCode.length !== 6 || !passwordOk) && {
                        backgroundColor: colors.chip,
                      },
                    ]}
                  >
                    {busy ? (
                      <>
                        <ActivityIndicator color="#111" />
                        <AppText style={styles.primaryText}>{t('lockKdfWait')}</AppText>
                      </>
                    ) : (
                      <AppText style={styles.primaryText}>{t('saveSession')}</AppText>
                    )}
                  </TouchableOpacity>
                </>
              ) : null}
              <TouchableOpacity
                onPress={() => {
                  setRecovering(false);
                  setError('');
                  setRecoverSent(false);
                  setPasswordInput('');
                  setPasswordConfirm('');
                  if (setup) setSetupStage('welcome');
                }}
                style={styles.switchMode}
              >
                <AppText style={[styles.switchText, { color: colors.primary }]}>
                  {t('lockRecoverBack')}
                </AppText>
              </TouchableOpacity>
            </View>
          ) : null}

          {!setup &&
          !recovering &&
          !sessionReady &&
          (!askingSignIn || signInExtra) &&
          unlockMode === 'authenticator' ? (
            <View style={styles.passwordBlock}>
              <SecretInput
                value={authCode}
                onChangeText={(value) => setAuthCode(value.replace(/\D/g, '').slice(0, 6))}
                keyboardType="number-pad"
                maxLength={6}
                editable={lockMs <= 0}
                placeholder={t('authenticatorCode')}
              />
              <TouchableOpacity
                disabled={busy || lockMs > 0 || authCode.length !== 6}
                onPress={() => void submitUnlockAuthenticator()}
                style={[styles.primary, { backgroundColor: colors.connect }]}
              >
                {busy ? (
                  <>
                    <ActivityIndicator color="#111" />
                    <AppText style={styles.primaryText}>{t('lockKdfWait')}</AppText>
                  </>
                ) : (
                  <AppText style={styles.primaryText}>{t('lockUnlock')}</AppText>
                )}
              </TouchableOpacity>
            </View>
          ) : null}

          {!setup &&
          !recovering &&
          !sessionReady &&
          (!askingSignIn || signInExtra) &&
          unlockMode === 'password' ? (
            <View style={styles.passwordBlock}>
              <SecretInput
                value={passwordInput}
                onChangeText={(value) =>
                  setPasswordInput(value.replace(/\s/g, '').slice(0, PASSWORD_LENGTH))
                }
                maxLength={PASSWORD_LENGTH}
                editable={lockMs <= 0}
                placeholder={t('lockPasswordGenerated')}
              />
              <TouchableOpacity
                disabled={busy || lockMs > 0 || !passwordInput}
                onPress={() => void submitUnlockPassword()}
                style={[styles.primary, { backgroundColor: colors.connect }]}
              >
                {busy ? (
                  <>
                    <ActivityIndicator color="#111" />
                    <AppText style={styles.primaryText}>{t('lockKdfWait')}</AppText>
                  </>
                ) : (
                  <AppText style={styles.primaryText}>{t('lockUnlock')}</AppText>
                )}
              </TouchableOpacity>
            </View>
          ) : null}

          {bioReady &&
          !setup &&
          !recovering &&
          !sessionReady &&
          (!askingSignIn || signInExtra) &&
          (unlockMode === 'biometric' ||
            (!unlockPrimaryOnly && unlockChoices.includes('biometric'))) ? (
            <TouchableOpacity
              onPress={tryBiometric}
              disabled={busy || lockMs > 0}
              style={[styles.bio, { borderColor: colors.border, backgroundColor: colors.surface }]}
              accessibilityRole="button"
              accessibilityLabel={t(
                bioKinds.includes('facial') &&
                  !bioKinds.includes('fingerprint') &&
                  !bioKinds.includes('iris')
                  ? 'lockBiometricFace'
                  : 'lockBiometric'
              )}
            >
              <AppIcon name="shield" size={18} color={colors.primary} />
              <AppText style={[styles.bioText, { color: colors.text }]}>
                {t(
                  bioKinds.includes('facial') &&
                    !bioKinds.includes('fingerprint') &&
                    !bioKinds.includes('iris')
                    ? 'lockBiometricFace'
                    : 'lockBiometric'
                )}
              </AppText>
            </TouchableOpacity>
          ) : null}

          {!setup &&
          !recovering &&
          !sessionReady &&
          !methodQueue.length &&
          (!askingSignIn || signInExtra) &&
          !unlockPrimaryOnly &&
          unlockChoices.includes('password') &&
          hasPassword &&
          unlockMode !== 'password' ? (
            <TouchableOpacity
              onPress={() => {
                setUnlockMode('password');
                setError('');
                setPinDigits('');
                setAuthCode('');
              }}
              style={styles.switchMode}
            >
              <AppText style={[styles.switchText, { color: colors.primary }]}>
                {t('lockPasswordUse')}
              </AppText>
            </TouchableOpacity>
          ) : null}
          {!setup &&
          !recovering &&
          !sessionReady &&
          !methodQueue.length &&
          (!askingSignIn || signInExtra) &&
          !unlockPrimaryOnly &&
          unlockChoices.includes('pin') &&
          hasPin &&
          !pinBlocked &&
          unlockMode !== 'pin' ? (
            <TouchableOpacity
              onPress={() => {
                setUnlockMode('pin');
                setError('');
                setPasswordInput('');
                setAuthCode('');
              }}
              style={styles.switchMode}
            >
              <AppText style={[styles.switchText, { color: colors.primary }]}>
                {t('lockPasswordUsePin')}
              </AppText>
            </TouchableOpacity>
          ) : null}
          {!setup &&
          !recovering &&
          !sessionReady &&
          !methodQueue.length &&
          (!askingSignIn || signInExtra) &&
          !unlockPrimaryOnly &&
          unlockChoices.includes('authenticator') &&
          hasAuth &&
          unlockMode !== 'authenticator' ? (
            <TouchableOpacity
              onPress={() => {
                setUnlockMode('authenticator');
                setError('');
                setPinDigits('');
                setPasswordInput('');
              }}
              style={styles.switchMode}
            >
              <AppText style={[styles.switchText, { color: colors.primary }]}>
                {t('lockPasswordUseAuth')}
              </AppText>
            </TouchableOpacity>
          ) : null}

          {walletMiss &&
          phraseRestoreAfterPasswordUnlock({
            sessionOpen: Boolean(getWalletWrapKey()),
            walletLoaded: false,
          }) === 'phrase' ? (
            <TouchableOpacity
              onPress={() => {
                setWalletMiss(false);
                setNeedsSetup(true);
                setSetupStage('restore');
                setLocked(false);
                setError('');
                setRestorePhrase('');
                setPasswordInput('');
                setAccountUsername('');
              }}
              style={styles.switchMode}
              accessibilityRole="button"
              accessibilityLabel={t('lockRestoreWithPhrase')}
            >
              <AppText style={[styles.switchText, { color: colors.primary }]}>
                {t('lockRestoreWithPhrase')}
              </AppText>
            </TouchableOpacity>
          ) : null}

          {locked && !needsSetup && restoreFromLockScreen('lock') === 'restore' ? (
            <TouchableOpacity
              onPress={() => {
                setNeedsSetup(true);
                setSetupStage('restore');
                setLocked(false);
                setError('');
                setRestorePhrase('');
                setPasswordInput('');
                setAccountUsername('');
              }}
              style={styles.switchMode}
              accessibilityRole="button"
              accessibilityLabel={t('restoreAccount')}
            >
              <AppText style={[styles.switchText, { color: colors.primary }]}>
                {t('restoreAccount')}
              </AppText>
            </TouchableOpacity>
          ) : null}

          {sessionTaken && !recovering && !sessionReady ? (
            <TouchableOpacity
              onPress={() => {
                setAskingSignIn(false);
                setNeedsSetup(true);
                setSetupStage('restore');
                setLocked(false);
                setError('');
                setRestorePhrase('');
                setPasswordInput('');
                setAccountUsername('');
              }}
              style={styles.switchMode}
            >
              <AppText style={[styles.switchText, { color: colors.primary }]}>
                {t('restoreAccount')}
              </AppText>
            </TouchableOpacity>
          ) : null}

          {!setup &&
          !recovering &&
          !sessionReady &&
          (!askingSignIn || signInExtra) &&
          hasPassword ? (
            <TouchableOpacity
              onPress={() => {
                setRecovering(true);
                setError('');
                setPasswordInput('');
                setPasswordConfirm('');
              }}
              style={styles.switchMode}
            >
              <AppText style={[styles.switchText, { color: colors.primary }]}>
                {t('lockForgotPassword')}
              </AppText>
            </TouchableOpacity>
          ) : null}

          {!setup &&
          !recovering &&
          !sessionReady &&
          (!askingSignIn || signInExtra) &&
          unlockMode === 'pin' ? (
            <View style={styles.pad}>
              {KEYS.map((key, index) => (
                <TouchableOpacity
                  key={`${key}-${index}`}
                  disabled={!key || busy || (!setup && lockMs > 0)}
                  onPress={() => pressKey(key)}
                  style={[styles.key, !key && styles.keyGhost]}
                  accessibilityRole={key ? 'button' : undefined}
                  accessibilityLabel={key === '⌫' ? t('lockBackspace') : key}
                >
                  <AppText style={[styles.keyText, { color: colors.text }]}>{key}</AppText>
                </TouchableOpacity>
              ))}
            </View>
          ) : null}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  fill: {
    flex: 1,
  },
  scroll: {
    flexGrow: 1,
    paddingBottom: 48,
  },
  hero: {
    paddingHorizontal: 28,
    paddingTop: 36,
    alignItems: 'center',
  },
  title: {
    fontSize: 22,
    fontWeight: '600',
    marginTop: 16,
    textAlign: 'center',
  },
  lead: {
    fontSize: 14,
    lineHeight: 20,
    marginTop: 8,
    textAlign: 'center',
  },
  emailNote: {
    fontSize: 13,
    lineHeight: 18,
    marginTop: 10,
    textAlign: 'center',
  },
  dots: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 28,
  },
  dot: {
    width: 14,
    height: 14,
    borderRadius: 7,
    borderWidth: 1.5,
  },
  error: {
    marginTop: 14,
    fontSize: 13,
    textAlign: 'center',
  },
  bio: {
    marginHorizontal: 28,
    marginTop: 24,
    borderWidth: 1,
    borderRadius: 12,
    paddingVertical: 12,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 8,
  },
  bioText: {
    fontSize: 15,
    fontWeight: '600',
  },
  pad: {
    marginTop: 28,
    paddingHorizontal: 36,
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
  },
  key: {
    width: '30%',
    aspectRatio: 1.4,
    alignItems: 'center',
    justifyContent: 'center',
  },
  keyGhost: {
    opacity: 0,
  },
  keyText: {
    fontSize: 24,
    fontWeight: '500',
  },
  passwordBlock: {
    paddingHorizontal: 24,
    marginTop: 20,
  },
  passwordInput: {
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 12,
    fontSize: 14,
    marginBottom: 8,
  },
  phraseInput: {
    minHeight: 88,
    textAlignVertical: 'top',
  },
  counter: {
    marginTop: 0,
    marginBottom: 8,
    fontSize: 12,
    textAlign: 'right',
  },
  primary: {
    borderRadius: 12,
    paddingVertical: 13,
    alignItems: 'center',
    marginTop: 16,
  },
  secondary: {
    borderWidth: 1,
    marginTop: 12,
  },
  primaryText: {
    color: '#111',
    fontSize: 15,
    fontWeight: '600',
  },
  switchMode: {
    marginTop: 20,
    alignItems: 'center',
  },
  switchText: {
    fontSize: 14,
    fontWeight: '600',
  },
});
