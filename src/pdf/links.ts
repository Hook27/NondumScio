import type { PDFDict, PDFDocument, PDFObject } from 'pdf-lib';

type PdfLib = typeof import('pdf-lib');

/**
 * Verwijzingen tussen pagina's bij het kopiëren. pdf-lib kopieert bij `copyPages` alles waar een
 * pagina naar verwijst. Wijst een koppeling (bijvoorbeeld in een inhoudsopgave) naar een andere
 * pagina, dan komt die andere pagina dus mee, met al zijn tekst: onzichtbaar, maar wel terug te
 * lezen. Daarom maken we die verwijzingen vóór het kopiëren los (ze worden een paginanummer) en
 * daarna weer vast, aan de nieuwe pagina op die plek.
 */

/** Het merkteken dat tijdelijk op de plek van een verwijzing naar een pagina staat. */
const MARK = 'NondumScioPage';

/**
 * Loopt door alles waar `starts` naar verwijzen (elk object één keer) en vervangt onderweg
 * waarden: geeft `swap` iets terug, dan komt dat ervoor in de plaats en gaat het daar niet verder.
 */
function walk(
  lib: PdfLib,
  doc: PDFDocument,
  starts: Iterable<PDFObject>,
  swap: (value: PDFObject) => PDFObject | undefined,
) {
  const { PDFArray, PDFDict, PDFRef, PDFStream } = lib;
  const seen = new Set<string>();
  const visit = (value: PDFObject) => {
    let target: PDFObject | undefined = value;
    if (value instanceof PDFRef) {
      if (seen.has(value.tag)) return;
      seen.add(value.tag);
      target = doc.context.lookup(value);
    }
    const dict = target instanceof PDFStream ? target.dict : target;
    if (dict instanceof PDFDict) {
      for (const [key, child] of dict.entries()) {
        const next = swap(child);
        if (next) dict.set(key, next);
        else visit(child);
      }
    } else if (dict instanceof PDFArray) {
      for (let i = 0; i < dict.size(); i += 1) {
        const child = dict.get(i);
        const next = swap(child);
        if (next) dict.set(i, next);
        else visit(child);
      }
    }
  };
  for (const start of starts) visit(start);
}

/** Of een object een pagina is (ook een losse, die niet in de paginaboom hangt). */
function isPage(lib: PdfLib, doc: PDFDocument, value: PDFObject | undefined) {
  const object = value instanceof lib.PDFRef ? doc.context.lookup(value) : value;
  return (
    object instanceof lib.PDFDict && object.get(lib.PDFName.of('Type')) === lib.PDFName.of('Page')
  );
}

/** De aantekeningen van een pagina (koppelingen, opmerkingen, formuliervelden). */
function annotationsOf(lib: PdfLib, doc: PDFDocument, page: PDFDict): PDFDict[] {
  const annots = page.lookupMaybe(lib.PDFName.of('Annots'), lib.PDFArray);
  if (!annots) return [];
  return annots
    .asArray()
    .map((item) => (item instanceof lib.PDFRef ? doc.context.lookup(item) : item))
    .filter((item): item is PDFDict => item instanceof lib.PDFDict);
}

/**
 * Maakt in `doc` (dat daarna gekopieerd wordt) elke verwijzing van een pagina naar een pagina los:
 * een pagina uit de paginaboom wordt een merkteken met zijn plek, een losse pagina valt weg. Wat
 * een pagina aan andere pagina's vastmaakt zonder dat het voor die pagina zelf nodig is, gaat weg:
 * de velden van een formulier (het formulier zelf gaat niet mee), een antwoord op een opmerking
 * elders, en artikelkralen.
 */
export function detachPageRefs(lib: PdfLib, doc: PDFDocument): void {
  const { PDFName, PDFNull, PDFRef } = lib;
  const pages = doc.getPages();
  const index = new Map(pages.map((page, i) => [page.ref.tag, i]));
  for (const page of pages) {
    page.node.delete(PDFName.of('B'));
    for (const annotation of annotationsOf(lib, doc, page.node)) {
      annotation.delete(PDFName.of('IRT'));
      if (annotation.get(PDFName.of('Subtype')) === PDFName.of('Widget')) {
        annotation.delete(PDFName.of('Parent'));
      }
    }
  }
  const starts = pages.flatMap((page) =>
    page.node
      .entries()
      .filter(([key]) => key !== PDFName.of('Parent'))
      .map(([, value]) => value),
  );
  walk(lib, doc, starts, (value) => {
    if (!(value instanceof PDFRef)) return undefined;
    const at = index.get(value.tag);
    if (at !== undefined) return doc.context.obj({ [MARK]: at });
    return isPage(lib, doc, value) ? PDFNull : undefined;
  });
}

/**
 * Maakt de merktekens van `detachPageRefs` weer vast: aan de pagina die nu op die plek staat (in
 * `doc`, het nieuwe document). Zonder pagina op die plek valt de verwijzing weg.
 */
export function attachPageRefs(lib: PdfLib, doc: PDFDocument): void {
  const { PDFDict, PDFName, PDFNull, PDFNumber } = lib;
  const refs = doc.getPages().map((page) => page.ref);
  const starts = doc.getPages().flatMap((page) =>
    page.node
      .entries()
      .filter(([key]) => key !== PDFName.of('Parent'))
      .map(([, value]) => value),
  );
  walk(lib, doc, starts, (value) => {
    if (!(value instanceof PDFDict)) return undefined;
    const mark = value.lookupMaybe(PDFName.of(MARK), PDFNumber);
    if (!mark) return undefined;
    return refs[mark.asNumber()] ?? PDFNull;
  });
}

/**
 * Telt wat er in een bestand staat zonder erbij te horen: pagina's die niet in de paginaboom hangen,
 * en aantekeningen die op geen enkele pagina staan (een venstertje bij een opmerking telt mee met
 * zijn opmerking). Bij 0 is er geen verstopte pagina of tekst van een andere pagina.
 */
export function strayObjects(lib: PdfLib, doc: PDFDocument): number {
  const { PDFDict, PDFName, PDFRef, PDFStream } = lib;
  const pages = new Set(doc.getPages().map((page) => page.ref.tag));
  const placed = new Set<string>();
  for (const page of doc.getPages()) {
    const annots = page.node.lookupMaybe(PDFName.of('Annots'), lib.PDFArray);
    for (const item of annots?.asArray() ?? []) {
      if (item instanceof PDFRef) placed.add(item.tag);
    }
  }
  let strays = 0;
  for (const [ref, object] of doc.context.enumerateIndirectObjects()) {
    const dict = object instanceof PDFStream ? object.dict : object;
    if (!(dict instanceof PDFDict)) continue;
    if (dict.get(PDFName.of('Type')) === PDFName.of('Page')) {
      if (!pages.has(ref.tag)) strays += 1;
      continue;
    }
    const isAnnotation = dict.has(PDFName.of('Subtype')) && dict.has(PDFName.of('Rect'));
    if (!isAnnotation || placed.has(ref.tag)) continue;
    const parent = dict.get(PDFName.of('Parent'));
    const popupOfPlaced =
      dict.get(PDFName.of('Subtype')) === PDFName.of('Popup') &&
      parent instanceof PDFRef &&
      placed.has(parent.tag);
    if (!popupOfPlaced) strays += 1;
  }
  return strays;
}
