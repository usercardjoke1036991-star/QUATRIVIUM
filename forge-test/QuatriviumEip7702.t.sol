// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {QuatriviumCredit} from "../contracts/QuatriviumCredit.sol";
import {QuatriviumFamaCaja} from "../contracts/QuatriviumFamaCaja.sol";
import {QuatriviumReserva} from "../contracts/QuatriviumReserva.sol";
import {QuatriviumAlta} from "../contracts/QuatriviumAlta.sol";
import {ERC20Mock} from "../contracts/mocks/ERC20Mock.sol";
import {MockV3Aggregator} from "../contracts/mocks/MockV3Aggregator.sol";
import {CreditViewMock} from "../contracts/mocks/CreditViewMock.sol";

contract LlamaPrestamo {
    constructor(QuatriviumCredit credit_, address token_) {
        credit_.solicitarPrestamo(token_, 0);
    }
}

contract LlamaAlta {
    constructor(QuatriviumAlta alta_) {
        alta_.pagarRegistro();
    }
}

contract LlamaBloquear {
    constructor(QuatriviumReserva reserva_) {
        reserva_.bloquear(1 ether);
    }
}

contract LlamaCanje {
    constructor(QuatriviumFamaCaja fama_) {
        fama_.canjearFama(1);
    }
}

contract QuatriviumEip7702Test is Test {
    ERC20Mock internal token;
    QuatriviumCredit internal credit;
    QuatriviumAlta internal alta;
    QuatriviumReserva internal reserva;
    QuatriviumFamaCaja internal fama;
    address internal owner;

    function setUp() public {
        vm.warp(1_704_000_000);
        owner = makeAddr("owner");
        vm.deal(owner, 10 ether);
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
        vm.startPrank(owner);
        fama = new QuatriviumFamaCaja(address(token), predictedCredit, predictedAlta, predictedReserva);
        credit = new QuatriviumCredit(address(token), admins, address(fama), address(feed));
        reserva = new QuatriviumReserva(address(token), owner, predictedCredit, address(fama), predictedAlta, admins);
        alta = new QuatriviumAlta(address(token), predictedCredit, predictedReserva);
        vm.stopPrank();
        token.mint(owner, 10_000 ether);
        vm.startPrank(owner, owner);
        token.approve(address(credit), type(uint256).max);
        credit.depositarLiquidez(address(token), 500 ether);
        vm.stopPrank();
    }

    function _delegar(address cuenta) internal {
        vm.etch(cuenta, abi.encodePacked(hex"ef0100", address(token)));
    }

    function _fondear(address cuenta, address gasto) internal {
        token.mint(cuenta, 20 ether);
        vm.prank(cuenta, cuenta);
        token.approve(gasto, type(uint256).max);
    }

    function test_delegada_registrar_revierte() public {
        address cuenta = makeAddr("reg");
        _delegar(cuenta);
        vm.prank(cuenta, cuenta);
        vm.expectRevert(QuatriviumCredit.NoEsEOA.selector);
        credit.registrarHumanoConPadre(address(0));
    }

    function test_delegada_depositar_revierte() public {
        address cuenta = makeAddr("dep");
        _fondear(cuenta, address(credit));
        _delegar(cuenta);
        vm.prank(cuenta, cuenta);
        vm.expectRevert(QuatriviumCredit.NoEsEOA.selector);
        credit.depositarLiquidez(address(token), 1 ether);
    }

    function test_delegada_solicitar_revierte() public {
        address cuenta = makeAddr("sol");
        _delegar(cuenta);
        vm.prank(cuenta, cuenta);
        vm.expectRevert(QuatriviumCredit.NoEsEOA.selector);
        credit.solicitarPrestamo(address(token), 0);
    }

    function test_delegada_solicitar_tope_revierte() public {
        address cuenta = makeAddr("tope");
        _delegar(cuenta);
        vm.prank(cuenta, cuenta);
        vm.expectRevert(QuatriviumCredit.NoEsEOA.selector);
        credit.solicitarPrestamoConTope(address(token), 0, type(uint256).max);
    }

    function test_delegada_liquidar_revierte() public {
        address cuenta = makeAddr("liq");
        _delegar(cuenta);
        vm.prank(cuenta, cuenta);
        vm.expectRevert(QuatriviumCredit.NoEsEOA.selector);
        credit.liquidate(owner, address(token));
    }

    function test_delegada_bono_hito_revierte() public {
        address cuenta = makeAddr("hito");
        _delegar(cuenta);
        vm.prank(cuenta, cuenta);
        vm.expectRevert(QuatriviumCredit.NoEsEOA.selector);
        credit.cobrarBonoHito(address(token));
    }

    function test_delegada_donar_revierte() public {
        address cuenta = makeAddr("don");
        _fondear(cuenta, address(credit));
        _delegar(cuenta);
        vm.prank(cuenta, cuenta);
        vm.expectRevert(QuatriviumCredit.NoEsEOA.selector);
        credit.donar(address(token), 1 ether);
    }

    function test_delegada_pagar_registro_revierte() public {
        address cuenta = makeAddr("alta");
        _fondear(cuenta, address(alta));
        _delegar(cuenta);
        vm.prank(cuenta, cuenta);
        vm.expectRevert(QuatriviumAlta.SoloEOA.selector);
        alta.pagarRegistro();
    }

    function test_delegada_bloquear_revierte() public {
        address cuenta = makeAddr("bloq");
        _fondear(cuenta, address(reserva));
        _delegar(cuenta);
        vm.prank(cuenta, cuenta);
        vm.expectRevert(QuatriviumReserva.SoloEOA.selector);
        reserva.bloquear(1 ether);
    }

    function test_delegada_renovar_revierte() public {
        address cuenta = makeAddr("ren");
        _delegar(cuenta);
        vm.prank(cuenta, cuenta);
        vm.expectRevert(QuatriviumReserva.SoloEOA.selector);
        reserva.renovar();
    }

    function test_delegada_aportar_revierte() public {
        address cuenta = makeAddr("bote");
        _fondear(cuenta, address(reserva));
        _delegar(cuenta);
        vm.prank(cuenta, cuenta);
        vm.expectRevert(QuatriviumReserva.SoloEOA.selector);
        reserva.aportarBote(1 ether);
    }

    function test_delegada_notificar_racha_revierte() public {
        address cuenta = makeAddr("racha");
        _delegar(cuenta);
        vm.prank(cuenta, cuenta);
        vm.expectRevert(QuatriviumFamaCaja.SoloEOA.selector);
        fama.notificarRacha(cuenta);
    }

    function test_delegada_cobrar_bono_racha_revierte() public {
        address cuenta = makeAddr("bonor");
        _delegar(cuenta);
        vm.prank(cuenta, cuenta);
        vm.expectRevert(QuatriviumFamaCaja.SoloEOA.selector);
        fama.cobrarBonoRacha();
    }

    function test_delegada_canjear_red_revierte() public {
        address cuenta = makeAddr("red");
        _delegar(cuenta);
        vm.prank(cuenta, cuenta);
        vm.expectRevert(QuatriviumFamaCaja.SoloEOA.selector);
        fama.canjearFamaRed(1);
    }

    function test_delegada_canjear_fama_revierte() public {
        address cuenta = makeAddr("fama");
        _delegar(cuenta);
        vm.prank(cuenta, cuenta);
        vm.expectRevert(QuatriviumFamaCaja.SoloEOA.selector);
        fama.canjearFama(1);
    }

    function test_constructor_prestamo_revierte() public {
        vm.expectRevert(QuatriviumCredit.NoEsEOA.selector);
        new LlamaPrestamo(credit, address(token));
    }

    function test_constructor_registro_revierte() public {
        vm.expectRevert(QuatriviumAlta.SoloEOA.selector);
        new LlamaAlta(alta);
    }

    function test_constructor_bloquear_revierte() public {
        vm.expectRevert(QuatriviumReserva.SoloEOA.selector);
        new LlamaBloquear(reserva);
    }

    function test_constructor_canje_revierte() public {
        vm.expectRevert(QuatriviumFamaCaja.SoloEOA.selector);
        new LlamaCanje(fama);
    }

    function test_contrato_distinto_origen_revierte_en_registro() public {
        ContratoPuente puente = new ContratoPuente(alta, reserva, fama, credit, address(token));
        vm.startPrank(owner, owner);
        vm.expectRevert(QuatriviumAlta.SoloEOA.selector);
        puente.registrar();
        vm.expectRevert(QuatriviumCredit.NoEsEOA.selector);
        puente.prestar();
        vm.expectRevert(QuatriviumReserva.SoloEOA.selector);
        puente.bloquear();
        vm.expectRevert(QuatriviumFamaCaja.SoloEOA.selector);
        puente.canjear();
        vm.stopPrank();
    }

    function test_salida_pagar_prestamo_delegada() public {
        address cuenta = makeAddr("paga");
        vm.prank(cuenta, cuenta);
        credit.registrarHumanoConPadre(address(0));
        token.mint(cuenta, 54 ether);
        vm.startPrank(cuenta, cuenta);
        token.approve(address(credit), type(uint256).max);
        token.approve(address(alta), type(uint256).max);
        alta.pagarRegistro();
        credit.solicitarPrestamo(address(token), 0);
        vm.stopPrank();
        (,, uint256 total,) = credit.obtenerDeuda(cuenta);
        _delegar(cuenta);
        vm.prank(cuenta, cuenta);
        credit.pagarPrestamo(address(token), total);
        (, uint256 activo,,,,) = credit.usuarios(cuenta);
        assertEq(activo, 0);
    }

    function test_salida_desbloquear_delegada_devuelve_capital() public {
        CreditViewMock vista = new CreditViewMock();
        address locker = makeAddr("locker");
        address[] memory radmins = new address[](3);
        radmins[0] = owner;
        radmins[1] = locker;
        radmins[2] = address(1);
        QuatriviumReserva local = new QuatriviumReserva(
            address(token), owner, address(vista), address(vista), address(1), radmins
        );
        vista.setNivel(locker, 10);
        token.mint(locker, 10 ether);
        vm.prank(locker, locker);
        token.approve(address(local), type(uint256).max);
        vm.prank(locker, locker);
        local.bloquear(10 ether);
        vm.warp(block.timestamp + 30 days);
        _delegar(locker);
        uint256 antes = token.balanceOf(locker);
        vm.prank(locker, locker);
        local.desbloquear();
        assertEq(token.balanceOf(locker) - antes, 10 ether);
    }

    function test_verificacion_con_cargo_cero_revierte() public {
        token.mint(address(alta), 1 ether);
        vm.prank(address(alta), address(alta));
        token.approve(address(credit), 1 ether);
        vm.prank(address(alta), address(alta));
        vm.expectRevert();
        credit.pagarVerificacion(address(token), 1 ether);
    }

    function test_sin_delegacion_el_registro_entra() public {
        address cuenta = makeAddr("limpia");
        vm.prank(cuenta, cuenta);
        credit.registrarHumanoConPadre(address(0));
        assertTrue(credit.humanosVerificados(cuenta));
    }
}

contract ContratoPuente {
    QuatriviumAlta internal alta;
    QuatriviumReserva internal reserva;
    QuatriviumFamaCaja internal fama;
    QuatriviumCredit internal credit;
    address internal token;

    constructor(
        QuatriviumAlta alta_,
        QuatriviumReserva reserva_,
        QuatriviumFamaCaja fama_,
        QuatriviumCredit credit_,
        address token_
    ) {
        alta = alta_;
        reserva = reserva_;
        fama = fama_;
        credit = credit_;
        token = token_;
    }

    function registrar() external {
        alta.pagarRegistro();
    }

    function bloquear() external {
        reserva.bloquear(1 ether);
    }

    function prestar() external {
        credit.solicitarPrestamo(token, 0);
    }

    function canjear() external {
        fama.canjearFama(1);
    }
}
