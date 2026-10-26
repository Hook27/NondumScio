// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/preact';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DocumentProvider } from '../document/DocumentContext';
import { messages } from '../i18n';
import { LanguageProvider } from '../i18n/LanguageContext';
import type { LoadedPdf } from '../pdf/loader';
import type { PageText } from '../search/pageText';
import { ocrWordsToPageText, textItemsToPageText } from '../search/textLayer';
import { Workspace } from './Workspace';

/** Wat de nepbron per pagina (vanaf 0) aan tekst en aan herkende tekst geeft. */
const fake = vi.hoisted(() => ({
  texts: {} as Record<number, PageText>,
  scans: {} as Record<number, PageText>,
  empty: undefined as PageText | undefined,
  calls: [] as string[],
}));

vi.mock('../search/source', () => ({
  openPageSource: () => ({
    text: async (page: { source: number }) => fake.texts[page.source] ?? fake.empty!,
    ocr: async (page: { source: number }) => {
      fake.calls.push(`ocr ${page.source}`);
      return fake.scans[page.source] ?? fake.empty!;
    },
    close: () => {},
  }),
}));

const nl = messages.nl;
const s = nl.redact.search;

function fakeLoad(bytes: Uint8Array): Promise<LoadedPdf> {
  const pageCount = Number(/%PDF-1\.7 (\d+)/.exec(new TextDecoder().decode(bytes))?.[1] ?? 1);
  const page = {
    rotate: 0,
    getViewport: ({ scale, rotation = 0 }: { scale: number; rotation?: number }) => {
      const sideways = rotation === 90 || rotation === 270;
      return { width: (sideways ? 842 : 595) * scale, height: (sideways ? 595 : 842) * scale };
    },
    render: () => ({ promise: Promise.resolve(), cancel: () => {} }),
    cleanup: () => {},
  };
  const pdf = { numPages: pageCount, getPage: async () => page } as unknown as PDFDocumentProxy;
  return Promise.resolve({ pdf, pageCount });
}

const SIZE = { width: 595, height: 842 };
const toBase = (x: number, y: number): [number, number] => [x, SIZE.height - y];
const textOf = (...lines: string[]) =>
  textItemsToPageText(
    lines.map((str, i) => ({
      str,
      transform: [12, 0, 0, 12, 50, 700 - i * 20] as number[],
      width: str.length * 6,
      height: 12,
      hasEOL: true,
    })),
    toBase,
    SIZE,
  );

const LONG = 'Dit is gewoon een regel met genoeg tekst erin';

async function setup(pages = 3) {
  render(
    <LanguageProvider initial="nl">
      <DocumentProvider load={fakeLoad} unload={() => {}}>
        <Workspace mode="redact" />
      </DocumentProvider>
    </LanguageProvider>,
  );
  fireEvent.change(document.querySelector('input[type="file"]')!, {
    target: { files: [new File([`%PDF-1.7 ${pages}\n`], 'rapport.pdf')] },
  });
  await screen.findByRole('list', { name: nl.edit.pages });
  await act(() => new Promise((resolve) => setTimeout(resolve, 150)));
}

const button = (name: string | RegExp) => screen.getByRole('button', { name }) as HTMLButtonElement;
const terms = () => screen.getByLabelText(s.terms) as HTMLTextAreaElement;
const search = async (text: string) => {
  fireEvent.input(terms(), { target: { value: text } });
  fireEvent.click(button(s.find));
};
const shapes = () => document.querySelectorAll('[data-annotation]');
const candidates = () => document.querySelectorAll('[data-candidate]');

beforeEach(() => {
  fake.empty = textOf();
  fake.texts = {
    0: textOf(LONG, 'Het geheim is hier'),
    1: textOf(LONG, 'Mail jan@voorbeeld.nl graag, het geheim blijft'),
    2: fake.empty,
  };
  fake.scans = {};
  fake.calls = [];
});

afterEach(() => cleanup());

describe('Redigeren: zoeken en markeren', () => {
  it('zoekt pas als er een term of patroon is', async () => {
    await setup();
    expect(button(s.find).disabled).toBe(true);
    fireEvent.input(terms(), { target: { value: '  ' } });
    expect(button(s.find).disabled).toBe(true);
    fireEvent.click(screen.getByLabelText(s.email));
    expect(button(s.find).disabled).toBe(false);
  });

  it('toont treffers als oranje vakken en in een lijst, zonder er al vakken van te maken', async () => {
    await setup();
    await search('geheim');
    expect(await screen.findByText('2 treffers op 2 pagina’s.')).toBeTruthy();
    expect(candidates()).toHaveLength(2);
    expect(shapes()).toHaveLength(0);
    // Alles staat standaard aangevinkt.
    const list = screen.getByRole('list', { name: s.list });
    const boxes = list.querySelectorAll<HTMLInputElement>('input[type="checkbox"]');
    expect([...boxes].map((box) => box.checked)).toEqual([true, true]);
    expect(button(/Zet vakken \(2\)/)).toBeTruthy();
    // De omgeving van de treffer staat erbij.
    expect(list.textContent).toContain('Het geheim is hier');
    expect(screen.getByText(s.check)).toBeTruthy();
  });

  it('maakt alleen van de aangevinkte treffers vakken, in één stap ongedaan te maken', async () => {
    await setup();
    await search('geheim');
    await screen.findByText('2 treffers op 2 pagina’s.');
    fireEvent.click(screen.getByRole('checkbox', { name: /Treffer 2, pagina 2/ }));
    expect(candidates()[1]!.classList.contains('annotate-candidate--off')).toBe(true);
    expect(button(/Zet vakken \(1\)/)).toBeTruthy();

    fireEvent.click(button(/Zet vakken \(1\)/));
    expect(shapes()).toHaveLength(1);
    expect(candidates()).toHaveLength(0);
    expect(screen.getByText(s.appliedOne)).toBeTruthy();
    expect(screen.getByText(new RegExp(`^${nl.redact.countOne}`))).toBeTruthy();

    fireEvent.click(button(nl.pages.undo));
    expect(shapes()).toHaveLength(0);
  });

  it('zet met "Niets aanvinken" niets en met "Alles aanvinken" alles aan', async () => {
    await setup();
    await search('geheim');
    await screen.findByText('2 treffers op 2 pagina’s.');
    fireEvent.click(button(s.checkNone));
    expect((button(/Zet vakken \(0\)/) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(button(s.checkAll));
    expect(button(/Zet vakken \(2\)/).disabled).toBe(false);
  });

  it('vindt patronen, zoals een e-mailadres', async () => {
    await setup();
    fireEvent.click(screen.getByLabelText(s.email));
    fireEvent.click(button(s.find));
    expect(await screen.findByText('1 treffer op 1 pagina.')).toBeTruthy();
    expect(screen.getByRole('list', { name: s.list }).textContent).toContain('jan@voorbeeld.nl');
  });

  it('meldt dat er niets gevonden is', async () => {
    await setup();
    await search('bestaatniet');
    expect(await screen.findByText(s.noHits)).toBeTruthy();
    expect(candidates()).toHaveLength(0);
  });

  it('slaat pagina’s zonder tekst over, tot OCR aan staat', async () => {
    fake.scans = {
      2: ocrWordsToPageText([{ text: 'geheim', x0: 20, y0: 20, x1: 120, y1: 50 }], 2, SIZE),
    };
    await setup();
    await search('geheim');
    expect(await screen.findByText(s.skippedOne)).toBeTruthy();
    expect(fake.calls).toEqual([]);
    expect(candidates()).toHaveLength(2);

    // De herkenning wordt pas geladen als je erom vraagt.
    fireEvent.click(screen.getByLabelText(s.ocr));
    expect(screen.getByText(s.ocrHelp)).toBeTruthy();
    fireEvent.click(button(s.find));
    expect(await screen.findByText('3 treffers op 3 pagina’s.')).toBeTruthy();
    expect(fake.calls).toEqual(['ocr 2']);
    expect(screen.getByText(s.recognizedOne)).toBeTruthy();
    expect(screen.getByText(s.viaOcr)).toBeTruthy();
  });

  it('laat treffers op een weggehaalde pagina verdwijnen', async () => {
    await setup();
    await search('geheim');
    await screen.findByText('2 treffers op 2 pagina’s.');
    const field = screen.getByLabelText('Pagina’s kiezen uit rapport.pdf');
    fireEvent.input(field, { target: { value: '1, 3' } });
    fireEvent.keyDown(field, { key: 'Enter' });
    expect(candidates()).toHaveLength(1);
    expect(screen.getByRole('list', { name: s.list }).textContent).not.toContain('jan@');
  });

  it('slaat bij opnieuw zoeken treffers over die al in een vak liggen', async () => {
    await setup();
    await search('geheim');
    await screen.findByText('2 treffers op 2 pagina’s.');
    fireEvent.click(button(/Zet vakken \(2\)/));
    expect(shapes()).toHaveLength(2);
    fireEvent.click(button(s.find));
    expect(await screen.findByText(s.noHits)).toBeTruthy();
    expect(screen.getByText('Al afgedekt door een vak en daarom niet getoond: 2.')).toBeTruthy();
    expect(shapes()).toHaveLength(2);
  });

  it('wist de treffers met één knop', async () => {
    await setup();
    await search('geheim');
    await screen.findByText('2 treffers op 2 pagina’s.');
    fireEvent.click(button(s.clear));
    expect(candidates()).toHaveLength(0);
    expect(screen.queryByRole('list', { name: s.list })).toBeNull();
  });
});
