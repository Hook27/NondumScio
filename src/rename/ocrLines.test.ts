import { describe, expect, it } from 'vitest';
import type { OcrWord } from '../pdf/ocrText';
import { linesFromWords } from './ocrLines';

/** Een woord op plek x (links) en y (bovenkant), in beeldpunten; standaard 30 hoog. */
const word = (text: string, x: number, y: number, height = 30): OcrWord => ({
  text,
  x0: x,
  y0: y,
  x1: x + text.length * 15,
  y1: y + height,
});

describe('linesFromWords: herkende woorden in regels', () => {
  it('van boven naar beneden, binnen een regel van links naar rechts', () => {
    const words = [
      word('Utrecht', 300, 100),
      word('Datum:', 100, 200),
      word('Gemeente', 100, 102),
      word('2026', 500, 198),
      word('12', 220, 201),
      word('maart', 280, 200),
    ];
    expect(linesFromWords(words)).toEqual(['Gemeente Utrecht', 'Datum: 12 maart 2026']);
  });

  it('twee kolommen op dezelfde hoogte worden één regel, zoals bij de tekstlaag', () => {
    const words = [word('Datum:', 1200, 104), word('Belastingdienst', 100, 100)];
    expect(linesFromWords(words)).toEqual(['Belastingdienst Datum:']);
  });

  it('een hoog logo naast het briefhoofd haalt de regels ernaast niet door elkaar', () => {
    const words = [
      word('LOGO', 100, 80, 120),
      word('Gemeente', 400, 100),
      word('Utrecht', 560, 100),
      word('Postbus', 400, 150),
      word('16200', 520, 150),
    ];
    expect(linesFromWords(words)).toEqual(['LOGO', 'Gemeente Utrecht', 'Postbus 16200']);
  });

  it('een woord met een staart (iets lager) blijft in zijn regel', () => {
    const words = [
      word('Bijlage', 300, 240),
      word('pagina', 100, 245, 38),
      word('Daarna', 100, 300),
    ];
    expect(linesFromWords(words)).toEqual(['pagina Bijlage', 'Daarna']);
  });

  it('lege woorden vallen weg; spaties in een woord worden opgeruimd; niets geeft geen regels', () => {
    expect(linesFromWords([word('  ', 0, 0), word(' Betreft: ', 0, 50)])).toEqual(['Betreft:']);
    expect(linesFromWords([])).toEqual([]);
  });
});
