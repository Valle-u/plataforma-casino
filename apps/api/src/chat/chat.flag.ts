/**
 * Feature flag del CRM/livechat. Default OFF.
 *
 * Con `CRM_ENABLED != '1'`, el `ChatModule` NO se importa en `app.module.ts`
 * → sus controllers/gateway ni se instancian: cero efecto en prod. Se prende
 * solo en dev / beta hasta que el CRM esté listo. Ver docs/22-crm-livechat.md §10.
 *
 * ⚠️ **Este flag NO se puede prender desde `.env.local`.**
 *
 * Se lee acá arriba, al importar el módulo, y `ConfigModule` recién vuelca los
 * archivos `.env*` a `process.env` cuando se construye `AppModule` — o sea,
 * después. Poniéndolo en `.env.local` la variable existe para todo lo demás
 * (la base, los JWT, los timeouts) pero **para esto llega tarde**: la constante
 * ya vale `false` y `ChatModule` quedó afuera del array de imports.
 *
 * El síntoma es confuso: la app levanta bien, el panel muestra la bandeja
 * —porque el flag del front sí sale de `.env.local`— y las rutas del chat
 * devuelven **404**. Parece que faltara un endpoint; en realidad falta el
 * módulo entero.
 *
 * Tiene que estar en el entorno **del proceso**. En local, con la entrada
 * `api-crm` de `.claude/launch.json`, que lo setea antes de arrancar.
 */
export const CRM_ENABLED = process.env.CRM_ENABLED === '1';
