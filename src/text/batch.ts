import type { PageText } from '../compare/layout';
import type { DocInfo } from '../compare/profile';
import { format } from '../i18n/format';
import { exportName, extractText, type TextOptions } from './extract';
import { DUTCH_HEAD, buildConventions, buildHeader, metaFromInfo, type HeadTexts } from './header';
import { DUTCH_CONCORDANCE, type ConcordanceTexts } from './pages';

/**
 * Batch: meerdere PDF's achter elkaar, zoals in de losse pdf-tekst-extractor. Elke PDF wordt
 * gelezen zoals één PDF zonder leesvakken, met de instellingen van nu. Het resultaat is per PDF een
 * .txt in een zip, of alles in één tekst met "Bestand N start/einde" om elk document heen.
 */

/** De woorden om elk document heen in één bestand. `{n}` is de plek in de keuze, `{name}` de naam. */
export type BatchWords = { start: string; end: string };

/** Zoals in de extractor. */
export const DUTCH_BATCH: BatchWords = {
  start: 'Bestand {n} start: {name}',
  end: 'Bestand {n} einde: {name}',
};

/** Wat er naast de instellingen nodig is: de taal (voor de datum) en de woorden. */
export type BatchContext = {
  language: string;
  concordance: ConcordanceTexts;
  head: HeadTexts;
  words: BatchWords;
};

export const DUTCH_CONTEXT: BatchContext = {
  language: 'nl',
  concordance: DUTCH_CONCORDANCE,
  head: DUTCH_HEAD,
  words: DUTCH_BATCH,
};

/** Een gelezen PDF van de batch. */
export type BatchDoc = { name: string; pages: readonly PageText[]; info: DocInfo };

/** De naam van een PDF in de zip, en hoe hij in een melding heet. */
export type ZipName = { file: string; label: string };

/**
 * De namen in de zip: "brief.pdf" → "brief_extract.txt". Komt een naam vaker voor, dan krijgen
 * alle bestanden met die naam een volgnummer van twee cijfers, ook het eerste: "brief_extract
 * (01).txt", "brief_extract (02).txt". Gelijk is ook gelijk op hoofdletters na (Windows ziet
 * "Brief" en "brief" als hetzelfde bestand); elk houdt zijn eigen schrijfwijze. Het nummer hoort
 * bij de plek in de keuze: ook een PDF die mislukt houdt het zijne.
 */
export function zipNames(names: readonly string[]): ZipName[] {
  const files = names.map(exportName);
  const key = (file: string) => file.toLowerCase();
  const counts = new Map<string, number>();
  for (const file of files) counts.set(key(file), (counts.get(key(file)) ?? 0) + 1);
  const seen = new Map<string, number>();
  return names.map((name, i) => {
    const file = files[i]!;
    if (counts.get(key(file)) === 1) return { file, label: name };
    const n = (seen.get(key(file)) ?? 0) + 1;
    seen.set(key(file), n);
    const no = String(n).padStart(2, '0');
    const dot = file.lastIndexOf('.');
    return { file: `${file.slice(0, dot)} (${no})${file.slice(dot)}`, label: `${name} (${no})` };
  });
}

/** Heeft de PDF tekst (minstens één pagina met een tekstlaag)? */
export const hasText = (doc: BatchDoc): boolean => doc.pages.some((page) => page.items.length > 0);

function textOf(doc: BatchDoc, opts: TextOptions, ctx: BatchContext): string {
  return extractText(doc.pages, opts, null, {
    joins: {},
    name: doc.name,
    meta: metaFromInfo(doc.info, ctx.language),
    texts: ctx.concordance,
    head: ctx.head,
  }).text;
}

/**
 * De tekst van één PDF voor de zip: zoals bij één PDF zonder leesvakken, met de documentkop en het
 * conventieblok als die aan staan, en de gegevens uit de PDF zelf.
 */
export function docText(doc: BatchDoc, opts: TextOptions, ctx: BatchContext = DUTCH_CONTEXT) {
  return textOf(doc, opts, ctx);
}

/** Bovenaan het gecombineerde bestand: het conventieblok voor een batch (als het aan staat). */
export function combinedHead(opts: TextOptions, ctx: BatchContext = DUTCH_CONTEXT): string {
  return opts.conventions ? buildConventions(opts, ctx.head, true) : '';
}

/**
 * Eén document in het gecombineerde bestand, zoals in de extractor: "Bestand N start: naam" met de
 * gegevens van de PDF eronder (altijd, ook zonder documentkop), de tekst, en "Bestand N einde:
 * naam". Zonder tekst alleen de begin- en eindregel.
 */
export function combinedPart(
  no: number,
  doc: BatchDoc,
  opts: TextOptions,
  ctx: BatchContext = DUTCH_CONTEXT,
): string {
  const body = textOf(doc, { ...opts, header: false, conventions: false }, ctx);
  const lines = buildHeader('', metaFromInfo(doc.info, ctx.language), ctx.head);
  const start = format(ctx.words.start, { n: no, name: doc.name }) + (lines ? `\n${lines}` : '');
  const end = format(ctx.words.end, { n: no, name: doc.name });
  return body ? `${start}\n\n${body}\n\n${end}` : `${start}\n\n${end}`;
}

/** Het gecombineerde bestand: het conventieblok en de documenten, met een witregel ertussen. */
export function combineParts(head: string, parts: readonly string[]): string {
  return [head, ...parts].filter((part) => part !== '').join('\n\n');
}
