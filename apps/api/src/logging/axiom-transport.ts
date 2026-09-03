/**
 * AxiomTransport — manda los logs a Axiom para poder buscarlos después.
 *
 * ## Para qué
 *
 * Los logs del contenedor son efímeros: Swarm poda los contenedores viejos y un
 * día con varios redeploys se lleva puesto el historial. El incidente del
 * 2026-09-01 hubo que reconstruirlo **con SQL contra la base** porque los logs
 * de esa ventana ya no existían. Ver `docs/26-monitoreo-diagnostico.md` §4.1.
 *
 * ## Reglas, las mismas que `AlertsService`
 *
 * - **Nunca tira.** Un log que no se pudo mandar no puede tumbar una apuesta.
 * - **Nunca bloquea.** Se encola y se manda en lotes, aparte del request.
 * - **Sin token queda apagado** y no molesta en desarrollo.
 *
 * ## Por qué a mano y no con el SDK
 *
 * La API de ingesta es un POST con NDJSON y un Bearer. El SDK agrega una
 * dependencia para ahorrar veinte líneas, y acá lo que importa es controlar
 * exactamente qué se manda afuera y qué pasa cuando falla.
 */

/** Un evento listo para mandar. Forma libre: Axiom infiere el esquema. */
export type AxiomEvent = Record<string, unknown>;

/** Cuántos eventos se acumulan antes de mandar sin esperar al timer. */
const LOTE = 100;

/** Cada cuánto se vacía la cola, aunque no se haya llenado. */
const INTERVALO_MS = 5_000;

/**
 * Techo de la cola. Si Axiom no responde, la cola no puede crecer sin límite:
 * quedarse sin memoria por no poder loguear sería el peor intercambio posible.
 * Al llenarse se tiran los eventos MÁS VIEJOS — ante un incidente, lo último
 * que pasó explica más que lo primero.
 */
const MAX_COLA = 10_000;

const TIMEOUT_MS = 10_000;

export class AxiomTransport {
  private readonly cola: AxiomEvent[] = [];
  private timer: NodeJS.Timeout | null = null;
  private enviando = false;
  /** Eventos tirados por cola llena. Se reporta para no perderlo en silencio. */
  private descartados = 0;

  constructor(
    private readonly token: string,
    private readonly dataset: string,
    private readonly domain: string = 'api.axiom.co',
  ) {}

  /**
   * Construye el transporte si está configurado, o `null` si no.
   *
   * Mismo criterio que el canal de Telegram: sin credenciales no se activa y no
   * hace ruido. En desarrollo no se manda nada afuera.
   */
  static desdeEnv(): AxiomTransport | null {
    const token = process.env.AXIOM_TOKEN?.trim();
    const dataset = process.env.AXIOM_DATASET?.trim();
    if (!token || !dataset) return null;
    return new AxiomTransport(
      token,
      dataset,
      process.env.AXIOM_DOMAIN?.trim() || 'api.axiom.co',
    );
  }

  /** Encola un evento. No espera, no falla. */
  encolar(evento: AxiomEvent): void {
    if (this.cola.length >= MAX_COLA) {
      this.cola.shift();
      this.descartados++;
    }
    this.cola.push(evento);

    if (this.cola.length >= LOTE) {
      void this.vaciar();
      return;
    }
    this.programar();
  }

  private programar(): void {
    if (this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.vaciar();
    }, INTERVALO_MS);
    // No mantiene vivo el proceso por un timer de logs.
    this.timer.unref?.();
  }

  /**
   * Manda lo que haya en la cola. Se llama sola y también al apagar el proceso.
   *
   * Si el envío falla, los eventos **se devuelven a la cola** para el próximo
   * intento: un corte de red de treinta segundos no debería perder los logs de
   * justo el momento en que algo se rompió.
   */
  async vaciar(): Promise<void> {
    if (this.enviando || this.cola.length === 0) return;
    this.enviando = true;

    const lote = this.cola.splice(0, LOTE);
    if (this.descartados > 0) {
      lote.push({
        _time: new Date().toISOString(),
        level: 'warn',
        context: 'AxiomTransport',
        message: `Se descartaron ${this.descartados} eventos por cola llena.`,
      });
      this.descartados = 0;
    }

    try {
      // La ruta es `/v1/datasets/<dataset>/ingest`.
      //
      // ⚠️ La documentación de Axiom muestra en algún lado `/v1/ingest/<dataset>`
      // y **esa no existe**: devuelve 404 "path not found". Se verificó contra la
      // API real el 2026-09-03 — con la ruta buena el 404 dice "dataset not
      // found", que es otra cosa. Si algún día deja de ingerir, distinguir esos
      // dos mensajes es lo primero que ahorra tiempo.
      const url = `https://${this.domain}/v1/datasets/${encodeURIComponent(this.dataset)}/ingest`;
      const r = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.token}`,
          'Content-Type': 'application/x-ndjson',
        },
        body: lote.map((e) => JSON.stringify(e)).join('\n'),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });

      if (!r.ok) {
        // A stderr y no por el logger: si el logger usa este transporte,
        // loguear un fallo del transporte se muerde la cola.
        const cuerpo = await r.text().catch(() => '');
        console.error(
          `[axiom] rechazó el lote: HTTP ${r.status} ${cuerpo.slice(0, 200)}`,
        );
        this.devolver(lote);
      }
    } catch (err) {
      console.error(`[axiom] no se pudo enviar: ${(err as Error).message}`);
      this.devolver(lote);
    } finally {
      this.enviando = false;
      if (this.cola.length > 0) this.programar();
    }
  }

  /** Reencola al frente, respetando el techo. */
  private devolver(lote: AxiomEvent[]): void {
    const espacio = MAX_COLA - this.cola.length;
    if (espacio <= 0) {
      this.descartados += lote.length;
      return;
    }
    const cabe = lote.slice(-espacio);
    this.descartados += lote.length - cabe.length;
    this.cola.unshift(...cabe);
  }

  /** Vacía todo antes de que el proceso muera. Se llama en el shutdown. */
  async cerrar(): Promise<void> {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    // Varias pasadas: `vaciar` manda de a un lote.
    for (let i = 0; i < 10 && this.cola.length > 0; i++) {
      await this.vaciar();
    }
  }
}
