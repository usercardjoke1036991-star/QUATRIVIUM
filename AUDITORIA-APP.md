# Auditoría de la app Quatrivium Finance

Fecha: 2026-10-10. Alcance: código en este PC. Los cuatro hallazgos de abajo quedaron aplicados en la app. No se tocaron contratos, worker ni APK. Un fallo solo entra aquí si hay archivo, líneas y un comportamiento demostrable. Lo que CONTEXTO.md o MEMORIA.md ya decidieron no se cuenta como bug.

## Aplicado

- ALT-01: un nodo callado ya no se guarda como protocolo de 100 niveles. Solo un `CALL_EXCEPTION` cuenta como “eso no está”.
- ALT-02: fama y racha no se pisan con ceros si la lectura no responde.
- ALT-03: padrino, bono y comisiones congeladas conservan el valor anterior si la red genealógica falla.
- ALT-04: Reserva ya no dice “no desplegada” mientras carga o si el nodo falla. Muestra `reservaPreviewFailed` y deja la última cifra.

## Fase 1 — Sintaxis y tipos

`npx tsc --noEmit` terminó con código 0. No hay error de compilación en el árbol actual.

No aparecieron imports rotos en el typecheck. No se recorrió a mano cada `useEffect` de los 61 componentes: el compilador no detecta un array de dependencias incompleto.

## Fase 2 — Lógica

### ALT-01 — Una lectura fallida deja la escalera en 100 niveles y la guarda

- Gravedad: alto
- Tipo: lógica
- Dónde: `services/quatriviumCreditService.ts` líneas 289-336 y `hooks/useWeb3Balances.ts` líneas 442-463
- Qué hace ahora: `detectarCapacidadProtocolo` pregunta `niveles(101)`. Si esa llamada falla, pone `maxLevel` en `CORE_LOAN_LEVEL` (100). Lo mismo pasa con donar, hitos, racha y verificación: el `catch` los deja en falso. El resultado se guarda en `capsCache`. La pantalla aplica ese resultado y no conserva el anterior. Si falla el probe entero, el `catch` de `useWeb3Balances` hace lo mismo de golpe: nivel máximo 100 y salas apagadas.
- Qué debería hacer: un fallo de red no es “el protocolo solo tiene 100 niveles”. Hay que conservar la capacidad ya leída y no cachear un resultado nacido de un error.
- Decisión de contexto: no. La escalera de 1000 niveles está desplegada.
- Corrección propuesta: distinguir “el contrato no tiene el nivel 101” de “el nodo no respondió”. Solo cachear cuando las lecturas respondieron. En el hook, si el probe lanza, no pisar `maxLoanLevel`, `canDonate`, `canCanjearFama` ni `canRacha`.

### ALT-02 — Fama y racha pasan a 0 si la lectura no responde

- Gravedad: medio
- Tipo: lógica
- Dónde: `services/quatriviumCreditService.ts` líneas 567-638 y `hooks/useWeb3Balances.ts` líneas 665-679
- Qué hace ahora: `obtenerFama` y `obtenerRacha`, si fallan, devuelven ceros. Las lecturas sueltas de fama de red, racha y perfil hacen `.catch(() => 0n)`. El hook escribe esos ceros encima de la cifra que ya estaba en pantalla. Canje y Racha quedan como si no hubiera puntos.
- Qué debería hacer: si el nodo no responde, conservar la fama y la racha anteriores. Un cero solo cuando el contrato respondió que el saldo es cero.
- Decisión de contexto: choca con la regla ya tomada de no poner una cifra en 0 cuando la lectura falla (crédito pendiente, bote, tasa).
- Corrección propuesta: devolver un resultado “no leído” en vez del objeto vacío, y en el hook no llamar a `setUserInfo` con ceros en ese caso. Quitar el `.catch(() => 0n)` de las vías que sí existen en el contrato desplegado.

### ALT-03 — Si falla la red genealógica, el padrino y el bono desaparecen

- Gravedad: medio
- Tipo: lógica
- Dónde: `hooks/useWeb3Balances.ts` líneas 896-925
- Qué hace ahora: si `redGenealogica` lanza, `padre` queda en `''` y `bonoActivacionCobrado` sigue en `false`. Esos valores pisan el estado anterior. La pantalla puede mostrar que no hay padrino y que el bono de 1 USDT no se cobró, aunque la lectura anterior dijera lo contrario. `dispersionCongelada`, si falla, deja las comisiones como no congeladas.
- Qué debería hacer: conservar `referral` anterior cuando esas llamadas no respondan.
- Decisión de contexto: no. El bono de activación y el padrino son datos de cadena, no un valor por defecto.
- Corrección propuesta: en cada `catch`, no asignar el vacío. Armar el objeto `referral` solo con los campos que sí respondieron.

### ALT-04 — Reserva, al fallar o mientras carga, dice que no está desplegada

- Gravedad: medio
- Tipo: lógica y visual
- Dónde: `components/ReservaSection.tsx` líneas 56-66 y 196-198. Texto: `i18n/locales/es.json` clave `reservaNoContract` (“Reserva en red aún no está desplegada.”)
- Qué hace ahora: `preview` empieza en `null`. El aviso se pinta en cuanto `preview` no tiene contrato, y eso incluye la carga y el `.catch(() => setPreview(null))`. Una posición ya leída se borra. El usuario ve “no está desplegada” con Reserva sí desplegada en chain 56, o durante los segundos de espera.
- Qué debería hacer: mientras carga, mostrar el indicador. Si la lectura falla, conservar la última provisión y la posición, y decir que no se pudo leer.
- Decisión de contexto: no. Reserva en Real está desplegada. La regla de conservar la cifra anterior aplica al bote.
- Corrección propuesta: un estado `reading` distinto de `missing`. En el `catch`, no poner `preview` en `null` si ya había una lectura buena. Mostrar `reservaNoContract` solo cuando `configured` respondió falso.

## Fase 3 — Vulnerabilidades

Revisión estática, sin explotar nada.

- No hay una clave privada de 64 hex en el código de la app. `PRIVATE_KEY` y `ATTESTER_PRIVATE_KEY` salen del entorno del worker y de Hardhat, no del cliente.
- El sobre de Cuenta Real sigue fuera de AsyncStorage. AsyncStorage aparece en modo de app, tema, idioma, invitación pendiente y sesión de AppKit. Eso coincide con las decisiones ya tomadas.
- No se auditó línea a línea reentrancy, quorum ni EIP-170 de los cuatro contratos en esta pasada. No se propone borrar `cobrarBonoHito`, `_assertPeg` ni `_pagarBonosRed`.

No hay hallazgo de vulnerabilidad con evidencia suficiente para entrar en la tabla.

## Fase 4 — Visual

No se abrió la app en un teléfono ni en un emulador. Lo visual de esta fase es lo que el código obliga.

- ALT-04 es el fallo visual demostrado: el aviso de “no desplegada” aparece antes de saber si el contrato respondió.
- `components/AppWindow.tsx` aparta el campo del teclado dentro de las ventanas modales. `components/AppLockGate.tsx` usa `KeyboardAvoidingView`. No se demostró un botón tapado fuera de esas dos piezas.
- `theme/androidText.ts` en Android quita `fontWeight`, cursiva, sombras y `textTransform`. El comentario lo explica como arreglo de letra doble en Xiaomi. Es decisión, no bug.
- `components/AppText.tsx` líneas 14-18 fijan `allowFontScaling={false}` y `maxFontSizeMultiplier={1}`. El texto no crece con el tamaño del sistema. Puede ser a propósito para que las tarjetas no se rompan. No se cuenta como bug hasta ver un recorte real.

Árabe y urdu: `i18n/LanguageContext.tsx` fuerza RTL y avisa que hace falta reiniciar (`rtlNeedsRestart`). No se recorrió cada tarjeta en RTL.

## Fase 5 — Traducciones

Comparación de las 17 locales contra `es.json` (ar, bn, de, en, es, fr, hi, id, it, ja, ko, pt, ru, tr, ur, vi, zh).

| Comprobación | Resultado |
| --- | --- |
| Claves en español | 1244 |
| Claves que faltan en algún idioma | 0 |
| Claves de más | 0 |
| Cadenas vacías | 0 |
| Interpolaciones `{nombre}` distintas del español | 0 |
| Frases inglesas copiadas en ja, ar, zh, ko, hi, bn, ur o ru | 0 |
| Palabras sueltas en español dentro de ar, zh, ja, ko, hi, bn, ur o ru | 0 |

Portugués coincide con el español en cadenas cortas que también son portugués válido (`Código`, `Página {page} de {pages}`, `Reenviar código`). No es una traducción pendiente.

`adminTwoOfThree` dice “2 fundadoras. 2 firmas… no hay una tercera”. Coincide con la decisión vigente de quorum 2-de-2. El 2-de-3 del contexto es el diseño cuando exista la tercera fundadora. No es un fallo de texto.

`reservaApyNow` (“Hasta 12%. Ahora {apy}%.”) solo se pinta si `apyKnown` es verdadero (`ReservaSection.tsx` líneas 167-170). No muestra 12 % como tasa actual sin lectura.

No hay hallazgo de traducción que entre en la tabla.

## Lo que no se revisó entero

- Cada pantalla en un dispositivo (inicio, alta, crédito, pagar, historial, referidos, fama, donar, ajustes, KYC, admin, bloqueo).
- Cada `useEffect` a mano.
- Los contratos Solidity, instrucción por instrucción.
- El worker, más allá de las rutas y el candado de firma citados arriba.
- El APK instalado en el Xiaomi. Este informe es del código de este PC.

## Cierre

| Gravedad | Cantidad |
| --- | --- |
| Crítico | 0 |
| Alto | 1 |
| Medio | 3 |
| Bajo | 0 |

| Tipo | Cantidad |
| --- | --- |
| Sintaxis | 0 |
| Lógica | 4 (ALT-04 también es visual) |
| Vulnerabilidad | 0 |
| Visual | 1 (el mismo ALT-04) |
| Traducción | 0 |

Los tres arreglos que más cambian lo que ve el usuario:

1. No tratar un nodo callado como “solo hay 100 niveles” y no guardar esa respuesta (ALT-01).
2. No poner fama y racha en 0 cuando la lectura falla (ALT-02).
3. No decir que Reserva no está desplegada mientras carga o cuando el nodo falla (ALT-04).

La app no queda declarada sana: la fase visual en dispositivo y la lectura completa de los contratos no se ejecutaron.
