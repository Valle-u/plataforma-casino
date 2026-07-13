# 07 — Statistics & Customer Service

---

## Statistics

### Stats Per Day
Página: `#/statistics/byday`

| Filtro | Tipo |
|---|---|
| Credit Rate | Dropdown (All) |
| Corresponding Agent | Dropdown |
| Period (start~end) | Date |

| Columna | Descripción |
|---|---|
| Date | Fecha |
| Category | Categoría (Slot/Live) |
| Betting | Monto apostado |
| Win | Monto ganado |
| Profit | Beneficio (Betting - Win) |
| Betting(Sub) | Apostas de la sub-red |
| Win(Sub) | Premios de la sub-red |
| Profit(Sub) | Beneficio de la sub-red |

Export: **Excel**

### Stats Per Game
Página: `#/statistics/bygame`

| Filtro | Tipo |
|---|---|
| Credit Rate | Dropdown |
| Corresponding Agent | Dropdown |
| Include sub-agents | Checkbox |
| Provider | Dropdown |
| Game Name/Symbol | Texto |
| Period (start~end) | Date |

| Columna | Descripción |
|---|---|
| Agent | Agente |
| Provider | Provider |
| Game Name | Nombre del juego |
| Symbol | Símbolo/ID del juego |
| Betting | Monto apostado |
| Win | Monto ganado |
| RTP | Return to Player |
| Profit | Beneficio |

Export: **Excel**

### Stats Per Agent
Página: `#/statistics/byagent`

| Filtro | Tipo |
|---|---|
| Credit Rate | Dropdown |
| Corresponding Agent | Dropdown |
| Period (start~end) | Date |
| Name | Texto |

| Columna | Descripción |
|---|---|
| ID | ID del agente |
| Agent | Nombre del agente |
| Currency | Moneda |
| Category | Categoría |
| Betting | Monto apostado |
| Win | Monto ganado |
| Profit | Beneficio |
| GGR | Gross Gaming Revenue |
| Currency Rate | Tipo de cambio |
| GGR Fee | Comisión sobre GGR (nuestro 6%) |

Export: **Excel**

### Stats Per User
Página: `#/statistics/byuser`

| Filtro | Tipo |
|---|---|
| Credit Rate | Dropdown |
| Parent Agent | Dropdown |
| Include sub-agents | Checkbox |
| Period (start~end) | Date |
| User Name | Texto |
| User Id | Texto |

| Columna | Descripción |
|---|---|
| Users | Usuario |
| Parent | Agente padre |
| Category | Categoría |
| Betting | Monto apostado |
| Win | Monto ganado |
| Profit | Beneficio |

Export: **Excel**

---

## Customer Service

### Notices Received
Página: `#/customer_service/announce_confirm_list`

Lista de avisos/notificaciones recibidas del proveedor. Filtro por título.

### My Ticket List
Página: `#/customer_service/ticket_list`

| Filtro | Tipo |
|---|---|
| Title | Texto |
| State | Checkboxes (Opened / Closed) |
| Answer | Checkboxes (No Answer / Answer) |

Sistema de tickets de soporte con estados.

### Open Ticket
Página: `#/customer_service/ticket_open`

| Campo | Tipo |
|---|---|
| Type | Dropdown (Technical Support, etc.) |
| Provider | Dropdown |
| Games List | Dropdown |
| Title | Texto |
| Content | Textarea (rich text) |

Para abrir tickets de soporte técnico al proveedor.
