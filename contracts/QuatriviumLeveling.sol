// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title QuatriviumLeveling
 * @notice Misma curva de solicitudes que el núcleo + bonos de hito cada 100 niveles.
 *         L1 → 3; L2–9 → 5; desde $100 (L10) → 5, 10, 15…; L1000 no sube.
 *         En L1000 las solicitudes se acumulan; cada 100 pagos a tiempo se puede volver a cobrar el hito 1000.
 *         Bono proporcional: 400 / 4k / 7k / 8.5k / 9k / 11.5k / 13.5k / 16k / 18k / 20k.
 */
contract QuatriviumLeveling {
    uint256 public constant HITO_PASO = 100;
    uint256 public constant BONO_NIVEL_MAXIMO = 20000e18;
    uint256 public constant BONO_HITOS_TOTAL = 108400e18;
    uint256 public constant MAX_NIVEL = 1000;
    uint256 public constant DIVISION_SIZE = 100;
    uint256 public constant L1000_BONO_CADA = 100;
    uint256 public constant RANKING_PREMIO_BP = 150;
    uint256 internal constant PISO_CAJA_BP = 2000;

    function requiredCount(uint256 nivel) public pure returns (uint256) {
        if (nivel < 1 || nivel > MAX_NIVEL) return 0;
        if (nivel <= 1) return 3;
        if (nivel < 10) return 5;
        unchecked {
            return 5 * (nivel - 9);
        }
    }

    function hitoAlcanzado(uint256 nivel) public pure returns (uint256) {
        if (nivel < HITO_PASO) return 0;
        uint256 h = nivel - (nivel % HITO_PASO);
        return h > MAX_NIVEL ? MAX_NIVEL : h;
    }

    function siguienteHito(uint256 cobrado, uint256 nivel) public pure returns (uint256) {
        uint256 next = cobrado + HITO_PASO;
        uint256 reached = hitoAlcanzado(nivel);
        if (next < HITO_PASO || next > MAX_NIVEL || next > reached) return 0;
        return next;
    }

    function bonoDeHito(uint256 hito) public pure returns (uint256) {
        if (hito < HITO_PASO || hito > MAX_NIVEL || hito % HITO_PASO != 0) return 0;
        if (hito == 100) return 400e18;
        if (hito == 200) return 4000e18;
        if (hito == 300) return 7000e18;
        if (hito == 400) return 8500e18;
        if (hito == 500) return 9000e18;
        if (hito == 600) return 11500e18;
        if (hito == 700) return 13500e18;
        if (hito == 800) return 16000e18;
        if (hito == 900) return 18000e18;
        return 20000e18;
    }

    function canPayHito(uint256 cajaLibre, uint256 liquidezTotal, uint256 hito) public pure returns (bool) {
        uint256 bono = bonoDeHito(hito);
        if (bono == 0) return false;
        uint256 piso = (liquidezTotal * PISO_CAJA_BP) / 10000;
        return cajaLibre > piso && cajaLibre - piso >= bono;
    }

    function canPayMaxBonus(uint256 cajaLibre, uint256 liquidezTotal) public pure returns (bool) {
        return canPayHito(cajaLibre, liquidezTotal, MAX_NIVEL);
    }

    function presupuestoPremioMensual(uint256 cajaLibre, uint256 liquidezTotal) public pure returns (uint256) {
        uint256 piso = (liquidezTotal * PISO_CAJA_BP) / 10000;
        if (cajaLibre <= piso) return 0;
        unchecked {
            return ((cajaLibre - piso) * RANKING_PREMIO_BP) / 10000;
        }
    }

    function pesoDivision(uint256 division, uint256 totalDivisiones) public pure returns (uint256) {
        if (division < 1 || division > totalDivisiones) return 0;
        return totalDivisiones - division + 1;
    }

    function premioAsiento(
        uint256 cajaLibre,
        uint256 liquidezTotal,
        uint256 division,
        uint256 totalDivisiones,
        uint256 puestoEnDivision,
        uint256 sumaPesosElegibles
    ) public pure returns (uint256) {
        if (
            puestoEnDivision < 1
            || puestoEnDivision > DIVISION_SIZE
            || sumaPesosElegibles == 0
            || totalDivisiones == 0
        ) return 0;
        uint256 budget = presupuestoPremioMensual(cajaLibre, liquidezTotal);
        uint256 wDiv = pesoDivision(division, totalDivisiones);
        // n(n+1) siempre es par: el /2 es exacto y sumDiv va en el denominador, no multiplica el bote.
        // slither-disable-next-line divide-before-multiply
        uint256 sumDiv = (totalDivisiones * (totalDivisiones + 1)) / 2;
        if (budget == 0 || wDiv == 0 || sumDiv == 0) return 0;
        uint256 wSeat = DIVISION_SIZE - puestoEnDivision + 1;
        // Un solo floor: no dividir el bote antes de aplicar el peso del asiento.
        return (budget * wDiv * wSeat) / (sumDiv * sumaPesosElegibles);
    }
}
