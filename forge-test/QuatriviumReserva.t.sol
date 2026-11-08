// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {QuatriviumReserva} from "../contracts/QuatriviumReserva.sol";
import {ERC20Mock} from "../contracts/mocks/ERC20Mock.sol";
import {CreditViewMock} from "../contracts/mocks/CreditViewMock.sol";

contract ReservaHandler is Test {
    QuatriviumReserva public reserva;
    ERC20Mock public token;
    address public founder;
    uint256 public ghostLocked;
    address[] public actors;

    constructor(QuatriviumReserva reserva_, ERC20Mock token_, address founder_, CreditViewMock credit_) {
        reserva = reserva_;
        token = token_;
        founder = founder_;
        actors.push(makeAddr("reserva-a1"));
        actors.push(makeAddr("reserva-a2"));
        actors.push(makeAddr("reserva-a3"));
        credit_.setAdmin(founder, true);
        for (uint256 i; i < actors.length; ++i) {
            credit_.setNivel(actors[i], 10);
            token.mint(actors[i], 10_000 ether);
            vm.prank(actors[i], actors[i]);
            token.approve(address(reserva), type(uint256).max);
        }
        token.mint(founder, 10_000 ether);
        vm.prank(founder, founder);
        token.approve(address(reserva), type(uint256).max);
    }

    function bloquear(uint256 actorSeed, uint96 amount) public {
        address actor = actors[actorSeed % actors.length];
        (, , bool activa,) = reserva.posiciones(actor);
        if (activa) return;
        amount = uint96(bound(amount, 1 ether, 200 ether));
        vm.prank(actor, actor);
        reserva.bloquear(amount);
        ghostLocked += amount;
    }

    function aportar(uint96 amount) public {
        amount = uint96(bound(amount, 1 ether, 50 ether));
        vm.prank(founder, founder);
        reserva.aportarBote(amount);
    }

    function desbloquear(uint256 actorSeed) public {
        address actor = actors[actorSeed % actors.length];
        (uint256 principal, uint256 desde, bool activa,) = reserva.posiciones(actor);
        if (!activa) return;
        if (block.timestamp < desde + 30 days) {
            vm.warp(desde + 30 days + 1);
        }
        vm.prank(actor, actor);
        reserva.desbloquear();
        ghostLocked -= principal;
    }
}

contract QuatriviumReservaForgeTest is Test {
    ReservaHandler internal handler;
    QuatriviumReserva internal reserva;
    ERC20Mock internal token;

    function setUp() public {
        token = new ERC20Mock();
        CreditViewMock credit = new CreditViewMock();
        address founder = makeAddr("reserva-founder");
        reserva = new QuatriviumReserva(address(token), founder, address(credit), address(credit), address(1));
        handler = new ReservaHandler(reserva, token, founder, credit);
        targetContract(address(handler));
    }

    function invariant_tokenBalanceMatchesLockedPlusPot() public view {
        assertEq(token.balanceOf(address(reserva)), handler.ghostLocked() + reserva.bote());
    }

    function test_techo_never_exceeds_period_cap() public view {
        uint256 principal = 100 ether;
        uint256 techo = reserva.techoRendimiento(principal, 30 days);
        assertLe(techo, (principal * 1200 * 30 days) / (10000 * 365 days));
    }

    function test_boost_comision_pays_user_and_founder() public {
        address locker = makeAddr("reserva-locker");
        address founder = makeAddr("reserva-founder-pay");
        CreditViewMock credit = new CreditViewMock();
        QuatriviumReserva local = new QuatriviumReserva(address(token), founder, address(credit), address(credit), address(1));
        credit.setNivel(locker, 10);
        credit.setPayToken(address(token));
        token.mint(address(credit), 50 ether);
        token.mint(address(this), 200 ether);
        token.mint(locker, 200 ether);
        token.approve(address(local), type(uint256).max);
        vm.prank(locker, locker);
        token.approve(address(local), type(uint256).max);
        vm.prank(address(this), address(this));
        local.aportarBote(20 ether);
        vm.prank(locker, locker);
        local.bloquear(100 ether);
        bytes32 id = keccak256("comision-1");
        require(id != bytes32(0), "salt");
        (uint256 extra, uint256 founderCut) = local.extraComisionDe(locker, 5 ether);
        uint256 userBefore = token.balanceOf(locker);
        uint256 founderBefore = token.balanceOf(founder);
        uint256 poolBefore = token.balanceOf(address(credit));
        credit.triggerBoost(address(local), locker, 5 ether, id);
        assertEq(token.balanceOf(locker) - userBefore, extra - founderCut);
        assertEq(token.balanceOf(founder) - founderBefore, founderCut);
        assertEq(poolBefore - token.balanceOf(address(credit)), extra);
        assertEq(token.balanceOf(address(local)), 100 ether + 20 ether);
    }
}
