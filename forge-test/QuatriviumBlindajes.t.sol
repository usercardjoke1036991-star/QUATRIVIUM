// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {QuatriviumCreditHarness} from "../contracts/test/QuatriviumCreditHarness.sol";
import {QuatriviumFamaCaja} from "../contracts/QuatriviumFamaCaja.sol";
import {QuatriviumReserva} from "../contracts/QuatriviumReserva.sol";
import {QuatriviumAlta} from "../contracts/QuatriviumAlta.sol";
import {ERC20Mock} from "../contracts/mocks/ERC20Mock.sol";
import {MockV3Aggregator} from "../contracts/mocks/MockV3Aggregator.sol";

/// @notice Tres casos que el Handler grande no cubre: padrino sin Alta, cuotas y sello vs grande.
contract QuatriviumBlindajesTest is Test {
    QuatriviumCreditHarness internal credit;
    QuatriviumFamaCaja internal fama;
    QuatriviumReserva internal reserva;
    QuatriviumAlta internal alta;
    ERC20Mock internal token;
    address internal owner;
    uint256 internal ownerPk;
    address internal padre;
    address internal hijo;
    address internal ballena;

    function setUp() public {
        vm.warp(1_704_000_000);
        ownerPk = 0xA11CE;
        owner = vm.addr(ownerPk);
        padre = makeAddr("padre");
        hijo = makeAddr("hijo");
        ballena = makeAddr("ballena");
        token = new ERC20Mock();
        MockV3Aggregator feed = new MockV3Aggregator(8, 100000000);
        address[] memory admins = new address[](3);
        admins[0] = owner;
        admins[1] = makeAddr("admin-b");
        admins[2] = makeAddr("admin-c");
        uint64 nonce = vm.getNonce(owner);
        address predictedCredit = vm.computeCreateAddress(owner, nonce + 1);
        address predictedReserva = vm.computeCreateAddress(owner, nonce + 2);
        address predictedAlta = vm.computeCreateAddress(owner, nonce + 3);
        vm.startPrank(owner, owner);
        fama = new QuatriviumFamaCaja(address(token), predictedCredit, predictedAlta, predictedReserva);
        credit = new QuatriviumCreditHarness(
            address(token),
            payable(owner),
            500,
            admins,
            1,
            address(fama)
        );
        reserva = new QuatriviumReserva(address(token), owner, address(credit), address(fama), predictedAlta);
        alta = new QuatriviumAlta(address(token), address(credit), address(reserva));
        token.mint(owner, 50_000 ether);
        token.approve(address(credit), type(uint256).max);
        credit.depositarLiquidez(address(token), 20_000 ether);
        vm.stopPrank();
    }

    function test_con_alta_el_sello_no_entra_por_verificar() public {
        _onboard(hijo, address(0));
        vm.prank(hijo, hijo);
        vm.expectRevert();
        credit.pagarVerificacion(address(token), 1 ether);
    }

    function test_sin_registro_el_prestamo_revierte() public {
        _onboard(padre, address(0));
        _onboard(hijo, padre);
        vm.prank(hijo, hijo);
        vm.expectRevert();
        credit.solicitarPrestamo(address(token), 1);
    }

    function test_cuotas_mantienen_nav() public {
        _onboard(hijo, address(0));
        credit.forceNivel(hijo, 15);
        _pagarAlta(hijo);
        vm.prank(hijo, hijo);
        credit.solicitarPrestamo(address(token), 15);
        (uint256 principal, uint256 interes, uint256 total,) = credit.obtenerDeuda(hijo);
        assertGt(total, principal);
        (, , uint8 totales,,) = credit.planPago(hijo);
        uint256 primera = totales > 1 ? total / uint256(totales) : total;
        vm.prank(hijo, hijo);
        credit.pagarPrestamo(address(token), primera);
        _assertNav();
        vm.prank(hijo, hijo);
        credit.pagarPrestamo(address(token), primera);
        _assertNav();
        (,, uint256 resto,) = credit.obtenerDeuda(hijo);
        if (resto > 0) {
            vm.prank(hijo, hijo);
            credit.pagarPrestamo(address(token), resto);
        }
        _assertNav();
        assertGt(interes, 0);
    }

    function test_sello_y_grande_no_pasan_el_80() public {
        _onboard(hijo, address(0));
        _onboard(ballena, address(0));
        credit.forceNivel(ballena, 10);
        vm.prank(hijo, hijo);
        token.approve(address(alta), type(uint256).max);
        vm.prank(hijo, hijo);
        alta.pagarRegistro();
        _pagarAlta(ballena);
        vm.prank(ballena, ballena);
        credit.solicitarPrestamo(address(token), 10);
        vm.prank(hijo, hijo);
        credit.solicitarPrestamo(address(token), 1);
        uint256 liq = credit.totalLiquidity(address(token));
        uint256 out = credit.outstandingLoans(address(token));
        assertLe(out * 10000, liq * 8000, "uso > 80%");
        _assertNav();
    }

    function _pagarAlta(address who) internal {
        vm.prank(who, who);
        token.approve(address(alta), type(uint256).max);
        vm.prank(who, who);
        alta.pagarRegistro();
    }

    function _onboard(address who, address padreRef) internal {
        vm.prank(who, who);
        credit.registrarHumanoConPadre(padreRef);
        token.mint(who, 5_000 ether);
        vm.prank(who);
        token.approve(address(credit), type(uint256).max);
    }

    function _assertNav() internal view {
        assertEq(
            token.balanceOf(address(credit)) + credit.outstandingLoans(address(token)),
            credit.totalLiquidity(address(token)) + credit.collectedFees(address(token)),
            "NAV"
        );
    }
}
