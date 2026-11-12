# HANDOFF — QUATRIVIUM

Documento para otro asistente, sin contexto previo. Los datos salen del código de la rama `cursor/soberania-contratos-8e15`. El último commit de producto es `708fc24`. El dueño es Jose. Habla español. Las respuestas hacia él van en español, cortas.

## 1. Qué es

QUATRIVIUM es una app de microcrédito descentralizada. Corre en Arbitrum One con LUSD. No hay servidor de la empresa, no hay mantenimiento y el usuario no configura nada: la billetera nace en el teléfono, los RPC públicos ya vienen puestos y las reglas viven en los contratos.

Paquete Android: `com.quatrivium.sovereign`. Esquema: `quatrivium-sovereign://`. App: Expo 54, React Native 0.81.5, TypeScript. Contratos: Solidity 0.8.24, Hardhat y Foundry. Licencia del `package.json`: 0BSD.

## 2. Decisiones cerradas

No reabrirlas. Si un texto del repo viejo las contradice, manda esta lista.

- Red: Arbitrum One, chainId `42161`. LUSD `0x93b346b6BC2548dA6A1E7d98E9a421B42541425b`, 18 decimales, paridad 1:1. No hay oráculo de precio. BOLD no se usa.
- Sin Rust. El análisis previo no halló beneficio. El producto es Solidity + la app.
- Tres admins. La votación es fija: 2 de 3. Espera de 72 h (`TIMELOCK_DELAY`). La propuesta no caduca. Votan `addAdmin`, `removeAdmin` y `pausarPrestamosNuevos`. Nadie pausa solo. La pausa dura 7 días y se levanta sola. Después hay 7 días de descanso (`pausaReposoHasta`) antes de votar otra. Pagos, liquidaciones y Reserva siguen.
- El pool está cerrado para siempre. `retirarLiquidez` revierte con `"pool locked"`. Ni un admin lo retira.
- Alta: 4 LUSD de una vez en `QuatriviumAlta.pagarRegistro`: 1 al fundador, 1 al bote de Reserva, 1 apartado para el padrino, 1 de sello a Credit. `pagarVerificacion` deja el 5 % de ese sello en `fondoSeguro` y el 95 % en la liquidez. Sin invitación, `registrarHumanoConPadre(address(0))` cuelga del fundador. El 1 apartado se suelta al pagar el primer L1: a quien invitó si `cobradorListo`, si no al pool. A los 7 días sin ese pago, `vencerPadrinoAlPool` lo manda al pool. Una cuenta no puede nombrarse a sí misma. Una segunda cuenta sí puede nombrar a la primera; el 1 que cobra sale de los 4 que la segunda pagó. El fundador cobra ese 1 LUSD del alta en la misma transacción, más el 15 % del interés (`FUNDADOR_BP = 1500`). Solo el fundador rota su billetera (`proponerFundador` / espera 72 h). No necesita alta ni L1 pagado: el constructor lo marca verificado y el cobro del 15 % no pasa por `cobradorListo`.
- Fondo de seguro: 5 % de lo que entra al pool (`SEGURO_BP = 500` en `QuatriviumFamaLib`). Solo cubre el premio del impago. Nadie lo retira. `collectedFees` no crece: el fee de liquidación se queda en el pool en la misma transacción.
- Reserva: nivel 10 o más (`NIVEL_MINIMO`), bloqueo 30 días (`LOCK`), tope 12 % anual (`MAX_APY_BP = 1200`) pagado del bote, principal siempre devuelto. Sin owner ni guardianes y sin retiro del bote. Los 3 admins (quórum 2, 72 h) solo votan su propia entrada o salida.
- Liquidación: 48 h de gracia (`LIQUIDACION_GRACIA`) más la caída leída de la ronda anterior del feed, más 1 h después de que vuelve (`SEQUENCER_GRACIA`). El feed de uptime solo publica cuando el sequencer cambia de estado: `answer == 0` es arriba aunque `updatedAt` tenga meses. No hay tope de 24 h. Si el feed falla, `startedAt` es cero o la llamada revierte, se posponen las liquidaciones. Préstamos y pagos no. Sin feed (Hardhat y Sepolia) solo aplican las 48 h. El liquidador no pone el principal. El fondo de seguro absorbe esa deuda y, si no alcanza, se reconoce pérdida del pool. El premio es el menor entre el 5 % del principal restante y el interés, y sale del contrato: solo el gas puede dejar al liquidador en negativo. Feed obligatorio en chainId 42161: `0xFdB631F5EE196F0ed6FAa767959853A9F217697D`. El constructor revierte `SequencerFeedRequerido` si en 42161 el feed es cero.
- Para cobrar unilevel, padrino, fama o racha hay que tener alta y L1 pagados (`cobradorListo`). Si no, esa parte entra al pool. La racha solo cuenta préstamos de nivel 2 o más pagados a tiempo (`QuatriviumFamaCaja`).
- Avisos: notificaciones locales del teléfono (`expo-notifications`). El mensaje privado por Nostr está oculto hasta que exista cifrado. La mora no se publica. Perfiles, usernames y leaderboard salen de la cadena, no de un servidor.
- Se distribuye solo el APK firmado. `QuatriviumApk` guarda versionCode, el hash del archivo, la fecha y la huella SHA-256 del certificado de firma. Esa huella es la misma en todas las versiones. Solo el fundador publica. No se borra. La app lee la huella del certificado con el módulo nativo `modules/quatrivium-signing-cert` (no se compila en los tests). Vacío o sin lectura: «versión no verificada». Igual: coincide. Distinta: aviso fuerte. La prueba en un teléfono se hace al compilar. Cualquier persona puede comparar a mano el hash del archivo con el registro.
- La dirección de fundador debe ser una billetera de varias firmas o una billetera física con respaldo. Si se pierde, nadie publica hashes ni cobra su parte. `scripts/deploy-arbitrum-sovereign.cjs` lo avisa y exige `CONFIRM_FOUNDER_WALLET=yes`.
- Prohibido en código, config, CI y textos: Play Store, Expo OTA, Render, Fly, Hetzner, Telegram, Binance, Resend, Namecheap, Textbelt, Twilio, WhatsApp y Sumsub. El escáner es `scripts/check-external-services.mjs`.

La escalera de 1000 niveles, las tasas, el reparto del alta de 4 LUSD y los porcentajes de fundador, unilevel, fama y Reserva no se cambian salvo que Jose lo pida por escrito.

## 3. Mapa del repo

| Ruta | Qué es |
| --- | --- |
| `contracts/QuatriviumCredit.sol` | Núcleo: préstamos, pool, interés, liquidación, admins, sequencer, fondo de seguro. |
| `contracts/QuatriviumAlta.sol` | Alta de 4 LUSD y el 1 del padrino. |
| `contracts/QuatriviumReserva.sol` | Bote y bloqueos de 30 días. |
| `contracts/QuatriviumFamaCaja.sol` | Fama, canje y racha. |
| `contracts/libraries/QuatriviumFamaLib.sol` | Reparto de interés, seguro y fama. Vive en librería por el límite EIP-170. |
| `contracts/QuatriviumApk.sol` | Historial de hashes del APK. Aparte de Credit a propósito. |
| `contracts/QuatriviumLeveling.sol` | Hitos y asientos, fuera del bytecode de Credit. |
| `contracts/LoanLadder.sol` | Niveles 101–1000, cuotas y `requiredCount`. |
| `contracts/libraries/LoanTierSeed.sol` | Tabla de los niveles 1–100 (monto, tasa, días). |
| `app/`, `components/`, `hooks/`, `services/`, `constants/`, `utils/`, `i18n/` | App. Entrada: `app/index.tsx`. Billetera: `services/appWallet.ts`. Ranking: `services/fameLeaderboard.ts` y `utils/fameRoster.ts`. Superficie soberana (RPC, Nostr, APK, alta): `utils/sovereignSurface.ts`. |
| `constants/deployedAddresses.ts` | Mainnet: LUSD y la billetera de donación `0x5023bf46dB7458B9bb9152a7ffE64f195CD1a047` ya escritos. `contract`, `reserva`, `fama` y `alta` están vacíos. No inventar direcciones. |
| `constants/arbitrum.ts`, `constants/rpcConfig.ts` | Arbitrum One (42161) y Arbitrum Sepolia (421614). RPC públicos con respaldo. |
| `test/` | Tests Hardhat (Mocha). |
| `forge-test/` | Tests Foundry. `lib/forge-std` está en `.gitignore`. |
| `scripts/deploy-arbitrum-sovereign.cjs` | Despliegue cuando Jose lo autorice. |
| `scripts/check-i18n.mjs`, `scripts/check-external-services.mjs`, `scripts/check-production.mjs` | Los usa `typecheck` y CI. No son meta-tooling de README. |
| `.github/workflows/ci.yml` | En `main` y en pull requests: Hardhat, typecheck, lint, format, escáner, `production:check:ci`. Node 22. No compila APK. |
| `web/` | Página estática de invitación y de descarga. Sin hosts de terceros. Los tests la leen. Sirve para IPFS cuando Jose lo pida. El SHA-256 escrito en `web/invite/index.html` es un valor fijo de la página, no el registro on-chain. |
| `foundry.toml`, `hardhat.config.cjs` | Optimizer runs 1, viaIR, `bytecodeHash` none, revert strings strip. |

Compilador Hardhat: `metadata.appendCBOR: false` y `bytecodeHash: "none"`. Por eso el tamaño que cuenta para EIP-170 es el `deployedBytecode` del artifact de Hardhat.

## 4. Estado por fase

Todas en `cursor/soberania-contratos-8e15`. PR: https://github.com/usercardjoke1036991-star/QUATRIVIUM/pull/1. Base: `main`. Sin merge.

| Fase | Commit | Qué quedó | Tests que lo cubren ahora |
| --- | --- | --- | --- |
| 1 | `95a3b21` | Racha solo nivel ≥ 2 a tiempo. Unilevel, padrino, canje y racha exigen alta y L1; si no, al pool. Alta obligatoria. Liquidación con 48 h y premio acotado. Sin oráculo de precio. | `test/soberania-fase1.test.js`, `test/racha.test.js`, `test/alta-registro.test.js`, `test/liquidation.test.js`, `test/peg.test.js`, `forge-test/QuatriviumBlindajes.t.sol` |
| 2 | `db7a952` | Tres admins, quórum 2, pausa solo de préstamos nuevos por 7 días. | Tests de gobierno dentro de `test/security.test.js` (quitar admin 2 de 3, pausa de 7 días, rotación del fundador). |
| 2 A/B/C | `23e4644` | Fundador cobra en la misma transacción. Reserva sin retiro del bote. Gracia del sequencer. | `test/fundador-cobro.test.js`, `test/reserva.test.js`, `test/sequencer-gracia.test.js`, `forge-test/QuatriviumReserva.t.sol` |
| 3 | `54821d6` | Fee de liquidación al pool. Fondo de seguro 5 %. `QuatriviumApk`. Feed obligatorio en 42161. Simulación de 100 préstamos L1. | `test/fase3-seguro-apk.test.js`, `forge-test/QuatriviumFase3.t.sol` |
| 4 | `45153f2` | La app muestra el reparto del alta, el 15 % y el 5 %, la gracia, el aviso de Reserva, avisos locales, Nostr sin mora, ranking y lectura de admins. Sin Expo OTA. | `test/fase4-app.test.js`, `test/screen-copy.test.js` |
| 5 | `6c42f4d` | Seis relés públicos con relevo. APK vacío o caído = «versión no verificada»; hash distinto = aviso fuerte. Capturas de tienda borradas. Ranking determinista desde eventos. Servicios prohibidos fuera del árbol. Escáner en CI. | `test/fase4-app.test.js`, `scripts/check-external-services.mjs` (también dentro de `npm run typecheck`) |
| 6 | `facc8a9` | Fuera el meta-tooling de README, conectores y `.cursor/`. Docs viejas que hablaban de otra app o de un oráculo de precio, borradas. | La misma suite. |
| docs | `cf2575b`, `c13e694` | `HANDOFF.md` y la primera `AUDITORIA.md`. | No cambian contratos. |
| limpieza | `15e45af`, `3661ba8` | Fuera `zk-contracts/`, `Groth16Verifier.sol` y `services/zkService.ts`. Sin ZKP. El id de Sonar es `usercardjoke1036991-star_QUATRIVIUM`. | `test/fase4-app.test.js` |
| arreglos | `60a9654` | Pausa 2 de 3 y 72 h, descanso de 7 días, huella del certificado en `QuatriviumApk`. El tope de 24 h del feed quedó descartado: ese feed no late cada día. | `test/pausa-quorum.test.js`, `test/fase3-seguro-apk.test.js` |
| alta | `960f446`, `708fc24` | Los textos dicen el reparto real. Tests del alta con invitación, sin invitación, invitador inválido y segunda cuenta. Nostr privado sigue oculto. | `test/alta-invitacion.test.js`, `test/alta-registro.test.js` |

## 5. Números

Medidos en `cursor/soberania-contratos-8e15` con `allowUnlimitedContractSize: false`. `QuatriviumCredit`: 23317 bytes, 1259 libres de 24576. El harness de prueba: 24528 bytes, 48 libres. Un pago de 40 generaciones: 1246495 de gas, por debajo de 3 000 000.

Hardhat: 362 pruebas en verde. Foundry con `FOUNDRY_PROFILE=ci`: 56 pruebas en verde. Invariantes de Credit y de Reserva: 256 corridas, profundidad 800, 204800 llamadas, 0 reverts cada uno.

Slither: 0 altos, 0 medios, 13 bajos, 10 optimizaciones. `npm audit` del árbol: 37 (15 bajos, 20 moderados, 2 altos, 0 críticos) tras subir `handlebars` a 4.7.10. Producción (`--omit=dev`): 21 (9 bajos, 11 moderados, 1 alto, `image-size`).

El candado no borra la billetera. Esperas: 30 s, 1 min, 5 min, 15 min, 1 h y luego 24 h. El reloj hacia atrás o un salto mayor que la espera no la acortan. El PIN queda bloqueado a los 10 fallos. El aviso no lee el secreto del teléfono: usa las marcas guardadas, y en demo no se muestra. Un reintento con éxito genera un secreto nuevo y vuelve a sellar el PIN. 9000 vueltas de PBKDF2-SHA256 salen de la medida de sjcl en un Android API 27: 10001 vueltas tardaron 5431,5 ms, así que 9000 quedan cerca de 4,9 s en ese JavaScript. No está medido en un teléfono. Un recibo vale cuando 2 de N RPC coinciden. Si no, el envío sigue pendiente.

## 6. Simulación de impago

Está en `forge-test/QuatriviumFase3.t.sol`, funciones `test_simulacion_5_por_ciento`, `test_simulacion_15_por_ciento` y `test_simulacion_30_por_ciento`. Son 100 préstamos de nivel 1. El nivel 1 es 1 LUSD con `tasaInteresBP` 10000, así que el interés es 1 LUSD (`(monto * tasa) / 10000` en Credit). El fee del test es 500 bp.

El liquidador no devuelve el principal. El fondo de seguro absorbe ese principal y, si no alcanza, baja `totalLiquidity`. El premio (el menor entre el 5 % y el interés) sale del pool. El test lo exige con `assertEq(sistema, esperado)` y `assertEq(totalImpagoCubierto, malos * 1 ether)`. La tabla vieja, en la que el liquidador reponía el principal, ya no vale.

`console2.log` imprime además el delta del pool y el del fondo. Esos dos no están fijados con `assertEq`. No los copies de un informe viejo: si hacen falta, salen de `forge test --match-test test_simulacion -vv`.

## 7. Lo que falta

Orden de prioridad:

1. **Fase 6: hecha en este árbol.** Se borraron los generadores de README, contexto, mapa, visión, memoria y QA, y la carpeta `.cursor/`. `README.md` y `CONTEXTO.md` describen este protocolo. Se dejó, porque un test lo lee y fallaría la suite, este arnés: `scripts/run-full-cyber-audit.sh`, `scripts/zap-health-wsl.sh`, `scripts/fetch-wallet-logos.py`, `scripts/run-slither.mjs`, `scripts/run-slither-wsl.sh`, `scripts/run-snyk.mjs`, `scripts/run-sonar.mjs`, `scripts/scan-mobile.mjs`, `scripts/trivy-lock.sh`, `trivy.yaml`, `.trivyignore`, `slither.config.json`, `sonar-project.properties`, `scripts/patch-i18n-leftovers*.mjs` (el test exige al menos cuatro) y `scripts/linkCredit.cjs`. El id de Sonar pasó a `usercardjoke1036991-star_QUATRIVIUM` en `sonar-project.properties` y `.sonarcloud.properties`. Se borraron `zk-contracts/` y `contracts/Groth16Verifier.sol`: ningún contrato, test ni job de CI los importaba, y `QuatriviumCreditZK` traía pausa, owner y oráculo. `web/` se queda. `services/zkService.ts`, su reexportación, `services/secureStorageService.ts` y `types/zkTypes.ts` se borraron: ninguna pantalla, perfil, ranking ni test los llamaba. La identidad es la dirección de `services/appWallet.ts`.
2. **Abierto, con severidad.** No cambiarlo sin que Jose lo pida.
   - Bajo: una segunda cuenta puede nombrar a la primera y cobrar el 1 apartado si esa ya pagó alta y nivel 1. El costo son los otros 3 LUSD más el interés del nivel 1. No es ganancia. `test/alta-invitacion.test.js`.
   - Bajo: `soltarPadrino` no suelta el 1 si el padre viene vacío o es el mismo deudor (`QuatriviumAlta.sol`). El registro normal no produce ese padre.
   - Bajo: siguen tests que leen texto y hablan de dinero. La lista está en `AUDITORIA.md`, sección «Segunda auditoría». No reescribirlos todavía.
   - Medio, abierto: `image-size` (alto de producción). El parche pide un SDK de Expo nuevo. No se subió Expo. `handlebars` pasó a 4.7.10 y el crítico de desarrollo salió. `solidity-coverage` 0.8.17 sigue compilando y escribiendo el informe; el contrato instrumentado no cabe en el gas de despliegue. `tmp` sigue alto vía `solc` y no se forzó.
   - Medio: el cifrado NIP-17/44 no está implementado. `prepareNostrPayload` devuelve null. No hay pantalla de mensaje privado.
3. **Pendiente antes de dinero real.**
   - Auditoría externa de los contratos. `AUDITORIA.md` la escribieron herramientas de IA, no una firma de auditoría, y no la sustituye.
   - La dirección de fundador debe ser una billetera de varias firmas (Safe) o una billetera física con respaldo. El despliegue exige `CONFIRM_FOUNDER_WALLET=yes`.
4. **Pendiente de Jose, sin tocar el código por nuestra cuenta.**
   - EIP-7702: `_soloEOA`, Alta y Reserva quedan como están hasta que él decida.
   - El enlace de SonarCloud lo cambia el dueño en el panel.
   - `image-size` espera un SDK de Expo nuevo.
5. **Pendiente cuando Jose lo ordene,** en este orden. Nada de esto se ha hecho.
   1. Compilar el APK firmado y calcular su SHA-256.
   2. Desplegar en Arbitrum One y escribir las direcciones reales en `constants/deployedAddresses.ts` (`contract`, `reserva`, `fama`, `alta`). No inventarlas.
   3. Publicar la huella del certificado y el hash del archivo en `QuatriviumApk`.
   4. IPFS.
   5. ENS.
6. **Incompleto a propósito en el código actual:**
   - Nostr no abre un websocket ni ofrece mensaje privado: `prepareNostrPayload` devuelve null. La mora sigue bloqueada.
   - El hash del APK instalado no se calcula en el teléfono. Sin registro, la UI dice «versión no verificada».
   - Credit tiene 1259 bytes libres (23317 de 24576). Cualquier lógica nueva en ese contrato puede no caber. Preferir un contrato hermano, como ya se hizo con Apk, Leveling y LoanLadder.
7. La clave que estuvo en el historial (commits `10553d4` y `dc40f15`, archivo `.env.worker.example`) ya fue revocada por Jose. No está en el árbol. No se reescribe la historia y no se copia el valor.

## 8. Riesgos

- 1259 bytes libres en Credit (23317) y 48 en el harness (24528). No añadir funciones ahí sin medir `deployedBytecode`.
- Hardhat tiene `allowUnlimitedContractSize: false`. El tamaño que cuenta es el `deployedBytecode` del artifact: Credit 23317 bytes, 1259 libres de 24576. El harness de prueba mide 24528, 48 libres.
- Los `require` de texto se borran del bytecode (`revertStrings: strip`). Los tests no pueden usar `revertedWith("mensaje")` para esos revert. Los errores con nombre (`SequencerFeedRequerido`, `SoloFundador`) sí se distinguen.
- La pausa de préstamos nuevos exige 2 de 3 y 72 h. Se levanta sola a los 7 días y luego hay 7 de descanso. No frena pagos ni liquidaciones.
- El pool y el fondo de seguro no tienen retiro. Un error en el reparto no se «arregla» sacando el dinero.
- La liquidación exige EOA (`tx.origin == msg.sender`) y prohíbe autoliquidarse.
- Direcciones de contrato vacías: la app no opera en mainnet hasta el despliegue.
- Esa clave del historial ya fue revocada. El valor no se escribe en documentos nuevos.
- No usar dinero real sin auditoría externa.

## 9. Cómo continuar

Instalar y probar (no compila APK ni despliega):

```bash
npm ci --ignore-scripts
npm test
# Foundry, perfil de CI (256 corridas de invariante, profundidad 800):
FOUNDRY_PROFILE=ci forge test
npm run typecheck
npm run lint
npm run format:check
```

CI usa Node 22. `typecheck` ya incluye i18n y el escáner de servicios prohibidos.

Despliegue, solo cuando Jose lo autorice, con `PRIVATE_KEY` fuera del repo y `CONFIRM_MAINNET=yes`:

```bash
CONFIRM_MAINNET=yes npm run deploy:arbitrum
```

Eso llama a `scripts/deploy-arbitrum-sovereign.cjs` en la red `arbitrumOne` de `hardhat.config.cjs`. Después hay que escribir las direcciones reales en `constants/deployedAddresses.ts` y publicar el hash del APK ya firmado. Hasta esa orden: no desplegar, no `eas build`, no `expo prebuild`, no gradle.

## 10. Reglas de trabajo con Jose

- Respuestas cortas, en español.
- Él pega el prompt. No adelantes la fase siguiente.
- No merge a `main`. No force-push.
- No toques el repo de Magno.
- No cambies la escalera, las tasas, el alta de 4 LUSD ni los porcentajes cerrados.
- No inventes direcciones.
- No copies secretos del historial a documentos nuevos.
