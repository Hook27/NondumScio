import type { PDFArray, PDFDict, PDFDocument, PDFObject, PDFRef } from 'pdf-lib';

type PdfLib = typeof import('pdf-lib');

/**
 * Verwijzingen tussen pagina's bij het opslaan. pdf-lib kopieert bij `copyPages` alles waar een
 * pagina naar verwijst, en schrijft bij het opslaan alles weg waar nog iets naar verwijst. Wijst
 * een koppeling (bijvoorbeeld in een inhoudsopgave), een bladwijzer of een formulierveld naar een
 * andere pagina, dan blijft die andere pagina dus in het bestand, met al zijn tekst: onzichtbaar,
 * maar wel terug te lezen. Daarom maken we die verwijzingen eerst los (ze worden een merkteken
 * met het bestand en de pagina) en daarna weer vast, aan de nieuwe pagina, of ze vallen weg.
 */

/** Het merkteken dat tijdelijk op de plek van een verwijzing naar een pagina staat. */
const MARK = 'NondumScioPage';
const MARK_DOC = 'NondumScioDoc';

/** Waar een merkteken naar wees: het bestand (`PageItem.doc`) en de pagina daarin (vanaf 0). */
export type PageMark = { doc: number; page: number };

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

/** De aantekeningen van een pagina (koppelingen, opmerkingen, formuliervelden), met hun verwijzing. */
function annotationsOf(lib: PdfLib, doc: PDFDocument, page: PDFDict) {
  const annots = page.lookupMaybe(lib.PDFName.of('Annots'), lib.PDFArray);
  return (annots?.asArray() ?? []).flatMap((item) => {
    const dict = item instanceof lib.PDFRef ? doc.context.lookup(item) : item;
    return dict instanceof lib.PDFDict
      ? [{ ref: item instanceof lib.PDFRef ? item : undefined, dict }]
      : [];
  });
}

/** Waar het lopen begint: alles op de pagina's behalve hun plek in de paginaboom, en eventueel de catalogus. */
function startsOf(lib: PdfLib, doc: PDFDocument, whole: boolean): PDFObject[] {
  const { PDFName } = lib;
  const entries = (dict: PDFDict, skip: PDFObject) =>
    dict
      .entries()
      .filter(([key]) => key !== skip)
      .map(([, value]) => value);
  const pages = doc.getPages().flatMap((page) => entries(page.node, PDFName.of('Parent')));
  return whole ? [...pages, ...entries(doc.catalog, PDFName.of('Pages'))] : pages;
}

/** Haalt `ref` uit een lijst (als die er is). */
function removeFrom(lib: PdfLib, list: PDFArray | undefined, ref: PDFRef) {
  if (!list) return;
  for (let i = list.size() - 1; i >= 0; i -= 1) {
    const item = list.get(i);
    if (item instanceof lib.PDFRef && item.tag === ref.tag) list.remove(i);
  }
}

/**
 * Maakt in `doc` elke verwijzing naar een pagina los: een pagina uit de paginaboom wordt een
 * merkteken (met `source`, het bestand, en zijn plek), een losse pagina valt weg.
 *
 * - Zonder `whole` wordt `doc` daarna in een nieuw document gekopieerd (samenvoegen, splitsen,
 *   redactie): alleen de pagina's tellen, en wat een pagina aan andere pagina's vastmaakt zonder
 *   dat het voor die pagina zelf nodig is, gaat weg: de velden van een formulier (het formulier
 *   zelf gaat niet mee), een antwoord op een opmerking elders, en artikelkralen.
 * - Met `whole` blijft `doc` zelf het resultaat (één bestand): dan ook de catalogus (bladwijzers,
 *   benoemde bestemmingen, de startactie, het formulier). Haal eerst met `cutLoose` weg wat bij
 *   de pagina's hoort die niet meedoen.
 */
export function detachPageRefs(
  lib: PdfLib,
  doc: PDFDocument,
  { source = 0, whole = false }: { source?: number; whole?: boolean } = {},
): void {
  const { PDFName, PDFNull, PDFRef } = lib;
  const pages = doc.getPages();
  const index = new Map(pages.map((page, i) => [page.ref.tag, i]));
  if (!whole) {
    for (const page of pages) {
      page.node.delete(PDFName.of('B'));
      for (const { dict } of annotationsOf(lib, doc, page.node)) {
        dict.delete(PDFName.of('IRT'));
        if (dict.get(PDFName.of('Subtype')) === PDFName.of('Widget')) {
          dict.delete(PDFName.of('Parent'));
        }
      }
    }
  }
  walk(lib, doc, startsOf(lib, doc, whole), (value) => {
    if (!(value instanceof PDFRef)) return undefined;
    const at = index.get(value.tag);
    if (at !== undefined) return doc.context.obj({ [MARK]: at, [MARK_DOC]: source });
    return isPage(lib, doc, value) ? PDFNull : undefined;
  });
}

/**
 * Eén bestand: haalt weg wat bij de pagina's hoort die niet meedoen (`keep`: de plekken in het
 * bestand die blijven), voordat `detachPageRefs` met `whole` loopt. Hun formuliervelden gaan uit
 * het formulier (een veld met een vak op een blijvende pagina blijft, met alleen dat vak); een
 * antwoord op een opmerking op zo'n pagina blijft, maar zonder die opmerking, en een venstertje
 * bij zo'n opmerking gaat weg.
 */
export function cutLoose(lib: PdfLib, doc: PDFDocument, keep: ReadonlySet<number>): void {
  const { PDFArray, PDFDict, PDFName, PDFRef } = lib;
  const pages = doc.getPages();
  const gone = pages.filter((_, i) => !keep.has(i));
  if (gone.length === 0) return;
  const goneAnnotations = new Set(
    gone.flatMap((page) => annotationsOf(lib, doc, page.node).flatMap(({ ref }) => ref?.tag ?? [])),
  );

  // Formuliervelden: elk vak uit zijn veld, en een veld zonder vakken uit het formulier.
  const form = doc.catalog.lookupMaybe(PDFName.of('AcroForm'), PDFDict);
  const unlink = (ref: PDFRef) => {
    const field = doc.context.lookup(ref);
    const parent = field instanceof PDFDict ? field.get(PDFName.of('Parent')) : undefined;
    removeFrom(lib, form?.lookupMaybe(PDFName.of('CO'), PDFArray), ref);
    if (parent instanceof PDFRef) {
      const kids = doc.context
        .lookupMaybe(parent, PDFDict)
        ?.lookupMaybe(PDFName.of('Kids'), PDFArray);
      removeFrom(lib, kids, ref);
      if (!kids || kids.size() === 0) unlink(parent);
    } else {
      removeFrom(lib, form?.lookupMaybe(PDFName.of('Fields'), PDFArray), ref);
    }
  };
  for (const page of gone) {
    for (const { ref, dict } of annotationsOf(lib, doc, page.node)) {
      if (ref && dict.get(PDFName.of('Subtype')) === PDFName.of('Widget')) unlink(ref);
    }
  }

  // Opmerkingen op de blijvende pagina's die vastzitten aan een opmerking op een weggehaalde pagina.
  const isGone = (value: PDFObject | undefined) =>
    value instanceof PDFRef && goneAnnotations.has(value.tag);
  pages.forEach((page, i) => {
    if (!keep.has(i)) return;
    const annots = page.node.lookupMaybe(PDFName.of('Annots'), PDFArray);
    annotationsOf(lib, doc, page.node).forEach(({ ref, dict }) => {
      if (isGone(dict.get(PDFName.of('IRT')))) dict.delete(PDFName.of('IRT'));
      const popup = dict.get(PDFName.of('Subtype')) === PDFName.of('Popup');
      if (popup && ref && isGone(dict.get(PDFName.of('Parent')))) removeFrom(lib, annots, ref);
    });
  });
}

/**
 * Of een koppeling nergens meer heen gaat: zijn pagina doet niet meer mee. (Een koppeling naar een
 * benoemde bestemming laten we staan: die naam wijst dan zelf nergens meer heen.)
 */
function isDeadLink(lib: PdfLib, doc: PDFDocument, annotation: PDFDict) {
  const { PDFArray, PDFDict, PDFName, PDFNull, PDFRef } = lib;
  if (annotation.get(PDFName.of('Subtype')) !== PDFName.of('Link')) return false;
  const resolve = (value: PDFObject | undefined) =>
    value instanceof PDFRef ? doc.context.lookup(value) : value;
  const action = resolve(annotation.get(PDFName.of('A')));
  const dest = resolve(
    annotation.get(PDFName.of('Dest')) ??
      (action instanceof PDFDict && action.get(PDFName.of('S')) === PDFName.of('GoTo')
        ? action.get(PDFName.of('D'))
        : undefined),
  );
  return dest instanceof PDFArray && (dest.size() === 0 || dest.get(0) === PDFNull);
}

/**
 * Maakt de merktekens van `detachPageRefs` weer vast, in `doc` (het nieuwe document, of met
 * `whole` hetzelfde document). `target` geeft de plek in het resultaat van de pagina waar een
 * merkteken naar wees (standaard: dezelfde plek); doet die pagina niet mee, dan valt de
 * verwijzing weg. Een koppeling die zo nergens meer heen gaat, gaat van de pagina af; een
 * bladwijzer blijft, maar wijst nergens meer heen.
 */
export function attachPageRefs(
  lib: PdfLib,
  doc: PDFDocument,
  {
    whole = false,
    target = (mark) => mark.page,
  }: { whole?: boolean; target?: (mark: PageMark) => number | undefined } = {},
): void {
  const { PDFArray, PDFDict, PDFName, PDFNull, PDFNumber } = lib;
  const pages = doc.getPages();
  walk(lib, doc, startsOf(lib, doc, whole), (value) => {
    if (!(value instanceof PDFDict)) return undefined;
    const page = value.lookupMaybe(PDFName.of(MARK), PDFNumber);
    if (!page) return undefined;
    const source = value.lookupMaybe(PDFName.of(MARK_DOC), PDFNumber)?.asNumber() ?? 0;
    const position = target({ doc: source, page: page.asNumber() });
    return (position === undefined ? undefined : pages[position]?.ref) ?? PDFNull;
  });
  for (const page of pages) {
    const annots = page.node.lookupMaybe(PDFName.of('Annots'), PDFArray);
    if (!annots) continue;
    for (let i = annots.size() - 1; i >= 0; i -= 1) {
      const item = annots.get(i);
      const dict = item instanceof lib.PDFRef ? doc.context.lookup(item) : item;
      if (dict instanceof PDFDict && isDeadLink(lib, doc, dict)) annots.remove(i);
    }
  }
}

/**
 * De plek van elke pagina in het plan, voor `attachPageRefs`: staat een pagina er meer dan eens
 * in, dan de eerste.
 */
export function positionsIn(pages: readonly { doc: number; source: number }[]) {
  const positions = new Map<string, number>();
  pages.forEach((page, i) => {
    const key = `${page.doc}:${page.source}`;
    if (!positions.has(key)) positions.set(key, i);
  });
  return (mark: PageMark) => positions.get(`${mark.doc}:${mark.page}`);
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
