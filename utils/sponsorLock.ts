import { addressToInviteCode, parseInviteInput } from './inviteCode';
import { storeSlot } from './storeSlot';

export type LockedSponsor = {
  v: 1;
  at: string;
  code: string;
  padre: string;
  chosen?: boolean;
};

export type SponsorResolve =
  | { ok: true; code: string; padre: string }
  | { ok: false; reason: 'invalid' | 'self' };

export const SPONSOR_LOCK_PREFIX = `${storeSlot(['quatrivium', 'sponsor', 'lock'])}.`;

export function sponsorLockKey(wallet: string): string {
  return `${SPONSOR_LOCK_PREFIX}${String(wallet || '')
    .trim()
    .toLowerCase()}`;
}

export function resolveSponsorInput(raw: string, selfWallet = ''): SponsorResolve {
  const trimmed = String(raw || '').trim();
  if (!trimmed) return { ok: true, code: '', padre: '' };

  const parsed = parseInviteInput(trimmed);
  if (parsed === null) return { ok: false, reason: 'invalid' };
  if (!parsed) return { ok: true, code: '', padre: '' };

  if (selfWallet && parsed.toLowerCase() === selfWallet.trim().toLowerCase()) {
    return { ok: false, reason: 'self' };
  }

  return { ok: true, code: addressToInviteCode(parsed), padre: parsed };
}

export function parseLockedSponsor(raw: string | null | undefined): LockedSponsor | null {
  if (!raw) return null;
  try {
    const data = JSON.parse(raw) as Partial<LockedSponsor>;
    if (!data || data.v !== 1 || typeof data.at !== 'string' || !data.at.trim()) return null;
    if (typeof data.code !== 'string' || typeof data.padre !== 'string') return null;
    const resolved = resolveSponsorInput(data.padre || data.code, '');
    if (!resolved.ok) return null;
    return {
      v: 1,
      at: data.at,
      code: resolved.code,
      padre: resolved.padre,
      chosen: data.chosen === true,
    };
  } catch {
    return null;
  }
}

export function buildLockedSponsor(
  raw: string,
  selfWallet: string,
  at = new Date().toISOString()
): LockedSponsor {
  const resolved = resolveSponsorInput(raw, selfWallet);
  if (!resolved.ok) {
    throw new Error(resolved.reason);
  }
  return { v: 1, at, code: resolved.code, padre: resolved.padre };
}

export function keepFirstLock(existing: LockedSponsor | null, next: LockedSponsor): LockedSponsor {
  return existing || next;
}
