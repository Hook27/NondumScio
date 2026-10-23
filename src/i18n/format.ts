/**
 * Vult `{naam}`-plekken in een tekst in: `format('Pagina {n}', { n: 3 })` → "Pagina 3".
 * Een onbekende plek blijft staan, zodat een vergeten waarde zichtbaar is en niet stilletjes verdwijnt.
 */
export function format(template: string, values: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (match, key: string) =>
    key in values ? String(values[key]) : match,
  );
}

/** Kiest de enkelvoud- of meervoudvorm en vult `{n}` in. */
export function plural(n: number, one: string, other: string): string {
  return format(n === 1 ? one : other, { n });
}
