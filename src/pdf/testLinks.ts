import {
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFName,
  PDFRawStream,
  PDFRef,
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
