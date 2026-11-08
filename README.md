# Quatrivium Finance · Edición Soberana

<!-- AUTO-README:START -->

## Quatrivium Finance

**Quatrivium Finance** es un protocolo y aplicación móvil 100% soberana e inmutable de microcrédito on-chain sin colateral sobre **Arbitrum One** (`chainId: 42161`) operando con **Liquity USD (LUSD)** (`0x93b346b6BC2548dA6A1E7d98E9a421B42541425b`). El usuario genera localmente su billetera HD BIP-39 de 24 palabras (cifrada con AES-256-GCM en el llavero seguro del dispositivo), completa el alta única de **4 LUSD** on-chain, solicita préstamos en LUSD desde el fondo de liquidez, los paga antes del vencimiento y sube de nivel hasta el nivel 1000.

- **Tipo de proyecto:** `node` (React Native / Expo 54 + Solidity 0.8.24 / Hardhat)
- **Red Principal (Cuenta Real):** Arbitrum One (`chainId: 42161`) · Gas: `ETH`
- **Red de Pruebas (Modo Demo):** Arbitrum Sepolia (`chainId: 421614`) · Gas: `ETH`
- **Stablecoin Soberana:** LUSD (`0x93b346b6BC2548dA6A1E7d98E9a421B42541425b`) — inmutable y sin función de `blacklist()`
- **Oráculo On-Chain:** Chainlink LUSD/USD en Arbitrum One (`0x0411D28c94d85A36bC72Cb0f875dfA8371D8fFfF`)
- **Identidad de Aplicación:** Paquete `com.quatrivium.sovereign` · Esquema `quatrivium-sovereign://` · Distribución directa vía APK verificado por SHA-256

### Arquitectura Soberana (Qué funciona)
- **Contratos 100% Inmutables y Sin Kill-Switches:** `QuatriviumCredit.sol`, `QuatriviumAlta.sol`, `QuatriviumFamaCaja.sol`, `QuatriviumReserva.sol` y `QuatriviumFamaLib.sol` operan sin `Pausable`, sin `blacklist`, sin `attester` centralizado y sin requisitos de KYC, SMS/OTP ni correo electrónico.
- **Alta Única de 4 LUSD (`pagarRegistro`):** Un único pago on-chain de 4 LUSD activa la cuenta en el protocolo (1 LUSD a la tesorería fundadora, 1 LUSD al bote de Reserva, 1 LUSD de registro al pool y 1 LUSD apartado en `QuatriviumAlta` para quien invitó de forma directa al liquidar el primer Nivel 1).
- **Fama y Canje:** 100 puntos de fama por cada 1 LUSD donado o aportado al pool desde la primera unidad. El alta no acredita fama de red. Conversión en `QuatriviumFamaCaja`: 250 de fama = 1 LUSD del fondo común.
- **Comisiones Unilevel (40 Generaciones):** Del interés pagado al cancelar un préstamo se reparte: Gen 1 (15%), Gen 2 (8%), Gen 3 (6%), Gen 4 (4%), Gen 5 (2%), Gen 6–12 (0,8%) y Gen 13–40 (0,4%). El fondo retiene al menos el 40%.
- **Racha Diaria:** Suma 100 de fama por día UTC válido cuando un invitado directo liquida un crédito. Hitos de racha (7, 30, 100 y 365 días) pagan 5, 25, 100 y 500 LUSD del fondo.
- **Reserva (Nivel 10+):** Bloqueo voluntario de LUSD por 30 días en `QuatriviumReserva` (separado del fondo de préstamos), mínimo 1 LUSD, con restitución íntegra del principal al vencimiento, rendimiento estimado de hasta el 12% anual según disponibilidad del bote y extra de comisión generacional (10% desde 50 LUSD, 20% desde 500 LUSD).
- **App Móvil Soberana (Expo 54 · React Native 0.81.5 · TypeScript):** 17 idiomas completos (`es`, `en`, `zh`, `hi`, `ar`, `bn`, `pt`, `ru`, `ur`, `id`, `fr`, `ja`, `de`, `ko`, `tr`, `vi`, `it`), billetera interna BIP-39 de 24 palabras, bloqueo local por contraseña/PIN/biometría/TOTP, notificaciones locales en el dispositivo y rotación soberana de 5 RPCs públicos de Arbitrum One.

### Módulos Principales
- Pantalla principal — `app/index.tsx`
- Layout Expo — `app/_layout.tsx`
- Configuración Web3 (Arbitrum One / Sepolia) — `web3Config.tsx` · `constants/bsc.ts` · `constants/rpcConfig.ts`
- Direcciones desplegadas — `constants/deployedAddresses.ts`
- Contratos Inteligentes — `contracts/QuatriviumCredit.sol`, `contracts/QuatriviumAlta.sol`, `contracts/QuatriviumFamaCaja.sol`, `contracts/QuatriviumReserva.sol`, `contracts/libraries/QuatriviumFamaLib.sol`
- Script Maestro de Despliegue — `scripts/deploy-arbitrum-sovereign.cjs`
- Handlers — `hooks/useHomeHandlers.ts`
- Estado on-chain — `hooks/useWeb3Balances.ts`
- Transacciones — `hooks/useWeb3Transactions.ts`
- Servicio de contrato — `services/quatriviumCreditService.ts`
- Billetera HD local — `services/appWallet.ts`
- Candado y seguridad local — `services/appLock.ts` · `services/authPrefs.ts` · `services/authenticator.ts`
- Historial on-chain — `services/movementHistory.ts` · `components/MovementHistory.tsx`
- Almacenamiento cifrado — `services/secureStorageService.ts`
- Portal Web de Invitación y Descarga Directa APK — `web/invite/index.html` · `web/index.html`

### Comandos Principales

```powershell
npm install
npm run start
npm run typecheck
npm run lint
npm test
npm run compile
npm run security:check
npm run production:check:ci
npm run deploy:arbitrum
npm run deploy:arbitrum:sepolia
```

<!-- AUTO-README:END -->

## Arquitectura en Arbitrum One (LUSD)

| Parámetro | Valor |
|---|---|
| Red Principal (Real) | Arbitrum One (`chainId: 42161`) |
| Red de Pruebas (Demo) | Arbitrum Sepolia (`chainId: 421614`) |
| Token Estable | Liquity USD (`LUSD`) — `0x93b346b6BC2548dA6A1E7d98E9a421B42541425b` |
| Oráculo Chainlink LUSD/USD | `0x0411D28c94d85A36bC72Cb0f875dfA8371D8fFfF` |
| Moneda Nativa de Gas | Ether (`ETH`) — Umbral mínimo en app: `0.0001 ETH` |
| Paquete Android / iOS | `com.quatrivium.sovereign` |
| Deep-Link Scheme | `quatrivium-sovereign://` |

## Verificación Local y Pruebas

```bash
npm run typecheck
npm run lint
npm test
```

En cada `push` y `pull_request` a `main`, el pipeline de GitHub Actions (`.github/workflows/ci.yml`) ejecuta automáticamente `npm test`, `npm run typecheck`, `npm run lint`, `npm run security:check`, `npm run production:check:ci`, Gitleaks y TruffleHog.

## Despliegue de Contratos (Cuando se decida ejecutar en red)

El script maestro `scripts/deploy-arbitrum-sovereign.cjs` despliega en orden `QuatriviumFamaLib`, `QuatriviumCredit`, `QuatriviumAlta`, `QuatriviumFamaCaja` y `QuatriviumReserva`, ejecuta los enlaces cruzados y escribe automáticamente las direcciones en `constants/deployedAddresses.ts`:

```bash
# En Arbitrum Sepolia (421614):
npm run deploy:arbitrum:sepolia

# En Arbitrum One Mainnet (42161):
CONFIRM_MAINNET=yes npm run deploy:arbitrum
```
