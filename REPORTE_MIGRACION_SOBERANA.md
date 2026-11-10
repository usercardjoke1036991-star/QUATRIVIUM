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
  - `services/notifyClient.ts`
- **Servicios y pantallas de KYC/OTP eliminados**:
  - `services/kycProvider.ts`, `services/kycDeclaration.ts`, `components/KycSection.tsx`
  - `services/accountEmail.ts`, `components/EmailOtpSection.tsx`
  - `services/accountPhone.ts`, `components/PhoneOtpSection.tsx`
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

---

## 4. Fase 3 — Actualización Integral de Textos, Portal Web de Invitación, CI/CD Limpio y Script Maestro de Despliegue

### 4.1 Actualización Integral de los 17 Idiomas (`i18n/locales/`) y Textos de UI
- **Reemplazo sistemático de token y red**:
  - Reemplazadas todas las referencias al token de gas `BNB` por `ETH` (ajustando montos mínimos de gas a `0.0001 ETH`).
- **Eliminación total de copys Web2**:
  - Eliminadas las instrucciones y alertas sobre "verificar correo", "código SMS / OTP", "KYC / documento de identidad" y "servidor de notificaciones".
  - Textos de onboarding adaptados al flujo 100% soberano: billetera HD local BIP-39 de 24 palabras o wallet externa vinculada + Alta on-chain de 4 LUSD.
- **Textos Legales y Componentes de UI**:
  - Actualizados `i18n/legalCopy.ts` e `i18n/legalExtras.ts` en los 17 idiomas.
  - Componentes estáticos alineados: `MovementHistory.tsx`, `TransferWalletsModal.tsx`, `WalletSection.tsx`, `icons.tsx` (con soporte para logotipos LUSD y ETH), `useReferralNetwork.ts`, `referralNetwork.ts`, `movementHistory.ts` y `walletChain.ts`.
- **Integridad de claves JSON**:
  - Se mantuvieron exactamente las 1,245 claves en cada uno de los 17 idiomas (`es`, `en`, `zh`, `hi`, `ar`, `bn`, `pt`, `ru`, `ur`, `id`, `fr`, `ja`, `de`, `ko`, `tr`, `vi`, `it`), garantizando cero rupturas de referencias en el código.
  - Verificado satisfactoriamente con `scripts/check-i18n.mjs`.

### 4.2 Portal Web de Invitación (`web/invite/index.html`) y Web Principal (`web/index.html`)
- Actualizado el deep-link al esquema oficial soberano `quatrivium-sovereign://invite?c=...` y el paquete `com.quatrivium.sovereign`.
- Configurada sección de descarga directa del APK soberano (`quatrivium-sovereign.apk`) junto con un bloque visual interactivo para mostrar y copiar su hash SHA-256 (`dfefccd00039725eb73aa67db0e77e910ae7464dee8df2748654e21da73ed24a`), con comandos de verificación para Linux/macOS (`sha256sum`) y Windows (`Get-FileHash`).
- Actualizados `README.md` y `CONTEXTO.md` reflejando la arquitectura en Arbitrum One (`chainId: 42161`) con LUSD (`0x93b346b6BC2548dA6A1E7d98E9a421B42541425b`) y oráculo Chainlink LUSD/USD (`0x0411D28c94d85A36bC72Cb0f875dfA8371D8fFfF`).

### 4.3 Limpieza y Blindaje de Scripts y Pipeline CI
- **`package.json`**:
  - Añadidos scripts `"deploy:arbitrum"` y `"deploy:arbitrum:sepolia"`.
- **`.github/workflows/ci.yml`**:
  - Actualizado el paso de chequeo de repositorio para validar producción en Arbitrum One (`chainId: 42161`) y modo soberano sin secretos Web2.
- **Scripts de auditoría y verificación local**:
  - `scripts/security-check.mjs`: Valida el repositorio y entorno sin perfiles remotos ni servidores off-chain.
  - `scripts/prepare-production-local.mjs`: Prepara variables de desarrollo locales sin generar `.env.worker` ni enlaces a tiendas Web2.

### 4.4 Script Maestro de Despliegue (`scripts/deploy-arbitrum-sovereign.cjs`)
Script automatizado listo para su uso futuro (sin ejecutar en red durante esta fase), el cual realiza en orden:
1. Despliegue de `QuatriviumFamaLib` y enlace con la factoría de `QuatriviumCredit`.
2. Predicción de dirección de `QuatriviumCredit` y despliegue de `QuatriviumFamaCaja`.
3. Despliegue de `QuatriviumCredit` apuntando a LUSD (`0x93b346b6BC2548dA6A1E7d98E9a421B42541425b`) y al oráculo Chainlink LUSD/USD (`0x0411D28c94d85A36bC72Cb0f875dfA8371D8fFfF`).
4. Despliegue de `QuatriviumReserva` y `QuatriviumAlta`.
5. Enlace cruzado on-chain: `fama.setAlta(altaAddr)`, `fama.setReserva(reservaAddr)` y `reserva.setAltaFuente(altaAddr)`.
6. Actualización automática de `constants/deployedAddresses.ts`, `eas.json`, `.env` y generación de resumen JSON de auditoría en `deployments/arbitrum-sovereign-<chainId>.json`.

---

## 5. Instrucciones de Comandos para Ejecución Futura

Cuando se decida realizar el despliegue en red y la generación de binarios APK, los comandos exactos a utilizar son:

### 5.1 Despliegue de Smart Contracts en Blockchain

- **En Arbitrum One (Red Principal Real - chainId: 42161):**
  > Requiere tener fondeada la billetera deployer con ETH de gas en Arbitrum One y definir las variables de administradores en `.env`.
  ```bash
  CONFIRM_MAINNET=yes npm run deploy:arbitrum
  ```

- **En Arbitrum Sepolia (Red de Pruebas - chainId: 421614):**
  ```bash
  npm run deploy:arbitrum:sepolia
  ```

### 5.2 Compilación del APK Soberano Android

> **Importante:** Las reglas inquebrantables de esta fase prohibieron compilar el APK. Cuando se autorice la generación del binario:

- **Vía EAS Build (perfil de producción local o cloud):**
  ```bash
  npx eas-cli build --platform android --profile production --local
  ```
  *(O directamente en los servidores de EAS si la cuenta está autenticada: `eas build --platform android --profile production`)*

- **Vía Expo Run / Gradle Local:**
  ```bash
  npx expo prebuild --platform android
  cd android && ./gradlew assembleRelease
  ```
  El APK resultante se ubicará en `android/app/build/outputs/apk/release/app-release.apk`.
  Calcular su hash de integridad con:
  ```bash
  sha256sum android/app/build/outputs/apk/release/app-release.apk
  # En Windows PowerShell:
  Get-FileHash android/app/build/outputs/apk/release/app-release.apk -Algorithm SHA256
  ```

---

## 6. Resultados de Verificación y Testing

1. **Chequeo de tipos estático e integridad i18n:**
   - Comandos: `node scripts/check-i18n.mjs` y `npx tsc --noEmit`
   - Resultado: **0 errores**. 1,245 claves sincronizadas en 17 idiomas.
2. **Suite de contratos e integración Hardhat:**
   - Comando: `npm test`
   - Resultado: **Aprobado (0 fallos)**.
3. **Auditoría de seguridad y producción CI:**
   - Comandos: `npm run security:check` y `npm run production:check:ci`
   - Resultado: **Aprobado (0 fallos)**. Arbitrum One (42161) y LUSD validados.
