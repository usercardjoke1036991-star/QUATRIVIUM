# Digital Asset Links

La app declara `autoVerify` para `https://quatriviumcredit.app/invite` (y `/history`, `/room`).
Sin este archivo en el dominio, Android no abre esos enlaces en la app.

## Qué subir

Copia `store-assets/.well-known/assetlinks.json` a:

```
https://quatriviumcredit.app/.well-known/assetlinks.json
```

HTTPS, `Content-Type: application/json`, **sin** redirección HTTP→HTTPS rota y sin auth.

## Huella SHA-256

La huella del APK de producción (certificado EAS, no el keystore local) ya está en el JSON:

`DF:EF:CC:D0:00:39:72:5E:B7:3A:A6:7D:B0:E7:7E:91:0A:E7:46:4D:EE:8D:F2:74:86:54:E2:1D:A7:3E:D2:4A`

El mismo archivo está en `web/.well-known/assetlinks.json`. El apex y `www` tienen que responder 200, sin redirección. Si Play firma la app con otro certificado, añade esa huella al mismo arreglo.
