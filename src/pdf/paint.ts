import { toDisplay, type Size } from '../annotations/geometry';
import type { BoxAnnotation } from '../annotations/model';
import type { Rotation } from '../pages/plan';

/** Een kleine marge rondom elk zwart vak (in beeldpunten), tegen afrondingen en half gekleurde randen. */
export const BLEED = 1;

/** Wat er van een canvas nodig is om vakken te tekenen. */
export type FillTarget = {
  fillStyle: string | CanvasGradient | CanvasPattern;
  fillRect: (x: number, y: number, width: number, height: number) => void;
};

/**
 * Zet de redactievakken zwart op een getekende pagina. De vakken staan in de basisstand van de
 * pagina (punten); `extra` is de draaiing uit het pagina-plan waarmee de pagina is getekend en
 * `scale` het aantal beeldpunten per punt. Elk vak wordt naar buiten afgerond en krijgt een
 * marge, zodat er geen randje van wat eronder stond overblijft.
 */
export function paintRedactions(
  target: FillTarget,
  boxes: readonly BoxAnnotation[],
  base: Size,
  extra: Rotation,
  scale: number,
) {
  target.fillStyle = '#000000';
  for (const box of boxes) {
    const a = toDisplay(base, extra, { x: box.x, y: box.y });
    const b = toDisplay(base, extra, { x: box.x + box.width, y: box.y + box.height });
    const left = Math.floor(Math.min(a.x, b.x) * scale) - BLEED;
    const top = Math.floor(Math.min(a.y, b.y) * scale) - BLEED;
    const right = Math.ceil(Math.max(a.x, b.x) * scale) + BLEED;
    const bottom = Math.ceil(Math.max(a.y, b.y) * scale) + BLEED;
    target.fillRect(left, top, right - left, bottom - top);
  }
}
