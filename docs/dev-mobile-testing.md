# Testing mobile en dispositivo real

Cómo exponer el dev server local (`apps/web` en `:3001` + `apps/api` en `:3000`) a tu celular durante desarrollo, para probar el panel admin y la app player con un dedo de verdad sobre un viewport real.

> Útil sobre todo después de Sprint 53.2 (mobile nav drawer): el devtools mobile mode emula pero no detecta cosas como tap target hit area real, scroll inercia iOS, o el address bar cubriendo el bottom nav.

---

## Opción A — ngrok (recomendado, gratis)

### Setup (una vez)

1. Crear cuenta en https://ngrok.com (free tier suficiente).
2. Instalar: `winget install ngrok` (Windows) o `brew install ngrok` (mac).
3. Pegar el authtoken: `ngrok config add-authtoken <tu_token>`.

### Uso

Cada vez que querés probar en mobile:

```bash
# Terminal 1: dev servers (ya corriendo normalmente)
pnpm dev

# Terminal 2: túnel HTTPS al web
ngrok http 3001
```

Salida:
```
Forwarding  https://abcd-1234.ngrok-free.app -> http://localhost:3001
```

Abrir esa URL en el celular. **Importante**: el tenant resolver del backend matchea por `Host` header — al pasar por ngrok el host cambia. Hay dos caminos:

#### Camino 1: agregar el subdomain ngrok como `tenant_domain`

En la DB de control, una sola vez por sesión:

```sql
INSERT INTO tenant_domains (tenant_id, domain, is_primary)
VALUES (
  (SELECT id FROM tenants WHERE slug = 'demo'),
  'abcd-1234.ngrok-free.app',  -- el subdomain del túnel
  false
);
```

Cuando ngrok te dé un subdomain nuevo (cambia en cada restart del free tier), update el row. O usar el camino 2.

#### Camino 2 (más práctico para dev) — `X-Tenant-Host` override

El middleware (`tenant-resolver.middleware.ts`) acepta `X-Tenant-Host` como override. En `apps/web` se puede setear vía un interceptor del fetch durante dev:

```ts
// apps/web/lib/api-client.ts — solo si NODE_ENV === 'development'
headers['X-Tenant-Host'] = 'demo.localhost';
```

Pero ojo: nuestro middleware ya lee `X-Tenant-Host` antes de `Host`, así que cualquier request del web carga el subdomain de tenant que vos forces. Si el helper de fetch ya lo manda en dev, el túnel funciona sin tocar la DB.

### Tier paid

Si te molesta el subdomain cambiando, ngrok paid ($8/mo) te da subdomain reservado (`tu-app.ngrok-free.app` siempre el mismo).

---

## Opción B — cloudflared (más fiable, también free)

Cloudflare Tunnel no tiene rate limit del free tier de ngrok y el subdomain es estable si lo registrás bajo tu dominio. Setup más largo pero zero costo recurrente.

### Setup (una vez)

1. `winget install cloudflare.cloudflared` (Windows) o `brew install cloudflared` (mac).
2. `cloudflared tunnel login` — abre browser para autenticar.
3. `cloudflared tunnel create casino-dev` — crea el tunnel, te da un UUID.
4. Crear `~/.cloudflared/config.yml`:
   ```yaml
   tunnel: <UUID>
   credentials-file: C:\Users\Admin\.cloudflared\<UUID>.json
   ingress:
     - hostname: casino-dev.tu-dominio.com
       service: http://localhost:3001
     - service: http_status:404
   ```
5. En Cloudflare DNS de tu dominio: `cloudflared tunnel route dns casino-dev casino-dev.tu-dominio.com`.

### Uso

```bash
cloudflared tunnel run casino-dev
```

URL estable: `https://casino-dev.tu-dominio.com`. Sumarla a `tenant_domains` una sola vez.

---

## Opción C — IP local en la misma red WiFi (más simple, sin túneles)

Si el celular y la PC están en la misma red:

1. En PC: `ipconfig` (Windows) o `ifconfig` (mac/linux) — anotá la IP LAN (ej. `192.168.1.42`).
2. Arrancar Next con bind a `0.0.0.0`:
   ```bash
   pnpm --filter @casino/web dev -- -H 0.0.0.0
   ```
3. En el celular: `http://192.168.1.42:3001`.

**Limitaciones**:
- No HTTPS → algunas APIs del browser (notifications, geolocation, service workers) no andan.
- Si el router tiene client isolation activado, no conecta.
- El backend también tiene que bindear a `0.0.0.0` o accederlo via proxy de Next.

Para checkeo rápido de layout y tap targets alcanza. Para probar PWA features, usar ngrok/cloudflared.

---

## Qué probar en mobile (checklist sugerido)

Post Sprint 53.2:

- [ ] **Drawer admin**: tap en burger abre, swipe / tap fuera cierra, ESC desde teclado bluetooth cierra.
- [ ] **Bottom nav player**: no queda tapado por el address bar de Safari iOS (revisar `pb-20` del `<main>`).
- [ ] **Skip-to-content**: tab desde landing hace focus visible en el link (Sprint 53.4).
- [ ] **Tap targets**: ningún botón < 44×44px (estándar Apple HIG).
- [ ] **FloatingLeagueWidget + FloatingMissionsWidget**: no se superponen en viewports angostos (< 360px).
- [ ] **Forms login**: el teclado mobile no tapa el botón submit; autofocus en username funciona.
- [ ] **Toast notifications**: aparecen sobre el bottom nav, no debajo.
- [ ] **Carga de imágenes pesadas** (game thumbnails): no bloquea el scroll.

---

## Notas

- **Nunca** dejar el túnel abierto al cerrar la laptop con la sesión admin activa — es internet público.
- ngrok free imprime warning banner sobre la app antes de cargar; tap para confirmar y seguir.
- En iOS Safari, el devtools remoto se habilita en: Mac > Safari > Developer > [iPhone] > [tab].
- Chrome Android: `chrome://inspect` desde Chrome desktop con cable USB y debug USB activado.
