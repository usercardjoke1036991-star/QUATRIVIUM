type LockTextKey =
  | 'lockPasswordPrivateKey'
  | 'lockKdfMissing'
  | 'lockKeychainSlow'
  | 'lockStoreUnknown'
  | 'errWalletPersist'
  | 'lockPasswordWeak';

type LockText = (key: LockTextKey) => string;

export function passwordFailText(error: unknown, t: LockText): string {
  const code = error instanceof Error ? error.message : '';
  if (code === 'password-key') return t('lockPasswordPrivateKey');
  if (code === 'pbkdf2-missing') return t('lockKdfMissing');
  return lockStoreFailureText(code, t) ?? t('lockPasswordWeak');
}

export function lockStoreFailureText(code: string, t: LockText): string | null {
  if (code === 'keychain-timeout') return t('lockKeychainSlow');
  if (code === 'store-unknown') return t('lockStoreUnknown');
  if (code === 'password-persist') return t('errWalletPersist');
  return null;
}
