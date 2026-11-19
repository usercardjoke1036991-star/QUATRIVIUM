// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Tanda1Base} from "./QuatriviumTanda1.t.sol";

/// Tanda 2: el impago no se borra. La deuda queda hasta que el deudor la paga (cuando sea,
/// en cuotas o completa); las 48 h cuentan desde el pago que cierra; a los 30 días del
/// vencimiento sus beneficios se congelan; `liquidate` solo castiga en la contabilidad.
contract QuatriviumTanda2Test is Tanda1Base {
    address internal complice = address(0xC0FFEE);

    function setUp() public {
        _deploy(false);
        _seed(10_000 ether);
    }

    function _pide(address who, uint256 nivel) internal returns (bool ok) {
        vm.prank(who, who);
        (ok,) = address(credit).call(abi.encodeWithSignature("solicitarPrestamo(address,uint256)", tok, nivel));
    }

    function _liquida(address quien, address deudor) internal returns (bool ok) {
        vm.prank(quien, quien);
        (ok,) = address(credit).call(abi.encodeWithSignature("liquidate(address,address)", deudor, tok));
    }

    function _vencerMas(address who, uint256 extra) internal {
        (,, uint256 venc,,,) = credit.usuarios(who);
        vm.warp(venc + extra);
    }

    function _pool() internal view returns (uint256) {
        return credit.totalLiquidity(tok) + credit.fondoSeguro(tok);
    }

    /// QA-C-01: el PoC de 3 impagos en nivel 10 (+300 LUSD al deudor, -315 al pool) ya no rinde.
    function test_impago_no_se_borra_con_liquidate() public {
        address ana = _user("ana", address(0));
        credit.forceNivel(ana, 10);
        uint256 poolAntes = _pool();
        uint256 anaAntes = token.balanceOf(ana);
        _borrow(ana, 0);
        (,, uint256 total,) = credit.obtenerDeuda(ana);
        assertEq(total, 134 ether);
        _vencerMas(ana, 48 hours + 1);
        uint256 c0 = token.balanceOf(complice);
        assertTrue(_liquida(complice, ana), "castigo a las 48 h");
        (,, uint256 sigue,) = credit.obtenerDeuda(ana);
        assertEq(sigue, total, "la deuda sigue tras liquidate");
        assertEq(token.balanceOf(complice) - c0, 0, "sin premio para el liquidador");
        assertTrue(credit.esMoroso(ana), "sigue moroso");
        vm.warp(vm.getBlockTimestamp() + 48 hours);
        assertFalse(_pide(ana, 0), "segundo prestamo bloqueado");
        assertFalse(_liquida(complice, ana), "un solo castigo por prestamo");

        token.mint(ana, total);
        vm.prank(ana, ana);
        credit.pagarPrestamo(tok, total);
        assertFalse(credit.esMoroso(ana), "pagado deja de ser moroso");
        assertEq(int256(token.balanceOf(ana)) - int256(anaAntes) - int256(total), -34 ether, "ana no gana: pierde el interes");
        assertGe(_pool(), poolAntes, "el pool recupera el principal");
        _assertNav();
        assertFalse(_pide(ana, 0), "48 h desde el pago");
        vm.warp(vm.getBlockTimestamp() + 48 hours);
        assertTrue(_pide(ana, 0), "pasadas 48 h vuelve a pedir");
        (uint256 nivel,,) = credit.obtenerProgresoUsuario(ana);
        assertEq(nivel, 10, "conserva el nivel");
    }

    /// La auto-liquidación desde otra billetera ya no cobra nada.
    function test_autoliquidacion_sin_ganancia() public {
        address ana = _user("ana", address(0));
        address otra = makeAddr("ana-2");
        credit.forceNivel(ana, 10);
        _borrow(ana, 0);
        _vencerMas(ana, 48 hours + 1);
        uint256 antes = token.balanceOf(otra);
        assertTrue(_liquida(otra, ana));
        assertEq(token.balanceOf(otra) - antes, 0, "premio de la segunda billetera");
    }

    /// Las 48 h cuentan desde el pago que cierra, no desde el pedido.
    function test_cooldown_desde_el_pago() public {
        address bea = _user("bea", address(0));
        _borrow(bea, 1);
        _vencerMas(bea, 0);
        _payAll(bea);
        assertFalse(_pide(bea, 1), "recien pagado no pide");
        vm.warp(vm.getBlockTimestamp() + 48 hours - 1);
        assertFalse(_pide(bea, 1), "a 48 h menos 1 s no pide");
        vm.warp(vm.getBlockTimestamp() + 1);
        assertTrue(_pide(bea, 1), "a las 48 h pide");
    }

    /// A los 30 días del vencimiento los beneficios se congelan, aunque nadie lo marque.
    function test_congelado_a_30_dias_sin_marcar() public {
        address padre = _user("padre", address(0));
        _borrow(padre, 1);
        _vencerMas(padre, 30 days);
        assertFalse(credit.dispersionCongelada(padre), "dentro del mes de gracia");
        vm.warp(vm.getBlockTimestamp() + 1);
        assertTrue(credit.dispersionCongelada(padre), "congelado a los 30 dias del vencimiento");
        _payAll(padre);
        assertFalse(credit.dispersionCongelada(padre), "pagado se descongela");
    }

    /// Un moroso ya marcado también pierde la reputación al castigarlo.
    function test_castigo_de_moroso_marcado_descuenta_reputacion() public {
        address eva = _user("eva", address(0));
        _borrow(eva, 1);
        _vencerMas(eva, 1);
        credit.marcarMorosoSiVencido(eva);
        uint256 rep = credit.reputacion(eva);
        assertEq(rep, 100);
        _vencerMas(eva, 48 hours + 1);
        assertTrue(_liquida(complice, eva));
        assertEq(credit.reputacion(eva), 0, "reputacion tras el castigo");
        assertEq(credit.prestamosMorosos(eva), 1, "un impago contado una vez");
    }

    /// El castigado sigue moroso: no entra en la Reserva.
    function test_castigado_no_entra_en_reserva() public {
        address ana = _user("ana", address(0));
        credit.forceNivel(ana, 10);
        _borrow(ana, 0);
        _vencerMas(ana, 48 hours + 1);
        assertTrue(_liquida(complice, ana));
        token.mint(ana, 10 ether);
        vm.prank(ana, ana);
        (bool ok,) = address(reserva).call(abi.encodeWithSignature("bloquear(uint256)", 10 ether));
        assertFalse(ok, "moroso castigado no bloquea en Reserva");
    }

    /// Castigo tras un pago parcial y recuperación en dos pagos: outstanding y NAV exactos.
    function test_castigo_tras_parcial_y_recuperacion_exacta() public {
        address a = _user("a", address(0));
        address b = _user("b", a);
        _borrow(a, 1);
        _payAll(a);
        _borrow(b, 1);
        assertEq(credit.outstandingLoans(tok), 1 ether, "testigo");
        credit.forceNivel(a, 8);
        _borrow(a, 8);
        (,, uint256 total,) = credit.obtenerDeuda(a);
        assertEq(total, 82800000000000000000);
        token.mint(a, total);
        vm.prank(a, a);
        credit.pagarPrestamo(tok, 27600000000000000000);
        _vencerMas(a, 48 hours + 1);
        uint256 poolAntes = _pool();
        assertTrue(_liquida(complice, a));
        (,, uint256 sigue,) = credit.obtenerDeuda(a);
        assertEq(sigue, total, "la deuda sigue tras liquidate");
        assertEq(poolAntes - _pool(), 40000000000000000000, "castigo = principal restante");
        assertEq(credit.outstandingLoans(tok), 1 ether, "outstanding sin el castigado");
        _assertNav();
        vm.startPrank(a, a);
        credit.pagarPrestamo(tok, 27600000000000000000);
        credit.pagarPrestamo(tok, total - 55200000000000000000);
        vm.stopPrank();
        (, uint256 activo,,,,) = credit.usuarios(a);
        assertEq(activo, 0, "cerrado");
        assertEq(credit.outstandingLoans(tok), 1 ether, "outstanding exacto");
        _assertNav();
    }

    /// Fuzz: pagos parciales, castigo y recuperación. Deriva 0 y NAV exacto.
    function testFuzz_castigo_y_recuperacion(uint256 nivel, uint256 s1, uint256 s2) public {
        nivel = bound(nivel, 8, 40);
        address w = _user("w", address(0));
        _borrow(w, 1);
        address a = _user("a", address(0));
        credit.forceNivel(a, nivel);
        _borrow(a, nivel);
        (,, uint256 total,) = credit.obtenerDeuda(a);
        token.mint(a, total);
        (,, uint8 tot,,) = credit.planPago(a);
        if (s1 % 2 == 0) {
            vm.prank(a, a);
            credit.pagarPrestamo(tok, bound(s1, total / tot, total - 1));
        }
        _vencerMas(a, 48 hours + 1);
        assertTrue(_liquida(complice, a));
        (,, uint256 sigue,) = credit.obtenerDeuda(a);
        assertEq(sigue, total, "la deuda sigue tras liquidate");
        vm.startPrank(a, a);
        for (uint256 i = 0; i < 14; i++) {
            (, uint256 activo,,,,) = credit.usuarios(a);
            if (activo == 0) break;
            (uint128 pag,, uint8 t, uint8 pgs,) = credit.planPago(a);
            uint256 rest = total - pag;
            uint256 left = t > pgs ? t - pgs : 1;
            uint256 cuota = left <= 1 ? rest : rest / left;
            if (cuota == 0) cuota = 1;
            credit.pagarPrestamo(tok, bound(uint256(keccak256(abi.encode(s2, i))), cuota, rest));
        }
        vm.stopPrank();
        (, uint256 act,,,,) = credit.usuarios(a);
        assertEq(act, 0, "cerrado");
        assertEq(credit.outstandingLoans(tok), 1 ether, "deriva");
        _assertNav();
    }
}
