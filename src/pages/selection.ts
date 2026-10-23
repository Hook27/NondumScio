/**
 * Selecteren van pagina's, zoals in een bestandsverkenner:
 * - klik: alleen deze pagina
 * - Ctrl/Cmd + klik: deze pagina erbij of eraf
 * - Shift + klik: alles tussen de vorige klik (het anker) en deze pagina
 */

export type Selection = {
  keys: ReadonlySet<number>;
  /** De pagina vanwaar een Shift-klik telt. */
  anchor: number | null;
};

export const emptySelection: Selection = { keys: new Set(), anchor: null };

export type ClickModifiers = { toggle?: boolean; range?: boolean };

export function selectByClick(
  selection: Selection,
  order: readonly number[],
  key: number,
  { toggle = false, range = false }: ClickModifiers = {},
): Selection {
  if (range && selection.anchor !== null && order.includes(selection.anchor)) {
    const from = order.indexOf(selection.anchor);
    const to = order.indexOf(key);
    const [start, end] = from <= to ? [from, to] : [to, from];
    const span = order.slice(start, end + 1);
    const keys = toggle ? new Set([...selection.keys, ...span]) : new Set(span);
    return { keys, anchor: selection.anchor };
  }
  if (toggle) {
    const keys = new Set(selection.keys);
    if (keys.has(key)) keys.delete(key);
    else keys.add(key);
    return { keys, anchor: key };
  }
  return { keys: new Set([key]), anchor: key };
}

export function selectAll(order: readonly number[]): Selection {
  return { keys: new Set(order), anchor: order[0] ?? null };
}

/** Haalt pagina's die niet meer bestaan (bijvoorbeeld na verwijderen) uit de selectie. */
export function keepExisting(selection: Selection, order: readonly number[]): Selection {
  const existing = new Set(order);
  const keys = new Set([...selection.keys].filter((key) => existing.has(key)));
  const anchor =
    selection.anchor !== null && existing.has(selection.anchor) ? selection.anchor : null;
  if (keys.size === selection.keys.size && anchor === selection.anchor) return selection;
  return { keys, anchor };
}
