// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/preact';
import { unzipSync } from 'fflate';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { DocumentProvider } from '../document/DocumentContext';
import { messages } from '../i18n';
import { LanguageProvider } from '../i18n/LanguageContext';
import { renderPageImage } from '../pdf/images';
import { makePng } from '../pdf/testPng';
import type { LoadedPdf } from '../pdf/loader';
import { downloadFile, downloadPdf } from '../pdf/save';
import { Workspace } from './Workspace';

vi.mock('../pdf/images', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../pdf/images')>()),
  // Een nep-afbeelding met het paginanummer erin, zodat je het in de ZIP terugziet.
  renderPageImage: vi.fn(async (_pdf: unknown, pageNumber: number) => ({
    bytes: new TextEncoder().encode(`pagina ${pageNumber}`),
    reduced: false,
  })),
}));

vi.mock('../pdf/save', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../pdf/save')>()),
  downloadPdf: vi.fn(),
  downloadFile: vi.fn(),
}));

const nl = messages.nl;

/** Een nep-PDF; het aantal pagina's staat in de inhoud van het nepbestand ("%PDF-1.7 3"). */
function fakeLoad(bytes: Uint8Array): Promise<LoadedPdf> {
  const pageCount = Number(/%PDF-1\.7 (\d+)/.exec(new TextDecoder().decode(bytes))?.[1] ?? 1);
  const page = {
    rotate: 0,
    getViewport: ({ scale }: { scale: number }) => ({ width: 595 * scale, height: 842 * scale }),
    render: () => ({ promise: Promise.resolve(), cancel: () => {} }),
    cleanup: () => {},
  };
  const pdf = { numPages: pageCount, getPage: async () => page } as unknown as PDFDocumentProxy;
  return Promise.resolve({ pdf, pageCount });
}

function setup() {
  render(
    <LanguageProvider initial="nl">
      <DocumentProvider load={fakeLoad} unload={() => {}}>
        <Workspace mode="convert" />
      </DocumentProvider>
    </LanguageProvider>,
  );
}

const png = (name: string) => new File([makePng(4, 4)], name, { type: 'image/png' });

async function addImages(...files: File[]) {
  fireEvent.change(document.querySelector('input[type="file"]')!, { target: { files } });
  await screen.findByRole('list', { name: nl.convert.listLabel });
}

const names = () =>
  within(screen.getByRole('list', { name: nl.convert.listLabel }))
    .getAllByRole('listitem')
    .map((item) => item.querySelector('.image-item__name')!.textContent);

async function openPdf(pages: number) {
  fireEvent.click(screen.getByRole('button', { name: nl.convert.toImages }));
  fireEvent.change(document.querySelector('#pdf-file')!, {
    target: { files: [new File([`%PDF-1.7 ${pages}\n`], 'rapport.pdf')] },
  });
  await screen.findAllByText(`${pages} van ${pages} pagina’s worden omgezet`);
}

const confirm = () => fireEvent.click(screen.getByRole('button', { name: nl.saveDialog.download }));

beforeAll(() => {
  // jsdom kent geen adressen voor bestanden in het geheugen.
  URL.createObjectURL = vi.fn(() => 'blob:test');
  URL.revokeObjectURL = vi.fn();
});

beforeEach(() => {
  vi.mocked(renderPageImage).mockClear();
  vi.mocked(downloadPdf).mockClear();
  vi.mocked(downloadFile).mockClear();
});

afterEach(() => cleanup());

describe('Omzetten: afbeeldingen naar PDF', () => {
  it('begint met een vak om afbeeldingen te kiezen, naast de keuze tussen de twee soorten', () => {
    setup();
    const mode = screen.getByRole('group', { name: nl.convert.mode });
    expect(
      within(mode).getByRole('button', { name: nl.convert.toPdf }).getAttribute('aria-pressed'),
    ).toBe('true');
    expect(screen.getByRole('heading', { name: nl.convert.pickTitle })).toBeTruthy();
    expect(document.querySelector('input[type="file"]')!.getAttribute('accept')).toContain(
      'image/jpeg',
    );
  });

  it('neemt JPG en PNG aan (aan de inhoud herkend) en meldt de rest', async () => {
    setup();
    await addImages(png('foto.png'), new File(['geen afbeelding'], 'tekst.png'));
    expect(names()).toEqual(['foto.png']);
    expect(screen.getByRole('alert').textContent).toBe(
      'tekst.png is geen JPG- of PNG-afbeelding en is overgeslagen.',
    );
    expect(screen.getByRole('heading', { level: 2, name: '1 afbeelding' })).toBeTruthy();
  });

  it('verplaatst en verwijdert afbeeldingen', async () => {
    setup();
    await addImages(png('a.png'), png('b.png'), png('c.png'));
    expect(names()).toEqual(['a.png', 'b.png', 'c.png']);

    fireEvent.click(screen.getByRole('button', { name: 'c.png omhoog' }));
    expect(names()).toEqual(['a.png', 'c.png', 'b.png']);
    fireEvent.click(screen.getByRole('button', { name: 'a.png omlaag' }));
    expect(names()).toEqual(['c.png', 'a.png', 'b.png']);
    // De bovenste kan niet verder omhoog, de onderste niet verder omlaag.
    expect(
      (screen.getByRole('button', { name: 'c.png omhoog' }) as HTMLButtonElement).disabled,
    ).toBe(true);
    expect(
      (screen.getByRole('button', { name: 'b.png omlaag' }) as HTMLButtonElement).disabled,
    ).toBe(true);

    fireEvent.click(screen.getByRole('button', { name: 'a.png verwijderen' }));
    expect(names()).toEqual(['c.png', 'b.png']);
  });

  it('maakt één PDF met een voorgestelde naam die je kunt aanpassen', async () => {
    setup();
    await addImages(png('a.png'), png('b.png'));
    fireEvent.click(screen.getByLabelText(nl.convert.a4));
    fireEvent.click(screen.getByLabelText(nl.convert.marginSmall));
    fireEvent.click(screen.getByRole('button', { name: nl.convert.make }));
    expect((screen.getByLabelText(nl.saveDialog.label) as HTMLInputElement).value).toBe(
      'afbeeldingen',
    );
    confirm();

    await waitFor(() => expect(downloadPdf).toHaveBeenCalledTimes(1));
    const [bytes, fileName] = vi.mocked(downloadPdf).mock.calls[0]!;
    expect(fileName).toBe('afbeeldingen.pdf');
    expect(new TextDecoder().decode(bytes.slice(0, 5))).toBe('%PDF-');
    await screen.findByText('Opgeslagen als afbeeldingen.pdf.');
  });

  it('stelt bij één afbeelding de naam van die afbeelding voor', async () => {
    setup();
    await addImages(png('vakantie.2024.png'));
    fireEvent.click(screen.getByRole('button', { name: nl.convert.make }));
    expect((screen.getByLabelText(nl.saveDialog.label) as HTMLInputElement).value).toBe(
      'vakantie.2024',
    );
  });

  it('meldt welke afbeelding niet in de PDF kon', async () => {
    setup();
    // Begint als PNG, maar de rest klopt niet: pdf-lib kan hem niet lezen.
    const broken = new File(
      [Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3])],
      'stuk.png',
    );
    await addImages(png('goed.png'), broken);
    fireEvent.click(screen.getByRole('button', { name: nl.convert.make }));
    confirm();
    expect((await screen.findByRole('alert')).textContent).toBe(
      'Afbeelding 2 (stuk.png) kon niet in de PDF worden gezet.',
    );
    expect(downloadPdf).not.toHaveBeenCalled();
  });

  it('houdt de afbeeldingen vast als je tussendoor naar de andere soort wisselt', async () => {
    setup();
    await addImages(png('a.png'));
    fireEvent.click(screen.getByRole('button', { name: nl.convert.toImages }));
    expect(screen.getByRole('heading', { name: nl.document.openTitle })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: nl.convert.toPdf }));
    expect(names()).toEqual(['a.png']);
  });

  it('wist alles met de sluitknop en begint weer met het keuzevak', async () => {
    setup();
    await addImages(png('a.png'));
    fireEvent.click(screen.getByRole('button', { name: nl.convert.clear }));
    expect(screen.getByRole('heading', { name: nl.convert.pickTitle })).toBeTruthy();
  });
});

describe('Omzetten: PDF naar afbeeldingen', () => {
  it('zet alle pagina’s standaard om, als PNG op 150 dpi, en downloadt ze als ZIP', async () => {
    setup();
    await openPdf(3);
    fireEvent.click(screen.getByRole('button', { name: '3 afbeeldingen downloaden (ZIP)' }));
    expect((screen.getByLabelText(nl.saveDialog.label) as HTMLInputElement).value).toBe(
      'rapport (afbeeldingen)',
    );
    expect(document.querySelector('.save-dialog__extension')!.textContent).toBe('.zip');
    confirm();

    await waitFor(() => expect(downloadFile).toHaveBeenCalledTimes(1));
    const [zip, fileName, type] = vi.mocked(downloadFile).mock.calls[0]!;
    expect([fileName, type]).toEqual(['rapport (afbeeldingen).zip', 'application/zip']);
    const files = unzipSync(zip);
    expect(Object.keys(files)).toEqual([
      'rapport (pagina 1).png',
      'rapport (pagina 2).png',
      'rapport (pagina 3).png',
    ]);
    expect(new TextDecoder().decode(files['rapport (pagina 3).png'])).toBe('pagina 3');
    expect(vi.mocked(renderPageImage).mock.calls[0]![2]).toBe(0);
    expect(vi.mocked(renderPageImage).mock.calls[0]![3]).toEqual({
      dpi: 150,
      format: 'png',
      quality: 0.85,
    });
  });

  it('zet de nummers in de ZIP vooraan aan met nullen, zodat ze goed sorteren', async () => {
    setup();
    await openPdf(12);
    fireEvent.click(screen.getByRole('button', { name: '12 afbeeldingen downloaden (ZIP)' }));
    confirm();
    await waitFor(() => expect(downloadFile).toHaveBeenCalledTimes(1));
    const names = Object.keys(unzipSync(vi.mocked(downloadFile).mock.calls[0]![0]));
    expect(names[0]).toBe('rapport (pagina 01).png');
    expect(names[11]).toBe('rapport (pagina 12).png');
  });

  it('zet alleen de gekozen pagina’s om; één pagina is een los bestand', async () => {
    setup();
    await openPdf(5);
    fireEvent.click(screen.getByLabelText(nl.convert.somePages));
    // Nog niets ingevuld: geen foutmelding, maar ook niets om te downloaden.
    expect(screen.queryByRole('alert')).toBeNull();
    expect(
      (screen.getByRole('button', { name: nl.convert.downloadOne }) as HTMLButtonElement).disabled,
    ).toBe(true);

    fireEvent.input(screen.getByLabelText(nl.convert.rangesLabel), { target: { value: '4' } });
    expect(screen.getAllByText('1 van 5 pagina’s worden omgezet').length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole('button', { name: nl.convert.downloadOne }));
    expect((screen.getByLabelText(nl.saveDialog.label) as HTMLInputElement).value).toBe(
      'rapport (pagina 4)',
    );
    confirm();

    await waitFor(() => expect(downloadFile).toHaveBeenCalledTimes(1));
    const [bytes, fileName, type] = vi.mocked(downloadFile).mock.calls[0]!;
    expect([fileName, type]).toEqual(['rapport (pagina 4).png', 'image/png']);
    expect(new TextDecoder().decode(bytes)).toBe('pagina 4');
    expect(vi.mocked(renderPageImage).mock.calls).toHaveLength(1);
  });

  it('meldt een pagina die niet bestaat', async () => {
    setup();
    await openPdf(5);
    fireEvent.click(screen.getByLabelText(nl.convert.somePages));
    fireEvent.input(screen.getByLabelText(nl.convert.rangesLabel), { target: { value: '2, 9' } });
    expect(screen.getByRole('alert').textContent).toBe(
      'Pagina 9 bestaat niet: er zijn 5 pagina’s.',
    );
    expect(
      (screen.getByRole('button', { name: nl.convert.downloadOne }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  it('JPG krijgt de gekozen kwaliteit en resolutie, en eindigt op .jpg', async () => {
    setup();
    await openPdf(2);
    const quality = screen.getByLabelText(nl.convert.quality) as HTMLSelectElement;
    // Bij PNG doet kwaliteit niets.
    expect(quality.disabled).toBe(true);
    fireEvent.click(screen.getByLabelText(nl.convert.jpeg));
    expect(quality.disabled).toBe(false);
    fireEvent.change(quality, { target: { value: 'high' } });
    fireEvent.click(screen.getByLabelText(nl.convert.dpi300));
    fireEvent.click(screen.getByLabelText(nl.convert.somePages));
    fireEvent.input(screen.getByLabelText(nl.convert.rangesLabel), { target: { value: '1' } });
    fireEvent.click(screen.getByRole('button', { name: nl.convert.downloadOne }));
    confirm();

    await waitFor(() => expect(downloadFile).toHaveBeenCalledTimes(1));
    const [, fileName, type] = vi.mocked(downloadFile).mock.calls[0]!;
    expect([fileName, type]).toEqual(['rapport (pagina 1).jpg', 'image/jpeg']);
    expect(vi.mocked(renderPageImage).mock.calls[0]![3]).toEqual({
      dpi: 300,
      format: 'jpeg',
      quality: 0.95,
    });
  });

  it('meldt dat een heel grote pagina kleiner is gemaakt', async () => {
    vi.mocked(renderPageImage).mockResolvedValueOnce({
      bytes: new Uint8Array([1]),
      reduced: true,
    });
    setup();
    await openPdf(1);
    fireEvent.click(screen.getByRole('button', { name: nl.convert.downloadOne }));
    confirm();
    expect(await screen.findByText(nl.convert.reduced)).toBeTruthy();
  });

  it('meldt een mislukte omzetting', async () => {
    vi.mocked(renderPageImage).mockRejectedValueOnce(new Error('kapot'));
    setup();
    await openPdf(1);
    fireEvent.click(screen.getByRole('button', { name: nl.convert.downloadOne }));
    confirm();
    expect((await screen.findByRole('alert')).textContent).toBe(nl.convert.imagesFailed);
    expect(downloadFile).not.toHaveBeenCalled();
  });

  it('begint bij “PDF naar afbeeldingen” als er al een PDF openstaat', async () => {
    const { unmount } = render(
      <LanguageProvider initial="nl">
        <DocumentProvider load={fakeLoad} unload={() => {}}>
          <OpenedConvert />
        </DocumentProvider>
      </LanguageProvider>,
    );
    await screen.findAllByText('2 van 2 pagina’s worden omgezet');
    expect(
      screen.getByRole('button', { name: nl.convert.toImages }).getAttribute('aria-pressed'),
    ).toBe('true');
    unmount();
  });
});

import { useEffect, useState } from 'preact/hooks';
import { useDocument } from '../document/DocumentContext';

/** Opent eerst een PDF (zoals bij een andere taak) en toont dan pas Omzetten. */
function OpenedConvert() {
  const { open, doc } = useDocument();
  const [started, setStarted] = useState(false);
  useEffect(() => {
    void open(new File([`%PDF-1.7 2\n`], 'rapport.pdf')).then(() => setStarted(true));
  }, [open]);
  return started && doc.status === 'ready' ? <Workspace mode="convert" /> : null;
}
