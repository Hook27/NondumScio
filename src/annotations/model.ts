/**
 * Annotaties: tekst, markeringen en vormen die je op een pagina zet. Ze horen bij een
 * pagina van het pagina-plan (`page` is `PageItem.key`) en bewegen dus mee als die pagina
 * verplaatst of gedraaid wordt. Opgeslagen worden ze in de pagina zelf getekend.
 *
 * Alle plaatsen en maten zijn in punten (1 punt = 1/72 inch), gemeten op de pagina zoals die
 * er zonder extra draaiing uitziet ("basisstand": met de draaiing die de pagina in het origineel
 * al heeft), met de oorsprong linksboven en y naar beneden. Zo blijft een annotatie op dezelfde
 * plek van de inhoud staan, ook als je de pagina daarna draait.
 */

export type Tool = 'select' | 'text' | 'highlight' | 'rect' | 'line';

export type TextAnnotation = {
  id: number;
  page: number;
  kind: 'text';
  /** Linksboven van het tekstvak. */
  x: number;
  y: number;
  text: string;
  /** Lettergrootte in punten. */
  size: number;
  color: string;
};

/** Een gekleurd vlak: een markering (doorzichtig) of een rechthoek (alleen de rand). */
export type BoxAnnotation = {
  id: number;
  page: number;
  kind: 'highlight' | 'rect';
  x: number;
  y: number;
  width: number;
  height: number;
  color: string;
  /** Dikte van de rand in punten (alleen bij `rect`). */
  strokeWidth: number;
};

export type LineAnnotation = {
  id: number;
  page: number;
  kind: 'line';
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  color: string;
  strokeWidth: number;
};

export type Annotation = TextAnnotation | BoxAnnotation | LineAnnotation;

/** De kleuren om uit te kiezen; de naam (voor de vertaling) en de kleur zelf. */
export const COLORS = [
  { id: 'black', value: '#111827' },
  { id: 'red', value: '#d92d20' },
  { id: 'blue', value: '#2c56c9' },
  { id: 'green', value: '#1a7f37' },
  { id: 'yellow', value: '#ffd60a' },
  { id: 'pink', value: '#ff5fa2' },
] as const;

export type ColorId = (typeof COLORS)[number]['id'];

/** Standaardkleur per gereedschap. */
export const DEFAULT_COLOR: Record<Exclude<Tool, 'select'>, string> = {
  text: '#111827',
  highlight: '#ffd60a',
  rect: '#d92d20',
  line: '#d92d20',
};

export const TEXT_SIZES = [10, 12, 14, 18, 24, 36] as const;
export const STROKE_WIDTHS = [1, 2, 4, 6] as const;
export const DEFAULT_TEXT_SIZE = 14;
export const DEFAULT_STROKE_WIDTH = 2;

/** Een markering is doorzichtig, zodat de tekst eronder leesbaar blijft. */
export const HIGHLIGHT_OPACITY = 0.4;

/** Een regel tekst is zo veel keer de lettergrootte hoog. */
export const LINE_HEIGHT = 1.2;

/** De basislijn van de tekst ligt zo ver (in lettergroottes) onder de bovenkant van de regel. */
export const BASELINE = (LINE_HEIGHT - (0.905 + 0.212)) / 2 + 0.905;

/** Het kleinste vak of de kortste lijn dat getekend wordt (in punten): een klik is geen tekening. */
export const MIN_DRAW = 4;

/** Het standaardformaat van een vak dat met het toetsenbord wordt geplaatst. */
export const KEYBOARD_BOX = { width: 140, height: 28 };

/** Annotaties van één pagina, in de volgorde waarin ze zijn gemaakt (onderaan = eerst). */
export function annotationsOf(annotations: readonly Annotation[], page: number): Annotation[] {
  return annotations.filter((annotation) => annotation.page === page);
}

/** Een annotatie verplaatst over (dx, dy) punten. */
export function moved(annotation: Annotation, dx: number, dy: number): Annotation {
  if (annotation.kind === 'line') {
    return {
      ...annotation,
      x1: annotation.x1 + dx,
      y1: annotation.y1 + dy,
      x2: annotation.x2 + dx,
      y2: annotation.y2 + dy,
    };
  }
  return { ...annotation, x: annotation.x + dx, y: annotation.y + dy };
}

/**
 * Een vak uit twee hoeken (in elke volgorde): de linkerbovenhoek en de afmetingen, altijd
 * positief.
 */
export function boxFrom(x1: number, y1: number, x2: number, y2: number) {
  return {
    x: Math.min(x1, x2),
    y: Math.min(y1, y2),
    width: Math.abs(x2 - x1),
    height: Math.abs(y2 - y1),
  };
}

/** Of een annotatie zo klein is dat het een klik was en geen tekening. */
export function tooSmall(annotation: Annotation): boolean {
  if (annotation.kind === 'text') return annotation.text.trim() === '';
  if (annotation.kind === 'line') {
    return Math.hypot(annotation.x2 - annotation.x1, annotation.y2 - annotation.y1) < MIN_DRAW;
  }
  return annotation.width < MIN_DRAW || annotation.height < MIN_DRAW;
}

/** Een annotatie, met zijn plek binnen de pagina gehouden (minstens een klein deel blijft zichtbaar). */
export function keptOnPage(
  annotation: Annotation,
  page: { width: number; height: number },
): Annotation {
  const clampX = (x: number) => Math.min(Math.max(x, 0), page.width);
  const clampY = (y: number) => Math.min(Math.max(y, 0), page.height);
  if (annotation.kind === 'line') {
    return {
      ...annotation,
      x1: clampX(annotation.x1),
      y1: clampY(annotation.y1),
      x2: clampX(annotation.x2),
      y2: clampY(annotation.y2),
    };
  }
  if (annotation.kind === 'text') {
    return { ...annotation, x: clampX(annotation.x), y: clampY(annotation.y) };
  }
  const x = Math.min(Math.max(annotation.x, 0), Math.max(page.width - annotation.width, 0));
  const y = Math.min(Math.max(annotation.y, 0), Math.max(page.height - annotation.height, 0));
  return { ...annotation, x, y };
}

/* Tekens die de standaardletter (Helvetica) kan tekenen */

/** Leestekens en letters die naast Latin-1 in "WinAnsi" zitten (het tekenstelsel van PDF's). */
const WIN_ANSI_EXTRA = new Set('€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ'.split(''));

/** Of de standaardletter dit teken kan tekenen. Nieuwe regels tellen mee. */
export function canDraw(char: string): boolean {
  if (char === '\n') return true;
  const code = char.codePointAt(0)!;
  if (code >= 0x20 && code <= 0x7e) return true;
  if (code >= 0xa0 && code <= 0xff) return true;
  return WIN_ANSI_EXTRA.has(char);
}

/** De tekens in een tekst die niet getekend kunnen worden, elk één keer. */
export function unsupportedChars(text: string): string[] {
  return [...new Set([...text].filter((char) => !canDraw(char)))];
}

/** De tekst zoals hij getekend wordt: wat niet kan wordt een vraagteken. Regeleinden normaal. */
export function drawableText(text: string): string {
  return [...text.replace(/\r\n?/g, '\n')].map((char) => (canDraw(char) ? char : '?')).join('');
}
