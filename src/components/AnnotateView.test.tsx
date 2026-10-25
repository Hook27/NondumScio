// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/preact';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DocumentProvider } from '../document/DocumentContext';
import { messages } from '../i18n';
import { LanguageProvider } from '../i18n/LanguageContext';
import type { LoadedPdf } from '../pdf/loader';
import { buildPdf, downloadPdf } from '../pdf/save';
import { Workspace } from './Workspace';

vi.mock('../pdf/save', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../pdf/save')>()),
  buildPdf: vi.fn(async () => new Uint8Array([37, 80, 68, 70])),
  downloadPdf: vi.fn(),
}));

const nl = messages.nl;

/** Een nep-PDF; het aantal pagina's staat in de inhoud van het nepbestand ("%PDF-1.7 3"). */
function fakeLoad(bytes: Uint8Array): Promise<LoadedPdf> {
  const pageCount = Number(/%PDF-1\.7 (\d+)/.exec(new TextDecoder().decode(bytes))?.[1] ?? 1);
  const page = {
    rotate: 0,
    getViewport: ({ scale, rotation = 0 }: { scale: number; rotation?: number }) => {
      const sideways = rotation === 90 || rotation === 270;
      return {
        width: (sideways ? 842 : 595) * scale,
        height: (sideways ? 595 : 842) * scale,
      };
    },
    render: () => ({ promise: Promise.resolve(), cancel: () => {} }),
    cleanup: () => {},
  };
  const pdf = { numPages: pageCount, getPage: async () => page } as unknown as PDFDocumentProxy;
  return Promise.resolve({ pdf, pageCount });
}

async function setup(pages = 3) {
  render(
    <LanguageProvider initial="nl">
      <DocumentProvider load={fakeLoad} unload={() => {}}>
        <Workspace mode="edit" />
      </DocumentProvider>
    </LanguageProvider>,
  );
  fireEvent.change(document.querySelector('input[type="file"]')!, {
    target: { files: [new File([`%PDF-1.7 ${pages}\n`], 'rapport.pdf')] },
  });
  await screen.findByRole('list', { name: nl.edit.pages });
  // Preact voert effecten (zoals de sneltoetsen) pas na het tekenen uit: even wachten.
  await act(() => new Promise((resolve) => setTimeout(resolve, 150)));
}

const button = (name: string) => screen.getByRole('button', { name }) as HTMLButtonElement;
const pageNr = (n: number) => screen.getByRole('group', { name: `Pagina ${n}` });
const shapes = () => document.querySelectorAll('[data-annotation]');
const press = (key: string, init: KeyboardEventInit = {}) =>
  fireEvent.keyDown(document.body, { key, ...init });

beforeEach(() => {
  vi.mocked(buildPdf).mockClear();
  vi.mocked(downloadPdf).mockClear();
});

afterEach(() => cleanup());

describe('Bewerken: annoteren', () => {
  it('toont de pagina’s op leesbare grootte met de gereedschappen en de zoomknoppen', async () => {
    await setup(3);
    expect(screen.getAllByRole('group', { name: /^Pagina \d$/ })).toHaveLength(3);
    const toolbar = screen.getByRole('toolbar', { name: nl.edit.toolbar });
    for (const name of [
      nl.edit.select,
      nl.edit.text,
      nl.edit.highlight,
      nl.edit.rect,
      nl.edit.line,
    ]) {
      expect(within(toolbar).getByRole('button', { name })).toBeTruthy();
    }
    expect(button(nl.edit.select).getAttribute('aria-pressed')).toBe('true');
    // Geen annotaties, dus niets om ongedaan te maken.
    expect(button(nl.pages.undo).disabled).toBe(true);
    expect(screen.getByText(nl.edit.none)).toBeTruthy();
  });

  it('heeft dezelfde balk als de andere taken: bestand toevoegen en downloaden', async () => {
    await setup();
    expect(screen.getByText(nl.merge.add)).toBeTruthy();
    expect(button(nl.pages.save)).toBeTruthy();
    expect(screen.getByRole('heading', { level: 2, name: 'rapport.pdf' })).toBeTruthy();
  });

  it('toont dezelfde bestandslijst als Samenvoegen, zonder de knop voor pagina’s kiezen', async () => {
    await setup(3);
    const list = screen.getByRole('list', { name: nl.merge.files });
    const item = within(list).getAllByRole('listitem')[0]!;
    expect(item.querySelector('.drag-handle')).not.toBeNull();
    expect(item.querySelector('.merge-list__name')!.textContent).toBe('rapport.pdf');
    expect(screen.getByLabelText('Pagina’s kiezen uit rapport.pdf')).toBeTruthy();
    expect(button('rapport.pdf weghalen')).toBeTruthy();
    // Rechts staan de pagina's zelf; een apart vak om pagina's te kiezen is er niet.
    expect(screen.queryByRole('button', { name: new RegExp(nl.merge.showPages) })).toBeNull();
    expect(screen.getByRole('heading', { name: nl.merge.result })).toBeTruthy();
    expect(screen.getByText('3 pagina’s', { selector: '.pane-head__meta' })).toBeTruthy();
  });

  it('volgt het bereik van een bestand: weggehaalde pagina’s verdwijnen uit de weergave', async () => {
    await setup(3);
    const field = screen.getByLabelText('Pagina’s kiezen uit rapport.pdf');
    fireEvent.input(field, { target: { value: '1, 3' } });
    fireEvent.keyDown(field, { key: 'Enter' });
    expect(screen.getAllByRole('group', { name: /^Pagina \d$/ })).toHaveLength(2);
    fireEvent.click(button(nl.pages.undo));
    expect(screen.getAllByRole('group', { name: /^Pagina \d$/ })).toHaveLength(3);
  });

  it('heeft één ongedaan-maken-reeks voor bestanden, pagina’s en annotaties', async () => {
    await setup(3);
    press('r');
    fireEvent.keyDown(pageNr(1), { key: 'Enter' });
    const field = screen.getByLabelText('Pagina’s kiezen uit rapport.pdf');
    fireEvent.input(field, { target: { value: '1-2' } });
    fireEvent.keyDown(field, { key: 'Enter' });
    expect(screen.getAllByRole('group', { name: /^Pagina \d$/ })).toHaveLength(2);
    expect(shapes()).toHaveLength(1);

    // Eerst de laatste stap (het bereik), dan de annotatie: dezelfde knop en Ctrl+Z.
    fireEvent.click(button(nl.pages.undo));
    expect(screen.getAllByRole('group', { name: /^Pagina \d$/ })).toHaveLength(3);
    expect(shapes()).toHaveLength(1);
    fireEvent.keyDown(document, { key: 'z', ctrlKey: true });
    expect(shapes()).toHaveLength(0);
    // En weer vooruit, in dezelfde volgorde.
    fireEvent.click(button(nl.pages.redo));
    expect(shapes()).toHaveLength(1);
    fireEvent.click(button(nl.pages.redo));
    expect(screen.getAllByRole('group', { name: /^Pagina \d$/ })).toHaveLength(2);
  });

  it('smelt pijltjes niet samen met een andere stap ertussen', async () => {
    await setup(2);
    press('r');
    fireEvent.keyDown(pageNr(1), { key: 'Enter' });
    const shape = () => shapes()[0]!;
    const x = () => Number(shape().querySelector('rect')!.getAttribute('x'));
    const start = x();
    fireEvent.keyDown(shape(), { key: 'ArrowRight' });
    // Een andere stap vlak ertussen (het bereik wijzigen), daarna weer een pijltje.
    const field = screen.getByLabelText('Pagina’s kiezen uit rapport.pdf');
    fireEvent.input(field, { target: { value: '1' } });
    fireEvent.keyDown(field, { key: 'Enter' });
    fireEvent.keyDown(shape(), { key: 'ArrowRight' });
    expect(x()).toBeCloseTo(start + 2, 5);
    fireEvent.click(button(nl.pages.undo));
    expect(x()).toBeCloseTo(start + 1, 5);
    fireEvent.click(button(nl.pages.undo));
    expect(screen.getAllByRole('group', { name: /^Pagina \d$/ })).toHaveLength(2);
    fireEvent.click(button(nl.pages.undo));
    expect(x()).toBeCloseTo(start, 5);
  });

  it('kiest gereedschap met sneltoetsen, en Escape gaat terug naar selecteren', async () => {
    await setup();
    for (const [key, name] of [
      ['t', nl.edit.text],
      ['h', nl.edit.highlight],
      ['r', nl.edit.rect],
      ['l', nl.edit.line],
    ] as const) {
      press(key);
      expect(button(name).getAttribute('aria-pressed'), name).toBe('true');
      expect(button(nl.edit.select).getAttribute('aria-pressed')).toBe('false');
    }
    press('Escape');
    expect(button(nl.edit.select).getAttribute('aria-pressed')).toBe('true');
  });

  it('plaatst met Enter een vak op de pagina, en kan dat ongedaan maken en opnieuw doen', async () => {
    await setup();
    press('r');
    fireEvent.keyDown(pageNr(2), { key: 'Enter' });
    expect(shapes()).toHaveLength(1);
    expect(within(pageNr(2)).getByRole('button', { name: nl.edit.rectOf })).toBeTruthy();
    expect(screen.getByText(/1 annotatie/)).toBeTruthy();
    expect(screen.getByText(/Gewijzigd, nog niet gedownload/)).toBeTruthy();

    fireEvent.click(button(nl.pages.undo));
    expect(shapes()).toHaveLength(0);
    expect(button(nl.pages.undo).disabled).toBe(true);
    fireEvent.click(button(nl.pages.redo));
    expect(shapes()).toHaveLength(1);
    // En met Ctrl+Z.
    fireEvent.keyDown(document, { key: 'z', ctrlKey: true });
    expect(shapes()).toHaveLength(0);
  });

  it('plaatst zonder gereedschap niets', async () => {
    await setup();
    fireEvent.keyDown(pageNr(1), { key: 'Enter' });
    expect(shapes()).toHaveLength(0);
  });

  it('plaatst een markering en een lijn, en telt ze', async () => {
    await setup();
    press('h');
    fireEvent.keyDown(pageNr(1), { key: 'Enter' });
    press('l');
    fireEvent.keyDown(pageNr(1), { key: 'Enter' });
    expect(shapes()).toHaveLength(2);
    expect(screen.getByText(/2 annotaties/)).toBeTruthy();
    // De annotaties staan op de pagina; "Lijn" is ook de naam van het gereedschap.
    expect(within(pageNr(1)).getByRole('button', { name: nl.edit.highlightOf })).toBeTruthy();
    expect(within(pageNr(1)).getByRole('button', { name: nl.edit.lineOf })).toBeTruthy();
  });

  it('kleur, dikte en lettergrootte volgen het gereedschap en wat geselecteerd is', async () => {
    await setup();
    // Zonder gereedschap of selectie: alleen een aanwijzing.
    expect(screen.getByText(nl.edit.optionsHint)).toBeTruthy();
    expect(screen.queryByLabelText(nl.edit.strokeWidth)).toBeNull();

    press('r');
    expect(button(nl.edit.colors.red).getAttribute('aria-pressed')).toBe('true');
    fireEvent.keyDown(pageNr(1), { key: 'Enter' });
    const rect = () => shapes()[0]!.querySelector('rect')!;
    fireEvent.click(button(nl.edit.colors.blue));
    expect(rect().getAttribute('stroke')).toBe('#2c56c9');
    const thin = Number(rect().getAttribute('stroke-width'));
    fireEvent.change(screen.getByLabelText(nl.edit.strokeWidth), { target: { value: '6' } });
    // 6 punten is drie keer zo dik als de standaard van 2.
    expect(Number(rect().getAttribute('stroke-width')) / thin).toBeCloseTo(3, 5);

    // Kleur en dikte zijn twee stappen om ongedaan te maken.
    fireEvent.click(button(nl.pages.undo));
    expect(Number(rect().getAttribute('stroke-width'))).toBeCloseTo(thin, 5);
    expect(rect().getAttribute('stroke')).toBe('#2c56c9');
    fireEvent.click(button(nl.pages.undo));
    expect(rect().getAttribute('stroke')).toBe('#d92d20');

    // Tekst heeft een lettergrootte maar geen dikte.
    press('Escape');
    press('t');
    expect(screen.getByLabelText(nl.edit.textSize)).toBeTruthy();
    expect(screen.queryByLabelText(nl.edit.strokeWidth)).toBeNull();
    // Een markering heeft alleen een kleur.
    press('h');
    expect(screen.queryByLabelText(nl.edit.textSize)).toBeNull();
    expect(screen.queryByLabelText(nl.edit.strokeWidth)).toBeNull();
    expect(button(nl.edit.colors.yellow).getAttribute('aria-pressed')).toBe('true');
  });

  it('verwijdert een geselecteerde annotatie met Delete en met de knop', async () => {
    await setup();
    press('r');
    fireEvent.keyDown(pageNr(1), { key: 'Enter' });
    expect(shapes()).toHaveLength(1);
    // Net geplaatst is geselecteerd: de knop is er.
    fireEvent.click(button(nl.edit.remove));
    expect(shapes()).toHaveLength(0);

    fireEvent.click(button(nl.pages.undo));
    const shape = shapes()[0]!;
    fireEvent.focus(shape);
    fireEvent.keyDown(shape, { key: 'Delete' });
    expect(shapes()).toHaveLength(0);
  });

  it('schuift een annotatie met de pijltjes, en alle pijltjes achter elkaar zijn één stap', async () => {
    await setup();
    press('r');
    fireEvent.keyDown(pageNr(1), { key: 'Enter' });
    const shape = () => shapes()[0]!;
    const x = () => Number(shape().querySelector('rect')!.getAttribute('x'));
    const start = x();
    fireEvent.keyDown(shape(), { key: 'ArrowRight' });
    fireEvent.keyDown(shape(), { key: 'ArrowRight', shiftKey: true });
    // Een stap van 1 punt en een van 10 punten (op een pagina zonder zoom is een punt een beeldpunt).
    expect(x()).toBeCloseTo(start + 11, 5);
    fireEvent.click(button(nl.pages.undo));
    expect(x()).toBeCloseTo(start, 5);
  });

  it('typt tekst, meldt tekens die niet kunnen en legt hem vast met Escape', async () => {
    await setup();
    press('t');
    fireEvent.keyDown(pageNr(1), { key: 'Enter' });
    const field = screen.getByRole('textbox', { name: nl.edit.textLabel }) as HTMLTextAreaElement;
    fireEvent.input(field, { target: { value: 'Hallo α' } });
    expect(screen.getByRole('status').textContent).toContain('α');
    fireEvent.keyDown(field, { key: 'Escape' });
    expect(screen.queryByRole('textbox', { name: nl.edit.textLabel })).toBeNull();
    expect(within(pageNr(1)).getByRole('button', { name: 'Tekst: Hallo α' })).toBeTruthy();
    expect(screen.getByText(/1 annotatie/)).toBeTruthy();
  });

  it('gooit een lege tekst weg en laat geen spoor in ongedaan maken', async () => {
    await setup();
    press('t');
    fireEvent.keyDown(pageNr(1), { key: 'Enter' });
    fireEvent.keyDown(screen.getByRole('textbox', { name: nl.edit.textLabel }), { key: 'Escape' });
    expect(shapes()).toHaveLength(0);
    expect(button(nl.pages.undo).disabled).toBe(true);
  });

  it('zoomt in en uit, en terug naar paginabreedte', async () => {
    await setup();
    const width = () => Number(pageNr(1).style.width.replace('px', ''));
    const fit = width();
    fireEvent.click(button(nl.edit.zoomIn));
    expect(width()).toBeCloseTo(fit * 1.25, 3);
    expect(screen.getByRole('button', { name: /^Zoom 125%/ })).toBeTruthy();
    fireEvent.click(button(nl.edit.zoomOut));
    fireEvent.click(button(nl.edit.zoomOut));
    expect(width()).toBeCloseTo(fit * 0.75, 3);
    fireEvent.click(screen.getByRole('button', { name: /^Zoom 75%/ }));
    expect(width()).toBeCloseTo(fit, 3);
    expect((screen.getByRole('button', { name: /^Zoom 100%/ }) as HTMLButtonElement).disabled).toBe(
      true,
    );
  });

  it('toont bij uitzoomen meer pagina’s naast elkaar, als overzicht', async () => {
    await setup(4);
    const label = () => screen.getByRole('button', { name: /^Zoom \d+%/ }).textContent;
    expect(label()).toBe('100%');
    for (const expected of ['75%', '50%', '33%', '25%']) {
      fireEvent.click(button(nl.edit.zoomOut));
      expect(label()).toBe(expected);
    }
    expect(button(nl.edit.zoomOut).disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: /^Zoom 25%/ }));
    expect(label()).toBe('100%');
  });

  it('downloadt met de annotaties en telt daarna als bewaard', async () => {
    await setup(2);
    press('r');
    fireEvent.keyDown(pageNr(2), { key: 'Enter' });
    fireEvent.click(button(nl.pages.save));
    expect((screen.getByLabelText(nl.saveDialog.label) as HTMLInputElement).value).toBe(
      'rapport (bewerkt)',
    );
    fireEvent.click(screen.getByRole('button', { name: nl.saveDialog.download }));

    await waitFor(() => expect(downloadPdf).toHaveBeenCalledTimes(1));
    const options = vi.mocked(buildPdf).mock.calls[0]![2]!;
    expect(options.annotations).toHaveLength(1);
    expect(options.annotations![0]).toMatchObject({ kind: 'rect' });
    expect(vi.mocked(downloadPdf).mock.calls[0]![1]).toBe('rapport (bewerkt).pdf');
    await screen.findByText('Opgeslagen als rapport (bewerkt).pdf.');
    expect(screen.queryByText(/Gewijzigd, nog niet gedownload/)).toBeNull();
  });

  it('sluit het document en begint met een lege lijst annotaties', async () => {
    await setup();
    press('r');
    fireEvent.keyDown(pageNr(1), { key: 'Enter' });
    expect(shapes()).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: nl.document.close }));
    // Terug bij het keuzevak; een nieuw document begint zonder annotaties.
    fireEvent.change(document.querySelector('input[type="file"]')!, {
      target: { files: [new File([`%PDF-1.7 2\n`], 'nieuw.pdf')] },
    });
    await screen.findByRole('list', { name: nl.edit.pages });
    expect(shapes()).toHaveLength(0);
    expect(button(nl.pages.undo).disabled).toBe(true);
  });
});
