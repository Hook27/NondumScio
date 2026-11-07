import type { PDFDict, PDFDocument, PDFPageLeaf, PDFPageTree, PDFRawStream } from 'pdf-lib';

type PdfLib = typeof import('pdf-lib');

/** De soorten hulpbronnen die een pagina bij naam aanroept, en die we per pagina kunnen uitdunnen. */
const NAMED = ['XObject', 'Font', 'ExtGState', 'ColorSpace', 'Pattern', 'Shading', 'Properties'];

/**
 * Uitdunnen, zoals de losse tool "PDF → Splitsen op bladwijzers" het doet. Veel PDF's (vooral
 * scans) geven alle pagina's één lijst met hulpbronnen, met daarin de afbeeldingen van álle
 * pagina's; soms krijgt ook elke pagina een eigen kopie van zo'n volle lijst. pdf-lib kopieert bij
 * `copyPages` wat een pagina noemt, dus dan gaat bij elke pagina het hele document mee.
 *
 * Deze functie geeft elke gevraagde pagina een eigen lijst met alleen wat haar inhoud bij naam
 * aanroept. Daarbij:
 * - leest ze de inhoud nauwkeurig (tekst tussen haakjes, commentaar en ingesloten beeldgegevens
 *   tellen niet);
 * - leest ze ook de inhoud van formulier-XObjects zonder eigen hulpbronnen (die lenen die van de
 *   pagina);
 * - dunt ze ook de eigen lijsten uit van formulier-XObjects, patronen, maskers (SMask) en de
 *   weergaven van aantekeningen: die wijzen vaak weer naar dezelfde volle lijst.
 *
 * De afbeeldingen zelf blijven gedeeld (dezelfde verwijzing), dus binnen één resultaat staan ze
 * niet dubbel. Het verandert alleen het ingelezen document in het geheugen, niet het bestand.
 *
 * Bij twijfel blijft een pagina zoals ze is: liever te veel meenemen dan iets verliezen. Twijfel
 * is: inhoud die niet te lezen is (een onbekende codering), of een weergave van een aantekening
 * zonder eigen hulpbronnen, die sommige PDF-lezers met die van de pagina tekenen (voorzichtiger dan
 * het origineel, dat de pagina dan toch uitdunt).
 *
 * Geeft de pagina's terug die niet uitgedund konden worden (Redigeren zet die zo nodig om in een
 * afbeelding, zie `redact.ts`; Splitsen toont er een ⚠ bij).
 */
export function trimPageResources(
  lib: PdfLib,
  doc: PDFDocument,
  indices: readonly number[],
): number[] {
  const pages = doc.getPages();
  const doubtful: number[] = [];
  for (const index of new Set(indices)) {
    const node = pages[index]?.node;
    if (!node) continue;
    let ok = trimmedPages.get(node);
    if (ok === undefined) {
      ok = trimPage(lib, doc, node);
      trimmedPages.set(node, ok);
    }
    if (!ok) doubtful.push(index);
  }
  return doubtful;
}

/** Per pagina of ze uitgedund is (`true`) of niet uit te dunnen was (`false`): één keer per pagina. */
const trimmedPages = new WeakMap<PDFPageLeaf, boolean>();
/** Formulieren en patronen waarvan de eigen lijst al is uitgedund, of die niet te lezen waren. */
const trimmedStreams = new WeakSet<PDFRawStream>();
const unreadableStreams = new WeakSet<PDFRawStream>();
/** Wordt nu uitgedund (tegen een formulier dat, via omwegen, zichzelf aanroept). */
const visiting = new WeakSet<PDFRawStream>();

class Unreadable extends Error {}

/** Dunt één pagina uit; geeft `false` als dat niet veilig kon (dan is er niets veranderd). */
function trimPage(lib: PdfLib, doc: PDFDocument, node: PDFPageLeaf): boolean {
  try {
    if (!appearancesHaveResources(lib, node)) return false;
    const resources = node.Resources();
    const own = resources
      ? trimmedList(lib, doc, resources, usedNames(lib, doc, pageContents(lib, node), resources))
      : null;
    for (const stream of appearanceStreams(lib, node)) trimStream(lib, doc, stream);
    if (own) node.set(lib.PDFName.of('Resources'), own);
    return true;
  } catch {
    return false;
  }
}

/** De inhoud van een pagina (alle stukken achter elkaar), of `Unreadable`. */
function pageContents(lib: PdfLib, node: PDFPageLeaf): Uint8Array {
  const { PDFArray } = lib;
  const contents = node.Contents();
  const streams =
    contents === undefined
      ? []
      : contents instanceof PDFArray
        ? contents.asArray().map((ref) => node.context.lookup(ref))
        : [contents];
  const chunks = streams.filter((stream) => stream !== undefined).map((s) => decoded(lib, s));
  const all = new Uint8Array(chunks.reduce((sum, chunk) => sum + chunk.length + 1, 0));
  let offset = 0;
  for (const chunk of chunks) {
    all.set(chunk, offset);
    offset += chunk.length;
    // Een spatie tussen de stukken: een naam loopt niet door in het volgende stuk.
    all[offset] = 32;
    offset += 1;
  }
  return all;
}

/** De gedecodeerde inhoud van een stream, of `Unreadable` (een codering die pdf-lib niet kent). */
function decoded(lib: PdfLib, stream: unknown): Uint8Array {
  if (!(stream instanceof lib.PDFRawStream)) throw new Unreadable();
  try {
    return lib.decodePDFRawStream(stream).decode();
  } catch {
    throw new Unreadable();
  }
}

/**
 * De namen die de inhoud aanroept, aangevuld met die van formulier-XObjects zonder eigen
 * hulpbronnen (die gebruiken de lijst van wie ze aanroept), ook als die weer zulke formulieren
 * aanroepen.
 */
function usedNames(
  lib: PdfLib,
  doc: PDFDocument,
  content: Uint8Array,
  resources: PDFDict,
): Set<string> {
  const { PDFDict, PDFName, PDFRawStream } = lib;
  const names = new Set<string>();
  contentNames(content, names);
  const xobjects = resources.lookup(PDFName.of('XObject'));
  if (!(xobjects instanceof PDFDict)) return names;
  const scanned = new Set<string>();
  for (let again = true; again;) {
    again = false;
    for (const [key, value] of xobjects.entries()) {
      const name = key.decodeText();
      if (!names.has(name) || scanned.has(name)) continue;
      scanned.add(name);
      const target = doc.context.lookup(value);
      if (
        target instanceof PDFRawStream &&
        target.dict.get(PDFName.of('Subtype')) === PDFName.of('Form') &&
        !target.dict.has(PDFName.of('Resources'))
      ) {
        contentNames(decoded(lib, target), names);
        again = true;
      }
    }
  }
  return names;
}

/**
 * Een nieuwe lijst met hulpbronnen met alleen `names`; wat geen lijst met namen is (zoals ProcSet)
 * gaat gewoon mee. Formulieren, patronen en maskers die meegaan, worden zelf ook uitgedund.
 */
function trimmedList(
  lib: PdfLib,
  doc: PDFDocument,
  resources: PDFDict,
  names: ReadonlySet<string>,
): PDFDict {
  const { PDFDict, PDFName } = lib;
  const own = PDFDict.withContext(doc.context);
  for (const [key, value] of resources.entries()) {
    const kind = key.decodeText();
    const list = NAMED.includes(kind) ? doc.context.lookup(value) : undefined;
    if (!(list instanceof PDFDict)) {
      own.set(key, value);
      continue;
    }
    const kept = PDFDict.withContext(doc.context);
    for (const [name, entry] of list.entries()) {
      if (!names.has(name.decodeText())) continue;
      kept.set(name, entry);
      const target = doc.context.lookup(entry);
      if (kind === 'XObject' || kind === 'Pattern') trimStream(lib, doc, target);
      else if (kind === 'ExtGState' && target instanceof PDFDict) {
        const mask = target.lookup(PDFName.of('SMask'));
        if (mask instanceof PDFDict) trimStream(lib, doc, mask.lookup(PDFName.of('G')));
      }
    }
    own.set(key, kept);
  }
  return own;
}

/**
 * Een formulier-XObject, patroon of weergave met een eigen lijst: die eigen lijst uitdunnen (hij kan
 * ook naar de gedeelde lijst wijzen). Eén keer per stream; niet te lezen geeft `Unreadable`, ook
 * de volgende keren (dan blijft elke pagina die hem gebruikt zoals ze is).
 */
function trimStream(lib: PdfLib, doc: PDFDocument, stream: unknown) {
  const { PDFDict, PDFName, PDFRawStream } = lib;
  if (!(stream instanceof PDFRawStream)) return;
  if (unreadableStreams.has(stream)) throw new Unreadable();
  if (trimmedStreams.has(stream) || visiting.has(stream)) return;
  const resources = stream.dict.lookup(PDFName.of('Resources'));
  if (!(resources instanceof PDFDict)) return;
  if (stream.dict.get(PDFName.of('Subtype')) === PDFName.of('Image')) return;
  visiting.add(stream);
  try {
    const own = trimmedList(
      lib,
      doc,
      resources,
      usedNames(lib, doc, decoded(lib, stream), resources),
    );
    stream.dict.set(PDFName.of('Resources'), own);
    trimmedStreams.add(stream);
  } catch (error) {
    unreadableStreams.add(stream);
    throw error;
  } finally {
    visiting.delete(stream);
  }
}

const isSpace = (b: number) => b === 0 || b === 9 || b === 10 || b === 12 || b === 13 || b === 32;
const isDelimiter = (b: number) =>
  b === 0x28 || // (
  b === 0x29 || // )
  b === 0x3c || // <
  b === 0x3e || // >
  b === 0x5b || // [
  b === 0x5d || // ]
  b === 0x7b || // {
  b === 0x7d || // }
  b === 0x2f || // /
  b === 0x25; // %

/**
 * Alle namen (`/Naam`) uit inhoud: de operanden van Do, Tf, gs, cs, scn, sh, BDC en zo. Tekst
 * tussen haakjes, commentaar (`%` tot het eind van de regel) en de beeldgegevens van ingesloten
 * afbeeldingen (`BI … ID … EI`) tellen niet mee; `#xx` in een naam wordt het teken zelf. Zoals in
 * het origineel.
 */
export function contentNames(bytes: Uint8Array, names: Set<string>): void {
  const n = bytes.length;
  const at = (i: number) => bytes[i] ?? 0;
  let i = 0;
  let inImage = false;
  while (i < n) {
    const c = at(i);
    if (c === 0x25) {
      while (i < n && at(i) !== 10 && at(i) !== 13) i += 1;
    } else if (c === 0x28) {
      // Tekst tussen haakjes, met geneste haakjes en \-escapes.
      let depth = 1;
      i += 1;
      while (i < n && depth > 0) {
        const x = at(i);
        if (x === 0x5c) i += 1;
        else if (x === 0x28) depth += 1;
        else if (x === 0x29) depth -= 1;
        i += 1;
      }
    } else if (c === 0x2f) {
      let name = '';
      i += 1;
      while (i < n && !isSpace(at(i)) && !isDelimiter(at(i))) {
        if (at(i) === 0x23 && i + 2 < n) {
          name += String.fromCharCode(parseInt(String.fromCharCode(at(i + 1), at(i + 2)), 16));
          i += 3;
        } else {
          name += String.fromCharCode(at(i));
          i += 1;
        }
      }
      names.add(name);
    } else if (isSpace(c) || isDelimiter(c)) {
      i += 1;
    } else {
      // Een woord: een getal of een operator. BI … ID begint de gegevens van een ingesloten
      // afbeelding; die lopen tot EI (met witruimte ervoor en erna).
      const start = i;
      while (i < n && !isSpace(at(i)) && !isDelimiter(at(i))) i += 1;
      const two = i - start === 2;
      if (two && at(start) === 0x42 && at(start + 1) === 0x49) inImage = true;
      else if (inImage && two && at(start) === 0x49 && at(start + 1) === 0x44) {
        inImage = false;
        i += 1;
        while (
          i < n &&
          !(
            at(i) === 0x45 &&
            at(i + 1) === 0x49 &&
            isSpace(at(i - 1)) &&
            (i + 2 >= n || isSpace(at(i + 2)))
          )
        ) {
          i += 1;
        }
        i += 2;
      }
    }
  }
}

/** De weergaven (N, R, D, ook per stand) van de aantekeningen op een pagina. */
function appearanceStreams(lib: PdfLib, node: PDFPageLeaf): unknown[] {
  const { PDFArray, PDFDict, PDFName } = lib;
  const annots = node.lookup(PDFName.of('Annots'));
  if (!(annots instanceof PDFArray)) return [];
  const streams: unknown[] = [];
  for (let i = 0; i < annots.size(); i += 1) {
    const annot = annots.lookup(i);
    const appearance = annot instanceof PDFDict ? annot.lookup(PDFName.of('AP')) : undefined;
    if (!(appearance instanceof PDFDict)) continue;
    for (const key of ['N', 'R', 'D']) {
      const entry = appearance.lookup(PDFName.of(key));
      if (entry instanceof PDFDict) {
        for (const [name] of entry.entries()) streams.push(entry.lookup(name));
      } else streams.push(entry);
    }
  }
  return streams;
}

/** Of elke weergave van een aantekening op deze pagina eigen hulpbronnen heeft. */
function appearancesHaveResources(lib: PdfLib, node: PDFPageLeaf): boolean {
  const { PDFName, PDFRawStream } = lib;
  return appearanceStreams(lib, node).every(
    (stream) => !(stream instanceof PDFRawStream) || stream.dict.has(PDFName.of('Resources')),
  );
}

/**
 * Haalt een lijst met hulpbronnen weg van de paginaboom (waar pagina's hem kunnen erven) als
 * geen enkele pagina eronder hem nog erft. Na `trimPageResources` hebben de pagina's een eigen
 * lijst; de geërfde lijst hield anders alle afbeeldingen in het bestand vast.
 */
export function dropUnusedInheritedResources(lib: PdfLib, doc: PDFDocument) {
  const { PDFName, PDFPageTree, PDFPageLeaf } = lib;
  const resources = PDFName.of('Resources');
  /** Of alle pagina's onder `node` een eigen lijst hebben (en de geërfde dus niet gebruiken). */
  const visit = (node: PDFPageTree): boolean => {
    const kids = node.Kids();
    let allOwn = true;
    for (let i = 0; i < kids.size(); i += 1) {
      const kid = kids.lookup(i);
      if (kid instanceof PDFPageTree) allOwn = visit(kid) && allOwn;
      else if (kid instanceof PDFPageLeaf) allOwn = kid.has(resources) && allOwn;
    }
    if (allOwn) node.delete(resources);
    return allOwn;
  };
  visit(doc.catalog.Pages());
}

/**
 * De afbeeldingen die pagina `index` kan tonen: via haar hulpbronnen (ook binnen formulieren en
 * patronen) en via haar aantekeningen, per verwijzing met hun (gecodeerde) inhoud. Andere pagina's
 * worden niet betreden, ook niet via een koppeling.
 */
export function imagesReachable(
  lib: PdfLib,
  doc: PDFDocument,
  index: number,
): Map<string, Uint8Array> {
  const { PDFArray, PDFDict, PDFName, PDFPageLeaf, PDFRawStream, PDFRef } = lib;
  const node = doc.getPages()[index]!.node;
  const images = new Map<string, Uint8Array>();
  const seen = new Set<string>();
  const queue: unknown[] = [node, node.Resources()];
  while (queue.length > 0) {
    let value = queue.pop();
    let key: string | null = null;
    if (value instanceof PDFRef) {
      key = value.toString();
      if (seen.has(key)) continue;
      seen.add(key);
      value = doc.context.lookup(value);
    }
    if (value instanceof PDFPageLeaf && value !== node) continue;
    if (value instanceof PDFRawStream) {
      if (value.dict.get(PDFName.of('Subtype')) === PDFName.of('Image')) {
        if (key) images.set(key, value.contents);
        continue;
      }
      value = value.dict;
    }
    if (value instanceof PDFDict) {
      for (const [name, entry] of value.entries()) {
        if (name !== PDFName.of('Parent')) queue.push(entry);
      }
    } else if (value instanceof PDFArray) {
      queue.push(...value.asArray());
    }
  }
  return images;
}
