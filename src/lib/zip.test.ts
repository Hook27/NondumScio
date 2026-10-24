import { strFromU8, unzipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { makeZip } from './zip';

const text = (value: string) => new TextEncoder().encode(value);

describe('makeZip', () => {
  it('pakt bestanden in en ze komen er ongeschonden uit', async () => {
    const zip = await makeZip([
      { name: 'rapport (pagina’s 1-3).pdf', data: text('%PDF-een') },
      { name: 'rapport (pagina’s 4-6).pdf', data: text('%PDF-twee') },
    ]);
    const files = unzipSync(zip);
    expect(Object.keys(files)).toEqual([
      'rapport (pagina’s 1-3).pdf',
      'rapport (pagina’s 4-6).pdf',
    ]);
    expect(strFromU8(files['rapport (pagina’s 4-6).pdf']!)).toBe('%PDF-twee');
  });

  it('geeft dubbele namen een volgnummer', async () => {
    const zip = await makeZip([
      { name: 'a.pdf', data: text('1') },
      { name: 'a.pdf', data: text('2') },
      { name: 'a.pdf', data: text('3') },
    ]);
    expect(Object.keys(unzipSync(zip))).toEqual(['a.pdf', 'a (2).pdf', 'a (3).pdf']);
  });
});
