import type { PDFDict, PDFDocument, PDFPageLeaf, PDFPageTree } from 'pdf-lib';

type PdfLib = typeof import('pdf-lib');

/** De soorten hulpbronnen die een pagina bij naam aanroept, en die we per pagina kunnen uitdunnen. */
const NAMED = ['XObject', 'Font', 'ExtGState', 'ColorSpace', 'Pattern', 'Shading', 'Properties'];

/**
 * Veel scanprogramma's geven alle pagina's één gedeelde lijst met hulpbronnen, met daarin de
 * afbeeldingen van álle pagina's. pdf-lib kopieert bij `copyPages` wat een pagina noemt, dus dan
 * gaat bij elke pagina het hele document mee (bij Splitsen per deel opnieuw).
 *
 * Deze functie geeft elke gevraagde pagina die zo'n gedeelde lijst gebruikt een eigen lijst, met
 * alleen wat haar inhoud bij naam aanroept. De afbeeldingen zelf blijven gedeeld (dezelfde
 * verwijzing), dus binnen één resultaat staan ze niet dubbel. Het verandert alleen het ingelezen
 * document in het geheugen, niet het bestand.
 *
 * Bij twijfel blijft een pagina zoals ze is: liever te veel meenemen dan iets verliezen. Twijfel
 * is: inhoud die niet te lezen is (een onbekende codering), of een getekend onderdeel zonder eigen
 * hulpbronnen (een formulier-XObject of een weergave van een aantekening), dat dan die van de
 * pagina zou gebruiken.
 *
 * Geeft de pagina's terug die daardoor nog een gedeelde lijst gebruiken (Redigeren zet die zo nodig
 * om in een afbeelding, zie `redact.ts`).
 */
export function trimSharedResources(
  lib: PdfLib,
  doc: PDFDocument,
  indices: readonly number[],
): number[] {
  const pages = doc.getPages();
  const users = new Map<PDFDict, number>();
  for (const page of pages) {
    const resources = page.node.Resources();
    if (resources) users.set(resources, (users.get(resources) ?? 0) + 1);
  }
  for (const [resources, count] of users) if (count > 1) shared.add(resources);
  const doubtful: number[] = [];
  for (const index of new Set(indices)) {
    const node = pages[index]?.node;
    const resources = node?.Resources();
    if (!node || !resources || !shared.has(resources)) continue;
    const own = trimmed(lib, doc, node, resources);
    if (own) node.set(lib.PDFName.of('Resources'), own);
    else doubtful.push(index);
  }
  return doubtful;
}

/**
 * De lijsten die ooit door meer pagina's gedeeld werden. Ook de laatste pagina die zo'n lijst nog
 * gebruikt (bij Splitsen een later deel), krijgt dan een eigen, uitgedunde lijst.
 */
const shared = new WeakSet<PDFDict>();

/** Een eigen lijst voor deze pagina met alleen wat ze gebruikt, of `null` bij twijfel. */
function trimmed(lib: PdfLib, doc: PDFDocument, node: PDFPageLeaf, resources: PDFDict) {
  const { PDFDict, PDFName, PDFRawStream } = lib;
  const used = namesIn(lib, node);
  if (!used || !appearancesHaveResources(lib, node)) return null;

  const own = PDFDict.withContext(doc.context);
  for (const [key, value] of resources.entries()) {
    const kind = key.decodeText();
    const list = NAMED.includes(kind) ? resources.lookup(key) : undefined;
    // Wat geen lijst met namen is (zoals ProcSet) gaat gewoon mee.
    if (!(list instanceof PDFDict)) {
      own.set(key, value);
      continue;
    }
    const kept = PDFDict.withContext(doc.context);
    for (const [name, entry] of list.entries()) {
      if (!used.has(name.decodeText())) continue;
      // Een formulier-XObject zonder eigen hulpbronnen leent die van de pagina: dan niet uitdunnen.
      const target = list.lookup(name);
      if (
        kind === 'XObject' &&
        target instanceof PDFRawStream &&
        target.dict.get(PDFName.of('Subtype')) === PDFName.of('Form') &&
        !target.dict.has(PDFName.of('Resources'))
      ) {
        return null;
      }
      kept.set(name, entry);
    }
    own.set(key, kept);
  }
  return own;
}

/** Alle namen (`/Naam`) in de inhoud van de pagina, of `null` als die niet te lezen is. */
function namesIn(lib: PdfLib, node: PDFPageLeaf): Set<string> | null {
  const { PDFArray, PDFRawStream, decodePDFRawStream } = lib;
  const contents = node.Contents();
  const streams =
    contents instanceof PDFArray
      ? contents.asArray().map((ref) => node.context.lookup(ref))
      : [contents];
  const names = new Set<string>();
  for (const stream of streams) {
    if (stream === undefined) continue;
    if (!(stream instanceof PDFRawStream)) return null;
    let bytes: Uint8Array;
    try {
      bytes = decodePDFRawStream(stream).decode();
    } catch {
      return null;
    }
    // Elk woord dat met een schuine streep begint; in tekst tussen haakjes vangen we er soms
    // een te veel, en dat is veilig (dan blijft er iets meer staan).
    let text = '';
    for (let i = 0; i < bytes.length; i += 1) text += String.fromCharCode(bytes[i]!);
    for (const match of text.matchAll(/\/([^\s/[\]()<>{}%]*)/g)) {
      names.add(
        match[1]!.replace(/#([0-9a-fA-F]{2})/g, (_, hex: string) =>
          String.fromCharCode(parseInt(hex, 16)),
        ),
      );
    }
  }
  return names;
}

/** Of elke weergave van een aantekening op deze pagina eigen hulpbronnen heeft. */
function appearancesHaveResources(lib: PdfLib, node: PDFPageLeaf): boolean {
  const { PDFArray, PDFDict, PDFName, PDFRawStream } = lib;
  const annots = node.lookup(PDFName.of('Annots'));
  if (!(annots instanceof PDFArray)) return true;
  const streams: unknown[] = [];
  for (let i = 0; i < annots.size(); i += 1) {
    const annot = annots.lookup(i);
    const appearance = annot instanceof PDFDict ? annot.lookup(PDFName.of('AP')) : undefined;
    if (!(appearance instanceof PDFDict)) continue;
    for (const key of ['N', 'R', 'D']) {
      const entry = appearance.lookup(PDFName.of(key));
      if (entry instanceof PDFDict)
        for (const [name] of entry.entries()) streams.push(entry.lookup(name));
      else streams.push(entry);
    }
  }
  return streams.every(
    (stream) => !(stream instanceof PDFRawStream) || stream.dict.has(PDFName.of('Resources')),
  );
}

/**
 * Haalt een lijst met hulpbronnen weg van de paginaboom (waar pagina's hem kunnen erven) als
 * geen enkele pagina eronder hem nog erft. Na `trimSharedResources` hebben de pagina's een eigen
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
