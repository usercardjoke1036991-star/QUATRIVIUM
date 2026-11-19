// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {console2} from "forge-std/console2.sol";
import {QuatriviumCreditHarness} from "../contracts/test/QuatriviumCreditHarness.sol";
import {QuatriviumCredit} from "../contracts/QuatriviumCredit.sol";
import {QuatriviumFamaCaja} from "../contracts/QuatriviumFamaCaja.sol";
import {QuatriviumReserva} from "../contracts/QuatriviumReserva.sol";
import {QuatriviumAlta} from "../contracts/QuatriviumAlta.sol";
import {QuatriviumApk} from "../contracts/QuatriviumApk.sol";
import {ERC20Mock} from "../contracts/mocks/ERC20Mock.sol";
import {MockV3Aggregator} from "../contracts/mocks/MockV3Aggregator.sol";

/// Despliegue completo igual que deploy-arbitrum-sovereign (Fama -> Credit -> Reserva -> Alta).
abstract contract Tanda1Base is Test {
    ERC20Mock internal token;
    MockV3Aggregator internal feed;
    QuatriviumCreditHarness internal credit;
    QuatriviumFamaCaja internal fama;
    QuatriviumReserva internal reserva;
    QuatriviumAlta internal alta;
    address internal owner;
    address internal adminB;
    address internal adminC;
    address internal tok;

    function _deploy(bool withFeed) internal {
        vm.warp(1_704_000_000);
        owner = makeAddr("owner");
        adminB = makeAddr("admin-b");
        adminC = makeAddr("admin-c");
        token = new ERC20Mock();
        tok = address(token);
        if (withFeed) {
            feed = new MockV3Aggregator(0, 0);
        }
        address[] memory admins = new address[](3);
        admins[0] = owner;
        admins[1] = adminB;
        admins[2] = adminC;
        uint64 nonce = vm.getNonce(owner);
        address pCredit = vm.computeCreateAddress(owner, nonce + 1);
        address pReserva = vm.computeCreateAddress(owner, nonce + 2);
        address pAlta = vm.computeCreateAddress(owner, nonce + 3);
        vm.startPrank(owner, owner);
        fama = new QuatriviumFamaCaja(tok, pCredit, pAlta, pReserva);
        credit = new QuatriviumCreditHarness(tok, admins, address(fama), withFeed ? address(feed) : address(0));
        reserva = new QuatriviumReserva(tok, owner, address(credit), address(fama), pAlta, admins);
        alta = new QuatriviumAlta(tok, address(credit), address(reserva));
        vm.stopPrank();
        require(address(credit) == pCredit && address(reserva) == pReserva && address(alta) == pAlta, "pred");
        token.mint(owner, 1_000_000 ether);
        vm.startPrank(owner, owner);
        token.approve(address(credit), type(uint256).max);
        token.approve(address(reserva), type(uint256).max);
        vm.stopPrank();
    }

    function _seed(uint256 amount) internal {
        vm.prank(owner, owner);
        credit.depositarLiquidez(tok, amount);
    }

    function _user(string memory name, address padre) internal returns (address who) {
        who = makeAddr(name);
        _onboard(who, padre);
    }

    function _onboard(address who, address padre) internal {
        vm.prank(who, who);
        credit.registrarHumanoConPadre(padre);
        token.mint(who, 4 ether);
        vm.startPrank(who);
        token.approve(address(credit), type(uint256).max);
        token.approve(address(alta), type(uint256).max);
        token.approve(address(reserva), type(uint256).max);
        vm.stopPrank();
        vm.prank(who, who);
        alta.pagarRegistro();
    }

    function _borrow(address who, uint256 nivel) internal {
        (,, uint256 last) = credit.obtenerProgresoUsuario(who);
        if (last != 0 && vm.getBlockTimestamp() < last + 48 hours) vm.warp(last + 48 hours + 1);
        vm.prank(who, who);
        credit.solicitarPrestamo(tok, nivel);
    }

    function _payAll(address who) internal {
        (,, uint256 total,) = credit.obtenerDeuda(who);
        (uint128 pagado,,,,) = credit.planPago(who);
        uint256 rest = total - pagado;
        token.mint(who, rest);
        vm.prank(who, who);
        credit.pagarPrestamo(tok, rest);
    }

    function _nav() internal view returns (uint256 lhs, uint256 rhs) {
        lhs = token.balanceOf(address(credit)) + credit.outstandingLoans(tok);
        rhs = credit.totalLiquidity(tok) + credit.fondoSeguro(tok);
    }

    function _assertNav() internal view {
        (uint256 l, uint256 r) = _nav();
        assertEq(l, r, "NAV");
    }
}

contract QuatriviumTanda1Test is Tanda1Base {
    function setUp() public {
        _deploy(false);
        _seed(100_000 ether);
    }

    /// QA-C-02: tras rotar el fundador en Credit, la Reserva paga el corte a la llave nueva.
    function test_reserva_corte_sigue_rotacion_fundador() public {
        address nuevo = makeAddr("fundador-nuevo");
        vm.prank(owner);
        credit.proponerFundador(nuevo);
        vm.warp(vm.getBlockTimestamp() + 72 hours);
        vm.prank(owner);
        credit.aplicarFundador();
        assertEq(credit.fundador(), nuevo);

        address ana = makeAddr("ana");
        _onboard(ana, address(0));
        vm.prank(owner, owner);
        reserva.aportarBote(100 ether);
        credit.forceNivel(ana, 10);
        token.mint(ana, 600 ether);
        vm.prank(ana, ana);
        reserva.bloquear(600 ether);
        vm.warp(vm.getBlockTimestamp() + 30 days);
        uint256 viejoAntes = token.balanceOf(owner);
        uint256 nuevoAntes = token.balanceOf(nuevo);
        vm.prank(ana, ana);
        reserva.desbloquear();
        assertEq(token.balanceOf(owner) - viejoAntes, 0, "llave vieja no cobra");
        assertEq(token.balanceOf(nuevo) - nuevoAntes, 710136986301369862, "llave nueva cobra el corte");
        assertEq(reserva.fundador(), nuevo, "Reserva.fundador sigue a Credit");
    }

    /// QA-C-03: nivel 8 (82,8 LUSD, 3 cuotas) pagado en 3 partes fijas. Con el testigo b
    /// (1 LUSD abierto), outstandingLoans tiene que volver a 1e18 exacto y el NAV cuadrar al wei.
    function test_redondeo_3_cuotas_sin_polvo() public {
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
        vm.startPrank(a, a);
        credit.pagarPrestamo(tok, 79096335011713081324);
        credit.pagarPrestamo(tok, 3352767742771378858);
        (uint128 pag,,,,) = credit.planPago(a);
        credit.pagarPrestamo(tok, total - pag);
        vm.stopPrank();
        (, uint256 activo,,,,) = credit.usuarios(a);
        assertEq(activo, 0, "cerrado");
        assertEq(credit.outstandingLoans(tok), 1 ether, "outstanding vuelve exacto al testigo");
        _assertNav();
    }

    /// QA-S-01: reemplazar un admin por un Safe = removeAdmin(viejo) y luego addAdmin(safe).
    function test_reemplazo_admin_por_safe() public {
        address safe = makeAddr("safe");
        uint256 id = _votar(abi.encodeWithSignature("addAdmin(address)", safe), adminB);
        vm.prank(owner);
        vm.expectRevert();
        credit.executeAdminAction(id);
        uint256 r = _votar(abi.encodeWithSignature("removeAdmin(address)", adminC), adminB);
        vm.prank(owner);
        credit.executeAdminAction(r);
        uint256 a2 = _votar(abi.encodeWithSignature("addAdmin(address)", safe), adminB);
        vm.prank(owner);
        credit.executeAdminAction(a2);
        assertTrue(credit.admins(safe));
        assertFalse(credit.admins(adminC));
    }

    function _votar(bytes memory data, address segundo) internal returns (uint256 id) {
        vm.prank(owner);
        id = credit.proposeAdminAction(data);
        vm.prank(segundo);
        credit.confirmAdminAction(id);
        vm.warp(vm.getBlockTimestamp() + 72 hours);
    }
}
