import { outputScale } from './images';
import { closePdf, loadPdf } from './loader';
import { squash } from './ocrText';
import { paintRedactions, redactionRects } from './paint';
import { RedactionError, type RasterSession, type TextCheck } from './redact';

/**
 * Het tekenen van pagina's voor redactie, met pdf.js en een canvas (alleen in de browser). Staat
 * apart van `redact.ts`, zodat die zonder browser te testen is.
 */

/** Opent het bestand om pagina's als afbeelding te maken, met de vakken er zwart in. */
export async function openRaster(bytes: Uint8Array): Promise<RasterSession> {
  // pdf.js neemt de bytes over en maakt ze onbruikbaar: geef een kopie.
  const { pdf } = await loadPdf(bytes.slice());
  return {
    close: () => closePdf(pdf),
    render: async ({ pageIndex, extra, boxes, dpi }) => {
      const page = await pdf.getPage(pageIndex + 1);
      try {
        // De pagina zoals hij nu in het bestand staat (met de extra draaiing al erin) ...
        const natural = page.getViewport({ scale: 1 });
        // ... en de basisstand waarin de vakken zijn getekend: zonder die extra draaiing.
        const baseRotation = (((page.rotate - extra) % 360) + 360) % 360;
        const baseView = page.getViewport({ scale: 1, rotation: baseRotation });
        const base = { width: baseView.width, height: baseView.height };

        const { scale, reduced } = outputScale(natural.width, natural.height, dpi);
        const viewport = page.getViewport({ scale });
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(viewport.width));
        canvas.height = Math.max(1, Math.round(viewport.height));
        await page.render({ canvas, viewport, background: '#ffffff' }).promise;

        paintRedactions(canvas.getContext('2d')!, boxes, base, extra, scale);
        const blackouts = redactionRects(boxes, base, extra, scale);
        const pixelWidth = canvas.width;
        const pixelHeight = canvas.height;

        const blob = await new Promise<Blob | null>((resolve) =>
          canvas.toBlob(resolve, 'image/png'),
        );
        // Het canvas kan flink wat geheugen vasthouden: meteen vrijgeven.
        canvas.width = 0;
        canvas.height = 0;
        if (!blob) throw new Error('De afbeelding kon niet worden gemaakt');
        return {
          png: new Uint8Array(await blob.arrayBuffer()),
          width: natural.width,
          height: natural.height,
          pixelWidth,
          pixelHeight,
          blackouts,
          reduced,
        };
      } finally {
        page.cleanup();
      }
    },
  };
}

/** Controleert met pdf.js dat de pagina's (plekken vanaf 0) geen enkel stukje tekst meer hebben. */
export async function verifyNoText(bytes: Uint8Array, pageIndexes: readonly number[]) {
  const { pdf } = await loadPdf(bytes.slice());
  try {
    for (const index of pageIndexes) {
      const page = await pdf.getPage(index + 1);
      const content = await page.getTextContent();
      page.cleanup();
      if (content.items.length > 0) throw new RedactionError('verify');
    }
  } finally {
    closePdf(pdf);
  }
}

/**
 * Controleert met pdf.js de pagina's met herkende tekst: er staat precies de herkende tekst op en
 * geen enkel stukje ervan ligt in een zwart vak.
 */
export async function verifyText(bytes: Uint8Array, checks: readonly TextCheck[]) {
  const { pdf } = await loadPdf(bytes.slice());
  try {
    for (const check of checks) {
      const page = await pdf.getPage(check.pageIndex + 1);
      const height = page.getViewport({ scale: 1 }).height;
      const content = await page.getTextContent();
      page.cleanup();
      const items = content.items.filter((item) => 'str' in item);
      if (squash(items.map((item) => item.str).join('')) !== check.text) {
        throw new RedactionError('verify');
      }
      for (const item of items) {
        if (item.str.trim() === '') continue;
        const x = item.transform[4]! + item.width / 2;
        const y = height - (item.transform[5]! + item.height / 2);
        if (check.forbidden.some((r) => x >= r.x0 && x <= r.x1 && y >= r.y0 && y <= r.y1)) {
          throw new RedactionError('verify');
        }
      }
    }
  } finally {
    closePdf(pdf);
  }
}
