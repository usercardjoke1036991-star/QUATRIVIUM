// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {QuatriviumCredit} from "../contracts/QuatriviumCredit.sol";
import {QuatriviumFamaCaja} from "../contracts/QuatriviumFamaCaja.sol";
import {QuatriviumFamaLib} from "../contracts/libraries/QuatriviumFamaLib.sol";
import {QuatriviumReserva} from "../contracts/QuatriviumReserva.sol";
import {QuatriviumAlta} from "../contracts/QuatriviumAlta.sol";
import {ERC20Mock} from "../contracts/mocks/ERC20Mock.sol";
import {MockV3Aggregator} from "../contracts/mocks/MockV3Aggregator.sol";
import {CreditViewMock} from "../contracts/mocks/CreditViewMock.sol";

contract QuatriviumAuditForgeTest is Test {
    uint256 internal constant EIP170 = 24576;
    ERC20Mock internal token;
    MockV3Aggregator internal feed;
    QuatriviumCredit internal credit;
    QuatriviumFamaCaja internal fama;
    QuatriviumAlta internal alta;
    address internal owner;
    uint256 internal ownerPk;
    address internal user;
    address internal liquidator;

    function setUp() public {
        vm.warp(1_704_000_000);
        ownerPk = 0xA11CE;
        owner = vm.addr(ownerPk);
        user = makeAddr("user");
        liquidator = makeAddr("liquidator");
        vm.deal(owner, 10 ether);

        token = new ERC20Mock();
        feed = new MockV3Aggregator(8, 100000000);
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
        credit = new QuatriviumCredit(
            address(token),
            payable(owner),
            500,
            admins,
            1,
            address(fama),
            address(0)
        );
        new QuatriviumReserva(address(token), owner, predictedCredit, address(fama), predictedAlta, admins);
        alta = new QuatriviumAlta(address(token), predictedCredit, predictedReserva);
        vm.stopPrank();
        require(address(credit) == predictedCredit, "credit pred");

        token.mint(owner, 10_000 ether);
        vm.startPrank(owner, owner);
        token.approve(address(credit), type(uint256).max);
        credit.depositarLiquidez(address(token), 500 ether);
        vm.stopPrank();
    }

    function test_runtime_fits_eip170() public view {
        assertLe(address(credit).code.length, EIP170);
    }

    function test_default_count_brake_is_10000() public view {
        assertEq(credit.maxOriginationsPerWindow(), 10000);
        assertEq(credit.maxUtilizationBps(), 8000);
        assertEq(credit.SELLO_PRIMERA(), 7 days);
    }

    function test_donate_from_first_usdt_gives_100_fame() public {
        _onboard(user);
        _donate(user, 2 ether);
        assertEq(fama.famaCaja(user), 200);
        assertEq(credit.donado(user), 2 ether);
    }

    function test_donate_dust_gives_zero_then_first_usdt_100() public {
        _onboard(user);
        _donate(user, 1);
        assertEq(fama.famaCaja(user), 0);
        _donate(user, 1 ether);
        assertEq(fama.famaCaja(user), 100);
    }

    function test_donate_three_credits_300_fame() public {
        _onboard(user);
        _donate(user, 3 ether);
        assertEq(fama.famaCaja(user), 300);
    }

    function testFuzz_donate_100_fame_per_usdt(uint96 aRaw, uint96 bRaw) public {
        uint256 a = bound(aRaw, 1 ether, 20 ether);
        uint256 b = bound(bRaw, 1 ether, 20 ether);
        _onboard(user);
        _donate(user, a);
        _donate(user, b);
        uint256 expected = QuatriviumFamaLib.ptsDonacion(0, a) + QuatriviumFamaLib.ptsDonacion(a, b);
        assertEq(fama.famaCaja(user), expected);
    }

    function test_self_liquidate_reverts() public {
        _onboard(user);
        vm.prank(user, user);
        credit.solicitarPrestamo(address(token), 0);
        (, , uint256 vencimiento,,,) = credit.usuarios(user);
        vm.warp(vencimiento + 48 hours + 10);
        token.mint(user, 20 ether);
        vm.prank(user, user);
        vm.expectRevert();
        credit.liquidate(user, address(token));
        (, uint256 montoActivo,,,,) = credit.usuarios(user);
        assertGt(montoActivo, 0);
    }

    function test_third_party_liquidate_keeps_nav() public {
        _onboard(user);
        vm.prank(user, user);
        credit.solicitarPrestamo(address(token), 0);
        (, , uint256 vencimiento,,,) = credit.usuarios(user);
        vm.warp(vencimiento + 48 hours + 10);
        token.mint(liquidator, 50 ether);
        vm.prank(liquidator);
        token.approve(address(credit), type(uint256).max);
        vm.prank(liquidator, liquidator);
        credit.liquidate(user, address(token));
        _assertNav();
        (, uint256 montoActivo,,,,) = credit.usuarios(user);
        assertEq(montoActivo, 0);
    }

    function test_no_pause_or_ban_selectors_and_repay_works() public {
        _onboard(user);
        vm.prank(user, user);
        credit.solicitarPrestamo(address(token), 0);
        (,, uint256 total,) = credit.obtenerDeuda(user);
        (bool okPause,) = address(credit).call(abi.encodeWithSignature("pausarContrato()"));
        assertFalse(okPause);
        (bool okBan,) = address(credit).call(abi.encodeWithSignature("banWallet(address,bool)", user, true));
        assertFalse(okBan);
        vm.prank(user, user);
        credit.pagarPrestamo(address(token), total);
        (, uint256 montoActivo,,,,) = credit.usuarios(user);
        assertEq(montoActivo, 0);
        _assertNav();
    }

    function test_stale_feed_does_not_block_borrow_or_donate() public {
        _onboard(user);
        feed.setRound(3, 100000000, block.timestamp - 26 hours, block.timestamp - 25 hours - 1 minutes, 3);
        vm.prank(user, user);
        credit.solicitarPrestamo(address(token), 0);
        vm.prank(user, user);
        credit.donar(address(token), 1 ether);
    }

    function test_depeg_does_not_block_deposit() public {
        feed.updateAnswer(97000000);
        vm.prank(owner, owner);
        credit.depositarLiquidez(address(token), 1 ether);
    }

    function test_no_attest_or_kyc_selectors() public {
        (bool okVincular,) = address(credit).call(
            abi.encodeWithSignature(
                "vincularIdentidad(bytes32,bytes32,uint256,uint8,bytes32,bytes32)",
                bytes32(0),
                bytes32(0),
                uint256(0),
                uint8(27),
                bytes32(0),
                bytes32(0)
            )
        );
        assertFalse(okVincular);
        (bool okKyc,) = address(credit).call(abi.encodeWithSignature("declararKyc()"));
        assertFalse(okKyc);
    }

    function test_failed_admin_execute_can_retry() public {
        address third = credit.ownerList(2);
        bytes memory data = abi.encodeWithSelector(QuatriviumCredit.removeAdmin.selector, third);
        vm.prank(owner);
        uint256 id = credit.proposeAdminAction(data);
        vm.warp(block.timestamp + 72 hours + 1);
        vm.prank(owner);
        vm.expectRevert();
        credit.executeAdminAction(id);
        (,,,, bool executed,) = credit.proposals(id);
        assertFalse(executed);

        _onboard(user);
        vm.prank(user, user);
        credit.solicitarPrestamo(address(token), 0);
        (, , uint256 vencimiento,,,) = credit.usuarios(user);
        vm.warp(vencimiento + 48 hours + 10);
        token.mint(liquidator, 50 ether);
        vm.prank(liquidator);
        token.approve(address(credit), type(uint256).max);
        uint256 antes = credit.totalLiquidity(address(token)) + credit.fondoSeguro(address(token));
        vm.prank(liquidator, liquidator);
        credit.liquidate(user, address(token));
        uint256 trasFee = credit.totalLiquidity(address(token)) + credit.fondoSeguro(address(token));
        assertGt(trasFee, antes);
        assertEq(credit.collectedFees(address(token)), 0);

        vm.prank(credit.ownerList(1));
        credit.confirmAdminAction(id);
        vm.prank(owner);
        credit.executeAdminAction(id);
        (,,,, bool done,) = credit.proposals(id);
        assertTrue(done);
        assertFalse(credit.admins(third));
        assertEq(credit.collectedFees(address(token)), 0);
        assertEq(credit.totalLiquidity(address(token)) + credit.fondoSeguro(address(token)), trasFee);
        _assertNav();
    }

    function test_canje_respects_cash_floor() public {
        _onboard(user);
        vm.prank(user, user);
        credit.solicitarPrestamo(address(token), 0);
        (,, uint256 total,) = credit.obtenerDeuda(user);
        vm.prank(user, user);
        credit.pagarPrestamo(address(token), total);
        _donate(user, 5 ether);
        assertEq(fama.famaCaja(user), 500);
        // Pool is 500; 20% floor = 100. Redeem 250 fame = 1 USDT, allowed.
        vm.prank(user, user);
        fama.canjearFama(250);
        assertEq(fama.famaCanjeada(user), 250);
        _assertNav();
    }

    function test_pagarCanje_only_fama_sibling() public {
        vm.prank(user, user);
        vm.expectRevert();
        credit.pagarCanje(address(token), user, 1 ether);
    }

    function test_no_destroy_selector() public {
        (bool ok,) = address(credit).call(abi.encodeWithSignature("destruirCuenta(address)", address(token)));
        assertFalse(ok);
    }

    function test_founder_cannot_self_donate() public {
        token.mint(owner, 5 ether);
        vm.prank(owner, owner);
        vm.expectRevert();
        credit.donar(address(token), 5 ether);
    }

    function test_contract_cannot_borrow() public {
        BorrowProxy proxy = new BorrowProxy(credit);
        vm.expectRevert();
        proxy.borrow();
    }

    function testFuzz_nav_after_repay(uint8 extraMint) public {
        _onboard(user);
        vm.prank(user, user);
        credit.solicitarPrestamo(address(token), 0);
        (,, uint256 total,) = credit.obtenerDeuda(user);
        token.mint(user, uint256(extraMint) * 1e15);
        vm.prank(user, user);
        credit.pagarPrestamo(address(token), total);
        _assertNav();
    }

    function test_boost_daily_cap_and_two_key_resume() public {
        CreditViewMock vista = new CreditViewMock();
        address founder = makeAddr("boost-founder");
        address locker = makeAddr("boost-locker");
        address[] memory radmins = new address[](3);
        radmins[0] = founder;
        radmins[1] = locker;
        radmins[2] = address(1);
        QuatriviumReserva reserva = new QuatriviumReserva(address(token), founder, address(vista), address(vista), address(1), radmins);
        vista.setAdmin(founder, true);
        vista.setNivel(locker, 10);
        vista.setPayToken(address(token));
        token.mint(address(vista), 200 ether);
        token.mint(founder, 200 ether);
        token.mint(locker, 600 ether);
        vm.prank(founder, founder);
        token.approve(address(reserva), type(uint256).max);
        vm.prank(locker, locker);
        token.approve(address(reserva), type(uint256).max);
        vm.prank(founder, founder);
        reserva.aportarBote(20 ether);
        vm.prank(locker, locker);
        reserva.bloquear(500 ether);

        bytes32 salt = keccak256("cap");
        vm.expectRevert(QuatriviumReserva.TopeDiario.selector);
        vista.triggerBoost(address(reserva), locker, 1_000_000 ether, salt);

        assertEq(reserva.requiredConfirmations(), 2);
    }

    function _onboard(address who) internal {
        vm.prank(who, who);
        credit.registrarHumanoConPadre(address(0));
        token.mint(who, 84 ether);
        vm.prank(who);
        token.approve(address(credit), type(uint256).max);
        vm.prank(who);
        token.approve(address(alta), type(uint256).max);
        vm.prank(who, who);
        alta.pagarRegistro();
    }

    function _donate(address who, uint256 amount) internal {
        token.mint(who, amount);
        vm.prank(who);
        token.approve(address(credit), type(uint256).max);
        vm.prank(who, who);
        credit.donar(address(token), amount);
    }

    function _assertNav() internal view {
        uint256 cash = token.balanceOf(address(credit));
        uint256 outstanding = credit.outstandingLoans(address(token));
        uint256 liquidity = credit.totalLiquidity(address(token));
        uint256 fees = credit.collectedFees(address(token));
        uint256 fondo = credit.fondoSeguro(address(token));
        assertEq(cash + outstanding, liquidity + fees + fondo, "NAV broken");
    }
}

contract BorrowProxy {
    QuatriviumCredit internal immutable credit;

    constructor(QuatriviumCredit credit_) {
        credit = credit_;
    }

    function borrow() external {
        credit.solicitarPrestamo(address(0), 0);
    }
}

contract FamaLibPtsTest is Test {
    function testFuzz_ptsDonacion_100_per_usdt(uint256 prev, uint256 amount) public pure {
        prev = bound(prev, 0, 100 ether);
        amount = bound(amount, 0, 100 ether);
        uint256 pts = QuatriviumFamaLib.ptsDonacion(prev, amount);
        assertEq(pts, (amount * 100) / 1e18);
        if (amount < 1 ether) assertEq(pts, (amount * 100) / 1e18);
    }

    function test_tope_util_grande_es_70_de_80() public pure {
        assertEq(QuatriviumFamaLib.topeUtilGrande(8000), 7000);
        assertEq(QuatriviumFamaLib.liqGeneral(1000 ether, 1 ether), 999 ether);
        assertEq(QuatriviumFamaLib.liqGeneral(1 ether, 2 ether), 0);
    }

    function test_umbral_piso_y_fractal() public pure {
        assertEq(QuatriviumFamaLib.umbralCarrilChico(200 ether), 50 ether);
        assertEq(QuatriviumFamaLib.umbralCarrilChico(20_000 ether), 100 ether);
        assertTrue(QuatriviumFamaLib.esCarrilChico(200 ether, 50 ether));
        assertFalse(QuatriviumFamaLib.esCarrilChico(200 ether, 50 ether + 1));
        assertTrue(QuatriviumFamaLib.esCarrilChico(20_000 ether, 80 ether));
        assertFalse(QuatriviumFamaLib.esCarrilChico(20_000 ether, 101 ether));
    }

    function testFuzz_umbral_piso_o_medio_por_ciento(uint256 caja) public pure {
        caja = bound(caja, 0, 1e27);
        uint256 umbral = QuatriviumFamaLib.umbralCarrilChico(caja);
        uint256 medioPorciento = (caja * 1000) / 200000;
        uint256 esperadoUmbral = medioPorciento < 50 ether ? 50 ether : medioPorciento;
        assertEq(umbral, esperadoUmbral);
    }

    function test_sello_primera_solo_l1_a_tiempo() public pure {
        assertTrue(QuatriviumFamaLib.usaSelloPrimera(1 ether, 100, 99, 1 ether, 1, true));
        assertFalse(QuatriviumFamaLib.usaSelloPrimera(1 ether, 100, 101, 1 ether, 1, true));
        assertFalse(QuatriviumFamaLib.usaSelloPrimera(1 ether, 100, 99, 1 ether, 1, false));
        assertFalse(QuatriviumFamaLib.usaSelloPrimera(1 ether, 100, 99, 50 ether, 1, true));
    }

    function test_acceso_grande_para_en_70() public {
        this.wrapAcceso(1000 ether, 0, 0, 50 ether, 8000, true);
        vm.expectRevert();
        this.wrapAcceso(85 ether, 0, 0, 60 ether, 8000, false);
    }

    function test_acceso_chico_para_en_80() public {
        this.wrapAcceso(100 ether, 0, 79 ether, 1 ether, 8000, true);
        vm.expectRevert();
        this.wrapAcceso(100 ether, 0, 80 ether, 1 ether, 8000, true);
    }

    function wrapAcceso(
        uint256 totalLiq,
        uint256 reservado,
        uint256 outstanding,
        uint256 monto,
        uint256 utilMaxBps,
        bool esChico
    ) external pure {
        QuatriviumFamaLib.requireAcceso(totalLiq, reservado, outstanding, monto, utilMaxBps, esChico);
    }
}
