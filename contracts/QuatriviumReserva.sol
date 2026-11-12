// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

interface IFamaPoolPay {
    function pagarDesdePool(address to, uint256 amount) external;
}

interface IQuatriviumCreditView {
    function redGenealogica(address usuario) external view returns (address padre, bool bonoActivacionCobrado);
    function esMoroso(address usuario) external view returns (bool);
    function obtenerProgresoUsuario(address usuario)
        external
        view
        returns (uint256 nivelActual, uint256 solicitudesCompletadas, uint256 ultimoPrestamoTimestamp);
    function admins(address) external view returns (bool);
}

/**
 * @title QuatriviumReserva
 * @notice Hermano del crédito: bloqueo de LUSD 30 días con techo de 12% anual.
 *         El principal vuelve. El rendimiento sale de un bote aparte, no del pool de préstamos.
 *         Gobernanza: 3 admins, quórum 2 y 72 h. Nadie retira el bote. Sin owner ni guardianes.
 *         EIP-170: no vive en Credit.
 */
contract QuatriviumReserva is ReentrancyGuard {
    using SafeERC20 for IERC20;

    uint256 public constant LOCK = 30 days;
    uint256 public constant MAX_APY_BP = 1200;
    uint256 public constant YEAR = 365 days;
    uint256 public constant TRAMO_MEDIO = 50e18;
    uint256 public constant TRAMO_ALTO = 500e18;
    uint256 public constant NIVEL_MINIMO = 10;
    uint256 public constant CAMBIO_ESPERA = 72 hours;
    uint256 public constant BOOST_GAP = 1 days;
    uint256 public constant BOOST_DIA_TOPE = 50e18;
    uint256 public constant MAX_ADMINS = 3;

    IERC20 public immutable token;
    address public immutable fundador;
    address public immutable credit;
    address public immutable famaCaja;
    uint256 public bote;
    address public immutable altaFuente;
    uint256 public totalBloqueado;
    uint256 public boostDiaAcumulado;
    uint256 public boostDiaInicio;

    mapping(address => bool) public admins;
    address[] public adminList;
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

    struct Posicion {
        uint256 principal;
        uint256 desde;
        bool activa;
        bool enRed;
    }

    mapping(address => Posicion) public posiciones;
    mapping(address => uint256) public boostPagado;
    mapping(bytes32 => bool) public boostUsado;
    mapping(address => uint256) public lastBoostAt;

    error NoAutorizado();
    error SoloEOA();
    error MontoCero();
    error PeriodoActivo();
    error NadaQueMover();
    error AunBloqueado();
    error EnMora();
    error DestinoCero();
    error YaPagado();
    error NivelInsuficiente();
    error SoloAdmin();
    error EsperaTimelock();
    error MismaLlave();
    error TopeDiario();
    error BoostCerrado();
    error Quorum();

    event Bloqueado(address indexed usuario, uint256 monto, uint256 desbloqueo);
    event Desbloqueado(address indexed usuario, uint256 principal, uint256 rendimiento, uint256 corteFundador);
    event Renovado(address indexed usuario, uint256 principal, uint256 rendimiento, uint256 corteFundador);
    event BoteAportado(address indexed de, uint256 monto);
    event BoostComision(address indexed beneficiario, uint256 montoBase, uint256 extra, uint256 corteFundador);
    event AdminAdded(address indexed admin);
    event AdminRemoved(address indexed admin);

    modifier onlyAdmin() {
        if (!admins[msg.sender]) revert SoloAdmin();
        _;
    }

    modifier onlyEOA() {
        if (tx.origin != msg.sender) revert SoloEOA();
        _;
    }

    constructor(
        address token_,
        address fundador_,
        address credit_,
        address famaCaja_,
        address alta_,
        address[] memory admins_
    ) {
        if (token_ == address(0) || fundador_ == address(0) || credit_ == address(0) || alta_ == address(0)) {
            revert DestinoCero();
        }
        if (admins_.length != MAX_ADMINS) revert Quorum();
        token = IERC20(token_);
        fundador = fundador_;
        credit = credit_;
        famaCaja = famaCaja_;
        altaFuente = alta_;
        requiredConfirmations = 2;
        for (uint256 i = 0; i < admins_.length; i++) {
            if (admins_[i] == address(0) || admins[admins_[i]]) revert DestinoCero();
            admins[admins_[i]] = true;
            adminList.push(admins_[i]);
        }
        allowedAdminSelector[this.addAdmin.selector] = true;
        allowedAdminSelector[this.removeAdmin.selector] = true;
    }

    function tramo(uint256 principal) public pure returns (uint256) {
        if (principal >= TRAMO_ALTO) return 3;
        if (principal >= TRAMO_MEDIO) return 2;
        return 1;
    }

    function boostRedBp(uint256 t) public pure returns (uint256) {
        if (t == 3) return 2000;
        if (t == 2) return 1000;
        return 0;
    }

    function corteFundadorBp(uint256 t) public pure returns (uint256) {
        if (t == 3) return 1200;
        if (t == 2) return 800;
        return 500;
    }

    function apyHoyBps() public view returns (uint256) {
        if (totalBloqueado == 0) return MAX_APY_BP;
        uint256 raw = (bote * 10000) / totalBloqueado;
        return raw > MAX_APY_BP ? MAX_APY_BP : raw;
    }

    function saludReserva() external view returns (uint256 bote_, uint256 bloqueado_, uint256 apyBps) {
        return (bote, totalBloqueado, apyHoyBps());
    }

    /// @notice Techo del periodo: 12 % anual. Si el bote no alcanza, el pago se recorta sin revertir.
    function techoRendimiento(uint256 principal, uint256 elapsed) public pure returns (uint256) {
        if (elapsed > LOCK) elapsed = LOCK;
        return (principal * MAX_APY_BP * elapsed) / (10000 * YEAR);
    }

    function desbloqueoDe(address usuario) public view returns (uint256) {
        Posicion memory p = posiciones[usuario];
        if (!p.activa) return 0;
        return p.desde + LOCK;
    }

    function bloquear(uint256 monto) external onlyEOA nonReentrant {
        if (monto < 1e18) revert MontoCero();
        Posicion storage p = posiciones[msg.sender];
        if (p.activa) revert PeriodoActivo();
        _exigirNuevoPeriodo();

        bool enRed = false;
        if (credit != address(0)) {
            // slither-disable-next-line unused-return // de la red solo importa el padre
            (address padre,) = IQuatriviumCreditView(credit).redGenealogica(msg.sender);
            enRed = padre != address(0);
        }

        token.safeTransferFrom(msg.sender, address(this), monto);
        posiciones[msg.sender] = Posicion(monto, block.timestamp, true, enRed);
        totalBloqueado += monto;
        boostPagado[msg.sender] = 0;
        emit Bloqueado(msg.sender, monto, block.timestamp + LOCK);
    }

    function desbloquear() external onlyEOA nonReentrant {
        (uint256 principal, uint256 userPay, uint256 founderCut) = _cerrar(false);
        emit Desbloqueado(msg.sender, principal, userPay, founderCut);
    }

    function renovar() external onlyEOA nonReentrant {
        _exigirNuevoPeriodo();
        (uint256 principal, uint256 userPay, uint256 founderCut) = _cerrar(true);
        emit Renovado(msg.sender, principal, userPay, founderCut);
    }

    function aportarBote(uint256 monto) external onlyEOA nonReentrant {
        if (monto == 0) revert MontoCero();
        token.safeTransferFrom(msg.sender, address(this), monto);
        bote += monto;
        emit BoteAportado(msg.sender, monto);
    }

    function onAlta(uint256 monto) external {
        if (msg.sender != altaFuente) revert SoloAdmin();
        if (monto == 0) revert MontoCero();
        bote += monto;
        if (token.balanceOf(address(this)) < totalBloqueado + bote) revert NadaQueMover();
        emit BoteAportado(msg.sender, monto);
    }

    function boostIdOf(address beneficiario, uint256 montoBase, bytes32 salt) public view returns (bytes32) {
        return keccak256(abi.encode(block.chainid, credit, beneficiario, montoBase, salt));
    }

    /// @notice Extra sobre una comisión de red pagada por Credit. Sale del pool, no del bote.
    ///         100% on-chain: lo invoca directamente `credit` al dispersar intereses (sin attester).
    function pagarBoostComision(address beneficiario, uint256 montoBase, bytes32 salt)
        external
        nonReentrant
    {
        if (msg.sender != credit) revert NoAutorizado();
        if (beneficiario == address(0) || montoBase == 0 || salt == bytes32(0)) revert MontoCero();
        bytes32 id = boostIdOf(beneficiario, montoBase, salt);
        if (boostUsado[id]) revert YaPagado();
        if (lastBoostAt[beneficiario] != 0 && block.timestamp < lastBoostAt[beneficiario] + BOOST_GAP) {
            revert YaPagado();
        }

        (uint256 extra, uint256 founderCut) = extraComisionDe(beneficiario, montoBase);
        // slither-disable-next-line incorrect-equality // cero es "no hay extra que mover", no un saldo
        if (extra == 0) revert NadaQueMover();
        _consumirTopeDia(extra);

        if (famaCaja == address(0)) revert DestinoCero();
        boostUsado[id] = true;
        lastBoostAt[beneficiario] = block.timestamp;
        boostPagado[beneficiario] += extra;
        uint256 userPay = extra - founderCut;
        if (userPay > 0) IFamaPoolPay(famaCaja).pagarDesdePool(beneficiario, userPay);
        if (founderCut > 0) IFamaPoolPay(famaCaja).pagarDesdePool(fundador, founderCut);
        emit BoostComision(beneficiario, montoBase, extra, founderCut);
    }

    function extraComisionDe(address beneficiario, uint256 montoBase) public view returns (uint256 extra, uint256 founderCut) {
        Posicion memory p = posiciones[beneficiario];
        if (!p.activa || montoBase == 0) return (0, 0);
        uint256 t = tramo(p.principal);
        // slither-disable-next-line divide-before-multiply // el corte se calcula sobre el extra ya redondeado
        extra = (montoBase * boostRedBp(t)) / 10000;
        uint256 tope = (p.principal * boostRedBp(t)) / 10000;
        uint256 ya = boostPagado[beneficiario];
        if (ya >= tope) return (0, 0);
        uint256 room = tope - ya;
        if (extra > room) extra = room;
        // slither-disable-next-line divide-before-multiply // el fundador cobra un corte del extra ya pagable
        founderCut = (extra * corteFundadorBp(t)) / 10000;
    }

    function proponerAdmin(bytes calldata data) external onlyAdmin returns (uint256 id) {
        if (data.length < 4 || !allowedAdminSelector[bytes4(data)]) revert NoAutorizado();
        id = ++proposalCount;
        proposals[id] = AdminProposal({
            proposer: msg.sender,
            eta: block.timestamp + CAMBIO_ESPERA,
            data: data,
            confirms: 1,
            executed: false,
            cancelled: false
        });
        confirmed[id][msg.sender] = true;
    }

    function confirmarAdmin(uint256 id) external onlyAdmin {
        AdminProposal storage p = proposals[id];
        if (p.eta == 0 || p.executed || p.cancelled || confirmed[id][msg.sender]) revert NoAutorizado();
        confirmed[id][msg.sender] = true;
        p.confirms += 1;
    }

    function _votosVigentes(uint256 id) internal view returns (uint256 n) {
        uint256 len = adminList.length;
        for (uint256 i; i < len; ++i) {
            if (confirmed[id][adminList[i]]) n += 1;
        }
    }

    function ejecutarAdmin(uint256 id) external onlyAdmin {
        AdminProposal storage p = proposals[id];
        if (p.eta == 0 || p.executed || p.cancelled) revert NadaQueMover();
        if (block.timestamp < p.eta) revert EsperaTimelock();
        if (_votosVigentes(id) < 2) revert Quorum();
        if (!allowedAdminSelector[bytes4(p.data)]) revert NoAutorizado();
        p.executed = true;
        (bool ok,) = address(this).call(p.data);
        if (!ok) revert NadaQueMover();
    }

    function addAdmin(address next) external {
        if (msg.sender != address(this)) revert SoloAdmin();
        if (next == address(0) || admins[next] || adminList.length >= MAX_ADMINS) revert DestinoCero();
        admins[next] = true;
        adminList.push(next);
        emit AdminAdded(next);
    }

    function removeAdmin(address admin) external {
        if (msg.sender != address(this)) revert SoloAdmin();
        if (!admins[admin] || adminList.length <= 2) revert Quorum();
        admins[admin] = false;
        for (uint256 i = 0; i < adminList.length; i++) {
            if (adminList[i] == admin) {
                adminList[i] = adminList[adminList.length - 1];
                adminList.pop();
                break;
            }
        }
        emit AdminRemoved(admin);
    }

    function _consumirTopeDia(uint256 extra) internal {
        // slither-disable-next-line incorrect-equality // cero significa que la ventana del dia aun no empezo
        if (boostDiaInicio == 0 || block.timestamp >= boostDiaInicio + 1 days) {
            boostDiaInicio = block.timestamp;
            boostDiaAcumulado = 0;
        }
        if (boostDiaAcumulado + extra > BOOST_DIA_TOPE) revert TopeDiario();
        boostDiaAcumulado += extra;
    }

    /// @dev Bloquear/renovar respetan mora y nivel 10. Desbloquear no, para no atrapar el principal.
    function _exigirNuevoPeriodo() internal view {
        if (credit == address(0)) return;
        IQuatriviumCreditView vista = IQuatriviumCreditView(credit);
        if (vista.esMoroso(msg.sender)) revert EnMora();
        // slither-disable-next-line unused-return // del progreso solo importa el nivel
        (uint256 nivel,,) = vista.obtenerProgresoUsuario(msg.sender);
        if (nivel < NIVEL_MINIMO) revert NivelInsuficiente();
    }

    function _cerrar(bool renovarPos) internal returns (uint256 principal, uint256 userPay, uint256 founderCut) {
        Posicion storage p = posiciones[msg.sender];
        if (!p.activa) revert NadaQueMover();
        if (block.timestamp < p.desde + LOCK) revert AunBloqueado();

        principal = p.principal;
        (userPay, founderCut) = _pagarRendimiento(p);

        if (renovarPos) {
            p.desde = block.timestamp;
            boostPagado[msg.sender] = 0;
            if (credit != address(0)) {
                // slither-disable-next-line unused-return // de la red solo importa el padre
                (address padre,) = IQuatriviumCreditView(credit).redGenealogica(msg.sender);
                p.enRed = padre != address(0);
            }
        } else {
            totalBloqueado -= principal;
            delete posiciones[msg.sender];
            delete boostPagado[msg.sender];
            token.safeTransfer(msg.sender, principal);
        }
        if (userPay > 0) token.safeTransfer(msg.sender, userPay);
        if (founderCut > 0) token.safeTransfer(fundador, founderCut);
    }

    function _pagarRendimiento(Posicion memory p) internal returns (uint256 userPay, uint256 founderCut) {
        uint256 elapsed = block.timestamp - p.desde;
        uint256 techo = techoRendimiento(p.principal, elapsed);
        uint256 t = tramo(p.principal);
        uint256 grosso = techo < bote ? techo : bote;
        founderCut = (grosso * corteFundadorBp(t)) / 10000;
        userPay = grosso - founderCut;
        if (p.enRed) {
            uint256 extra = (userPay * boostRedBp(t)) / 10000;
            uint256 leftover = bote - grosso;
            if (extra > leftover) extra = leftover;
            if (userPay + extra > techo) extra = techo - userPay;
            userPay += extra;
            grosso += extra;
        }
        bote -= grosso;
    }
}
