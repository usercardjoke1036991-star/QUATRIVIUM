// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {QuatriviumFamaLib} from "../libraries/QuatriviumFamaLib.sol";

/// @notice El aviso no vive como función externa de la librería de producción.
contract QuatriviumAvisoHarness {
    function aviso(
        address reserva,
        address beneficiario,
        uint256 monto,
        address deudor,
        uint8 generacion,
        uint256 remaining
    ) external {
        QuatriviumFamaLib._avisarReserva(reserva, beneficiario, monto, deudor, generacion, remaining);
    }
}
