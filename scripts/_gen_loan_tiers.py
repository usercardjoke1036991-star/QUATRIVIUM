"""Generate 100 loan tiers: amount up, rate down, interest $ up."""

from __future__ import annotations


def nice_amount(x: float) -> int:
    if x < 20:
        return max(1, int(round(x)))
    if x < 100:
        return int(round(x / 5.0) * 5)
    if x < 500:
        return int(round(x / 10.0) * 10)
    if x < 2000:
        return int(round(x / 25.0) * 25)
    if x < 5000:
        return int(round(x / 50.0) * 50)
    return int(round(x / 100.0) * 100)


def installments(amount: int) -> int:
    if amount >= 60:
        return 3
    if amount >= 50:
        return 2
    return 1


def build() -> list[dict]:
    amounts = [1, 2, 5, 10, 20, 35, 50, 60, 80, 100]
    for n in range(11, 101):
        t = (n - 11) / 89
        raw = 120 * ((10000 / 120) ** t)
        amounts.append(nice_amount(raw))

    for i in range(1, 100):
        step = 1 if amounts[i - 1] < 50 else 5 if amounts[i - 1] < 200 else 10 if amounts[i - 1] < 1000 else 25
        if amounts[i] <= amounts[i - 1]:
            amounts[i] = amounts[i - 1] + step
    amounts[-1] = 10000
    if amounts[-1] <= amounts[-2]:
        amounts[-2] = 9975

    rates: list[int] = [0] * 100
    rates[0] = 10000
    prev_interest = amounts[0] * rates[0] / 10000

    for i in range(1, 100):
        max_rate = rates[i - 1] - 1
        min_rate = int(prev_interest * 10000 / amounts[i]) + 1
        while min_rate > max_rate:
            amounts[i] += 5 if amounts[i] < 200 else 10 if amounts[i] < 1000 else 25
            min_rate = int(prev_interest * 10000 / amounts[i]) + 1
        early = (9500, 8000, 7000, 5000, 4800, 4000, 3800, 3600, 3400)
        if i <= 9:
            target = early[i - 1]
        else:
            t = (i - 9) / 90
            target = int(round(3400 * (1 - t) + 800 * t))
        rate = min(max_rate, max(min_rate, target))
        rates[i] = rate
        prev_interest = amounts[i] * rate / 10000

    if amounts[-1] != 10000:
        amounts[-1] = 10000
        min_rate = int((amounts[-2] * rates[-2] / 10000) * 10000 / 10000) + 1
        rates[-1] = min(rates[-2] - 1, max(min_rate, 800))
        if amounts[-1] * rates[-1] / 10000 <= amounts[-2] * rates[-2] / 10000:
            rates[-1] = min_rate
            if rates[-1] >= rates[-2]:
                rates[-1] = rates[-2] - 1

    tiers = []
    for i in range(100):
        n = i + 1
        interest = amounts[i] * rates[i] / 10000
        early_days = (7, 10, 15, 20, 25, 30, 35, 40, 45, 50)
        if i < 10:
            days = early_days[i]
        else:
            days = int(round(50 + ((i - 9) / 90) * 40))
        tiers.append(
            {
                "id": n,
                "usdAmount": amounts[i],
                "interestBps": rates[i],
                "interestUsd": round(interest, 4),
                "totalUsd": round(amounts[i] + interest, 4),
                "days": days,
                "installments": installments(amounts[i]),
                "requiredCount": 3 if n == 1 else 0 if n == 100 else 5,
            }
        )
    return tiers


def assert_order(tiers: list[dict]) -> None:
    for i in range(1, len(tiers)):
        a, b = tiers[i - 1], tiers[i]
        assert b["usdAmount"] > a["usdAmount"], (a, b)
        assert b["interestBps"] < a["interestBps"], (a, b)
        assert b["interestUsd"] > a["interestUsd"], (a, b)
        assert b["totalUsd"] > a["totalUsd"], (a, b)
    assert tiers[0]["usdAmount"] == 1
    assert tiers[-1]["usdAmount"] == 10000
    print("OK", len(tiers), "first", tiers[0], "mid", tiers[49], "last", tiers[-1])
    print("rate breaks old vs new L5-L8:")
    for t in tiers[4:8]:
        print(t)


def write_ts(tiers: list[dict], path: str) -> None:
    rows = []
    for t in tiers:
        rows.append(
            "  { "
            f"id: {t['id']}, "
            f"usdAmount: {t['usdAmount']}, "
            f"termDays: {t['days']}, "
            f"requiredCount: {t['requiredCount']}, "
            f"interestBps: {t['interestBps']}, "
            f"installments: {t['installments']} "
            "},"
        )
    body = "\n".join(rows)
    text = f"""export const MAX_LOAN_LEVEL = 100;
export const MAX_LOAN_USD = 10000;
export const USD100_LEVEL = 10;
export const MAX_LEVEL_BONUS_USD = 2000;

export function requiredCountForLevel(id: number): number {{
  if (id < 1 || id >= MAX_LOAN_LEVEL) return 0;
  if (id <= 1) return 3;
  return 5;
}}

export interface LoanTier {{
  id: number;
  name: string;
  usdAmount: number;
  term: string;
  termDays: number;
  requiredCount: number;
  interestBps: number;
  installments: number;
}}

/** 100 niveles: monto e interés $ suben; la tasa del anterior siempre es más cara que la del siguiente. */
export const LOAN_TIER_ROWS: ReadonlyArray<Omit<LoanTier, 'name' | 'term'>> = [
{body}
];

export const LOAN_TIERS: LoanTier[] = LOAN_TIER_ROWS.map((row) => ({{
  ...row,
  requiredCount: requiredCountForLevel(row.id),
  name: `Nivel ${{row.id}}`,
  term: `${{row.termDays}} días`,
}}));

export function installmentsForPrincipalWei(monto: bigint): number {{
  if (monto >= 60n * 10n ** 18n) return 3;
  if (monto >= 50n * 10n ** 18n) return 2;
  return 1;
}}

export function overlayOnChainTier(
  base: LoanTier,
  monto: bigint,
  plazo: bigint,
  tasaBps: bigint
): LoanTier {{
  if (monto === 0n) return base;
  const usdAmount = Number(monto) / 1e18;
  const days = Math.max(1, Math.round(Number(plazo) / 86400));
  return {{
    ...base,
    usdAmount,
    interestBps: Number(tasaBps),
    termDays: days,
    term: `${{days}} días`,
    installments: installmentsForPrincipalWei(monto),
  }};
}}
"""
    with open(path, "w", encoding="utf-8", newline="\n") as fh:
        fh.write(text)


def write_sol_seed(tiers: list[dict], path: str) -> None:
    usd = ", ".join(str(t["usdAmount"]) for t in tiers)
    bps = ", ".join(str(t["interestBps"]) for t in tiers)
    days = ", ".join(str(t["days"]) for t in tiers)
    text = f"""// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @dev Semilla de 100 niveles. Fuente: constants/loanTiers.ts
library LoanTierSeed {{
    uint256 internal constant MAX_NIVEL = 100;
    uint256 internal constant MAX_MONTO = 10000 * 1e18;

    function applyTo(mapping(uint256 => uint256) storage monto, mapping(uint256 => uint256) storage plazo, mapping(uint256 => uint256) storage tasa) internal {{
        uint16[100] memory usd = [{usd}];
        uint16[100] memory bps = [{bps}];
        uint8[100] memory dias = [{days}];
        for (uint256 i = 0; i < 100; i++) {{
            monto[i + 1] = uint256(usd[i]) * 1e18;
            plazo[i + 1] = uint256(dias[i]) * 1 days;
            tasa[i + 1] = uint256(bps[i]);
        }}
    }}
}}
"""
    # The mapping approach doesn't match Level struct. Write a helper that returns values instead.
    text = f"""// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @dev Tablas de 100 niveles. Fuente: constants/loanTiers.ts
library LoanTierSeed {{
    uint256 internal constant MAX_NIVEL = 100;
    uint256 internal constant MAX_MONTO = 10000 * 1e18;

    function tables()
        internal
        pure
        returns (uint16[100] memory usd, uint16[100] memory bps, uint8[100] memory dias)
    {{
        usd = [{usd}];
        bps = [{bps}];
        dias = [{days}];
    }}
}}
"""
    with open(path, "w", encoding="utf-8", newline="\n") as fh:
        fh.write(text)


if __name__ == "__main__":
    tiers = build()
    assert_order(tiers)
    write_ts(tiers, "constants/loanTiers.ts")
    write_sol_seed(tiers, "contracts/libraries/LoanTierSeed.sol")
    print("wrote constants/loanTiers.ts and contracts/libraries/LoanTierSeed.sol")
    print("L1-10 days", [t["days"] for t in tiers[:10]])
    print("L1-10 bps", [t["interestBps"] for t in tiers[:10]])
    print("L1-10 usd", [t["usdAmount"] for t in tiers[:10]])
    print("L100", tiers[-1])
