// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/preact';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { closeVisual, pageSize, renderPage } from '../compare/visual';
import { messages } from '../i18n';
import { LanguageProvider } from '../i18n/LanguageContext';
import { format } from '../i18n/format';
import { PdfLoadError } from '../pdf/loader';
import { downloadFile } from '../pdf/save';
import { TriageTool } from './TriageTool';
import { ADVANCE_MS, getTriageState, resetTriageState } from './store';

/** Het aantal pagina's per bestand (of een fout bij openen). */
const DOCS: Record<string, number | Error> = {
  'a.pdf': 3,
  'b.pdf': 1,
  'c.pdf': 2,
  'd.pdf': 1,
  'geheim.pdf': new PdfLoadError('password'),
};

// Het tekenen nagebootst (jsdom kan niet echt tekenen); de rekenregels voor de zoom blijven echt.
vi.mock('../compare/visual', async (importOriginal) => {
  const real = await importOriginal<typeof import('../compare/visual')>();
  return {
    ...real,
    pageSize: vi.fn(async (file: File, no: number) => {
      const pages = DOCS[file.name]!;
      if (pages instanceof Error) throw pages;
      return no < 1 || no > pages ? null : { count: pages, w: 595, h: 842 };
    }),
    renderPage: vi.fn(async (_file: File, _no: number, width: number) => {
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = Math.round(width * 1.414);
      return canvas;
    }),
    closeVisual: vi.fn(),
  };
});

vi.mock('../pdf/save', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../pdf/save')>()),
  downloadFile: vi.fn(),
}));

const tr = messages.nl.triage;
const pv = messages.nl.plainText.preview;
const pdf = (name: string) => new File([`%PDF-1.7 ${name}`], name, { type: 'application/pdf' });

function setup() {
  render(
    <LanguageProvider initial="nl">
      <TriageTool />
    </LanguageProvider>,
  );
}

function choose(...files: File[]) {
  fireEvent.change(document.querySelector('#triage-files')!, { target: { files } });
}

/** Effecten en het lezen van de PDF lopen pas na het tekenen. */
const settle = (ms = 30) => act(() => new Promise((resolve) => setTimeout(resolve, ms)));
/** Wachten tot na een besluit het volgende bestand verschijnt. */
const advance = () => settle(ADVANCE_MS + 60);

const key = (k: string, init: KeyboardEventInit = {}) =>
  act(() => {
    fireEvent.keyDown(document, { key: k, ...init });
  });

const list = () => screen.getByRole('list', { name: tr.files });
const current = () =>
  within(list())
    .getAllByRole('button')
    .find((b) => b.getAttribute('aria-current') === 'true');
const names = () => getTriageState().files.map((f) => [f.name, f.decision, f.page]);
const pageText = () => document.querySelector('.plaintext-bar .plaintext-nav__page')?.textContent;

beforeEach(() => {
  vi.mocked(downloadFile).mockClear();
  vi.mocked(closeVisual).mockClear();
  vi.mocked(pageSize).mockClear();
  vi.mocked(renderPage).mockClear();
});

afterEach(() => {
  cleanup();
  resetTriageState();
});

describe('TriageTool', () => {
  it('begint leeg: uitleg, alleen Lijst maken te kiezen, nog geen lijst', () => {
    setup();
    // Zoals pdf-triage.html: de pagina op de breedte van het vak.
    expect(getTriageState()).toMatchObject({ fit: 'width', zoom: 100 });
    expect(screen.getByText(tr.placeholder)).toBeTruthy();
    expect(screen.getByRole('button', { name: tr.modes.list }).getAttribute('aria-pressed')).toBe(
      'true',
    );
    expect(
      (screen.getByRole('button', { name: tr.modes.folder }) as HTMLButtonElement).disabled,
    ).toBe(true);
    expect(screen.queryByRole('list', { name: tr.files })).toBeNull();
    expect((screen.getByRole('button', { name: tr.clear }) as HTMLButtonElement).disabled).toBe(
      true,
    );
  });

  it('PDF’s toevoegen: de eerste gaat open, andere bestanden worden overgeslagen en genoemd', async () => {
    setup();
    choose(pdf('a.pdf'), new File(['x'], 'foto.jpg', { type: 'image/jpeg' }), pdf('b.pdf'));
    await settle();
    expect(within(list()).getAllByRole('button')).toHaveLength(2);
    expect(current()?.textContent).toContain('a.pdf');
    expect(
      screen.getByText(`${tr.skipped.replace('{list}', '1 bestand is geen PDF')}`),
    ).toBeTruthy();
    expect(screen.getByText(/a\.pdf · 3 pagina’s/)).toBeTruthy();
    expect(pageText()).toContain('1 / 3');
    expect(screen.getByText(format(tr.slot.count, { n: 2 }))).toBeTruthy();

    // Nog eens toevoegen: achteraan, een naam die er al staat niet; de open PDF blijft open.
    choose(pdf('b.pdf'), pdf('c.pdf'));
    await settle();
    expect(names().map(([n]) => n)).toEqual(['a.pdf', 'b.pdf', 'c.pdf']);
    expect(
      screen.getByText(tr.skipped.replace('{list}', '1 naam stond al in de lijst')),
    ).toBeTruthy();
    expect(current()?.textContent).toContain('a.pdf');
  });

  it('K en X beslissen; daarna volgt het volgende nog niet beoordeelde bestand', async () => {
    setup();
    choose(pdf('a.pdf'), pdf('b.pdf'), pdf('c.pdf'), pdf('d.pdf'));
    await settle();
    await key('k');
    // Het besluit is meteen te zien; het volgende bestand komt pas even later.
    expect(names()[0]![1]).toBe('keep');
    expect(current()?.textContent).toContain('a.pdf');
    expect(screen.getByRole('button', { name: tr.keep }).getAttribute('aria-pressed')).toBe('true');
    await advance();
    expect(current()?.textContent).toContain('b.pdf');

    await key('X');
    await advance();
    expect(current()?.textContent).toContain('c.pdf');

    // Terug naar a en verwijderen: b is al beoordeeld, dus door naar c.
    await key('ArrowLeft');
    await key('ArrowLeft');
    expect(current()?.textContent).toContain('a.pdf');
    await key('x');
    await advance();
    expect(current()?.textContent).toContain('c.pdf');
    expect(names().map(([, d]) => d)).toEqual(['remove', 'remove', null, null]);
    const progress = document.querySelector('.triage-progress')!;
    expect(progress.querySelector('p')!.textContent).toBe(
      `${format(tr.progress, { done: 2, total: 4 })} · ✓ 0 · ✕ 2${format(tr.tallyLabel, { keep: 0, remove: 2 })}`,
    );
    expect(progress.querySelector('progress')!.getAttribute('value')).toBe('2');
    expect(progress.querySelector('progress')!.getAttribute('max')).toBe('4');
  });

  it('nog eens dezelfde toets haalt het besluit weg, en dan blijf je staan', async () => {
    setup();
    choose(pdf('a.pdf'), pdf('b.pdf'));
    await settle();
    await key('k');
    await key('k');
    await advance();
    expect(names()[0]![1]).toBe(null);
    expect(current()?.textContent).toContain('a.pdf');
  });

  it('bij het laatste bestand blijf je staan na een besluit', async () => {
    setup();
    choose(pdf('a.pdf'), pdf('b.pdf'));
    await settle();
    await key('ArrowRight');
    await key('k');
    await advance();
    expect(current()?.textContent).toContain('b.pdf');
    expect(names()[1]![1]).toBe('keep');
  });

  it('de knoppen doen hetzelfde als de toetsen', async () => {
    setup();
    choose(pdf('a.pdf'), pdf('b.pdf'));
    await settle();
    fireEvent.click(screen.getByRole('button', { name: tr.remove }));
    expect(names()[0]![1]).toBe('remove');
    await advance();
    expect(current()?.textContent).toContain('b.pdf');
    fireEvent.click(screen.getByRole('button', { name: tr.previousFile }));
    expect(current()?.textContent).toContain('a.pdf');
    fireEvent.click(screen.getByRole('button', { name: tr.nextFile }));
    expect(current()?.textContent).toContain('b.pdf');
    fireEvent.click(within(list()).getByRole('button', { name: /^a\.pdf/ }));
    expect(current()?.textContent).toContain('a.pdf');
    expect(current()?.getAttribute('class')).toContain('triage-list__item--remove');
  });

  it('wie zelf naar een ander bestand gaat, wordt niet meer verplaatst door het besluit van daarvoor', async () => {
    setup();
    choose(pdf('a.pdf'), pdf('b.pdf'), pdf('c.pdf'));
    await settle();
    await key('k');
    await key('ArrowRight');
    await key('ArrowRight');
    await advance();
    expect(current()?.textContent).toContain('c.pdf');
  });

  it('↑ ↓, Page Up/Down, Home en End bladeren; elk bestand onthoudt zijn pagina', async () => {
    setup();
    choose(pdf('a.pdf'), pdf('c.pdf'));
    await settle();
    await key('ArrowUp');
    expect(names()[0]![2]).toBe(1);
    await key('ArrowDown');
    expect(names()[0]![2]).toBe(2);
    await key('End');
    expect(names()[0]![2]).toBe(3);
    await key('ArrowDown');
    expect(names()[0]![2]).toBe(3);
    await key('Home');
    expect(names()[0]![2]).toBe(1);
    await key('PageDown');
    expect(names()[0]![2]).toBe(2);
    await settle();
    expect(pageText()).toContain('2 / 3');
    await key('ArrowRight');
    await settle();
    expect(pageText()).toContain('1 / 2');
    await key('PageDown');
    await key('PageUp');
    await key('PageDown');
    expect(names()[1]![2]).toBe(2);
    await key('ArrowLeft');
    await settle();
    expect(pageText()).toContain('2 / 3');
    expect(vi.mocked(renderPage).mock.calls.at(-1)?.slice(0, 2)).toEqual([
      getTriageState().files[0]!.file,
      2,
    ]);
  });

  it('bladeren met de knoppen', async () => {
    setup();
    choose(pdf('a.pdf'));
    await settle();
    fireEvent.click(screen.getByRole('button', { name: pv.last }));
    expect(names()[0]![2]).toBe(3);
    fireEvent.click(screen.getByRole('button', { name: pv.previous }));
    expect(names()[0]![2]).toBe(2);
    fireEvent.click(screen.getByRole('button', { name: pv.first }));
    expect(names()[0]![2]).toBe(1);
    fireEvent.click(screen.getByRole('button', { name: pv.next }));
    expect(names()[0]![2]).toBe(2);
  });

  it('zoomen en passend maken', async () => {
    setup();
    choose(pdf('a.pdf'));
    await settle();
    fireEvent.click(screen.getByRole('button', { name: pv.zoomIn }));
    expect(getTriageState().zoom).toBe(125);
    fireEvent.click(screen.getByRole('button', { name: pv.zoomOut }));
    fireEvent.click(screen.getByRole('button', { name: pv.zoomOut }));
    expect(getTriageState().zoom).toBe(75);
    fireEvent.click(screen.getByRole('button', { name: pv.fitPage }));
    expect(getTriageState()).toMatchObject({ fit: 'page', zoom: 100 });
    expect(screen.getByRole('button', { name: pv.fitPage }).getAttribute('aria-pressed')).toBe(
      'true',
    );
    fireEvent.click(screen.getByRole('button', { name: pv.fitWidth }));
    expect(getTriageState()).toMatchObject({ fit: 'width', zoom: 100 });
  });

  it('toetsen doen niets met Ctrl, in een venster of in het overzicht', async () => {
    setup();
    choose(pdf('a.pdf'), pdf('b.pdf'));
    await settle();
    await key('k', { ctrlKey: true });
    await key('x', { altKey: true });
    expect(names()[0]![1]).toBe(null);

    fireEvent.click(screen.getByRole('button', { name: tr.clear }));
    await settle();
    await key('k');
    expect(names()[0]![1]).toBe(null);
    fireEvent.click(screen.getByRole('button', { name: tr.cancel }));
    await settle();

    fireEvent.click(screen.getByRole('button', { name: tr.views.overview }));
    await key('k');
    await key('ArrowRight');
    expect(names()[0]![1]).toBe(null);
    expect(getTriageState().cur).toBe(0);
  });

  it('een PDF die niet open kan: de reden, en beslissen kan nog steeds', async () => {
    setup();
    choose(pdf('geheim.pdf'), pdf('b.pdf'));
    await settle();
    expect(screen.getByRole('alert').textContent).toBe(messages.nl.compare.errors.password);
    await key('x');
    await advance();
    expect(names()[0]![1]).toBe('remove');
    expect(current()?.textContent).toContain('b.pdf');
  });

  it('de PDF van het vorige bestand gaat dicht', async () => {
    setup();
    choose(pdf('a.pdf'), pdf('b.pdf'));
    await settle();
    await key('ArrowRight');
    expect(vi.mocked(closeVisual)).toHaveBeenCalledWith(getTriageState().files[0]!.file);
  });

  it('het overzicht toont de groepen en downloadt de lijst als .txt en .csv', async () => {
    setup();
    choose(pdf('a.pdf'), pdf('b.pdf'), pdf('c.pdf'));
    await settle();
    await key('k');
    await advance();
    await key('x');
    await advance();
    fireEvent.click(screen.getByRole('button', { name: tr.views.overview }));
    expect(screen.getByRole('heading', { name: format(tr.overview.keep, { n: 1 }) })).toBeTruthy();
    expect(
      screen.getByRole('heading', { name: format(tr.overview.remove, { n: 1 }) }),
    ).toBeTruthy();
    expect(screen.getByRole('heading', { name: format(tr.overview.none, { n: 1 }) })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: tr.overview.txt }));
    const [txt, txtName, txtType] = vi.mocked(downloadFile).mock.calls[0]!;
    expect(txtName).toBe('triage.txt');
    expect(txtType).toBe('text/plain');
    expect(new TextDecoder().decode(txt as Uint8Array)).toBe(
      'ARCHIEF TRIAGE\n====================================\n\nBEWAREN:\n  a.pdf\n\nVERWIJDEREN:\n  b.pdf\n\nNIET BEOORDEELD:\n  c.pdf\n',
    );
    expect(screen.getByRole('status').textContent).toBe(
      format(tr.overview.downloaded, { name: 'triage.txt' }),
    );

    fireEvent.click(screen.getByRole('button', { name: tr.overview.csv }));
    const [csv, csvName, csvType] = vi.mocked(downloadFile).mock.calls[1]!;
    expect(csvName).toBe('triage.csv');
    expect(csvType).toBe('text/csv');
    expect(new TextDecoder().decode(csv as Uint8Array)).toBe(
      '"Bestandsnaam","Besluit"\n"a.pdf","bewaren"\n"b.pdf","verwijderen"\n"c.pdf","niet beoordeeld"',
    );

    // Een bestand in de lijst kiezen gaat terug naar Beoordelen.
    fireEvent.click(within(list()).getByRole('button', { name: /^b\.pdf/ }));
    expect(getTriageState().view).toBe('review');
  });

  it('het overzicht zonder PDF’s: uitleg, en niets te downloaden', () => {
    setup();
    fireEvent.click(screen.getByRole('button', { name: tr.views.overview }));
    expect(screen.getByText(tr.overview.empty)).toBeTruthy();
    expect(
      (screen.getByRole('button', { name: tr.overview.txt }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  it('Wis alles vraagt eerst; Annuleren laat alles staan', async () => {
    setup();
    choose(pdf('a.pdf'), pdf('b.pdf'));
    await settle();
    await key('k');
    fireEvent.click(screen.getByRole('button', { name: tr.clear }));
    fireEvent.click(screen.getByRole('button', { name: tr.cancel }));
    expect(getTriageState().files).toHaveLength(2);

    fireEvent.click(screen.getByRole('button', { name: tr.clear }));
    fireEvent.click(screen.getByRole('button', { name: tr.clearConfirm }));
    await advance();
    expect(getTriageState().files).toHaveLength(0);
    expect(getTriageState().cur).toBe(-1);
    expect(screen.getByText(tr.placeholder)).toBeTruthy();
    expect(vi.mocked(closeVisual)).toHaveBeenCalled();
  });

  it('in het Engels', async () => {
    render(
      <LanguageProvider initial="en">
        <TriageTool />
      </LanguageProvider>,
    );
    choose(pdf('a.pdf'));
    await settle();
    expect(screen.getByRole('button', { name: messages.en.triage.keep })).toBeTruthy();
    expect(screen.getByText(/a\.pdf · 3 pages/)).toBeTruthy();
  });
});
