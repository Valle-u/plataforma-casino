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

- ✅ **SEAMLESS** — CONFIRMADO (dashboard 2026-08: tag "● Seamless" junto a la cuenta
  `redgardel`). Forever corre el juego y le pega a NUESTRA wallet por callbacks en tiempo
  real (`bet`, `win`, `cancel`…). Somos la fuente de verdad del saldo. → **Necesito el
  Bloque 3 (Callback API)** sí o sí.
- ~~TRANSFER~~ — descartado.

> Palace es seamless. Si Forever también lo es, reutilizamos casi toda la mecánica.
> **Dónde verlo:** en el menú de su panel/API suele decir "Seamless" o "Transfer"
> (Palace lo llamaba "Callback API (Seamless)" vs "Only Transfer Mode").

---

## Bloque 1 — Identidad y acceso al panel

- **1.1** ⬜ Nombre del **aggregator / dueño del sistema** (probablemente el mismo que
  Palace — a confirmar en el submenú API/footer).
- **1.2** ✅ **Cuenta:** `redgardel`, rol **Operator** (dashboard 2026-08).
- **1.3** ✅ Sí, **multi-nivel** Agent → sub-agents → users, con **Points** ("Total points
  of all users" en el dashboard). Mismo modelo que Palace.
- **1.4** ✅ **Menú capturado** (dashboard): Dashboard · Profile · Error log · Game control
  · Agent · User · Report · API. ⬜ Falta abrir los submenús (sobre todo **API**).
- **1.5** ⬜ El **manual de uso** (PDF) que te pasaron.

---

## Bloque 2 — Main API (nosotros → Forever)

> La API que NOSOTROS llamamos para crear jugadores, listar juegos, abrir un juego, etc.

- **2.1** ⬜ **Base URL** (ej. `https://api.forever.example`) y si hay sandbox + prod.
- **2.2** ⚠️ **Autenticación por FIRMA** (el menú tiene "Request signature" + "Signature
  test"). Necesito de `API guide` / `Request signature`: **algoritmo** (HMAC-SHA256?),
  **qué se firma** (body? query? timestamp+nonce?), **dónde va la firma** (header?), y
  **de dónde sale el secret** (en el panel). Distinto de Palace (que era Bearer token plano).
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

- **3.1** ⚠️ **Autenticación del callback**: Forever usa **firma** (ver menú). Necesito
  saber si el callback viene **firmado por Forever** (y validamos la firma con el secret) o
  si además hay token. Palace era token plano sin firma → acá es más seguro pero más
  trabajo. Ver `API guide`.
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

- **4.1** ✅ **Currency: USD** (dashboard: "Balance: USD 0", selector USD). ⚠️ Distinto de
  Palace (ARS) — el `provider_code=forever` opera en USD.
- **4.2** ⬜ **Decimales/centavos**: ¿los montos incluyen centavos o son enteros? ⚠️ Crítico:
  si truncamos mal, rompemos el invariante del ledger. (A confirmar con una tx real o la
  doc del callback).
- **4.3** ⬜ **⚠️ Decisión económica (USD ↔ fichas):** nuestra plataforma opera en fichas
  (1 ficha = 1 peso, LEY E1) y el callback de Forever va a mandar montos en **USD**. Hay
  que decidir el mapeo: **(a)** 1 USD = 1 ficha (tratar el número como fichas, sin
  convertir — más simple, es lo que hace Palace con ARS), o **(b)** convertir USD→pesos con
  un tipo de cambio. Casi seguro **(a)** para MVP (Forever es solo el "motor de juego"; el
  número que manda = fichas que se mueven), pero lo confirmás vos. Va al `99-integration-plan`.

---

## Bloque 5 — Catálogo y lanzamiento del juego

- **5.1** ⬜ **Tamaño del catálogo**: cuántos proveedores / cuántos juegos.
- **5.2** ⬜ **Cómo se listan** los juegos (endpoint + campos: code, nombre, categoría,
  thumbnail/imagen, si está habilitado).
- **5.3** ⬜ **Cómo se lanza** un juego: ¿**iframe** o **redirect**? ¿anda en **mobile**?
  ¿qué es la `return_url` (a dónde vuelve el jugador al cerrar)?
- **5.4** ✅ Sí, hay **RTP / palanca de ganancia** por cuenta (dashboard: "RTP 0%~0%"),
  como Palace. ⬜ Falta ver cómo se setea (rango por agente / por jugada).

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

- **8.1** ✅ **Panel: una sección, dos cards.** En "Proveedores de juego" (`/games`)
  aparecen Palace y Forever como cards separadas, cada una con su config/estado.
- **8.2** ✅ **Lobby: mezclados con filtro** por proveedor (un solo catálogo, etiqueta/filtro).
- **8.3** ✅ Forever **se suma** al catálogo (no reemplaza a Palace).

---

## Resumen: estado para arrancar a codear

> El PDF `en_0.pdf` (v1.0.3) resolvió casi todo. Detalle en [`01-api-spec.md`](01-api-spec.md).

1. ✅ **Modelo de wallet:** SEAMLESS.
2. ✅ **API/endpoints:** launch (`GetGameUrl`), catálogo (`GetVendors`/`GetGameList`),
   callback (`GetBalance`/`ChangeBalance`), reportes. Todo destilado en `01-api-spec.md`.
3. ✅ **Callback:** 2 endpoints, idempotencia por `txnCode`, `txnType` 0/1/2, timeout 2s.
4. ✅ **Cómo se lanza:** `GetGameUrl` → `launchUrl` (iframe/redirect, channel desktop/mobile).
5. ⬜ **BLOQUEANTES que faltan** (capturas puntuales):
   - **API base URL** (sección "Settings and Information" del back office).
   - **Reglas de la firma** `X-Forever-Sig-*` → **bajá el SDK de Node.js** de la página
     "Request signature" + captura de esa página.
   - **Dónde se registra la Callback URL** nuestra + si el **callback entrante viene firmado**.
   - **Centavos sí/no** en `amount`.
   - Estado de la cuenta: **approved/unapproved**, sandbox/prod.

Con esos 5 puntitos + tus decisiones de producto (Bloque 8) puedo cerrar el
`99-integration-plan.md` y arrancar a codear.
