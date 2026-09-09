# Runbook — cerrar el acceso público a los documentos privados

> Escrito el 2026-09-06. **Ampliado el 2026-09-08** para incluir los adjuntos
> del chat. **El código ya está; falta desplegarlo.**
> Contexto y por qué: `docs/12-seguridad-compliance.md`, al final.

## Qué se está arreglando

Dos clases de archivo se descargan hoy **con sólo tener la URL**, sin
autenticación, y con un `Cache-Control` de **un año** que hace que borrar uno no
lo saque de circulación:

| Carpeta | Qué hay adentro |
|---|---|
| `bank-transactions/proofs/` · `deposits/proofs/` | comprobantes: nombre, CUIT, CBU y monto |
| `chat/attachments/` | lo que la gente manda por el livechat: fotos del DNI, capturas de transferencias |

Al terminar este runbook: sólo se abren con una URL firmada que **vive 15
minutos**, y borrar un archivo tiene efecto inmediato.

> **Los adjuntos del chat se sumaron el 2026-09-08.** Estaban fuera desde que se
> construyó el livechat: la regla de privacidad miraba una sola carpeta
> (`/proofs/`) y ésta no matcheaba. **Terminar este runbook en su versión vieja
> los habría dejado exactamente como estaban**, con la sensación de haber cerrado
> el tema. Ver `docs/crm/14-decisiones.md` D12.

## Estado antes de empezar (medido el 2026-09-06)

```
GET /storage/files/tenants/miamihub/bank-transactions/proofs/<uuid>.pdf
→ 200 OK
→ Cache-Control: public, max-age=31536000, immutable

GET /storage/files/tenants/miamihub/chat/attachments/<uuid>.jpg
→ 200 OK
→ Cache-Control: public, max-age=31536000, immutable
```

Medido el 2026-09-08: `REQUIRE_SIGNED_PROOFS` sigue en `"0"`, o sea que **la
firma todavía no se exige**. Una URL vieja sin firmar abre igual.

---

## 📍 Dónde estamos parados (2026-09-08)

**`main` corre a propósito la versión VIEJA del driver de storage.** El
arreglo que hace que la API firme los adjuntos del chat está completo y
probado en `staging` (`0c21270`), pero **no puede ir a producción antes que el
Worker** — por el motivo de la sección de abajo.

Cuando el Worker esté desplegado (Paso 1), traer esos dos archivos a `main`:

```bash
git checkout staging -- apps/api/src/storage/cloudflare-worker-driver.ts apps/api/src/storage/cloudflare-worker-driver.spec.ts
```

> ⚠️ **Un `git merge staging` NO alcanza.** Para git esos archivos ya están
> resueltos en `main`, así que la versión vieja ganaría en silencio. Hay que
> traerlos explícitamente con el comando de arriba.

---

## ⚠️ El orden no es negociable

**Los pasos 1 y 2 van antes que el 3.** Si la API empieza a firmar mientras el
Worker viejo sigue mandando `public, immutable`, cada URL firmada crea una
**entrada de caché nueva de un año**. En vez de arreglar el problema,
multiplicaríamos las copias públicas imborrables.

**El paso 5 va último.** Es el único que puede cortar un flujo de plata: si algo
quedara sin firmar, el operador deja de ver los comprobantes y **no puede
aprobar depósitos ni conciliar transferencias**.

---

## Paso 0 — Mergear el código de la API a `main`

**Este paso faltaba en la primera versión de este runbook, y se pagó.** El
2026-09-06 se desplegó el Worker, se purgó el caché y se cargaron los secretos
en los dos lados — y las URLs seguían saliendo **sin firmar**, porque el código
que firma estaba en `staging` y **producción corre `main`**.

Cuesta encontrarlo porque todo lo demás parece correcto: el secreto está, el
Worker está desplegado, los comprobantes se ven. Lo único que falla es lo que
nadie mira hasta el final.

```bash
git checkout main
git merge --ff-only staging
git push origin main
```

Esperar a que Dokploy termine de desplegar la API antes de seguir.

---

## Paso 1 — Desplegar el Worker

Lleva el `Cache-Control` por tipo de archivo, el validador de firma (apagado) y
el `DELETE /files/:key`.

```bash
cd worker; npx wrangler deploy   # PowerShell 5.1 no soporta &&
```

**Verificar** — el comprobante tiene que dejar de decir `immutable`:

```bash
curl -sI "https://miamihub.vip/storage/files/tenants/miamihub/bank-transactions/proofs/5cc16a08-5b0c-46a8-84e0-b87f0e480e3f.pdf?cb=$(date +%s)" | grep -i cache-control
```

- ✅ `private, max-age=300` → seguir.
- ❌ `public, ... immutable` → el deploy no tomó. **No avanzar.**

Y lo mismo con un adjunto del chat — hay que sacar una key real de
`crm_messages.attachments`, o abrir una conversación con foto en el panel y
copiar la URL:

```bash
curl -sI "https://miamihub.vip/storage/files/tenants/miamihub/chat/attachments/<uuid>.jpg?cb=$(date +%s)" | grep -i cache-control
```

- ✅ `private, max-age=300` → seguir.
- ❌ `public, ... immutable` → está corriendo el Worker viejo. **No avanzar.**

---

## Paso 2 — Purgar el caché

Las copias que ya están en el borde siguen con su año: el paso 1 sólo cambia lo
que se cachea de ahora en adelante.

Panel de Cloudflare → zona `miamihub.vip` → **Caching** → **Purge Everything**.

---

## Paso 3 — El secreto compartido

Generar uno **largo y aleatorio**:

```bash
openssl rand -hex 32
```

Cargarlo con el **mismo valor** en los dos lados:

```bash
# Worker
cd worker && npx wrangler secret put CF_WORKER_SIGNING_SECRET

# API: en Dokploy → app `api` → Environment
CF_WORKER_SIGNING_SECRET=<el mismo valor>
```

> Si no coinciden, el Worker rechaza **todas** las firmas en el paso 5. Es el
> error más fácil de cometer y el más difícil de ver: hasta el paso 5 no se nota.

Después de guardar el env en Dokploy hay que **redesplegar la API** para que lo
tome.

**Verificar** que la API ya firma — abrir un depósito en el panel y mirar la URL
del comprobante: tiene que traer `?exp=...&sig=...`.

---

## Paso 4 — Verificar que nada se rompió

Con la validación todavía **apagada**, así que si algo falla no corta nada.

- [ ] Panel → **Depósitos** → abrir un comprobante. Se ve.
- [ ] Panel → **Transferencias bancarias** → abrir un comprobante. Se ve.
- [ ] Panel → **Soporte** → abrir una conversación **con una foto**. Se ve.
- [ ] Interfaz del jugador → el widget de chat muestra sus adjuntos.
- [ ] El logo del casino sigue cargando (no se firma, es público a propósito).

> Los dos del chat son nuevos y hay que mirarlos en las **dos puntas**: el
> operador y el jugador leen los adjuntos por caminos distintos, y los dos pasan
> por `hydrateMessage`, que regenera la URL desde la `storageKey` en cada
> lectura. Si esa función fallara, el adjunto se ve roto — no se cae la
> pantalla, así que hay que mirarlo a propósito.

> Transferencias es el que hay que mirar con más atención: hasta este cambio
> devolvía la URL guardada sin regenerarla, y fue lo que hubo que arreglar para
> que firmar no rompiera esa pantalla.

---

## Paso 5 — Exigir la firma

En `worker/wrangler.toml`, cambiar:

```toml
[vars]
REQUIRE_SIGNED_PROOFS = "1"
```

Y desplegar:

```bash
cd worker; npx wrangler deploy   # PowerShell 5.1 no soporta &&
```

**Verificar** — sin firma tiene que dar 403, con firma 200. **Las dos carpetas:**

```bash
# comprobante sin firma → 403
curl -s -o /dev/null -w "%{http_code}\n" \
  "https://miamihub.vip/storage/files/tenants/miamihub/bank-transactions/proofs/5cc16a08-5b0c-46a8-84e0-b87f0e480e3f.pdf"
```

```bash
# adjunto del chat sin firma → 403
curl -s -o /dev/null -w "%{http_code}\n" \
  "https://miamihub.vip/storage/files/tenants/miamihub/chat/attachments/<uuid>.jpg"
```

Y volver a abrir, desde el panel, **un comprobante y una conversación con foto**:
las dos tienen que seguir funcionando.

> Con este paso, cualquier URL de estas dos carpetas que haya salido de la
> plataforma —reenviada, pegada en un chat, en una captura— **deja de servir**.
> Ese es todo el punto del runbook.

---

## Si algo sale mal

Volver `REQUIRE_SIGNED_PROOFS` a `"0"` y desplegar. Eso restaura el acceso en un
minuto sin tocar nada más — los comprobantes vuelven a verse mientras se
investiga.

```bash
cd worker; npx wrangler deploy   # PowerShell 5.1 no soporta &&
```

---

## Lo que este runbook NO resuelve

**Cualquiera con una URL firmada vigente puede abrirla**: no se valida *quién*
pide. Son 15 minutos y hay que tener el link, muchísimo menos que "público y
para siempre", pero no es lo mismo que un endpoint que chequea permisos.

Esa es la opción 2 de `docs/12-seguridad-compliance.md` y queda pendiente.

**Los archivos ya subidos siguen donde están.** Este runbook cierra el acceso,
no borra nada. La retención de adjuntos del chat a 6 meses es una decisión
aparte (`docs/crm/14-decisiones.md` D15) y todavía no está implementada.

**Y la regla de qué es privado vive duplicada** en `worker/src/index.js`
(`CARPETAS_PRIVADAS`) y `apps/api/src/storage/cloudflare-worker-driver.ts`
(idem). No se puede compartir el código: el Worker es un bundle aparte. **Si
divergen, el fallo es silencioso** — que es exactamente cómo los adjuntos del
chat pasaron meses sin que nadie lo notara. Al agregar una carpeta privada
nueva, tocar los dos.
