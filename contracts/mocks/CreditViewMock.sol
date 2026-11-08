// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

contract CreditViewMock {
    mapping(address => address) public padreOf;
    mapping(address => bool) public esMoroso;
    mapping(address => uint256) public nivelOf;
    mapping(address => bool) public adminOf;
    bool public paused;
    address public attester;
    address public owner;
    IERC20 public payToken;

    function redGenealogica(address usuario) external view returns (address padre, bool bonoActivacionCobrado) {
        return (padreOf[usuario], false);
    }

    function obtenerProgresoUsuario(address usuario)
        external
        view
        returns (uint256 nivelActual, uint256 solicitudesCompletadas, uint256 ultimoPrestamoTimestamp)
    {
        uint256 n = nivelOf[usuario];
        if (n == 0) n = 1;
        return (n, 0, 0);
    }

    function admins(address cuenta) external view returns (bool) {
        return adminOf[cuenta];
    }

    function setPadre(address usuario, address padre) external {
        padreOf[usuario] = padre;
    }

    function setMora(address usuario, bool mora) external {
        esMoroso[usuario] = mora;
    }

    function setPaused(bool value) external {
        paused = value;
    }

    function setAttester(address next) external {
        attester = next;
    }

    function setNivel(address usuario, uint256 nivel) external {
        nivelOf[usuario] = nivel;
    }

    function setAdmin(address cuenta, bool value) external {
        adminOf[cuenta] = value;
    }

    function setOwner(address next) external {
        owner = next;
    }

    function setPayToken(address next) external {
        payToken = IERC20(next);
    }

    function pagarDesdePool(address to, uint256 amount) external {
        if (amount == 0 || to == address(0)) return;
        payToken.transfer(to, amount);
    }

    function triggerBoost(
        address reserva,
        address beneficiario,
        uint256 montoBase,
        bytes32 salt
    ) external {
        (bool ok, bytes memory ret) = reserva.call(
            abi.encodeWithSignature(
                "pagarBoostComision(address,uint256,bytes32)",
                beneficiario,
                montoBase,
                salt
            )
        );
        if (!ok) {
            assembly {
                revert(add(ret, 32), mload(ret))
            }
        }
    }
}
