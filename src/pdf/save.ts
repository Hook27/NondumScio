import type { PDFDocument as PdfLibDocument } from 'pdf-lib';
import { annotationsOf, hasRedactions, type Annotation } from '../annotations/model';
import { remapOutline, type BookmarkNode, type OutlineEntry } from '../outline/outline';
import { docOrder, type PageItem } from '../pages/plan';
import { drawAnnotations, type FontCache } from './annotate';
import { pruneUnreachable } from './prune';
import type { RedactionReport } from './redact';
import { DEFAULT_REDACTION, type RedactionOptions } from './redactOptions';

export type SaveErrorCode = 'encrypted' | 'failed' | 'redaction' | 'cancelled' | 'tooLarge';

export class PdfSaveError extends Error {
  constructor(readonly code: SaveErrorCode) {
    super(`PDF kon niet worden opgeslagen: ${code}`);
    this.name = 'PdfSaveError';
  }
}

/** De originele bytes per geopend bestand (sleutel: `PageItem.doc`). */
export type SourceBytes = ReadonlyMap<number, Uint8Array>;

/** Een nieuwe bladwijzer: naar de eerste pagina van een bestand in het resultaat. */
export type BookmarkFor = { doc: number; title: string };

export type BuildOptions = {
  /**
   * Nieuwe bladwijzers, één per bestand. Vervangt bestaande bladwijzers. Een bestand dat
   * niet (meer) in het plan staat, wordt overgeslagen; de volgorde volgt het resultaat.
   */
  bookmarks?: readonly BookmarkFor[];
  /**
   * De bestaande bladwijzers per bestand (sleutel: `PageItem.doc`), gelezen met pdf.js. Komen de
   * pagina's in een nieuw document (meer bestanden), dan gaan ze mee, met de plek van hun pagina
   * in het resultaat; met `bookmarks` komen ze onder de nieuwe bladwijzer van hun bestand. Een
   * bladwijzer naar een pagina die niet meedoet, valt weg. Zonder opgave vervallen ze.
   */
  outlines?: ReadonlyMap<number, readonly OutlineEntry[]>;
  /**
   * Bestaande bladwijzers weglaten, ook bij één bestand (waar ze anders in het bestand zelf
   * blijven staan). Voor de keuze "Bestaande bladwijzers behouden" als die uit staat.
   */
  dropBookmarks?: boolean;
  /**
   * Annotaties (tekst, markeringen, vormen), die in de pagina zelf worden getekend. Ze horen
   * bij een pagina van het plan (`PageItem.key`); die van pagina's die niet in het plan staan,
   * doen niet mee.
   */
  annotations?: readonly Annotation[];
  /**
   * Hoe pagina's met redactievakken worden afgehandeld: ze worden afbeeldingen (zie `redact.ts`).
   * Zonder opgave gelden de standaardwaarden; redactievakken doen altijd mee, dus ook als een
   * taak hier niets over opgeeft.
   */
  redaction?: Partial<RedactionOptions> & {
    onProgress?: (done: number, total: number) => void;
    onDone?: (report: RedactionReport) => void;
    /** Meldt hoever het laden van de tekstherkenning is (0 tot 1). */
    onOcrStatus?: (progress: number) => void;
    /** Om te stoppen met redigeren (er komt dan geen bestand). */
    signal?: AbortSignal;
    /**
     * Is er ergens in het hele document (niet alleen in deze pagina's) een redactievak? Dan
     * krijgt ook een deel of uittreksel zonder vak geen documentgegevens mee. Zonder opgave
     * geldt wat in de gevraagde pagina's zit.
     */
    wholeDocument?: boolean;
  };
};

export type RedactionRun = NonNullable<BuildOptions['redaction']>;

/**
 * Past redactie toe op een klaar bestand: alleen als er voor de pagina's van het plan
 * redactievakken zijn. Mislukt het, dan komt er geen bestand: liever niets dan een bestand
 * waarin nog staat wat weg moest.
 */
async function applyRedactions(
  bytes: Uint8Array,
  pages: readonly PageItem[],
  annotations: readonly Annotation[],
  run: RedactionRun = {},
  alsoWithout = false,
): Promise<Uint8Array> {
  if (!hasRedactions(pages, annotations) && !alsoWithout) return bytes;
  const { redactPdf, RedactionError } = await import('./redact');
  const { onProgress, onDone, onOcrStatus, signal } = run;
  const options: RedactionOptions = {
    dpi: run.dpi ?? DEFAULT_REDACTION.dpi,
    stripMetadata: run.stripMetadata ?? DEFAULT_REDACTION.stripMetadata,
    ocr: run.ocr ?? DEFAULT_REDACTION.ocr,
  };
  try {
    const result = await redactPdf(
      bytes,
      pages,
      annotations,
      options,
      onProgress,
      { onOcrStatus, signal },
      alsoWithout,
    );
    onDone?.(result.report);
    return result.bytes;
  } catch (error) {
    if (error instanceof RedactionError && error.code === 'cancelled') {
      throw new PdfSaveError('cancelled');
    }
    throw new PdfSaveError('redaction');
  }
}

/**
 * Maakt een nieuwe PDF volgens het pagina-plan: de gekozen pagina's, uit de gekozen
 * bestanden, in de gekozen volgorde, met de extra draaiing. Werkt op kopieën in het
 * geheugen; de bestanden op je apparaat blijven onaangeroerd.
 *
 * - Eén bestand: we passen dat document zelf aan in plaats van pagina's naar een leeg
 *   document te kopiëren. Zo blijven titel, auteur, formulieren en bladwijzers zoveel
 *   mogelijk behouden (een bladwijzer naar een verwijderde pagina wijst daarna nergens heen).
 * - Meerdere bestanden (samenvoegen): een nieuw document waarin de pagina's worden
 *   gekopieerd. Titel en auteur komen uit het bestand van de eerste pagina; bestaande
 *   bladwijzers gaan alleen mee als ze in `outlines` zijn meegegeven (met de nieuwe plekken).
 * - Met `bookmarks`: nieuwe bladwijzers (bijvoorbeeld één per samengevoegd bestand), met de
 *   bestaande bladwijzers van dat bestand eronder als `outlines` is meegegeven.
 */
export async function buildPdf(
  sources: SourceBytes,
  pages: readonly PageItem[],
  options: BuildOptions = {},
): Promise<Uint8Array> {
  const bytes = await buildPlain(sources, pages, options);
  return applyRedactions(
    bytes,
    pages,
    options.annotations ?? [],
    options.redaction,
    options.redaction?.wholeDocument ?? false,
  );
}

async function buildPlain(
  sources: SourceBytes,
  pages: readonly PageItem[],
  { bookmarks, outlines, dropBookmarks = false, annotations = [] }: BuildOptions,
): Promise<Uint8Array> {
  if (pages.length === 0) throw new PdfSaveError('failed');
  const lib = await import('pdf-lib');
  const docs = await loadDocs(lib, sources, pages);
  const rotated = rotation(lib);

  try {
    if (docs.size === 1) {
      const [id, doc] = docs.entries().next().value!;
      const sourcePages = doc.getPages();
      // Koppelingen, bladwijzers en velden houden anders een weggehaalde pagina in het bestand
      // vast (zie `links.ts`); verplaatste pagina's houden zo ook hun koppelingen.
      const links = await import('./links');
      links.cutLoose(lib, doc, new Set(pages.map((item) => item.source)));
      links.detachPageRefs(lib, doc, { source: id, whole: true });
      // Alle pagina's uit de paginaboom halen en in de nieuwe volgorde terugzetten.
      for (let i = sourcePages.length - 1; i >= 0; i -= 1) doc.removePage(i);
      const fonts: FontCache = {};
      for (const item of pages) {
        const page = sourcePages[item.source]!;
        await drawAnnotations(lib, doc, page, annotationsOf(annotations, item.key), fonts);
        page.setRotation(rotated(page.getRotation().angle, item.rotation));
        doc.addPage(page);
      }
      links.attachPageRefs(lib, doc, { whole: true, target: links.positionsIn(pages) });
      // Zonder nieuwe bladwijzers blijven de bestaande in het bestand zelf staan, tenzij ze weg moeten.
      if (bookmarks) setBookmarks(lib, doc, outlineEntries(bookmarks, pages, outlines), true);
      else if (dropBookmarks) setBookmarks(lib, doc, [], false);
      // Pagina's die je hebt weggehaald, moeten ook echt uit het bestand zijn.
      pruneUnreachable(lib, doc);
      return await doc.save();
    }

    const out = await assemble(lib, docs, pages, annotations);
    if (bookmarks) setBookmarks(lib, out, outlineEntries(bookmarks, pages, outlines), true);
    else if (outlines) setBookmarks(lib, out, keptOutlines(pages, outlines), false);
    return await out.save();
  } catch {
    throw new PdfSaveError('failed');
  }
}

/**
 * Splitsen: maakt per deel een eigen PDF. Elk bronbestand wordt maar één keer ingelezen,
 * ook bij honderden delen. Titel en auteur komen uit het bestand van de eerste pagina van
 * elk deel; bestaande bladwijzers vervallen. `onProgress` meldt na elk deel hoe ver het is;
 * tussen de delen krijgt de browser even lucht, zodat de pagina blijft reageren.
 *
 * Met `onPart` gaat elk deel meteen daarheen (bijvoorbeeld een ZIP) en wordt het niet bewaard:
 * dan staan niet alle delen tegelijk in het geheugen, en is de teruggegeven lijst leeg.
 */
export async function buildParts(
  sources: SourceBytes,
  parts: readonly (readonly PageItem[])[],
  onProgress?: (done: number, total: number) => void,
  annotations: readonly Annotation[] = [],
  redaction?: RedactionRun,
  onPart?: (bytes: Uint8Array, index: number) => void,
): Promise<Uint8Array[]> {
  if (parts.length === 0 || parts.some((part) => part.length === 0)) {
    throw new PdfSaveError('failed');
  }
  const lib = await import('pdf-lib');
  const docs = await loadDocs(lib, sources, parts.flat());
  const result: Uint8Array[] = [];
  // Is er in een van de delen geredigeerd, dan krijgen ook de andere delen geen documentgegevens
  // mee (die kunnen hetzelfde bevatten).
  const redacting = redaction?.wholeDocument ?? hasRedactions(parts.flat(), annotations);
  try {
    for (const [index, part] of parts.entries()) {
      const bytes = await (await assemble(lib, docs, part, annotations)).save();
      const done = await applyRedactions(bytes, part, annotations, redaction, redacting);
      if (onPart) onPart(done, index);
      else result.push(done);
      onProgress?.(index + 1, parts.length);
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  } catch (error) {
    // Een mislukte redactie houdt zijn eigen melding.
    throw error instanceof PdfSaveError ? error : new PdfSaveError('failed');
  }
  return result;
}

type PdfLib = typeof import('pdf-lib');

/** Leest elk gebruikt bestand één keer in, en controleert dat alle pagina's bestaan. */
async function loadDocs(lib: PdfLib, sources: SourceBytes, pages: readonly PageItem[]) {
  const { PDFDocument, EncryptedPDFError } = lib;
  const docs = new Map<number, PdfLibDocument>();
  for (const id of new Set(pages.map((page) => page.doc))) {
    const bytes = sources.get(id);
    if (!bytes) throw new PdfSaveError('failed');
    try {
      docs.set(id, await PDFDocument.load(bytes, { updateMetadata: false }));
    } catch (error) {
      throw new PdfSaveError(isEncryptedError(error, EncryptedPDFError) ? 'encrypted' : 'failed');
    }
  }
  // Ook een bestand dat pdf-lib wel inleest maar waarvan de paginaboom niet klopt, geeft
  // hier een nette melding.
  const complete = () => {
    try {
      return pages.every((item) => docs.get(item.doc)!.getPages()[item.source] !== undefined);
    } catch {
      return false;
    }
  };
  if (!complete()) throw new PdfSaveError('failed');
  return docs;
}

/** De draaiing van de pagina plus de extra draaiing uit het plan, als pdf-lib-hoek. */
function rotation({ degrees }: PdfLib) {
  return (angle: number, extra: number) => degrees((((angle + extra) % 360) + 360) % 360);
}

/**
 * Een nieuw document met de pagina's van het plan, gekopieerd uit de ingelezen bestanden.
 * Titel en auteur komen uit het bestand van de eerste pagina.
 */
async function assemble(
  lib: PdfLib,
  docs: ReadonlyMap<number, PdfLibDocument>,
  pages: readonly PageItem[],
  annotations: readonly Annotation[] = [],
) {
  const rotated = rotation(lib);
  // Anders haalt het kopiëren via koppelingen pagina's mee die niet meedoen (zie `links.ts`).
  const links = await import('./links');
  for (const [id, doc] of docs) {
    if (detached.has(doc)) continue;
    links.detachPageRefs(lib, doc, { source: id });
    detached.add(doc);
  }
  const out = await lib.PDFDocument.create();
  const first = docs.get(pages[0]!.doc)!;
  const title = first.getTitle();
  const author = first.getAuthor();
  if (title) out.setTitle(title);
  if (author) out.setAuthor(author);

  // Per bestand alle benodigde pagina's in één keer kopiëren: gedeelde lettertypen en
  // afbeeldingen komen dan maar één keer in het resultaat.
  const copies = new Map<string, ReturnType<typeof out.addPage>>();
  for (const [id, doc] of docs) {
    const indices = [...new Set(pages.filter((p) => p.doc === id).map((p) => p.source))];
    if (indices.length === 0) continue;
    const copied = await out.copyPages(doc, indices);
    indices.forEach((index, i) => copies.set(`${id}:${index}`, copied[i]!));
  }
  const fonts: FontCache = {};
  for (const item of pages) {
    const page = copies.get(`${item.doc}:${item.source}`)!;
    await drawAnnotations(lib, out, page, annotationsOf(annotations, item.key), fonts);
    page.setRotation(rotated(page.getRotation().angle, item.rotation));
    out.addPage(page);
  }
  links.attachPageRefs(lib, out, { target: links.positionsIn(pages) });
  pruneUnreachable(lib, out);
  return out;
}

/** De ingelezen bestanden waarvan de verwijzingen al zijn losgemaakt (splitsen gebruikt ze per deel opnieuw). */
const detached = new WeakSet<PdfLibDocument>();

/**
 * Bij elke nieuwe bladwijzer de plek van de eerste pagina van dat bestand, in volgorde van het
 * resultaat; met `outlines` de bestaande bladwijzers van dat bestand eronder.
 */
function outlineEntries(
  bookmarks: readonly BookmarkFor[],
  pages: readonly PageItem[],
  outlines?: ReadonlyMap<number, readonly OutlineEntry[]>,
): BookmarkNode[] {
  return bookmarks
    .map((bookmark) => ({
      title: bookmark.title,
      pageIndex: pages.findIndex((page) => page.doc === bookmark.doc),
      children: outlines ? remapOutline(outlines.get(bookmark.doc) ?? [], bookmark.doc, pages) : [],
    }))
    .filter((entry) => entry.pageIndex >= 0)
    .sort((a, b) => a.pageIndex - b.pageIndex);
}

/** De bestaande bladwijzers van alle bestanden achter elkaar, in de volgorde van de bestanden. */
function keptOutlines(
  pages: readonly PageItem[],
  outlines: ReadonlyMap<number, readonly OutlineEntry[]>,
): BookmarkNode[] {
  return docOrder(pages).flatMap((doc) => remapOutline(outlines.get(doc) ?? [], doc, pages));
}

/**
 * Zet de bladwijzers (de "outline" van de PDF) en laat de PDF-lezer ze bij openen tonen.
 * pdf-lib heeft daar geen kant-en-klare functie voor; we bouwen de boom zelf op volgens de
 * PDF-norm: een Outlines-woordenboek met First/Last/Count en per bladwijzer Title, Parent,
 * Prev/Next, een bestemming (de pagina, passend in beeld) en eventueel First/Last/Count voor wat
 * eronder valt. Met `openTop` staat het bovenste niveau in de PDF-lezer opengeklapt (de
 * bladwijzers per bestand); diepere niveaus staan altijd dicht.
 */
function setBookmarks(
  lib: typeof import('pdf-lib'),
  doc: PdfLibDocument,
  entries: readonly BookmarkNode[],
  openTop: boolean,
) {
  const { PDFName, PDFNumber, PDFHexString } = lib;
  const { context, catalog } = doc;
  if (entries.length === 0) {
    // Geen bladwijzers: dan ook de PDF-lezer niet laten openen met een (leeg) bladwijzervenster.
    catalog.delete(PDFName.of('Outlines'));
    if (catalog.lookupMaybe(PDFName.of('PageMode'), PDFName) === PDFName.of('UseOutlines')) {
      catalog.delete(PDFName.of('PageMode'));
    }
    return;
  }
  const pageRefs = doc.getPages().map((page) => page.ref);
  const outlinesRef = context.nextRef();

  /** Schrijft een niveau; geeft de eerste en laatste en hoeveel er zichtbaar zijn. */
  const write = (nodes: readonly BookmarkNode[], parent: typeof outlinesRef, open: boolean) => {
    const refs = nodes.map(() => context.nextRef());
    let visible = nodes.length;
    nodes.forEach((node, i) => {
      const item = context.obj({
        Title: PDFHexString.fromText(node.title),
        Parent: parent,
        Dest: [pageRefs[node.pageIndex]!, 'Fit'],
      });
      if (i > 0) item.set(PDFName.of('Prev'), refs[i - 1]!);
      if (i < refs.length - 1) item.set(PDFName.of('Next'), refs[i + 1]!);
      if (node.children.length > 0) {
        const sub = write(node.children, refs[i]!, false);
        item.set(PDFName.of('First'), sub.first);
        item.set(PDFName.of('Last'), sub.last);
        // Positief: opengeklapt, met zoveel zichtbare eronder; negatief: dichtgeklapt.
        item.set(PDFName.of('Count'), PDFNumber.of(open ? sub.visible : -node.children.length));
        if (open) visible += sub.visible;
      }
      context.assign(refs[i]!, item);
    });
    return { first: refs[0]!, last: refs.at(-1)!, visible };
  };

  const top = write(entries, outlinesRef, openTop);
  context.assign(
    outlinesRef,
    context.obj({ Type: 'Outlines', First: top.first, Last: top.last, Count: top.visible }),
  );
  catalog.set(PDFName.of('Outlines'), outlinesRef);
  catalog.set(PDFName.of('PageMode'), PDFName.of('UseOutlines'));
}

/** Leest de bytes van de bestanden die in het plan voorkomen. */
export async function readSources(
  files: ReadonlyMap<number, File>,
  pages: readonly PageItem[],
): Promise<Map<number, Uint8Array>> {
  const result = new Map<number, Uint8Array>();
  for (const id of new Set(pages.map((page) => page.doc))) {
    const file = files.get(id);
    if (file) result.set(id, new Uint8Array(await file.arrayBuffer()));
  }
  return result;
}

/**
 * Herkent de fout van pdf-lib voor een beveiligde PDF. pdf-lib is gebouwd voor oude
 * browsers, waardoor `instanceof` bij zijn fouttypes niet betrouwbaar werkt; daarom ook
 * op de tekst van de melding.
 */
function isEncryptedError(error: unknown, type: abstract new (...args: never[]) => unknown) {
  return error instanceof type || /\bis encrypted\b/.test(String((error as Error | null)?.message));
}

/** Bestandsnaam voor het resultaat: "rapport.pdf" → "rapport (bewerkt).pdf". */
export function editedFileName(name: string, suffix: string): string {
  const base = name.replace(/\.pdf$/i, '');
  return `${base} (${suffix}).pdf`;
}

/** Biedt een PDF aan als download, zonder iets te versturen. */
export function downloadPdf(bytes: Uint8Array, fileName: string): void {
  downloadFile(bytes, fileName, 'application/pdf');
}

/**
 * Biedt bytes of een kant-en-klare Blob (bijvoorbeeld een ZIP) aan als download, zonder iets te
 * versturen. Een Blob wordt daarbij niet gekopieerd.
 */
export function downloadFile(data: Uint8Array | Blob, fileName: string, type: string): void {
  const blob = new Blob([data as BlobPart], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  link.style.display = 'none';
  document.body.append(link);
  link.click();
  link.remove();
  // Geef de browser even de tijd om de download te starten.
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
