// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/preact';
import { unzipSync } from 'fflate';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { messages } from '../i18n';
import { LanguageProvider } from '../i18n/LanguageContext';
import { downloadFile } from '../pdf/save';
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
}));

vi.mock('../pdf/save', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../pdf/save')>()),
  downloadFile: vi.fn(),
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

beforeEach(() => vi.mocked(downloadFile).mockClear());
afterEach(() => {
  cleanup();
  // De stand blijft bewaard buiten het scherm; elke test begint leeg.
  resetRenameState();
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
