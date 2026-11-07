import { describe, expect, it } from 'vitest';
import {
  canMove,
  freeName,
  planActions,
  plannedFolders,
  reasonOf,
  runActions,
  type Action,
  type Outcome,
} from './execute';
import { TRASH_FOLDER, scanPdfs, type FolderHandle } from './folders';
import { fakeFolder, type FakeOptions, type Tree } from './testFolders';
import type { Decision, TriageFile } from './triage';

/**
 * Uitvoeren op een nagemaakte map (het "nep-bestandssysteem"): wat verplaatst wordt, zie je terug
 * in de boom. Zo wordt het risicovolle deel getest zonder ooit een echte map te raken.
 */

/** Een boom met de bronmap Documenten/Archief, en de PDF's zoals de app ze inleest. */
async function setup(tree: Tree, decisions: Record<string, Decision>, options: FakeOptions = {}) {
  const root = fakeFolder('Documenten', tree, options);
  const source = ['Archief'];
  const folder = await root.getDirectoryHandle('Archief');
  const found = await scanPdfs(folder, true);
  const files: TriageFile[] = found.map(({ file, handle, dirs }, i) => ({
    id: i + 1,
    file,
    name: file.name,
    page: 1,
    dirs,
    handle,
    decision: decisions[[...dirs, file.name].join('/')] ?? null,
  }));
  return { root, source, files };
}

async function execute(
  root: FolderHandle,
  source: string[],
  actions: Action[],
  newFolders: string[] = [],
) {
  const outcomes: [string, Outcome][] = [];
  await runActions(root, source, actions, newFolders, (action, outcome) =>
    outcomes.push([action.name, outcome]),
  );
  return outcomes;
}

const tree = (): Tree => ({
  Archief: {
    'brief.pdf': 'B',
    'factuur.pdf': 'F',
    'offerte.pdf': 'O',
    'oud.pdf': 'X',
    '2024': { 'c.pdf': 'C' },
  },
  Facturen: { 'factuur.pdf': 'al er', 'factuur_1.pdf': 'ook al er' },
  Foto: {},
});

describe('planActions', () => {
  it('alleen verplaatsen en verwijderen; bewaren en niet beoordeeld blijven', async () => {
    const { files, source } = await setup(tree(), {
      'brief.pdf': 'keep',
      'factuur.pdf': { move: 'Facturen' },
      'oud.pdf': 'remove',
      '2024/c.pdf': 'remove',
    });
    expect(planActions(files, source).map((a) => [a.name, a.kind, a.from, a.to])).toEqual([
      ['factuur.pdf', 'move', ['Archief'], ['Facturen']],
      ['oud.pdf', 'trash', ['Archief'], ['Archief', TRASH_FOLDER]],
      ['c.pdf', 'trash', ['Archief', '2024'], ['Archief', TRASH_FOLDER, '2024']],
    ]);
  });

  it('verplaatsen naar de map waar de PDF al staat (ook met andere hoofdletters) is niets te doen; de hoofdmap zelf kan wel', async () => {
    const { files, source } = await setup(tree(), {
      'brief.pdf': { move: 'archief' },
      '2024/c.pdf': { move: 'Archief/2024' },
      'oud.pdf': { move: '' },
    });
    expect(planActions(files, source).map((a) => [a.name, a.to])).toEqual([['oud.pdf', []]]);
  });

  it('nieuwe mappen: alleen die waar een PDF heen gaat (ook een tussenliggende nieuwe map)', async () => {
    const { files, source } = await setup(tree(), {
      'brief.pdf': { move: 'Nieuw/Diep' },
      'oud.pdf': 'remove',
    });
    const actions = planActions(files, source);
    expect(plannedFolders(actions, ['Nieuw', 'Nieuw/Diep', 'Ongebruikt'])).toEqual([
      'Nieuw',
      'Nieuw/Diep',
    ]);
  });
});

describe('runActions', () => {
  it('verplaatst naar de doelmappen en de prullenbakmap (met de submap), en maakt nieuwe mappen aan', async () => {
    const t = tree();
    const { root, files, source } = await setup(t, {
      'brief.pdf': { move: 'Nieuw/Diep' },
      'offerte.pdf': { move: 'Foto' },
      'oud.pdf': 'remove',
      '2024/c.pdf': 'remove',
      'factuur.pdf': 'keep',
    });
    const outcomes = await execute(root, source, planActions(files, source), [
      'Nieuw',
      'Nieuw/Diep',
    ]);
    expect(outcomes).toEqual([
      ['brief.pdf', { ok: true, name: 'brief.pdf', to: ['Nieuw', 'Diep'] }],
      ['offerte.pdf', { ok: true, name: 'offerte.pdf', to: ['Foto'] }],
      ['oud.pdf', { ok: true, name: 'oud.pdf', to: ['Archief', TRASH_FOLDER] }],
      ['c.pdf', { ok: true, name: 'c.pdf', to: ['Archief', TRASH_FOLDER, '2024'] }],
    ]);
    expect(t).toEqual({
      Archief: {
        'factuur.pdf': 'F',
        '2024': {},
        [TRASH_FOLDER]: { 'oud.pdf': 'X', '2024': { 'c.pdf': 'C' } },
      },
      Facturen: { 'factuur.pdf': 'al er', 'factuur_1.pdf': 'ook al er' },
      Foto: { 'offerte.pdf': 'O' },
      Nieuw: { Diep: { 'brief.pdf': 'B' } },
    });
  });

  it('een naam die er al is: naam_1, naam_2 … (een map met die naam telt ook), zoals server.py', async () => {
    const t = tree();
    t.Facturen = { 'factuur.pdf': 'al er', 'factuur_1.pdf': 'ook al er', factuur_2: {} };
    (t.Facturen as Tree)['factuur_2.pdf'] = {};
    const { root, files, source } = await setup(t, { 'factuur.pdf': { move: 'Facturen' } });
    const outcomes = await execute(root, source, planActions(files, source));
    expect(outcomes).toEqual([
      ['factuur.pdf', { ok: true, name: 'factuur_3.pdf', to: ['Facturen'] }],
    ]);
    expect((t.Facturen as Tree)['factuur_3.pdf']).toBe('F');
  });

  it('een bestaande doelmap die er niet meer is, wordt niet aangemaakt: "doelmap niet gevonden"; de rest gaat door', async () => {
    const t = tree();
    const { root, files, source } = await setup(t, {
      'brief.pdf': { move: 'Weg' },
      'oud.pdf': 'remove',
    });
    const outcomes = await execute(root, source, planActions(files, source));
    expect(outcomes).toEqual([
      ['brief.pdf', { ok: false, reason: 'noFolder' }],
      ['oud.pdf', { ok: true, name: 'oud.pdf', to: ['Archief', TRASH_FOLDER] }],
    ]);
    expect('Weg' in t).toBe(false);
    expect((t.Archief as Tree)['brief.pdf']).toBe('B');
  });

  it('een bestand dat al weg is, of een fout bij verplaatsen: gemeld, de rest gaat door', async () => {
    const t = tree();
    const { root, files, source } = await setup(
      t,
      { 'brief.pdf': 'remove', 'factuur.pdf': { move: 'Foto' }, 'oud.pdf': 'remove' },
      { failMove: ['factuur.pdf'] },
    );
    delete (t.Archief as Tree)['brief.pdf'];
    const outcomes = await execute(root, source, planActions(files, source));
    expect(outcomes).toEqual([
      ['brief.pdf', { ok: false, reason: 'notFound' }],
      ['factuur.pdf', { ok: false, reason: 'failed' }],
      ['oud.pdf', { ok: true, name: 'oud.pdf', to: ['Archief', TRASH_FOLDER] }],
    ]);
    expect((t.Archief as Tree)['factuur.pdf']).toBe('F');
  });

  it('een browser die niet echt kan verplaatsen: canMove is false', async () => {
    const { files, source } = await setup(tree(), { 'oud.pdf': 'remove' }, { noMove: true });
    expect(canMove(planActions(files, source))).toBe(false);
    const withMove = await setup(tree(), { 'oud.pdf': 'remove' });
    expect(canMove(planActions(withMove.files, withMove.source))).toBe(true);
    expect(canMove([])).toBe(true);
  });
});

describe('freeName en reasonOf', () => {
  it('freeName: zonder extensie en met een punt in de naam', async () => {
    const folder = fakeFolder('x', { a: 'x', a_1: 'x', 'b.c.pdf': 'x' });
    expect(await freeName(folder, 'a')).toBe('a_2');
    expect(await freeName(folder, 'b.c.pdf')).toBe('b.c_1.pdf');
    expect(await freeName(folder, 'nieuw.pdf')).toBe('nieuw.pdf');
  });

  it('reasonOf: de soorten fouten', () => {
    expect(reasonOf(new DOMException('', 'NotFoundError'))).toBe('notFound');
    expect(reasonOf(new DOMException('', 'NotAllowedError'))).toBe('denied');
    expect(reasonOf(new DOMException('', 'SecurityError'))).toBe('denied');
    expect(reasonOf(new Error('x'))).toBe('failed');
    expect(reasonOf(null)).toBe('failed');
  });
});
