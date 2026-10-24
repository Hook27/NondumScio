import type { PDFDocument as PdfLibDocument } from 'pdf-lib';
import type { PageItem } from '../pages/plan';

export type SaveErrorCode = 'encrypted' | 'failed';

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
};

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
 *   bladwijzers vervallen, want die zouden in het samengevoegde document toch niet kloppen.
 * - Met `bookmarks`: nieuwe bladwijzers (bijvoorbeeld één per samengevoegd bestand).
 */
export async function buildPdf(
  sources: SourceBytes,
  pages: readonly PageItem[],
  { bookmarks }: BuildOptions = {},
): Promise<Uint8Array> {
  if (pages.length === 0) throw new PdfSaveError('failed');
  const lib = await import('pdf-lib');
  const { PDFDocument, EncryptedPDFError, degrees } = lib;

  // Elk gebruikt bestand één keer inlezen.
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

  const rotated = (angle: number, extra: number) => degrees((((angle + extra) % 360) + 360) % 360);

  try {
    for (const item of pages) {
      if (!docs.get(item.doc)!.getPages()[item.source]) {
        throw new RangeError(`Pagina ${item.source} bestaat niet`);
      }
    }

    if (docs.size === 1) {
      const doc = docs.values().next().value!;
      const sourcePages = doc.getPages();
      // Alle pagina's uit de paginaboom halen en in de nieuwe volgorde terugzetten.
      for (let i = sourcePages.length - 1; i >= 0; i -= 1) doc.removePage(i);
      for (const item of pages) {
        const page = sourcePages[item.source]!;
        page.setRotation(rotated(page.getRotation().angle, item.rotation));
        doc.addPage(page);
      }
      if (bookmarks) setBookmarks(lib, doc, outlineEntries(bookmarks, pages));
      return await doc.save();
    }

    const out = await PDFDocument.create();
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
      const copied = await out.copyPages(doc, indices);
      indices.forEach((index, i) => copies.set(`${id}:${index}`, copied[i]!));
    }
    for (const item of pages) {
      const page = copies.get(`${item.doc}:${item.source}`)!;
      page.setRotation(rotated(page.getRotation().angle, item.rotation));
      out.addPage(page);
    }
    if (bookmarks) setBookmarks(lib, out, outlineEntries(bookmarks, pages));
    return await out.save();
  } catch {
    throw new PdfSaveError('failed');
  }
}

/** Bij elke bladwijzer de plek van de eerste pagina van dat bestand, in volgorde van het resultaat. */
function outlineEntries(bookmarks: readonly BookmarkFor[], pages: readonly PageItem[]) {
  return bookmarks
    .map((bookmark) => ({
      title: bookmark.title,
      pageIndex: pages.findIndex((page) => page.doc === bookmark.doc),
    }))
    .filter((entry) => entry.pageIndex >= 0)
    .sort((a, b) => a.pageIndex - b.pageIndex);
}

/**
 * Zet de bladwijzers (de "outline" van de PDF) en laat de PDF-lezer ze bij openen tonen.
 * pdf-lib heeft daar geen kant-en-klare functie voor; we bouwen de lijst zelf op volgens de
 * PDF-norm: een Outlines-woordenboek met First/Last/Count en per bladwijzer Title, Parent,
 * Prev/Next en een bestemming (de pagina, passend in beeld).
 */
function setBookmarks(
  lib: typeof import('pdf-lib'),
  doc: PdfLibDocument,
  entries: readonly { title: string; pageIndex: number }[],
) {
  const { PDFName, PDFHexString } = lib;
  const { context, catalog } = doc;
  if (entries.length === 0) {
    catalog.delete(PDFName.of('Outlines'));
    return;
  }
  const pageRefs = doc.getPages().map((page) => page.ref);
  const outlinesRef = context.nextRef();
  const refs = entries.map(() => context.nextRef());
  entries.forEach((entry, i) => {
    const item = context.obj({
      Title: PDFHexString.fromText(entry.title),
      Parent: outlinesRef,
      Dest: [pageRefs[entry.pageIndex]!, 'Fit'],
    });
    if (i > 0) item.set(PDFName.of('Prev'), refs[i - 1]!);
    if (i < refs.length - 1) item.set(PDFName.of('Next'), refs[i + 1]!);
    context.assign(refs[i]!, item);
  });
  context.assign(
    outlinesRef,
    context.obj({ Type: 'Outlines', First: refs[0]!, Last: refs.at(-1)!, Count: refs.length }),
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

/** Biedt bytes aan als download, zonder iets te versturen. */
export function downloadPdf(bytes: Uint8Array, fileName: string): void {
  const blob = new Blob([bytes as BlobPart], { type: 'application/pdf' });
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
