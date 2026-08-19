# 00 — Intake: qué datos necesito de Forever

> **Objetivo:** juntar toda la info para conectar Forever y que **conviva** con Palace,
> diferenciado en todo y ordenado en su propia sección del panel.
>
> **Cómo pasármelo:** capturas del panel de Forever, el manual de uso (PDF), y si
> tienen, el **swagger/OpenAPI** o la doc de su API. No hace falta que completes esto
> a mano — con las capturas + el manual yo lo destilo acá. Marcá lo que ya me diste.
>
> **Formato de respuesta:** dejá la respuesta bajo cada pregunta, o pasame la captura
> donde se ve. Lo `⬜` es lo que falta; lo `✅` lo confirmado.

---

## 🔴 Bloque 0 — La pregunta que define todo

**0.1 — Modelo de wallet.** ¿Cómo mueve el dinero Forever?

- ⬜ **SEAMLESS** (como Palace): Forever corre el juego y le pega a NUESTRA wallet por
  callbacks en tiempo real (`bet`, `win`, `cancel`…). Nosotros somos la fuente de
  verdad del saldo. → Necesito el **Bloque 3 (Callback API)** sí o sí.
- ⬜ **TRANSFER**: nosotros le transferimos crédito a Forever con su API antes de
  jugar, y el saldo vive de su lado; al salir del juego se hace "withdraw". → El
  Bloque 3 no aplica; el Bloque 2 (Main API) hace todo.

> Palace es seamless. Si Forever también lo es, reutilizamos casi toda la mecánica.
> **Dónde verlo:** en el menú de su panel/API suele decir "Seamless" o "Transfer"
> (Palace lo llamaba "Callback API (Seamless)" vs "Only Transfer Mode").

---

## Bloque 1 — Identidad y acceso al panel

- **1.1** ⬜ Nombre del **aggregator / dueño del sistema** (la empresa detrás de Forever).
- **1.2** ⬜ **Tipo de nuestra cuenta** (agent / operador / sub-agente) y su **username**.
- **1.3** ⬜ ¿El sistema es **multi-nivel** (Agent → sub-agents → users) como Palace? ¿Usa
  algún concepto de "Points"/crédito del agente?
- **1.4** ⬜ **Capturas del panel**: menú/sidebar completo, dashboard, y cualquier sección
  de "API" / "Settings" / "Integración".
- **1.5** ⬜ El **manual de uso** (PDF) que te pasaron.

---

## Bloque 2 — Main API (nosotros → Forever)

> La API que NOSOTROS llamamos para crear jugadores, listar juegos, abrir un juego, etc.

- **2.1** ⬜ **Base URL** (ej. `https://api.forever.example`) y si hay sandbox + prod.
- **2.2** ⬜ **Autenticación**: ¿`Authorization: Bearer {token}`? ¿header custom? ¿dónde se
  saca el token en su panel?
- **2.3** ⬜ **Formato de respuesta** (envelope): ¿algo tipo `{code, message, data}`? ¿qué
  valor de `code` significa OK?
- **2.4** ⬜ **Endpoints** (idealmente el **swagger/OpenAPI**). Los que me importan:
  - crear/consultar **jugador** (user create / info)
  - listar **proveedores** y **juegos** (catálogo: codes, nombres, imágenes, categorías)
  - **abrir juego** (game-url / launch): qué params pide (user, game code, lang, return_url)
  - **transacciones / reconciliación** (para cuadrar contra nuestro ledger)
  - **estadísticas** (opcional)
- **2.5** ⬜ **Límites**: rate limit (llamadas simultáneas por IP), **IP whitelist**
  obligatoria (¿hay que darles nuestra IP de salida?), **timezone** de las queries,
  ¿por cuánto tiempo guardan las transacciones?

---

## Bloque 3 — Callback API (Forever → nuestra wallet) · SOLO si es seamless

> La API que FOREVER nos llama cuando el jugador apuesta/gana. Es el corazón del
> seamless y donde se mueve la plata — necesito el detalle fino.

- **3.1** ⬜ **Autenticación del callback**: ¿token compartido en un header (como Palace,
  `Callback-Token`)? ¿HMAC/firma con secret? ¿whitelist de IPs de Forever?
- **3.2** ⬜ **Lista de commands** y el JSON de request/response de cada uno. En Palace son:
  `authenticate`, `balance`, `bet`, `win`, `cancel`, `status`. ¿Cuáles tiene Forever?
- **3.3** ⬜ **Idempotencia**: ¿qué campo identifica de forma única cada transacción (para
  no duplicar en reintentos)? En Palace es `trans_guid`.
- **3.4** ⬜ **Reintentos**: ¿reintenta los callbacks si no respondemos? ¿cuántas veces?
  (Palace reintenta `win`/`cancel` hasta 50 veces → idempotencia a prueba de balas).
- **3.5** ⬜ **Timeouts**: ¿cuánto tiempo tenemos para responder cada command? (Palace:
  `bet`/`balance` ≤ 2s, resto ≤ 4s — condiciona la arquitectura).
- **3.6** ⬜ **Identificación del jugador**: ¿con qué campo viene el jugador en el callback
  (`account`, `user_code`)? ¿coincide con lo que le mandamos al crear el user?
- **3.7** ⬜ **Códigos de resultado** esperados en nuestra respuesta (OK, saldo
  insuficiente, token inválido, error interno, etc.).
- **3.8** ⬜ **Dónde se registra la Callback URL** en su panel (y si hay un **tester** de
  callbacks, como el de Palace, para probar sin jugar de verdad).
- **3.9** ⬜ ¿Hay un **PHP/pseudocódigo de referencia** del callback? (Palace nos dio uno).

---

## Bloque 4 — Moneda y montos

- **4.1** ⬜ **Currency** con la que opera nuestra cuenta (¿ARS? ¿otra?).
- **4.2** ⬜ **Decimales/centavos**: ¿los montos incluyen centavos o son enteros? ⚠️ Crítico:
  si truncamos mal, rompemos el invariante del ledger. (Palace: ARS con centavos).

---

## Bloque 5 — Catálogo y lanzamiento del juego

- **5.1** ⬜ **Tamaño del catálogo**: cuántos proveedores / cuántos juegos.
- **5.2** ⬜ **Cómo se listan** los juegos (endpoint + campos: code, nombre, categoría,
  thumbnail/imagen, si está habilitado).
- **5.3** ⬜ **Cómo se lanza** un juego: ¿**iframe** o **redirect**? ¿anda en **mobile**?
  ¿qué es la `return_url` (a dónde vuelve el jugador al cerrar)?
- **5.4** ⬜ ¿Hay concepto de **RTP / palanca de ganancia** configurable por agente o por
  jugada (como Palace)? Si sí, cómo se setea.

---

## Bloque 6 — Credenciales (para el panel de config del tenant)

> Estas las cargará el admin en la sección de config de Forever del panel (igual que hoy
> con Palace: se guardan en `tenant_settings`, NO en `.env`). Con capturas de dónde
> aparecen en el panel de Forever me alcanza.

- **6.1** ⬜ **API token** (Main API).
- **6.2** ⬜ **Callback token / secret** (si es seamless).
- **6.3** ⬜ Cualquier otro **ID de agente / merchant / operator id** que pidan.
- **6.4** ⬜ **Estado de la cuenta**: ¿sandbox o producción? ¿está **aprobada** para
  operar o arranca "pendiente de aprobación" (como Palace)?

---

## Bloque 7 — Económico (para reportes y comisiones)

- **7.1** ⬜ **Comisión que Forever nos cobra** sobre el NetWin (%). Va en
  `game_providers.commission_fee_pct` y se descuenta como costo de proveedor
  (LEY C), separado del de Palace.
- **7.2** ⬜ ¿Cómo se **fondea/liquida** nuestro crédito con Forever (si aplica al modelo)?

---

## Bloque 8 — Convivencia con Palace (cómo lo quiero en el panel)

> Esto es decisión tuya (producto), no dato de Forever. Lo dejo acá para cerrarlo.

- **8.1** ⬜ En el panel, ¿querés **una sección "Proveedores de juego"** con Palace y
  Forever como sub-secciones/tabs, o **dos secciones separadas** en el menú?
- **8.2** ⬜ En el **lobby del jugador**, ¿los juegos de ambos proveedores se mezclan en un
  mismo catálogo (con filtro por proveedor) o van separados?
- **8.3** ⬜ ¿Forever **reemplaza** algún juego/proveedor actual o **se suma** al catálogo?

---

## Resumen: lo mínimo para arrancar a codear

Con **esto** ya puedo diseñar el plan de integración (`99-integration-plan.md`):

1. ✅/⬜ **Modelo de wallet** (Bloque 0) — bloqueante.
2. ✅/⬜ **Main API**: base URL + auth + endpoints de user/catálogo/launch (Bloque 2).
3. ✅/⬜ Si es seamless: **auth del callback + lista de commands + idempotencia +
   timeouts** (Bloque 3).
4. ✅/⬜ **Centavos sí/no** (Bloque 4).
5. ✅/⬜ **Cómo se lanza el juego** (Bloque 5.3).

El resto (catálogo completo, comisión, credenciales reales, convivencia en el panel)
lo vamos completando en paralelo. **Empezá por las capturas del panel + el manual +
el swagger si lo tenés** — de ahí saco la mayoría.
