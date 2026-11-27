# Auditoría completa de punta a punta — fase 1

Commit: `ecf755b1e06555b6b81bdf739ab4feb3452e2a52`. Fecha: 19 de noviembre de 2026, 10:00 (hora de Caracas, UTC−4). Esta fase solo encuentra. No cambia código.

Herramientas: Node v24.19.0, npm 11.17.0, Hardhat (la suite `npm test`), Forge 1.9.0 (`6056c584`), Slither 0.11.6, solhint 6.2.4, Gitleaks 8.30.1, Mocha. El servidor `activar_proyecto` no está en esta instalación. Snyk no tiene sesión y no se consultó.

## 2. Resumen

4 hallazgos: 0 críticos, 0 altos, 1 medio, 2 bajos, 1 info.

Los cinco puntos que más importan, en una línea:

1. QA-APP-1 (Media). `expo-clipboard` no está instalado: copiar el secreto TOTP o una dirección cae en la hoja de compartir.
2. QA-UI-1 (Baja). En el tema claro, el texto de los botones verdes queda en 2,89:1.
3. QA-I18N-1 (Baja). Quince idiomas dicen que el teléfono se envía a un servidor SMS. El español y el inglés no. El código no lo envía.
4. QA-LOG-1 (Baja). El árbol de referidos deja de abrirse en la generación 12. El contrato paga hasta la 40.
5. QA-DEP-1 (Info). `wagmi` está en `package.json` y nadie lo importa.

## 3. Valores de partida

| Comprobación | Esperado | Medido |
| --- | --- | --- |
| Hardhat `npm test` | 493, 0 fallos | 493 passing (10m), salida 0 |
| Foundry `FOUNDRY_PROFILE=ci forge test --fuzz-runs 256` | 80; 3 invariantes; 204800 llamadas | 80 passed, 0 failed. Tres funciones `invariant_`: `invariant_creditNav` e `invariant_reservaCaja` en `forge-test/QuatriviumInvariant.t.sol` (256 corridas, 204800 llamadas, 0 reversiones) e `invariant_tokenBalanceMatchesLockedPlusPot` en `forge-test/QuatriviumReserva.t.sol` (256, 204800, 0). En ese archivo de invariantes hay 2, no 3. El tercero vive en el test de Reserva. El total de HANDOFF cuadra. |
| Tamaño de Credit | 23322 / 23132 / harness 24524, bajo 24576 | Hardhat `deployedBytecode` 23322. Harness 24524. Forge runtime 23132, margen 1444. `forge build --sizes` no recompiló. |
| `npm run typecheck` | 17 × 1288, copiedLongEn=0, tsc 0 | Igual. Salida 0. |
| lint y format:check | 0 errores | ESLint sin salida y código 0. Prettier: todos los archivos coinciden. |
| Servicios externos | ok sin servicios externos prohibidos | Esa frase. |
| `production:check:ci` | OK, 42161, LUSD, soberano | Las tres líneas OK. |
| Slither con `slither.config.json` | 25, 0 altos, 0 medios | 25 resultados, salida 0 (`fail_on: high`). Detectores impresos: missing-zero-check, calls-loop, reentrancy-benign, reentrancy-events, return-bomb, constable-states, immutable-states. No apareció un detector de impacto alto ni medio. Se usó `--hardhat-ignore-compile` después de `npm test`, para no reescribir artifacts. |
| `npm audit --json` | 34: 5 bajos, 28 moderados, 1 alto, 0 críticos | `{"info":0,"low":5,"moderate":28,"high":1,"critical":0,"total":34}`. El alto sigue siendo `image-size` (el árbol de dependencias no cambió desde la medición que lo nombró). |
| Gitleaks | sin fugas nuevas | `detect --source . --redact`: 83 commits, 7,34 MB, no leaks found, salida 0. |
| `npx mocha test/apk-contenido.test.js` | 7 passing | 7 passing (15s). |

Ningún valor de partida falló. No hay hallazgo de regresión de la línea base.

## 4. Hallazgos

### QA-APP-1 · Media · Verificado

- Archivo: `utils/copyText.ts:9-36`, llamado desde `components/AuthenticatorSetup.tsx:120`, `components/WalletSection.tsx:41`, `components/TransferWalletsModal.tsx:275` y `components/ReferralSection.tsx:162` y `:174`. `package.json` no declara `expo-clipboard`.
- Qué pasa: `require('expo-clipboard')` no resuelve. El `catch` prueba `Clipboard` de React Native, que el propio archivo dice que ya no viene en RN 0.81, y al final llama a `Share.share({ message: value })`. Copiar el secreto TOTP, la dirección o el enlace de invitación abre la hoja de compartir del sistema con ese texto. La pantalla solo avisa si el resultado es `copied` (`AuthenticatorSetup.tsx:121`).
- Reproducción exacta, en la raíz del repo:

```
node -e "try { console.log(require.resolve('expo-clipboard')); } catch (e) { console.log('NO_RESOLVE'); }"
```

Salida: `NO_RESOLVE`.

- Impacto: el secreto del autenticador puede salir del teléfono si la persona confirma un destino en la hoja de compartir. No lo roba un tercero remoto. La contraseña y la frase no pasan por `copyText`.
- Arreglo propuesto: declarar `expo-clipboard` y, si no está, devolver `failed` en vez de compartir un secreto. No toca Credit.
- «Falla antes» propuesto: un test de Node que haga `expect(require.resolve('expo-clipboard')).to.be.a('string')`. Hoy lanza y, envuelto, la aserción falla. Con el paquete instalado y resuelto, pasa.

### QA-UI-1 · Baja · Verificado

- Archivo: `theme/palette.ts:58-59` (tema `light`: `primary` `#1B6B3A`, `onPrimary` `#111111`). Uso real en botones, por ejemplo `components/LoanTierCard.tsx:270-277` (`backgroundColor: colors.primary`, texto `colors.onPrimary`, `fontSize` 15 en `:597`).
- Qué pasa: el contraste de `#111111` sobre `#1B6B3A` es 2,89:1. El umbral de texto normal es 4,5:1 y el de texto grande es 3:1. 15 px con peso 600 no llega a texto grande. El tema oscuro (`#0E0E0D` sobre `#5DCF86`) y el minimalista (`#FFFFFF` sobre `#000000`) quedan por encima de 4,5. El resto de pares texto/fondo, texto apagado, aviso y chip de los tres temas también.
- Reproducción: script de luminancia relativa WCAG sobre los hex de `theme/palette.ts`. Salida relevante: `light onPrimary/primary 2.89 #111111 on #1B6B3A`. Los pares `onPrimary` contra `bg` que dan 1,00 no se usan: `onPrimary` va sobre `primary`.
- Impacto: en claro, el rótulo de pagar, bloquear y continuar se lee mal. No mueve fondos.
- Arreglo propuesto: en claro, `onPrimary` a un color claro (el oscuro ya usa texto oscuro sobre verde claro). No toca Credit.
- «Falla antes» propuesto: el mismo cálculo, `expect(ratio('#111111','#1B6B3A')).to.be.at.least(4.5)`. Hoy da 2,89.

### QA-I18N-1 · Baja · Verificado

- Archivo: `i18n/locales/{ar,bn,de,fr,hi,id,it,ja,ko,pt,ru,tr,ur,vi,zh}.json:324`, clave `kycNotGov`. Español e inglés, en la misma clave: «Sus datos no se publican.» / «Your data is not published.»
- Qué pasa: esos quince textos dicen que el número de teléfono se envía cifrado a un servidor SMS y que la cadena guarda un código. `services/deviceClaim.ts` solo lee el vínculo local del teléfono. No hay `fetch` ni subida. La decisión cerrada es que no hay servidor propio ni SMS. Una búsqueda de `kycNotGov` en `*.ts`, `*.tsx` y `*.js` no encontró ninguna llamada `t(...)`. El texto viaja en el paquete de idiomas y hoy no se pinta.
- Reproducción: lectura de `de.json` (203 caracteres) frente a `es.json` (25) y de `deviceClaim.ts:1-24`.
- Impacto: si alguna pantalla empieza a usar la clave, el usuario leerá que sus datos salen a un servidor que el protocolo no tiene. Hoy no se muestra.
- Arreglo propuesto: igualar `kycNotGov` al sentido del español en los 15 idiomas. No toca Credit.
- «Falla antes» propuesto: un test que lea los 17 JSON y espere que ninguno mencione un servidor SMS. Hoy fallan 15 idiomas por aserción.

### QA-LOG-1 · Baja · Verificado

- Archivo: `utils/referralTree.ts:1` y `:9-10`; `components/ReferralBranch.tsx:33`. Contrato: `contracts/libraries/QuatriviumFamaLib.sol:28` (`MAX_LINEA = 40`) y `constants/commissions.ts:7` y `:14-22` (la generación 13 a la 40 cobra 40 bp).
- Qué pasa: `canExpandReferralDepth` solo deja seguir si `depth < 12`. La rama se dibuja hasta la generación 12 y no abre la 13. El reparto on-chain sigue hasta la 40. No es un tope de pago.
- Reproducción: lectura de esas líneas. No hace falta un pago.
- Impacto: la pantalla de red no enseña las generaciones que el contrato sí paga. El dinero no se desvía.
- Arreglo propuesto: subir el tope de la UI a 40, o escribir en la pantalla que la vista se corta en 12. No toca Credit.
- «Falla antes» propuesto: `expect(canExpandReferralDepth(12)).to.equal(true)` si el arreglo es mostrar hasta la 40. Hoy `depth < 12` lo deja en false. La aserción falla con el código actual.

### QA-DEP-1 · Info · Verificado

- Archivo: `package.json:79`.
- Qué pasa: `wagmi` está en dependencias. Ningún `*.ts`, `*.tsx`, `*.js`, `*.mjs` ni `*.cjs` lo importa.
- Reproducción: búsqueda de `from 'wagmi'` y `require('wagmi')`, sin coincidencias.
- Impacto: peso de instalación. No entra en el camino de la firma.
- Arreglo propuesto: quitarlo del `package.json` cuando se regenere el lock, y volver a medir `npm audit`. No toca Credit.
- «Falla antes» propuesto: un test que falle si `package.json` lista `wagmi` y el árbol de fuentes no lo importa.

## 5. Revisado sin hallazgos

Contratos. Las líneas citadas en el encargo coinciden con `ecf755b`.

- EIP-7702. `_soloEOA` está en `QuatriviumCredit.sol:240-242` y lo usan el registro, el depósito, los dos pedidos, la liquidación, el bono de hito y la donación. Alta `:54`, FamaCaja `:267`, `:278`, `:301` y `:322`, Reserva `onlyEOA` `:111-114`. `pagarPrestamo` `:707` y `desbloquear` `:203` no exigen EOA y mueven lo de `msg.sender`. `usuarioVerificacion` `:486` no usa `tx.origin` y exige `cargoDe` distinto de cero.
- Mantenimiento sin EOA, como está decidido: `marcarMorosoSiVencido` `:848` (solo si está vencido y hay monto), `liberarSelloPrimeraSiExpiro` `:1064` (la librería sale si no expiró, `:124`) y `vencerPadrinoAlPool` `:90` (sello de al menos 1 LUSD y padrino vencido).
- Corte del fundador. `tramo` `:143-147` y `corteFundadorBp` `:155-159`: 500 / 800 / 1200 bp. Fuzz fuera del repo, 256 corridas, pasó (sección 6). También se aplica en `_pagarRendimiento` `:389` y en `extraComisionDe`.
- `retirarLiquidez` `:813-815` es `pure` y revierte. Reserva no tiene función de retiro del bote. `onAlta` `:221` solo acepta `altaFuente`.
- Admins. Credit `propose/confirm/cancel/execute` `:314-360`. Selectores permitidos `:296-298`: `addAdmin`, `removeAdmin`, `pausarPrestamosNuevos`. La pausa `:372-376` suma 7 días y otros 7 de reposo. Quitar al último por debajo de 2 revierte (`:427`). Reserva exige 3 admins al construir (`:127`) y no baja de 2 (`:326`).
- Fundador. Rotación con 72 h `:379-397`. `QuatriviumApk.publicar` `:37` compara el fundador guardado en ese contrato: no sigue la rotación de Credit. Eso ya está abierto como A-03. Alta lee `credit.fundador()` en cada `pagarRegistro`, así que el alta sí sigue la rotación.
- Reentrada. `pagarPrestamo` sostiene `nonReentrant` y luego avisa a Reserva con gas tope (`QuatriviumFamaLib.sol:462`). Reserva llama a `pagarCanje`, que no lleva candado a propósito (`QuatriviumCredit.sol:1093`) para que el boost quepa dentro del pago. Si Reserva falla, se emite `ReservaBoostFallido` y el pago sigue (`:470`). `ingresarAlPool` `:1081` no tiene candado porque Alta lo llama desde un pago que ya lo tiene. `test/reserva.test.js:315` exige que el boost emita `BoostComision` desde la dispersión. No hay un camino de un extraño hacia `pagarCanje`: exige `msg.sender == famaHermano`.
- `staticcall` a hermanos (`_altaHermano` `:1088`, `_reservaDe` `:436`, `usuarioVerificacion` `:493`). Si falla o devuelve corto, la dirección queda en cero y el paso que la usa se salta o revierte. No abre un chequeo.
- Contabilidad. Las dos invariantes de Credit y la de Reserva pasaron 256 × 800 llamadas con 0 reversiones. Cubren depósito, donación, verificación, alta, préstamo, pago, liquidación y el bote.
- Cuotas. `_montoCuota` `:593-603` trunca, y la última cuota (`left <= 1`) devuelve el resto. Un wei no deja el préstamo abierto para siempre.
- Token. Las transferencias de Credit, Alta, Reserva y la librería usan `safeTransfer` o `safeTransferFrom`. `onlySupportedToken` limita la moneda. LUSD no cobra comisión. Un token con comisión no está en el camino de producción.
- Tiempo. `_estaVencido` usa `>` (`:820`), así que el segundo exacto del vencimiento todavía no está vencido. La gracia del secuenciador y el feed obligatorio en 42161 están cubiertos por `forge-test/QuatriviumFase3.t.sol` (8 pruebas en verde, incluido el feed en cero que revierte en 42161).
- Front-running de tasa. `solicitarPrestamoConTope` revierte `TasaSubio` si la curva supera el tope (`:568`). Un tercero puede marcar mora o liquidar cuando el contrato ya lo permite. Eso es el diseño, no un salto.
- Scripts de despliegue. `deploy.cjs`, `deploy-testnet-nuevo.cjs` y `deploy-reserva.cjs` lanzan `throw new Error('Script retirado...')` en la primera línea. `package.json` todavía los nombra, y al correrlos no despliegan otra cosa. El camino vivo es `deploy-arbitrum-sovereign.cjs`.
- KDF. `utils/pinKdf.ts:18` es 9000. `utils/pinPolicy.ts:52-53` es 30 s, 1 min, 5 min, 15 min, 1 h y luego 24 h. `advanceWait` (`:130-148`) no usa el reloj de pared del teléfono: con dos RPC de acuerdo manda la hora de cadena, y sin red solo el reloj monótono. Cambiar la hora del teléfono no salta la espera. El secreto sigue haciendo falta.
- Recibos. `services/writeRpc.ts:75-117` exige dos RPC propios con el mismo hash, el mismo `blockHash` y el mismo estado. Uno solo, o dos que no coinciden, deja el envío pendiente. Los tests de `write provider pending hold` pasaron dentro de los 493.
- Enlaces. `utils/appDeepLink.ts:72-85` solo acepta el esquema de la app y `https` del host público. `javascript:`, `intent:` y `file:` caen en `return false`. `utils/safeOpenUrl.ts:16-24` exige https, sin usuario ni clave en la URL, y solo el host de la invitación.
- TOTP. `services/authenticator.ts:222-228` rechaza un paso ya usado (`step <= last.step`) y un paso demasiado adelantado. La ventana de `utils/totp.ts:143` es el paso anterior, el actual y el siguiente.
- Pantalla. `ScreenGuard` está montado en `App.js:119`. `expo-screen-capture` sí está en `package.json` (`~8.0.10`) y `preventScreenCaptureAsync` se llama al activar la app. La cubierta de segundo plano no depende de ese módulo.
- Demo y vivo. `wallet/AppModeContext.tsx:22-27` separa los modos. El almacén de demo usa claves propias en `services/reservaDemoStore.ts:13`.
- Arranque de eventos. `services/referralNetwork.ts:400-414` y `services/movementHistory.ts:251-265`: si no hay bloque conocido, el origen es `latest - 80000`, con tope de 120000 bloques. No recorre desde el bloque 0 salvo que la cadena tenga menos historia que esa ventana.
- `as any`, `@ts-ignore` y `@ts-expect-error`: ninguno en `*.ts` ni `*.tsx`.
- CI. Las acciones de `ci.yml`, `gitleaks.yml` y `trufflehog.yml` van fijadas por SHA. `permissions: contents: read`. `npm ci --ignore-scripts`. Foundry en `dba66c27052e63476d886f22216e119ba7e615bf`. Gitleaks y TruffleHog comprueban sha256 antes de instalar.
- `.easignore` y Metro: las 7 pruebas de `test/apk-contenido.test.js` pasan.
- Textos legales en español (`i18n/legalCopy.ts:30`, `i18n/legalExtras.ts:53`) dicen que la foto del documento no sale del teléfono. `deviceClaim.ts` no la envía.

Abiertos conocidos que se volvieron a ver y no se reabren como nuevos: segunda cuenta y el 1 LUSD apartado, `soltarPadrino` con padre vacío (Slither lo vuelve a marcar como reentrancy-events en `QuatriviumAlta.sol:72-87`), `image-size`, `QuatriviumApk` sin rotar el fundador, y NIP-17/44 sin implementar (`prepareNostrPayload` sigue fuera de esta pasada como pendiente ya escrito).

## 6. Invariantes y fuzz

Ejecutado en `../qa-tmp` (Forge 1.9.0, 256 corridas), propiedad (d):

```solidity
function testFuzz_corteNoSuperaTramo(uint256 principal) public view {
    principal = bound(principal, 0, 1_000_000 ether);
    uint256 t = reserva.tramo(principal);
    uint256 bp = reserva.corteFundadorBp(t);
    if (principal >= 500 ether) assertEq(bp, 1200);
    else if (principal >= 50 ether) assertEq(bp, 800);
    else assertEq(bp, 500);
    assertLe(bp, 1200);
}
```

Salida: `[PASS] testFuzz_corteNoSuperaTramo(uint256) (runs: 256, μ: 15975, ~: 15931)`. 1 passed, 0 failed.

Las otras cinco no se volvieron a fuzzear como archivo nuevo. Lo que ya corrió en el repo las cubre en parte:

- (a) `sum(posiciones.principal) == totalBloqueado`. La invariante `invariant_tokenBalanceMatchesLockedPlusPot` pasó: 256 corridas, 204800 llamadas, 0 reversiones.
- (b) nadie sin préstamo conserva `montoActivo > 0`. No hay un fuzz nuevo. `_limpiarPrestamo` corre al cerrar el pago (`QuatriviumCredit.sol:756`). Hipótesis: hace falta un handler que deje el monto a medias y compruebe el cero. No se ejecutó.
- (c) `fondoSeguro` solo baja en `cubrirImpago`. No se ejecutó un fuzz aparte. La invariante `invariant_creditNav` obliga a que el seguro siga dentro de la ecuación de caja, no a que solo baje por el impago.
- (e) las comisiones de un pago no superan el interés de ese pago. `_repartirPago` recibe `interesParte` ya recortado a `pago` (`:736`). No se fuzzó el reparto línea a línea en `../qa-tmp`.
- (f) `pausaPrestamosHasta` no pasa de ahora + 7 días. Verificado por lectura: `PAUSA_PRESTAMOS = 7 days` (`:39`) y `pausarPrestamosNuevos` asigna `block.timestamp + PAUSA_PRESTAMOS` (`:374`). No hubo fuzz de esa función en `../qa-tmp`.

## 7. Espejos de constantes

| Dato | App | Contrato | Coincide |
| --- | --- | --- | --- |
| Tramo medio / alto | `constants/reserva.ts:6-7`, 50 y 500 USD enteros | `TRAMO_MEDIO` 50e18, `TRAMO_ALTO` 500e18, `tramo()` `:143-147` | Sí en wei enteros. 49,9 LUSD cae en el tramo bajo en los dos. |
| Corte del fundador | `reservaCorteFundadorBp`: 500 / 800 / 1200 | `corteFundadorBp` `:155-159` | Sí. El fuzz de la sección 6 también. |
| Boost de red | 0 / 1000 / 2000 bp | `boostRedBp` `:149-153` | Sí. |
| Tope anual de Reserva | 1200 bp, 30 días | `MAX_APY_BP`, `LOCK` | Sí. |
| Línea de comisión | `MAX_COMMISSION_LINE = 40`, bp 1500, 800, 600, 400, 200, 80, 40 | `MAX_LINEA = 40` y `famaPorGeneracion` usa la misma escala de fama, no de LUSD | El bp de la app coincide con el comentario de GEN1. La UI del árbol se corta en 12 (QA-LOG-1). |
| LUSD | `0x93b346b6BC2548dA6A1E7d98E9a421B42541425b` en el chequeo de producción | el mismo, 18 decimales, sin oráculo | Sí. |
| Cadena de producción | `eas.json` chain 42161 | feed obligatorio solo en 42161 | Sí. |

## 8. Lo que no se pudo revisar

- La pantalla real. No se compiló la app ni un APK, y no se abrió el emulador. El contraste y las cadenas son cálculos sobre el código. Que un texto largo desborde un botón es hipótesis: 112 claves de los 17 idiomas superan 1,6 veces el largo español (la mayor, `adminLead` en francés, 46 frente a 390 caracteres). `AdminPanel.tsx:126` pinta `adminLead` sin `numberOfLines`. No se midió el píxel.
- 320 dp, RTL (`marginLeft` frente a `Start`) y el área táctil de 44 × 44. Hace falta el layout pintado. Hipótesis, sin medida.
- `FOUNDRY_PROFILE=ci forge test --fuzz-runs 5000` y las invariantes con `FOUNDRY_INVARIANT_RUNS=512` y profundidad 1500. No se corrieron. La pasada pedida de 256 sí.
- Slither sin `detectors_to_exclude`. Solo corrió el config del repo, que excluye `naming-convention`, `solc-version` y `timestamp`.
- solhint 6.2.4 está instalado y salió 255: «Failed to load a solhint's config file». No hay `.solhint.json`. No clasificó el código.
- echidna, mythril, `npx depcheck` y `npx license-checker` no se ejecutaron. No están en el PATH y no se instalaron en esta pasada.
- Snyk y MobSF. Sin sesión.
- Una auditoría visual de los cerca de 70 componentes, uno por uno, no cabe en una lectura de esta fase. Se leyeron los de dinero, candado, enlaces, modo, recibos y los botones que usan `onPrimary`.

## 9. Orden recomendado de arreglos

Ninguno de estos lotes cambia el bytecode de Credit (siguen 1254 bytes libres en Hardhat y 1444 en Forge).

1. QA-APP-1. Añadir el portapapeles de verdad y no compartir secretos. Un test de resolución del módulo.
2. QA-I18N-1. Reescribir `kycNotGov` en los quince idiomas. Un test que prohíba «SMS» en esa clave.
3. QA-UI-1. Aclarar `onPrimary` en el tema claro. El cálculo de contraste como test.
4. QA-LOG-1. Decidir si la red muestra 40 generaciones o si el texto avisa el corte en 12.
5. QA-DEP-1. Quitar `wagmi` en un commit que regenere el lock y vuelva a medir `npm audit`.

Los fuzz que faltan (b, c, e, f) pueden ir en un lote de tests de Foundry, fuera del bytecode de producción, cuando se decida ampliar `QuatriviumInvariant.t.sol`.
