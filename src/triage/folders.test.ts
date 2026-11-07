import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  TRASH_FOLDER,
  canPickFolders,
  folderAt,
  mayRead,
  parentOf,
  pathOf,
  pathText,
  pickRoot,
  rememberRoot,
  rememberedRoot,
  scanPdfs,
  shortPath,
  subfolders,
} from './folders';
import { fakeFolder } from './testFolders';

const docs = () =>
  fakeFolder('Documenten', {
    'z.pdf': 'z',
    'brief 10.pdf': 'b10',
    'Brief 2.PDF': 'b2',
    'notitie.txt': 'x',
    '2024': { 'c.pdf': 'c', diep: { 'd.pdf': 'd' } },
    '.git': { 'verborgen.pdf': 'v' },
    [TRASH_FOLDER]: { 'oud.pdf': 'o' },
    archief: { 'a.pdf': 'a' },
    leeg: {},
  });

describe('scanPdfs', () => {
  it('zonder submappen: alleen de PDF’s in de map zelf, op naam (2 vóór 10), ook .PDF', async () => {
    const found = await scanPdfs(docs(), false);
    expect(found.map((f) => [f.dirs.join('/'), f.file.name])).toEqual([
      ['', 'Brief 2.PDF'],
      ['', 'brief 10.pdf'],
      ['', 'z.pdf'],
    ]);
    expect(await found[0]!.file.text()).toBe('b2');
    expect(found[0]!.handle.name).toBe('Brief 2.PDF');
  });

  it('met submappen: eerst de bestanden, dan de submappen op naam; verborgen mappen en de prullenbakmap niet', async () => {
    const progress: number[] = [];
    const found = await scanPdfs(docs(), true, (n) => progress.push(n));
    expect(found.map((f) => [...f.dirs, f.file.name].join('/'))).toEqual([
      'Brief 2.PDF',
      'brief 10.pdf',
      'z.pdf',
      '2024/c.pdf',
      '2024/diep/d.pdf',
      'archief/a.pdf',
    ]);
    expect(progress).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it('een map die niet te lezen is, wordt overgeslagen', async () => {
    const folder = fakeFolder(
      'Documenten',
      { 'a.pdf': 'a', dicht: { 'x.pdf': 'x' }, open: { 'b.pdf': 'b' } },
      { locked: ['Documenten/dicht'] },
    );
    const found = await scanPdfs(folder, true);
    expect(found.map((f) => [...f.dirs, f.file.name].join('/'))).toEqual(['a.pdf', 'open/b.pdf']);
  });

  it('is de map zelf niet te lezen, dan een fout', async () => {
    const folder = fakeFolder('Dicht', { 'a.pdf': 'a' }, { locked: ['Dicht'] });
    await expect(scanPdfs(folder, true)).rejects.toThrow('Geen toegang');
  });
});

describe('subfolders en folderAt', () => {
  it('de submappen op naam, zonder verborgen mappen (de prullenbakmap wel)', async () => {
    expect(await subfolders(docs())).toEqual([TRASH_FOLDER, '2024', 'archief', 'leeg']);
  });

  it('de map op een pad, of null als hij niet bestaat', async () => {
    const root = docs();
    expect((await folderAt(root, []))?.name).toBe('Documenten');
    expect((await folderAt(root, ['2024', 'diep']))?.name).toBe('diep');
    expect(await folderAt(root, ['2024', 'nieuw'])).toBe(null);
    expect(await folderAt(root, ['z.pdf'])).toBe(null);
  });
});

describe('paden', () => {
  it('als tekst en terug', () => {
    expect(pathText(['Archief', 'Foto'])).toBe('Archief/Foto');
    expect(pathOf('Archief/Foto')).toEqual(['Archief', 'Foto']);
    expect(pathOf('')).toEqual([]);
    expect(parentOf(['a', 'b'])).toEqual(['a']);
    expect(parentOf([])).toEqual([]);
  });

  it('een deel van het pad, zoals DocumentTriage', () => {
    expect(shortPath(['Documenten'])).toBe('Documenten');
    expect(shortPath(['Documenten', 'Facturen'])).toBe('Documenten/Facturen');
    expect(shortPath(['Documenten', 'Foto', 'Bloemen'])).toBe('.../Foto/Bloemen');
  });
});

describe('mayRead', () => {
  it('een map zonder vragen mag altijd', async () => {
    expect(await mayRead(docs(), false)).toBe(true);
  });

  it('al toegestaan, of pas na de vraag', async () => {
    expect(await mayRead(fakeFolder('x', {}, { permission: { state: 'granted' } }), false)).toBe(
      true,
    );
    const asking = fakeFolder('x', {}, { permission: { state: 'prompt', answer: 'granted' } });
    expect(await mayRead(asking, false)).toBe(false);
    expect(await mayRead(asking, true)).toBe(true);
    const denied = fakeFolder('x', {}, { permission: { state: 'prompt', answer: 'denied' } });
    expect(await mayRead(denied, true)).toBe(false);
  });
});

describe('kiezen en onthouden', () => {
  afterEach(() => {
    delete (globalThis as { showDirectoryPicker?: unknown }).showDirectoryPicker;
  });

  it('alleen met mappen-toegang (Edge en Chrome)', () => {
    expect(canPickFolders({})).toBe(false);
    expect(canPickFolders({ showDirectoryPicker: () => null })).toBe(true);
  });

  it('pickRoot: alleen lezen; annuleren geeft null, een andere fout gaat door', async () => {
    const root = docs();
    const picker = vi.fn(async () => root);
    Object.assign(globalThis, { showDirectoryPicker: picker });
    expect(await pickRoot()).toBe(root);
    expect(picker).toHaveBeenCalledWith({ id: 'nondumscio-triage', mode: 'read' });
    picker.mockRejectedValueOnce(new DOMException('Weg', 'AbortError'));
    expect(await pickRoot()).toBe(null);
    picker.mockRejectedValueOnce(new DOMException('Systeemmap', 'SecurityError'));
    await expect(pickRoot()).rejects.toThrow('Systeemmap');
  });

  it('zonder opslag (zoals hier) gaat onthouden stil mis', async () => {
    await rememberRoot(docs());
    expect(await rememberedRoot()).toBe(null);
  });
});
