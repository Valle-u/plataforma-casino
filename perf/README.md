# perf/ — Scripts k6 para load testing

> **Status**: Sprint 38 introdujo los 3 scripts. Sprint 39 (2026-05-19)
> los validó en runtime contra dev local. Resultados:
>
> | Script | Resultado |
> |---|---|
> | smoke (1 VU 1min) | ✅ 105 reqs, 0 errors, p95 **22ms** |
> | baseline (50 VUs 5min) | ✅ 24,819 reqs, **0 errors**, login p95 **133ms**, reads p95 **<40ms**, **80 req/s** sostenidos |
> | spike (200 VUs 90s) | ✅ 17,291 reqs, **0.03% errors** (6/17k), **187 req/s peak** · ⚠️ p95 **~2.3s** excede threshold aspiracional de 2s |
>
> El spike reveló un finding real: bajo carga abrupta el sistema NO
> colapsa pero la latencia p95 sube a ~2.3s. Optimizaciones probadas
> que ayudarían: cache de `/tenant/info` (lo polea el branding hook
> en cada nav del player), pool DB más grande, Redis para session lookup.

## ¿Por qué k6?

- Single binary, sin dependencies (Grafana k6 distro).
- Script en JS (familiar para el equipo) con Web API similar a `fetch`.
- Output a stdout + opcional Prometheus/InfluxDB para Grafana.

## Instalar

```bash
# macOS
brew install k6

# Linux / WSL
sudo gpg -k
sudo gpg --no-default-keyring --keyring /usr/share/keyrings/k6-archive-keyring.gpg --keyserver hkp://keyserver.ubuntu.com:80 --recv-keys C5AD17C747E3415A3642D57D77C6C491D6AC1D69
echo "deb [signed-by=/usr/share/keyrings/k6-archive-keyring.gpg] https://dl.k6.io/deb stable main" | sudo tee /etc/apt/sources.list.d/k6.list
sudo apt update && sudo apt install k6

# Windows (Chocolatey)
choco install k6
```

## Correr

Requiere backend API arriba en `:3000` (`pnpm --filter @casino/api dev`).
Por default apunta a `http://localhost:3000` con tenant `demo.localhost`.

```bash
# Smoke test: 1 user, 1 minuto — verifica que todo responde sin colapsar.
k6 run perf/smoke.js

# Baseline: 50 users sostenidos por 5 minutos — mide latencia + error rate normal.
k6 run perf/baseline.js

# Spike: 200 users de golpe por 30s + ramp-down — verifica que el sistema sobrevive.
k6 run perf/spike.js
```

Override de target:

```bash
API_BASE=https://staging.casino.example k6 run perf/smoke.js
```

## Targets de performance del MVP (doc 14 §15)

| Métrica | Target | Hot path |
|---|---|---|
| Login latency | p95 < 200ms | `POST /tenant/auth/login` |
| Wallet balance read | p95 < 100ms | `GET /tenant/wallet/me` |
| Deposit create | p95 < 300ms | `POST /tenant/deposits` |
| Game spin | p95 < 300ms | `POST /tenant/games/sessions/:id/bet` |
| **Throughput sostenido** | **500 req/s** | endpoints críticos |
| **Error rate** | **< 0.5%** | baseline |

Si los scripts revelan p95 fuera de target, primer paso es identificar
el endpoint culpable con el resumen de k6 (`http_req_duration{name:"login"}`).

## Estructura de los scripts

Cada script comparte un helper común `helpers/index.js` para:
- Login del player → token Bearer.
- Header `X-Tenant-Host: demo.localhost`.
- Headers comunes (`Idempotency-Key` cuando aplica).

## Limitaciones conocidas

- **No corre wallet mutations en spike** — `mint`/`load` requieren admin
  perms y modificarían el balance compartido. Solo lecturas + login en
  spike.
- **No incluye game spin en baseline** — requiere fundear cada VU
  con chips, no trivial dentro de k6 puro. Si emerge necesidad, agregar
  setup phase que mintea via API admin externa.
- **Sin Prometheus output**: hoy solo stdout. Si emerge necesidad de
  histórico, agregar `--out experimental-prometheus-rw=http://prometheus...`.
