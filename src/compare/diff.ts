import { analyseRunning, pageText, type PageText } from './layout';

/**
 * Twee teksten vergelijken: in stukken knippen (alinea's, zinnen of regels), de langste gemeenschappelijke
 * reeks zoeken (LCS) en wat overblijft als toegevoegd, verwijderd of gewijzigd tonen, met binnen een
 * gewijzigd stuk de woorden die verschillen. Overgenomen uit de losse pdf-vergelijker.
 */

/** Waarop vergeleken wordt. */
export type CompareLevel = 'paragraph' | 'sentence' | 'line';

export type CompareOptions = {
  level: CompareLevel;
  /**
   * Witruimte gelijktrekken. Staat altijd aan en is niet in te stellen: de opmaak trekt witruimte
   * al gelijk, dus uit maakt geen verschil.
   */
  ignoreSpace: boolean;
  ignoreCase: boolean;
  /** Terugkerende kop- en voetteksten weglaten. */
  strip: boolean;
  /** Twee kolommen herkennen. */
  columns: boolean;
  /** Afgebroken woorden herstellen. */
  dehyphen: boolean;
  /** Alinea-gevoeligheid: zoveel keer de gewone regelafstand is een witregel tussen alinea's. */
  gapFactor: number;
};

/** De grenzen van de alinea-gevoeligheid, zoals in de losse pdf-tekst-extractor. */
export const GAP_FACTOR = { min: 1.1, max: 2.5, step: 0.1 } as const;

/**
 * De standaardinstellingen van de losse pdf-vergelijker, op één na: de alinea-gevoeligheid is 1,3
 * in plaats van 1,6. Word zet standaard 8 pt witruimte na een alinea; dat is ongeveer 1,55 keer
 * de regelafstand, zodat bij 1,6 een hele pagina één alinea werd. Met 6 pt witruimte is het
 * ongeveer 1,4 keer; 1,3 laat daar nog wat ruimte.
 */
export const DEFAULT_OPTIONS: CompareOptions = {
  level: 'paragraph',
  ignoreSpace: true,
  ignoreCase: false,
  strip: true,
  columns: true,
  dehyphen: true,
  gapFactor: 1.3,
};

/** Eén stuk tekst om te vergelijken, met de pagina waar het stond. */
export type Unit = { page: number; val: string; key: string };

/** Een stukje tekst binnen een gewijzigd stuk; `mark` als het in de andere versie niet staat. */
export type Segment = { text: string; mark: boolean };

export type Row =
  | { kind: 'equal'; a: Unit; b: Unit }
  | { kind: 'changed'; a: Unit; b: Unit; partsA: Segment[]; partsB: Segment[] }
  | { kind: 'removed'; a: Unit }
  | { kind: 'added'; b: Unit };

type Op =
  { op: 'eq'; ai: number; bi: number } | { op: 'del'; ai: number } | { op: 'add'; bi: number };

type Entry =
  { type: 'equal'; a: Unit; b: Unit } | { type: 'removed'; a: Unit } | { type: 'added'; b: Unit };

/** Boven dit aantal cellen (stukken A × stukken B) wordt alleen op volgorde vergeleken. */
export const MAX_CELLS = 4_000_000;

/** Boven dit aantal (woorden A × woorden B) worden binnen een stuk geen woorden gemarkeerd. */
const MAX_WORD_CELLS = 250_000;

/** De sleutel waarop vergeleken wordt: zonder verschil in witruimte of hoofdletters, als gevraagd. */
export function normKey(text: string, opts: CompareOptions): string {
  let key = text;
  if (opts.ignoreSpace) key = key.replace(/\s+/g, ' ').trim();
  if (opts.ignoreCase) key = key.toLowerCase();
  return key;
}

function splitSentences(paragraph: string): string[] {
  return paragraph.split(/(?<=[.!?…])\s+(?=["'“«([]?[A-ZÀ-Þ0-9])/);
}

/** De tekst van alle pagina's in stukken; elk stuk onthoudt zijn pagina, om het terug te vinden. */
export function buildUnits(pages: readonly PageText[], opts: CompareOptions): Unit[] {
  const layout = {
    strip: opts.strip,
    columns: opts.columns,
    dehyphen: opts.dehyphen,
    joinLines: opts.level !== 'line',
    gapFactor: opts.gapFactor,
  };
  const running = opts.strip ? analyseRunning(pages) : null;
  const units: Unit[] = [];
  pages.forEach((page, index) => {
    const text = pageText(page, layout, running?.[index]);
    if (!text.trim()) return;
    const parts =
      opts.level === 'line'
        ? text.split('\n')
        : opts.level === 'sentence'
          ? text.split(/\n{2,}/).flatMap(splitSentences)
          : text.split(/\n{2,}/);
    for (const part of parts) {
      const val = part.trim();
      if (val) units.push({ page: page.no, val, key: normKey(val, opts) });
    }
  });
  return units;
}

/** De langste gemeenschappelijke reeks van twee rijen sleutels, als stappen. */
function lcsOps(keysA: readonly string[], keysB: readonly string[]): Op[] {
  const m = keysA.length;
  const n = keysB.length;
  const dp: Uint32Array[] = [];
  for (let i = 0; i <= m; i++) dp.push(new Uint32Array(n + 1));
  for (let i = 1; i <= m; i++) {
    const ka = keysA[i - 1];
    const row = dp[i]!;
    const prev = dp[i - 1]!;
    for (let j = 1; j <= n; j++) {
      row[j] = ka === keysB[j - 1] ? prev[j - 1]! + 1 : Math.max(prev[j]!, row[j - 1]!);
    }
  }
  const ops: Op[] = [];
  let i = m;
  let j = n;
  while (i > 0 && j > 0) {
    if (keysA[i - 1] === keysB[j - 1]) {
      ops.push({ op: 'eq', ai: i - 1, bi: j - 1 });
      i--;
      j--;
    } else if (dp[i - 1]![j]! >= dp[i]![j - 1]!) {
      ops.push({ op: 'del', ai: i - 1 });
      i--;
    } else {
      ops.push({ op: 'add', bi: j - 1 });
      j--;
    }
  }
  while (i > 0) ops.push({ op: 'del', ai: --i });
  while (j > 0) ops.push({ op: 'add', bi: --j });
  return ops.reverse();
}

/** Voor heel grote documenten: alleen op volgorde vergelijken (stuk 1 met stuk 1, enzovoort). */
function simpleOps(keysA: readonly string[], keysB: readonly string[]): Op[] {
  const ops: Op[] = [];
  const max = Math.max(keysA.length, keysB.length);
  for (let i = 0; i < max; i++) {
    if (i >= keysA.length) ops.push({ op: 'add', bi: i });
    else if (i >= keysB.length) ops.push({ op: 'del', ai: i });
    else if (keysA[i] === keysB[i]) ops.push({ op: 'eq', ai: i, bi: i });
    else ops.push({ op: 'del', ai: i }, { op: 'add', bi: i });
  }
  return ops;
}

/** Snijdt het gelijke begin en einde eraf en vergelijkt alleen het middenstuk. */
function diffEntries(
  itemsA: readonly Unit[],
  itemsB: readonly Unit[],
): { entries: Entry[]; fallback: boolean } {
  const lenA = itemsA.length;
  const lenB = itemsB.length;
  let lo = 0;
  while (lo < lenA && lo < lenB && itemsA[lo]!.key === itemsB[lo]!.key) lo++;
  let hiA = lenA;
  let hiB = lenB;
  while (hiA > lo && hiB > lo && itemsA[hiA - 1]!.key === itemsB[hiB - 1]!.key) {
    hiA--;
    hiB--;
  }

  const midA = itemsA.slice(lo, hiA);
  const midB = itemsB.slice(lo, hiB);
  const keysA = midA.map((it) => it.key);
  const keysB = midB.map((it) => it.key);
  const fallback = midA.length * midB.length > MAX_CELLS;
  const ops = fallback ? simpleOps(keysA, keysB) : lcsOps(keysA, keysB);

  const entries: Entry[] = [];
  for (let i = 0; i < lo; i++) entries.push({ type: 'equal', a: itemsA[i]!, b: itemsB[i]! });
  for (const op of ops) {
    if (op.op === 'eq') entries.push({ type: 'equal', a: midA[op.ai]!, b: midB[op.bi]! });
    else if (op.op === 'del') entries.push({ type: 'removed', a: midA[op.ai]! });
    else entries.push({ type: 'added', b: midB[op.bi]! });
  }
  for (let i = 0; i < lenA - hiA; i++) {
    entries.push({ type: 'equal', a: itemsA[hiA + i]!, b: itemsB[hiB + i]! });
  }
  return { entries, fallback };
}

function tokenize(text: string): string[] {
  return text.match(/\s+|\S+/g) ?? [];
}

/** Voegt een stukje toe en plakt het aan het vorige als het op dezelfde manier gemarkeerd is. */
function append(parts: Segment[], text: string, mark: boolean) {
  const last = parts[parts.length - 1];
  if (last && last.mark === mark) last.text += text;
  else parts.push({ text, mark });
}

/**
 * Binnen een gewijzigd stuk: welke woorden verschillen. Zonder enig gemeenschappelijk woord (of bij
 * een heel lang stuk) wordt niets gemarkeerd; dan is het hele stuk anders.
 */
export function inlineDiff(a: string, b: string, opts: CompareOptions): [Segment[], Segment[]] {
  const plain: [Segment[], Segment[]] = [[{ text: a, mark: false }], [{ text: b, mark: false }]];
  const tokA = tokenize(a);
  const tokB = tokenize(b);
  if (tokA.length * tokB.length > MAX_WORD_CELLS) return plain;
  const ops = lcsOps(
    tokA.map((t) => normKey(t, opts)),
    tokB.map((t) => normKey(t, opts)),
  );
  if (!ops.some((op) => op.op === 'eq' && /\S/.test(tokA[op.ai]!))) return plain;
  const partsA: Segment[] = [];
  const partsB: Segment[] = [];
  for (const op of ops) {
    if (op.op === 'eq') {
      append(partsA, tokA[op.ai]!, false);
      append(partsB, tokB[op.bi]!, false);
    } else if (op.op === 'del') append(partsA, tokA[op.ai]!, true);
    else append(partsB, tokB[op.bi]!, true);
  }
  return [partsA, partsB];
}

/** Groepeert verwijderde en toegevoegde stukken die op elkaar volgen, en paart ze als "gewijzigd". */
function buildRows(entries: readonly Entry[], opts: CompareOptions): Row[] {
  const rows: Row[] = [];
  let i = 0;
  while (i < entries.length) {
    const entry = entries[i]!;
    if (entry.type === 'equal') {
      rows.push({ kind: 'equal', a: entry.a, b: entry.b });
      i++;
      continue;
    }
    const dels: Unit[] = [];
    const adds: Unit[] = [];
    while (i < entries.length && entries[i]!.type !== 'equal') {
      const e = entries[i]!;
      if (e.type === 'removed') dels.push(e.a);
      else if (e.type === 'added') adds.push(e.b);
      i++;
    }
    const pairs = Math.min(dels.length, adds.length);
    for (let k = 0; k < pairs; k++) {
      const [partsA, partsB] = inlineDiff(dels[k]!.val, adds[k]!.val, opts);
      rows.push({ kind: 'changed', a: dels[k]!, b: adds[k]!, partsA, partsB });
    }
    for (const a of dels.slice(pairs)) rows.push({ kind: 'removed', a });
    for (const b of adds.slice(pairs)) rows.push({ kind: 'added', b });
  }
  return rows;
}

export type TextComparison = {
  rows: Row[];
  /** Te groot voor een volledige vergelijking: alleen op volgorde vergeleken. */
  fallback: boolean;
  unitsA: number;
  unitsB: number;
};

/** Vergelijkt de tekst van twee documenten. */
export function compareTexts(
  pagesA: readonly PageText[],
  pagesB: readonly PageText[],
  opts: CompareOptions,
): TextComparison {
  const unitsA = buildUnits(pagesA, opts);
  const unitsB = buildUnits(pagesB, opts);
  const { entries, fallback } = diffEntries(unitsA, unitsB);
  return {
    rows: buildRows(entries, opts),
    fallback,
    unitsA: unitsA.length,
    unitsB: unitsB.length,
  };
}

/** Hoeveel stukken er toegevoegd, verwijderd en gewijzigd zijn. */
export function countRows(rows: readonly Row[]) {
  const counts = { added: 0, removed: 0, changed: 0 };
  for (const row of rows) if (row.kind !== 'equal') counts[row.kind]++;
  return counts;
}

export type Shown =
  { t: 'row'; row: Row; index: number } | { t: 'gap'; from: number; to: number; count: number };

/**
 * Welke rijen te zien zijn: met `onlyDiff` worden ongewijzigde stukken ingeklapt tot één regel om
 * aan te klikken, behalve één stuk vóór en na elk verschil en wat je al hebt opengeklikt.
 */
export function displayList(
  rows: readonly Row[],
  onlyDiff: boolean,
  expanded: ReadonlySet<number>,
): Shown[] {
  if (!onlyDiff) return rows.map((row, index) => ({ t: 'row', row, index }));
  const context = 1;
  const keep = new Array<boolean>(rows.length).fill(false);
  rows.forEach((row, i) => {
    if (row.kind === 'equal') return;
    for (let k = Math.max(0, i - context); k <= Math.min(rows.length - 1, i + context); k++) {
      keep[k] = true;
    }
  });
  const out: Shown[] = [];
  let i = 0;
  while (i < rows.length) {
    if (keep[i] || expanded.has(i)) {
      out.push({ t: 'row', row: rows[i]!, index: i });
      i++;
      continue;
    }
    let j = i;
    while (j < rows.length && !keep[j] && !expanded.has(j)) j++;
    out.push({ t: 'gap', from: i, to: j - 1, count: j - i });
    i = j;
  }
  return out;
}
