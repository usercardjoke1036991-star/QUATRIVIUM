// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {QuatriviumFamaLib} from "../contracts/libraries/QuatriviumFamaLib.sol";

contract QuatriviumAvisoTest is Test {
    uint256 constant AVISO_MINIMO = (uint256(180000) * 64) / 63 + 1 + 7000;

    function test_aviso_revierte_si_el_gas_no_alcanza_el_63_64() public {
        vm.expectRevert();
        this.avisoJusto{gas: AVISO_MINIMO}();
    }

    function test_aviso_sigue_si_hay_gas_para_el_call() public {
        this.avisoJusto{gas: AVISO_MINIMO + 40_000}();
    }

    function avisoJusto() external {
        QuatriviumFamaLib.probarAvisoReserva(address(1), address(2), 1, address(3), 1, 1);
    }
}
