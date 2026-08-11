# Prompt de arranque para Claude Code

> Pegá este prompt como primer mensaje en el chat de Claude Code para arrancar con el contexto completo.

---

Sos un agente IA que toma el proyecto "Plataforma Casino" (multi-tenant white-label) en un punto muy específico. Antes de hacer nada:

1. Leé en orden: `START_HERE.md`, `AGENTS.md`, `docs/00-vision.md`, `docs/14-roadmap.md`, `docs/SESSION_LOG.md`, `docs/DEVLOG.md`.
2. Corré `git log --oneline -20` y `git status` — el repo real es la fuente de verdad; SESSION_LOG es complemento, no reemplazo.
3. El proyecto es multi-tenant white-label (una plataforma que se vende a operadores, % del netwin). Reglas innegociables en `docs/LEYES.md` — si una tarea toca economía/roles/comisiones, citá las leyes aplicables y nunca las rompas.

## Estado actual (sesión opencode 2026-08-11)

**Último trabajo (commits recientes en main):**
- `2987e07` → fix: logout limpiaba solo el panel actual y dejaba la sesión del otro panel en localStorage (la sesión "se reabría sola" al navegar entre paneles).
- `1746536` → fix: sesiones admin/player **100% independientes** (Uriel pidió que login/logout en un panel NO afecte al otro). `logout()` limpia solo el panel actual; el bootstrap es reactivo al panel activo vía `usePathname()`.
- `c77e8a5` → docs de esa tanda.

**Todo eso está deployado y verificado** en Vercel (chunks `9409` desplegado contiene el bootstrap por panel) y Railway (`0072a3ec` SUCCESS, `/health` 200).

## Bugreport vigente (abierto)

Uriel reportó que al entrar a `https://plataforma-casino-web-ur4.vercel.app/play/login` desde su navegador común (no incógnito) termina en `.../login` (panel admin).

**Lo que ya se descartó**:
- `/play/login` en Vercel responde 200 sin redirect server-side; el HTML desplegado referencia el chunk correcto que redirige solo a `/play?auth=login`. Nunca a `/login`.
- `vercel.json` y `next.config.ts` no tienen redirects. No existe `middleware.ts`.
- Los únicos que redirigen a `/login` son `app/page.tsx` (raíz `/`, client) y `app/(admin)/layout.tsx:60` (`router.replace('/login')` sin sesión admin) — ninguno aplica al árbol `/play`.

**Hipótesis principal**: caché del navegador o service worker (`public/sw.js`, network-first para navegaciones, caché `casino-shell-v1.3.0`) de Uriel sirviendo una release vieja; o sesión admin residual en localStorage.

## Tu tarea inicial

1. **Pedile a Uriel Hard Refresh (Ctrl+Shift+R) o prueba en incógnito** en `https://plataforma-casino-web-ur4.vercel.app/play/login`.
2. Si persiste en incógnito, pedile el **URL final real** tras los redirects client-side y/o captura de consola (errores JS, qué chunk se ejecutó) para rastrear qué componente hace el `replace('/login')`.
3. No cambies diseño sin preguntar (ver AGENTS.md §5). Si tocás wallet/permisos/arquitectura, detenete y preguntá.

Al cerrar tu sesión, actualizá `docs/SESSION_LOG.md` (y `DEVLOG.md` si tomaste decisiones técnicas) y respetá Conventional Commits si commiteás.

---

> Nota para Uriel: este archivo (`docs/HANDOFF_CLAUDE.md`) es solo el prompt de arranque. Podés borrarlo después de pegarlo en Claude si querés.
