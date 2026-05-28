/**
 * SlotApp — bootstrap de la aplicación PixiJS.
 *
 * Responsabilidades:
 *   - Crear el `Application` de Pixi (WebGL renderer + ticker)
 *   - Cargar todos los assets del manifest en paralelo
 *   - Crear y montar la SlotScene
 *   - Implementar el "resize letterbox": el stage de diseño (1920×1080)
 *     se escala uniformemente al canvas real, centrado, con barras
 *     negras si el aspect no matchea
 *
 * API:
 *   - new SlotApp(parent) → crea
 *   - await app.init() → carga assets + monta scene
 *   - app.spin(bet) → ejecuta un spin
 *   - app.destroy() → cleanup (importante para React unmount)
 */

import { Application, Assets, Container } from 'pixi.js';
import { ASSETS } from './core/AssetManifest';
import { DESIGN_WIDTH, DESIGN_HEIGHT, DESIGN_ASPECT } from './core/Layout';
import { SlotScene } from './scenes/SlotScene';
import type { HUD } from './components/HUD';
import type { SpinResult } from '@casino/games-jokers-jewels';

export class SlotApp {
  private app: Application;
  private scene: SlotScene | null = null;
  private stage: Container;
  private parent: HTMLElement;
  private resizeObserver: ResizeObserver | null = null;

  constructor(parent: HTMLElement) {
    this.parent = parent;
    this.app = new Application();
    this.stage = new Container();
  }

  /**
   * Inicializa el renderer, carga assets y monta la escena.
   * Debe llamarse ANTES de spin() o cualquier otra operación.
   */
  async init(): Promise<void> {
    // 1. Iniciar el Application de Pixi.
    //    backgroundAlpha: 0 → fondo transparente (queremos que se vea el
    //    backboard sprite que ponemos en la scene, no un color sólido).
    await this.app.init({
      width: DESIGN_WIDTH,
      height: DESIGN_HEIGHT,
      backgroundColor: 0x000000,
      antialias: true,
      resolution: window.devicePixelRatio || 1,
      autoDensity: true,
      preference: 'webgl', // fallback a canvas si no hay WebGL
    });

    // 2. Montar el canvas en el parent.
    this.parent.appendChild(this.app.canvas);
    this.app.canvas.style.display = 'block';

    // 3. Cargar assets en paralelo. Pixi.Assets cachea por defecto.
    await Assets.load(ASSETS.map((a) => ({ alias: a.key, src: a.url })));

    // 4. Design stage — letterboxed, contiene TODA la escena (incluido
    //    el backboard). Afuera del design stage = barras negras (canvas
    //    background 0x000000).
    this.app.stage.addChild(this.stage);
    this.scene = new SlotScene();
    this.stage.addChild(this.scene);

    // 5. Configurar resize.
    this.setupResize();
    this.applyResize();
  }

  /**
   * Ejecuta un spin. Devuelve el SpinResult (board + wins + totalWin).
   */
  async spin(betAmount: number): Promise<SpinResult> {
    if (!this.scene) {
      throw new Error('SlotApp no está inicializado — llamar init() primero');
    }
    return this.scene.spin(betAmount);
  }

  isSpinning(): boolean {
    return this.scene?.isSpinning() ?? false;
  }

  /**
   * Acceso al HUD de la escena — React lo usa para pushear state
   * (setCredit, setBet, setSpinning) y wirear callbacks (onSpinClick, etc).
   */
  getHUD(): HUD | null {
    return this.scene?.hud ?? null;
  }

  /**
   * Destruye el Pixi Application, libera GPU resources y desmonta canvas.
   * CRÍTICO llamar al unmount del componente React (sino leak en HMR).
   */
  destroy(): void {
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    this.app.destroy(true, { children: true });
  }

  /**
   * Calcula la escala uniforme + offset para que el stage de diseño
   * (1920×1080) quepa exactamente dentro del parent, centrado, con
   * letterbox si el aspect ratio no matchea.
   */
  private applyResize(): void {
    const { clientWidth, clientHeight } = this.parent;
    if (clientWidth === 0 || clientHeight === 0) return;

    this.app.renderer.resize(clientWidth, clientHeight);

    // Design stage letterbox — escala uniforme + centro.
    const parentAspect = clientWidth / clientHeight;
    let scale: number;
    if (parentAspect > DESIGN_ASPECT) {
      // parent más ancho que diseño → "barras" a los lados ocupadas por el backboard
      scale = clientHeight / DESIGN_HEIGHT;
    } else {
      // parent más alto que diseño → "barras" arriba/abajo ocupadas por el backboard
      scale = clientWidth / DESIGN_WIDTH;
    }

    this.stage.scale.set(scale);
    this.stage.position.set(
      (clientWidth - DESIGN_WIDTH * scale) / 2,
      (clientHeight - DESIGN_HEIGHT * scale) / 2,
    );
  }

  private setupResize(): void {
    this.resizeObserver = new ResizeObserver(() => this.applyResize());
    this.resizeObserver.observe(this.parent);
  }
}
