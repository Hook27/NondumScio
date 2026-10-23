// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/preact';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DocumentProvider } from '../document/DocumentContext';
import { messages, type Language } from '../i18n';
import { LanguageProvider } from '../i18n/LanguageContext';
import { PdfLoadError, type LoadedPdf } from '../pdf/loader';
import { Workspace } from './Workspace';

const nl = messages.nl;

/** Een nep-PDF met een aantal pagina's; tekenen gebeurt niet echt (dat testen de browsertests). */
function fakePdf(pageCount: number) {
  const page = {
    getViewport: ({ scale }: { scale: number }) => ({ width: 595 * scale, height: 842 * scale }),
    render: () => ({ promise: Promise.resolve(), cancel: () => {} }),
    cleanup: vi.fn(),
  };
  const pdf = { numPages: pageCount, getPage: vi.fn(async () => page) };
  const loaded: LoadedPdf = { pdf: pdf as unknown as PDFDocumentProxy, pageCount };
  return Object.assign(loaded, { page });
}

function pdfFile(name = 'rapport.pdf', size = 2048) {
  const header = '%PDF-1.7\n';
  return new File([header + 'x'.repeat(size - header.length)], name, { type: 'application/pdf' });
}

function setup({
  load = vi.fn(async (): Promise<LoadedPdf> => fakePdf(3)),
  unload = vi.fn(),
  language = 'nl',
}: {
  load?: (bytes: Uint8Array) => Promise<LoadedPdf>;
  unload?: (pdf: PDFDocumentProxy) => void;
  language?: Language;
} = {}) {
  render(
    <LanguageProvider initial={language}>
      <DocumentProvider load={load} unload={unload}>
        <Workspace />
      </DocumentProvider>
    </LanguageProvider>,
  );
  // Elke keer opnieuw zoeken: na sluiten staat er een nieuw bestandsveld.
  const fileInput = () => document.querySelector<HTMLInputElement>('input[type="file"]')!;
  const choose = (file: File) => fireEvent.change(fileInput(), { target: { files: [file] } });
  return { load, unload, input: fileInput(), choose };
}

afterEach(() => cleanup());

describe('Workspace', () => {
  it('nodigt uit om een PDF te openen', () => {
    const { input } = setup();
    expect(screen.getByRole('heading', { level: 2, name: nl.document.openTitle })).toBeTruthy();
    expect(screen.getByText(nl.document.openHint)).toBeTruthy();
    // Het label "Kies een PDF" hoort bij het bestandsveld.
    expect(screen.getByLabelText(nl.document.choose)).toBe(input);
    expect(input.accept).toContain('application/pdf');
  });

  it('opent een PDF en toont naam, aantal pagina’s, grootte en miniaturen', async () => {
    const { load, choose } = setup();
    choose(pdfFile('rapport.pdf', 2048));

    expect(await screen.findByRole('heading', { level: 2, name: 'rapport.pdf' })).toBeTruthy();
    expect(screen.getByText(/3 pagina’s · 2 KB/)).toBeTruthy();
    const list = screen.getByRole('list', { name: 'Pagina’s van rapport.pdf' });
    expect(within(list).getAllByRole('listitem')).toHaveLength(3);
    for (const n of [1, 2, 3])
      expect(within(list).getByRole('img', { name: `Pagina ${n}` })).toBeTruthy();
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('gebruikt enkelvoud bij één pagina', async () => {
    const { choose } = setup({ load: vi.fn(async () => fakePdf(1)) });
    choose(pdfFile('kort.pdf', 100));
    expect(await screen.findByText(/^1 pagina ·/)).toBeTruthy();
  });

  it('weigert een bestand dat geen PDF is, zonder het te laden', async () => {
    const { load, choose } = setup();
    choose(new File(['dit is tekst'], 'notities.txt', { type: 'text/plain' }));

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toBe(
      'notities.txt is geen PDF. Kies een bestand dat eindigt op .pdf.',
    );
    expect(load).not.toHaveBeenCalled();
    // Je kunt meteen een ander bestand kiezen.
    expect(screen.getByLabelText(nl.document.choose)).toBeTruthy();
  });

  it('herkent een PDF aan de inhoud, ook met een vreemde naam', async () => {
    const { choose } = setup();
    choose(pdfFile('scan zonder extensie', 500));
    expect(
      await screen.findByRole('heading', { level: 2, name: 'scan zonder extensie' }),
    ).toBeTruthy();
  });

  it('meldt een beveiligde PDF', async () => {
    const { choose } = setup({
      load: vi.fn(async () => {
        throw new PdfLoadError('password');
      }),
    });
    choose(pdfFile('geheim.pdf'));
    expect((await screen.findByRole('alert')).textContent).toBe(
      'geheim.pdf is beveiligd met een wachtwoord. Dat wordt nog niet ondersteund.',
    );
  });

  it('meldt een beschadigde PDF, ook bij een onverwachte fout', async () => {
    const { choose } = setup({
      load: vi.fn(async () => {
        throw new Error('iets onverwachts');
      }),
    });
    choose(pdfFile('kapot.pdf'));
    expect((await screen.findByRole('alert')).textContent).toBe(
      'kapot.pdf kon niet worden geopend. Het bestand is mogelijk beschadigd.',
    );
  });

  it('toont dat het bestand geopend wordt', async () => {
    let finish: (value: LoadedPdf) => void = () => {};
    const { choose } = setup({ load: vi.fn(() => new Promise<LoadedPdf>((r) => (finish = r))) });
    choose(pdfFile('groot.pdf'));

    expect((await screen.findByRole('status')).textContent).toBe('groot.pdf wordt geopend…');
    finish(fakePdf(2));
    expect(await screen.findByRole('heading', { level: 2, name: 'groot.pdf' })).toBeTruthy();
  });

  it('sluit het document en geeft het geheugen vrij', async () => {
    const loaded = fakePdf(2);
    const { choose, unload } = setup({ load: vi.fn(async () => loaded) });
    choose(pdfFile());
    await screen.findByRole('heading', { level: 2, name: 'rapport.pdf' });

    fireEvent.click(screen.getByRole('button', { name: nl.document.close }));
    expect(screen.getByRole('heading', { level: 2, name: nl.document.openTitle })).toBeTruthy();
    expect(unload).toHaveBeenCalledWith(loaded.pdf);
  });

  it('laat een trager, ouder verzoek een nieuwer niet overschrijven', async () => {
    const pending: Array<(value: LoadedPdf) => void> = [];
    const first = fakePdf(5);
    const second = fakePdf(2);
    const { choose, unload } = setup({
      load: vi.fn(() => new Promise<LoadedPdf>((r) => pending.push(r))),
    });

    choose(pdfFile('eerste.pdf'));
    await waitFor(() => expect(pending).toHaveLength(1));
    choose(pdfFile('tweede.pdf'));
    await waitFor(() => expect(pending).toHaveLength(2));

    pending[1]!(second);
    expect(await screen.findByRole('heading', { level: 2, name: 'tweede.pdf' })).toBeTruthy();
    pending[0]!(first);
    await waitFor(() => expect(unload).toHaveBeenCalledWith(first.pdf));
    expect(screen.getByRole('heading', { level: 2, name: 'tweede.pdf' })).toBeTruthy();
  });

  it('opent ook een bestand dat erop wordt gesleept', async () => {
    setup();
    const zone = screen.getByRole('region', { name: nl.document.openTitle });
    fireEvent.dragEnter(zone);
    expect(screen.getByRole('heading', { level: 2, name: nl.document.dropHere })).toBeTruthy();

    fireEvent.drop(zone, { dataTransfer: { files: [pdfFile('gesleept.pdf')] } });
    expect(await screen.findByRole('heading', { level: 2, name: 'gesleept.pdf' })).toBeTruthy();
  });

  it('is in het Engels te gebruiken', async () => {
    const { choose } = setup({ language: 'en' });
    expect(
      screen.getByRole('heading', { level: 2, name: messages.en.document.openTitle }),
    ).toBeTruthy();
    choose(pdfFile('report.pdf', 3 * 1024 * 1024));
    expect(await screen.findByText(/3 pages · 3 MB/)).toBeTruthy();
    expect(screen.getByRole('img', { name: 'Page 2' })).toBeTruthy();
  });

  it('ruimt na het tekenen elke pagina op in pdf.js (zuinig met geheugen)', async () => {
    const loaded = fakePdf(3);
    const { choose } = setup({ load: vi.fn(async () => loaded) });
    choose(pdfFile());
    await screen.findByRole('heading', { level: 2, name: 'rapport.pdf' });
    await waitFor(() => expect(loaded.page.cleanup).toHaveBeenCalledTimes(3));
  });

  it('toont nieuwe miniaturen voor een tweede document met dezelfde naam', async () => {
    const eerste = fakePdf(3);
    const tweede = fakePdf(2);
    const load = vi.fn().mockResolvedValueOnce(eerste).mockResolvedValueOnce(tweede);
    const { choose } = setup({ load });

    choose(pdfFile('zelfde.pdf'));
    await screen.findByRole('heading', { level: 2, name: 'zelfde.pdf' });
    fireEvent.click(screen.getByRole('button', { name: nl.document.close }));
    choose(pdfFile('zelfde.pdf'));

    await waitFor(() => expect(screen.getAllByRole('listitem')).toHaveLength(2));
    await waitFor(() => expect(tweede.pdf.getPage).toHaveBeenCalledTimes(2));
  });
});
