# Storage — comprobantes y archivos de tenants

Sprint 51.6 introdujo el subsistema de storage para uploads de archivos
(hoy: comprobantes de depósito; futuro: avatars, branding, KYC docs).

El sistema es **driver-agnostic**: el código consume `StorageService` y
no se entera si abajo está local disk, R2, S3, o lo que sea. Eso permite
swap sin tocar features.

---

## Drivers disponibles

| Driver | Activo cuando | Para qué |
|---|---|---|
| `local` (default) | `STORAGE_DRIVER` no seteado o `=local` | Dev + CI |
| `r2` | `STORAGE_DRIVER=r2` | Producción (Cloudflare R2 — S3-compatible) |

Agregar otro driver (S3, B2, GCS) es:
1. Implementar `StorageDriver` interface (`apps/api/src/storage/storage.types.ts`).
2. Sumar el case al factory en `storage.module.ts`.
3. Documentar las env vars acá.

---

## Setup R2 (producción) — paso a paso

R2 es la recomendación default. Razones:
- **Egress = $0** (admin que ve comprobantes no cuesta bandwidth).
- $0.015/GB-mes storage. 10 GB gratis.
- S3-compatible (cualquier SDK S3 sirve).
- Multi-region automático.

### Paso 1 — Crear bucket

1. Cloudflare dashboard → **R2 Object Storage** → **Create bucket**.
2. Nombre: `casino-uploads` (o el que prefieras).
3. Location: **Automatic** (R2 elige la región más cercana).
4. **No** marcar "Public access" — vamos a usar signed URLs por defecto.

### Paso 2 — Generar token

1. R2 dashboard → **Manage R2 API Tokens** (abajo a la izquierda) → **Create API token**.
2. **Token name**: `casino-api-prod` (o lo que sea descriptivo).
3. **Permissions**: `Object Read & Write`.
4. **Specify bucket**: elegir `casino-uploads` (no usar "All buckets" — principio de mínimo privilegio).
5. **TTL**: dejar en `Forever` o un período largo. Si rotás keys, generás nuevo token.
6. Cloudflare te muestra 3 valores **una sola vez**. Guardalos:
   - `Access Key ID`
   - `Secret Access Key`
   - `Endpoint` (algo como `https://<accountid>.r2.cloudflarestorage.com`)

### Paso 3 — Setear env vars

En `apps/api/.env.local` (dev) o equivalente de prod:

```env
STORAGE_DRIVER=r2
R2_ENDPOINT=https://<accountid>.r2.cloudflarestorage.com
R2_ACCESS_KEY_ID=<access key del paso 2>
R2_SECRET_ACCESS_KEY=<secret del paso 2>
R2_BUCKET=casino-uploads

# OPCIONAL: si tenés dominio custom con CDN para URLs públicas
# Sin esta var, las URLs son signed con TTL 1h (más seguro).
# R2_PUBLIC_BASE_URL=https://files.tu-casino.com
```

### Paso 4 — Reiniciar API

```bash
pnpm --filter @casino/api dev
```

En los logs deberías ver:

```
[StorageModule] Storage driver: R2 (Cloudflare).
```

Si ves:

```
Error: Variable de entorno R2_BUCKET requerida cuando STORAGE_DRIVER=r2.
```

→ alguna env var falta. Revisar el `.env.local`.

### Paso 5 — Verificar con el health-check

Hay un endpoint dedicado:

```
GET /tenant/storage/health
```

Hace un ciclo completo upload → fetch → delete contra el driver activo
y devuelve un reporte. Lo llamás desde el panel admin (estás logueado),
o con curl:

```bash
TOKEN=<tu jwt admin>
curl -H "Authorization: Bearer $TOKEN" \
     -H "X-Tenant-Host: demo.localhost" \
     http://localhost:3000/tenant/storage/health
```

Respuesta esperada con todo OK:

```json
{
  "driver": "r2",
  "bucket": "casino-uploads",
  "endpoint": "https://<accountid>.r2.cloudflarestorage.com",
  "publicBaseUrl": null,
  "ok": true,
  "steps": [
    { "step": "upload", "ok": true, "durationMs": 245 },
    { "step": "fetch",  "ok": true, "durationMs": 89 },
    { "step": "delete", "ok": true, "durationMs": 102 }
  ],
  "totalDurationMs": 436
}
```

Si **algún step falla**, devuelve `500` con el detalle exacto del paso
que rompió — útil para diagnosticar.

### Paso 6 — Probar end-to-end desde la UI

1. Loguearte como player.
2. Solicitar un depósito → subir un PNG / PDF.
3. Loguearte como admin.
4. Ir a `/deposits` → click en el deposit → ver el comprobante inline.

Si la imagen aparece, todo OK. Si ves 403 / 401 al abrir la imagen, ver
el gotcha **"URL expirada"** abajo.

---

## Los 6 gotchas que arruinan storage en prod

### 1. CORS bloquea uploads

**Síntoma**: el browser tira `CORS policy: No 'Access-Control-Allow-Origin' header`.

**Por qué no nos pasa**: el cliente sube al **backend** (`/tenant/deposits/upload-proof`), no al bucket directo. El backend usa SDK server-side (sin CORS).

**Si en el futuro hacés pre-signed URL upload** (cliente sube directo a R2): tenés que configurar CORS del bucket — Settings → CORS → permitir `PUT` desde `https://tu-frontend.com`.

### 2. URL expirada / 403 al abrir el comprobante

**Síntoma**: el admin abre un comprobante viejo y ve 403 o "AccessDenied".

**Causa**: los signed URLs caducan (TTL 1h por default). Si la URL que está en DB es vieja, no funciona.

**Por qué no nos pasa**: `GET /tenant/deposits/:id` **regenera** la URL desde el `receiptStorageKey` en cada request. La URL que viaja al frontend es siempre fresca.

**Si pasa**: el `receiptStorageKey` está NULL para deposits pre-Sprint 51.6 (legacy). En ese caso, el storage URL viejo (público hardcodeado) no funciona. Solución: aceptar que los legacy no son recuperables.

### 3. Credenciales con scope demasiado abierto

**Síntoma de seguridad**: tenés un token con permisos "All buckets" que se filtra y un atacante accede a todo.

**Cómo prevenir**: en el paso 2 del setup, **siempre** elegir "Specify bucket" y dar permisos solo a `casino-uploads`. Si tenés varios entornos (dev/staging/prod), un token por cada uno.

### 4. Egress sorpresa con S3

**Síntoma**: factura de AWS de $200 por bandwidth que no esperabas.

**Por qué no nos pasa**: usamos **R2** que tiene **egress $0**. Si por alguna razón migrás a S3, la cuenta puede explotar — el admin que abre 50 comprobantes/día × 100 admins × 800KB cada uno = 4 GB/día = $11/mes solo de bandwidth en S3. En R2 es gratis.

### 5. Archivos huérfanos llenan el bucket

**Síntoma**: el bucket tiene 50 GB de archivos pero solo 30 GB son de deposits activos. El resto son comprobantes de deposits rechazados.

**Cómo lo manejamos**:
- **En reject**: `DepositsController.reject` llama `storage.delete(receiptStorageKey)` después del UPDATE (fail-soft — si falla el delete, el reject sigue siendo válido).
- **En approve**: NO borramos — queremos conservar comprobantes aprobados por compliance.
- **Pendiente** (futuro): cron que busca `receipt_storage_key` huérfanos (no referenciados en deposits) y los borra.

### 6. Multi-tenant — un tenant ve archivos de otro

**Síntoma de seguridad**: bug de auth + URLs predecibles → tenant A puede acceder a archivos de tenant B.

**Cómo prevenir**:
- **Storage paths con prefix de tenant**: `tenants/<slug>/deposits/proofs/<uuid>.png`. Si un tenant se va, `aws s3 rm --recursive tenants/<slug>` lo borra todo.
- **Bucket privado + signed URLs**: la URL incluye una firma temporal que solo el backend puede generar. Cualquiera que haga GET sin la firma, ve 403.
- **Pendiente** (si emerge cliente enterprise): cuenta R2 separada por tenant (BYOC — Bring Your Own Cloud).

---

## Roadmap de escalamiento

### Etapa 1 — Hoy (1-50 tenants)

- **Driver**: R2.
- **Bucket**: 1 compartido (`casino-uploads`), prefix `tenants/<slug>/...`.
- **Credenciales**: 1 par para la plataforma.
- **Costo estimado**: $1-5/mes en R2 hasta 100 GB.

### Etapa 2 — Crecimiento (50-500 tenants)

- Mismo driver, mismo bucket.
- Agregar **cron de cleanup** (cron diario que borra `receipt_storage_key` huérfanos > 30 días).
- Agregar **quota por tenant** (`tenants.storage_quota_bytes` columna). Check en upload.
- Considerar `R2_PUBLIC_BASE_URL` con CDN custom para reducir latencia de imágenes (las signed URLs cada vez agregan ~50ms).

### Etapa 3 — Enterprise / white-label (500+ o cliente premium)

- **Bucket por tenant** opcional (`tenants.storage_bucket` columna). El `R2Driver` lo lee y overridea el default.
- **BYOC** opcional (`tenants.storage_config jsonb` con sus propias R2 keys encriptadas con KMS). Útil para data ownership / compliance regional.
- **Antivirus scan** async (ClamAV worker) si el cliente lo exige.

Todos estos cambios se hacen agregando lógica al `R2Driver` o sumando
un driver más. El resto del código no se entera.

---

## Troubleshooting express

| Síntoma | Causa probable | Fix |
|---|---|---|
| `Error: Variable de entorno R2_BUCKET requerida` al iniciar | Falta env var | Verificar `.env.local` |
| `403 AccessDenied` al fetchear URL del admin | TTL signed expiró | Llamar al detail endpoint para regenerar |
| Health-check falla en `upload` con `403` | Token sin permisos `Object Read & Write` | Regenerar token con scope correcto |
| Health-check falla en `upload` con `NoSuchBucket` | Bucket no existe o mal nombre | Crear bucket / verificar `R2_BUCKET` |
| Health-check falla en `fetch` con `403` | Bucket privado + URL no signed | Verificar que `R2_PUBLIC_BASE_URL` no esté set si no tenés CDN |
| Health-check falla en `fetch` con `404` | URL mal formada | Reportar como bug — el `R2Driver` debería generar URLs válidas siempre |
| Frontend no muestra preview pero el archivo se subió | Browser cachea la URL vieja | Hard refresh; la nueva URL viene en el siguiente fetch del detail |
| Bucket lleno con archivos viejos | Falta el cron de cleanup | Borrar manualmente con `aws s3 rm --recursive` o agregar el cron |
| Migración local → R2 sin transferir archivos | Los archivos locales no se mueven solos | Script único de migración: leer `deposits.receipt_storage_key`, fetchear local URL, subir a R2 |

---

## Migración local → R2 (cuando vayas a prod por primera vez)

Si arrancaste con `local` en dev y querés migrar a R2 sin perder los
deposits existentes:

```bash
# Pseudo-código del script — agregarlo a packages/db/src/scripts/ si emerge.
1. Listar deposits con receipt_storage_key NOT NULL.
2. Por cada uno:
   a. Leer el archivo del disk local.
   b. Subir al R2 bucket con el mismo storage_key.
   c. UPDATE deposits SET receipt_storage_key = <nuevo si cambia>.
3. Setear STORAGE_DRIVER=r2 en .env.
4. Reiniciar API.
5. Probar con health-check.
```

Si arrancás en R2 directo, este paso no aplica.

---

## Variables de entorno completas

```env
# Driver activo
STORAGE_DRIVER=local|r2  # default: local

# LocalDiskDriver
STORAGE_LOCAL_ROOT=./storage              # default: ./storage relative to API CWD
STORAGE_PUBLIC_BASE_URL=http://localhost:3000  # base URL del API

# R2Driver (todas requeridas si STORAGE_DRIVER=r2)
R2_ENDPOINT=https://<accountid>.r2.cloudflarestorage.com
R2_ACCESS_KEY_ID=<access key>
R2_SECRET_ACCESS_KEY=<secret>
R2_BUCKET=casino-uploads
R2_PUBLIC_BASE_URL=https://files.tu-casino.com  # OPCIONAL
```
