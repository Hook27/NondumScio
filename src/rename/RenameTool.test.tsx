// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/preact';
import { unzipSync } from 'fflate';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { messages } from '../i18n';
import { LanguageProvider } from '../i18n/LanguageContext';
import { PdfSaveError, buildPdf, downloadFile, downloadPdf } from '../pdf/save';
import { DB_STORAGE_KEY, type RenameDb } from './database';
import { RenameTool } from './RenameTool';
import { resetRenameState } from './store';

/** Wat er per bestand "gelezen" wordt: de regels van de tekstlaag (of een fout). */
const LETTERS: Record<string, string[] | Error> = {
  'gemeente.pdf': [
    'Gemeente Utrecht',
    'Postbus 16200',
    'Datum: 12 maart 2026',
    'Betreft: Aanslag gemeentelijke belastingen',
  ],
  'bank1.pdf': ['ING Bank N.V.', 'Datum 3-2-2026', 'Betreft: Afschrift'],
  'bank2.pdf': ['ING Bank N.V.', 'Datum 3-2-2026', 'Betreft: Afschrift'],
  'scan.pdf': [],
  'kapot.pdf': new Error('kapot'),
};

vi.mock('./readText', () => ({
  readLines: vi.fn(async (file: File) => {
    const lines = LETTERS[file.name];
    if (lines instanceof Error) throw lines;
    return { pageCount: 1, lines: lines ?? [] };
  }),
  // Losse PDF's bij samenvoegen: het aantal pagina's staat in de naam ("… 3p.pdf"), anders 1.
  countPages: vi.fn(async (file: File) => {
    if (file.name.includes('kapot')) throw new Error('kapot');
    return Number(/(\d+)p\.pdf$/.exec(file.name)?.[1] ?? 1);
  }),
}));

vi.mock('../pdf/save', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../pdf/save')>()),
  downloadFile: vi.fn(),
  downloadPdf: vi.fn(),
  buildPdf: vi.fn(async () => new Uint8Array([1, 2, 3])),
}));

const r = messages.nl.rename;
const pdf = (name: string) => new File([`%PDF-1.7 ${name}`], name, { type: 'application/pdf' });

function setup() {
  render(
    <LanguageProvider initial="nl">
      <RenameTool />
    </LanguageProvider>,
  );
}

async function open(...names: string[]) {
  fireEvent.change(document.querySelector('#rename-files')!, {
    target: { files: names.map(pdf) },
  });
  await screen.findByRole('table');
  await waitFor(() => expect(screen.getAllByRole('row')).toHaveLength(names.length + 1));
}

const nameOf = (file: string) =>
  screen.getByLabelText<HTMLInputElement>(`Nieuwe naam voor ${file}`).value;
const row = (file: string) => screen.getByText(file).closest('tr')!;

beforeEach(() => {
  vi.mocked(downloadFile).mockClear();
  vi.mocked(downloadPdf).mockClear();
  vi.mocked(buildPdf).mockClear();
});
afterEach(() => {
  cleanup();
  // De stand blijft bewaard buiten het scherm, en de database in de browser; elke test begint leeg.
  resetRenameState();
  window.localStorage.clear();
});

describe('Slim hernoemen', () => {
  it('stelt per brief een naam voor uit datum, afzender en onderwerp', async () => {
    setup();
    await open('gemeente.pdf');
    expect(screen.getByLabelText<HTMLInputElement>('Datum voor gemeente.pdf').value).toBe('260312');
    expect(screen.getByLabelText<HTMLInputElement>('Afzender van gemeente.pdf').value).toBe(
      'Gemeente Utrecht',
    );
    expect(nameOf('gemeente.pdf')).toBe('260312 gemeente utrecht aan.pdf');
    expect(within(row('gemeente.pdf')).getByText('27/27')).toBeTruthy();
    expect(screen.getByText('1 bestand · klaar')).toBeTruthy();
  });

  it('past de naam aan als je een veld verandert, en houdt een eigen naam vast', async () => {
    setup();
    await open('gemeente.pdf');
    fireEvent.input(screen.getByLabelText('Onderwerp van gemeente.pdf'), {
      target: { value: 'OZB' },
    });
    expect(nameOf('gemeente.pdf')).toBe('260312 gemeente utrecht ozb.pdf');
    fireEvent.input(screen.getByLabelText('Datum voor gemeente.pdf'), {
      target: { value: '26-01-05x' },
    });
    expect(nameOf('gemeente.pdf')).toBe('260105 gemeente utrecht ozb.pdf');
    fireEvent.input(screen.getByLabelText('Nieuwe naam voor gemeente.pdf'), {
      target: { value: 'mijn eigen naam' },
    });
    expect(nameOf('gemeente.pdf')).toBe('mijn eigen naam');
  });

  it('kiest een andere gevonden datum uit de lijst', async () => {
    setup();
    await open('bank1.pdf');
    const select = screen.getByLabelText<HTMLSelectElement>('Gevonden datums in bank1.pdf');
    expect([...select.options].map((option) => option.textContent)).toEqual([
      r.candidates,
      '260203 · d-m-j: 3-2-2026',
    ]);
    fireEvent.input(screen.getByLabelText('Datum voor bank1.pdf'), { target: { value: '' } });
    expect(within(row('bank1.pdf')).getByText(/geen datum/)).toBeTruthy();
    fireEvent.change(select, { target: { value: '260203' } });
    expect(nameOf('bank1.pdf')).toBe('260203 ing bank n afschrift.pdf');
  });

  it('dubbele namen krijgen een volgnummer en een melding; uitvinken haalt dat weg', async () => {
    setup();
    await open('bank1.pdf', 'bank2.pdf');
    expect(nameOf('bank1.pdf')).toBe('260203_01 ing bank n afschrift.pdf');
    expect(nameOf('bank2.pdf')).toBe('260203_02 ing bank n afschrift.pdf');
    fireEvent.click(screen.getByLabelText('bank2.pdf meenemen'));
    expect(nameOf('bank1.pdf')).toBe('260203 ing bank n afschrift.pdf');
  });

  it('meldt een scan zonder tekstlaag en een bestand dat niet te lezen is', async () => {
    setup();
    await open('scan.pdf', 'kapot.pdf');
    expect(within(row('scan.pdf')).getByText(r.noText)).toBeTruthy();
    expect(within(row('kapot.pdf')).getByText(r.readError)).toBeTruthy();
    expect(screen.getByText('2 bestanden · 2 zonder datum')).toBeTruthy();
  });

  it('één bestand: downloadt de kopie meteen met de nieuwe naam', async () => {
    setup();
    await open('gemeente.pdf');
    fireEvent.click(screen.getByRole('button', { name: r.download }));
    await waitFor(() => expect(downloadFile).toHaveBeenCalledTimes(1));
    const [bytes, name, type] = vi.mocked(downloadFile).mock.calls[0]!;
    expect([name, type]).toEqual(['260312 gemeente utrecht aan.pdf', 'application/pdf']);
    expect(new TextDecoder().decode(bytes as Uint8Array)).toBe('%PDF-1.7 gemeente.pdf');
  });

  it('meer bestanden: een ZIP met de hernoemde kopieën, zonder wat uitgevinkt is', async () => {
    setup();
    await open('gemeente.pdf', 'bank1.pdf', 'scan.pdf');
    fireEvent.click(screen.getByLabelText('scan.pdf meenemen'));
    fireEvent.click(screen.getByRole('button', { name: r.download }));
    const dialog = screen.getByRole('dialog');
    expect((within(dialog).getByRole('textbox') as HTMLInputElement).value).toMatch(
      /^pdfs-hernoemd_\d{8}_\d{4}$/,
    );
    fireEvent.click(within(dialog).getByRole('button', { name: messages.nl.saveDialog.download }));
    await waitFor(() => expect(downloadFile).toHaveBeenCalledTimes(1));
    const [zip, name, type] = vi.mocked(downloadFile).mock.calls[0]!;
    expect(type).toBe('application/zip');
    expect(name).toMatch(/^pdfs-hernoemd_\d{8}_\d{4}\.zip$/);
    const files = unzipSync(new Uint8Array(await (zip as Blob).arrayBuffer()));
    expect(Object.keys(files)).toEqual([
      '260312 gemeente utrecht aan.pdf',
      '260203 ing bank n afschrift.pdf',
    ]);
    expect(new TextDecoder().decode(files['260203 ing bank n afschrift.pdf'])).toBe(
      '%PDF-1.7 bank1.pdf',
    );
    expect(await screen.findByText(/2 bestanden gedownload in/)).toBeTruthy();
  });

  it('wissen vraagt eerst, zolang er iets niet gedownload is', async () => {
    setup();
    await open('gemeente.pdf');
    fireEvent.click(screen.getByRole('button', { name: r.clear }));
    expect(screen.getByRole('dialog', { name: r.clearTitle })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: messages.nl.closeDialog.cancel }));
    expect(screen.getByRole('table')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: r.clear }));
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: r.clear }));
    expect(screen.getByRole('heading', { name: r.openTitle })).toBeTruthy();
  });

  it('de tekst per brief is te tonen en te verbergen, ook allemaal tegelijk', async () => {
    setup();
    await open('gemeente.pdf');
    expect(row('gemeente.pdf').querySelector('pre')!.textContent).toContain('Postbus 16200');
    fireEvent.click(screen.getByRole('button', { name: r.hideText }));
    expect(row('gemeente.pdf').querySelector('pre')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: r.hideAllText }));
    fireEvent.click(screen.getByRole('button', { name: r.showAllText }));
    expect(row('gemeente.pdf').querySelector('pre')).toBeTruthy();
  });
});

describe('Slim hernoemen: de stand blijft', () => {
  it('weggaan (naar een andere taak) en terugkomen: alles staat er nog', async () => {
    setup();
    await open('gemeente.pdf');
    fireEvent.input(screen.getByLabelText('Onderwerp van gemeente.pdf'), {
      target: { value: 'OZB' },
    });
    cleanup();
    setup();
    expect(nameOf('gemeente.pdf')).toBe('260312 gemeente utrecht ozb.pdf');
  });

  it('waarschuwt bij het sluiten van het tabblad, zolang er iets niet gedownload is', async () => {
    const leave = () => {
      const event = new Event('beforeunload', { cancelable: true });
      window.dispatchEvent(event);
      return event.defaultPrevented;
    };
    setup();
    expect(leave()).toBe(false);
    await open('gemeente.pdf');
    expect(leave()).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: r.download }));
    await waitFor(() => expect(downloadFile).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(leave()).toBe(false));
  });
});

describe('Slim hernoemen: de database', () => {
  const d = r.db;
  const stored = (): RenameDb => JSON.parse(window.localStorage.getItem(DB_STORAGE_KEY)!);
  const store = (db: RenameDb) => window.localStorage.setItem(DB_STORAGE_KEY, JSON.stringify(db));
  const field = (label: string) => screen.getByLabelText<HTMLInputElement>(label);
  const toView = (name: string) => fireEvent.click(screen.getByRole('button', { name }));

  /** Een export zoals de HTML-tool hem schrijft; verzonnen namen. */
  const EXPORT = JSON.stringify(
    {
      afzenders: [
        { naam: 'Belastingdienst', triggers: ['belastingdienst'] },
        { naam: 'ING', triggers: ['ing bank'] },
      ],
      onderwerpen: [{ naam: 'Aanslag', triggers: ['aanslag'] }],
    },
    null,
    2,
  );
  const json = (text: string) => new File([text], 'export.json', { type: 'application/json' });
  const importFile = (file: File) =>
    fireEvent.change(document.querySelector('#rename-db-import')!, { target: { files: [file] } });

  it('herkenwoorden gaan vóór de gok; zo’n veld heeft een groene rand tot je het aanpast', async () => {
    store({
      afzenders: [
        { naam: 'Bank', triggers: ['bank'] },
        { naam: 'ING', triggers: ['ing bank'] },
      ],
      onderwerpen: [{ naam: 'Rekening', triggers: ['afschrift'] }],
    });
    setup();
    await open('bank1.pdf', 'gemeente.pdf');
    const sender = field('Afzender van bank1.pdf');
    // Het langste herkenwoord wint ("ing bank", niet "bank").
    expect(sender.value).toBe('ING');
    expect(field('Onderwerp van bank1.pdf').value).toBe('Rekening');
    expect(nameOf('bank1.pdf')).toBe('260203 ing rekening.pdf');
    expect(sender.classList.contains('rename-table__known')).toBe(true);
    expect(document.getElementById(sender.getAttribute('aria-describedby')!)!.textContent).toBe(
      r.known,
    );
    // Zonder herkenwoord in de tekst: de eigen gok, zonder groene rand.
    const gemeente = field('Afzender van gemeente.pdf');
    expect(gemeente.value).toBe('Gemeente Utrecht');
    expect(gemeente.classList.contains('rename-table__known')).toBe(false);

    fireEvent.input(sender, { target: { value: 'ING Bank' } });
    expect(sender.classList.contains('rename-table__known')).toBe(false);
    expect(sender.hasAttribute('aria-describedby')).toBe(false);
  });

  it('wat je invult, wordt onthouden en komt terug als suggestie', async () => {
    setup();
    await open('gemeente.pdf');
    const sender = field('Afzender van gemeente.pdf');
    expect(sender.getAttribute('list')).toBe('rename-senders');
    fireEvent.input(sender, { target: { value: ' Gemeente Utrecht (OZB) ' } });
    // Tijdens het typen nog niet; pas als je het veld verlaat.
    expect(window.localStorage.getItem(DB_STORAGE_KEY)).toBeNull();
    fireEvent.change(sender);
    fireEvent.change(field('Onderwerp van gemeente.pdf'), { target: { value: 'OZB' } });
    // Dezelfde naam met andere hoofdletters komt er niet nog eens bij.
    fireEvent.change(sender, { target: { value: 'gemeente utrecht (ozb)' } });
    expect(stored()).toEqual({
      afzenders: [{ naam: 'Gemeente Utrecht (OZB)', triggers: [] }],
      onderwerpen: [{ naam: 'OZB', triggers: [] }],
    });
    const options = [...document.querySelectorAll('#rename-senders option')];
    expect(options.map((option) => option.getAttribute('value'))).toEqual([
      'Gemeente Utrecht (OZB)',
    ]);
    // Wissen haalt de brieven weg, niet de database.
    fireEvent.click(screen.getByRole('button', { name: r.clear }));
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: r.clear }));
    expect(stored().afzenders).toHaveLength(1);
  });

  it('bij downloaden: ook wat de tool zelf vond, van de meegenomen brieven', async () => {
    store({
      afzenders: [],
      onderwerpen: [{ naam: 'aanslag gemeentelijke belastingen', triggers: ['x'] }],
    });
    setup();
    await open('gemeente.pdf', 'bank1.pdf', 'scan.pdf');
    fireEvent.click(screen.getByLabelText('bank1.pdf meenemen'));
    // Nog niets aangepast: nog niets onthouden.
    expect(stored().afzenders).toEqual([]);
    fireEvent.click(screen.getByRole('button', { name: r.download }));
    fireEvent.click(
      within(screen.getByRole('dialog')).getByRole('button', {
        name: messages.nl.saveDialog.download,
      }),
    );
    await waitFor(() => expect(downloadFile).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(stored().afzenders).toHaveLength(1));
    // Niet de uitgevinkte bankbrief, geen lege velden (de scan zonder tekst), en een bekende naam
    // (op hoofdletters na) niet nog eens.
    expect(stored()).toEqual({
      afzenders: [{ naam: 'Gemeente Utrecht', triggers: [] }],
      onderwerpen: [{ naam: 'aanslag gemeentelijke belastingen', triggers: ['x'] }],
    });
  });

  it('nieuwe herkenwoorden onder Database; Herken opnieuw past ze toe op de geladen brieven', async () => {
    setup();
    await open('gemeente.pdf');
    fireEvent.input(screen.getByLabelText('Nieuwe naam voor gemeente.pdf'), {
      target: { value: 'eigen naam' },
    });
    // De schakelaar blijft staan (wordt niet opnieuw gemaakt), dus de knop houdt de focus.
    const database = screen.getByRole('button', { name: r.views.database });
    database.focus();
    fireEvent.click(database);
    expect(database.getAttribute('aria-pressed')).toBe('true');
    expect(document.activeElement).toBe(database);

    fireEvent.click(screen.getByRole('button', { name: d.kinds.afzenders.add }));
    const naam = field('Naam van afzender 1');
    // Een nieuwe regel krijgt meteen de focus.
    expect(document.activeElement).toBe(naam);
    fireEvent.change(naam, { target: { value: 'Gemeente' } });
    fireEvent.change(field('Herkenwoorden van afzender 1'), {
      target: { value: 'postbus 16200' },
    });

    toView(r.views.rename);
    // De lijst met brieven is er nog, met de eigen naam.
    expect(nameOf('gemeente.pdf')).toBe('eigen naam');
    fireEvent.click(screen.getByRole('button', { name: r.recognizeAgain }));
    expect(field('Afzender van gemeente.pdf').value).toBe('Gemeente');
    expect(field('Afzender van gemeente.pdf').classList.contains('rename-table__known')).toBe(true);
    // De eigen naam maakt weer plaats voor het voorstel.
    expect(nameOf('gemeente.pdf')).toBe('260312 gemeente aanslag gem.pdf');
    expect(screen.getByRole('status').textContent).toBe(r.recognized);
  });

  it('regels bewerken en verwijderen; de rij blijft staan terwijl je bewerkt', () => {
    setup();
    toView(r.views.database);
    expect(screen.getAllByText(d.empty)).toHaveLength(2);
    fireEvent.click(screen.getByRole('button', { name: d.kinds.onderwerpen.add }));
    fireEvent.click(screen.getByRole('button', { name: d.kinds.onderwerpen.add }));
    const naam = field('Naam van onderwerp 1');
    fireEvent.change(naam, { target: { value: '  Notaris  ' } });
    // Dezelfde rij (het veld is niet opnieuw gemaakt), dus de focus blijft waar hij was.
    expect(field('Naam van onderwerp 1')).toBe(naam);
    expect(naam.value).toBe('Notaris');
    const triggers = field('Herkenwoorden van onderwerp 1');
    fireEvent.change(triggers, { target: { value: 'notaris,  notariaat ,' } });
    expect(triggers.value).toBe('notaris, notariaat');
    expect(stored().onderwerpen).toEqual([
      { naam: 'Notaris', triggers: ['notaris', 'notariaat'] },
      { naam: '', triggers: [] },
    ]);
    expect(screen.getByText('2 onderwerpen')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Verwijderen: onderwerp 1' }));
    expect(stored().onderwerpen).toEqual([{ naam: '', triggers: [] }]);
    expect(field('Naam van onderwerp 1').value).toBe('');
  });

  it('importeren voegt samen; exporteren geeft het bestand van de HTML-tool', async () => {
    store({ afzenders: [{ naam: 'ing', triggers: ['nl99ingb'] }], onderwerpen: [] });
    setup();
    toView(r.views.database);
    importFile(json(EXPORT));
    expect(
      await screen.findByText('Geïmporteerd en samengevoegd: +1 afzender, +1 onderwerp.'),
    ).toBeTruthy();
    expect(stored()).toEqual({
      afzenders: [
        { naam: 'ing', triggers: ['nl99ingb', 'ing bank'] },
        { naam: 'Belastingdienst', triggers: ['belastingdienst'] },
      ],
      onderwerpen: [{ naam: 'Aanslag', triggers: ['aanslag'] }],
    });
    expect(field('Herkenwoorden van afzender 1').value).toBe('nl99ingb, ing bank');

    fireEvent.click(screen.getByRole('button', { name: d.export }));
    expect(downloadFile).toHaveBeenCalledTimes(1);
    const [bytes, name, type] = vi.mocked(downloadFile).mock.calls[0]!;
    expect([name, type]).toEqual(['pdf-hernoemer-database.json', 'application/json']);
    const text = new TextDecoder().decode(bytes as Uint8Array);
    expect(text).toBe(JSON.stringify(stored(), null, 2));
    expect(screen.getByText('Geëxporteerd: 2 afzenders, 1 onderwerp.')).toBeTruthy();

    importFile(json('{"afzenders": []}'));
    expect((await screen.findByRole('alert')).textContent).toBe(d.importError);
    expect(stored().afzenders).toHaveLength(2);
  });
});

describe('Slim hernoemen: samenvoegen', () => {
  const m = r.merge;
  const toView = (name: string) => fireEvent.click(screen.getByRole('button', { name }));
  /** De nieuwe namen in de volgorde van de lijst. */
  const order = () =>
    [...document.querySelectorAll('.rename-merge tbody .rename-table__file')].map(
      (cell) => cell.firstChild!.textContent,
    );
  const addExtras = async (...names: string[]) => {
    fireEvent.change(document.querySelector('#rename-merge-add')!, {
      target: { files: names.map(pdf) },
    });
    await screen.findByText(names.length === 1 ? m.addedOne : `${names.length} PDF’s toegevoegd.`);
  };
  const up = (name: string) => screen.getByRole('button', { name: `${name} omhoog` });
  const down = (name: string) => screen.getByRole('button', { name: `${name} omlaag` });
  const GEMEENTE = '260312 gemeente utrecht aan.pdf';
  const BANK = '260203 ing bank n afschrift.pdf';

  it('op datum: de nieuwste eerst, zonder datum onderaan; aan/uit los van meenemen', async () => {
    setup();
    await open('scan.pdf', 'bank1.pdf', 'gemeente.pdf', 'kapot.pdf');
    // Bij Hernoemen uitgevinkt: bij samenvoegen staat hij gewoon aan.
    fireEvent.click(screen.getByLabelText('bank1.pdf meenemen'));
    toView(r.views.merge);
    expect(order()).toEqual([GEMEENTE, BANK, 'naamloos_01.pdf', 'naamloos_02.pdf']);
    expect(screen.getByLabelText<HTMLInputElement>(`${BANK} samenvoegen`).checked).toBe(true);
    // Niet te lezen: niet samen te voegen.
    const kapot = screen.getByLabelText<HTMLInputElement>('naamloos_02.pdf samenvoegen');
    expect([kapot.checked, kapot.disabled]).toEqual([false, true]);
    expect(
      screen.getByText('3 bestanden · 3 pagina’s · eerst de nieuwste, als laatste de oudste'),
    ).toBeTruthy();
    fireEvent.click(screen.getByLabelText(`${BANK} samenvoegen`));
    expect(screen.getByText(/^2 bestanden · 2 pagina’s/)).toBeTruthy();
  });

  it('een aangepaste datum schuift mee, tot je zelf schuift; Sorteer op datum zet het terug', async () => {
    setup();
    await open('gemeente.pdf', 'bank1.pdf');
    toView(r.views.merge);
    expect(order()).toEqual([GEMEENTE, BANK]);
    expect((screen.getByRole('button', { name: m.sort }) as HTMLButtonElement).disabled).toBe(true);

    // Een half ingevulde datum telt niet: onderaan.
    toView(r.views.rename);
    fireEvent.input(screen.getByLabelText('Datum voor bank1.pdf'), { target: { value: '2604' } });
    toView(r.views.merge);
    expect(order()).toEqual([GEMEENTE, '2604 ing bank n afschrift.pdf']);

    toView(r.views.rename);
    fireEvent.input(screen.getByLabelText('Datum voor bank1.pdf'), { target: { value: '260401' } });
    toView(r.views.merge);
    const bank = '260401 ing bank n afschrift.pdf';
    expect(order()).toEqual([bank, GEMEENTE]);

    // Zelf schuiven; de focus blijft op een pijl van dezelfde brief (bovenaan: de pijl omlaag).
    fireEvent.click(up(GEMEENTE));
    expect(order()).toEqual([GEMEENTE, bank]);
    expect(document.activeElement).toBe(down(GEMEENTE));
    fireEvent.click(down(GEMEENTE));
    fireEvent.click(up(GEMEENTE));
    expect(document.activeElement).toBe(down(GEMEENTE));
    // Een nieuwe datum verandert de eigen volgorde niet meer.
    toView(r.views.rename);
    fireEvent.input(screen.getByLabelText('Datum voor bank1.pdf'), { target: { value: '260501' } });
    toView(r.views.merge);
    expect(order()).toEqual([GEMEENTE, '260501 ing bank n afschrift.pdf']);

    fireEvent.click(screen.getByRole('button', { name: m.sort }));
    expect(order()).toEqual(['260501 ing bank n afschrift.pdf', GEMEENTE]);
  });

  it('losse, al hernoemde PDF’s: datum uit de naam, label extern; eigen volgorde houdt ze onderaan', async () => {
    setup();
    toView(r.views.merge);
    expect(screen.getByText(m.empty)).toBeTruthy();
    await addExtras('260501 notaris akte 3p.pdf', 'losse scan.pdf', '260101 kapot.pdf');
    expect(order()).toEqual(['260501 notaris akte 3p.pdf', '260101 kapot.pdf', 'losse scan.pdf']);
    expect(screen.getAllByText(m.external)).toHaveLength(3);
    expect(screen.getByText(/^2 bestanden · 4 pagina’s/)).toBeTruthy();

    // Na zelf schuiven komen nieuwe PDF's onderaan, ook met een nieuwere datum.
    fireEvent.click(down('260501 notaris akte 3p.pdf'));
    await addExtras('261231 nieuw.pdf');
    expect(order()).toEqual([
      '260101 kapot.pdf',
      '260501 notaris akte 3p.pdf',
      'losse scan.pdf',
      '261231 nieuw.pdf',
    ]);

    fireEvent.click(screen.getByRole('button', { name: m.clearExtras }));
    expect(screen.getByText(m.empty)).toBeTruthy();
    expect(screen.queryByRole('button', { name: m.clearExtras })).toBeNull();
  });

  it('samenvoegen: de gekozen PDF’s in volgorde, met een bladwijzer per brief', async () => {
    setup();
    await open('gemeente.pdf', 'bank1.pdf');
    toView(r.views.merge);
    await addExtras('260101 oud 2p.pdf');
    fireEvent.click(screen.getByLabelText(`${BANK} samenvoegen`));
    fireEvent.click(screen.getByRole('button', { name: m.download }));
    const dialog = screen.getByRole('dialog', { name: m.saveTitle });
    expect((within(dialog).getByRole('textbox') as HTMLInputElement).value).toBe(
      '260101-260312 samengevoegd',
    );
    fireEvent.click(within(dialog).getByRole('button', { name: messages.nl.saveDialog.download }));
    await waitFor(() => expect(downloadPdf).toHaveBeenCalledTimes(1));

    const [sources, pages, options] = vi.mocked(buildPdf).mock.calls[0]!;
    const fileOf = (doc: number) => new TextDecoder().decode(sources.get(doc));
    // Alle pagina's van elk bestand, op volgorde van de lijst, met unieke sleutels.
    expect(pages.map((page) => [fileOf(page.doc), page.source, page.key])).toEqual([
      ['%PDF-1.7 gemeente.pdf', 0, 0],
      ['%PDF-1.7 260101 oud 2p.pdf', 0, 1],
      ['%PDF-1.7 260101 oud 2p.pdf', 1, 2],
    ]);
    expect(options!.bookmarks!.map((mark) => [fileOf(mark.doc), mark.title])).toEqual([
      ['%PDF-1.7 gemeente.pdf', '260312 gemeente utrecht aan'],
      ['%PDF-1.7 260101 oud 2p.pdf', '260101 oud 2p'],
    ]);
    expect(vi.mocked(downloadPdf).mock.calls[0]).toEqual([
      new Uint8Array([1, 2, 3]),
      '260101-260312 samengevoegd.pdf',
    ]);
    expect(screen.getByText('Opgeslagen als 260101-260312 samengevoegd.pdf.')).toBeTruthy();

    // Zonder bladwijzers; en een fout van het opslaan wordt gemeld.
    fireEvent.click(screen.getByLabelText(m.bookmarks));
    vi.mocked(buildPdf).mockRejectedValueOnce(new PdfSaveError('encrypted'));
    fireEvent.click(screen.getByRole('button', { name: m.download }));
    fireEvent.click(
      within(screen.getByRole('dialog')).getByRole('button', {
        name: messages.nl.saveDialog.download,
      }),
    );
    expect((await screen.findByRole('alert')).textContent).toBe(messages.nl.pages.errors.encrypted);
    expect(vi.mocked(buildPdf).mock.calls[1]![2]).toEqual({});
  });

  it('Wissen (ook bij Hernoemen) haalt de losse PDF’s en de eigen volgorde weg', async () => {
    setup();
    await open('gemeente.pdf', 'bank1.pdf');
    toView(r.views.merge);
    await addExtras('260101 oud.pdf');
    fireEvent.click(up(BANK));
    toView(r.views.rename);
    fireEvent.click(screen.getByRole('button', { name: r.clear }));
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: r.clear }));
    toView(r.views.merge);
    expect(screen.getByText(m.empty)).toBeTruthy();
    toView(r.views.rename);
    await open('gemeente.pdf', 'bank1.pdf');
    toView(r.views.merge);
    // Weer op datum (er is geen eigen volgorde meer om terug te zetten).
    expect(order()).toEqual([GEMEENTE, BANK]);
    expect((screen.getByRole('button', { name: m.sort }) as HTMLButtonElement).disabled).toBe(true);
  });
});

describe('Slim hernoemen: bekijken', () => {
  it('opent per brief het voorbeeldvenster, met de nieuwe naam bovenaan', async () => {
    setup();
    await open('gemeente.pdf', 'kapot.pdf');
    // Een bestand dat niet te lezen was, is ook niet te bekijken.
    expect(screen.queryByRole('button', { name: 'kapot.pdf bekijken' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'gemeente.pdf bekijken' }));
    const dialog = screen.getByRole('dialog', {
      name: '260312 gemeente utrecht aan.pdf · gemeente.pdf',
    });
    fireEvent.click(within(dialog).getByRole('button', { name: r.preview.close }));
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
