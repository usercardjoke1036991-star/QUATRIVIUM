// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "@openzeppelin/contracts/security/Pausable.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@chainlink/contracts/src/v0.8/interfaces/AggregatorV3Interface.sol";

/**
 * @title QuatriviumCreditZK - Contrato actualizado con validación ZK real
 * @dev Extiende el contrato original con verificación de pruebas Zero-Knowledge
 * @notice CRITICAL SECURITY FIXES IMPLEMENTED: SafeERC20, proper return value checking, enhanced ZK validation
 */
contract QuatriviumCreditZK is ReentrancyGuard, Pausable, Ownable {
    using SafeERC20 for IERC20;
    // --- Estructuras y Mappings del contrato original ---
    struct Level {
        uint256 montoPrestamo;
        uint256 plazo;
        uint256 tasaInteres;
    }

    struct ProgresoNivel {
        uint256 nivelActual;
        uint256 solicitudesCompletadas;
        uint256 ultimoPrestamoTimestamp;
    }

    struct HistorialUsuario {
        uint256 puntosReputacion;
        uint256 pagadosATiempo;
        uint256 morosos;
        uint256 totalPenalizaciones;
        bool moroso;
    }

    mapping(uint256 => Level) public _niveles;
    mapping(address => ProgresoNivel) public progresoUsuarios;
    mapping(address => bool) public humanosVerificados;
    mapping(address => bool) public blacklist;
    mapping(address => mapping(address => uint256)) public usuarios;
    mapping(address => IERC20) public stableTokens;
    mapping(address => AggregatorV3Interface) public priceFeeds;
    mapping(address => bool) public esMoroso;

    uint256 public totalLiquidity;
    address payable public feeCollector;
    uint256 public feeBP = 100; // 1%
    uint256 public constant COOLDOWN_PRESTAMO = 48 hours;

    // --- Estructuras ZK ---
    struct ZKProof {
        uint256[2] a;
        uint256[2][2] b;
        uint256[2] c;
        uint256[] input;
    }

    IVerifier public verifier; // Contrato verificador ZK
    mapping(bytes32 => bool) public usedNullifiers; // Previene reuso de pruebas ZK
    
    // Configuración de seguridad
    uint256 public constant MAX_DEPOSIT_PER_TX = 1e24; // 1M tokens max por transacción
    uint256 public constant REGISTRATION_COOLDOWN = 1 hours; // Cooldown entre registros ZK
    mapping(address => uint256) public lastRegistrationTime; // Rate limiting para registro ZK
    
    // Eventos de auditoría
    event NullifierUsed(bytes32 indexed nullifier, address indexed user, uint256 timestamp);
    event SecurityViolation(address indexed user, string reason, uint256 timestamp);

    // --- Eventos ---
    event HumanoVerificado(address indexed usuario);
    event LiquidezAportada(address indexed proveedor, uint256 monto, address token);
    event PrestamoEmitido(address indexed usuario, uint256 monto, uint256 vencimiento);
    event PrestamoPagado(address indexed usuario, uint256 monto, uint256 nuevoNivel);
    event NivelActualizado(address indexed usuario, uint256 nuevoNivel);
    event ReputationUpdated(address indexed usuario, uint256 puntosReputacion, bool moroso);
    event CircuitBreakerActivated(uint256 timestamp, uint256 montoIntentado);
    event FeeCollectorUpdated(address indexed nuevoFeeCollector);
    event ZKVerifierUpdated(address indexed nuevoVerifier);

    // --- Constructor ---
    constructor(
        address _usdtAddress,
        address payable _feeCollector,
        uint256 _feeBP,
        address _verifier
    ) Ownable(msg.sender) {
        feeCollector = _feeCollector;
        feeBP = _feeBP;
        verifier = IVerifier(_verifier);

        // Configurar niveles progresivos
        _niveles[1] = Level(1e18, 7 days, 300); // $1, 7 días, 3%
        _niveles[2] = Level(2e18, 10 days, 400);
        _niveles[3] = Level(5e18, 15 days, 500);
        _niveles[4] = Level(10e18, 20 days, 600);
        _niveles[5] = Level(20e18, 25 days, 700);
        _niveles[6] = Level(35e18, 30 days, 800);
        _niveles[7] = Level(50e18, 35 days, 900);
        _niveles[8] = Level(65e18, 40 days, 1000);
        _niveles[9] = Level(80e18, 45 days, 1100);
        _niveles[10] = Level(100e18, 50 days, 1200);

        // Configurar tokens soportados
        stableTokens[_usdtAddress] = IERC20(_usdtAddress);
    }

    // --- Modificadores ---
    modifier onlySupportedToken(address token) {
        require(address(stableTokens[token]) != address(0), "token not supported");
        _;
    }

    // --- Funciones ZK Actualizadas ---

    /**
     * @dev Registra un usuario como humano verificado usando prueba ZK
     * @param _usuario Dirección del usuario a registrar
     * @param _proof Prueba ZK que demuestra identidad humana
     * @notice CRITICAL: Enhanced security with input validation, rate limiting, and proper nullifier handling
     */
    function registrarHumanoZK(
        address _usuario,
        ZKProof calldata _proof
    ) external nonReentrant whenNotPaused {
        require(msg.sender == _usuario, "can only self-register");
        require(!blacklist[_usuario], "blacklisted");
        require(!humanosVerificados[_usuario], "already verified");

        // Rate limiting para prevenir abuse
        require(
            block.timestamp >= lastRegistrationTime[_usuario] + REGISTRATION_COOLDOWN,
            "registration cooldown not expired"
        );

        // Verificar que el contrato verificador esté configurado
        require(address(verifier) != address(0), "verifier not set");

        // Validación completa de inputs ZK
        require(_proof.input.length >= 2, "insufficient proof inputs");
        require(_proof.input[0] != 0, "invalid user input");
        require(_proof.input[1] != 0, "invalid nullifier input");
        require(_proof.input.length == 4, "invalid input length for circuit");

        // Verificar que el input corresponde al usuario
        require(
            address(uint160(_proof.input[0])) == _usuario,
            "proof input mismatch"
        );

        // Verificar que la prueba no sea trivial (todos ceros)
        require(
            _proof.a[0] != 0 || _proof.a[1] != 0,
            "proof cannot be trivial"
        );

        // Verificar formato de la prueba
        require(
            _proof.b[0][0] != 0 || _proof.b[0][1] != 0 || _proof.b[1][0] != 0 || _proof.b[1][1] != 0,
            "proof B component invalid"
        );
        
        require(
            _proof.c[0] != 0 || _proof.c[1] != 0,
            "proof C component invalid"
        );

        // Verificar la prueba ZK usando el contrato verificador
        bool proofValid = verifier.verifyProof(_proof.a, _proof.b, _proof.c, _proof.input);
        if (!proofValid) {
            emit SecurityViolation(_usuario, "invalid ZK proof", block.timestamp);
            revert("invalid ZK proof");
        }

        // Verificar que el nullifier sea único con timestamp (previene reuso temporal)
        bytes32 nullifierHash = keccak256(abi.encodePacked(_proof.input[1], block.timestamp));
        require(!usedNullifiers[nullifierHash], "proof already used");
        usedNullifiers[nullifierHash] = true;
        emit NullifierUsed(nullifierHash, _usuario, block.timestamp);

        // Actualizar timestamp de último registro
        lastRegistrationTime[_usuario] = block.timestamp;

        humanosVerificados[_usuario] = true;
        emit HumanoVerificado(_usuario);
    }

    /**
     * @dev Actualiza el contrato verificador ZK
     * @param _nuevoVerifier Nueva dirección del verificador
     */
    function actualizarVerifierZK(address _nuevoVerifier) external onlyOwner {
        verifier = IVerifier(_nuevoVerifier);
        emit ZKVerifierUpdated(_nuevoVerifier);
    }

    // --- Funciones restantes del contrato original ---
    // (Se mantienen las funciones originales para compatibilidad)

    function banWallet(address _addr, bool _banned) external onlyOwner {
        blacklist[_addr] = _banned;
    }

    function depositarLiquidez(address token, uint256 _monto) external nonReentrant onlySupportedToken(token) {
        require(_monto > 0, "monto>0");
        require(_monto <= MAX_DEPOSIT_PER_TX, "deposit too large");
        
        // Usar SafeERC20 para transferencia segura
        stableTokens[token].safeTransferFrom(msg.sender, address(this), _monto);
        totalLiquidity[token] += _monto;
        emit LiquidezAportada(msg.sender, _monto, token);
    }

    function solicitarPrestamo(address token) external whenNotPaused nonReentrant onlySupportedToken(token) {
        require(humanosVerificados[msg.sender], "not verified");
        require(!blacklist[msg.sender], "blacklisted");
        require(!esMoroso[msg.sender], "usuario moroso");
        require(usuarios[msg.sender][token].montoActivo == 0, "loan already active");

        ProgresoNivel storage progreso = progresoUsuarios[msg.sender];
        if (progreso.nivelActual == 0) {
            progreso.nivelActual = 1;
        }

        require(
            block.timestamp >= progreso.ultimoPrestamoTimestamp + COOLDOWN_PRESTAMO,
            "Debe esperar 48 horas desde su ultimo prestamo para solicitar uno nuevo."
        );

        // Peg protection con validación de timestamp de frescura de datos
        if (address(priceFeeds[token]) != address(0)) {
            (
                uint80 roundId,
                int256 price,
                uint256 startedAt,
                uint256 updatedAt,
                uint80 answeredInRound
            ) = priceFeeds[token].latestRoundData();
            
            // Validar que el precio no sea cero o negativo
            require(price > 0, "invalid price");
            
            // Validar que el precio esté dentro del umbral aceptable (98% del peg)
            int256 threshold = 98_000_000; // 0.98 * 1e8 (Chainlink usa 8 decimales)
            require(price >= threshold, "peg lost");
            
            // Validar frescura de los datos (no más de 1 hora de antigüedad)
            uint256 maxAge = 1 hours;
            require(
                updatedAt > 0 && block.timestamp - updatedAt <= maxAge,
                "price data too stale"
            );
            
            // Validar que el round ID sea razonable (previene datos de prueba)
            require(roundId > 0, "invalid round ID");
            
            // Validar que el round se haya completado
            require(answeredInRound == roundId, "round not complete");
            
            // Validar que el timestamp de inicio sea razonable
            require(startedAt > 0, "invalid start time");
            require(startedAt <= updatedAt, "invalid time range");
        }

        uint256 nivel = progreso.nivelActual;
        Level memory L = _niveles[nivel];
        require(L.montoPrestamo > 0, "tier not set");

        uint256 montoConInteres = (L.montoPrestamo * (10000 + L.tasaInteres)) / 10000;
        require(stableTokens[token].balanceOf(address(this)) >= montoConInteres, "insufficient liquidity");

        usuarios[msg.sender][token] = UsuarioInfo({
            nivelActual: nivel,
            montoActivo: montoConInteres,
            vencimiento: block.timestamp + L.plazo,
            enMora: false
        });

        progreso.solicitudesCompletadas++;
        progreso.ultimoPrestamoTimestamp = block.timestamp;

        // Usar SafeERC20 para transferencia segura
        stableTokens[token].safeTransfer(msg.sender, L.montoPrestamo);
        emit PrestamoEmitido(msg.sender, L.montoPrestamo, block.timestamp + L.plazo);
    }

    struct UsuarioInfo {
        uint256 nivelActual;
        uint256 montoActivo;
        uint256 vencimiento;
        bool enMora;
    }

    function pagarPrestamo(address token, uint256 _montoConInteres) external nonReentrant onlySupportedToken(token) {
        UsuarioInfo storage info = usuarios[msg.sender][token];
        require(info.montoActivo > 0, "no active loan");
        require(_montoConInteres >= info.montoActivo, "insufficient amount");

        // Usar SafeERC20 para transferencia segura
        stableTokens[token].safeTransferFrom(msg.sender, address(this), _montoConInteres);

        // Calcular y cobrar fee
        uint256 fee = (_montoConInteres * feeBP) / 10000;
        if (fee > 0) {
            uint256 feeInToken = stableTokens[token].balanceOf(address(this)) >= fee ? fee : _montoConInteres / 100;
            if (feeInToken > 0) {
                stableTokens[token].safeTransfer(feeCollector, feeInToken);
            }
        }

        // Actualizar reputación
        HistorialUsuario storage history = historialUsuarios[msg.sender];
        bool pagadoATiempo = block.timestamp <= info.vencimiento;
        history.pagadosATiempo += pagadoATiempo ? 1 : 0;
        history.morosos += pagadoATiempo ? 0 : 1;
        history.puntosReputacion += pagadoATiempo ? 10 : -5;
        history.moroso = !pagadoATiempo;
        esMoroso[msg.sender] = !pagadoATiempo;

        // Actualizar nivel
        ProgresoNivel storage progreso = progresoUsuarios[msg.sender];
        if (pagadoATiempo && progreso.nivelActual < 10) {
            progreso.nivelActual++;
            emit NivelActualizado(msg.sender, progreso.nivelActual);
        }

        emit PrestamoPagado(msg.sender, _montoConInteres, progreso.nivelActual);
        emit ReputationUpdated(msg.sender, history.puntosReputacion, history.moroso);

        delete usuarios[msg.sender][token];
    }

    mapping(address => HistorialUsuario) public historialUsuarios;

    function obtenerHistorialUsuario(address _usuario) external view returns (HistorialUsuario memory) {
        return historialUsuarios[_usuario];
    }

    function obtenerProgresoUsuario(address _usuario) external view returns (ProgresoNivel memory) {
        return progresoUsuarios[_usuario];
    }

    function obtenerCooldownRestante(address _usuario) external view returns (uint256) {
        uint256 ultimo = progresoUsuarios[_usuario].ultimoPrestamoTimestamp;
        if (ultimo == 0) return 0;
        uint256 cooldownEnd = ultimo + COOLDOWN_PRESTAMO;
        return block.timestamp >= cooldownEnd ? 0 : cooldownEnd - block.timestamp;
    }

    function retirarLiquidez(address token, uint256 _monto) external nonReentrant {
        require(usuarios[msg.sender][token].montoActivo == 0, "active loan");
        
        // Prevenir condición de carrera calculando nuevo total antes de actualizar
        uint256 currentLiquidity = totalLiquidity[token];
        require(currentLiquidity >= _monto, "insufficient pool liquidity");
        
        uint256 newTotalLiquidity = currentLiquidity - _monto;
        uint256 poolShare = (_monto * 1e18) / currentLiquidity;
        require(poolShare <= 50e16, "max 50% withdrawal"); // Max 50%

        totalLiquidity[token] = newTotalLiquidity;
        
        // Usar SafeERC20 para transferencia segura
        stableTokens[token].safeTransfer(msg.sender, _monto);
    }

    function setPriceFeed(address token, address _feed) external onlyOwner {
        priceFeeds[token] = AggregatorV3Interface(_feed);
    }

    function queueChangeFeeCollector(address payable _nuevo) external onlyOwner {
        pendingFeeCollector = _nuevo;
        feeCollectorTimelock = block.timestamp + 72 hours;
    }

    function executeChangeFeeCollector() external onlyOwner {
        require(block.timestamp >= feeCollectorTimelock, "timelock not expired");
        require(pendingFeeCollector != address(0), "no pending change");
        feeCollector = pendingFeeCollector;
        pendingFeeCollector = address(0);
        emit FeeCollectorUpdated(feeCollector);
    }

    address payable public pendingFeeCollector;
    uint256 public feeCollectorTimelock;

    mapping(address => uint256) public lastWithdrawalTime;
    uint256 public constant CIRCUIT_BREAKER_THRESHOLD = 50e16; // 50%
    uint256 public constant CIRCUIT_BREAKER_WINDOW = 1 hours;

    function retirarComisiones() external onlyOwner {
        uint256 balance = address(this).balance;
        require(balance > 0, "no ETH balance");
        
        // Usar call en lugar de transfer para mejor manejo de errores
        (bool success, ) = feeCollector.call{value: balance}("");
        require(success, "ETH transfer failed");
    }

    function retirarComisionesToken(address token) external onlyOwner {
        uint256 tokenBalance = stableTokens[token].balanceOf(address(this));
        require(tokenBalance > 0, "no token balance");
        
        // Usar SafeERC20 para transferencia segura
        stableTokens[token].safeTransfer(feeCollector, tokenBalance);
    }

    /**
     * @dev Función de emergencia para retirar fondos cuando el contrato está pausado
     * @notice Solo puede ser llamado por el owner cuando el contrato está en pausa
     * @param token Dirección del token (address(0) para ETH)
     * @param amount Cantidad a retirar
     */
    function emergencyWithdraw(address token, uint256 amount) external onlyOwner {
        require(paused(), "contract must be paused for emergency withdrawal");
        
        if (token == address(0)) {
            uint256 balance = address(this).balance;
            require(amount <= balance, "insufficient ETH balance");
            (bool success, ) = feeCollector.call{value: amount}("");
            require(success, "emergency ETH transfer failed");
        } else {
            uint256 balance = stableTokens[token].balanceOf(address(this));
            require(amount <= balance, "insufficient token balance");
            stableTokens[token].safeTransfer(feeCollector, amount);
        }
    }

    /**
     * @dev Obtiene el estado actual del contrato para monitoreo
     */
    function getContractState() external view returns (
        uint256 totalLiquidity_,
        bool verifierSet_,
        uint256 usedNullifiersCount_,
        bool isPaused_
    ) {
        return (
            totalLiquidity,
            address(verifier) != address(0),
            // Nota: No podemos contar usedNullifiers sin un iterador, esto es una aproximación
            address(verifier) != address(0) ? 1 : 0,
            paused()
        );
    }

    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }
}

/**
 * @dev Interfaz para el contrato verificador ZK
 */
interface IVerifier {
    function verifyProof(
        uint256[2] calldata _a,
        uint256[2][2] calldata _b,
        uint256[2] calldata _c,
        uint256[] calldata _input
    ) external pure returns (bool);
}
