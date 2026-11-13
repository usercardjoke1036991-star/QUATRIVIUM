// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

interface ICreditCaja {
    function pagarCanje(address token, address to, uint256 amount) external;
    function humanosVerificados(address) external view returns (bool);
    function dispersionCongelada(address usuario) external view returns (bool);
    function esMoroso(address) external view returns (bool);
    function redGenealogica(address)
        external
        view
        returns (address padre, bool bonoActivacionCobrado);
    function usuarios(address)
        external
        view
        returns (
            uint256 nivelActual,
            uint256 montoActivo,
            uint256 vencimiento,
            bool enMora,
            address monedaActivo,
            uint256 tasaAplicadaBP
        );

    function planPago(address)
        external
        view
        returns (uint128 pagado, uint64 venceCuota, uint8 totales, uint8 pagadas, bool enPlazo);
    function prestamosCerrados(address) external view returns (uint256);
    function fundador() external view returns (address);
    function cobradorListo(address) external view returns (bool);
    function cierreNivel(address) external view returns (uint256);
    function cierreATiempo(address) external view returns (bool);
}

/**
 * @title QuatriviumFamaCaja
 * @notice Hermano del crédito: fama de caja, canje y racha diaria.
 *         100 fama por cada USDT donado o aportado, desde el primero. El alta de 4 no pasa por donar.
 *         Fama de red: generaciones 2–40 y recorte del fundador, misma escala que el dinero.
 *         Canje: 250 fama disponible = 1 USDT. El perfil de fama no baja.
 *         Racha: un referido que pide y paga suma un día; 1 día de gracia;
 *         la fama de racha no se pierde; el ranking sí puede bajar.
 *         EIP-170: no vive en QuatriviumCredit.
 */
contract QuatriviumFamaCaja is ReentrancyGuard {
    uint256 public constant FAMA_POR_USDT = 100;
    uint256 public constant FAMA_POR_REFERIDO_L1 = 100;
    uint256 public constant FAMA_CANJE_POR_USDT = 250;
    uint256 public constant FAMA_POR_DIA_RACHA = 100;
    uint256 public constant RACHA_GRACIA_DIAS = 1;
    uint256 public constant RACHA_HITO_7 = 7;
    uint256 public constant RACHA_HITO_30 = 30;
    uint256 public constant RACHA_HITO_100 = 100;
    uint256 public constant RACHA_HITO_365 = 365;
    uint256 public constant BONO_RACHA_7 = 5e18;
    uint256 public constant BONO_RACHA_30 = 25e18;
    uint256 public constant BONO_RACHA_100 = 100e18;
    uint256 public constant BONO_RACHA_365 = 500e18;

    address public immutable credit;
    address public immutable token;
    address public immutable alta;
    address public immutable reserva;

    mapping(address => uint256) public famaCaja;
    /// @notice Fama de donar o aportar. Se ve en el perfil y no se canjea.
    mapping(address => uint256) public famaVisible;
    mapping(address => uint256) public famaRed;
    mapping(address => uint256) public famaRacha;
    mapping(address => uint256) public famaCanjeada;
    mapping(address => uint256) public famaRedCanjeada;

    struct Racha {
        uint32 dias;
        uint32 diasMax;
        uint32 ultimoDia;
        uint32 decayTaken;
        uint32 famaDias;
        uint32 hitoCobrado;
    }
    mapping(address => Racha) public racha;
    mapping(address => uint256) public cierreContado;

    error SoloCredit();
    error SoloEOA();
    error DestinoCero();
    error NoHumano();
    error FamaInvalida();
    error SinFama();
    error SinBonoRacha();
    error SinCierre();
    error SoloReserva();

    event FamaAcreditada(address indexed usuario, uint256 pts);
    event FamaCanjeada(address indexed usuario, uint256 fama, uint256 monto, address indexed token);
    event FamaBorrada(address indexed usuario);
    event RachaDiaSumado(address indexed padrino, uint32 dias, uint32 famaDias, uint32 dia);
    event BonoRachaPagado(address indexed usuario, uint32 hito, uint256 monto, address indexed token);

    constructor(address token_, address credit_, address alta_, address reserva_) {
        if (token_ == address(0) || credit_ == address(0) || alta_ == address(0) || reserva_ == address(0)) {
            revert DestinoCero();
        }
        token = token_;
        credit = credit_;
        alta = alta_;
        reserva = reserva_;
    }

    modifier onlyCredit() {
        if (msg.sender != credit) revert SoloCredit();
        _;
    }

    function famaDisponible(address usuario) public view returns (uint256) {
        uint256 ganada = famaCaja[usuario];
        uint256 cobrada = famaCanjeada[usuario];
        return ganada > cobrada ? ganada - cobrada : 0;
    }

    function famaRedEstado(address usuario) external view returns (uint256 ganada, uint256 cobrada) {
        ganada = famaRed[usuario];
        cobrada = famaRedCanjeada[usuario];
    }

    function famaRedDisponible(address usuario) public view returns (uint256) {
        uint256 ganada = famaRed[usuario];
        uint256 cobrada = famaRedCanjeada[usuario];
        return ganada > cobrada ? ganada - cobrada : 0;
    }

    function famaPerfil(address usuario) public view returns (uint256) {
        return famaCaja[usuario] + famaVisible[usuario] + famaRed[usuario] + famaRacha[usuario];
    }

    function pagarDesdePool(address to, uint256 amount) external {
        if (msg.sender != reserva) revert SoloReserva();
        if (to == address(0) || amount == 0) revert DestinoCero();
        ICreditCaja(credit).pagarCanje(token, to, amount);
    }

    function acreditar(address who, uint256 pts) external onlyCredit {
        if (who == address(0) || pts == 0) return;
        famaCaja[who] += pts;
        emit FamaAcreditada(who, pts);
    }

    /// @notice Reputación de donar o aportar. No entra en famaDisponible.
    function acreditarVisible(address who, uint256 pts) external onlyCredit {
        if (who == address(0) || pts == 0) return;
        famaVisible[who] += pts;
        emit FamaAcreditada(who, pts);
    }

    function famaPorGeneracion(uint8 gen) public pure returns (uint256) {
        if (gen <= 1) return 0;
        uint256 bp = gen == 2 ? 800 : gen == 3 ? 600 : gen == 4 ? 400 : gen == 5 ? 200 : gen <= 12 ? 80 : 40;
        return (FAMA_POR_REFERIDO_L1 * bp) / 1500;
    }

    function acreditarFamaRed(address deudor) external onlyCredit {
        if (deudor == address(0)) return;
        ICreditCaja nucleo = ICreditCaja(credit);
        // slither-disable-next-line unused-return // redGenealogica devuelve el bono y aqui no se cobra
        (address padre,) = nucleo.redGenealogica(deudor);
        address fund = nucleo.fundador();
        address cursor = padre;
        for (uint8 gen = 1; gen <= 40; gen++) {
            if (cursor == address(0) || cursor == deudor) break;
            uint256 pts = famaPorGeneracion(gen);
            if (pts > 0 && !nucleo.dispersionCongelada(cursor)) {
                famaRed[cursor] += pts;
                emit FamaAcreditada(cursor, pts);
            }
            // slither-disable-next-line unused-return // solo se sigue el padre, el bono no entra en el bucle
            (cursor,) = nucleo.redGenealogica(cursor);
        }
        if (fund != address(0) && fund != deudor && fund != padre) {
            if (!nucleo.dispersionCongelada(fund)) {
                famaRed[fund] += FAMA_POR_REFERIDO_L1;
                emit FamaAcreditada(fund, FAMA_POR_REFERIDO_L1);
            }
        }
    }

    function wipe(address who) external onlyCredit {
        famaCaja[who] = 0;
        famaVisible[who] = 0;
        famaRed[who] = 0;
        famaRacha[who] = 0;
        famaCanjeada[who] = 0;
        famaRedCanjeada[who] = 0;
        delete racha[who];
        emit FamaBorrada(who);
    }

    function diaActual() public view returns (uint32) {
        return uint32(block.timestamp / 1 days);
    }

    function siguienteHitoRacha(uint256 cobrado) public pure returns (uint256) {
        // slither-disable-next-line incorrect-equality // el hito es un identificador, no un saldo
        if (cobrado == 0) return RACHA_HITO_7;
        // slither-disable-next-line incorrect-equality // el hito es un identificador, no un saldo
        if (cobrado == RACHA_HITO_7) return RACHA_HITO_30;
        // slither-disable-next-line incorrect-equality // el hito es un identificador, no un saldo
        if (cobrado == RACHA_HITO_30) return RACHA_HITO_100;
        // slither-disable-next-line incorrect-equality // el hito es un identificador, no un saldo
        if (cobrado == RACHA_HITO_100) return RACHA_HITO_365;
        return 0;
    }

    function bonoDeHitoRacha(uint256 hito) public pure returns (uint256) {
        if (hito == RACHA_HITO_7) return BONO_RACHA_7;
        if (hito == RACHA_HITO_30) return BONO_RACHA_30;
        if (hito == RACHA_HITO_100) return BONO_RACHA_100;
        if (hito == RACHA_HITO_365) return BONO_RACHA_365;
        return 0;
    }

    function diasRacha(address usuario) public view returns (uint32) {
        return _diasTrasDecay(racha[usuario], diaActual());
    }

    function obtenerRacha(address usuario)
        external
        view
        returns (
            uint32 dias,
            uint32 diasMax,
            uint32 ultimoDia,
            uint32 famaDias,
            uint32 hitoCobrado,
            uint256 siguienteHito,
            uint256 bonoPendiente,
            bool graciaVigente
        )
    {
        Racha memory r = racha[usuario];
        uint32 today = diaActual();
        dias = _diasTrasDecay(r, today);
        diasMax = r.diasMax;
        ultimoDia = r.ultimoDia;
        famaDias = r.famaDias;
        hitoCobrado = r.hitoCobrado;
        siguienteHito = siguienteHitoRacha(hitoCobrado);
        if (siguienteHito != 0 && dias >= siguienteHito) {
            bonoPendiente = bonoDeHitoRacha(siguienteHito);
        }
        graciaVigente = r.dias != 0 && r.ultimoDia != 0 && today <= r.ultimoDia + 1 + uint32(RACHA_GRACIA_DIAS);
    }

    function onCierrePrestamo(address deudor, address padre) external onlyCredit {
        if (padre == address(0) || deudor == address(0) || padre == deudor) return;
        ICreditCaja nucleo = ICreditCaja(credit);
        // slither-disable-next-line unused-return // solo se comprueba que el padre coincida
        (address padreOnChain,) = nucleo.redGenealogica(deudor);
        if (padreOnChain != padre) return;
        _contarCierre(deudor, padre, nucleo);
    }

    /// @notice El referido o el padrino anotan el cierre. Credit no cabe un gancho (EIP-170).
    function notificarRacha(address hijo) external {
        if (tx.origin != msg.sender) revert SoloEOA();
        if (hijo == address(0)) revert DestinoCero();
        ICreditCaja nucleo = ICreditCaja(credit);
        // slither-disable-next-line unused-return // solo hace falta la direccion del padre
        (address padre,) = nucleo.redGenealogica(hijo);
        if (padre == address(0) || padre == hijo) revert SinCierre();
        if (msg.sender != hijo && msg.sender != padre) revert SoloEOA();
        if (!_contarCierre(hijo, padre, nucleo)) revert SinCierre();
    }

    function cobrarBonoRacha() external nonReentrant {
        if (tx.origin != msg.sender) revert SoloEOA();
        ICreditCaja nucleo = ICreditCaja(credit);
        // slither-disable-next-line unused-return // de usuarios solo importan el monto, el vencimiento y la mora
        (, uint256 montoActivo, uint256 vencimiento, bool enMora,,) = nucleo.usuarios(msg.sender);
        bool vencido = montoActivo > 0 && vencimiento > 0 && block.timestamp > vencimiento;
        if (
            !nucleo.cobradorListo(msg.sender)
                || nucleo.dispersionCongelada(msg.sender)
                || nucleo.esMoroso(msg.sender)
                || enMora
                || vencido
        ) revert NoHumano();

        uint32 vis = _persistDecay(msg.sender);
        uint256 next = siguienteHitoRacha(racha[msg.sender].hitoCobrado);
        if (next == 0 || vis < next) revert SinBonoRacha();
        uint256 total = bonoDeHitoRacha(next);
        racha[msg.sender].hitoCobrado = uint32(next);
        nucleo.pagarCanje(token, msg.sender, total);
        emit BonoRachaPagado(msg.sender, uint32(next), total, token);
    }

    function canjearFamaRed(uint256 fama) external nonReentrant {
        if (tx.origin != msg.sender) revert SoloEOA();
        ICreditCaja nucleo = ICreditCaja(credit);
        // slither-disable-next-line unused-return // de usuarios solo importan el monto, el vencimiento y la mora
        (, uint256 montoActivo, uint256 vencimiento, bool enMora,,) = nucleo.usuarios(msg.sender);
        bool vencido = montoActivo > 0 && vencimiento > 0 && block.timestamp > vencimiento;
        if (
            !nucleo.cobradorListo(msg.sender)
                || nucleo.dispersionCongelada(msg.sender)
                || nucleo.esMoroso(msg.sender)
                || enMora
                || vencido
        ) revert NoHumano();
        if (fama < FAMA_CANJE_POR_USDT || fama % FAMA_CANJE_POR_USDT != 0) revert FamaInvalida();
        if (fama > famaRedDisponible(msg.sender)) revert SinFama();
        uint256 pago = (fama * 1e18) / FAMA_CANJE_POR_USDT;
        famaRedCanjeada[msg.sender] += fama;
        nucleo.pagarCanje(token, msg.sender, pago);
        emit FamaCanjeada(msg.sender, fama, pago, token);
    }

    function canjearFama(uint256 fama) external nonReentrant {
        if (tx.origin != msg.sender) revert SoloEOA();
        ICreditCaja nucleo = ICreditCaja(credit);
        // slither-disable-next-line unused-return // de usuarios solo importan el monto, el vencimiento y la mora
        (, uint256 montoActivo, uint256 vencimiento, bool enMora,,) = nucleo.usuarios(msg.sender);
        bool vencido = montoActivo > 0 && vencimiento > 0 && block.timestamp > vencimiento;
        if (
            !nucleo.cobradorListo(msg.sender)
                || nucleo.dispersionCongelada(msg.sender)
                || nucleo.esMoroso(msg.sender)
                || enMora
                || vencido
        ) revert NoHumano();
        if (fama < FAMA_CANJE_POR_USDT || fama % FAMA_CANJE_POR_USDT != 0) revert FamaInvalida();
        if (fama > famaDisponible(msg.sender)) revert SinFama();
        uint256 pago = (fama * 1e18) / FAMA_CANJE_POR_USDT;
        famaCanjeada[msg.sender] += fama;
        nucleo.pagarCanje(token, msg.sender, pago);
        emit FamaCanjeada(msg.sender, fama, pago, token);
    }

    function _contarCierre(address hijo, address padre, ICreditCaja nucleo) internal returns (bool) {
        // slither-disable-next-line unused-return // del cierre solo importa si el hijo sigue con monto activo
        (, uint256 montoActivo,,,,) = nucleo.usuarios(hijo);
        uint256 cerrados = nucleo.prestamosCerrados(hijo);
        if (montoActivo != 0 || cerrados == 0 || cerrados <= cierreContado[hijo]) return false;
        cierreContado[hijo] = cerrados;
        // Antes un L1 pagado sumaba día. Ahora solo nivel >= 2 y a tiempo.
        if (nucleo.cierreNivel(hijo) < 2 || !nucleo.cierreATiempo(hijo)) return false;
        _sumarDia(padre);
        return true;
    }

    function _persistDecay(address who) internal returns (uint32 vis) {
        Racha storage r = racha[who];
        uint32 today = diaActual();
        vis = _diasTrasDecay(r, today);
        // slither-disable-next-line incorrect-equality // compara el contador de dias ya guardado con el visible
        if (r.dias == vis) return vis;
        r.dias = vis;
        if (r.ultimoDia != 0 && today > r.ultimoDia + 2) {
            r.decayTaken = today - (r.ultimoDia + 2);
        }
    }

    function _diasTrasDecay(Racha memory r, uint32 today) internal pure returns (uint32) {
        uint32 dias = r.dias;
        // slither-disable-next-line incorrect-equality // cero es "sin racha", no un balance de token
        if (dias == 0 || r.ultimoDia == 0 || today <= r.ultimoDia + 2) return dias;
        uint32 decay = today - (r.ultimoDia + 2);
        if (decay <= r.decayTaken) return dias;
        uint32 extra = decay - r.decayTaken;
        return extra >= dias ? 0 : dias - extra;
    }

    function _sumarDia(address padre) internal {
        uint32 today = diaActual();
        Racha storage r = racha[padre];
        // slither-disable-next-line incorrect-equality // el mismo dia civil no suma otra vez
        if (r.ultimoDia == today) return;
        uint32 vis = _diasTrasDecay(r, today);
        r.dias = vis + 1;
        if (r.dias > r.diasMax) r.diasMax = r.dias;
        r.ultimoDia = today;
        r.decayTaken = 0;
        r.famaDias += 1;
        famaRacha[padre] += FAMA_POR_DIA_RACHA;
        emit FamaAcreditada(padre, FAMA_POR_DIA_RACHA);
        emit RachaDiaSumado(padre, r.dias, r.famaDias, today);
    }
}
