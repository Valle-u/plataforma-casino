# 26 · Monitoreo y diagnóstico

> Plan creado el **2026-09-03**, antes de abrir a producción. Estado: **la capa
> de detección está construida y verificada; la de diagnóstico casi no existe.**
>
> Complementa —no reemplaza— `docs/13-escalabilidad.md` §18 (Sentry) y §19
> (canal de avisos por Telegram), que documentan lo que ya corre. Acá está lo
> que **falta**, por qué, y en qué orden conviene hacerlo.

---

## 1. La pregunta que responde este documento

No es *"¿me entero si algo se rompe?"* — de eso ya estamos razonablemente
cubiertos. Es la siguiente:

> **Son las 3 de la mañana, llegó una alerta. ¿Cuánto tardo en saber qué pasó y
> arreglarlo?**

Hoy la respuesta honesta es **horas**, y el 01-09 lo demostró.

---

## 2. El principio: detectar no es diagnosticar

Son dos capacidades distintas y se construyen con herramientas distintas.

| | Pregunta | Herramienta |
|---|---|---|
| **Detectar** | ¿algo está mal? | alertas |
| **Diagnosticar** | ¿qué y por qué? | logs, trazas, datos durables |
| **Resolver** | ¿cómo lo arreglo? | runbooks, rollback |
| **Prevenir** | ¿cómo evito que vuelva? | tests en CI, entorno de pruebas |

Toda la inversión hasta hoy fue en **detectar**. Es lo correcto —era lo primero—
pero una alerta sin diagnóstico sólo te avisa más rápido que estás perdido.

---

## 3. Qué hay hoy

| Capa | Estado | Dónde está documentado |
|---|---|---|
| Errores de código | ✅ Sentry, verificado | §18 de `13-escalabilidad` |
| Trazas (HTTP, queries, Redis) | ✅ funcionando | §18.1 |
| Caída total de la plataforma | ✅ Worker fuera del VPS, verificado | §19.3 |
| "Los jugadores no pueden jugar" | ✅ `GamesHealthCron` cada 10 min | §19.2 |
| Plata en riesgo (rondas, reconciliación) | ✅ Telegram | §19.2 |
| Invariante del ledger | ✅ validador + panel `/ledger` | §10.6 de `14-roadmap` |
| Auditoría durable | ✅ `audit_log` con IP, user-agent, `request_id` | `12-seguridad-compliance` |
| Salud honesta de la API | ✅ `/health` devuelve 503 si la base o Redis caen | §18.4 |
| **Logs** | ❌ **se borran y no se pueden buscar** | §4.1 acá |
| **CPU / RAM / disco del host** | ❌ no existe | §4.2 acá |
| **Alertas de negocio** | ❌ no existen | §4.3 acá |
| **Tests como red de seguridad** | ❌ no corren en CI | §4.4 acá |
| **Dónde reproducir un incidente** | ❌ no hay staging real | §4.5 acá |

---

## 4. Los huecos

### 4.1 Los logs se borran, y no se pueden buscar ⚠️ **el más grande**

Tres problemas encadenados:

1. **Son efímeros.** Salen al stdout del contenedor y Swarm poda los
   contenedores viejos. Un día con varios redeploys se lleva puesto el historial.
2. **No se pueden leer por API.** Dokploy los transmite sólo por **WebSocket**;
   `docker.getContainerLogs` y `/docker-container-logs` por HTTP devuelven 404.
   Se probaron cinco combinaciones de parámetros y ninguna devolvió datos
   (ver `docs/24-entornos-deploy.md`). En la práctica: se bajan a mano del panel.
3. **Son texto plano.** La API usa el `Logger` de NestJS, no un logger
   estructurado. No hay forma de filtrar por `request_id`, `tenant_id` o
   `user_id` — sólo `grep` sobre texto.

**La evidencia de que esto duele**: el análisis del incidente del 01-09
(`docs/gregmorn/97-analisis-incidente-2026-09-01.md`) tuvo que reconstruirse
**con consultas SQL a la base**, porque los logs de esa ventana ya no existían.
Salió bien porque `audit_log` y las tablas del proveedor son durables — pero fue
un trabajo de horas para responder algo que un buscador de logs contesta en un
minuto.

⚠️ **Y el `request_id` ya existe.** Viaja por el request y se guarda en
`audit_log`. Es la pieza que correlaciona todo, y hoy no sirve para nada porque
no hay dónde buscarlo.

### 4.2 Nadie mira el host

No hay histórico de CPU, memoria **ni disco**. `application.readAppMonitoring` de
Dokploy devuelve vacío.

⚠️ **El disco es el riesgo tonto y letal**: si se llena, **Postgres deja de
escribir y el casino se cae**. En el VPS conviven la base, las imágenes de
Docker, los backups y los logs — cuatro cosas que crecen solas. Hoy nada lo mira.

### 4.3 No hay alertas de negocio

Todas las alertas actuales son técnicas: algo falló, algo no responde. Pero el
01-09 enseñó que **el sistema puede estar impecable y el negocio parado**: se
agotó el saldo del hall, la API contestó 93 callbacks con HTTP 200, y nadie se
enteró durante 18 horas.

Cosas que valdría vigilar y hoy no se vigilan:

- La Casa en rojo (el bankroll puede quedar negativo — es riesgo real de
  cualquier casino, y hay que verlo cuando pasa).
- Retiros pendientes acumulándose sin aprobar.
- Cero depósitos en X horas, con tráfico normal.
- Saldo del hall bajo (⚠️ **sólo se ve en el panel del proveedor** — no hay API,
  ver `docs/gregmorn/README.md`).

### 4.4 Los tests no son una red

**La suite no corre en CI.** Ni `ci.yml` ni `deploy.yml` ejecutan `pnpm test`:
sólo `lint`, `build` y `type-check`.

Consecuencia medida el **2026-09-03**: **63 tests fallan de 952, en 13 suites de
76**. El `SESSION_LOG` registraba "5 en rojo" — la diferencia se acumuló sin que
nada avisara, sobre el camino de la plata.

Probablemente se dejó afuera porque los tests necesitan Postgres. GitHub Actions
soporta contenedores de servicio: es un problema resuelto.

### 4.5 No hay dónde reproducir

`docs/24-entornos-deploy.md` dice *"Dos entornos, dos ramas"*, pero **Dokploy
tiene un solo proyecto (`casino`) con un solo entorno (`production`)**,
verificado por su API el 2026-09-03. Existe la rama `staging` en git, pero nada
la despliega.

Para diagnosticar, eso significa que **el único lugar donde reproducir un bug es
producción**. Y para prevenir, que cualquier push a `main` va directo al casino
en vivo: `autoDeploy: true` en las dos apps, incluso para cambios que sólo tocan
`docs/`.

---

## 5. El plan

### Fase 1 — antes de abrir a producción

**1.1 Logs estructurados con retención.**
Pasar la API a un logger estructurado (JSON) que emita en cada línea
`request_id`, `tenant_id` y `user_id`, y enviarlos a un agregador donde se pueda
buscar por esos campos. Con eso, *"¿qué pasó a las 05:44 UTC?"* deja de ser una
investigación y pasa a ser una consulta.

⚠️ **Antes de elegir proveedor, comparar los planes gratis vigentes.** Hay varias
opciones que sobran para el volumen de un VPS (Sentry incorporó logs, y están
Axiom, Better Stack y Grafana Cloud), pero los límites cambian seguido y no
conviene decidirlo de memoria.

⚠️ **Cuidado con los datos personales**: ya existe `apps/api/src/common/redact.ts`
y hay que asegurarse de que se aplique **antes** de enviar nada afuera. Mandar
logs a un tercero amplía la superficie de lo que se filtra.

**1.2 Disco, CPU y memoria.**
Lo más barato que evita la falla más tonta. Un cron en la API que chequee y avise
por el canal de Telegram que ya funciona; no hace falta montar nada nuevo.
Umbrales sugeridos: disco > 80% avisa, > 90% es crítico.

### Fase 2 — primera semana de producción

**2.1 Alertas de negocio.** Las de §4.3. La infraestructura ya está resuelta
(`AlertsService`, §19.1): cada alerta nueva son unas 20 líneas. Conviene
esperar a ver tráfico real antes de fijar umbrales, para no calibrarlos a ojo —
mismo criterio con el que se calibró `GamesHealthCron` contra datos del 01-09.

**2.2 Runbook de diagnóstico.** Un documento con el árbol de decisión para
cuando ya estás adentro del incidente: ¿está caído o lento? ¿es nuestro o del
proveedor? ¿dónde miro cada cosa? `docs/runbooks/observability.md` tiene la
filosofía y las métricas del día a día; falta la parte de "estoy en el incidente,
ahora qué".

### Fase 3 — cuando se estabilice

**3.1 Tests en CI**, con un contenedor de Postgres. Requiere primero arreglar
las 63 fallas: un CI que arranca en rojo se ignora igual que un suite en rojo.

**3.2 Un entorno de staging de verdad**, o al menos dejar de deployar producción
con cada push de docs.

---

## 6. Qué NO se hace, y por qué

**Grafana + Prometheus.** `docs/runbooks/observability.md` los menciona como
aspiración y para una plataforma grande son lo correcto. Para **un VPS con un
tenant** son dos servicios más que instalar, asegurar y mantener, para responder
preguntas que un agregador de logs y cuatro alertas ya responden. Se revisa
cuando haya varios tenants o cuando el diagnóstico deje de alcanzar.

**Sentry pago.** El problema real del plan gratis es la cuota de **5.000
errores/mes**, y un loop de errores te deja ciego el resto del mes. Eso se
mitiga primero sacando ruido y agrupando bien (§18.4), no pagando.

---

## 7. Límites conocidos del stack actual

Cosas que **no se resuelven** con nada de este plan y conviene tener presentes:

- **El iframe del proveedor.** El juego corre en su dominio; nuestro Sentry del
  browser no puede ver adentro. El frame en blanco y sus carteles de error son
  invisibles para nosotros. Lo que sí se detecta es el **efecto** (§19.2).
- **El saldo del hall no tiene API.** Sólo se ve en el back office del proveedor.
  La alerta de "aperturas sin apuestas" es el único aviso automatizable, y es
  **tardío**: suena cuando los jugadores ya no pueden jugar.
- **Sentry retiene 30 días.** Para cualquier análisis más viejo, la fuente son
  las tablas de la base.
- **Las alertas de Sentry van sólo al mail de Uriel** (`maxMembers: 1`). El canal
  de Telegram no tiene ese límite y es el que conviene usar para todo lo
  operativo.

---

## 8. Cómo verificar que el monitoreo está vivo

Un canal de avisos **falla en silencio**. No hay que asumir que funciona porque
está configurado: hay que probarlo, y volver a probarlo después de cada cambio
de tokens, grupos o entornos.

| Qué | Cómo |
|---|---|
| Sentry (API, web, trazas) | §18.3 de `13-escalabilidad` — tres chequeos |
| Canal de Telegram de la API | `ALERTS_BOOT_PING=1`, reiniciar, ver que llegue, apagarlo |
| Monitor de caída | `curl ".../?ping=1"` → tiene que devolver `{"ping":{"ok":true}}` |

⚠️ **Mirá el resultado, no el hecho de que responda.** El worker devolvía
"enviado" aunque Telegram rechazara el mensaje; se corrigió el 2026-09-03
justamente porque una prueba que no mira la respuesta no distingue un canal sano
de uno roto.
