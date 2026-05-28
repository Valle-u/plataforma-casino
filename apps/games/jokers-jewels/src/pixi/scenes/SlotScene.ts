/**
 * SlotScene — escena root del slot.
 *
 * Sub-fase 2A.x PixiJS (2026-05-27): TEMPLATE-DRIVEN.
 *
 * Solo dos capas dentro del design stage:
 *   1. Reels (5×3, en design coords, dentro del hole del template)
 *   2. Template overlay (full design rect, con centro transparente)
 *
 * Backboard vive en SlotApp (fuera del design stage, ocupa canvas full).
 *
 * Expone:
 *   - spin(betAmount): Promise<SpinResult>
 *   - getCurrentBoard(): Board
 */

import { Container, Sprite, Assets, type Texture } from 'pixi.js';
import { spin as runSpin, type Board, type SpinResult } from '@casino/games-jokers-jewels';
import type { DeterministicRng } from '@casino/games-shared/rng';
import { Reels } from '../components/Reels';
import { HUD } from '../components/HUD';
import { createBackboard } from '../components/Backboard';
import { ReelDividerLights } from '../components/ReelDividerLights';
import { REELS, DESIGN_WIDTH, DESIGN_HEIGHT } from '../core/Layout';

/**
 * RNG demo (Math.random) para Sub-fase 2A. El real usa el RGS server
 * con provably fair (SHA-256 chain commits) — eso se conecta en 2C.
 */
function createDemoRng(): DeterministicRng {
  return {
    next: () => Math.random(),
    nextInt: (max: number) => Math.floor(Math.random() * max),
    pick: <T,>(arr: readonly T[]): T => {
      if (arr.length === 0) throw new Error('pick: array vacío');
      return arr[Math.floor(Math.random() * arr.length)] as T;
    },
  };
}

export class SlotScene extends Container {
  private reels: Reels;
  private currentBoard: Board;
  private spinning = false;
  private dividerLights: ReelDividerLights;
  /** HUD expuesto para que SlotApp lo conecte con React. */
  readonly hud: HUD;
  /** Listener opcional para notificar fin de spin (resultado). */
  onSpinComplete?: (result: SpinResult) => void;

  constructor() {
    super();

    // 0. Backboard (wallpaper azul tileable) — fondo del design stage.
    //    Dentro del design stage para que letterboxee con el resto y
    //    afuera queden barras negras en aspect ratios raros.
    const backboard = createBackboard();
    this.addChild(backboard);

    // 1. Reels (5×3) — posicionados EXACTO en el hole del template
    const initialResult = runSpin(createDemoRng(), 1);
    this.currentBoard = initialResult.board;
    this.reels = new Reels(this.currentBoard);
    this.reels.position.set(
      REELS.CENTER_X - REELS.WIDTH / 2,
      REELS.CENTER_Y - REELS.HEIGHT / 2,
    );
    this.addChild(this.reels);

    // 2. Bombitas marquee entre reels — encima de los reels (se ven
    //    cuando los símbolos están borrosos durante el spin) pero abajo
    //    del template (el template las clipea al hole transparente).
    this.dividerLights = new ReelDividerLights();
    this.addChild(this.dividerLights);

    // 3. Template overlay — full design rect, con hole transparente
    //    en el centro para que se vean los reels y las bombitas
    const templateTexture = Assets.get<Texture>('frame.template');
    if (templateTexture) {
      const template = new Sprite(templateTexture);
      template.width = DESIGN_WIDTH;
      template.height = DESIGN_HEIGHT;
      template.position.set(0, 0);
      this.addChild(template);
    }

    // 3. HUD — encima del template, en la zona "bottom shelf" donde
    //    el template tiene impreso "TIRE PARA GANAR". Los textos del HUD
    //    tapan ese texto del template.
    this.hud = new HUD();
    this.addChild(this.hud);
  }

  /**
   * Tira el spin: ejecuta math, anima los reels y resuelve cuando para.
   */
  async spin(betAmount: number): Promise<SpinResult> {
    if (this.spinning) {
      throw new Error('Ya hay un spin en curso');
    }
    this.spinning = true;
    this.dividerLights.setSpinning(true);
    try {
      const result = runSpin(createDemoRng(), betAmount);
      this.currentBoard = result.board;
      await this.reels.spin(result.board);
      this.onSpinComplete?.(result);
      return result;
    } finally {
      this.spinning = false;
      this.dividerLights.setSpinning(false);
    }
  }

  isSpinning(): boolean {
    return this.spinning;
  }

  getCurrentBoard(): Board {
    return this.currentBoard;
  }
}
