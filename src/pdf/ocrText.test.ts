import { PDFArray, PDFDocument, PDFRawStream, StandardFonts, decodePDFRawStream } from 'pdf-lib';
import * as lib from 'pdf-lib';
import { describe, expect, it } from 'vitest';
import { addTextLayer, encodable, squash, wordsOutside, type OcrWord } from './ocrText';

const word = (text: string, x0: number, y0: number, x1: number, y1: number): OcrWord => ({
  text,
  x0,
  y0,
  x1,
  y1,
});

const rect = { x0: 100, y0: 100, x1: 200, y1: 200 };

describe('wordsOutside', () => {
  it('houdt woorden buiten de vlakken', () => {
    const words = [word('a', 0, 0, 50, 20), word('b', 300, 300, 350, 320)];
    expect(wordsOutside(words, [rect])).toEqual(words);
  });

  it('laat een woord weg waarvan het midden in een vlak ligt', () => {
    expect(wordsOutside([word('x', 120, 120, 180, 140)], [rect])).toEqual([]);
    // Het midden ligt erin, ook al steekt het woord eruit.
    expect(wordsOutside([word('x', 150, 150, 210, 170)], [rect])).toEqual([]);
  });

  it('laat een woord weg dat voor meer dan een kwart in een vlak ligt', () => {
    // Het woord is 100 breed; 60 ervan ligt in het vlak, het midden net niet.
    expect(wordsOutside([word('x', 40, 120, 140, 140)], [rect])).toEqual([]);
  });

  it('houdt een woord dat het vlak maar even raakt', () => {
    const near = word('x', 40, 120, 102, 140);
    expect(wordsOutside([near], [rect])).toEqual([near]);
  });

  it('kijkt naar alle vlakken', () => {
    const other = { x0: 300, y0: 300, x1: 400, y1: 400 };
    expect(wordsOutside([word('x', 320, 320, 380, 340)], [rect, other])).toEqual([]);
  });
});

describe('encodable en squash', () => {
  it('laat tekens weg die het lettertype niet kent', async () => {
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Helvetica);
    expect(encodable('café €', font)).toBe('café €');
    expect(encodable('日本語ok', font)).toBe('ok');
  });

  it('haalt alle witruimte weg', () => {
    expect(squash(' a  b\n c\t')).toBe('abc');
  });
});

describe('addTextLayer', () => {
  async function layer(words: OcrWord[], factor = 0.5) {
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const page = doc.addPage([300, 400]);
    const result = addTextLayer(lib, page, font, words, factor);
    const bytes = new Uint8Array(await doc.save());
    const loaded = await PDFDocument.load(bytes);
    const contents = loaded.getPage(0).node.Contents();
    const streams = contents instanceof PDFArray ? contents.asArray() : [contents];
    const text = streams
      .map((ref) => {
        const stream = ref && loaded.context.lookup(ref);
        return stream instanceof PDFRawStream
          ? Buffer.from(decodePDFRawStream(stream).decode()).toString('latin1')
          : '';
      })
      .join('\n');
    return { result, text };
  }

  it('zet de woorden onzichtbaar op hun plek', async () => {
    const { result, text } = await layer([
      word('Hallo', 100, 100, 200, 130),
      word('wereld', 210, 100, 300, 130),
    ]);
    expect(result.words).toEqual(['Hallo', 'wereld']);
    expect(result.boxes[0]).toEqual({ x0: 50, y0: 50, x1: 100, y1: 65 });
    expect(text).toContain('3 Tr');
    expect(text).toContain('BT');
    expect(text.match(/Tj/g)).toHaveLength(2);
  });

  it('slaat woorden over die leeg worden', async () => {
    const { result, text } = await layer([word('日本', 0, 0, 40, 20)]);
    expect(result.words).toEqual([]);
    expect(text).not.toContain('BT');
  });
});
