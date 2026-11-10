# QUATRIVIUM

App de microcrédito descentralizada en Arbitrum One (`chainId` 42161) con LUSD `0x93b346b6BC2548dA6A1E7d98E9a421B42541425b`. La paridad es 1:1. No hay oráculo de precio, ni servidor, ni configuración para el usuario. La billetera se crea en el teléfono. Los avisos son locales.

El alta son 4 LUSD: 1 al fundador, 1 al bote de Reserva, 1 al padrino y 1 de sello al pool. El fundador cobra ese 1 LUSD y el 15 % del interés en la misma transacción. El pool no se puede retirar. Tres admins votan 2 de 3, con 72 h de espera, solo para entrar o salir. Su pausa de emergencia frena préstamos nuevos y se levanta sola a los 7 días.

Reserva: nivel 10 o más, bloqueo de 30 días, tope del 12 % anual pagado del bote, capital siempre devuelto. El fondo de seguro es el 5 % de lo que entra al pool y solo cubre el premio de un impago. La liquidación espera 48 h más el tiempo caído del sequencer de Arbitrum. Para cobrar unilevel, padrino, fama o racha hay que tener el alta y el L1 pagados.

El detalle cerrado, el mapa y lo que falta están en `HANDOFF.md`.

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

## Pendiente de despliegue

Los contratos no están desplegados. En `constants/deployedAddresses.ts` las direcciones de Credit, Reserva, fama y alta siguen vacías. El APK firmado, su hash on-chain, IPFS y ENS esperan una orden explícita. No forman parte de `npm test`.
