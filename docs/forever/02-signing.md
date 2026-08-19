# 02 — Forever · Firma de requests y verificación de callbacks (Ed25519)

> Fuente: SDK oficial de Node.js del panel (`forever-packet-signer.js`, guardado en este
> mismo dir) + captura del Profile (2026-08). Este doc es el **contrato de auth** — lo
> implementamos tal cual para que Forever acepte nuestros requests y para validar que los
> callbacks son legítimos.

---

## 0 — Qué credenciales hay (Profile → back office)

> ⚠️ **Los valores secretos NO se guardan en el repo.** Viven en `tenant_settings` (como
> `palace.*`). Acá solo documentamos qué es cada uno.

| Campo (Profile) | Qué es | Uso | Estado |
|---|---|---|---|
| **API Endpoint** | `https://api.aicvgdbi.win/api/casinoapi` | base URL de la Main API (Operator API) | ✅ confirmado |
| **Agent code** | `redgardel` | va en el body (`agentCode`) y en la firma | ✅ |
| **Type** | Operator | — | ✅ |
| **Api mode** | Seamless | — | ✅ |
| **API token** | (secreto) | va en el body (`token`) de cada request | ✅ existe · ⚠️ regenerar antes de prod (quedó en captura) |
| **Request sign private key** | (secreto, Ed25519 seed 32B) | **firmar** nuestros requests salientes | ✅ generada (fuera del repo) · ⚠️ regenerar antes de prod |
| **Callback verify public key** | (pública, Ed25519 32B) | **verificar** la firma de los callbacks entrantes | ✅ generada |
| **Site endpoint** | `https://plataforma-casino-production.up.railway.app/api/v1/game-provider/...` | **nuestra Callback URL** (ya apunta a prod) | ✅ ya configurado (path `/api/v1/game-provider/...`) |
| **Timezone** | (UTC-03:00) City of Buenos Aires | ⚠️ ver caveat abajo | ✅ (pero ojo) |
| **WhiteIP** | IP whitelist de la Main API | agregar la IP de salida de Railway | ⬜ configurar |
| **Created at** | 2026-07-30 | — | — |

> ⚠️ **Timezone:** el PDF dice "usar **UTC+0** para todos los DateTime", pero el Profile
> tiene el timezone en **Buenos Aires (UTC-3)**. Hay que **confirmar** si la API interpreta
> los DateTime en UTC+0 (spec) o en el timezone del agente (panel) — afecta `ReportByDate`
> y `createdOn`. Probar con una tx real.

> ⚠️ **Site endpoint ya apunta a nuestra Railway prod** con path `/api/v1/game-provider/...`
> — la MISMA convención que Palace. La ruta del callback de Forever será algo como
> `/api/v1/game-provider/forever/callback`.

---

## 1 — Algoritmo de firma: **Ed25519** (asimétrico)

No es HMAC: es **Ed25519** (firma con clave privada, verificación con clave pública). Dos
direcciones:

- **Nosotros → Forever (Operator API):** firmamos con **nuestra private key** (`Request
  sign private key`). Forever verifica con la pública correspondiente.
- **Forever → nosotros (callbacks):** Forever firma con **su** private key; nosotros
  verificamos con la **`Callback verify public key`**.

### Headers de firma (`X-Forever-Sig-*`)
| Header | Valor |
|---|---|
| `X-Forever-Sig-Alg` | `Ed25519` |
| `X-Forever-Sig-Agent` | `agentCode` (ej. `redgardel`) |
| `X-Forever-Sig-Timestamp` | epoch en **milisegundos** |
| `X-Forever-Sig-Nonce` | 16 bytes random en hex (anti-replay) |
| `X-Forever-Sig-BodyHash` | **SHA-256 hex** del body crudo (utf-8) |
| `X-Forever-Sig-Value` | firma Ed25519 del *canonical*, en **base64url** (sin padding) |

### String canónico (lo que se firma)
```
v1\n<agentCode>\n<timestampMs>\n<nonce>\n<sha256HexDelBody>
```
(las 5 líneas unidas por `\n`; `v1` = versión canónica fija).

### Firmar (saliente) — pseudocódigo del SDK
```
bodyHash   = sha256hex(bodyJson)
canonical  = ["v1", agentCode, String(tsMs), nonce, bodyHash].join("\n")
signature  = ed25519.sign(utf8(canonical), base64decode(privateKey))
X-Forever-Sig-Value = base64url(signature)
```

### Verificar (callback entrante) — lo que hacemos con cada callback
1. `bodyHash == sha256hex(bodyCrudo)` (si no, rechazar).
2. `|now - X-Forever-Sig-Timestamp| <= 5 min` (anti-replay; si no, expirado).
3. `X-Forever-Sig-Alg == "Ed25519"` y `X-Forever-Sig-Agent == agentCode` esperado.
4. `ed25519.verify(base64urlDecode(sigValue), utf8(canonical), callbackVerifyPublicKey)`.

> ✅ **Confirmado: los callbacks entrantes VIENEN FIRMADOS.** Los verificamos con la public
> key. Esto es más fuerte que Palace (que era token plano) — nos da autenticidad real del
> callback, no solo un secreto compartido.

### Implementación en nuestro stack (NestJS / Node)
- Node 18+ soporta Ed25519 nativo (`crypto.sign(null, msg, keyObject)` /
  `crypto.verify`), así que **no hace falta** `@noble/ed25519` — usamos `node:crypto`.
- El `bodyHash` se calcula sobre el **body crudo** (raw), así que el callback controller de
  Forever necesita acceso al **raw body** (como el de Palace) para el SHA-256 exacto.

---

## 2 — Resolución de tenant en el callback (con firma)

El callback llega a UNA sola URL (`Site endpoint`) para toda la plataforma. Para saber de
qué tenant es:
1. Tomar `agentCode` (header `X-Forever-Sig-Agent`) y/o `token` (body).
2. Resolver el tenant por ese agente (mapping en la DB de control — ver
   `99-integration-plan.md §1.4`; equivalente al `palace_callback_token`).
3. Con la `callback_verify_public_key` de ESE tenant, verificar la firma Ed25519.
4. Recién ahí procesar `GetBalance` / `ChangeBalance`.

---

## 3 — Dónde van las credenciales (tenant_settings, NUNCA en el repo)

Setting keys previstas (namespacing `game_provider.forever.*`, sin valores en git):
```
game_provider.forever.api_url                    = https://api.aicvgdbi.win/api/casinoapi
game_provider.forever.agent_code                 = redgardel
game_provider.forever.api_token                  (secreto)
game_provider.forever.request_sign_private_key   (secreto)  ← firmar salientes
game_provider.forever.callback_verify_public_key (pública)  ← verificar callbacks
```
Se cargan desde el panel admin (como `palace.*`) o por script; los secretos quedan
cifrados at-rest en la DB del tenant. **Los valores reales viven fuera de git.**

## 4 — Pendientes operativos (no bloquean el diseño)
1. ✅ Claves Ed25519 generadas (guardadas fuera del repo). ⬜ cargarlas en `tenant_settings`
   cuando exista la integración.
2. ⬜ **WhiteIP:** agregar la IP de salida de nuestra API (Railway) a la whitelist.
3. ⬜ **Regenerar el API token + el par de claves** antes de producción (la cuenta es de
   testeo y los valores pasaron por capturas/chat).
4. ⬜ Confirmar interpretación de **timezone** (UTC+0 vs AR).
