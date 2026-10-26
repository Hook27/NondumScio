import type { Point, Size } from '../annotations/geometry';

/**
 * De tekst van een pagina, met van elk teken de plek. De plekken staan in de basisstand van de
 * pagina (punten, linksboven, y omlaag), zoals de annotaties, zodat een treffer rechtstreeks een
 * redactievak kan worden. Een pagina bestaat uit stukjes tekst ("runs"): een tekstfragment uit de
 * PDF of een woord van de tekstherkenning. Per stuk is bekend waar het staat; de plek van de
 * tekens daarin wordt uit hun breedte geschat.
 */

/** Een stuk tekst op één regel, als een scheef te zetten vlak. */
export type Run = {
  chars: string[];
  /** Linksonder van het vlak (begin van de regel, iets onder de basislijn). */
  origin: Point;
  /** Van linksonder naar rechtsonder: de richting en lengte van de tekst. */
  along: Point;
  /** Van linksonder naar linksboven: de hoogte van de tekst. */
  up: Point;
  /** Per teken waar het begint (breedte tot dan toe); één langer dan `chars`. */
  cumulative: number[];
};

export type PageText = {
  /** Alle tekens van de pagina, met tussen de stukken een spatie of nieuwe regel. */
  chars: string[];
  /** Per teken: het stuk waar het bij hoort, of -1 voor een teken tussen stukken. */
  owner: number[];
  /** Per teken: de plek binnen zijn stuk. */
  offset: number[];
  runs: Run[];
  size: Size;
};

export type Rect = { x0: number; y0: number; x1: number; y1: number };
export type Box = { x: number; y: number; width: number; height: number };

/* De breedte van een teken, naar de standaardletter Helvetica (in duizendsten). */

const widths: Record<string, number> = {};
const setWidths = (chars: string, values: number[]) =>
  [...chars].forEach((char, i) => (widths[char] = values[i]!));
setWidths(
  'ABCDEFGHIJKLMNOPQRSTUVWXYZ',
  [
    667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778, 667, 778, 722, 667,
    611, 722, 667, 944, 667, 667, 611,
  ],
);
setWidths(
  'abcdefghijklmnopqrstuvwxyz',
  [
    556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556, 556, 556, 333, 500,
    278, 556, 500, 722, 500, 500, 500,
  ],
);
setWidths(' .,:;!/', [278, 278, 278, 278, 278, 278, 278]);
setWidths(
  '-()_@\'"+=&%#$*?',
  [333, 333, 333, 556, 1015, 191, 355, 584, 584, 667, 889, 556, 556, 389, 556],
);

/** Hoe breed een teken ongeveer is ten opzichte van de andere; een letter met accent als zijn letter. */
export function charWidth(char: string): number {
  return widths[char] ?? widths[char.normalize('NFD')[0]!] ?? 556;
}

/** Een stuk tekst op een plek: tekens met hun breedte voor het verdelen van de lengte. */
export function makeRun(text: string, origin: Point, along: Point, up: Point): Run {
  const chars = [...text];
  const cumulative = [0];
  for (const char of chars) cumulative.push(cumulative[cumulative.length - 1]! + charWidth(char));
  return { chars, origin, along, up, cumulative };
}

/** Een pagina uit stukken; `after` is wat er achter een stuk staat: niets, een spatie of een nieuwe regel. */
export function buildPageText(
  entries: readonly { run: Run; after: '' | ' ' | '\n' }[],
  size: Size,
): PageText {
  const text: PageText = { chars: [], owner: [], offset: [], runs: [], size };
  entries.forEach(({ run, after }, index) => {
    text.runs.push(run);
    run.chars.forEach((char, i) => {
      text.chars.push(char);
      text.owner.push(index);
      text.offset.push(i);
    });
    if (after !== '' && run.chars.length > 0 && index < entries.length - 1) {
      text.chars.push(after);
      text.owner.push(-1);
      text.offset.push(0);
    }
  });
  return text;
}

/** Het aantal tekens op de pagina dat geen witruimte is. */
export function visibleCount(text: PageText): number {
  return text.chars.filter((char) => !/^\s$/.test(char)).length;
}

/** Het vlak waar de tekens `from` tot `to` van een stuk samen innemen, als omlijnend rechthoek. */
function runRect(run: Run, from: number, to: number): Rect {
  const total = run.cumulative[run.chars.length]!;
  const t0 = total > 0 ? run.cumulative[from]! / total : from / run.chars.length;
  const t1 = total > 0 ? run.cumulative[to]! / total : to / run.chars.length;
  const xs: number[] = [];
  const ys: number[] = [];
  for (const t of [t0, t1]) {
    for (const lift of [0, 1]) {
      xs.push(run.origin.x + run.along.x * t + run.up.x * lift);
      ys.push(run.origin.y + run.along.y * t + run.up.y * lift);
    }
  }
  return { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) };
}

/** De marge rondom een vak (in punten) bij een tekst van deze hoogte: de schatting van de plek is niet exact. */
export function padding(height: number): number {
  return 0.12 * height + 0.5;
}

/**
 * De vakken die een plek in de tekst afdekken: één per regel (een naam die over twee regels
 * loopt, geeft twee vakken), met marge en binnen de pagina gehouden.
 */
export function boxesFor(text: PageText, start: number, end: number): Box[] {
  const pieces: Rect[] = [];
  for (let i = start; i < end;) {
    const owner = text.owner[i]!;
    if (owner < 0) {
      i += 1;
      continue;
    }
    let last = i;
    while (last + 1 < end && text.owner[last + 1] === owner) last += 1;
    pieces.push(runRect(text.runs[owner]!, text.offset[i]!, text.offset[last]! + 1));
    i = last + 1;
  }

  // Stukken die op dezelfde regel staan en dicht bij elkaar, worden één vak.
  const lines: Rect[] = [];
  for (const piece of pieces) {
    const previous = lines[lines.length - 1];
    const height = piece.y1 - piece.y0;
    if (previous) {
      const shared = Math.min(previous.y1, piece.y1) - Math.max(previous.y0, piece.y0);
      const smaller = Math.min(previous.y1 - previous.y0, height);
      const gap = Math.max(previous.x0, piece.x0) - Math.min(previous.x1, piece.x1);
      if (shared >= 0.5 * smaller && gap <= Math.max(previous.y1 - previous.y0, height)) {
        previous.x0 = Math.min(previous.x0, piece.x0);
        previous.y0 = Math.min(previous.y0, piece.y0);
        previous.x1 = Math.max(previous.x1, piece.x1);
        previous.y1 = Math.max(previous.y1, piece.y1);
        continue;
      }
    }
    lines.push({ ...piece });
  }

  const boxes: Box[] = [];
  for (const line of lines) {
    const pad = padding(line.y1 - line.y0);
    const x0 = Math.max(0, line.x0 - pad);
    const y0 = Math.max(0, line.y0 - pad);
    const x1 = Math.min(text.size.width, line.x1 + pad);
    const y1 = Math.min(text.size.height, line.y1 + pad);
    if (x1 > x0 && y1 > y0) boxes.push({ x: x0, y: y0, width: x1 - x0, height: y1 - y0 });
  }
  return boxes;
}
