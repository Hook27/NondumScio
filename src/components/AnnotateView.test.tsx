// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/preact';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import { options, type VNode } from 'preact';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DocumentProvider } from '../document/DocumentContext';
import { messages } from '../i18n';
import { format } from '../i18n/format';
import { LanguageProvider } from '../i18n/LanguageContext';
import type { LoadedPdf } from '../pdf/loader';
import { buildPdf, downloadPdf } from '../pdf/save';
import { Workspace } from './Workspace';
import { held } from '../lib/testFiles';
import { giveAnnotatePagesWidth } from './testLayout';

giveAnnotatePagesWidth();

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
    // Met `drawing.hold` blijft het tekenen hangen tot de test het loslaat.
    render: () => ({ promise: drawing.hold ?? Promise.resolve(), cancel: () => {} }),
    cleanup: () => {},
  };
  const pdf = { numPages: pageCount, getPage: async () => page } as unknown as PDFDocumentProxy;
  return Promise.resolve({ pdf, pageCount });
}

/** Het tekenen van de nep-PDF: zonder `hold` meteen klaar. */
const drawing: { hold: Promise<void> | null } = { hold: null };

async function setup(pages = 3, mode: 'edit' | 'redact' = 'edit') {
  const tree = (current: 'edit' | 'redact' | 'pages') => (
    <LanguageProvider initial="nl">
      <DocumentProvider load={fakeLoad} unload={() => {}}>
        <Workspace mode={current} />
      </DocumentProvider>
    </LanguageProvider>
  );
  const view = render(tree(mode));
  fireEvent.change(document.querySelector('input[type="file"]')!, {
    target: { files: [new File([`%PDF-1.7 ${pages}\n`], 'rapport.pdf')] },
  });
  await screen.findByRole('list', { name: nl.edit.pages });
  // Preact voert effecten (zoals de sneltoetsen) pas na het tekenen uit. Een pagina staat pas op
  // "getekend" nadat zijn effecten gelopen hebben, en dan die van het scherm (de sneltoetsen) ook.
  // Wachten op een teken in plaats van een vaste tijd: op een drukke machine duurt het langer.
  await waitFor(() =>
    expect(document.querySelectorAll('.annotate-page[data-rendered="true"]')).toHaveLength(pages),
  );
  /** Naar de andere taak (Bewerken of Redigeren), zoals via het menu: het document blijft open. */
  const switchTo = async (next: 'edit' | 'redact') => {
    view.rerender(tree(next));
    await waitFor(() =>
      expect(document.querySelectorAll('.annotate-page[data-rendered="true"]')).toHaveLength(pages),
    );
  };
  /** Even naar Pagina's (bijvoorbeeld om een pagina te draaien); daarna terug met `switchTo`. */
  const showPages = async () => {
    view.rerender(tree('pages'));
    await screen.findAllByRole('option');
  };
  return { switchTo, showPages };
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
    // De zoomwaarde is ook een status (output); de melding staat in de andere.
    const statuses = screen
      .getAllByRole('status')
      .map((status) => status.textContent)
      .join(' ');
    expect(statuses).toContain('α');
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
    fireEvent.click(button(nl.pageBar.zoomIn));
    expect(width()).toBeCloseTo(fit * 1.25, 3);
    expect(document.querySelector('.zoom-bar__value')!.textContent).toBe('125%');
    expect(button(nl.pageBar.fitWidth).getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(button(nl.pageBar.zoomOut));
    fireEvent.click(button(nl.pageBar.zoomOut));
    expect(width()).toBeCloseTo(fit * 0.75, 3);
    fireEvent.click(button(nl.pageBar.fitWidth));
    expect(width()).toBeCloseTo(fit, 3);
    expect(document.querySelector('.zoom-bar__value')!.textContent).toBe('100%');
    expect(button(nl.pageBar.fitWidth).getAttribute('aria-pressed')).toBe('true');
  });

  it('toont bij uitzoomen meer pagina’s naast elkaar, als overzicht', async () => {
    await setup(4);
    const label = () => document.querySelector('.zoom-bar__value')!.textContent;
    expect(label()).toBe('100%');
    for (const expected of ['75%', '50%', '33%', '25%']) {
      fireEvent.click(button(nl.pageBar.zoomOut));
      expect(label()).toBe(expected);
    }
    expect(button(nl.pageBar.zoomOut).disabled).toBe(true);
    fireEvent.click(button(nl.pageBar.fitWidth));
    expect(label()).toBe('100%');
  });

  it('weggaan tijdens het opslaan: er komt geen download meer', async () => {
    const { switchTo } = await setup(2);
    press('r');
    fireEvent.keyDown(pageNr(2), { key: 'Enter' });
    const work = held(new Uint8Array([37, 80, 68, 70]));
    vi.mocked(buildPdf).mockImplementationOnce(() => work.promise);
    fireEvent.click(button(nl.pages.save));
    fireEvent.click(screen.getByRole('button', { name: nl.saveDialog.download }));
    await waitFor(() => expect(buildPdf).toHaveBeenCalledTimes(1));
    // Naar Redigeren (een ander scherm), terwijl het opslaan nog loopt.
    await switchTo('redact');
    await waitFor(() => expect(vi.mocked(buildPdf).mock.calls[0]![2]!.signal!.aborted).toBe(true));
    work.release();
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(downloadPdf).not.toHaveBeenCalled();
  });

  it('wat je tijdens het opslaan nog verandert, blijft "gewijzigd"', async () => {
    await setup(2);
    press('r');
    fireEvent.keyDown(pageNr(2), { key: 'Enter' });
    const work = held(new Uint8Array([37, 80, 68, 70]));
    vi.mocked(buildPdf).mockImplementationOnce(() => work.promise);
    fireEvent.click(button(nl.pages.save));
    fireEvent.click(screen.getByRole('button', { name: nl.saveDialog.download }));
    await waitFor(() => expect(buildPdf).toHaveBeenCalledTimes(1));
    // Nog een vak, terwijl het opslaan loopt: dat zit niet in de download.
    press('r');
    fireEvent.keyDown(pageNr(1), { key: 'Enter' });
    work.release();
    await waitFor(() => expect(downloadPdf).toHaveBeenCalledTimes(1));
    expect(screen.getByText(/Gewijzigd, nog niet gedownload/)).toBeTruthy();
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
    // Het vak is nog niet gedownload: eerst bevestigen.
    fireEvent.click(screen.getByRole('button', { name: nl.document.close }));
    fireEvent.click(screen.getByRole('button', { name: nl.closeDialog.confirm }));
    // Terug bij het keuzevak; een nieuw document begint zonder annotaties.
    fireEvent.change(document.querySelector('input[type="file"]')!, {
      target: { files: [new File([`%PDF-1.7 2\n`], 'nieuw.pdf')] },
    });
    await screen.findByRole('list', { name: nl.edit.pages });
    expect(shapes()).toHaveLength(0);
    expect(button(nl.pages.undo).disabled).toBe(true);
  });
});

describe('Bewerken: veel pagina’s', () => {
  /** Telt hoe vaak een onderdeel echt tekent, via de haak van Preact vóór het tekenen. */
  function countRenders(name: string) {
    const internal = options as unknown as { __r?: (vnode: VNode) => void };
    const before = internal.__r;
    let count = 0;
    internal.__r = (vnode) => {
      before?.(vnode);
      if (typeof vnode.type === 'function' && vnode.type.name === name) count += 1;
    };
    return {
      get count() {
        return count;
      },
      reset: () => {
        count = 0;
      },
      stop: () => {
        internal.__r = before;
      },
    };
  }

  it('tekent bij het slepen van een vak alleen de pagina met dat vak opnieuw', async () => {
    const PAGES = 40;
    const MOVES = 10;
    const renders = countRenders('AnnotatePage');
    try {
      await setup(PAGES);
      // Zonder dit teken is de telling waardeloos: elke pagina heeft minstens één keer getekend.
      expect(renders.count).toBeGreaterThanOrEqual(PAGES);

      // Een paar vakken op andere pagina's, zodat er ook iets te filteren valt.
      press('r');
      for (const n of [5, 10, 15]) fireEvent.keyDown(pageNr(n), { key: 'Enter' });
      expect(shapes()).toHaveLength(3);

      const overlay = pageNr(1).querySelector('svg')!;
      fireEvent.pointerDown(overlay, { button: 0, pointerId: 1, clientX: 100, clientY: 100 });
      renders.reset();
      for (let i = 1; i <= MOVES; i += 1) {
        fireEvent.pointerMove(overlay, {
          pointerId: 1,
          clientX: 100 + i * 5,
          clientY: 100 + i * 3,
        });
      }
      // Het vak groeit op pagina 1 mee (er wordt dus echt getekend), maar de andere 39 blijven staan.
      expect(renders.count).toBeGreaterThan(0);
      expect(renders.count).toBeLessThanOrEqual(MOVES);
      fireEvent.pointerUp(overlay, { pointerId: 1 });
      expect(shapes()).toHaveLength(4);
    } finally {
      renders.stop();
    }
  });
});

describe('Redigeren: het verslag na het downloaden', () => {
  it('meldt pagina’s zonder vak die voor de veiligheid ook een afbeelding zijn geworden', async () => {
    vi.mocked(buildPdf).mockImplementationOnce(async (_sources, _pages, options) => {
      options?.redaction?.onDone?.({ pages: [0, 1], recognized: [], reduced: false, extra: [0] });
      return new Uint8Array([37, 80, 68, 70]);
    });
    await setup(2, 'redact');
    press('r');
    fireEvent.keyDown(pageNr(2), { key: 'Enter' });
    fireEvent.click(button(nl.pages.save));
    fireEvent.click(screen.getByRole('button', { name: nl.saveDialog.download }));
    const status = await screen.findByText(/Opgeslagen als/);
    expect(status.textContent).toContain(nl.redact.extraOne);
  });
});

describe('Bewerken: tekst typen direct na het klikken', () => {
  it('het tekstvak heeft de focus zodra het er staat, zodat de eerste letter niet wegvalt', async () => {
    await setup(1);
    press('t');
    const overlay = pageNr(1).querySelector('svg')!;
    // Zonder act: zoals in de browser, waar effecten na het tekenen pas later kunnen lopen.
    overlay.dispatchEvent(
      new MouseEvent('pointerdown', { bubbles: true, button: 0, clientX: 100, clientY: 100 }),
    );
    // Preact tekent in een microtaak; daarna moet het tekstvak meteen de focus hebben.
    await new Promise((resolve) => queueMicrotask(() => resolve(null)));
    await new Promise((resolve) => queueMicrotask(() => resolve(null)));
    const field = screen.getByRole('textbox', { name: nl.edit.textLabel });
    expect(document.activeElement).toBe(field);
  });
});

describe('Bewerken en Redigeren: elk een eigen scherm', () => {
  const pressed = (name: string) => button(name).getAttribute('aria-pressed');

  it('van Bewerken (Markeren gekozen) naar Redigeren: daar staat Selecteren, geen markeerstift', async () => {
    const { switchTo } = await setup(2, 'edit');
    fireEvent.click(button(nl.edit.highlight));
    expect(pressed(nl.edit.highlight)).toBe('true');
    await switchTo('redact');
    expect(pressed(nl.redact.select)).toBe('true');
    expect(pressed(nl.redact.redact)).toBe('false');
    // Enter op een pagina met Redactievak gekozen zet een redactievak, geen markering.
    fireEvent.click(button(nl.redact.redact));
    fireEvent.keyDown(pageNr(1), { key: 'Enter' });
    expect(within(pageNr(1)).getByRole('button', { name: nl.redact.boxOf })).toBeTruthy();
  });

  it('van Redigeren naar Bewerken: Selecteren, en de vakken blijven bewaard', async () => {
    const { switchTo } = await setup(2, 'redact');
    fireEvent.click(button(nl.redact.redact));
    fireEvent.keyDown(pageNr(1), { key: 'Enter' });
    expect(shapes()).toHaveLength(1);
    await switchTo('edit');
    expect(pressed(nl.edit.select)).toBe('true');
    expect(shapes()).toHaveLength(1);
    // Terug: het vak staat er nog, en het gereedschap begint weer bij Selecteren.
    await switchTo('redact');
    expect(shapes()).toHaveLength(1);
    expect(pressed(nl.redact.select)).toBe('true');
  });
});

describe('Bewerken en Redigeren: slepen, ook met een vinger', () => {
  // In jsdom staat elke pagina op (0, 0): een punt op het scherm is dan een punt op de pagina in
  // beeldpunten, en vakken en greepjes staan in dezelfde maat.
  const overlay = (n = 1) => pageNr(n).querySelector('svg')!;
  const rectOf = (i = 0) => {
    const rect = shapes()[i]!.querySelector('rect')!;
    return ['x', 'y', 'width', 'height'].map((key) => Number(rect.getAttribute(key)));
  };
  const handle = (name: string) =>
    document.querySelector<SVGRectElement>(`[data-handle="${name}"]`)!;
  /** Het midden van een greepje (een vierkantje). */
  const at = (element: Element) => {
    const [x, y, width, height] = ['x', 'y', 'width', 'height'].map((key) =>
      Number(element.getAttribute(key)),
    );
    return [x! + width! / 2, y! + height! / 2];
  };
  /** Een vinger (of muis) neerzetten, bewegen en optillen. */
  function slide(target: Element, from: number[], to: number[], pointerType = 'touch') {
    const init = { button: 0, pointerId: 7, pointerType };
    fireEvent.pointerDown(target, { ...init, clientX: from[0], clientY: from[1] });
    fireEvent.pointerMove(overlay(), { ...init, clientX: to[0], clientY: to[1] });
    fireEvent.pointerUp(overlay(), { ...init, clientX: to[0], clientY: to[1] });
  }

  it('Redigeren: met een vinger een vak tekenen', async () => {
    await setup(1, 'redact');
    fireEvent.click(button(nl.redact.redact));
    slide(overlay(), [100, 100], [250, 180]);
    expect(shapes()).toHaveLength(1);
    expect(rectOf()).toEqual([100, 100, 150, 80]);
  });

  it('een afgebroken aanraking (de browser gaat scrollen) laat geen half vak achter', async () => {
    await setup(1, 'redact');
    fireEvent.click(button(nl.redact.redact));
    const init = { button: 0, pointerId: 7, pointerType: 'touch' };
    fireEvent.pointerDown(overlay(), { ...init, clientX: 100, clientY: 100 });
    fireEvent.pointerMove(overlay(), { ...init, clientX: 160, clientY: 150 });
    expect(shapes()).toHaveLength(1); // het concept, tijdens het slepen
    fireEvent.pointerCancel(overlay(), init);
    expect(shapes()).toHaveLength(0);
    fireEvent.pointerUp(overlay(), { ...init, clientX: 200, clientY: 200 });
    expect(shapes()).toHaveLength(0);
  });

  it('een greepje verslepen maakt het vak groter; het vak verslepen schuift het', async () => {
    await setup(1, 'redact');
    fireEvent.click(button(nl.redact.redact));
    fireEvent.keyDown(pageNr(1), { key: 'Enter' });
    const [x, y, width, height] = rectOf();
    // Rechtsonder 40 naar rechts en 30 omlaag.
    slide(handle('se'), at(handle('se')), [at(handle('se'))[0]! + 40, at(handle('se'))[1]! + 30]);
    expect(rectOf()).toEqual([x, y, width! + 40, height! + 30]);
    // Linksboven 10 naar links: het vak groeit naar links.
    slide(handle('nw'), at(handle('nw')), [at(handle('nw'))[0]! - 10, at(handle('nw'))[1]!]);
    expect(rectOf()).toEqual([x! - 10, y, width! + 50, height! + 30]);

    // Bij Selecteren het hele vak verslepen.
    fireEvent.click(button(nl.redact.select));
    const box = shapes()[0]!.querySelector('rect')!;
    slide(box, [x! + 20, y! + 10], [x! + 45, y! + 30]);
    expect(rectOf()).toEqual([x! + 15, y! + 20, width! + 50, height! + 30]);
  });

  it('een gekozen vak heeft acht vierkante greepjes, zoals de leesvakken van Platte tekst', async () => {
    await setup(1, 'edit');
    fireEvent.click(button(nl.edit.rect));
    fireEvent.keyDown(pageNr(1), { key: 'Enter' });
    const grips = [...document.querySelectorAll('[data-handle]')];
    expect(grips.map((grip) => grip.getAttribute('data-handle'))).toEqual([
      'nw',
      'n',
      'ne',
      'e',
      'se',
      's',
      'sw',
      'w',
    ]);
    for (const grip of grips) {
      expect(grip.tagName.toLowerCase()).toBe('rect');
      // De gedeelde vormgeving en de pijl in de richting van het greepje.
      expect(grip.classList.contains('handle')).toBe(true);
      expect(grip.classList.contains(`handle--${grip.getAttribute('data-handle')}`)).toBe(true);
    }
    // Op de hoeken en midden op de zijden van het vak.
    const [x, y, width, height] = rectOf();
    expect(at(handle('nw'))).toEqual([x, y]);
    expect(at(handle('n'))).toEqual([x! + width! / 2, y]);
    expect(at(handle('e'))).toEqual([x! + width!, y! + height! / 2]);
    expect(at(handle('se'))).toEqual([x! + width!, y! + height!]);
    expect(at(handle('sw'))).toEqual([x, y! + height!]);
  });

  it('een zijgreepje verandert alleen die kant van het vak', async () => {
    await setup(1, 'redact');
    fireEvent.click(button(nl.redact.redact));
    fireEvent.keyDown(pageNr(1), { key: 'Enter' });
    const [x, y, width, height] = rectOf();
    slide(handle('e'), at(handle('e')), [at(handle('e'))[0]! + 30, at(handle('e'))[1]! + 25]);
    expect(rectOf()).toEqual([x, y, width! + 30, height]);
    slide(handle('n'), at(handle('n')), [at(handle('n'))[0]! - 15, at(handle('n'))[1]! - 20]);
    expect(rectOf()).toEqual([x, y! - 20, width! + 30, height! + 20]);
    slide(handle('w'), at(handle('w')), [at(handle('w'))[0]! + 10, at(handle('w'))[1]! + 40]);
    expect(rectOf()).toEqual([x! + 10, y! - 20, width! + 20, height! + 20]);
    slide(handle('s'), at(handle('s')), [at(handle('s'))[0]! + 50, at(handle('s'))[1]! + 5]);
    expect(rectOf()).toEqual([x! + 10, y! - 20, width! + 20, height! + 25]);
  });

  it('op een gedraaide pagina volgt een zijgreepje wat je ziet', async () => {
    const { switchTo, showPages } = await setup(1, 'redact');
    // In Pagina's een kwartslag rechtsom draaien, dan terug naar Redigeren.
    await showPages();
    fireEvent.click(screen.getAllByRole('option')[0]!);
    fireEvent.click(button(nl.pages.rotateRight));
    await switchTo('redact');
    fireEvent.click(button(nl.redact.redact));
    fireEvent.keyDown(pageNr(1), { key: 'Enter' });
    const [x, y, width, height] = rectOf();
    // Liggend in beeld: het vak van het toetsenbord staat nu rechtop.
    expect(height!).toBeGreaterThan(width!);
    // De rechterkant op het scherm 30 naar rechts: alleen breder, zoals je het ziet.
    slide(handle('e'), at(handle('e')), [at(handle('e'))[0]! + 30, at(handle('e'))[1]! + 20]);
    const [x2, y2, width2, height2] = rectOf();
    expect(x2).toBeCloseTo(x!, 5);
    expect(y2).toBeCloseTo(y!, 5);
    expect(width2).toBeCloseTo(width! + 30, 5);
    expect(height2).toBeCloseTo(height!, 5);
  });

  it('een lijn heeft twee vierkante greepjes, op de uiteinden', async () => {
    await setup(1, 'edit');
    fireEvent.click(button(nl.edit.line));
    fireEvent.keyDown(pageNr(1), { key: 'Enter' });
    const grips = [...document.querySelectorAll('[data-handle]')];
    expect(grips.map((grip) => grip.getAttribute('data-handle'))).toEqual(['p1', 'p2']);
    const line = shapes()[0]!.querySelectorAll('line')[1]!;
    const end = (n: 1 | 2) => [
      Number(line.getAttribute(`x${n}`)),
      Number(line.getAttribute(`y${n}`)),
    ];
    expect(at(handle('p1'))).toEqual(end(1));
    expect(at(handle('p2'))).toEqual(end(2));
    for (const grip of grips) {
      expect(grip.tagName.toLowerCase()).toBe('rect');
      expect(grip.classList.contains('handle')).toBe(true);
      expect(grip.classList.contains('handle--end')).toBe(true);
    }
  });

  it('een beweging van minder dan 3 beeldpunten verplaatst een vak niet', async () => {
    await setup(1, 'redact');
    fireEvent.click(button(nl.redact.redact));
    fireEvent.keyDown(pageNr(1), { key: 'Enter' });
    fireEvent.click(button(nl.redact.select));
    const before = rectOf();
    const box = shapes()[0]!.querySelector('rect')!;
    slide(box, [before[0]! + 5, before[1]! + 5], [before[0]! + 6, before[1]! + 7]);
    expect(rectOf()).toEqual(before);
    // Een echte beweging wel, ook met de muis.
    slide(box, [before[0]! + 5, before[1]! + 5], [before[0]! + 25, before[1]! + 5], 'mouse');
    expect(rectOf()[0]).toBe(before[0]! + 20);
  });

  it('een vinger op een greepje of een vak houdt het scrollen tegen; ernaast niet', async () => {
    await setup(1, 'redact');
    fireEvent.click(button(nl.redact.redact));
    fireEvent.keyDown(pageNr(1), { key: 'Enter' });
    fireEvent.click(button(nl.redact.select));
    // fireEvent geeft false als de app het standaardgedrag (hier: scrollen) heeft tegengehouden.
    expect(fireEvent.touchStart(handle('se'))).toBe(false);
    expect(fireEvent.touchStart(shapes()[0]!.querySelector('rect')!)).toBe(false);
    expect(fireEvent.touchStart(overlay())).toBe(true);
  });

  it('een vak dat bij deze taak niet te pakken is, houdt het scrollen niet tegen', async () => {
    const { switchTo } = await setup(1, 'edit');
    fireEvent.click(button(nl.edit.rect));
    fireEvent.keyDown(pageNr(1), { key: 'Enter' });
    await switchTo('redact');
    // De rechthoek van Bewerken staat in Redigeren alleen in beeld (data-inert).
    const inert = document.querySelector('[data-inert] rect')!;
    expect(fireEvent.touchStart(inert)).toBe(true);
  });
});

describe('"getekend" betekent echt getekend', () => {
  afterEach(() => {
    drawing.hold = null;
  });

  it('data-rendered wordt pas true als de pagina klaar is met tekenen', async () => {
    let release: () => void = () => {};
    drawing.hold = new Promise((resolve) => (release = resolve));
    render(
      <LanguageProvider initial="nl">
        <DocumentProvider load={fakeLoad} unload={() => {}}>
          <Workspace mode="edit" />
        </DocumentProvider>
      </LanguageProvider>,
    );
    fireEvent.change(document.querySelector('input[type="file"]')!, {
      target: { files: [new File(['%PDF-1.7 1\n'], 'rapport.pdf')] },
    });
    await screen.findByRole('list', { name: nl.edit.pages });
    const page = () => document.querySelector('.annotate-page')!;
    // De pagina mag tekenen (in beeld, maat bekend), maar het tekenen is nog bezig.
    await new Promise((resolve) => setTimeout(resolve, 250));
    expect(page().getAttribute('data-rendered')).toBe('false');
    release();
    await waitFor(() => expect(page().getAttribute('data-rendered')).toBe('true'));
    // Opnieuw tekenen (inzoomen): zolang dat bezig is, weer "niet getekend".
    drawing.hold = new Promise((resolve) => (release = resolve));
    fireEvent.click(screen.getByRole('button', { name: nl.pageBar.zoomIn }));
    await waitFor(() => expect(page().getAttribute('data-rendered')).toBe('false'));
    release();
    await waitFor(() => expect(page().getAttribute('data-rendered')).toBe('true'));
  });
});

describe('Bewerken en Redigeren: voortgang en Stoppen', () => {
  it('ook Bewerken heeft Stoppen: niets gedownload, met een gewone melding', async () => {
    await setup(2);
    press('r');
    fireEvent.keyDown(pageNr(2), { key: 'Enter' });
    const work = held(new Uint8Array([37, 80, 68, 70]));
    vi.mocked(buildPdf).mockImplementationOnce(() => work.promise);
    fireEvent.click(button(nl.pages.save));
    fireEvent.click(screen.getByRole('button', { name: nl.saveDialog.download }));
    fireEvent.click(await screen.findByRole('button', { name: nl.pages.stop }));
    expect(screen.getByText(nl.pages.stopping)).toBeTruthy();
    work.release();
    const stopped = await screen.findByText(nl.pages.stopped);
    // Geen fout of waarschuwing: je koos er zelf voor.
    expect(stopped.closest('[role="alert"]')).toBeNull();
    expect(stopped.classList.contains('page-editor__status')).toBe(true);
    expect(screen.queryByRole('button', { name: nl.pages.stop })).toBeNull();
    expect(downloadPdf).not.toHaveBeenCalled();
  });

  it('Redigeren: de voortgang staat bij Stoppen', async () => {
    await setup(2, 'redact');
    fireEvent.click(button(nl.redact.redact));
    fireEvent.keyDown(pageNr(1), { key: 'Enter' });
    const work = held(new Uint8Array([37, 80, 68, 70]));
    vi.mocked(buildPdf).mockImplementationOnce(async (_sources, _pages, options) => {
      options!.redaction!.onProgress!(1, 2);
      return work.promise;
    });
    fireEvent.click(button(nl.pages.save));
    fireEvent.click(screen.getByRole('button', { name: nl.saveDialog.download }));
    const progress = await screen.findByText(format(nl.redact.progress, { done: 1, total: 2 }));
    expect(progress.closest('.save-busy')!.textContent).toContain(nl.pages.stop);
    work.release();
    await waitFor(() => expect(downloadPdf).toHaveBeenCalledTimes(1));
  });
});

describe('Bewerken en Redigeren: toetsen zoals overal', () => {
  const label = () => document.querySelector('.zoom-bar__value')!.textContent;

  it('+ − zoomen, 0 terug naar passend', async () => {
    await setup(1);
    press('+');
    expect(label()).toBe('125%');
    press('-');
    press('-');
    expect(label()).toBe('75%');
    press('0');
    expect(label()).toBe('100%');
  });

  it('bij een open venster doen de toetsen niets (ook Delete niet)', async () => {
    await setup(1);
    press('r');
    fireEvent.keyDown(pageNr(1), { key: 'Enter' });
    expect(shapes()).toHaveLength(1);
    // Een open venster: de toetsen doen niets.
    const dialog = document.createElement('dialog');
    dialog.setAttribute('open', '');
    document.body.append(dialog);
    press('Delete');
    press('v');
    press('+');
    expect(shapes()).toHaveLength(1);
    expect(label()).toBe('100%');
    dialog.remove();
    press('Delete');
    expect(shapes()).toHaveLength(0);
  });
});
