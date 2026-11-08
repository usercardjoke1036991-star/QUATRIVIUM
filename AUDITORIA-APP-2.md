# Auditoría 2 de Quatrivium Finance

Fecha: 2026-10-10. Los dos medios y el bajo de abajo quedaron aplicados: la sala Admin ya no abre vacía, el retiro pendiente se conserva si el nodo falla, y las cuatro pruebas miran el código actual. No se tocaron contratos ni el worker.

No se vuelven a contar los arreglos de `AUDITORIA-APP.md`: capacidad de protocolo, fama, padrino y el aviso de Reserva. Siguen en el código (`isUnreadRpc`, `caps-unread`, `reservaPreviewFailed`, trozos de 4000 bloques).

## Fase 1 — Sintaxis y tipos

`npx tsc --noEmit` terminó con código 0.

### BAJ-01 — Cuatro pruebas miran texto que la pantalla ya no usa

- Gravedad: bajo
- Tipo: sintaxis
- Dónde: `test/cyber-hardening.test.js` líneas 786, 2001, 2016 y 2080
- Qué hace ahora: la suite falla en cuatro aserciones. La pantalla no está rota; el test busca una frase o una variable vieja.
  - Línea 786 exige `pendingLead` en `components/CreditAccessBanner.tsx`. El aviso de alta elige `creditAccessGateLead`, `creditAccessAlreadyInWallet`, `creditAccessPending` o `liveCreditNotReady` (líneas 53-60). El español dice «Un único pago de 4 USDT».
  - Línea 2001 exige `adminInfo.isOwner || adminInfo.isAdmin` en `app/index.tsx`. La baldosa usa `adminSeat` (líneas 168-176 y 498-499) y la sala se cierra si ese asiento no está (líneas 284-287).
  - Línea 2016 exige que `linkWalletNeedFunds` contenga «externa». El texto actual es «Vincule una billetera para mover fondos.»
  - Línea 2080 exige el literal `t('linkWalletBind')`. `components/LinkedWalletCard.tsx` líneas 79 y 112 usan `t(boundLabel)`, y `boundLabel` vale `linkWalletBind` cuando no hay vínculo.
- Qué debería hacer: actualizar esas cuatro aserciones al código actual, sin cambiar la regla de 4 USDT ni el candado de Admin.
- Decisión de contexto: no. El alta de 4 USDT y el panel solo para fundadora siguen siendo la regla.
- Corrección propuesta: reescribir las cuatro expectativas. No cambiar las pantallas por estas líneas.

No hay error de compilación ni import roto en el typecheck. No se recorrió a mano cada `useEffect`.

## Fase 2 — Lógica

### MED-01 — La sala Admin se abre y el cuerpo queda vacío

- Gravedad: medio
- Tipo: lógica y visual
- Dónde: `app/index.tsx` líneas 168-176, 498-499 y 988-990; `components/AdminPanel.tsx` línea 122; `hooks/useHomeHandlers.ts` líneas 193-197
- Qué hace ahora: la baldosa Admin aparece si la billetera de la app es fundadora, aunque WalletConnect no esté conectado (`adminSeatOpen` acepta `userInfo.isOwner` o `founder`). Al abrirla, el panel recibe solo `adminInfo.isOwner` y `adminInfo.isAdmin`, que salen de la billetera externa. Si esa lectura es falsa, `AdminPanel` hace `return null`. La ventana muestra el título y ningún control. `runAsAdmin` sí puede firmar con la billetera de la app cuando esa billetera es el asiento.
- Qué debería hacer: o pintar los controles con el mismo asiento que abrió la baldosa, o no abrir la sala y mostrar que falta conectar la billetera fundadora. No dejar el título solo.
- Decisión de contexto: el panel de gobierno es de la fundadora. No es un permiso nuevo. El fallo es que la sala se anuncia y luego no tiene cuerpo.
- Corrección propuesta: pasar a `AdminPanel` el mismo criterio que `adminSeat`, o sustituir el `return null` por el texto `appWalletAdminConnect` cuando el asiento es la billetera interna y la externa aún no firmó.

### MED-02 — Si falla la lectura, el retiro pendiente de Reserva desaparece

- Gravedad: medio
- Tipo: lógica
- Dónde: `components/AdminPanel.tsx` líneas 118-120. La lectura está en `services/reservaService.ts` líneas 231-249.
- Qué hace ahora: `leerPendienteRetiroBote` devuelve `null` cuando no hay retiro, y lanza si el nodo no responde. El `catch` hace `setRetiroPendiente(null)`. Un fallo de red se ve igual que «no hay retiro de la provisión». La espera de 72 horas deja de mostrarse.
- Qué debería hacer: si la llamada lanza, conservar el retiro ya leído. `null` solo cuando el contrato respondió que no hay propuesta.
- Decisión de contexto: no. El retiro de la provisión sigue exigiendo guardianes y 72 horas. La salud del bote, justo arriba, sí conserva la cifra anterior (líneas 112-114). Esta lectura no.
- Corrección propuesta: en el `catch`, no poner el estado en `null` si ya había una fila. Mostrar un aviso de lectura fallida.

El resto de los flujos pedidos (frase, alta de 4 USDT, un préstamo, Demo distinto de Real, fama por vía, Reserva desde el nivel 10, quorum de 2, tope de espera de referidos) no produjo otro fallo demostrable en esta pasada. El doble toque de las acciones de inicio sigue entrando por `runAsAdmin` y el indicador `txLoading`.

## Fase 3 — Vulnerabilidades

Revisión estática, sin explotar nada. No hay un hallazgo nuevo con archivo, línea y efecto demostrable.

- No apareció una clave privada de owner o attester en el cliente.
- El enlace profundo a `admin` se ignora (`app/index.tsx` línea 101).
- `/auto-fund` del worker sigue rechazando mainnet y exigiendo firma. No se releyó el worker entero ni los cuatro contratos instrucción por instrucción.
- No se propone borrar `cobrarBonoHito`, `_assertPeg` ni `_pagarBonosRed`.

## Fase 4 — Visual

No se abrió la app en el teléfono ni en un emulador. No se inventa un texto cortado.

Lo que el código obliga: MED-01. La sala Admin puede quedar en título sin controles. El teclado de las ventanas modales sigue en `AppWindow`. El de la pantalla de bloqueo sigue en `KeyboardAvoidingView`. Árabe y urdu siguen forzando RTL y pidiendo reinicio; no se recorrió cada tarjeta en ese modo.

## Fase 5 — Traducciones

17 locales contra `es.json`.

| Comprobación | Resultado |
| --- | --- |
| Claves en español | 1245 |
| Claves que faltan | 0 |
| Claves de más | 0 |
| Cadenas vacías | 0 |
| Interpolaciones distintas | 0 |
| `reservaPreviewFailed` en los 17 | sí |

`creditAccessGateLead` dice el alta única de 4 USDT. `adminTwoOfThree` sigue en quorum de 2. `reservaApyNow` solo se pinta con la tasa ya leída. Canje separa caja y red; la racha no tiene botón de cobro ahí. No hay hallazgo de traducción.

## Lo que no se revisó entero

- Cada pantalla en un dispositivo.
- Cada `useEffect` a mano.
- Los contratos Solidity, instrucción por instrucción.
- El worker, más allá del candado de las rutas ya citadas en la auditoría anterior.

## Cierre

| Gravedad | Cantidad |
| --- | --- |
| Crítico | 0 |
| Alto | 0 |
| Medio | 2 |
| Bajo | 1 |

| Tipo | Cantidad |
| --- | --- |
| Sintaxis | 1 (BAJ-01, el test) |
| Lógica | 2 |
| Vulnerabilidad | 0 |
| Visual | 1 (el mismo MED-01) |
| Traducción | 0 |

Los tres arreglos que más cambian lo que se ve:

1. La sala Admin no debe abrirse vacía (MED-01).
2. El retiro pendiente de Reserva no debe borrarse si el nodo no responde (MED-02).
3. Actualizar las cuatro pruebas viejas para que un fallo real no se mezcle con ellas (BAJ-01).

La app no queda declarada sana: no hubo pase visual en el teléfono ni lectura completa de los contratos.
