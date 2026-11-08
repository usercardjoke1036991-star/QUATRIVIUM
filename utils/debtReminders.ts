export type DebtReminderKind = 'mid' | 'cutoff';

export interface DebtReminderWindows {
  start: number;
  mid: number;
  due: number;
  cutoffAt: number;
}

export interface DebtReminderInput {
  loanStart: number;
  loanDue: number;
  nextInstallmentDue: number;
  installments: number;
}

const DAY = 86400;

export function getInstallmentWindows(input: DebtReminderInput): DebtReminderWindows | null {
  const loanStart = Number(input.loanStart) || 0;
  const loanDue = Number(input.loanDue) || 0;
  const nextDue = Number(input.nextInstallmentDue) || loanDue;
  const n = Math.max(1, Number(input.installments) || 1);
  if (nextDue <= 0) return null;

  const full = Math.max(0, loanDue - loanStart);
  const duration =
    n <= 1
      ? full > 0
        ? full
        : Math.max(1, nextDue - loanStart)
      : full > 0
        ? Math.max(1, Math.floor(full / n))
        : Math.max(1, nextDue - loanStart);

  const start =
    n <= 1 ? loanStart || nextDue - duration : Math.max(loanStart || 0, nextDue - duration);
  const due = nextDue;
  const span = Math.max(1, due - start);
  const cutoffLead =
    span >= 3 * DAY ? DAY : Math.min(6 * 3600, Math.max(3600, Math.floor(span / 4)));

  return {
    start,
    mid: start + Math.floor(span / 2),
    due,
    cutoffAt: due - cutoffLead,
  };
}

export function visibleDebtReminder(
  windows: DebtReminderWindows | null,
  now = Math.floor(Date.now() / 1000)
): DebtReminderKind | null {
  if (!windows) return null;
  if (now >= windows.cutoffAt) return 'cutoff';
  if (now >= windows.mid) return 'mid';
  return null;
}

export function canSendMidReminder(windows: DebtReminderWindows): boolean {
  return windows.mid < windows.cutoffAt - 3600;
}

export function shouldSendDebtReminder(
  windows: DebtReminderWindows,
  kind: DebtReminderKind,
  now = Math.floor(Date.now() / 1000)
): boolean {
  if (kind === 'mid') {
    if (!canSendMidReminder(windows)) return false;
    return now >= windows.mid && now < windows.cutoffAt;
  }
  return now >= windows.cutoffAt && now <= windows.due + 3600;
}

export function upcomingReminderTriggers(
  windows: DebtReminderWindows | null,
  now = Math.floor(Date.now() / 1000)
): { kind: DebtReminderKind; at: number }[] {
  if (!windows) return [];
  const out: { kind: DebtReminderKind; at: number }[] = [];
  if (canSendMidReminder(windows) && windows.mid > now) {
    out.push({ kind: 'mid', at: windows.mid });
  }
  if (windows.cutoffAt > now) {
    out.push({ kind: 'cutoff', at: windows.cutoffAt });
  }
  return out;
}
