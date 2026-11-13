import {
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFName,
  PDFNumber,
  PDFRawStream,
  PDFRef,
  PDFString,
  StandardFonts,
  decodePDFRawStream,
  type PDFPage,
} from 'pdf-lib';

/**
 * Alleen voor tests: PDF's met verwijzingen tussen pagina's (koppelingen, opmerkingen,
 * formuliervelden), en controleren of een geheim ergens in een bestand is blijven staan.
 */

export const SECRET = 'GEHEIM-4711';

const hex = (text: string) =>
  [...text].map((char) => char.charCodeAt(0).toString(16).toUpperCase().padStart(2, '0')).join('');

/** Of het geheim ergens in het bestand staat: in de ruwe bytes, een object of een uitgepakte stroom. */
export async function leaks(bytes: Uint8Array): Promise<boolean> {
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
 * Een PDF met een pagina per tekst (standaard drie; pagina 2 heeft het geheim). `extra` zet er
 * aantekeningen bij (koppelingen, opmerkingen, formuliervelden) die naar andere pagina's verwijzen.
 */
export async function makeSource(
  extra: (doc: PDFDocument, pages: PDFPage[]) => void,
  texts = ['Inhoud', SECRET, 'Bijlage'],
) {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const pages = texts.map((text) => {
    const page = doc.addPage([600, 800]);
    page.drawText(text, { x: 50, y: 700, size: 20, font });
    return page;
  });
  extra(doc, pages);
  return new Uint8Array(await doc.save());
}

/** Zet aantekeningen (als losse objecten) op een pagina. */
export function annotate(doc: PDFDocument, page: PDFPage, ...items: Record<string, unknown>[]) {
  const refs = items.map((item) =>
    doc.context.register(
      doc.context.obj({ Type: 'Annot', Rect: [50, 690, 200, 720], ...item } as never),
    ),
  );
  page.node.set(PDFName.of('Annots'), doc.context.obj(refs));
  return refs;
}

export const link = (target: PDFPage) => ({ Subtype: 'Link', Dest: [target.ref, 'Fit'] });

/**
 * Een getagde PDF van drie pagina's waarin het geheim alleen in de alternatieve tekst van een
 * figuur op pagina 2 staat (niet op de pagina zelf). Pagina 1 heeft een koppeling naar zichzelf;
 * met `sd` wijst die koppeling ook naar de figuur als structuurbestemming (PDF 2.0, `/SD`). Met
 * `se` is er een bladwijzer naar pagina 1 die ook naar de figuur als structuurelement wijst (`/SE`).
 * Met `open` opent het bestand op pagina 1 met een startactie die ook een structuurbestemming heeft.
 */
export function makeStructureSource({ sd = false, se = false, open = false } = {}) {
  return makeSource(
    (doc, [a, b, c]) => {
      const { context } = doc;
      const element = (fields: Record<string, unknown>) =>
        context.register(context.obj({ Type: 'StructElem', ...fields } as never));
      const p1 = element({ S: 'P', Pg: a!.ref, K: 0 });
      const figure = element({
        S: 'Figure',
        Pg: b!.ref,
        Alt: PDFString.of(`Foto ${SECRET}`),
        K: 0,
      });
      const p3 = element({ S: 'P', Pg: c!.ref, K: 0 });
      const document = element({ S: 'Document', K: [p1, figure, p3] });
      const root = context.register(
        context.obj({
          Type: 'StructTreeRoot',
          K: document,
          ParentTree: context.obj({ Nums: [0, [p1], 1, [figure], 2, [p3]] }),
          ParentTreeNextKey: 3,
        }),
      );
      for (const ref of [p1, figure, p3]) {
        context.lookup(ref, PDFDict).set(PDFName.of('P'), document);
      }
      context.lookup(document, PDFDict).set(PDFName.of('P'), root);
      [a, b, c].forEach((page, i) => page!.node.set(PDFName.of('StructParents'), PDFNumber.of(i)));
      doc.catalog.set(PDFName.of('StructTreeRoot'), root);
      doc.catalog.set(PDFName.of('MarkInfo'), context.obj({ Marked: true }));
      annotate(doc, a!, {
        Subtype: 'Link',
        A: { S: 'GoTo', D: [a!.ref, 'Fit'], ...(sd ? { SD: [figure, 'Fit'] } : {}) },
      });
      if (open) {
        doc.catalog.set(
          PDFName.of('OpenAction'),
          context.obj({ S: 'GoTo', D: [a!.ref, 'Fit'], SD: [figure, 'Fit'] }),
        );
      }
      if (se) {
        const outlines = context.nextRef();
        const item = context.register(
          context.obj({
            Title: PDFString.of('Inhoud'),
            Parent: outlines,
            Dest: [a!.ref, 'Fit'],
            SE: figure,
          }),
        );
        context.assign(
          outlines,
          context.obj({ Type: 'Outlines', First: item, Last: item, Count: 1 }),
        );
        doc.catalog.set(PDFName.of('Outlines'), outlines);
      }
    },
    ['Inhoud', 'Pagina twee', 'Bijlage'],
  );
}

/** De aantekeningen van een pagina in het resultaat. */
export async function annotationsOn(bytes: Uint8Array, pageIndex: number) {
  const doc = await PDFDocument.load(bytes, { updateMetadata: false });
  const annots = doc.getPage(pageIndex).node.lookupMaybe(PDFName.of('Annots'), PDFArray);
  const items = (annots?.asArray() ?? []).map((ref) => doc.context.lookup(ref) as PDFDict);
  return { doc, items };
}

/** Naar welke pagina (plek vanaf 0) een verwijzing in het resultaat wijst; -1 als nergens. */
export const pageIndexOf = (doc: PDFDocument, ref: unknown) =>
  doc.getPages().findIndex((page) => ref instanceof PDFRef && page.ref.tag === ref.tag);
