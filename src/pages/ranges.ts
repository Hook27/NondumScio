/**
 * Schrijft paginanummers kort op, voor een bestandsnaam of melding:
 * [2, 3, 4] → "2-4", [1, 3, 5, 6] → "1, 3, 5-6". Volgorde en dubbele maken niet uit.
 */
export function formatRanges(numbers: readonly number[]): string {
  const sorted = [...new Set(numbers)].sort((a, b) => a - b);
  const parts: string[] = [];
  let start = sorted[0];
  let previous = start;
  for (const n of [...sorted.slice(1), Number.NaN]) {
    if (start === undefined || previous === undefined) break;
    if (n === previous + 1) {
      previous = n;
      continue;
    }
    parts.push(start === previous ? String(start) : `${start}-${previous}`);
    start = n;
    previous = n;
  }
  return parts.join(', ');
}

export type RangeProblem =
  { code: 'empty' } | { code: 'invalid'; part: string } | { code: 'outOfRange'; page: number };

export type ParsedRanges = { ok: true; pages: number[] } | { ok: false; error: RangeProblem };

/**
 * Leest paginanummers zoals mensen ze typen: "1-3, 5", "2 4 6", "8-" (tot het eind),
 * "-3" (vanaf het begin) of "5-3" (omgekeerd telt ook). Komma's, puntkomma's en spaties
 * scheiden; een gewoon streepje of een gedachtestreepje maakt een bereik. Geeft de nummers
 * (vanaf 1) gesorteerd en zonder dubbele, of wat er niet klopt.
 */
export function parseRanges(text: string, pageCount: number): ParsedRanges {
  const parts = text
    .replace(/\s*[-–—]\s*/g, '-')
    .split(/[\s,;]+/)
    .filter(Boolean);
  if (parts.length === 0) return { ok: false, error: { code: 'empty' } };
  const pages = new Set<number>();
  for (const part of parts) {
    const match = /^(\d*)(-?)(\d*)$/.exec(part);
    if (!match || part === '-') return { ok: false, error: { code: 'invalid', part } };
    const [, from = '', dash, to = ''] = match;
    if (!dash && !from) return { ok: false, error: { code: 'invalid', part } };
    const start = from ? Number(from) : 1;
    const end = dash ? (to ? Number(to) : pageCount) : start;
    const [low, high] = start <= end ? [start, end] : [end, start];
    for (const page of [low, high]) {
      if (page < 1 || page > pageCount) return { ok: false, error: { code: 'outOfRange', page } };
    }
    for (let page = low; page <= high; page++) pages.add(page);
  }
  return { ok: true, pages: [...pages].sort((a, b) => a - b) };
}
