// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { layoutBlock, type PageText } from '../compare/layout';
import { renderPage } from '../compare/visual';
import type { OcrWord } from '../pdf/ocrText';
import type { OcrEngine } from '../pdf/redact';
import { DEFAULT_TEXT_OPTIONS } from './extract';
import { OCR_DPI, ocrPieces, recognizePage } from './ocr';

vi.mock('../compare/visual', () => ({ renderPage: vi.fn() }));

/** Een woord in beeldpunten: links, boven, breedte en hoogte. */
const word = (text: string, x: number, y: number, w: number, h: number): OcrWord => ({
  text,
  x0: x,
  y0: y,
  x1: x + w,
  y1: y + h,
});

describe('ocrPieces', () => {
  it('rekent beeldpunten om naar punten vanaf linksonder, met de onderkant van het woord', () => {
    // 300 dpi: 300/72 beeldpunten per punt; een A4 is 842 punten hoog.
    const scale = 300 / 72;
    const [piece] = ocrPieces([word('Geachte', 300, 500, 250, 50)], scale, 842);
    expect(piece!.str).toBe('Geachte ');
    expect(piece!.x).toBeCloseTo(72);
    expect(piece!.y).toBeCloseTo(842 - 550 / scale);
    expect(piece!.w).toBeCloseTo(60);
    expect(piece!.fh).toBeCloseTo(12);
  });

  it('gebruikt de hoogte van de pagina zelf (ook Letter) en de gegeven schaal', () => {
    const [piece] = ocrPieces([word('Dear', 100, 200, 50, 20)], 2, 792);
    expect(piece).toEqual({ str: 'Dear ', x: 50, y: 792 - 110, fh: 10, w: 25 });
  });

  it('laat lege woorden weg en haalt witruimte rond een woord weg', () => {
    const pieces = ocrPieces([word(' ', 0, 0, 5, 5), word(' de ', 10, 0, 20, 10)], 1, 100);
    expect(pieces.map((p) => p.str)).toEqual(['de ']);
  });

  it('neemt hoogte en plek van de regel als de herkenning die geeft', () => {
    const line = { y0: 400, y1: 460 };
    const pieces = ocrPieces(
      [
        { ...word('Het', 100, 410, 60, 40), line },
        { ...word('jong', 180, 420, 80, 40), line },
      ],
      2,
      842,
    );
    expect(pieces.map((p) => [p.y, p.fh])).toEqual([
      [842 - 230, 30],
      [842 - 230, 30],
    ]);
  });

  /**
   * Regels zoals de herkenning ze gaf bij een eigen scan (300 dpi): een woord met een stok ("t",
   * "d") of hoofdletter is 33 beeldpunten hoog, een staart ("g", "j") gaat er 9 onder, en een
   * opsommingsteken is klein en staat midden in de regel. Met de regel erbij (stok tot staart).
   */
  function scanned(lines: string[][]): OcrWord[] {
    const words: OcrWord[] = [];
    lines.forEach((texts, row) => {
      const base = 850 + row * 141;
      let x = 238;
      for (const text of texts) {
        const bullet = text === '•';
        const top = bullet ? base - 22 : base - 33;
        const bottom = bullet ? base - 10 : /[gjpqy]/.test(text) ? base + 9 : base;
        const w = bullet ? 12 : text.length * 20;
        words.push({
          ...word(text, x, top, w, bottom - top),
          line: { y0: base - 33, y1: base + 9 },
        });
        x += w + 16;
      }
    });
    return words;
  }

  it('woorden met een staart blijven op hun regel, ook na een klein opsommingsteken', () => {
    const words = scanned([
      ['•', 'De', 'facturen', 'zijn', 'niet', 'geparafeerd', 'door', 'de', 'budgethouder.'],
      ['•', 'Het', 'contract', 'is', 'stilzwijgend', 'verlengd.'],
    ]);
    expect(layoutBlock(ocrPieces(words, 300 / 72, 842), DEFAULT_TEXT_OPTIONS, true)).toBe(
      '• De facturen zijn niet geparafeerd door de budgethouder.\n• Het contract is stilzwijgend verlengd.',
    );
  });
});

describe('recognizePage', () => {
  afterEach(() => vi.mocked(renderPage).mockReset());

  /** Een getekende pagina: een canvas dat een PNG kan maken. */
  function drawn(width: number) {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = Math.round(width * 1.4);
    canvas.toBlob = (done: BlobCallback) => done(new Blob([new Uint8Array([1, 2, 3])]));
    return canvas;
  }

  const page: PageText = { no: 2, w: 612, h: 792, items: [], chars: 0 };

  it('tekent de pagina op 300 dpi, laat herkennen en geeft de woorden als tekststukjes', async () => {
    const canvas = drawn(2550);
    vi.mocked(renderPage).mockResolvedValue(canvas);
    const recognize = vi.fn(async () => [word('Hallo', 255, 500, 200, 50)]);
    const engine: OcrEngine = { recognize, close: vi.fn() };
    const file = new File(['x'], 'scan.pdf');
    const signal = new AbortController().signal;
    const result = await recognizePage(file, page, engine, signal);
    // Letter (612 punten) op 300 dpi: 2550 beeldpunten breed.
    expect(renderPage).toHaveBeenCalledWith(file, 2, Math.round((612 * OCR_DPI) / 72), signal);
    expect(recognize).toHaveBeenCalledWith(new Uint8Array([1, 2, 3]), OCR_DPI);
    // 2550 beeldpunten voor 612 punten: 25/6 beeldpunten per punt.
    expect(result.items).toHaveLength(1);
    const [hallo] = result.items;
    expect(hallo!.str).toBe('Hallo ');
    expect(hallo!.x).toBeCloseTo(61.2);
    expect(hallo!.y).toBeCloseTo(792 - 132);
    expect(hallo!.fh).toBeCloseTo(12);
    expect(hallo!.w).toBeCloseTo(48);
    expect(result.chars).toBe(5);
    expect(result.no).toBe(2);
    expect(result.w).toBe(612);
    // Het canvas is meteen vrijgegeven.
    expect(canvas.width).toBe(0);
  });

  it('gestopt tijdens het herkennen: de belofte wordt afgewezen', async () => {
    vi.mocked(renderPage).mockResolvedValue(drawn(2550));
    const stop = new AbortController();
    const engine: OcrEngine = {
      recognize: () => {
        stop.abort('stopped');
        return new Promise(() => {});
      },
      close: vi.fn(),
    };
    await expect(
      recognizePage(new File(['x'], 'scan.pdf'), page, engine, stop.signal),
    ).rejects.toBe('stopped');
  });

  it('een pagina die niet bestaat: een fout', async () => {
    vi.mocked(renderPage).mockResolvedValue(null);
    const engine: OcrEngine = { recognize: vi.fn(), close: vi.fn() };
    await expect(
      recognizePage(new File(['x'], 'scan.pdf'), page, engine, new AbortController().signal),
    ).rejects.toThrow('Deze pagina bestaat niet');
    expect(engine.recognize).not.toHaveBeenCalled();
  });

  it('lukt het plaatje niet: een fout, en het canvas is toch vrijgegeven', async () => {
    const canvas = drawn(2550);
    canvas.toBlob = (done: BlobCallback) => done(null);
    vi.mocked(renderPage).mockResolvedValue(canvas);
    const engine: OcrEngine = { recognize: vi.fn(), close: vi.fn() };
    await expect(
      recognizePage(new File(['x'], 'scan.pdf'), page, engine, new AbortController().signal),
    ).rejects.toThrow('De afbeelding kon niet worden gemaakt');
    expect(canvas.width).toBe(0);
    expect(engine.recognize).not.toHaveBeenCalled();
  });
});
