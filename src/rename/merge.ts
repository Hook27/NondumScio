/**
 * Slim hernoemen: de hernoemde brieven samenvoegen tot één PDF, op volgorde van de datum in hun
 * nieuwe naam (de nieuwste eerst). Overgenomen uit Jörgs `pdf-hernoemer.html`; alleen de volgorde
 * komt uit de naam, de inhoud van elke PDF blijft zoals hij is.
 */

/** Eén PDF in de lijst om samen te voegen: een brief van Hernoemen, of een losse (externe) PDF. */
export type MergeEntry = {
  id: number;
  /** JJMMDD, of leeg zonder (volledige) datum. */
  date: string;
  /** De nieuwe naam (bij een externe PDF: zijn bestandsnaam). */
  name: string;
  pageCount: number;
  /** Los toegevoegd: een al hernoemde PDF, die alleen meedoet bij het samenvoegen. */
  external: boolean;
  /** Niet te lezen, dus ook niet samen te voegen. */
  error: boolean;
};

/** De datum vooraan een al hernoemde bestandsnaam (`260604 …`), of leeg. */
export function dateFromName(name: string): string {
  const m = name.replace(/\.pdf$/i, '').match(/^(\d{2})(\d{2})(\d{2})/);
  if (!m) return '';
  const month = +m[2]!;
  const day = +m[3]!;
  if (month < 1 || month > 12 || day < 1 || day > 31) return '';
  return m[1]! + m[2]! + m[3]!;
}

/** De nieuwste eerst (datum aflopend); zonder datum achteraan; verder blijft de volgorde. */
export function byDateDesc(a: { date: string }, b: { date: string }): number {
  const da = a.date || '';
  const db = b.date || '';
  if (da && !db) return -1;
  if (!da && db) return 1;
  if (da && db && da !== db) return db.localeCompare(da);
  return 0;
}

/**
 * De volgorde om samen te voegen. Zonder eigen volgorde (`manual` is `null`) op datum. Met een
 * eigen volgorde (na schuiven) blijft die staan; wat er sindsdien bij kwam, komt onderaan (op
 * datum), en wat er niet meer is, valt weg.
 */
export function orderEntries<T extends { id: number; date: string }>(
  entries: readonly T[],
  manual: readonly number[] | null,
): T[] {
  if (!manual) return [...entries].sort(byDateDesc);
  const byId = new Map(entries.map((entry) => [entry.id, entry]));
  const kept = manual.flatMap((id) => byId.get(id) ?? []);
  const known = new Set(manual);
  const added = entries.filter((entry) => !known.has(entry.id)).sort(byDateDesc);
  return [...kept, ...added];
}

/** Schuift een PDF één plek omhoog (`-1`) of omlaag (`1`) in de volgorde van de ids. */
export function moveId(order: readonly number[], id: number, direction: -1 | 1): number[] {
  const result = [...order];
  const from = result.indexOf(id);
  const to = from + direction;
  if (from < 0 || to < 0 || to >= result.length) return result;
  [result[from], result[to]] = [result[to]!, result[from]!];
  return result;
}

/**
 * De voorgestelde naam: de oudste en de nieuwste datum ervoor (`260129-260422 samengevoegd.pdf`),
 * één datum als ze gelijk zijn, en zonder datum alleen het woord.
 */
export function mergeName(dates: readonly string[], word: string): string {
  const dated = dates.filter(Boolean).sort();
  if (dated.length === 0) return `${word}.pdf`;
  const oldest = dated[0]!;
  const newest = dated.at(-1)!;
  return `${oldest === newest ? oldest : `${oldest}-${newest}`} ${word}.pdf`;
}
