# Data safety — Google Play Console

Ruta: Play Console → Política de la app → Seguridad de los datos.

Declara **cámara y fotos**. Si marcas que no las usas, Google compara con el manifiesto (`CAMERA`, `READ_MEDIA_IMAGES`) y te tumba la ficha.

## Recopilación

| Dato | Recopila | Uso principal | Opcional | Cifrado en tránsito | Usuarios pueden pedir borrado |
|---|---|---|---|---|---|
| Correo | Sí | Cuenta, avisos | No en Real | Sí (HTTPS) | Sí, en el servidor de avisos |
| Teléfono | Sí | OTP, atar línea Real | No en Real | Sí | Sí, en el servidor de avisos |
| Fotos | Sí | KYC local y perfil | KYC no en Demo | N/A (local) | Borrar la app / fotos del teléfono |
| Cámara | Sí | Escanear documento | KYC no en Demo | N/A (local) | Igual |
| Info financiera | Sí | Préstamos USDT on-chain | No | Cadena pública | No (blockchain) |
| ID de dispositivo | Sí | Hash de atado Real | No en Real | Sí hacia worker / cadena | No el hash ya on-chain |
| Clave privada / frase 24 | **No** (solo en el teléfono) | — | — | — | — |
| Contactos | **No** | — | — | — | — |
| Ubicación | **No** | — | — | — | — |

## Compartido con terceros

| Destino | Qué | Motivo |
|---|---|---|
| Twilio / WhatsApp Cloud | Número | Enviar OTP |
| Resend | Correo | Códigos y avisos |
| Validadores BSC | Direcciones y txs | El protocolo |
| Reown / WalletConnect | Dirección externa si el usuario conecta | Firmar depósitos, donar, pool, acceso |

No hay venta de datos ni publicidad.

## Preguntas frecuentes del formulario

- ¿Los datos se cifran en tránsito? **Sí** (HTTPS). La cadena BSC es pública por diseño.
- ¿Los usuarios pueden pedir que se borren? **Parcial:** correo/teléfono del worker sí; historial on-chain no.
- ¿Cumple Families Policy? **No aplica** — 18+.
- ¿Es una app de deuda que lee contactos? **No.**

## Permisos del manifiesto (justificación)

- `CAMERA` — foto del documento para KYC.
- `READ_MEDIA_IMAGES` — galería de perfil y documento.
- `USE_BIOMETRIC` / `USE_FINGERPRINT` — desbloqueo local.
- `RECEIVE_BOOT_COMPLETED` / `VIBRATE` — avisos de vencimiento.
