// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IQuatriviumFamaCaja} from "../interfaces/IQuatriviumFamaCaja.sol";
import {Usuario} from "./Usuario.sol";

interface ICreditDisp {
    function dispersionCongelada(address usuario) external view returns (bool);
    function cobradorListo(address who) external view returns (bool);
}

/**
 * @title QuatriviumFamaLib
 * @notice Ganchos de fama. LUSD vale 1 USD fijo: no hay feed externo.
 *         QUATRIVIUM soberano: sin lista negra, sin attester y sin pausa. El boost de
 *         Reserva se anota on-chain al pagar cada comisión (ver `_avisarReserva`).
 */
library QuatriviumFamaLib {
    using SafeERC20 for IERC20;

    uint256 internal constant BONO_ACTIVACION = 1e18;
    uint256 internal constant POOL_FLOOR_BP = 4000;
    uint256 internal constant FUNDADOR_BP = 1500;
    uint256 internal constant PISO_CAJA_BP = 2000;
    uint256 internal constant SEGURO_BP = 500;
    uint8 internal constant MAX_LINEA = 40;
    uint256 internal constant CARRIL_REF_BP = 1000;
    uint256 internal constant CARRIL_CHICO_PISO = 50e18;
    uint256 internal constant UTIL_GRANDE_NUM = 7000;
    uint256 internal constant UTIL_GRANDE_DEN = 8000;

    /// @notice Chico si el préstamo no pasa de max(50 USDT, 0,5 % de caja general).
    function umbralCarrilChico(uint256 caja) public pure returns (uint256 u) {
        u = (caja * CARRIL_REF_BP) / 200000;
        if (u < CARRIL_CHICO_PISO) u = CARRIL_CHICO_PISO;
    }

    function esCarrilChico(uint256 caja, uint256 monto) public pure returns (bool) {
        return monto > 0 && monto <= umbralCarrilChico(caja);
    }

    function liqGeneral(uint256 totalLiq, uint256 reservado) public pure returns (uint256) {
        return totalLiq > reservado ? totalLiq - reservado : 0;
    }

    /// @notice Hitos cada 100 hasta 1000: ~mitad del interés de ese préstamo (no 30 000 fijos).
    function bonoDeHito(uint256 hito) external pure returns (uint256) {
        if (hito == 100) return 400e18;
        if (hito == 200) return 4000e18;
        if (hito == 300) return 7000e18;
        if (hito == 400) return 8500e18;
        if (hito == 500) return 9000e18;
        if (hito == 600) return 11500e18;
        if (hito == 700) return 13500e18;
        if (hito == 800) return 16000e18;
        if (hito == 900) return 18000e18;
        if (hito == 1000) return 20000e18;
        return 0;
    }

    /// @notice Los grandes paran al 70 % si el tope global es 80 % (misma proporción si el admin mueve el 80 %).
    function topeUtilGrande(uint256 utilMaxBps) public pure returns (uint256) {
        return (utilMaxBps * UTIL_GRANDE_NUM) / UTIL_GRANDE_DEN;
    }

    function tasaCurva(
        uint256 utilBP,
        uint256 baseBP,
        uint256 optimoBP,
        uint256 pendiente1,
        uint256 pendiente2
    ) public pure returns (uint256) {
        if (utilBP < 1) return baseBP;
        if (utilBP <= optimoBP) {
            if (optimoBP < 1) return baseBP;
            return baseBP + (pendiente1 * utilBP) / optimoBP;
        }
        uint256 extraBP = utilBP - optimoBP;
        uint256 denom = 10000 - optimoBP;
        if (denom < 1) return baseBP + pendiente1 + pendiente2;
        return baseBP + pendiente1 + (pendiente2 * extraBP) / denom;
    }

    function usaSelloPrimera(
        uint256 reserved,
        uint256 expira,
        uint256 ts,
        uint256 monto,
        uint256 nivel,
        bool nuncaPidio
    ) public pure returns (bool) {
        return nuncaPidio && nivel == 1 && monto == BONO_ACTIVACION && reserved >= BONO_ACTIVACION && ts <= expira;
    }

    function requireAcceso(
        uint256 totalLiq,
        uint256 reservado,
        uint256 outstanding,
        uint256 monto,
        uint256 utilMaxBps,
        bool esChico
    ) internal pure {
        require(monto > 0);
        uint256 base = liqGeneral(totalLiq, reservado);
        require(base >= outstanding + monto, "insufficient liquidity");
        uint256 utilAfter = ((outstanding + monto) * 10000) / base;
        if (!esChico) {
            require(utilAfter <= topeUtilGrande(utilMaxBps), "insufficient liquidity");
        }
        require(utilAfter <= utilMaxBps, "utilization cap");
    }

    function liberarSelloSiExpiro(
        mapping(address => uint256) storage reservaPrimera,
        mapping(address => uint256) storage reservaPrimeraExpira,
        mapping(address => address) storage reservaPrimeraToken,
        mapping(address => uint256) storage totalReservadoPrimera,
        address tokenHint,
        address user
    ) external {
        uint256 r = reservaPrimera[user];
        if (r == 0 || block.timestamp <= reservaPrimeraExpira[user]) return;
        address tkn = reservaPrimeraToken[user];
        if (tkn == address(0)) tkn = tokenHint;
        reservaPrimera[user] = 0;
        reservaPrimeraExpira[user] = 0;
        reservaPrimeraToken[user] = address(0);
        uint256 tot = totalReservadoPrimera[tkn];
        totalReservadoPrimera[tkn] = tot > r ? tot - r : 0;
    }

    function pagarActivacion(
        mapping(address => uint256) storage totalLiquidity,
        mapping(address => uint256) storage reputacion,
        IERC20 token,
        address tokenAddr,
        address padre,
        address deudor,
        bool padreOk,
        uint256 caja,
        uint256 piso,
        address hermano
    ) public returns (uint256 bono) {
        if (hermano != address(0) && padreOk && padre != address(0) && padre != deudor) {
            (bool okA, bytes memory rawA) = hermano.staticcall(abi.encodeWithSignature("alta()"));
            if (okA && rawA.length >= 32) {
                address alta = abi.decode(rawA, (address));
                if (alta != address(0)) {
                    (bool ok, bytes memory data) = alta.call(
                        abi.encodeWithSignature("soltarPadrino(address,address)", deudor, padre)
                    );
                    if (ok && data.length >= 32) {
                        bono = abi.decode(data, (uint256));
                        if (bono > 0) return bono;
                    }
                    return 0;
                }
            }
        }
        return pagarBonoPool(
            totalLiquidity,
            reputacion,
            token,
            tokenAddr,
            padre,
            deudor,
            padreOk,
            caja,
            piso,
            hermano
        );
    }

    function sellarPrimera(
        mapping(address => uint256) storage reservaPrimera,
        mapping(address => uint256) storage reservaPrimeraExpira,
        mapping(address => address) storage reservaPrimeraToken,
        mapping(address => uint256) storage totalReservadoPrimera,
        uint256 yaPidioTimestamp,
        address token,
        address user,
        uint256 selloDuracion
    ) public {
        if (yaPidioTimestamp != 0) return;
        uint256 r = reservaPrimera[user];
        if (r != 0 && block.timestamp <= reservaPrimeraExpira[user]) return;
        if (r != 0) {
            address tknOld = reservaPrimeraToken[user];
            if (tknOld == address(0)) tknOld = token;
            uint256 totOld = totalReservadoPrimera[tknOld];
            totalReservadoPrimera[tknOld] = totOld > r ? totOld - r : 0;
            reservaPrimera[user] = 0;
            reservaPrimeraExpira[user] = 0;
            reservaPrimeraToken[user] = address(0);
        }
        reservaPrimera[user] = BONO_ACTIVACION;
        reservaPrimeraExpira[user] = block.timestamp + selloDuracion;
        reservaPrimeraToken[user] = token;
        totalReservadoPrimera[token] += BONO_ACTIVACION;
    }

    function consumirSello(
        mapping(address => uint256) storage reservaPrimera,
        mapping(address => uint256) storage reservaPrimeraExpira,
        mapping(address => address) storage reservaPrimeraToken,
        mapping(address => uint256) storage totalReservadoPrimera,
        address token,
        address user
    ) external {
        uint256 r = reservaPrimera[user];
        address tkn = reservaPrimeraToken[user];
        reservaPrimera[user] = 0;
        reservaPrimeraExpira[user] = 0;
        reservaPrimeraToken[user] = address(0);
        if (tkn == address(0)) tkn = token;
        uint256 tot = totalReservadoPrimera[tkn];
        totalReservadoPrimera[tkn] = tot > r ? tot - r : 0;
    }

    event BonoRedPagado(address indexed usuario, uint256 umbral, uint256 monto, address indexed token);
    event ReputationUpdated(address indexed usuario, uint256 nuevaReputacion);
    event ComisionGeneracional(
        address indexed beneficiario,
        address indexed deudor,
        uint8 generacion,
        uint256 monto,
        address indexed token
    );
    event BonoActivacionPagado(address indexed padre, address indexed referido, uint256 monto, address indexed token);
    event InteresRetenidoPool(address indexed token, uint256 monto);

    /// @notice Donar y aportar: 100 fama por cada 1 USDT, desde el primero.
    function ptsDonacion(uint256, uint256 amount) external pure returns (uint256) {
        if (amount == 0) return 0;
        return (amount * 100) / 1e18;
    }

    function pagarBonosRed(
        mapping(address => uint256) storage puntosRed,
        mapping(address => uint256) storage bonosRedCobrados,
        mapping(address => uint256) storage totalLiquidity,
        mapping(address => uint256) storage outstandingLoans,
        IERC20 pago,
        address token,
        address usuario,
        uint256 umbral,
        uint256 bonoUsdt,
        uint256 pisoBp
    ) external {
        uint256 earned = puntosRed[usuario] / umbral;
        uint256 already = bonosRedCobrados[usuario];
        if (earned <= already) return;
        uint256 n = earned - already;
        if (n > 20) n = 20;
        for (uint256 i = 0; i < n; i++) {
            uint256 liq = totalLiquidity[token];
            uint256 out = outstandingLoans[token];
            uint256 caja = liq > out ? liq - out : 0;
            uint256 piso = (liq * pisoBp) / 10000;
            if (caja <= piso || caja - piso < bonoUsdt) break;
            totalLiquidity[token] = liq - bonoUsdt;
            pago.safeTransfer(usuario, bonoUsdt);
            already += 1;
            emit BonoRedPagado(usuario, already * umbral, bonoUsdt, token);
        }
        bonosRedCobrados[usuario] = already;
    }

    function tocar(address hermano, address who, uint256 pts) external {
        if (hermano == address(0) || who == address(0)) return;
        if (pts == 0) {
            IQuatriviumFamaCaja(hermano).wipe(who);
            return;
        }
        IQuatriviumFamaCaja(hermano).acreditar(who, pts);
    }

    function onCierre(address hermano, address deudor, address padre) external {
        if (hermano == address(0) || deudor == address(0) || padre == address(0) || padre == deudor) return;
        IQuatriviumFamaCaja(hermano).onCierrePrestamo(deudor, padre);
    }

    function sacarCaja(
        mapping(address => uint256) storage totalLiquidity,
        IERC20 token,
        address tokenAddr,
        address to,
        uint256 amount,
        uint256 caja,
        uint256 piso
    ) external {
        require(to != address(0) && to != address(this) && amount > 0);
        require(caja > piso && caja - piso >= amount);
        require(token.balanceOf(address(this)) >= amount);
        totalLiquidity[tokenAddr] -= amount;
        token.safeTransfer(to, amount);
    }

    function pagarBonoPool(
        mapping(address => uint256) storage totalLiquidity,
        mapping(address => uint256) storage reputacion,
        IERC20 token,
        address tokenAddr,
        address padre,
        address deudor,
        bool padreOk,
        uint256 caja,
        uint256 piso,
        address hermano
    ) public returns (uint256 bono) {
        if (!padreOk || padre == address(0) || padre == deudor) {
            return 0;
        }
        bono = BONO_ACTIVACION;
        if (caja <= piso || caja - piso < bono) return 0;
        totalLiquidity[tokenAddr] -= bono;
        token.safeTransfer(padre, bono);
        emit ComisionGeneracional(padre, deudor, 1, bono, tokenAddr);
        reputacion[padre] += 100;
        emit ReputationUpdated(padre, reputacion[padre]);
        if (hermano != address(0)) {
            IQuatriviumFamaCaja(hermano).acreditarFamaRed(deudor);
        }
    }

    function bpGeneracion(uint8 generacion) public pure returns (uint256) {
        if (generacion == 1) return 1500;
        if (generacion == 2) return 800;
        if (generacion == 3) return 600;
        if (generacion == 4) return 400;
        if (generacion == 5) return 200;
        if (generacion <= 12) return 80;
        return 40;
    }

    function dispersarInteres(
        mapping(address => Usuario) storage red,
        mapping(address => uint256) storage reputacion,
        mapping(address => uint256) storage totalLiquidity,
        mapping(address => uint256) storage outstandingLoans,
        IERC20 pago,
        address token,
        address deudor,
        address fundador,
        uint256 interes,
        uint256 nivelPrestamo,
        uint256 pagosAntes,
        address hermano
    ) external returns (uint256 comisionesRed, uint256 retenidoPool, bool usoBonoA) {
        if (interes == 0) return (0, 0, false);
        bool habriaBonoA = pagosAntes == 0 && nivelPrestamo == 1 && !red[deudor].bonoActivacionCobrado;
        uint256 remaining = interes;
        uint256 corte = (interes * FUNDADOR_BP) / 10000;
        remaining -= _pagarCapped(pago, token, fundador, corte, remaining, deudor, 0, address(0));
        address padre = red[deudor].padre;
        address reserva = _reservaDe(hermano);
        if (habriaBonoA) {
            uint256 liq = totalLiquidity[token];
            uint256 out = outstandingLoans[token];
            uint256 caja = liq > out ? liq - out : 0;
            uint256 piso = (liq * PISO_CAJA_BP) / 10000;
            red[deudor].bonoActivacionCobrado = true;
            uint256 pagadoBono = pagarActivacion(
                totalLiquidity,
                reputacion,
                pago,
                token,
                padre,
                deudor,
                padre != address(0) && !ICreditDisp(address(this)).dispersionCongelada(padre),
                caja,
                piso,
                hermano
            );
            if (pagadoBono > 0) {
                usoBonoA = true;
                reputacion[padre] += 100;
                emit ReputationUpdated(padre, reputacion[padre]);
                if (hermano != address(0)) {
                    IQuatriviumFamaCaja(hermano).acreditarFamaRed(deudor);
                }
                emit BonoActivacionPagado(padre, deudor, pagadoBono, token);
            } else {
                red[deudor].bonoActivacionCobrado = false;
            }
        }
        uint256 floor = (interes * POOL_FLOOR_BP) / 10000;
        address cursor = padre;
        for (uint8 gen = 1; gen <= MAX_LINEA; gen++) {
            if (cursor == address(0) || cursor == deudor || remaining == 0) break;
            if (!(usoBonoA && gen == 1)) {
                uint256 share = (interes * bpGeneracion(gen)) / 10000;
                if (gen >= 6) {
                    if (remaining <= floor) break;
                    uint256 room = remaining - floor;
                    if (share > room) share = room;
                }
                remaining -= _pagarCapped(pago, token, cursor, share, remaining, deudor, gen, reserva);
            }
            cursor = red[cursor].padre;
        }
        retenidoPool = remaining;
        comisionesRed = interes - retenidoPool;
        if (retenidoPool > 0) {
            totalLiquidity[token] += retenidoPool;
            emit InteresRetenidoPool(token, retenidoPool);
        }
    }

    function _pagarCapped(
        IERC20 pago,
        address token,
        address to,
        uint256 amount,
        uint256 remaining,
        address deudor,
        uint8 generacion,
        address reserva
    ) private returns (uint256) {
        if (remaining == 0 || amount == 0) return 0;
        if (amount > remaining) amount = remaining;
        if (amount == 0 || to == address(0) || to == deudor) return 0;
        if (generacion != 0 && ICreditDisp(address(this)).dispersionCongelada(to)) return 0;
        // El cobrador sin alta y sin L1 pagado no saca su parte: se queda en el pool.
        if (generacion != 0 && !ICreditDisp(address(this)).cobradorListo(to)) return 0;
        pago.safeTransfer(to, amount);
        emit ComisionGeneracional(to, deudor, generacion, amount, token);
        if (generacion != 0) _avisarReserva(reserva, to, amount, deudor, generacion, remaining);
        return amount;
    }

    /// @dev Dirección de Reserva leída del hermano de fama. Cero si no hay.
    function _reservaDe(address hermano) private view returns (address r) {
        if (hermano == address(0)) return address(0);
        (bool ok, bytes memory raw) = hermano.staticcall(abi.encodeWithSignature("reserva()"));
        if (ok && raw.length >= 32) r = abi.decode(raw, (address));
    }

    /// @dev Boost 100 % on-chain: Reserva liquida el extra de esta comisión (sin attester).
    ///      Un fallo de Reserva nunca bloquea el pago del préstamo; el gas queda acotado.
    function _avisarReserva(
        address reserva,
        address beneficiario,
        uint256 monto,
        address deudor,
        uint8 generacion,
        uint256 remaining
    ) private {
        if (reserva == address(0)) return;
        bytes32 salt = keccak256(abi.encode(deudor, generacion, block.timestamp, remaining));
        // slither-disable-next-line unchecked-lowlevel
        (bool ok, ) = reserva.call{gas: 180000}(
            abi.encodeWithSignature(
                "pagarBoostComision(address,uint256,bytes32)",
                beneficiario,
                monto,
                salt
            )
        );
        ok;
    }

    function alimentarPool(
        mapping(address => uint256) storage totalLiquidity,
        IERC20 token,
        address tokenAddr,
        uint256 amount
    ) external {
        require(amount == 5e17 || amount == 1e18);
        totalLiquidity[tokenAddr] += amount;
        token.safeTransferFrom(msg.sender, address(this), amount);
    }

    /// @notice Solo el contrato Alta puede alimentar el pool. cargoDe() apunta al deudor
    /// cuando vence el padrino. No hay camino si Alta no está fijada.
    function usuarioVerificacion(address hermano, address caller, address origin)
        external
        view
        returns (address user)
    {
        address alta = _leerAlta(hermano);
        require(alta != address(0) && alta == caller);
        user = origin;
        (bool okU, bytes memory rawU) = alta.staticcall(abi.encodeWithSignature("cargoDe()"));
        if (okU && rawU.length >= 32) {
            address cargo = abi.decode(rawU, (address));
            if (cargo != address(0)) user = cargo;
        }
    }

    /// @notice El préstamo exige registroHecho en el Alta fijado. Cero o sin contrato revierte.
    function requireAltaPagada(address hermano, address user) external view {
        require(altaRegistrada(hermano, user));
    }

    function altaRegistrada(address hermano, address user) public view returns (bool) {
        address alta = _leerAlta(hermano);
        if (alta == address(0)) return false;
        (bool ok, bytes memory data) = alta.staticcall(
            abi.encodeWithSignature("registroHecho(address)", user)
        );
        return ok && data.length >= 32 && abi.decode(data, (bool));
    }

    /// @notice 5 % de cada entrada al pool. El resto queda prestable.
    function partirSeguro(uint256 amount) public pure returns (uint256 alPool, uint256 alSeguro) {
        alSeguro = (amount * SEGURO_BP) / 10000;
        alPool = amount - alSeguro;
    }

    /// @dev `entered` ya se sumó a la liquidez. Mueve el 5 % al fondo de seguro.
    function apartarSeguro(
        mapping(address => uint256) storage totalLiquidity,
        mapping(address => uint256) storage fondoSeguro,
        address token,
        uint256 entered
    ) external {
        if (entered == 0) return;
        (, uint256 seguro) = partirSeguro(entered);
        if (seguro == 0) return;
        require(totalLiquidity[token] >= seguro, "seguro");
        totalLiquidity[token] -= seguro;
        fondoSeguro[token] += seguro;
    }

    /// @dev Cubre una pérdida por impago moviendo contabilidad del fondo al pool. No saca tokens.
    function cubrirImpago(
        mapping(address => uint256) storage totalLiquidity,
        mapping(address => uint256) storage fondoSeguro,
        address token,
        uint256 perdida
    ) external returns (uint256 cubierto) {
        if (perdida == 0) return 0;
        uint256 fondo = fondoSeguro[token];
        cubierto = perdida <= fondo ? perdida : fondo;
        if (cubierto == 0) return 0;
        fondoSeguro[token] = fondo - cubierto;
        totalLiquidity[token] += cubierto;
    }

    function _leerAlta(address hermano) private view returns (address alta) {
        if (hermano == address(0)) return address(0);
        (bool okA, bytes memory rawA) = hermano.staticcall(abi.encodeWithSignature("alta()"));
        if (okA && rawA.length >= 32) alta = abi.decode(rawA, (address));
    }
}
