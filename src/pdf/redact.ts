import type { PDFDocument } from 'pdf-lib';
import {
  annotationsOf,
  redactionsOf,
  type Annotation,
  type BoxAnnotation,
} from '../annotations/model';
import type { PageItem, Rotation } from '../pages/plan';
import { DEFAULT_REDACTION, DPI_CHOICES, type RedactionOptions } from './redactOptions';

/**
 * Redigeren: echt weglakken. Een zwart vak over tekst laat de tekst gewoon in het bestand
 * staan. Daarom wordt elke pagina met een redactievak een afbeelding, met het vak er zwart in:
 * er is dan op die pagina geen tekst, lettertype of verborgen laag meer om terug te halen. Het
 * resultaat is een nieuw bestand dat alleen uit de pagina's wordt opgebouwd; de oorspronkelijke
 * pagina's, bladwijzers, formulieren, bijlagen en eerdere versies komen er dus niet in mee.
 */

export { DEFAULT_REDACTION, DPI_CHOICES, type RedactionOptions };

/** Redigeren mislukte of kon niet worden gecontroleerd: er wordt dan niets gedownload. */
export class RedactionError extends Error {
  constructor(readonly code: 'raster' | 'verify') {
    super(`Redigeren mislukt: ${code}`);
    this.name = 'RedactionError';
  }
}

/** Eén pagina als afbeelding: de PNG, de afmetingen in punten, en of hij kleiner moest dan gevraagd. */
export type RasterPage = { png: Uint8Array; width: number; height: number; reduced: boolean };

/** Een geopend bestand waarvan pagina's als afbeelding (met de zwarte vakken) gemaakt worden. */
export type RasterSession = {
  render: (request: {
    pageIndex: number;
    /** De extra draaiing uit het pagina-plan, waarin de vakken (in basisstand) omgerekend worden. */
    extra: Rotation;
    boxes: BoxAnnotation[];
    dpi: number;
  }) => Promise<RasterPage>;
  close: () => void;
};

export type RedactionDeps = {
  /** Opent het bestand om te tekenen; standaard met pdf.js en een canvas (zie `rasterize.ts`). */
  openRaster?: (bytes: Uint8Array) => Promise<RasterSession>;
  /** Controleert het resultaat; standaard met pdf.js. Gooit een fout als er toch tekst staat. */
  verify?: (bytes: Uint8Array, pageIndexes: number[]) => Promise<void>;
};

export type RedactionReport = {
  /** De plekken (vanaf 0) van de pagina's die afbeelding zijn geworden. */
  pages: number[];
  reduced: boolean;
};

/**
 * Maakt van een klaar bestand (het resultaat van het pagina-plan) een bestand waarin de pagina's
 * met redactievakken afbeeldingen zijn. `pages` is het plan waarmee `bytes` is gebouwd, zodat
 * de vakken bij de goede pagina horen. Zonder redactievakken verandert er niets.
 */
export async function redactPdf(
  bytes: Uint8Array,
  pages: readonly PageItem[],
  annotations: readonly Annotation[],
  options: RedactionOptions,
  onProgress?: (done: number, total: number) => void,
  deps: RedactionDeps = {},
  /**
   * Ook als er op deze pagina's geen vakken zijn, een nieuw bestand zonder documentgegevens
   * maken (bij splitsen: een deel zonder vak hoort bij een document waarin wel geredigeerd is).
   */
  copyAll = false,
): Promise<{ bytes: Uint8Array; report: RedactionReport }> {
  const boxesPerPage = pages.map((page) => redactionsOf(annotationsOf(annotations, page.key)));
  const affected = boxesPerPage.flatMap((boxes, index) => (boxes.length > 0 ? [index] : []));
  const stripOnly = affected.length === 0 && copyAll && options.stripMetadata;
  if (affected.length === 0 && !stripOnly) {
    return { bytes, report: { pages: [], reduced: false } };
  }

  const lib = await import('pdf-lib');
  const source = await lib.PDFDocument.load(bytes, { updateMetadata: false });
  if (source.getPageCount() !== pages.length) throw new RedactionError('raster');
  const out = await lib.PDFDocument.create();
  if (!options.stripMetadata) copyInfo(source, out);

  // Zonder vakken is er niets te tekenen: dan alleen kopiëren.
  const openRaster =
    affected.length === 0
      ? async (): Promise<RasterSession> => ({
          render: () => Promise.reject(new Error('Niets te tekenen')),
          close() {},
        })
      : (deps.openRaster ?? (await import('./rasterize')).openRaster);
  const session = await openRaster(bytes);
  let reduced = false;
  let done = 0;
  try {
    // Pagina's zonder vak in één keer kopiëren (gedeelde lettertypen en afbeeldingen blijven
    // dan gedeeld); een pagina met vak wordt een afbeelding.
    let run: number[] = [];
    const flush = async () => {
      if (run.length === 0) return;
      for (const page of await out.copyPages(source, run)) out.addPage(page);
      done += run.length;
      onProgress?.(done, pages.length);
      run = [];
    };
    for (let index = 0; index < pages.length; index += 1) {
      const boxes = boxesPerPage[index]!;
      if (boxes.length === 0) {
        run.push(index);
        continue;
      }
      await flush();
      let raster: RasterPage;
      try {
        raster = await session.render({
          pageIndex: index,
          extra: pages[index]!.rotation,
          boxes,
          dpi: options.dpi,
        });
      } catch {
        throw new RedactionError('raster');
      }
      reduced ||= raster.reduced;
      const image = await out.embedPng(raster.png);
      const page = out.addPage([raster.width, raster.height]);
      page.drawImage(image, { x: 0, y: 0, width: raster.width, height: raster.height });
      done += 1;
      onProgress?.(done, pages.length);
      // Tussen de pagina's krijgt de browser even lucht, zodat de pagina blijft reageren.
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    await flush();
  } finally {
    session.close();
  }

  const result = await out.save();
  // Eerst de eigen controle op de opbouw, dan (met pdf.js) of er echt geen tekst meer staat.
  await assertImageOnly(result, affected);
  if (deps.verify) await deps.verify(result, affected);
  else await (await import('./rasterize')).verifyNoText(result, affected);
  return { bytes: result, report: { pages: affected, reduced } };
}

/** Titel, auteur en dergelijke overnemen als de gebruiker daarvoor kiest. */
function copyInfo(source: PDFDocument, out: PDFDocument) {
  const title = source.getTitle();
  const author = source.getAuthor();
  const subject = source.getSubject();
  const keywords = source.getKeywords();
  if (title) out.setTitle(title);
  if (author) out.setAuthor(author);
  if (subject) out.setSubject(subject);
  if (keywords) out.setKeywords(keywords.split(/\s+/).filter(Boolean));
}

/**
 * Controleert in het opgeslagen bestand zelf dat de pagina's met redactie niets bevatten dan één
 * afbeelding: geen lettertypen, geen tekstopdrachten, geen aantekeningen of koppelingen, en geen
 * miniatuur of andere extra's in de pagina. Gooit een fout als er iets anders staat.
 */
export async function assertImageOnly(bytes: Uint8Array, pageIndexes: readonly number[]) {
  const { PDFArray, PDFDict, PDFDocument, PDFName, PDFRawStream, decodePDFRawStream } =
    await import('pdf-lib');
  const doc = await PDFDocument.load(bytes, { updateMetadata: false });
  // pdf-lib zet in elke nieuwe pagina ook lege lijsten voor aantekeningen, lettertypen en dergelijke.
  const allowed = new Set(['Type', 'Parent', 'MediaBox', 'Resources', 'Contents', 'Annots']);
  const emptyOnly = new Set(['Font', 'ExtGState', 'ProcSet', 'Annots']);
  const isEmpty = (value: unknown) =>
    value === undefined ||
    (value instanceof PDFArray && value.size() === 0) ||
    (value instanceof PDFDict && value.keys().length === 0);
  for (const index of pageIndexes) {
    const page = doc.getPage(index);
    for (const key of page.node.keys()) {
      const name = key.decodeText();
      if (!allowed.has(name)) throw new RedactionError('verify');
      if (name === 'Annots' && !isEmpty(doc.context.lookup(page.node.get(key)))) {
        throw new RedactionError('verify');
      }
    }
    const resources = page.node.Resources();
    if (!resources) throw new RedactionError('verify');
    for (const key of resources.keys()) {
      const name = key.decodeText();
      if (name !== 'XObject' && !emptyOnly.has(name)) throw new RedactionError('verify');
      if (emptyOnly.has(name) && !isEmpty(doc.context.lookup(resources.get(key)))) {
        throw new RedactionError('verify');
      }
    }
    const contents = page.node.Contents();
    const streams = contents instanceof PDFArray ? contents.asArray() : [contents];
    for (const ref of streams) {
      const stream = ref && doc.context.lookup(ref);
      if (!(stream instanceof PDFRawStream)) throw new RedactionError('verify');
      const text = new TextDecoder('latin1').decode(decodePDFRawStream(stream).decode());
      // Een tekstblok begint met BT; er mag alleen een afbeelding getekend worden.
      if (/\bBT\b/.test(text) || /\bTj\b|\bTJ\b/.test(text)) throw new RedactionError('verify');
    }
    // Wat er in de hulpbronnen als afbeelding staat, is een afbeelding en niets anders.
    const xobjects = resources.lookupMaybe(PDFName.of('XObject'), PDFDict);
    if (!xobjects) throw new RedactionError('verify');
    for (const [, ref] of xobjects.entries()) {
      const object = doc.context.lookup(ref);
      if (!(object instanceof PDFRawStream)) throw new RedactionError('verify');
      if (object.dict.get(PDFName.of('Subtype')) !== PDFName.of('Image')) {
        throw new RedactionError('verify');
      }
    }
  }
}
