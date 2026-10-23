import { readFileSync } from 'node:fs';
import {
  PDFDocument,
  StandardFonts,
  concatTransformationMatrix,
  drawObject,
  popGraphicsState,
  pushGraphicsState,
  rgb,
} from 'pdf-lib';

const A4 = { width: 595, height: 842 };

/**
 * Maakt een test-PDF met genummerde pagina's. Elke pagina heeft een gekleurd vlak en
 * een groot nummer, zodat een miniatuur zichtbaar niet leeg is. `landscape` geeft de
 * paginanummers die liggend moeten zijn.
 */
export async function makePdf(pageCount: number, landscape: number[] = []): Promise<Buffer> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.HelveticaBold);

  for (let n = 1; n <= pageCount; n += 1) {
    const size = landscape.includes(n) ? { width: A4.height, height: A4.width } : A4;
    const page = doc.addPage([size.width, size.height]);
    page.drawRectangle({
      x: 40,
      y: 40,
      width: size.width - 80,
      height: size.height - 80,
      color: rgb(0.85, 0.9, 1),
      borderColor: rgb(0.2, 0.3, 0.7),
      borderWidth: 6,
    });
    page.drawText(String(n), {
      x: 80,
      y: size.height / 2,
      size: 160,
      font,
      color: rgb(0.1, 0.1, 0.2),
    });
  }
  doc.setTitle('Testdocument');
  return Buffer.from(await doc.save());
}

export const pdfFile = async (name: string, pageCount: number, landscape: number[] = []) => ({
  name,
  mimeType: 'application/pdf',
  buffer: await makePdf(pageCount, landscape),
});

/**
 * Een "gescande" pagina: de inhoud is één afbeelding in JPEG 2000 (scan.jp2: wit papier
 * met drie zwarte balken links), zoals bij veel scans. pdf.js heeft daar een apart
 * decodeerprogramma (WebAssembly) voor nodig; zonder dat blijft de miniatuur wit.
 * Een JBIG2-scan gebruikt hetzelfde mechanisme.
 */
export async function makeScanPdf(): Promise<Buffer> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([A4.width, A4.height]);
  const image = doc.context.register(
    doc.context.stream(readFileSync(new URL('./fixtures/scan.jp2', import.meta.url)), {
      Type: 'XObject',
      Subtype: 'Image',
      Width: 400,
      Height: 566,
      Filter: 'JPXDecode',
    }),
  );
  const name = page.node.newXObject('Scan', image);
  page.pushOperators(
    pushGraphicsState(),
    concatTransformationMatrix(A4.width, 0, 0, A4.height, 0, 0),
    drawObject(name),
    popGraphicsState(),
  );
  return Buffer.from(await doc.save());
}
