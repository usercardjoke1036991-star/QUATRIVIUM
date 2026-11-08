# 🧠 CONTEXTO DEL PROYECTO: Quatrivium Finance

## ¿Qué es este proyecto?
**Quatrivium Finance** es una app móvil de microcrédito on-chain sin colateral sobre BNB Smart Chain (BSC).
El usuario activa una wallet interna, pide un préstamo en USDT del pool de liquidez, lo paga antes del vencimiento
y sube de nivel para pedir montos mayores. Si no paga, entra en mora y queda bloqueado hasta regularizar.
**No puede cerrar la cuenta mientras tenga deuda o esté en mora.**

## Tipo de proyecto
- **Stack:** React Native 0.81 · Expo 54 · React 19 · TypeScript · Solidity 0.8.24 · ethers v6
- **Tipo:** Mobile DeFi App + Smart Contracts (EVM)
- **Estado actual:** Mainnet BSC (chain 56) desplegado y en el APK de producción 1.0.2, código 12, paquete `com.quatrivium.credit`. Demo es BSC testnet (chain 97). No redesplegar.

---

## Arquitectura y estructura

```
Magno/
├── app/index.tsx                  # Pantalla principal (~522 líneas, orquesta con hooks)
├── app/_layout.tsx                # Placeholder Expo Router (arranque real: App.js)
├── babel.config.js                # Babel / Expo
├── metro.config.js                # Metro + stub snarkjs
├── hardhat.config.cjs             # Hardhat: tests y deploy Solidity
├── foundry.toml                   # Foundry overlay (forge-out/forge-cache, no mezclar con Hardhat)
├── lib/forge-std/scripts/vm.py    # Vendor Foundry (no es módulo de producto)
├── forge-test/                    # Fuzz/invariantes Foundry (WSL)
├── zkService.ts                   # Reexport ZK experimental (stub Metro)
├── web3Config.tsx                 # AppKit / WalletConnect (BSC Demo y Real)
├── components/ (61 archivos)      # UI: WalletSection, LoanTierCard, AdminPanel, SecuritySettings…
├── hooks/                         # useWeb3Balances, useWeb3Transactions, useHomeHandlers
├── services/                      # quatriviumCreditService, appWallet, deviceBinding, kycDeclaration…
├── contracts/
│   ├── QuatriviumCredit.sol       # Núcleo (EIP-170 ≤ 24576)
│   ├── QuatriviumLeveling.sol     # Hermano: solicitudes/hitos
│   ├── QuatriviumReserva.sol      # Hermano: bloqueo 30d, techo 12% anual del bote
│   ├── QuatriviumFamaCaja.sol     # Hermano: fama de caja y canje contra el pool
│   ├── libraries/QuatriviumFamaLib.sol # Peg, L1 bono pool, tocar fama (delegatecall)
│   ├── Groth16Verifier.sol        # ZK experimental (no en producción)
│   ├── interfaces/                # AggregatorV3Interface (Chainlink)
│   └── mocks/                     # ERC20Mock, MockV3Aggregator (testnet)
├── test/ (21 archivos)            # accounting, circuitBreaker, cuotas, destroy, identity, kyc, mlm, rankings, demo-identity…
├── scripts/                       # deploy, security-check, production-check, notify-worker
├── Dockerfile.notify              # Imagen del worker 24/7 (Render/Fly/Hetzner)
├── render.yaml                    # Blueprint Render: disco /data, health /health, sin llaves de owner
├── salud_proyecto.py              # Reloj suizo: grafo UI→hooks→contrato + i18n/tsc (`npm run salud`)
├── qa_safe_io.py                  # I/O del kit QA acotado a Magno (Sonar path traversal)
├── i18n/ (17 locales)             # ar, bn, de, en, es, fr, hi, id, it, ja, ko, pt, ru, tr, ur, vi, zh
├── constants/                     # contractConfig, rpcConfig, tokens, loanTiers
├── stubs/zk-node-stub.js          # Metro stub: snarkjs no es bundleable en RN
├── .env.example                   # Variables requeridas documentadas
└── eas.json                       # Builds: development/preview (chain 97), production (chain 56)
```

---

## Stack tecnológico
- **App:** React Native 0.81 / Expo 54 / React 19 / TypeScript (strict)
- **Web3:** ethers v6 / Reown AppKit (WalletConnect) / wagmi
- **Contratos:** Solidity 0.8.24 / OpenZeppelin v5 (`Pausable`, `ReentrancyGuard`, `SafeERC20`) — **owner/admin es propio, no usa Ownable**
- **Auditoría on-chain:** Hardhat (suite JS) + Foundry 1.8.3 en WSL (`forge test` / `forge lint`). Caches separadas (`forge-out/`, `forge-cache/`).
- **Tooling WSL (Ubuntu-24.04, usuario root):** Aderyn 0.6.8 · Trivy 0.74.0 · Semgrep 1.177.0 · Mythril 0.24.8 · OWASP ZAP 2.17.0 (OpenJDK 21). PATH en `/etc/profile.d/cyber-tools.sh`.
- **Red blockchain:** BSC Testnet (chain 97) en dev · BSC Mainnet (chain 56) en prod
- **Seguridad mobile:** expo-secure-store / device binding local / biometría / PIN 6 dígitos / frase BIP-39
- **Notificaciones:** Textbelt SMS (OTP) / Twilio y WhatsApp Cloud de respaldo / Telegram Bot / Resend / notify-worker
- **i18n:** 17 idiomas, 1234 claves, soporte RTL (árabe, urdu)

---

## Decisiones importantes tomadas
- **Un solo préstamo activo por wallet**: no se puede pedir otro hasta pagar o liquidar el actual
- **Sin colateral**: el pool absorbe el riesgo de impago (diseño intencional, no bug)
- **El pool manda (no hay cupo diario de crédito)**: se presta si cabe en el 80 % de liquidez. El 20 % no se toca. Los montos grandes paran al 70 %; del 70 al 80 % solo el carril chico (`máx(50 USDT, 0,5 % de caja)`). La primera de 1 USDT tras verificar queda reservada 7 días para ese usuario (mecanismo interno; si no pide, vuelve al fondo). Luego 48 h y las mismas reglas que el resto. El 10 % diario y las 10 000 altas ya no racionan crédito. Demo live `0xD2d2` sigue el protocolo viejo hasta redesplegar.
- **Pool no redimible**: `retirarLiquidez` hace `revert("pool locked")` — el capital queda para prestar
- **Fama de donar y de aportar**: 100 por cada 1 USDT desde el primero. El canje es 250 de fama = 1 USDT y lo cobra quien canjea, desde el fondo. Donar entrega el 100 % del USDT al fundador. La nota del 2026-10-01 sobre «exceso de 2 USDT» quedó vieja.
- **`tx.origin == msg.sender`**: bloquea contratos intermediarios en registro, préstamo, pago, depósito y liquidación
- **Timelock de 72h + 2-de-3** para todas las acciones admin (excepto pausa, que es inmediata). Si una llave se pierde o la hackean, las otras 2 la echan.
- **Wallet interna (app wallet)**: cada instalación genera una wallet HD (frase de 24 palabras BIP-39) cifrada en SecureStore. Recuperar aún acepta 12 palabras de cuentas antiguas. Pedir y pagar préstamos y guardar el saldo viven en esa cuenta. Depositar, retirar, donar, aportar al pool y el **alta de 4 USDT** se pagan con una billetera externa vinculada (WalletConnect); el USDT pasa a la interna y luego el contrato ve `msg.sender` = interna. Saltarse el vínculo en el alta no basta para mover fondos. La contraseña no se edita en Ajustes: se pide al desbloquear y para ver la frase. **La frase no se reemplaza**: es la llave de esa billetera; en otro teléfono se recupera con las mismas palabras.
- **Identidad KYC inmutable**: nombre legal y tipo de documento se congelan en el primer submit on-chain; ciudad/región siguen editables. Verificar KYC permite escanear el documento con la cámara (foto local, sin OCR ni envío a la red). On-chain, `declararKyc()` exige teléfono atestado y contrato no pausado.
- **Cerrar cuenta exige deuda = 0 y !esMoroso**: el contrato y la UI bloquean a morosos
- **ZK es experimental**: `snarkjs` hace stub en Metro; el registro real es `registrarHumanoConPadre()`
- **Entornos separados en `eas.json`**: development/preview→chain 97, production→chain 56
- **`slug: "magno"` en `app.json`**: el projectId EAS es `0a9b20f0-900a-4d35-8541-14b6202d84f5`; el nombre visible es Quatrivium Finance
- **Liquidación en AdminPanel**: el servicio aprueba USDT automáticamente antes de `liquidate()`
- **`useHomeHandlers` hook**: handlers extraídos de `app/index.tsx` para reducir complejidad
- **Device binding es LOCAL** (SecureStore): la identidad on-chain es la dirección de la wallet + teléfono OTP, no el IMEI
- **Worker 24/7:** el camino elegido es **Render** (Web Service + `Dockerfile.notify`, `render.yaml`, disco `/data`, health `/health`). OTP SMS = Textbelt (`TEXTBELT_API_KEY`). Correo = Resend. Firma OTP = `ATTESTER_PRIVATE_KEY` (nunca la llave de owner). El proceso no debe dormirse. El fundador no sube la llave de despliegue a Render.
- **Referido solo al alta:** el código opcional se pide al crear la cuenta. Vacío = el usuario inicia su cadena colgada del fundador. Tras continuar, el padrino queda bloqueado en el teléfono y on-chain (`already registered`). Activar la línea ya no pide código.
- **Alta de cuenta**: si este teléfono no tiene cuenta, el inicio muestra **Crear frase secreta** y **Recuperar cuenta**. La app **no destruye ni genera otra cuenta**. Formatear o cambiar de VPN/red no abre una segunda línea: se recupera con las 24 palabras (o 12 si la cuenta es antigua). En Real, el mismo teléfono o dispositivo on-chain no puede atarse a otra billetera. Recuperar pide la frase y luego usuario+contraseña de este aparato. Si el dispositivo ya tiene dueño on-chain, Crear desaparece. **Guardar sesión** abre el bloqueo. Contraseña es el método principal: 8 a 66 caracteres, con mayúscula, número y símbolo. Antes de pedir crédito hay que anotar las 24 palabras. **Demo no pide correo, número ni KYC.** Con el alta conectada, Demo y Real cobran un solo pago de 4 USDT (`pagarRegistro`); correo y teléfono no cobran aparte. En Real siguen el KYC y que este dispositivo coincida con el hash on-chain.
- **Frase secreta BIP-39**: alta y respaldo. No cierra la cuenta. No hay destruir ni generar otra cuenta en la app.
- **Usuario y contraseña son el candado de este teléfono.** El correo y el número siguen para crédito Real, avisos y recuperar contraseña. No se usan para desbloquear, pedir, pagar ni transferir.
- **Métodos de seguridad**: desbloquear, pedir, pagar y transferir son opcionales (interruptor + método ya registrado: PIN, autenticador, huella o contraseña). Huella y llave son el mismo sensor. Los cambios se confirman con Guardar. El autenticador es TOTP real: al activarlo muestra un QR `otpauth://` escaneable y la clave por si la cámara no enfoca.
- **Historial**: Demo y Real tienen diarios distintos (modo + chain + contrato + billetera). Dos ventanas (transferencias y préstamos) y mora. En el hub, al vencer empieza un reloj rojo: 30 días de gracia en cuenta atrás; al acabarse, cuenta hacia adelante hasta que pague. El fundador entra en mora como el resto.
- **Demo y Real son mundos distintos**: Demo = BSC testnet (chain 97). Real = BSC mainnet (chain 56). El préstamo, el saldo y el registro de uno **no se copian** al otro. **Primera apertura = Real.** Después la app recuerda el último modo abierto (`quatrivium.appMode.v2`). El APK 1.0.2 código 12 ya trae las direcciones de chain 56. Con el alta conectada, Real cobra un solo pago de 4 USDT; correo y teléfono no cobran aparte. El KYC es de Real. Demo opera sin esos candados (sí pide anotar las 24 palabras).
- **Admin/fundadoras**: el panel no aparece hasta conectar una billetera fundadora (WalletConnect).
- **Crecer sin recortar el núcleo**: EIP-170 limita a 24 KB *cada* contrato, no el protocolo. Funciones nuevas (escalera de solicitudes, bono del 100, identidad, red, Reserva) van a **contratos hermanos**. No se borran vistas ni pagos del núcleo para “hacer hueco”.
- **Reserva no es el pool**: el pool de préstamos no se retira. Reserva es un hermano: se ve desde el inicio y se usa desde el **nivel 10**. Bloqueo 30 días, principal de vuelta. Techo **hasta 12 %** anual: el % **baja si lo bloqueado es grande frente al bote** (`apyHoyBps` / `saludReserva`). Cada alta mete 1 USDT al bote. Admins también aportan; **retirar** el bote exige guardianes de acuerdo y 72 h. Extra de comisiones de red sigue del pool (tramo 2/3). Credit no se recorta. No se llama “producto de inversión” ni banco.
- **Alta Real 4 USDT (desplegada en chain 56 y en el testnet nuevo)**: 1 a la fundadora, 1 al bote Reserva, 1 de sello (`pagarVerificacion`) y 1 apartado al padrino en `QuatriviumAlta` (se suelta al pagar el primer L1; el interés de ese pago se parte en comisiones). Hitos cada 100 hasta 1000: 400 / 4k / 7k / 8.5k / 9k / 11.5k / 13.5k / 16k / 18k / 20k, con piso 20 %. Demo live `0xD2d2` sigue el protocolo viejo.
- **Fama y dinero no se mezclan**: el 1 USDT de captación no da fama de caja. La fama de red recorre generaciones 2–40 y el fundador suma 100 si no es el padrino directo. La puerta Real (los 4 USDT) no da fama. `_pagarBonosRed` queda en el núcleo sin acreditarse.
- **Mora con mes de gracia**: al vencer se cobra de la billetera. Si no hay saldo, 30 días sigue cobrando para poder pagar. Luego la reputación baja 10 × nivel por día y sus comisiones/bonos van al pool hasta que pague. El fundador **también entra en mora** y se le puede liquidar; el pool ya no cubre su préstamo. La fama de línea vive en `QuatriviumFamaLib` (delegatecall) para no romper EIP-170.
- **No hay cerrar cuenta on-chain**: el teléfono y el dispositivo quedan atados a esa billetera. Recuperar es con la frase, no se crea otra línea.
- **Confirmación de fondos fail-closed**: huella abre el wrap del Keystore (`requireAuthentication`); si no hay método listo, se niega. PIN nuevo = 20 000 rondas. En Real, correo/teléfono no van a AsyncStorage.

---

## Niveles de crédito (fuente: `constants/loanTiers.ts` + `LoanTierSeed.sol` + `LoanLadder.sol`)

**1000 niveles**, del **$1** al **$1 000 000**. Los 1–100 siguen en tabla (`LoanTierSeed`). Los 101–1000 son fórmula (`LoanLadder`) para no meter 900 filas en el constructor ni romper EIP-170.

Reglas:
- el **principal** del siguiente > el anterior
- el **interés en $** del siguiente > el anterior
- el **total a devolver** también sube
- **1–100**: la tasa del anterior > la del siguiente (estricta)
- **101–1000**: la tasa no sube (baja 1 bps/nivel hasta 4,06 % y luego se sostiene; si bajara más el interés $ se rompería)

`requiredCount` (la velocidad de llegada marca la de pago): L1 → 3; L2–9 → 5; desde **$100 (L10)** cada nivel pide **5 más** (5, 10, 15…; L100 = 455; L999 = 4950; L1000 = 4955). L1000 no sube de nivel: al completar las solicitudes el ciclo se reinicia y el bono de 20 000 USDT se puede volver a cobrar.
Bono de pool cada 100 niveles: **20 USDT × nivel del hito**. Sala **Bonos** en Demo y Real. **Donar** (sala aparte, solo Real) y **aportar liquidez** suman **100 de fama por cada USDT**. El pool es el banco común. Cuenta Real firma contra el contrato de chain 56.
Rangos: 12 gemas del catálogo (granate, aguamarina, citrino, topacio, turmalina, peridoto, esmeralda, zafiro, rubí, ónix, diamante, amatista). Cada banda se parte en I / II / III. El marco es el logo 3D, más ancho que la foto, con incrustaciones fotográficas de esa piedra.

| Nivel | Principal | Plazo | Tasa | Interés $ | Cuotas | Solicitudes |
|------:|----------:|------:|-----:|----------:|:------:|:------------|
| 1 | $1 | 7 días | 100% | $1.00 | 1 | 3 |
| 10 | $100 | 50 días | 34% | $34 | 3 | 5 |
| 11 | $120 | 50 días | 33,71% | $40.45 | 3 | 10 |
| 100 | $10 000 | 90 días | 8% | $800 | 3 | 455 |
| 101 | $11 100 | 90 días | 7,99% | $886.89 | 3 | 460 |
| 1000 | **$1 000 000** | 180 días | 4,06% | $40 600 | 12 | 4955 |

> Los bps son tasa plana sobre el principal por el plazo (no APR anual).
> Cuotas: $50 → 2; $60 → 3; $25 000 → 6; $100 000 → 12.
> Contrato **Demo live** `0xD2d2A9eF0D1e4f253abc90Dd4ACb0E6C50B2de9f` (bloque 130652258): 1000 niveles, mora, hitos y donar. El anterior `0x1E5118` queda fuera de servicio.
> Un millón sin colateral exige pool enorme. La semilla Demo (~2000 USDT) no cubre ni L100.

---

## Lo que está funcionando ✅
- Mainnet BSC (chain 56), ya en el APK 1.0.2 código 12: Credit `0xade65b4224B4C6b2f1CCAb9D58c810EE15ac71D6`, FamaCaja `0xa590f241868560AF3f9E2017c7d629FFDEA27e2B`, Reserva `0xa81857F71A11a21d59F59C2190638793266233fB`, Alta `0x50146aDB887dB13Ee7Ffa66792d656127BCB96A4`, biblioteca de fama `0x9058C95bBdde3B215f86908aE66F1B2C03180420`, USDT `0x55d398326f99059ff775485246999027b3197955`
- Demo, BSC testnet (chain 97): Credit `0xD318f39834A5e798a11D2535c6c9D1E1270e6778`, Alta `0xE890627734D7350132988561247945624991f063`. El contrato viejo `0xD2d2` no lo usa la app
- Alta: un solo pago de 4 USDT (`pagarRegistro`). Con el alta conectada, correo y teléfono no cobran aparte. Quien entra sin código queda anclado al fundador
- Fama: 100 por cada USDT desde el primero al donar o aportar. El alta no acredita fama de red. El interés por generaciones (15 %, 8 %, 6 %, 4 %, 2 %, 0,8 % y 0,4 %) sí se reparte. La fama de racha no baja
- Racha: el día lo suma un invitado directo al liquidar un crédito. Registrarse no cuenta. La red de ese invitado no cuenta. El mismo día UTC no suma dos veces
- Reserva: el usuario bloquea su principal desde el nivel 10, mínimo 1 USDT, 30 días, techo del 12 %. El panel propone y confirma el retiro del bote a las 72 horas. Hoy hay un solo guardián, la billetera fundadora. Ese retiro no toca el principal bloqueado
- App Expo 54, React Native 0.81.5 y TypeScript. 17 idiomas, 1234 claves. El apodo público se confirma aparte del usuario del teléfono, una sola vez, y no va a la cadena. El ranking, desde el nivel 15, muestra el apodo o el código de invitación
- Si falla la lectura del fondo, del bote o de la tasa, la pantalla conserva la cifra anterior
- Arranque nativo en verde liso (`assets/splash-blank.png`). La pantalla grande del logo sigue usando `assets/logo.png`
- Avisos en `https://notify.quatriviumcredit.app`. El worker del repositorio ya separa el apodo del usuario del teléfono
- Demo y Real cambian juntos. El grifo de BNB de prueba no se abre con Real seleccionado. Las actualizaciones OTA están apagadas: un cambio de app pide un APK nuevo
- Paquete Android `com.quatrivium.credit`. El Xiaomi de trabajo tiene la versión 1.0.2, código 12, instalada encima de la anterior
- Contrato `QuatriviumCredit.sol` — Demo live `0xD2d2A9eF0D1e4f253abc90Dd4ACb0E6C50B2de9f` (1000 niveles, FamaLib `0x6B98072a087B3fd856c24249232EE3fb40cB5003`, pool 2000 USDT). Histórico: la app ya no apunta ahí
- Sala **Reserva**: hermano `QuatriviumReserva.sol`. Visible desde el inicio, usable en nivel 10. El bote de mainnet ya está desplegado
- Hermano **FamaCaja**: `canjearFama` usa el mismo criterio que Credit `_estaVencido` (cuota o vencimiento final) leyendo `planPago`; no se añade wrapper al núcleo
- Suites Hardhat con `npx hardhat --config hardhat.config.cjs test`
- CI de GitHub en `main`: Gitleaks, TruffleHog, `npm test` y `npm run typecheck`. No hay `.nvmrc` ni `engines`; Actions usa Node 22. El APK no se compila ahí: EAS pide cuenta y keystore.
- App móvil con componentes React Native (seguridad a elección, autenticador, historial, sala Bonos, sala Reserva)
- i18n: 17 idiomas, 1234 claves
- Rankings: 7 tableros (incluye racha), divisiones de 100, premio mensual estimado, nombres y fotos públicas, visibles desde el nivel 15
- Referidos Unilevel en contrato y UI
- Notify-worker: Telegram, SMS, email y auto-fondeo BNB solo en Demo (`/auto-fund`)
- KYC on-chain + OTP de teléfono; nombre y documento congelados; foto del documento en el teléfono
- App lock: la contraseña se pide al desbloquear y para ver la frase; ya no hay fila de contraseña en Ajustes. PIN y huella se pueden cambiar o quitar. Huella y llave de acceso son el mismo sensor (una sola fila: Huella).
- Fondos: depositar, retirar, donar y aportar al pool salen de la billetera vinculada. Con el alta conectada, Real y Demo cobran un solo pago de 4 USDT (`pagarRegistro`); correo y teléfono no cobran aparte. El USDT del saldo vive en la cuenta interna; desde ahí se piden y pagan préstamos. Demo no pide identidad.
- Frase secreta BIP-39: ver/anotar. No se sustituye: cambiarla sería otra cuenta. Recuperar en otro teléfono usa las mismas 24 palabras.
- Device binding local + frase para recuperar en otro teléfono
- Liquidación de deudores desde AdminPanel (approve automático)
- Auto-refresh de balances cada 30 s
- Primera apertura en Cuenta Real; al cambiar a Demo o Real se restaura ese modo al reabrir (`wallet/AppModeContext.tsx`)

## Lo que está en progreso 🔄 (solo el fundador puede completar)
- Publicar en Google Play Store. Hoy el APK se instala aparte; las actualizaciones OTA siguen apagadas
- Añadir un segundo guardián de la reserva. Hoy la misma billetera fundadora propone el retiro del bote y, pasadas 72 horas, lo confirma
- Tener un servidor de avisos de respaldo antes del mantenimiento del 13 de octubre de 2026. El aviso vivo sigue en `https://notify.quatriviumcredit.app`
- Republicar ese worker para que el apodo público coincida con el código del repositorio

## Lo que NO es un bug (deuda de diseño, no hay que “arreglarlo”)
- **Lint Foundry (`tx.origin`, `block.timestamp`, `ecrecover` maleable, `feeCollector.call`)**: diseño conocido, igual que Slither. No son pérdida de fondos. `pagarPrestamo` cobra a `msg.sender`, no a un `from` arbitrario.
- **Aderyn H-1 (CEI) y Lows L-1…L-13**: el High no drena el pool: `marcarMorosoSiVencido` y `destruirCuenta` ya tienen `nonReentrant`; USDT no tiene callbacks; destruir además exige EOA. Lows = gas, literales 10000 bps, `pragma ^0.8.24`, PUSH0 (BSC Cancun), `require` sin string (EIP-170), `ecrecover` en `vincularIdentidad` (el hash incluye `msg.sender`+chain+contrato; maleabilidad no cambia el attester), constante `REPUTACION_SANA` no referenciada (el bytecode no la incluye). No recortar el núcleo.
- **Mythril SWC-101 / Semgrep INFO / Trivy lockfile**: Solidity 0.8.24 no envuelve enteros; Semgrep INFO es gas (EIP-170); las CVE del lockfile viven en Metro/snarkjs/xcode, no en el worker ni en el crédito. `npm audit --force` instalaría Expo 57. Docker declara `USER node` (Sonar docker:S6471). Si el host arranca como root, el entrypoint hace chown de `/data` y `su-exec node`; si `/data` no es escribible el worker usa `/app/data`.
- **ZK real en React Native**: `snarkjs` no es bundleable; el registro es `registrarHumanoConPadre()`. Decisión consciente.
- **Pool no se retira**: no hay circuit breaker de retiros al 50% — el pool está cerrado a propósito (`revert("pool locked")`). La pausa de emergencia es el freno.
- **`eas.json` production ya lleva las direcciones de chain 56.** El APK 1.0.2 código 12 del Xiaomi ya las usa. No redesplegar. Un cambio nuevo de app pide otro build: las actualizaciones OTA están apagadas.
- **Premio mensual de rankings**: la UI muestra la estimación; el núcleo Credit no lo paga. Haría falta un contrato hermano fondeado o un redespliegue.
- **Java 25 en la máquina local**: puede romper `expo run:android` local. Los builds EAS usan imagen `sdk-54` (JDK correcto). En local: usar JDK 17.

---

## Dependencias críticas

```
app/index.tsx → useHomeHandlers (handlers)
             → useWeb3Balances (estado on-chain)
             → useWeb3Transactions (transacciones)

useHomeHandlers → useWeb3Transactions → quatriviumCreditService → CONTRACT_ABI + ethers v6
useWeb3Balances → quatriviumCreditService → RPC BSC (fallback 3 URLs)

AdminPanel → onLiquidar → useHomeHandlers → useWeb3Transactions.liquidarDeudor
                                          → quatriviumCreditService.liquidar (approve + liquidate)

services/appWallet → expo-secure-store (cifrado)
                  → deviceBinding (ligada al dispositivo, LOCAL)
                  → walletSession (clave de cifrado)

contracts/QuatriviumCredit.sol → OpenZeppelin v5 (Pausable, ReentrancyGuard, SafeERC20)
                               → AggregatorV3Interface (oráculo Chainlink)
                               → owner/admins/timelock propios (NO Ownable)
```

---

## Módulos del proyecto
| Módulo | Archivo(s) | Función |
|---|---|---|
| Pantalla home | `app/index.tsx` | Orquesta UI (handlers extraídos a `useHomeHandlers`) |
| Layout Expo | `app/_layout.tsx` | Placeholder; el arranque real es `App.js` |
| Tooling RN | `babel.config.js` · `metro.config.js` | Babel/Expo y Metro (stub ZK) |
| Contratos JS | `hardhat.config.cjs` | Tests y deploy Hardhat |
| ZK stub | `zkService.ts` | Reexport experimental; no va a producción |
| Handlers | `hooks/useHomeHandlers.ts` | Lógica de cada acción del usuario |
| Estado on-chain | `hooks/useWeb3Balances.ts` | Lee contrato + RPC · auto-refresh 30 s |
| Transacciones | `hooks/useWeb3Transactions.ts` | Approve + préstamo + pago + LP + liquidación |
| Servicio contrato | `services/quatriviumCreditService.ts` | Capa ethers sobre ABI |
| Identidad demo | `services/demoIdentity.ts` + worker `/demo-identity` | Atestigua KYC/teléfono on-chain solo en testnet |
| Wallet interna | `services/appWallet.ts` | HD wallet + frase BIP-39 cifrada |
| KYC local | `services/kycDeclaration.ts` | Nombre/documento congelados; fingerprint keccak |
| Lock | `services/appLock.ts` + `authPrefs.ts` + `authenticator.ts` | PIN, password, huella, TOTP; el usuario elige para qué usa cada uno |
| Historial | `services/movementHistory.ts` + `MovementHistory.tsx` | Préstamos, pagos y envíos entre billeteras |
| Storage seguro | `services/secureStorageService.ts` | Wrapper expo-secure-store |
| Red | `constants/rpcConfig.ts` | RPC, chainId, modo demo/live |
| Contrato | `constants/contractConfig.ts` | ABI + dirección según entorno |
| Tokens | `constants/tokens.ts` | Lista de stables soportados |
| ABI/contrato | `contracts/QuatriviumCredit.sol` | Lógica de crédito on-chain |
| Tests | `test/*.test.js` | 15 suites Hardhat · 131 tests |
| Errores tx | `utils/txErrors.ts` | Mensajes legibles de revert |

---

## Seguridad on-chain (contrato)
| Protección | Estado |
|---|---|
| ReentrancyGuard | ✅ Funciones de fondos |
| SafeERC20 | ✅ Transfers/approvals |
| Pausable (emergencia) | ✅ Inmediato (cualquier admin) · despausar con timelock |
| Timelock 72h + multisig | ✅ Acciones admin · 2-de-3 al tercer fundador. Si una se pierde o la hackean, las otras 2 la echan |
| tx.origin == msg.sender | ✅ Registro, préstamo, pago, depósito, liquidación |
| Oráculo Chainlink (stale 1h) | ✅ Precio USDT/USD · peg ≥ 0.98 |
| Pool locked | ✅ `retirarLiquidez` siempre revierte — no hay retiros LP |
| Cooldown 48h entre préstamos | ✅ Anti-spam |
| Utilización máx 80% | ✅ No presta el pool entero |
| destruirCuenta | ❌ Fuera del protocolo (Demo = mainnet). Identidad no se libera |

---

## Estado de verificaciones (última auditoría: 2026-09-11 noche)

| Verificación | Estado | Detalle |
|---|---|---|
| `tsc --noEmit` | ✅ 0 errores | TypeScript strict, noUnusedLocals, noImplicitReturns |
| `check-i18n.mjs` | ✅ OK | 756 claves · 17 locales · sin BOM · sin discrepancias |
| `security-check.mjs` | ✅ OK | .env fuera de git · sin credenciales hardcodeadas |
| `hardhat test` | ✅ 103/103 | Incluye mora del fundador (pool cubre, 48h intacta) + FamaLib |
| `npm audit` (ws high) | ✅ OK | GHSA-58qx/96hv corregidas con `override ws^8.21.0` |
| `npm audit` (devDeps) | ⚠️ ~66 vulns | hardhat / solidity-coverage / expo SDK — **no van al APK** · no correr `--force` |
| `production:check` | 🟡 | Mainnet desplegado. Siguen el APK nuevo, el worker público y Twilio/WhatsApp |
| Imports rotos | ✅ 0 | TypeScript confirma resolución |
| `.env.worker` en git | ✅ 0 | No trackeado |
| ProGuard (APK release) | ✅ ON | Via Gradle en EAS, no en `app.json` (schema inválido) |
| expo-updates (OTA) | ✅ OK | canales development / preview / production |
| ngrok túnel dev | ✅ OK | `rundown-shelf-mongoose.ngrok-free.dev` · `npm run tunnel:ngrok` |
| EAS Android image | ✅ `sdk-54` | Evita JDK 25 en builds cloud |
| ATTESTER_PRIVATE_KEY | ✅ Generada | Distinta del deployer · no en git |
| RESEND_API_KEY | ✅ Configurada | En `.env.worker` · no en git |

---

## Historial de cambios importantes
| Fecha | Cambio | Razón |
|-------|--------|-------|
| 2026-10-25 | Documentos alineados al contrato vivo: el pool no se retira y la fama de donar o aportar es 100 por USDT desde el primero. El canje de 250 no es un pago al fundador. Contratos sin cambios. | — |
| 2026-10-10 | Sala Admin muestra controles del asiento real o pide conectar. El retiro pendiente de Reserva no se borra si la lectura falla. | — |
| 2026-10-10 | Lecturas fallidas de niveles, fama, padrino y Reserva conservan la cifra anterior. No se cachea un nodo callado como escalera de 100. | — |
| 2026-10-10 | Ver personas pide primero el trozo de unas 25 horas, de 4000 bloques. Si el nodo rechaza un trozo ancho, sigue la mitad que contiene ese bloque. El telefono no se reinstalo. | — |
| 2026-10-10 | Ver personas deja de pedir trozos de 20000 bloques: usa 4000, tres a la vez, y una sola espera de 28s para personas y comisiones. | — |
| 2026-10-10 | Si Telegram tarda, la app avisa que el chat aun no llega y conserva la oferta. En ingles, el admin dice que tambien entra un cofundador ya autorizado. El tablero de fama ya no fija el texto a la izquierda. | — |
| 2026-10-10 | La app ya no dice que el 1 USDT del primer Nivel 1 sale del fondo: sale del USDT apartado en el alta. El codigo de correo o telefono sigue valido si el cobro se cancela. Telegram no vincula el chat hasta que la cartera lo confirma. KYC solo abre hosts de Sumsub. La liquidacion dice 5% del principal restante. El candado de fondos distingue un envio entre billeteras de otros movimientos. Contratos sin cambios. | — |
| 2026-10-09 | Si el correo de recuperacion no sale, se devuelve el envio del dia y la app lo dice. Fama y movimientos cortan la lectura a 18 segundos. Reserva no bloquea si el nivel no se lee. | — |
| 2026-10-09 | El historial de referidos corta tambien la lectura de nivel, fecha, bloque actual y padrino. Si no contestan, la lista sale con nivel 1 y sin fecha. | — |
| 2026-10-09 | La fila Lo invito descarga la imagen publica del padrino y la muestra dentro del marco. | — |
| 2026-10-09 | El historial de referidos cuenta el 1 USDT del padrino aunque falle el registro del alta, y lee primero los bloques recientes. | — |
| 2026-10-09 | La pantalla del codigo de referido espera a saber si la cuenta ya esta en la red. Solo aparece si todavia no lo esta. | — |
| 2026-10-09 | Crear cuenta pide el codigo de referido opcional antes de fijar el padrino. Una cuenta que ya existe y todavia no esta en la red tambien puede escribirlo. Un codigo ya confirmado no se cambia. | — |
| 2026-10-09 | Dockerfile.notify actualiza zlib de 1.3.2-r0 a 1.3.2-r1 al construir la imagen del notificador. La imagen local quatrivium-notify:zlib-r1 ya lo trae. El servidor publicado no se republicó. | — |
| 2026-10-08 | Restablecer contraseña: 3 intentos y 3 envíos al día por correo, y 1 minuto de espera entre envíos. | — |
| 2026-10-08 | README de GitHub alineado a mainnet chain 56, APK 1.0.2 codigo 12, alta de 4 USDT y 1233 claves. Sin redespliegue. | — |
| 2026-10-08 | Si falla obtenerTasaInteresActual, la app conserva la tasa anterior en lugar de pintar 0. | — |
| 2026-10-08 | Lectura fallida del credito pendiente o del bote conserva la cifra anterior. Frances rachaLead: el mismo dia no suma otra vez. | — |
| 2026-10-08 | Antes de firmar el retiro de la provision, el aviso muestra importe y billetera. Canje y la guia ya no prometen fama de red. Hindi y bengali corrigen el destino. | — |
| 2026-10-08 | La app ya no promete fama de red por el alta ni racha por registrarse. El panel de admin puede proponer y confirmar el retiro del bote de reserva. El splash nativo es el fondo verde, y el logo grande sigue en la pantalla de carga. | — |
| 2026-10-08 | Ajustes ya no publica el nombre de usuario como apodo. El apodo de la red se confirma con imagen y queda fijo. | — |
| 2026-10-08 | Modales de identidad y de envio con altura real. La red ya no anida un scroll. El registro automatico espera una lectura correcta. Ajustes usa la misma regla de admin que la casa. | — |
| 2026-10-08 | Logo de carga tapa la casa hasta alta, KYC e identidad. Splash nativo con emblema cuadrado. Hitos se desplazan en la ventana. No se reintenta el registro solo. Candado de contacto renovable cada mes. | — |
| 2026-10-08 | App: teclado al campo activo, prestamo tras lectura de KYC e identidad, foto KYC reemplazable hasta la declaracion, fondo conserva la cifra si la red falla, textos de/fr. | — |
| 2026-10-08 | La foto del KYC, una vez aceptada, ya no se reemplaza al cambiar los demas datos en Ajustes. | — |
| 2026-10-08 | La pantalla suelta el logo al conocer el alta, la fundadora ve el panel en Real, el teclado no tapa el aporte, y correo y numero quedan fijos un mes. | — |
| 2026-10-08 | App: cambio Demo/Real espera la cadena, KYC declarado se comparte, la camara no cierra Ajustes, donado fallido conserva el apoyo, enlaces solo https de quatriviumcredit.app. Contratos sin cambios. | — |
| 2026-10-08 | App: la camara de KYC no cierra el modal, las pantallas esperan la lectura de cadena antes de decir sin alta, el codigo de correo y telefono espera 60s, y hay logo transparente al cargar. Contratos sin cambios. Fondo de credito en BSC 1.85 USDT, reserva 1, comisiones pendientes 0. | — |
| 2026-10-07 | Sincronizacion app-contratos: registroHecho fallido no se guarda como alta impaga; Reserva muestra el bote del contrato, no el saldo de la billetera. | — |
| 2026-10-07 | App: huella sin requireAuthentication al guardar y prompt al usar; scroll con flex en ventanas congeladas; timeout de 8s ya no borra la sesion; alta muestra Firmar si el USDT ya esta en la billetera interna; BNB 0.001 solo al firmar y sin grifo en Real; PIN sin remount; espera en huella; reconectar sesion; i18n padrino. Contratos sin cambios. | — |
| 2026-10-07 | Cierre de auditoria APK: alta = registroHecho (no donacion), Reserva sin 'Ahora 12%' sin lectura, KYC/identidad siguen el contrato en Real, updates OTA apagadas para el proximo APK, assetlinks.json listo en web/.well-known, frances corregido; security:check acepta las direcciones Demo vivas en eas.json | — |
| 2026-10-06 | Mainnet chain 56 desplegado: Credit 0xade65b4224B4C6b2f1CCAb9D58c810EE15ac71D6. Foundry 44/44. La app usa esa direccion si falta la variable de entorno. No redesplegar. | — |
| 2026-10-04 | Acciones de GitHub: Gitleaks y TruffleHog en cada push y pull request. Repositorio privado, Gitleaks usa el binario abierto. | — |
| 2026-10-04 | Auditoria de app: identidad antes de KYC en Demo, y el banner de alta no dice Vincule si el contrato de alta ya esta. | — |
| 2026-10-04 | La vinculación queda por red. El botón Pasar al fondo envía vencerPadrinoAlPool desde la billetera de la frase, sin cambiar contratos. | — |
| 2026-10-04 | Historial y red usan el bloque de la direccion conocida. El texto de admin en 17 idiomas dice quorum de 2 fundadoras. | — |
| 2026-10-04 | En el Xiaomi, Cuenta Real sin contratos muestra que el credito se firma en el lanzamiento, y Reserva sin contrato no publica una tasa actual. | — |
| 2026-10-04 | El despliegue de mainnet queda escrito y bloqueado: cuatro contratos, feed USDT/USD vivo, sin sembrar la caja y sin tocar la red 97. No se ha enviado. | — |
| 2026-10-03 | Testnet 97 redeploy: Credit 0xD318, Alta 0xE890, Reserva 0x98bE, Fama 0xEC27, startBlock 134721274. Pool 500. Mainnet vacio. | — |
| 2026-10-03 | Prestamo exige registroHecho cuando Alta esta puesta. Padrino vencido anota el sello al deudor. Deep link no abre Admin. Nucleo 23254 bytes, bajo EIP-170. | — |
| 2026-10-03 | Alta 4 USDT sin desglose en UI ni legales. Frase 24 palabras explicada como llave en el telefono, no en la red. | — |
| 2026-10-03 | Catalogo y legales en 17 idiomas con tono institucional. Vincular/Vinculado. Politicas y extras nativos, no fallback ingles. | — |
| 2026-10-03 | Catalogo de hitos y 17 idiomas alineados a bonoDeHito (400-20000) y alta 4 USDT. Demo tambien pide el alta si hay contrato Alta. | — |
| 2026-10-03 | Auditoria 3 oct: candados Alta en Demo, copy 4 USDT, CEI en pagarRegistro. Credit.solicitarPrestamo sigue sin requireAltaPagada por EIP-170. Xiaomi APK 13-sep + Metro. | — |
| 2026-10-03 | Protocolo nuevo en BSC testnet 97: Credit 0xdF21Ec0bCBFb6F03b6929De4b37B3B6c40d31F5a, Fama 0x74914FD88E98F18f2D27EC343c00f28FcDA981F4, Reserva 0x9058C95bBdde3B215f86908aE66F1B2C03180420, Alta 0xa590f241868560AF3f9E2017c7d629FFDEA27e2B. Pool 500. 2-de-2. Demo viejo 0xD2d2 intacto. Mainnet sin deploy. | — |
| 2026-10-03 | Fama 100 por USDT desde el primero en donar/aportar. Si el referido no paga el L1 en 7 dias, el 1 del padrino va al pool via Alta.vencerPadrinoAlPool. Credit bajo EIP-170. | — |
| 2026-10-03 | Auditoria 3 oct: solicitar exige altaPaid si hay Alta; _pagarComision ignora blacklist; deep links con allowlist. requireAltaPagada vive en FamaLib, Credit no la llama por EIP-170. i18n 1194/17. Alta 6/6 y cyber 67/67. | — |
| 2026-10-02 | Alta 4 USDT de una vez (sello incluido). Correo y celular sin tarifa. Autenticador de admin en el worker. | — |
| 2026-10-02 | App y tests alineados al alta 4 USDT. Padrino ya no come caja si hay Alta. Attester 2-de-2 off-chain. Panel lee caja y Reserva. Sin testnet. | — |
| 2026-10-02 | Invariantes Foundry NAV Credit y caja Reserva (Handler). Centinela Python solo lectura + Telegram, sin pausa. | — |
| 2026-10-02 | Alta Real 4 USDT: 1 fundador + 1 Reserva (bote) + 1 sello + 1 padrino en QuatriviumAlta. Hitos proporcionales 400-20000 hasta L1000. Reserva APY movil techo 12 por lo bloqueado; admins retiran bote con quorum 72h. No desplegado. | — |
| 2026-10-02 | El pool manda: se quita el 10% diario y las 10000 altas como racion de credito. 80% uso, grandes al 70%, sello 7d del 1 USDT de verificar. Textos de espera por caja. Demo 0xD2d2 sin parche. | — |
| 2026-10-02 | Cupo formula B: max(50 USDT, 0.5% caja) para carril chico; dos potometros del 10%. Demo 0xD2d2 sin parche. | — |
| 2026-10-02 | Cupo en dos carriles: chicos 1-50 USDT fuera del 10%; grandes limitados al 10% de caja libre. Demo 0xD2d2 sigue en 50 hasta redesplegar. | — |
| 2026-10-02 | Cupo de originacion: 10% de caja libre, piso 50 USDT, freno 10000 altas/dia. Math en FamaLib. Demo 0xD2d2 sigue en 50 hasta redesplegar. | — |
| 2026-10-02 | SonarCloud 1550fe0 gate OK 0 issues. Credit: CEI en depositar, donar y liquidate (estado antes de transferencias). | — |
| 2026-10-02 | Worker Docker: override ws 8.21.0 y se quita npm/yarn de la imagen. Trivy image HIGH/MEDIUM 0 con DB del 2026-10-02. | — |
| 2026-10-02 | Trivy: overrides adm-zip 0.6.1, serialize-javascript 7.1.2, undici 6.28.1, bn.js 4.12.5. Politica .trivyignore y trivy.yaml. tmp 0.0.33 de solc se mantiene. | — |
| 2026-10-01 | Demo alineado a mainnet: sin destruirCuenta. Identidad on-chain permanente; recuperar solo con frase. | — |
| 2026-10-01 | Auditoria Foundry: fama de donacion solo sobre el exceso de 2 USDT; liquidate bloquea self; executeAdminAction marca executed despues de exito; reanudarBoost 2-de-N; suite forge-test/QuatriviumAudit.t.sol | — |
| 2026-10-01 | Blindaje on-chain: Reserva con guardianes 2-de-N, tope diario y pausa de boost; Credit sin pull en mora, peg en donar, bucle de bonos <=20; Android pinning GTS; destroy no aprueba USDT si hay shares | — |
| 2026-10-01 | Vincular billetera: proveAndSaveLinkedWallet firma EIP-712 (purpose vincular-billetera) y solo entonces guarda. Texto de pool: no se puede retirar (poolPublicLead, poolLockedNote, guidePoolBody). | — |
| 2026-10-01 | Cierra hallazgos de la auditoria: nonce de identidad, KYC con telefono, pausa en donar, mora/liquidacion del fundador, destroy sin confiscacion, boostId+rate limit, FundsConfirm Keystore fail-closed, /health minimo. | — |
| 2026-09-30 | Guia profesional en Ajustes; bono nivel 200 = 30000 USDT; sala Red reorganizada con enlace de invitacion y tabla de generaciones. | — |
| 2026-09-30 | Esquema de puerta 2+1: acceso 2 USDT a fundadora sin fama; correo y telefono 0.50+0.50 al pool sin fama; captacion 1 USDT sin fama de caja; fama de red gen 2+ y recorte fundador; ya no se paga el 0.50 de puntos de red. Credit EIP-170 24059 B. | — |
| 2026-09-30 | Sala Racha en el hermano de fama: 100 fama/dia, gracia 1 dia, bonos 5/25/100/500 USDT a 7/30/100/365, ranking de racha. Credit intacto EIP-170. | — |
| 2026-09-30 | Niveles: lista de comisiones por generacion; L1000 acumula y bono cada 100; cuotas opcionales contra vencimiento final. Nucleo sin funciones borradas. | — |
| 2026-09-30 | Copy de niveles/comisiones igual al nucleo (gen 15/8/6/4/2/0.8/0.4, primer L1 1 USDT del pool, 50 puntos solo al directo). Autenticador sin QR si ya esta validado. confirmSecurity antes de mutar PIN, huella, metodos y autenticador. | — |
| 2026-09-30 | Copy alineada al contrato: fama 100 por estable, Reserva solo operativa nivel 10, QR TOTP al abrir Seguridad, texto de universos de token Demo/Real | — |
| 2026-09-30 | Canje hasta 1000 USDT; Reserva muestra tramos 0/10/20 porciento y una posicion de 30 dias; minimo 1 USDT en bloquear; textos institucionales en es/en | — |
| 2026-09-30 | En Cuenta Real la contraseña no cae a AsyncStorage. Si el cofre de huella no abre, se pide PIN o contraseña; no se abre con wrap suelto. | — |
| 2026-09-30 | Canje de fama usa el mismo vencido que Credit (cuota o plazo final). Foundry despliega FamaCaja y el constructor de 7 argumentos. Nucleo Credit intacto (EIP-170). Hardhat 210/210. Foundry 11/11. | — |
| 2026-09-30 | Cuenta Real ya no guarda el sobre de la billetera en AsyncStorage si falla SecureStore. Cuentas nuevas se cifran con AES-256-GCM; las v1 se siguen abriendo. | — |
| 2026-09-30 | Auditoria canje: el fundador ya no puede donarse fama; mora y vencido no canjean; sacarCaja exige saldo real. Credit 24536/24576. | — |
| 2026-09-30 | Sala Canje cableada a QuatriviumFamaCaja (hermano). Credit no se recorta: 250 fama=1 USDT del pool; Reserva lock documentado en la misma sala. | — |
| 2026-09-30 | Dockerfile.notify declara USER node; el entrypoint solo hace chown/su-exec si arranca como root. Worker prueba /data y cae a /app/data. Contratos y app sin hallazgo nuevo. ReDoS Expo 54 se ignora, no se sube a 55. | — |
| 2026-09-30 | Reserva: texto solo de funcionamiento, sin fundador, cuenta atras en Desbloquear. Politicas 2026-09-30.1 con Reserva, riesgos y ley local. No se afirma legalidad universal ni Play 100. | — |
| 2026-09-29 | Snyk: alfabeto no es password, invite sin redirect abierto, regex acotado, rutas del kit con under_root; HTTP del worker sigue detras de TLS de Render | — |
| 2026-09-29 | Bunker: purpose EIP-712 por ruta, replay persistido, store atomico, wallet SecureStore-first, lockout en fondos, timelock fundador Reserva | — |
| 2026-09-29 | GET / del worker responde ok y apunta a /health. Sonar ignora USER root del Dockerfile.notify porque el entrypoint baja a node. Snyk: override brace-expansion; inflight y uuid 7 se ignoran por Expo 54. | — |
| 2026-09-29 | Worker y KYC listos para Sumsub por env en Render. El panel de admins no guarda esas claves. Attester HSM sigue pendiente del proveedor. | — |
| 2026-09-29 | Hardening: el worker no guarda ni devuelve el wrap; autofund exige EIP-712; approve exacto tras prestar; attester no usa la llave de owner en host publico; Reserva boost solo attester y cambios de owner/credit a 72h | — |
| 2026-09-29 | Reserva visible desde el inicio, usable en nivel 10; aportarBote solo admin (no Donar ni pool) | — |
| 2026-09-29 | Reserva: extra de comisiones de red del bote (tramo 2/3) con corte del fundador; Credit no se recorta; worker paga al ver ComisionGeneracional | — |
| 2026-09-29 | Reserva endurecida: desbloquear vive bajo pausa, pin de direccion Demo, approve acotado, setCredit(0) prohibido, syncPauseFromCredit, invariante Foundry y guardian en el worker. Credit no se toco. | — |
| 2026-09-29 | Reserva E2E: Credit.paused/mora no atrapan el principal; desbloquear sigue permitido; deploy testnet listo (sin humo de lock en el deployer). Falta tBNB en 0x5023. | — |
| 2026-09-29 | Sala Reserva: contrato hermano QuatriviumReserva (lock 30 dias, techo hasta 12% anual del bote, principal vuelve, recorte fundador y boost de red). UI en el hub, Demo practica local, Real exige identidad. Sin recortar Credit ni mezclar con el pool. Sin deploy mainnet. | — |
| 2026-09-29 | Quality Gate Magno: corrige S5845, S2083, S8705 y S8786 que quedaron tras el analisis 02:43. | — |
| 2026-09-29 | Correccion SonarCloud de los 26 issues del analisis 29-sep y Quality Gate de codigo nuevo. | — |
| 2026-09-18 | Auditoria PDF MobSF descsdsadarga.pdf del APK 35CADA22 (1.0.2 vc4): 61/100 Grade A. HIGH=AES/CBC de huella androidx.biometric (se mantiene). 0 exportados, sin exp+, sin HTTP claro, OFAC vacio, sin Twilio/claves. I18n: 15 idiomas ya no muestran CONFIRM_MAINNET. Hardhat 178. Falta mainnet. | — |
| 2026-09-18 | APK release 1.0.2 versionCode 4 en Escritorio Quatrivium-Finance-MobSF.apk (67.29 MB, SHA256 35CADA22…, v3 CN=Quatrivium Finance, sin esquema exp+). Escanear solo en localhost:8000. No se reinstalo en Xiaomi. | — |
| 2026-09-18 | Auditoria kit completo: Dockerfile.notify USER node, override compression 1.8.2, ZAP HEALTH_OK=1 sin alertas, Semgrep https-only en fetch-wallet-logos. image-size 1.2.1 queda en Metro. | — |
| 2026-09-18 | Slither operativo en Windows con Hardhat 2 forzado; 7 avisos revisados sin fallo real; test nuevo de premio de asiento (exactitud + tope de bote). | — |
| 2026-09-18 | Auditoria en vivo USB: Seguridad Real ya no pide 1 USDT de acceso si mainnet no esta publicado; candado sin correo en metodos disponibles. | — |
| 2026-09-18 | Auditoria: restaurar identidad no apaga el telefono on-chain, Solicitar Real exige 1 USDT on-chain, el vinculo se previsualiza antes del 0.50, y el candado ya no envia OTP de correo. | — |
| 2026-09-18 | Correo y numero salen del candado. Desbloquear, pedir, pagar y transferir solo usan PIN, autenticador, huella o contraseña. Identidad de crédito no cambia. | — |
| 2026-09-18 | Correo y numero quedan en la cuenta: viajan a otro celular sin re-OTP, se cambian o quitan en Ajustes, cada cambio cobra 0.50 USDT silencioso, y si se quitan hay que volver a verificar para el credito. | — |
| 2026-09-18 | La tarifa 0.50 de correo y numero en Real queda silenciosa: sin texto, sin PIN extra, sin historial. El usuario solo confirma el codigo. | — |
| 2026-09-18 | Real: confirmar correo o numero cobra 0.50 USDT a la fundadora via donar (misma via que el acceso). Demo 0. El pool no se toca. Textbelt sigue solo en Render. | — |
| 2026-09-17 | Auditoria profunda pre-mainnet: Hardhat 173/173, typecheck OK, worker health OK. Fly ya no sube PRIVATE_KEY. production:prepare deriva la fundadora de PRIVATE_KEY. Donacion Real apunta a 0x5023. Sin deploy mainnet. | — |
| 2026-09-17 | Auditoria de contratos: sin bug de fondos. Nucleo 24555 B. LoanLadder.requiredCount de L1000 alineado con el nucleo (4955). | — |
| 2026-09-17 | Worker testnet arranca sin dominio ni Resend. Render usa ATTESTER_PRIVATE_KEY, no la del owner. EMAIL_FROM vacio hasta verificar el dominio. | — |
| 2026-09-17 | Demo opera sin correo, numero, KYC ni 1 USDT. Esos candados quedan solo en Real y persisten al completarlos. | — |
| 2026-09-17 | Conexion OTP: app -> worker Render -> Textbelt SMS y Resend correo. /health expone textbelt, resend y attester sin claves. ATTESTER_PRIVATE_KEY en Render (sync false). Nunca API de SMS en AdminPanel. | — |
| 2026-09-17 | OTP SMS principal: Textbelt. El worker envia el codigo a textbelt.com; TEXTBELT_API_KEY vive en .env.worker y en el dashboard de Render. Twilio/WhatsApp siguen de respaldo. | — |
| 2026-09-17 | Mythril 0.24.8 + Semgrep 1.177.0 + Trivy 0.74.0 en vivo. Mythril SWC-101 en getters/vistas 0.8.24 (falso). Semgrep 202 INFO de gas, worker 0. Trivy: Metro/snarkjs/xcode + Docker USER (se mantiene por /data). Sin cambio de codigo. | — |
| 2026-09-17 | Aderyn 0.6.8 en vivo (WSL, 6 contratos, 88 detectores): High 1 CEI en marcarMorosoSiVencido y destruirCuenta — ambas nonReentrant, se mantiene. 13 Low de estilo/gas/EIP-170. Sin cambio al nucleo ni redespliegue. | — |
| 2026-09-17 | Foundry 1.8.3 en vivo: 8/8 tests (fuzz 256) incluyendo premioAsiento multiply-first y n(n+1)/2 exacto. Lint: tx.origin, timestamps y this.selector son diseño; no se toco el nucleo por EIP-170. Sin redespliegue. | — |
| 2026-09-17 | Auditoria PDF MobSF ssaas.pdf del APK B5BD79B9 (1.0.2 vc3): 61/100 Grade A. exp+ Metro ya no aparece. HIGH CBC sigue siendo androidx.biometric (huella). Sin Twilio ni claves en el APK. OFAC vacio, 0 exportados. No se regenera APK: no hay fallo nuevo que no rompa el producto. Demo 14/15, falta mainnet. | — |
| 2026-09-17 | Auditoria PDF MobSF sss.pdf (APK 1E36EC5B, 61/100 A): el HIGH CBC es androidx.biometric CryptoObjectUtils (huella, se mantiene). Native canary JNA/Hermes. El fallo real era el esquema Metro exp+ que el merger no quitaba. Ahora se borra en el manifiesto principal y el APK Desktop es SHA256 B5BD79B9 (1.0.2 vc3, solo quatrivium:// + https invite/history/room). No es Play ni mainnet. | — |
| 2026-09-17 | APK release 1.0.2 versionCode 3 para MobSF local en Escritorio Quatrivium-Finance-MobSF.apk (67.25 MB, SHA256 1E36EC5B..., v3 CN=Quatrivium Finance, arm-only, minSdk 29). No es Play ni mainnet. | — |
| 2026-09-17 | Auditoria productiva: el padrino se fija antes de guardar el usuario; /profiles no publica el usuario de sesion; premioAsiento multiplica antes de dividir. Hardhat 168, tsc 0, production 14/15. Sin mainnet ni APK. | — |
| 2026-09-17 | Auditoria en vivo 2026-09-16: Hardhat 168, Foundry 6/6, Slither 1 divide-before-multiply en premioAsiento (redondeo a la baja), Aderyn H-1 CEI con nonReentrant, Semgrep 0, ZAP CORS * de Demo, Mythril SWC-101 falso en 0.8.24, Trivy lockfile Expo/snarkjs, MobSF APK SHA fea201d5 sin rescan 401. Sin mainnet. | — |
| 2026-09-16 | Worker 24/7 listo para Render: render.yaml (Dockerfile.notify, disco /data, health /health, NOTIFY_DATA_KEY generado, Twilio sync false). saveStore crea el directorio. Nunca PRIVATE_KEY en Render. | — |
| 2026-09-16 | Pack de deploy Hetzner para el notify-worker (Docker, Caddy, volumen /data). Fly sigue disponible. | — |
| 2026-09-16 | Referido opcional solo en alta de cuenta. Sin codigo, la cadena nace en ese usuario colgada del fundador. Tras vincular, es definitivo (SecureStore + registrarHumanoConPadre already registered). Activar linea ya no pide padrino. | — |
| 2026-09-16 | Auditoria: rankings piden nombre y foto por lotes de 100, incluyen la cuenta que mira y L1000 muestra el ciclo de solicitudes. Hardhat 160. Sin mainnet ni APK. | — |
| 2026-09-16 | Auditoria: rankings piden nombre/foto por lotes de 100 (worker + Metro 8787), incluyen la cuenta que mira aunque el escaneo recorte, y L1000 muestra las solicitudes del ciclo. Hardhat 160. Premio de ranking sigue estimado hasta hermano de pago / redespliegue. Sin mainnet ni APK. | — |
| 2026-09-16 | Rankings: 6 tableros, divisiones de 100, premio mensual 1.5% caja libre, nombre y foto publicos, visibilidad nivel 50. L1000 reinicia solicitudes para repetir el bono. Formula de premio en QuatriviumLeveling, sin recortar el nucleo. | — |
| 2026-09-16 | 1 USDT desbloquea verificar correo, numero y KYC. Sala Rankings aparte del historial de referidos: 5 tableros, puestos por esfuerzo, podio con 1o arriba y mas grande, marco de gema en cada persona y medallas distintas para 1-2-3. | — |
| 2026-09-16 | Identidad: notifyClient prueba HTTPS y luego 127.0.0.1:8787. Ajustes muestra KYC y telefono tambien en Demo. Correo no necesita contrato. Telefono y KYC on-chain siguen exigiendo linea activa en un contrato vivo. | — |
| 2026-09-16 | Auditoria PDF MobSF 1.0.2 (SHA256 fea201d5): 61/100 Grade A, 0 exportados, sin HTTP claro, OFAC vacio, dominios ok, secretos=nombres C++. HIGH CBC p/q.java = huella (se mantiene). Release overlay quita exp+quatrivium-credit. Regenerar APK no sube la nota. | — |
| 2026-09-16 | APK MobSF 1.0.2 en Escritorio (arm-only, v3 SHA-256 CN=Quatrivium Finance, SHA256 fea201d5...). JS de la auditoria final. No es el APK de Play ni mainnet. | — |
| 2026-09-16 | Auditoria final de productividad: hidratar credito solo con contrato del mundo activo; hub/linea/personas usan creditOnChain; cache de red de referidos; notify-worker AES-GCM recargado. Hardhat 149/149, tsc 0, salud 14/14, production 14/15 (falta mainnet). Sin deploy ni APK. | — |
| 2026-09-16 | Escaneos que faltaban (local, sin mainnet): Aderyn, Trivy lockfile+Dockerfile, Semgrep packs locales, Mythril bytecode, ZAP al worker WSL `/health`. GCM del almacén de avisos ahora fija `authTagLength: 16`. Sin redespliegue ni APK. | Auditoría ciber restante |
| 2026-09-16 | WSL: inventario de la lista Gemini. Ya estaban Ubuntu 24.04.5 y Foundry 1.8.3. Instalados Aderyn 0.6.8, Trivy 0.74.0, Semgrep 1.177.0, Mythril 0.24.8 (setuptools 80.10 por pkg_resources) y OWASP ZAP 2.17.0 + OpenJDK 21. C: ~9.7 GB libres. | Tooling de ciberseguridad |
| 2026-09-16 | Foundry 1.8.3 overlay en WSL (`foundry.toml`, `forge-test/`, caches aparte). `forge test` NAV/EIP-170/anti-contrato/pool locked + fuzz 256. Lint: tx.origin y timestamps son diseño, no pérdida de fondos. Runtime Foundry 23954 B; Demo live 24457 B. | Auditoría Foundry en vivo |
| 2026-09-16 | MobSF local del APK 1.0.1 (67.2 MB, v3 SHA-256): 61/100 LOW RISK Grade A. Manifiesto 0 warning, exportados 0, sin HTTP claro. El HIGH restante es CBC de androidx.biometric (huella). Produccion: 14/15, falta mainnet CONFIRM_MAINNET=yes. | — |
| 2026-09-16 | MobSF 61/100 Grade A. HIGH restante: AES/CBC en androidx.biometric (p/q.java CryptoObjectUtils). Plugin release: versionName 1.0.1, ABI armeabi-v7a+arm64, sin inspector de red, Log R8 completo. | — |
| 2026-09-16 | MobSF del APK debug (37/100): endurecido release con plugin withQuatriviumAndroidSecurity, expo-build-properties minSdk 29 y R8. Debug/dev-client no puede sacar A en MobSF. Hace falta eas build production y volver a escanear. | — |
| 2026-09-15 | Integración MobSF: scripts/scan-mobile.mjs + npm run security:mobsf. Informe en mobsf-report.json (gitignore). Requiere MOBSF_API_KEY y MobSF en localhost:8000. | — |
| 2026-09-15 | security:slither usa scripts/run-slither.mjs + run-slither-wsl.sh para encontrar pipx en WSL y no el npm de Windows. Slither 0 findings con la config del repo. | — |
| 2026-09-15 | Slither: fee de liquidacion multiplica antes de dividir; hitos con modulo; ==0 de pool/mora a <1; detector timestamp excluido (plazos de credito). Demo live no cambia hasta redesplegar. | — |
| 2026-09-14 | Auditoria 2026-09-14: Demo live 0xD2d2 alineado (24457 B, 1000 niveles, pool 2000 USDT). prepare-production ya no pisa el contrato con 0x1E5118. fundInternalFromExternal no vuelve a sacar USDT si la interna ya tiene el monto. OTP trial usa Twilio Verify. Mainnet sigue sin desplegar. | — |
| 2026-09-14 | Notify 24/7: Dockerfile.notify + fly.toml + npm run notify:sms / notify:deploy. Worker escucha PORT de PaaS. Twilio pendiente de SID/token/FROM. flyctl instalado, sin login. | — |
| 2026-09-14 | Alta y recuperacion: no se auto-crea otra billetera si el wrap existe y el blob falta; PhoneOtpSection exige deviceMatches; contrato Demo 0xD2d2 con kyc e identidad exigidos, selectores de prestamo/pago/donar/pool/KYC presentes. Hardhat 143/143, tsc 0, i18n 962. | — |
| 2026-09-14 | Auditoria profunda visual y de codigo: LegalDocuments estable, politicas en Ajustes, codigo de invitacion sin partir grupos, Demo/Real verificados en el telefono. tsc 0, i18n 962, salud 14/14. | — |
| 2026-09-14 | Privacidad y condiciones reescritas con tono de casa financiera: como trabaja, que acepta y que obtiene. Sin jerga interna ni proveedores en el texto al usuario. | — |
| 2026-09-14 | Tras el idioma, privacidad y terminos con Acepto al llegar al final. Las mismas politicas se leen en Ajustes. | — |
| 2026-09-14 | Ficha Play, privacidad, terminos, Data safety y grafico 1024x500 alineados al producto real. Camera/fotos declaradas. Assetlinks plantilla pendiente de SHA-256. | — |
| 2026-09-14 | Auditoria cuenta/credito/niveles/bonos/red/historial/donar: historial muestra acceso, bonos y donaciones sin destino; codigo de referido se copia; correo del banner abre verificacion; deposito de entrada cambia de red; donar no mezcla el 1 USDT de acceso. | — |
| 2026-09-14 | Pool de liquidez: sala visible en Demo (caja publica, sin depositar). Real sin contrato no muestra 0 USDT ni el formulario. LP y aviso de no retiro visibles. Hardhat 135/135. Demo live NAV 2000.7 USDT, peg fresco. | — |
| 2026-09-14 | Ciberseguridad: wrap de sesion migrada fuera de AsyncStorage; /session/check exige firma EIP-712 purpose session; plugin expo-screen-capture; frase no seleccionable y se oculta al recorte o al cerrar el panel. Hardhat 135/135. | — |
| 2026-09-14 | Auditoria Demo vs Real: Demo live 0xD2d2 operativo 24457 B; worker /health OK; Real sin contrato. LoanTierCard respeta contractReady; billetera externa cambia a chain 97/56 antes de pagar. | — |
| 2026-09-14 | Auditoria de contratos: bytecode Demo = repo. ABI de gobernanza completo (despausarContrato, setFeeBP, setNivel, cancelAdminAction). LoanLadder en lockstep con el nucleo. Mainnet sigue sin desplegar. | — |
| 2026-09-14 | Catalogo de rangos restaurado: Granate, Aguamarina, Citrino, Topacio, Turmalina, Peridoto, Esmeralda, Zafiro, Rubi, Onix, Diamante, Amatista. Sin Bronce/Oro/Platino. Auditoria: tsc 0, Hardhat 131/131, i18n 943, salud 14/14, conectores 210. Telefono en vivo muestra Granate I II III. | — |
| 2026-09-14 | Rangos usan las 12 gemas del catalogo (granate a amatista) como incrustaciones fotograficas en el marco. | — |
| 2026-09-14 | Incrustaciones transparentes tipo cristal: luz interior, destellos y talla de vidrio. El metal del marco se ve a traves de la gema. | — |
| 2026-09-14 | Incrustaciones de rango con talla de joyeria: cabujon, perla, corte esmeralda y talla brillante segun la piedra. Division I/II/III suma gemas, garras y fuego. | — |
| 2026-09-14 | Marcos mas anchos que la foto con incrustaciones 4/8/12. Colores de I II III mas nitidos, sin mezclar con el tono oscuro. | — |
| 2026-09-14 | El marco de rango es el logo 3D de la app pintado como metal de cada piedra. Entrelaza la foto. I denso, II vivo con mas agarre, III luminoso. Sin dibujos infantiles. | — |
| 2026-09-14 | Marcos de rango recuperan el detalle creciente del boceto original (I sobrio, II anillos y esquinas, III diamantes y filigrana). El emblema 3D metalizado se mantiene. | — |
| 2026-09-14 | Marcos: tinte por luma (no lava el metal), bisel con filigrana por division y gemas con talla y engaste. | — |
| 2026-09-14 | Sala Marcos en el hub: vitrina I/II/III por piedra. Los referidos muestran marco y rango (Granate I · nivel). | — |
| 2026-09-14 | Auditoria en vivo: banners de acceso usan onPrimary (texto negro sobre verde). Contraste KYC verificado en el telefono. Docs alineadas a 939 claves, 131 tests y 61 componentes. Demo live 24457 B. | — |
| 2026-09-14 | Marcos de rango usan el emblema 3D original (assets/ranks) teñido por division I-III. Tarjeta externa solo dice Billetera y Vincular billetera. Botones verdes con texto negro. | — |
| 2026-09-14 | KYC permite escanear el documento con la camara (foto local, sin OCR). Los marcos de rango son cuadrados y se enriquecen por division I-III y por familia. Copy recortado a tono financiero. | — |
| 2026-09-14 | Frase secreta solo se consulta. Contraseña del alta con requisitos visibles. Billetera externa en el hub y en el panel de cuenta. | — |
| 2026-09-14 | Ajustes ya no tiene panel de contraseña. Depositar, retirar, donar, pool y 1 USDT se pagan con la billetera externa vinculada; el USDT llega a la cuenta interna, que pide y paga prestamos. | — |
| 2026-09-14 | Arranque: si falta la llave de la billetera se pide la contrasena una vez y se vuelve a guardar. Textos profesionales (Depositar/Retirar). | — |
| 2026-09-14 | Textos recortados a tono financiero. Acceso Real sin botón gris. Errores de correo/SMS sin nombres de APIs. | Menos relleno en pantalla. |
| 2026-09-14 | Gobernanza 2-de-3: una llave perdida o hackeada la echan las otras 2. Una sola no gobierna. Pausa inmediata. | El 3-de-3 dejaba el contrato muerto si una se perdía. |
| 2026-09-14 | Alta: despues de la cara publica se registra una billetera externa (WalletConnect). El contrato reconoce a la fundadora por esa direccion. | — |
| 2026-09-14 | Panel admin: proponer atestador (sello del telefono) con la direccion 0x; la clave privada no entra en la app. | — |
| 2026-09-14 | Ajustes: contraseña no editable. Hub muestra acceso 1 USDT. Candado off persiste wrap. Personas: busqueda por nombre. | — |
| 2026-09-14 | Auditoria 2026-09-14: 127 tests, Demo live operativo. Acceso 1 USDT usa capacidad on-chain, no la sala Donar. Metro reiniciado. | — |
| 2026-09-14 | Personas: grupos por referido con generaciones expandibles al toque (loadReferralChildren). | — |
| 2026-09-14 | Antes de Solicitar hay que pagar 1 USDT de acceso. Internamente usa donar() hacia el fundador. Los niveles desbloqueados siguen eligibles. | — |
| 2026-09-14 | Alta separa credenciales de sesion e identidad publica. Perfil quitado de Ajustes. Directorio remoto guarda publicPhoto. | — |
| 2026-09-14 | Perfil publico: nombre e imagen anonima fijos. El historial de referidos muestra esa cara, no la foto del celular. | — |
| 2026-09-14 | Red: el historial de personas es una ventana aparte paginada (nombre, foto, alta y ganancias). El tablero de comisiones se queda en Red. | — |
| 2026-09-13 | Seguridad: ver y reemplazar la frase BIP-39 viven en un solo panel de Ajustes | — |
| 2026-09-13 | Auditoria contratos: nucleo + FamaLib + Leveling, 123 tests, Demo 0xD2d2 alineado. ABI cliente con cancelAdminAction; mainnet sin deploy. | — |
| 2026-09-13 | Auditoria en vivo: el tablero de comisiones/bono/total queda arriba en Red; Activar linea se desactiva si no hay contrato; MainActivity reenvia onNewIntent. | — |
| 2026-09-13 | Auditoria: Hardhat 121 tests, i18n 877 claves, Demo live operativo. gradle.properties newArchEnabled alineado con app.json (false). remapAndroidText ya no sintetiza fontWeight en MIUI. | — |
| 2026-09-13 | Red: tablero de comisiones, bono de primer pago y total generado a partir de eventos on-chain | — |
| 2026-09-13 | Historial aislado por mundo. Reloj de gracia/mora en pantalla principal. | — |
| 2026-09-13 | Historial partido en transferencias y prestamos. Mora on-chain: dias, fama, freeze y pool. | — |
| 2026-09-13 | KycAccessBanner: solo muestra requisitos de prestamo pendientes. Al confirmar, desaparecen. | — |
| 2026-09-13 | Como confirma: interruptor por accion y chips PIN, autenticador, huella y contrasena. Sin interruptor no se pide confirmacion. | — |
| 2026-09-13 | Como confirma recortado: Desbloquear, Transferir, Pedir, Pagar y metodos. Sin texto extra. | — |
| 2026-09-13 | Cómo confirma ya no dice que contraseña y correo son obligatorios. Desbloqueo fija contraseña como principal. Pedir, pagar y transferir eligen PIN, huella, autenticador o contraseña. | — |
| 2026-09-13 | Auditoria profunda: nextEntryScreen va a desbloqueo si hay cuenta local. Demo 2000 USDT operativo. Real y Twilio siguen del fundador. | — |
| 2026-09-13 | Auditoria 2026-09-13: Demo live 2000 USDT operativo; Real sin contrato; LanguageWelcome espera el idioma guardado. | — |
| 2026-09-13 | Primera apertura en Real; AppMode espera AsyncStorage y recuerda el ultimo modo abierto. | — |
| 2026-09-13 | Auditoria 2026-09-13: probePasswordSet distingue vacio de almacén colgado. Hardhat 116/116, cyber 28/28, Demo 0xD2d2A9 OPERATIVO. Mainnet y Twilio siguen siendo acciones del fundador. | — |
| 2026-09-12 | Auditoria profunda: 116 tests Hardhat, Demo live OPERATIVO. failOpen no abre Crear frase si el candado no responde. | — |
| 2026-09-12 | Auditoria 2026-09-12: TypeScript sin errores. Alta frase-primero. Sesion exclusiva viva en notify-worker. Metro y worker restaurados. Demo 0xD2d2A9eF operativo. Mainnet sigue sin desplegar. | — |
| 2026-09-12 | Sesion exclusiva por dispositivo via notify-worker /session/claim. Al recuperar o entrar en otro telefono, el anterior se bloquea. | — |
| 2026-09-12 | Onboarding: crear o recuperar frase BIP-39, luego usuario y contrasena. Reinstalar en el mismo telefono pide frase+usuario+clave. Telefono perdido se recupera con las 12 palabras. | — |
| 2026-09-12 | Vinculo dispositivo-billetera: walletOfDevice oculta Crear al reinstalar; restore solo de esa billetera; Solicitar Real exige deviceMatches. | — |
| 2026-09-12 | Sin destruir cuenta en la app. Recuperar con 12 palabras. Formatear o VPN no crean segunda linea: telefono y KYC on-chain la bloquean. | — |
| 2026-09-12 | Desbloqueo: contraseña principal, correo guardado, una o varias opciones. Frase 12 palabras obligatoria antes de credito. Sin cerrar sesion. Recuperar 12 palabras abre la cuenta on-chain. | — |
| 2026-09-12 | Guardar sesion ya no vuelve a Crear/Iniciar/Recuperar. Abre bloqueo; contraseña por defecto; metodos y principal en Como confirma. Cerrar sesion en Seguridad. | — |
| 2026-09-12 | Inicio sin cuenta: tres botones Crear cuenta, Recuperar cuenta e Iniciar sesion. Recuperar pide las 12 palabras. | — |
| 2026-09-12 | Recuperacion: 12 palabras traen el mismo nivel, saldo y credito. Crear cuenta se oculta cuando este telefono ya tiene cuenta. | — |
| 2026-09-12 | En Cuenta Real, Solicitar exige correo de la cuenta, telefono+dispositivo on-chain y KYC. El boton se bloquea; Demo no cambia. | — |
| 2026-09-12 | Login: hash de contrasena local (ya no 8000 hops nativos) y tope en checkPassword/guardar sesion para que Iniciar sesion no se quede girando en MIUI. | — |
| 2026-09-12 | Crear cuenta e iniciar sesion son flujos distintos. El codigo de correo es una pantalla aparte. El login ya no se queda girando si el keystore de MIUI no responde. | — |
| 2026-09-12 | Alta: contraseña y correo en la misma pantalla, OTP solo la primera vez. Inicio de sesión sin código. Guardar sesión persiste la wrap. | — |
| 2026-09-12 | Arranque en vivo: AppKit ya no se crea al importar el bundle; el modo y el idioma no bloquean el primer frame. Worker de avisos con backoff activo. | — |
| 2026-09-12 | Auditoria: arranque con tope de espera (fuentes, idioma, mundo, candado, billetera, usuario, biometria Xiaomi). Donar muestra vista previa sin firmar. Pool bloqueado en Demo. Worker de avisos con backoff si el RPC tiene cupo. | — |
| 2026-09-12 | Fama proporcional al USDT donado o aportado al pool. Preview en Donar y Pool. | — |
| 2026-09-12 | Real visible al 100 por ciento antes del lanzamiento. Fama por donar y por liquidez. Copy profesional sin destino de donacion. | — |
| 2026-09-12 | Bonos en ambos mundos. Donar sala aparte solo Real (fama). Catalogo Real completo 1000 niveles / 10 hitos. | — |
| 2026-09-12 | Donar visible en Real con destino pendiente (DEPLOYED_MAINNET.founder vacio). Pool = banco general. Envio solo con mainnet. | — |
| 2026-09-12 | Donar solo en Real: UI oculta en Demo, servicio y handler bloqueados, isDonationEnabled exige mainnet. | — |
| 2026-09-12 | Inicio de sesion: correo ya verificado no pide codigo. Guardar sesion en la misma pantalla. | — |
| 2026-09-12 | Auditoria profunda: Demo 0xD2d2A9 operativo (1000 niveles, pool 2000 USDT). Si la huella esta marcada pero el sensor no responde, se salta y se pide el siguiente metodo. | — |
| 2026-09-12 | Nombre visible de la app: Quatrivium Finance. Paquete Android/iOS y firmas EIP-712 sin cambiar. | — |
| 2026-09-12 | Como confirma permite varios metodos a la vez; se confirman en secuencia (AND). | — |
| 2026-09-12 | Inicio de sesion (correo+contrasena juntos + paso extra de Como confirma) separado de desbloquear. La sesion guardada se persiste; sin ella no se muestra Desbloquear. | — |
| 2026-09-12 | Demo live 0xD2d2A9eF0D1e4f253abc90Dd4ACb0E6C50B2de9f bloque 130652258: 1000 niveles, donar, hitos, mora fundador. FamaLib 0x6B98072a087B3fd856c24249232EE3fb40cB5003. Pool 2000 USDT NAV ok. | — |
| 2026-09-12 | Fundador exento de mora/gracia: el pool cubre su principal al vencer sin saldo. Espera 48h intacta. QuatriviumFamaLib por delegatecall. Nucleo 24457/24576. | — |
| 2026-09-12 | Fundador exento de mora/gracia: si no hay saldo al vencer, el pool cubre el principal. Sigue la espera de 48h. Fama de linea en QuatriviumFamaLib. Nucleo 24457/24576. | — |
| 2026-09-12 | Mora: debito al vencimiento, 30 dias de gracia cobrando, luego 10x nivel/dia y ganancias al pool. Nucleo 24474/24576. | — |
| 2026-09-12 | Fama unilevel decreciente al registrar (misma escala que comisiones). Fundador suma de cada alta. Puntos de red/bono pool solo del referidor directo. | — |
| 2026-09-12 | Auditoria: unlock por defecto OFF al migrar prefs; signer estable ante remount; Bonos solo si el contrato tiene hitos o donar. | — |
| 2026-09-12 | Correo y contrasena obligatorios al iniciar sesion; ambos tambien eligibles para desbloquear, pedir, pagar y transferir. | — |
| 2026-09-12 | Inicio de sesion obligatorio con contrasena y correo. Como confirma ya no permite apagar eso. | — |
| 2026-09-12 | Como confirma: 5 acciones opcionales con interruptor y metodo. Huella unica. Boton Guardar en ajustes editables. i18n 794 claves. | — |
| 2026-09-12 | Contraseña obligatoria al desbloquear e iniciar sesion. Huella o llave opcionales. Confirmar pedir o pagar prestamo es opcional (apagado por defecto). i18n 792 claves. | — |
| 2026-09-12 | Auditoria live 12-sep: stack caido (8081/8787), ADB trabado, Ankr 401 y eth_getLogs rate-limit. Worker ahora sondea RPC, salta atraso y no rota por cupo. App en telefono abre candado. | — |
| 2026-09-12 | Bonos 20 USDT x nivel de hito, sala Bonos, donar() al fundador y reputacion por donar o inyectar pool | — |
| 2026-09-12 | Bono de hito: 2000 USDT del pool al llegar a cada 100 niveles, cobro uno a uno con caja libre sobre el piso del 20% | — |
| 2026-09-12 | RequiredCount +5 por nivel desde 100 USDT. 12 rangos de piedras (ambar, perla, jade, esmeralda, zafiro, rubi) con marcos. | — |
| 2026-09-12 | Escalera 1000 niveles hasta 1M USDT. Nucleo lee formula 101-1000. App, rangos y tests alineados. Live Demo sigue en 100 niveles hasta redeploy. | — |
| 2026-09-12 | Correcciones de auditoria: wrap TOTP, confirmar fondos sin colgar, cooldown en vivo, deep link history e historial por mundo. | — |
| 2026-09-12 | Seguridad: el usuario elige metodo para desbloquear, mover dinero e iniciar sesion. Autenticador TOTP. Historial de prestamos, pagos y envios. | — |
| 2026-09-12 | Seguridad: el usuario elige método para desbloquear, mover dinero e iniciar sesión. Autenticador TOTP. Historial de préstamos, pagos y transferencias. | — |
| 2026-09-12 | Guardar sesion al crear o iniciar. Correo para recuperar clave y avisos de pago (interruptor en Avisos). | — |
| 2026-09-12 | Correo para crear e iniciar sesion. Se reemplaza en Seguridad, no en Perfil. Iniciar sesion envia codigo al correo. | — |
| 2026-09-12 | Deep links: quatrivium://room/credit y /profile. Verificado en Demo: historial 0 a tiempo / mora / penaliz. y Perfil Nivel 1/100 Bronce. | — |
| 2026-09-12 | UserMetrics muestra historial on-chain (a tiempo, mora, penalizaciones). Perfil enseña nivel/100. DOCUMENTO alineado a 100 niveles. | — |
| 2026-09-12 | useWalletLevel deja de recortar el nivel a 10. El marco de rango en Ajustes y referidos sigue el nivel on-chain 1-100. | — |
| 2026-09-12 | Tema Minimalista (blanco y negro). Avatar sin foto: silueta gris tipo Facebook. | — |
| 2026-09-12 | Panel de seguridad: contraseña y frase solo se reemplazan; PIN, huella y llave se pueden quitar. | — |
| 2026-09-12 | Auditoria: recoverAppSigner ante signer nulo; i18n errNoWallet; gitignore Python; Hardhat 89/89; salud 14/14. | — |
| 2026-09-12 | UI de Cuenta Demo/Real inconfundible; isOfficialWorldToken evita falso token apagado; cooldown se muestra antes. | — |
| 2026-09-12 | Auditoria productiva: UI y nucleo coinciden con 0x1E5118 (L1=3, resto=5). QuatriviumLeveling guarda la escalera+bono para el proximo deploy. eas.json production ya no inyecta testnet. | — |
| 2026-09-12 | Vista de niveles superiores: todos los bloqueados se listan; pulse para ver la ficha completa. Siguen sin poder pedirse. | — |
| 2026-09-12 | Avatar: solo imagen y marco de rango. Sin foto: silueta gris estilo Facebook. | — |
| 2026-09-12 | Decisión: alta nueva = Real. El último modo (Demo o Real) se restaura al reabrir. Demo disponible también en tienda (mundo testnet aislado). | — |
| 2026-09-11 | Fixes Demo: notifyApiBases localhost, lastBlock por contrato, CTA Activar en LoanTierCard, prepareDemoCredit visible tras registrar. | — |
| 2026-09-11 | Auditoria live post-redeploy 100 niveles: UI pide Activar, L1  / L2 bloqueado, historial vacio. Cache de credito keyed por contrato; refresh silencioso no reescanea niveles. | — |
| 2026-09-11 | Escalera de 100 niveles hasta $10 000: tasa del anterior siempre mayor; interés $ y monto siempre suben | Completar la línea de crédito y corregir el desorden de tasas 5→6 y 7→8 |
| 2026-09-11 | Historial de referidos: ABI con `BonoActivacionPagado`, bloque de deploy en `deployedAddresses`, fechas de actividad y sección abierta | El historial fallaba al abrir y solo miraba ~3 días de bloques |
| 2026-09-11 | Auditoría final productividad: hidratación de caché no revierte préstamo/registro on-chain; assertEnoughToPay en todas las cuotas; worker rota RPC y no tumba el HTTP | — |
| 2026-09-11 | salud_proyecto.py orquesta grafo critico + i18n/tsc/security/conectores (npm run salud) | — |
| 2026-09-11 | Auditoría final: caché de préstamo se limpia al pagar; ficha activa por `tierId`; saldo de pago usa el token de la deuda; AppKit sigue Demo/Real; worker rota RPC | Evitar deuda fantasma, botón Pagar en la ficha equivocada y avisos parados por Ankr |
| 2026-09-11 | Demo y Real son mundos distintos (testnet vs mainnet); logo en billetera Quatrivium | Real heredaba préstamo y saldo de Demo porque ambos leían el mismo contrato de prueba |
| 2026-09-11 | Cooldown de préstamo en cliente + FallbackProvider `quorum: 1` | `obtenerCooldownRestante` cambiaba cada segundo y LogBox mostraba `quorum not met` |
| 2026-09-11 | Modo Real vuelve a exigir KYC/teléfono; demo solo si se elige en Ajustes | `isDemoMode()` (testnet) ocultaba el KYC de las cuentas reales |
| 2026-09-11 | Frase secreta solo respaldo; OTP correo solo alta/recuperar; admin oculto sin wallet fundadora; demo sin KYC/teléfono | Alinear seguridad y demo con el flujo real |
| 2026-09-11 | Huella: detección real (sin NativeModules), PIN y llave de acceso unificados, textos sin Face ID en Android | La app decía que no había huella aunque el teléfono sí la tenía |
| 2026-09-11 | Auditoría productividad: no saltar onboarding si falla la wallet; errores device-bound/locked; KYC no cierra si falla on-chain; auto-fund con safeFetch | Huecos al crear cuenta y verificar correo |
| 2026-09-11 | Alta: idioma → crear/entrar → clave → correo OTP. Demo se elige en Ajustes. Textos de avisos/Proton quitados. Botón crear con Gmail. | Flujo de cuenta real, no demo por defecto |
| 2026-09-11 | `tx.origin` añadido a `depositarLiquidez` y `pagarPrestamo` | CONTEXTO lo daba por hecho y el contrato no lo tenía |
| 2026-09-11 | `eas.json` imagen Android `sdk-54` en los 3 perfiles | Evita Java 25 en EAS cloud |
| 2026-09-11 | Auto-fondeo BNB testnet + auto-refresh balances 30s + `EXPO_PUBLIC_NOTIFY_API` | Demo sin error de gas |
| 2026-09-11 | KYC: nombre y tipo de documento congelados | Identidad inmutable |
| 2026-09-11 | PIN para rotar frase · mora bloquea cierre · bio para desactivar huella | Acciones destructivas protegidas |
| 2026-09-11 | Contrato: `destruirCuenta` exige `!esMoroso` | Deuda = no puedes salir |
| 2026-09-11 | i18n 617 claves × 17 locales | kycNameLocked, destroyDelinquent, seedRotatePinRequired… |
| 2026-09-10 | CONTEXTO.md inicializado | Auditoría completa |
| 2026-09-10 | slug `quatrivium-credit` · `useHomeHandlers` · liquidación AdminPanel | Modularización |
| 2026-09-10 | override `ws: ^8.21.0` · expo-updates · ProGuard · ngrok · attester | Hardening |
| 2026-09-11 | Textos UI sin tecnicismos · app.json schema 18/18 · EAS dev client | Pulido de producción |
