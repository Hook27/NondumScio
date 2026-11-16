/**
 * De greepjes om een vak groter of kleiner te maken, overal hetzelfde: in Bewerken en Redigeren
 * (de annotaties) en in PDF → Platte tekst (de leesvakken). Acht vierkantjes, op de hoeken en
 * midden op de zijden, genoemd naar de windrichting zoals je het vak op het scherm ziet. De
 * vormgeving en de muisaanwijzer staan in de stijl (`.handle`, `.handle--nw` …).
 */

/** Welke kant of hoek van een vak je versleept: n(oord) = boven, e = rechts, s = onder, w = links. */
export type Handle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w';

/** De maat van een greepje in beeldpunten, met zijn rand van 1 erbij (ook zo in de stijl). */
export const HANDLE_SIZE = 12;

/** Alle greepjes, rechtsom vanaf linksboven. */
export const HANDLES: readonly Handle[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];

/** Een vak als zijn vier randen: links (x0), boven (y0), rechts (x1) en onder (y1). */
export type Edges = { x0: number; y0: number; x1: number; y1: number };

/** Waar een greepje staat: op een hoek, of midden op een zijde. */
export function handlePoint({ x0, y0, x1, y1 }: Edges, handle: Handle) {
  const x = handle.includes('w') ? x0 : handle.includes('e') ? x1 : (x0 + x1) / 2;
  const y = handle.includes('n') ? y0 : handle.includes('s') ? y1 : (y0 + y1) / 2;
  return { x, y };
}

/**
 * Het vak met de versleepte kant of hoek op (`x`, `y`); de andere kanten blijven staan. Een
 * zijgreepje verandert dus maar één maat. Voorbij de overkant gesleept staan de randen omgekeerd:
 * wie het gebruikt, zet ze weer op volgorde.
 */
export function dragEdges(edges: Edges, handle: Handle, x: number, y: number): Edges {
  const next = { ...edges };
  if (handle.includes('w')) next.x0 = x;
  if (handle.includes('e')) next.x1 = x;
  if (handle.includes('n')) next.y0 = y;
  if (handle.includes('s')) next.y1 = y;
  return next;
}
