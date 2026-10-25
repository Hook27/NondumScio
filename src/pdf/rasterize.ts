import { outputScale } from './images';
import { closePdf, loadPdf } from './loader';
import { paintRedactions } from './paint';
import { RedactionError, type RasterSession } from './redact';

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
