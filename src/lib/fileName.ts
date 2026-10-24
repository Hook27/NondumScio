/** Tekens die Windows, macOS of Linux niet in een bestandsnaam toestaan (ook stuurtekens). */
// eslint-disable-next-line no-control-regex -- stuurtekens moeten hier juist gevonden worden
const FORBIDDEN = /[\\/:*?"<>|\u0000-\u001f\u007f]/g;

/** Namen die Windows voor apparaten reserveert, ook met een extensie erachter. */
const RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;

/** Ruim binnen wat besturingssystemen aankunnen (meestal 255), inclusief de extensie. */
const MAX_LENGTH = 200;

/**
 * Maakt van wat iemand intypt een bruikbare bestandsnaam voor een PDF (of, met `extension`,
 * bijvoorbeeld een ZIP):
 * - verboden tekens worden een streepje (`a/b:c` → `a-b-c`)
 * - spaties en punten aan begin en eind vervallen (Windows staat ze aan het eind niet toe)
 * - de extensie (standaard `.pdf`) wordt aangevuld als die ontbreekt (hoofdletters maken niet uit)
 * - een gereserveerde naam (zoals `CON`) krijgt een liggend streepje erachter
 * - een te lange naam wordt ingekort
 * Blijft er niets over, dan geldt `fallback`.
 */
export function cleanFileName(input: string, fallback: string, extension = '.pdf'): string {
  let base = withoutExtension(
    input.normalize('NFC').replace(FORBIDDEN, '-').replace(/\s+/g, ' ').trim(),
    extension,
  ).replace(/^[\s.]+|[\s.]+$/g, '');

  if (base === '') return fallback;
  if (RESERVED.test(base)) base = `${base}_`;
  const room = MAX_LENGTH - extension.length;
  if (base.length > room) base = base.slice(0, room).replace(/[\s.]+$/, '');
  return `${base}${extension}`;
}

/** De naam zonder de extensie erachter, voor in het invoerveld: die komt er bij opslaan vanzelf bij. */
export function withoutExtension(name: string, extension = '.pdf'): string {
  return name.toLowerCase().endsWith(extension.toLowerCase())
    ? name.slice(0, -extension.length)
    : name;
}

/** De naam zonder ".pdf" erachter. */
export function withoutPdfExtension(name: string): string {
  return withoutExtension(name, '.pdf');
}
