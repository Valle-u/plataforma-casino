# 04 — Settings (Back Office)

Página: `admin.goldslotpalase.com/#/settings/index`

---

## 1. Basic Information

| Campo | Valor | Notas |
|---|---|---|
| **ID** | `redgardel` | Identificador único del agente |
| **Name** | `redgardel` | Nombre visible en el panel |
| **Agent Level** | `Agent` | Nivel dentro de la jerarquía del proveedor |
| **GGR (%)** | `6` | Porcentaje de GGR que nos corresponde |
| **Point** | `0` | Puntos acumulados (informativo) |
| **State** | `Approved` | Estado de la cuenta — aprobada y operativa |
| **RTP** | `95` | RTP configurado (95%) |

---

## 2. Bet & Win Limit Information

| Campo | Valor (ARS) | Notas |
|---|---|---|
| **Max Bet** | `0` | Sin límite (0 = ilimitado) |
| **Min Bet** | `0` | Sin mínimo (0 = ilimitado) |
| **Max Win** | `0` | Sin límite de premio (0 = ilimitado) |

> **Nota del panel:** "If the value is 0, there is no limit."

Esto es consistente con la **Opción C** elegida: no hay tope de premio, el proveedor paga cualquier monto que el juego devuelva.

---

## 3. Bank Account Information

| Campo | Valor |
|---|---|
| Tel | _(vacío)_ |
| Bank Name | _(vacío)_ |
| Bank Account | _(vacío)_ |
| Master | _(vacío)_ |

> Sección incompleta / sin configurar. Puede que sea opcional o que deba completarse para retiros. Verificar con el proveedor si es requerida.

---

## 4. API Information

| Campo | Valor | Notas |
|---|---|---|
| **API Token** | `be54f7ba-5a61-40bd-acd7-4f787fde182b` | UUID. Se usa en `Authorization: Bearer {token}` |
| **API URL** | `https://agent.goldslotpalase.com` | Base URL para Main API (v4) |

> ⚠️ El API Token está expuesto en esta captura. Si esta imagen circula, considerar hacer **Reissue** desde el botón del panel.

---

## 5. Allowed IP for API calls

| Campo | Valor |
|---|---|
| **Allowed IP** | _(vacío)_ |

> **Sin restricción de IP.** El panel indica: "If there is no IP restriction, leave [Allowed IP] blank."  
> Esto significa que el proveedor **no valida IP de origen** para las llamadas a su Main API. Cualquier servidor con el token puede llamar.

---

## 6. Callback Information

| Campo | Valor | Notas |
|---|---|---|
| **Callback TOKEN** | `1ff995a6-de36-4d69-803e-ca82b3688ae6` | Se envía en header `Callback-Token` |
| **Callback URL** | _(vacío)_ | Debe configurarse con nuestra URL de callback |

### Reglas del callback (según el panel):

1. El **Callback TOKEN** se recibe en el header `Callback-Token` de cada request del proveedor.
2. Si el token recibido **no coincide** con el token de esta página → retornar **ERROR**.
3. La **Callback URL** debe comenzar con `http://` o `https://`.
4. Puede tardar **hasta 10 minutos** en aplicarse en el servidor real.
5. Si se usa el método **transfer wallet**, dejar la Callback URL **vacía**.
6. Para más información: enlace a "Callback API Example Source" en el panel.

> **Pendiente:** Configurar la Callback URL apuntando a nuestro backend NestJS. Ver `03-callback-seamless.md` para el diseño del endpoint.

---

## Resumen de campos para nuestro backend

| Campo | Dónde se usa en nuestro sistema | Ubicación sugerida |
|---|---|---|
| `API Token` | Main API — header `Authorization: Bearer` | `env vars` → `PALACE_API_TOKEN` |
| `API URL` | Main API — base URL | `env vars` → `PALACE_API_URL` |
| `Callback TOKEN` | Callback Seamless — header `Callback-Token` | `env vars` → `PALACE_CALLBACK_TOKEN` |
| `Callback URL` | Configurado en el panel → apunta a nuestro endpoint | Nuestro endpoint: `/api/v1/game-provider/palace/callback` |
| `GGR %` | Cálculo de comisión mensual | Lógica de billing (futuro) |
| `RTP` | Informativo — RTP real de los juegos del proveedor | No afecta nuestro backend |
