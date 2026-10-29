/** Een ZIP die bestand voor bestand groeit (zie `zipWriter`). */
export type ZipWriter = {
  /** Pakt een bestand in. Daarna houdt de ZIP zelf de bytes niet meer vast. */
  add: (name: string, data: Uint8Array) => void;
  /** Sluit de ZIP af. */
  finish: () => Blob;
};

/**
 * Pakt bestanden in één ZIP, bijvoorbeeld alle delen na splitsen: één download in plaats van
 * tientallen (browsers vragen bij veel downloads tegelijk om toestemming). Zonder compressie:
 * PDF's en afbeeldingen zijn al gecomprimeerd, en zo blijft het snel. fflate wordt pas geladen
 * als het nodig is. Dubbele namen krijgen een volgnummer: "a.pdf", "a (2).pdf".
 *
 * Bestand voor bestand: na elk bestand gaan de nieuwe stukken van de ZIP in een Blob en worden ze
 * losgelaten. Zo staan niet eerst alle bestanden en daarna nog eens de hele ZIP in het geheugen;
 * een Blob mag de browser buiten de pagina bewaren (ook op schijf).
 */
export async function zipWriter(): Promise<ZipWriter> {
  const { Zip, ZipPassThrough } = await import('fflate');
  const taken = new Set<string>();
  let zipped = new Blob([]);
  let pending: Uint8Array[] = [];
  let failure: Error | null = null;
  const zip = new Zip((error, chunk) => {
    if (error) failure = error;
    else pending.push(chunk);
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
      taken.add(unique);
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
