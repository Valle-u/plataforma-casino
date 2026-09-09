# 09 · Respuestas rápidas y automatismos

> Documento corto por decisión: **no hay bots** (**D17**). Lo que sí hay son
> respuestas guardadas para escribir más rápido.

---

## Dos cosas distintas con el mismo nombre

Es la confusión más fácil de esta sección y conviene cortarla de entrada:

| | Qué es | Quién la aprueba |
|---|---|---|
| **Respuesta rápida** (`crm_templates`) | Un texto guardado con un atajo (`/deposito`) que el operador inserta al escribir | Nadie: la escribe el casino |
| **Plantilla de WhatsApp** | Un mensaje que Meta revisó y autorizó | **Meta**, uno por uno, con demora |

**No tienen nada que ver.** Al implementar conviene llamarlas por nombres
distintos en el código y en la pantalla.

---

## Respuestas rápidas — ya funcionan

`crm_templates`: `{ id, title, body, shortcut, created_at }`, con endpoints de
listar, crear y borrar.

**Para qué sirven de verdad:** un cajero explica cómo cargar fichas veinte veces
por día. Escribirlo veinte veces es donde se pierde el tiempo y donde aparecen
las respuestas distintas para la misma pregunta.

**Lo que les falta:** son **por tenant**, no por dueño de canal. O sea que el
catálogo de respuestas es compartido entre todas las bandejas.

> **¿Está mal?** No necesariamente. Una respuesta rápida no tiene datos de nadie:
> es un texto genérico. Compartirlas es hasta útil — un socio nuevo arranca con
> las del casino en vez de con la hoja en blanco.
>
> **Pero hay que decidirlo**, no dejarlo pasar: si un socio escribe una respuesta
> con su nombre y su horario, aparece en la bandeja de todos. **Recomendación:**
> dejarlas compartidas en la v1 y ver si molesta. Es más fácil separarlas después
> que unificarlas.

---

## Automatismos: ninguno (D17)

**El sistema no manda ningún mensaje escrito solo.** Ni aviso de horario, ni menú
de opciones, ni confirmación de recibido.

**Por qué.** Cero código y ningún riesgo de que un mensaje automático diga algo
confuso sobre plata — que es de lo único que se habla en este chat.

### Lo que se descartó, para no volver a discutirlo desde cero

**Un aviso de horario** (*"te respondemos de 9 a 22"*). Le habría dicho a la
persona que su mensaje llegó y cuándo esperar respuesta.

**Un menú de opciones** al primer contacto (1 cargar, 2 retirar, 3 otra cosa).
Habría dejado la conversación etiquetada antes de que la lea un humano. Se
descartó también porque a mucha gente le molesta que le conteste una máquina, y
si su caso no está en el menú escribe igual.

### ⚠️ Lo que esto implica

Alguien que escribe a las 3 de la mañana **no recibe ninguna señal** de que su
mensaje llegó. Y por **D16** el operador tampoco se entera hasta que abre el
panel.

Es el cruce documentado en [`05-ruteo-y-bandejas.md`](05-ruteo-y-bandejas.md).
**No hay que cambiar la decisión** — la salida barata es sumar las conversaciones
sin responder al parte diario que ya se manda todas las mañanas.

---

## El único mensaje que escribe el sistema

Hay una excepción, y es interna: **el aviso de derivación** (**D8**).

```
BANDEJA DEL CAJERO
── Aviso ────────────────────────────────
Juan Pérez escribió al casino hoy 14:32.
Se le pidió que te contacte.
```

**No es una respuesta automática**: no sale del casino, no lo lee el jugador, y
no va por ningún canal externo. Es un mensaje `direction: 'system'` en una
conversación interna.

Aun así conviene tratarlo con cuidado: es **el único punto del sistema donde un
dato cruza de una bandeja a otra**. El armado del texto tiene que ser una función
chica, sola y con test — no un `template string` en medio de un servicio.

---

## Plantillas de WhatsApp: fuera de la v1

Hacen falta para dos cosas, y ninguna va en la primera versión:

1. **Escribirle a alguien fuera de las 24 horas.**
2. **Campañas y mensajes masivos** — explícitamente afuera (**D19**).

**Lo que sí hay que construir en la v1**, aunque no se manden plantillas: **el
aviso de que la ventana se cerró**, antes de que el operador escriba. Un operador
que escribe tres párrafos y recibe un error es un operador que deja de usar la
herramienta.

---

## Si algún día se agregan bots

Anotado para el que lo retome, no como plan:

- **Nunca sobre plata.** Un bot que diga algo sobre saldos, cargas o retiros es
  la peor idea posible en este dominio.
- **Salida siempre visible.** *"Escribí cualquier cosa para hablar con una
  persona"*, en el primer mensaje.
- **Por dueño de canal, no global.** Un socio tiene otro horario y otro tono que
  el casino.
- **Nunca fuera de la ventana de 24 h**, o Meta lo cuenta como mensaje iniciado
  por el negocio.
