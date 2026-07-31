# 20 · Modelo operativo — los dos modos de banca + rumbo del piloto

> Estado: **decidido con el dueño (2026-07-06)**. Reconstruido tras perderse la
> sesión donde se definió el roadmap. Reemplaza/actualiza los supuestos de
> `docs/18-modelo-de-negocio.md` sobre "quién banca" y el estado del socio
> dependiente (que NO está dormido: se reactivó como franquicia comercial).

---

## 1. La idea central: dos modelos opuestos

Todo se entiende separando **quién maneja la plata**:

### 🏛️ CENTRALIZADO — tu red propia + socios dependientes

- **La plata la manejan SOLO el admin (el dueño) y sus empleados.** Son los únicos
  que aprueban depósitos, procesan retiros y cargan fichas a la red central.
- **La Casa banca todo**: las cargas del admin salen de la tesorería del tenant;
  los retiros se pagan del banco del tenant.
- **El socio dependiente carga fichas de SU wallet a los jugadores de su red**
  (canal de reventa, `wallet.load` — cambio R3 2026-07-31). NO aprueba depósitos,
  NO procesa retiros, NO corrige, NO retira.
- **Distribuidores y cajeros NO tocan plata.** Su rol es **100% comercial**:
  publicidad, traer jugadores y manejar su propio equipo. Nada más.
- **Cobran por comisión %** sobre la NetWin de su red (no por sueldo).
- "Tu red propia" y "socio dependiente" se diferencian solo en **quién trae la
  gente** (el dueño o el socio). La mecánica de plata central es idéntica: la
  Casa banca.
- Solo el admin tiene empleados que manejan plata. Los roles comerciales
  (distribuidor/cajero) nunca.

### 🔗 DESCENTRALIZADO — socios independientes

- **Cada operador maneja su propia plata.** El socio, el distribuidor y el cajero
  independiente tienen **su propio stock de fichas** y bancan a sus propios
  jugadores (aprueban sus depósitos/retiros, cargan desde su stock).
- **El socio revende fichas hacia abajo en cadena** (socio → distribuidor →
  cajero → jugador), a los precios que él decida.
- **El tenant ya cobró al inicio** (venta mayorista de fichas) y queda afuera de
  su operación. El socio hace su negocio aparte.

---

## 2. Pago al staff

- **Todos por comisión %**: socio, distribuidor y cajero cobran cada uno su % según
  la actividad (NetWin) de su red. **Se elimina el sueldo fijo** (el modelo de
  sueldos de F1 se reemplaza por comisión por nivel).

---

## 3. El piloto

- **Un solo tenant: el dueño**, operando como cliente real. La facturación entre
  varios tenants (el % de netwin que cobra la plataforma) queda para más adelante.
- **Los tres modelos activos** en paralelo (red propia + dependiente + independiente).
- **Juegos**: vía **agregador externo** cuando se contrate; hoy solo el juego mock.
- **Engagement**: solo lo básico en el piloto (p.ej. un bono de bienvenida); el
  resto (promos, ligas, misiones, VIP) al final.
- **Publicidad/referidos**: importante, pero después de economía + jerarquías.

---

## 4. Rumbo (orden de trabajo)

1. **Economía (en curso):** cerrar las fugas/incoherencias detectadas en la
   auditoría del 2026-07-06 y dejar la plata coherente.
2. **Jerarquías / banca:** el grueso del trabajo nuevo. El código HOY todavía no
   hace todo el modelo de arriba:
   - En el modelo centralizado, los roles comerciales (socio/distribuidor/cajero)
     todavía pueden tener permisos de plata → hay que dejarlos **sin** permisos de
     plata (extiende la política de F1 a todos los niveles).
   - Cambiar el pago de **sueldo fijo → comisión % por nivel**.
   - Construir el **modelo independiente multinivel**: cada operador con su stock
     revendiendo en cadena. Hoy solo banca el **socio raíz** de la rama
     (`getNearestIndependentBranchAncestor`); falta generalizar a cada nivel.
3. **Engagement:** bonos, promos, ligas, misiones, logros, VIP.

---

## 5. Relación con otros docs

- `docs/18-modelo-de-negocio.md`: describe los 3 setups; su nota de "dependiente
  dormido" quedó **desactualizada** (el dependiente está activo como franquicia
  comercial). Este doc manda sobre "quién banca".
- `docs/17-modelo-independiente.md`: el detalle técnico del modelo descentralizado
  (roadmap I-0..I-6). El multinivel (I-0/I-2/I-3) está **diseñado pero no construido**.
- `docs/16-tesoreria.md`: la Casa y las comisiones por red (base del centralizado).
