// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {QuatriviumCredit} from "../QuatriviumCredit.sol";
import {QuatriviumFamaLib} from "../libraries/QuatriviumFamaLib.sol";

/// @dev Solo tests: fuerza el nivel de progreso para probar bonos de hito.
contract QuatriviumCreditHarness is QuatriviumCredit {
    constructor(
        address usdt,
        address feed,
        address payable feeCollector_,
        uint256 feeBp,
        address[] memory admins_,
        uint256 confirms,
        address famaHermano_
    ) QuatriviumCredit(usdt, feed, feeCollector_, feeBp, admins_, confirms, famaHermano_) {}

    function forceNivel(address usuario, uint256 nivel) external {
        progresoUsuarios[usuario].nivelActual = nivel;
    }

    function forceHito(address usuario, uint256 hito) external {
        hitoCobrado[usuario] = hito;
    }

    function forceSolicitudes(address usuario, uint256 n) external {
        progresoUsuarios[usuario].solicitudesCompletadas = n;
    }

    function forceLoanClock(address usuario, uint256 monto, uint256 vencimiento) external {
        usuarios[usuario].montoActivo = monto;
        usuarios[usuario].vencimiento = vencimiento;
    }

    function forcePagoATiempo(address deudor) external {
        _subirNivelSiATiempo(deudor, true);
    }

    function forceTickRacha(address deudor) external {
        QuatriviumFamaLib.onCierre(famaHermano, deudor, redGenealogica[deudor].padre);
    }
}
