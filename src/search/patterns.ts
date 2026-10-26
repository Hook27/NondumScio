import { foldChars, foldTerm } from './fold';

/**
 * Zoeken in de tekst van een pagina: letterlijke termen en een paar vaste patronen. Een eigen
 * reguliere expressie kan niet; die kan de pagina laten vastlopen en is lastig te begrijpen.
 */

export type PatternId = 'email' | 'iban' | 'phone' | 'postcode';

export const PATTERN_IDS: readonly PatternId[] = ['email', 'iban', 'phone', 'postcode'];

export type SearchSpec = {
  /** Letterlijke termen; hoofdletters en accenten maken niet uit. */
  terms: readonly string[];
  patterns: readonly PatternId[];
  /** Een term telt alleen als hij niet in een langer woord zit ("Jan" niet in "Janssen"). */
  wholeWords: boolean;
};

/** Een plek in de tekens van een pagina: van `start` tot (niet tot en met) `end`. */
export type Hit = { start: number; end: number; kind: 'term' | PatternId };

/** Een patroon; `accept` keurt een gevonden stuk achteraf goed (en geeft zijn lengte) of af (0). */
type Pattern = { source: string; flags: string; accept?: (found: string) => number };

const PATTERNS: Record<PatternId, Pattern> = {
  email: {
    source: String.raw`(?<![A-Za-z0-9._%+-])[A-Za-z0-9._%+-]+@(?:[A-Za-z0-9-]+\.)+[A-Za-z]{2,}`,
    flags: 'g',
  },
  iban: {
    source: String.raw`(?<![A-Za-z0-9])[A-Z]{2}\d{2}(?: ?[A-Z0-9]{4}){2,7}(?: ?[A-Z0-9]{1,3})?(?![A-Za-z0-9])`,
    flags: 'gi',
    accept: ibanLength,
  },
  phone: {
    // Nederlands (06 12345678, 020-1234567, +31 6 …) en internationaal (+49 …).
    source:
      String.raw`(?<![\dA-Za-z+])(?:(?:\+|00)31[\s-]?(?:\(0\))?[\s-]?[1-9](?:[\s-]?\d){8}|0[1-9](?:[\s-]?\d){8}` +
      String.raw`|\+(?!31)[1-9]\d{0,2}(?:[\s-]?\d){6,11})(?!\d)`,
    flags: 'g',
    accept: (found) => (/^\d{1,2}[-/.]\d{1,2}[-/.]\d{4}/.test(found) ? 0 : found.length),
  },
  postcode: {
    // Hoofdletters verplicht: anders is "2019 en" een postcode.
    source: String.raw`(?<![A-Za-z0-9])[1-9]\d{3} ?[A-Z]{2}(?![A-Za-z0-9])`,
    flags: 'g',
    accept: (found) => (/(SA|SD|SS)$/.test(found) ? 0 : found.length),
  },
};

/** De rest van het IBAN-controlegetal (mod 97) van een rekeningnummer zonder spaties. */
function ibanRemainder(compact: string): number {
  const moved = compact.slice(4) + compact.slice(0, 4);
  let remainder = 0;
  for (const char of moved) {
    const value = /\d/.test(char) ? char : String(char.toUpperCase().charCodeAt(0) - 55);
    for (const digit of value) remainder = (remainder * 10 + Number(digit)) % 97;
  }
  return remainder;
}

/**
 * Hoeveel van het gevonden stuk een geldig IBAN is: het hele stuk, of zonder de woorden erachter
 * (het patroon neemt soms een stukje van de volgende woorden mee). 0 als het geen IBAN is.
 */
function ibanLength(found: string): number {
  const ends = [found.length];
  for (let i = found.length - 1; i > 0; i -= 1) if (found[i] === ' ') ends.push(i);
  for (const end of ends) {
    const compact = found.slice(0, end).replace(/ /g, '');
    if (compact.length >= 15 && compact.length <= 34 && ibanRemainder(compact) === 1) return end;
  }
  return 0;
}

/** De zoektermen uit een tekstveld: één per regel, zonder lege regels of dubbelen. */
export function parseTerms(input: string): string[] {
  const terms = input
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => foldTerm(line) !== '');
  return [...new Set(terms)];
}

const escapeRegExp = (text: string) => text.replace(/[\\^$.*+?()[\]{}|]/g, '\\$&');

/** De zoekopdracht als reguliere expressie, met dezelfde behandeling van accenten als de tekst. */
function termRegExp(term: string, wholeWords: boolean): RegExp | null {
  const folded = foldTerm(term);
  if (folded === '') return null;
  const body = escapeRegExp(folded);
  return wholeWords
    ? new RegExp(String.raw`(?<![\p{L}\p{N}])${body}(?![\p{L}\p{N}])`, 'giu')
    : new RegExp(body, 'giu');
}

/** Alle plekken waar een term of patroon voorkomt; overlappende plekken zijn samengevoegd. */
export function findHits(chars: readonly string[], spec: SearchSpec): Hit[] {
  const folded = foldChars(chars);
  const found: Hit[] = [];
  const add = (from: number, length: number, kind: Hit['kind']) => {
    const start = folded.origin[from];
    const last = folded.origin[from + length - 1];
    if (length > 0 && start !== undefined && last !== undefined) {
      found.push({ start, end: last + 1, kind });
    }
  };
  const scan = (regexp: RegExp, kind: Hit['kind'], accept?: (found: string) => number) => {
    for (let match = regexp.exec(folded.text); match; match = regexp.exec(folded.text)) {
      const length = accept ? accept(match[0]) : match[0].length;
      add(match.index, length, kind);
      // Is het stuk afgekeurd, dan kan er vanaf de volgende plek nog iets anders beginnen.
      regexp.lastIndex = match.index + Math.max(length, 1);
    }
  };

  for (const term of spec.terms) {
    const regexp = termRegExp(term, spec.wholeWords);
    if (regexp) scan(regexp, 'term');
  }
  for (const id of spec.patterns) {
    const pattern = PATTERNS[id];
    scan(new RegExp(pattern.source, pattern.flags), id, pattern.accept);
  }

  found.sort((a, b) => a.start - b.start || b.end - a.end);
  const merged: Hit[] = [];
  for (const hit of found) {
    const last = merged[merged.length - 1];
    if (last && hit.start < last.end) last.end = Math.max(last.end, hit.end);
    else merged.push({ ...hit });
  }
  return merged;
}
