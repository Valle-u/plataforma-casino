# Runbook — cerrar el acceso público a los comprobantes

> Escrito el 2026-09-06. **El código ya está; falta desplegarlo.**
> Contexto y por qué: `docs/12-seguridad-compliance.md`, al final.

## Qué se está arreglando

Los comprobantes —PDF de transferencias, fotos de depósitos— se descargan hoy
**con sólo tener la URL**, sin autenticación, y con un `Cache-Control` de **un
año** que hace que borrar uno no lo saque de circulación.

Al terminar este runbook: sólo se abren con una URL firmada que **vive 15
minutos**, y borrar un archivo tiene efecto inmediato.

## Estado antes de empezar (medido el 2026-09-06)

```
GET /storage/files/tenants/miamihub/bank-transactions/proofs/<uuid>.pdf
→ 200 OK
→ Cache-Control: public, max-age=31536000, immutable
```

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

## Paso 1 — Desplegar el Worker

Lleva el `Cache-Control` por tipo de archivo, el validador de firma (apagado) y
el `DELETE /files/:key`.

```bash
cd worker && npx wrangler deploy
```

**Verificar** — el comprobante tiene que dejar de decir `immutable`:

```bash
curl -sI "https://miamihub.vip/storage/files/tenants/miamihub/bank-transactions/proofs/5cc16a08-5b0c-46a8-84e0-b87f0e480e3f.pdf?cb=$(date +%s)" | grep -i cache-control
```

- ✅ `private, max-age=300` → seguir.
- ❌ `public, ... immutable` → el deploy no tomó. **No avanzar.**

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
- [ ] El logo del casino sigue cargando (no se firma, es público a propósito).

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
cd worker && npx wrangler deploy
```

**Verificar** — sin firma tiene que dar 403, con firma 200:

```bash
# sin firma → 403
curl -s -o /dev/null -w "%{http_code}\n" \
  "https://miamihub.vip/storage/files/tenants/miamihub/bank-transactions/proofs/5cc16a08-5b0c-46a8-84e0-b87f0e480e3f.pdf"
```

Y volver a abrir un comprobante desde el panel: **tiene que seguir funcionando**.

---

## Si algo sale mal

Volver `REQUIRE_SIGNED_PROOFS` a `"0"` y desplegar. Eso restaura el acceso en un
minuto sin tocar nada más — los comprobantes vuelven a verse mientras se
investiga.

```bash
cd worker && npx wrangler deploy
```

---

## Lo que este runbook NO resuelve

**Cualquiera con una URL firmada vigente puede abrirla**: no se valida *quién*
pide. Son 15 minutos y hay que tener el link, muchísimo menos que "público y
para siempre", pero no es lo mismo que un endpoint que chequea permisos.

Esa es la opción 2 de `docs/12-seguridad-compliance.md` y queda pendiente.
