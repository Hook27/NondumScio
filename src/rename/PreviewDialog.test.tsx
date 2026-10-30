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

vi.mock('../pdf/loader', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../pdf/loader')>()),
  loadPdf: vi.fn(),
  closePdf: vi.fn(),
}));

const p = messages.nl.rename.preview;
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

  it('meldt een PDF die niet te tonen is', async () => {
    vi.mocked(loadPdf).mockRejectedValue(new PdfLoadError('damaged'));
    setup();
    expect(await screen.findByText(p.error)).toBeTruthy();
  });
});
