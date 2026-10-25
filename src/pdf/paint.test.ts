import { describe, expect, it } from 'vitest';
import type { BoxAnnotation } from '../annotations/model';
import { BLEED, paintRedactions } from './paint';

const base = { width: 600, height: 800 };

const box = (extra: Partial<BoxAnnotation> = {}): BoxAnnotation => ({
  id: 1,
  page: 1,
  kind: 'redact',
  x: 100,
  y: 200,
  width: 50,
  height: 30,
  color: '#000000',
  strokeWidth: 0,
  ...extra,
});

function paint(boxes: BoxAnnotation[], extra: 0 | 90 | 180 | 270, scale: number) {
  const rects: [number, number, number, number][] = [];
  const target = {
    fillStyle: '' as string | CanvasGradient | CanvasPattern,
    fillRect: (x: number, y: number, w: number, h: number) => rects.push([x, y, w, h]),
  };
  paintRedactions(target, boxes, base, extra, scale);
  return { rects, style: target.fillStyle };
}

describe('paintRedactions', () => {
  it('zet het vak in zwart op de plek van de pagina, met een marge rondom', () => {
    const { rects, style } = paint([box()], 0, 2);
    expect(style).toBe('#000000');
    // 100 × 2 = 200 → links 200 − marge; 50 × 2 = 100 breed, plus een marge aan elke kant.
    expect(rects).toEqual([[200 - BLEED, 400 - BLEED, 100 + 2 * BLEED, 60 + 2 * BLEED]]);
  });

  it('rondt naar buiten af, zodat er nooit een randje overblijft', () => {
    const [[x, y, w, h]] = paint([box({ x: 10.4, y: 20.6, width: 10.2, height: 10.2 })], 0, 1)
      .rects as [[number, number, number, number]];
    // Van 10,4 tot 20,6 wordt 10 tot 21 (plus marge), van 20,6 tot 30,8 wordt 20 tot 31.
    expect(x).toBe(10 - BLEED);
    expect(x + w).toBe(21 + BLEED);
    expect(y).toBe(20 - BLEED);
    expect(y + h).toBe(31 + BLEED);
  });

  it('rekent de plek om als de pagina is gedraaid', () => {
    // Een kwartslag rechtsom: (x, y) wordt (hoogte − y, x); het vak van (100,200) tot (150,230)
    // staat dan van x = 570 tot 600 en y = 100 tot 150.
    const [[x, y, w, h]] = paint([box()], 90, 1).rects as [[number, number, number, number]];
    expect([x, y, x + w, y + h]).toEqual([570 - BLEED, 100 - BLEED, 600 + BLEED, 150 + BLEED]);
    // Een halve slag: (600 − x, 800 − y).
    const [[x2, y2, w2, h2]] = paint([box()], 180, 1).rects as [[number, number, number, number]];
    expect([x2, y2, x2 + w2, y2 + h2]).toEqual([
      450 - BLEED,
      570 - BLEED,
      500 + BLEED,
      600 + BLEED,
    ]);
    // Drie kwartslagen: (y, breedte − x).
    const [[x3, y3, w3, h3]] = paint([box()], 270, 1).rects as [[number, number, number, number]];
    expect([x3, y3, x3 + w3, y3 + h3]).toEqual([
      200 - BLEED,
      450 - BLEED,
      230 + BLEED,
      500 + BLEED,
    ]);
  });

  it('tekent elk vak en doet niets zonder vakken', () => {
    expect(paint([box(), box({ id: 2, x: 300 })], 0, 1).rects).toHaveLength(2);
    expect(paint([], 0, 1).rects).toEqual([]);
  });
});
