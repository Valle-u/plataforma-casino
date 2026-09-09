# 08 · Permisos — qué ve y qué puede hacer cada rol

> Las dos preguntas del CRM son **quién entra** y **qué ve de la ficha**. La
> primera ya está resuelta en el código; la segunda tiene un agujero abierto.

---

## Las leyes que aplican

| Ley | Qué dice | Dónde pega |
|---|---|---|
| **R6** | El admin ve de la red independiente sólo agregados, no el detalle interno | La ficha del contacto |
| **P1** | Permiso **y** scope del target; nunca cruzar redes | Todo |
| **P2** | Regla del techo: los empleados quedan capados al techo de su operador | Los empleados |
| **E8 / P3** | Nadie de afuera mueve fichas de una red independiente | **No aplican**: el CRM no mueve plata |

> Si algún día se agrega "cargar fichas desde el chat", E8 y P3 vuelven a aplicar
> y hay que replantear este documento entero.

---

## Quién entra al CRM

Resuelto por `CrmAccessGuard` + `resolveInboxOwner`. **Ya funciona.**

| Rol | ¿Entra? | Su bandeja |
|---|---|---|
| `admin_tenant` | ✅ | La central |
| `empleado` | ✅ | La central |
| Socio / distribuidor / cajero **independiente** | ✅ | **Sólo la suya** |
| Socio / distribuidor / cajero **dependiente** | ❌ **403** | — |
| `usuario_final` | Widget, no panel | — |

**Por qué los dependientes no entran:** por **D1**, en la red central los canales
son del casino y los atiende el staff central. No es una restricción del CRM: es
el modelo.

---

## Qué ve de la ficha

Acá está lo delicado. La ficha (`getContext`) trae identidad, saldo, últimos 5
depósitos, últimos 5 retiros y el operador del que cuelga.

### La tabla que hay que respetar

| Dato | Su propia red | **Otra red (independiente)** |
|---|---|---|
| Nombre, teléfono, email | ✅ | ✅ |
| Desde cuándo es jugador | ✅ | ✅ |
| Cartel *"es de la red de Litoral"* | — | ✅ **siempre visible** |
| **Saldo** | ✅ | ❌ **R6** |
| **Depósitos y retiros** | ✅ | ❌ **R6** |
| **De qué operador cuelga** | ✅ | ⚠️ sólo la red, no el operador |
| Conversaciones de la otra bandeja | ❌ **D6** | ❌ **D6** |
| Que esas conversaciones existan | ❌ **D7** | ❌ **D7** |

### 🔴 Hoy esto no está implementado

`chat-crm.service.ts` devuelve `wallet`, `recentDeposits` y `recentWithdrawals`
**sin ninguna comprobación de red**.

**Hoy no filtra nada**, porque el ruteo lo hace inalcanzable: el único canal es el
widget web y las conversaciones de un jugador independiente van siempre a su
operador directo, nunca a la bandeja central.

**Pero D3 abre esa puerta a propósito.** El día que exista un WhatsApp central, el
staff va a poder abrir la ficha de un jugador de otra red — y con el código actual
va a ver su plata.

**Es requisito del primer canal externo.** No es deuda para después: es la
condición para prender WhatsApp o Telegram en un canal central.

### Cómo se arregla

`getContext` ya recibe el contacto. Le falta comparar **la red del jugador**
contra **la red del que pregunta**:

```
si clasificar(jugador) === 'independent'
   y clasificar(operador) === 'central'
   → devolver identidad + cartel de red
   → NO devolver wallet, recentDeposits, recentWithdrawals
```

`CrmNetworkService.classify()` ya hace las dos clasificaciones. Es una condición,
no un módulo nuevo.

> **Que no devuelva los campos, no que la pantalla los esconda.** Si el dato sale
> de la API, ya salió: cualquiera que mire la respuesta lo ve.

---

## Qué puede hacer

| Acción | Permiso | Nota |
|---|---|---|
| Ver su bandeja | `CrmAccessGuard` | Ya funciona |
| Responder | idem | Ya funciona |
| Notas y etiquetas | idem | Ya funciona; cuelgan del contacto, o sea que se aíslan solas (D6) |
| Plantillas | idem | Ya funciona |
| **Cerrar / pendiente / reabrir** | idem | ⬜ **no existe** |
| **Avisar a otra bandeja** (D8) | idem | ⬜ no existe |
| **Dar de alta un jugador** | **`users.create`** | ⬜ falta la parte del CRM (ver [`07`](07-crear-usuarios.md)) |
| **Cerrar una red** | 🔴 **nuevo y delicado** | Ver abajo |

---

## El permiso más delicado de todos: cerrar una red

**D14 autoriza una excepción a R6**: cuando una red independiente se cierra, sus
conversaciones pasan a la bandeja central y las lee el staff — **incluidos los
empleados**.

**El cierre es lo único que separa lo permitido de lo prohibido.** Si se pudiera
cerrar y reabrir una red sin dejar rastro, la excepción se convertiría en un
interruptor para leer la red de cualquiera.

Por eso:

1. **Sólo el admin.** Nunca un empleado, por más permisos que tenga. Es una
   excepción a una ley: no se delega.
2. **Auditado en `audit_log`**: quién, cuándo, por qué.
3. **No hay un botón de "ver las conversaciones de Litoral".** La herencia es
   consecuencia del cierre, jamás una acción propia.
4. **Reabrir la red no deshace la herencia.** Ya fueron leídas; pretender lo
   contrario sería mentir en la pantalla.

> Hoy **la baja de un socio no existe como flujo** en ninguna parte de la
> plataforma. Se construye desde cero, y con el cuidado que pide una excepción
> autorizada a una ley.

---

## Los empleados y la regla del techo (P2)

Un empleado queda capado al techo de su operador. En el CRM eso significa:

- Un empleado del casino ve **la bandeja central**, no más.
- Un empleado de un socio independiente ve **la bandeja de ese socio**, no la de
  sus cajeros (**D10** aplica igual: el techo no es una llave hacia abajo).

> ⚠️ Y ver [`07-crear-usuarios.md`](07-crear-usuarios.md): al dar de alta, el
> jugador tiene que colgar **del dueño del canal**, no del empleado que lo creó.
> El endpoint actual hace lo segundo.

---

## Los seis tests que protegen esto

Un fallo de permisos acá no se ve: se filtra. Mirando la pantalla no alcanza.

1. Un mensaje al canal de Pérez **nunca** aparece en la bandeja del casino.
2. Un mensaje al canal central **nunca** aparece en la de Pérez.
3. El staff central, sobre un jugador independiente, **no recibe** `wallet`,
   `recentDeposits` ni `recentWithdrawals`. ← **el que falta hoy**
4. Un operador dependiente recibe **403** en todo el CRM.
5. Un socio independiente **no ve** ninguna conversación de sus cajeros.
6. El aviso de derivación **no contiene** ningún texto del mensaje original.

El 3 y el 6 protegen leyes directamente. Si alguno se rompe, es una filtración
entre redes.
