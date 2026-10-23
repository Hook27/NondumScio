import type { PDFDocument as PdfLibDocument } from 'pdf-lib';
import type { PageItem } from '../pages/plan';

export type SaveErrorCode = 'encrypted' | 'failed';

export class PdfSaveError extends Error {
  constructor(readonly code: SaveErrorCode) {
    super(`PDF kon niet worden opgeslagen: ${code}`);
    this.name = 'PdfSaveError';
  }
}

/**
 * Maakt een nieuwe PDF volgens het pagina-plan: de gekozen pagina's, in de gekozen
 * volgorde, met de extra draaiing. Werkt op een kopie van het origineel in het geheugen;
 * het bestand op je apparaat blijft onaangeroerd.
 *
 * We passen het originele document aan in plaats van pagina's naar een leeg document te
 * kopiëren. Zo blijven de gegevens van het document (titel, auteur, formulieren,
 * bladwijzers) zoveel mogelijk behouden. Een bladwijzer naar een verwijderde pagina
 * wijst daarna nergens meer heen.
 */
export async function buildPdf(
  original: Uint8Array,
  pages: readonly PageItem[],
): Promise<Uint8Array> {
  if (pages.length === 0) throw new PdfSaveError('failed');
  const { PDFDocument, EncryptedPDFError, degrees } = await import('pdf-lib');

  let doc: PdfLibDocument;
  try {
    doc = await PDFDocument.load(original, { updateMetadata: false });
  } catch (error) {
    throw new PdfSaveError(isEncryptedError(error, EncryptedPDFError) ? 'encrypted' : 'failed');
  }

  try {
    const sourcePages = doc.getPages();
    for (const item of pages) {
      if (!sourcePages[item.source]) throw new RangeError(`Pagina ${item.source} bestaat niet`);
    }
    // Alle pagina's uit de paginaboom halen en in de nieuwe volgorde terugzetten.
    for (let i = sourcePages.length - 1; i >= 0; i -= 1) doc.removePage(i);
    for (const item of pages) {
      const page = sourcePages[item.source]!;
      const angle = (((page.getRotation().angle + item.rotation) % 360) + 360) % 360;
      page.setRotation(degrees(angle));
      doc.addPage(page);
    }
    return await doc.save();
  } catch {
    throw new PdfSaveError('failed');
  }
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
