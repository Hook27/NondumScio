import {
  PDFArray,
  PDFDocument,
  PDFRawStream,
  decodePDFRawStream,
  degrees,
  type PDFPage,
} from 'pdf-lib';
import { describe, expect, it } from 'vitest';
import type { Annotation } from '../annotations/model';
import { initialPages } from '../pages/plan';
import { buildParts, buildPdf } from './save';

/** Een PDF met pagina's van 600 × 800, waarvan sommige in het bestand zelf gedraaid zijn. */
async function makeSource(rotations: number[] = [0, 0, 0]) {
  const doc = await PDFDocument.create();
  for (const rotation of rotations) {
    const page = doc.addPage([600, 800]);
    if (rotation) page.setRotation(degrees(rotation));
  }
  return new Uint8Array(await doc.save());
}

/** Alles wat er op een pagina getekend wordt, als leesbare tekst. */
async function contentOf(bytes: Uint8Array, index: number): Promise<string> {
  const doc = await PDFDocument.load(bytes);
  const page: PDFPage = doc.getPage(index);
  const contents = page.node.Contents();
  const streams = contents instanceof PDFArray ? contents.asArray() : [contents];
  return streams
    .map((ref) => {
      const stream = doc.context.lookup(ref);
      return stream instanceof PDFRawStream
        ? Buffer.from(decodePDFRawStream(stream).decode()).toString('latin1')
        : '';
    })
    .join('\n');
}

const hex = (text: string) =>
  [...text].map((char) => char.charCodeAt(0).toString(16).toUpperCase().padStart(2, '0')).join('');

const text = (page: number, extra: Partial<Annotation> = {}) =>
  ({
    id: 1,
    page,
    kind: 'text',
    x: 50,
    y: 100,
    text: 'Hallo',
    size: 20,
    color: '#ff0000',
    ...extra,
  }) as Annotation;

describe('annotaties in de PDF tekenen', () => {
  it('zet tekst op de pagina waar hij bij hoort, en alleen daar', async () => {
    const pages = initialPages(3);
    const bytes = await buildPdf(new Map([[0, await makeSource()]]), pages, {
      annotations: [text(pages[1]!.key)],
    });
    expect(await contentOf(bytes, 0)).not.toContain(hex('Hallo'));
    expect(await contentOf(bytes, 1)).toContain(hex('Hallo'));
    expect(await contentOf(bytes, 2)).not.toContain(hex('Hallo'));
  });

  it('tekent in de gekozen kleur, met de matrix van een gewone pagina', async () => {
    const pages = initialPages(1);
    const bytes = await buildPdf(new Map([[0, await makeSource([0])]]), pages, {
      annotations: [text(pages[0]!.key)],
    });
    const content = await contentOf(bytes, 0);
    // De matrix: alleen verschoven (geen draaiing), binnen een q ... Q.
    expect(content).toMatch(/q\s+1 0 0 1 0 0 cm/);
    expect(content).toContain('1 0 0 rg');
    // De tekst staat op de x-plek van de annotatie.
    expect(content).toMatch(/1 0 0 1 50 \S+ Tm/);
  });

  it('gebruikt bij een in het bestand gedraaide pagina de bijbehorende matrix', async () => {
    const pages = initialPages(1);
    const bytes = await buildPdf(new Map([[0, await makeSource([90])]]), pages, {
      annotations: [text(pages[0]!.key)],
    });
    expect(await contentOf(bytes, 0)).toMatch(/q\s+0 1 -1 0 600 0 cm/);
  });

  it('zet de annotaties mee met de pagina als die verplaatst of gedraaid is', async () => {
    const pages = initialPages(3);
    const reordered = [pages[2]!, pages[0]!, { ...pages[1]!, rotation: 90 as const }];
    const bytes = await buildPdf(new Map([[0, await makeSource()]]), reordered, {
      annotations: [text(pages[1]!.key)],
    });
    // De pagina met de annotatie staat nu laatst en is gedraaid.
    expect(await contentOf(bytes, 2)).toContain(hex('Hallo'));
    expect(await contentOf(bytes, 0)).not.toContain(hex('Hallo'));
    expect((await PDFDocument.load(bytes)).getPage(2).getRotation().angle).toBe(90);
  });

  it('slaat annotaties van weggehaalde pagina’s over', async () => {
    const pages = initialPages(3);
    const bytes = await buildPdf(new Map([[0, await makeSource()]]), [pages[0]!, pages[2]!], {
      annotations: [text(pages[1]!.key)],
    });
    expect((await PDFDocument.load(bytes)).getPageCount()).toBe(2);
    expect(await contentOf(bytes, 0)).not.toContain(hex('Hallo'));
    expect(await contentOf(bytes, 1)).not.toContain(hex('Hallo'));
  });

  it('tekent markeringen doorzichtig, rechthoeken als rand en lijnen met rondingen', async () => {
    const pages = initialPages(1);
    const key = pages[0]!.key;
    const bytes = await buildPdf(new Map([[0, await makeSource([0])]]), pages, {
      annotations: [
        {
          id: 1,
          page: key,
          kind: 'highlight',
          x: 10,
          y: 20,
          width: 100,
          height: 30,
          color: '#ffd60a',
          strokeWidth: 2,
        },
        {
          id: 2,
          page: key,
          kind: 'rect',
          x: 10,
          y: 60,
          width: 100,
          height: 30,
          color: '#d92d20',
          strokeWidth: 4,
        },
        {
          id: 3,
          page: key,
          kind: 'line',
          x1: 0,
          y1: 0,
          x2: 50,
          y2: 50,
          color: '#2c56c9',
          strokeWidth: 3,
        },
      ],
    });
    const content = await contentOf(bytes, 0);
    // Een markering: gevuld, met een doorzichtigheid (ExtGState).
    expect(content).toMatch(/gs\b/);
    expect(content).toMatch(/\bf\b/);
    // Een rechthoek: alleen een rand van 4 punten (geen vulling), een lijn van 3 punten.
    expect(content).toMatch(/4 w/);
    expect(content).toMatch(/3 w/);
    expect(content).toMatch(/\bS\b/);
    // Een lijn met ronde uiteinden.
    expect(content).toMatch(/1 J/);
  });

  it('vervangt tekens die de standaardletter niet kan tekenen door een vraagteken', async () => {
    const pages = initialPages(1);
    const bytes = await buildPdf(new Map([[0, await makeSource([0])]]), pages, {
      annotations: [text(pages[0]!.key, { text: 'a α b' })],
    });
    const content = await contentOf(bytes, 0);
    expect(content).toContain(hex('a ? b'));
  });

  it('tekent meerdere regels onder elkaar', async () => {
    const pages = initialPages(1);
    const bytes = await buildPdf(new Map([[0, await makeSource([0])]]), pages, {
      annotations: [text(pages[0]!.key, { text: 'een\ntwee', size: 10 })],
    });
    const content = await contentOf(bytes, 0);
    const lines = [...content.matchAll(/1 0 0 1 50 (\S+) Tm/g)].map((m) => Number(m[1]));
    expect(lines).toHaveLength(2);
    // De tweede regel staat 1,2 keer de lettergrootte lager (y wordt kleiner).
    expect(lines[0]! - lines[1]!).toBeCloseTo(12, 3);
  });

  it('doet niets met annotaties als er geen zijn: de pagina blijft precies zoals hij was', async () => {
    const pages = initialPages(1);
    const source = await makeSource([0]);
    const bytes = await buildPdf(new Map([[0, source]]), pages);
    expect(await contentOf(bytes, 0)).not.toContain(' cm');
  });

  it('werkt ook bij splitsen: de delen krijgen hun eigen annotaties', async () => {
    const pages = initialPages(3);
    const [first, second] = await buildParts(
      new Map([[0, await makeSource()]]),
      [[pages[0]!, pages[1]!], [pages[2]!]],
      undefined,
      [text(pages[1]!.key), text(pages[2]!.key, { id: 2, text: 'Tot ziens' })],
    );
    expect(await contentOf(first!, 1)).toContain(hex('Hallo'));
    expect(await contentOf(first!, 0)).not.toContain(hex('Hallo'));
    expect(await contentOf(second!, 0)).toContain(hex('Tot ziens'));
  });

  it('werkt bij samenvoegen van meerdere bestanden', async () => {
    const a = initialPages(1, 0, 0);
    const b = initialPages(1, 1, 1);
    const bytes = await buildPdf(
      new Map([
        [0, await makeSource([0])],
        [1, await makeSource([270])],
      ]),
      [...a, ...b],
      { annotations: [text(b[0]!.key)] },
    );
    expect(await contentOf(bytes, 0)).not.toContain(hex('Hallo'));
    // De tweede pagina is in het bestand gedraaid (270): die matrix is gebruikt.
    const content = await contentOf(bytes, 1);
    expect(content).toContain(hex('Hallo'));
    expect(content).toMatch(/q\s+0 -1 1 0 0 800 cm/);
  });
});
