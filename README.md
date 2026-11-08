# Quatrivium Finance


<!-- AUTO-README:START -->

## Quatrivium Finance

**Quatrivium Finance** es una app móvil de microcrédito on-chain sin colateral sobre BNB Smart Chain (BSC). El usuario activa una wallet interna, pide un préstamo en USDT del pool de liquidez, lo paga antes del vencimiento y sube de nivel para pedir montos mayores. Si no paga, entra en mora y queda bloqueado hasta regularizar. **No puede cerrar la cuenta mientras tenga deuda o esté en mora.**

- **Tipo de proyecto:** `node` (detectado automáticamente)
- **Estado:** Mainnet BSC (chain 56) desplegado y en el APK de producción 1.0.2, código 12, paquete `com.quatrivium.credit`. Demo es BSC testnet (chain 97). No redesplegar.
- **Tests detectados:** 47 archivo(s)

### Qué funciona
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

### En progreso
- Publicar en Google Play Store. Hoy el APK se instala aparte; las actualizaciones OTA siguen apagadas
- Añadir un segundo guardián de la reserva. Hoy la misma billetera fundadora propone el retiro del bote y, pasadas 72 horas, lo confirma
- Tener un servidor de avisos de respaldo antes del mantenimiento del 13 de octubre de 2026. El aviso vivo sigue en `https://notify.quatriviumcredit.app`
- Republicar ese worker para que el apodo público coincida con el código del repositorio

### Módulos
- Pantalla home — `app/index.tsx`
- Layout Expo — `app/_layout.tsx`
- Tooling RN — `babel.config.js` · `metro.config.js`
- Contratos JS — `hardhat.config.cjs`
- ZK stub — `zkService.ts`
- Handlers — `hooks/useHomeHandlers.ts`
- Estado on-chain — `hooks/useWeb3Balances.ts`
- Transacciones — `hooks/useWeb3Transactions.ts`
- Servicio contrato — `services/quatriviumCreditService.ts`
- Identidad demo — `services/demoIdentity.ts` + worker `/demo-identity`
- Wallet interna — `services/appWallet.ts`
- KYC local — `services/kycDeclaration.ts`
- Lock — `services/appLock.ts` + `authPrefs.ts` + `authenticator.ts`
- Historial — `services/movementHistory.ts` + `MovementHistory.tsx`
- Storage seguro — `services/secureStorageService.ts`

### Funciones reales (código)
- `actualizar_contexto.py`
  - `cmd_mostrar()`
  - `cmd_actualizar_estado()`
  - `cmd_agregar_cambio()`
  - `cmd_init()`
  - `main()`
- `actualizar_readme.py`
  - `class InfoReadme`
  - `detectar_tipo_proyecto()`
  - `iterar_fuentes()`
  - `extraer_simbolos_python()`
  - `extraer_exports_js()`
  - `extraer_handlers_mql()`
  - `extraer_tipos_android()`
  - `extraer_simbolos_archivo()`
  - `analizar_codigo()`
  - `detectar_comandos()`
  - `detectar_herramientas_qa()`
  - `recolectar_info()`
- `App.js`
  - `App()`
- `aprender_error.py`
  - `cargar_errores()`
  - `guardar_errores()`
  - `generar_id()`
  - `validar_tipos()`
  - `validar_severidad()`
  - `validar_patron_regex()`
  - `modo_interactivo()`
  - `registrar_error()`
  - `mostrar_confirmacion()`
  - `main()`
- `detectar_lenguaje.py`
  - `hay_ext_cercana()`
  - `formatear_simbolo()`
  - `lenguaje_de_archivo()`
  - `detectar_tipo_lenguaje()`
  - `extraer_simbolos_etiquetados()`
  - `extraer_simbolos()`
  - `extraer_simbolos_formateados()`
  - `analizar_ruta()`
  - `imprimir_reporte()`
  - `main()`
- `detectar_logica.py`
  - `class ProblemaLogica`
  - `detectar_division_por_cero()`
  - `detectar_none_sin_verificar()`
  - `detectar_bucle_infinito()`
  - `detectar_modificacion_en_iteracion()`
  - `detectar_return_en_bucle_acumulador()`
  - `detectar_comparacion_con_asignacion()`
  - `detectar_logica_trading_invertida()`
  - `detectar_volumen_cero()`
  - `detectar_operacion_sin_verificar_spread()`
  - `detectar_magic_number_cero()`
  - `detectar_mutacion_estado_react()`
- `hardhat.config.cjs`
  - `accountsFromEnv()`
- `io_utf8.py`
  - `run_utf8()`
- `mapa_proyecto.py`
  - `detectar_tipo_proyecto()`
  - `extraer_simbolos()`
  - `inventariar_partes()`
  - `comprobar_al_dia()`
  - `comprobar_conexion()`
  - `escribir_mapa_md()`
  - `mapa_proyecto()`
  - `imprimir_reporte()`
  - `main()`
- `memoria_proyecto.py`
  - `class MemoriaProyecto`
  - `resolver_directorio()`
  - `ruta_memoria_md()`
  - `ruta_memoria_json()`
  - `leer_memoria()`
  - `renderizar_memoria()`
  - `escribir_memoria()`
  - `cmd_init()`
  - `cmd_cambio()`
  - `cmd_decision()`
  - `cmd_enfoque()`
  - `cmd_mostrar()`
- `polyfills.js`
  - `class AbortController`
  - `class AbortSignal`
  - `class URL`
  - `class URLSearchParams`
- `qa_autonomo.py`
  - `class ResultadoQA`
  - `class ReporteQA`
  - `detectar_tipo_proyecto()`
  - `verificar_python()`
  - `verificar_mql5()`
  - `verificar_nodejs()`
  - `verificar_android()`
  - `verificar_rust()`
  - `verificar_go()`
  - `verificar_ci()`
  - `verificar_readme()`
  - `verificar_errores_aprendidos()`
- `qa_safe_io.py`
  - `confine()`
  - `confine_read()`
  - `confine_write()`
  - `write_under()`
  - `under_root()`
  - `resto_bullet_estado()`
- `reestructurar_peticion.py`
  - `resolver_directorio()`
  - `normalizar()`
  - `detectar_intencion()`
  - `detectar_tipo_proyecto()`
  - `habla_espanol()`
  - `leer_contexto_una_linea()`
  - `inferir_alcance()`
  - `sugerir_herramientas()`
  - `inferir_entregable()`
  - `reformular_objetivo()`
  - `construir_restricciones()`
  - `construir_prompt_agente()`
- `run_tests.py`
  - `class ResultadoTests`
  - `detectar_tipo_proyecto()`
  - `ejecutar_tests_python()`
  - `ejecutar_tests_node()`
  - `ejecutar_tests_android()`
  - `ejecutar_tests_mql5()`
  - `ejecutar_tests_proyecto()`
  - `detectar_subproyectos()`
  - `imprimir_reporte()`
  - `main()`
- `salud_proyecto.py`
  - `class Hallazgo`
  - `class ReporteSalud`
  - `verificar_identidad()`
  - `verificar_archivos()`
  - `verificar_simbolos()`
  - `verificar_decisiones()`
  - `verificar_comando()`
  - `verificar_herramientas()`
  - `ejecutar_salud()`
  - `imprimir_reporte()`
  - `main()`
- `verificar_conectores.py`
  - `detectar_imports_rotos()`
  - `detectar_llamadas_sin_definicion()`
  - `detectar_imports_js_rotos()`
  - `detectar_handlers_jsx_sin_definir()`
  - `detectar_rutas_api_js()`
  - `detectar_conectores_mql()`
  - `verificar_conectores()`
  - `imprimir_reporte()`
  - `main()`
- `verificar_modulos.py`
  - `detectar_tipo_proyecto()`
  - `detectar_modulos_documentados_ausentes()`
  - `detectar_imports_relativos_rotos()`
  - `detectar_submodulos_paquete_ausentes()`
  - `detectar_init_faltante()`
  - `detectar_docstring_modulo_faltante()`
  - `detectar_ciclos_simples()`
  - `detectar_includes_mql_ausentes()`
  - `detectar_exports_index_rotos()`
  - `detectar_modales_ui()`
  - `verificar_modulos()`
  - `imprimir_reporte()`
- `vision_proyecto.py`
  - `class VisionProyecto`
  - `detectar_tipo_proyecto()`
  - `analizar_modulos_existentes()`
  - `leer_vision()`
  - `escribir_vision()`
  - `cmd_init()`
  - `cmd_agregar_idea()`
  - `cmd_actualizar()`
  - `cmd_mostrar()`
  - `cmd_completar_modulo()`
  - `cmd_json()`
  - `main()`
- `web3Config.tsx`
  - `syncAppKitNetwork()`
  - `Web3Provider()`
  - `toEthersWeb3Provider()`
  - `getEthersSignerFromProvider()`
  - `web3ConfigDebug()`

### Cómo usarlo

```powershell
npm run start
npm run android
npm run ios
npm run audit
npm run audit:fix
npm run test
npm run test:forge
npm run test:coverage
npm run typecheck
npm run compile
npm run security:check
npm run security:slither
npm run security:mobsf
npm run security:mobsf:purge
npm run security:trivy
npm run security:snyk
npm run security:snyk:code
npm run security:sonar
npm run deploy:bsc
npm run deploy:testnet
npm run deploy:testnet:nuevo
npm run deploy:reserva
npm run notify
npm run notify:prod
npm run notify:sms
npm run notify:deploy
npm run notify:hetzner
npm run tunnel
npm run tunnel:ngrok
npm run production:check
npm run production:prepare
npm run salud
npm run salud:watch
npm run salud:tests
python qa_autonomo.py
python actualizar_contexto.py --mostrar
python vision_proyecto.py --mostrar
python actualizar_readme.py
```

### Herramientas QA

| Script | Uso | Descripción |
|--------|-----|-------------|
| `qa_autonomo.py` | `python qa_autonomo.py` | Auditoría QA del proyecto |
| `aprender_error.py` | `python aprender_error.py --lista` | Memoria de errores (ERR-XXX) |
| `actualizar_contexto.py` | `python actualizar_contexto.py --mostrar` | Gestiona CONTEXTO.md |
| `vision_proyecto.py` | `python vision_proyecto.py --mostrar` | Gestiona VISION.md |
| `verificar_conectores.py` | `python verificar_conectores.py` | Detecta conectores sueltos (ERR-008) |
| `detectar_logica.py` | `python detectar_logica.py` | Detecta errores de lógica (ERR-009..012) |
| `verificar_modulos.py` | `python verificar_modulos.py` | Verifica módulos documentados y modales UI |
| `mapa_proyecto.py` | `python mapa_proyecto.py --actualizar` | Cerebro del proyecto activo: piezas, docs vs código y conexión (MAPA.md) |
| `detectar_lenguaje.py` | `python detectar_lenguaje.py [ruta]` | Lenguaje adaptativo: detecta tipo y extrae símbolos multi-lenguaje |
| `run_tests.py` | `python run_tests.py` | Ejecuta tests según el tipo de proyecto |
| `actualizar_readme.py` | `python actualizar_readme.py` | Actualiza este README con el estado real |
| `memoria_proyecto.py` | `python memoria_proyecto.py --mostrar` | Memoria de sesión (MEMORIA.md) |
| `reestructurar_peticion.py` | `python reestructurar_peticion.py "texto"` | Reestructura una petición informal en prompt profesional |

_Actualizado automáticamente el 2026-10-10 por `actualizar_readme.py`. El texto fuera de estos marcadores no se toca._

<!-- AUTO-README:END -->

Quatrivium Finance es crédito on-chain **sin colateral** en BNB Smart Chain. Pides un préstamo en USDT, lo pagas dentro del plazo y subes de nivel para pedir más.

## Hoy

- **Real** es BSC mainnet (chain 56). El APK de producción 1.0.2, código 12, ya usa esos contratos. Paquete `com.quatrivium.credit`.
- **Demo** es BSC testnet (chain 97). Demo y Real cambian juntos.
- El alta es un solo pago de **4 USDT**. Correo y teléfono no cobran aparte cuando el alta está conectada.
- La fama de red no se acredita con el alta. Donar o aportar suma 100 de fama por USDT desde el primero. La racha la suma un invitado directo al liquidar un crédito.
- Reserva: desde el nivel 10 se bloquea el propio principal, 30 días, techo del 12 %. El retiro del bote lo propone y confirma el panel, con 72 horas, y no toca ese principal.
- 17 idiomas. El apodo de la red se confirma aparte, una sola vez, y no va a la cadena.
- Los contratos de mainnet ya están desplegados. No hace falta volver a desplegarlos.

## App

React Native 0.81.5, Expo 54 y TypeScript. La billetera del teléfono sale de la frase de 24 palabras.

```bash
npm install
npm run start
```

El APK de producción se construye en la nube con el perfil `production` de `eas.json` (chain 56). Las actualizaciones OTA están apagadas.

## Contratos

Las pruebas locales usan el archivo de configuración de este repositorio:

```bash
npx hardhat --config hardhat.config.cjs test
npx tsc --noEmit
```

En cada push y pull request a `main`, GitHub Actions corre esos chequeos además de Gitleaks y TruffleHog. El APK no se construye en Actions.

Mainnet, chain 56:

| Contrato | Dirección |
|---|---|
| Crédito | `0xade65b4224B4C6b2f1CCAb9D58c810EE15ac71D6` |
| Fama | `0xa590f241868560AF3f9E2017c7d629FFDEA27e2B` |
| Reserva | `0xa81857F71A11a21d59F59C2190638793266233fB` |
| Alta | `0x50146aDB887dB13Ee7Ffa66792d656127BCB96A4` |
| USDT | `0x55d398326f99059ff775485246999027b3197955` |

Avisos: `https://notify.quatriviumcredit.app`. Sitio: `https://quatriviumcredit.app`.
