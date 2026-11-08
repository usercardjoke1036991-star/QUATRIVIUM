# Checklist Play Store — Quatrivium Finance

## Ya está en el repo (agente, 14 sep 2026)

- [x] Ficha alineada al producto real (`play-store-listing.md`) — 1000 niveles, 24 palabras, sin destruir cuenta
- [x] Privacidad alineada (`privacy-policy.html`) — KYC foto local, correo obligatorio en Real, sin «destruir cuenta»
- [x] Términos alineados (`terms-of-service.html`) — pool locked, alta de 4 USDT, mora con gracia 30 días
- [x] Data safety (`data-safety.md`) — cámara y fotos declaradas
- [x] Servicios financieros (`financial-services-declaration.md`) — tasa plana, no APR inventado
- [x] `feature-graphic.png` 1024×500 y `play-icon-512.png`
- [x] Plantilla `/.well-known/assetlinks.json` (falta tu SHA-256 tras el AAB)
- [x] ProGuard, permisos, EAS production → chain 56

## Tú pagas / tú pulsas (no lo puede hacer el agente)

1. Hospedar HTML en `https://quatriviumcredit.app/privacy-policy` y `/terms` (Cloudflare Pages vale).
2. Cuenta Play Developer — **25 USD**.
3. Deploy mainnet (`CONFIRM_MAINNET=yes`) + USDT al pool + huella en `assetlinks.json`.
4. Twilio / WhatsApp Cloud para OTP Real.
5. Correo real `soporte@quatriviumcredit.app` que responda.
6. `eas build --platform android --profile production` y capturas de **Real vivo** (no Demo, no «Pronto»).
7. Formulario Data safety + 18+ + servicios financieros en Console.
8. Enviar a revisión.

No subas el APK de Expo Dev Client.
