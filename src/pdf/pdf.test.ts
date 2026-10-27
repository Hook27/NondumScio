import { describe, expect, it } from 'vitest';
import { classifyLoadError, looksLikePdf } from './detect';
import { pdfjsAssetOptions } from './loader';
import { renderScale, thumbnailSize } from './thumbnail';

const text = (value: string) => new TextEncoder().encode(value);

describe('looksLikePdf', () => {
  it('herkent een PDF aan de kop', () => {
    expect(looksLikePdf(text('%PDF-1.7\n%âãÏÓ\n1 0 obj'))).toBe(true);
    expect(looksLikePdf(text('%PDF-2.0'))).toBe(true);
  });

  it('accepteert een kop die iets na het begin staat', () => {
    expect(looksLikePdf(text(`${' '.repeat(100)}%PDF-1.4`))).toBe(true);
  });

  it('kijkt niet verder dan de eerste 1024 bytes', () => {
    expect(looksLikePdf(text(`${'x'.repeat(1020)}%PDF-1.4`))).toBe(false);
    expect(looksLikePdf(text(`${'x'.repeat(1019)}%PDF-1.4`))).toBe(true);
  });

  it('weigert andere bestanden', () => {
    expect(looksLikePdf(text('PK\u0003\u0004 een zip of docx'))).toBe(false);
    expect(looksLikePdf(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toBe(false); // JPEG
    expect(looksLikePdf(text('%PDF'))).toBe(false); // te kort, geen streepje
    expect(looksLikePdf(new Uint8Array())).toBe(false);
  });
});

describe('classifyLoadError', () => {
  it('herkent een beveiligde PDF', () => {
    expect(classifyLoadError({ name: 'PasswordException', message: 'No password given' })).toBe(
      'password',
    );
  });

  it('noemt elke andere fout "beschadigd"', () => {
    expect(classifyLoadError({ name: 'InvalidPDFException' })).toBe('damaged');
    expect(classifyLoadError(new Error('iets'))).toBe('damaged');
    expect(classifyLoadError(null)).toBe('damaged');
    expect(classifyLoadError('tekst')).toBe('damaged');
  });
});

describe('thumbnailSize', () => {
  it('houdt de verhouding van een staande A4-pagina aan', () => {
    expect(thumbnailSize({ width: 595, height: 842 }, 160)).toEqual({ width: 160, height: 226 });
  });

  it('maakt een liggende pagina lager', () => {
    expect(thumbnailSize({ width: 842, height: 595 }, 160)).toEqual({ width: 160, height: 113 });
  });

  it('weigert onmogelijke maten', () => {
    expect(() => thumbnailSize({ width: 0, height: 842 }, 160)).toThrow(RangeError);
    expect(() => thumbnailSize({ width: 595, height: -1 }, 160)).toThrow(RangeError);
    expect(() => thumbnailSize({ width: 595, height: 842 }, 0)).toThrow(RangeError);
    expect(() => thumbnailSize({ width: Number.NaN, height: 842 }, 160)).toThrow(RangeError);
  });
});

describe('renderScale', () => {
  it('tekent scherper op een scherm met hoge pixeldichtheid', () => {
    expect(renderScale(595, 160, 1)).toBeCloseTo(160 / 595);
    expect(renderScale(595, 160, 2)).toBeCloseTo(320 / 595);
  });

  it('begrenst de pixeldichtheid tussen 1 en 2 (ook op een iPhone, dichtheid 3)', () => {
    expect(renderScale(100, 100, 0.5)).toBe(1);
    expect(renderScale(100, 100, 3)).toBe(2);
    expect(renderScale(100, 100, 5)).toBe(2);
    expect(renderScale(100, 100, 0)).toBe(1);
  });
});

describe('pdfjsAssetOptions', () => {
  it('wijst naar de meegeleverde hulpbestanden, met een schuine streep aan het eind', () => {
    expect(pdfjsAssetOptions('https://pdf.nondumsc.io/#/pages')).toEqual({
      wasmUrl: 'https://pdf.nondumsc.io/pdfjs/wasm/',
      cMapUrl: 'https://pdf.nondumsc.io/pdfjs/cmaps/',
      cMapPacked: true,
      standardFontDataUrl: 'https://pdf.nondumsc.io/pdfjs/standard_fonts/',
      iccUrl: 'https://pdf.nondumsc.io/pdfjs/iccs/',
    });
  });

  it('werkt ook in een submap, zoals een PR-voorbeeld', () => {
    expect(pdfjsAssetOptions('https://pdf.nondumsc.io/pr-preview/pr-14/').wasmUrl).toBe(
      'https://pdf.nondumsc.io/pr-preview/pr-14/pdfjs/wasm/',
    );
  });
});
