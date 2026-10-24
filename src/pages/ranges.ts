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
