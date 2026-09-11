# 27 · Ruleta diaria

> Diseño acordado con el dueño el **2026-09-10**. Este documento manda sobre la
> implementación: si el código hace otra cosa, el código está mal.
>
> **Estado: aprobado para construir, sólo en `staging`.** Sin fecha de
> producción — la pone el dueño mirando cómo se comporta.
>
> Leyes que toca: **E1, E2, E3, E8, R5, R7, R8, C1, C4b, P1, P2**. Cada una
> aparece citada donde corresponde.

---

## 1. Qué es y para qué

Una rueda que el jugador gira **una vez por día** y le da un premio. El objetivo
es **fidelidad**: que vuelva todos los días. No es adquisición ni reactivación —
esa distinción es la que decide la tabla de premios: **muchos premios chicos y
frecuentes** antes que pocos y grandes.

De ahí se desprende casi todo lo demás:

- **El giro no se acumula.** El que no giró hoy, lo perdió. Un giro que se
  guarda convierte la ruleta diaria en una ruleta semanal y mata el motivo para
  entrar.
- **Casi siempre gana algo.** El que gira y no gana nunca, deja de girar.
- **El premio no es plata retirable**, es bono con exigencia de juego (§5).

---

## 2. Lo que ya existe (y lo que está mal)

Esto **no se construye de cero**. Hay un módulo `promotions` con la ruleta
funcionando desde julio de 2026: motor de sorteo, panel de configuración y
pantalla de jugador.

| Pieza | Dónde | Sirve |
|---|---|---|
| Motor del sorteo | `apps/api/src/promotions/daily-wheel.service.ts` | ✅ Sorteo ponderado, idempotente por día, guarda el RNG |
| Entrega del premio | `promotions/prize-awarder.service.ts` | 🟡 `chips` y `bonus` sí; `free_spins` **no entrega nada** |
| Endpoints | `promotions.controller.ts` | 🟡 Existen, sin control de rol ni de red |
| Editor del admin | `components/admin/wheel-config-editor.tsx` | ✅ Segmentos y probabilidades |
| Pantalla del jugador | `apps/web/app/play/wheel/page.tsx` | ✅ Rueda, animación, historial |
| Trazabilidad | `promotion_rewards` + `audit_log` + `wallet_transactions` | ✅ Cumple **E2** |

**Los seis agujeros que este diseño cierra:**

1. **`free_spins` miente.** Si se configura un segmento de tiradas gratis, el
   awarder loguea un warning, no entrega nada, y el reward se escribe igual. El
   jugador ve el confetti y no recibe la tirada. Se **bloquea el tipo** (§6).
2. **Cualquiera puede girar.** El endpoint pide sólo sesión: un cajero, un socio
   o un empleado gira y cobra fichas de la Casa. Para premios en fichas no lo
   frena nada. Viola el espíritu de **R8** y abre un canal de fuga.
3. **Llega a las redes independientes.** `listActiveForPlayer` no filtra por
   red, y el funder es la Casa → **la Casa fondea una red independiente**, que
   es exactamente lo que **E8** prohíbe.
4. **No hay tope.** Consume saldo de la Casa hasta agotarlo.
5. **El premio en fichas es plata retirable.** `promo_reward` acredita el
   balance común; sólo `bonus_credit` toca el `bonus_balance`. O sea: gira, gana
   200, retira 200, sin haber jugado nada.
6. **Editar la config rompe el historial.** Al cambiar los segmentos, los giros
   viejos apuntan a un `segmentId` que ya no existe; el código devuelve un
   segmento sintético para no explotar. No se puede reconstruir qué rueda giró.

---

## 3. Quién puede girar

**Sólo el rol `usuario_final`.** Ningún operador, ni empleado, ni admin. El
backend valida el rol antes de sortear, no después.

| Condición | ¿Gira? |
|---|---|
| Jugador registrado, sin haber depositado nunca | **Sí**, desde el día que se registra |
| Cuenta suspendida o bloqueada | No, y no ve la sección |
| Autoexcluido por juego responsable | No, y no ve la sección |
| Multicuenta **confirmada** (las cuentas de más) | No |
| Cualquier operador (socio, distribuidor, cajero, empleado, admin) | No |
| Jugador de una red **independiente** | No — ver §7 |
| Cuentas de prueba internas | **Sí** — decisión del dueño |

> ⚠️ **Las cuentas de prueba no quedaron excluidas.** Van a sumar al gasto y a
> las métricas como un jugador más. Está dicho a propósito acá para que, cuando
> los números no cierren, se sepa por qué.

> ⚠️ **Combinación de riesgo, asumida a conciencia.** Fidelidad + gira desde el
> registro + el enganche del antifraude diferido (§11) es el escenario más
> expuesto a cuentas múltiples que se puede armar. **Lo que lo contiene es el
> tope diario** (§6): pone un techo duro a lo que se puede sacar por día, sin
> importar cuántas cuentas se abran. Es la única contención real hasta que
> exista el límite de 2 cuentas por persona, que es proyecto aparte (§15).

---

## 4. El día y el ritmo

- **Un giro por día.**
- **El día corta a medianoche argentina**, no UTC. Hoy el código usa
  `now.toISOString().slice(0,10)`, o sea medianoche UTC = **21:00 AR**: el
  jugador pierde el día a las nueve de la noche y a las 21:01 gira otra vez.
  Dos giros en la misma noche.
- **No se acumulan.**
- **Sin giros extra.** Nada de "ganá tiradas invitando a un amigo" en esta
  versión.
- Si el jugador **cierra el navegador a mitad del giro**, al volver ve el mismo
  premio. El resultado se decide y se guarda antes de animar nada: cortar la
  conexión no vuelve a sortear. Es lo que impide repetir el sorteo hasta que
  guste, y ya funciona así por la clave de idempotencia.

**Implicación técnica del huso:** el ancla del día pasa de `YYYY-MM-DD` en UTC a
`YYYY-MM-DD` en la zona del casino. La zona es **configurable por tenant**, con
`America/Argentina/Buenos_Aires` de default. La clave de idempotencia sigue
siendo `daily_spin:<promoId>:<userId>:<anclaDelDía>`, que es lo que garantiza el
giro único aunque lleguen dos pedidos a la vez.

---

## 5. Los premios

### 5.1 Todo premio en fichas es bono, no plata retirable

**Decisión del dueño.** El premio se acredita como **bono** (`bonus_credit`,
sobre el `bonus_balance`), con **exigencia de juego (rollover)**: el jugador
tiene que apostarlo N veces antes de poder retirarlo.

Por qué importa: con plata retirable, el jugador gira, gana 200 y retira 200 —
la Casa perdió 200 limpios. Con rollover, el premio vuelve casi entero por la
ventaja de la casa. **El costo real es una fracción del costo nominal**, y esa
diferencia es lo que hace sostenible regalar todos los días.

Esto respeta **R8**: el `bonus_balance` es exclusivo de jugadores, y como sólo
giran jugadores (§3), no hay conflicto.

### 5.1b ⚠️ El rollover NO se aplica, y eso cambia los números

**Descubierto el 2026-09-10 al implementar la etapa 3.** El campo `wagering` de
las planillas se guarda, se exporta a CSV y **nadie lo lee**: no hay motor que
cuente apuestas contra el requisito. El comentario del propio esquema lo dice
—*"sin wagering tracking todavía"*— y se verificó que ningún código lo consume.

**Lo que sí se cumple**, y es la protección real:

- El bono **hay que jugarlo**: las apuestas consumen primero el saldo real y
  después el bono (decisión del dueño del 2026-09-03, implementada en
  `placeBetWithBonus`, y los tres proveedores la usan).
- El bono **no se retira directo**.
- El bono **vence** si no se usa.

**Lo que no**: "apostarlo N veces". El rollover efectivo es **x1** — el jugador
apuesta el bono una vez y lo que gane ya es retirable.

**Consecuencia sobre la plata, que es lo que importa.** El argumento de §5.1 era
que con rollover el premio vuelve casi entero a la Casa y por eso el costo real
sería una fracción del nominal. Con x1 y un RTP de ~95%, de cada 100 fichas de
bono el jugador se queda con ~95 retirables: **el costo real es casi el nominal,
aproximadamente el doble de lo que se asumió al armar la tabla de §5.4.**

El dueño decidió (2026-09-10) **salir sin rollover** y ajustar los números, en
vez de construir el motor. El motor queda como proyecto aparte: toca el camino
de la plata y los callbacks de los tres proveedores.

> **Al armar la tabla y el tope, contá el costo como el nominal.** Si algún día
> se construye el motor de wagering, los números se pueden aflojar — no al
> revés.

### 5.2 Rollover y vencimiento, configurables por premio

Cada segmento define su propio rollover y su propio vencimiento. **Pero el
rollover no se aplica todavía** (§5.1b): configurarlo hoy deja constancia de la
intención y no cambia el comportamiento. El **vencimiento sí** se aplica.

Viven en la planilla (`bonus_definitions`), no en el premio: el grant no acepta
override. Por eso la ruleta usa **una planilla por nivel** —una por combinación
de rollover y vencimiento— y cada gajo apunta a la suya. Se eligió así
explícitamente para **no tocar una línea del otorgamiento de bonos**, que es
área sensible y la usan todas las promociones, no sólo la ruleta.

### 5.3 Planillas propias

La ruleta usa **planillas dedicadas**, no las de bienvenida o recarga. Así todo
lo que sale de la ruleta se identifica solo en los reportes y no se mezcla con
el resto del gasto en promociones.

**El premio en fichas retirables está prohibido por código**: una ruleta con un
segmento `prize.kind='chips'` no se puede guardar. Una decisión que no se hace
cumplir dura hasta el primer descuido.

> Quién paga: el funder de la **planilla**. Para una planilla del admin eso se
> redirige a la tesorería `__casa__` por **E3** (ver `docs/15` §0), no a la
> wallet del admin.

### 5.4 Tabla propuesta

Doce gajos, para calzar con la geometría del diseño (§13). **Es un punto de
partida**, no un número sagrado: la idea es que el dueño mueva montos y
probabilidades mirando el costo esperado.

| # | Etiqueta en la rueda | Premio | Rollover | Prob. |
|---|---|---|---|---|
| 0 | 15 FICHAS | bono 15 | x1 | 26 % |
| 1 | 25 FICHAS | bono 25 | x1 | 20 % |
| 2 | 10 FICHAS | bono 10 | x1 | 18 % |
| 3 | 50 FICHAS | bono 50 | x3 | 8 % |
| 4 | 40 FICHAS | bono 40 | x3 | 6 % |
| 5 | SUERTE LA PRÓXIMA | nada | — | 5 % |
| 6 | 2.500 FICHAS · JACKPOT | bono 2.500 | x10 | 0,05 % |
| 7 | 100 FICHAS | bono 100 | x5 | 2,5 % |
| 8 | 20 FICHAS | bono 20 | x1 | 7 % |
| 9 | 200 FICHAS | bono 200 | x8 | 0,8 % |
| 10 | 500 FICHAS | bono 500 | x10 | 0,15 % |
| 11 | SUERTE LA PRÓXIMA | nada | — | 6,5 % |

**Costo nominal esperado: ≈ 24,6 fichas por giro.**

⚠️ **Contá ese número como el costo real, no como el nominal.** La versión
original de esta tabla suponía que el rollover devolvía buena parte a la Casa y
que el costo real sería una fracción. **No es así: el rollover no se aplica**
(§5.1b). Con un RTP de ~95%, el jugador se queda con ~95 de cada 100 fichas de
bono. Si la tabla se dimensionó pensando en una fracción, está subestimada por
un factor de dos.

Lo que sigue sin saberse y **hay que medir en `staging`** (§12): cuánto del bono
termina realmente perdido en el juego contra cuánto se retira. El RTP da una
estimación; el dato real sale de mirarlo.

**Gana algo el 88,5 % de los giros.** El 11,5 % restante son los dos gajos
vacíos.

**Dos gajos vacíos y no uno**, en lados opuestos de la rueda (5 y 11). Le dan al
tope agotado (§6.3) un lugar creíble donde caer: un único gajo perdedor que
además fuera el que sale siempre después del tope se nota mucho más.

**No hay "girá de nuevo".** Venía del diseño y se descartó: devolvía la tirada,
o sea que el jugador giraba dos veces el mismo día y la regla de un giro
diario quedaba con una excepción. Esa probabilidad se repartió entre los
premios chicos.

---

## 6. La plata: tope, funder y qué pasa cuando se acaba

### 6.1 Quién paga

La **tesorería (`__casa__`)**, como todo grant de la red dependiente
(**E3**, y la tabla de resolución del funder de `docs/15-engagement-promos.md`).

### 6.2 Tope diario

**Un número fijo de fichas por día, configurable desde el panel** y modificable
en cualquier momento. No es por jugador: es **el techo de toda la ruleta en el
día**.

Es la contención principal de todo el sistema. Sin importar cuántas cuentas se
abran ni cuánta suerte tengan, el gasto de un día no pasa de ese número.

### 6.3 Qué pasa cuando se agota

**La ruleta sigue funcionando. No se deshabilita.** Lo que cambia es que a
partir de ahí **sale siempre el gajo 11, "SUERTE LA PRÓXIMA"**.

Ese gajo es un segmento **legítimo de la rueda**: puede salir por mala suerte
en cualquier momento del día, tope o no tope. Cuando el tope se agota, deja de
ser azar y pasa a ser seguro.

> **Esto es una decisión explícita del dueño, tomada después de que se le
> planteara el reparo.** El jugador no puede distinguir "mala suerte" de "se
> acabaron los premios del día": son visualmente idénticos. La consecuencia
> asumida es que, después de cierta hora, nadie gana nunca, y eso es detectable
> por cualquiera que compare. Queda escrito acá para que ningún agente futuro lo
> tome por un bug y lo "arregle" por su cuenta.

### 6.4 Cómo se cuenta el gasto del día

Sumando los rewards del día en curso, **no** con un contador aparte. Un
contador es una segunda copia del mismo hecho y se puede desincronizar; la suma
no puede mentir porque es el hecho mismo. Es el mismo criterio que **D22** del
CRM.

El costo: hay que sumar en cada giro. Con el índice adecuado sobre
`(promotion_id, granted_at)` es barato al volumen del proyecto, y si algún día
deja de serlo, se cachea **derivando**, no duplicando.

**Contra las carreras**: la verificación del tope y la inserción del reward van
en la **misma transacción**, con `FOR UPDATE` sobre la fila de la promoción. Sin
eso, dos jugadores que giran en el mismo milisegundo pueden pasar los dos el
control y dejar el gasto por encima del tope.

### 6.5 El efecto sobre las comisiones (C1 / C4b)

**El costo de la ruleta se descuenta de la base de comisión.**

El problema, si no se hiciera: la Casa le regala 100 fichas a un jugador, el
jugador las pierde jugando, y eso **sube el NetWin** de su cadena. El operador
cobra comisión sobre plata que regaló la Casa. **La Casa paga dos veces**: el
regalo y la comisión sobre el regalo.

La mecánica es la misma que ya usa el fee del proveedor en **C4b**: se resta de
la base **antes** de aplicar las tasas. Y con el mismo cuidado: **sólo sobre
bases positivas**, porque una red que perdió no debería ver su deuda reducida
por los regalos que recibió.

---

## 7. Redes: sólo la central

**La ruleta se ofrece únicamente a jugadores cuya línea sube a la Casa.** Los
jugadores de una sub-red independiente **no la ven** — no les aparece la sección
ni el ítem en el menú.

**Por qué**: los premios los paga la Casa. Dárselos a un jugador de una red
independiente es que un actor externo fondee esa red, y eso es **E8**. No hay
matiz: es la ley más dura de las económicas.

**Qué se pierde**: el socio independiente no puede ofrecer ruleta a su gente.
Que la tenga exige que la fondee **de su propia banca** (**R4**), con scope por
rama, dueño, permisos y control de saldo. Es el "v2" que
`docs/15-engagement-promos.md` ya anticipa y **queda fuera de esta versión**.

**Implementación**: el filtro va en el backend, en los **dos** lados —
`listActiveForPlayer` (para que no la vea) y el endpoint de giro (para que no
pueda girar aunque arme el pedido a mano). Lo primero es una puerta; lo segundo
es la cerradura. **P1**: permiso *y* scope, siempre.

---

## 8. Que el jugador pueda comprobar que no está arreglado

El premio lo decide el servidor. Hoy el jugador tiene que creernos: guardamos el
número aleatorio y lo puede auditar el dueño, pero él no tiene forma de
verificarlo.

**Se le da esa forma**, reusando el mecanismo de *provably fair* que ya existe
para los juegos propios (`packages/games-shared/provably-fair`):

1. Antes de girar, el servidor le muestra una **huella** (hash) del resultado ya
   decidido. La huella no revela el premio.
2. Después del giro, le muestra la **semilla**.
3. El jugador comprueba que la semilla produce esa huella y ese resultado.

Es el equivalente a poner el resultado en un sobre cerrado antes de girar: no ve
adentro, pero después verifica que el sobre nunca se cambió. Es el argumento más
fuerte contra el "esto está arreglado" del que no gana en una semana, y acá es
reusar, no inventar.

---

## 9. Cuando la entrega falla

Hoy: sale el confetti, se registra el premio y el jugador no recibe nada, porque
el awarder se traga el error y devuelve `bonusId: null`.

**Cómo tiene que ser:**

1. El jugador **ve que hubo un problema** y que su premio quedó **pendiente**.
   No se le muestra un premio que no tiene.
2. El reward queda con estado `pendiente`, no `entregado`.
3. **Le llega el aviso al admin** para resolverlo.
4. Existe un camino para **entregarlo a mano** desde el panel, auditado.

Esto obliga a que `promotion_rewards` tenga **estado de entrega**. Hoy no lo
tiene: la fila existe y se asume entregada.

---

## 10. Operación

- **Configuran**: el admin del casino y los empleados con permiso de
  promociones. Nunca por encima del techo del admin (**P2**).
- **Se puede editar en caliente**, con gente girando.
- **Cada cambio guarda una versión.** Los giros viejos apuntan a la versión con
  la que se jugaron. Sin esto, el historial y las auditorías quedan colgando de
  segmentos que ya no existen — que es el bug 6 de §2.
- **Apagarla no le saca nada a nadie**: se deja de poder girar, y los bonos ya
  otorgados siguen su curso hasta usarse o vencer.
- **El premio grande se acredita solo** y le avisa al admin. El jugador lo cobra
  al instante, que es lo que lo hace valer como anzuelo.
- **Términos y condiciones propios**, visibles en la misma pantalla: un giro por
  día, qué rollover tiene el bono, cuándo vence, y qué pasa cuando se agotan los
  premios del día.

---

## 11. Antifraude

**Diferido a propósito.** El módulo de detección de cuentas múltiples existe
(`docs/15-engagement-promos.md` §D) y **no se engancha** a la ruleta en esta
versión.

Lo que lo reemplaza mientras tanto es el **tope diario** (§6.2), que acota el
daño total sin importar cuántas cuentas participen.

El dueño quiere además un **límite de 2 cuentas por persona**, que es una regla
de **toda la plataforma** —toca registro, identidad y detección— y va como
proyecto propio. **Conviene tenerlo antes de abrir la ruleta a producción**,
porque hoy gira cualquiera que se registre.

---

## 12. Qué se tiene que poder mirar

| Pregunta | De dónde sale |
|---|---|
| ¿Cuánto me costó la ruleta este mes? | Suma de rewards del período, contra el tope |
| ¿Quién giró y qué ganó? | `promotion_rewards` + usuario, giro por giro |
| ¿Sirve para lo que la puse? | Cuánta gente vuelve al día siguiente, cuántos días seguidos gira, y si el que gira deposita más que el que no |
| ¿Cuánto del bono volvió a la Casa? | De lo entregado: cuánto se jugó y se perdió, cuánto se retiró, cuánto venció sin usar |

La última es **el costo real**, y es el número que decide si esto se sostiene.
Es también el que hoy nadie puede calcular.

Todo exportable a CSV, como el resto del módulo.

---

## 13. La interfaz

El diseño lo hizo el dueño en Claude Design. El bundle se extrae en
**`docs/design_handoff_ruleta_diaria/`** y **no está versionado**: `.gitignore`
excluye `design_handoff_*/` a propósito, porque son referencias visuales y no
código. Si no lo tenés en tu copia, pedíselo al dueño — el archivo original es
`Sidebar vs header en dashboard.zip`, cuyo nombre no dice nada de la ruleta.

Este documento define **qué se toma y qué no**. El detalle visual fino
—coordenadas de los gajos, degradés, tamaños, tipografías— vive en el
`README.md` del bundle y **hay que tenerlo a mano para construir la pantalla**.

> **El diseño es sólo estético.** Las mecánicas son las de este documento. El
> handoff describe una ruleta distinta —3 tiradas por día, giros gratis en 4 de
> los 12 gajos, sección para ganar tiradas extra, bono x2 en la carga,
> cashback— y **nada de eso aplica**.

**Se toma del diseño:**

- La rueda neón: aro de grafito, tubo rosa, 12 gajos de 30°, clavijas, cubo
  central y flecha. La geometría está especificada con coordenadas exactas.
- Las tres capas apiladas (halo, aro fijo, disco que gira, cubo y flecha) y que
  la rotación viva en una *ref*, no en el estado.
- Los estados del botón: puede girar → girando → sin tiradas.
- La tarjeta de resultado, que aparece **recién al terminar** el giro.
- Los tokens de color y tipografía, que ya existen en el tema del jugador.
- El tratamiento mobile: un solo renglón por gajo, porque a 340 px la segunda
  línea es ilegible.
- Que el cliente **anime hacia** el resultado que devuelve la API, sin decidirlo
  nunca. El handoff ya lo dice.

**No se toma:**

- Las 3 tiradas, los giros gratis, "Conseguí más tiradas", el bono x2 y el
  cashback.
- La reorganización de la navegación mobile y la Billetera nueva. **Eso no es
  estética**, es cambiar dónde vive cada cosa. Va como proyecto aparte (§15).
- El estudio de sidebar vs. header, que el propio handoff marca como material de
  decisión y no para implementar.

**Dónde vive**: sección propia en el menú del jugador, en **`/play/wheel`** — la
que ya existe. El diseño sugería `/play/roulette` y se descartó: no hay nada
roto que arreglar, y en un casino "roulette" es además el juego de mesa.

**Aviso al jugador**: por la campanita del casino, cuando se le renueva el giro.
Nada de Telegram, WhatsApp ni notificaciones del navegador en esta versión.

---

## 14. Qué hay que tocar

**Base de datos**

- `promotions`: zona horaria del día, tope diario, y versión de la config.
- Versionado de la config: los rewards tienen que apuntar a la versión con la
  que se jugó.
- `promotion_rewards`: **estado de entrega** (pendiente / entregado / fallido) y
  los datos del sobre cerrado (semilla y huella).
- Una `bonus_definition` propia de la ruleta, con rollover y vencimiento por
  segmento.

**Backend**

- Ancla del día por zona horaria del casino, en vez de UTC.
- Control de elegibilidad: rol, estado de la cuenta, autoexclusión, y **red
  central** — en el listado y en el giro.
- Tope diario, verificado y consumido **en la misma transacción** que el reward.
- Premio tipo bono con rollover y vencimiento por segmento.
- **Bloquear `free_spins`** en el editor y en el awarder.
- Sobre cerrado: emitir huella, revelar semilla, y un endpoint de verificación.
- Entrega fallida → estado pendiente + aviso + entrega manual auditada.
- Descuento del costo en la base de comisión (**C1/C4b**).

**Frontend**

- Rehacer la pantalla del jugador con la estética del handoff.
- Ítem propio en el menú, oculto para quien no puede girar.
- Términos y condiciones en pantalla.
- Panel: tope diario, zona horaria, rollover y vencimiento por segmento, y el
  reporte del §12.

---

## 15. Fuera de alcance

Se nombran para que nadie los dé por incluidos:

0. **El motor de rollover** (§5.1b). Hoy `wagering` se guarda y nadie lo lee, así
   que el rollover efectivo es x1 y el costo real del bono es casi el nominal.
   Construirlo exige contar apuestas contra el requisito y no liberar las
   ganancias hasta cumplirlo: toca el camino de la plata y los callbacks de los
   tres proveedores. Es lo que más abarataría la ruleta.
1. **Tiradas gratis.** El proveedor las soporta —`openGame` de Gregmorn acepta
   `freespinCount` y `freespinTotalBet`, y el cliente ya los sabe mandar— pero
   **nadie lo llama nunca** con esos parámetros. Falta el registro de tiradas
   pendientes, inyectarlas al abrir el juego, el vencimiento, y decidir quién
   banca las ganancias: **una tirada gratis genera premio sin una apuesta que lo
   compense**. Y falta confirmar con el proveedor si el contrato del dueño las
   tiene habilitadas y en qué juegos.
2. **Ruleta para redes independientes**, fondeada por el socio (§7).
3. **Límite de 2 cuentas por persona** (§11).
4. **Enganche del antifraude** a la ruleta (§11).
5. **Reorganización de la navegación mobile y Billetera** (§13).
6. **Bono x2 en la carga y cashback** — mecánicas del diseño que no existen hoy
   y que no son "dar un bono de monto fijo": la primera es una promesa que se
   aplica a un depósito futuro, la segunda un porcentaje que **no se conoce al
   girar** porque se calcula al cierre del día.
7. **Login streak.** Queda apagado: dos mecanismos que premian volver todos los
   días confunden al jugador y duplican el gasto sin duplicar el efecto.

---

## 16. Lo que hay que medir en staging antes de producción

1. **El costo real contra el nominal.** De cada 100 fichas entregadas, cuántas
   vuelven. Es el número que hoy nadie tiene y del que depende todo.
2. **Que el tope frene de verdad**, incluso con giros simultáneos.
3. **Que ningún jugador de red independiente vea la ruleta ni pueda girar**,
   ni siquiera armando el pedido a mano. Es **E8** y se prueba explícitamente.
4. **Que ningún operador pueda girar.**
5. **Que el corte del día sea a medianoche argentina**, incluido el caso de las
   21:00 a las 00:00 que hoy da dos giros.
6. **Que una entrega fallida no le muestre al jugador un premio que no tiene.**
