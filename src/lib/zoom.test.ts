import { describe, expect, it } from 'vitest';
import { PX_PER_PT, ZOOM_KEYS, ZOOM_STEPS, nextZoom, realPercent, realWidth } from './zoom';

describe('zoomen: 100 % is de echte maat', () => {
  it('een punt is bij 100 % 96/72 beeldpunten: een A4 (595 punten) is 793 breed', () => {
    expect(PX_PER_PT).toBeCloseTo(4 / 3, 10);
    expect(Math.round(realWidth(595, 100))).toBe(793);
    expect(Math.round(realWidth(595, 50))).toBe(397);
    expect(realWidth(72, 200)).toBe(192);
  });

  it('rekent een breedte terug naar procenten van de echte maat', () => {
    expect(realPercent(793.33, 595)).toBeCloseTo(100, 1);
    // Zoals gemeten op een scherm van 1280 breed: Hele breedte in Platte tekst.
    expect(Math.round(realPercent(875, 595))).toBe(110);
    expect(realPercent(realWidth(612, 67), 612)).toBeCloseTo(67, 10);
    // Zonder maat (nog niet bekend): gewoon 100.
    expect(realPercent(500, 0)).toBe(100);
  });

  it('de vaste stappen, van 25 tot 400 %', () => {
    expect([...ZOOM_STEPS]).toEqual([25, 33, 50, 67, 75, 100, 125, 150, 200, 300, 400]);
  });

  it('+ naar de eerste stap boven wat je ziet, − naar de eerste eronder', () => {
    // Passend op 110 %: + naar 125, − naar 100.
    expect(nextZoom(110, 1)).toBe(125);
    expect(nextZoom(110, -1)).toBe(100);
    // Op een stap: de buurstap.
    expect(nextZoom(100, 1)).toBe(125);
    expect(nextZoom(100, -1)).toBe(75);
    expect(nextZoom(33, -1)).toBe(25);
    // Bijna op een stap (afronding): telt als die stap.
    expect(nextZoom(100.4, 1)).toBe(125);
    expect(nextZoom(99.6, -1)).toBe(75);
    expect(nextZoom(99.6, 1)).toBe(125);
    expect(nextZoom(100.4, -1)).toBe(75);
    // Net daarboven of -onder: wel naar die stap.
    expect(nextZoom(99.4, 1)).toBe(100);
    expect(nextZoom(100.6, -1)).toBe(100);
    // Aan de randen houdt het op.
    expect(nextZoom(400, 1)).toBeNull();
    expect(nextZoom(25, -1)).toBeNull();
    expect(nextZoom(20, -1)).toBeNull();
    expect(nextZoom(20, 1)).toBe(25);
    expect(nextZoom(500, -1)).toBe(400);
  });

  it('de toetsen: + en = groter, − en _ kleiner', () => {
    expect(ZOOM_KEYS).toEqual({ '+': 1, '=': 1, '-': -1, _: -1 });
  });
});
