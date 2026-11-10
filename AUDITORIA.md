# Auditoría de QUATRIVIUM

`QuatriviumCredit` mide 23330 bytes (1246 libres de 24576). El contrato de prueba que hereda de él, `QuatriviumCreditHarness`, mide 24541 bytes y también cabe. Un pago con 40 generaciones de comisión usó 1246534 de gas en Foundry. Un bloque de Arbitrum suele admitir unos 32 millones, así que no recorté el recorrido.

Arbitrum One ya acepta EIP-7702 (ArbOS 40, según el blog de la fundación y la lista de autorizaciones de Arbiscan). El chequeo `tx.origin == msg.sender` deja pasar a una cuenta normal con código delegado. Ahora entra solo quien no tiene código (`NoEsEOA`). Fuente: https://blog.arbitrum.foundation/the-smartest-wallet-you-already-own-is-on-arbitrum/ y https://eips.ethereum.org/EIPS/eip-7702.

Un PIN de 6 dígitos solo tiene 1 000 000 de combinaciones. La protección real es el almacén de hardware, cuando el teléfono lo tiene, y el bloqueo creciente tras cada fallo (30 s, 1 min, 5 min, 15 min, 1 h). El PIN puede tener de 6 a 12 dígitos. Si no hay hardware, la clave queda en el almacén del sistema y la app lo avisa.

Fecha de la revisión: 10 de noviembre de 2026 (America/Caracas). Rama `cursor/soberania-contratos-8e15`. Tras quitar el tope de 24 h del feed: Hardhat 306, Foundry 51. Credit: 21882 bytes, 2694 libres de 24576.

La clave del historial (commits `10553d4` y `dc40f15`, archivo `.env.worker.example`) ya fue revocada. No está en el árbol. El valor no se copia y la historia no se reescribe.

Sigue abierto: los dos hallazgos bajos del alta (S-01 y S-02), los tests que solo leen texto y cubren dinero (lista en la segunda auditoría), `npm audit` con `handlebars` (B-03) y el cifrado NIP-17/44, que no se ha implementado.

Antes de dinero real hace falta una auditoría externa y una billetera de fundador de varias firmas o física (`CONFIRM_FOUNDER_WALLET=yes`). Cuando Jose lo ordene, y nada de esto se ha hecho: compilar el APK y su SHA-256, desplegar en Arbitrum One y llenar `constants/deployedAddresses.ts`, publicar huella y hash en `QuatriviumApk`, IPFS y ENS.

## Estado de los hallazgos

El quinto punto grave del resumen (feed viejo) era **B-01, Medio**, no Alto. Tras los arreglos quedan **0 altos abiertos en el código**. A-04 sigue pendiente del dueño: hay que borrar la clave en la cuenta de Resend. No está en la app. Credit quedó en 21891 bytes, 2685 libres de 24576.

| ID | Era | Estado |
| --- | --- | --- |
| A-01 | Alto | Arreglado. `QuatriviumApk` guarda la huella del certificado. `apkCertCheck` cubre los tres estados. La lectura nativa está en `modules/quatrivium-signing-cert` y se prueba al compilar. |
| A-02 | Alto | Arreglado. La pausa entra por el voto 2 de 3 y 72 h, con 7 días de descanso. Tests en `test/pausa-quorum.test.js`. |
| A-03 | Alto | Documentado, sin cambio de contrato. README, HANDOFF y `CONFIRM_FOUNDER_WALLET=yes` en el despliegue. La llave perdida sigue sin relevo dentro del contrato: es la decisión tomada. |
| A-04 | Alto | Cerrado por el dueño. La clave estaba en el historial, commits `10553d4` y `dc40f15`, archivo `.env.worker.example`. Ya fue revocada. No está en la app. El valor no se copia. El historial no se reescribe. |
| B-01 | Medio | El tope de 24 h se quitó. Ese feed no late cada día: con `answer == 0` se liquida aunque la ronda tenga meses. La caída se lee de la ronda anterior. |
| B-02 | Medio | Arreglado en la superficie: `prepareNostrPayload` devuelve null en todos los caminos. No hay pantalla de mensaje privado. Cifrar NIP-17/44 sigue sin hacerse. La mora no se publica. |
| B-03 | Medio | Requiere decisión. `npm audit` sigue con 1 crítica (`handlebars`, herramienta, no dependencia directa) y 11 altas. Actualizar el árbol a ciegas puede romper Expo. No se tocó. |
| C-01 | Bajo | Arreglado. El comentario de `pagarVerificacion` ya no dice 0.50 LUSD. El comportamiento no cambió. |
| C-02 | Bajo | Pendiente. Reescribir cada test que lee fuente sería un refactor. Los arreglos de esta ronda sí ejecutan el contrato. |
| C-03 | Bajo | Arreglado. `web/invite/index.html` ya no muestra un hash inventado. |
| C-04 | Informativo | Aplicado solo en texto. El alta sigue siendo 1 fundador, 1 Reserva, 1 padrino y 1 sello. README lo dice. |

## Segunda auditoría

Revisión de `60a9654` y `960f446`, más el comportamiento real del alta. No se cambió la lógica de los contratos.

### Alta

`QuatriviumAlta.pagarRegistro` (líneas 53-67) siempre aparta 1 LUSD, invite o no. `registrarHumanoConPadre` (Credit, líneas 441-449) convierte la invitación vacía en el fundador y rechaza una cuenta que se nombre a sí misma o un invitador que no esté registrado. Al pagar el primer nivel 1, `soltarPadrino` (Alta, líneas 70-84) entrega ese 1 a quien invitó si `cobradorListo` (Credit, líneas 1100-1101). Si no, lo mete al pool y el 5 % de esa entrada va al seguro (`ingresarAlPool`, líneas 1106-1110). Si pasan 7 días sin ese pago, `vencerPadrinoAlPool` (Alta, líneas 88-100) lo manda al pool. El 5 % de 1 LUSD es exacto: `1e18 * 500 / 10000 = 0.05e18`, sin polvo. La suma de saldos no cambia: el mock no crea tokens en el alta.

| ID | Severidad | Qué pasa | Qué se hizo |
| --- | --- | --- | --- |
| S-01 | Bajo | Una segunda cuenta puede nombrar a la primera y, si esa ya pagó alta y nivel 1, cobrar el 1 apartado. El costo es los otros 3 LUSD del alta de la segunda cuenta, más el interés del nivel 1. No es ganancia. | Nada en el contrato. Quedó descrito en los textos y en `test/alta-invitacion.test.js`. No hace falta decisión. |
| S-02 | Bajo | Si `soltarPadrino` recibiera padre cero o igual al deudor, devuelve sin soltar el 1 (Alta, línea 73). El registro normal no produce ese padre. | No se cambió. El camino de la app no lo alcanza. |

### Lo revisado en los dos commits

- Pausa: solo el contrato, tras 2 de 3 y `block.timestamp >= eta` (72 h justas sí valen, Credit líneas 364-372 y 385-389). A los 7 días justos el préstamo nuevo vuelve (`>= pausaPrestamosHasta`). El descanso usa `< pausaReposoHasta`, así que el instante exacto ya permite votar otra. `p.executed = true` va antes de la llamada interna; si esa llamada falla, toda la transacción revierte. No hay reentrada hacia fuera.
- APK: solo el fundador publica. La huella del certificado queda fija en la primera versión. No hay borrado ni llamada externa.
- Feed: no hay tope por antigüedad. `answer == 0` permite liquidar si ya pasó más de 1 h desde `startedAt` y la gracia del préstamo. Una ronda vacía (`startedAt == 0`) o un feed que revierte pospone solo la liquidación.
- Nostr: `prepareNostrPayload` devuelve null siempre (`utils/sovereignSurface.ts`, línea 128). Ningún componente ni idioma ofrece mensaje privado. `nostrMayPublish` también es falso, incluida la mora.
- Residuos: `scripts/check-external-services.mjs` pasa. Los nombres prohibidos viven en esa lista y en `scripts/run-full-cyber-audit.sh`, que sigue citando `Groth16Verifier` y `zk-contracts` como carpetas a excluir. Esas carpetas ya no existen. No se tocó el script porque los tests leen el resto del archivo.
- Credit: 21891 bytes, 2685 libres de 24576.

### Tests que aún leen texto y tocan dinero

No se reescribieron en esta pasada.

- `test/fase3-seguro-apk.test.js`: el rechazo de ETH lee el fuente y también envía ETH.
- `test/cyber-hardening.test.js`: «gates Alta loans…» lee el fuente del alta. «offers canje…» y «reads alta and reserve rate…» leen textos de Reserva y fama. «blocks Solicitar in Real…» lee compuertas de alta. El del pool bloqueado ahora también llama a `retirarLiquidez`.
- `test/security-audit-fixes.test.js`: lee `QuatriviumReserva.sol` para comprobar que no hay retiro del bote.
- `test/screen-copy.test.js`: el splash y el alta vieja siguen leyendo texto. Pool y Reserva ya ejecutan el contrato.
- `test/fase4-app.test.js`: el 15 %, el 5 %, la gracia y el aviso de Reserva leen textos. El alta ya ejecuta el contrato.

## Informe original

Solo lectura en su origen. Los arreglos posteriores están en la tabla de arriba.

No se compiló la app, no se generó un APK y no se desplegó nada. La interfaz se leyó en el código, no en un teléfono.

## Resumen ejecutivo

Este texto es la primera pasada. La pausa de un solo admin, el hash del APK y el feed viejo ya están corregidos en la tabla de estado y en la segunda auditoría.

El proyecto no está listo para dinero real. Los contratos de préstamo, el pool, la Reserva y el fondo de seguro coinciden con las reglas de dinero en lo esencial, y las pruebas automáticas pasan, pero falta una auditoría externa y el despliegue.

Un solo administrador puede congelar los préstamos nuevos de inmediato y volver a hacerlo sin límite. La app no calcula el hash del APK instalado, así que no puede avisar si el archivo es otro. Si se pierde la llave del fundador, nadie más puede cobrar su parte ni publicar un hash nuevo. El feed del sequencer, si se queda viejo pero dice que Arbitrum está arriba, no frena las liquidaciones.

Nada de lo leído permite que un extraño vacíe el pool, el bote de Reserva o el fondo de seguro. Eso no sustituye la auditoría externa.

## Cómo se midió

- Hardhat: 294 pruebas, todas en verde, una sola corrida.
- Foundry: 51 pruebas, todas en verde, con `--fuzz-runs 32`. Los invariantes corrieron 256 veces, sin reverts.
- `node scripts/check-external-services.mjs`: sin nombres prohibidos en el árbol actual.
- `node scripts/check-i18n.mjs`: 17 idiomas, 1256 claves cada uno, sin copias largas del inglés.
- `npm audit`: 1 crítica, 11 altas, 24 medias, 15 bajas. La crítica es `handlebars` (inyección en plantillas precompiladas). No está en las dependencias directas de `package.json`; entra por herramientas de desarrollo.
- Slither: el repo tiene `scripts/run-slither.mjs` y `slither.config.json`. El programa `slither` no está instalado en esta máquina. No se ejecutó. No se inventan hallazgos de Slither.

Tamaños de bytecode desplegado (artifact de Hardhat, límite EIP-170 = 24576):

| Contrato | Bytes | Libres |
| --- | --- | --- |
| QuatriviumCredit | 21769 | 2807 |
| QuatriviumReserva | 9765 | 14811 |
| QuatriviumFamaCaja | 9658 | 14918 |
| QuatriviumFamaLib | 8653 | 15923 |
| QuatriviumAlta | 3536 | 21040 |
| QuatriviumLeveling | 1744 | 22832 |
| LoanLadder | 889 | 23687 |
| QuatriviumApk | 656 | 23920 |

`LoanTierSeed` sale en 4 bytes porque es una librería enlazada dentro de Credit, no un contrato que se despliega solo.

## Hallazgos

### A-01 · Alto · seguridad / despliegue

La app no mira el APK que está instalado.

- Archivo: `app/index.tsx`, línea 1042. Llama `<ApkIntegrityNote />` sin hash local ni hash publicado.
- Archivo: `components/ApkIntegrityNote.tsx`, líneas 15-31. Si `publishedHash` llega vacío, trata el registro como vacío y muestra «versión no verificada». Nunca lee un archivo.
- Cómo reproducirlo: abrir la sala de admin en el código. El componente no recibe props. `apkCheck` en `utils/sovereignSurface.ts` (líneas 61-72) compara solo los textos que le pasan.
- Impacto: un APK distinto puede instalarse y la app no tiene con qué compararlo. El aviso fuerte de hash distinto no puede aparecer en el flujo real.
- Arreglo: leer el SHA-256 del APK instalado y el último hash de `QuatriviumApk`, y pasar ambos al componente. Hasta el despliegue, el texto «no verificada» es honesto, pero no protege.

### A-02 · Alto · lógica / seguridad

Un solo admin pausa los préstamos nuevos, sin votación y sin las 72 horas, y puede repetirlo para siempre.

- Archivo: `contracts/QuatriviumCredit.sol`, líneas 374-376.

```solidity
function pausarPrestamosNuevos() external onlyAdmin {
    pausaPrestamosHasta = block.timestamp + PAUSA_PRESTAMOS;
}
```

`PAUSA_PRESTAMOS` es 7 días (línea 41). `solicitarPrestamo` exige `block.timestamp >= pausaPrestamosHasta` (línea 477). No hay quórum ni espera.

- La regla cerrada pide 2 de 3 y 72 horas. El código solo usa 2 de 3 y 72 horas para `addAdmin` y `removeAdmin` (`allowedAdminSelector`, líneas 306-307 y 320-364). La pausa queda fuera.
- Cómo reproducirlo: con una de las tres llaves, llamar `pausarPrestamosNuevos`. Al día 6, llamarla otra vez. `solicitarPrestamo` sigue revirtiendo. Pagos y liquidaciones no se frenan.
- Impacto: una llave robada o un admin en desacuerdo apaga los préstamos nuevos sin límite. No saca dinero.
- Arreglo: si la pausa debe ser de emergencia de una sola llave, escribirlo así en `HANDOFF.md` y poner un tope (por ejemplo, no renovar hasta que venza). Si debe ser 2 de 3, moverla al mismo candado que `addAdmin`. Cabe en los 2807 bytes si solo se reutiliza `proposeAdminAction`, pero hay que medir el bytecode después.

### A-03 · Alto · despliegue

Si se pierde la llave del fundador, no hay relevo.

- `aplicarFundador` solo la llama el fundador actual, tras 72 horas (`QuatriviumCredit.sol`, líneas 379-401).
- `QuatriviumApk.publicar` solo la llama el fundador fijado en el constructor (`QuatriviumApk.sol`, líneas 23-30). Ese valor es `immutable`. Cambiar el fundador en Credit no cambia quién publica hashes.
- Impacto: se dejan de cobrar el 1 LUSD del alta y el 15 % del interés, y no se puede publicar otro hash. El pool, los pagos y la Reserva siguen. Es aceptable solo si el dueño guarda esa llave fuera del teléfono y acepta que perderla es definitivo.
- Arreglo: antes de desplegar, decidir si el fundador de `QuatriviumApk` será la misma billetera y dónde se guarda la copia. No hace falta cambiar Credit si esa decisión se acepta.

### A-04 · Alto · seguridad

En el historial de git hay una clave de Resend. No está en el árbol actual.

- Archivo histórico: `.env.worker.example`, commits `10553d4` y `dc40f15`. Ese archivo ya no existe en la rama.
- El valor no se copia aquí. Hay que revocarla en Resend. No reescribir la historia.
- No apareció otra clave asignada de mensajería en el árbol actual. El escáner de servicios prohibidos pasa.

### B-01 · Medio · dinero / lógica

Si el feed del sequencer responde «arriba» pero el dato es viejo, la liquidación sigue.

- Archivo: `contracts/QuatriviumCredit.sol`, líneas 863-889.
- Si `latestRoundData` revierte, o `answer != 0`, o las marcas de tiempo son cero o futuras, la liquidación se pospone. Si `answer == 0` y `updatedAt` es antiguo pero no cero, no hay tope de antigüedad: se liquida.
- En chainId 42161 el constructor rechaza el feed `address(0)` (línea 253). En otras redes, feed cero no pospone liquidaciones (línea 865). Eso coincide con Hardhat y Sepolia.
- El margen de 1 hora tras volver está en las líneas 888-889 (`SEQUENCER_GRACIA`).
- Cómo reproducirlo: un mock con `answer = 0` y `updatedAt` de hace varios días. `liquidate` no revierte por sequencer.
- Ese arreglo propuesto (tope de 24 horas) no vale: el feed real de uptime no late cada día. Una ronda vieja con `answer == 0` significa que el sequencer sigue arriba.

### B-02 · Medio · seguridad

Nostr no cifra y no se conecta. La mora sí está bloqueada.

- `utils/sovereignSurface.ts`, líneas 88-101. `nostrMayPublish` rechaza `mora`, `moroso` y `delinquency`. `prepareNostrPayload` devuelve el texto tal cual, con la etiqueta NIP-17 o NIP-44. No hay cifrado ni websocket.
- Hoy nadie envía ese objeto a un relé. El riesgo aparece si más adelante se publica `body` creyendo que ya va cifrado.
- Arreglo: no enviar `body` a la red hasta que exista cifrado de verdad, o quitar las etiquetas NIP hasta entonces.

### B-03 · Medio · dependencia

`npm audit` marca 1 vulnerabilidad crítica y 11 altas. La crítica es `handlebars` 3.0.0–4.7.9 (inyección en plantillas). No es dependencia directa. Las altas incluyen, entre otras, `axios`, `node-forge`, `undici`, `expo-router` y `@react-navigation/core`, casi todas por el árbol de herramientas o de Expo. No se actualizó nada en esta auditoría.

### C-01 · Bajo · texto

El comentario de `pagarVerificacion` todavía dice «0.50 o 1 LUSD» (`QuatriviumCredit.sol`, línea 1053). La función solo acepta 0.5 o 1 porque `alimentarPool` lo exige (`QuatriviumFamaLib.sol`, línea 471), y solo la llama el contrato Alta. El alta real transfiere 1 LUSD (`QuatriviumAlta.sol`, línea 66). No es un camino abierto al usuario. El comentario sobra.

### C-02 · Bajo · prueba

Varias pruebas de la app leen el texto del fuente (`test/fase4-app.test.js` y partes de `test/cyber-hardening.test.js`) en lugar de ejecutar la pantalla. Sirven para que no vuelva un servicio prohibido. No prueban un toque ni una transacción.

### C-03 · Bajo · documentación

`web/invite/index.html` trae un SHA-256 escrito a mano (línea 180) y un enlace a `/apk/quatrivium-sovereign.apk`. No es el registro on-chain. Hasta que exista el APK firmado, ese número puede no coincidir con ningún archivo.

### C-04 · Informativo · dinero

El alta on-chain no manda «el resto» al pool de préstamos en el mismo momento. `QuatriviumAlta.pagarRegistro` (líneas 58-66) parte 4 LUSD así: 1 al fundador, 1 al bote de Reserva, 1 apartado para el padrino y 1 de sello al pool. La frase corta de la regla («1 al fundador y el resto al pool») es el resumen de pantalla (`altaSplitNote`). El padrino cobra su 1 solo si tiene alta y L1; si no, entra al pool (`soltarPadrino`, líneas 76-80). No es un robo. Conviene no simplificarlo en documentos legales.

## Lo que está correcto

- El pool no se retira: `retirarLiquidez` revierte (`QuatriviumCredit.sol`, líneas 816-817).
- El fondo de seguro es el 5 % (`SEGURO_BP = 500`) y `cubrirImpago` solo mueve contabilidad hacia el pool. No hay función para sacarlo.
- El fundador cobra el 15 % del interés en el mismo pago (`FUNDADOR_BP = 1500`, `dispersarInteres`, líneas 354-356). La generación 0 no exige alta ni L1. El resto de la línea sí (`_pagarCapped`, líneas 425-427).
- El premio del liquidador es el menor entre el 5 % del principal restante y el interés que queda tras el fee (`liquidate`, líneas 921-925). El fee se queda en el pool.
- La liquidación espera 48 horas más el tiempo caído más 1 hora. Un contrato no puede liquidar (`tx.origin`). Nadie se liquida a sí mismo.
- Reserva: nivel 10, 30 días, tope 12 % (`MAX_APY_BP = 1200`), el principal se transfiere al desbloquear (`_cerrar`, líneas 345-365). Si el bote no alcanza, el rendimiento se recorta y no revierte. No hay función para sacar el bote. Los admins solo votan su entrada o salida, 2 de 3 y 72 horas, y no pueden bajar de 2.
- El quórum de Credit está fijo en 2 (`_requiredConfirms`). Un voto no se repite (`already confirmed`). La propuesta no caduca. No se puede proponer otra función que `addAdmin` o `removeAdmin`.
- LUSD está fijado en el código a `0x93b346b6BC2548dA6A1E7d98E9a421B42541425b`. No hay oráculo de precio. Solo hay un token soportado, el del constructor.
- La aprobación de la app es por el monto exacto, no infinita (`services/quatriviumCreditService.ts`, líneas 204-206).
- Los préstamos y los pagos rechazan contratos (`tx.origin`). Eso corta el préstamo relámpago desde un contrato.
- `allowBackup` es false y `usesCleartextTraffic` es false (`app.json`, líneas 32-33).
- La frase de la billetera vive en el almacenamiento seguro del teléfono (`services/appWallet.ts`). Hay guarda de captura (`components/ScreenGuard.tsx`).
- Los botones de pago usan un candado de reentrada (`hooks/useWeb3Transactions.ts`, líneas 24-28, y `useVerificationFee.ts`).
- La mora no pasa el filtro de Nostr.
- CI pide solo `contents: read` y fija el SHA de las acciones (`ci.yml`).
- Los 17 idiomas tienen las mismas 1256 claves. El árbol actual no nombra los servicios prohibidos.

## Ataques económicos

| Ataque | Qué gana | Qué lo frena |
| --- | --- | --- |
| Muchas cuentas para cobrar el 1 del padrino | El 1 LUSD sale del alta que la misma persona pagó | Alta de 4 LUSD por cuenta. El neto no es ganancia. |
| Inflar la racha con préstamos de nivel 1 | Nada | La racha solo cuenta nivel 2 o más y a tiempo (`QuatriviumFamaCaja.sol`, comentario de línea 321 y `_contarCierre`). |
| No pagar a propósito | Se queda el principal hasta la liquidación | A las 48 horas más el sequencer, un tercero paga la deuda y cobra como mucho el interés. El principal vuelve al pool. |
| Préstamo relámpago | — | `tx.origin == msg.sender` en alta, depósito, préstamo, pago y liquidación. |
| Vaciar el fondo de seguro | Como mucho el premio de una liquidación, ya acotado | `cubrirImpago` no transfiere a una billetera arbitraria. |
| Spam de altas | Cada alta cuesta 4 LUSD al atacante | No quema el gas de otro. |
| Dos admins echan al tercero | Controlan quién entra | Es el diseño de 2 de 3. No pueden bajar de dos. |
| Un admin pausa para siempre | Nadie pide préstamos nuevos | Ver A-02. No toca el dinero ya prestado. |

## Pantallas

La app entra por `app/index.tsx`. Cada sala es un panel. No se dibujó en un dispositivo.

| Sala | Qué hace | Carga / error / vacío |
| --- | --- | --- |
| Inicio | Billetera, modo demo o real, acceso a las salas | Si no hay frase, pide crearla o importarla |
| wallet | Crear, importar, ver la frase | Candado local |
| alta | Approve y `pagarRegistro` de 4 LUSD | `useVerificationFee` no deja doble toque |
| credit | Estado del alta | Vacío si el contrato no está desplegado |
| loans | Pedir y pagar | Pausa on-chain y falta de saldo revierten |
| ranks, fame, bonuses, canje | Fama y canje | Leen la cadena; si el nodo calla, las pruebas de lectura dicen que no se borra el último dato |
| donate | Donación al fundador | Cerrada en demo |
| network, people | Referidos | Lista paginada |
| history | Movimientos | Depende del RPC |
| admin | Pausa, admins, aviso de APK | Sin props de hash: siempre «no verificada» (A-01) |

Modo oscuro: `userInterfaceStyle` es `automatic` y hay `ThemeContext`. No se midió contraste en un teléfono. El teclado de Android usa `softwareKeyboardLayoutMode: resize`.

## Flujos

Crear e importar billetera: `services/appWallet.ts` genera 24 palabras y guarda la clave en el almacenamiento seguro. Importar usa la misma caja. Borrar llama a `wipeAppWallet`. No se encontró un `console.log` de la frase.

Alta, préstamo, pago, liquidación, nivel, comisiones, padrino y racha: el camino de la app llama a `services/quatriviumCreditService.ts`, que aprueba el monto justo y firma con la billetera interna. Los números de interés y de gracia los calcula el contrato; la pantalla muestra 15 %, 5 % y 48 horas con textos de idioma. No se ejecutó una transacción real, así que la coincidencia exacta de una cuota en pantalla contra el contrato queda en las pruebas de Hardhat y Foundry, no en un teléfono.

Reserva: `bloquear` exige nivel 10 y 1 LUSD mínimo. `desbloquear` devuelve el principal aunque el bote esté vacío. Con bote parcial, `_pagarRendimiento` paga `min(techo, bote)`.

Pausa y votación: ver A-02 y la sección de lo correcto.

Avisos: `hooks/useLoanPaymentReminders.ts` programa avisos locales. No pide token de push.

Perfil y ranking: el ranking ordena eventos `AfiliadoRegistrado` y lecturas de estado (`services/fameLeaderboard.ts`). Dos teléfonos con el mismo nodo ven el mismo orden. Un nodo mentiroso puede mostrar otra cosa; no hay una segunda fuente.

Invitación: `web/invite/index.html` abre `quatrivium-sovereign://invite?c=` y copia el código. El código se filtra a letras y números. El SHA de esa página es fijo (C-03).

Idioma: 17 archivos, mismas claves, sin textos vacíos según `check-i18n.mjs`. No se leyó cada una de las 1256 frases en los 17 idiomas palabra por palabra. Se buscó el nombre viejo del proyecto, la tienda de aplicaciones, un oráculo y «1 USDT» / «2 USDT» en `es.json` y no aparecieron.

## Despliegue, sin ejecutarlo

`scripts/deploy-arbitrum-sovereign.cjs` exige el feed `0xFdB631F5EE196F0ed6FAa767959853A9F217697D` en chainId 42161 y el LUSD oficial. Si el script se corta a mitad, pueden quedar contratos desplegados sin enlazar. No hay que rellenar `constants/deployedAddresses.ts` hasta tener las direcciones reales. El script no debe imprimir `PRIVATE_KEY`. No se encontró una clave privada escrita en los scripts actuales.

Si LUSD se detiene o un RPC miente, la app rota RPC públicos (`constants/rpcConfig.ts`) pero no puede inventar otro estado. Si todos fallan, las lecturas quedan en el último valor o en error. Si el pool se vacía, no salen préstamos nuevos. Las liquidaciones necesitan que alguien traiga el LUSD de la deuda.

## Qué no se pudo revisar

- Slither: no está instalado.
- Ninguna pantalla en un teléfono, ni modo oscuro, ni contraste, ni un dedo sobre un botón. El usuario prohibió compilar la app.
- Los 17 idiomas, frase por frase.
- Cada PNG de `assets/` como imagen. Se contaron como archivos del repo, sin lógica.
- `node_modules`, `artifacts`, `cache`, `forge-out` y `forge-cache`: no están en git. No se listan uno a uno.
- Comportamiento real de LUSD, de Chainlink y de los RPC en Arbitrum One. No se llamó a la red.
- Si la clave histórica de Resend sigue activa. Solo se señala el commit.

## Pruebas que faltan (no se añadieron)

1. Un admin no puede dejar `pausaPrestamosHasta` movido para siempre, o el test documenta que sí puede y que eso es aceptado.
2. Feed con `answer = 0` y `updatedAt` viejo: la liquidación debe posponerse si se adopta el tope de antigüedad.
3. `ApkIntegrityNote` sin props queda en «no verificada» y no hay lectura de archivo. Cuando exista el hash del APK, un test con hash distinto debe exigir el aviso fuerte.
4. `prepareNostrPayload('mora', ...)` sigue en null, y el cuerpo de un aviso no se considera cifrado.
5. Perder la llave del fundador deja `publicar` inutilizable. Test de documento, no de contrato, hasta que haya un relevo.

## Plan, sin tocar nada todavía

1. Revocar la clave de Resend (A-04). No cambia Credit.
2. Decidir si la pausa de un solo admin es aceptada. Si no, moverla al voto 2 de 3. Puede gastar unos cientos de bytes de los 2807 libres. Hay que medir.
3. No desplegar hasta la auditoría externa.
4. Al firmar el APK, calcular su SHA-256 en el teléfono y compararlo con `QuatriviumApk` (A-01). Eso es código de app, no de Credit.
5. Guardar la llave del fundador y aceptar que `QuatriviumApk` no tiene relevo (A-03), o redesplegar ese contrato si aún no se ha publicado.
6. Tope de antigüedad del feed (B-01), corto, medido contra EIP-170.
7. No presentar Nostr como cifrado hasta que lo sea (B-02).

## Antes de dinero real

Contratos desplegados en Arbitrum One, direcciones escritas en `constants/deployedAddresses.ts`, APK firmado con hash publicado, IPFS y ENS si se van a usar, la clave de Resend revocada, y una auditoría externa de los contratos. Este archivo no es esa auditoría.

## Inventario

Cada archivo seguido de git en esta rama se revisó al menos por nombre, tipo y, si era código o texto, por búsqueda de dinero, secretos, servicios prohibidos o reglas rotas. Los contratos de dinero y los flujos de la lista se leyeron con detalle. Los binarios no se abrieron como imagen.

)
- `.dockerignore` — revisado: sí
- `.env.example` — revisado: sí
- `.github/workflows/ci.yml` — revisado: sí
- `.github/workflows/gitleaks.yml` — revisado: sí
- `.github/workflows/trufflehog.yml` — revisado: sí
- `.gitignore` — revisado: sí
- `.npmrc` — revisado: sí
- `.prettierignore` — revisado: sí
- `.prettierrc.json` — revisado: sí
- `.snyk` — revisado: sí
- `.sonarcloud.properties` — revisado: sí
- `.trivyignore` — revisado: sí
- `.vscode/settings.json` — revisado: sí
- `App.js` — revisado: sí
- `CONTEXTO.md` — revisado: sí
- `HANDOFF.md` — revisado: sí
- `README.md` — revisado: sí
- `app.json` — revisado: sí
- `app/_layout.tsx` — revisado: sí
- `app/index.tsx` — revisado: sí
- `assets/adaptive-icon.png` — revisado: sí
- `assets/favicon.png` — revisado: sí
- `assets/gems/amethyst.png` — revisado: sí
- `assets/gems/aquamarine.png` — revisado: sí
- `assets/gems/citrine.png` — revisado: sí
- `assets/gems/diamond.png` — revisado: sí
- `assets/gems/emerald.png` — revisado: sí
- `assets/gems/garnet.png` — revisado: sí
- `assets/gems/onyx.png` — revisado: sí
- `assets/gems/peridot.png` — revisado: sí
- `assets/gems/ruby.png` — revisado: sí
- `assets/gems/sapphire.png` — revisado: sí
- `assets/gems/topaz.png` — revisado: sí
- `assets/gems/tourmaline.png` — revisado: sí
- `assets/icon.png` — revisado: sí
- `assets/logo-source.png` — revisado: sí
- `assets/logo.png` — revisado: sí
- `assets/ranks/1.png` — revisado: sí
- `assets/ranks/10.png` — revisado: sí
- `assets/ranks/2.png` — revisado: sí
- `assets/ranks/3.png` — revisado: sí
- `assets/ranks/4.png` — revisado: sí
- `assets/ranks/5.png` — revisado: sí
- `assets/ranks/6.png` — revisado: sí
- `assets/ranks/7.png` — revisado: sí
- `assets/ranks/8.png` — revisado: sí
- `assets/ranks/9.png` — revisado: sí
- `assets/snack-icon.png` — revisado: sí
- `assets/splash-blank.png` — revisado: sí
- `assets/splash-icon.png` — revisado: sí
- `assets/wallets/bitget.png` — revisado: sí
- `assets/wallets/coinbase.png` — revisado: sí
- `assets/wallets/metamask.png` — revisado: sí
- `assets/wallets/okx.png` — revisado: sí
- `assets/wallets/other.png` — revisado: sí
- `assets/wallets/rabby.png` — revisado: sí
- `assets/wallets/rainbow.png` — revisado: sí
- `assets/wallets/safepal.png` — revisado: sí
- `assets/wallets/tokenpocket.png` — revisado: sí
- `assets/wallets/trust.png` — revisado: sí
- `babel.config.js` — revisado: sí
- `components/AccountOnboarding.tsx` — revisado: sí
- `components/AccountWorldCard.tsx` — revisado: sí
- `components/ActivateCreditSection.tsx` — revisado: sí
- `components/AdminAccess.tsx` — revisado: sí
- `components/AdminPanel.tsx` — revisado: sí
- `components/AdminStatusReadout.tsx` — revisado: sí
- `components/ApkIntegrityNote.tsx` — revisado: sí
- `components/AppLockGate.tsx` — revisado: sí
- `components/AppSection.tsx` — revisado: sí
- `components/AppText.tsx` — revisado: sí
- `components/AppWindow.tsx` — revisado: sí
- `components/AuthMethodPicker.tsx` — revisado: sí
- `components/AuthenticatorSetup.tsx` — revisado: sí
- `components/BalanceDisplay.tsx` — revisado: sí
- `components/BiometricLockSection.tsx` — revisado: sí
- `components/BrandLogo.tsx` — revisado: sí
- `components/BrandSplash.tsx` — revisado: sí
- `components/BusyLogo.tsx` — revisado: sí
- `components/CreditAccessBanner.tsx` — revisado: sí
- `components/CreditAccessGate.tsx` — revisado: sí
- `components/DemoModeBanner.tsx` — revisado: sí
- `components/DonateFounderSection.tsx` — revisado: sí
- `components/FameCanjeSection.tsx` — revisado: sí
- `components/FameLeaderboard.tsx` — revisado: sí
- `components/FundsConfirmHost.tsx` — revisado: sí
- `components/GraceMoraClock.tsx` — revisado: sí
- `components/HomeHub.tsx` — revisado: sí
- `components/HowTheAppWorks.tsx` — revisado: sí
- `components/LanguageSelector.tsx` — revisado: sí
- `components/LanguageWelcome.tsx` — revisado: sí
- `components/LegalDocuments.tsx` — revisado: sí
- `components/LegalWelcome.tsx` — revisado: sí
- `components/LinkWalletForm.tsx` — revisado: sí
- `components/LinkedWalletCard.tsx` — revisado: sí
- `components/LoanTierCard.tsx` — revisado: sí
- `components/LockSettings.tsx` — revisado: sí
- `components/LockedLoanCatalog.tsx` — revisado: sí
- `components/MilestoneBonusCatalog.tsx` — revisado: sí
- `components/ModeToggle.tsx` — revisado: sí
- `components/MovementHistory.tsx` — revisado: sí
- `components/NetworkStatusBanner.tsx` — revisado: sí
- `components/PasswordRulesHint.tsx` — revisado: sí
- `components/PodiumFrame.tsx` — revisado: sí
- `components/PoolSupportSection.tsx` — revisado: sí
- `components/ProfileAvatar.tsx` — revisado: sí
- `components/ProfileSettings.tsx` — revisado: sí
- `components/PublicFacePicker.tsx` — revisado: sí
- `components/PublicIdentityForm.tsx` — revisado: sí
- `components/RachaSection.tsx` — revisado: sí
- `components/RankFrame.tsx` — revisado: sí
- `components/RankGem.tsx` — revisado: sí
- `components/RankLadder.tsx` — revisado: sí
- `components/RankMedal.tsx` — revisado: sí
- `components/ReferralBranch.tsx` — revisado: sí
- `components/ReferralHistory.tsx` — revisado: sí
- `components/ReferralSection.tsx` — revisado: sí
- `components/ReservaSection.tsx` — revisado: sí
- `components/ScreenGuard.tsx` — revisado: sí
- `components/SecretInput.tsx` — revisado: sí
- `components/SecuritySettings.tsx` — revisado: sí
- `components/SettingsButton.tsx` — revisado: sí
- `components/SponsorPoolButton.tsx` — revisado: sí
- `components/ThemeToggle.tsx` — revisado: sí
- `components/TokenSelector.tsx` — revisado: sí
- `components/TransferWalletsModal.tsx` — revisado: sí
- `components/UserMetrics.tsx` — revisado: sí
- `components/UsernameSection.tsx` — revisado: sí
- `components/WalletFailedEscape.tsx` — revisado: sí
- `components/WalletMark.tsx` — revisado: sí
- `components/WalletSection.tsx` — revisado: sí
- `components/icons.tsx` — revisado: sí
- `constants/altaConfig.ts` — revisado: sí
- `constants/appLinks.ts` — revisado: sí
- `constants/brand.ts` — revisado: sí
- `constants/bsc.ts` — revisado: sí
- `constants/commissions.ts` — revisado: sí
- `constants/compatibleWallets.ts` — revisado: sí
- `constants/contractConfig.ts` — revisado: sí
- `constants/deployedAddresses.ts` — revisado: sí
- `constants/fama.ts` — revisado: sí
- `constants/famaConfig.ts` — revisado: sí
- `constants/feeConfig.ts` — revisado: sí
- `constants/loanTiers.ts` — revisado: sí
- `constants/podium.ts` — revisado: sí
- `constants/racha.ts` — revisado: sí
- `constants/ranks.ts` — revisado: sí
- `constants/reputation.ts` — revisado: sí
- `constants/reserva.ts` — revisado: sí
- `constants/reservaConfig.ts` — revisado: sí
- `constants/rpcConfig.ts` — revisado: sí
- `constants/support.ts` — revisado: sí
- `constants/tokens.ts` — revisado: sí
- `contracts/LoanLadder.sol` — revisado: sí
- `contracts/QuatriviumAlta.sol` — revisado: sí
- `contracts/QuatriviumApk.sol` — revisado: sí
- `contracts/QuatriviumCredit.sol` — revisado: sí
- `contracts/QuatriviumFamaCaja.sol` — revisado: sí
- `contracts/QuatriviumLeveling.sol` — revisado: sí
- `contracts/QuatriviumReserva.sol` — revisado: sí
- `contracts/interfaces/AggregatorV3Interface.sol` — revisado: sí
- `contracts/interfaces/IQuatriviumFamaCaja.sol` — revisado: sí
- `contracts/libraries/LoanTierSeed.sol` — revisado: sí
- `contracts/libraries/QuatriviumFamaLib.sol` — revisado: sí
- `contracts/libraries/Usuario.sol` — revisado: sí
- `contracts/mocks/CreditViewMock.sol` — revisado: sí
- `contracts/mocks/ERC20Mock.sol` — revisado: sí
- `contracts/mocks/MockV3Aggregator.sol` — revisado: sí
- `contracts/test/QuatriviumCreditHarness.sol` — revisado: sí
- `docker-compose.sonar.yml` — revisado: sí
- `eas.json` — revisado: sí
- `eslint.config.js` — revisado: sí
- `forge-test/QuatriviumAudit.t.sol` — revisado: sí
- `forge-test/QuatriviumBlindajes.t.sol` — revisado: sí
- `forge-test/QuatriviumCredit.t.sol` — revisado: sí
- `forge-test/QuatriviumFase3.t.sol` — revisado: sí
- `forge-test/QuatriviumInvariant.t.sol` — revisado: sí
- `forge-test/QuatriviumReserva.t.sol` — revisado: sí
- `foundry.toml` — revisado: sí
- `hardhat.config.cjs` — revisado: sí
- `hooks/useEquippedFrame.ts` — revisado: sí
- `hooks/useFameLeaderboard.ts` — revisado: sí
- `hooks/useHomeHandlers.ts` — revisado: sí
- `hooks/useLiveCooldown.ts` — revisado: sí
- `hooks/useLoanPaymentReminders.ts` — revisado: sí
- `hooks/usePendingInvite.ts` — revisado: sí
- `hooks/useReferralNetwork.ts` — revisado: sí
- `hooks/useScreenScroll.ts` — revisado: sí
- `hooks/useSendCooldown.ts` — revisado: sí
- `hooks/useVerificationFee.ts` — revisado: sí
- `hooks/useWalletLevel.ts` — revisado: sí
- `hooks/useWeb3Balances.ts` — revisado: sí
- `hooks/useWeb3Transactions.ts` — revisado: sí
- `i18n/LanguageContext.tsx` — revisado: sí
- `i18n/gap-translations.json` — revisado: sí
- `i18n/languages.ts` — revisado: sí
- `i18n/legalCopy.ts` — revisado: sí
- `i18n/legalExtras.ts` — revisado: sí
- `i18n/locales/ar.json` — revisado: sí
- `i18n/locales/bn.json` — revisado: sí
- `i18n/locales/de.json` — revisado: sí
- `i18n/locales/en.json` — revisado: sí
- `i18n/locales/es.json` — revisado: sí
- `i18n/locales/fr.json` — revisado: sí
- `i18n/locales/hi.json` — revisado: sí
- `i18n/locales/id.json` — revisado: sí
- `i18n/locales/it.json` — revisado: sí
- `i18n/locales/ja.json` — revisado: sí
- `i18n/locales/ko.json` — revisado: sí
- `i18n/locales/pt.json` — revisado: sí
- `i18n/locales/ru.json` — revisado: sí
- `i18n/locales/tr.json` — revisado: sí
- `i18n/locales/ur.json` — revisado: sí
- `i18n/locales/vi.json` — revisado: sí
- `i18n/locales/zh.json` — revisado: sí
- `i18n/translations.ts` — revisado: sí
- `index.js` — revisado: sí
- `metro.config.js` — revisado: sí
- `package-lock.json` — revisado: sí
- `package.json` — revisado: sí
- `plugins/withQuatriviumAndroidSecurity.js` — revisado: sí
- `polyfills.js` — revisado: sí
- `profile/ProfileContext.tsx` — revisado: sí
- `remappings.txt` — revisado: sí
- `scripts/_preflight_mainnet.cjs` — revisado: sí
- `scripts/adminTotp.mjs` — revisado: sí
- `scripts/apply-i18n-leftovers.mjs` — revisado: sí
- `scripts/apply-i18n-professional.mjs` — revisado: sí
- `scripts/attest2of2.mjs` — revisado: sí
- `scripts/bscNetworks.cjs` — revisado: sí
- `scripts/check-external-services.mjs` — revisado: sí
- `scripts/check-i18n.mjs` — revisado: sí
- `scripts/check-production.mjs` — revisado: sí
- `scripts/deploy-arbitrum-sovereign.cjs` — revisado: sí
- `scripts/deploy-mainnet-nuevo.cjs` — revisado: sí
- `scripts/deploy-reserva.cjs` — revisado: sí
- `scripts/deploy-testnet-nuevo.cjs` — revisado: sí
- `scripts/deploy.cjs` — revisado: sí
- `scripts/fetch-wallet-logos.py` — revisado: sí
- `scripts/linkCredit.cjs` — revisado: sí
- `scripts/patch-i18n-leftovers-asia.mjs` — revisado: sí
- `scripts/patch-i18n-leftovers-east.mjs` — revisado: sí
- `scripts/patch-i18n-leftovers-rtl.mjs` — revisado: sí
- `scripts/patch-i18n-leftovers.mjs` — revisado: sí
- `scripts/prepare-production-local.mjs` — revisado: sí
- `scripts/run-full-cyber-audit.sh` — revisado: sí
- `scripts/run-slither-wsl.sh` — revisado: sí
- `scripts/run-slither.mjs` — revisado: sí
- `scripts/run-snyk.mjs` — revisado: sí
- `scripts/run-sonar.mjs` — revisado: sí
- `scripts/scan-mobile.mjs` — revisado: sí
- `scripts/security-check.mjs` — revisado: sí
- `scripts/seed-testnet.cjs` — revisado: sí
- `scripts/setup-safe-admin.cjs` — revisado: sí
- `scripts/simulateTx.js` — revisado: sí
- `scripts/spawnEnv.mjs` — revisado: sí
- `scripts/trivy-lock.sh` — revisado: sí
- `scripts/verify-totp.mjs` — revisado: sí
- `scripts/zap-health-wsl.sh` — revisado: sí
- `services/accountReset.ts` — revisado: sí
- `services/accountUsername.ts` — revisado: sí
- `services/appLock.ts` — revisado: sí
- `services/appWallet.ts` — revisado: sí
- `services/authPrefs.ts` — revisado: sí
- `services/authenticator.ts` — revisado: sí
- `services/contactLock.ts` — revisado: sí
- `services/deviceBinding.ts` — revisado: sí
- `services/deviceClaim.ts` — revisado: sí
- `services/equippedFrame.ts` — revisado: sí
- `services/fameLeaderboard.ts` — revisado: sí
- `services/founderUsdtCharge.ts` — revisado: sí
- `services/fundsConfirm.ts` — revisado: sí
- `services/linkedWallet.ts` — revisado: sí
- `services/movementHistory.ts` — revisado: sí
- `services/padrinoSettle.ts` — revisado: sí
- `services/quatriviumCreditService.ts` — revisado: sí
- `services/referralNetwork.ts` — revisado: sí
- `services/reservaDemoStore.ts` — revisado: sí
- `services/reservaService.ts` — revisado: sí
- `services/savedSession.ts` — revisado: sí
- `services/sponsorLock.ts` — revisado: sí
- `services/userProfile.ts` — revisado: sí
- `services/verificationFeeReceipt.ts` — revisado: sí
- `services/walletAuth.ts` — revisado: sí
- `services/walletHandoff.ts` — revisado: sí
- `services/walletOpenEscape.ts` — revisado: sí
- `services/walletSession.ts` — revisado: sí
- `slither.config.json` — revisado: sí
- `sonar-project.properties` — revisado: sí
- `store-assets/.well-known/assetlinks.json` — revisado: sí
- `store-assets/privacy-policy.html` — revisado: sí
- `store-assets/terms-of-service.html` — revisado: sí
- `stubs/ws-stub.js` — revisado: sí
- `stubs/zlib-stub.js` — revisado: sí
- `test/accountWorld.test.js` — revisado: sí
- `test/accounting.test.js` — revisado: sí
- `test/alta-registro.test.js` — revisado: sí
- `test/attest2of2.test.js` — revisado: sí
- `test/audit-fixes.test.js` — revisado: sí
- `test/audit-reads.test.js` — revisado: sí
- `test/brand-splash.test.js` — revisado: sí
- `test/circuitBreaker.test.js` — revisado: sí
- `test/commission-levels.test.js` — revisado: sí
- `test/contract-abi.test.js` — revisado: sí
- `test/cuotas.test.js` — revisado: sí
- `test/cyber-hardening.test.js` — revisado: sí
- `test/destroy.test.js` — revisado: sí
- `test/equipped-frame.test.js` — revisado: sí
- `test/fama-canje.test.js` — revisado: sí
- `test/fame-rankings.test.js` — revisado: sí
- `test/fase3-seguro-apk.test.js` — revisado: sí
- `test/fase4-app.test.js` — revisado: sí
- `test/fundador-cobro.test.js` — revisado: sí
- `test/hardening-security.test.js` — revisado: sí
- `test/hardening.test.js` — revisado: sí
- `test/helpers.cjs` — revisado: sí
- `test/identity.test.js` — revisado: sí
- `test/invite-code.test.js` — revisado: sí
- `test/kyc.test.js` — revisado: sí
- `test/legal-consent.test.js` — revisado: sí
- `test/levelProgress.test.js` — revisado: sí
- `test/liquidation.test.js` — revisado: sí
- `test/loanLevels.test.js` — revisado: sí
- `test/mlm.test.js` — revisado: sí
- `test/money-invariants.test.js` — revisado: sí
- `test/morosity.test.js` — revisado: sí
- `test/network-worlds.test.js` — revisado: sí
- `test/origination-cupo.test.js` — revisado: sí
- `test/peg.test.js` — revisado: sí
- `test/racha.test.js` — revisado: sí
- `test/referral-earnings.test.js` — revisado: sí
- `test/reserva.test.js` — revisado: sí
- `test/save-changes.test.js` — revisado: sí
- `test/screen-copy.test.js` — revisado: sí
- `test/secret-box.test.js` — revisado: sí
- `test/security-audit-fixes.test.js` — revisado: sí
- `test/security.test.js` — revisado: sí
- `test/sequencer-gracia.test.js` — revisado: sí
- `test/soberania-fase1.test.js` — revisado: sí
- `test/sponsor-lock.test.js` — revisado: sí
- `test/wallet-link-reject.test.js` — revisado: sí
- `test/wallet-link-sign.test.js` — revisado: sí
- `theme/ThemeContext.tsx` — revisado: sí
- `theme/androidText.ts` — revisado: sí
- `theme/palette.ts` — revisado: sí
- `theme/patchAndroidText.ts` — revisado: sí
- `trivy.yaml` — revisado: sí
- `tsconfig.json` — revisado: sí
- `tsconfig.sonar.json` — revisado: sí
- `utils/accountEntry.ts` — revisado: sí
- `utils/adminProposal.ts` — revisado: sí
- `utils/appDeepLink.ts` — revisado: sí
- `utils/appKitStorage.ts` — revisado: sí
- `utils/appNotice.ts` — revisado: sí
- `utils/biometricStatus.ts` — revisado: sí
- `utils/copyText.ts` — revisado: sí
- `utils/creditCooldown.ts` — revisado: sí
- `utils/creditGates.ts` — revisado: sí
- `utils/debtReminders.ts` — revisado: sí
- `utils/emailPolicy.ts` — revisado: sí
- `utils/fameRankings.ts` — revisado: sí
- `utils/fameRoster.ts` — revisado: sí
- `utils/formatters.ts` — revisado: sí
- `utils/founderWallet.ts` — revisado: sí
- `utils/graceClock.ts` — revisado: sí
- `utils/historyWorld.ts` — revisado: sí
- `utils/inviteCode.ts` — revisado: sí
- `utils/legacyStorage.ts` — revisado: sí
- `utils/legalConsent.ts` — revisado: sí
- `utils/loanPaidMark.ts` — revisado: sí
- `utils/moraHistory.ts` — revisado: sí
- `utils/openWalletConnect.ts` — revisado: sí
- `utils/passwordPolicy.ts` — revisado: sí
- `utils/pendingDeepLink.ts` — revisado: sí
- `utils/pickerHold.ts` — revisado: sí
- `utils/pinPolicy.ts` — revisado: sí
- `utils/rankingDivisions.ts` — revisado: sí
- `utils/referralEarnings.ts` — revisado: sí
- `utils/referralPages.ts` — revisado: sí
- `utils/referralSearch.ts` — revisado: sí
- `utils/referralTree.ts` — revisado: sí
- `utils/safeFetch.ts` — revisado: sí
- `utils/safeOpenUrl.ts` — revisado: sí
- `utils/sanitize.ts` — revisado: sí
- `utils/secretBox.ts` — revisado: sí
- `utils/secretBoxAes.d.ts` — revisado: sí
- `utils/secretBoxAes.js` — revisado: sí
- `utils/sovereignSurface.ts` — revisado: sí
- `utils/sponsorLock.ts` — revisado: sí
- `utils/storeSlot.ts` — revisado: sí
- `utils/totp.ts` — revisado: sí
- `utils/txErrors.ts` — revisado: sí
- `utils/unsavedChanges.ts` — revisado: sí
- `utils/usernamePolicy.ts` — revisado: sí
- `utils/waitMined.ts` — revisado: sí
- `utils/walletChain.ts` — revisado: sí
- `utils/walletVaultPolicy.ts` — revisado: sí
- `wallet/AppModeContext.tsx` — revisado: sí
- `wallet/AppWalletContext.tsx` — revisado: sí
- `wallet/appModePersist.ts` — revisado: sí
- `web/.well-known/assetlinks.json` — revisado: sí
- `web/icon.png` — revisado: sí
- `web/index.html` — revisado: sí
- `web/invite/index.html` — revisado: sí
- `web3Config.tsx` — revisado: sí
