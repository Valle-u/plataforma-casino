/**
 * Feature flag del CRM/livechat. Default OFF.
 *
 * Con `CRM_ENABLED != '1'`, el `ChatModule` NO se importa en `app.module.ts`
 * → sus controllers/gateway ni se instancian: cero efecto en prod. Se prende
 * solo en dev / beta hasta que el CRM esté listo. Ver docs/22-crm-livechat.md §10.
 */
export const CRM_ENABLED = process.env.CRM_ENABLED === '1';
