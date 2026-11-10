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
        new QuatriviumCredit(address(1), admins, address(2), address(0));
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
        bytes32 cert = keccak256("cert");
        vm.prank(address(0xBEEF));
        vm.expectRevert(QuatriviumApk.SoloFundador.selector);
        apk.publicar(1, h1, cert);
        vm.expectRevert(QuatriviumApk.VersionInvalida.selector);
        apk.publicar(1, h1, bytes32(0));
        apk.publicar(4, h1, cert);
        apk.publicar(5, h2, cert);
        vm.expectRevert(QuatriviumApk.CertificadoDistinto.selector);
        apk.publicar(6, h2, keccak256("otro"));
        assertEq(apk.total(), 2);
        (uint256 c0, bytes32 a0,,) = apk.version(0);
        (uint256 c1, bytes32 a1,,) = apk.version(1);
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
        address caja = address(0xCA1A);
        token.mint(caja, 20_000 ether);
        vm.prank(caja);
        token.approve(address(credit), type(uint256).max);
        vm.prank(caja, caja);
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
        int256 sistema = int256(liq1 + fondo1) - int256(liq0 + fondo0);
        uint256 corte = (interes * 1500) / 10000;
        uint256 bueno = interes - corte;
        uint256 premio = 0.05 ether;
        if (premio > interes) premio = interes;
        // El 1 del padrino que entra al pool y el principal que el seguro absorbe se anulan.
        // El premio sale del sistema. El principal no vuelve en tokens.
        int256 esperado = int256(buenos * (2 ether + bueno)) - int256(malos * premio);
        int256 ganancia = sistema - int256(n * 1 ether + buenos * 1 ether);
        int256 fondoDelta = int256(fondo1) - int256(fondo0);
        int256 poolDelta = int256(liq1) - int256(liq0);

        console2.log("impago", malos);
        console2.log("ganancia antes (pool+fondo)", ganancia);
        console2.log("pool despues", poolDelta);
        console2.log("fondo", fondoDelta);
        console2.log("cubierto", credit.totalImpagoCubierto());

        assertEq(sistema, esperado, "sistema");
        assertEq(credit.totalImpagoCubierto(), malos * 1 ether, "cobertura");
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
            admins,
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

    function test_liquidacion_l1_conserva_saldos() public {
        vm.chainId(31337);
        vm.warp(1_700_000_000);
        (QuatriviumCredit credit, QuatriviumAlta alta, ERC20Mock token, QuatriviumReserva reserva,) =
            _stack(address(0));
        address caja = address(0xCA1A);
        token.mint(caja, 1000 ether);
        vm.prank(caja);
        token.approve(address(credit), type(uint256).max);
        vm.prank(caja, caja);
        credit.depositarLiquidez(address(token), 100 ether);

        address deudor = address(0xD00D);
        vm.prank(deudor, deudor);
        credit.registrarHumanoConPadre(address(0));
        token.mint(deudor, 10 ether);
        vm.prank(deudor);
        token.approve(address(alta), type(uint256).max);
        vm.prank(deudor, deudor);
        alta.pagarRegistro();
        vm.prank(deudor, deudor);
        credit.solicitarPrestamo(address(token), 1);

        (, uint256 principal, uint256 vencimiento,,,) = credit.usuarios(deudor);
        (, uint256 interes,,) = credit.obtenerDeuda(deudor);
        vm.warp(vencimiento + 48 hours + 2 hours);

        address liq = address(0x1111);
        uint256 premio = (principal * 5) / 100;
        if (premio > interes) premio = interes;
        uint256 suma = _caja(token, credit, alta, reserva, deudor, liq);
        uint256 fondoAntes = credit.fondoSeguro(address(token));

        vm.prank(liq, liq);
        credit.liquidate(deudor, address(token));

        assertEq(token.balanceOf(liq), premio);
        assertGt(premio, 0);
        assertEq(credit.outstandingLoans(address(token)), 0);
        assertEq(_caja(token, credit, alta, reserva, deudor, liq), suma);
        assertEq(
            token.balanceOf(address(credit)) + credit.outstandingLoans(address(token)),
            credit.totalLiquidity(address(token)) + credit.fondoSeguro(address(token))
        );
        assertLe(credit.fondoSeguro(address(token)), fondoAntes);
        assertEq(token.balanceOf(address(reserva)), reserva.bote() + reserva.totalBloqueado());
        (bool ok,) = address(credit).call(
            abi.encodeWithSignature("retirarLiquidez(address,uint256)", address(token), 1 ether)
        );
        assertFalse(ok);
    }

    function _caja(
        ERC20Mock token,
        QuatriviumCredit credit,
        QuatriviumAlta alta,
        QuatriviumReserva reserva,
        address deudor,
        address liq
    ) internal view returns (uint256) {
        return token.balanceOf(address(credit)) + token.balanceOf(address(alta)) + token.balanceOf(address(reserva))
            + token.balanceOf(deudor) + token.balanceOf(liq) + token.balanceOf(credit.fundador());
    }
}
