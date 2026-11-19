type LockTextKey =
  | 'lockPasswordPrivateKey'
  | 'lockKdfMissing'
  | 'lockKeychainSlow'
  | 'lockStoreUnknown'
  | 'errWalletPersist'
  | 'lockPasswordLocked'
  | 'lockPasswordWeak'
  | 'emailExpired'
  | 'errWalletOtherApp'
  | 'seedInvalid'
  | 'errDeviceBound'
  | 'appWalletFailed';

type LockText = (key: LockTextKey) => string;

export function passwordFailText(error: unknown, t: LockText): string {
  const code = error instanceof Error ? error.message : '';
  if (code === 'password-key') return t('lockPasswordPrivateKey');
  if (code === 'pbkdf2-missing') return t('lockKdfMissing');
  if (code === 'password-locked') return t('lockPasswordLocked');
  return lockStoreFailureText(code, t) ?? t('lockPasswordWeak');
}

export function lockStoreFailureText(code: string, t: LockText): string | null {
  if (code === 'keychain-timeout') return t('lockKeychainSlow');
  if (code === 'store-unknown') return t('lockStoreUnknown');
  if (code === 'password-persist') return t('errWalletPersist');
  return null;
}

export function restoreFailText(reason: string, t: LockText): string {
  return (
    lockStoreFailureText(reason, t) ||
    (reason === 'password-locked'
      ? t('emailExpired')
      : reason === 'wallet-other-app'
        ? t('errWalletOtherApp')
        : reason === 'phrase'
          ? t('seedInvalid')
          : reason === 'wallet-persist'
            ? t('errWalletPersist')
            : reason === 'device-bound'
              ? t('errDeviceBound')
              : t('appWalletFailed'))
  );
}
