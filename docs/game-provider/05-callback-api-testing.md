# 05 — Callback API Testing (Panel del Proveedor)

Página: `admin.goldslotpalase.com/#/api/callback`

El panel permite probar el callback API (Seamless) contra nuestro backend sin necesidad de levantar un juego real. Cada test simula la secuencia de commands que un proveedor de juegos enviaría.

> **Nota:** Los tests se realizan con datos virtuales (sin puntos reales). El historial de requests/responses se revisa en "Callback API Test Log".

---

## Secciones del Testing Panel

### 1. Enter Basic Information

- **Agent selector**: `redgardel` (nuestra cuenta)
- **User Name**: nombre del usuario de prueba a crear/usar
- **Requisito**: solicitar aprobación del administrador con `agent name` + `user name`
- Los tests usan puntos virtuales (no afectan saldo real)

---

### 2. User Authentication

**Propósito:** Verificar que nuestro backend puede autenticar un usuario del provider.

| Paso | Tipo | Comando/Check | Descripción |
|---|---|---|---|
| 1 | CHECK | `21` | Check user information |
| 2 | COMMAND | `authenticate` | User Authentication |

**Response esperada:**
```
account: User Id
balance: User Balance
```

---

### 3. User Balance Inquiry

**Propósito:** Consultar el saldo de un usuario autenticado.

| Paso | Tipo | Comando/Check | Descripción |
|---|---|---|---|
| 1 | CHECK | `21` | Check user information |
| 2 | CHECK | `22` | Check if the user status is normal |
| 3 | COMMAND | `authenticate` | User Authentication |
| 4 | COMMAND | `balance` | Check user balance |

**Response esperada:**
```
balance: User Balance
```

---

### 4. Test Betting

**Propósito:** Simular una apuesta (bet) y verificar xử lý.

#### Escenario A: Bet less than balance (Success)

| Paso | Tipo | Comando/Check | Descripción |
|---|---|---|---|
| 1 | CHECK | `21` | Check user information |
| 2 | CHECK | `22` | Check if user status is normal |
| 3 | CHECK | `41` | Check if already processed (idempotency) |
| 4 | CHECK | `31` | Check user balance |
| 5 | COMMAND | `authenticate` | User Authentication |
| 6 | COMMAND | `balance` | Check user balance |
| 7 | COMMAND | `bet` | Betting Request |
| 8 | COMMAND | `bet` | 2nd Duplicate Betting Request (idempotency test) |
| 9 | COMMAND | `win` | Handling Betting Results (Hits/Misses) |
| 10 | COMMAND | `status` | Betting Processing Status |

**Response esperada:**
```
account: User Id
trans_id: ID
trans_status: Status of transaction history
```

#### Escenario B: Bet more than balance (Failed)

| Paso | Tipo | Comando/Check | Descripción |
|---|---|---|---|
| 1 | COMMAND | `authenticate` | User Authentication |
| 2 | COMMAND | `balance` | Check user balance |
| 3 | COMMAND | `bet` | Betting Request (monto > saldo) |

**Response esperada:**
```
balance: User Balance (sin cambios)
```

---

### 5. Hit Test After Bet

**Propósito:** Simular el resultado de una apuesta (win/loss) después del bet.

| Paso | Tipo | Comando/Check | Descripción |
|---|---|---|---|
| 1 | CHECK | `21` | Check user information |
| 2 | CHECK | `22` | Check if user status is normal |
| 3 | CHECK | `41` | Check if already processed |
| 4 | COMMAND | `authenticate` | User Authentication |
| 5 | COMMAND | `balance` | Check user balance |
| 6 | COMMAND | `bet` | Betting Request |
| 7 | COMMAND | `win` | Handling Betting Results (Hits/Misses) |
| 8 | COMMAND | `win` | Handling 2nd Duplicate Betting Results (idempotency) |
| 9 | COMMAND | `status` | Betting Processing Status |

**Response esperada:**
```
account: User Id
trans_id: ID
trans_status: Status of transaction history
```

---

### 6. Individual Cancellation Test (CANCEL)

**Propósito:** Cancelar una apuesta específica después de bet/hit.

| Paso | Tipo | Comando/Check | Descripción |
|---|---|---|---|
| 1 | CHECK | `21` | Check user information |
| 2 | CHECK | `22` | Check if user status is normal |
| 3 | CHECK | `42` | Check if transaction history ID exists |
| 4 | CHECK | `43` | Check if [trans] id to cancel exists |
| 5 | COMMAND | `authenticate` | User Authentication |
| 6 | COMMAND | `balance` | Check user balance |
| 7 | COMMAND | `bet` | Betting Request |
| 8 | COMMAND | `cancel` | Individual bet cancellation |
| 9 | COMMAND | `cancel` | Individual cancellation of 2nd duplicate |
| 10 | COMMAND | `status` | Betting Processing Status |
| 11 | COMMAND | `bet` | Betting Request (re-bet después de cancel) |
| 12 | COMMAND | `balance` | Check user balance |

**Response esperada:**
```
balance: User Balance
```

---

## Resumen de Commands del Callback

| Command | Descripción | Nosotros implementamos como |
|---|---|---|
| `authenticate` | Login del user en el juego | Validar JWT + status active |
| `balance` | Consultar saldo | Leer wallet.balance |
| `bet` | Descontar fichas por apuesta | `WalletService.executeTransaction(type='bet')` |
| `win` | Acreditar fichas por premio | `WalletService.executeTransaction(type='win')` |
| `cancel` | Revertir una apuesta | `WalletService.executeGameRollback()` |
| `status` | Estado de la transacción | Leer game_rounds.status |

## Resumen de Checks

| Check | Código | Descripción |
|---|---|---|
| `21` | Check user information | ¿Existe el user? |
| `22` | Check user status is normal | ¿Status = active? |
| `31` | Check user balance | ¿Tiene saldo? |
| `41` | Check if already processed | Idempotency — ¿ya procesamos este round? |
| `42` | Check if transaction history ID exists | ¿Existe la transacción? |
| `43` | Check if [trans] id to cancel exists | ¿Se puede cancelar esta transacción? |

---

## Flujo de integración esperado

```
Provider (Palace)                    Nuestro Backend
       │                                    │
       ├── authenticate ──────────────────► │  Validar user + status
       │                                    │
       ├── balance ────────────────────────► │  Leer wallet.balance
       │                                    │
       ├── bet ────────────────────────────► │  Debitar wallet + crear game_round
       │                                    │
       ├── win ────────────────────────────► │  Creditar wallet + actualizar game_round
       │                                    │
       ├── cancel ─────────────────────────► │  Revertir wallet + marcar round rolled_back
       │                                    │
       └── status ─────────────────────────► │  Leer game_round.status
```
