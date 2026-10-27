import type { PDFDocument } from 'pdf-lib';
import {
  annotationsOf,
  redactionsOf,
  type Annotation,
  type BoxAnnotation,
} from '../annotations/model';
import type { PageItem, Rotation } from '../pages/plan';
import { attachPageRefs, detachPageRefs, strayObjects } from './links';
import { addTextLayer, squash, wordsOutside, type OcrWord } from './ocrText';
import type { PixelRect } from './paint';
import { pruneUnreachable } from './prune';
import { DEFAULT_REDACTION, DPI_CHOICES, type RedactionOptions } from './redactOptions';

/**
 * Redigeren: echt weglakken. Een zwart vak over tekst laat de tekst gewoon in het bestand
 * staan. Daarom wordt elke pagina met een redactievak een afbeelding, met het vak er zwart in:
 * er is dan op die pagina geen tekst, lettertype of verborgen laag meer om terug te halen. Het
 * resultaat is een nieuw bestand dat alleen uit de pagina's wordt opgebouwd; de oorspronkelijke
 * pagina's, bladwijzers, formulieren, bijlagen en eerdere versies komen er dus niet in mee.
 */

export { DEFAULT_REDACTION, DPI_CHOICES, type OcrWord, type RedactionOptions };

/** Redigeren mislukte of kon niet worden gecontroleerd: er wordt dan niets gedownload. */
export class RedactionError extends Error {
  constructor(readonly code: 'raster' | 'verify' | 'ocr' | 'cancelled') {
    super(`Redigeren mislukt: ${code}`);
    this.name = 'RedactionError';
  }
}

/**
 * Eén pagina als afbeelding: de PNG, de afmetingen in punten en in beeldpunten, de zwarte vlakken
 * (in beeldpunten) en of de afbeelding kleiner moest dan gevraagd.
 */
export type RasterPage = {
  png: Uint8Array;
  width: number;
  height: number;
  pixelWidth: number;
  pixelHeight: number;
  blackouts: PixelRect[];
  reduced: boolean;
};

/** Tekstherkenning: geeft de woorden op een afbeelding, met hun plek in beeldpunten. */
export type OcrEngine = {
  recognize: (png: Uint8Array, dpi: number) => Promise<OcrWord[]>;
  close: () => void;
};

/** Wat er op een pagina met herkende tekst moet staan, en waar geen tekst mag liggen (punten, linksboven). */
export type TextCheck = {
  pageIndex: number;
  /** De verwachte tekst zonder witruimte. */
  text: string;
  forbidden: PixelRect[];
};

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
  /** Opent de tekstherkenning; standaard tesseract.js (zie `ocr.ts`). */
  openOcr?: (onStatus?: (progress: number) => void) => Promise<OcrEngine>;
  /** Controleert de pagina's met herkende tekst; standaard met pdf.js. */
  verifyText?: (bytes: Uint8Array, checks: TextCheck[]) => Promise<void>;
  /** Meldt hoever het laden van de herkenner is (0 tot 1). */
  onOcrStatus?: (progress: number) => void;
  /** Om te stoppen: tussen de pagina's, en ook midden in een herkenning. */
  signal?: AbortSignal;
};

export type RedactionReport = {
  /** De plekken (vanaf 0) van de pagina's die afbeelding zijn geworden. */
  pages: number[];
  /** Daarvan de pagina's waar herkende tekst onzichtbaar op is gezet. */
  recognized: number[];
  reduced: boolean;
};

/** Wacht op `promise`, maar geeft op tijd op als er gestopt wordt. */
function unlessAborted<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return promise;
  return new Promise<T>((resolve, reject) => {
    const stop = () => reject(new RedactionError('cancelled'));
    if (signal.aborted) return stop();
    signal.addEventListener('abort', stop, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', stop));
  });
}

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
    return { bytes, report: { pages: [], recognized: [], reduced: false } };
  }

  const lib = await import('pdf-lib');
  const source = await lib.PDFDocument.load(bytes, { updateMetadata: false });
  if (source.getPageCount() !== pages.length) throw new RedactionError('raster');
  // Anders haalt het kopiëren via een koppeling de originele pagina met vak mee (zie `links.ts`).
  detachPageRefs(lib, source);
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
  let engine: OcrEngine | undefined;
  let font: Awaited<ReturnType<PDFDocument['embedFont']>> | undefined;
  const checks: TextCheck[] = [];
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
      if (deps.signal?.aborted) throw new RedactionError('cancelled');
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
      if (options.ocr) {
        // Herkennen op de afbeelding die al zwart is gemaakt: wat onder een vak stond, bestaat daar niet meer.
        let words: OcrWord[];
        try {
          engine ??= await unlessAborted(
            (deps.openOcr ?? (await import('./ocr')).openOcr)(deps.onOcrStatus),
            deps.signal,
          );
          const dpi = Math.round((raster.pixelWidth / raster.width) * 72);
          words = await unlessAborted(engine.recognize(raster.png, dpi), deps.signal);
        } catch (error) {
          throw error instanceof RedactionError ? error : new RedactionError('ocr');
        }
        font ??= await out.embedFont(lib.StandardFonts.Helvetica);
        const factor = raster.width / raster.pixelWidth;
        const layer = addTextLayer(lib, page, font, wordsOutside(words, raster.blackouts), factor);
        checks.push({
          pageIndex: index,
          text: squash(layer.words.join('')),
          forbidden: raster.blackouts.map((rect) => ({
            x0: rect.x0 * factor,
            y0: rect.y0 * factor,
            x1: rect.x1 * factor,
            y1: rect.y1 * factor,
          })),
        });
      }
      done += 1;
      onProgress?.(done, pages.length);
      // Tussen de pagina's krijgt de browser even lucht, zodat de pagina blijft reageren.
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    await flush();
  } finally {
    session.close();
    engine?.close();
  }

  // Koppelingen wijzen weer naar de pagina op hun plek, nu in het nieuwe bestand; wat nergens
  // meer aan hangt, gaat eruit.
  attachPageRefs(lib, out);
  pruneUnreachable(lib, out);
  const result = await out.save();
  // Eerst de eigen controle op de opbouw, dan (met pdf.js) of er echt geen tekst meer staat; op
  // pagina's met herkende tekst: of er niets anders staat dan die tekst, en niet in een zwart vak.
  const recognized = checks.map((check) => check.pageIndex);
  await assertImageOnly(result, affected, new Set(recognized));
  const plain = affected.filter((index) => !recognized.includes(index));
  if (plain.length > 0) {
    if (deps.verify) await deps.verify(result, plain);
    else await (await import('./rasterize')).verifyNoText(result, plain);
  }
  if (checks.length > 0) {
    if (deps.verifyText) await deps.verifyText(result, checks);
    else await (await import('./rasterize')).verifyText(result, checks);
  }
  return { bytes: result, report: { pages: affected, recognized, reduced } };
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
 * miniatuur of andere extra's in de pagina. En in het hele bestand: geen pagina buiten de
 * paginaboom en geen aantekening die op geen pagina staat (daar kan de oude pagina in zitten). Gooit
 * een fout als er iets anders staat.
 */
export async function assertImageOnly(
  bytes: Uint8Array,
  pageIndexes: readonly number[],
  /** Pagina's met herkende tekst: daar mogen onzichtbare tekst en één standaardlettertype op staan. */
  textPages: ReadonlySet<number> = new Set(),
) {
  const lib = await import('pdf-lib');
  const { PDFArray, PDFDict, PDFDocument, PDFName, PDFRawStream, decodePDFRawStream } = lib;
  const doc = await PDFDocument.load(bytes, { updateMetadata: false });
  if (strayObjects(lib, doc) > 0) throw new RedactionError('verify');
  // pdf-lib zet in elke nieuwe pagina ook lege lijsten voor aantekeningen, lettertypen en dergelijke.
  const allowed = new Set(['Type', 'Parent', 'MediaBox', 'Resources', 'Contents', 'Annots']);
  const emptyOnly = new Set(['Font', 'ExtGState', 'ProcSet', 'Annots']);
  const isEmpty = (value: unknown) =>
    value === undefined ||
    (value instanceof PDFArray && value.size() === 0) ||
    (value instanceof PDFDict && value.keys().length === 0);
  for (const index of pageIndexes) {
    const withText = textPages.has(index);
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
      const fonts = name === 'Font' ? doc.context.lookup(resources.get(key)) : undefined;
      if (withText && fonts instanceof PDFDict) {
        // Alleen het standaardlettertype Helvetica, zonder ingebouwd lettertypebestand.
        for (const [, ref] of fonts.entries()) {
          const font = doc.context.lookup(ref);
          if (
            !(font instanceof PDFDict) ||
            font.get(PDFName.of('BaseFont')) !== PDFName.of('Helvetica') ||
            font.get(PDFName.of('Subtype')) !== PDFName.of('Type1') ||
            font.has(PDFName.of('FontDescriptor'))
          ) {
            throw new RedactionError('verify');
          }
        }
      } else if (emptyOnly.has(name) && !isEmpty(doc.context.lookup(resources.get(key)))) {
        throw new RedactionError('verify');
      }
    }
    const contents = page.node.Contents();
    const streams = contents instanceof PDFArray ? contents.asArray() : [contents];
    for (const ref of streams) {
      const stream = ref && doc.context.lookup(ref);
      if (!(stream instanceof PDFRawStream)) throw new RedactionError('verify');
      const text = new TextDecoder('latin1').decode(decodePDFRawStream(stream).decode());
      // Een tekstblok begint met BT. Zonder herkende tekst mag er alleen een afbeelding getekend
      // worden; met herkende tekst moet alle tekst onzichtbaar zijn (weergavemodus 3).
      const hasText = /\bBT\b/.test(text) || /\bTj\b|\bTJ\b/.test(text);
      if (hasText && (!withText || !/\b3 Tr\b/.test(text) || /\b[0124567] Tr\b/.test(text))) {
        throw new RedactionError('verify');
      }
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
