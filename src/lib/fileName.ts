/** Tekens die Windows, macOS of Linux niet in een bestandsnaam toestaan (ook stuurtekens). */
// eslint-disable-next-line no-control-regex -- stuurtekens moeten hier juist gevonden worden
const FORBIDDEN = /[\\/:*?"<>|\u0000-\u001f\u007f]/g;

/** Namen die Windows voor apparaten reserveert, ook met een extensie erachter. */
const RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;

/** Ruim binnen wat besturingssystemen aankunnen (meestal 255), inclusief ".pdf". */
const MAX_LENGTH = 200;

/**
 * Maakt van wat iemand intypt een bruikbare bestandsnaam voor een PDF:
 * - verboden tekens worden een streepje (`a/b:c` → `a-b-c`)
 * - spaties en punten aan begin en eind vervallen (Windows staat ze aan het eind niet toe)
 * - `.pdf` wordt aangevuld als het ontbreekt (hoofdletters maken niet uit)
 * - een gereserveerde naam (zoals `CON`) krijgt een liggend streepje erachter
 * - een te lange naam wordt ingekort
 * Blijft er niets over, dan geldt `fallback`.
 */
export function cleanFileName(input: string, fallback: string): string {
  let base = input
    .normalize('NFC')
    .replace(FORBIDDEN, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\.pdf$/i, '')
    .replace(/^[\s.]+|[\s.]+$/g, '');

  if (base === '') return fallback;
  if (RESERVED.test(base)) base = `${base}_`;
  if (base.length > MAX_LENGTH - 4) base = base.slice(0, MAX_LENGTH - 4).replace(/[\s.]+$/, '');
  return `${base}.pdf`;
}

/** Hoe lang het deel vóór ".pdf" is: om alleen dat deel te selecteren in het invoerveld. */
export function nameWithoutExtensionLength(name: string): number {
  return /\.pdf$/i.test(name) ? name.length - 4 : name.length;
}
