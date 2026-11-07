// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/preact';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { messages } from '../i18n';
import { LanguageProvider } from '../i18n/LanguageContext';
import { format } from '../i18n/format';
import { downloadFile } from '../pdf/save';
import { TriageTool } from './TriageTool';
import { rememberRoot, rememberedRoot, type FolderHandle } from './folders';
import { ADVANCE_MS, getTriageState, resetTriageState } from './store';
import { fakeFolder, type FakeOptions } from './testFolders';

// Het tekenen nagebootst (jsdom kan niet echt tekenen).
vi.mock('../compare/visual', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../compare/visual')>()),
  pageSize: vi.fn(async () => ({ count: 1, w: 595, h: 842 })),
  renderPage: vi.fn(async (_file: File, _no: number, width: number) => {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = Math.round(width * 1.414);
    return canvas;
  }),
  closeVisual: vi.fn(),
}));

vi.mock('../pdf/save', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../pdf/save')>()),
  downloadFile: vi.fn(),
}));

// Onthouden (IndexedDB) is er in jsdom niet; hier nagebootst.
vi.mock('./folders', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./folders')>()),
  rememberRoot: vi.fn(async () => undefined),
  rememberedRoot: vi.fn(async () => null),
}));

const tr = messages.nl.triage;
const f = tr.folderMode;
const b = tr.browser;

const tree = () => ({
  Archief: {
    'brief.pdf': 'b',
    'factuur.pdf': 'f',
    'notitie.txt': 't',
    '2024': { 'c.pdf': 'c' },
    '.git': { 'x.pdf': 'x' },
  },
  Foto: { Bloemen: {} },
  Dicht: { 'geheim.pdf': 'g' },
});

let picker: ReturnType<typeof vi.fn>;

function withPicker(options: FakeOptions = {}, root?: FolderHandle) {
  const handle = root ?? fakeFolder('Documenten', tree(), options);
  picker = vi.fn(async () => handle);
  Object.assign(window, { showDirectoryPicker: picker });
  return handle;
}

function setup() {
  render(
    <LanguageProvider initial="nl">
      <TriageTool />
    </LanguageProvider>,
  );
}

const settle = (ms = 40) => act(() => new Promise((resolve) => setTimeout(resolve, ms)));
const key = (k: string, target: Document | Element = document) =>
  act(() => {
    fireEvent.keyDown(target, { key: k });
  });
/** Wat er bij het inlezen gemeld wordt (in het vak van de hoofdmap). */
const scanStatus = () => within(screen.getByRole('region', { name: f.root })).getByRole('status');
const button = (name: string | RegExp) => screen.getByRole('button', { name });
const dialog = () => screen.getByRole('dialog');
const inDialog = (name: string | RegExp) => within(dialog()).getByRole('button', { name });
const listNames = () =>
  within(screen.getByRole('list', { name: tr.files }))
    .getAllByRole('button')
    .map((item) => item.getAttribute('data-tip'));
const decisions = () => getTriageState().files.map((entry) => entry.decision);

/** Map opruimen, hoofdmap Documenten, bronmap Archief. */
async function openArchief() {
  setup();
  fireEvent.click(button(tr.modes.folder));
  fireEvent.click(button(f.chooseRoot));
  await settle();
  fireEvent.click(button(f.chooseSource));
  await settle();
  fireEvent.click(inDialog('Archief'));
  await settle();
  fireEvent.click(inDialog(b.confirm));
  await settle();
}

beforeEach(() => {
  vi.mocked(downloadFile).mockClear();
  vi.mocked(rememberRoot).mockClear();
  vi.mocked(rememberedRoot).mockClear();
});

afterEach(() => {
  cleanup();
  resetTriageState();
  delete (window as { showDirectoryPicker?: unknown }).showDirectoryPicker;
});

describe('Archief / Triage: Map opruimen', () => {
  it('zonder mappen-toegang (Firefox, Safari) staat Map opruimen uit, met uitleg', () => {
    setup();
    expect((button(tr.modes.folder) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(tr.folderOnly)).toBeTruthy();
  });

  it('hoofdmap kiezen, bronmap kiezen in het mapvenster, en de PDF’s inlezen', async () => {
    const root = withPicker();
    setup();
    expect(screen.queryByText(tr.folderOnly)).toBeNull();
    fireEvent.click(button(tr.modes.folder));
    expect(screen.getByText(f.placeholder)).toBeTruthy();
    fireEvent.click(button(f.chooseRoot));
    await settle();
    expect(picker).toHaveBeenCalledWith({ id: 'nondumscio-triage', mode: 'read' });
    expect(vi.mocked(rememberRoot)).toHaveBeenCalledWith(root);
    expect(screen.getByText('Documenten')).toBeTruthy();
    expect(screen.getByText(f.noSource)).toBeTruthy();

    fireEvent.click(button(f.chooseSource));
    await settle();
    expect(within(dialog()).getByRole('heading').textContent).toBe(b.titleSource);
    // Submappen op naam; geen veld voor een nieuwe map bij de bronmap.
    expect(
      within(screen.getByRole('list', { name: b.folders }))
        .getAllByRole('button')
        .map((item) => item.textContent),
    ).toEqual(['📁Archief', '📁Dicht', '📁Foto']);
    expect(screen.queryByLabelText(b.newLabel)).toBeNull();
    expect((inDialog(b.up) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(inDialog('Archief'));
    await settle();
    expect(
      within(screen.getByRole('navigation', { name: b.path }))
        .getAllByRole('button')
        .map((item) => item.textContent),
    ).toEqual(['↑', 'Documenten', 'Archief']);
    fireEvent.click(inDialog(b.confirm));
    await settle();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(getTriageState().source).toEqual(['Archief']);
    expect(screen.getByText('Documenten/Archief')).toBeTruthy();
    expect(scanStatus().textContent).toBe(format(f.found, { n: 2 }));
    expect(listNames()).toEqual(['brief.pdf', 'factuur.pdf']);
  });

  it('Ook submappen inlezen leest opnieuw in; besluiten blijven; de toetsen werken ook met de focus op het vinkje', async () => {
    withPicker();
    await openArchief();
    await key('k');
    await settle(ADVANCE_MS + 40);
    const box = screen.getByLabelText(f.recursive) as HTMLInputElement;
    box.focus();
    fireEvent.click(box);
    await settle();
    expect(listNames()).toEqual(['brief.pdf', 'factuur.pdf', '2024/c.pdf']);
    expect(decisions()).toEqual(['keep', null, null]);
    expect(scanStatus().textContent).toBe(format(f.found, { n: 3 }));
    // Je blijft bij de PDF van nu (factuur).
    expect(getTriageState().cur).toBe(1);
    // Met de focus op het vinkje: X verwijdert.
    await key('x', box);
    expect(decisions()).toEqual(['keep', 'remove', null]);
    await settle(ADVANCE_MS + 40);
    expect(getTriageState().cur).toBe(2);
    // Weer uit: de PDF uit 2024 gaat uit de lijst; dan de eerste.
    fireEvent.click(box);
    await settle();
    expect(listNames()).toEqual(['brief.pdf', 'factuur.pdf']);
    expect(decisions()).toEqual(['keep', 'remove']);
    expect(getTriageState().cur).toBe(0);
  });

  it('M opent het mapvenster: een nieuwe map (nog niet aangemaakt), daarna begint het boven de vorige doelmap', async () => {
    withPicker();
    await openArchief();
    await key('m');
    await settle();
    expect(within(dialog()).getByRole('heading').textContent).toBe(b.titleTarget);
    // Begint in de bronmap.
    expect(screen.getByRole('button', { name: 'Archief' }).getAttribute('aria-current')).toBe(
      'location',
    );
    fireEvent.input(screen.getByLabelText(b.newLabel), { target: { value: 'a/b' } });
    fireEvent.click(inDialog(b.create));
    expect(screen.getByRole('alert').textContent).toBe(b.badName);
    fireEvent.input(screen.getByLabelText(b.newLabel), { target: { value: ' Facturen ' } });
    fireEvent.click(inDialog(b.create));
    await settle();
    expect(screen.getByRole('button', { name: 'Facturen' }).getAttribute('aria-current')).toBe(
      'location',
    );
    expect(screen.getByText(b.empty)).toBeTruthy();
    fireEvent.click(inDialog(b.confirm));
    await settle();
    expect(decisions()[0]).toEqual({ move: 'Archief/Facturen' });
    expect(getTriageState().newFolders).toEqual(['Archief/Facturen']);
    const move = within(screen.getByRole('group', { name: tr.moveTo }));
    expect(
      move.getByRole('button', { name: '.../Archief/Facturen' }).getAttribute('data-tip'),
    ).toBe(format(tr.folderTip, { folder: 'Documenten/Archief/Facturen', n: 1 }));
    await settle(ADVANCE_MS + 40);

    // Nu begint het in Archief (boven Facturen); de nieuwe map staat erbij.
    fireEvent.click(button(f.choose));
    await settle();
    expect(screen.getByRole('button', { name: 'Archief' }).getAttribute('aria-current')).toBe(
      'location',
    );
    expect(
      within(screen.getByRole('list', { name: b.folders }))
        .getAllByRole('button')
        .map((item) => item.textContent),
    ).toEqual(['📁2024', `📁Facturen (${b.isNew})`]);
    fireEvent.click(inDialog(b.up));
    await settle();
    fireEvent.click(inDialog('Foto'));
    await settle();
    fireEvent.click(inDialog('Bloemen'));
    await settle();
    // ↑ vanaf twee mappen diep: naar Foto, niet meteen naar de hoofdmap.
    fireEvent.click(inDialog(b.up));
    await settle();
    expect(screen.getByRole('button', { name: 'Foto' }).getAttribute('aria-current')).toBe(
      'location',
    );
    fireEvent.click(inDialog('Bloemen'));
    await settle();
    fireEvent.click(inDialog(b.confirm));
    await settle();
    expect(decisions()[1]).toEqual({ move: 'Foto/Bloemen' });
    // 1–9 op de naam van de map zelf: Bloemen vóór Facturen (op het hele pad andersom).
    expect(
      move
        .getAllByRole('button')
        .map((item) => item.querySelector('.triage-folder__name')?.textContent),
    ).toEqual([undefined, '.../Foto/Bloemen', '.../Archief/Facturen']);
    fireEvent.click(button(/^factuur\.pdf/));
    await key('2');
    expect(decisions()[1]).toEqual({ move: 'Archief/Facturen' });
    await key('1');
    expect(decisions()[1]).toEqual({ move: 'Foto/Bloemen' });
    // Het venster begint nu boven de laatst gekozen doelmap (Foto/Bloemen): in Foto.
    await settle(ADVANCE_MS + 40);
    fireEvent.click(button(f.choose));
    await settle();
    expect(screen.getByRole('button', { name: 'Foto' }).getAttribute('aria-current')).toBe(
      'location',
    );
  });

  it('een gekozen map nog eens aanmaken is dezelfde map', async () => {
    withPicker();
    await openArchief();
    await key('m');
    await settle();
    fireEvent.input(screen.getByLabelText(b.newLabel), { target: { value: '2024' } });
    fireEvent.click(inDialog(b.create));
    await settle();
    expect(getTriageState().newFolders).toEqual([]);
    expect(screen.getByRole('button', { name: '2024' }).getAttribute('aria-current')).toBe(
      'location',
    );
    // Een bestaande map met andere hoofdletters: dezelfde map, met de naam zoals hij er staat.
    fireEvent.click(inDialog(b.up));
    await settle();
    fireEvent.click(inDialog(b.up));
    await settle();
    fireEvent.input(screen.getByLabelText(b.newLabel), { target: { value: 'archief' } });
    fireEvent.click(inDialog(b.create));
    await settle();
    expect(getTriageState().newFolders).toEqual([]);
    expect(screen.getByRole('button', { name: 'Archief' }).getAttribute('aria-current')).toBe(
      'location',
    );
    fireEvent.click(inDialog(b.cancel));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(decisions()[0]).toBe(null);
  });

  it('het overzicht: namen met de submap, mappen met het pad, en nog niets uitgevoerd', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 10, 7, 21, 5));
    withPicker();
    await openArchief();
    fireEvent.click(screen.getByLabelText(f.recursive));
    await settle();
    fireEvent.click(button(f.choose));
    await settle();
    fireEvent.click(inDialog(b.up));
    await settle();
    fireEvent.click(inDialog('Foto'));
    await settle();
    fireEvent.click(inDialog('Bloemen'));
    await settle();
    fireEvent.click(inDialog(b.confirm));
    await settle();
    fireEvent.click(button(tr.views.overview));
    expect(screen.getByText(f.notYet)).toBeTruthy();
    expect(screen.getByText('2024/c.pdf')).toBeTruthy();
    fireEvent.click(button(tr.overview.csv));
    const [csv, name] = vi.mocked(downloadFile).mock.calls[0]!;
    expect(name).toBe('triage_2026-11-07_2105.csv');
    expect(new TextDecoder().decode(csv as Uint8Array)).toBe(
      '"Bestandsnaam","Besluit","Map"\n"brief.pdf","verplaatsen","Foto/Bloemen"\n"factuur.pdf","niet beoordeeld",""\n"2024/c.pdf","niet beoordeeld",""',
    );
    vi.useRealTimers();
  });

  it('een bronmap die niet te lezen is, geeft een melding', async () => {
    withPicker({ locked: ['Documenten/Dicht'] });
    setup();
    fireEvent.click(button(tr.modes.folder));
    fireEvent.click(button(f.chooseRoot));
    await settle();
    fireEvent.click(button(f.chooseSource));
    await settle();
    fireEvent.click(inDialog('Dicht'));
    await settle();
    fireEvent.click(inDialog(b.confirm));
    await settle();
    expect(scanStatus().textContent).toBe(f.readError);
    expect(getTriageState().files).toEqual([]);
  });

  it('een map die de browser weigert, of annuleren', async () => {
    withPicker();
    setup();
    fireEvent.click(button(tr.modes.folder));
    picker.mockRejectedValueOnce(new DOMException('Systeemmap', 'SecurityError'));
    fireEvent.click(button(f.chooseRoot));
    await settle();
    expect(screen.getByRole('alert').textContent).toBe(f.refused);
    picker.mockRejectedValueOnce(new DOMException('Weg', 'AbortError'));
    fireEvent.click(button(f.chooseRoot));
    await settle();
    expect(getTriageState().root).toBe(null);
  });

  it('een onthouden hoofdmap: Verder met …, na toestemming', async () => {
    const root = fakeFolder('Documenten', tree(), {
      permission: { state: 'prompt', answer: 'granted' },
    });
    vi.mocked(rememberedRoot).mockResolvedValueOnce(root);
    withPicker({}, root);
    setup();
    fireEvent.click(button(tr.modes.folder));
    await settle();
    expect(getTriageState().root).toMatchObject({ name: 'Documenten', ready: false });
    fireEvent.click(button(format(f.resume, { name: 'Documenten' })));
    await settle();
    expect(getTriageState().root?.ready).toBe(true);
    expect(button(f.chooseSource)).toBeTruthy();
    expect(picker).not.toHaveBeenCalled();
  });

  it('geen toestemming voor de onthouden hoofdmap: een melding', async () => {
    const root = fakeFolder('Documenten', tree(), {
      permission: { state: 'prompt', answer: 'denied' },
    });
    vi.mocked(rememberedRoot).mockResolvedValueOnce(root);
    withPicker({}, root);
    setup();
    fireEvent.click(button(tr.modes.folder));
    await settle();
    fireEvent.click(button(format(f.resume, { name: 'Documenten' })));
    await settle();
    expect(screen.getByRole('alert').textContent).toBe(f.noAccess);
  });

  it('wisselen van werkwijze met besluiten vraagt eerst; Wis alles begint opnieuw met de bronmap', async () => {
    withPicker();
    await openArchief();
    await key('k');
    fireEvent.click(button(tr.modes.list));
    expect(within(dialog()).getByRole('heading').textContent).toBe(tr.switchMode.title);
    fireEvent.click(inDialog(tr.switchMode.cancel));
    expect(getTriageState().mode).toBe('folder');
    expect(decisions()[0]).toBe('keep');

    fireEvent.click(button(tr.clear));
    fireEvent.click(inDialog(tr.clearConfirm));
    expect(getTriageState().files).toEqual([]);
    expect(getTriageState().source).toBe(null);
    expect(getTriageState().root?.name).toBe('Documenten');

    // Zonder besluiten: meteen wisselen.
    fireEvent.click(button(tr.modes.list));
    expect(getTriageState().mode).toBe('list');
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
