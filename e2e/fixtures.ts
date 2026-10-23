import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

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
