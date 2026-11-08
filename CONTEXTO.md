# 🧠 CONTEXTO DEL PROYECTO: Quatrivium Finance · Edición Soberana

## ¿Qué es este proyecto?
**Quatrivium Finance** es un protocolo y aplicación móvil 100% soberana e inmutable de microcrédito on-chain sin colateral sobre **Arbitrum One** (`chainId: 42161`) utilizando **Liquity USD (LUSD)** (`0x93b346b6BC2548dA6A1E7d98E9a421B42541425b`).
El usuario crea o restaura su billetera HD local BIP-39 de 24 palabras, completa el alta única de **4 LUSD** on-chain, solicita préstamos en LUSD del pool de liquidez, los paga antes del vencimiento y sube de nivel para acceder a montos mayores (hasta el nivel 1000). Si no paga, entra en mora y sus beneficios quedan bloqueados hasta regularizar.

## Tipo de proyecto
- **Stack:** React Native 0.81 · Expo 54 · React 19 · TypeScript · Solidity 0.8.24 · ethers v6
- **Tipo:** Sovereign Mobile DeFi App + Immutable Smart Contracts (Arbitrum L2)
- **Estado actual:** Arquitectura soberana completada en código (Fases 1, 2 y 3) para **Arbitrum One (`chainId: 42161`)** en Cuenta Real y **Arbitrum Sepolia (`chainId: 421614`)** en Modo Demo. Paquete Android/iOS `com.quatrivium.sovereign`, esquema deep-link `quatrivium-sovereign://`, distribución directa vía APK verificado por SHA-256.

---

## Arquitectura y estructura

```
QUATRIVIUM-main/
├── app/index.tsx                  # Pantalla principal (orquesta con hooks soberanos)
├── app/_layout.tsx                # Placeholder Expo Router (arranque real: App.js)
├── babel.config.js                # Babel / Expo
├── metro.config.js                # Metro + stub snarkjs
├── hardhat.config.cjs             # Hardhat: compilación, tests y deploy en Arbitrum One / Sepolia
├── foundry.toml                   # Foundry overlay (forge-out/forge-cache)
├── forge-test/                    # Fuzz e invariantes Foundry
├── web3Config.tsx                 # AppKit / WalletConnect (Arbitrum One 42161 y Arbitrum Sepolia 421614)
├── components/                    # UI: WalletSection, LoanTierCard, AdminPanel, SecuritySettings…
├── hooks/                         # useWeb3Balances, useWeb3Transactions, useHomeHandlers
├── services/                      # quatriviumCreditService, appWallet, appLock, movementHistory…
├── contracts/
│   ├── QuatriviumCredit.sol       # Núcleo inmutable sin Pausable ni blacklist (EIP-170 ≤ 24576 B)
│   ├── QuatriviumAlta.sol         # Hermano: alta única de 4 LUSD y bono de activación L1
│   ├── QuatriviumReserva.sol      # Hermano: bloqueo 30d en LUSD, techo 12% anual del bote
│   ├── QuatriviumFamaCaja.sol     # Hermano: fama de caja, racha y canje contra el pool
│   ├── QuatriviumLeveling.sol     # Hermano: solicitudes e hitos de nivel
│   ├── libraries/QuatriviumFamaLib.sol # Peg Chainlink LUSD/USD, bono L1, fama (delegatecall)
│   ├── interfaces/                # AggregatorV3Interface (Chainlink)
│   └── mocks/                     # ERC20Mock, MockV3Aggregator (tests y testnet)
├── test/                          # Suites Hardhat de contabilidad, soberanía, seguridad, UI e i18n
├── scripts/
│   ├── deploy-arbitrum-sovereign.cjs # Script maestro de despliegue en Arbitrum One (42161) / Sepolia (421614)
│   ├── bscNetworks.cjs            # Configuración RPC y constantes de Arbitrum One / Sepolia y LUSD
│   ├── check-i18n.mjs             # Verificador de los 17 idiomas y 1245 claves
│   ├── check-production.mjs       # Verificador de configuración soberana para CI y producción
│   └── security-check.mjs         # Verificador de seguridad estática y ausencia de secretos
├── web/
│   ├── index.html                 # Portal web soberano
│   ├── invite/index.html          # Portal de invitación deep-link quatrivium-sovereign:// + descarga APK + SHA-256
│   └── .well-known/assetlinks.json # Digital Asset Links para com.quatrivium.sovereign
├── i18n/ (17 locales)             # ar, bn, de, en, es, fr, hi, id, it, ja, ko, pt, ru, tr, ur, vi, zh
├── constants/                     # bsc.ts, rpcConfig.ts, deployedAddresses.ts, tokens.ts, loanTiers.ts
├── .env.example                   # Variables de entorno documentadas para despliegue en Arbitrum
└── eas.json                       # Perfiles de build para Arbitrum Sepolia (421614) y Arbitrum One (42161)
```

---

## Stack tecnológico
- **App:** React Native 0.81 / Expo 54 / React 19 / TypeScript (strict)
- **Web3:** ethers v6 / Reown AppKit (WalletConnect) / wagmi
- **Contratos:** Solidity 0.8.24 / OpenZeppelin v5 (`ReentrancyGuard`, `SafeERC20`) — **sin `Pausable`, sin `blacklist`, sin `attester`**
- **Red blockchain:** Arbitrum Sepolia (`chainId: 421614`) en Demo · Arbitrum One (`chainId: 42161`) en Cuenta Real
- **Stablecoin principal:** Liquity USD (`LUSD`) — `0x93b346b6BC2548dA6A1E7d98E9a421B42541425b` (18 decimales, descentralizada e inmutable)
- **Oráculo de precios:** Chainlink LUSD/USD en Arbitrum One — `0x0411D28c94d85A36bC72Cb0f875dfA8371D8fFfF`
- **Moneda de gas:** Ether (`ETH`) nativo en Arbitrum L2 (`MIN_GAS_WEI = 0.0001 ETH`)
- **Seguridad mobile:** `expo-secure-store` (AES-256-GCM) / biometría / PIN 6 dígitos / contraseña maestra / TOTP local / frase BIP-39 de 24 palabras
- **Notificaciones:** 100% locales en el dispositivo (`services/localReminders.ts`), sin servidores externos ni workers Web2
- **i18n:** 17 idiomas completos, 1245 claves verificadas con `scripts/check-i18n.mjs`, soporte RTL (árabe, urdu)

---

## Decisiones de Arquitectura Soberana
- **Inmutabilidad y Cero Censura:** Se eliminaron por completo `Pausable`, `pausarContrato()`, `despausarContrato()`, `pauseBoost()`, `blacklist`, `setBlacklist()`, `kycExigido`, `identidadExigida` y `attester`. Ningún administrador ni tercero puede congelar el protocolo ni bloquear direcciones.
- **Soberanía de Identidad:** No se solicita correo electrónico, número de teléfono (SMS/OTP) ni documentos de identidad (KYC). La única identidad del usuario es su par de llaves criptográficas BIP-39 de 24 palabras y su registro on-chain.
- **Stablecoin Inmutable (`LUSD`):** Toda la contabilidad de préstamos, pagos, donaciones, Reserva y bonos opera en `LUSD` (`0x93b346b6BC2548dA6A1E7d98E9a421B42541425b`) sobre Arbitrum One, eliminando el riesgo de congelamiento centralizado de emisores custodial.
- **Resiliencia RPC en Arbitrum One:** `constants/bsc.ts` y `constants/rpcConfig.ts` rotan automáticamente entre 5 endpoints RPC públicos independientes (`arb1.arbitrum.io`, `arbitrum-one-rpc.publicnode.com`, `1rpc.io/arb`, `arbitrum.drpc.org`, `rpc.ankr.com/arbitrum`).
- **Alta Única On-Chain de 4 LUSD (`QuatriviumAlta.pagarRegistro`):**
  - 1 LUSD a la billetera fundadora
  - 1 LUSD al bote de `QuatriviumReserva`
  - 1 LUSD de registro al pool de `QuatriviumCredit`
  - 1 LUSD apartado en `QuatriviumAlta` para quien invitó de forma directa (se libera cuando el referido paga su primer préstamo de Nivel 1; si no lo paga en 7 días, puede enviarse al pool mediante `vencerPadrinoAlPool`).
- **Pool Cerrado (`retirarLiquidez` revierte):** El capital aportado al fondo común de préstamos permanece en el contrato para respaldar la línea de crédito y no es reembolsable; aporta 100 puntos de fama de caja por cada 1 LUSD.
- **Reserva Independiente (`QuatriviumReserva`):** Instrumento separado del fondo de préstamos, disponible desde el nivel 10, con bloqueo de 30 días (mínimo 1 LUSD), devolución íntegra del principal al vencimiento y rendimiento estimado de hasta el 12% anual pagado exclusivamente desde la provisión del bote de Reserva.
- **Distribución Soberana del APK:** Paquete `com.quatrivium.sovereign` y esquema `quatrivium-sovereign://`. Se distribuye directamente mediante APK firmado y verificado con su hash SHA-256 en el portal web `web/invite/index.html`, sin depender de tiendas centralizadas.

---

## Niveles de crédito (`constants/loanTiers.ts` + `LoanTierSeed.sol` + `LoanLadder.sol`)

**1000 niveles**, desde **1 LUSD** hasta **1 000 000 LUSD**. Los niveles 1–100 se definen en tabla (`LoanTierSeed`) y los niveles 101–1000 mediante fórmula determinista (`LoanLadder`) para cumplir con el límite EIP-170 (≤ 24 576 bytes).

| Nivel | Principal (LUSD) | Plazo | Tasa Plana | Interés (LUSD) | Cuotas | Solicitudes |
|------:|-----------------:|------:|-----------:|---------------:|:------:|:------------|
| 1 | 1 LUSD | 7 días | 100% | 1.00 LUSD | 1 | 3 |
| 10 | 100 LUSD | 50 días | 34% | 34.00 LUSD | 3 | 5 |
| 11 | 120 LUSD | 50 días | 33,71% | 40.45 LUSD | 3 | 10 |
| 100 | 10 000 LUSD | 90 días | 8% | 800.00 LUSD | 3 | 455 |
| 101 | 11 100 LUSD | 90 días | 7,99% | 886.89 LUSD | 3 | 460 |
| 1000 | **1 000 000 LUSD** | 180 días | 4,06% | 40 600.00 LUSD | 12 | 4955 |

---

## Seguridad on-chain y cliente
| Protección | Estado |
|---|---|
| `ReentrancyGuard` | ✅ En todas las funciones de movimiento de fondos |
| `SafeERC20` | ✅ En todas las transferencias y aprobaciones ERC-20 |
| Sin Kill-Switches (`Pausable` / `blacklist` eliminados) | ✅ Inmutabilidad total del protocolo |
| Timelock 72h + Multisig 2-de-3 | ✅ Para parámetros administrativos permitidos |
| `tx.origin == msg.sender` | ✅ Registro, préstamo, pago, depósito y liquidación solo desde EOA |
| Oráculo Chainlink LUSD/USD | ✅ Validación de peg `>= 0.98 USD` y frescura de ronda |
| Cifrado local AES-256-GCM | ✅ Semilla BIP-39 de 24 palabras protegida en `expo-secure-store` |
| Verificación de código e i18n | ✅ `tsc --noEmit`, `check-i18n.mjs` (17 idiomas), `hardhat test` |
