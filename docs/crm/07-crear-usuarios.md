# 07 · Dar de alta un jugador desde el chat

> Alguien escribe pidiendo cuenta. El operador se la crea sin salir de la
> conversación.
>
> Regla: **el jugador cuelga del dueño del canal, y el campo es fijo** (**D9**).

---

## Por qué el campo es fijo

Sin desplegable **no hay forma de colgarse un jugador que no corresponde** — ni
por error ni a propósito.

En un sistema donde de quién cuelga un jugador **determina las comisiones**, un
campo editable es una tentación permanente. Se descartó explícitamente la versión
"editable dentro de la propia bajada": si algún día hace falta reasignar, que sea
una acción aparte, explícita y auditada, no un desplegable en el formulario de
alta.

```
Canal: WhatsApp de Pérez (cajero, red Litoral)
→ jugador nuevo cuelga de Pérez
   [ operador: Pérez · fijo, no editable ]
```

---

## Lo que ya existe

**`POST /tenant/users`**, con permiso `users.create`. Y ya trae algo que sirve
directo: cuando crea un jugador, **lo cuelga solo del operador que lo crea**
(convención `jugador_de_<rol>`). Si lo crea un `admin_tenant`, queda root.

O sea que el 80% del alta ya está. Lo que falta es el pedazo del CRM.

---

## ⚠️ El detalle donde no coinciden

El endpoint actual cuelga al jugador **del que lo crea**. D9 dice que tiene que
colgar **del dueño del canal**.

Casi siempre es lo mismo — el que atiende es el dueño del canal — **pero no
siempre**:

| Quién atiende | Canal | Cuelga hoy de… | Debería colgar de… |
|---|---|---|---|
| El cajero Pérez | el suyo | Pérez | Pérez ✅ |
| Un **empleado de Litoral** | el de Litoral | **el empleado** ❌ | Litoral |
| Un **empleado del casino** | el central | **el empleado** ❌ | el admin (root) |

Los socios independientes pueden tener empleados (**R7**), así que el caso no es
teórico.

**La consecuencia si no se corrige:** el jugador queda colgado de un empleado, y
la cadena de comisiones se calcula sobre un árbol equivocado. No es un problema
de pantalla: es plata.

**Cómo se resuelve:** el alta desde el CRM no usa "el actor" como padre, usa
`crm_channels.owner_user_id` de la conversación. Es un parámetro explícito, no la
inferencia por defecto del endpoint.

---

## El flujo

```
1. El operador está en la conversación de un LEAD
2. Toca [ Crear jugador ]
3. El formulario viene pre-cargado:
     usuario     ← lo propone el sistema, editable
     nombre      ← del contacto, editable
     teléfono    ← del contacto, NO editable (es la llave, D4)
     operador    ← dueño del canal, NO editable (D9)
4. Se crea
5. El contacto deja de ser lead: is_lead = false, user_id = el nuevo
6. La conversación sigue abierta, en la misma bandeja
```

**Lo que NO cambia el alta:** la bandeja. El contacto ya era del dueño del canal
por **D5**; darlo de alta no lo mueve a ningún lado.

---

## La contraseña

Es la parte incómoda: **hay que dársela a alguien que está del otro lado de un
WhatsApp**.

| Opción | Problema |
|---|---|
| Mandarla por el chat | Queda escrita en la conversación, y en WhatsApp queda en **el teléfono del jugador y en el del operador**, para siempre |
| Que el jugador la elija por un link | Un paso más, pero la contraseña no pasa por ningún chat |
| Temporal, con cambio obligatorio al primer ingreso | Intermedio: si se filtra, sirve una sola vez |

**Recomendación: la tercera**, que es además lo que la plataforma ya sabe hacer
(`POST /tenant/users/:id/reset-password` existe).

> **Queda como decisión abierta.** No se planteó en ningún bloque y hay que
> resolverla antes de construir el alta — no después, porque cambia la pantalla.

---

## Quién puede

Hereda el permiso que ya existe: **`users.create`**.

| Quién | ¿Puede? |
|---|---|
| Admin | ✅ |
| Empleado con `users.create` | ✅ — pero el jugador cuelga del **dueño del canal**, no de él |
| Socio / distribuidor / cajero **independiente** | ✅ en su canal |
| Operador **dependiente** | ❌ — no tiene acceso al CRM (D1) |

No hace falta un permiso nuevo. Sí hace falta que el CRM **no** deje elegir el
padre, que es lo que agrega D9 sobre el endpoint existente.

---

## El efecto comercial que hay que saber

Alguien que escribe **primero al número central** —aunque un amigo que juega con
Pérez se lo haya recomendado— se da de alta **en la red central**. Por **D5** el
lead es del casino, y por **D9** cuelga de ahí.

**No es un error.** Es el sistema funcionando. Pero es plata que cambia de rama, y
los operadores tienen que saberlo: **el que quiere el jugador tiene que hacer que
le escriba a su número.**

Si el caso se vuelve frecuente, **la salida NO es abrir el desplegable**: es que
el staff central le pida que le escriba a su cajero **antes** de crear nada.

---

## Casos de borde

| Caso | Qué pasa |
|---|---|
| El teléfono ya es de un jugador | No es un lead: **D4 ya lo vinculó**. No se ofrece crear. |
| El teléfono matchea con **varios** jugadores | No se vinculó ninguno (D4). Se puede crear, pero la pantalla tiene que avisar que hay homónimos. |
| El lead escribió por Telegram y no dio teléfono | Se puede crear igual, con el teléfono a mano. **No queda vinculado por D4** hasta que ese número exista. |
| Se crea y después resulta que ya tenía cuenta | Quedan dos jugadores. **Fusionar jugadores no existe** en la plataforma y no lo agrega el CRM. |
| El operador se equivoca de conversación | El jugador cuelga de quien correspondía a **esa** conversación. Sin reasignación, hay que corregirlo por fuera. |

Los dos últimos son los que más van a doler y **ninguno se resuelve acá**: son
huecos de la plataforma, no del CRM. Conviene tenerlos anotados antes de que
aparezcan en producción.
