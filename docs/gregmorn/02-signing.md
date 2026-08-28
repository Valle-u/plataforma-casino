# Gregmorn — 02 · Firma (`X-Signature`)

Un solo esquema para las dos direcciones: **HMAC-SHA256, digest hexadecimal, sobre
los bytes crudos del body JSON**, con la `secret_api_key` como clave.

Es notablemente más simple que Forever, que usa Ed25519 con un par de claves
distinto por sentido (ver `docs/forever/02-signing.md`).

## Dónde aplica

| Operación | Sentido | Firma |
|---|---|---|
| `POST /games/openGame` | nosotros → ellos | La generamos nosotros. |
| `getBalance` / `writeBet` / `rollback` | ellos → nosotros | **La verificamos.** |
| `POST /apiIndividualWallet/` | — | No aplica: descartamos el transfer wallet. |

`/auth/login` y `getUserGames` **no** llevan firma: el primero es form-urlencoded con
usuario y contraseña, el segundo va con Bearer.

## La regla que no se puede romper

> La firma se calcula sobre los **bytes exactos** del body, no sobre el JSON
> re-serializado.

Si se parsea el JSON y se vuelve a serializar para firmar o verificar, cualquier
diferencia —orden de claves, espacios, escapado de unicode, notación de números—
cambia los bytes y la firma no valida. Es el error clásico de este tipo de
integración.

**En nuestro backend ya está resuelto:** `apps/api/src/main.ts` arranca Nest con
`rawBody: true`, y el controller de Forever ya lee `req.rawBody` para verificar. El
de Gregmorn tiene que hacer lo mismo:

```ts
@Post('callback')
async handle(
  @Req() req: RawBodyRequest<{ rawBody?: Buffer }>,
  // ...
) {
  const raw = req.rawBody ? req.rawBody.toString('utf8') : '';
  // verificar la firma contra `raw`, NO contra el body parseado
}
```

## Verificación (entrante)

1. Leer el header `X-Signature`.
2. Calcular `HMAC-SHA256(rawBody, secret_api_key)` en hex.
3. Comparar **en tiempo constante** (`crypto.timingSafeEqual`), nunca con `===`,
   para no filtrar información por el tiempo de comparación.
4. Si no coincide: rechazar **antes** de tocar la wallet.

Sin header o con firma inválida se responde con el contrato de error de ellos
(`status: "fail"` + HTTP 400), igual que el resto de los rechazos.

## Generación (saliente, `openGame`)

Serializar el body **una sola vez**, firmar exactamente esa cadena y mandar esa misma
cadena como body. No serializar dos veces: hay que firmar y enviar el mismo string.

## La clave

`secret_api_key`, que ellos resuelven a partir del `user_id` que mandamos. Vive en
`tenant_settings` bajo `game_provider.gregmorn.secret_api_key` — es **por tenant**,
no global.

Stage y Prod tienen claves distintas.

## Defensa en profundidad: la IP

La firma es el control principal, pero además solo deberían llegarnos callbacks
desde `3.78.156.229`. Esa IP va a la allowlist de Cloudflare. Palace ya tiene un
mecanismo parecido a nivel aplicación
(`game_provider.palace.callback_ip_mode` / `.callback_ip_allowlist`); si más adelante
conviene, se puede espejar para Gregmorn.

**La IP no reemplaza a la firma.** Una IP se puede falsear si el atacante llega al
origen, y además ellos podrían sumar servidores sin avisar.
