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
  /**
   * Opsommingen en koppen herkennen, zoals de pdf-tekst-extractor ("Opsommingen & koppen"): meer
   * soorten opsommingstekens, een opsomming als één blok met enkele regelovergangen, en koppen
   * (Artikel, Hoofdstuk… of een korte losse regel) met een extra witregel erboven. Uit: de oude,
   * eenvoudigere opsommingsregel van de extractor. Niet opgegeven (zoals bij PDF's vergelijken):
   * de uitgebreide opsommingsregel, maar geen koppen en elk blok met een witregel ertussen.
   */
  structure?: boolean;
  /** Een herkende kop krijgt "{H} " vooraan (alleen met `structure`). */
  headingMarker?: boolean;
  /** Rasters van uitgelijnde cellen als tabel met tabs; dan geen kolomherkenning. */
  tables?: boolean;
};

/**
 * De grenzen van de alinea-gevoeligheid (`gapFactor`), zoals in de losse pdf-tekst-extractor. Hier,
 * zodat PDF → Platte tekst ze kan gebruiken zonder de rest van het vergelijken mee te laden.
 */
export const GAP_FACTOR = { min: 1.1, max: 2.5, step: 0.1 } as const;

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

/**
 * De tekststukjes van een pagina uit pdf.js, met het aantal tekens. `toPage` rekent de plek van een
 * stukje (in de punten van de PDF zelf) om naar de pagina zoals je die ziet, met de draaiing en de
 * uitsnede (in punten vanaf linksonder); zonder `toPage` blijft de plek zoals hij is.
 */
export function piecesFrom(
  items: readonly RawTextItem[],
  toPage?: (x: number, y: number) => [number, number],
): { items: Piece[]; chars: number } {
  const pieces: Piece[] = [];
  let chars = 0;
  for (const item of items) {
    if (!item.str) continue;
    const tr = item.transform ?? [1, 0, 0, 1, 0, 0];
    const fh = Math.hypot(tr[1]!, tr[3]!) || item.height || 10;
    const w = item.width || item.str.length * fh * 0.5;
    const [x, y] = toPage ? toPage(tr[4]!, tr[5]!) : [tr[4]!, tr[5]!];
    pieces.push({ str: item.str, x, y, fh, w });
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

/** Hoeveel groter dan de lopende tekst de letter van een kop- of voettekst hooguit is. */
export const RUNNING_MAX_SIZE = 1.15;

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
  const body = median(page.items.map((i) => i.fh)) || 10;
  const yTol = body * 0.5;
  // Een regel in een duidelijk grotere letter dan de lopende tekst is een titel, geen kop- of
  // voettekst: "Hoofdstuk 1", "Hoofdstuk 2"… bovenaan elke pagina zou anders (met de cijfers als #)
  // als terugkerende kop wegvallen. Een kop van 12 pt boven tekst van 11 pt telt nog wel als kop.
  const small = (line: Line) => Math.max(...line.items.map((i) => i.fh)) <= body * RUNNING_MAX_SIZE;
  const lines = groupLines(page.items, yTol);
  if (lines.length < 3) return none;
  const gaps: number[] = [];
  for (let i = 1; i < lines.length; i++) gaps.push(lines[i - 1]!.y - lines[i]!.y);
  const typ = quantile(gaps, 0.25) || 12;

  const first = lines[0]!;
  const last = lines[lines.length - 1]!;
  const prev = lines[lines.length - 2]!;
  return {
    top:
      first.y > page.h * 0.85 && first.y - lines[1]!.y > typ * 1.7 && small(first) ? first : null,
    bot: last.y < page.h * 0.15 && prev.y - last.y > typ * 1.7 && small(last) ? last : null,
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

/**
 * De oude, eenvoudige opsommingsregel van de extractor (als "Opsommingen & koppen" uit staat):
 * alleen •, -, *, ●, ▪ en "1." of "1)".
 */
function isBulletOld(text: string): boolean {
  return /^\s*([•\-*●▪]|\d{1,2}[.)])\s/.test(text);
}

/** Een kop met een vast woord vooraan en een nummer: "Artikel 5", "Hoofdstuk II", "Bijlage B". */
export function isKeywordHeading(text: string): boolean {
  return /^(Artikel|Hoofdstuk|Bijlage|Paragraaf|Sectie|Afdeling|Titel|Boek|Deel|Annex)\s+([0-9]+(?:[.–-][0-9]+)*|[IVXLCDM]+|[A-Z])\b/i.test(
    text.trim(),
  );
}

/**
 * Een korte losse regel die als kop telt, voorzichtig: hooguit 30 tekens en 5 woorden, zonder
 * leesteken aan het eind, met een hoofdletter of cijfer vooraan, en gevolgd door een regel die
 * minstens twee keer zo lang is.
 */
export function isGenericHeading(text: string, next: string): boolean {
  const s = text.trim();
  if (s.length < 2 || s.length > 30) return false;
  if (s.split(/\s+/).length > 5) return false;
  if (/[.,:;!?]$/.test(s)) return false;
  if (!/^[A-ZÀ-Þ0-9]/.test(s)) return false;
  return next.trim().length >= s.length * 2;
}

type Cell = { x: number; text: string };

/**
 * Een regel in cellen, gesplitst op brede tussenruimtes. pdf.js zet tussen ver uiteenstaande
 * cellen onzichtbare spaties die het gat precies opvullen: die eerst weglaten, anders lijkt elke
 * rij één cel.
 */
function lineCells(line: LaidLine): Cell[] {
  const items = line.items.filter((i) => i.str.trim() !== '');
  if (items.length === 0) return [];
  const fh = line.fh || 10;
  const groups: Piece[][] = [];
  let group: Piece[] = [items[0]!];
  for (let i = 1; i < items.length; i++) {
    const before = items[i - 1]!;
    if (items[i]!.x - (before.x + before.w) > fh * 2) {
      groups.push(group);
      group = [items[i]!];
    } else group.push(items[i]!);
  }
  groups.push(group);
  return groups.map((g) => ({ x: g[0]!.x, text: buildLineText(g) }));
}

/** Rijen van cellen als tabel: kolommen op gedeelde x-posities, cellen met een tab ertussen. */
function buildTable(rows: readonly Cell[][], fh: number): string {
  const tol = Math.max(fh * 1.5, 8);
  const xs = rows.flatMap((row) => row.map((cell) => cell.x)).sort((a, b) => a - b);
  const cols: number[] = [];
  for (const x of xs) if (cols.length === 0 || x - cols[cols.length - 1]! > tol) cols.push(x);
  return rows
    .map((row) => {
      const cells = cols.map(() => '');
      for (const cell of row) {
        let best = 0;
        let distance = Infinity;
        cols.forEach((cx, ci) => {
          const d = Math.abs(cx - cell.x);
          if (d < distance) {
            distance = d;
            best = ci;
          }
        });
        cells[best] = cells[best] ? `${cells[best]} ${cell.text}` : cell.text;
      }
      return cells.join('\t');
    })
    .join('\n');
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
  // Bij tabellen geen kolommen: de kolommen van een tabel zouden anders als goot tellen.
  const gx = allowColumns && !opts.tables ? detectGutter(raw, minX, maxX) : null;

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

  // Opsommingen en koppen: alleen als `structure` is opgegeven (Platte tekst); de vergelijker
  // houdt zijn eigen regels.
  const structure = opts.structure === true;
  const bulletRule = opts.structure === false ? isBulletOld : isBullet;

  // Tabellen: een reeks van minstens twee regels die elk in twee of meer cellen uiteenvallen.
  const cells = opts.tables ? lines.map(lineCells) : [];
  const inTable = lines.map((_, i) => (cells[i]?.length ?? 0) >= 2);
  for (let i = 0; i < lines.length;) {
    if (!inTable[i]) {
      i++;
      continue;
    }
    let j = i;
    while (j < lines.length && inTable[j]) j++;
    if (j - i < 2) for (let k = i; k < j; k++) inTable[k] = false;
    i = j;
  }

  type Block = { text: string; bullet: boolean; heading: boolean };
  const out: Block[] = [];
  let cur = '';
  let curBullet = false;
  let curHeading = false;
  const pushCur = () => {
    if (cur !== '') out.push({ text: cur, bullet: curBullet, heading: curHeading });
    cur = '';
  };
  const startBlock = (text: string, next: string) => {
    cur = text;
    curBullet = structure && isBullet(text);
    curHeading = structure && (isKeywordHeading(text) || isGenericHeading(text, next));
  };
  for (let i = 0; i < lines.length; i++) {
    if (inTable[i]) {
      pushCur();
      let j = i;
      while (j < lines.length && inTable[j]) j++;
      const fh = median(lines.slice(i, j).map((l) => l.fh)) || 10;
      out.push({ text: buildTable(cells.slice(i, j), fh), bullet: false, heading: false });
      i = j - 1;
      continue;
    }
    const line = lines[i]!;
    const text = line.text;
    const next = i + 1 < lines.length ? lines[i + 1]!.text : '';
    if (cur === '') {
      startBlock(text, next);
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
    const bulletBreak =
      bulletRule(text) &&
      (!/^\s*\d/.test(text) ||
        endsSentence(prev.text) ||
        endsShort(prev) ||
        bulletRule(prev.text) ||
        bulletRule(next));
    // Een kop met een vast woord begint altijd een nieuw blok, en na een kop ook.
    const keywordHeading = structure && isKeywordHeading(text);
    if (movedUp || bigGap || indent || bulletBreak || keywordHeading || curHeading) {
      pushCur();
      startBlock(text, next);
    } else if (opts.dehyphen && /[A-Za-zÀ-ÿ]-$/.test(cur)) {
      cur = cur.replace(/-$/, '') + text.replace(/^\s+/, '');
    } else {
      cur = cur.replace(/\s+$/, '') + ' ' + text.replace(/^\s+/, '');
    }
  }
  pushCur();

  // Samenstellen: een witregel tussen blokken; opeenvolgende opsommingspunten met een enkele
  // regelovergang; een kop met een extra witregel erboven (en eventueel "{H} " ervoor).
  const blocks = out.filter((block) => block.text.trim() !== '');
  return blocks
    .map((block, i) => {
      const before =
        i === 0
          ? ''
          : block.heading
            ? '\n\n\n'
            : block.bullet && blocks[i - 1]!.bullet
              ? '\n'
              : '\n\n';
      return before + (block.heading && opts.headingMarker ? '{H} ' : '') + block.text;
    })
    .join('');
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
