// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title LoanLadder
/// @notice Hermano del núcleo: niveles 101–1000, cuotas altas y requiredCount.
///         Vive en su propio bytecode para no romper EIP-170.
contract LoanLadder {
    uint256 public constant MAX_NIVEL = 1000;
    uint256 public constant CORE_NIVEL = 100;
    uint256 public constant MAX_MONTO = 1_000_000 * 1e18;
    uint256 public constant CORE_USD = 10_000;
    uint256 public constant STEP_USD = 1_100;
    uint256 public constant CORE_BPS = 800;
    uint256 public constant RATE_DROPS = 394;

    function requiredCount(uint256 id) external pure returns (uint256) {
        if (id < 1 || id > MAX_NIVEL) return 0;
        if (id <= 1) return 3;
        if (id < 10) return 5;
        unchecked {
            return 5 * (id - 9);
        }
    }

    function params(uint256 id) external pure returns (uint256 monto, uint256 plazo, uint256 tasa) {
        require(id > CORE_NIVEL && id <= MAX_NIVEL);
        uint256 t = id - CORE_NIVEL;
        uint256 usd = CORE_USD + STEP_USD * t;
        uint256 dropped = t > RATE_DROPS ? RATE_DROPS : t;
        tasa = CORE_BPS - dropped;
        monto = usd * 1e18;
        plazo = (90 + t / 10) * 1 days;
    }

    function cuotas(uint256 monto) external pure returns (uint8) {
        if (monto >= 100000e18) return 12;
        if (monto >= 25000e18) return 6;
        if (monto >= 60e18) return 3;
        if (monto >= 50e18) return 2;
        return 1;
    }
}
