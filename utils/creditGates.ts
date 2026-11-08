import { CREDIT_ALTA_USDT, isAltaConfigured } from '../constants/altaConfig';
import { isDemoAccount } from '../constants/rpcConfig';

export type LiveCreditFlags = {
  phraseBackedUp: boolean;
};

/** Anotar las 24 palabras antes de pedir crédito. Único requisito local soberano (sin KYC, correo ni teléfono). */
export function liveNeedsPhrase(phraseBackedUp: boolean): boolean {
  return !phraseBackedUp;
}

/** Con Alta: 4 USDT también en Demo. Sin Alta: solo Real (legado 2 USDT). */
export function liveNeedsAccess(demo: boolean, paidUsd: number, altaPaid = false): boolean {
  if (hasCreditAccess(paidUsd, altaPaid)) return false;
  if (isAltaConfigured()) return true;
  return !demo;
}

export function liveCreditReady(_demo: boolean, flags: LiveCreditFlags): boolean {
  return !liveNeedsPhrase(flags.phraseBackedUp);
}

export type LoanGateBannerRow = 'phrase';

/** Con wallet soberana solo queda la frase de 24 palabras. */
export function loanGateBannerRows(input: { phraseDone: boolean }): LoanGateBannerRow[] {
  return input.phraseDone ? [] : ['phrase'];
}

export function liveCreditBlockReason(_demo: boolean, flags: LiveCreditFlags): 'phrase' | null {
  return liveNeedsPhrase(flags.phraseBackedUp) ? 'phrase' : null;
}

export function creditNeedsPhrase(phraseBackedUp: boolean): boolean {
  return liveNeedsPhrase(phraseBackedUp);
}

/** Hub de identidad ya no existe: el alta de 4 LUSD es la única puerta. */
export function identityUnlocked(paidUsd: number, altaPaid = false): boolean {
  return hasCreditAccess(paidUsd, altaPaid);
}

export const CREDIT_ACCESS_LEGACY_USDT = 2;
export const CREDIT_ACCESS_USDT = CREDIT_ALTA_USDT;
export type VerificationFeeKind = 'kyc' | 'phone' | 'email';

export function verificationFeeUsdt(_kind: VerificationFeeKind, _demo?: boolean): number {
  return 0;
}

export function isHiddenVerificationDonation(_usdAmount: number, _demo?: boolean): boolean {
  return false;
}

export function accessPayUsdt(): number {
  return isAltaConfigured() ? CREDIT_ALTA_USDT : CREDIT_ACCESS_LEGACY_USDT;
}

export function creditAccessPaidUsd(donatedUsd: number, altaPaid = false): number {
  const donated = Number(donatedUsd);
  const gift = Number.isFinite(donated) && donated > 0 ? donated : 0;
  if (altaPaid) return Math.max(gift, CREDIT_ALTA_USDT);
  return gift;
}

/** Alta nueva = `registroHecho`. Una donación no sustituye el alta. El legado acepta 2. */
export function hasCreditAccess(paidUsd: number, altaPaid = false): boolean {
  if (altaPaid) return true;
  if (isAltaConfigured()) return false;
  const paid = Number(paidUsd);
  if (!Number.isFinite(paid)) return false;
  return paid + 1e-9 >= CREDIT_ACCESS_LEGACY_USDT;
}

/** Con Alta, todo lo donado cuenta. Legado sin Alta: los primeros 2 eran la puerta. */
export function voluntaryDonateUsd(paidUsd: number): number {
  const paid = Number(paidUsd);
  if (!Number.isFinite(paid) || paid <= 0) return 0;
  if (isAltaConfigured()) return paid;
  if (!hasCreditAccess(paid)) return 0;
  return Math.max(0, paid - CREDIT_ACCESS_LEGACY_USDT);
}

/** Con Alta el acceso no pasa por donar. Legado: la primera de 2 USDT era la puerta. */
export function classifyDonationKind(
  usdAmount: number,
  isFirstDonation: boolean
): 'access' | 'donation' {
  if (isAltaConfigured()) return 'donation';
  const usd = Number(usdAmount);
  if (isFirstDonation && Number.isFinite(usd) && Math.abs(usd - CREDIT_ACCESS_LEGACY_USDT) < 1e-6) {
    return 'access';
  }
  return 'donation';
}

export function creditNeedsAccess(paidUsd: number, altaPaid = false): boolean {
  return liveNeedsAccess(isDemoAccount(), paidUsd, altaPaid);
}

/** Con Alta basta el fundador. Legado: donar + destino + red Real. */
export function canPayCreditAccess(input: {
  protocolCanDonate: boolean;
  founderAddress: string;
  accessEnabled: boolean;
  altaReady?: boolean;
}): boolean {
  const dest = Boolean(String(input.founderAddress || '').trim());
  if (input.altaReady || isAltaConfigured()) return dest;
  return Boolean(input.protocolCanDonate && dest && input.accessEnabled);
}

/** Línea activa solo si el contrato del mundo actual existe. Real no hereda el registro de Demo. */
export function creditLineLooksActive(
  creditReady: boolean,
  isRegistered: boolean,
  hasActiveLoan: boolean
): boolean {
  return Boolean(creditReady && (isRegistered || hasActiveLoan));
}

/** No hidratar crédito cacheado si el mundo no tiene contrato o ya llegó el RPC. */
export function canHydrateCreditStatus(input: {
  configured: boolean;
  chainReady: boolean;
  savedContract?: string;
  currentContract: string;
}): boolean {
  if (!input.configured || input.chainReady) return false;
  const saved = String(input.savedContract || '')
    .trim()
    .toLowerCase();
  const current = String(input.currentContract || '')
    .trim()
    .toLowerCase();
  if (saved && current && saved !== current) return false;
  return true;
}

/** Baldosa Admin: fundadora o admin en Real y en Demo. En Demo basta la sesión externa. */
export function adminSeatOpen(input: {
  demo: boolean;
  connected: boolean;
  address?: string | null;
  isAdmin?: boolean;
  isOwner?: boolean;
  roster?: string[];
  founder?: boolean;
}): boolean {
  const privileged = Boolean(input.isAdmin || input.isOwner || input.founder);
  const wallet = String(input.address || '')
    .trim()
    .toLowerCase();
  const onRoster =
    Boolean(wallet) &&
    (input.roster || []).some((item) => String(item || '').toLowerCase() === wallet);
  if (!privileged && !onRoster) return false;
  if (input.demo && !input.connected && !privileged) return false;
  return true;
}
