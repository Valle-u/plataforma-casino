# Día 1 del piloto — operación end-to-end

> **Audiencia**: vos (dueño) arrancando el Mes 7 del roadmap como cliente
> piloto interno. **Status**: redactado en Sprint 51.10 (2026-05-22).

## Objetivo

Pasar del MVP "técnicamente listo" a tenant operando con tu pirámide real
(admin → socios → cajeros → players) y flujo operativo cotidiano funcionando.

## Pre-requisitos

- ✅ Postgres 18 corriendo + `pnpm db:setup:control` ya ejecutado.
- ✅ R2 configurado en `apps/api/.env.local` (`STORAGE_DRIVER=r2` + vars).
- ✅ API corriendo (`pnpm --filter @casino/api dev`).
- ✅ Web corriendo (`pnpm --filter @casino/web dev`).

---

## Paso 1: Provisionar tu tenant

Una sola corrida:

```bash
pnpm --filter @casino/db db:seed:pilot -- \
  --slug=tu-marca \
  --name="Tu Marca" \
  --host=tu-marca.localhost \
  --admin-user=tu_admin \
  --admin-email=tu@email.real \
  --admin-pass="$(openssl rand -base64 18)"
```

**Anotar el password output**. Sale algo como:

```
═══════════════════════════════════════════════════════════
✓ Tenant CREADO: tu-marca
═══════════════════════════════════════════════════════════
Tenant ID:   019e...
Host:        tu-marca.localhost
Admin user:  tu_admin
Admin pass:  [REDACTED, copiá de la consola]
```

**Tip**: si querés probar varias veces, el script es idempotente —
mismo slug = update, no crea duplicado. Para reset total:
`dropdb tenant_tu_marca` + `DELETE FROM tenants WHERE slug='tu-marca'`
+ correr de nuevo.

---

## Paso 2: Apuntar el web

Editá `apps/web/.env.local`:

```
NEXT_PUBLIC_TENANT_HOST=tu-marca.localhost
```

Restart el web (`pnpm --filter @casino/web dev`).

Login en http://localhost:3001/login con `tu_admin` + el pass.
Deberías ver el dashboard.

---

## Paso 3: Activar 2FA del admin

**Crítico**. Sin esto, password fugado = take-over de tenant.

1. Click en el ícono de llave (header, arriba a la derecha).
2. Seguir el flow del modal: escaneás QR con app TOTP (Authenticator,
   1Password, etc.) → confirmás con código.
3. **Descargar los recovery codes** y guardarlos en password manager.

---

## Paso 4: Setup operativo mínimo

### 4a. Payment method (cómo recibís plata)

`/payment-methods` → "Nuevo método":
- Code: `bank-arg` (lowercase, identifier interno).
- Name: `Transferencia ARS`.
- Type: `bank_transfer`.
- Config (JSON):
  ```json
  {
    "cbu": "0000000000000000000000",
    "alias": "tu.alias.banco",
    "holder": "Tu Nombre",
    "bank": "Tu Banco"
  }
  ```

Activar. Los players verán este método al hacer un deposit.

### 4b. Bonus definitions (welcome + reload)

`/bonus-definitions` → "Crear plantilla":

**Welcome**:
- Code: `welcome-default`
- Type: `welcome`
- Status: `active`
- Config: `{ "matchPct": 100, "maxAmount": 5000, "minDeposit": 200 }`
- Wagering: `{ "multiplier": 10, "scope": "bonus_only" }`
- Expiration days: `30`

**Reload** (mismo flow):
- Code: `reload-default`
- Type: `reload`
- Config: `{ "matchPct": 50, "maxAmount": 2000, "minDeposit": 200 }`
- Wagering: `{ "multiplier": 5 }`
- Expiration: `15`

### 4c. Estructura jerárquica mínima

Crear desde `/users`:

1. **1 socio**: rol `socio`, username `socio_principal`, sin parent
   (el socio cuelga directo del admin).
2. **1 cajero** (subordinado del socio): username `cajero_01`, rol
   `cajero`. En el create-modal, seleccionar `socio_principal` como
   parent.
3. **2-3 players de prueba**: rol `usuario_final`. Pueden colgar de
   `cajero_01` o no (los players no requieren parent).

Para roles que necesitan permisos extra, usar el drawer de cada user
+ override grants.

---

## Paso 5: Mintar saldo inicial

Tu wallet (admin) arranca en 0. Para fondear ops:

1. `/wallet` → "Crear fichas" (mint).
2. Amount: `1000000` (1M chips para probar holgado).
3. Reason: `seed inicial del piloto`.
4. Confirm.

Ahora podés `Load` chips a los players de prueba desde el mismo panel.

---

## Paso 6: Probar el flow deposit end-to-end

Como **player** (logout admin, login `player_01`):

1. `/play/wallet` → "Nuevo depósito".
2. Seleccionar `bank-arg` como método.
3. Amount: `500`.
4. **Subir un comprobante** (PNG/JPG/PDF — cualquier imagen sirve para
   probar; el cajero lo va a ver).
5. Submit.

Como **cajero** (logout, login `cajero_01`):

1. Recibís notif in-app del deposit pendiente.
2. `/deposits` → ves el row con badge "pendiente".
3. Click en el row → drawer.
4. Mirar el comprobante (botón "Abrir en pestaña").
5. **Matchear con bank_tx**: si el dueño cargó la transferencia en
   `/bank-transactions`, el cajero la elige aquí. Si no, primero crear
   la bank_tx desde `/bank-transactions` → "Nueva entrante" con monto
   matching.
6. Match → "Approve" (atajo: `A` 2x).
7. El player recibe chips + bonus welcome auto-grant si es el 1er deposit.

Como **admin** (logout, login):

1. `/wallet-stats` → ves el deposit reflejado.
2. `/audit` → línea de "deposits.approve" con tu cajero como actor.
3. `/bonuses` → user bonus otorgado al player.

---

## Paso 7: Probar el flow retiro

Como **player**:

1. `/play/wallet` → "Retirar".
2. Seleccionar método (cobro CBU).
3. Amount: `200`.
4. Submit. El balance baja (hold inmediato).

Como **cajero**:

1. `/withdrawals` → "Aprobar" → "Pagar" (cuando hayas hecho la
   transferencia real al CBU del player).
2. O "Rechazar" con motivo si rebota.

---

## Paso 8: Monitoreo cotidiano (panel diario del cajero)

Páginas que el cajero abre cada mañana:

- `/deposits` (tab "Cola"): aprueba lo pendiente.
- `/withdrawals` (tab "Pendientes"): paga + marca como paid.
- `/users` (filtro "Nuevos esta semana"): chequea altas recientes.
- `/notifications`: si la tasa de éxito de email/SMS baja, revisar
  config del provider.

Páginas que el admin/socio abre:

- `/dashboard`: KPIs del tenant.
- `/wallet-stats`: volumen del día/semana/mes.
- `/audit` (filtro últimas 24h): qué hicieron los empleados.
- `/leagues`: ranking semanal/mensual + premios pendientes.

---

## Paso 9: Backups diarios

Configurar cron (Linux):

```cron
# Backup diario 03:00 UTC. Retención 30 días local + offsite a R2.
0 3 * * * /opt/casino/scripts/backup-all.sh >> /var/log/casino-backup.log 2>&1
```

Ver `docs/runbooks/disaster-recovery.md §Backup setup` para el script.

**Validar el backup**: cada semana correr el procedimiento §
"Validar el backup periódicamente" del mismo runbook (5 min de tu
tiempo, garantiza que el restore funciona).

---

## Paso 10: Bug-fix loop (Mes 7 real)

Operar 4-6 semanas como cliente real. Issues que vas a encontrar:

- **UX gaps**: cosas que se sienten torpes pero no rompen.
- **Tooltips faltantes**: campos cuyo significado no es obvio.
- **Workflows largos**: 5 clicks para algo que debería ser 2.
- **Edge cases reales**: data que no tenés en stress tests (nombres
  con tildes, montos con muchos decimales, etc.).

**Para cada finding**:
1. Anotar en `docs/SESSION_LOG.md` (o issue tracker si querés algo
   más estructurado).
2. Priorizar P0/P1/P2.
3. P0 (rompe modelo) → fix inmediato.
4. P1 (feature gap) → próxima semana.
5. P2 (polish) → backlog post-MVP.

---

## Cheatsheet de comandos comunes

```bash
# Levantar todo
pnpm --filter @casino/api dev    # terminal 1
pnpm --filter @casino/web dev    # terminal 2

# Provisionar tenant nuevo
pnpm --filter @casino/db db:seed:pilot -- --slug=X --admin-pass=Y

# Backup manual on-demand
export PGPASSWORD=admin
pg_dump -h localhost -U postgres -d tenant_<slug> -F c -f backup.dump

# Restore (ver runbook DR §1)
createdb tenant_<slug>_test && pg_restore -d tenant_<slug>_test backup.dump

# Cleanup tenant viejo (PELIGROSO — irreversible)
DELETE FROM tenant_domains WHERE domain='<slug>.localhost';
DELETE FROM tenants WHERE slug='<slug>';
dropdb tenant_<slug>

# Stats rápidas
psql -d tenant_<slug> -c "SELECT COUNT(*) FROM users;"
psql -d tenant_<slug> -c "SELECT type, count(*), sum(amount) FROM wallet_transactions GROUP BY type;"
```

---

## Cuándo declarar "piloto exitoso → listo para cliente externo"

Cuando podés decir SÍ a todas:

- [ ] Operé 4+ semanas continuas sin caída crítica.
- [ ] Hice al menos 1 restore real desde backup (no solo el procedimiento).
- [ ] Encontré + arreglé los P0/P1 que aparecieron.
- [ ] Tengo un cajero/empleado real (no test) operando sin que el
      sistema lo confunda.
- [ ] Los reportes mensuales cuadran con lo que esperabas a mano.
- [ ] 0 bugs críticos abiertos.

Ahí sí: contratá un pen test externo profesional + arrancá la
conversación con el primer cliente real.
