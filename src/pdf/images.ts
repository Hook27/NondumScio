import type { PDFDocumentProxy } from 'pdfjs-dist';

export type ImageType = 'jpeg' | 'png';

/** Een afbeelding die in een PDF moet: de bytes van het bestand en wat het voor soort is. */
export type ImageInput = { bytes: Uint8Array; type: ImageType };

export type PageSizeChoice = 'fit' | 'a4' | 'letter';
export type MarginChoice = 'none' | 'small' | 'normal';

/** Het ene afbeeldingsbestand dat niet in de PDF kon (de plek in de lijst, vanaf 0). */
export class ImageConvertError extends Error {
  constructor(readonly index: number) {
    super(`Afbeelding ${index + 1} kon niet in de PDF worden gezet`);
    this.name = 'ImageConvertError';
  }
}

const POINTS_PER_MM = 72 / 25.4;

/** De marge rondom de afbeelding, in PDF-punten (1 punt = 1/72 inch). */
export const MARGINS: Record<MarginChoice, number> = {
  none: 0,
  small: 5 * POINTS_PER_MM,
  normal: 10 * POINTS_PER_MM,
};

/** Staande paginaformaten in punten. */
const PAGE_SIZES = {
  a4: { width: 595.28, height: 841.89 },
  letter: { width: 612, height: 792 },
} as const;

/** "Passend": de langste kant van de afbeelding wordt zo lang als een A4-pagina. */
const FIT_LONG_SIDE = PAGE_SIZES.a4.height;

/** Herkent JPEG en PNG aan het begin van het bestand, niet aan de naam. */
export function detectImageType(bytes: Uint8Array): ImageType | null {
  const png = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (png.every((byte, i) => bytes[i] === byte)) return 'png';
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'jpeg';
  return null;
}

/** Hoe een foto gedraaid moet worden om rechtop te staan (EXIF), in de vier gewone standen. */
export type Turn = 1 | 3 | 6 | 8;

/**
 * Leest de EXIF-draaiing van een JPEG. Telefoons slaan een foto vaak liggend op en
 * zetten in het bestand hoe hij gedraaid moet worden; zonder dit staat zo'n foto in de
 * PDF op zijn kant. 1 = rechtop, 3 = 180°, 6 = 90° rechtsom, 8 = 90° linksom. Gespiegelde
 * standen komen nauwelijks voor en tellen als rechtop. Klopt er iets niet, dan: rechtop.
 */
export function jpegOrientation(bytes: Uint8Array): Turn {
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) return 1;
  let i = 2;
  while (i + 4 <= bytes.length) {
    if (bytes[i] !== 0xff) return 1;
    const marker = bytes[i + 1]!;
    if (marker === 0xff) {
      i += 1;
      continue;
    }
    // Begin van de beeldgegevens of einde: daarna komt geen EXIF meer.
    if (marker === 0xda || marker === 0xd9) return 1;
    const length = (bytes[i + 2]! << 8) | bytes[i + 3]!;
    const isExif =
      marker === 0xe1 &&
      length >= 16 &&
      [0x45, 0x78, 0x69, 0x66, 0, 0].every((byte, k) => bytes[i + 4 + k] === byte);
    if (isExif) return exifTurn(bytes, i + 10, i + 2 + length);
    i += 2 + length;
  }
  return 1;
}

/** Zoekt de draaiing (tag 0x0112) in het TIFF-deel van een EXIF-blok. */
function exifTurn(bytes: Uint8Array, tiff: number, end: number): Turn {
  const little = bytes[tiff] === 0x49;
  const read16 = (at: number) =>
    at + 2 > end
      ? 0
      : little
        ? bytes[at]! | (bytes[at + 1]! << 8)
        : (bytes[at]! << 8) | bytes[at + 1]!;
  const read32 = (at: number) =>
    little ? read16(at) | (read16(at + 2) << 16) : (read16(at) << 16) | read16(at + 2);
  if (read16(tiff + 2) !== 42) return 1;
  const ifd = tiff + read32(tiff + 4);
  const count = read16(ifd);
  for (let n = 0; n < count && n < 100; n += 1) {
    const entry = ifd + 2 + n * 12;
    if (read16(entry) !== 0x0112) continue;
    const value = read16(entry + 8);
    return value === 3 || value === 6 || value === 8 ? value : 1;
  }
  return 1;
}

export type ImageLayout = {
  page: { width: number; height: number };
  /** Waar en hoe de afbeelding getekend wordt (links onder, in punten; hoek in graden linksom). */
  x: number;
  y: number;
  width: number;
  height: number;
  angle: number;
};

/**
 * Rekent uit hoe een afbeelding op zijn pagina komt:
 * - `fit`: de pagina krijgt de verhouding van de afbeelding (rechtop gezien), plus marge;
 * - `a4` / `letter`: een vaste pagina, staand of liggend naar de afbeelding, met de
 *   afbeelding binnen de marge, zo groot mogelijk en in het midden.
 * `width` en `height` zijn de afmetingen zoals opgeslagen in het bestand; `turn` is de
 * draaiing die nodig is om hem rechtop te zetten.
 */
export function layoutImage(
  width: number,
  height: number,
  turn: Turn,
  pageSize: PageSizeChoice,
  margin: number,
): ImageLayout {
  const sideways = turn === 6 || turn === 8;
  // De afmetingen zoals je de afbeelding straks ziet.
  const shownW = sideways ? height : width;
  const shownH = sideways ? width : height;

  let page: { width: number; height: number };
  let scale: number;
  if (pageSize === 'fit') {
    scale = FIT_LONG_SIDE / Math.max(shownW, shownH);
    page = { width: shownW * scale + 2 * margin, height: shownH * scale + 2 * margin };
  } else {
    const base = PAGE_SIZES[pageSize];
    page = shownW > shownH ? { width: base.height, height: base.width } : { ...base };
    scale = Math.min((page.width - 2 * margin) / shownW, (page.height - 2 * margin) / shownH);
  }
  const fitW = shownW * scale;
  const fitH = shownH * scale;
  const left = (page.width - fitW) / 2;
  const bottom = (page.height - fitH) / 2;

  // pdf-lib draait om de linkeronderhoek van de afbeelding; daarom schuift het beginpunt mee.
  const drawn = { width: width * scale, height: height * scale };
  if (turn === 6) return { page, x: left, y: bottom + fitH, ...drawn, angle: -90 };
  if (turn === 8) return { page, x: left + fitW, y: bottom, ...drawn, angle: 90 };
  if (turn === 3) return { page, x: left + fitW, y: bottom + fitH, ...drawn, angle: 180 };
  return { page, x: left, y: bottom, ...drawn, angle: 0 };
}

/**
 * Maakt één PDF van afbeeldingen, een pagina per afbeelding in de gegeven volgorde. De
 * afbeelding zelf gaat ongewijzigd in de PDF (geen extra kwaliteitsverlies); alleen de
 * pagina eromheen wordt gemaakt. Lukt een afbeelding niet, dan weet de fout welke.
 */
export async function imagesToPdf(
  images: readonly ImageInput[],
  { pageSize, margin }: { pageSize: PageSizeChoice; margin: MarginChoice },
): Promise<Uint8Array> {
  if (images.length === 0) throw new ImageConvertError(0);
  const lib = await import('pdf-lib');
  const doc = await lib.PDFDocument.create();
  for (const [index, image] of images.entries()) {
    try {
      const embedded =
        image.type === 'jpeg' ? await doc.embedJpg(image.bytes) : await doc.embedPng(image.bytes);
      const turn = image.type === 'jpeg' ? jpegOrientation(image.bytes) : 1;
      const layout = layoutImage(embedded.width, embedded.height, turn, pageSize, MARGINS[margin]);
      const page = doc.addPage([layout.page.width, layout.page.height]);
      page.drawImage(embedded, {
        x: layout.x,
        y: layout.y,
        width: layout.width,
        height: layout.height,
        rotate: lib.degrees(layout.angle),
      });
    } catch {
      throw new ImageConvertError(index);
    }
  }
  return doc.save();
}

export type ImageFormat = 'png' | 'jpeg';

/**
 * Het grootste aantal beeldpunten van één afbeelding. Telefoons (vooral iPhones) kunnen
 * geen groter canvas aan; een pagina van een tekening op A0 zou daar anders mislukken.
 */
export const MAX_PIXELS = 16_000_000;

/** Op welke schaal een pagina getekend wordt voor een gewenste resolutie, begrensd. */
export function outputScale(width: number, height: number, dpi: number) {
  const wanted = dpi / 72;
  const pixels = width * wanted * (height * wanted);
  const scale = pixels > MAX_PIXELS ? wanted * Math.sqrt(MAX_PIXELS / pixels) : wanted;
  return { scale, reduced: scale < wanted };
}

/**
 * Tekent één pagina van een PDF op de gewenste resolutie en geeft de bytes van een PNG of
 * JPEG. Op een witte achtergrond, zoals papier. `rotation` is de extra draaiing uit het
 * pagina-plan.
 */
export async function renderPageImage(
  pdf: PDFDocumentProxy,
  pageNumber: number,
  rotation: number,
  { dpi, format, quality }: { dpi: number; format: ImageFormat; quality: number },
): Promise<{ bytes: Uint8Array; reduced: boolean }> {
  const page = await pdf.getPage(pageNumber);
  try {
    const angle = (((page.rotate + rotation) % 360) + 360) % 360;
    const natural = page.getViewport({ scale: 1, rotation: angle });
    const { scale, reduced } = outputScale(natural.width, natural.height, dpi);
    const viewport = page.getViewport({ scale, rotation: angle });
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(viewport.width));
    canvas.height = Math.max(1, Math.round(viewport.height));
    await page.render({ canvas, viewport, background: '#ffffff' }).promise;
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, format === 'png' ? 'image/png' : 'image/jpeg', quality),
    );
    // Het canvas kan flink wat geheugen vasthouden: meteen vrijgeven.
    canvas.width = 0;
    canvas.height = 0;
    if (!blob) throw new Error('De afbeelding kon niet worden gemaakt');
    return { bytes: new Uint8Array(await blob.arrayBuffer()), reduced };
  } finally {
    page.cleanup();
  }
}
