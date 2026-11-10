# QUATRIVIUM

App de microcrédito descentralizada en Arbitrum One (`chainId` 42161) con LUSD `0x93b346b6BC2548dA6A1E7d98E9a421B42541425b`. La paridad es 1:1. No hay oráculo de precio, ni servidor, ni configuración para el usuario. La billetera se crea en el teléfono. Los avisos son locales.

El alta son 4 LUSD: 1 al fundador, 1 al bote de Reserva, 1 apartado para quien invitó y 1 de sello al pool. De ese sello, el 5 % queda en el fondo de seguro. Sin invitación, o si quien invitó no tiene el alta y el primer nivel pagados, ese 1 apartado entra al pool al pagar el primer nivel 1. Si ese nivel no se paga en 7 días, también entra al pool. No se puede uno invitar a sí mismo. El fundador cobra ese 1 LUSD y el 15 % del interés en la misma transacción. El pool no se puede retirar. Tres admins votan 2 de 3, con 72 h de espera y sin caducidad. La pausa de préstamos nuevos usa esa misma votación, se levanta sola a los 7 días y no puede repetirse hasta pasar otros 7 días. Pagos, liquidaciones y Reserva no se pausan.

Reserva: nivel 10 o más, bloqueo de 30 días, tope del 12 % anual pagado del bote, capital siempre devuelto. El fondo de seguro es el 5 % de lo que entra al pool y solo cubre el premio de un impago. La liquidación espera 48 h más la caída que muestra el feed del sequencer y 1 h después de que vuelve. Una ronda vieja con el sequencer arriba no frena la liquidación. Para cobrar unilevel, padrino, fama o racha hay que tener el alta y el L1 pagados.

Sin Rust y sin pruebas de conocimiento cero. Sin servidor y sin tienda de aplicaciones. El mensaje privado por Nostr está oculto: no hay cifrado NIP-17/44.

El detalle cerrado, el mapa y lo que falta están en `HANDOFF.md`. Hardhat 306, Foundry 51. Credit: 21882 bytes, 2694 libres de 24576.

## Probar

Node 22.

```bash
npm ci --ignore-scripts
npm test
forge test --fuzz-runs 32
npm run typecheck
npm run lint
npm run format:check
```

`npm run typecheck` revisa los 17 idiomas y rechaza servicios que esta app ya no usa. Foundry necesita `lib/forge-std` (no está en git).

## Abierto

- Bajo: una segunda cuenta puede cobrar el LUSD apartado de la primera. Cuesta los otros 3 LUSD más el interés del nivel 1.
- Bajo: `soltarPadrino` no suelta ese LUSD si el padre viniera vacío. El registro normal no hace eso.
- Bajo: algunos tests de dinero todavía leen texto. La lista está en `AUDITORIA.md`.
- Medio: `npm audit` marca `handlebars` en las herramientas, no en la app.
- Medio: el cifrado NIP-17/44 no está implementado.

## Pendiente antes de dinero real

Auditoría externa de los contratos. La billetera del fundador tiene que ser de varias firmas o física, y el despliegue no sigue sin `CONFIRM_FOUNDER_WALLET=yes`.

## Pendiente cuando Jose lo ordene

Nada de esto se ha hecho. El orden es: 1) compilar el APK y calcular su SHA-256, 2) desplegar en Arbitrum One y escribir las direcciones en `constants/deployedAddresses.ts`, 3) publicar la huella del certificado y el hash en `QuatriviumApk`, 4) IPFS, 5) ENS.

La clave que estuvo en el historial (commits `10553d4` y `dc40f15`, archivo `.env.worker.example`) ya fue revocada. El valor no se copia.

## Pendiente de despliegue

Los contratos no están desplegados. En `constants/deployedAddresses.ts` las direcciones de Credit, Reserva, fama y alta siguen vacías.

La dirección de fundador tiene que ser una billetera de varias firmas o una billetera física con respaldo. Si esa llave se pierde, nadie publica hashes ni cobra la parte del fundador. El despliegue lo avisa y no sigue sin `CONFIRM_FOUNDER_WALLET=yes`.

La app compara la huella del certificado con el que está firmada contra la publicada en `QuatriviumApk`. Esa lectura nativa se prueba al compilar el APK. Mientras tanto, cualquier persona puede comparar a mano el hash del archivo descargado con el registro de la red. Si el registro está vacío o la lectura falla, la app dice «versión no verificada».
