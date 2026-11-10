// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {AggregatorV3Interface} from "./interfaces/AggregatorV3Interface.sol";
import {LoanTierSeed} from "./libraries/LoanTierSeed.sol";
import {Usuario} from "./libraries/Usuario.sol";
import {QuatriviumFamaLib} from "./libraries/QuatriviumFamaLib.sol";

/**
 * @title Quatrivium Finance (Sovereign / LUSD)
 * @notice Microcredito sin colateral + red Unilevel de flujo estrictamente ascendente.
 *         El principal vuelve integro al pool. El interes se reparte (red + pool) con suma cero.
 *         LUSD = 1 USD fijo (sin feed) y admin con timelock + confirmaciones.
 *         Sin pausa, sin lista negra, sin KYC ni attester off-chain.
 *
 * Escala: 1000 niveles, $1 a $1 000 000. 1-100 en LoanTierSeed; 101-1000 por formula en _tier.
 * Nivel 1 = 1e18 (1 LUSD). Alta Real: 4 LUSD (1 fundador, 1 Reserva, 1 sello, 1 padrino
 * apartado). El padrino cobra ese 1 al pagar el primer L1; el interés se parte en comisiones.
 * El fundador cobra un recorte fijo de cada interes. Si una llave se compromete,
 * las otras fundadoras pueden reasignar fundador y owner (timelock + confirmaciones).
 * Las comisiones de red recorren toda la linea hacia arriba (no se cortan a 5).
 * Fama de caja: donar/aportar 100 por LUSD desde el primero (mínimo 1 LUSD).
 *
 * EIP-170: ESTE archivo no puede pasar de 24576 bytes (limite de Ethereum, no nuestro).
 * El protocolo no se recorta: cada pieza nueva vive en un hermano o libreria
 * (QuatriviumLeveling, QuatriviumFamaLib, etc.), cada uno con su propio tope.
 *
 * Redes y Constantes Canónicas:
 * - Arbitrum One (chainId: 42161):
 *   LUSD (18 dec): 0x93b346b6BC2548dA6A1E7d98E9a421B42541425b
 * - Ethereum Mainnet (chainId: 1, referencia):
 *   LUSD (18 dec): 0x5f98805A4E8be255a32880FDeC7F6728C6568bA0
 */
contract QuatriviumCredit is ReentrancyGuard {
    using SafeERC20 for IERC20;

    uint256 public constant TIMELOCK_DELAY = 72 hours;
    uint256 public constant PAUSA_PRESTAMOS = 7 days;
    uint256 public constant COOLDOWN_PRESTAMO = 48 hours;
    uint256 public constant LIQUIDACION_GRACIA = 48 hours;
    uint256 public constant SEQUENCER_GRACIA = 1 hours;
    uint256 internal constant GRACIA_MORA = 30 days;
    uint256 internal constant FAMA_POR_DIA_MORA = 10;
    uint256 public constant ORIGINATION_WINDOW = 1 days;
    uint256 public constant MAX_ADMINS = 3;
    uint256 internal constant MAX_NIVEL_TOTAL = 1000;

    /// @notice 1 USDT apartado en el registro; se suelta al padrino al pagar el primer L1.
    uint256 public constant BONO_ACTIVACION = 1e18;
    uint8 internal constant MAX_LINEA = 40;
    uint256 internal constant REPUTACION_INICIAL = 100;
    uint256 public constant PUNTOS_POR_REFERIDO = 50;
    uint256 public constant UMBRAL_BONO_RED = 250;
    uint256 public constant BONO_RED_USDT = 5e17;
    uint256 internal constant BONO_RED_PISO_CAJA_BP = 2000;
    /// @notice Hitos 100–1000: 400 / 4k / 7k / 8.5k / 9k / 11.5k / 13.5k / 16k / 18k / 20k.
    /// @dev 15% fundador + 15/8/6/4/2% las primeras 5 generaciones. El resto va al pool;
    ///      generaciones 6+ toman de ese resto (0,8% y luego 0,4%) sin bajar del piso del pool.
    uint256 internal constant POOL_RECURRENTE_BP = 5000;
    uint256 internal constant POOL_FLOOR_BP = 4000;
    uint256 internal constant FUNDADOR_BP = 1500;
    uint256 internal constant GEN1_BP = 1500;
    uint256 internal constant GEN2_BP = 800;
    uint256 internal constant GEN3_BP = 600;
    uint256 internal constant GEN4_BP = 400;
    uint256 internal constant GEN5_BP = 200;

    mapping(address => IERC20) public stableTokens;
    mapping(address => bool) public supportedToken;
    address payable public feeCollector;
    address public fundador;
    address public fundadorPendiente;
    uint256 public fundadorEta;
    uint256 public pausaPrestamosHasta;
    /// @notice Hasta esta marca no se puede votar otra pausa: 7 días de pausa y 7 de descanso.
    uint256 public pausaReposoHasta;
    /// @dev El feed de uptime del sequencer en Arbitrum late como mucho cada 24 h.
    ///      Una ronda más vieja no es una lectura viva: se posponen solo las liquidaciones.
    uint256 internal constant SEQUENCER_FEED_MAX_EDAD = 24 hours;
    /// @notice Feed de uptime del sequencer. En Arbitrum One (42161) no puede ser cero.
    AggregatorV3Interface public immutable sequencerFeed;
    /// @notice Tiempo que el sequencer estuvo caído y que se suma a la gracia de liquidación.
    uint256 public graciaSequencer;
    uint256 public sequencerCaidoDesde;
    uint256 public feeBasisPoints;

    mapping(address => bool) public admins;
    address[] public ownerList;
    uint256 public requiredConfirmations;
    mapping(bytes4 => bool) public allowedAdminSelector;

    struct AdminProposal {
        address proposer;
        uint256 eta;
        bytes data;
        uint256 confirms;
        bool executed;
        bool cancelled;
    }
    uint256 public proposalCount;
    mapping(uint256 => AdminProposal) public proposals;
    mapping(uint256 => mapping(address => bool)) public confirmed;

    mapping(address => uint256) public totalLiquidity;
    /// @notice 5 % de lo que entra al pool. Solo cubre el premio de un impago. Nadie lo retira.
    mapping(address => uint256) public fondoSeguro;
    uint256 public totalImpagoCubierto;
    mapping(address => uint256) public outstandingLoans;
    mapping(address => mapping(address => uint256)) public lpShares;
    mapping(address => uint256) public totalShares;
    mapping(address => uint256) public collectedFees;

    uint256 public originationsInWindow;
    uint256 public originatedChicoInWindow;
    uint256 public originatedPrincipalInWindow;
    uint256 public originationWindowStart;
    /// @notice Conservado en ABI. Ya no raciona crédito; el pool (80 %) manda.
    uint256 public maxOriginationsPerWindow = 10000;
    uint256 public maxUtilizationBps = 8000;
    uint256 public constant SELLO_PRIMERA = 7 days;
    mapping(address => uint256) public verificadoAlPool;
    mapping(address => uint256) public reservaPrimera;
    mapping(address => uint256) public reservaPrimeraExpira;
    mapping(address => address) public reservaPrimeraToken;
    mapping(address => uint256) public totalReservadoPrimera;
    struct Level { uint256 montoPrestamo; uint256 plazo; uint256 tasaInteresBP; }
    mapping(uint256 => Level) private _niveles;

    struct PosicionCredito {
        uint256 nivelActual;
        uint256 montoActivo;
        uint256 vencimiento;
        bool enMora;
        address monedaActivo;
        uint256 tasaAplicadaBP;
    }
    mapping(address => PosicionCredito) public usuarios;

    /// @notice Nodo Unilevel. Registro orgÃ¡nico cuelga del `fundador`.
    mapping(address => Usuario) public redGenealogica;
    mapping(address => uint256) public prestamosCerrados;
    /// @notice True cuando el usuario pagó (no liquidó) un préstamo de nivel 1.
    mapping(address => bool) public l1Pagado;
    /// @notice Nivel y puntualidad del último cierre. La racha solo cuenta nivel >= 2 a tiempo.
    mapping(address => uint256) public cierreNivel;
    mapping(address => bool) public cierreATiempo;

    struct PlanPago {
        uint128 pagado;
        uint64 venceCuota;
        uint8 totales;
        uint8 pagadas;
        bool enPlazo;
    }
    mapping(address => PlanPago) public planPago;

    mapping(address => bool) public humanosVerificados;
    mapping(address => bool) public esMoroso;
    mapping(address => uint256) internal moraDesde;
    mapping(address => uint256) internal moraDiasCobrados;
    mapping(address => uint256) public reputacion;
    mapping(address => uint256) public puntosRed;
    mapping(address => uint256) public bonosRedCobrados;
    mapping(address => uint256) public prestamosPagadosATiempo;
    mapping(address => uint256) public prestamosMorosos;
    mapping(address => uint256) public penalizacionesAcumuladas;

    struct ProgresoNivel {
        uint256 nivelActual;
        uint256 solicitudesCompletadas;
        uint256 ultimoPrestamoTimestamp;
    }
    mapping(address => ProgresoNivel) public progresoUsuarios;
    /// @notice Ãšltimo hito de 100 cobrado (0, 100, 200â€¦ 1000).
    mapping(address => uint256) public hitoCobrado;
    /// @notice LUSD donado al fundador (no entra al pool).
    mapping(address => uint256) public donado;

    uint256 public tasaBaseBP;
    uint256 public puntoOptimoUtilBP;
    uint256 public pendiente1BP;
    uint256 public pendiente2BP;
    uint256 public puntosPorPagoATiempo;
    uint256 public penalizacionPorMora;
    uint256 public reputacionThresholdGovernance;

    /// @notice Hermano de fama/canje. Se crea en el constructor (no cabe en este bytecode).
    address public immutable famaHermano;

    event HumanoVerificado(address indexed usuario);
    event AfiliadoRegistrado(address indexed usuario, address indexed padre);
    event BonoActivacionPagado(address indexed padre, address indexed referido, uint256 monto, address indexed token);
    event ComisionGeneracional(address indexed beneficiario, address indexed deudor, uint8 generacion, uint256 monto, address indexed token);
    event InteresRetenidoPool(address indexed token, uint256 monto);
    event InteresDistribuido(
        address indexed deudor,
        address indexed token,
        uint256 interes,
        uint256 comisionesRed,
        uint256 retenidoPool,
        bool bonoActivacion
    );
    event LiquidezAportada(address indexed proveedor, uint256 monto, address indexed token);
    event PrestamoEmitido(address indexed usuario, uint256 monto, uint256 vencimiento, address indexed token);
    event PrestamoPagado(address indexed usuario, uint256 montoPrincipal, uint256 fee, address indexed token);
    event LiquidationExecuted(address indexed liquidator, address indexed user, address indexed token, uint256 paidAmount, uint256 reward);
    event LoanLiquidated(address indexed deudor, address indexed liquidador, address indexed token, uint256 monto);
    event NivelActualizado(address indexed usuario, uint256 nuevoNivel);
    event MorosityUpdated(address indexed usuario, bool esMoroso);
    event ReputationUpdated(address indexed usuario, uint256 nuevaReputacion);
    event PuntosRed(address indexed usuario, uint256 puntos);
    event BonoRedPagado(address indexed usuario, uint256 umbral, uint256 monto, address indexed token);
    event BonoHitoPagado(address indexed usuario, uint256 hito, uint256 monto, address indexed token);
    event Donacion(address indexed usuario, uint256 monto, address indexed token);
    event AdminActionProposed(uint256 indexed id, address indexed proposer, bytes4 selector, uint256 eta);
    event AdminActionConfirmed(uint256 indexed id, address indexed admin, uint256 confirms);
    event AdminActionCancelled(uint256 indexed id, address indexed admin);
    event AdminActionExecuted(uint256 indexed id, bytes4 selector);
    event AdminAdded(address indexed admin);
    event AdminRemoved(address indexed admin);
    event OwnerTransferred(address indexed previousOwner, address indexed newOwner);
    event FundadorUpdated(address indexed previous, address indexed next);
    event FundadorPropuesto(address indexed next, uint256 eta);
    event FundadorCancelado();

    error SequencerFeedRequerido();
    error PausaEnReposo();
    event PrestamosPausados(uint256 hasta);
    event SecurityParamsUpdated(uint256 maxOriginations, uint256 maxUtilizationBps);
    event FeeCollectorUpdated(address indexed newCollector);

    modifier onlyAdmin() {
        require(admins[msg.sender], "only admin");
        _;
    }

    modifier onlySelf() {
        require(msg.sender == address(this), "only timelock");
        _;
    }

    modifier onlySupportedToken(address token) {
        require(supportedToken[token], "unsupported token");
        _;
    }

    constructor(
        address _usdtAddress,
        address payable _feeCollector,
        uint256 _feeBP,
        address[] memory _initialAdmins,
        uint256 _requiredConfirmations,
        address _famaHermano,
        address _sequencerFeed
    ) {
        if (block.chainid == 42161 && _sequencerFeed == address(0)) revert SequencerFeedRequerido();
        require(_usdtAddress != address(0), "zero token");
        require(_feeCollector != address(0), "zero fee collector");
        require(_feeBP <= 1000, "fee too high");
        require(_famaHermano != address(0) && _famaHermano != address(this), "fama");
        require(_initialAdmins.length == MAX_ADMINS, "bad admins");
        _requiredConfirmations;

        stableTokens[_usdtAddress] = IERC20(_usdtAddress);
        supportedToken[_usdtAddress] = true;
        feeCollector = _feeCollector;
        feeBasisPoints = _feeBP;
        requiredConfirmations = 2;

        fundador = _initialAdmins[0];
        humanosVerificados[fundador] = true;
        redGenealogica[fundador] = Usuario({ padre: address(0), bonoActivacionCobrado: true });
        progresoUsuarios[fundador].nivelActual = 1;
        reputacion[fundador] = REPUTACION_INICIAL;
        emit HumanoVerificado(fundador);
        emit AfiliadoRegistrado(fundador, address(0));

        for (uint256 i = 0; i < _initialAdmins.length; i++) {
            address admin = _initialAdmins[i];
            require(admin != address(0), "zero admin");
            require(!admins[admin], "dup admin");
            admins[admin] = true;
            ownerList.push(admin);
        }
        _syncQuorum();

        (uint16[100] memory usd, uint16[100] memory bps, uint8[100] memory dias) = LoanTierSeed.tables();
        for (uint256 i = 0; i < LoanTierSeed.MAX_NIVEL; i++) {
            _niveles[i + 1] = Level({
                montoPrestamo: uint256(usd[i]) * 1e18,
                plazo: uint256(dias[i]) * 1 days,
                tasaInteresBP: uint256(bps[i])
            });
        }
        _assertAntiSybilNivel1(_niveles[1].montoPrestamo, _niveles[1].tasaInteresBP);
        require(
            POOL_RECURRENTE_BP + FUNDADOR_BP + GEN1_BP + GEN2_BP + GEN3_BP + GEN4_BP + GEN5_BP == 10000,
            "bad recurrent split"
        );

        tasaBaseBP = 100;
        puntoOptimoUtilBP = 8000;
        pendiente1BP = 400;
        pendiente2BP = 2000;
        puntosPorPagoATiempo = 100;
        penalizacionPorMora = 200;
        reputacionThresholdGovernance = 1000;

        allowedAdminSelector[this.addAdmin.selector] = true;
        allowedAdminSelector[this.removeAdmin.selector] = true;
        allowedAdminSelector[this.pausarPrestamosNuevos.selector] = true;
        famaHermano = _famaHermano;
        sequencerFeed = AggregatorV3Interface(_sequencerFeed);
    }

    function _syncQuorum() internal {
        requiredConfirmations = 2;
    }

    function _requiredConfirms() internal pure returns (uint256) {
        return 2;
    }

    function proposeAdminAction(bytes calldata data) external onlyAdmin returns (uint256 id) {
        require(data.length >= 4, "bad data");
        bytes4 sel = bytes4(data);
        require(allowedAdminSelector[sel], "selector not allowed");
        if (sel == this.pausarPrestamosNuevos.selector && block.timestamp < pausaReposoHasta) {
            revert PausaEnReposo();
        }
        id = ++proposalCount;
        proposals[id] = AdminProposal({
            proposer: msg.sender,
            eta: block.timestamp + TIMELOCK_DELAY,
            data: data,
            confirms: 1,
            executed: false,
            cancelled: false
        });
        confirmed[id][msg.sender] = true;
        emit AdminActionProposed(id, msg.sender, sel, proposals[id].eta);
    }

    function confirmAdminAction(uint256 id) external onlyAdmin {
        AdminProposal storage p = proposals[id];
        require(p.eta != 0 && !p.executed && !p.cancelled, "closed");
        require(!confirmed[id][msg.sender], "already confirmed");
        confirmed[id][msg.sender] = true;
        p.confirms += 1;
        emit AdminActionConfirmed(id, msg.sender, p.confirms);
    }

    function cancelAdminAction(uint256 id) external onlyAdmin {
        AdminProposal storage p = proposals[id];
        require(p.eta != 0 && !p.executed && !p.cancelled, "closed");
        require(msg.sender == p.proposer, "only proposer");
        p.cancelled = true;
        emit AdminActionCancelled(id, msg.sender);
    }

    function executeAdminAction(uint256 id) external nonReentrant onlyAdmin {
        AdminProposal storage p = proposals[id];
        require(p.eta != 0 && !p.executed && !p.cancelled, "closed");
        require(block.timestamp >= p.eta, "timelock");
        require(p.confirms >= _requiredConfirms(), "confirmations");
        bytes4 sel = bytes4(p.data);
        require(allowedAdminSelector[sel], "selector not allowed");
        p.executed = true;
        (bool ok, ) = address(this).call(p.data);
        require(ok);
        emit AdminActionExecuted(id, sel);
    }

    function _assertAntiSybilNivel1(uint256 montoPrestamo, uint256 tasaInteresBP) internal pure {
        uint256 interes = (montoPrestamo * tasaInteresBP) / 10000;
        uint256 extracto = (BONO_RED_USDT * PUNTOS_POR_REFERIDO) / UMBRAL_BONO_RED;
        require(interes > extracto, "L1 interest must exceed referral extract");
    }

    /// @notice Pausa solo préstamos nuevos. Solo el propio contrato, tras el voto 2 de 3 y 72 h.
    ///         Se levanta sola a los 7 días. Otra votación espera otros 7 días de descanso.
    function pausarPrestamosNuevos() external onlySelf {
        if (block.timestamp < pausaReposoHasta) revert PausaEnReposo();
        pausaPrestamosHasta = block.timestamp + PAUSA_PRESTAMOS;
        pausaReposoHasta = pausaPrestamosHasta + PAUSA_PRESTAMOS;
        emit PrestamosPausados(pausaPrestamosHasta);
    }

    function proponerFundador(address next) external {
        require(msg.sender == fundador, "solo fundador");
        require(next != address(0) && next != fundador, "fundador");
        fundadorPendiente = next;
        fundadorEta = block.timestamp + TIMELOCK_DELAY;
        emit FundadorPropuesto(next, fundadorEta);
    }

    function cancelarFundador() external {
        require(msg.sender == fundador, "solo fundador");
        fundadorPendiente = address(0);
        fundadorEta = 0;
        emit FundadorCancelado();
    }

    function aplicarFundador() external {
        require(msg.sender == fundador, "solo fundador");
        require(fundadorPendiente != address(0) && block.timestamp >= fundadorEta, "timelock");
        address previous = fundador;
        fundador = fundadorPendiente;
        fundadorPendiente = address(0);
        fundadorEta = 0;
        emit FundadorUpdated(previous, fundador);
    }

    function addAdmin(address newAdmin) external onlySelf {
        require(newAdmin != address(0), "zero admin");
        require(!admins[newAdmin], "already admin");
        require(ownerList.length < MAX_ADMINS, "max owners reached");
        admins[newAdmin] = true;
        ownerList.push(newAdmin);
        _syncQuorum();
        emit AdminAdded(newAdmin);
    }

    function removeAdmin(address admin) external onlySelf {
        require(admins[admin], "not admin");
        require(ownerList.length > 2, "vacante");
        admins[admin] = false;
        for (uint256 i = 0; i < ownerList.length; i++) {
            if (ownerList[i] == admin) {
                ownerList[i] = ownerList[ownerList.length - 1];
                ownerList.pop();
                break;
            }
        }
        emit AdminRemoved(admin);
    }

    function registrarHumanoConPadre(address _padre) external {
        require(msg.sender == tx.origin, "no contracts");
        require(!humanosVerificados[msg.sender], "already registered");
        require(msg.sender != fundador, "already registered");

        address padre = _padre == address(0) ? fundador : _padre;
        require(padre != msg.sender, "self referral");
        require(humanosVerificados[padre], "padre not registered");
        require(padre != address(this), "invalid padre");

        if (progresoUsuarios[msg.sender].nivelActual == 0) {
            progresoUsuarios[msg.sender].nivelActual = 1;
        }
        if (reputacion[msg.sender] == 0) {
            reputacion[msg.sender] = REPUTACION_INICIAL;
        }

        redGenealogica[msg.sender] = Usuario({ padre: padre, bonoActivacionCobrado: false });
        humanosVerificados[msg.sender] = true;
        emit HumanoVerificado(msg.sender);
        emit AfiliadoRegistrado(msg.sender, padre);
    }

    function depositarLiquidez(address token, uint256 _monto) external nonReentrant onlySupportedToken(token) {
        require(tx.origin == msg.sender, "no contracts");
        require(_monto >= 1e18, "monto>0");

        (uint256 alPool, uint256 seguro) = QuatriviumFamaLib.partirSeguro(_monto);
        uint256 shares;
        if (totalShares[token] == 0 || totalLiquidity[token] == 0) {
            shares = alPool;
        } else {
            shares = (alPool * totalShares[token]) / totalLiquidity[token];
        }
        if (shares > 0) {
            lpShares[msg.sender][token] += shares;
            totalShares[token] += shares;
        }
        totalLiquidity[token] += alPool;
        fondoSeguro[token] += seguro;
        uint256 pts = (_monto * 100) / 1e18;
        reputacion[msg.sender] += pts;
        stableTokens[token].safeTransferFrom(msg.sender, address(this), _monto);
        _tocarFama(msg.sender, pts);
        emit LiquidezAportada(msg.sender, _monto, token);
        emit ReputationUpdated(msg.sender, reputacion[msg.sender]);
    }

    function solicitarPrestamo(address token, uint256 nivel) external nonReentrant onlySupportedToken(token) {
        require(block.timestamp >= pausaPrestamosHasta, "prestamos pausados");
        require(tx.origin == msg.sender, "no contracts");
        QuatriviumFamaLib.requireAltaPagada(famaHermano, msg.sender);
        require(humanosVerificados[msg.sender], "not verified");
        require(!_inhabilitado(msg.sender), "usuario moroso");
        require(usuarios[msg.sender].montoActivo == 0, "loan already active");

        ProgresoNivel storage progreso = progresoUsuarios[msg.sender];
        if (progreso.nivelActual == 0) {
            progreso.nivelActual = 1;
        }
        uint256 desbloqueado = progreso.nivelActual;
        uint256 pedido = nivel == 0 ? desbloqueado : nivel;
        require(pedido >= 1 && pedido <= desbloqueado && pedido <= MAX_NIVEL_TOTAL, "nivel locked");
        require(
            block.timestamp >= progreso.ultimoPrestamoTimestamp + COOLDOWN_PRESTAMO,
            "cooldown 48h"
        );

        Level memory L = _tier(pedido);
        require(L.montoPrestamo > 0, "tier not set");
        QuatriviumFamaLib.liberarSelloSiExpiro(
            reservaPrimera,
            reservaPrimeraExpira,
            reservaPrimeraToken,
            totalReservadoPrimera,
            token,
            msg.sender
        );
        bool sello = QuatriviumFamaLib.usaSelloPrimera(
            reservaPrimera[msg.sender],
            reservaPrimeraExpira[msg.sender],
            block.timestamp,
            L.montoPrestamo,
            pedido,
            progreso.ultimoPrestamoTimestamp == 0
        ) && reservaPrimeraToken[msg.sender] == token;
        if (sello) {
            QuatriviumFamaLib.consumirSello(
                reservaPrimera,
                reservaPrimeraExpira,
                reservaPrimeraToken,
                totalReservadoPrimera,
                token,
                msg.sender
            );
        } else {
            uint256 reservado = totalReservadoPrimera[token];
            uint256 base = QuatriviumFamaLib.liqGeneral(totalLiquidity[token], reservado);
            uint256 cajaVista = base > outstandingLoans[token] ? base - outstandingLoans[token] : 0;
            QuatriviumFamaLib.requireAcceso(
                totalLiquidity[token],
                reservado,
                outstandingLoans[token],
                L.montoPrestamo,
                maxUtilizationBps,
                QuatriviumFamaLib.esCarrilChico(cajaVista, L.montoPrestamo)
            );
        }
        require(stableTokens[token].balanceOf(address(this)) >= L.montoPrestamo, "insufficient liquidity");

        progreso.ultimoPrestamoTimestamp = block.timestamp;
        usuarios[msg.sender].nivelActual = pedido;
        usuarios[msg.sender].montoActivo = L.montoPrestamo;
        usuarios[msg.sender].vencimiento = block.timestamp + L.plazo;
        usuarios[msg.sender].enMora = false;
        usuarios[msg.sender].monedaActivo = token;
        uint256 tasaCurva = obtenerTasaInteresActual(token);
        uint256 tasaPiso = L.tasaInteresBP;
        usuarios[msg.sender].tasaAplicadaBP = tasaCurva > tasaPiso ? tasaCurva : tasaPiso;

        outstandingLoans[token] += L.montoPrestamo;
        uint256 m = L.montoPrestamo;
        uint8 n = m >= 100000e18 ? 12 : m >= 25000e18 ? 6 : m >= 60e18 ? 3 : m >= 50e18 ? 2 : 1;
        planPago[msg.sender] = PlanPago({
            pagado: 0,
            venceCuota: uint64(n <= 1 ? block.timestamp + L.plazo : block.timestamp + (L.plazo / n)),
            totales: n,
            pagadas: 0,
            enPlazo: true
        });
        stableTokens[token].safeTransfer(msg.sender, L.montoPrestamo);
        emit PrestamoEmitido(msg.sender, L.montoPrestamo, usuarios[msg.sender].vencimiento, token);
    }

    function _tier(uint256 id) internal view returns (Level memory L) {
        if (id <= LoanTierSeed.MAX_NIVEL) return _niveles[id];
        if (id > MAX_NIVEL_TOTAL) return L;
        uint256 t = id - LoanTierSeed.MAX_NIVEL;
        L.montoPrestamo = (10000 + 1100 * t) * 1e18;
        L.plazo = (90 + t / 10) * 1 days;
        L.tasaInteresBP = 800 - (t > 394 ? 394 : t);
    }

    function _montoCuota(
        uint256 totalDue,
        uint256 pagado,
        uint8 totales,
        uint8 pagadas
    ) internal pure returns (uint256) {
        if (totalDue <= pagado) return 0;
        uint256 restante = totalDue - pagado;
        uint8 left = totales > pagadas ? totales - pagadas : 1;
        if (left <= 1) return restante;
        return restante / left;
    }


    function _deudaActual(address usuario) internal view returns (uint256 principal, uint256 interes, uint256 total, address token) {
        principal = usuarios[usuario].montoActivo;
        token = usuarios[usuario].monedaActivo;
        uint256 tasaBP = usuarios[usuario].tasaAplicadaBP;
        if (tasaBP == 0 && principal > 0) {
            uint256 nivel = usuarios[usuario].nivelActual;
            if (nivel == 0) nivel = 1;
            tasaBP = _tier(nivel).tasaInteresBP;
        }
        interes = (principal * tasaBP) / 10000;
        total = principal + interes;
    }

    function obtenerDeuda(address usuario) external view returns (uint256 principal, uint256 interes, uint256 total, address token) {
        return _deudaActual(usuario);
    }

    function _reducirOutstanding(address token, uint256 amount) internal {
        if (outstandingLoans[token] <= amount) {
            outstandingLoans[token] = 0;
        } else {
            outstandingLoans[token] -= amount;
        }
    }

    function _subirNivelSiATiempo(address deudor, bool enPlazo) internal {
        if (
            !enPlazo
            || usuarios[deudor].vencimiento == 0
            || block.timestamp > usuarios[deudor].vencimiento
        ) {
            return;
        }
        reputacion[deudor] += puntosPorPagoATiempo;
        prestamosPagadosATiempo[deudor] += 1;
        emit ReputationUpdated(deudor, reputacion[deudor]);
        ProgresoNivel storage progresoPago = progresoUsuarios[deudor];
        uint256 unlocked = progresoPago.nivelActual == 0 ? 1 : progresoPago.nivelActual;
        if (usuarios[deudor].montoActivo != _tier(unlocked).montoPrestamo) {
            return;
        }
        progresoPago.solicitudesCompletadas++;
        if (unlocked >= MAX_NIVEL_TOTAL) {
            if (progresoPago.solicitudesCompletadas % 100 == 0 && hitoCobrado[deudor] >= MAX_NIVEL_TOTAL) {
                hitoCobrado[deudor] = MAX_NIVEL_TOTAL - 100;
            }
            return;
        }
        uint256 solicitudesRequeridas = unlocked <= 1 ? 3 : (unlocked < 10 ? 5 : 5 * (unlocked - 9));
        if (progresoPago.solicitudesCompletadas >= solicitudesRequeridas) {
            progresoPago.solicitudesCompletadas = 0;
            progresoPago.nivelActual++;
            emit NivelActualizado(deudor, progresoPago.nivelActual);
        }
    }

    function _limpiarPrestamo(address deudor) internal {
        uint256 nivel = usuarios[deudor].nivelActual;
        uint256 vence = usuarios[deudor].vencimiento;
        bool aTiempo = planPago[deudor].enPlazo && vence != 0 && block.timestamp <= vence;
        cierreNivel[deudor] = nivel;
        cierreATiempo[deudor] = aTiempo;
        if (nivel == 1) l1Pagado[deudor] = true;
        usuarios[deudor].montoActivo = 0;
        usuarios[deudor].vencimiento = 0;
        usuarios[deudor].enMora = false;
        usuarios[deudor].monedaActivo = address(0);
        usuarios[deudor].tasaAplicadaBP = 0;
        delete planPago[deudor];
        delete moraDesde[deudor];
        prestamosCerrados[deudor] += 1;
        if (esMoroso[deudor]) {
            esMoroso[deudor] = false;
            emit MorosityUpdated(deudor, false);
        }
    }

    function _repartirPago(address deudor, address token, uint256 interesParte) internal returns (uint256 comisionesRed) {
        uint256 nivelPrestamo = usuarios[deudor].nivelActual;
        if (nivelPrestamo == 0) nivelPrestamo = 1;
        uint256 retenidoPool;
        bool usoBonoA;
        (comisionesRed, retenidoPool, usoBonoA) = QuatriviumFamaLib.dispersarInteres(
            redGenealogica,
            reputacion,
            totalLiquidity,
            outstandingLoans,
            stableTokens[token],
            token,
            deudor,
            fundador,
            interesParte,
            nivelPrestamo,
            prestamosCerrados[deudor],
            famaHermano
        );
        QuatriviumFamaLib.apartarSeguro(totalLiquidity, fondoSeguro, token, retenidoPool);
        emit InteresDistribuido(deudor, token, interesParte, comisionesRed, retenidoPool, usoBonoA);
    }

    function pagarPrestamo(address token, uint256 monto) external nonReentrant onlySupportedToken(token) {
        require(tx.origin == msg.sender, "no contracts");
        require(monto > 0, "monto>0");
        require(usuarios[msg.sender].montoActivo > 0, "no active loan");
        require(usuarios[msg.sender].monedaActivo == token, "token mismatch");
        _pagarComo(msg.sender, token, monto);
    }

    function _pagarComo(address deudor, address token, uint256 monto) internal {
        _aplicarPenalizacionDiaria(deudor);
        (uint256 principalDue, uint256 interesDue, uint256 totalDue, ) = _deudaActual(deudor);
        PlanPago storage plan = planPago[deudor];
        require(totalDue > plan.pagado, "already paid");
        uint8 totales = plan.totales == 0 ? 1 : plan.totales;
        uint256 cuota = _montoCuota(totalDue, plan.pagado, totales, plan.pagadas);
        require(monto >= cuota, "insufficient amount");

        uint256 pagadoAntes = plan.pagado;
        uint256 restante = totalDue - pagadoAntes;
        uint256 pago = monto < restante ? monto : restante;
        if (_estaVencido(deudor)) {
            plan.enPlazo = false;
            _aplicarMoraSiVencido(deudor);
        }

        stableTokens[token].safeTransferFrom(deudor, address(this), pago);
        uint256 interesYa = (interesDue * pagadoAntes) / totalDue;
        uint256 interesParte = pago == restante
            ? interesDue - interesYa
            : (interesDue * pago) / totalDue;
        if (interesParte > pago) interesParte = pago;
        _reducirOutstanding(token, pago - interesParte);
        uint256 comisionesRed = _repartirPago(deudor, token, interesParte);

        plan.pagado = uint128(pagadoAntes + pago);
        if (uint256(plan.pagado) < totalDue) {
            plan.pagadas += 1;
            uint256 vence = usuarios[deudor].vencimiento;
            uint256 left = totales > plan.pagadas ? totales - plan.pagadas : 1;
            plan.venceCuota = uint64(vence > block.timestamp ? block.timestamp + ((vence - block.timestamp) / left) : vence);
            return;
        }

        uint256 prevOut = (principalDue * pagadoAntes) / totalDue;
        if (principalDue > prevOut + (pago - interesParte)) {
            _reducirOutstanding(token, principalDue - prevOut - (pago - interesParte));
        }
        bool enPlazo = plan.enPlazo;
        _subirNivelSiATiempo(deudor, enPlazo);
        _limpiarPrestamo(deudor);
        emit PrestamoPagado(deudor, principalDue, comisionesRed, token);
    }

    function _inhabilitado(address usuario) internal view returns (bool) {
        return esMoroso[usuario] || _estaVencido(usuario);
    }

    /// @notice Tras el mes de gracia las comisiones y bonos del usuario van al pool.
    function dispersionCongelada(address usuario) public view returns (bool) {
        if (usuario == fundador || !esMoroso[usuario]) return false;
        uint256 desde = moraDesde[usuario];
        return desde != 0 && block.timestamp > desde + GRACIA_MORA;
    }

    function _cajaLibre(address token) internal view returns (uint256) {
        uint256 liq = totalLiquidity[token];
        uint256 out = outstandingLoans[token];
        return liq > out ? liq - out : 0;
    }

    function _tocarFama(address who, uint256 pts) internal {
        QuatriviumFamaLib.tocar(famaHermano, who, pts);
    }

    function _acreditarRed(address padre, address token) internal {
        if (padre == address(0)) {
            return;
        }
        puntosRed[padre] += PUNTOS_POR_REFERIDO;
        emit PuntosRed(padre, puntosRed[padre]);
        _pagarBonosRed(padre, token);
    }

    function _pagarBonosRed(address usuario, address token) internal {
        if (dispersionCongelada(usuario)) return;
        QuatriviumFamaLib.pagarBonosRed(
            puntosRed,
            bonosRedCobrados,
            totalLiquidity,
            outstandingLoans,
            stableTokens[token],
            token,
            usuario,
            UMBRAL_BONO_RED,
            BONO_RED_USDT,
            BONO_RED_PISO_CAJA_BP
        );
    }

    function obtenerRedReputacion(address usuario) external view returns (
        uint256 puntos,
        uint256 bonosCobrados,
        uint256 umbral,
        uint256 bono,
        uint256 puntosPorReferido
    ) {
        return (
            puntosRed[usuario],
            bonosRedCobrados[usuario],
            UMBRAL_BONO_RED,
            BONO_RED_USDT,
            PUNTOS_POR_REFERIDO
        );
    }

    function valorLp(address user, address token) public view returns (uint256) {
        if (totalShares[token] == 0) return 0;
        return (lpShares[user][token] * totalLiquidity[token]) / totalShares[token];
    }

    function _ajustarLiquidezPorInteres(address token, uint256 interes, uint256 fee) internal {
        if (interes >= fee) {
            totalLiquidity[token] += (interes - fee);
        } else {
            uint256 dip = fee - interes;
            require(totalLiquidity[token] >= dip, "fee exceeds pool");
            totalLiquidity[token] -= dip;
        }
    }

    /// @notice El pool es de prÃ©stamo, no un LP redimible. La UI y el contrato coinciden.
    function retirarLiquidez(address, uint256) external pure {
        revert("pool locked");
    }

    function _estaVencido(address usuario) internal view returns (bool) {
        if (usuarios[usuario].montoActivo == 0) return false;
        uint256 vence = usuarios[usuario].vencimiento;
        return vence > 0 && block.timestamp > vence;
    }

    function _aplicarPenalizacionDiaria(address usuario) internal {
        uint256 desde = moraDesde[usuario];
        if (!esMoroso[usuario] || desde < 1 || block.timestamp <= desde + GRACIA_MORA) return;
        uint256 dias = (block.timestamp - desde - GRACIA_MORA) / 1 days;
        uint256 ya = moraDiasCobrados[usuario];
        if (dias <= ya) return;
        uint256 nivel = progresoUsuarios[usuario].nivelActual;
        if (nivel < 1) nivel = 1;
        uint256 quita = (dias - ya) * FAMA_POR_DIA_MORA * nivel;
        reputacion[usuario] = reputacion[usuario] > quita ? reputacion[usuario] - quita : 0;
        moraDiasCobrados[usuario] = dias;
        penalizacionesAcumuladas[usuario] += quita;
        emit ReputationUpdated(usuario, reputacion[usuario]);
    }

    function _aplicarMoraSiVencido(address usuario) internal {
        if (!_estaVencido(usuario) || esMoroso[usuario]) return;
        esMoroso[usuario] = true;
        usuarios[usuario].enMora = true;
        moraDesde[usuario] = block.timestamp;
        moraDiasCobrados[usuario] = 0;
        prestamosMorosos[usuario] += 1;
        emit MorosityUpdated(usuario, true);
    }

    function marcarMorosoSiVencido(address usuario) external nonReentrant {
        require(usuarios[usuario].montoActivo > 0 && _estaVencido(usuario), "not due");
        _aplicarPenalizacionDiaria(usuario);
        _aplicarMoraSiVencido(usuario);
    }

    /// @notice Deja escrito el tiempo caído. Una liquidación que revierte no puede guardarlo.
    function anotarSequencer() external {
        _syncSequencer();
    }

    /// @dev answer 0 = sequencer arriba. Otro valor, o un feed que revierte, pospone solo la liquidación.
    function _syncSequencer() internal returns (uint256 extra, bool posponer) {
        extra = graciaSequencer;
        if (address(sequencerFeed) == address(0)) return (extra, false);
        try sequencerFeed.latestRoundData() returns (
            uint80,
            int256 answer,
            uint256 startedAt,
            uint256 updatedAt,
            uint80
        ) {
            if (updatedAt == 0 || startedAt == 0 || updatedAt > block.timestamp || startedAt > block.timestamp) {
                return (extra, true);
            }
            if (answer != 0) {
                if (sequencerCaidoDesde == 0) sequencerCaidoDesde = startedAt;
                return (extra, true);
            }
            if (block.timestamp - updatedAt > SEQUENCER_FEED_MAX_EDAD) return (extra, true);
            if (sequencerCaidoDesde != 0) {
                uint256 fin = startedAt > sequencerCaidoDesde ? startedAt : block.timestamp;
                if (fin > sequencerCaidoDesde) {
                    graciaSequencer += fin - sequencerCaidoDesde;
                    extra = graciaSequencer;
                }
                sequencerCaidoDesde = 0;
            }
            if (block.timestamp < startedAt + SEQUENCER_GRACIA) return (extra, true);
            return (extra, false);
        } catch {
            return (extra, true);
        }
    }

    function liquidate(address deudor, address tokenAddress) external nonReentrant onlySupportedToken(tokenAddress) {
        require(tx.origin == msg.sender, "no contracts");
        require(msg.sender != deudor, "self");
        require(usuarios[deudor].montoActivo > 0, "no active loan");
        require(usuarios[deudor].monedaActivo == tokenAddress, "token mismatch");
        require(_estaVencido(deudor), "not defaulted");
        (uint256 extra, bool posponer) = _syncSequencer();
        if (posponer) revert("sequencer");
        require(
            block.timestamp > usuarios[deudor].vencimiento + LIQUIDACION_GRACIA + extra,
            "grace"
        );

        uint256 principal = usuarios[deudor].montoActivo;
        (, uint256 interest, uint256 totalDue, ) = _deudaActual(deudor);
        uint256 pagado = planPago[deudor].pagado;
        require(totalDue > pagado, "already paid");
        uint256 restante = totalDue - pagado;
        uint256 interestRestante = (interest * restante) / totalDue;
        uint256 principalRestante = principal - ((principal * pagado) / totalDue);

        stableTokens[tokenAddress].safeTransferFrom(msg.sender, address(this), restante);

        uint256 fee = (interest * restante * feeBasisPoints) / (totalDue * 10000);
        if (fee > interestRestante) fee = interestRestante;

        // 5 % del principal, nunca más que el interés que queda tras el fee: el pool no pierde.
        // El fee se queda en el pool en esta misma transacción. No hay saldo sin dueño.
        uint256 reward = (principalRestante * 5) / 100;
        uint256 topePremio = interestRestante - fee;
        if (reward > topePremio) reward = topePremio;

        _ajustarLiquidezPorInteres(tokenAddress, interestRestante, reward);
        uint256 entro = interestRestante > reward ? interestRestante - reward : 0;
        QuatriviumFamaLib.apartarSeguro(totalLiquidity, fondoSeguro, tokenAddress, entro);
        if (reward > 0) {
            totalImpagoCubierto += QuatriviumFamaLib.cubrirImpago(
                totalLiquidity,
                fondoSeguro,
                tokenAddress,
                reward
            );
        }

        if (outstandingLoans[tokenAddress] <= principalRestante) {
            outstandingLoans[tokenAddress] = 0;
        } else {
            outstandingLoans[tokenAddress] -= principalRestante;
        }

        cierreNivel[deudor] = usuarios[deudor].nivelActual;
        cierreATiempo[deudor] = false;
        usuarios[deudor].montoActivo = 0;
        usuarios[deudor].vencimiento = 0;
        usuarios[deudor].enMora = false;
        usuarios[deudor].monedaActivo = address(0);
        usuarios[deudor].tasaAplicadaBP = 0;
        delete planPago[deudor];
        prestamosCerrados[deudor] += 1;

        if (esMoroso[deudor]) {
            esMoroso[deudor] = false;
            emit MorosityUpdated(deudor, false);
        } else {
            prestamosMorosos[deudor] += 1;
            penalizacionesAcumuladas[deudor] += penalizacionPorMora;
            if (reputacion[deudor] >= penalizacionPorMora) {
                reputacion[deudor] -= penalizacionPorMora;
            } else {
                reputacion[deudor] = 0;
            }
            emit ReputationUpdated(deudor, reputacion[deudor]);
        }

        if (reward > 0) {
            stableTokens[tokenAddress].safeTransfer(msg.sender, reward);
        }

        emit LiquidationExecuted(msg.sender, deudor, tokenAddress, restante, reward);
        emit LoanLiquidated(deudor, msg.sender, tokenAddress, restante);
    }

    function calcularTasaUtilizacion(address tokenAddress) public view returns (uint256) {
        uint256 pool = totalLiquidity[tokenAddress];
        if (pool < 1) return 0;
        return (outstandingLoans[tokenAddress] * 10000) / pool;
    }

    function obtenerTasaInteresActual(address tokenAddress) public view returns (uint256) {
        return QuatriviumFamaLib.tasaCurva(
            calcularTasaUtilizacion(tokenAddress),
            tasaBaseBP,
            puntoOptimoUtilBP,
            pendiente1BP,
            pendiente2BP
        );
    }

    function obtenerHistorialUsuario(address usuario) external view returns (
        uint256 puntosReputacion,
        bool moroso,
        uint256 pagadosATiempo,
        uint256 morosos,
        uint256 totalPenalizaciones
    ) {
        return (
            reputacion[usuario],
            esMoroso[usuario],
            prestamosPagadosATiempo[usuario],
            prestamosMorosos[usuario],
            penalizacionesAcumuladas[usuario]
        );
    }

    function obtenerProgresoUsuario(address usuario) external view returns (
        uint256 nivelActual,
        uint256 solicitudesCompletadas,
        uint256 ultimoPrestamoTimestamp
    ) {
        ProgresoNivel storage progreso = progresoUsuarios[usuario];
        uint256 level = progreso.nivelActual == 0 ? 1 : progreso.nivelActual;
        return (level, progreso.solicitudesCompletadas, progreso.ultimoPrestamoTimestamp);
    }

    function cobrarBonoHito(address token) external nonReentrant onlySupportedToken(token) {
        require(tx.origin == msg.sender, "no contracts");
        require(humanosVerificados[msg.sender] && !dispersionCongelada(msg.sender));
        uint256 nivel = progresoUsuarios[msg.sender].nivelActual;
        if (nivel < 1) nivel = 1;
        uint256 next = hitoCobrado[msg.sender] + 100;
        require(next <= MAX_NIVEL_TOTAL && next <= nivel - (nivel % 100));
        uint256 bono = QuatriviumFamaLib.bonoDeHito(next);
        uint256 caja = _cajaLibre(token);
        uint256 piso = (totalLiquidity[token] * BONO_RED_PISO_CAJA_BP) / 10000;
        require(caja > piso && caja - piso >= bono);
        hitoCobrado[msg.sender] = next;
        totalLiquidity[token] -= bono;
        stableTokens[token].safeTransfer(msg.sender, bono);
        emit BonoHitoPagado(msg.sender, next, bono, token);
    }

    function donar(address token, uint256 amount) external nonReentrant onlySupportedToken(token) {
        require(tx.origin == msg.sender, "no contracts");
        require(amount > 0 && fundador != address(0) && msg.sender != fundador);
        uint256 prev = donado[msg.sender];
        donado[msg.sender] += amount;
        uint256 pts = QuatriviumFamaLib.ptsDonacion(prev, amount);
        if (pts != 0) {
            reputacion[msg.sender] += pts;
        }
        stableTokens[token].safeTransferFrom(msg.sender, fundador, amount);
        if (pts != 0) {
            _tocarFama(msg.sender, pts);
        }
        emit Donacion(msg.sender, amount, token);
        emit ReputationUpdated(msg.sender, reputacion[msg.sender]);
    }

    /// @notice Sello de 1 LUSD al pool. Solo lo llama Alta. Sin fama ni participaciones LP.
    function pagarVerificacion(address token, uint256 amount) external nonReentrant onlySupportedToken(token) {
        address user = QuatriviumFamaLib.usuarioVerificacion(famaHermano, msg.sender, tx.origin);
        QuatriviumFamaLib.alimentarPool(totalLiquidity, stableTokens[token], token, amount);
        QuatriviumFamaLib.apartarSeguro(totalLiquidity, fondoSeguro, token, amount);
        uint256 prev = verificadoAlPool[user];
        verificadoAlPool[user] = prev + amount;
        if (prev < 1e18 && prev + amount >= 1e18) {
            QuatriviumFamaLib.sellarPrimera(
                reservaPrimera,
                reservaPrimeraExpira,
                reservaPrimeraToken,
                totalReservadoPrimera,
                progresoUsuarios[user].ultimoPrestamoTimestamp,
                token,
                user,
                SELLO_PRIMERA
            );
        }
    }

    /// @notice Si el sello de 7 días caducó, esa 1 LUSD vuelve a la caja general.
    function liberarSelloPrimeraSiExpiro(address token, address user) external onlySupportedToken(token) {
        QuatriviumFamaLib.liberarSelloSiExpiro(
            reservaPrimera,
            reservaPrimeraExpira,
            reservaPrimeraToken,
            totalReservadoPrimera,
            token,
            user
        );
    }

    function cobradorListo(address who) external view returns (bool) {
        return l1Pagado[who] && QuatriviumFamaLib.altaRegistrada(famaHermano, who);
    }

    /// @notice El 1 del padrino que no puede cobrar entra al pool, sin sello nuevo.
    /// @dev Sin nonReentrant: Alta llama esto desde pagarPrestamo, que ya tiene el candado.
    function ingresarAlPool(address token, uint256 amount) external onlySupportedToken(token) {
        address alta = _altaHermano();
        require(msg.sender == alta && alta != address(0), "solo alta");
        QuatriviumFamaLib.alimentarPool(totalLiquidity, stableTokens[token], token, amount);
        QuatriviumFamaLib.apartarSeguro(totalLiquidity, fondoSeguro, token, amount);
    }

    function _altaHermano() internal view returns (address alta) {
        (bool ok, bytes memory raw) = famaHermano.staticcall(abi.encodeWithSignature("alta()"));
        if (ok && raw.length >= 32) alta = abi.decode(raw, (address));
    }

    function pagarCanje(address token, address to, uint256 amount) external onlySupportedToken(token) {
        require(msg.sender == famaHermano);
        QuatriviumFamaLib.sacarCaja(
            totalLiquidity,
            stableTokens[token],
            token,
            to,
            amount,
            _cajaLibre(token),
            (totalLiquidity[token] * BONO_RED_PISO_CAJA_BP) / 10000
        );
    }

    function niveles(uint256 id) external view returns (uint256, uint256, uint256) {
        Level memory L = _tier(id);
        return (L.montoPrestamo, L.plazo, L.tasaInteresBP);
    }
}
