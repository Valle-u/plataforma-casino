# 🚦 START HERE

Bienvenido al proyecto. Si sos un **agente IA** (Claude Code, opencode, Cursor, Aider, etc.) o un **humano nuevo** entrando al codebase, **leé esto primero**.

---

## 1. ¿Qué es este proyecto?

Plataforma de **casino virtual multi-tenant white-label**. Un único producto, múltiples operadores, comisión sobre NGR. Detalle completo en `docs/00-vision.md`.

**Stack**: Turborepo + pnpm · TypeScript estricto · Next.js 15 · NestJS 11 · PostgreSQL 18 · Drizzle ORM · Redis · Socket.io · Cloudflare R2.

---

## 2. ¿Quién es el dueño del proyecto?

- **Nombre**: Uriel.
- **Email**: urielalejandrovalle493@gmail.com.
- **GitHub**: [@Valle-u](https://github.com/Valle-u).
- **Contexto**: estudiante de ingeniería en informática, **part-time** sobre el proyecto, **principiante** en aspectos como Docker, monorepos y plataformas distribuidas pero entiende lo básico de programación. Solicita explícitamente **modo enseñanza**: explicar conceptos antes de usarlos cuando sean nuevos.
- **Idioma**: español (Argentina) para conversación. **Inglés** para código, identifiers, commits.

---

## 3. Lectura obligatoria — en este orden

```
1. AGENTS.md                       ← reglas de operación para agentes IA
2. docs/00-vision.md               ← qué se construye, modelo de negocio
3. docs/14-roadmap.md              ← en qué fase estamos, qué viene
4. docs/SESSION_LOG.md             ← qué hicieron agentes anteriores
5. docs/DEVLOG.md                  ← decisiones conversacionales no formalizadas
6. docs/02-arquitectura.md         ← stack y estructura
7. docs/03-jerarquia-roles.md      ← modelo de roles + permisos
```

Después, según la tarea, leé los `docs/04-*` a `docs/15-*` correspondientes (ver tabla en `AGENTS.md §3`).

---

## 4. Antes de empezar a trabajar

```bash
# 1. Verificá el estado actual del repo
git log --oneline -20
git status

# 2. Leé el último entry de SESSION_LOG.md para saber dónde quedamos
# 3. Identificá la fase actual del roadmap
# 4. Preguntá al usuario qué tarea quiere atacar HOY
```

**No avances sin confirmación del usuario.** Esa regla es no negociable.

---

## 5. Reglas no negociables

1. **TypeScript estricto**. `any` está prohibido salvo justificación explícita en comentario.
2. **Antes de cualquier decisión arquitectónica**: preguntar al usuario.
3. **Antes de un cambio grande**: mostrar el plan, esperar OK.
4. **Antes de tocar áreas de alta sensibilidad** (wallet, auth, permissions, migrations, tenant-resolver): preguntar siempre, incluso si parece trivial.
5. **Después de cada sesión**: agregar entrada a `docs/SESSION_LOG.md`.
6. **Cuando tomes una decisión técnica que no está en docs formales**: agregar entrada a `docs/DEVLOG.md`.
7. **Conventional Commits** para mensajes (`feat:`, `fix:`, `chore:`, `docs:`, `refactor:`, `test:`).
8. **Nunca cruzar tenants** en queries. Multi-tenant físico = DB por tenant.
9. **Wallet es plata real**. Toda operación: transaccional + auditada + idempotente.
10. **Auditoría granular** en `audit_log` con IP, user agent, request_id.
11. **Modo enseñanza** activo por default. Explicar conceptos nuevos antes de usarlos.
12. **No documentación inventada**. Si creás un `.md`, refleja código real o decisión tomada.

---

## 6. Estilo de comunicación

- **Respuestas concisas**. Sin relleno. Sin "Great question!".
- **En conversación**: español argentino.
- **Cuando proponés cambios**: mostrá el plan **antes** de tocar archivos.
- **Cuando hay dos caminos no obvios**: explicá ambos con trade-offs y pedí decisión.
- **Si el usuario es principiante en algo**: usá analogías + ejemplos concretos.
- **Si hay un término técnico nuevo**: definirlo antes de usarlo.

---

## 7. Áreas de alta sensibilidad — preguntar SIEMPRE

| Dominio | Por qué |
|---|---|
| `packages/db/wallet/*` | Plata real. Errores = pérdidas. |
| `apps/api/auth/*` | Compromete seguridad de todos los tenants. |
| `apps/api/permissions/*` | Un fallo permite escalada de privilegios. |
| `packages/db/migrations/*` | Corre contra todas las DB de tenants. |
| `apps/api/tenant-resolver/*` | Si falla, un tenant ve datos de otro. |
| `packages/games-shared/provably-fair/*` | Si rompemos esto, perdemos confianza del jugador. |
| `apps/rgs/*/math.ts` | Si la math está mal, el casino pierde plata. |

---

## 8. Cómo cerrar una sesión correctamente

Antes de despedirte:

1. **Asegurá que el código compila**: `pnpm --filter @casino/<app> build`.
2. **Asegurá que los tests pasan** (si hay): `pnpm test`.
3. **Hacé commit** de lo que dejás listo (si el usuario lo pide).
4. **Push** a GitHub si lo pidió.
5. **Agregá entrada a `docs/SESSION_LOG.md`** con el formato definido ahí.
6. **Agregá entrada a `docs/DEVLOG.md`** si hubo decisiones técnicas relevantes.
7. **Dejá un mensaje de "qué viene"**: cuál es el próximo paso lógico.

---

## 9. Compromiso entre agentes

Este proyecto se mueve entre múltiples agentes IA y modelos. **La continuidad la garantiza la documentación, no la memoria de cada agente**. Por eso:

- **Documentar > tener buena memoria**.
- **Convención > preferencia personal del agente**.
- **Pedir > asumir**.
- **Preguntar > improvisar**.

---

## 10. Preguntas frecuentes

**¿Y si no entiendo una decisión documentada?**
Buscá en `docs/DEVLOG.md` el contexto. Si no está, preguntá al usuario antes de cambiarla.

**¿Puedo proponer cambiar una decisión cerrada?**
Sí, pero con argumento sólido. Las decisiones cerradas tienen razones; demostrá por qué la nueva es mejor. Y nunca sin permiso del usuario.

**¿Y si veo código que viola las reglas?**
Reportalo al usuario. **No lo arregles silenciosamente**. Si te piden arreglarlo, hacelo en commit separado (`fix:` o `refactor:`).

**¿Tengo que actualizar todos los docs en cada cambio?**
No, solo los que sean afectados. Pero **`docs/SESSION_LOG.md` siempre** se actualiza al cierre de sesión.

---

¿Listo? Andá a `AGENTS.md` y empezá la lectura en orden.
