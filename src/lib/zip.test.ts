import { strFromU8, unzipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { zipWriter } from './zip';

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

  it('maakt ook een lege ZIP', async () => {
    const zip = await zipWriter();
    expect(Object.keys(await unzip(zip.finish()))).toEqual([]);
  });
});
