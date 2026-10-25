import type { Rotation } from '../pages/plan';

export type Size = { width: number; height: number };
export type Point = { x: number; y: number };

/** De afmetingen zoals je de pagina ziet, met de extra draaiing uit het pagina-plan (rechtsom). */
export function displaySize(base: Size, extra: Rotation): Size {
  return extra === 90 || extra === 270 ? { width: base.height, height: base.width } : { ...base };
}

/**
 * Van een punt op de pagina in basisstand naar dat punt op het scherm (in punten), voor een
 * pagina met extra draaiing `extra` (90 = een kwartslag rechtsom).
 */
export function toDisplay(base: Size, extra: Rotation, { x, y }: Point): Point {
  if (extra === 90) return { x: base.height - y, y: x };
  if (extra === 180) return { x: base.width - x, y: base.height - y };
  if (extra === 270) return { x: y, y: base.width - x };
  return { x, y };
}

/** Het omgekeerde van `toDisplay`: van een punt op het scherm naar de pagina in basisstand. */
export function fromDisplay(base: Size, extra: Rotation, { x, y }: Point): Point {
  if (extra === 90) return { x: y, y: base.height - x };
  if (extra === 180) return { x: base.width - x, y: base.height - y };
  if (extra === 270) return { x: base.width - y, y: x };
  return { x, y };
}

/** De matrix van PDF: [a, b, c, d, e, f], zodat x' = a·x + c·y + e en y' = b·x + d·y + f. */
export type Matrix = [number, number, number, number, number, number];

/**
 * De matrix waarmee je in de basisstand van een pagina tekent (oorsprong linksonder, y naar
 * boven, in punten) en het toch op de goede plek in de PDF krijgt. `rotate` is de draaiing die
 * de pagina in het origineel heeft (/Rotate) en `box` het zichtbare vlak (de CropBox) in
 * PDF-coördinaten. Daarmee valt een annotatie op dezelfde plek als op het scherm, ook bij een
 * pagina die in het bestand zelf gedraaid is.
 */
export function baseToPdf(
  rotate: Rotation,
  box: { x: number; y: number; width: number; height: number },
): Matrix {
  const { x, y, width: w, height: h } = box;
  if (rotate === 90) return [0, 1, -1, 0, x + w, y];
  if (rotate === 180) return [-1, 0, 0, -1, x + w, y + h];
  if (rotate === 270) return [0, -1, 1, 0, x, y + h];
  return [1, 0, 0, 1, x, y];
}

/** De afmetingen van de pagina in basisstand: bij /Rotate 90 of 270 zijn breedte en hoogte verwisseld. */
export function baseSize(rotate: Rotation, box: Size): Size {
  return rotate === 90 || rotate === 270
    ? { width: box.height, height: box.width }
    : { width: box.width, height: box.height };
}

/** Past een matrix toe op een punt (voor tests en berekeningen). */
export function apply([a, b, c, d, e, f]: Matrix, { x, y }: Point): Point {
  return { x: a * x + c * y + e, y: b * x + d * y + f };
}
