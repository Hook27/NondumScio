const SIGNATURE = [0x25, 0x50, 0x44, 0x46, 0x2d]; // "%PDF-"

/** Volgens de PDF-specificatie mag de kop iets na het begin staan; lezers zoeken in de eerste 1024 bytes. */
const SEARCH_WINDOW = 1024;

/**
 * Of de bytes op een PDF lijken: "%PDF-" in de eerste 1024 bytes. Kijkt naar de inhoud,
 * niet naar de bestandsnaam of het type dat het besturingssysteem opgeeft (dat ontbreekt
 * soms of klopt niet).
 */
export function looksLikePdf(bytes: Uint8Array): boolean {
  const end = Math.min(bytes.length, SEARCH_WINDOW) - SIGNATURE.length;
  for (let start = 0; start <= end; start += 1) {
    if (SIGNATURE.every((byte, i) => bytes[start + i] === byte)) return true;
  }
  return false;
}

export type LoadErrorCode = 'not-pdf' | 'password' | 'damaged';

/** Vertaalt een fout van de PDF-lezer naar een van onze vaste soorten. */
export function classifyLoadError(error: unknown): LoadErrorCode {
  const name = (error as { name?: unknown } | null)?.name;
  if (name === 'PasswordException') return 'password';
  return 'damaged';
}
