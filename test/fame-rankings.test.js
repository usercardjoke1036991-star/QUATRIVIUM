const { expect } = require('chai');
const fs = require('fs');
const path = require('path');

const DIVISION_SIZE = 100;
const PRIZE_BUDGET_BP = 150;
const PRIZE_FLOOR_BP = 2000;

function normalizeFameMetric(value, max) {
  if (!Number.isFinite(value) || value <= 0) return 0;
  if (!Number.isFinite(max) || max <= 0) return 0;
  return value / max;
}

function attachCombinedScores(players) {
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

function fameBoardMetric(player, kind) {
  if (kind === 'referrals') return Number(player.referrals) || 0;
  if (kind === 'fame') return Number(player.fame) || 0;
  if (kind === 'streak') return Number(player.streakDays) || 0;
  if (kind === 'level') return Number(player.level) || 0;
  if (kind === 'bonuses')
    return (Number(player.bonusUsd) || 0) * 1e6 + (Number(player.bonuses) || 0);
  if (kind === 'combined') return Number(player.combined) || 0;
  const paid = Number(player.loansPaid) || 0;
  const usd = Number(player.paidUsd) || 0;
  const requested = Number(player.loansRequested) || 0;
  return paid * 1e12 + usd * 1e6 + requested;
}

function sortFameBoard(players, kind) {
  return [...players].sort((left, right) => {
    const delta = fameBoardMetric(right, kind) - fameBoardMetric(left, kind);
    if (delta !== 0) return delta;
    const levelDelta = (right.level || 0) - (left.level || 0);
    if (levelDelta !== 0) return levelDelta;
    return (left.userNumber || 0) - (right.userNumber || 0);
  });
}

function fameListAfterPodium(rows) {
  return Array.isArray(rows) && rows.length > 3 ? rows.slice(3) : [];
}

function rankingVisible(level) {
  return Number.isFinite(level) && level >= 15;
}

function monthlyPrizeBudgetUsd(poolCashUsd, poolNavUsd) {
  const cash = Math.max(0, Number(poolCashUsd) || 0);
  const nav = Math.max(0, Number(poolNavUsd) || 0);
  const floor = (nav * PRIZE_FLOOR_BP) / 10000;
  const surplus = Math.max(0, cash - floor);
  if (surplus <= 0) return 0;
  return (surplus * PRIZE_BUDGET_BP) / 10000;
}

function assignDivisions(players, kind) {
  return sortFameBoard(players, kind).map((player, index) => ({
    player,
    globalRank: index + 1,
    division: Math.floor(index / DIVISION_SIZE) + 1,
    placeInDivision: (index % DIVISION_SIZE) + 1,
    prizeUsd: 0,
  }));
}

function attachDivisionPrizes(seats, budgetUsd) {
  const list = Array.isArray(seats) ? seats : [];
  const budget = Number.isFinite(budgetUsd) && budgetUsd > 0 ? budgetUsd : 0;
  const totalDivisions = list.reduce((max, seat) => Math.max(max, seat.division), 0);
  if (!list.length || budget <= 0 || totalDivisions < 1) {
    return list.map((seat) => ({ ...seat, prizeUsd: 0 }));
  }
  let weightSum = 0;
  for (let division = 1; division <= totalDivisions; division += 1) {
    weightSum += totalDivisions - division + 1;
  }
  const byDivision = new Map();
  for (const seat of list) {
    const rows = byDivision.get(seat.division) || [];
    rows.push(seat);
    byDivision.set(seat.division, rows);
  }
  const prizeByKey = new Map();
  for (const [division, rows] of byDivision) {
    const eligible = rows.filter((seat) => !seat.player.delinquent);
    let placeSum = 0;
    const weights = eligible.map((seat) => {
      const weight = DIVISION_SIZE - seat.placeInDivision + 1;
      placeSum += weight;
      return weight;
    });
    if (placeSum <= 0) continue;
    const divWeight = totalDivisions - division + 1;
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

function player(id, extra = {}) {
  return {
    address: `0x${id}`,
    userNumber: id,
    referrals: 0,
    loansRequested: 0,
    loansPaid: 0,
    paidUsd: 0,
    fame: 0,
    streakDays: 0,
    level: 1,
    bonuses: 0,
    bonusUsd: 0,
    delinquent: false,
    combined: 0,
    ...extra,
  };
}

describe('fame rankings', () => {
  const sample = attachCombinedScores([
    player(1, { referrals: 1, loansRequested: 1, loansPaid: 1, paidUsd: 1, fame: 10, level: 2 }),
    player(2, { referrals: 8, loansRequested: 2, loansPaid: 2, paidUsd: 20, fame: 40, level: 10 }),
    player(3, { referrals: 3, loansRequested: 9, loansPaid: 8, paidUsd: 80, fame: 5, level: 4 }),
    player(4),
  ]);

  it('moves places by activity on each board, including level and bonuses', () => {
    expect(sortFameBoard(sample, 'referrals')[0].address).to.equal('0x2');
    expect(sortFameBoard(sample, 'loans')[0].address).to.equal('0x3');
    expect(sortFameBoard(sample, 'fame')[0].address).to.equal('0x2');
    expect(sortFameBoard(sample, 'level')[0].address).to.equal('0x2');
    const withStreak = attachCombinedScores(
      sample.map((row) => (row.address === '0x1' ? { ...row, streakDays: 40 } : row))
    );
    expect(sortFameBoard(withStreak, 'streak')[0].address).to.equal('0x1');
    expect(sortFameBoard(sample, 'combined')[0].address).to.equal('0x2');
    const withBonus = attachCombinedScores(
      sample.map((row) => (row.address === '0x4' ? { ...row, bonuses: 3, bonusUsd: 40000 } : row))
    );
    expect(sortFameBoard(withBonus, 'bonuses')[0].address).to.equal('0x4');
    const climbed = attachCombinedScores(
      sample.map((row) =>
        row.address === '0x4' ? { ...row, referrals: 20, fame: 90, level: 40 } : row
      )
    );
    expect(sortFameBoard(climbed, 'combined')[0].address).to.equal('0x4');
  });

  it('keeps the long list under the podium', () => {
    const ranked = sortFameBoard(sample, 'referrals');
    expect(fameListAfterPodium(ranked).map((row) => row.address)).to.deep.equal(['0x4']);
  });

  it('unlocks ranking names at level 15 and keeps the room available', () => {
    expect(rankingVisible(14)).to.equal(false);
    expect(rankingVisible(15)).to.equal(true);
    expect(rankingVisible(1000)).to.equal(true);
    const home = fs.readFileSync(path.join(__dirname, '..', 'app', 'index.tsx'), 'utf8');
    expect(home).to.include('rankingVisible(');
    expect(home).to.include("id: 'fame'");
  });

  it('fills the highest division first and opens the next after 100', () => {
    const crowd = attachCombinedScores(
      Array.from({ length: 30 }, (_, index) => player(index + 1, { fame: 30 - index }))
    );
    const early = assignDivisions(crowd, 'fame');
    expect(early.every((seat) => seat.division === 1)).to.equal(true);
    expect(early).to.have.length(30);

    const filled = attachCombinedScores(
      Array.from({ length: 101 }, (_, index) => player(index + 1, { fame: 101 - index }))
    );
    const seats = assignDivisions(filled, 'fame');
    expect(seats.filter((seat) => seat.division === 1)).to.have.length(100);
    expect(seats.filter((seat) => seat.division === 2)).to.have.length(1);
    expect(seats[100].player.address).to.equal('0x101');
  });

  it('promotes a player into a higher division when their metrics pass the rest', () => {
    const filled = attachCombinedScores(
      Array.from({ length: 101 }, (_, index) => player(index + 1, { fame: 101 - index }))
    );
    expect(assignDivisions(filled, 'fame')[100].division).to.equal(2);
    const climbed = attachCombinedScores(
      filled.map((row) => (row.address === '0x101' ? { ...row, fame: 10_000 } : row))
    );
    const seats = assignDivisions(climbed, 'fame');
    expect(seats[0].player.address).to.equal('0x101');
    expect(seats[0].division).to.equal(1);
  });

  it('scales the monthly prize with the pool and pays only accounts not in arrears', () => {
    expect(monthlyPrizeBudgetUsd(400, 2000)).to.equal(0);
    const small = monthlyPrizeBudgetUsd(2000, 2000);
    const large = monthlyPrizeBudgetUsd(20000, 20000);
    expect(small).to.be.greaterThan(0);
    expect(large).to.be.greaterThan(small);

    const crowd = attachCombinedScores(
      Array.from({ length: 4 }, (_, index) =>
        player(index + 1, {
          fame: 4 - index,
          delinquent: index === 0,
        })
      )
    );
    const awarded = attachDivisionPrizes(assignDivisions(crowd, 'fame'), 100);
    expect(awarded[0].player.delinquent).to.equal(true);
    expect(awarded[0].prizeUsd).to.equal(0);
    const paid = awarded.filter((seat) => seat.prizeUsd > 0);
    expect(paid).to.have.length(3);
    expect(paid[0].prizeUsd).to.be.greaterThan(paid[2].prizeUsd);
    expect(paid.reduce((sum, seat) => sum + seat.prizeUsd, 0)).to.be.closeTo(100, 0.0001);
  });

  it('keeps ranking frames distinct from gem frames and referral history', () => {
    const podium = fs.readFileSync(
      path.join(__dirname, '..', 'components', 'PodiumFrame.tsx'),
      'utf8'
    );
    expect(podium).to.include('Medalla de ranking');
    expect(podium).to.not.include("from './RankFrame'");
    expect(podium).to.not.include("from './RankGem'");
    expect(podium).to.not.include('assets/logo.png');
    const board = fs.readFileSync(
      path.join(__dirname, '..', 'components', 'FameLeaderboard.tsx'),
      'utf8'
    );
    expect(board).to.include('firstSlot');
    expect(board).to.include('sideRow');
    expect(board).to.include('PodiumFrame');
    expect(board).to.include('ProfileAvatar');
    expect(board).to.include('publicView');
    expect(board).to.include('labelForProfile');
    expect(board).to.include('rankingIdentity');
    expect(board).to.include("kind === 'level'");
    expect(board).to.include("kind === 'bonuses'");
    expect(board).to.include('fameBoardLocked');
    expect(board).to.include('RANKING_DIVISION_SIZE');
    expect(board).to.not.include('ReferralHistory');
    const home = fs.readFileSync(path.join(__dirname, '..', 'app', 'index.tsx'), 'utf8');
    expect(home).to.include('FameLeaderboard');
    expect(home).to.include('ReferralHistory');
    const utils = fs.readFileSync(path.join(__dirname, '..', 'utils', 'fameRankings.ts'), 'utf8');
    expect(utils).to.include("'bonuses'");
    expect(utils).to.include('normalizeFameMetric(row.bonusUsd');
    const divisions = fs.readFileSync(
      path.join(__dirname, '..', 'utils', 'rankingDivisions.ts'),
      'utf8'
    );
    expect(divisions).to.include('RANKING_DIVISION_SIZE = 100');
    expect(divisions).to.include('RANKING_PRIZE_BUDGET_BP = 150');
    expect(divisions).to.include('(budget * divWeight * weights[index]) / (weightSum * placeSum)');
    const leveling = fs.readFileSync(
      path.join(__dirname, '..', 'contracts', 'QuatriviumLeveling.sol'),
      'utf8'
    );
    expect(leveling).to.include('(budget * wDiv * wSeat) / (sumDiv * sumaPesosElegibles)');
    const profiles = fs.readFileSync(
      path.join(__dirname, '..', 'profile', 'ProfileContext.tsx'),
      'utf8'
    );
    expect(profiles).to.include('walletAddress.toLowerCase()');
  });

  it('keeps the viewing wallet on the board when the roster is truncated', () => {
    function takeRoster(order, viewer) {
      const truncated = order.length > 400;
      let roster = order.slice(0, 400);
      if (!viewer) return { roster, truncated };
      const viewerKey = viewer.toLowerCase();
      if (roster.some((address) => address.toLowerCase() === viewerKey)) {
        return { roster, truncated };
      }
      roster = roster.length < 400 ? [...roster, viewer] : [...roster.slice(0, 399), viewer];
      return { roster, truncated };
    }
    const crowd = Array.from(
      { length: 401 },
      (_, index) => `0x${String(index + 1).padStart(40, '0')}`
    );
    const viewer = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
    const result = takeRoster(crowd, viewer);
    expect(result.truncated).to.equal(true);
    expect(result.roster).to.have.length(400);
    expect(result.roster[399].toLowerCase()).to.equal(viewer);
  });

  it('loads ranking names and photos locally without notify worker', () => {
    const profiles = fs.readFileSync(
      path.join(__dirname, '..', 'services', 'userProfile.ts'),
      'utf8'
    );
    expect(profiles).to.not.include('notifyJsonFetch');
    const board = fs.readFileSync(
      path.join(__dirname, '..', 'services', 'fameLeaderboard.ts'),
      'utf8'
    );
    expect(board).to.include('KNOWN_SCAN_SPAN');
    expect(board).to.include('loadFameLeaderboard(viewerAddress');
    expect(board).to.include('takeRoster');
    expect(board).to.include('rosterTruncated');
    const hook = fs.readFileSync(
      path.join(__dirname, '..', 'hooks', 'useFameLeaderboard.ts'),
      'utf8'
    );
    expect(hook).to.include('viewerAddress');
    const ui = fs.readFileSync(
      path.join(__dirname, '..', 'components', 'FameLeaderboard.tsx'),
      'utf8'
    );
    expect(ui.replace(/\s+/g, ' ')).to.include(
      'useFameLeaderboard( enabled && unlocked, walletAddress )'
    );
    const loans = fs.readFileSync(
      path.join(__dirname, '..', 'components', 'LoanTierCard.tsx'),
      'utf8'
    );
    expect(loans).to.include('payOnTimeToLevel');
    expect(loans).to.include('maxLevelNote');
    expect(loans).to.include('referralEarnBand');
    expect(loans).to.include('commissionRowsForLoan');
    expect(loans).to.include('commsOpen');
    expect(loans).to.not.include('commissionBandsForLoan');
    expect(loans).to.include('MAX_LEVEL_BONUS_EVERY');
    expect(loans).to.match(/isMaxLevel \? \(/);
    const hub = fs.readFileSync(path.join(__dirname, '..', 'app/index.tsx'), 'utf8');
    expect(hub).to.include("id: 'racha'");
    expect(hub.indexOf("id: 'racha'")).to.be.greaterThan(hub.indexOf("id: 'reserva'"));
    const rachaUi = fs.readFileSync(
      path.join(__dirname, '..', 'components/RachaSection.tsx'),
      'utf8'
    );
    expect(rachaUi).to.include('RACHA_HITOS');
    expect(rachaUi).to.include('FAMA_POR_DIA_RACHA');
  });
});
