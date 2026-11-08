import { formatUSD } from '../utils/formatters';

/** GEN1_BP del núcleo. El 15% del interés va al padrino directo, salvo el primer L1. */
export const DIRECT_COMMISSION_BPS = 1500;
/** BONO_ACTIVACION: 1 USDT del pool al padrino directo en el primer L1 pagado. */
export const ACTIVATION_BONUS_USD = 1;
export const MAX_COMMISSION_LINE = 40;
export const POOL_FLOOR_BP = 4000;

export function interestFromLoan(usdAmount: number, interestBps: number): number {
  return (usdAmount * interestBps) / 10000;
}

export function generationCommissionBps(gen: number): number {
  if (gen <= 0 || gen > MAX_COMMISSION_LINE) return 0;
  if (gen === 1) return 1500;
  if (gen === 2) return 800;
  if (gen === 3) return 600;
  if (gen === 4) return 400;
  if (gen === 5) return 200;
  if (gen <= 12) return 80;
  return 40;
}

export function directCommissionFromLoan(usdAmount: number, interestBps: number): number {
  return (interestFromLoan(usdAmount, interestBps) * DIRECT_COMMISSION_BPS) / 10000;
}

export function formatCommissionUSD(amount: number): string {
  if (amount >= 1) return formatUSD(amount);
  if (amount >= 0.01) return `$${amount.toFixed(3)}`;
  return `$${amount.toFixed(4)}`;
}

export function commissionForGeneration(
  usdAmount: number,
  interestBps: number,
  gen: number
): number {
  return (interestFromLoan(usdAmount, interestBps) * generationCommissionBps(gen)) / 10000;
}

export const COMMISSION_BANDS: ReadonlyArray<{ range: string; gen: number }> = [
  { range: '1', gen: 1 },
  { range: '2', gen: 2 },
  { range: '3', gen: 3 },
  { range: '4', gen: 4 },
  { range: '5', gen: 5 },
  { range: '6–12', gen: 6 },
  { range: '13–40', gen: 13 },
];

/** Lista 1–40 para la ficha de cada nivel (LoanTierCard). */
export function commissionLine(): number[] {
  return Array.from({ length: MAX_COMMISSION_LINE }, (_, index) => index + 1);
}

export function commissionBandsForLoan(
  usdAmount: number,
  interestBps: number
): Array<{ range: string; amount: number }> {
  return COMMISSION_BANDS.map((band) => ({
    range: band.range,
    amount: commissionForGeneration(usdAmount, interestBps, band.gen),
  }));
}

/** Lista por nivel: gens 1–12 una a una; 13–40 en una sola fila (misma tasa). */
export function commissionRowsForLoan(
  usdAmount: number,
  interestBps: number
): Array<{ range: string; amount: number }> {
  const rows: Array<{ range: string; amount: number }> = [];
  for (let gen = 1; gen <= 12; gen++) {
    rows.push({
      range: String(gen),
      amount: commissionForGeneration(usdAmount, interestBps, gen),
    });
  }
  rows.push({
    range: '13–40',
    amount: commissionForGeneration(usdAmount, interestBps, 13),
  });
  return rows;
}

/** Comisión directa (gen 1) por cada nivel de préstamo L1…L1000. */
export function directCommissionRowsForTiers(
  tiers: ReadonlyArray<{ id: number; usdAmount: number; interestBps: number }>,
  curveRateBps = 0
): Array<{ id: number; usdAmount: number; amount: number }> {
  return tiers.map((tier) => ({
    id: tier.id,
    usdAmount: tier.usdAmount,
    amount: directCommissionFromLoan(tier.usdAmount, Math.max(tier.interestBps, curveRateBps || 0)),
  }));
}
