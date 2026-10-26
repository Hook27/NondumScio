/**
 * Tekst om in te zoeken. Hoofdletters blijven staan (sommige patronen hebben ze nodig), maar
 * accenten, ligaturen en soorten spaties worden gelijkgetrokken en onzichtbare tekens vallen
 * weg. Zo vindt "jose" ook "José" en "office" ook "oﬃce".
 */

export type Folded = {
  text: string;
  /** Per teken (UTF-16) van `text`: de plek in de oorspronkelijke tekens waar het vandaan komt. */
  origin: number[];
};

/** Zachte afbreekstreepjes, spaties zonder breedte en dergelijke: ze horen niet bij de tekst. */
const INVISIBLE = /^\p{Cf}$/u;

/** Maakt van de tekens van een pagina de doorzoekbare tekst, met de plek van elk teken. */
export function foldChars(chars: readonly string[]): Folded {
  let text = '';
  const origin: number[] = [];
  chars.forEach((char, index) => {
    if (INVISIBLE.test(char)) return;
    // Alle soorten witruimte (ook een harde spatie of nieuwe regel) worden één spatie.
    const folded = /^\s$/u.test(char) ? ' ' : char.normalize('NFKD').replace(/\p{M}/gu, '');
    if (folded === '' || (folded === ' ' && text.endsWith(' '))) return;
    text += folded;
    for (let i = 0; i < folded.length; i += 1) origin.push(index);
  });
  return { text, origin };
}

/** Een zoekterm op dezelfde manier behandeld, zonder spaties aan de randen. */
export function foldTerm(term: string): string {
  return foldChars([...term]).text.trim();
}
