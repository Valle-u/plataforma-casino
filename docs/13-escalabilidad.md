# 13 · Escalabilidad

> Estado: **decidido en estructura**. Números concretos (capacidad de instancias, particiones, etc.) se ajustan en producción según uso real.

Define cómo crece la plataforma de 1 a N tenants y de 100 a 100.000 usuarios sin refactor mayor. Estrategia por etapas, no over-engineering en MVP.

> ⚠️ **Las secciones 1 a 16 son proyecciones y planes.** Los números MEDIDOS
> contra producción están en **§17**, junto con el método y sus límites. Si
> algo de acá contradice a §17, gana §17.

---

## 1. Principios

| Principio | Implicación |
|---|---|
| **Escalar cuando duela** | No optimizar prematuramente. MVP arranca chico, escala cuando aparezca señal real. |
| **Decisiones reversibles primero** | Las elecciones de MVP no encierran. Cualquier capa puede pasar a algo más serio sin reescribir el dominio. |
| **Multi-tenant físico** | DB por tenant ya da sharding natural. Un tenant pesado se mueve a host dedicado sin tocar código. |
| **Caché agresivo, invalidación clara** | Redis para todo lo que se lee mucho y cambia poco. Reglas de invalidación documentadas. |
| **Async por default** | Side effects no bloquean. Outbox + BullMQ. |
| **Particionado desde el inicio** | Tablas que crecen sin techo (`wallet_transactions`, `game_rounds`, `audit_log`) particionadas por mes desde día 1. Barato hacerlo bien al principio, caro retroactivo. |
| **Observabilidad como feature** | Sin métricas no se sabe cuándo escalar. Prometheus + Grafana desde MVP. |

---

## 2. Targets de capacidad por fase

### MVP (mes 0–6)

- **Tenants**: 1–3.
- **MAU por tenant**: 100–10.000.
- **Concurrencia pico**: 100–1.000 usuarios simultáneos jugando.
- **Throughput esperado**: 50–500 req/s sostenido al backend.
- **Volumen de tx**: 10k–500k `wallet_transactions` por tenant por mes.
- **Volumen de rounds**: 100k–5M `game_rounds` por tenant por mes.

### v1 (mes 6–18)

- **Tenants**: 5–15.
- **MAU por tenant**: 1.000–50.000.
- **Concurrencia pico**: 1.000–5.000.
- **Throughput esperado**: 500–2.000 req/s.
- Algún tenant podría justificar host dedicado.

### v2 (mes 18+)

- **Tenants**: 15–50+.
- **MAU consolidada**: 100.000+.
- Migración a Kubernetes inevitable.
- Posible multi-region.
- Probable read replicas, algún tenant con DB sharding interna.

> Estos números son proyecciones. La arquitectura no asume estos volúmenes desde día 1; los soporta cuando lleguen.

---

## 3. Estrategia de despliegue por etapas

### MVP — VPS único + Coolify

**Setup**:
- 1 VPS Hetzner / DigitalOcean (ej: 8 vCPU + 32 GB RAM + 200 GB SSD) — costo ~$50–100/mes.
- **Coolify** instalado en el VPS, gestiona deploys vía Git.
- Servicios en Docker Compose:
  - 1 instancia Next.js (`apps/web`).
  - 1 instancia Next.js (`apps/panel`).
  - 1 instancia NestJS (`apps/api`) con workers BullMQ embebidos.
  - 1 Postgres 18 (DB de control + DBs de tenants en el mismo cluster).
  - 1 Redis (cache + queues + sessions).
  - 1 MinIO (storage en dev/staging; R2 directo en prod).
  - 1 Caddy (reverse proxy, SSL automático Let's Encrypt).
- Backups automáticos a R2 vía script + WAL archiving.

**Capacidad estimada**: hasta 3 tenants chicos / 1 tenant mediano sin estrés.

### v1 — VPS más grande + servicios separados

**Setup**:
- VPS más grande (16 vCPU + 64 GB RAM) o 2 VPS chicos detrás de load balancer.
- Postgres separado en VPS dedicado (CPU + IO optimizado).
- Redis separado.
- Apps en réplicas (2x `apps/api`, 2x `apps/web`, 2x `apps/panel`).
- **Workers BullMQ en proceso separado** del backend (decisión que se ejecuta acá, no en MVP).
- Connection pooler: **PgBouncer** entre apps y Postgres.
- Costo ~$200–500/mes según volumen.

### v2 — Kubernetes

**Triggers para migrar**:
- > 15 tenants activos.
- 1+ tenant con > 10k MAU sostenido.
- Necesidad de multi-region.
- Auto-scaling deseable por carga variable.

**Setup**:
- DigitalOcean Kubernetes / Hetzner / EKS.
- Helm charts para cada servicio.
- Postgres en provider managed (DigitalOcean Managed PostgreSQL, RDS).
- Redis managed.
- HPA (Horizontal Pod Autoscaling) por carga.
- Múltiples regions opcional (depende de geografía de tenants).

> La transición es **operacional**, no de código. Los servicios ya corren en Docker; solo cambia el orquestador.

### Multi-region

**Decisión MVP**: Argentina-only, single region. Datacenter en USA-East o Brasil (latencia razonable a Argentina, costo bajo). Implementación multi-region postergada hasta que un cliente lo justifique geográficamente.

---

## 4. CDN, storage y assets

### 4.1 Cloudflare

- **CDN** delante de `apps/web`, `apps/panel`, y assets de R2.
- **WAF** habilitado (gratis, regla básica + custom rules).
- **DDoS protection** automático.
- **Bot management** básico.
- **Page Rules** para cache agresivo de assets estáticos.

### 4.2 Cloudflare R2 (storage)

Decisión clave por costo: **R2 no cobra egress fees**. Crítico cuando los comprobantes y avatares se sirven mucho.

**Buckets**:
- `casino-platform-comprobantes` (privados, signed URLs).
- `casino-platform-kyc` (privados, cifrados, signed URLs corta vida).
- `casino-platform-branding` (públicos, cacheables).
- `casino-platform-promo-assets` (públicos).
- `casino-platform-exports` (privados, vida corta).

**Política**:
- Lifecycle a Glacier-equivalente (R2 Infrequent Access) tras 90 días.
- Versionado activado en buckets críticos.
- Replicación cross-region para backup.

### 4.3 Imágenes

- Optimización con Next.js Image + `next/image` con loader custom apuntando a R2.
- Resize on demand vía Cloudflare Image Resizing (gratis con plan).
- Formatos modernos: AVIF / WebP servidos automáticamente.

---

## 5. Cold storage y archiving

### 5.1 Plan de retención

| Datos | Hot (Postgres / R2 standard) | Cold (R2 IA / Glacier) | Total |
|---|---|---|---|
| `game_rounds` | 12 meses | 24 meses post-archive | 3 años |
| `wallet_transactions` | 24 meses | indefinido | indefinido |
| `audit_log` | 24 meses | 36 meses post-archive | 5 años (security log) |
| Comprobantes | 24 meses | 24 meses post-archive | 4 años |
| KYC docs | 24 meses | 60 meses post-archive | 7 años (compliance) |
| App logs | 30 días | — | 30 días |
| Access logs | 90 días | — | 90 días |

### 5.2 Proceso de archivado

Job mensual automatizado (`archive-cold-data`):
1. Selecciona particiones / archivos > umbral de antigüedad.
2. Exporta a formato comprimido (Parquet para tablas, tar.gz para archivos).
3. Sube a R2 IA con metadata.
4. Verifica integridad (hash).
5. Detacha la partición Postgres / mueve archivo a IA.
6. Registra en `archived_data_index` con ubicación.

### 5.3 Recuperación

- Acceso a datos cold es **lento** (horas) — solo para auditorías, soporte legal, disputas.
- UI: si una query toca datos > X meses, mostrar "Datos archivados, recuperación tarda ~24h" + botón "Solicitar".
- Job descarga + descomprime + restaura temporalmente para consulta.

---

## 6. Postgres: read replicas, connection pooling, partitioning

### 6.1 Read replicas

**MVP**: primary único. No hay réplica.

**v1+**: si la carga de lectura crece (reportes pesados que congelan al primary):
- 1 read replica con replicación streaming.
- Apps configuradas con dos pools: `primary` (writes + reads críticas) y `replica` (reportes, exports).
- Reportes ejecutados en replica → no bloquea operación.

### 6.2 Connection pooling

**Desde MVP**: **PgBouncer** entre apps y Postgres.
- Pool mode: **transaction** (mejor para multi-tenant que session).
- Pool size: 20–50 conexiones por DB tenant.
- Total conexiones al primary: 200–500.

**Estrategia multi-tenant**:
- Pool de pools con **LRU** (least recently used).
- Pools de tenants no usados en 5 min se cierran.
- Cuando un tenant request entra, si no hay pool → crear (lazy).
- Esto evita mantener conexiones abiertas a 100 DBs cuando solo 10 están activas.

### 6.3 Partitioning

Tablas particionadas por **rango mensual** sobre `created_at`:

```sql
CREATE TABLE wallet_transactions (
  ...
) PARTITION BY RANGE (created_at);

CREATE TABLE wallet_transactions_2026_05 PARTITION OF wallet_transactions
  FOR VALUES FROM ('2026-05-01') TO ('2026-06-01');
```

Job nocturno (`partition-manager`):
- Crea particiones de los próximos 3 meses (lookahead).
- Detacha + archiva particiones que cumplen política de retención.
- Reporta estado al super-admin.

**Tablas particionadas**:
- `wallet_transactions`
- `game_rounds`
- `audit_log`
- `livechat_messages` (volumen alto si crece el livechat)

### 6.4 Tuning de Postgres

Defaults sensatos para producción:
- `shared_buffers` = 25% RAM
- `effective_cache_size` = 75% RAM
- `work_mem` = 16-64 MB según RAM
- `maintenance_work_mem` = 1 GB
- `wal_buffers` = 16 MB
- `random_page_cost` = 1.1 (SSD)
- `effective_io_concurrency` = 200 (SSD)
- `max_connections` = 200 (PgBouncer maneja el resto)
- `synchronous_commit` = `on` para tx críticas; opcional `off` para tx no-críticas en función de riesgo

---

## 7. Workers, colas y jobs (BullMQ)

### 7.1 Estructura por fase

**MVP**: workers BullMQ corriendo **embebidos** en el proceso del backend NestJS. Mismo container.

**v1**: workers en proceso/container separado. Permite escalar workers sin escalar API.

### 7.2 Colas y prioridades

| Cola | Prioridad | Concurrencia default | Uso |
|---|---|---|---|
| `critical` | Alta | 10 paralelos | Webhooks de game providers, pagos confirmados, mint, alertas de seguridad. |
| `default` | Media | 5 paralelos | Emails, notificaciones, sync con Kommo, eventos no urgentes. |
| `reporting` | Baja | 2 paralelos | Generar exports, reconciliación, cierres de período, archivado. |
| `low` | Muy baja | 1 paralelo | Cleanup, métricas, refresh de caches periódico. |

### 7.3 Reglas

- **Idempotencia obligatoria** en cada job (mismo job N veces → mismo resultado).
- **Retry con backoff exponencial**: 3 reintentos default, configurable.
- **Dead letter queue**: jobs que fallan tras todos los reintentos quedan en DLQ + alerta a soporte.
- **Job scheduling**: cron-like vía BullMQ Repeatable Jobs (no usar node-cron paralelo).
- **Visibilidad**: panel del super-admin con dashboard de colas (longitud, latencia, fails).

### 7.4 Jobs recurrentes principales

- **Cierre de período de comisiones** (mensual/semanal según tenant).
- **Conciliación con providers** (nocturna).
- **Conciliación bancos / cripto** (nocturna).
- **Generación de NGR / GGR** (nocturna).
- **Archivado a cold storage** (mensual).
- **Particiones de tablas** (mensual).
- **Refresh de jackpots** (cada 30s).
- **Cleanup de sesiones expiradas** (horario).
- **Cleanup de idempotency_keys** (horario).
- **Test de restore** (mensual).
- **Health checks de providers** (cada 1 min).

---

## 8. Redis y caché

### 8.1 Configuración

**MVP**: una instancia Redis con 4-8 GB RAM.
**v1+**: Redis cluster o Redis Sentinel para HA.

**Persistencia**:
- AOF + snapshots cada 5 min.
- Datos críticos siempre rebuildables desde Postgres.
- Redis = cache, no source of truth.

**Memoria**:
- `maxmemory-policy = allkeys-lru` (eviction LRU automática).
- Reservar 20% para overhead.

### 8.2 Estrategia de caché

| Clave / dominio | TTL | Invalidación explícita |
|---|---|---|
| Lista de juegos del lobby | 5 min | Al toggle / edit de game |
| Branding del tenant | 1 h | Al publicar cambios |
| Permisos efectivos del usuario | 5 min | Al cambiar roles/permisos del usuario |
| Set de roles del tenant | 5 min | Al editar roles |
| Saldo de wallet (read-only para UI) | 30 s | Al cambiar balance |
| Jackpots de red (pull del provider) | 30 s | TTL natural |
| Standings de liga (top 10) | 5 min | TTL natural |
| Geo-IP lookup (por IP) | 24 h | TTL |
| Rate limit counters | hasta vencer ventana | TTL |
| Sesiones JWT (denylist de revoked) | hasta expirar el token | append on revoke |
| Locks distribuidos (BullMQ, mint, etc.) | según operación | release manual |
| Tenant config (settings + branding meta) | 10 min | Al editar settings |

### 8.3 Cache stampede prevention

- **Stale-while-revalidate**: devolver caché vencido mientras se refresca en background.
- **Locks distribuidos** para operaciones costosas (un solo proceso refresca, los otros esperan).
- **Jitter en TTLs** para evitar expiración masiva simultánea.

---

## 9. WebSockets / Socket.io

### 9.1 Arquitectura

- **Socket.io 4** + **`@socket.io/redis-adapter`** desde MVP.
- Eventos pub/sub via Redis: cliente conectado a instancia A recibe eventos emitidos en B.
- **Sticky sessions** en el load balancer (Caddy) cuando se escala a múltiples instancias de API.
- **Auth**: token JWT en handshake, validado al conectar.

### 9.2 Namespaces

- `/livechat` — chats de soporte.
- `/notifications` — notifs en tiempo real del panel.
- `/wallet` — actualizaciones de balance / hold.
- `/games` — eventos de juego (jackpot disparado, big win broadcast).
- `/admin` — eventos de panel admin (alertas, métricas en vivo).

### 9.3 Capacidad

- Una instancia Node.js maneja ~10k WebSockets simultáneos cómodo.
- Para 50k+: horizontal scaling de instancias detrás del load balancer + Redis adapter.

---

## 10. Multi-tenant scaling

### 10.1 Arquitectura actual

- **DB por tenant** + **DB de control**.
- Multi-tenant físico = sharding natural por tenant.

### 10.2 Cuando un tenant explota

Si un tenant supera umbrales (CPU consumption, IO, etc.):
1. Provisionar nuevo Postgres host (mismo provider).
2. `pg_dump` de la DB del tenant.
3. Restore en host nuevo.
4. Update `tenants.db_host` en DB de control.
5. Apps automáticamente apuntan al nuevo host (next request).
6. Si TX in-flight: drenar antes de switch (5 min ventana).
7. Borrar DB del host viejo después de validación.

**Cero downtime si se hace bien**. Connection pooler ya separa por tenant.

### 10.3 Cuando un tenant es chico

DBs chicas conviven cómodamente en un host compartido. Postgres maneja 100s de DBs sin estrés.

### 10.4 Onboarding de tenant nuevo

Job `provision-tenant`:
1. Crear DB `tenant_<slug>` en host del cluster.
2. Aplicar todas las migraciones.
3. Insertar seeds: roles base, permisos del catálogo, settings default, branding default.
4. Crear usuario Admin Tenant inicial con password temporal + 2FA pendiente.
5. Pre-warm: ejecutar `ANALYZE` sobre tablas core, pre-load branding/config en cache.
6. Crear buckets en R2 si se decide aislar storage por tenant (decisión a tomar; default: bucket compartido con prefix por tenant).
7. Notificar al super-admin con credenciales temporales.
8. Email de bienvenida al Admin Tenant con instrucciones.

---

## 11. Performance budgets

Targets sobre los que monitorear:

| Métrica | Target |
|---|---|
| Latencia p50 endpoints API | < 100 ms |
| Latencia p95 endpoints API | < 300 ms |
| Latencia p99 endpoints API | < 800 ms |
| Latencia wallet provider API (bet/win) | p99 < 150 ms |
| Tiempo de carga first contentful paint sitio jugador | < 1.5 s |
| Tiempo de carga panel | < 2.5 s |
| Throughput sostenido por instancia API | > 200 req/s |
| Cache hit rate Redis | > 80% |
| Conexiones activas a Postgres por tenant | < 30 sostenido |
| Cola BullMQ `critical` latencia p95 | < 1 s |
| Tasa de errores 5xx | < 0.1% |
| Uptime objetivo | 99.5% MVP / 99.9% v1+ |

Si alguna se sostiene fuera del target → alerta + investigación.

---

## 12. Observabilidad

### 12.1 Stack

- **Métricas**: Prometheus + Grafana.
- **Logs**: Pino → Loki → Grafana.
- **Traces**: OpenTelemetry → Tempo → Grafana.
- **Alertas**: Alertmanager → Slack/Telegram + email.
- **Uptime monitoring**: UptimeRobot o similar (externo, simula usuarios).

### 12.2 Dashboards principales (Grafana)

- **Salud general**: CPU/RAM/disk por servicio, latencias p50/p95/p99.
- **Por tenant**: actividad, latencias específicas, errores.
- **Game providers**: latencia, rate de error, throughput.
- **Wallet operations**: throughput, errores por tipo, latencia p99 de bet/win.
- **Colas BullMQ**: longitud, latencia, fails por cola.
- **Cache Redis**: hit rate, memory usage, eviction rate.
- **Auth & security**: login attempts, blocks, 2FA fails, anti-fraud signals.
- **Reporting**: NGR/GGR/mint en vivo (super-admin).

### 12.3 Alertas críticas

| Alerta | Trigger |
|---|---|
| API 5xx rate alto | > 1% en 5 min |
| Latencia p99 elevada | > 1s sostenido 10 min |
| Cola crítica con backlog | > 1000 jobs pending |
| Redis OOM | memoria > 90% |
| Postgres conexiones agotadas | > 80% del max |
| Provider down | health check falla 3 veces |
| Mint inusual | > umbral configurable en período corto |
| Login attempts spike | > 100 fails / min |
| Tasa de fraud signals alta | > 10x baseline |

---

## 13. Costos estimados por fase

Aproximados para Argentina/USD:

| Fase | Setup | Costo mensual |
|---|---|---|
| MVP (1-3 tenants chicos) | VPS Hetzner CX41 + R2 + Cloudflare free | $50–100 |
| v1 (5-15 tenants) | VPS más grande o 2-3 VPS + Postgres dedicated + Redis dedicated | $200–500 |
| v2 (15+ tenants) | Kubernetes + managed Postgres + Redis cluster + observability stack | $1.500–5.000+ |
| Por tenant promedio (v1) | Marginal: storage, CDN bandwidth, backups | $5–20 |

> Estos son order-of-magnitude. Ajustar al implementar.

---

## 14. Pre-warming de tenants nuevos

Después de provisionar (`provision-tenant` job), ejecutar `warmup-tenant`:

1. `ANALYZE` sobre tablas core (Postgres planifica mejor con stats frescas).
2. Pre-load de branding + tenant_settings en Redis.
3. Pre-load del catálogo de juegos del tenant en Redis.
4. Pre-creación de pool de conexiones.
5. Health check end-to-end (request a `/health` de cada servicio).
6. Marcar tenant como `active` solo si warmup pasó.

---

## 15. Plan de migración a Kubernetes (cuando duela)

Cuando los triggers se cumplan (§3 v2):

1. **Preparación**: containerizar todos los servicios (ya están en MVP). Helm charts.
2. **Provider**: elegir managed K8s (DigitalOcean / Hetzner / EKS).
3. **DB primero**: migrar Postgres a managed primero (DO Managed Postgres / RDS). Sin downtime con replicación.
4. **Redis después**: migrar a Redis managed o cluster.
5. **Apps al final**: deploy a K8s en paralelo al stack viejo. Gradual cutover por tenant via DNS / load balancer.
6. **Decommission VPS** cuando todo esté migrado y estable.

Estimado: 2-4 semanas de trabajo dedicado.

---

## 16. Pendientes / a definir al implementar

- **Provider concreto** de VPS (Hetzner por costo, DigitalOcean por DX, AWS EC2 si se prevé migrar a EKS).
- **Estrategia de bucket R2**: uno compartido con prefix por tenant vs uno por tenant (afecta gestión de credentials y ACLs).
- **Política de read replica** detallada (cuándo activarla, criterios).
- **Autoscaling rules** específicas en K8s (HPA por CPU + queue length).
- **Disaster recovery exercises** programados (cada cuánto, alcance, criterios).
- **Multi-region** detalle si llega un cliente que lo justifique.
- **Database migrations zero-downtime** strategy (expand-migrate-contract pattern documentado).
- **Performance testing**: definir suite de load tests (k6, artillery) y baseline de SLOs.
- **Optimización por tenant grande**: connection pool tuning específico, índices custom si hace falta.
- **Hot/cold separation de game_rounds** más fino: rounds del último mes en hot, resto en cold accesible vía vista.

---

## 17. Mediciones reales de producción (2026-08-31)

> Todo lo de arriba son proyecciones y planes. Esta sección son **números
> medidos contra `miamihub.vip` en producción**, con el método y sus límites.
> Si contradicen a una proyección, ganan estos.

### 17.1 Cómo medir (y cómo NO medir)

**El error a no repetir.** La primera tanda de mediciones abría una conexión
TCP+TLS nueva por cada muestra (un `curl` por request). Eso dio latencias de 54
a 608ms y llevó a concluir que había *contención en el VPS*. **Era falso**: se
estaban midiendo handshakes, no el servidor. Un navegador real reusa la
conexión.

Con la conexión ya caliente, los mismos endpoints:

| Endpoint | Muestras (ms) | Mediana |
|---|---|---|
| `/health` | 43 43 44 45 45 45 45 46 47 48 48 | **45ms** |
| `games/recent-wins?limit=10` | 45 46 47 49 50 54 59 60 60 62 63 | **54ms** |
| `games/facets` | 45 45 45 46 46 46 48 49 49 50 51 | **46ms** |
| `games/active?limit=60` (34 KB) | 43 46 46 47 48 50 51 51 51 52 54 | **50ms** |

Distribuciones apretadas, sin picos. La única request lenta es la primera de
cada tanda (350-400ms de handshake).

**Regla para el próximo que mida**: usar keep-alive y **calentar** antes de
tomar la muestra. Con `curl`, pasar N URLs en UNA invocación y un `-o /dev/null`
por cada una — con un solo `-o`, el cuerpo de las demás se mezcla con los
tiempos y los parsea mal.

### 17.2 Concurrencia

Solo lectura, `recent-wins`, conexiones calientes:

| Concurrencia | Requests | OK | Errores | p50 | p90 | p99 |
|---|---|---|---|---|---|---|
| 1 | 20 | 20 | 0 | 155ms | 161ms | 172ms |
| 10 | 60 | 60 | 0 | 168ms | 445ms | 830ms |
| 25 | 150 | 150 | 0 | 197ms | 408ms | 848ms |
| 40 | 240 | 240 | 0 | 248ms | 457ms | 583ms |

**Cero errores en 470 requests.** La mediana sube 1,6x entre 1 y 40
concurrentes. (Las medianas acá son más altas que en 17.1 porque el cliente era
Node y suma overhead propio; lo que importa es la **degradación relativa**.)

Para dimensionar: **100 jugadores quietos generan ~15 req/s** (ver 17.3), que
con ~200ms por request son **~3 concurrentes**. Se probó 40.

**Conclusión: 50-100 jugadores navegando entran cómodos.**

⚠️ **Lo que esto NO prueba.** Todo es lectura. El camino de la apuesta
(callback → transacción → `FOR UPDATE` sobre la wallet) **no se ejercitó**. Para
100 personas jugando de verdad ese es el número que falta, y necesita un load
test contra staging, no contra producción.

### 17.3 Carga que genera un jugador

Del polling del front (`refetchInterval`), con la pestaña visible:

| Origen | Cada | req/min |
|---|---|---|
| `useMyWallet` | 20s | 3 |
| `useMyUnreadCount` | 30s | 2 |
| `useRecentPublicWins` (ticker) | 15s | 4 |
| **Total por jugador** | | **9** |

100 jugadores = 900 req/min = **15 req/s**. El catálogo (`games/active`) **no**
se pollea: se pide al cargar la página y al tocar un filtro.

Dato bueno del diseño actual: todos usan `refetchIntervalInBackground: false`,
así que **el polling se pausa con la pestaña oculta**.

### 17.4 Qué se cacheó y cuánto rindió

Ver `apps/api/src/games/games-catalog-cache.service.ts`.

| Caché | TTL | Mejora medida |
|---|---|---|
| Catálogo (`active`, `facets`, `providers`) | 60s | **1,28x** (69ms → 54ms) |
| Ticker (`recent-wins`) | 10s | **1,15x** (62ms → 54ms) |

**Rindieron mucho menos de lo esperado**, y conviene entender por qué antes de
cachear más cosas: la migración `0099_perf_indexes` ya había dejado esas queries
en ~8-15ms, y el resto de la latencia es red y framework. No había mucho que
ahorrar.

**El valor del caché no es la velocidad de hoy, es que el costo en base deja de
crecer con la cantidad de jugadores.** El ticker pasa de ~7 consultas/s con 100
jugadores a ~0,1 — y ese número se sostiene cuando `game_rounds` tenga millones
de filas (el propio target de §2: 100k-5M por mes). Es seguro para después.

Correctitud verificada en producción: 16 pares miss/hit con **cuerpos
idénticos**, y en local que un tenant no ve la clave del otro.

### 17.5 Infraestructura: lo que sí es un problema

Nada de esto depende de las mediciones erradas.

1. **Los builds corren en el VPS de producción.** `buildServerId: null`, y cada
   build de la web tarda ~200s a full CPU sobre los mismos 4 cores que sirven a
   los jugadores. **Deployar en horario pico degrada el casino.** Es lo más
   accionable de toda la lista, y explica el CPU que va a 100 y vuelve a 0 que
   se ve en el panel de Dokploy.
2. **El VPS es la mitad de lo planeado**: Hostinger KVM 4 (**4 vCPU / 16 GB**)
   contra los 8 vCPU / 32 GB que dice §3 para MVP. Ahí adentro conviven
   Postgres, Redis, la API, la web, Dokploy, Traefik y los builds.
3. **Una sola réplica de la API** = un proceso Node = **un core para JS**, con
   `cpuLimit` y `memoryLimit` sin definir en ningún contenedor.
4. **Sin monitoreo**: `application.readAppMonitoring` devuelve todo vacío. No
   hay histórico de CPU ni memoria para diagnosticar nada.
5. **Tuning de Postgres sin verificar**: no se pudo leer `shared_buffers`,
   `work_mem` ni `max_connections` reales. Si quedó con los defaults de Docker,
   `shared_buffers` son 128 MB en una caja de 16 GB.

### 17.6 Lo que se revisó y está bien

- **El camino de la plata**: transacciones, `SELECT FOR UPDATE` sobre la wallet
  y locking ordenado por id para evitar deadlocks. Sin objeciones.
- **Índices**: `game_rounds (status, settled_at)` de `0099_perf_indexes` cubre
  el ticker. No hay seq scan sobre la tabla de mayor volumen.
- **Argon2id no bloquea el event loop**: `@node-rs/argon2` corre en el
  threadpool. El clásico "100 logins simultáneos tumban el server" no aplica.
- **Pools**: control 30, tenant 20 (subido de 10 el 2026-08-31). Con el default
  de `max_connections = 100` la cuenta da 50 con un tenant y 90 con los 3 del
  target de MVP. Pasar de ahí exige subir `max_connections` **antes**.

### 17.7 Próximos pasos, por impacto

1. **Sacar los builds del VPS de producción** (build server aparte) o, como
   mínimo, deployar fuera de horario.
2. **Load test del camino de apuesta** contra staging. Es el único hueco real
   que queda para responder "¿aguanta 100 jugando?".
3. **Prender monitoreo** de CPU/memoria: hoy se diagnostica a ciegas.
4. **Verificar el tuning de Postgres** en el contenedor de producción.
5. Antes de cachear nada más, **medir primero**: acá se cachearon dos endpoints
   que no eran el cuello de botella.
