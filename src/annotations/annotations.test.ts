import { describe, expect, it } from 'vitest';
import type { Rotation } from '../pages/plan';
import { apply, baseSize, baseToPdf, displaySize, fromDisplay, toDisplay } from './geometry';
import {
  annotationsOf,
  boxFrom,
  canDraw,
  drawableText,
  groupByPage,
  keptOnPage,
  moved,
  tooSmall,
  unsupportedChars,
  type Annotation,
  type BoxAnnotation,
  type LineAnnotation,
  type TextAnnotation,
} from './model';

const ROTATIONS: Rotation[] = [0, 90, 180, 270];
const base = { width: 600, height: 800 };

describe('weergave van een pagina met extra draaiing', () => {
  it('verwisselt breedte en hoogte bij een kwartslag', () => {
    expect(displaySize(base, 0)).toEqual({ width: 600, height: 800 });
    expect(displaySize(base, 90)).toEqual({ width: 800, height: 600 });
    expect(displaySize(base, 180)).toEqual({ width: 600, height: 800 });
    expect(displaySize(base, 270)).toEqual({ width: 800, height: 600 });
  });

  it('zet de hoeken van de pagina op de hoeken van het gedraaide scherm', () => {
    // Een kwartslag rechtsom: linksboven gaat naar rechtsboven, linksonder naar linksboven.
    expect(toDisplay(base, 90, { x: 0, y: 0 })).toEqual({ x: 800, y: 0 });
    expect(toDisplay(base, 90, { x: 0, y: 800 })).toEqual({ x: 0, y: 0 });
    expect(toDisplay(base, 90, { x: 600, y: 800 })).toEqual({ x: 0, y: 600 });
    expect(toDisplay(base, 180, { x: 0, y: 0 })).toEqual({ x: 600, y: 800 });
    // Drie kwartslagen: linksboven gaat naar linksonder.
    expect(toDisplay(base, 270, { x: 0, y: 0 })).toEqual({ x: 0, y: 600 });
    expect(toDisplay(base, 270, { x: 600, y: 0 })).toEqual({ x: 0, y: 0 });
  });

  it('is omkeerbaar', () => {
    for (const rotation of ROTATIONS) {
      for (const point of [
        { x: 0, y: 0 },
        { x: 123.5, y: 456.25 },
        { x: 600, y: 800 },
      ]) {
        expect(fromDisplay(base, rotation, toDisplay(base, rotation, point))).toEqual(point);
      }
    }
  });
});

describe('van de basisstand naar de PDF', () => {
  const box = { x: 10, y: 20, width: 600, height: 800 };

  /** Linksboven, linksonder en rechtsonder van het scherm (y omhoog), in PDF-coördinaten. */
  function corners(rotate: Rotation) {
    const matrix = baseToPdf(rotate, box);
    const { width, height } = baseSize(rotate, box);
    return {
      topLeft: apply(matrix, { x: 0, y: height }),
      bottomLeft: apply(matrix, { x: 0, y: 0 }),
      bottomRight: apply(matrix, { x: width, y: 0 }),
    };
  }

  it('zonder draaiing: gewoon verschoven naar de linkeronderhoek van het vak', () => {
    expect(corners(0)).toEqual({
      topLeft: { x: 10, y: 820 },
      bottomLeft: { x: 10, y: 20 },
      bottomRight: { x: 610, y: 20 },
    });
  });

  it('bij /Rotate 90 (pagina rechtsom): wat je linksonder ziet, is origineel rechtsonder', () => {
    expect(corners(90)).toEqual({
      topLeft: { x: 10, y: 20 },
      bottomLeft: { x: 610, y: 20 },
      bottomRight: { x: 610, y: 820 },
    });
  });

  it('bij /Rotate 180 staat alles op zijn kop', () => {
    expect(corners(180)).toEqual({
      topLeft: { x: 610, y: 20 },
      bottomLeft: { x: 610, y: 820 },
      bottomRight: { x: 10, y: 820 },
    });
  });

  it('bij /Rotate 270 (pagina linksom): wat je linksonder ziet, is origineel linksboven', () => {
    expect(corners(270)).toEqual({
      topLeft: { x: 610, y: 820 },
      bottomLeft: { x: 10, y: 820 },
      bottomRight: { x: 10, y: 20 },
    });
  });

  it('draait de pagina-afmetingen bij 90 en 270', () => {
    expect(baseSize(0, box)).toEqual({ width: 600, height: 800 });
    expect(baseSize(90, box)).toEqual({ width: 800, height: 600 });
    expect(baseSize(270, box)).toEqual({ width: 800, height: 600 });
  });
});

const text: TextAnnotation = {
  id: 1,
  page: 7,
  kind: 'text',
  x: 50,
  y: 60,
  text: 'Hallo',
  size: 14,
  color: '#000000',
};
const rect: BoxAnnotation = {
  id: 2,
  page: 7,
  kind: 'rect',
  x: 10,
  y: 20,
  width: 100,
  height: 40,
  color: '#d92d20',
  strokeWidth: 2,
};
const line: LineAnnotation = {
  id: 3,
  page: 8,
  kind: 'line',
  x1: 0,
  y1: 0,
  x2: 30,
  y2: 40,
  color: '#d92d20',
  strokeWidth: 2,
};

describe('annotaties', () => {
  it('geeft de annotaties van één pagina', () => {
    const all: Annotation[] = [text, rect, line];
    expect(annotationsOf(all, 7).map((a) => a.id)).toEqual([1, 2]);
    expect(annotationsOf(all, 8).map((a) => a.id)).toEqual([3]);
    expect(annotationsOf(all, 9)).toEqual([]);
  });

  it('groepeert alles per pagina in één keer, in dezelfde volgorde als annotationsOf', () => {
    const all: Annotation[] = [text, rect, line];
    const groups = groupByPage(all);
    expect([...groups.keys()]).toEqual([7, 8]);
    for (const page of [7, 8, 9]) {
      expect(groups.get(page) ?? []).toEqual(annotationsOf(all, page));
    }
    expect(groupByPage([]).size).toBe(0);
  });

  it('verplaatst elk soort annotatie', () => {
    expect(moved(text, 5, -10)).toMatchObject({ x: 55, y: 50 });
    expect(moved(rect, 1, 2)).toMatchObject({ x: 11, y: 22, width: 100, height: 40 });
    expect(moved(line, 10, 10)).toMatchObject({ x1: 10, y1: 10, x2: 40, y2: 50 });
  });

  it('maakt een vak uit twee hoeken, in elke richting', () => {
    expect(boxFrom(10, 10, 30, 50)).toEqual({ x: 10, y: 10, width: 20, height: 40 });
    expect(boxFrom(30, 50, 10, 10)).toEqual({ x: 10, y: 10, width: 20, height: 40 });
    expect(boxFrom(30, 10, 10, 50)).toEqual({ x: 10, y: 10, width: 20, height: 40 });
  });

  it('ziet een klik of lege tekst als te klein', () => {
    expect(tooSmall({ ...rect, width: 2 })).toBe(true);
    expect(tooSmall({ ...rect, height: 3 })).toBe(true);
    expect(tooSmall(rect)).toBe(false);
    expect(tooSmall({ ...line, x2: 1, y2: 1 })).toBe(true);
    expect(tooSmall(line)).toBe(false);
    expect(tooSmall({ ...text, text: '  \n ' })).toBe(true);
    expect(tooSmall(text)).toBe(false);
  });

  it('houdt een annotatie binnen de pagina', () => {
    const page = { width: 200, height: 300 };
    expect(keptOnPage({ ...rect, x: 190, y: -5 }, page)).toMatchObject({ x: 100, y: 0 });
    expect(keptOnPage({ ...text, x: -10, y: 400 }, page)).toMatchObject({ x: 0, y: 300 });
    expect(keptOnPage({ ...line, x1: -5, x2: 250, y2: 999 }, page)).toMatchObject({
      x1: 0,
      x2: 200,
      y2: 300,
    });
  });
});

describe('tekens die de standaardletter kan tekenen', () => {
  it('kent gewone letters, accenten, € en typografische tekens', () => {
    for (const char of ['a', 'Z', '9', ' ', 'é', 'ë', 'ü', 'ñ', '€', '’', '“', '–', '…', '\n']) {
      expect(canDraw(char), char).toBe(true);
    }
  });

  it('kent geen Grieks, Chinees, emoji of wiskundige tekens', () => {
    for (const char of ['α', '漢', '😀', '≤', '∑', 'ł']) expect(canDraw(char), char).toBe(false);
  });

  it('geeft de onbekende tekens, elk één keer', () => {
    expect(unsupportedChars('prijs: 5 € α α 😀')).toEqual(['α', '😀']);
    expect(unsupportedChars('gewoon Nederlands, met één é')).toEqual([]);
  });

  it('maakt van onbekende tekens een vraagteken en normaliseert regeleinden', () => {
    expect(drawableText('a α b')).toBe('a ? b');
    expect(drawableText('regel 1\r\nregel 2\rregel 3')).toBe('regel 1\nregel 2\nregel 3');
    // Een emoji is één teken, niet twee.
    expect(drawableText('😀')).toBe('?');
  });
});
