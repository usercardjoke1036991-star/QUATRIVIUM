export const FAME_PAGE_SIZE = 10;
export const RANKING_UNLOCK_LEVEL = 15;

export type FameBoardKind =
  | 'referrals'
  | 'loans'
  | 'fame'
  | 'streak'
  | 'level'
  | 'bonuses'
  | 'combined';

export const FAME_BOARD_KINDS: FameBoardKind[] = [
  'referrals',
  'loans',
  'fame',
  'streak',
  'level',
  'bonuses',
  'combined',
];

export interface FamePlayer {
  address: string;
  userNumber: number;
  referrals: number;
  loansRequested: number;
  loansPaid: number;
  paidUsd: number;
  fame: number;
  streakDays: number;
  level: number;
  bonuses: number;
  bonusUsd: number;
  delinquent: boolean;
  combined: number;
}

export function rankingVisible(level: number): boolean {
  return Number.isFinite(level) && level >= RANKING_UNLOCK_LEVEL;
}

export function normalizeFameMetric(value: number, max: number): number {
  if (!Number.isFinite(value) || value <= 0) return 0;
  if (!Number.isFinite(max) || max <= 0) return 0;
  return value / max;
}

export function attachCombinedScores(players: FamePlayer[]): FamePlayer[] {
  const list = Array.isArray(players) ? players : [];
  const maxReferrals = Math.max(0, ...list.map((row) => row.referrals || 0));
  const maxPaid = Math.max(0, ...list.map((row) => row.loansPaid || 0));
  const maxUsd = Math.max(0, ...list.map((row) => row.paidUsd || 0));
  const maxFame = Math.max(0, ...list.map((row) => row.fame || 0));
  const maxStreak = Math.max(0, ...list.map((row) => row.streakDays || 0));
  const maxLevel = Math.max(0, ...list.map((row) => row.level || 0));
  const maxBonusUsd = Math.max(0, ...list.map((row) => row.bonusUsd || 0));
  return list.map((row) => ({
    ...row,
    combined:
      normalizeFameMetric(row.referrals, maxReferrals) +
      normalizeFameMetric(row.loansPaid, maxPaid) +
      normalizeFameMetric(row.paidUsd, maxUsd) +
      normalizeFameMetric(row.fame, maxFame) +
      normalizeFameMetric(row.streakDays, maxStreak) +
      normalizeFameMetric(row.level, maxLevel) +
      normalizeFameMetric(row.bonusUsd, maxBonusUsd),
  }));
}

export function fameBoardMetric(player: FamePlayer, kind: FameBoardKind): number {
  if (kind === 'referrals') return Number(player.referrals) || 0;
  if (kind === 'fame') return Number(player.fame) || 0;
  if (kind === 'streak') return Number(player.streakDays) || 0;
  if (kind === 'level') return Number(player.level) || 0;
  if (kind === 'bonuses') {
    const usd = Number(player.bonusUsd) || 0;
    const count = Number(player.bonuses) || 0;
    return usd * 1e6 + count;
  }
  if (kind === 'combined') return Number(player.combined) || 0;
  const paid = Number(player.loansPaid) || 0;
  const usd = Number(player.paidUsd) || 0;
  const requested = Number(player.loansRequested) || 0;
  return paid * 1e12 + usd * 1e6 + requested;
}

export function sortFameBoard(players: FamePlayer[], kind: FameBoardKind): FamePlayer[] {
  const list = Array.isArray(players) ? [...players] : [];
  return list.sort((left, right) => {
    const delta = fameBoardMetric(right, kind) - fameBoardMetric(left, kind);
    if (delta !== 0) return delta;
    const levelDelta = (right.level || 0) - (left.level || 0);
    if (levelDelta !== 0) return levelDelta;
    return (left.userNumber || 0) - (right.userNumber || 0);
  });
}

export function podiumPlayers(players: FamePlayer[], kind: FameBoardKind): FamePlayer[] {
  return sortFameBoard(players, kind)
    .filter((row) => fameBoardMetric(row, kind) > 0)
    .slice(0, 3);
}

export type PodiumPlace = 1 | 2 | 3;

export function podiumPlace(rank: number): PodiumPlace | 0 {
  if (rank === 1) return 1;
  if (rank === 2) return 2;
  if (rank === 3) return 3;
  return 0;
}

export function rankedFameRows(
  players: FamePlayer[],
  kind: FameBoardKind
): Array<{
  player: FamePlayer;
  rank: number;
  place: PodiumPlace | 0;
}> {
  return sortFameBoard(players, kind).map((player, index) => {
    const rank = index + 1;
    return { player, rank, place: podiumPlace(rank) };
  });
}

export function fameListAfterPodium<T>(rows: T[]): T[] {
  return Array.isArray(rows) && rows.length > 3 ? rows.slice(3) : [];
}
