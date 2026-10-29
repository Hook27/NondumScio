import { strFromU8, unzipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { ZIP_LIMITS, ZipTooLargeError, zipWriter } from './zip';

const text = (value: string) => new TextEncoder().encode(value);
const unzip = async (blob: Blob) => unzipSync(new Uint8Array(await blob.arrayBuffer()));

describe('zipWriter', () => {
  it('pakt bestanden in en ze komen er ongeschonden uit', async () => {
    const zip = await zipWriter();
    zip.add('rapport (pagina’s 1-3).pdf', text('%PDF-een'));
    zip.add('rapport (pagina’s 4-6).pdf', text('%PDF-twee'));
    const blob = zip.finish();
    expect(blob.type).toBe('application/zip');
    const files = await unzip(blob);
    expect(Object.keys(files)).toEqual([
      'rapport (pagina’s 1-3).pdf',
      'rapport (pagina’s 4-6).pdf',
    ]);
    expect(strFromU8(files['rapport (pagina’s 4-6).pdf']!)).toBe('%PDF-twee');
  });

  it('geeft dubbele namen een volgnummer', async () => {
    const zip = await zipWriter();
    for (const content of ['1', '2', '3']) zip.add('a.pdf', text(content));
    zip.add('a (2).pdf', text('4'));
    expect(Object.keys(await unzip(zip.finish()))).toEqual([
      'a.pdf',
      'a (2).pdf',
      'a (3).pdf',
      'a (2) (2).pdf',
    ]);
  });

  it('houdt een bestand na het inpakken niet meer vast: wat daarna gebeurt, raakt de ZIP niet', async () => {
    const zip = await zipWriter();
    const first = text('eerste bestand');
    zip.add('een.txt', first);
    // Het geheugen van het eerste bestand wordt hergebruikt (zoals een los canvas of een buffer):
    // in de ZIP staat het nog zoals het was.
    first.fill(0);
    zip.add('twee.txt', text('tweede bestand'));
    const files = await unzip(zip.finish());
    expect(strFromU8(files['een.txt']!)).toBe('eerste bestand');
    expect(strFromU8(files['twee.txt']!)).toBe('tweede bestand');
  });

  it('stopt vóór de grens van een gewone ZIP, en de schatting klopt op de byte', async () => {
    const files: [string, Uint8Array][] = [
      ['een.pdf', text('x'.repeat(100))],
      ['twee.pdf', text('y'.repeat(50))],
    ];
    const free = await zipWriter();
    for (const [name, data] of files) free.add(name, data);
    const size = free.finish().size;

    // Precies groot genoeg: dat mag.
    const exact = await zipWriter({ bytes: size, files: 2 });
    for (const [name, data] of files) exact.add(name, data);
    expect(exact.finish().size).toBe(size);

    // Eén byte te weinig: het tweede bestand wordt geweigerd, vóórdat het ingepakt is.
    const short = await zipWriter({ bytes: size - 1, files: 2 });
    short.add(...files[0]!);
    expect(() => short.add(...files[1]!)).toThrow(ZipTooLargeError);

    // Te veel bestanden.
    const few = await zipWriter({ bytes: size, files: 1 });
    few.add(...files[0]!);
    expect(() => few.add(...files[1]!)).toThrow(ZipTooLargeError);
  });

  it('heeft de grenzen van een gewone ZIP: 4 GB en 65.535 bestanden', () => {
    expect(ZIP_LIMITS).toEqual({ bytes: 2 ** 32 - 1, files: 65_535 });
  });

  it('maakt ook een lege ZIP', async () => {
    const zip = await zipWriter();
    expect(Object.keys(await unzip(zip.finish()))).toEqual([]);
  });
});
