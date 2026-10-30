import type { PDFDict, PDFDocument, PDFObject } from 'pdf-lib';

type PdfLib = typeof import('pdf-lib');

/**
 * Eén bestand: haalt uit de structuur voor schermlezers (de tags van een getagde PDF) weg wat
 * alleen bij de weggehaalde pagina's hoorde (`keep`: de plekken in het bestand die blijven). Zo'n
 * element kan alternatieve tekst of de echte tekst (`/ActualText`) van die pagina bevatten. Draai
 * dit vóór `detachPageRefs`, als de verwijzingen naar pagina's nog kloppen.
 *
 * - Een inhoudsdeel (een nummer, of een verwijzing `/MCR`) hoort bij een weggehaalde pagina als
 *   zijn pagina (`/Pg`, ook van een element erboven) weggehaald is; een verwijzing naar een object
 *   (`/OBJR`) ook als dat object een aantekening op zo'n pagina is.
 * - Een element zonder overgebleven inhoud gaat weg; een element dat nog inhoud heeft op een
 *   blijvende pagina blijft (met alleen die inhoud).
 * - In de ParentTree gaan de nummers van de weggehaalde pagina's en hun aantekeningen weg, en in de
 *   IDTree de namen van weggehaalde elementen.
 */
export function dropTagsOf(lib: PdfLib, doc: PDFDocument, keep: ReadonlySet<number>): void {
  const { PDFArray, PDFDict, PDFName, PDFNumber, PDFRef } = lib;
  const root = doc.catalog.lookupMaybe(PDFName.of('StructTreeRoot'), PDFDict);
  if (!root) return;
  const pages = doc.getPages();
  const gone = pages.filter((_, i) => !keep.has(i));
  if (gone.length === 0) return;

  const resolve = (value: PDFObject | undefined) =>
    value instanceof PDFRef ? doc.context.lookup(value) : value;
  const goneKeys = new Set<number>();
  const goneObjects = new Set<string>();
  const gonePages = new Set(gone.map((page) => page.ref.tag));
  for (const page of gone) {
    const key = page.node.lookupMaybe(PDFName.of('StructParents'), PDFNumber);
    if (key) goneKeys.add(key.asNumber());
    const annots = page.node.lookupMaybe(PDFName.of('Annots'), PDFArray);
    for (const item of annots?.asArray() ?? []) {
      if (item instanceof PDFRef) goneObjects.add(item.tag);
      const annotation = resolve(item);
      const parent =
        annotation instanceof PDFDict
          ? annotation.lookupMaybe(PDFName.of('StructParent'), PDFNumber)
          : undefined;
      if (parent) goneKeys.add(parent.asNumber());
    }
  }
  const isGonePage = (value: PDFObject | undefined) =>
    value instanceof PDFRef && gonePages.has(value.tag);

  /** De weggehaalde elementen (hun verwijzing), om ook uit de ParentTree en de IDTree te halen. */
  const dropped = new Set<string>();
  const seen = new Set<PDFDict>();

  /** Houdt van `holder` alleen de inhoud die blijft; geeft terug of er iets overbleef. */
  const prune = (holder: PDFDict, page: PDFObject | undefined): boolean => {
    const kids = holder.get(PDFName.of('K'));
    if (kids === undefined) return !isGonePage(page);
    const resolved = resolve(kids);
    const list = resolved instanceof PDFArray ? resolved.asArray() : [kids];
    const kept = list.filter((kid) => keepKid(kid, page));
    if (kept.length === list.length) return true;
    if (kept.length === 0) holder.delete(PDFName.of('K'));
    else holder.set(PDFName.of('K'), kept.length === 1 ? kept[0]! : doc.context.obj(kept));
    return kept.length > 0;
  };

  const keepKid = (kid: PDFObject, page: PDFObject | undefined): boolean => {
    if (kid instanceof PDFNumber) return !isGonePage(page);
    const value = resolve(kid);
    if (!(value instanceof PDFDict)) return true;
    const type = value.get(PDFName.of('Type'));
    const own = value.get(PDFName.of('Pg')) ?? page;
    if (type === PDFName.of('MCR')) return !isGonePage(own);
    if (type === PDFName.of('OBJR')) {
      const object = value.get(PDFName.of('Obj'));
      return !isGonePage(own) && !(object instanceof PDFRef && goneObjects.has(object.tag));
    }
    // Een element (StructElem): eerst zijn eigen inhoud.
    if (seen.has(value)) return true;
    seen.add(value);
    const keeps = prune(value, own);
    if (!keeps) {
      if (kid instanceof PDFRef) dropped.add(kid.tag);
      return false;
    }
    // Blijft het element alleen voor inhoud op andere pagina's, dan wijst het niet meer naar een
    // weggehaalde pagina.
    if (isGonePage(value.get(PDFName.of('Pg')))) value.delete(PDFName.of('Pg'));
    return true;
  };

  prune(root, undefined);

  // ParentTree (getallenboom) en IDTree (namenboom): weg wat bij de weggehaalde pagina's hoorde.
  const isDropped = (value: PDFObject | undefined) =>
    value instanceof PDFRef && dropped.has(value.tag);
  const cleanTree = (node: PDFObject | undefined, list: 'Nums' | 'Names') => {
    const dict = resolve(node);
    if (!(dict instanceof PDFDict)) return;
    const entries = dict.lookupMaybe(PDFName.of(list), PDFArray);
    if (entries) {
      const kept: PDFObject[] = [];
      for (let i = 0; i + 1 < entries.size(); i += 2) {
        const key = entries.get(i);
        const value = entries.get(i + 1);
        const goneKey = list === 'Nums' && key instanceof PDFNumber && goneKeys.has(key.asNumber());
        if (goneKey || isDropped(value)) continue;
        // Een lijst met elementen (voor een pagina die blijft): weggehaalde elementen worden leeg.
        const items = resolve(value);
        if (items instanceof PDFArray) {
          for (let j = 0; j < items.size(); j += 1) {
            if (isDropped(items.get(j))) items.set(j, lib.PDFNull);
          }
        }
        kept.push(key, value);
      }
      dict.set(PDFName.of(list), doc.context.obj(kept));
    }
    const kids = dict.lookupMaybe(PDFName.of('Kids'), PDFArray);
    for (const kid of kids?.asArray() ?? []) cleanTree(kid, list);
  };
  cleanTree(root.get(PDFName.of('ParentTree')), 'Nums');
  cleanTree(root.get(PDFName.of('IDTree')), 'Names');
}
