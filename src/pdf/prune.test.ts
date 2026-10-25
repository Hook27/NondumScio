import * as lib from 'pdf-lib';
import { PDFDocument, PDFName, PDFRawStream, StandardFonts, decodePDFRawStream } from 'pdf-lib';
import { describe, expect, it } from 'vitest';
import { initialPages } from '../pages/plan';
import { pruneUnreachable } from './prune';
import { buildPdf } from './save';

const SECRET = 'GEHEIM-4711';
const hex = (text: string) =>
  [...text].map((char) => char.charCodeAt(0).toString(16).toUpperCase().padStart(2, '0')).join('');

async function makeSource(lines: string[]) {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (const line of lines)
    doc.addPage([600, 800]).drawText(line, { x: 50, y: 700, size: 20, font });
  return new Uint8Array(await doc.save());
}

/** Alles wat een bestand verraadt: ruwe bytes, uitgepakte stromen en de tekst van elk object. */
async function everything(bytes: Uint8Array) {
  const doc = await PDFDocument.load(bytes, { updateMetadata: false });
  const parts = [Buffer.from(bytes).toString('latin1')];
  for (const [, object] of doc.context.enumerateIndirectObjects()) {
    parts.push(String(object));
    if (object instanceof PDFRawStream) {
      try {
        parts.push(Buffer.from(decodePDFRawStream(object).decode()).toString('latin1'));
      } catch {
        // Binair: de ruwe bytes zijn al meegenomen.
      }
    }
  }
  return parts.join('\n');
}

describe('pruneUnreachable', () => {
  it('haalt een pagina die uit het document is gehaald ook echt uit het bestand', async () => {
    const source = await makeSource(['OPENBAAR', SECRET, 'OPENBAAR twee']);

    // Zonder opruimen: pdf-lib laat de pagina als los object staan (de reden voor deze stap).
    const loose = await PDFDocument.load(source);
    loose.removePage(1);
    expect(await everything(new Uint8Array(await loose.save()))).toContain(hex(SECRET));

    // Met opruimen (zoals de download bij Pagina's): weg is weg.
    const pages = initialPages(3);
    const bytes = await buildPdf(new Map([[0, source]]), [pages[0]!, pages[2]!]);
    expect(await everything(bytes)).not.toContain(hex(SECRET));
    expect(await everything(bytes)).toContain(hex('OPENBAAR twee'));
    expect((await PDFDocument.load(bytes)).getPageCount()).toBe(2);
  });

  it('laat alles staan wat nog gebruikt wordt: pagina’s, lettertypen en bladwijzers', async () => {
    const source = await makeSource(['een', 'twee']);
    const pages = initialPages(2);
    const bytes = await buildPdf(new Map([[0, source]]), pages, {
      bookmarks: [{ doc: 0, title: 'Begin' }],
    });
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBe(2);
    expect(doc.catalog.has(PDFName.of('Outlines'))).toBe(true);
    expect(await everything(bytes)).toContain(hex('twee'));
    // Een tweede keer opruimen vindt niets meer.
    expect(pruneUnreachable(lib, doc)).toBe(0);
  });

  it('geeft het aantal weggehaalde objecten terug', async () => {
    const source = await makeSource(['een', 'twee']);
    const doc = await PDFDocument.load(source);
    doc.removePage(0);
    expect(pruneUnreachable(lib, doc)).toBeGreaterThan(0);
    expect(pruneUnreachable(lib, doc)).toBe(0);
  });
});
