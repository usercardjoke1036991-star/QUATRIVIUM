# REPORTE DE MIGRACIÓN SOBERANA — QUATRIVIUM FINANCE

**Fecha de ejecución:** Noviembre 2026  
**Red canónica de despliegue:** Arbitrum One (`chainId: 42161`)  
**Token oficial único:** LUSD (`0x93b346b6BC2548dA6A1E7d98E9a421B42541425b`, 18 decimales)  
**Oráculo de precio:** Chainlink LUSD/USD (`0x0411D28c94d85A36bC72Cb0f875dfA8371D8fFfF`)  
**Identificador de aplicación Android:** `com.quatrivium.sovereign` (`slug` / `scheme`: `quatrivium-sovereign`)

---

## 1. Resumen Ejecutivo

Este documento certifica la transformación de la base de código de microcréditos descentralizados hacia una arquitectura **100% soberana, autónoma e imparable**, eliminando por diseño:
1. Todos los kill switches administrativos (pausas de emergencia y listas negras de billeteras).
2. Toda dependencia de servidores off-chain, workers de backend, bots de Telegram y atestaciones centralizadas.
3. Todas las fricciones Web2 (KYC de terceros, verificación de SMS/correo, vinculación forzada de dispositivos).
4. El canal de actualizaciones OTA (Over-The-Air) para garantizar ejecutables APK firmados e inalterables.

---

## 2. Fase 1 — Smart Contracts (Solidity 0.8.24) y On-Chain Governance

### 2.1 Eliminación de Candados y Kill Switches
- **`contracts/QuatriviumCredit.sol`**:
  - Eliminados `pausarContrato`, `despausarContrato`, modificador `whenNotPaused` y mapping `blacklist` / `banWallet`. Nadie (ni el administrador ni el fundador) puede detener el protocolo ni congelar billeteras usuarias.
  - Eliminadas las variables y flujos centralizados de onboarding: `kycExigido`, `kycDeclarado`, `declararKyc()`, `identidadExigida`, `phoneHashOf`, `deviceHashOf`, `vincularIdentidad()`, así como la dirección `attester` y `setAttester()`.
  - El usuario interactúa directamente con su billetera: paga su Alta en `QuatriviumAlta` y puede solicitar préstamos o registrarse sin firmas de servidor.
  - **Preservación económica total**: Se conservan intactos la escalera de 1000 niveles (`LoanLadder.sol`, microcréditos de $1 a $1,000,000 LUSD), los carriles de liquidez (70% para tramos grandes, 80% para chicos), el pool bloqueado por diseño (`retirarLiquidez` revierte con `"pool locked"`), las liquidaciones de mora (`liquidate`), bonos de hitos cada 100 niveles, donaciones voluntarias, comisiones del founder (15% del interés) y la red de referidos unilevel de hasta 40 generaciones (15% / 8% / 6% / 4% / 2% / 0.8% / 0.4%).

### 2.2 Oráculo y Librería FAMA
- **`contracts/libraries/QuatriviumFamaLib.sol`**:
  - `PEG_MAX_EDAD` actualizado a **25 horas** (`90,000` segundos) para coincidir con el heartbeat de 24 horas del feed Chainlink LUSD/USD en Arbitrum One, manteniendo la comprobación de paridad (`price >= 0.98 USD`).
  - Eliminada la función `recoverAttest` y cualquier residuo de verificación de firmas criptográficas off-chain del attester.

### 2.3 QuatriviumReserva 100% On-Chain
- **`contracts/QuatriviumReserva.sol`**:
  - Mantiene `IERC20 public immutable token` (LUSD al desplegar), bloqueo mínimo de 30 días, APY dinámico hasta 12% anual y requisito de Nivel 10+.
  - **Refactorización de `pagarBoostComision`**: Eliminada la exigencia de `_esAttesterCredit()`. Ahora el boost de comisión (10% / 20% adicional para tramos 2 y 3) es liquidado de forma completamente on-chain y determinista directamente desde `QuatriviumCredit` al dispersar intereses.

### 2.4 Cumplimiento de Límites EIP-170
Todos los contratos compilados se sitúan holgadamente por debajo del límite estricto de bytecode de 24,576 bytes:
- `QuatriviumCredit`: **20,728 bytes** (holgura de 3,848 bytes).
- `QuatriviumReserva`: **10,642 bytes**.
- `QuatriviumAlta`: **3,415 bytes**.
- `QuatriviumFamaCaja`: **4,112 bytes**.
- `QuatriviumLeveling`: **3,439 bytes**.

---

## 3. Fase 2 — Cliente React Native / Expo, Desconexión Web2 y Paquete Soberano

### 3.1 Red y Parámetros en Cliente
- **Arbitrum One (`chainId: 42161`)**: Configurada como red principal indiscutible en `constants/bsc.ts`, `constants/tokens.ts`, `constants/deployedAddresses.ts`, `constants/rpcConfig.ts` y `web3Config.tsx`.
- **LUSD**: Establecido como token único de la aplicación (18 decimales).
- **Cálculo de gas L2**: Nativo en ETH con umbral mínimo `MIN_GAS_WEI = 0.0001 ETH` (`100,000,000,000,000 wei`), adaptado al bajo costo de Arbitrum.
- **RPCs públicos con alta disponibilidad**: Implementado `FallbackProvider` conectando 5 RPCs públicos independientes de Arbitrum One.

### 3.2 Eliminación de Backend y Candados Web2
- **Archivos de servidor eliminados**:
  - `scripts/notify-worker.mjs`
  - `render.yaml`, `fly.toml`, `Dockerfile.notify`, `deploy/hetzner/`
  - `scripts/deploy-notify.mjs`, `scripts/deploy-hetzner.mjs`
  - `services/notifyClient.ts`
- **Servicios y pantallas de KYC/OTP eliminados**:
  - `services/kycProvider.ts`, `services/kycDeclaration.ts`, `components/KycSection.tsx`
  - `services/accountEmail.ts`, `components/EmailOtpSection.tsx`
  - `services/accountPhone.ts`, `components/PhoneOtpSection.tsx`
  - `services/telegramBot.ts`
  - `services/accountIdentity.ts`, `services/emailOtp.ts`, `services/phoneOtp.ts`, `services/demoIdentity.ts`
- **Puertas en UI**: `utils/creditGates.ts`, `hooks/useHomeHandlers.ts`, `app/index.tsx` y `components/AccountOnboarding.tsx` fueron depurados de verificaciones de correo, SMS, KYC, device match o registro centralizado de apodos.

### 3.3 Módulos Soberanos Locales Preservados
- Billetera HD determinista BIP-39 de 24 palabras cifrada en SecureStore local (`services/appWallet.ts`).
- Bloqueo de acceso por PIN, contraseña local, biometría y TOTP local (`services/appLock.ts`).
- Enlace de código de patrocinador/padrino on-chain (`services/sponsorLock.ts`).
- Conexión e interacción con billeteras externas vía AppKit (`services/linkedWallet.ts`).
- Recordatorios de pago locales on-chain (`hooks/useLoanPaymentReminders.ts`).

### 3.4 Coexistencia Android y Desactivación de OTA
- **ID de paquete Android**: `com.quatrivium.sovereign` (permite instalarla de forma independiente en dispositivos que ya tengan instalada la versión Magno `com.quatrivium.credit`).
- **Esquema de deep linking**: `quatrivium-sovereign://`.
- **Desactivación de Expo Updates**: Eliminado `expo-updates` de `app.json`, `eas.json` y `package.json` para evitar descargas remotas no consentidas. Distribución exclusivamente por binarios APK firmados.

---

## 4. Resultados de Verificación y Testing

1. **Chequeo de tipos estático:**
   - Comando: `npx tsc --noEmit`
   - Resultado: **0 errores**.
2. **Suite de contratos e integración Hardhat:**
   - Comando: `npm test`
   - Resultado: **270 tests aprobados (0 fallos)**.
3. **Suite Foundry / Forge:**
   - Comando: `forge test`
   - Resultado: **35 tests aprobados (0 fallos)**.
4. **Total de pruebas verificadas:** **305 tests en verde**.
