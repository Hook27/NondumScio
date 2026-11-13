/**
 * Eén waarschuwing van de browser bij het sluiten of herladen van het tabblad, zolang er ergens
 * werk is dat nog niet gedownload (of uitgevoerd) is. Elk onderdeel meldt alleen of het zulk werk
 * heeft (`setUnsavedWork`); er is dan één luisteraar, hoeveel onderdelen ook werk hebben.
 */

/** Welke onderdelen nu werk hebben dat verloren zou gaan. */
const sources = new Set<string>();
let target: Window | null = null;

const warn = (event: BeforeUnloadEvent) => {
  event.preventDefault();
  // Voor oudere browsers, die alleen naar returnValue kijken.
  event.returnValue = '';
};

/** Meldt dat onderdeel `source` (wel of geen) niet-opgeslagen werk heeft. */
export function setUnsavedWork(source: string, unsaved: boolean): void {
  if (unsaved) sources.add(source);
  else sources.delete(source);
  const needed = sources.size > 0;
  if (needed && !target && typeof window !== 'undefined') {
    // Het doel onthouden: opruimen kan na het einde van een test vallen, als `window` al weg is.
    target = window;
    target.addEventListener('beforeunload', warn);
  } else if (!needed && target) {
    target.removeEventListener('beforeunload', warn);
    target = null;
  }
}

/** Welke onderdelen nu werk hebben (voor de tests). */
export function unsavedSources(): string[] {
  return [...sources].sort();
}
