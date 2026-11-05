import type { PageText } from '../compare/layout';

/**
 * Pagina-overgangen, zoals in de losse pdf-tekst-extractor: het afgedrukte paginanummer van elke
 * pagina herkennen, beslissen of een pagina aansluit op de vorige (een zin die doorloopt), en de
 * tekst samenstellen met pagina-ankers {p#} en een paginaconcordantie onderaan.
 */

/** Hoe een pagina aansluit op de vorige: automatisch bepalen, altijd aaneen, of altijd gescheiden. */
export type Join = 'auto' | 'join' | 'break';

export const JOINS: readonly Join[] = ['auto', 'join', 'break'];

/** Per fysieke pagina (vanaf 1) het afgedrukte paginanummer, of null als er geen is. */
export type Printed = Record<number, string | null>;

/** Een Romeins cijfer als getal (0 als het geen Romeins cijfer is), zoals in de extractor. */
export function romanToInt(text: string): number {
  const values: Record<string, number> = { i: 1, v: 5, x: 10, l: 50, c: 100, d: 500, m: 1000 };
  const s = text.toLowerCase();
  let total = 0;
  let previous = 0;
  for (let k = s.length - 1; k >= 0; k--) {
    const v = values[s[k]!];
    if (!v) return 0;
    if (v < previous) total -= v;
    else {
      total += v;
      previous = v;
    }
  }
  return total;
}

type Candidate = { raw: string; value: number; roman: boolean };

/**
 * Een los getal (1 tot 4 cijfers) of Romeins cijfer in de boven- of onderrand van de pagina (8 %
 * van de hoogte), bij voorkeur zo dicht mogelijk bij de onderkant.
 */
export function detectPageNumber(page: PageText): Candidate | null {
  const band = page.h * 0.08;
  let best: (Candidate & { y: number }) | null = null;
  for (const item of page.items) {
    const s = item.str.trim();
    if (!s) continue;
    if (item.y >= band && item.y <= page.h - band) continue;
    let found: Candidate | null = null;
    if (/^\d{1,4}$/.test(s)) found = { raw: s, value: Number(s), roman: false };
    else if (/^[ivxlcdm]{1,7}$/i.test(s)) {
      const value = romanToInt(s);
      if (value) found = { raw: s.toLowerCase(), value, roman: true };
    }
    if (found && (!best || item.y < best.y)) best = { ...found, y: item.y };
  }
  return best ? { raw: best.raw, value: best.value, roman: best.roman } : null;
}

/**
 * De afgedrukte paginanummers van een document. Gewone nummers moeten oplopen en mogen niet meer
 * dan 50 verspringen; anders is het waarschijnlijk iets anders (een jaartal) en telt het niet.
 */
export function printedPages(pages: readonly PageText[]): Printed {
  const printed: Printed = {};
  let last: number | null = null;
  for (const page of pages) {
    const candidate = detectPageNumber(page);
    if (!candidate) {
      printed[page.no] = null;
      continue;
    }
    if (!candidate.roman) {
      if (last !== null && (candidate.value < last || candidate.value - last > 50)) {
        printed[page.no] = null;
        continue;
      }
      last = candidate.value;
    }
    printed[page.no] = candidate.raw;
  }
  return printed;
}

/** Hoe twee pagina's aan elkaar komen: zonder afbreekstreepje, met een spatie, of als nieuwe alinea. */
export type Boundary = 'hyphen' | 'space' | 'break';

/**
 * Sluit de tekst van een pagina aan op die van de vorige gelezen pagina? Aaneen als de vorige op
 * een afgebroken woord eindigt (en afgebroken woorden hersteld worden), of als de vorige niet op
 * een leesteken eindigt en deze pagina met een kleine letter begint. De keuze per overgang gaat
 * voor.
 */
export function boundary(
  previous: string,
  current: string,
  join: Join,
  opts: { crossPage: boolean; dehyphen: boolean },
): Boundary {
  if (!opts.crossPage) return 'break';
  const prev = previous.trim();
  const hyphen = /[A-Za-zÀ-ÿ]-$/.test(prev);
  if (join === 'break') return 'break';
  if (join === 'join') return hyphen && opts.dehyphen ? 'hyphen' : 'space';
  if (hyphen && opts.dehyphen) return 'hyphen';
  const endsSentence = /[.:;!?»”’"')\]]$/.test(prev);
  const startsLower = /^[a-zà-ÿ(]/.test(current.trim());
  return !endsSentence && startsLower ? 'space' : 'break';
}

/** De woorden van de paginaconcordantie, in de taal van de app. */
export type ConcordanceTexts = {
  title: string;
  page: string;
  none: string;
  titlePage: string;
};

/** Zoals in de extractor. */
export const DUTCH_CONCORDANCE: ConcordanceTexts = {
  title: 'Paginaconcordantie:',
  page: 'PDF-pagina {n} = documentpagina {p}',
  none: 'PDF-pagina {n} = geen documentpaginanummer',
  titlePage: ' (titelblad)',
};

/** De paginaconcordantie: elke PDF-pagina met zijn afgedrukte paginanummer. */
export function concordance(
  pages: readonly { no: number }[],
  printed: Printed,
  texts: ConcordanceTexts = DUTCH_CONCORDANCE,
): string {
  if (pages.length === 0) return '';
  const rows = pages.map(({ no }) => {
    const p = printed[no];
    return p
      ? texts.page.replace('{n}', String(no)).replace('{p}', p)
      : texts.none.replace('{n}', String(no)) + (no === 1 ? texts.titlePage : '');
  });
  return `---\n${texts.title}\n${rows.join('\n')}`;
}

/** Wat er nodig is om de tekst samen te stellen, naast de pagina's. */
export type Assembly = {
  printed: Printed;
  /** De keuze per overgang, per pagina (de aansluiting op de vorige pagina). */
  joins: Readonly<Record<number, Join>>;
  texts: ConcordanceTexts;
};

/**
 * De gelezen pagina's samen tot één tekst, zoals `assembleDocument` in de extractor: met
 * `anchors` begint elke pagina met {p#} (bij een doorlopende zin midden in de zin) en komt de
 * concordantie onderaan; met `crossPage` lopen zinnen over de pagina-overgang door. Eén bewuste
 * afwijking: zonder enige tekst ook geen concordantie (de extractor gaf dan alleen die).
 */
export function assemble(
  results: readonly { no: number; text: string; status: string }[],
  opts: { anchors: boolean; crossPage: boolean; dehyphen: boolean },
  assembly: Assembly,
): string {
  const read = results.filter((r) => r.status === 'read' && r.text.trim() !== '');
  let body = '';
  read.forEach((r, i) => {
    const anchor = opts.anchors ? `{p${r.no}} ` : '';
    const text = r.text.trim();
    if (i === 0) {
      body = anchor + text;
      return;
    }
    const decision = boundary(read[i - 1]!.text, r.text, assembly.joins[r.no] ?? 'auto', opts);
    if (decision === 'hyphen')
      body = body.replace(/-\s*$/, '') + (opts.anchors ? `{p${r.no}}` : '') + text;
    else if (decision === 'space') body = `${body.replace(/\s+$/, '')} ${anchor}${text}`;
    else body += `\n\n${anchor}${text}`;
  });
  if (opts.anchors && body !== '') {
    const table = concordance(results, assembly.printed, assembly.texts);
    if (table) body += `\n\n${table}`;
  }
  return body;
}
