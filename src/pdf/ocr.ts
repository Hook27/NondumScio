import type { OcrEngine } from './redact';

/**
 * Tekstherkenning (OCR) met tesseract.js, alleen in de browser. Werker, herkenner en taaldata
 * staan in /ocr/ (zie scripts/copy-ocr-assets.ts), dus er gaat niets over het netwerk naar een
 * andere server. tesseract.js zelf wordt pas geladen als iemand OCR aanzet.
 */

/** Talen: Nederlands en Engels samen. */
export const OCR_LANGS = ['nld', 'eng'];

/** Waar de OCR-bestanden staan, ten opzichte van de pagina (werkt ook in een submap). */
export function ocrAssetOptions(baseUrl: string) {
  const dir = (name: string) => new URL(`ocr/${name}`, baseUrl).href.replace(/\/$/, '');
  return {
    workerPath: dir('worker.min.js'),
    corePath: dir('core'),
    langPath: dir('lang'),
  };
}

/** Opent de herkenner; `onStatus` meldt wat er geladen wordt (de eerste keer duurt even). */
export async function openOcr(onStatus?: (progress: number) => void): Promise<OcrEngine> {
  const { createWorker } = await import('tesseract.js');
  const worker = await createWorker(OCR_LANGS, 1, {
    ...ocrAssetOptions(document.baseURI),
    logger: (message) => {
      if (/loading|initializing/i.test(message.status)) onStatus?.(message.progress);
    },
  });
  return {
    recognize: async (png, dpi) => {
      await worker.setParameters({ user_defined_dpi: String(dpi) });
      const result = await worker.recognize(
        new Blob([png as BlobPart], { type: 'image/png' }),
        {},
        { blocks: true },
      );
      const words: Awaited<ReturnType<OcrEngine['recognize']>> = [];
      for (const block of result.data.blocks ?? []) {
        for (const paragraph of block.paragraphs) {
          for (const line of paragraph.lines) {
            for (const word of line.words) {
              words.push({
                text: word.text,
                x0: word.bbox.x0,
                y0: word.bbox.y0,
                x1: word.bbox.x1,
                y1: word.bbox.y1,
              });
            }
          }
        }
      }
      return words;
    },
    close: () => void worker.terminate(),
  };
}
