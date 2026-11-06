import type { DocInfo } from '../compare/profile';

/**
 * De documentkop en het conventieblok, zoals in de losse pdf-tekst-extractor: bovenaan de tekst
 * eventueel een korte uitleg van de markeringen ({p#}, {H}) en een kop met de bestandsnaam en de
 * gegevens van de PDF (titel, auteur, onderwerp, datum). De gegevens komen uit de PDF en zijn vóór
 * het extraheren aan te passen.
 */

/** De gegevens van de PDF voor de documentkop, zoals ze in de velden staan. */
export type Meta = { title: string; author: string; subject: string; date: string };

export const EMPTY_META: Meta = { title: '', author: '', subject: '', date: '' };

export const META_FIELDS = ['title', 'author', 'subject', 'date'] as const;

/** De woorden van de documentkop en het conventieblok, in de taal van de app. */
export type HeadTexts = {
  fields: { file: string } & Meta;
  conventions: {
    title: string;
    intro: string;
    anchors: string;
    concordance: string;
    heading: string;
  };
};

/** Zoals in de extractor (en de regel over {H} erbij). */
export const DUTCH_HEAD: HeadTexts = {
  fields: {
    file: 'Bestand',
    title: 'Titel',
    author: 'Auteur',
    subject: 'Onderwerp',
    date: 'Datum',
  },
  conventions: {
    title: 'Conventies',
    intro: 'Platte tekst geëxtraheerd uit een PDF; opmaak en afbeeldingen zijn weggelaten.',
    anchors:
      '{p#} = begin van PDF-pagina #. Kan midden in een zin staan als een alinea over de pagina-overgang doorloopt.',
    concordance:
      'Onderaan staat een paginaconcordantie die fysieke PDF-pagina’s koppelt aan afgedrukte documentpaginanummers.',
    heading: '{H} = begin van een herkende kop, zoals een hoofdstuk- of artikeltitel.',
  },
};

/**
 * Een PDF-datum ("D:20180604090000+02'00'") als "4 juni 2018", in de taal van de app; leeg of
 * onleesbaar geeft "". Zoals `parsePdfDate` in de extractor: alleen de datum, zonder tijd.
 */
export function pdfDateText(raw: string | undefined, language = 'nl'): string {
  if (!raw) return '';
  const m = /D?:?(\d{4})(\d{2})(\d{2})/.exec(raw);
  if (!m) return '';
  const month = Number(m[2]);
  if (month < 1 || month > 12) return '';
  const name = new Intl.DateTimeFormat(language, { month: 'long', timeZone: 'UTC' }).format(
    Date.UTC(2000, month - 1, 1),
  );
  return `${Number(m[3])} ${name} ${Number(m[1])}`;
}

const text = (value: unknown) => (typeof value === 'string' ? value : '');

/** De velden zoals ze bij het openen van een PDF worden ingevuld (`populateMeta` in de extractor). */
export function metaFromInfo(info: DocInfo, language = 'nl'): Meta {
  return {
    title: text(info.Title),
    author: text(info.Author),
    subject: text(info.Subject),
    date: pdfDateText(text(info.CreationDate), language),
  };
}

/**
 * De documentkop: "Bestand: …", "Titel: …", "Auteur: …", "Onderwerp: …", "Datum: …", elk op een
 * eigen regel. Lege velden vallen weg.
 */
export function buildHeader(name: string, meta: Meta, texts: HeadTexts = DUTCH_HEAD): string {
  const f = texts.fields;
  const fields: [string, string][] = [
    [f.file, name],
    [f.title, meta.title.trim()],
    [f.author, meta.author.trim()],
    [f.subject, meta.subject.trim()],
    [f.date, meta.date.trim()],
  ];
  return fields
    .filter(([, value]) => value)
    .map(([label, value]) => `${label}: ${value}`)
    .join('\n');
}

/** Wat het conventieblok nodig heeft van de instellingen. */
export type ConventionOptions = {
  anchors: boolean;
  joinLines: boolean;
  structure: boolean;
  headingMarker: boolean;
};

/**
 * Het conventieblok: wat de tekst is, en wat de markeringen betekenen. De regel over {H} staat er
 * alleen als {H} ook echt in de tekst kan staan (met regels samenvoegen en opsommingen en koppen);
 * die regel had de extractor nog niet.
 */
export function buildConventions(opts: ConventionOptions, texts: HeadTexts = DUTCH_HEAD): string {
  const c = texts.conventions;
  const title = `=== ${c.title} ===`;
  const lines = [title, c.intro];
  if (opts.anchors) lines.push(c.anchors, c.concordance);
  if (opts.headingMarker && opts.structure && opts.joinLines) lines.push(c.heading);
  // Even breed als de titelregel (in de extractor: 18 tekens, net als "=== Conventies ===").
  lines.push('='.repeat(title.length));
  return lines.join('\n');
}

/** Wat er nodig is voor de kop boven de tekst. */
export type Head = { name: string; meta: Meta; texts: HeadTexts };

/**
 * De tekst met bovenaan het conventieblok en de documentkop (als die aan staan), zoals
 * `assembleDocument` in de extractor. Eén bewuste afwijking, net als bij de concordantie: zonder
 * enige tekst ook geen kop (de extractor gaf dan alleen de kop).
 */
export function withHead(
  body: string,
  opts: ConventionOptions & { header: boolean; conventions: boolean },
  head: Head,
): string {
  if (body === '') return '';
  const parts: string[] = [];
  if (opts.conventions) parts.push(buildConventions(opts, head.texts));
  if (opts.header) {
    const header = buildHeader(head.name, head.meta, head.texts);
    if (header) parts.push(header);
  }
  return parts.length === 0 ? body : `${parts.join('\n\n')}\n\n${body}`;
}
