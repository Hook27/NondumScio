import {
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFName,
  PDFRawStream,
  StandardFonts,
  decodePDFRawStream,
} from 'pdf-lib';
import { describe, expect, it, vi } from 'vitest';
import { hasRedactions, type Annotation, type BoxAnnotation } from '../annotations/model';
import { initialPages, type PageItem } from '../pages/plan';
import {
  DEFAULT_REDACTION,
  RedactionError,
  assertImageOnly,
  redactPdf,
  type OcrEngine,
  type OcrWord,
  type RasterSession,
} from './redact';
import { buildPdf } from './save';
import { makePng } from './testPng';

const SECRET = 'GEHEIM-4711';

/** Een PDF waarvan elke pagina één regel tekst heeft, met titel, auteur en onderwerp. */
async function makeSource(lines: string[]) {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  doc.setTitle('Vertrouwelijk rapport');
  doc.setAuthor('Jan Jansen');
  doc.setSubject('Onderwerp: GEHEIM-4711');
  for (const line of lines) {
    doc.addPage([600, 800]).drawText(line, { x: 50, y: 700, size: 20, font });
  }
  return new Uint8Array(await doc.save());
}

const box = (page: number, extra: Partial<BoxAnnotation> = {}): BoxAnnotation => ({
  id: 1,
  page,
  kind: 'redact',
  x: 40,
  y: 60,
  width: 200,
  height: 40,
  color: '#000000',
  strokeWidth: 0,
  ...extra,
});

/** Een nep-tekenaar: levert per pagina een kleine PNG en onthoudt wat er gevraagd werd. */
function fakeRaster() {
  const render = vi.fn(async () => ({
    png: makePng(4, 4),
    width: 600,
    height: 800,
    pixelWidth: 600,
    pixelHeight: 800,
    // Het zwarte vlak van het standaardvak (x 40, y 60, 200 breed, 40 hoog), met de marge.
    blackouts: [{ x0: 39, y0: 59, x1: 241, y1: 101 }],
    reduced: false,
  }));
  const close = vi.fn();
  const session: RasterSession = { render, close };
  return { render, close, openRaster: async () => session };
}

const noVerify = async () => {};

/** Een nep-herkenner: geeft altijd dezelfde woorden terug en onthoudt wat er gevraagd werd. */
function fakeOcr(words: OcrWord[]) {
  const recognize = vi.fn<OcrEngine['recognize']>(async () => words);
  const close = vi.fn();
  const engine: OcrEngine = { recognize, close };
  return { recognize, close, openOcr: async () => engine };
}

const word = (text: string, x0: number, y0: number, x1: number, y1: number): OcrWord => ({
  text,
  x0,
  y0,
  x1,
  y1,
});

/** Alles wat een bestand verraadt: de ruwe bytes en elke uitgepakte stroom, als tekst. */
async function everything(bytes: Uint8Array): Promise<string> {
  const doc = await PDFDocument.load(bytes, { updateMetadata: false });
  const parts = [Buffer.from(bytes).toString('latin1')];
  for (const [, object] of doc.context.enumerateIndirectObjects()) {
    // Ook de woordenboeken en teksten die in een objectstroom (gecomprimeerd) stonden.
    parts.push(String(object));
    if (object instanceof PDFRawStream) {
      try {
        parts.push(Buffer.from(decodePDFRawStream(object).decode()).toString('latin1'));
      } catch {
        // Een afbeelding of ander binair formaat: de ruwe bytes zijn al meegenomen.
      }
    }
  }
  return parts.join('\n');
}

const hex = (text: string) =>
  [...text].map((char) => char.charCodeAt(0).toString(16).toUpperCase().padStart(2, '0')).join('');

/** Een tekst zoals PDF hem voor titels bewaart: UTF-16 in hexadecimaal. */
const utf16hex = (text: string) =>
  [...text].map((char) => char.charCodeAt(0).toString(16).toUpperCase().padStart(4, '0')).join('');

/** De tekst van één pagina (zoals hij in de inhoudsstroom staat), of leeg. */
async function pageContent(bytes: Uint8Array, index: number) {
  const doc = await PDFDocument.load(bytes, { updateMetadata: false });
  const contents = doc.getPage(index).node.Contents();
  const streams = contents instanceof PDFArray ? contents.asArray() : [contents];
  return streams
    .map((ref) => {
      const stream = ref && doc.context.lookup(ref);
      return stream instanceof PDFRawStream
        ? Buffer.from(decodePDFRawStream(stream).decode()).toString('latin1')
        : '';
    })
    .join('\n');
}

async function run(
  lines: string[],
  boxes: (pages: PageItem[]) => Annotation[],
  options = DEFAULT_REDACTION,
  raster = fakeRaster(),
  verify: (bytes: Uint8Array, pageIndexes: number[]) => Promise<void> = noVerify,
  planFor: (pages: PageItem[]) => PageItem[] = (pages) => pages,
) {
  const source = await makeSource(lines);
  const pages = initialPages(lines.length);
  const plan = planFor(pages);
  const built = await buildPdf(new Map([[0, source]]), plan);
  const annotations = boxes(pages);
  const result = await redactPdf(built, plan, annotations, options, undefined, {
    openRaster: raster.openRaster,
    verify,
  });
  return { source, built, result, raster, pages };
}

describe('hasRedactions', () => {
  it('ziet alleen vakken van pagina’s die in het plan staan', () => {
    const pages = initialPages(2);
    expect(hasRedactions(pages, [])).toBe(false);
    expect(hasRedactions(pages, [box(pages[1]!.key)])).toBe(true);
    // Een vak van een weggehaalde pagina telt niet.
    expect(hasRedactions([pages[0]!], [box(pages[1]!.key)])).toBe(false);
    // Een gewone markering is geen redactie.
    expect(
      hasRedactions(pages, [
        {
          id: 1,
          page: pages[0]!.key,
          kind: 'highlight',
          x: 0,
          y: 0,
          width: 10,
          height: 10,
          color: '#ffd60a',
          strokeWidth: 2,
        },
      ]),
    ).toBe(false);
  });
});

describe('redactPdf: echt weglakken', () => {
  it('zet alleen de pagina met een vak om in een afbeelding, de rest blijft zoals hij was', async () => {
    const { result } = await run(['OPENBAAR een', SECRET, 'OPENBAAR drie'], (pages) => [
      box(pages[1]!.key),
    ]);
    const out = await PDFDocument.load(result.bytes);
    expect(out.getPageCount()).toBe(3);
    expect(result.report.pages).toEqual([1]);

    // Pagina 1 en 3: nog gewoon tekst.
    expect(await pageContent(result.bytes, 0)).toContain(hex('OPENBAAR een'));
    expect(await pageContent(result.bytes, 2)).toContain(hex('OPENBAAR drie'));
    // Pagina 2: geen tekst, geen lettertype, alleen een afbeelding.
    const redacted = out.getPage(1);
    expect(await pageContent(result.bytes, 1)).not.toMatch(/\bBT\b/);
    // pdf-lib zet een lege lijst lettertypen in elke pagina; er mag er geen één in staan.
    const fonts = redacted.node.Resources()!.lookupMaybe(PDFName.of('Font'), PDFDict);
    expect(fonts?.keys().length ?? 0).toBe(0);
    expect(redacted.node.Resources()!.has(PDFName.of('XObject'))).toBe(true);
    expect(redacted.getSize()).toEqual({ width: 600, height: 800 });
  });

  it('laat het woord nergens in het bestand staan: niet in de pagina, niet in oude objecten', async () => {
    const { source, result } = await run(['OPENBAAR een', SECRET, 'OPENBAAR drie'], (pages) => [
      box(pages[1]!.key),
    ]);
    // Controle op de controle: in het bronbestand staat het woord wél.
    expect(await everything(source)).toContain(hex(SECRET));
    const after = await everything(result.bytes);
    expect(after).not.toContain(hex(SECRET));
    expect(after).not.toContain(SECRET);
    expect(after).not.toContain('GEHEIM');
    // En ook niet in de documentgegevens: het onderwerp bevatte het woord.
    expect(after).not.toContain('Onderwerp');
  });

  it('neemt documentgegevens standaard niet over, en wel als je dat kiest', async () => {
    const strip = await run(['a', 'b'], (pages) => [box(pages[0]!.key)]);
    const stripped = await PDFDocument.load(strip.result.bytes);
    expect(stripped.getTitle()).toBeUndefined();
    expect(stripped.getAuthor()).toBeUndefined();
    expect(stripped.getSubject()).toBeUndefined();

    const keep = await run(['a', 'b'], (pages) => [box(pages[0]!.key)], {
      ...DEFAULT_REDACTION,
      stripMetadata: false,
    });
    const kept = await PDFDocument.load(keep.result.bytes);
    expect(kept.getTitle()).toBe('Vertrouwelijk rapport');
    expect(kept.getAuthor()).toBe('Jan Jansen');
  });

  it('neemt nooit bladwijzers over, ook niet die bij het samenvoegen zijn gemaakt', async () => {
    const source = await makeSource([SECRET, 'OPENBAAR']);
    const pages = initialPages(2);
    const built = await buildPdf(new Map([[0, source]]), pages, {
      bookmarks: [{ doc: 0, title: `Hoofdstuk ${SECRET}` }],
    });
    // Het gebouwde bestand heeft de bladwijzer wel (titels staan als UTF-16, met FEFF vooraan).
    expect((await PDFDocument.load(built)).catalog.has(PDFName.of('Outlines'))).toBe(true);
    expect((await everything(built)).toUpperCase()).toContain(`FEFF${utf16hex('Hoofdstuk')}`);
    const raster = fakeRaster();
    const { bytes } = await redactPdf(
      built,
      pages,
      [box(pages[0]!.key)],
      DEFAULT_REDACTION,
      undefined,
      { openRaster: raster.openRaster, verify: noVerify },
    );
    const out = await PDFDocument.load(bytes);
    expect(out.catalog.has(PDFName.of('Outlines'))).toBe(false);
    expect((await everything(bytes)).toUpperCase()).not.toContain(utf16hex('Hoofdstuk'));
  });

  it('laat het bestand ongemoeid als er geen vakken zijn', async () => {
    const raster = fakeRaster();
    const source = await makeSource(['a']);
    const pages = initialPages(1);
    const result = await redactPdf(source, pages, [], DEFAULT_REDACTION, undefined, {
      openRaster: raster.openRaster,
      verify: noVerify,
    });
    expect(result.bytes).toBe(source);
    expect(raster.render).not.toHaveBeenCalled();
  });

  it('geeft de tekenaar alleen de vakken van die pagina, met resolutie en extra draaiing', async () => {
    const raster = fakeRaster();
    await run(
      ['a', 'b', 'c'],
      (pages) => [
        box(pages[0]!.key, { id: 1 }),
        box(pages[0]!.key, { id: 2, x: 300 }),
        box(pages[2]!.key, { id: 3 }),
      ],
      { ...DEFAULT_REDACTION, dpi: 200 },
      raster,
      noVerify,
      (pages) => [pages[0]!, pages[1]!, { ...pages[2]!, rotation: 90 as const }],
    );
    expect(raster.render).toHaveBeenCalledTimes(2);
    const [first, second] = raster.render.mock.calls.map((call) => (call as unknown[])[0]) as {
      pageIndex: number;
      extra: number;
      dpi: number;
      boxes: BoxAnnotation[];
    }[];
    expect(first).toMatchObject({ pageIndex: 0, extra: 0, dpi: 200 });
    expect(first!.boxes.map((b) => b.id)).toEqual([1, 2]);
    expect(second).toMatchObject({ pageIndex: 2, extra: 90, dpi: 200 });
    expect(second!.boxes.map((b) => b.id)).toEqual([3]);
    expect(raster.close).toHaveBeenCalledTimes(1);
  });

  it('houdt de volgorde, ook met meerdere pagina’s met een vak', async () => {
    const { result } = await run(['een', 'twee', 'drie', 'vier'], (pages) => [
      box(pages[0]!.key),
      box(pages[2]!.key),
    ]);
    expect(result.report.pages).toEqual([0, 2]);
    expect(await pageContent(result.bytes, 1)).toContain(hex('twee'));
    expect(await pageContent(result.bytes, 3)).toContain(hex('vier'));
    expect(await pageContent(result.bytes, 0)).not.toMatch(/\bBT\b/);
    expect(await pageContent(result.bytes, 2)).not.toMatch(/\bBT\b/);
  });

  it('volgt het pagina-plan: een verplaatste of weggehaalde pagina houdt zijn vak niet per ongeluk', async () => {
    // Plan: pagina 3, dan 1 (pagina 2 is weg). Het vak hoort bij pagina 2: dat telt dus niet.
    const { result } = await run(
      ['een', SECRET, 'drie'],
      (pages) => [box(pages[1]!.key)],
      DEFAULT_REDACTION,
      fakeRaster(),
      noVerify,
      (pages) => [pages[2]!, pages[0]!],
    );
    expect(result.report.pages).toEqual([]);
    // Pagina 2 zat niet in het plan en is er dus ook niet.
    expect((await PDFDocument.load(result.bytes)).getPageCount()).toBe(2);
    expect(await everything(result.bytes)).not.toContain(hex(SECRET));
  });

  it('meldt voortgang en of een pagina kleiner moest dan gevraagd', async () => {
    const raster = fakeRaster();
    raster.render.mockResolvedValueOnce({
      png: makePng(2, 2),
      width: 600,
      height: 800,
      pixelWidth: 2,
      pixelHeight: 2,
      blackouts: [],
      reduced: true,
    });
    const source = await makeSource(['a', 'b', 'c']);
    const pages = initialPages(3);
    const progress: [number, number][] = [];
    const built = await buildPdf(new Map([[0, source]]), pages);
    const { report } = await redactPdf(
      built,
      pages,
      [box(pages[1]!.key)],
      DEFAULT_REDACTION,
      (done, total) => progress.push([done, total]),
      { openRaster: raster.openRaster, verify: noVerify },
    );
    expect(report.reduced).toBe(true);
    expect(progress.at(-1)).toEqual([3, 3]);
    expect(progress.every(([done, total]) => done <= total && total === 3)).toBe(true);
  });

  it('geeft niets terug als het tekenen mislukt, en sluit de tekenaar', async () => {
    const raster = fakeRaster();
    raster.render.mockRejectedValueOnce(new Error('kapot'));
    const source = await makeSource(['a']);
    const pages = initialPages(1);
    const built = await buildPdf(new Map([[0, source]]), pages);
    await expect(
      redactPdf(built, pages, [box(pages[0]!.key)], DEFAULT_REDACTION, undefined, {
        openRaster: raster.openRaster,
        verify: noVerify,
      }),
    ).rejects.toMatchObject({ code: 'raster' });
    expect(raster.close).toHaveBeenCalledTimes(1);
  });

  it('geeft niets terug als de controle op tekst iets vindt', async () => {
    const source = await makeSource(['a']);
    const pages = initialPages(1);
    const built = await buildPdf(new Map([[0, source]]), pages);
    const raster = fakeRaster();
    await expect(
      redactPdf(built, pages, [box(pages[0]!.key)], DEFAULT_REDACTION, undefined, {
        openRaster: raster.openRaster,
        verify: async () => {
          throw new RedactionError('verify');
        },
      }),
    ).rejects.toBeInstanceOf(RedactionError);
  });
});

describe('assertImageOnly: de eigen controle op het resultaat', () => {
  it('accepteert een pagina met alleen een afbeelding', async () => {
    const { result } = await run(['a'], (pages) => [box(pages[0]!.key)]);
    await expect(assertImageOnly(result.bytes, [0])).resolves.toBeUndefined();
  });

  it('weigert een pagina met tekst, een lettertype of een aantekening', async () => {
    const source = await makeSource(['gewone tekst']);
    await expect(assertImageOnly(source, [0])).rejects.toBeInstanceOf(RedactionError);
  });
});

describe('redigeren met tekstherkenning (OCR)', () => {
  const withOcr = { ...DEFAULT_REDACTION, ocr: true };

  async function runOcr(
    words: OcrWord[],
    extra: { signal?: AbortSignal; openOcr?: () => Promise<OcrEngine> } = {},
  ) {
    const source = await makeSource(['a', 'b']);
    const pages = initialPages(2);
    const built = await buildPdf(new Map([[0, source]]), pages);
    const raster = fakeRaster();
    const ocr = fakeOcr(words);
    const result = await redactPdf(built, pages, [box(pages[0]!.key)], withOcr, undefined, {
      openRaster: raster.openRaster,
      openOcr: extra.openOcr ?? ocr.openOcr,
      verify: noVerify,
      verifyText: noVerify,
      signal: extra.signal,
    });
    return { result, ocr, raster };
  }

  it('is standaard uit', () => {
    expect(DEFAULT_REDACTION.ocr).toBe(false);
  });

  it('zet de herkende woorden onzichtbaar op de pagina en laat die in het zwart weg', async () => {
    const { result, ocr } = await runOcr([
      word('Openbaar', 300, 300, 400, 330),
      // Rommel die OCR in het zwarte vak "ziet": dit mag er niet in.
      word('GEHEIM-4711', 60, 65, 200, 95),
    ]);
    const content = await pageContent(result.bytes, 0);
    expect(content).toContain('3 Tr');
    expect(content).toContain(hex('Openbaar'));
    expect(content).not.toContain(hex('GEHEIM'));
    expect(await everything(result.bytes)).not.toContain(SECRET);
    expect(result.report).toMatchObject({ pages: [0], recognized: [0] });
    expect(ocr.recognize).toHaveBeenCalledTimes(1);
    expect(ocr.recognize.mock.calls[0]![1]).toBe(72);
    expect(ocr.close).toHaveBeenCalledTimes(1);
  });

  it('laat de pagina zonder vak zoals hij was, en zonder herkenning', async () => {
    const { result } = await runOcr([word('Openbaar', 300, 300, 400, 330)]);
    expect(await pageContent(result.bytes, 1)).not.toContain('3 Tr');
  });

  it('gebruikt geen herkenner zolang OCR uit staat', async () => {
    const source = await makeSource(['a']);
    const pages = initialPages(1);
    const built = await buildPdf(new Map([[0, source]]), pages);
    const openOcr = vi.fn(async () => fakeOcr([]).openOcr());
    const result = await redactPdf(
      built,
      pages,
      [box(pages[0]!.key)],
      DEFAULT_REDACTION,
      undefined,
      {
        openRaster: fakeRaster().openRaster,
        openOcr,
        verify: noVerify,
      },
    );
    expect(openOcr).not.toHaveBeenCalled();
    expect(result.report.recognized).toEqual([]);
    expect(await pageContent(result.bytes, 0)).not.toContain('BT');
  });

  it('geeft niets terug als de herkenning mislukt, en sluit alles', async () => {
    const ocr = fakeOcr([]);
    ocr.recognize.mockRejectedValueOnce(new Error('kapot'));
    const source = await makeSource(['a']);
    const pages = initialPages(1);
    const built = await buildPdf(new Map([[0, source]]), pages);
    const raster = fakeRaster();
    await expect(
      redactPdf(built, pages, [box(pages[0]!.key)], withOcr, undefined, {
        openRaster: raster.openRaster,
        openOcr: ocr.openOcr,
      }),
    ).rejects.toMatchObject({ code: 'ocr' });
    expect(raster.close).toHaveBeenCalledTimes(1);
    expect(ocr.close).toHaveBeenCalledTimes(1);
  });

  it('stopt als er al om gestopt is', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(runOcr([], { signal: controller.signal })).rejects.toMatchObject({
      code: 'cancelled',
    });
  });

  it('stopt ook midden in een herkenning', async () => {
    const controller = new AbortController();
    const stuck = { recognize: () => new Promise<OcrWord[]>(() => {}), close: vi.fn() };
    const running = runOcr([], { signal: controller.signal, openOcr: async () => stuck });
    setTimeout(() => controller.abort(), 50);
    await expect(running).rejects.toMatchObject({ code: 'cancelled' });
    expect(stuck.close).toHaveBeenCalledTimes(1);
  });

  it('geeft de controle op de tekst de herkende woorden en de zwarte vlakken', async () => {
    const source = await makeSource(['a']);
    const pages = initialPages(1);
    const built = await buildPdf(new Map([[0, source]]), pages);
    const verifyText = vi.fn(async () => {});
    await redactPdf(built, pages, [box(pages[0]!.key)], withOcr, undefined, {
      openRaster: fakeRaster().openRaster,
      openOcr: fakeOcr([word('Open', 300, 300, 340, 330), word('baar', 350, 300, 400, 330)])
        .openOcr,
      verifyText,
    });
    expect(verifyText).toHaveBeenCalledWith(expect.any(Uint8Array), [
      { pageIndex: 0, text: 'Openbaar', forbidden: [{ x0: 39, y0: 59, x1: 241, y1: 101 }] },
    ]);
  });
});

describe('assertImageOnly met herkende tekst', () => {
  it('accepteert onzichtbare tekst alleen op pagina’s waar die mag', async () => {
    const source = await makeSource(['a']);
    const pages = initialPages(1);
    const built = await buildPdf(new Map([[0, source]]), pages);
    const { bytes } = await redactPdf(
      built,
      pages,
      [box(pages[0]!.key)],
      { ...DEFAULT_REDACTION, ocr: true },
      undefined,
      {
        openRaster: fakeRaster().openRaster,
        openOcr: fakeOcr([word('Openbaar', 300, 300, 400, 330)]).openOcr,
        verifyText: noVerify,
      },
    );
    await expect(assertImageOnly(bytes, [0], new Set([0]))).resolves.toBeUndefined();
    await expect(assertImageOnly(bytes, [0])).rejects.toBeInstanceOf(RedactionError);
  });

  it('weigert zichtbare tekst, ook op een pagina waar tekst mag', async () => {
    const source = await makeSource(['gewone tekst']);
    await expect(assertImageOnly(source, [0], new Set([0]))).rejects.toBeInstanceOf(RedactionError);
  });
});
