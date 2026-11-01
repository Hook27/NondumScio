import type { PDFDocumentProxy } from 'pdfjs-dist';
import { closePdf, loadPdf } from '../pdf/loader';

/**
 * Het beeld van twee pagina's vergelijken: tekenen met pdf.js en de pixels naast elkaar leggen
 * (verschil, naast elkaar of overlay). Overgenomen uit de losse pdf-vergelijker; de rekenregels
 * staan hier los van het scherm, zodat ze te testen zijn.
 */

/** De zoomstappen, in procenten van "passend in het vak". */
export const ZOOM_STEPS = [50, 75, 100, 125, 150, 200, 300, 400] as const;

/** De breedste pagina die we tekenen (in beeldpunten), ook bij inzoomen. */
export const MAX_CANVAS_W = 3200;

/** Ruimte tussen de twee pagina's naast elkaar (in CSS-pixels). */
export const SIDE_GAP = 16;

/** De volgende zoomstap (`dir` 1 of −1); buiten de stappen terug naar passend. */
export function stepZoom(zoom: number, dir: 1 | -1): number {
  const i = (ZOOM_STEPS as readonly number[]).indexOf(zoom);
  if (i === -1) return 100;
  return ZOOM_STEPS[Math.max(0, Math.min(ZOOM_STEPS.length - 1, i + dir))]!;
}

/** De breedte van één pagina als hij precies in het vak past; naast elkaar de helft. */
export function fitWidth(available: number, side: boolean): number {
  const avail = Math.max(280, available);
  return side ? Math.floor((avail - SIDE_GAP) / 2) : avail;
}

/**
 * De weergavebreedte (`css`) en de werkelijke tekenbreedte (`dev`). Op een scherm met hoge
 * pixeldichtheid tekenen we fijner dan we tonen (hooguit 2×), anders is de tekst zacht.
 */
export function targetWidths(fit: number, zoom: number, devicePixelRatio: number) {
  const css = Math.max(120, Math.round((fit * zoom) / 100));
  const dpr = Math.min(2, devicePixelRatio || 1);
  const dev = Math.min(MAX_CANVAS_W, Math.round(css * dpr));
  return { css, dev, ratio: dev / css };
}

/**
 * Pixelverschil op helderheid: rood = inkt die alleen in A staat, groen = alleen in B, grijs =
 * gelijk (hoe donkerder de inkt, hoe lichter het grijs), op een donkere achtergrond zodat de
 * verschillen opvallen. `threshold` is het verschil in helderheid dat nog als gelijk telt.
 */
export function pixelDiff(
  a: Uint8ClampedArray,
  b: Uint8ClampedArray,
  threshold: number,
): { data: Uint8ClampedArray<ArrayBuffer>; diff: number; ink: number } {
  const data = new Uint8ClampedArray(a.length);
  let diff = 0;
  let ink = 0;
  for (let i = 0; i < data.length; i += 4) {
    const la = a[i]! * 0.299 + a[i + 1]! * 0.587 + a[i + 2]! * 0.114;
    const lb = b[i]! * 0.299 + b[i + 1]! * 0.587 + b[i + 2]! * 0.114;
    const d = la - lb;
    const inkLevel = 255 - Math.min(la, lb);
    if (inkLevel > 24) ink++;
    if (Math.abs(d) <= threshold) {
      const g = 18 + (inkLevel / 255) * 88;
      data[i] = g;
      data[i + 1] = g;
      data[i + 2] = g + 14;
    } else {
      diff++;
      const s = Math.min(1, Math.abs(d) / 140);
      if (d < 0) {
        data[i] = 150 + s * 105;
        data[i + 1] = 60 - s * 30;
        data[i + 2] = 60 - s * 30;
      } else {
        data[i] = 50 - s * 25;
        data[i + 1] = 150 + s * 105;
        data[i + 2] = 90 - s * 30;
      }
    }
    data[i + 3] = 255;
  }
  return { data, diff, ink };
}

/*
 * De geopende PDF's voor het beeld, per bestand: openen kost tijd, en bij bladeren of zoomen is
 * het steeds hetzelfde bestand. Wordt een document weggehaald, dan gaat zijn PDF dicht.
 */
const open = new Map<File, Promise<PDFDocumentProxy>>();

function pdfFor(file: File): Promise<PDFDocumentProxy> {
  let pdf = open.get(file);
  if (!pdf) {
    pdf = file.arrayBuffer().then(async (buffer) => (await loadPdf(new Uint8Array(buffer))).pdf);
    open.set(file, pdf);
    // Mislukt het, dan de volgende keer opnieuw proberen.
    pdf.catch(() => open.delete(file));
  }
  return pdf;
}

/** De PDF van een bestand sluiten, als hij voor het beeld open was. */
export function closeVisual(file: File): void {
  const pdf = open.get(file);
  if (!pdf) return;
  open.delete(file);
  pdf.then(closePdf, () => undefined);
}

/** Tekent een pagina op een witte achtergrond, `width` beeldpunten breed; null als hij niet bestaat. */
export async function renderPage(
  file: File,
  pageNumber: number,
  width: number,
): Promise<HTMLCanvasElement | null> {
  const pdf = await pdfFor(file);
  if (pageNumber < 1 || pageNumber > pdf.numPages) return null;
  const page = await pdf.getPage(pageNumber);
  try {
    const base = page.getViewport({ scale: 1 });
    const viewport = page.getViewport({ scale: width / base.width });
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(viewport.width));
    canvas.height = Math.max(1, Math.round(viewport.height));
    await page.render({ canvas, viewport, background: '#ffffff' }).promise;
    return canvas;
  } finally {
    page.cleanup();
  }
}

/** Een wit canvas van `width` × `height` met `source` linksboven erop. */
function padTo(source: HTMLCanvasElement, width: number, height: number) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, width, height);
  ctx.drawImage(source, 0, 0);
  return ctx.getImageData(0, 0, width, height).data;
}

/** Het pixelverschil van twee getekende pagina's, met de tellingen. */
export function composeDiff(a: HTMLCanvasElement, b: HTMLCanvasElement, threshold: number) {
  const width = Math.max(a.width, b.width);
  const height = Math.max(a.height, b.height);
  const { data, diff, ink } = pixelDiff(
    padTo(a, width, height),
    padTo(b, width, height),
    threshold,
  );
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  canvas.getContext('2d')!.putImageData(new ImageData(data, width, height), 0, 0);
  return { canvas, diff, ink, total: width * height };
}

/** B half doorzichtig (`alpha`) over A. */
export function composeOverlay(a: HTMLCanvasElement, b: HTMLCanvasElement, alpha: number) {
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(a.width, b.width);
  canvas.height = Math.max(a.height, b.height);
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(a, 0, 0);
  ctx.globalAlpha = alpha;
  ctx.drawImage(b, 0, 0);
  return canvas;
}
