import { placeOutline, type OutlineEntry } from '../outline/outline';
import type { PageItem } from '../pages/plan';

/*
 * Splitsen op bladwijzers, zoals de losse tool "PDF → Splitsen op bladwijzers": elk deel loopt van
 * de pagina van zijn bladwijzer tot de pagina vóór de volgende. Alles hier rekent alleen; de
 * pagina's zelf komen later uit het pagina-plan (`buildParts` in `pdf/save.ts`).
 */

/** Een bladwijzer in documentvolgorde, met zijn plek in het pagina-plan. */
export type Mark = {
  title: string;
  /** 1 is het bovenste niveau. */
  depth: number;
  /**
   * De plek van zijn pagina in het plan (vanaf 0), of `null`: de bladwijzer wijst niet naar een
   * pagina (bijvoorbeeld naar een website), of zijn pagina is weggehaald.
   */
  position: number | null;
  /** De hoofdbladwijzer (niveau 1) waar hij onder valt; op niveau 1 hijzelf. */
  top: Top;
};

/** Een hoofdbladwijzer, voor de submappen in de ZIP. */
export type Top = {
  title: string;
  /** Of er bladwijzers onder vallen (alleen dan krijgt hij een eigen map). */
  children: boolean;
};

/** De bladwijzers van een geopend bestand (`doc` is `Source.id`). */
export type MarkSource = { doc: number; entries: readonly OutlineEntry[] };

/**
 * De bladwijzers van de bestanden als platte lijst: per bestand in documentvolgorde, met wat
 * eronder valt direct na zijn ouder. Een bladwijzer zonder titel krijgt `untitled`.
 */
export function flattenMarks(
  sources: readonly MarkSource[],
  pages: readonly PageItem[],
  untitled: string,
): Mark[] {
  const marks: Mark[] = [];
  for (const source of sources) {
    const walk = (entries: ReturnType<typeof placeOutline>, depth: number, top: Top | null) => {
      for (const entry of entries) {
        const title = entry.title || untitled;
        const own = top ?? { title, children: entry.children.length > 0 };
        marks.push({
          title,
          depth,
          position: entry.target.kind === 'page' ? entry.target.position : null,
          top: own,
        });
        walk(entry.children, depth + 1, own);
      }
    };
    walk(placeOutline(source.entries, source.doc, pages), 1, null);
  }
  return marks;
}

/** Het diepste niveau van de bladwijzers (0 zonder bladwijzers). */
export function maxDepth(marks: readonly Mark[]): number {
  return marks.reduce((deepest, mark) => Math.max(deepest, mark.depth), 0);
}

/** Een deel: van plek `from` tot en met `to` in het plan (vanaf 0). */
export type Part = {
  title: string;
  depth: number;
  from: number;
  to: number;
  /** De andere bladwijzers die op dezelfde pagina beginnen ("ook: …"). */
  also: string[];
  /** De hoofdbladwijzer van de bladwijzer die het deel zijn naam geeft (`null` bij voorwerk). */
  top: Top | null;
};

export type PartOptions = {
  /** Tot en met welk niveau bladwijzers een deel beginnen; 0 is alle niveaus. */
  level: number;
  /** "Grenspagina ook in vorig deel": de eerste pagina van een deel komt ook achteraan het vorige. */
  overlap: boolean;
  /** De naam van het deel vóór de eerste bladwijzer ("Voorwerk"). */
  frontMatter: string;
  /**
   * Bij meer bestanden begint elk volgend bestand een nieuw deel. Begint daar geen bladwijzer,
   * dan heet het deel naar het bestand: de titel per `PageItem.doc`.
   */
  fileTitles?: ReadonlyMap<number, string>;
};

/**
 * De delen. Bladwijzers tot en met het gekozen niveau beginnen een deel op hun pagina; beginnen
 * er meer op dezelfde pagina, dan geeft de diepste (de eerste daarvan) de naam en staan de andere
 * bij "ook". Begint de eerste bladwijzer na de eerste pagina, dan komt daarvoor een deel
 * `frontMatter`. Zonder bruikbare bladwijzer: geen delen.
 */
export function bookmarkParts(
  marks: readonly Mark[],
  pages: readonly PageItem[],
  { level, overlap, frontMatter, fileTitles }: PartOptions,
): Part[] {
  const deepest = level > 0 ? level : Infinity;
  const groups = new Map<number, Mark[]>();
  for (const mark of marks) {
    if (mark.position === null || mark.depth > deepest) continue;
    const group = groups.get(mark.position);
    if (group) group.push(mark);
    else groups.set(mark.position, [mark]);
  }
  if (groups.size === 0) return [];

  // Waar een volgend bestand begint. Daar is de pagina nooit half: de grenspagina doet niet mee.
  const fileStarts = new Set<number>();
  for (let i = 1; i < pages.length; i += 1) {
    if (pages[i]!.doc !== pages[i - 1]!.doc) fileStarts.add(i);
  }
  const starts = [...new Set([...groups.keys(), ...fileStarts])].sort((a, b) => a - b);
  const until = (next: number) => (overlap && !fileStarts.has(next) ? next : next - 1);

  const parts: Part[] = [];
  if (starts[0]! > 0) {
    const to = until(starts[0]!);
    parts.push({ title: frontMatter, depth: 1, from: 0, to, also: [], top: null });
  }
  starts.forEach((start, i) => {
    const to = i + 1 < starts.length ? until(starts[i + 1]!) : pages.length - 1;
    const group = groups.get(start);
    if (!group) {
      const title = fileTitles?.get(pages[start]!.doc) ?? frontMatter;
      parts.push({ title, depth: 1, from: start, to, also: [], top: null });
      return;
    }
    const main = group.reduce((best, mark) => (mark.depth > best.depth ? mark : best));
    parts.push({
      title: main.title,
      depth: main.depth,
      from: start,
      to,
      also: group.filter((mark) => mark !== main).map((mark) => mark.title),
      top: main.top,
    });
  });
  return parts;
}

// eslint-disable-next-line no-control-regex -- stuurtekens moeten hier juist weg
const FORBIDDEN = /[\\:*?"<>|\u0000-\u001f]/g;

/**
 * Een titel als bestandsnaam: een `/` wordt ` - `, de tekens `\ : * ? " < > |` en stuurtekens
 * vervallen, witruimte wordt één spatie, hooguit 150 tekens, zonder punten en spaties aan het eind.
 * Blijft er niets over, dan `fallback`.
 */
export function cleanName(text: string, fallback: string): string {
  return (
    text
      .replace(/\s*\/\s*/g, ' - ')
      .replace(FORBIDDEN, '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 150)
      .replace(/[. ]+$/, '') || fallback
  );
}

/**
 * De voorgestelde naam van deel `index` (vanaf 0) van `count`: "[voorvoegsel ]001 - titel.pdf".
 * Het volgnummer heeft minstens twee cijfers, en zoveel als het aantal delen nodig heeft.
 */
export function autoName(
  title: string,
  index: number,
  count: number,
  prefix: string,
  fallback: string,
): string {
  const number = String(index + 1).padStart(Math.max(2, String(count).length), '0');
  const before = cleanName(prefix, '');
  return `${before ? `${before} ` : ''}${number} - ${cleanName(title, fallback)}.pdf`;
}

/** De naam waaronder een deel wordt opgeslagen: een (zelf aangepaste) naam opgeschoond, met .pdf. */
export function fileNameOf(name: string, fallback: string): string {
  const clean = cleanName(name.replace(/\.pdf$/i, ''), fallback).trim() || fallback;
  return /\.pdf$/i.test(clean) ? clean : `${clean}.pdf`;
}

/**
 * Het pad van een deel in de ZIP. Met `folders` ("Submap per hoofdbladwijzer") komt het in een map
 * met de naam van zijn hoofdbladwijzer, als daar bladwijzers onder vallen; anders, en het
 * voorwerk, in de hoofdmap.
 */
export function zipPath(
  fileName: string,
  top: Top | null,
  folders: boolean,
  fallback: string,
): string {
  return folders && top?.children ? `${cleanName(top.title, fallback)}/${fileName}` : fileName;
}

/** Welke namen vaker voorkomen (hoofdletters tellen niet): hun plekken in de lijst. */
export function duplicateNames(names: readonly (string | null)[]): Set<number> {
  const counts = new Map<string, number>();
  for (const name of names) {
    if (name !== null) counts.set(name.toLowerCase(), (counts.get(name.toLowerCase()) ?? 0) + 1);
  }
  const result = new Set<number>();
  names.forEach((name, i) => {
    if (name !== null && counts.get(name.toLowerCase())! > 1) result.add(i);
  });
  return result;
}

/**
 * De namen in de ZIP: komt een naam al voor (hoofdletters tellen niet, want Windows ziet ze als
 * hetzelfde bestand), dan "naam (2).pdf", "naam (3).pdf", ….
 */
export function uniqueNames(names: readonly string[]): string[] {
  const taken = new Set<string>();
  return names.map((name) => {
    let unique = name;
    if (taken.has(name.toLowerCase())) {
      const dot = name.lastIndexOf('.');
      const [base, extension] = dot > 0 ? [name.slice(0, dot), name.slice(dot)] : [name, ''];
      for (let n = 2; taken.has(unique.toLowerCase()); n += 1)
        unique = `${base} (${n})${extension}`;
    }
    taken.add(unique.toLowerCase());
    return unique;
  });
}
