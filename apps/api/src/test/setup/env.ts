/**
 * Variables de entorno que la suite necesita puestas **antes** de que se importe
 * nada de la app.
 *
 * ## Por qué esto no puede ir adentro de un test
 *
 * `CRM_ENABLED` se lee **una sola vez**, cuando se importa `chat/chat.flag.ts`,
 * y de eso depende que `ChatModule` entre o no en `AppModule`. Los `import` de
 * un archivo de test corren antes que cualquier línea suya, así que para cuando
 * un `beforeAll` toca `process.env` la decisión ya está tomada y los endpoints
 * del CRM devuelven 404.
 *
 * `setupFiles` corre antes de cargar el archivo de test, que es el único momento
 * que sirve.
 *
 * ## Por qué prendido
 *
 * Porque en producción está prendido. Correr la suite con el CRM apagado sería
 * verificar una configuración que nadie usa — y dejaría sin cobertura los tests
 * de aislamiento entre redes, que son de los que protegen leyes.
 *
 * El `??=` respeta lo que venga de afuera: alguien que quiera correr la suite
 * con el CRM apagado sigue pudiendo, con `CRM_ENABLED=0`.
 */
process.env.CRM_ENABLED ??= '1';
