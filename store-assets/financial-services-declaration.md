# Guía: Servicios financieros — Google Play Console

Ruta: Política de la app → Contenido de la app → Servicios financieros.

La app **no es un banco**. Si Google solo deja «préstamos personales» como casilla, rellena con honestidad y adjunta estos términos. Las tasas de Quatrivium son **planas sobre el principal durante el plazo**, no un APR de tarjeta.

Marcar APR 40–100 % como si fuera anual **era un error** de la guía anterior (esas cifras eran la tasa del plazo del nivel 1–10 antiguo).

---

## Pregunta 1: ¿Ofrece servicios financieros?

**Sí.**

## Pregunta 2: ¿Préstamos o créditos?

**Sí** — microcrédito on-chain en USDT, sin colateral, ejecutado por contrato en BSC.

### Si pide ficha de préstamo personal

| Campo | Qué poner | Nota |
|---|---|---|
| ¿Préstamos personales? | Sí, con matiz DeFi (no licencia bancaria) | Riesgo alto de rechazo en IN / US si lo presentas como neobank |
| Tasa | **Tasa plana del plazo**, no APR | Nivel 1: 100 % en 7 días. Nivel 1000: 4,06 % en 180 días |
| Si Google obliga APR anualizado | Nivel 1 ≈ muy alto; nivel 100 ≈ ~32 %; nivel 1000 ≈ ~8 % | No redondees el nivel 1 a «100 % APR» |
| Plazo mínimo | 7 días | Nivel 1 |
| Plazo máximo | 180 días | Nivel 1000 |
| ¿Contactos para cobrar? | **No** | |
| ¿Fotos para aprobar? | **Sí** — KYC: foto local del documento, sin OCR ni subida a servidor | Antes decía No; el manifiesto tiene cámara |
| ¿Ubicación para aprobar? | **No** | |
| Privacidad | `https://quatriviumcredit.app/privacy-policy` | |
| Términos | `https://quatriviumcredit.app/terms` | |

En comentarios libres, pega:

```
Quatrivium Finance is a non-custodial DeFi interface. Loans are USDT on BNB Smart Chain.
Fees are a flat rate on principal for the listed term, shown in-app before signing.
Not a bank. No fiat on-ramp. No contact-list collections. 18+.
Camera is used only for a local ID photo (KYC); the image is not uploaded.
Liquidity providers cannot withdraw (pool locked). Blockchain txs are irreversible.
```

## Pregunta 3: ¿Criptomonedas?

**Sí.**

- No es un exchange.
- No compra ni vende cripto por dinero fiat dentro de Play.
- USDT es el medio de préstamo, acceso, donar y pool.
- Wallet interna (24 palabras) + wallet externa WalletConnect.

## Lo que Google mira y ya cumple el código

- APR/coste visible en tarjetas de nivel antes de firmar.
- Sin contactos.
- Sin ubicación.
- Mora on-chain, no acoso.
- 18+ en ficha y política.

## Lo que te puede tumbar

- Ficha que diga «10 niveles hasta 100 USDT» (eso ya no es el producto).
- Decir que no usas cámara teniendo `CAMERA` en el manifiesto.
- Prometer auditoría bancaria o «nadie puede pausar el protocolo».
- Subir un AAB de Demo / dev-client.
- Distribuir en países con prohibición cripto sin excluirlos (p. ej. CN).

## Tras el deploy mainnet

1. Verificar el contrato en BscScan.
2. Pegar la URL en Play y en los términos.
3. No envíes revisión con contrato `0x000…000`.
