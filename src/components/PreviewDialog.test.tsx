// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/preact';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { messages } from '../i18n';
import { LanguageProvider } from '../i18n/LanguageContext';
import { PdfLoadError, closePdf, loadPdf } from '../pdf/loader';
import { PreviewDialog } from './PreviewDialog';

/** Een nep-PDF van drie pagina's; houdt bij welke pagina's getekend zijn. */
function fakePdf() {
  const rendered: number[] = [];
  const pdf = {
    numPages: 3,
    getPage: async (number: number) => ({
      getViewport: ({ scale }: { scale: number }) => ({ width: 595 * scale, height: 842 * scale }),
      render: () => {
        rendered.push(number);
        return { promise: Promise.resolve(), cancel: () => {} };
      },
      cleanup: () => {},
    }),
  };
  return { pdf, rendered };
}

vi.mock('../pdf/loader', async (importOriginal) => {
  const original = await importOriginal<typeof import('../pdf/loader')>();
  const loadPdf = vi.fn();
  return {
    ...original,
    loadPdf,
    // Het echte inlezen van het bestand, en dan de nep-lezer hierboven.
    openPdfFile: async (file: File) => loadPdf(await original.readPdfBytes(file)),
    closePdf: vi.fn(),
  };
});

const p = messages.nl.preview;
const file = new File(['%PDF-1.7'], 'scan_001.pdf', { type: 'application/pdf' });

function setup(onClose = vi.fn()) {
  render(
    <LanguageProvider initial="nl">
      <PreviewDialog file={file} title="260312 gemeente utrecht aan.pdf" onClose={onClose} />
    </LanguageProvider>,
  );
  return onClose;
}

afterEach(() => {
  cleanup();
  vi.mocked(loadPdf).mockReset();
  vi.mocked(closePdf).mockReset();
});

describe('PreviewDialog: een PDF bekijken', () => {
  it('toont de eerste pagina, en bladert met de knoppen en de pijltjestoetsen', async () => {
    const { pdf, rendered } = fakePdf();
    vi.mocked(loadPdf).mockResolvedValue({ pdf: pdf as never, pageCount: 3 });
    setup();
    const dialog = screen.getByRole('dialog', { name: /260312 gemeente utrecht aan\.pdf/ });
    expect(await screen.findByText('Pagina 1 van 3')).toBeTruthy();
    await waitFor(() => expect(rendered).toEqual([1]));
    const previous = screen.getByRole('button', { name: p.previous }) as HTMLButtonElement;
    const next = screen.getByRole('button', { name: p.next }) as HTMLButtonElement;
    expect(previous.disabled).toBe(true);

    fireEvent.click(next);
    expect(await screen.findByText('Pagina 2 van 3')).toBeTruthy();
    fireEvent.keyDown(dialog, { key: 'ArrowRight' });
    expect(await screen.findByText('Pagina 3 van 3')).toBeTruthy();
    expect(next.disabled).toBe(true);
    fireEvent.keyDown(dialog, { key: 'ArrowLeft' });
    expect(await screen.findByText('Pagina 2 van 3')).toBeTruthy();
    await waitFor(() => expect(rendered).toEqual([1, 2, 3, 2]));
  });

  it('sluit met Escape, met de knop en met een klik naast het venster; ruimt de PDF op', async () => {
    const { pdf } = fakePdf();
    vi.mocked(loadPdf).mockResolvedValue({ pdf: pdf as never, pageCount: 3 });
    const onClose = setup();
    await screen.findByText('Pagina 1 van 3');
    const dialog = screen.getByRole('dialog');
    fireEvent(dialog, new Event('cancel', { cancelable: true }));
    expect(onClose).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: p.close }));
    expect(onClose).toHaveBeenCalledTimes(2);
    // Een klik op het venster zelf (de donkere rand eromheen), niet op de inhoud.
    fireEvent.click(dialog);
    expect(onClose).toHaveBeenCalledTimes(3);
    fireEvent.click(screen.getByText('Pagina 1 van 3'));
    expect(onClose).toHaveBeenCalledTimes(3);
    cleanup();
    // Preact ruimt effecten soms net na het afbreken op.
    await waitFor(() => expect(closePdf).toHaveBeenCalledWith(pdf));
  });

  it('toont pagina’s uit een PDF die al open is, gedraaid en met hun eigen label', async () => {
    const angles: number[] = [];
    const shown: number[] = [];
    const pdf = {
      numPages: 9,
      getPage: async (number: number) => ({
        rotate: 90,
        getViewport: ({ scale, rotation }: { scale: number; rotation: number }) => {
          angles.push(rotation);
          return { width: 595 * scale, height: 842 * scale };
        },
        render: () => {
          shown.push(number);
          return { promise: Promise.resolve(), cancel: () => {} };
        },
        cleanup: () => {},
      }),
    };
    render(
      <LanguageProvider initial="nl">
        <PreviewDialog
          title="04 - Bijlage.pdf"
          pages={[
            { pdf: pdf as never, pageNumber: 6, rotation: 270, label: 'eerste' },
            { pdf: pdf as never, pageNumber: 2 },
          ]}
          onClose={() => {}}
        />
      </LanguageProvider>,
    );
    expect(screen.getByRole('dialog', { name: '04 - Bijlage.pdf' })).toBeTruthy();
    expect(screen.getByText('eerste')).toBeTruthy();
    await waitFor(() => expect(shown).toEqual([6]));
    // De draaiing van de pagina zelf plus die uit het plan.
    expect(angles).toEqual([0, 0]);
    fireEvent.click(screen.getByRole('button', { name: p.next }));
    expect(await screen.findByText('Pagina 2 van 2')).toBeTruthy();
    await waitFor(() => expect(shown).toEqual([6, 2]));
    expect(angles.slice(2)).toEqual([90, 90]);
    cleanup();
    // Preact ruimt effecten soms net na het afbreken op: daar even op wachten.
    await new Promise((resolve) => setTimeout(resolve, 50));
    // Die PDF is van het document: niet geopend en niet opgeruimd.
    expect(loadPdf).not.toHaveBeenCalled();
    expect(closePdf).not.toHaveBeenCalled();
  });

  it('meldt een PDF die niet te tonen is', async () => {
    vi.mocked(loadPdf).mockRejectedValue(new PdfLoadError('damaged'));
    setup();
    expect(await screen.findByText(p.error)).toBeTruthy();
  });
});
