export function asWei(value: string | number | bigint | undefined): bigint {
  try {
    if (typeof value === 'bigint') return value;
    if (typeof value === 'number') return BigInt(Math.max(0, Math.floor(value)));
    if (!value) return 0n;
    return BigInt(value);
  } catch {
    return 0n;
  }
}

export function sumReferralEarnings(nodes: { commissionWei?: string; bonusWei?: string }[]): {
  commissionWei: bigint;
  bonusWei: bigint;
  totalWei: bigint;
} {
  let commissionWei = 0n;
  let bonusWei = 0n;
  for (const node of nodes || []) {
    commissionWei += asWei(node.commissionWei);
    bonusWei += asWei(node.bonusWei);
  }
  return { commissionWei, bonusWei, totalWei: commissionWei + bonusWei };
}

/** Suma un pago al directo. Sirve aunque el registro de alta no haya llegado en el barrido. */
export function creditDirectWei(
  earnedWei: string,
  bonusWei: string,
  commissionWei: string,
  amount: bigint,
  kind: 'bonus' | 'commission'
): { earnedWei: string; bonusWei: string; commissionWei: string } {
  const earned = asWei(earnedWei) + amount;
  const bonus = asWei(bonusWei) + (kind === 'bonus' ? amount : 0n);
  const commission = asWei(commissionWei) + (kind === 'commission' ? amount : 0n);
  return {
    earnedWei: earned.toString(),
    bonusWei: bonus.toString(),
    commissionWei: commission.toString(),
  };
}
