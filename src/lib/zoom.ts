/**
 * Zoomen, overal hetzelfde (bedieningsafspraak V5): 100 % is de echte maat, zoals in Acrobat of
 * Word. Een PDF meet in punten (72 per inch), het scherm in beeldpunten (96 per inch): bij 100 % is
 * een punt dus 96/72 = 1,33 beeldpunten, en een A4 (595 punten) 793 beeldpunten breed.
 *
 * De zoomstand is "passend" (`null`: een van de passend-knoppen, de maat hangt aan het vak) of een
 * vaste stap. + gaat naar de eerste stap boven wat je ziet, − naar de eerste eronder; zo ligt
 * passend er altijd tussen.
 */

/** Beeldpunten per PDF-punt bij 100 %. */
export const PX_PER_PT = 96 / 72;

/** De vaste zoomstappen, in procenten van de echte maat. */
export const ZOOM_STEPS = [25, 33, 50, 67, 75, 100, 125, 150, 200, 300, 400] as const;

/** Passend (`null`), of een vaste stap in procenten van de echte maat. */
export type Zoom = number | null;

/** De toetsen om te zoomen: + (ook = zonder Shift) groter, − (ook _) kleiner. 0 is passend. */
export const ZOOM_KEYS: Readonly<Record<string, 1 | -1>> = { '+': 1, '=': 1, '-': -1, _: -1 };

/** Hoe breed (in beeldpunten) een pagina van `points` punten is bij `percent` % van de echte maat. */
export function realWidth(points: number, percent: number): number {
  return (points * PX_PER_PT * percent) / 100;
}

/** Hoeveel procent van de echte maat een pagina van `points` punten is als ze `width` breed is. */
export function realPercent(width: number, points: number): number {
  return points > 0 ? (width / (points * PX_PER_PT)) * 100 : 100;
}

/**
 * De eerste stap boven (`dir` 1) of onder (−1) wat je nu ziet (`shown`, in procenten); `null` als
 * er geen meer is. Een halve procent marge: wat op een stap staat, telt als die stap.
 */
export function nextZoom(shown: number, dir: 1 | -1): number | null {
  const steps: readonly number[] = ZOOM_STEPS;
  return dir > 0
    ? (steps.find((step) => step > shown + 0.5) ?? null)
    : ([...steps].reverse().find((step) => step < shown - 0.5) ?? null);
}
