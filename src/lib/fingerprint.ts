/**
 * Vingerafdrukken van inhoud: de SHA-256 als 64 hexadecimale tekens. Twee stukken met dezelfde
 * afdruk zijn (in de praktijk) byte voor byte gelijk. Rekenen gebeurt in de browser zelf (Web
 * Crypto); er gaat niets over het netwerk.
 */

/** De SHA-256 van `bytes`. Gooit een fout als de browser dat niet kan (zonder https of localhost). */
export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes as BufferSource);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

/**
 * De vingerafdruk van een bestand, of null als de browser hem niet kan rekenen: dan weet je niet
 * zeker of het hetzelfde bestand is (zie Platte tekst, onthouden instellingen).
 */
export async function fingerprintOf(bytes: Uint8Array): Promise<string | null> {
  try {
    return await sha256Hex(bytes);
  } catch {
    return null;
  }
}
