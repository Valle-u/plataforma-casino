/**
 * HUD — controles del slot dentro del canvas PixiJS, posicionados en
 * la "bottom shelf" del template.
 *
 * Layout horizontal (matcheando el original Pragmatic):
 *   ┌────────────────────────────────────────────────────────────────┐
 *   │  [☰] [ⓘ]    CRÉDITO    MANTENGA LA TECLA ESPACIO  [−] [SPIN] [+]
 *   │  [🔊]        100,00 €   PARA TIRADA TURBO                       │
 *   │              APUESTA                              TIR. AUTO.   │
 *   │              1,00 €                                            │
 *   └────────────────────────────────────────────────────────────────┘
 *
 * API:
 *   - setCredit(n) / setBet(n) / setSpinning(b) → React pushea state
 *   - onSpinClick / onBetUp / onBetDown → callbacks que React asigna
 */

import { Container, Graphics, Text } from 'pixi.js';
import { DESIGN_WIDTH } from '../core/Layout';

// Y del bottom shelf en design space
const HUD_Y_TOP = 935;
const HUD_Y_BOTTOM = 1080;
const HUD_HEIGHT = HUD_Y_BOTTOM - HUD_Y_TOP;
const HUD_CENTER_Y = HUD_Y_TOP + HUD_HEIGHT / 2;

// Colores
const GOLD = 0xffd700;
const GOLD_BRIGHT = 0xffec5c;
const GOLD_DARK = 0xb8860b;
const ORANGE = 0xff8c2e;
const WHITE = 0xffffff;
const CREAM = 0xfff5e6;
const DARK = 0x1a0a2e;
const BTN_BG = 0x2d1547;

function formatMoney(n: number): string {
  return n.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

const FONT = 'Fredoka, system-ui, sans-serif';

export class HUD extends Container {
  private creditValue!: Text;
  private betValue!: Text;
  private centerLine1!: Text;
  private centerLine2!: Text;
  private spinButton!: Container;
  private spinButtonBg!: Graphics;
  private plusButton!: Container;
  private minusButton!: Container;
  private spinning = false;

  /** Callbacks que React asigna */
  onSpinClick?: () => void;
  onBetUp?: () => void;
  onBetDown?: () => void;

  constructor() {
    super();
    this.buildIcons();
    this.buildCreditBetSection();
    this.buildCenterMessage();
    this.buildRightControls();
  }

  setCredit(value: number): void {
    this.creditValue.text = formatMoney(value) + ' €';
  }

  setBet(value: number): void {
    this.betValue.text = formatMoney(value) + ' €';
  }

  setSpinning(spinning: boolean): void {
    this.spinning = spinning;
    const dimAlpha = spinning ? 0.5 : 1.0;
    this.spinButtonBg.alpha = dimAlpha;
    this.plusButton.alpha = dimAlpha;
    this.minusButton.alpha = dimAlpha;
    this.spinButton.eventMode = spinning ? 'none' : 'static';
    this.plusButton.eventMode = spinning ? 'none' : 'static';
    this.minusButton.eventMode = spinning ? 'none' : 'static';

    // Cambiar mensaje central — "¡BUENA SUERTE!" durante spin
    if (spinning) {
      this.centerLine1.text = '¡BUENA SUERTE!';
      this.centerLine2.text = '';
      this.centerLine1.style.fill = GOLD_BRIGHT;
      this.centerLine1.style.fontSize = 22;
    } else {
      this.centerLine1.text = 'MANTENGA LA TECLA ESPACIO PARA TIRADA';
      this.centerLine2.text = 'TURBO';
      this.centerLine1.style.fill = WHITE;
      this.centerLine1.style.fontSize = 16;
    }
  }

  // ─── Iconos de la izquierda (☰ ⓘ 🔊) + PRAGMATIC PLAY ─────────────
  private buildIcons(): void {
    const xBase = 50;

    // ☰ hamburger menu — 3 líneas horizontales
    const menu = new Graphics();
    const menuY = HUD_Y_TOP + 30;
    for (let i = 0; i < 3; i++) {
      menu.rect(xBase, menuY + i * 8, 22, 3).fill({ color: WHITE });
    }
    this.addChild(menu);

    // ⓘ info icon — círculo con "i"
    const infoX = xBase + 50;
    const infoY = menuY + 8;
    const info = new Graphics()
      .circle(infoX + 11, infoY, 14)
      .stroke({ width: 2, color: WHITE });
    this.addChild(info);
    const infoTxt = new Text({
      text: 'i',
      style: { fill: WHITE, fontSize: 20, fontFamily: 'Georgia, serif', fontWeight: '700', fontStyle: 'italic' },
    });
    infoTxt.anchor.set(0.5);
    infoTxt.position.set(infoX + 11, infoY);
    this.addChild(infoTxt);

    // 🔊 sound icon (speaker shape with X for muted, here normal)
    const soundX = xBase;
    const soundY = HUD_Y_TOP + 70;
    const speaker = new Graphics()
      .moveTo(soundX, soundY + 4)
      .lineTo(soundX + 6, soundY + 4)
      .lineTo(soundX + 12, soundY - 2)
      .lineTo(soundX + 12, soundY + 14)
      .lineTo(soundX + 6, soundY + 8)
      .lineTo(soundX, soundY + 8)
      .closePath()
      .fill({ color: WHITE });
    // sound waves (2 arcs)
    speaker
      .moveTo(soundX + 16, soundY + 1)
      .quadraticCurveTo(soundX + 22, soundY + 6, soundX + 16, soundY + 11)
      .stroke({ width: 2, color: WHITE });
    this.addChild(speaker);

    // PRAGMATIC PLAY label
    const pragmatic = new Text({
      text: 'PRAGMATIC PLAY',
      style: { fill: WHITE, fontSize: 12, fontFamily: FONT, fontWeight: '700', letterSpacing: 1 },
    });
    pragmatic.position.set(xBase, HUD_Y_BOTTOM - 24);
    this.addChild(pragmatic);
  }

  // ─── CRÉDITO + APUESTA (apilados, labels ámbar, values blancos) ────
  private buildCreditBetSection(): void {
    const xLabel = 280;
    const xValue = 460;

    // CRÉDITO label
    const creditLabel = new Text({
      text: 'CRÉDITO',
      style: { fill: ORANGE, fontSize: 22, fontFamily: FONT, fontWeight: '700', letterSpacing: 1 },
    });
    creditLabel.anchor.set(0, 0.5);
    creditLabel.position.set(xLabel, HUD_CENTER_Y - 18);
    this.addChild(creditLabel);

    // CRÉDITO value
    this.creditValue = new Text({
      text: '0,00 €',
      style: { fill: WHITE, fontSize: 28, fontFamily: FONT, fontWeight: '700' },
    });
    this.creditValue.anchor.set(0, 0.5);
    this.creditValue.position.set(xValue, HUD_CENTER_Y - 18);
    this.addChild(this.creditValue);

    // APUESTA label
    const betLabel = new Text({
      text: 'APUESTA',
      style: { fill: ORANGE, fontSize: 22, fontFamily: FONT, fontWeight: '700', letterSpacing: 1 },
    });
    betLabel.anchor.set(0, 0.5);
    betLabel.position.set(xLabel, HUD_CENTER_Y + 18);
    this.addChild(betLabel);

    // APUESTA value
    this.betValue = new Text({
      text: '0,00 €',
      style: { fill: WHITE, fontSize: 28, fontFamily: FONT, fontWeight: '700' },
    });
    this.betValue.anchor.set(0, 0.5);
    this.betValue.position.set(xValue, HUD_CENTER_Y + 18);
    this.addChild(this.betValue);
  }

  // ─── "MANTENGA LA TECLA ESPACIO PARA TIRADA TURBO" ─────────────────
  // Centrado HORIZONTALMENTE en DESIGN_WIDTH/2.
  // Posicionado en la mitad INFERIOR del bottom shelf para evitar el
  // texto "¡TIRE PARA GANAR!" baked-in del template (que está arriba).
  private buildCenterMessage(): void {
    const cx = DESIGN_WIDTH / 2; // centrado horizontal exacto
    // Y positions — la mitad inferior del bottom shelf (y=935-1080).
    // Line 1 alrededor de y=1020, line 2 alrededor de y=1048.
    const yLine1 = HUD_Y_TOP + 85;
    const yLine2 = HUD_Y_TOP + 113;

    this.centerLine1 = new Text({
      text: 'MANTENGA LA TECLA ESPACIO PARA TIRADA',
      style: { fill: WHITE, fontSize: 16, fontFamily: FONT, fontWeight: '700', letterSpacing: 1 },
    });
    this.centerLine1.anchor.set(0.5, 0.5);
    this.centerLine1.position.set(cx, yLine1);
    this.addChild(this.centerLine1);

    this.centerLine2 = new Text({
      text: 'TURBO',
      style: { fill: WHITE, fontSize: 16, fontFamily: FONT, fontWeight: '700', letterSpacing: 2 },
    });
    this.centerLine2.anchor.set(0.5, 0.5);
    this.centerLine2.position.set(cx, yLine2);
    this.addChild(this.centerLine2);
  }

  // ─── Controles derecha: − SPIN + + TIR.AUTO ────────────────────────
  private buildRightControls(): void {
    // Posiciones: el SPIN va a la derecha, y los +/- a sus lados
    const spinX = DESIGN_WIDTH - 220;
    const spacing = 110;

    // − button (a la izquierda del spin)
    this.minusButton = this.buildSmallCircleButton('−', spinX - spacing, HUD_CENTER_Y, 32);
    this.minusButton.on('pointertap', () => this.onBetDown?.());
    this.addChild(this.minusButton);

    // + button (a la derecha del spin)
    this.plusButton = this.buildSmallCircleButton('+', spinX + spacing, HUD_CENTER_Y, 32);
    this.plusButton.on('pointertap', () => this.onBetUp?.());
    this.addChild(this.plusButton);

    // SPIN button (grande, con flechas circulares)
    this.spinButton = new Container();
    this.spinButton.position.set(spinX, HUD_CENTER_Y - 6);
    this.spinButton.eventMode = 'static';
    this.spinButton.cursor = 'pointer';

    const radius = 50;
    this.spinButtonBg = new Graphics()
      .circle(0, 0, radius)
      .fill({ color: DARK })
      .stroke({ width: 3, color: WHITE });
    this.spinButton.addChild(this.spinButtonBg);

    // Inner ring (decorative)
    const innerRing = new Graphics()
      .circle(0, 0, radius - 8)
      .stroke({ width: 1.5, color: WHITE, alpha: 0.7 });
    this.spinButton.addChild(innerRing);

    // Ícono de flechas circulares (refresh) — dos arcos con flechas
    const arrowIcon = this.buildRefreshArrows(22);
    this.spinButton.addChild(arrowIcon);

    this.spinButton.on('pointerover', () => {
      if (!this.spinning) this.spinButton.scale.set(1.06);
    });
    this.spinButton.on('pointerout', () => {
      this.spinButton.scale.set(1.0);
    });
    this.spinButton.on('pointertap', () => this.onSpinClick?.());
    this.addChild(this.spinButton);

    // TIR. AUTO. label debajo del spin
    const tirAuto = new Text({
      text: 'TIR. AUTO.',
      style: {
        fill: WHITE,
        fontSize: 12,
        fontFamily: FONT,
        fontWeight: '700',
        letterSpacing: 1.5,
      },
    });
    tirAuto.anchor.set(0.5, 0);
    tirAuto.position.set(spinX, HUD_Y_BOTTOM - 25);
    this.addChild(tirAuto);

    // Pequeño icono de "speech" antes de TIR. AUTO.
    const speech = new Graphics();
    const speechX = spinX - 50;
    const speechY = HUD_Y_BOTTOM - 22;
    speech
      .moveTo(speechX, speechY)
      .lineTo(speechX + 4, speechY + 5)
      .lineTo(speechX - 4, speechY + 5)
      .closePath()
      .fill({ color: WHITE });
    // Tres líneas curvas (las "ondas")
    for (let i = 0; i < 3; i++) {
      speech
        .moveTo(speechX - 8 - i * 4, speechY - 2)
        .quadraticCurveTo(speechX - 12 - i * 4, speechY + 2, speechX - 8 - i * 4, speechY + 6)
        .stroke({ width: 1.5, color: WHITE });
    }
    this.addChild(speech);
  }

  /**
   * Dibuja dos flechas circulares (icono de "spin/refresh") centradas
   * en (0,0). Cada arco va de ~45° a ~225° con una punta de flecha.
   */
  private buildRefreshArrows(radius: number): Graphics {
    const g = new Graphics();

    // Arco superior: de 0.4π a 1.5π (sentido horario)
    const stroke = { width: 5, color: WHITE };
    g.arc(0, 0, radius, Math.PI * 0.15, Math.PI * 1.0).stroke(stroke);
    // Arco inferior (espejado)
    g.arc(0, 0, radius, Math.PI * 1.15, Math.PI * 2.0).stroke(stroke);

    // Puntas de flecha en los extremos
    // Top arrow tip (al final del arco superior, ~angle 1.0π = lado izquierdo)
    const tipL = { x: -radius, y: 0 };
    g.moveTo(tipL.x - 6, tipL.y - 8)
      .lineTo(tipL.x - 6, tipL.y + 4)
      .lineTo(tipL.x + 4, tipL.y - 2)
      .closePath()
      .fill({ color: WHITE });

    // Bottom arrow tip (al final del arco inferior, ~angle 2π = lado derecho)
    const tipR = { x: radius, y: 0 };
    g.moveTo(tipR.x + 6, tipR.y + 8)
      .lineTo(tipR.x + 6, tipR.y - 4)
      .lineTo(tipR.x - 4, tipR.y + 2)
      .closePath()
      .fill({ color: WHITE });

    return g;
  }

  /** Helper: botón circular pequeño con label de un caracter (+/-). */
  private buildSmallCircleButton(label: string, x: number, y: number, radius: number): Container {
    const btn = new Container();
    btn.position.set(x, y);
    btn.eventMode = 'static';
    btn.cursor = 'pointer';

    const bg = new Graphics()
      .circle(0, 0, radius)
      .fill({ color: BTN_BG, alpha: 0.6 })
      .stroke({ width: 2, color: WHITE });
    btn.addChild(bg);

    const txt = new Text({
      text: label,
      style: {
        fill: WHITE,
        fontSize: 32,
        fontFamily: FONT,
        fontWeight: '700',
      },
    });
    txt.anchor.set(0.5);
    txt.y = -2;
    btn.addChild(txt);

    btn.on('pointerover', () => btn.scale.set(1.1));
    btn.on('pointerout', () => btn.scale.set(1.0));

    return btn;
  }
}

// Silencia warnings si quedaron imports sin uso (PALETTE no se usa acá)
void GOLD; void GOLD_BRIGHT; void GOLD_DARK; void CREAM;
