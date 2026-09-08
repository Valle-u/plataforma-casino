# 05 · Ruteo y bandejas — quién atiende qué

> El corazón del sistema. Todo lo demás depende de que esto esté bien.
>
> **La buena noticia: la mitad ya está construida** y funcionando en producción,
> en `apps/api/src/chat/crm-network.service.ts`.

---

## La regla, en una línea

**Atiende la bandeja dueña del canal por el que entró el mensaje** (**D2**).

Sin excepciones, sin bandeja de "sin asignar", sin reparto automático. El canal
por el que alguien elige entrar *es* la información de a quién buscaba.

---

## Las tres redes

| Red | Quién | Bandeja |
|---|---|---|
| **Central** | Admin + empleados | La bandeja central (la del admin principal) |
| **Dependiente** | Socios, distribuidores y cajeros del casino | **Ninguna** — sus jugadores los atiende el staff central |
| **Independiente** | Un socio con `is_independent_branch` y toda su bajada | Cada panel, la suya |

Esto ya lo resuelve `classify()`:

```
¿tiene rol admin_tenant o empleado?     → 'central'
¿tiene un ancestro independiente?       → 'independent'
si no                                   → 'dependent'
```

---

## Ruteo: a qué bandeja va un mensaje

### Por el widget web (lo que ya funciona)

`resolveAssignedOperator(playerUserId)`:

| El jugador es… | Va a… |
|---|---|
| de una red **independiente** | su **operador directo** (el padre inmediato) |
| de la red **dependiente** | la **bandeja central** |

Un jugador nunca clasifica como `central`, así que sólo hay dos caminos.

### Por un canal externo (lo que falta)

**Más simple todavía: va a la bandeja del dueño del canal.** Punto.

No importa de qué red sea quien escribe, ni si lo conocemos:

```
mensaje entrante
  └─ ¿por qué canal entró?
       └─ crm_channels.owner_user_id
            ├─ NULL   → bandeja central
            └─ un id  → bandeja de ese panel
```

> **Por qué no se mira de qué red es el que escribe.** Porque haría que el mismo
> número, escribiendo al mismo lugar, terminara en bandejas distintas según quién
> sea — y eso es imposible de explicarle a un operador. La regla tiene que
> poderse decir en una frase.

### El caso que cruza redes

Un jugador de la red de Litoral le escribe al **WhatsApp central**. Por D2 lo
atiende el staff central, aunque no sea su red.

Ahí aplica **D3**: el staff **puede** responder, ver quién es y ver el cartel de
red; **no ve** su saldo ni sus movimientos; y puede **avisarle** a la bandeja que
corresponde (**D8** — avisar, no mandar la conversación).

---

## Bandejas: qué ve cada operador

`resolveInboxOwner(operatorUserId)`:

| Quién sos | Tu bandeja | Estado |
|---|---|---|
| Admin o empleado | La central | ✅ implementado |
| Red independiente (socio, distribuidor, cajero) | **Sólo la tuya** | ✅ implementado |
| Red dependiente | **Ninguna** (403) | ✅ implementado |

### Un socio NO ve las bandejas de sus cajeros (D10)

Es lo que el código ya hace —le devuelve su propio id— y **quedó confirmado como
decisión**, no como accidente. La conversación entre un cajero y su jugador es la
relación comercial del cajero.

Se descartó darle "todo lo de su bajada" (defendible por P2, y no violaría R6):
es una capacidad de vigilancia que nadie pidió.

> **Queda anotada la alternativa intermedia** para si algún día hace falta: que
> el socio vea **la lista sin el contenido** —quién habló, cuánto se tardó,
> cuántos quedaron sin contestar—. Supervisa la atención sin leer conversaciones
> privadas. Va a [`10-metricas.md`](10-metricas.md).

---

## ⚠️ El agujero que dejan D8 y D10 juntos

Cada decisión es correcta por separado. Juntas, **un cajero que atiende mal queda
invisible para todos**:

- el jugador se queja al central, pero por **D8** esa queja no viaja;
- el socio podría notarlo, pero por **D10** no ve nada de su cajero;
- el cajero recibe un aviso, y puede ignorarlo igual que ignoró al jugador.

El único que se entera es el staff central, y sólo si presta atención a que el
mismo jugador vuelve.

**No hay que cambiar ninguna decisión.** La salida, si el problema aparece, es la
alternativa intermedia de arriba: métricas de atención para el socio, sin
contenido.

---

## ⚠️ Y el que dejan D16 y D17

Mismo patrón, otro par:

```
03:14  Juan escribe
       → Juan no recibe nada    (D17: sin respuestas automáticas)
       → Pérez no se entera     (D16: sólo el panel, y está cerrado)
09:20  Pérez abre el panel
```

Seis horas sin señal **en ninguna de las dos puntas**. Y si Pérez no abre el
panel en dos días, nadie lo sabe.

**Propuesta que no contradice nada y no construye nada nuevo:** sumar
*"conversaciones sin responder"* al **parte diario** que ya manda
`HealthReportCron` todas las mañanas. Ese cron ya tiene un bloque *ESPERANDO
RESPUESTA* con depósitos y retiros pendientes, y ya marca lo que lleva más de
24 h. Es una consulta más en algo que ya corre y ya llega.

---

## Derivar = avisar (D8)

Cuando el staff central manda un caso a la red que corresponde, lo único que
llega es **quién escribió y cuándo**:

```
BANDEJA DEL CAJERO
── Aviso ────────────────────────────────
Juan Pérez escribió al casino hoy 14:32.
Se le pidió que te contacte.
(sin contenido)
```

**Por qué no viaja el contenido:** con D6, el contacto del casino y el del cajero
**ya son dos fichas distintas** — nunca hubo una conversación que mover.
"Derivar" era, en realidad, *copiar*.

Y hay una razón de producto: si el cajero lee la queja que el jugador hizo **sobre
él**, el jugador deja de escribirle al central. Ahí se pierde la única señal que
el casino tiene sobre cómo se atiende en las redes independientes.

**A quién le llega:** al **operador directo** del jugador (su cajero), que es a
quien el ruteo ya le asigna todo lo suyo. No al socio de esa red (**D10**).

**Cómo se guarda:** un mensaje `direction: 'system'` en la conversación de la
bandeja que recibe. Si esa bandeja no tiene conversación con esa persona, se
crea — es el único caso donde una conversación nace sin que el contacto haya
escrito por ese canal.

---

## Lo que falta construir

| | Qué | Depende de |
|---|---|---|
| 1 | Ruteo por dueño de canal | `owner_user_id` en `crm_channels` |
| 2 | El aviso de derivación | mensaje `system` |
| 3 | **Tapar el agujero de `getContext`** | 🔴 requisito del primer canal externo |
| 4 | Cerrar / marcar pendiente / reabrir | nada lo escribe hoy |

### Sobre el punto 3

`chat-crm.service.ts` devuelve **saldo, depósitos y retiros sin chequear la red**.
Hoy es inalcanzable porque el ruteo no lleva jugadores independientes a la bandeja
central. **D3 abre esa puerta.**

---

## Cómo se verifica que esto está bien

Mirando la pantalla no alcanza: un fallo de ruteo no se ve, se filtra. Los tests
que hacen falta:

1. Un mensaje al canal de Pérez **nunca** aparece en la bandeja del casino.
2. Un mensaje al canal central **nunca** aparece en la de Pérez.
3. El staff central, abriendo la ficha de un jugador independiente, **no recibe**
   `wallet`, `recentDeposits` ni `recentWithdrawals`.
4. Un operador **dependiente** recibe 403 en todo el CRM.
5. Un socio independiente **no ve** ninguna conversación de sus cajeros.
6. El aviso de derivación **no contiene** ningún texto del mensaje original.

El 3 y el 6 son los que protegen leyes. Si alguno se rompe, es una filtración
entre redes, no un bug de pantalla.
