/**
 * Pakt bestanden in één ZIP, bijvoorbeeld alle delen na splitsen: één download in plaats van
 * tientallen (browsers vragen bij veel downloads tegelijk om toestemming). Zonder compressie:
 * PDF's zijn al gecomprimeerd, en zo blijft het snel. fflate wordt pas geladen als het nodig is.
 * Dubbele namen krijgen een volgnummer: "a.pdf", "a (2).pdf".
 */
export async function makeZip(files: readonly { name: string; data: Uint8Array }[]) {
  const { zipSync } = await import('fflate');
  const entries: Record<string, [Uint8Array, { level: 0 }]> = {};
  for (const file of files) entries[uniqueName(file.name, entries)] = [file.data, { level: 0 }];
  return zipSync(entries);
}

function uniqueName(name: string, taken: Record<string, unknown>) {
  if (!(name in taken)) return name;
  const dot = name.lastIndexOf('.');
  const [base, extension] = dot > 0 ? [name.slice(0, dot), name.slice(dot)] : [name, ''];
  for (let n = 2; ; n += 1) {
    const candidate = `${base} (${n})${extension}`;
    if (!(candidate in taken)) return candidate;
  }
}
