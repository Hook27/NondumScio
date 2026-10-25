import { PDFDocument } from 'pdf-lib';
import { describe, expect, it } from 'vitest';
import {
  ImageConvertError,
  MARGINS,
  MAX_PIXELS,
  detectImageType,
  imagesToPdf,
  jpegOrientation,
  layoutImage,
  outputScale,
} from './images';
import { makePng } from './testPng';

/** Het begin van een JPEG met een EXIF-blok dat de draaiing `value` bevat. */
function jpegWithOrientation(value: number, { little = true } = {}): Uint8Array {
  const word = (n: number) => (little ? [n & 255, n >> 8] : [n >> 8, n & 255]);
  const long = (n: number) => (little ? [n & 255, n >> 8, 0, 0] : [0, 0, n >> 8, n & 255]);
  const tiff = [
    ...(little ? [0x49, 0x49] : [0x4d, 0x4d]),
    ...word(42),
    ...long(8),
    ...word(1), // één veld
    ...word(0x0112),
    ...word(3),
    ...long(1),
    ...word(value),
    0,
    0,
    ...long(0),
  ];
  const exif = [0x45, 0x78, 0x69, 0x66, 0, 0, ...tiff];
  const length = exif.length + 2;
  return Uint8Array.from([0xff, 0xd8, 0xff, 0xe1, length >> 8, length & 255, ...exif, 0xff, 0xd9]);
}

describe('detectImageType', () => {
  it('herkent PNG en JPEG aan de inhoud', () => {
    expect(detectImageType(makePng(1, 1))).toBe('png');
    expect(detectImageType(Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0]))).toBe('jpeg');
  });

  it('weigert al het andere, ook als de naam anders doet vermoeden', () => {
    expect(detectImageType(new TextEncoder().encode('%PDF-1.7'))).toBeNull();
    expect(detectImageType(new TextEncoder().encode('GIF89a'))).toBeNull();
    expect(detectImageType(new Uint8Array())).toBeNull();
  });
});

describe('jpegOrientation', () => {
  it.each([
    [1, 1],
    [3, 3],
    [6, 6],
    [8, 8],
    [2, 1],
    [5, 1],
  ])('EXIF %i geeft draaiing %i', (exif, turn) => {
    expect(jpegOrientation(jpegWithOrientation(exif))).toBe(turn);
    expect(jpegOrientation(jpegWithOrientation(exif, { little: false }))).toBe(turn);
  });

  it('geeft rechtop als er geen EXIF is of het bestand niet klopt', () => {
    expect(jpegOrientation(Uint8Array.from([0xff, 0xd8, 0xff, 0xd9]))).toBe(1);
    expect(jpegOrientation(new Uint8Array())).toBe(1);
    expect(jpegOrientation(Uint8Array.from([1, 2, 3, 4, 5]))).toBe(1);
    // Afgekapt midden in het EXIF-blok.
    expect(jpegOrientation(jpegWithOrientation(6).slice(0, 14))).toBe(1);
  });
});

describe('layoutImage', () => {
  it('passend: de pagina krijgt de verhouding van de afbeelding, langste kant als A4', () => {
    const { page, x, y, width, height, angle } = layoutImage(2000, 1000, 1, 'fit', 0);
    expect(page.width).toBeCloseTo(841.89);
    expect(page.height).toBeCloseTo(420.945);
    expect([x, y, angle]).toEqual([0, 0, 0]);
    expect(width).toBeCloseTo(page.width);
    expect(height).toBeCloseTo(page.height);
  });

  it('passend met marge: de pagina is groter met twee keer de marge', () => {
    const { page, x, y } = layoutImage(1000, 1000, 1, 'fit', 20);
    expect(page.width).toBeCloseTo(841.89 + 40);
    expect(x).toBe(20);
    expect(y).toBe(20);
  });

  it('A4: staande afbeelding op een staande pagina, in het midden', () => {
    const { page, x, y, width, height } = layoutImage(500, 1000, 1, 'a4', 0);
    expect(page).toEqual({ width: 595.28, height: 841.89 });
    expect(height).toBeCloseTo(841.89);
    expect(width).toBeCloseTo(420.945);
    expect(x).toBeCloseTo((595.28 - 420.945) / 2);
    expect(y).toBeCloseTo(0);
  });

  it('A4: liggende afbeelding krijgt een liggende pagina', () => {
    const { page } = layoutImage(1000, 500, 1, 'a4', 0);
    expect(page).toEqual({ width: 841.89, height: 595.28 });
  });

  it('Letter en marge: de afbeelding blijft binnen de marge', () => {
    const margin = MARGINS.normal;
    const { page, x, y, width, height } = layoutImage(1000, 1000, 1, 'letter', margin);
    expect(page).toEqual({ width: 612, height: 792 });
    expect(x).toBeGreaterThanOrEqual(margin - 1e-9);
    expect(y).toBeGreaterThanOrEqual(margin - 1e-9);
    expect(x + width).toBeLessThanOrEqual(612 - margin + 1e-9);
    expect(y + height).toBeLessThanOrEqual(792 - margin + 1e-9);
  });

  it('een foto die op zijn kant is opgeslagen (EXIF 6 en 8) krijgt een staande pagina', () => {
    // Opgeslagen als 4000 breed bij 3000 hoog, maar bedoeld als staande foto.
    for (const turn of [6, 8] as const) {
      const { page, angle } = layoutImage(4000, 3000, turn, 'a4', 0);
      expect(page.height).toBeGreaterThan(page.width);
      expect(angle).toBe(turn === 6 ? -90 : 90);
    }
  });

  it('draaiing om de linkeronderhoek: de gedraaide afbeelding vult precies het vak', () => {
    // Na draaien beslaat de afbeelding, vanuit (x, y), deze hoekpunten.
    const corners = (turn: 3 | 6 | 8) => {
      const l = layoutImage(400, 200, turn, 'fit', 0);
      const rad = (l.angle * Math.PI) / 180;
      const [cos, sin] = [Math.cos(rad), Math.sin(rad)];
      const points = [
        [0, 0],
        [l.width, 0],
        [0, l.height],
        [l.width, l.height],
      ].map(([px, py]) => [l.x + px! * cos - py! * sin, l.y + px! * sin + py! * cos]);
      const xs = points.map((p) => p[0]!);
      const ys = points.map((p) => p[1]!);
      return {
        left: Math.min(...xs),
        right: Math.max(...xs),
        bottom: Math.min(...ys),
        top: Math.max(...ys),
        page: l.page,
      };
    };
    for (const turn of [3, 6, 8] as const) {
      const box = corners(turn);
      expect(box.left).toBeCloseTo(0);
      expect(box.bottom).toBeCloseTo(0);
      expect(box.right).toBeCloseTo(box.page.width);
      expect(box.top).toBeCloseTo(box.page.height);
    }
  });
});

describe('imagesToPdf', () => {
  it('maakt een pagina per afbeelding, in volgorde, met de juiste verhouding', async () => {
    const bytes = await imagesToPdf(
      [
        { bytes: makePng(20, 10), type: 'png' },
        { bytes: makePng(10, 20), type: 'png' },
        { bytes: makePng(10, 10), type: 'png' },
      ],
      { pageSize: 'fit', margin: 'none' },
    );
    const doc = await PDFDocument.load(bytes);
    const sizes = doc.getPages().map((page) => page.getSize());
    expect(sizes).toHaveLength(3);
    expect(sizes[0]!.width / sizes[0]!.height).toBeCloseTo(2);
    expect(sizes[1]!.width / sizes[1]!.height).toBeCloseTo(0.5);
    expect(sizes[2]!.width / sizes[2]!.height).toBeCloseTo(1);
  });

  it('A4 geeft alleen A4-pagina’s, staand of liggend', async () => {
    const bytes = await imagesToPdf(
      [
        { bytes: makePng(20, 10), type: 'png' },
        { bytes: makePng(10, 20), type: 'png' },
      ],
      { pageSize: 'a4', margin: 'small' },
    );
    const sizes = (await PDFDocument.load(bytes)).getPages().map((page) => page.getSize());
    expect(sizes[0]!.width).toBeCloseTo(841.89);
    expect(sizes[1]!.width).toBeCloseTo(595.28);
  });

  it('zet de afbeelding echt op de pagina', async () => {
    const bytes = await imagesToPdf([{ bytes: makePng(8, 8), type: 'png' }], {
      pageSize: 'a4',
      margin: 'none',
    });
    const doc = await PDFDocument.load(bytes);
    // De pagina verwijst naar een afbeelding in zijn hulpbronnen.
    expect(doc.getPage(0).node.Resources()?.toString()).toContain('/XObject');
  });

  it('meldt welke afbeelding niet lukt', async () => {
    const broken = {
      bytes: Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 0]),
      type: 'png',
    } as const;
    const error = await imagesToPdf([{ bytes: makePng(2, 2), type: 'png' }, broken], {
      pageSize: 'fit',
      margin: 'none',
    }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ImageConvertError);
    expect((error as ImageConvertError).index).toBe(1);
  });

  it('weigert een lege lijst', async () => {
    await expect(imagesToPdf([], { pageSize: 'fit', margin: 'none' })).rejects.toBeInstanceOf(
      ImageConvertError,
    );
  });
});

describe('outputScale', () => {
  it('rekent de resolutie om naar een schaal (72 dpi = 1)', () => {
    expect(outputScale(595, 842, 72)).toEqual({ scale: 1, reduced: false });
    expect(outputScale(595, 842, 150).scale).toBeCloseTo(150 / 72);
    expect(outputScale(595, 842, 300).reduced).toBe(false);
  });

  it('begrenst een heel grote pagina, zodat het resultaat niet te groot wordt', () => {
    // Een pagina van ongeveer A0 op 300 dpi zou ver boven de grens komen.
    const { scale, reduced } = outputScale(2384, 3370, 300);
    expect(reduced).toBe(true);
    expect(2384 * scale * (3370 * scale)).toBeLessThanOrEqual(MAX_PIXELS * 1.0001);
  });
});
