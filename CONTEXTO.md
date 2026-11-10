# CONTEXTO — QUATRIVIUM

## Qué es

Protocolo y app de microcrédito sin colateral en Arbitrum One (chainId 42161) con LUSD `0x93b346b6BC2548dA6A1E7d98E9a421B42541425b`, 18 decimales, paridad 1:1 y sin oráculo de precio. Solidity 0.8.24. App Expo 54 / React Native 0.81 / TypeScript. Paquete `com.quatrivium.sovereign`.

No hay servidor de la empresa. La billetera nace en el teléfono (`services/appWallet.ts`). WalletConnect es opcional. Los RPC públicos están en `constants/rpcConfig.ts`.

## Reglas cerradas

- Tres admins, votación fija 2 de 3, espera 72 h, sin caducidad. Votan su entrada, su salida y la pausa de préstamos nuevos. Nadie pausa solo. La pausa se levanta sola a los 7 días y después hay 7 días de descanso. No frena pagos ni liquidaciones.
- `retirarLiquidez` revierte. Nadie saca el pool.
- Alta de 4 LUSD en `QuatriviumAlta.pagarRegistro`: 1 al fundador, 1 al bote de Reserva, 1 apartado para quien invitó y 1 de sello a Credit. De ese sello, el 5 % queda en el fondo de seguro y el 95 % en la liquidez. Entrar sin invitación cuelga del fundador. Ese 1 apartado no se queda bloqueado: al pagar el primer nivel 1 va a quien invitó si ya tiene alta y nivel 1, y si no, al pool. A los 7 días sin ese pago, entra al pool. Una misma cuenta no puede ser su propio invitador. El fundador cobra además el 15 % del interés en la misma transacción. Solo él rota su billetera, con 72 h. No necesita alta ni L1.
- Donar y aportar dan fama visible y no se canjean por LUSD del pool. Solo la fama de intereses pagados se convierte.
- Fondo de seguro: 5 % de las entradas al pool. Solo paga el premio del impago.
- Reserva: nivel ≥ 10, 30 días, tope 12 % anual del bote, principal siempre devuelto. Sin owner ni retiro del bote.
- Liquidación: 48 h más la caída leída de la ronda anterior del feed y 1 h tras volver. `answer == 0` es sequencer arriba aunque la ronda tenga meses. Si el feed falla o `startedAt` es cero, se pospone la liquidación. El liquidador no pone el principal: el seguro absorbe la deuda y el premio (el menor entre 5 % y el interés) sale del contrato. Feed `0xFdB631F5EE196F0ed6FAa767959853A9F217697D`, obligatorio si chainId es 42161.
- Unilevel, padrino, fama y racha exigen alta y L1 (`cobradorListo`). Si no, esa parte entra al pool. La racha solo cuenta nivel ≥ 2 pagado a tiempo.
- Avisos locales. No hay mensaje privado por Nostr: el cifrado NIP-17/44 no está hecho y `prepareNostrPayload` devuelve null. La mora no se publica. Ranking leído de eventos de la cadena.
- Sin Rust y sin pruebas de conocimiento cero. Sin servidor y sin tienda de aplicaciones. La lista de nombres prohibidos está en `HANDOFF.md`.
- Distribución: APK firmado, con huella del certificado y hash en `QuatriviumApk`. Nada de eso está publicado.

La escalera de 1000 niveles y los porcentajes de arriba no se tocan sin una orden nueva.

## Contratos

| Archivo | Rol |
| --- | --- |
| `contracts/QuatriviumCredit.sol` | Préstamos, pool, interés, liquidación, admins, sequencer, fondo. 23330 bytes. Libres: 1246 de 24576. |
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

Rama `cursor/soberania-contratos-8e15`. Tras el arreglo del feed: Hardhat 306, Foundry 51. El mapa de commits está en `HANDOFF.md`.

Abierto: dos hallazgos bajos del alta (segunda cuenta, y `soltarPadrino` si el padre viniera vacío), tests que leen texto, `npm audit` con `handlebars`, y el cifrado NIP-17/44.

Pendiente antes de dinero real: auditoría externa de los contratos, y que la billetera del fundador sea de varias firmas o física, con `CONFIRM_FOUNDER_WALLET=yes`.

Pendiente cuando Jose lo ordene, y nada de esto se ha hecho: 1) compilar el APK y calcular su SHA-256, 2) desplegar en Arbitrum One y escribir las direcciones en `constants/deployedAddresses.ts`, 3) publicar la huella del certificado y el hash en `QuatriviumApk`, 4) IPFS, 5) ENS.

La clave que estuvo en el historial (commits `10553d4` y `dc40f15`, archivo `.env.worker.example`) ya fue revocada. El valor no se copia.
