export const GRACE_SECONDS = 30 * 86_400;

export type GraceMoraPhase = 'none' | 'grace' | 'mora';

export function paymentDueAt(
  loan: { vencimiento?: number; proximaCuota?: number } | null | undefined
): number {
  if (!loan) return 0;
  const due = Number(loan.vencimiento) || 0;
  const next = Number(loan.proximaCuota) || 0;
  if (due > 0 && next > 0) return Math.min(due, next);
  return due || next;
}

export function graceEndsAt(dueAt: number): number {
  const due = Number(dueAt) || 0;
  return due > 0 ? due + GRACE_SECONDS : 0;
}

export function graceMoraPhase(
  input: {
    hasActiveLoan: boolean;
    dueAt: number;
    isFounder?: boolean;
  },
  now = Math.floor(Date.now() / 1000)
): GraceMoraPhase {
  if (input.isFounder || !input.hasActiveLoan) return 'none';
  const due = Number(input.dueAt) || 0;
  if (due <= 0 || now < due) return 'none';
  if (now < graceEndsAt(due)) return 'grace';
  return 'mora';
}

export function graceRemainingSeconds(dueAt: number, now = Math.floor(Date.now() / 1000)): number {
  return Math.max(0, graceEndsAt(dueAt) - now);
}

export function moraElapsedSeconds(dueAt: number, now = Math.floor(Date.now() / 1000)): number {
  return Math.max(0, now - graceEndsAt(dueAt));
}

export function graceMoraSeconds(
  phase: GraceMoraPhase,
  dueAt: number,
  now = Math.floor(Date.now() / 1000)
): number {
  if (phase === 'grace') return graceRemainingSeconds(dueAt, now);
  if (phase === 'mora') return moraElapsedSeconds(dueAt, now);
  return 0;
}
