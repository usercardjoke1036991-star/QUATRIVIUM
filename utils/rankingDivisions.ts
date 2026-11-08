import { sortFameBoard, type FameBoardKind, type FamePlayer } from './fameRankings';

export const RANKING_DIVISION_SIZE = 100;
/** 1,5 % de la caja libre por encima del suelo del 20 %. */
export const RANKING_PRIZE_BUDGET_BP = 150;
export const RANKING_PRIZE_FLOOR_BP = 2000;

export interface RankingSeat {
  player: FamePlayer;
  globalRank: number;
  division: number;
  placeInDivision: number;
  prizeUsd: number;
}

export function monthlyPrizeBudgetUsd(poolCashUsd: number, poolNavUsd: number): number {
  const cash = Math.max(0, Number(poolCashUsd) || 0);
  const nav = Math.max(0, Number(poolNavUsd) || 0);
  const floor = (nav * RANKING_PRIZE_FLOOR_BP) / 10000;
  const surplus = Math.max(0, cash - floor);
  if (surplus <= 0) return 0;
  return (surplus * RANKING_PRIZE_BUDGET_BP) / 10000;
}

export function divisionCountFor(playerCount: number): number {
  const n = Math.max(0, Math.floor(Number(playerCount) || 0));
  if (n <= 0) return 0;
  return Math.ceil(n / RANKING_DIVISION_SIZE);
}

export function divisionWeight(division: number, totalDivisions: number): number {
  if (division < 1 || totalDivisions < 1 || division > totalDivisions) return 0;
  return totalDivisions - division + 1;
}

export function seatPlaceWeight(placeInDivision: number): number {
  if (placeInDivision < 1 || placeInDivision > RANKING_DIVISION_SIZE) return 0;
  return RANKING_DIVISION_SIZE - placeInDivision + 1;
}

export function assignDivisions(players: FamePlayer[], kind: FameBoardKind): RankingSeat[] {
  const ranked = sortFameBoard(players, kind);
  return ranked.map((player, index) => ({
    player,
    globalRank: index + 1,
    division: Math.floor(index / RANKING_DIVISION_SIZE) + 1,
    placeInDivision: (index % RANKING_DIVISION_SIZE) + 1,
    prizeUsd: 0,
  }));
}

export function attachDivisionPrizes(seats: RankingSeat[], budgetUsd: number): RankingSeat[] {
  const list = Array.isArray(seats) ? seats : [];
  const budget = Number.isFinite(budgetUsd) && budgetUsd > 0 ? budgetUsd : 0;
  const totalDivisions = list.reduce((max, seat) => Math.max(max, seat.division), 0);
  if (!list.length || budget <= 0 || totalDivisions < 1) {
    return list.map((seat) => ({ ...seat, prizeUsd: 0 }));
  }

  let weightSum = 0;
  for (let division = 1; division <= totalDivisions; division += 1) {
    weightSum += divisionWeight(division, totalDivisions);
  }
  if (weightSum <= 0) return list.map((seat) => ({ ...seat, prizeUsd: 0 }));

  const byDivision = new Map<number, RankingSeat[]>();
  for (const seat of list) {
    const rows = byDivision.get(seat.division) || [];
    rows.push(seat);
    byDivision.set(seat.division, rows);
  }

  const prizeByKey = new Map<string, number>();
  for (const [division, rows] of byDivision) {
    const eligible = rows.filter((seat) => !seat.player.delinquent);
    let placeSum = 0;
    const weights = eligible.map((seat) => {
      const weight = seatPlaceWeight(seat.placeInDivision);
      placeSum += weight;
      return weight;
    });
    if (placeSum <= 0) continue;
    const divWeight = divisionWeight(division, totalDivisions);
    eligible.forEach((seat, index) => {
      prizeByKey.set(
        seat.player.address.toLowerCase(),
        (budget * divWeight * weights[index]) / (weightSum * placeSum)
      );
    });
  }

  return list.map((seat) => ({
    ...seat,
    prizeUsd: prizeByKey.get(seat.player.address.toLowerCase()) || 0,
  }));
}

export function seatsForDivision(seats: RankingSeat[], division: number): RankingSeat[] {
  return (Array.isArray(seats) ? seats : []).filter((seat) => seat.division === division);
}
