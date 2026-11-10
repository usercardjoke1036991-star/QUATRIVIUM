# CONTEXTO — QUATRIVIUM

## Qué es

Protocolo y app de microcrédito sin colateral en Arbitrum One (chainId 42161) con LUSD `0x93b346b6BC2548dA6A1E7d98E9a421B42541425b`, 18 decimales, paridad 1:1 y sin oráculo de precio. Solidity 0.8.24. App Expo 54 / React Native 0.81 / TypeScript. Paquete `com.quatrivium.sovereign`.

No hay servidor de la empresa. La billetera nace en el teléfono (`services/appWallet.ts`). WalletConnect es opcional. Los RPC públicos están en `constants/rpcConfig.ts`.

## Reglas cerradas

- Tres admins, votación fija 2 de 3, espera 72 h, sin caducidad. Solo votan su entrada o salida. `pausarPrestamosNuevos` lo llama un admin, dura 7 días y no frena pagos ni liquidaciones.
- `retirarLiquidez` revierte. Nadie saca el pool.
- Alta de 4 LUSD en `QuatriviumAlta.pagarRegistro`: 1 al fundador, 1 al bote de Reserva, 1 apartado para quien invitó y 1 de sello a Credit. De ese sello, el 5 % queda en el fondo de seguro y el resto en la liquidez. El fundador cobra además el 15 % del interés en la misma transacción. Solo él rota su billetera, con 72 h. No necesita alta ni L1.
- Fondo de seguro: 5 % de las entradas al pool. Solo paga el premio del impago.
- Reserva: nivel ≥ 10, 30 días, tope 12 % anual del bote, principal siempre devuelto. Sin owner ni retiro del bote.
- Liquidación: 48 h más el tiempo caído del sequencer y 1 h tras volver. Feed `0xFdB631F5EE196F0ed6FAa767959853A9F217697D`, obligatorio si chainId es 42161. Premio = el menor entre 5 % del principal restante y el interés que queda.
- Unilevel, padrino, fama y racha exigen alta y L1 (`cobradorListo`). Si no, esa parte entra al pool. La racha solo cuenta nivel ≥ 2 pagado a tiempo.
- Avisos locales. No hay mensaje privado por Nostr mientras no exista cifrado. La mora no se publica. Ranking leído de eventos de la cadena.
- Distribución: APK firmado y hash en `QuatriviumApk`. Eso, el despliegue, IPFS y ENS están pendientes.

La escalera de 1000 niveles y los porcentajes de arriba no se tocan sin una orden nueva.

## Contratos

| Archivo | Rol |
| --- | --- |
| `contracts/QuatriviumCredit.sol` | Préstamos, pool, interés, liquidación, admins, sequencer, fondo. 21769 bytes en el artifact de Hardhat. Límite EIP-170: 24576. |
| `contracts/QuatriviumAlta.sol` | Alta de 4 LUSD. |
| `contracts/QuatriviumReserva.sol` | Bloqueos y bote. |
| `contracts/QuatriviumFamaCaja.sol` | Fama, canje y racha. |
| `contracts/libraries/QuatriviumFamaLib.sol` | Reparto y seguro. |
| `contracts/QuatriviumApk.sol` | Historial de hashes. Solo el fundador publica. |
| `contracts/QuatriviumLeveling.sol`, `contracts/LoanLadder.sol` | Hitos y niveles 101–1000, fuera de Credit. |

Direcciones de despliegue: vacías en `constants/deployedAddresses.ts`, salvo el LUSD y la billetera de donación `0x5023bf46dB7458B9bb9152a7ffE64f195CD1a047`. No inventar las otras.

## Cómo probar

```bash
npm ci --ignore-scripts
npm test
forge test --fuzz-runs 32
npm run typecheck
npm run lint
npm run format:check
```

Despliegue, solo con orden explícita: `CONFIRM_MAINNET=yes npm run deploy:arbitrum`.

## Estado

Fases 1 a 6 están en la rama `cursor/soberania-contratos-8e15`. El mapa de commits, la simulación de impago y los riesgos están en `HANDOFF.md`.
