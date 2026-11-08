// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {QuatriviumCreditHarness} from "../contracts/test/QuatriviumCreditHarness.sol";
import {QuatriviumFamaCaja} from "../contracts/QuatriviumFamaCaja.sol";
import {QuatriviumReserva} from "../contracts/QuatriviumReserva.sol";
import {QuatriviumAlta} from "../contracts/QuatriviumAlta.sol";
import {ERC20Mock} from "../contracts/mocks/ERC20Mock.sol";
import {MockV3Aggregator} from "../contracts/mocks/MockV3Aggregator.sol";

/// @dev Mezcla depósito, crédito, donar, Alta y Reserva. No se despliega.
contract QuatriviumMoneyHandler is Test {
    QuatriviumCreditHarness public credit;
    QuatriviumReserva public reserva;
    QuatriviumAlta public alta;
    ERC20Mock public token;
    address public owner;
    uint256 public ownerPk;
    address[] public actors;

    constructor(
        QuatriviumCreditHarness credit_,
        QuatriviumReserva reserva_,
        QuatriviumAlta alta_,
        ERC20Mock token_,
        address owner_,
        uint256 ownerPk_
    ) {
        credit = credit_;
        reserva = reserva_;
        alta = alta_;
        token = token_;
        owner = owner_;
        ownerPk = ownerPk_;
        actors.push(makeAddr("inv-a"));
        actors.push(makeAddr("inv-b"));
        actors.push(makeAddr("inv-c"));
        for (uint256 i; i < actors.length; ++i) {
            _ready(actors[i]);
        }
    }

    function deposit(uint96 amount) public {
        amount = uint96(bound(amount, 1 ether, 200 ether));
        token.mint(owner, amount);
        vm.prank(owner, owner);
        credit.depositarLiquidez(address(token), amount);
    }

    function donate(uint256 actorSeed, uint96 amount) public {
        address actor = _actor(actorSeed);
        amount = uint96(bound(amount, 1, 20 ether));
        vm.prank(actor, actor);
        try credit.donar(address(token), amount) {} catch {}
    }

    function verifyStamp(uint256 actorSeed) public {
        address actor = _actor(actorSeed);
        vm.prank(actor, actor);
        try credit.pagarVerificacion(address(token), 1 ether) {} catch {}
    }

    function altaRegistro(uint256 actorSeed) public {
        address actor = _actor(actorSeed);
        vm.prank(actor, actor);
        try alta.pagarRegistro() {} catch {}
    }

    function borrow(uint256 actorSeed, bool small) public {
        address actor = _actor(actorSeed);
        (, uint256 activo,,,,) = credit.usuarios(actor);
        if (activo > 0) return;
        (,, uint256 lastTs) = credit.obtenerProgresoUsuario(actor);
        if (lastTs != 0 && block.timestamp < lastTs + 48 hours) {
            vm.warp(lastTs + 48 hours + 1);
        }
        uint256 nivel = small ? 1 : 0;
        vm.prank(actor, actor);
        try alta.pagarRegistro() {} catch {}
        vm.prank(actor, actor);
        try credit.solicitarPrestamo(address(token), nivel) {} catch {}
    }

    function repay(uint256 actorSeed) public {
        address actor = _actor(actorSeed);
        (,, uint256 total,) = credit.obtenerDeuda(actor);
        if (total == 0) return;
        vm.prank(actor, actor);
        try credit.pagarPrestamo(address(token), total) {} catch {}
    }

    function reservaAportar(uint96 amount) public {
        amount = uint96(bound(amount, 1 ether, 50 ether));
        token.mint(owner, amount);
        vm.prank(owner, owner);
        reserva.aportarBote(amount);
    }

    function reservaBloquear(uint256 actorSeed, uint96 amount) public {
        address actor = _actor(actorSeed);
        (,, bool activa,) = reserva.posiciones(actor);
        if (activa) return;
        amount = uint96(bound(amount, 1 ether, 80 ether));
        vm.prank(actor, actor);
        try reserva.bloquear(amount) {} catch {}
    }

    function reservaDesbloquear(uint256 actorSeed) public {
        address actor = _actor(actorSeed);
        (, uint256 desde, bool activa,) = reserva.posiciones(actor);
        if (!activa) return;
        if (block.timestamp < desde + 30 days) {
            vm.warp(desde + 30 days + 1);
        }
        vm.prank(actor, actor);
        try reserva.desbloquear() {} catch {}
    }

    function _actor(uint256 seed) internal view returns (address) {
        return actors[seed % actors.length];
    }

    function _ready(address who) internal {
        vm.prank(who, who);
        credit.registrarHumanoConPadre(address(0));
        token.mint(who, 10_000 ether);
        vm.prank(who);
        token.approve(address(credit), type(uint256).max);
        vm.prank(who);
        token.approve(address(alta), type(uint256).max);
        vm.prank(who);
        token.approve(address(reserva), type(uint256).max);
        credit.forceNivel(who, 10);
    }
}

contract QuatriviumInvariantTest is Test {
    QuatriviumMoneyHandler internal handler;
    QuatriviumCreditHarness internal credit;
    QuatriviumReserva internal reserva;
    ERC20Mock internal token;

    function setUp() public {
        vm.warp(1_704_000_000);
        uint256 ownerPk = 0xA11CE;
        address owner = vm.addr(ownerPk);
        token = new ERC20Mock();
        MockV3Aggregator feed = new MockV3Aggregator(8, 100000000);
        address[] memory admins = new address[](1);
        admins[0] = owner;
        uint64 nonce = vm.getNonce(owner);
        address predictedCredit = vm.computeCreateAddress(owner, nonce + 1);
        address predictedReserva = vm.computeCreateAddress(owner, nonce + 2);
        address predictedAlta = vm.computeCreateAddress(owner, nonce + 3);

        vm.startPrank(owner, owner);
        QuatriviumFamaCaja fama = new QuatriviumFamaCaja(address(token), predictedCredit, predictedAlta, predictedReserva);
        credit = new QuatriviumCreditHarness(
            address(token),
            payable(owner),
            500,
            admins,
            1,
            address(fama)
        );
        require(address(credit) == predictedCredit, "credit pred");
        reserva = new QuatriviumReserva(address(token), owner, address(credit), address(fama), predictedAlta);
        QuatriviumAlta alta = new QuatriviumAlta(address(token), address(credit), address(reserva));
        token.mint(owner, 20_000 ether);
        token.approve(address(credit), type(uint256).max);
        token.approve(address(reserva), type(uint256).max);
        credit.depositarLiquidez(address(token), 8_000 ether);
        vm.stopPrank();

        handler = new QuatriviumMoneyHandler(credit, reserva, alta, token, owner, ownerPk);

        bytes4[] memory selectors = new bytes4[](9);
        selectors[0] = QuatriviumMoneyHandler.deposit.selector;
        selectors[1] = QuatriviumMoneyHandler.donate.selector;
        selectors[2] = QuatriviumMoneyHandler.verifyStamp.selector;
        selectors[3] = QuatriviumMoneyHandler.altaRegistro.selector;
        selectors[4] = QuatriviumMoneyHandler.borrow.selector;
        selectors[5] = QuatriviumMoneyHandler.repay.selector;
        selectors[6] = QuatriviumMoneyHandler.reservaAportar.selector;
        selectors[7] = QuatriviumMoneyHandler.reservaBloquear.selector;
        selectors[8] = QuatriviumMoneyHandler.reservaDesbloquear.selector;
        targetSelector(FuzzSelector({addr: address(handler), selectors: selectors}));
        targetContract(address(handler));
    }

    /// @notice Caja + prestado == liquidez + comisiones. El USDT del núcleo no se inventa ni desaparece.
    function invariant_creditNav() public view {
        uint256 cash = token.balanceOf(address(credit));
        uint256 outstanding = credit.outstandingLoans(address(token));
        uint256 liquidity = credit.totalLiquidity(address(token));
        uint256 fees = credit.collectedFees(address(token));
        assertEq(cash + outstanding, liquidity + fees, "NAV Credit");
    }

    /// @notice Reserva es otra caja: saldo == bote + lo bloqueado. No es el pool de préstamos.
    function invariant_reservaCaja() public view {
        assertEq(
            token.balanceOf(address(reserva)),
            reserva.bote() + reserva.totalBloqueado(),
            "caja Reserva"
        );
    }

    function test_invariants_hold_at_setup() public view {
        invariant_creditNav();
        invariant_reservaCaja();
    }
}
