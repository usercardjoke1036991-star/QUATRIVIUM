// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

interface ICreditAlta {
    function fundador() external view returns (address);
    function pagarVerificacion(address token_, uint256 amount) external;
    function verificadoAlPool(address) external view returns (uint256);
    function cobradorListo(address) external view returns (bool);
    function ingresarAlPool(address token_, uint256 amount) external;
}

interface IReservaAlta {
    function onAlta(uint256 monto) external;
}

/// @title QuatriviumAlta
/// @notice 4 LUSD (18 decimales) de una vez: 1 fundador + 1 Reserva + 1 padrino + 1 sello al pool.
///         Sin pausa ni attester.
contract QuatriviumAlta is ReentrancyGuard {
    using SafeERC20 for IERC20;

    IERC20 public immutable token;
    ICreditAlta public immutable credit;
    address public immutable reserva;
    mapping(address => uint256) public padrinoApartado;
    mapping(address => uint256) public padrinoExpira;
    mapping(address => bool) public registroHecho;
    /// @notice Mientras vence un padrino, el crédito anota el sello a este deudor y no a quien llama.
    address public cargoDe;
    uint256 public constant PLAZO_PADRINO = 7 days;

    error DestinoCero();
    error SoloEOA();
    error YaRegistro();
    error PadrinoVivo();
    error SinPadrino();
    error SinSello();

    event RegistroPagado(address indexed usuario);
    event PadrinoSoltado(address indexed referido, address indexed padre, uint256 monto);

    constructor(address token_, address credit_, address reserva_) {
        if (token_ == address(0) || credit_ == address(0) || reserva_ == address(0)) revert DestinoCero();
        token = IERC20(token_);
        credit = ICreditAlta(credit_);
        reserva = reserva_;
    }

    function pagarRegistro() external nonReentrant {
        if (tx.origin != msg.sender) revert SoloEOA();
        if (registroHecho[msg.sender] || padrinoApartado[msg.sender] != 0) revert YaRegistro();
        address fundador = credit.fundador();
        if (fundador == address(0)) revert DestinoCero();
        token.safeTransferFrom(msg.sender, address(this), 4e18);
        registroHecho[msg.sender] = true;
        padrinoApartado[msg.sender] = 1e18;
        padrinoExpira[msg.sender] = block.timestamp + PLAZO_PADRINO;
        token.safeTransfer(fundador, 1e18);
        token.safeTransfer(reserva, 1e18);
        IReservaAlta(reserva).onAlta(1e18);
        token.forceApprove(address(credit), 1e18);
        credit.pagarVerificacion(address(token), 1e18);
        emit RegistroPagado(msg.sender);
    }

    function soltarPadrino(address deudor, address padre) external returns (uint256) {
        if (msg.sender != address(credit)) revert DestinoCero();
        uint256 monto = padrinoApartado[deudor];
        if (monto == 0 || padre == address(0) || padre == deudor) return 0;
        padrinoApartado[deudor] = 0;
        padrinoExpira[deudor] = 0;
        if (!credit.cobradorListo(padre)) {
            token.forceApprove(address(credit), monto);
            credit.ingresarAlPool(address(token), monto);
            emit PadrinoSoltado(deudor, address(credit), monto);
            return 0;
        }
        token.safeTransfer(padre, monto);
        emit PadrinoSoltado(deudor, padre, monto);
        return monto;
    }

    /// @notice Si Ana no paga el primer L1 en 7 días, el 1 de Pedro pasa al pool.
    function vencerPadrinoAlPool(address deudor) external nonReentrant {
        if (deudor == address(0)) revert DestinoCero();
        uint256 monto = padrinoApartado[deudor];
        if (monto == 0) revert SinPadrino();
        if (block.timestamp < padrinoExpira[deudor]) revert PadrinoVivo();
        if (credit.verificadoAlPool(msg.sender) < 1e18) revert SinSello();
        padrinoApartado[deudor] = 0;
        padrinoExpira[deudor] = 0;
        cargoDe = deudor;
        token.forceApprove(address(credit), monto);
        credit.pagarVerificacion(address(token), monto);
        cargoDe = address(0);
        emit PadrinoSoltado(deudor, address(credit), monto);
    }
}
