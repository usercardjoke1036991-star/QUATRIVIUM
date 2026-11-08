import { isPasswordSet, isPinSet } from './appLock';
import { isAuthenticatorEnabled } from './authenticator';
import { getAuthMethods, isAuthEnabled, isMethodReady, type AuthMethod } from './authPrefs';

export type FundsConfirmPurpose = 'transfer' | 'loanRequest' | 'loanPay' | 'security' | 'movement';
export type LoanConfirmKind = 'loanRequest' | 'loanPay';

export async function listSecurityConfirmMethods(): Promise<AuthMethod[]> {
  const ready: AuthMethod[] = [];
  if (await isPasswordSet()) ready.push('password');
  if (await isPinSet()) ready.push('pin');
  if (await isMethodReady('biometric')) ready.push('biometric');
  if (await isAuthenticatorEnabled()) ready.push('authenticator');
  const preferred = await getAuthMethods('unlock');
  const ordered: AuthMethod[] = [];
  for (const method of preferred) {
    if (ready.includes(method) && !ordered.includes(method)) ordered.push(method);
  }
  for (const method of ready) {
    if (!ordered.includes(method)) ordered.push(method);
  }
  return ordered;
}

export async function hasSecurityConfirmMethod(): Promise<boolean> {
  return (await listSecurityConfirmMethods()).length > 0;
}

export async function isFundsConfirmEnabled(): Promise<boolean> {
  return isAuthEnabled('funds');
}

export async function isLoanConfirmEnabled(kind: LoanConfirmKind): Promise<boolean> {
  return isAuthEnabled(kind);
}

export async function setFundsConfirmEnabled(_enabled: boolean): Promise<void> {
  // Los interruptores viven en Cómo confirma (authPrefs).
}

export async function setLoanConfirmEnabled(
  _kind: LoanConfirmKind,
  _enabled: boolean
): Promise<void> {
  // Los interruptores viven en Cómo confirma (authPrefs).
}
