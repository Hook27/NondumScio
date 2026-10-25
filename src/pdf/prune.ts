import type { PDFDocument, PDFObject, PDFRef } from 'pdf-lib';

type PdfLib = typeof import('pdf-lib');

/**
 * Haalt uit een document alle objecten waar vanuit de kern (de catalogus, de documentgegevens en
 * de versleuteling) niets meer naar verwijst, en geeft het aantal terug. pdf-lib schrijft bij het
 * opslaan namelijk ook objecten weg die nergens meer in hangen: een pagina die je uit het
 * document haalt, blijft dan als los object (met zijn tekst) in het bestand staan, onzichtbaar
 * maar wel terug te lezen. Na een opruimbeurt is weg echt weg.
 */
export function pruneUnreachable(lib: PdfLib, doc: PDFDocument): number {
  const { PDFArray, PDFDict, PDFRef, PDFStream } = lib;
  const { context } = doc;
  const keep = new Set<string>();
  const pending: PDFRef[] = [];

  const visit = (value: PDFObject | undefined) => {
    if (value instanceof PDFRef) {
      if (!keep.has(value.tag)) {
        keep.add(value.tag);
        pending.push(value);
      }
    } else if (value instanceof PDFDict) {
      for (const [, child] of value.entries()) visit(child);
    } else if (value instanceof PDFArray) {
      for (const child of value.asArray()) visit(child);
    } else if (value instanceof PDFStream) {
      visit(value.dict);
    }
  };

  const { Root, Info, Encrypt } = context.trailerInfo;
  visit(Root);
  visit(Info);
  visit(Encrypt);
  for (let ref = pending.pop(); ref; ref = pending.pop()) visit(context.lookup(ref));

  let removed = 0;
  for (const [ref] of context.enumerateIndirectObjects()) {
    if (!keep.has(ref.tag)) {
      context.delete(ref);
      removed += 1;
    }
  }
  return removed;
}
