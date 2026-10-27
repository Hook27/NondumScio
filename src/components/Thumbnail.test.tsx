// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/preact';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { resetInView } from '../lib/inView';
import { Thumbnail } from './Thumbnail';

afterEach(() => {
  cleanup();
  resetInView();
});

/** Een nep-PDF waarvan het tekenen pas klaar is als de test dat zegt. */
function slowPdf() {
  let finish = () => {};
  const render = vi.fn(() => ({
    promise: new Promise<void>((resolve) => {
      finish = resolve;
    }),
    cancel: () => {},
  }));
  const page = {
    rotate: 0,
    getViewport: ({ scale }: { scale: number }) => ({ width: 595 * scale, height: 842 * scale }),
    render,
    cleanup: () => {},
  };
  const pdf = { getPage: async () => page } as unknown as PDFDocumentProxy;
  return { pdf, render, finish: () => finish() };
}

describe('Thumbnail', () => {
  it('toont wit papier tot de pagina klaar is, nooit een half getekend (zwart) canvas', async () => {
    const { pdf, render: draw, finish } = slowPdf();
    render(<Thumbnail pdf={pdf} pageNumber={1} label="Pagina 1" />);
    const shown = screen.getByRole('img', { name: 'Pagina 1' }) as HTMLCanvasElement;
    await waitFor(() => expect(draw).toHaveBeenCalledTimes(1));

    // pdf.js tekent op een los canvas; het zichtbare heeft nog geen beeldpunten, wel zijn maat.
    const [{ canvas }] = draw.mock.calls[0] as unknown as [{ canvas: HTMLCanvasElement }];
    expect(canvas).not.toBe(shown);
    expect(shown.width).toBe(0);
    expect(shown.style.width).toBe('160px');
    expect(shown.closest('.thumb')!.getAttribute('data-rendered')).toBe('false');

    finish();
    await waitFor(() =>
      expect(shown.closest('.thumb')!.getAttribute('data-rendered')).toBe('true'),
    );
    expect(shown.width).toBe(160);
    expect(shown.height).toBe(226);
    // Het losse canvas is weer vrijgegeven.
    expect(canvas.width).toBe(0);
  });
});
