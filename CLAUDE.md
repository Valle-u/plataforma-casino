# CLAUDE.md

Guía específica para **Claude Code** trabajando sobre este repositorio.

> Para reglas generales de cualquier agente IA, leé primero `AGENTS.md`. Este archivo solo agrega lo específico de Claude Code.

---

## Lectura obligatoria al iniciar

En este orden, sin saltarse nada:

1. `START_HERE.md` — puerta de entrada para agentes IA.
2. `AGENTS.md` — reglas generales y convenciones.
3. `docs/00-vision.md` — qué es el producto.
4. `docs/14-roadmap.md` — en qué fase estamos.
5. `docs/SESSION_LOG.md` — qué hicieron los agentes anteriores (último entry primero).
6. `docs/DEVLOG.md` — decisiones técnicas conversacionales con contexto.
7. `docs/01-glosario.md` — vocabulario del dominio.
8. `docs/02-arquitectura.md` — stack y estructura.
9. `docs/03-jerarquia-roles.md` — modelo de roles y permisos.

Cualquier `.md` adicional según la tarea (ver tabla en `AGENTS.md` §3).

---

## Convenciones para Claude Code

### Estilo de respuesta
- **Español** para conversación con el usuario.
- **Inglés** para código, nombres de archivos, identificadores.
- Respuestas concisas. Sin relleno. Sin "Great question!".
- Cuando proponés un cambio grande, mostrar el plan **antes** de tocar archivos.

### Uso de herramientas
- `Read` antes de `Edit`. Siempre.
- `Glob` / `Grep` antes de asumir que un archivo existe o que un símbolo está en cierto lugar.
- `Bash` solo cuando hace falta (migraciones, tests, instalaciones).
- Para tareas de exploración grandes, usar el agente `Explore` o `general-purpose`.

### Edición de código
- Cambios chicos → `Edit`.
- Archivos nuevos → `Write`.
- Nunca sobrescribir un archivo existente con `Write` si un `Edit` alcanza.

### Commits (cuando el usuario los pida)
- Conventional Commits.
- Mensaje en inglés, una línea ≤72 caracteres + cuerpo opcional.
- Co-author footer estándar de Claude Code.

---

## Áreas de alta sensibilidad

Estos dominios requieren **especial cuidado y duda explícita** antes de cualquier cambio:

| Dominio | Por qué |
|---|---|
| `packages/db/wallet/*` | Plata real. Errores = pérdidas. |
| `apps/api/auth/*` | Compromete la seguridad de todos los tenants. |
| `apps/api/permissions/*` | Un fallo permite escalada de privilegios. |
| `packages/db/migrations/*` | Corre contra todas las DB de tenants. |
| `apps/api/tenant-resolver/*` | Si falla, un tenant puede ver datos de otro. |

Para estos, **siempre** preguntar antes de modificar, aunque parezca trivial.

---

## Cómo razonar sobre multi-tenant

Cada operación del backend ocurre en el contexto de **un tenant específico**.

- El `tenant_id` se resuelve por dominio (subdomain o custom domain) en un middleware temprano.
- A partir de ahí, el `Request` lleva un `TenantContext` que contiene la conexión a la DB de ese tenant.
- **Nunca** abrir una conexión "global" a una DB de tenant. Siempre desde el `TenantContext`.
- La DB de control (`platform_control`) es la única excepción: contiene el registro de tenants y datos del super-admin.

---

## Si te encontrás con código que viola las reglas

1. **Reportarlo al usuario**, no arreglarlo silenciosamente.
2. Si te piden arreglarlo, hacerlo en commit separado con `fix:` o `refactor:`.

---

## Comando útil mental

Antes de cada cambio, preguntate:
1. ¿Esto está en los docs? Si no, ¿debería estarlo?
2. ¿Esto cruza tenants? Si sí, ¿está justificado?
3. ¿Esto toca permisos o wallet? Si sí, ¿pedí permiso?
4. ¿Mis tipos son estrictos? `any` = `no`.
5. ¿Decisión grande? Si sí, ¿la voy a anotar en `docs/DEVLOG.md`?

## Al cerrar la sesión

**Obligatorio** antes de despedirte:
1. Agregar entrada a `docs/SESSION_LOG.md` con el formato definido ahí (fecha-hora AR, modelo, qué hiciste, commits, próximo paso).
2. Si tomaste decisiones técnicas no obvias, agregar entrada a `docs/DEVLOG.md`.
3. Confirmar que los commits se hicieron y se pushearon (si el usuario lo pidió).
4. Dejar un mensaje claro de "qué viene" para el próximo agente.
