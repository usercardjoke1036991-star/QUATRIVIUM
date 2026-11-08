// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {console2} from "forge-std/console2.sol";
import {QuatriviumCredit} from "../contracts/QuatriviumCredit.sol";
import {QuatriviumFamaCaja} from "../contracts/QuatriviumFamaCaja.sol";
import {QuatriviumReserva} from "../contracts/QuatriviumReserva.sol";
import {QuatriviumAlta} from "../contracts/QuatriviumAlta.sol";
import {QuatriviumApk} from "../contracts/QuatriviumApk.sol";
import {ERC20Mock} from "../contracts/mocks/ERC20Mock.sol";

/// @notice Fase 3: feed obligatorio en Arbitrum One y simulación de 100 préstamos.
contract QuatriviumFase3Test is Test {
    function test_arbitrum_one_rejects_zero_sequencer() public {
        vm.chainId(42161);
        address[] memory admins = new address[](3);
        admins[0] = address(this);
        admins[1] = address(0xB0B);
        admins[2] = address(0xB0C);
        vm.expectRevert(QuatriviumCredit.SequencerFeedRequerido.selector);
        new QuatriviumCredit(
            address(1),
            payable(address(1)),
            500,
            admins,
            2,
            address(2),
            address(0)
        );
    }

    function test_sepolia_allows_zero_sequencer() public {
        vm.chainId(421614);
        (QuatriviumCredit credit,,,,) = _stack(address(0));
        assertEq(address(credit.sequencerFeed()), address(0));
    }

    function test_hardhat_chain_allows_zero_sequencer() public {
        assertEq(block.chainid, 31337);
        (QuatriviumCredit credit,,,,) = _stack(address(0));
        assertEq(address(credit.sequencerFeed()), address(0));
    }

    function test_apk_history_is_append_only() public {
        QuatriviumApk apk = new QuatriviumApk(address(this));
        bytes32 h1 = keccak256("apk-1");
        bytes32 h2 = keccak256("apk-2");
        vm.prank(address(0xBEEF));
        vm.expectRevert(QuatriviumApk.SoloFundador.selector);
        apk.publicar(1, h1);
        apk.publicar(4, h1);
        apk.publicar(5, h2);
        assertEq(apk.total(), 2);
        (uint256 c0, bytes32 a0,) = apk.version(0);
        (uint256 c1, bytes32 a1,) = apk.version(1);
        assertEq(c0, 4);
        assertEq(a0, h1);
        assertEq(c1, 5);
        assertEq(a1, h2);
    }

    /// @dev 100 préstamos L1. El resultado "antes" es la caja del sistema (pool + fondo),
    ///      que es lo que el pool habría retenido si el 5 % no se apartara.
    ///      "Después" es solo la liquidez prestable. La referencia citada de -21.75
    ///      era la pérdida cuando el principal impago no volvía.
    function test_simulacion_5_por_ciento() public {
        _simular(5, 100);
    }

    function test_simulacion_15_por_ciento() public {
        _simular(15, 100);
    }

    function test_simulacion_30_por_ciento() public {
        _simular(30, 100);
    }

    function _simular(uint256 malos, uint256 n) internal {
        vm.chainId(31337);
        vm.warp(1_700_000_000);
        (QuatriviumCredit credit, QuatriviumAlta alta, ERC20Mock token,,) = _stack(address(0));
        token.mint(address(this), 20_000 ether);
        token.approve(address(credit), type(uint256).max);
        vm.prank(address(this), address(this));
        credit.depositarLiquidez(address(token), 10_000 ether);

        uint256 liq0 = credit.totalLiquidity(address(token));
        uint256 fondo0 = credit.fondoSeguro(address(token));
        uint256 interes;
        uint256 buenos;

        for (uint256 i; i < n; ++i) {
            address quien = address(uint160(0xA000 + i));
            vm.prank(quien, quien);
            credit.registrarHumanoConPadre(address(0));
            token.mint(quien, 10 ether);
            vm.prank(quien, quien);
            token.approve(address(credit), type(uint256).max);
            vm.prank(quien, quien);
            token.approve(address(alta), type(uint256).max);
            vm.prank(quien, quien);
            alta.pagarRegistro();
            vm.prank(quien, quien);
            credit.solicitarPrestamo(address(token), 1);
            if (interes == 0) {
                (, interes,,) = credit.obtenerDeuda(quien);
            }
            if (i >= malos) {
                (, , uint256 total,) = credit.obtenerDeuda(quien);
                vm.prank(quien, quien);
                credit.pagarPrestamo(address(token), total);
                buenos += 1;
            }
        }

        vm.warp(block.timestamp + 7 days + 48 hours + 1);
        address liquidador = address(0x1111);
        token.mint(liquidador, malos * 3 ether);
        vm.prank(liquidador, liquidador);
        token.approve(address(credit), type(uint256).max);
        for (uint256 i; i < malos; ++i) {
            vm.prank(liquidador, liquidador);
            credit.liquidate(address(uint160(0xA000 + i)), address(token));
        }

        uint256 liq1 = credit.totalLiquidity(address(token));
        uint256 fondo1 = credit.fondoSeguro(address(token));
        uint256 sistema = (liq1 + fondo1) - (liq0 + fondo0);
        uint256 corte = (interes * 1500) / 10000;
        uint256 bueno = interes - corte;
        uint256 fee = (interes * 500) / 10000;
        uint256 topePremio = interes > fee ? interes - fee : 0;
        uint256 premio = 0.05 ether;
        if (premio > topePremio) premio = topePremio;
        uint256 malo = interes - premio;
        uint256 esperado = buenos * (2 ether + bueno) + malos * (1 ether + malo);
        int256 ganancia = int256(sistema) - int256(n * 1 ether + buenos * 1 ether);
        uint256 fondoDelta = fondo1 - fondo0;
        uint256 poolDelta = liq1 - liq0;

        console2.log("impago", malos);
        console2.log("ganancia antes (pool+fondo)", ganancia);
        console2.log("pool despues", poolDelta);
        console2.log("fondo", fondoDelta);
        console2.log("cubierto", credit.totalImpagoCubierto());

        assertEq(credit.collectedFees(address(token)), 0, "fee atascado");
        assertEq(sistema, esperado, "sistema");
        assertEq(credit.totalImpagoCubierto(), malos * premio, "cobertura");
        assertGt(int256(ganancia), int256(-2175) * int256(1e16), "mejor que -21.75");
        assertEq(credit.outstandingLoans(address(token)), 0);
    }

    function _stack(address feed)
        internal
        returns (
            QuatriviumCredit credit,
            QuatriviumAlta alta,
            ERC20Mock token,
            QuatriviumReserva reserva,
            QuatriviumFamaCaja fama
        )
    {
        token = new ERC20Mock();
        address[] memory admins = new address[](3);
        admins[0] = address(this);
        admins[1] = address(0xB0B);
        admins[2] = address(0xB0C);
        uint64 nonce = vm.getNonce(address(this));
        address predictedCredit = vm.computeCreateAddress(address(this), nonce + 1);
        address predictedReserva = vm.computeCreateAddress(address(this), nonce + 2);
        address predictedAlta = vm.computeCreateAddress(address(this), nonce + 3);
        fama = new QuatriviumFamaCaja(address(token), predictedCredit, predictedAlta, predictedReserva);
        credit = new QuatriviumCredit(
            address(token),
            payable(address(this)),
            500,
            admins,
            2,
            address(fama),
            feed
        );
        reserva = new QuatriviumReserva(
            address(token),
            address(this),
            predictedCredit,
            address(fama),
            predictedAlta,
            admins
        );
        alta = new QuatriviumAlta(address(token), predictedCredit, predictedReserva);
        require(address(credit) == predictedCredit, "pred");
    }
}
