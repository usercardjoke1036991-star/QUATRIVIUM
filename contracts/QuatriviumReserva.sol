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
 *         Gobernanza: guardianes 2-de-N (como Credit) + timelock 72h. Sin pausa ni attester.
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
    uint256 public constant MAX_GUARDIANES = 3;

    IERC20 public immutable token;
    address public owner;
    address public fundador;
    address public credit;
    address public famaCaja;
    address public pendienteOwner;
    uint256 public pendienteOwnerDesde;
    address public pendienteOwnerProposer;
    bool public ownerCambioConfirmado;
    address public pendienteCredit;
    uint256 public pendienteCreditDesde;
    address public pendienteCreditProposer;
    address public pendienteFundador;
    uint256 public pendienteFundadorDesde;
    address public pendienteFundadorProposer;
    uint256 public bote;
    address public altaFuente;
    uint256 public totalBloqueado;
    address public pendienteRetiroA;
    uint256 public pendienteRetiroMonto;
    uint256 public pendienteRetiroDesde;
    address public pendienteRetiroProposer;
    address public pendienteFamaCaja;
    uint256 public pendienteFamaCajaDesde;
    address public pendienteFamaCajaProposer;
    address public pendienteGuardian;
    uint256 public pendienteGuardianDesde;
    address public pendienteGuardianProposer;
    address public reanudaBoostProposer;
    bool public boostPausado;
    uint256 public boostDiaAcumulado;
    uint256 public boostDiaInicio;

    address[] public guardianList;
    mapping(address => bool) public isGuardian;

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

    error SoloOwner();
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
    error GuardianLleno();

    event Bloqueado(address indexed usuario, uint256 monto, uint256 desbloqueo);
    event Desbloqueado(address indexed usuario, uint256 principal, uint256 rendimiento, uint256 corteFundador);
    event Renovado(address indexed usuario, uint256 principal, uint256 rendimiento, uint256 corteFundador);
    event BoteAportado(address indexed de, uint256 monto);
    event BoteRetirado(address indexed a, uint256 monto);
    event BoostComision(address indexed beneficiario, uint256 montoBase, uint256 extra, uint256 corteFundador);
    event FundadorCambiado(address indexed next);
    event CreditCambiado(address indexed next);
    event GuardianAgregado(address indexed next);
    event BoostPausa(bool cerrado);

    modifier onlyGuardian() {
        if (!isGuardian[msg.sender]) revert SoloAdmin();
        _;
    }

    modifier onlyEOA() {
        if (tx.origin != msg.sender) revert SoloEOA();
        _;
    }

    constructor(address token_, address fundador_, address credit_, address famaCaja_) {
        if (token_ == address(0) || fundador_ == address(0) || credit_ == address(0)) revert DestinoCero();
        token = IERC20(token_);
        owner = msg.sender;
        fundador = fundador_;
        credit = credit_;
        famaCaja = famaCaja_;
        isGuardian[msg.sender] = true;
        guardianList.push(msg.sender);
    }

    function guardianes() external view returns (uint256) {
        return guardianList.length;
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

    function techoRendimiento(uint256 principal, uint256 elapsed) public view returns (uint256) {
        if (elapsed > LOCK) elapsed = LOCK;
        return (principal * apyHoyBps() * elapsed) / (10000 * YEAR);
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
        if (msg.sender != owner && !_esOwnerCredit() && !_esAdminCredit()) revert SoloAdmin();
        if (monto == 0) revert MontoCero();
        token.safeTransferFrom(msg.sender, address(this), monto);
        bote += monto;
        emit BoteAportado(msg.sender, monto);
    }

    function setAltaFuente(address next) external {
        if (msg.sender != owner) revert SoloOwner();
        if (altaFuente != address(0) || next == address(0)) revert DestinoCero();
        altaFuente = next;
    }

    function onAlta(uint256 monto) external {
        if (msg.sender != altaFuente) revert SoloAdmin();
        if (monto == 0) revert MontoCero();
        bote += monto;
        if (token.balanceOf(address(this)) < totalBloqueado + bote) revert NadaQueMover();
        emit BoteAportado(msg.sender, monto);
    }

    function proponerRetiroBote(address a, uint256 monto) external onlyGuardian {
        if (a == address(0) || monto == 0 || monto > bote) revert MontoCero();
        pendienteRetiroA = a;
        pendienteRetiroMonto = monto;
        pendienteRetiroDesde = block.timestamp;
        pendienteRetiroProposer = msg.sender;
    }

    function applyRetiroBote() external onlyGuardian {
        if (pendienteRetiroA == address(0) || pendienteRetiroDesde == 0) revert NadaQueMover();
        _exigirQuorum(pendienteRetiroProposer, pendienteRetiroDesde);
        uint256 monto = pendienteRetiroMonto;
        address a = pendienteRetiroA;
        if (monto == 0 || monto > bote) revert NadaQueMover();
        pendienteRetiroA = address(0);
        pendienteRetiroMonto = 0;
        pendienteRetiroDesde = 0;
        pendienteRetiroProposer = address(0);
        bote -= monto;
        token.safeTransfer(a, monto);
        emit BoteRetirado(a, monto);
    }

    function setFamaCaja(address next) external onlyGuardian {
        if (next == address(0)) revert DestinoCero();
        pendienteFamaCaja = next;
        pendienteFamaCajaDesde = block.timestamp;
        pendienteFamaCajaProposer = msg.sender;
    }

    function applyFamaCaja() external onlyGuardian {
        if (pendienteFamaCaja == address(0) || pendienteFamaCajaDesde == 0) revert NadaQueMover();
        _exigirQuorum(pendienteFamaCajaProposer, pendienteFamaCajaDesde);
        famaCaja = pendienteFamaCaja;
        pendienteFamaCaja = address(0);
        pendienteFamaCajaDesde = 0;
        pendienteFamaCajaProposer = address(0);
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
        if (boostPausado) revert BoostCerrado();
        if (msg.sender != credit) revert NoAutorizado();
        if (beneficiario == address(0) || montoBase == 0 || salt == bytes32(0)) revert MontoCero();
        bytes32 id = boostIdOf(beneficiario, montoBase, salt);
        if (boostUsado[id]) revert YaPagado();
        if (lastBoostAt[beneficiario] != 0 && block.timestamp < lastBoostAt[beneficiario] + BOOST_GAP) {
            revert YaPagado();
        }

        (uint256 extra, uint256 founderCut) = extraComisionDe(beneficiario, montoBase);
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
        extra = (montoBase * boostRedBp(t)) / 10000;
        uint256 tope = (p.principal * boostRedBp(t)) / 10000;
        uint256 ya = boostPagado[beneficiario];
        if (ya >= tope) return (0, 0);
        uint256 room = tope - ya;
        if (extra > room) extra = room;
        founderCut = (extra * corteFundadorBp(t)) / 10000;
    }

    function addGuardian(address next) external onlyGuardian {
        if (next == address(0)) revert DestinoCero();
        if (isGuardian[next] || next == pendienteGuardian) revert YaPagado();
        if (guardianList.length >= MAX_GUARDIANES) revert GuardianLleno();
        pendienteGuardian = next;
        pendienteGuardianDesde = block.timestamp;
        pendienteGuardianProposer = msg.sender;
    }

    function applyGuardian() external onlyGuardian {
        if (pendienteGuardian == address(0) || pendienteGuardianDesde == 0) revert NadaQueMover();
        _exigirQuorum(pendienteGuardianProposer, pendienteGuardianDesde);
        address next = pendienteGuardian;
        if (isGuardian[next]) revert YaPagado();
        if (guardianList.length >= MAX_GUARDIANES) revert GuardianLleno();
        isGuardian[next] = true;
        guardianList.push(next);
        pendienteGuardian = address(0);
        pendienteGuardianDesde = 0;
        pendienteGuardianProposer = address(0);
        emit GuardianAgregado(next);
    }

    function setFundador(address next) external onlyGuardian {
        if (next == address(0)) revert DestinoCero();
        pendienteFundador = next;
        pendienteFundadorDesde = block.timestamp;
        pendienteFundadorProposer = msg.sender;
    }

    function applyFundador() external onlyGuardian {
        if (pendienteFundador == address(0) || pendienteFundadorDesde == 0) revert NadaQueMover();
        _exigirQuorum(pendienteFundadorProposer, pendienteFundadorDesde);
        fundador = pendienteFundador;
        pendienteFundador = address(0);
        pendienteFundadorDesde = 0;
        pendienteFundadorProposer = address(0);
        emit FundadorCambiado(fundador);
    }

    function setCredit(address next) external onlyGuardian {
        if (next == address(0)) revert DestinoCero();
        pendienteCredit = next;
        pendienteCreditDesde = block.timestamp;
        pendienteCreditProposer = msg.sender;
    }

    function applyCredit() external onlyGuardian {
        if (pendienteCredit == address(0) || pendienteCreditDesde == 0) revert NadaQueMover();
        _exigirQuorum(pendienteCreditProposer, pendienteCreditDesde);
        credit = pendienteCredit;
        pendienteCredit = address(0);
        pendienteCreditDesde = 0;
        pendienteCreditProposer = address(0);
        emit CreditCambiado(credit);
    }

    function setOwner(address next) external onlyGuardian {
        if (next == address(0)) revert DestinoCero();
        pendienteOwner = next;
        pendienteOwnerDesde = block.timestamp;
        pendienteOwnerProposer = msg.sender;
        ownerCambioConfirmado = guardianList.length < 2;
    }

    function confirmOwner() external onlyGuardian {
        if (pendienteOwner == address(0)) revert NadaQueMover();
        if (msg.sender == pendienteOwnerProposer) revert MismaLlave();
        ownerCambioConfirmado = true;
    }

    function acceptOwner() external {
        if (msg.sender != pendienteOwner) revert SoloOwner();
        if (!ownerCambioConfirmado) revert NoAutorizado();
        if (pendienteOwnerDesde == 0 || block.timestamp < pendienteOwnerDesde + CAMBIO_ESPERA) {
            revert EsperaTimelock();
        }
        if (!isGuardian[msg.sender]) {
            if (guardianList.length >= MAX_GUARDIANES) revert GuardianLleno();
            isGuardian[msg.sender] = true;
            guardianList.push(msg.sender);
        }
        owner = pendienteOwner;
        pendienteOwner = address(0);
        pendienteOwnerDesde = 0;
        pendienteOwnerProposer = address(0);
        ownerCambioConfirmado = false;
    }

    function pausarBoost() external {
        if (!isGuardian[msg.sender] && !_esAdminCredit()) revert SoloAdmin();
        boostPausado = true;
        reanudaBoostProposer = address(0);
        emit BoostPausa(true);
    }

    function reanudarBoost() external onlyGuardian {
        if (guardianList.length >= 2) {
            if (reanudaBoostProposer == address(0)) {
                reanudaBoostProposer = msg.sender;
                return;
            }
            if (msg.sender == reanudaBoostProposer) revert MismaLlave();
            reanudaBoostProposer = address(0);
        }
        boostPausado = false;
        emit BoostPausa(false);
    }

    function _esOwnerCredit() internal view returns (bool) {
        (bool ok, bytes memory data) = credit.staticcall(abi.encodeWithSignature("owner()"));
        if (!ok || data.length < 32) return false;
        return abi.decode(data, (address)) == msg.sender;
    }

    function _esAdminCredit() internal view returns (bool) {
        (bool ok, bytes memory data) = credit.staticcall(abi.encodeWithSignature("admins(address)", msg.sender));
        if (!ok || data.length < 32) return false;
        return abi.decode(data, (bool));
    }

    function _exigirQuorum(address proposer, uint256 desde) internal view {
        if (desde == 0 || block.timestamp < desde + CAMBIO_ESPERA) revert EsperaTimelock();
        if (guardianList.length >= 2 && msg.sender == proposer) revert MismaLlave();
    }

    function _consumirTopeDia(uint256 extra) internal {
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
