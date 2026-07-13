# 01 · Back Office — mapa del panel

> Captura 1 (2026-07). Dashboard del back office del proveedor.

## Header
- Logo: **Palace Casino**.
- Saldo mostrado: `ARS 0 ARS` (contador de puntos/saldo, en 0).
- Idioma: English. Zona: "Local (auto)".
- Notificaciones: 0.
- Usuario logueado: **redgardel** (@redgardel).

## Menú lateral (izquierda) — "BACK OFFICE"
```
Settings
── SLOTCITY ──
Dashboard
Agent            ▸
   └── Point Transactions
Users            ▸
   ├── Users List
   ├── Transaction History
   ├── Game History
   └── Game Connections
Games            ▸
   ├── Providers List
   └── Games List
Statistics       ▸
   ├── Stats Per Day
   ├── Stats Per Game
   ├── Stats Per Agent
   └── Stats Per User
API              ▸
   ├── Main API
   ├── Callback API (Seamless)
   ├── Callback API Testing
   ├── Callback API Testing Logs
   └── API Error Logs
Customer Service ▸
   ├── Notices Received
   ├── My Ticket List
   └── Open Ticket
```

**Notas:**
- La sección **API** es la que nos importa para integrar. Tiene:
  - **Main API** → la API saliente (nosotros → ellos): launch de juego, catálogo,
    gestión de usuarios/agents. Base URL: `https://agent.goldslotpalase.com`.
    Auth: `Authorization: Bearer {UUID}`.
  - **Callback API (Seamless)** → la API entrante (ellos → nosotros): el shape de
    los callbacks de wallet que DEBEMOS exponer. Auth: header `Callback-Token`.
  - **Callback API Testing** → herramienta para disparar callbacks de prueba
    contra nuestra URL. Permite simular: authenticate, balance, bet, win, cancel,
    status. Ver `05-callback-api-testing.md`.
  - **Callback API Testing Logs** → historial de requests/responses de testing.
  - **API Error Logs** → errores de las llamadas (debug de la integración).
- **Games** → catálogo con 17 providers y 2.148 juegos. Ver `06-panel-overview.md`.
  - Providers List: Pragmatic Play, CQ9, PG Soft, Booongo, Playson, Habanero,
    JiLi, Tydo, PlayStar, XGaming, Spribe, Hacksaw, Palace, BGaming, TADA,
    Amusnet, Inout.
  - Games List: Symbol = ID único del juego. Category = slots/crash/table/live.
- **Users** → gestión de usuarios del provider (nuestra red de jugadores).
  - Users List: nombre, parent, balance, deposit balance.
  - Transaction History: filtros por tipo (Betting/Win/Deposit/Withdraw/Cancel/
    Bet Error/Win Error).
  - Game History: rondas por usuario/juego/provider.
  - Game Connections: sesiones activas en tiempo real (auto-refresh 10s).
- **Agent** → Point Transactions (movimientos de puntos/saldo con el aggregator).

## Dashboard — tarjetas (todas en 0, cuenta nueva)
| Tarjeta | Valor | Qué es |
|---|---|---|
| My Point | 0 ARS | puntos/saldo propio (crédito con el aggregator) |
| My Profit of Day [Slot] | 0 ARS | ganancia del día en slots |
| My Profit of Day [Live] | 0 ARS | ganancia del día en casino en vivo |
| My Users | 0 | usuarios propios |
| **Providers / Games** | **17 / 2.148** | proveedores y juegos disponibles |
| Sub(Total) Point | 0 ARS | puntos agregados de la sub-red |
| Sub(Total) Profit of Day [Slot] | 0 ARS | ganancia agregada de la sub-red (slot) |
| Sub(Total) Profit of Day [Live] | 0 ARS | ganancia agregada de la sub-red (live) |
| Users | 0 | usuarios de la sub-red |
| Agents | 0 | agentes de la sub-red |

## Lecturas del modelo
- **Seamless wallet** (confirmado por "Callback API (Seamless)").
- **Modelo de puntos + agentes jerárquicos:** el aggregator tiene su propia
  pirámide (Agent → sub-agents → users) con "Points". Esto es del LADO del
  proveedor — NO es nuestra jerarquía de socios. Habrá que definir cómo mapea:
  probablemente nosotros somos un Agent con un pool de Points, y creamos un
  "user" del proveedor por cada jugador (o uno genérico) — a confirmar con la
  Main API.
- Distinguen **Slot** vs **Live** en las métricas.

## Footer
`Copyright © CASINO API Admin Corp. All Rights Reserved.`
