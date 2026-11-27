// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
import {Tanda1Base} from "./QuatriviumTanda1.t.sol";
/// QA-T2-01: si queda polvo (1 wei), el principal pendiente redondea a 0. Sin nada que absorber
/// no hay castigo, y `liquidate` no se puede repetir sobre el mismo préstamo.
contract QuatriviumPolvoTest is Tanda1Base {
    address internal liq = address(0xBEEF);
    function setUp() public {
        _deploy(false);
        _seed(10_000 ether);
    }
    function _liquida(address deudor) internal returns (bool ok) {
        vm.prank(liq, liq);
        (ok,) = address(credit).call(abi.encodeWithSignature("liquidate(address,address)", deudor, tok));
    }
    function test_polvo_no_permite_castigos_repetidos() public {
        address a = _user("polvo", address(0));
        credit.forceNivel(a, 10);
        _borrow(a, 0);
        (,, uint256 total,) = credit.obtenerDeuda(a);
        token.mint(a, total);
        vm.prank(a, a);
        credit.pagarPrestamo(tok, total - 1);
        (,, uint256 venc,,,) = credit.usuarios(a);
        vm.warp(venc + 48 hours + 1);
        uint256 out0 = credit.outstandingLoans(tok);
        uint256 pen0 = credit.penalizacionesAcumuladas(a);
        uint256 n;
        for (uint256 i; i < 5; i++) {
            if (_liquida(a)) n++;
        }
        assertEq(n, 0, "castigos sobre polvo");
        assertEq(credit.penalizacionesAcumuladas(a), pen0, "penalizaciones sin cambio");
        assertEq(credit.castigado(a), 0, "castigado");
        assertEq(credit.outstandingLoans(tok), out0, "sin efecto contable");
        vm.prank(a, a);
        credit.pagarPrestamo(tok, 1);
        (, uint256 activo,,,,) = credit.usuarios(a);
        assertEq(activo, 0, "el ultimo wei cierra el prestamo");
        _assertNav();
    }
}
