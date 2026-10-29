/** Een ZIP die bestand voor bestand groeit (zie `zipWriter`). */
export type ZipWriter = {
  /** Pakt een bestand in. Daarna houdt de ZIP zelf de bytes niet meer vast. */
  add: (name: string, data: Uint8Array) => void;
  /** Sluit de ZIP af. */
  finish: () => Blob;
};

/**
 * De grenzen van een gewone ZIP: hooguit 4 GB en 65.535 bestanden. Daarboven is een uitbreiding
 * nodig (Zip64) die fflate niet maakt; het bestand zou dan ongeldig zijn.
 */
export const ZIP_LIMITS = { bytes: 0xffffffff, files: 0xffff };

/** De ZIP zou de grenzen van een gewone ZIP overschrijden; er is dan nog niets gedownload. */
export class ZipTooLargeError extends Error {
  constructor() {
    super('De ZIP wordt te groot (meer dan 4 GB of 65.535 bestanden)');
    this.name = 'ZipTooLargeError';
  }
}

/** Een kop per bestand (30), de afsluiting na de inhoud (16) en de regel in de inhoudsopgave (46). */
const LOCAL = 30 + 16;
const CENTRAL = 46;
/** De afsluiting van de ZIP. */
const END = 22;

/**
 * Pakt bestanden in één ZIP, bijvoorbeeld alle delen na splitsen: één download in plaats van
 * tientallen (browsers vragen bij veel downloads tegelijk om toestemming). Zonder compressie:
 * PDF's en afbeeldingen zijn al gecomprimeerd, en zo blijft het snel. fflate wordt pas geladen
 * als het nodig is. Dubbele namen krijgen een volgnummer: "a.pdf", "a (2).pdf".
 *
 * Bestand voor bestand: na elk bestand gaan de nieuwe stukken van de ZIP in een Blob en worden ze
 * losgelaten. Zo staan niet eerst alle bestanden en daarna nog eens de hele ZIP in het geheugen;
 * een Blob mag de browser buiten de pagina bewaren (ook op schijf).
 *
 * Zou een bestand de ZIP over de grenzen van `limits` brengen, dan stopt `add` met een
 * `ZipTooLargeError`, vóórdat het bestand wordt ingepakt: liever een duidelijke melding dan na lang
 * werken een ZIP die niet te openen is.
 */
export async function zipWriter(limits = ZIP_LIMITS): Promise<ZipWriter> {
  const { Zip, ZipPassThrough } = await import('fflate');
  const taken = new Set<string>();
  // Wat er al geschreven is, en wat de inhoudsopgave aan het eind nog kost.
  let written = 0;
  let central = END;
  let zipped = new Blob([]);
  let pending: Uint8Array[] = [];
  let failure: Error | null = null;
  const zip = new Zip((error, chunk) => {
    if (error) failure = error;
    else {
      pending.push(chunk);
      written += chunk.length;
    }
  });
  // De stukken komen meteen (fflate werkt hier zonder wachten); ze gaan direct de Blob in.
  const flush = () => {
    if (failure) throw failure;
    zipped = new Blob([zipped, ...(pending as BlobPart[])]);
    pending = [];
  };
  return {
    add: (name, data) => {
      const unique = uniqueName(name, taken);
      const nameLength = new TextEncoder().encode(unique).length;
      const total = written + LOCAL + nameLength + data.length + central + CENTRAL + nameLength;
      if (taken.size + 1 > limits.files || total > limits.bytes) throw new ZipTooLargeError();
      taken.add(unique);
      central += CENTRAL + nameLength;
      const file = new ZipPassThrough(unique);
      zip.add(file);
      file.push(data, true);
      flush();
    },
    finish: () => {
      zip.end();
      flush();
      return new Blob([zipped], { type: 'application/zip' });
    },
  };
}

function uniqueName(name: string, taken: ReadonlySet<string>) {
  if (!taken.has(name)) return name;
  const dot = name.lastIndexOf('.');
  const [base, extension] = dot > 0 ? [name.slice(0, dot), name.slice(dot)] : [name, ''];
  for (let n = 2; ; n += 1) {
    const candidate = `${base} (${n})${extension}`;
    if (!taken.has(candidate)) return candidate;
  }
}
