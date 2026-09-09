# 11 · Cumplimiento: reglas de plataforma, retención y privacidad

> Lo que no decidimos nosotros, y lo que decidimos sobre datos de personas
> reales.

---

## Parte 1 — Las reglas de Meta y Telegram

### WhatsApp: la ventana de 24 horas

Desde el último mensaje **del cliente**, hay 24 horas para responderle
libremente. Después, sólo salen **plantillas aprobadas por Meta**.

**Dónde pega, concretamente:**

| Situación | Qué pasa |
|---|---|
| El jugador escribe y el operador responde en el día | Todo normal |
| El operador responde a las 25 horas | **El mensaje no sale** |
| Se reabre un hilo de hace tres semanas (**D11**) | La ventana **no** se reabre |
| El operador quiere escribir primero | Sólo con plantilla |

**Lo que hay que construir en la v1**, aunque no se manden plantillas: **el aviso
en la pantalla, antes de que el operador escriba.**

### WhatsApp: la verificación, y de quién es la cuenta

Cada número necesita una cuenta de WhatsApp Business verificada con
documentación de una empresa. Por **D13**, esa cuenta **es del socio**.

**Consecuencia de cumplimiento:** el casino **no responde ante Meta** por lo que
mande un socio. Fue la razón principal de decidirlo así — con todos los números
bajo una sola cuenta, una denuncia contra el número de un socio caería sobre la
cuenta de todos, incluido el número central.

**Y la otra cara:** el casino tampoco puede arreglarle el problema a un socio
suspendido. Sólo puede explicarle el trámite.

### Telegram: sólo bots

Automatizar una cuenta personal (*userbot*) viola los términos y termina en la
cuenta cerrada. Y un bot **sólo puede hablarle a quien le escribió primero**.

**Traducción:** Telegram sirve para atender, no para buscar clientes.

### Lo que estas reglas prohíben prometer

- ❌ "Le escribimos a los jugadores que no vuelven" — necesita plantillas
  aprobadas de antemano (y por **D19** está fuera de la v1).
- ❌ "Importamos tu agenda y les escribimos" — Telegram no puede; WhatsApp lo
  cuenta como iniciado por el negocio y es la forma más rápida de que denuncien
  el número.
- ❌ "Usá tu WhatsApp de siempre" — hace falta una cuenta Business verificada.
- ❌ "Usá tu Telegram personal" — sería un userbot.

---

## Parte 2 — Retención

### La regla (D15)

**El texto se guarda para siempre. Los adjuntos se borran a los 6 meses.**

```
[12-mar] Juan: "te mando el comprobante"
         📎 (archivo eliminado · retención)

[hoy] Juan: "acá va"
      📎 comprobante.jpg
```

**Por qué así:** el riesgo no está en el texto, está en las imágenes. Ahí es donde
viajan el DNI, el CBU y la cara de la gente. El texto pesa poco y sirve para
reclamos; la foto pesa, no se busca, y es lo único que hace daño si se filtra.

### Lo que hay que construir

Un proceso periódico que:

1. busque mensajes con adjuntos de más de 6 meses,
2. borre cada archivo de R2,
3. marque el adjunto como eliminado **sin borrar el mensaje**.

> ⚠️ **El borrado en R2 recién funciona desde el 2026-09-06.** Antes sólo escribía
> un warning y los archivos quedaban para siempre. Hay que **verificar que borra
> de verdad**, no darlo por hecho.

### Lo que la retención NO borra

El **comprobante oficial** de un depósito (`deposits/proofs/…`) es otro archivo,
con su propio ciclo de vida. Que se borre la foto que el jugador mandó por chat
no toca el comprobante con el que se aprobó el depósito.

Son dos cosas distintas y confundirlas al implementar el borrado sería grave: se
estaría destruyendo el respaldo de una operación de plata.

---

## Parte 3 — Privacidad

### Los adjuntos ya no son públicos

Hasta el **2026-09-08**, los adjuntos del chat se servían con **URL pública y
caché de un año**. La regla de privacidad del Worker y de la API miraba una sola
carpeta (`/proofs/`) y `chat/attachments` no la cumplía.

O sea que una foto de DNI mandada por el widget quedaba en una URL permanente,
imborrable del borde durante un año.

**Corregido** (**D12**): ahora las dos carpetas son privadas, con URL firmada de
15 minutos. **Falta desplegarlo** — ver
[`../runbooks/firmar-comprobantes.md`](../runbooks/firmar-comprobantes.md).

> **Lo que enseñó:** la regla vive **duplicada** en el Worker y en la API, porque
> el Worker es un bundle aparte que no puede importar de `apps/api`. **Si
> divergen, el fallo es silencioso.** Al agregar una carpeta privada nueva, tocar
> las dos.

### 🔴 Los secretos de canal — decisión abierta

Un token de bot de Telegram controla el bot entero. Un token de WhatsApp permite
mandar mensajes como ese negocio.

**No hay cifrado en ninguna parte de la API** (verificado el 2026-09-08): las
credenciales de proveedores de juego se guardan en texto plano.

**Con D13 el problema cambia de escala:** esos tokens **son de los socios**, no
nuestros. Una filtración de la base expone credenciales de terceros que
confiaron en la plataforma.

Los tres caminos están en [`02-modelo-de-datos.md`](02-modelo-de-datos.md).
**No decidirlo es elegir texto plano.**

### Lo que ve cada uno

Está en [`08-permisos.md`](08-permisos.md). El resumen de privacidad:

- El staff central **no ve la plata** de un jugador de otra red (**R6**). ⚠️ Hoy
  el código sí la devuelve — es el agujero abierto.
- Nadie ve las conversaciones de otra bandeja (**D6**), ni sabe que existen
  (**D7**).
- Un socio **no lee** las conversaciones de sus cajeros (**D10**).
- **Excepción autorizada:** al cerrarse una red, sus conversaciones pasan al
  staff central (**D14**, anotada en `../LEYES.md` bajo R6).

### Lo que un jugador puede pedir

No hay marco legal definido para el casino y este documento no lo inventa. Pero
conviene tener pensado qué se puede responder:

| Pide | ¿Se puede hoy? |
|---|---|
| "¿Qué tenés guardado mío?" | Sí, a mano: sus contactos, conversaciones y adjuntos |
| "Borrá mis conversaciones" | No hay flujo. **El texto se guarda para siempre** (D15) |
| "Borrá mis fotos" | Se puede a mano; a los 6 meses se van solas |

**Queda como hueco conocido**, no como problema resuelto.
