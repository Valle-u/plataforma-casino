# 04 · Identidad: quién es quién, y por qué NO se fusiona

> El archivo se llama "fusión" por el diseño viejo. **La decisión fue no
> fusionar** (D6). Cuando se toque, conviene renombrarlo.

---

## Las dos preguntas, que son distintas

Al llegar un mensaje hay que responder dos cosas, y confundirlas es el error más
fácil de cometer acá:

| | Pregunta | Respuesta |
|---|---|---|
| **1** | ¿De qué **jugador** es este mensaje? | Automático por teléfono (**D4**) |
| **2** | ¿A qué **contacto** pertenece? | Al de la bandeja dueña del canal (**D6**) |

La primera se comparte entre bandejas. La segunda **no**.

```
Juan · +54 9 341 555-1234 · user_id = abc-123
│
├── contacto en la bandeja de Pérez   → user_id = abc-123
└── contacto en la bandeja del casino → user_id = abc-123
        ↑ misma persona, mismo jugador, DOS contactos
```

Las dos fichas saben que son Juan. Ninguna sabe qué habló la otra.

---

## Pregunta 1 — Vincular al jugador (D4)

### Cómo funciona

Llega un mensaje de un número que no está en la base. El sistema busca ese
teléfono entre los jugadores y, si lo encuentra, **lo vincula solo**. Nadie
confirma nada.

### Las tres defensas que esto exige

No son opcionales: son parte de la decisión.

#### 1. Normalizar a E.164 antes de comparar

`3415551234`, `+543415551234` y `0341 15 555-1234` son el mismo número escrito de
tres formas. Sin normalizar, el vínculo falla justo cuando más sirve.

**La normalización va en las dos puntas**: al guardar `users.phone` y al recibir
un mensaje. Comparar un dato sucio contra uno limpio no matchea nunca.

#### 2. Si matchea con más de un jugador, no vincular ninguno

```sql
-- users.phone es text LIBRE, SIN índice único.
-- Nada impide hoy que dos jugadores tengan el mismo número.
```

Casos reales, no teóricos: una pareja que comparte teléfono, un locutorio, un
familiar que anota a otro, un cajero que carga mal un dígito.

**Ante la duda, lead sin vincular.** Mostrar el nombre equivocado —y con él el
saldo y los movimientos equivocados— es mucho peor que no mostrar ninguno.

#### 3. El vínculo se tiene que poder deshacer

Desde la ficha, con un botón, y **quedando registrado quién lo deshizo**. Si el
sistema se equivoca y no hay forma de corregirlo, el error queda para siempre.

### Lo que se aceptó a cambio

D4 eligió el automático puro por sobre "sugerir y que el operador confirme". La
alternativa era más segura y se descartó porque convertía un acierto del sistema
en un clic humano, cientos de veces por semana.

**El riesgo asumido**: un teléfono compartido o mal cargado une a dos personas en
una ficha, **y el operador no ve ninguna señal de que algo pasó**. Las tres
defensas de arriba existen para achicar eso, no para eliminarlo.

### Por canal

| Canal | ¿Llega el teléfono? | Qué pasa |
|---|---|---|
| Web | No hace falta | El jugador está autenticado: se sabe quién es |
| WhatsApp | Sí | D4 funciona de lleno |
| Telegram | **Casi nunca** | Nace como lead; se vincula a mano o si la persona comparte su número |

> En Telegram, "no sabemos quién es" va a ser **lo normal**. La pantalla tiene
> que estar diseñada para eso, no tratarlo como un caso raro.

---

## Pregunta 2 — A qué contacto pertenece (D6)

### La regla

**Un contacto por dueño de canal.** No por canal, y no por casino.

```
Bandeja de Pérez      →  Juan  ·  hilo WhatsApp  +  hilo web
Bandeja del casino    →  Juan  ·  hilo WhatsApp central
                         (dos fichas, mismo user_id)
```

Dentro de una bandeja la persona es **una sola**: Pérez ve un Juan, con sus dos
hilos. Partirlo también ahí no protegería nada —mismo operador, misma red, mismo
jugador— y sólo duplicaría fichas.

### Por qué no se fusiona

Es la lectura más estricta de **R6**.

Con una ficha compartida, **todo lo que se le cuelgue en el futuro es una
superficie de filtración**: notas internas, etiquetas, línea de tiempo, campos
que hoy no existen. Cada uno habría que auditarlo contra R6 de nuevo, para
siempre. Con fichas separadas no hay nada que filtrar, porque el dato no está del
otro lado.

**Lo que cuesta:** el mismo jugador puede tener dos fichas con notas distintas y
nadie las concilia. Es el precio elegido.

### Qué se comparte y qué no

| | ¿Se comparte entre bandejas? |
|---|---|
| El vínculo al jugador (`user_id`) | ✅ sí — es lo que hace D4 |
| Nombre, teléfono, email | ✅ sí, porque salen del jugador |
| **Conversaciones y mensajes** | ❌ **no** |
| **Notas internas** | ❌ no |
| **Etiquetas** | ❌ no |
| **Línea de tiempo** | ❌ no |

Como notas, etiquetas y línea de tiempo cuelgan del **contacto**, quedan aisladas
solas. No hace falta un permiso por cada una.

---

## Lo que el staff central ve de un jugador de otra red

Es donde D3, D6 y D7 se cruzan. La respuesta corta: **la identidad sí, la
operación no**.

| | ¿Lo ve el staff central? |
|---|---|
| Quién es (nombre, teléfono) | ✅ |
| De qué red es — el cartel *"es de la red de Litoral"* | ✅ |
| Su propio hilo con el casino | ✅ |
| **Su saldo** | ❌ **R6** |
| **Sus depósitos y retiros** | ❌ **R6** |
| **Sus conversaciones con su cajero** | ❌ **D6** |
| **Que esas conversaciones existan** (aunque sea un contador) | ❌ **D7** |

> El cartel de red y el botón de derivar **no salen del historial**: salen del
> vínculo al jugador (D4), que dice a qué red pertenece sin contar nada de lo que
> se habló.

### 🔴 Esto hoy no está implementado

`chat-crm.service.ts` arma la ficha del contacto con **saldo, últimos 5 depósitos
y últimos 5 retiros, sin ninguna comprobación de red**.

Hoy no filtra nada porque el ruteo lo hace inalcanzable: el único canal es el
widget web y las conversaciones de un jugador independiente van siempre a su
operador directo.

**Pero D3 abre esa puerta a propósito.** El día que exista el WhatsApp central,
el staff va a poder abrir esa ficha — y con el código actual va a ver la plata.

**Arreglarlo es requisito del primer canal externo, no algo para después.**

---

## Casos de borde, resueltos

| Caso | Qué pasa |
|---|---|
| Un número desconocido escribe al canal de Pérez | Lead **de Pérez** (D5). Lo atiende Pérez (D2). |
| Ese lead se registra como jugador | Cuelga **de Pérez** (D9). El campo es fijo, sin desplegable. |
| El mismo número escribe al canal central | Contacto **nuevo**, de la bandeja central (D6) |
| Dos jugadores tienen el mismo teléfono | **No se vincula ninguno** (D4, defensa 2) |
| Un jugador cambia de teléfono | El contacto viejo queda con el número viejo. Deshacer y rehacer el vínculo a mano (D4, defensa 3). |
| Alguien escribe al central pidiendo cuenta, recomendado por un amigo de Pérez | Se da de alta **en la red central** (D5 + D9). No es un error. La salida es que el staff le pida que le escriba a Pérez **antes** de crear nada. |
| Litoral cierra su red | Sus contactos pasan a `owner = NULL` (central). **Excepción autorizada a R6** — ver D14. |
