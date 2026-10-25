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

/** Een vlak in beeldpunten van een getekende pagina, met de hoekpunten linksboven en rechtsonder. */
export type PixelRect = { x0: number; y0: number; x1: number; y1: number };

/**
 * De vlakken (in beeldpunten van de getekende pagina) die bij de redactievakken zwart worden. De
 * vakken staan in de basisstand van de pagina (punten); `extra` is de draaiing uit het pagina-plan
 * waarmee de pagina is getekend en `scale` het aantal beeldpunten per punt. Elk vak wordt naar
 * buiten afgerond en krijgt een marge, zodat er geen randje van wat eronder stond overblijft.
 */
export function redactionRects(
  boxes: readonly BoxAnnotation[],
  base: Size,
  extra: Rotation,
  scale: number,
): PixelRect[] {
  return boxes.map((box) => {
    const a = toDisplay(base, extra, { x: box.x, y: box.y });
    const b = toDisplay(base, extra, { x: box.x + box.width, y: box.y + box.height });
    return {
      x0: Math.floor(Math.min(a.x, b.x) * scale) - BLEED,
      y0: Math.floor(Math.min(a.y, b.y) * scale) - BLEED,
      x1: Math.ceil(Math.max(a.x, b.x) * scale) + BLEED,
      y1: Math.ceil(Math.max(a.y, b.y) * scale) + BLEED,
    };
  });
}

/** Zet de redactievakken zwart op een getekende pagina (zie `redactionRects`). */
export function paintRedactions(
  target: FillTarget,
  boxes: readonly BoxAnnotation[],
  base: Size,
  extra: Rotation,
  scale: number,
) {
  target.fillStyle = '#000000';
  for (const { x0, y0, x1, y1 } of redactionRects(boxes, base, extra, scale)) {
    target.fillRect(x0, y0, x1 - x0, y1 - y0);
  }
}
