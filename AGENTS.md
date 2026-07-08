# Guía para Agentes IA

Este documento es la **puerta de entrada para cualquier agente IA** (opencode, Claude Code, Cursor, Aider, etc.) que trabaje sobre este repositorio. Léelo entero antes de tocar nada.

> **¿Sos un agente nuevo en el proyecto?** Empezá por **`START_HERE.md`** en la raíz. Después leé este archivo. Después seguí el orden de §3.

---

## 1. Qué es este proyecto

Plataforma de casino virtual **multi-tenant white-label**. Un único producto que se vende a múltiples operadores ("tenants"). Cada operador tiene su propia base de datos, su propio branding, su propia jerarquía de usuarios y sus propios reportes.

Modelo de negocio del dueño de la plataforma: **% del netwin** de cada tenant.

---

## 2. Reglas innegociables

> ⚖️ **LEYES DE DOMINIO — `docs/LEYES.md`.** Las leyes de economía, roles, comisiones y permisos son **inquebrantables salvo pedido explícito del dueño**. Leelas antes de tocar esas áreas y, en cada cambio, **avisá qué leyes aplican** (citándolas por código, ej. "toca R1 y P3"). Si una tarea parece requerir romper una ley, **detenete y preguntá**.

1. **No inventar arquitectura**. Si la duda no está cubierta por los `.md` de `/docs`, **detenete y preguntá**. No improvises decisiones de diseño.
2. **Leer antes de escribir**. Antes de modificar cualquier archivo, leelo completo.
3. **TypeScript estricto**. `any` está prohibido salvo justificación explícita en comentario. Usar tipos compartidos de `packages/types`.
4. **Multi-tenant siempre**. Cada query/operación ocurre en el contexto de un tenant. Nunca escribir lógica que asuma "una sola DB".
5. **Wallet = plata real**. Toda operación sobre fichas debe ser:
   - Transaccional (Postgres TX o saga si involucra varios servicios).
   - Auditada (entrada en `audit_log` con quién, cuándo, qué, por qué).
   - Idempotente (con `idempotency_key`).
6. **Permisos primero**. Toda ruta/acción del backend valida permisos atómicos antes de ejecutar. Sin excepciones.
7. **No documentación inventada**. Si creás un `.md`, que refleje código real o decisiones tomadas. Nada de "TODO docs".
8. **Idiomas**:
   - Código (variables, funciones, tablas, comentarios técnicos): **inglés**.
   - Documentación (`/docs`, `README.md`): **español**.
   - Mensajes de UI: configurables por tenant; default español.

---

## 3. Cómo navegar la documentación

**Carpeta `/docs`** contiene toda la documentación de diseño. Numerada para indicar orden de lectura cuando entrás de cero.

| Archivo | Cuándo leerlo |
|---|---|
| `LEYES.md` | **Siempre.** Leyes inquebrantables de economía, roles, comisiones y permisos. Antes de tocar cualquiera de esas áreas. |
| `00-vision.md` | Siempre primero. Te ubica. |
| `01-glosario.md` | Cada vez que veas un término que no entiendas. |
| `02-arquitectura.md` | Antes de tocar infra, stack, monorepo, deploys. |
| `03-jerarquia-roles.md` | Antes de tocar auth, permisos, usuarios, paneles. |
| `04-modelo-datos.md` | Antes de tocar schemas, migraciones, queries. |
| `05-flujos-fichas.md` | Antes de tocar wallet, cargas, retiros, transferencias. |
| `06-flujos-pagos.md` | Antes de tocar depósitos, comprobantes, criptos. |
| `07-integracion-aggregator.md` | Antes de tocar integración de juegos. |
| `08-integracion-kommo.md` | Antes de tocar livechat o CRM. |
| `09-publicidad-referidos.md` | Antes de tocar referidos, links, atribución. |
| `10-panel-control.md` | Antes de tocar el panel admin/operador. |
| `11-personalizacion.md` | Antes de tocar branding/temas por tenant. |
| `12-seguridad-compliance.md` | Antes de tocar auth, KYC, anti-fraude. |
| `13-escalabilidad.md` | Antes de tocar caché, colas, particionado. |
| `14-roadmap.md` | Para entender prioridades del momento. |
| `15-engagement-promos.md` | Antes de tocar bonos, sorteos, ligas, antifraude de multi-cuentas. |
| `own-games/00-overview.md` | Antes de tocar el módulo de juegos propios (RGS, math, provably fair, Phaser). |
| `SESSION_LOG.md` | **Siempre al iniciar sesión** — para saber qué hicieron agentes anteriores. **Siempre al cerrar sesión** — para registrar lo que hiciste vos. |
| `DEVLOG.md` | Cuando necesites entender el "por qué" de una decisión técnica que no está en los docs formales. Agregar entrada cuando tomes una decisión nueva. |

Los marcados como *(pendiente)* todavía no existen. **No los inventes**: si necesitás info que estaría ahí, pregunta al usuario.

---

## 4. Flujo de trabajo esperado

Cuando recibas una tarea:

1. **`git log --oneline -20` y `git status` ANTES que cualquier doc.** El estado real del repo es la fuente de verdad. SESSION_LOG es un complemento, no un reemplazo.
2. **Leé `docs/SESSION_LOG.md`** — entendé el último estado declarado y comparalo con git.
3. **Identificá el dominio**. ¿Toca wallet? ¿Permisos? ¿Frontend? Buscá el `.md` correspondiente.
4. **Leé los `.md` relevantes**. Como mínimo `LEYES`, `00`, `01`, `02`, `03`, `14` siempre.
5. **Proponé un plan corto** antes de escribir código (en una sesión interactiva). En tareas autónomas, dejá un comentario `// PLAN:` arriba del cambio.
6. **Escribí TS estricto + tests** cuando aplique.
7. **Documentá en el `.md` correspondiente** los cambios de diseño que hagas.
8. **Conventional Commits** para mensajes de commit.
9. **Al cerrar sesión**: agregá entrada a `docs/SESSION_LOG.md`. Si tomaste decisiones técnicas no obvias, agregalas también a `docs/DEVLOG.md`.

---

## 5. Cosas que **no** debés hacer sin permiso explícito

- Cambiar el stack (ORM, framework, BD).
- Cambiar la estructura del monorepo.
- Tocar archivos en `/docs/00-` a `/docs/03-` (son decisiones cerradas con el dueño).
- Agregar dependencias pesadas sin justificar.
- Renombrar entidades del modelo de datos.
- Saltarte validaciones de permisos "para probar rápido".
- Escribir queries crudas que crucen tenants.

---

## 6. Stack en una línea

Turborepo + pnpm · Next.js 15 + TS · NestJS · PostgreSQL 18 + Drizzle (1 DB por tenant + DB de control) · Redis + BullMQ · Socket.io · S3-compatible · Docker + Coolify.

---

## 7. Si algo no cierra

**Preguntá al usuario.** Es preferible una pregunta extra a una decisión silenciosa que después haya que deshacer. Especialmente en: wallet, permisos, modelo de datos, integraciones externas.
