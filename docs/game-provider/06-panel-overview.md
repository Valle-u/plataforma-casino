# 06 — Panel Overview (Back Office)

Resumen de todas las secciones del panel del proveedor Palace Casino.

---

## Estructura del Sidebar

```
├── Settings
├── Dashboard
├── Agent
│   └── Point Transactions
├── Users
│   ├── Users List
│   ├── Transaction History
│   ├── Game History
│   └── Game Connections
├── Games
│   ├── Providers List
│   └── Games List
├── Statistics
├── API
│   ├── Main API
│   ├── Callback API (Seamless)
│   ├── Callback API Testing
│   ├── Callback API Testing Logs
│   └── API Error Logs
└── Customer Service
```

---

## Games — Providers List

Página: `#/games/providers`

**17 providers disponibles**, todos con estado "Normal".

| ID | Provider | Logo |
|---|---|---|
| 1 | Pragmatic Play | Pragmatic Play |
| 2 | CQ9 | CQ9 |
| 3 | Pocket Games Soft | PG |
| 4 | Booongo | Booongo |
| 5 | Playson | Playson |
| 7 | Habanero | Habanero |
| 9 | JiLi | JiLi |
| 12 | Tydo | Tydo |
| 13 | PlayStar | PlayStar |
| 14 | XGaming | XGaming |
| 15 | Spribe | Spribe |
| 16 | Hacksaw | Hacksaw |
| 17 | **Palace** | Palace |
| 20 | BGaming | BGaming |
| 23 | TADA | TADA |
| 24 | Amusnet | Amusnet |
| 26 | Inout | Inout |

> **Nota:** La info de providers también se puede consultar vía API (Main API → Provider List Search API).

---

## Games — Games List

Página: `#/games/list`

### Filtros de búsqueda

| Filtro | Tipo | Descripción |
|---|---|---|
| Provider | Dropdown | Filtrar por provider específico o "Total" |
| Game Name/Symbol | Texto | Nombre o símbolo del juego |
| State | Checkboxes | Normal / On Maintenance |

### Columnas de la tabla

| Columna | Descripción |
|---|---|
| LOGO | Logo del juego |
| Narrow LOGO | Logo reducido |
| Provider | Nombre del provider |
| Game Name | Nombre del juego |
| Symbol | Código/símbolo del juego (identificador único) |
| Category | Categoría (slots, crash, table, live, etc.) |
| State | Normal / On Maintenance |
| Created Date | Fecha de creación |

> **Importante:** El campo `Symbol` es el ID único del juego que usamos para mapear con nuestro catálogo interno.

---

## Users — Users List

Página: `#/users/list`

### Filtros de búsqueda

| Filtro | Tipo | Descripción |
|---|---|---|
| Parent Agent | Dropdown | Agente padre (nuestra cuenta: `redgardel`) |
| Include sub-agents | Checkbox | Incluir sub-agentes en la búsqueda |
| Name | Texto | Nombre del usuario |
| Id | Texto | ID del usuario |

### Columnas de la tabla

| Columna | Descripción |
|---|---|
| Users | Nombre del usuario |
| Parent | Agente padre |
| Balance | Saldo actual del usuario |
| Create Date | Fecha de creación |
| Functions | Acciones disponibles |
| Deposit Balance | Saldo de depósitos |

> **Nota importante del panel:** "In the case of a seamless wallet method, the balance amount is not collected separately when the user ends the game. It is maintained as the last balance, so please use it as a reference."

Esto confirma que el wallet es **seamless** — el balance se actualiza en tiempo real vía callbacks, no al cerrar el juego.

---

## Users — Transaction History

Página: `#/users/transactions`

### Filtros de búsqueda

| Filtro | Tipo | Descripción |
|---|---|---|
| Parent Agent | Dropdown | Agente padre |
| Period (start~end) | DateTime | Rango de fechas |
| User Name | Texto | Nombre del usuario |
| User Id | Texto | ID del usuario |
| Guid | Texto | ID de la transacción |
| Game Name | Texto | Nombre del juego |
| Type | Checkboxes | Betting, Win, Deposit, Withdraw, Cancel, Bet Error, Win Error |

### Tipos de transacción

| Tipo | Descripción |
|---|---|
| Betting | Apuesta realizada |
| Win | Premio ganado |
| Deposit | Depósito |
| Withdraw | Retiro |
| Cancel | Cancelación de apuesta |
| Bet Error | Error en apuesta |
| Win Error | Error en premio |

---

## Users — Game History

Página: `#/users/games`

### Filtros de búsqueda

| Filtro | Tipo | Descripción |
|---|---|---|
| Corresponding Agent | Dropdown | Agente correspondiente |
| Include sub-agents | Checkbox | Incluir sub-agentes |
| Provider | Dropdown | Filtrar por provider |
| Period (start~end) | Date | Rango de fechas |
| User Name | Texto | Nombre del usuario |
| User Id | Texto | ID del usuario |
| Game Name | Texto | Nombre del juego |

---

## Users — Game Connections (Live)

Página: `#/users/onlines`

**Monitor en tiempo real** — data se actualiza automáticamente cada 10 segundos.

### Filtros

| Filtro | Descripción |
|---|---|
| User Name | Nombre del usuario |
| User Id | ID del usuario |
| Parent | Agente padre |
| Provider | Provider del juego |
| Game Name | Nombre del juego |
| Symbol | Símbolo del juego |

### Columnas

| Columna | Descripción |
|---|---|
| Users | Usuario conectado |
| Parent | Agente padre |
| Provider | Provider activo |
| Game Name | Juego jugándose |
| Symbol | Símbolo del juego |
| Bet | Apuesta actual |
| Win | Premio actual |
| Profit | Ganancia/pérdida |
| Start Time | Inicio de la sesión |
| Function | Acciones (probablemente forzar cierre) |

---

## Mapeo con nuestro sistema

| Sección del panel | Nuestro módulo equivalente |
|---|---|
| Providers List | `games` table (provider_code) |
| Games List | `games` table (code, name, category, config) |
| Users List | `users` + `wallets` |
| Transaction History | `wallet_transactions` |
| Game History | `game_rounds` |
| Game Connections | `game_sessions` (activas) |
| Callback API Testing | `/api/v1/game-provider/palace/callback` (nuestro endpoint) |
