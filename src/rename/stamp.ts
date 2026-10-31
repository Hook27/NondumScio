/**
 * Datum-tijdstempel JJJJMMDD_UUMM (lokale tijd), voor de naam van een download: de ZIP met hernoemde
 * kopieën en de export van de database. Zo overschrijft een nieuwe download nooit een oude.
 */
export function stamp(now = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}${p(now.getMonth() + 1)}${p(now.getDate())}_${p(now.getHours())}${p(now.getMinutes())}`;
}
