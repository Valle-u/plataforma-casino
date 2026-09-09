# 06 · La operación diaria

> Cómo se usa esto un martes cualquiera: estados, no leídos, avisos y cierres.

---

## El ciclo de una conversación

```
        alguien escribe
              ↓
          ● OPEN ──────────────► ✓ RESOLVED
              ↕                        │
          ◐ PENDING                    │ vuelve a escribir
              ↑                        │
              └────────────────────────┘
                    (se REABRE el mismo hilo)
```

Tres estados, ya presentes en `crm_conversations.status`:

| Estado | Qué significa |
|---|---|
| `open` | Alguien espera respuesta |
| `pending` | Se respondió y se espera algo de afuera (que mande un comprobante, que se acredite una transferencia) |
| `resolved` | Terminado |

### 🔴 Hoy nada de esto funciona

La columna existe. **Ningún código la escribe.** Cerrar, marcar pendiente y
reabrir son tres acciones que **hay que construir**. Es lo primero de este
documento que se convierte en tarea.

### Reabrir, no duplicar (D11)

Si una persona vuelve a escribir tres semanas después, **se reabre el mismo
hilo**. No se crea uno nuevo.

Se descartó el hilo por vuelta —más prolijo para medir— por no agregar una capa
de navegación a algo que ya funciona.

**Dos consecuencias que hay que resolver:**

1. **Las métricas hay que calcularlas por tramos**, no por conversación: el hilo
   de Juan lleva ocho meses abierto. Ver [`10-metricas.md`](10-metricas.md).
2. **Reabrir el hilo no reabre la ventana de 24 h de WhatsApp.** Si el último
   mensaje del cliente pasó ese rato, sólo sale una plantilla aprobada. **La
   pantalla tiene que decirlo antes de que el operador escriba**, no después de
   que el mensaje falle.

---

## Los no leídos

Ya funcionan y están bien pensados: `crm_conversations` lleva **dos** contadores.

| Campo | Sube cuando |
|---|---|
| `unread_for_operator` | el mensaje es `inbound` (lo escribió la persona) |
| `unread_for_contact` | el mensaje es `outbound` (lo escribió el operador) |

Dos contadores y no uno, porque las dos puntas leen en momentos distintos.

Se limpian al marcar leído, y el gateway emite `conversation:read` para que la
otra punta lo vea al instante.

---

## Cómo se entera un operador (D16)

**Badge de no leídos en el panel. Nada más.** No sale ningún aviso al celular:
ni Telegram, ni SMS, ni mail.

> El mail, además, **no manda nada**: `ConsoleEmailProvider` está fijo por código
> y sólo escribe en el log. Las notificaciones por mail de toda la plataforma son
> decorativas hoy. Vale saberlo antes de prometer "te avisamos por correo".

### El silencio de las dos puntas

Con **D17** (sin respuestas automáticas) y **D16** juntas, un mensaje de las 3 AM
deja seis horas sin señal para nadie. Y si el operador no abre el panel en dos
días, nadie en el sistema lo sabe.

**Las dos salidas anotadas, en orden de costo:**

1. **Sumar "conversaciones sin responder" al parte diario.** `HealthReportCron`
   ya manda todas las mañanas un bloque *ESPERANDO RESPUESTA* y ya marca lo que
   lleva más de 24 h. Es una consulta más en algo que ya corre.
2. **Avisar por Telegram**, con el bot que ya está andando y verificado. Gratis
   e ilimitado; requiere que el operador le escriba al bot una vez para
   vincularse. Fue la recomendación descartada en D16 y **es la primera mejora a
   agregar** si el problema aparece.

---

## Derivar (D8)

Cuando el staff central atendió a alguien de otra red y quiere mandarlo a donde
corresponde:

```
[ Avisar a su operador ]
        ↓
BANDEJA DEL CAJERO
── Aviso ────────────────────────────────
Juan Pérez escribió al casino hoy 14:32.
Se le pidió que te contacte.
(sin contenido)
```

**Lo que NO pasa:** la conversación no se mueve, no se copia, y el cajero no lee
nada de lo que se habló.

**Lo que el staff central tiene que hacer además:** decirle a la persona que le
escriba a su operador. El aviso solo no cierra el círculo — el operador puede
ignorarlo.

---

## La pantalla del operador

Lo que tiene que estar a la vista, sin clics:

**En la lista:**
- Nombre (o el teléfono, si es un lead)
- Último mensaje y cuándo
- No leídos
- 🏷️ **De qué red es**, si no es de la suya (D3)

**En la conversación abierta:**
- Los mensajes, con sus adjuntos
- Al costado: **la ficha** — quién es, desde cuándo, y lo que
  [`08-permisos.md`](08-permisos.md) permita ver
- Notas internas y etiquetas
- Acciones: responder, marcar pendiente, resolver, avisar, **dar de alta**

**Lo que la pantalla tiene que avisar sola:**

| Situación | Qué mostrar |
|---|---|
| WhatsApp, pasaron 24 h | *"Sólo podés mandar una plantilla aprobada"* — **antes** de escribir |
| El contacto es de otra red | El cartel de red, siempre visible |
| El adjunto se borró por retención | *"(archivo eliminado · retención)"*, no un ícono roto |
| El teléfono matchea con varios jugadores | *"No se pudo identificar"*, sin adivinar |

---

## Lo que NO hay

Vale decirlo para que nadie lo espere:

| | Por qué |
|---|---|
| Reparto automático de conversaciones | El dueño del canal ya define quién atiende (D2) |
| Prioridades, SLA, escalamiento | No es un sistema de tickets |
| Respuestas automáticas | **D17** |
| Un socio mirando a sus cajeros | **D10** |
| Ver que existen conversaciones de otra red | **D7** |

---

## Lo que falta construir

| # | Qué | Tamaño |
|---|---|---|
| 1 | Cerrar / marcar pendiente / reabrir | chico, y **no existe nada** |
| 2 | El aviso de derivación | chico |
| 3 | El cartel de red en la lista y en la ficha | chico |
| 4 | El aviso de la ventana de 24 h | chico, pero **hay que acordarse** |
| 5 | Conversaciones sin responder en el parte diario | chico |
