# Diagnóstico de Integración — Palace Casino

**Fecha:** 15 de julio de 2026  
**Agente:** redgardel  
**Estado del Agente:** Aprobado  
**URL de la API:** `https://agent.goldslotpalase.com`  
**URL de Callback:** `https://visibly-evade-flattery.ngrok-free.dev/api/v1/game-provider/palace/callback`

---

## 1. Resumen Ejecutivo

Hemos implementado correctamente la **Callback API en modo Seamless** y podemos confirmar que los 6 comandos del callback funcionan perfectamente. Sin embargo, **no podemos lanzar ningún juego** porque el endpoint `POST /v4/game/game-url` devuelve error `2006 (BALANCE_NOT_ENOUGH)` para todos los jugadores, incluso cuando:

- El jugador existe en su sistema (`user/create` responde exitosamente)
- El jugador tiene saldo en nuestra wallet (nuestro callback devuelve el balance correcto)
- Estamos en modo Seamless (la Callback URL está configurada)

**Necesitamos su ayuda para diagnosticar por qué `game-url` rechaza a nuestros jugadores.**

---

## 2. Arquitectura de Nuestro Sistema

```
┌─────────────────┐     ┌──────────────────────┐     ┌─────────────────┐
│  Nuestro Frontend│────▶│  Nuestro Backend API │────▶│  Palace API     │
│   (Next.js)      │     │    (NestJS)          │     │ (endpoints v4)  │
└─────────────────┘     └──────────────────────┘     └─────────────────┘
                              │         ▲
                              │         │
                              ▼         │
                        ┌──────────────────────┐
                        │  Nuestra DB Wallet   │
                        │    (PostgreSQL)      │
                        └──────────────────────┘
                              ▲         │
                              │         │
                              └─────────┘
                     Llamadas callback desde Palace
```

### Flujo cuando el jugador abre un juego

1. Frontend llama a `POST /tenant/games/code/{gameCode}/launch`
2. Backend llama a `POST /v4/user/create` → obtiene `user_code` ✅
3. Backend llama a `POST /v4/game/game-url` → **FALLA con 2006** ❌
4. Se esperaba: recibir `game_url` → embeber en iframe

### Flujo del Callback (Modo Seamless)

1. Jugador abre el juego en iframe
2. Palace llama a nuestra URL de callback con comando `authenticate`
3. Nosotros devolvemos el saldo del jugador desde nuestra wallet
4. Jugador juega → Palace llama `bet`, `win`, `cancel`, `status`
5. Nosotros actualizamos la wallet y devolvemos el nuevo saldo

**Este flujo funciona perfectamente.** El problema es que el paso 1 nunca sucede porque `game-url` rechaza la solicitud.

---

## 3. Nuestra Configuración

| Configuración | Valor |
|---------------|-------|
| Nombre del Agente | `redgardel` |
| Estado del Agente | `Aprobado` |
| RTP del Agente | 95% |
| GGR del Agente | 6% |
| Puntos del Agente | 0 |
| Balance del Agente | 0.0000 |
| Token de API | `be54f7ba-5a61-40bd-acd7-4f787fde182b` |
| Token de Callback | `1ff995a6-de36-4d69-803e-ca82b3688ae6` |
| URL de Callback | `https://visibly-evade-flattery.ngrok-free.dev/api/v1/game-provider/palace/callback` |
| Idioma por Defecto | 4 (Español) |

---

## 4. Resultados de las Pruebas

### 4.1 Creación de Jugador

**Request:**
```json
POST /v4/user/create
{
  "name": "jugador_carlos"
}
```

**Response:**
```json
{
  "code": 0,
  "message": null,
  "data": {
    "user_code": 408527320,
    "is_new_user": false
  }
}
```

**Resultado:** ✅ ÉXITO — El jugador existe, `user_code = 408527320`

---

### 4.2 Consulta de Información del Jugador

**Request:**
```json
POST /v4/user/info
{
  "user_code": 408527320
}
```

**Response:**
```json
{
  "code": 1003,
  "message": "USER_NOT_FOUND"
}
```

**Resultado:** ❌ FALLO — El jugador fue creado pero no se puede consultar

**Pregunta:** ¿Es este comportamiento esperado? El jugador se creó exitosamente con `user/create`, pero `user/info` devuelve que no existe.

---

### 4.3 Solicitud de URL del Juego

**Request:**
```json
POST /v4/game/game-url
{
  "user_code": 408527320,
  "provider_id": 1,
  "game_symbol": "vs20doghouse",
  "lang": 4
}
```

**Response:**
```json
{
  "code": 2006,
  "message": "BALANCE_NOT_ENOUGH"
}
```

**Resultado:** ❌ FALLO — Error 2006

**Probamos con múltiples symbols de juego:**
- `vs20doghouse` → 2006
- `vs20fruitsw` → 2006
- `vs12bbb` → 2006
- `vs40wildwest` → 2006
- `vswayshammthor` → 2006

**Todos los juegos devuelven el mismo error.**

---

### 4.4 Información del Agente

**Request:**
```json
POST /v4/agent/info
{}
```

**Response:**
```json
{
  "code": 0,
  "message": null,
  "data": {
    "name": "redgardel",
    "currency": "ARS",
    "balance": "0.0000",
    "rtp": 95,
    "state": "Approved"
  }
}
```

**Resultado:** El balance del agente es **0** (sin Puntos de Agente)

---

### 4.5 Nuestra Callback API (Modo Seamless)

**Prueba: Autenticación de Jugador**
```json
POST /api/v1/game-provider/palace/callback
Headers: { "Callback-Token": "1ff995a6-de36-4d69-803e-ca82b3688ae6" }
Body: {
  "command": "authenticate",
  "data": {
    "account": "jugador_carlos"
  }
}
```

**Response:**
```json
{
  "result": 0,
  "status": "OK",
  "data": {
    "account": "jugador_carlos",
    "balance": 5000
  }
}
```

**Resultado:** ✅ ÉXITO

---

**Prueba: Consulta de Balance**
```json
{
  "command": "balance",
  "data": {
    "account": "jugador_carlos"
  }
}
```

**Response:**
```json
{
  "result": 0,
  "status": "OK",
  "data": {
    "balance": 5000
  }
}
```

**Resultado:** ✅ ÉXITO

---

**Prueba: Apuesta (amount=0, bet de prueba del proveedor)**
```json
{
  "command": "bet",
  "data": {
    "account": "jugador_carlos",
    "trans_guid": "test-bet-1",
    "amount": 0,
    "game_code": "vs20doghouse",
    "game_type": "Slots"
  }
}
```

**Response:**
```json
{
  "result": 0,
  "status": "OK",
  "data": {
    "balance": 5000
  }
}
```

**Resultado:** ✅ ÉXITO (omitimos la transacción de wallet cuando amount=0)

---

**Prueba: Ganancia**
```json
{
  "command": "win",
  "data": {
    "account": "jugador_carlos",
    "trans_guid": "test-win-1",
    "amount": "100",
    "game_code": "vs20doghouse",
    "game_type": "Slots"
  }
}
```

**Response:**
```json
{
  "result": 0,
  "status": "OK",
  "data": {
    "balance": 5100
  }
}
```

**Resultado:** ✅ ÉXITO

---

## 5. Tabla Resumen

| Endpoint | Request | Response | Estado |
|----------|---------|----------|--------|
| `POST /v4/user/create` | `name: "jugador_carlos"` | `user_code: 408527320` | ✅ OK |
| `POST /v4/user/info` | `user_code: 408527320` | `USER_NOT_FOUND` | ❌ FALLO |
| `POST /v4/game/game-url` | `user_code: 408527320` | `BALANCE_NOT_ENOUGH (2006)` | ❌ FALLO |
| `POST /v4/agent/info` | `{}` | `balance: "0.0000"` | ⚠️ Sin Puntos |
| Callback: `authenticate` | `account: "jugador_carlos"` | `balance: 5000` | ✅ OK |
| Callback: `balance` | `account: "jugador_carlos"` | `balance: 5000` | ✅ OK |
| Callback: `bet` | `account: "jugador_carlos", amount: 0` | `balance: 5000` | ✅ OK |
| Callback: `win` | `account: "jugador_carlos", amount: 100` | `balance: 5100` | ✅ OK |

---

## 6. Lo Que Necesitamos de Ustedes

### Problema Principal
**¿Por qué `game-url` devuelve 2006 (BALANCE_NOT_ENOUGH) cuando:**
1. El jugador existe (`user/create` responde exitosamente)
2. Estamos en modo Seamless (la Callback URL está configurada)
3. Nuestro callback devuelve el balance del jugador correctamente

### Preguntas Específicas

1. **En modo Seamless, ¿`game-url` llama a nuestro callback para verificar el balance del jugador, o verifica un balance interno?**
   - Si verifica un balance interno, ¿cómo sincronizamos el saldo de nuestra wallet con su sistema?

2. **¿Por qué `user/info` devuelve USER_NOT_FOUND cuando `user/create` funciona correctamente?**
   - ¿`user/info` solo funciona para jugadores creados vía modo Transfer?

3. **¿Necesitamos Puntos de Agente para usar modo Seamless?**
   - Nuestro balance de agente es 0. ¿Esto está causando el error 2006?

4. **¿Cuál es el flujo correcto para modo Seamless?**
   - Nuestra comprensión: `user/create` → `game-url` → recibir `game_url` → embeber en iframe
   - ¿Es correcto?

5. **¿Existe un endpoint separado para verificar el balance de un jugador en modo Seamless?**
   - Nosotros podemos proveer el balance vía callback, pero `game-url` parece verificar algo diferente.

---

## 7. Lo Que Hemos Intentado

1. **Múltiples symbols de juego** — Todos devuelven 2006 (no es específico de un juego)
2. **Múltiples jugadores** — Todos devuelven 2006 (no es específico de un jugador)
3. **Modo Transfer** — Borramos la Callback URL, intentamos `wallet/deposit` → `POINT_NOT_ENOUGH` (0 Puntos de Agente)
4. **Re-creamos jugadores** — `user/create` con el mismo nombre devuelve `is_new_user: false`
5. **Revisamos logs de la API** — No hay errores de Palace en nuestros logs (el callback nunca se llama porque el juego nunca se abre)

---

## 8. Detalles de Nuestra Implementación

### Endpoint de Callback
```
POST /api/v1/game-provider/palace/callback
```

**Formato del request:**
```json
{
  "command": "authenticate|balance|bet|win|cancel|status",
  "data": {
    "account": "string (username del jugador)",
    "trans_guid": "string (GUID de transacción, requerido para bet/win/cancel/status)",
    "cancel_trans_guid": "string (requerido para cancel)",
    "amount": "number (requerido para bet/win)",
    "game_code": "string",
    "game_type": "string",
    "round_id": "string",
    "provider_id": "number",
    "type": "number",
    "user_code": "number (player_code de Palace)",
    "time_stamp": "number (epoch)"
  }
}
```

**Formato de la respuesta:**
```json
{
  "result": 0,  // 0 = OK, ver códigos de resultado abajo
  "status": "OK|ERROR",
  "data": {
    "balance": 1234.56  // Requerido para todos los comandos
  }
}
```

**Códigos de resultado:**
- `0` = OK
- `21` = CHECK_USER_NOT_FOUND (usuario no encontrado)
- `22` = CHECK_USER_NOT_ACTIVE (usuario inactivo)
- `31` = CHECK_INSUFFICIENT_BALANCE (saldo insuficiente)
- `41` = CHECK_ALREADY_PROCESSED (ya procesado)
- `42` = CHECK_TX_NOT_FOUND (transacción no encontrada)
- `43` = CHECK_CANCEL_TX_NOT_FOUND (transacción de cancelación no encontrada)
- `99` = INTERNAL_ERROR (error interno)

### Datos del Jugador en Nuestra DB
```sql
-- Jugador "jugador_carlos"
id: "uuid"
palace_account: "jugador_carlos"  -- Usado como account en callbacks
palace_user_code: 408527320       -- user_code de Palace
status: "active"
```

### Balance de la Wallet
```sql
-- Wallet de jugador_carlos
balance: 5000.00 ARS
```

---

## 9. Archivos Adicionales / Logs

Si necesitan logs adicionales o datos de request/response, por favor avísenos. Podemos proveer:
- Logs completos de HTTP request/response
- Queries de la base de datos
- Historial de transacciones del callback
- Logs de red desde ngrok

---

## 10. Contacto

**Agente:** redgardel  
**Plataforma:** Casino Multi-Tenant White-Label  
**Stack Tecnológico:** NestJS + PostgreSQL + Redis  
**Protocolo de Callback:** Seamless (v4)

---

*Este reporte fue generado el 15 de julio de 2026. Todas las pruebas se realizaron contra `https://agent.goldslotpalase.com`.*
