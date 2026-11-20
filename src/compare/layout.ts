/**
 * Van de losse tekststukjes van een PDF-pagina weer leesbare tekst maken: regels, twee kolommen,
 * terugkerende kop- en voetteksten, afgebroken woorden en alinea's. Overgenomen uit de losse
 * pdf-vergelijker (die dezelfde opmaakregels heeft als de pdf-tekst-extractor); de keuzes en
 * drempels zijn daar op echte documenten afgesteld en hier bewust gelijk gehouden.
 */

/**
 * Eén tekststukje zoals pdf.js het geeft: tekst, plek (linksonder, in punten) en maat. `turn`: de
 * richting van de tekst op de pagina zoals je die ziet, in graden tegen de klok in (90 = van onder
 * naar boven), alleen als het stukje gedraaid staat (zie `TURN_TOLERANCE`); `w` is dan de lengte
 * langs die richting.
 */
export type Piece = { str: string; x: number; y: number; fh: number; w: number; turn?: number };

/**
 * Hoeveel graden een stukje scheef mag staan en toch gewone tekst is: een tekstlaag van een iets
 * scheve scan blijft dan gewoon lopende tekst. Een watermerk (meestal 30 tot 60 graden) of
 * verticale tekst in de marge valt er ruim buiten.
 */
export const TURN_TOLERANCE = 5;

/**
 * De richting van een vector in hele graden, van 0 tot en met 360 (tegen de klok in). 360 komt
 * alleen voor bij minder dan een halve graad onder recht, en dat telt toch als recht.
 */
function degreesOf(dx: number, dy: number): number {
  return Math.round(((Math.atan2(dy, dx) * 180) / Math.PI + 360) % 360);
}

/** Het midden van een tekststukje, ook als het gedraaid staat. */
export function centerOf(piece: Piece): { x: number; y: number } {
  const angle = ((piece.turn ?? 0) * Math.PI) / 180;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  return {
    x: piece.x + (piece.w / 2) * cos - (piece.fh / 2) * sin,
    y: piece.y + (piece.w / 2) * sin + (piece.fh / 2) * cos,
  };
}

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
/** De kolom van een regel: het nummer (0 = links), 'F' over de volle breedte, of null (geen kolommen). */
type Column = number | 'F' | null;
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
    // De richting zoals je de pagina ziet: met de draaiing en uitsnede van de pagina.
    const [ax, ay] = toPage ? toPage(tr[4]! + tr[0]!, tr[5]! + tr[1]!) : [x + tr[0]!, y + tr[1]!];
    const turn = degreesOf(ax - x, ay - y);
    const flat = Math.min(turn, 360 - turn) <= TURN_TOLERANCE;
    pieces.push(flat ? { str: item.str, x, y, fh, w } : { str: item.str, x, y, fh, w, turn });
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
  // Gedraaide tekst (een watermerk, een strook in de marge) is geen kop- of voetregel.
  const items = page.items.filter((i) => i.turn === undefined);
  if (items.length < 2) return none;
  const body = median(items.map((i) => i.fh)) || 10;
  const yTol = body * 0.5;
  // Een regel in een duidelijk grotere letter dan de lopende tekst is een titel, geen kop- of
  // voettekst: "Hoofdstuk 1", "Hoofdstuk 2"… bovenaan elke pagina zou anders (met de cijfers als #)
  // als terugkerende kop wegvallen. Een kop van 12 pt boven tekst van 11 pt telt nog wel als kop.
  const small = (line: Line) => Math.max(...line.items.map((i) => i.fh)) <= body * RUNNING_MAX_SIZE;
  const lines = groupLines(items, yTol);
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

/** Een stukje met alleen witruimte (zie `detectGutter`). */
const isBlank = (piece: Piece): boolean => piece.str.trim() === '';

/**
 * Zoekt de "goot" tussen twee kolommen: in tekst met twee kolommen heeft bijna elke regel een
 * brede witruimte rond dezelfde plek. Geeft die plek (x), of null. Stukjes met alleen witruimte
 * tellen niet mee: staan twee kolommen regel voor regel in het bestand, dan zet pdf.js een spatie
 * die het hele gat overbrugt (audit F22).
 */
function detectGutter(lines: readonly Line[], minX: number, maxX: number): number | null {
  const width = maxX - minX;
  if (width <= 0 || lines.length < 6) return null;
  const lo = minX + width * 0.25;
  const hi = minX + width * 0.75;
  const mids: number[] = [];
  let counted = 0;
  // Regels met meer dan één breed gat: losse cellen van een tabel, geen twee kolommen tekst.
  let cells = 0;
  for (const line of lines) {
    const its = line.items.filter((i) => !isBlank(i));
    if (its.length < 2) continue;
    counted++;
    const fh = Math.max(...its.map((i) => i.fh)) || 10;
    let bestGap = 0;
    let mid: number | null = null;
    let wide = 0;
    for (let i = 1; i < its.length; i++) {
      const before = its[i - 1]!;
      const gap = its[i]!.x - (before.x + before.w);
      if (gap > fh * 2) wide++;
      if (gap > bestGap) {
        bestGap = gap;
        mid = (its[i]!.x + before.x + before.w) / 2;
      }
    }
    if (wide > 1) cells++;
    if (bestGap > fh * 2 && mid !== null && mid > lo && mid < hi) mids.push(mid);
  }
  // Een tabel heeft ook brede gaten op dezelfde plek. Bestaan de meeste regels uit losse cellen,
  // dan blijft het een tabel, per rij in de tekst, zoals tot nu toe (de overbruggende spaties van
  // audit F22 verborgen de gaten). Staat er maar een deel, dan is het geen tabel van de pagina.
  if (cells * 2 > counted) return null;
  if (mids.length < Math.max(4, counted * 0.25)) return null;
  mids.sort((a, b) => a - b);
  return mids[Math.floor(mids.length / 2)]!;
}

/**
 * Begint de regel met een opsommingsteken of een nummer? Nummergroepen bewust op 1 of 2 cijfers
 * gehouden: anders wordt een bedrag als "390.000 euro" of een jaartal als "2018." als
 * paragraafnummer gelezen en breekt de alinea midden in een zin af. Een Romeins cijfer alleen als
 * echt cijfer met i, v en x (i tot en met xxxix, niet gemengd): "mi.", "mm." of "dl." zijn
 * afkortingen, geen opsomming (audit F15).
 */
export function isBullet(text: string): boolean {
  return /^\s*([•*●▪]|[-–—]|\d{1,3}(?:\.\d{1,2})+\.?|\d{1,2}[.)]|[A-Za-z][.)]|(?=[ivx])x{0,3}(?:ix|iv|v?i{0,3})[.)]|(?=[IVX])X{0,3}(?:IX|IV|V?I{0,3})[.)])\s/.test(
    text,
  );
}

/**
 * Heeft de pagina een tekstlaag? Een pagina met alleen spaties telt niet (audit F15): die kan niet
 * gelezen worden, net als een scan.
 */
export const hasTextLayer = (page: Pick<PageText, 'items'>): boolean =>
  page.items.some((item) => item.str.trim() !== '');

/** Hoeveel pagina's geen tekstlaag hebben (zie `hasTextLayer`). */
export const withoutTextLayer = (pages: readonly Pick<PageText, 'items'>[]): number =>
  pages.filter((page) => !hasTextLayer(page)).length;

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

/** De vaste woorden voor een kop, in het Nederlands en het Engels. */
const HEADING_WORDS = [
  'Artikel',
  'Hoofdstuk',
  'Bijlage',
  'Paragraaf',
  'Sectie',
  'Afdeling',
  'Titel',
  'Boek',
  'Deel',
  'Annex',
  'Chapter',
  'Section',
  'Article',
  'Appendix',
  'Part',
];

const KEYWORD_HEADING = new RegExp(
  `^(?:${HEADING_WORDS.join('|')}|${HEADING_WORDS.map((word) => word.toUpperCase()).join('|')})\\s+([0-9]+(?:[.–-][0-9]+)*|[IVXLCDM]+|[A-Z])\\b`,
);

/**
 * Een kop met een vast woord vooraan en een nummer: "Artikel 5", "Hoofdstuk II", "Bijlage B",
 * "Chapter 3". Alleen met een hoofdletter vooraan (of alles in hoofdletters): "artikel 5 van de wet"
 * is een afgebroken zin, geen kop (audit F15).
 */
export function isKeywordHeading(text: string): boolean {
  return KEYWORD_HEADING.test(text.trim());
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

/** Een gedraaid stukje teruggedraaid, zodat het horizontaal staat (draaien om de oorsprong). */
function unturn(piece: Piece): Piece {
  const angle = ((piece.turn ?? 0) * Math.PI) / 180;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  return {
    str: piece.str,
    x: piece.x * cos + piece.y * sin,
    y: piece.y * cos - piece.x * sin,
    fh: piece.fh,
    w: piece.w,
  };
}

/** Een verticale strook witruimte in een blok tekst: van `x0` tot `x1`. */
type Strip = { x0: number; x1: number };

/**
 * De verticale stroken witruimte in een blok: plekken waar hooguit `maxCross` regels tekst hebben,
 * minstens `minWidth` breed, met aan beide kanten tekst. Stukjes met alleen witruimte tellen niet
 * (audit F22). Per punt bekeken, van links naar rechts.
 */
function whiteStrips(
  lines: readonly Line[],
  minX: number,
  maxX: number,
  maxCross: number,
  minWidth: number,
): Strip[] {
  const spans = lines.map((line) =>
    line.items.filter((i) => !isBlank(i)).map((i) => [i.x, i.x + i.w] as const),
  );
  const strips: Strip[] = [];
  let start: number | null = null;
  for (let x = Math.floor(minX); x <= Math.ceil(maxX); x++) {
    const at = x + 0.5;
    const cover = spans.filter((line) => line.some(([a, b]) => a < at && b > at)).length;
    if (cover <= maxCross) start ??= x;
    else if (start !== null) {
      if (x - start >= minWidth && start > minX) strips.push({ x0: start, x1: x });
      start = null;
    }
  }
  return strips;
}

/** De mediaan van de lettergrootte van de stukjes met tekst. */
const bodySize = (items: readonly Piece[]): number =>
  median(items.filter((i) => !isBlank(i)).map((i) => i.fh)) || 10;

/**
 * Een smalle kolom aan de rand met kantlijnnoten (wens 20-11, deel C): links of rechts van de
 * lopende tekst, hooguit 30 procent van de breedte, gescheiden door een strook witruimte, in een
 * kleinere letter dan de lopende tekst, met woorden (geen losse nummers van een lijst) op minstens
 * twee regels, naast minstens zes regels lopende tekst. Geeft de stukjes van die kolom, of null.
 */
function marginNotes(lines: readonly Line[], minX: number, maxX: number): Set<Piece> | null {
  const items = lines.flatMap((line) => line.items.filter((i) => !isBlank(i)));
  const fh = bodySize(items);
  const width = maxX - minX;
  for (const strip of whiteStrips(lines, minX, maxX, 0, fh * 1.5)) {
    for (const left of [true, false]) {
      if ((left ? strip.x0 - minX : maxX - strip.x1) > width * 0.3) continue;
      // Het midden van de strook: de randen zijn op hele punten afgerond (zie `whiteStrips`).
      const mid = (strip.x0 + strip.x1) / 2;
      const side = items.filter((i) => (left ? i.x + i.w <= mid : i.x >= mid));
      const body = items.filter((i) => !side.includes(i));
      const sideLines = lines.filter((line) => line.items.some((i) => side.includes(i))).length;
      const bodyLines = lines.filter((line) => line.items.some((i) => body.includes(i))).length;
      if (sideLines < 2 || bodyLines < 6) continue;
      if (bodySize(side) > bodySize(body) * 0.9) continue;
      if (!side.some((i) => /\p{L}{2}/u.test(i.str))) continue;
      return new Set(side);
    }
  }
  return null;
}

/**
 * Kolommen (wens 20-11, deel C): verticale stroken witruimte over het hele blok, waar ook (niet
 * alleen in het midden), met hooguit een paar regels over de volle breedte (zoals een titel), en
 * elke kolom ertussen gevuld met doorlopende tekst: minstens tien letters breed, de regels vullen
 * hem voor minstens 60 procent, op minstens een kwart van de regels. Een tabel heeft ook zulke
 * stroken, maar losse cellen vullen hun kolom niet; die blijft per rij. Geeft de plekken van de
 * goten (x), of null; dan geldt de oudere herkenning van twee kolommen (`detectGutter`).
 */
function detectColumns(lines: readonly Line[], minX: number, maxX: number): number[] | null {
  if (lines.length < 6) return null;
  const fh = bodySize(lines.flatMap((line) => line.items));
  const maxCross = Math.max(2, Math.ceil(lines.length * 0.15));
  const gutters = whiteStrips(lines, minX, maxX, maxCross, fh * 1.5).map((s) => (s.x0 + s.x1) / 2);
  if (gutters.length === 0) return null;
  const edges = [minX, ...gutters, maxX];
  for (let c = 0; c + 1 < edges.length; c++) {
    const [from, to] = [edges[c]!, edges[c + 1]!];
    if (to - from < fh * 10) return null;
    const extents = lines.flatMap((line) => {
      const inside = line.items.filter((i) => !isBlank(i) && i.x >= from && i.x + i.w <= to);
      if (inside.length === 0) return [];
      return [Math.max(...inside.map((i) => i.x + i.w)) - Math.min(...inside.map((i) => i.x))];
    });
    if (extents.length < Math.max(3, lines.length * 0.25)) return null;
    if (median(extents) < (to - from) * 0.6) return null;
  }
  return gutters;
}

/**
 * De tekststukjes van één pagina als tekst met alinea's (of losse regels zonder `joinLines`).
 * Gedraaide tekst (een watermerk, een strook in de marge) doet niet mee met de lopende tekst: die
 * komt per richting als eigen blok erachter, teruggedraaid en met dezelfde regels gelezen (zonder
 * kolommen). Zo breekt "CONCEPT" geen zin meer, en wordt een verticale strook één regel.
 */
export function layoutBlock(
  input: readonly Piece[],
  opts: LayoutOptions,
  allowColumns: boolean,
): string {
  if (input.some((i) => i.turn !== undefined)) {
    const turns = [...new Set(input.flatMap((i) => (i.turn === undefined ? [] : [i.turn])))];
    const flat = input.filter((i) => i.turn === undefined);
    return [
      layoutBlock(flat, opts, allowColumns),
      ...turns
        .sort((a, b) => a - b)
        .map((turn) => layoutBlock(input.filter((i) => i.turn === turn).map(unturn), opts, false)),
    ]
      .filter((text) => text !== '')
      .join('\n\n');
  }
  if (input.length === 0) return '';
  const items = input.slice().sort((a, b) => b.y - a.y || a.x - b.x);
  const yTol = (median(items.map((i) => i.fh)) || 10) * 0.5;
  const minX = Math.min(...items.map((i) => i.x));
  const maxX = Math.max(...items.map((i) => i.x + i.w));

  const raw = groupLines(items, yTol);
  // Bij tabellen geen kolommen: de kolommen van een tabel zouden anders als goot tellen.
  const columns = allowColumns && !opts.tables;
  // Kantlijnnoten: als eigen blok na de lopende tekst, zodat ze geen zin onderbreken.
  const notes = columns ? marginNotes(raw, minX, maxX) : null;
  if (notes) {
    return [
      layoutBlock(
        input.filter((i) => !notes.has(i)),
        opts,
        allowColumns,
      ),
      layoutBlock([...notes], opts, false),
    ]
      .filter((text) => text !== '')
      .join('\n\n');
  }
  // Kolommen met gevulde tekst; anders twee zoals altijd, of geen.
  const gx = columns ? detectGutter(raw, minX, maxX) : null;
  const gutters = columns ? (detectColumns(raw, minX, maxX) ?? (gx === null ? [] : [gx])) : [];

  let lines: LaidLine[] = [];
  for (const r of raw) {
    if (gutters.length === 0) {
      lines.push(makeLine(r.items, null));
      continue;
    }
    // Een spatie over een goot (audit F22) telt niet: die valt bij het splitsen weg.
    const crossing = r.items.some(
      (i) => !isBlank(i) && gutters.some((g) => i.x < g && i.x + i.w > g),
    );
    if (crossing) {
      lines.push(makeLine(r.items, 'F'));
      continue;
    }
    const edges = [-Infinity, ...gutters, Infinity];
    for (let c = 0; c + 1 < edges.length; c++) {
      const part = r.items.filter((i) => i.x >= edges[c]! && i.x + i.w <= edges[c + 1]!);
      if (part.some((i) => !isBlank(i))) lines.push(makeLine(part, c));
    }
  }
  lines.sort((a, b) => b.y - a.y);

  // Leesvolgorde: de kolommen van links naar rechts, elk helemaal; een regel over de volle breedte
  // onderbreekt dat.
  if (gutters.length > 0) {
    const ordered: LaidLine[] = [];
    let parts: LaidLine[][] = gutters.map(() => []).concat([[]]);
    const flush = () => {
      for (const part of parts) ordered.push(...part);
      parts = parts.map(() => []);
    };
    for (const line of lines) {
      if (line.col === 'F') {
        flush();
        ordered.push(line);
      } else parts[line.col as number]!.push(line);
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
    const key = String(line.col ?? '_');
    ends.set(key, [...(ends.get(key) ?? []), line.x1]);
  }
  const edges = new Map([...ends].map(([key, x1s]) => [key, quantile(x1s, 0.9)]));
  const endsShort = (line: LaidLine) => line.x1 < edges.get(String(line.col ?? '_'))! - line.fh * 2;

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
    // Een letter of Romeins cijfer ("A. Jansen", "iv.") is net zo dubbelzinnig (audit F15); alleen
    // een opsommingsteken (•, -) breekt altijd.
    const bulletBreak =
      bulletRule(text) &&
      (!/^\s*[\dA-Za-z]/.test(text) ||
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
