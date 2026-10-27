import * as lib from 'pdf-lib';
import {
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFName,
  PDFRawStream,
  PDFRef,
  PDFString,
  StandardFonts,
  decodePDFRawStream,
  type PDFPage,
} from 'pdf-lib';
import { describe, expect, it } from 'vitest';
import type { BoxAnnotation } from '../annotations/model';
import { initialPages } from '../pages/plan';
import { strayObjects } from './links';
import {
  DEFAULT_REDACTION,
  RedactionError,
  assertImageOnly,
  redactPdf,
  type RasterSession,
} from './redact';
import { buildPdf } from './save';
import { makePng } from './testPng';

const SECRET = 'GEHEIM-4711';

const hex = (text: string) =>
  [...text].map((char) => char.charCodeAt(0).toString(16).toUpperCase().padStart(2, '0')).join('');

/** Of het geheim ergens in het bestand staat: in de ruwe bytes, een object of een uitgepakte stroom. */
async function leaks(bytes: Uint8Array): Promise<boolean> {
  const doc = await PDFDocument.load(bytes, { updateMetadata: false });
  const parts = [Buffer.from(bytes).toString('latin1')];
  for (const [, object] of doc.context.enumerateIndirectObjects()) {
    parts.push(String(object));
    if (object instanceof PDFRawStream) {
      try {
        parts.push(Buffer.from(decodePDFRawStream(object).decode()).toString('latin1'));
      } catch {
        // Een afbeelding: de ruwe bytes zijn al meegenomen.
      }
    }
  }
  const all = parts.join('\n');
  return all.includes(SECRET) || all.includes(hex(SECRET));
}

/**
 * Drie pagina's; pagina 2 heeft het geheim. `extra` zet er aantekeningen bij (koppelingen,
 * opmerkingen, formuliervelden) die naar andere pagina's verwijzen.
 */
async function makeSource(extra: (doc: PDFDocument, pages: PDFPage[]) => void) {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const pages = ['Inhoud', SECRET, 'Bijlage'].map((text) => {
    const page = doc.addPage([600, 800]);
    page.drawText(text, { x: 50, y: 700, size: 20, font });
    return page;
  });
  extra(doc, pages);
  return new Uint8Array(await doc.save());
}

/** Zet aantekeningen (als losse objecten) op een pagina. */
function annotate(doc: PDFDocument, page: PDFPage, ...items: Record<string, unknown>[]) {
  const refs = items.map((item) =>
    doc.context.register(
      doc.context.obj({ Type: 'Annot', Rect: [50, 690, 200, 720], ...item } as never),
    ),
  );
  page.node.set(PDFName.of('Annots'), doc.context.obj(refs));
  return refs;
}

const link = (target: PDFPage) => ({ Subtype: 'Link', Dest: [target.ref, 'Fit'] });

/** Een redactievak op pagina 2 (sleutel 1). */
const box: BoxAnnotation = {
  id: 1,
  page: 1,
  kind: 'redact',
  x: 40,
  y: 60,
  width: 200,
  height: 40,
  color: '#000000',
  strokeWidth: 0,
};

const session: RasterSession = {
  render: async () => ({
    png: makePng(4, 4),
    width: 600,
    height: 800,
    pixelWidth: 600,
    pixelHeight: 800,
    blackouts: [{ x0: 39, y0: 59, x1: 241, y1: 101 }],
    reduced: false,
  }),
  close: () => {},
};

/** Redigeert pagina 2, zoals de app: eerst het plan opbouwen, dan de redactie. */
async function redact(source: Uint8Array) {
  const pages = initialPages(3);
  const built = await buildPdf(new Map([[0, source]]), pages);
  const { bytes } = await redactPdf(built, pages, [box], DEFAULT_REDACTION, undefined, {
    openRaster: async () => session,
    verify: async () => {},
  });
  return bytes;
}

/** De aantekeningen van een pagina in het resultaat. */
async function annotationsOn(bytes: Uint8Array, pageIndex: number) {
  const doc = await PDFDocument.load(bytes, { updateMetadata: false });
  const annots = doc.getPage(pageIndex).node.lookupMaybe(PDFName.of('Annots'), PDFArray);
  const items = (annots?.asArray() ?? []).map((ref) => doc.context.lookup(ref) as PDFDict);
  return { doc, items };
}

/** Naar welke pagina (plek vanaf 0) een verwijzing in het resultaat wijst. */
const pageIndexOf = (doc: PDFDocument, ref: unknown) =>
  doc.getPages().findIndex((page) => ref instanceof PDFRef && page.ref.tag === ref.tag);

describe('redigeren met verwijzingen naar andere pagina’s', () => {
  it('controle: zonder verwijzingen staat het geheim niet in het resultaat', async () => {
    const source = await makeSource(() => {});
    expect(await leaks(source)).toBe(true);
    expect(await leaks(await redact(source))).toBe(false);
  });

  it('een koppeling naar de geredigeerde pagina haalt het origineel niet mee, en wijst naar de nieuwe pagina', async () => {
    const result = await redact(await makeSource((doc, [p1, p2]) => annotate(doc, p1!, link(p2!))));
    expect(await leaks(result)).toBe(false);
    const { doc, items } = await annotationsOn(result, 0);
    expect(items).toHaveLength(1);
    const dest = items[0]!.lookup(PDFName.of('Dest'), PDFArray);
    expect(pageIndexOf(doc, dest.get(0))).toBe(1);
  });

  it('een koppeling naar een gewone pagina blijft werken', async () => {
    const result = await redact(
      await makeSource((doc, [p1, , p3]) => annotate(doc, p1!, link(p3!))),
    );
    expect(await leaks(result)).toBe(false);
    const { doc, items } = await annotationsOn(result, 0);
    const dest = items[0]!.lookup(PDFName.of('Dest'), PDFArray);
    expect(pageIndexOf(doc, dest.get(0))).toBe(2);
    expect(strayObjects(lib, doc)).toBe(0);
  });

  it('ook een koppeling als actie (GoTo) en een koppeling terug vanaf de laatste pagina', async () => {
    const result = await redact(
      await makeSource((doc, [p1, p2, p3]) => {
        annotate(doc, p1!, { Subtype: 'Link', A: { S: 'GoTo', D: [p2!.ref, 'XYZ', 0, 800, 0] } });
        annotate(doc, p3!, link(p1!));
      }),
    );
    expect(await leaks(result)).toBe(false);
    const first = await annotationsOn(result, 0);
    const action = first.items[0]!.lookup(PDFName.of('A'), PDFDict);
    expect(pageIndexOf(first.doc, action.lookup(PDFName.of('D'), PDFArray).get(0))).toBe(1);
    const last = await annotationsOn(result, 2);
    const dest = last.items[0]!.lookup(PDFName.of('Dest'), PDFArray);
    expect(pageIndexOf(last.doc, dest.get(0))).toBe(0);
  });

  it('een opmerking houdt zijn eigen pagina (/P), zonder dat de rest meekomt', async () => {
    const result = await redact(
      await makeSource((doc, [p1]) =>
        annotate(doc, p1!, { Subtype: 'Text', Contents: PDFString.of('Openbaar'), P: p1!.ref }),
      ),
    );
    expect(await leaks(result)).toBe(false);
    const { doc, items } = await annotationsOn(result, 0);
    expect(pageIndexOf(doc, items[0]!.get(PDFName.of('P')))).toBe(0);
  });

  it('een antwoord op een opmerking op de geredigeerde pagina haalt die opmerking niet mee', async () => {
    const result = await redact(
      await makeSource((doc, [p1, p2]) => {
        const [comment] = annotate(doc, p2!, {
          Subtype: 'Text',
          Contents: PDFString.of(SECRET),
          P: p2!.ref,
        });
        annotate(doc, p1!, { Subtype: 'Text', Contents: PDFString.of('Eens'), IRT: comment });
      }),
    );
    expect(await leaks(result)).toBe(false);
    const { items } = await annotationsOn(result, 0);
    expect(items[0]!.has(PDFName.of('IRT'))).toBe(false);
  });

  it('een formulierveld over twee pagina’s haalt de waarde niet mee', async () => {
    const result = await redact(
      await makeSource((doc, [p1, p2]) => {
        const field = doc.context.nextRef();
        const [w1] = annotate(doc, p1!, { Subtype: 'Widget', Parent: field, P: p1!.ref });
        const [w2] = annotate(doc, p2!, { Subtype: 'Widget', Parent: field, P: p2!.ref });
        doc.context.assign(
          field,
          doc.context.obj({
            FT: 'Tx',
            T: PDFString.of('naam'),
            V: PDFString.of(SECRET),
            Kids: [w1, w2],
          } as never),
        );
      }),
    );
    expect(await leaks(result)).toBe(false);
    const { doc, items } = await annotationsOn(result, 0);
    expect(items).toHaveLength(1);
    expect(items[0]!.has(PDFName.of('Parent'))).toBe(false);
    expect(strayObjects(lib, doc)).toBe(0);
  });

  it('een koppeling naar een losse pagina buiten de paginaboom valt weg', async () => {
    const result = await redact(
      await makeSource((doc, [p1]) => {
        // Zoals na samenvoegen: een kopie van een weggehaalde pagina, nergens in de paginaboom.
        const loose = doc.context.register(
          doc.context.obj({
            Type: 'Page',
            MediaBox: [0, 0, 600, 800],
            Contents: PDFString.of(SECRET),
          } as never),
        );
        annotate(doc, p1!, { Subtype: 'Link', Dest: [loose, 'Fit'] });
      }),
    );
    expect(await leaks(result)).toBe(false);
  });
});

describe('controle op losse pagina’s en aantekeningen', () => {
  it('telt een pagina buiten de paginaboom en een aantekening op geen enkele pagina', async () => {
    const doc = await PDFDocument.create();
    doc.addPage([600, 800]);
    expect(strayObjects(lib, doc)).toBe(0);
    doc.context.register(doc.context.obj({ Type: 'Page', MediaBox: [0, 0, 600, 800] }));
    doc.context.register(doc.context.obj({ Subtype: 'Link', Rect: [0, 0, 10, 10] }));
    expect(strayObjects(lib, doc)).toBe(2);
  });

  it('een venstertje bij een opmerking op de pagina telt niet als los', async () => {
    const doc = await PDFDocument.create();
    const page = doc.addPage([600, 800]);
    const [comment] = annotate(doc, page, { Subtype: 'Text', Contents: PDFString.of('Opmerking') });
    doc.context.register(
      doc.context.obj({ Subtype: 'Popup', Rect: [0, 0, 10, 10], Parent: comment }),
    );
    expect(strayObjects(lib, doc)).toBe(0);
  });

  it('de controle na redactie weigert een bestand met een verstopte pagina', async () => {
    const doc = await PDFDocument.create();
    doc.addPage([600, 800]);
    doc.context.register(doc.context.obj({ Type: 'Page', MediaBox: [0, 0, 600, 800] }));
    await expect(assertImageOnly(await doc.save({ useObjectStreams: false }), [])).rejects.toEqual(
      new RedactionError('verify'),
    );
  });
});
