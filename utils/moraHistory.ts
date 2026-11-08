export const MORA_GRACE_DAYS = 30;
export const FAMA_PER_MORA_DAY = 10;
export const GEN1_BP = 1500n;

export type MoraToggle = { at: number; on: boolean };

export type MoraSpell = {
  id: string;
  startedAt: number;
  endedAt: number | null;
  days: number;
  penaltyDays: number;
  fameLost: number;
  benefitsBlocked: boolean;
  poolWei: bigint;
};

export function moraDays(startedAt: number, endedAt: number): number {
  if (!startedAt || endedAt <= startedAt) return 0;
  return Math.max(0, Math.floor((endedAt - startedAt) / 86_400_000));
}

export function moraPenaltyDays(days: number, graceDays = MORA_GRACE_DAYS): number {
  return Math.max(0, Math.floor(days) - graceDays);
}

export function moraFameLost(penaltyDays: number, level: number): number {
  const safeLevel = Number.isFinite(level) && level > 0 ? Math.floor(level) : 1;
  return Math.max(0, Math.floor(penaltyDays)) * FAMA_PER_MORA_DAY * safeLevel;
}

export function moraBenefitsBlocked(penaltyDays: number): boolean {
  return penaltyDays > 0;
}

export function gen1ShareWei(interestWei: bigint): bigint {
  if (interestWei <= 0n) return 0n;
  return (interestWei * GEN1_BP) / 10_000n;
}

export function buildMoraSpells(toggles: MoraToggle[], now: number, level: number): MoraSpell[] {
  const ordered = [...toggles].filter((item) => item.at > 0).sort((a, b) => a.at - b.at);
  const spells: MoraSpell[] = [];
  let openAt = 0;
  for (const item of ordered) {
    if (item.on) {
      if (!openAt) openAt = item.at;
      continue;
    }
    if (!openAt) continue;
    spells.push(spellFromRange(openAt, item.at, now, level, false));
    openAt = 0;
  }
  if (openAt) spells.push(spellFromRange(openAt, now, now, level, true));
  return spells.reverse();
}

function spellFromRange(
  startedAt: number,
  endedAt: number,
  now: number,
  level: number,
  open: boolean
): MoraSpell {
  const end = open ? null : endedAt;
  const days = moraDays(startedAt, endedAt || now);
  const penaltyDays = moraPenaltyDays(days);
  return {
    id: `${startedAt}-${end || 'open'}`,
    startedAt,
    endedAt: end,
    days,
    penaltyDays,
    fameLost: moraFameLost(penaltyDays, level),
    benefitsBlocked: penaltyDays > 0,
    poolWei: 0n,
  };
}

export function addPoolToSpells(
  spells: MoraSpell[],
  paidAt: number,
  interestWei: bigint
): MoraSpell[] {
  const share = gen1ShareWei(interestWei);
  if (share <= 0n || !paidAt) return spells;
  return spells.map((spell) => {
    const end = spell.endedAt || Number.MAX_SAFE_INTEGER;
    const penaltyStart = spell.startedAt + MORA_GRACE_DAYS * 86_400_000;
    if (paidAt < penaltyStart || paidAt > end) return spell;
    return { ...spell, poolWei: spell.poolWei + share };
  });
}

export function isTransferMovement(kind: string): boolean {
  return kind === 'transfer_in' || kind === 'transfer_out';
}

export function isLoanMovement(kind: string): boolean {
  return kind === 'loan' || kind === 'payment';
}

export function isSupportMovement(kind: string): boolean {
  return kind === 'bonus' || kind === 'donation' || kind === 'access';
}
