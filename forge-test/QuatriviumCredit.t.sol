// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {QuatriviumCredit} from "../contracts/QuatriviumCredit.sol";
import {QuatriviumFamaCaja} from "../contracts/QuatriviumFamaCaja.sol";
import {QuatriviumReserva} from "../contracts/QuatriviumReserva.sol";
import {QuatriviumAlta} from "../contracts/QuatriviumAlta.sol";
import {QuatriviumLeveling} from "../contracts/QuatriviumLeveling.sol";
import {ERC20Mock} from "../contracts/mocks/ERC20Mock.sol";
import {MockV3Aggregator} from "../contracts/mocks/MockV3Aggregator.sol";

contract QuatriviumCreditForgeTest is Test {
    uint256 internal constant EIP170 = 24576;
    ERC20Mock internal token;
    MockV3Aggregator internal feed;
    QuatriviumCredit internal credit;
    QuatriviumAlta internal alta;
    address internal owner;
    uint256 internal ownerPk;
    address internal user;

    function setUp() public {
        vm.warp(1_704_000_000);
        ownerPk = 0xA11CE;
        owner = vm.addr(ownerPk);
        user = makeAddr("user");
        vm.deal(owner, 10 ether);

        token = new ERC20Mock();
        feed = new MockV3Aggregator(8, 100000000);
        address[] memory admins = new address[](1);
        admins[0] = owner;
        uint64 nonce = vm.getNonce(owner);
        address predictedCredit = vm.computeCreateAddress(owner, nonce + 1);
        address predictedReserva = vm.computeCreateAddress(owner, nonce + 2);
        address predictedAlta = vm.computeCreateAddress(owner, nonce + 3);
        vm.startPrank(owner);
        QuatriviumFamaCaja fama = new QuatriviumFamaCaja(address(token), predictedCredit, predictedAlta, predictedReserva);
        credit = new QuatriviumCredit(
            address(token),
            payable(owner),
            500,
            admins,
            1,
            address(fama)
        );
        new QuatriviumReserva(address(token), owner, predictedCredit, address(fama), predictedAlta);
        alta = new QuatriviumAlta(address(token), predictedCredit, predictedReserva);
        vm.stopPrank();
        require(address(credit) == predictedCredit, "credit pred");
        require(credit.famaHermano() == address(fama), "fama hermano");

        token.mint(owner, 10_000 ether);
        vm.startPrank(owner, owner);
        token.approve(address(credit), type(uint256).max);
        credit.depositarLiquidez(address(token), 500 ether);
        vm.stopPrank();
    }

    function test_runtime_fits_eip170() public view {
        assertLe(address(credit).code.length, EIP170, "QuatriviumCredit exceeds EIP-170");
    }

    function test_nav_holds_across_borrow_and_repay() public {
        _onboard(user);
        vm.prank(user, user);
        credit.solicitarPrestamo(address(token), 0);
        _assertNav();

        (,, uint256 total,) = credit.obtenerDeuda(user);
        vm.prank(user, user);
        credit.pagarPrestamo(address(token), total);
        _assertNav();

        (, uint256 montoActivo,,,,) = credit.usuarios(user);
        assertEq(montoActivo, 0);
    }

    function test_lp_cannot_redeem() public {
        uint256 value = credit.valorLp(owner, address(token));
        vm.prank(owner, owner);
        vm.expectRevert();
        credit.retirarLiquidez(address(token), value);
        assertEq(credit.valorLp(owner, address(token)), 500 ether);
    }

    function test_contract_cannot_register() public {
        RegistrarProxy proxy = new RegistrarProxy(credit);
        vm.expectRevert();
        proxy.registrar();
    }

    function test_stranger_cannot_repay_victim_loan() public {
        address stranger = makeAddr("stranger");
        _onboard(user);
        vm.prank(user, user);
        credit.solicitarPrestamo(address(token), 0);

        token.mint(stranger, 50 ether);
        vm.prank(stranger, stranger);
        token.approve(address(credit), type(uint256).max);
        vm.prank(stranger, stranger);
        vm.expectRevert();
        credit.pagarPrestamo(address(token), 1 ether);

        (, uint256 montoActivo,,,,) = credit.usuarios(user);
        assertGt(montoActivo, 0);
        _assertNav();
    }

    function testFuzz_nav_after_deposit(uint96 amount) public {
        amount = uint96(bound(amount, 1 ether, 1_000 ether));
        token.mint(owner, amount);
        vm.prank(owner, owner);
        credit.depositarLiquidez(address(token), amount);
        _assertNav();
    }

    function _onboard(address who) internal {
        vm.prank(who, who);
        credit.registrarHumanoConPadre(address(0));
        token.mint(who, 54 ether);
        vm.prank(who);
        token.approve(address(credit), type(uint256).max);
        vm.prank(who);
        token.approve(address(alta), type(uint256).max);
        vm.prank(who, who);
        alta.pagarRegistro();
    }

    function _assertNav() internal view {
        uint256 cash = token.balanceOf(address(credit));
        uint256 outstanding = credit.outstandingLoans(address(token));
        uint256 liquidity = credit.totalLiquidity(address(token));
        uint256 fees = credit.collectedFees(address(token));
        assertEq(cash + outstanding, liquidity + fees, "NAV broken");
    }
}

contract QuatriviumLevelingForgeTest is Test {
    function test_premio_asiento_matches_multiply_first() public {
        QuatriviumLeveling leveling = new QuatriviumLeveling();
        uint256 caja = 20_000 ether;
        uint256 budget = leveling.presupuestoPremioMensual(caja, caja);
        uint256 sumaPesos = 5050;
        uint256 firstSeat = leveling.premioAsiento(caja, caja, 1, 2, 1, sumaPesos);
        assertEq(firstSeat, (budget * 2 * 100) / (3 * sumaPesos));
        uint256 lastSeat = leveling.premioAsiento(caja, caja, 2, 2, 100, sumaPesos);
        assertEq(lastSeat, (budget * 1 * 1) / (3 * sumaPesos));
        assertGt(firstSeat, lastSeat);
    }

    function testFuzz_division_weight_sum_is_exact(uint8 nRaw) public pure {
        uint256 n = bound(nRaw, 1, 200);
        uint256 sumDiv = (n * (n + 1)) / 2;
        if (n % 2 == 0) {
            assertEq(sumDiv, (n / 2) * (n + 1));
        } else {
            assertEq(sumDiv, n * ((n + 1) / 2));
        }
    }
}

contract RegistrarProxy {
    QuatriviumCredit internal immutable credit;

    constructor(QuatriviumCredit credit_) {
        credit = credit_;
    }

    function registrar() external {
        credit.registrarHumanoConPadre(address(0));
    }
}
