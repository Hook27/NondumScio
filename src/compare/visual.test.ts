import { describe, expect, it } from 'vitest';
import { MAX_CANVAS_W, fitWidth, pixelDiff, stepZoom, targetWidths } from './visual';

/** Eén pixel (RGBA) per grijswaarde: 0 = zwart, 255 = wit. */
const pixels = (...grays: number[]) =>
  new Uint8ClampedArray(grays.flatMap((gray) => [gray, gray, gray, 255]));

/** De pixels van de uitkomst, per pixel [r, g, b]. */
const rgb = (data: Uint8ClampedArray) =>
  Array.from({ length: data.length / 4 }, (_, i) => [...data.slice(i * 4, i * 4 + 3)]);

describe('pixelDiff', () => {
  it('rood = inkt alleen in A, groen = alleen in B, grijs = gelijk', () => {
    const { data, diff, ink } = pixelDiff(pixels(0, 255, 255, 0), pixels(255, 0, 255, 0), 30);
    expect(rgb(data)).toEqual([
      [255, 30, 30],
      [25, 255, 60],
      // Wit op beide: donker; zwart op beide: lichter grijs.
      [18, 18, 32],
      [106, 106, 120],
    ]);
    expect(diff).toBe(2);
    expect(ink).toBe(3);
    // Altijd ondoorzichtig.
    expect([data[3], data[7], data[11], data[15]]).toEqual([255, 255, 255, 255]);
  });

  it('een klein verschil in helderheid telt als gelijk, tot boven de drempel', () => {
    expect(pixelDiff(pixels(200), pixels(180), 30).diff).toBe(0);
    expect(pixelDiff(pixels(200), pixels(180), 20).diff).toBe(0);
    const above = pixelDiff(pixels(200), pixels(180), 19);
    expect(above.diff).toBe(1);
    // B is donkerder: alleen in B, groen; een klein verschil geeft een zachtere kleur.
    expect(rgb(above.data)[0]).toEqual([46, 165, 86]);
  });

  it('telt een pixel als inkt vanaf een beetje donker', () => {
    expect(pixelDiff(pixels(231), pixels(231), 30).ink).toBe(0);
    expect(pixelDiff(pixels(230), pixels(230), 30).ink).toBe(1);
  });
});

describe('zoom en breedtes', () => {
  it('stapt door de zoomstappen, en blijft binnen de grenzen', () => {
    expect(stepZoom(100, 1)).toBe(125);
    expect(stepZoom(100, -1)).toBe(75);
    expect(stepZoom(50, -1)).toBe(50);
    expect(stepZoom(400, 1)).toBe(400);
    expect(stepZoom(110, 1)).toBe(100);
  });

  it('past een pagina in het vak, of twee naast elkaar', () => {
    expect(fitWidth(1000, false)).toBe(1000);
    expect(fitWidth(1000, true)).toBe(492);
    expect(fitWidth(100, false)).toBe(280);
    expect(fitWidth(100, true)).toBe(132);
  });

  it('tekent fijner op een scherm met hoge pixeldichtheid, hooguit 2× en hooguit 3200 breed', () => {
    expect(targetWidths(1000, 100, 1)).toEqual({ css: 1000, dev: 1000, ratio: 1 });
    expect(targetWidths(1000, 100, 2)).toEqual({ css: 1000, dev: 2000, ratio: 2 });
    expect(targetWidths(1000, 100, 3)).toEqual({ css: 1000, dev: 2000, ratio: 2 });
    expect(targetWidths(1000, 400, 2)).toEqual({ css: 4000, dev: MAX_CANVAS_W, ratio: 0.8 });
    expect(targetWidths(100, 50, 1)).toEqual({ css: 120, dev: 120, ratio: 1 });
    expect(targetWidths(1000, 100, 0).dev).toBe(1000);
  });
});
