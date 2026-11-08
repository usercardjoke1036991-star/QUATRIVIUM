# Quatrivium Finance — Resumen del producto, funciones y características

Documento de referencia de la app **Quatrivium Finance**. Describe lo que existe hoy en el código y en el contrato, no un pitch de marketing.

Última actualización: 25 de octubre de 2026.

---

## 1. Qué es

Quatrivium Finance es una app móvil de **microcrédito on-chain sin colateral**. El usuario conecta una wallet, se registra, pide un préstamo en stablecoin (USDT) y lo paga. Si paga **antes del vencimiento**, sube de nivel y puede pedir más. Si se atrasa, queda en mora y el protocolo le bloquea nuevos préstamos.

No es un banco, no es un exchange y no es un DEX. Es un **pool de liquidez + motor de crédito** en un contrato inteligente, con una interfaz Expo / React Native.

| Concepto | Realidad actual |
|---|---|
| Nombre de producto | Quatrivium Finance |
| Contrato | `QuatriviumCredit.sol` (Solidity 0.8.24, OpenZeppelin v5) |
| Colateral / fianza | No hay. El préstamo es 100 % sin garantía |
| Identidad ZK | No está en producción. El botón de registro es `registrarHumano` (self-register) |
| Un préstamo a la vez | Sí. No se puede pedir otro hasta pagar o liquidar el actual |
| Red de pruebas | BSC Testnet (chain 97) |
| Red de producción | BSC Mainnet (chain 56), contrato distinto y más viejo |

---

## 2. Propuesta de valor

1. **Crédito sin pedirle garantía al usuario.** No deposita USDT extra ni NFT ni BNB como colateral.
2. **Reputación on-chain.** Pagar a tiempo sube el nivel (1 → 100) y suma puntos de reputación. La mora resta puntos y corta el acceso.
3. **Pool de liquidez.** Cualquiera puede aportar USDT. Ese capital se queda para prestar: `retirarLiquidez` revierte con `pool locked`. No hay retiro de la parte aportada.
4. **Reglas públicas.** Montos, plazos, tasas, cooldown, tope diario y oráculo están en el contrato, no en un servidor opaco.

El riesgo de crédito (alguien pide y no paga) lo absorbe el pool. Eso no es un bug: es el modelo. El contrato no puede “ir a buscar” al deudor fuera de la chain.

---

## 3. Stack técnico

### App

- Expo 54 / React Native 0.81 / React 19
- Expo Router (`app/index.tsx` es la pantalla principal)
- ethers v6
- Reown AppKit (WalletConnect) para conectar MetaMask y otras wallets
- TypeScript
- Almacenamiento: SecureStore + AsyncStorage (sesión AppKit)

### Contratos

- Hardhat
- OpenZeppelin: Ownable, Pausable, ReentrancyGuard, SafeERC20
- Oráculo: Chainlink AggregatorV3 (o mock en testnet)
- Tests: `test/accounting`, `liquidation`, `morosity`, `peg`, `security`. El aporte no se retira (`pool locked`); no hay circuit breaker de retiros al 50 %.

### Scripts

- `scripts/deploy.cjs` — despliega QuatriviumCredit y escribe la dirección en `.env`
- `scripts/seed-testnet.cjs` — mintea USDT mock y carga el pool

---

## 4. Cómo se usa la app (flujo de usuario)

Pantalla única. De arriba a abajo:

### 4.1 Conectar wallet

- Botón WalletConnect / Reown AppKit.
- En development la app fuerza **BSC Testnet (97)**.
- En production, BSC Mainnet (56).
- Hace falta BNB (o tBNB) para gas.

### 4.2 Elegir token

- Selector de token.
- En development solo se muestra el USDT de testnet configurado en `.env`.
- En production se listan los tokens soportados de `constants/tokens.ts`.

### 4.3 Ver balances

Muestra:

- Saldo del token en la wallet del usuario
- Tamaño del pool (lectura: liquidez + préstamos vigentes)
- Posición LP del usuario (solo lectura; el aporte no se retira)

### 4.4 Ver progreso

Tarjeta **Tu Progreso**:

- Nivel actual (1–100)
- Reputación (empieza en 100; no tiene techo 100)
- Historial: pagos a tiempo, préstamos en mora y penalizaciones
- Pagos a tiempo vs. los que faltan para subir (3 en nivel 1, 5 en L2–99; el 100 no sube)
- Cooldown restante (48 h entre préstamos)
- Si hay deuda activa: monto a devolver y fecha de vencimiento
- Badges: Registrado / Préstamo activo / En mora

### 4.5 Activar línea de crédito

Botón **Activar línea de crédito**.

- Llama `registrarHumano()` en el contrato.
- Es un self-register: `tx.origin == msg.sender` (no se puede registrar desde otro contrato).
- No hay prueba ZK, no hay KYC, no hay documento de identidad.
- Sin este paso no se puede pedir préstamo.

### 4.6 Pedir préstamo

Hay **1000 niveles** (1 a 1000), del $1 al $1 000 000. El usuario solo puede pedir el nivel que ya desbloqueó; los demás se ven en ficha, bloqueados (los lejanos se agrupan de 50 en 50). Los 1–100 son la tabla original; 101–1000 salen de fórmula.

Al pulsar **Pedir**:

1. La app estima gas y, si hace falta, pide aprobación USDT (en el modelo actual el préstamo no exige depósito previo del usuario).
2. Envía `solicitarPrestamo(token, nivel)`.
3. El contrato transfiere el principal desde el pool a la wallet.
4. Queda una deuda = principal + interés del momento.
5. Empieza el plazo (días del nivel).
6. Se activa el cooldown de 48 h para el siguiente préstamo.

Condiciones que el contrato exige (si falla, la tx revierte):

- Contrato no pausado
- Usuario registrado y no moroso
- Sin préstamo activo
- Cooldown cumplido
- Nivel desbloqueado
- Token soportado y oráculo fresco (precio no más viejo de 1 h)
- Peg del stable ≥ 0,98 USD
- Pool con liquidez suficiente
- Utilización del pool ≤ 80 %
- `tx.origin == msg.sender` (EOA, no contrato)

### 4.7 Pagar préstamo

Con deuda activa, la tarjeta del nivel muestra **Pagar**.

- Aprueba USDT si hace falta.
- Llama `pagarPrestamo(token)`.
- El contrato parte el pago según el monto: 2 cuotas desde 50 USDT, 3 desde 60, 6 desde 25 000 y 12 desde 100 000. Por debajo de 50 USDT es un solo pago (principal + interés).
- Si paga **antes del vencimiento**:
  - Suma un pago a tiempo
  - Tras 3 (nivel 1) o 5 (niveles 2–99) pagos a tiempo, **sube de nivel**
  - Suma puntos de reputación (`puntosPorPagoATiempo`, 100 por defecto)
- Si paga **tarde**:
  - El préstamo se cierra igual
  - **No** cuenta para subir de nivel
  - Queda marcado moroso (no puede pedir otro)

### 4.8 Aportar liquidez (LP)

Cualquier wallet conectada puede:

- Aportar USDT al pool (`depositarLiquidez`)
- `retirarLiquidez` no devuelve el capital: revierte con `pool locked`

Quien aporta recibe 100 de fama por cada 1 USDT, desde el primero. Esa fama se canjea aparte, a 250 por 1 USDT, si el fondo tiene liquidez. El canje no es un retiro del aporte. `valorLp` solo informa un valor de lectura.

### 4.9 Admin / fees

Si la wallet conectada es owner/admin:

- Puede retirar comisiones acumuladas (`retirarComisiones` / `retirarComisionesToken`)
- El resto de cambios sensibles (unpause, parámetros, tokens) van por **propuesta + timelock de 72 h + confirmaciones**

`pausarContrato` es inmediato (emergencia). Despausar no: hay que esperar el timelock.

---

## 5. Niveles de crédito

Hay **1000 niveles**, de 1 USDT a 1 000 000 USDT. El alta de la cuenta es otro pago, de 4 USDT, y no es el préstamo del nivel 1. Los niveles 1–100 están en `constants/loanTiers.ts`. Del 101 al 1000 los calcula `LoanLadder.sol`: monto = 10 000 + 1 100 × (nivel − 100) USDT, plazo = 90 + (nivel − 100) / 10 días, tasa base = 800 − min(nivel − 100, 394) puntos básicos. El nivel 1000 queda en 1 000 000 USDT, 180 días y 4,06 %.

| Nivel | Principal | Plazo | Tasa base del nivel* | Cuotas |
|------:|----------:|------:|---------------------:|-------:|
| 1 | 1 USDT | 7 días | 100 % | 1 |
| 2 | 2 USDT | 10 días | 95 % | 1 |
| 3 | 5 USDT | 15 días | 80 % | 1 |
| 4 | 10 USDT | 20 días | 70 % | 1 |
| 5 | 20 USDT | 25 días | 50 % | 1 |
| 6 | 35 USDT | 30 días | 48 % | 1 |
| 7 | 50 USDT | 35 días | 40 % | 2 |
| 8 | 60 USDT | 40 días | 38 % | 3 |
| 9 | 80 USDT | 45 días | 36 % | 3 |
| 10 | 100 USDT | 50 días | 34 % | 3 |
| 100 | 10 000 USDT | 90 días | 8 % | 3 |

\* La tasa que **realmente se cobra** al pedir no es solo la del nivel. El contrato usa `obtenerTasaInteresActual(token)`: una curva según **utilización del pool** (cuánto está prestado vs. el tamaño del pool). A más utilización, más cara la tasa.

Progreso:

- Empiezas en nivel 1 al registrarte.
- Nivel 1 → 2: 3 pagos **a tiempo**.
- Niveles 2 a 9: 5 pagos a tiempo.
- Desde el nivel 10: 5 × (nivel − 9) pagos a tiempo. El nivel 1000 no sube.
- Un pago tarde no suma progreso.

---

## 6. Economía del protocolo

### Préstamo

```
deuda = principal + interés
interés = principal * tasaAplicadaBP / 10000
```

El usuario recibe el principal al instante. Debe devolver principal + interés antes del vencimiento.

### Comisión

Un porcentaje de los intereses (`feeBasisPoints`, por defecto 10 % = 1000 BP) se aparta como fee del protocolo. El resto del interés queda para el pool (los LPs).

### Liquidación de mora (`liquidate`)

Función del contrato, pensada para que un tercero pague la deuda vencida:

1. El liquidator transfiere `totalDue` al contrato.
2. Se cobra el fee sobre el interés.
3. El liquidator recibe un premio del 5 % del principal (acotado a lo disponible).
4. La deuda del usuario se cierra.
5. El usuario queda **moroso** (si aún no lo estaba) y pierde reputación.

Hoy **no hay un botón de liquidación en la pantalla principal** de la app. La función existe on-chain; se puede llamar con otra wallet o script.

También existe `marcarMorosoSiVencido`: marca mora cuando ya pasó la fecha, sin liquidar.

### Contabilidad

Invariante que los tests comprueban:

```
caja + préstamos vigentes  ==  liquidez del pool + fees acumulados
```

---

## 7. Seguridad y reglas del contrato

Estas barreras están en Solidity, no en la UI.

| Protección | Qué hace |
|---|---|
| Sin contratos intermediarios | `tx.origin == msg.sender` en registro, préstamo, pago, depósito, retiro y liquidación |
| ReentrancyGuard | Evita reentrada en funciones que mueven tokens |
| SafeERC20 | Transfers/approvals seguros |
| Pausable | Se puede congelar el protocolo |
| Oráculo obligatorio | Precio USDT/USD; si está viejo (> 1 h) o el peg < 0,98, no se origina |
| Un préstamo activo | Impide apilar deuda |
| Cooldown 48 h | Impide spamear préstamos |
| Utilización máx. 80 % | No se presta el pool entero |
| Pool no redimible | `retirarLiquidez` revierte siempre (`pool locked`) |
| Timelock 72 h | Cambios de admin no son instantáneos (salvo pausa) |
| Multisig de confirmaciones | Acciones admin necesitan N de M admins |
| Self-register | Cada wallet se registra a sí misma; no hay whitelist mágica |

Lo que **no** cubre el contrato:

- Sybil: mil wallets nuevas pueden pedir el nivel 1 y no pagar. Eso drena el pool. Es riesgo de crédito, no un agujero de Solidity.
- Un usuario que gasta el USDT prestado y desaparece.
- Un oráculo manipulado o caído (si el feed está mal, el protocolo se niega a prestar; no “adivina” el precio).
- La clave privada de la wallet del usuario. Si la pierde o la pega en un chat, no hay recupero on-chain.

---

## 8. Identidad y “ZK” (leer con calma)

En la UI el bloque se llama algo como identidad / línea de crédito. En el código:

- `ZKIdentitySection` llama `registrarHumano`.
- `services/zkService.ts` tiene carga de `snarkjs` / circuitos, pero **Metro no puede empaquetar snarkjs** en React Native (`readline` de Node). Hay un stub (`stubs/zk-node-stub.js`) para que la app no crashee.
- Los contratos `zk-contracts/` (Groth16Verifier, QuatriviumCreditZK) son **experimentales** y Hardhat no los usa en el deploy de producción/testnet.

**Conclusión:** hoy Quatrivium Finance no verifica humanidad con zero-knowledge. El registro es “yo firmo con mi wallet”. El copy de la app no debería prometer ZK real.

---

## 9. Pantallas y módulos de la app

| Módulo | Archivo | Función |
|---|---|---|
| Pantalla home | `app/index.tsx` | Orquesta todo |
| Wallet | `components/WalletSection.tsx` | Conectar / desconectar |
| Token | `components/TokenSelector.tsx` | Elegir USDT (u otros en prod) |
| Saldos | `components/BalanceDisplay.tsx` | Wallet, pool, LP |
| Métricas | `components/UserMetrics.tsx` | Nivel, reputación, mora, deuda |
| Registro | `components/ZKIdentitySection.tsx` | Activar línea de crédito |
| Niveles | `components/LoanTierCard.tsx` | Pedir / pagar |
| Pool y admin | `components/AdminPanel.tsx` | Depositar, retirar, fees |
| Saldos on-chain | `hooks/useWeb3Balances.ts` | Lee contrato + RPC |
| Transacciones | `hooks/useWeb3Transactions.ts` | Approve, préstamo, pago, LP |
| ABI / llamadas | `services/quatriviumCreditService.ts` | Capa ethers |
| Storage | `services/secureStorageService.ts` | Claves locales |
| Red | `constants/rpcConfig.ts` | RPC, chainId, AppKit |
| Contrato | `constants/contractConfig.ts` | Dirección según entorno |
| Tokens | `constants/tokens.ts` | Lista de stables |
| Errores tx | `utils/txErrors.ts` | Mensajes legibles de revert |
| Seguridad | `SecuritySettings` + `authPrefs` | El usuario elige cómo desbloquea, mueve dinero e inicia sesión |
| Autenticador | `services/authenticator.ts` | TOTP de 6 dígitos (Google Authenticator u otra app) |
| Historial | `components/MovementHistory.tsx` | Préstamos, pagos y envíos entre billeteras (on-chain + diario local) |

El correo sirve para crear cuenta, entrar y recuperar la clave. El historial de movimientos vive en el teléfono y en los logs del contrato, no en un servidor de usuarios.

---

## 10. Redes y configuración

La app elige contrato así (`getContractAddress`):

- Si `EXPO_PUBLIC_APP_ENV=development` **o** el chainId es 97 → usa `EXPO_PUBLIC_CONTRACT_ADDRESS_TESTNET`
- Si no → usa `EXPO_PUBLIC_CONTRACT_ADDRESS` (mainnet)

Variables típicas (están en `.env`, no se commitean):

- `EXPO_PUBLIC_APP_ENV`
- `EXPO_PUBLIC_CONTRACT_ADDRESS` / `EXPO_PUBLIC_CONTRACT_ADDRESS_TESTNET`
- `USDT_ADDRESS` / `EXPO_PUBLIC_USDT_ADDRESS`
- `USDT_FEED` (oráculo)
- RPCs de BSC / Chapel

**Importante:** el contrato mainnet antiguo (`0xA6Aac9CE…` u otros deploys viejos) puede ser **incompatible** con el ABI actual (fianza quitada, oráculo, timelock). En development hay que usar el QuatriviumCredit recién desplegado en testnet.

---

## 11. Qué puede hacer el admin (on-chain)

Sujeto a timelock + confirmaciones, salvo pausa:

- Pausar (inmediato) / despausar (timelock)
- Añadir o quitar tokens soportados y sus feeds
- Cambiar parámetros de tasa, utilización, cooldown, topes
- Cambiar fee collector / fee BP
- Retirar comisiones

El admin **no** puede:

- Perdonar una deuda concreta desde un botón mágico en la UI (no está cableado)
- Inventar un nivel 101
- Saltar el oráculo
- Quitar el self-register y prestar a una dirección no registrada

---

## 12. Tests automáticos

Hardhat cubre, entre otros:

- Contabilidad (caja + outstanding = liquidez + fees)
- El aporte no se retira (`pool locked`). No hay circuit breaker de retiros al 50 %. La pausa de emergencia es el freno.
- Liquidación de vencidos
- Mora y bloqueo de nuevos préstamos
- Peg / oráculo stale
- Seguridad (reentrancy, pausa, origen EOA)

No sustituyen una prueba manual en el teléfono con WalletConnect.

---

## 13. Limitaciones actuales (honestas)

1. **Sin colateral** = el pool puede perderse por impago / Sybil.
2. **Sin ZK real** en el teléfono.
3. **Un solo préstamo.** El pago se parte en 2, 3, 6 o 12 cuotas según el monto; por debajo de 50 USDT es un solo pago.
4. **Sin liquidación en la UI** (sí en el contrato).
5. **Development** usa USDT mock + feed mock si el USDT/oráculo reales de Chapel no sirven (balance 0 o precio stale).
6. El APK nativo ya instalado puede seguir con el package y scheme anteriores (`com.magnotechnologies.magno`, `exp+magno`) hasta regenerar `android/` con prebuild. `app.json` ahora usa `com.quatrivium.credit` y scheme `quatrivium`.
7. Metro necesita el stub de `snarkjs` o el bundle Android revienta.
8. En Android Studio, Java 25 rompe el plugin de React Native; el build estable usa **JDK 17**.
9. No hay notificaciones push de “tu préstamo vence mañana”.
10. No hay soporte multi-préstamo, ni otras chains, ni off-ramp a fiat dentro de la app.

---

## 14. Glosario corto

| Término | Significado |
|---|---|
| Principal | Lo que te prestan |
| Interés | Extra que devuelves, fijado al pedir |
| Nivel | Tope de monto/plazo que ya desbloqueaste |
| Reputación | Puntos on-chain (arranque 100). Pago a tiempo suma; mora resta (piso 0) |
| Mora | Atraso. Bloquea pedir otro préstamo |
| Cooldown | 48 h de espera entre préstamos |
| Pool / NAV | Caja + deudas vigentes |
| LP | Quien aportó liquidez. El aporte se queda en el pool (`pool locked`) |
| Originación | Crear un préstamo nuevo |
| Utilización | % del pool que está prestado |
| Timelock | Espera de 72 h antes de aplicar un cambio admin |
| Oráculo | Precio USDT/USD (Chainlink o mock) |
| Peg | Que el stable valga ≈ 1 USD (≥ 0,98) |

---

## 15. En una frase

**Quatrivium Finance es una app de microcrédito sin garantía sobre BSC: te registras con tu wallet y pides un préstamo a la vez del pool. El pago se parte según el monto: 2 cuotas desde 50 USDT, 3 desde 60, 6 desde 25 000 y 12 desde 100 000; por debajo de 50 USDT es un solo pago. Si llegas a tiempo subes de nivel; si no, quedas en mora y el pool asume el impago.**
