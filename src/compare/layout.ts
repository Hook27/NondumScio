/**
 * Van de losse tekststukjes van een PDF-pagina weer leesbare tekst maken: regels, twee kolommen,
 * terugkerende kop- en voetteksten, afgebroken woorden en alinea's. Overgenomen uit de losse
 * pdf-vergelijker (die dezelfde opmaakregels heeft als de pdf-tekst-extractor); de keuzes en
 * drempels zijn daar op echte documenten afgesteld en hier bewust gelijk gehouden.
 */

/** Eén tekststukje zoals pdf.js het geeft: tekst, plek (linksonder, in punten) en maat. */
export type Piece = { str: string; x: number; y: number; fh: number; w: number };

/** De tekst van één pagina, met de maat van de pagina. */
export type PageText = { no: number; w: number; h: number; items: Piece[]; chars: number };

/** Wat pdf.js per tekststukje geeft (alleen wat we gebruiken). */
export type RawTextItem = { str?: string; transform?: number[]; width?: number; height?: number };

export type LayoutOptions = {
  /** Terugkerende kop- en voetteksten weglaten. */
  strip: boolean;
  /** Twee kolommen herkennen en na elkaar lezen. */
  columns: boolean;
  /** Een woord dat over twee regels is afgebroken weer aan elkaar zetten. */
  dehyphen: boolean;
  /** Regels samenvoegen tot alinea's (anders blijft elke regel los). */
  joinLines: boolean;
  /** Hoeveel groter dan de gewone regelafstand een witregel tussen alinea's is. */
  gapFactor: number;
};

type Line = { y: number; items: Piece[] };
type Column = 'L' | 'R' | 'F' | null;
type LaidLine = {
  items: Piece[];
  col: Column;
  y: number;
  fh: number;
  text: string;
  x0: number;
  x1: number;
};

export function median(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((x, y) => x - y);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

export function quantile(values: readonly number[], q: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((x, y) => x - y);
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return lo === hi ? sorted[lo]! : sorted[lo]! + (sorted[hi]! - sorted[lo]!) * (pos - lo);
}

/** De tekststukjes van een pagina uit pdf.js, met het aantal tekens. */
export function piecesFrom(items: readonly RawTextItem[]): { items: Piece[]; chars: number } {
  const pieces: Piece[] = [];
  let chars = 0;
  for (const item of items) {
    if (!item.str) continue;
    const tr = item.transform ?? [1, 0, 0, 1, 0, 0];
    const fh = Math.hypot(tr[1]!, tr[3]!) || item.height || 10;
    const w = item.width || item.str.length * fh * 0.5;
    pieces.push({ str: item.str, x: tr[4]!, y: tr[5]!, fh, w });
    chars += item.str.length;
  }
  return { items: pieces, chars };
}

/** Groepeert tekststukjes op hoogte tot regels, van boven naar beneden. */
function groupLines(items: readonly Piece[], yTol: number): Line[] {
  const lines: Line[] = [];
  for (const item of items) {
    let line = lines.find((l) => Math.abs(l.y - item.y) <= yTol);
    if (!line) {
      line = { y: item.y, items: [] };
      lines.push(line);
    }
    line.items.push(item);
  }
  for (const line of lines) line.items.sort((a, b) => a.x - b.x);
  lines.sort((a, b) => b.y - a.y);
  return lines;
}

/** Een mogelijke kop- en voetregel van een pagina, en of die op genoeg pagina's terugkomt. */
export type RunningLines = {
  top: Line | null;
  bot: Line | null;
  dropTop: boolean;
  dropBot: boolean;
};

/**
 * Een kop- of voettekst is geen vaste zone maar een regel die bovenaan (of onderaan) staat én
 * door een duidelijk gat van het tekstblok is gescheiden. Een vaste bandhoogte zou op A4 ook de
 * eerste tekstregel meepakken.
 */
function runningCandidates(page: PageText): { top: Line | null; bot: Line | null } {
  const none = { top: null, bot: null };
  if (page.items.length < 2) return none;
  const yTol = (median(page.items.map((i) => i.fh)) || 10) * 0.5;
  const lines = groupLines(page.items, yTol);
  if (lines.length < 3) return none;
  const gaps: number[] = [];
  for (let i = 1; i < lines.length; i++) gaps.push(lines[i - 1]!.y - lines[i]!.y);
  const typ = quantile(gaps, 0.25) || 12;

  const first = lines[0]!;
  const last = lines[lines.length - 1]!;
  const prev = lines[lines.length - 2]!;
  return {
    top: first.y > page.h * 0.85 && first.y - lines[1]!.y > typ * 1.7 ? first : null,
    bot: last.y < page.h * 0.15 && prev.y - last.y > typ * 1.7 ? last : null,
  };
}

/**
 * De sleutel van een kop- of voetregel, met cijfers vervangen door #, zodat een meelopend
 * paginanummer de sleutel niet per pagina anders maakt.
 */
function lineKey(line: Line): string | null {
  const text = line.items
    .map((i) => i.str)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
  return text ? text.replace(/\d+/g, '#') : null;
}

/**
 * Een regel telt als "meelopend" als dezelfde sleutel op minstens de helft van de pagina's
 * terugkomt (en op minstens twee pagina's).
 */
export function analyseRunning(pages: readonly PageText[]): RunningLines[] {
  const candidates = pages.map(runningCandidates);
  const keys = candidates.map((c) => ({
    top: c.top ? lineKey(c.top) : null,
    bot: c.bot ? lineKey(c.bot) : null,
  }));
  const topCount = new Map<string, number>();
  const botCount = new Map<string, number>();
  for (const k of keys) {
    if (k.top) topCount.set(k.top, (topCount.get(k.top) ?? 0) + 1);
    if (k.bot) botCount.set(k.bot, (botCount.get(k.bot) ?? 0) + 1);
  }
  const threshold = Math.max(2, Math.ceil(pages.length * 0.5));
  return candidates.map((c, i) => {
    const k = keys[i]!;
    return {
      ...c,
      dropTop: !!(k.top && topCount.get(k.top)! >= threshold),
      dropBot: !!(k.bot && botCount.get(k.bot)! >= threshold),
    };
  });
}

/** De tekst van één regel: een spatie waar tussen twee stukjes duidelijk ruimte zit. */
function buildLineText(items: readonly Piece[]): string {
  let text = '';
  let prevEnd: number | null = null;
  for (const item of items) {
    if (prevEnd !== null) {
      const gap = item.x - prevEnd;
      if (gap > item.fh * 0.25 && !/\s$/.test(text)) text += ' ';
    }
    text += item.str;
    prevEnd = item.x + item.w;
  }
  return text.replace(/\s+/g, ' ').trim();
}

function makeLine(items: Piece[], col: Column): LaidLine {
  return {
    items,
    col,
    y: Math.max(...items.map((i) => i.y)),
    fh: Math.max(...items.map((i) => i.fh)),
    text: buildLineText(items),
    x0: Math.min(...items.map((i) => i.x)),
    x1: Math.max(...items.map((i) => i.x + i.w)),
  };
}

/**
 * Zoekt de "goot" tussen twee kolommen: in tekst met twee kolommen heeft bijna elke regel een
 * brede witruimte rond dezelfde plek. Geeft die plek (x), of null.
 */
function detectGutter(lines: readonly Line[], minX: number, maxX: number): number | null {
  const width = maxX - minX;
  if (width <= 0 || lines.length < 6) return null;
  const lo = minX + width * 0.25;
  const hi = minX + width * 0.75;
  const mids: number[] = [];
  let counted = 0;
  for (const line of lines) {
    const its = line.items;
    if (its.length < 2) continue;
    counted++;
    const fh = Math.max(...its.map((i) => i.fh)) || 10;
    let bestGap = 0;
    let mid: number | null = null;
    for (let i = 1; i < its.length; i++) {
      const before = its[i - 1]!;
      const gap = its[i]!.x - (before.x + before.w);
      if (gap > bestGap) {
        bestGap = gap;
        mid = (its[i]!.x + before.x + before.w) / 2;
      }
    }
    if (bestGap > fh * 2 && mid !== null && mid > lo && mid < hi) mids.push(mid);
  }
  if (mids.length < Math.max(4, counted * 0.25)) return null;
  mids.sort((a, b) => a - b);
  return mids[Math.floor(mids.length / 2)]!;
}

/**
 * Begint de regel met een opsommingsteken of een nummer? Nummergroepen bewust op 1 of 2 cijfers
 * gehouden: anders wordt een bedrag als "390.000 euro" of een jaartal als "2018." als
 * paragraafnummer gelezen en breekt de alinea midden in een zin af.
 */
export function isBullet(text: string): boolean {
  return /^\s*([•*●▪]|[-–—]|\d{1,3}(?:\.\d{1,2})+\.?|\d{1,2}[.)]|[A-Za-z][.)]|[ivxlcdmIVXLCDM]{1,7}[.)])\s/.test(
    text,
  );
}

/**
 * Sluit deze regel een zin af? Om een dubbelzinnige cijferopsomming ("5.4 ") te onderscheiden
 * van een doorgebroken zin.
 */
function endsSentence(text: string): boolean {
  return /[.:;!?…]["'”’)\]]?$/.test(text.trim());
}

/** De tekststukjes van één pagina als tekst met alinea's (of losse regels zonder `joinLines`). */
export function layoutBlock(
  input: readonly Piece[],
  opts: LayoutOptions,
  allowColumns: boolean,
): string {
  if (input.length === 0) return '';
  const items = input.slice().sort((a, b) => b.y - a.y || a.x - b.x);
  const yTol = (median(items.map((i) => i.fh)) || 10) * 0.5;
  const minX = Math.min(...items.map((i) => i.x));
  const maxX = Math.max(...items.map((i) => i.x + i.w));

  const raw = groupLines(items, yTol);
  const gx = allowColumns ? detectGutter(raw, minX, maxX) : null;

  let lines: LaidLine[] = [];
  for (const r of raw) {
    if (gx !== null) {
      const crossing = r.items.some((i) => i.x < gx && i.x + i.w > gx);
      const left = r.items.filter((i) => i.x + i.w <= gx);
      const right = r.items.filter((i) => i.x >= gx);
      if (!crossing && left.length > 0 && right.length > 0) {
        lines.push(makeLine(left, 'L'));
        lines.push(makeLine(right, 'R'));
        continue;
      }
      lines.push(makeLine(r.items, crossing ? 'F' : right.length > 0 ? 'R' : 'L'));
    } else {
      lines.push(makeLine(r.items, null));
    }
  }
  lines.sort((a, b) => b.y - a.y);

  // Leesvolgorde: eerst de linkerkolom helemaal, dan de rechter; een regel over de volle breedte
  // onderbreekt dat.
  if (gx !== null) {
    const ordered: LaidLine[] = [];
    let left: LaidLine[] = [];
    let right: LaidLine[] = [];
    const flush = () => {
      ordered.push(...left, ...right);
      left = [];
      right = [];
    };
    for (const line of lines) {
      if (line.col === 'F') {
        flush();
        ordered.push(line);
      } else if (line.col === 'L') left.push(line);
      else right.push(line);
    }
    flush();
    lines = ordered;
  }

  if (!opts.joinLines)
    return lines
      .map((l) => l.text)
      .filter((t) => t !== '')
      .join('\n');

  // De gewone regelafstand met het eerste kwartiel schatten, niet met de mediaan: bij korte
  // alinea's zijn er evenveel alinea-afstanden als regelafstanden en landt de mediaan op de
  // alinea-afstand; dan breekt er niets meer af.
  const gaps: number[] = [];
  for (let i = 1; i < lines.length; i++) {
    const gap = lines[i - 1]!.y - lines[i]!.y;
    if (gap > 0) gaps.push(gap);
  }
  const typGap = Math.max(quantile(gaps, 0.25), median(lines.map((l) => l.fh)) * 1.05) || 12;

  // De rechtermarge per kolom. Een regel die duidelijk vóór die marge eindigt, is geen
  // doorgebroken regel maar het einde van een blok (een kop, de laatste regel van een alinea).
  const ends = new Map<string, number[]>();
  for (const line of lines) {
    const key = line.col ?? '_';
    ends.set(key, [...(ends.get(key) ?? []), line.x1]);
  }
  const edges = new Map([...ends].map(([key, x1s]) => [key, quantile(x1s, 0.9)]));
  const endsShort = (line: LaidLine) => line.x1 < edges.get(line.col ?? '_')! - line.fh * 2;

  const out: string[] = [];
  let cur = '';
  const pushCur = () => {
    if (cur !== '') out.push(cur);
    cur = '';
  };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const text = line.text;
    if (cur === '') {
      cur = text;
      continue;
    }
    const prev = lines[i - 1]!;
    const gap = prev.y - line.y;
    // Een sprong omhoog: een nieuwe kolom of een nieuw deel.
    const movedUp = line.y > prev.y + line.fh;
    const bigGap = gap > typGap * opts.gapFactor;
    const indent = line.x0 - prev.x0 > prev.fh * 1.2;
    // Een cijferopsomming is dubbelzinnig: hetzelfde patroon staat ook midden in een zin
    // ("...zoals 5.1 en / 5.4 moet..."). Alleen een reden om af te breken als de omgeving erop
    // wijst: de vorige regel sluit af met een leesteken of eindigt vóór de rechtermarge, of er
    // staat direct ervoor of erna een opsommingspunt (dan zitten we in een lijst). Een grote
    // witruimte (bigGap) breekt sowieso al.
    const next = i + 1 < lines.length ? lines[i + 1]!.text : '';
    const bulletBreak =
      isBullet(text) &&
      (!/^\s*\d/.test(text) ||
        endsSentence(prev.text) ||
        endsShort(prev) ||
        isBullet(prev.text) ||
        isBullet(next));
    if (movedUp || bigGap || indent || bulletBreak) {
      pushCur();
      cur = text;
    } else if (opts.dehyphen && /[A-Za-zÀ-ÿ]-$/.test(cur)) {
      cur = cur.replace(/-$/, '') + text.replace(/^\s+/, '');
    } else {
      cur = cur.replace(/\s+$/, '') + ' ' + text.replace(/^\s+/, '');
    }
  }
  pushCur();
  return out.filter((t) => t.trim() !== '').join('\n\n');
}

/** De tekst van een pagina, zonder de meelopende kop- en voetregel als `strip` aanstaat. */
export function pageText(page: PageText, opts: LayoutOptions, running?: RunningLines): string {
  let items = page.items;
  if (opts.strip && running && (running.dropTop || running.dropBot)) {
    const drop = new Set<Piece>();
    if (running.dropTop) running.top!.items.forEach((i) => drop.add(i));
    if (running.dropBot) running.bot!.items.forEach((i) => drop.add(i));
    items = items.filter((i) => !drop.has(i));
  }
  return layoutBlock(items, opts, opts.columns);
}
