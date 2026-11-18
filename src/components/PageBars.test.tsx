// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/preact';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { messages } from '../i18n';
import { LanguageProvider } from '../i18n/LanguageContext';
import { PageNav, ZoomBar } from './PageBars';

const b = messages.nl.pageBar;
const button = (name: string) => screen.getByRole<HTMLButtonElement>('button', { name });

afterEach(() => cleanup());

describe('PageNav', () => {
  function setup(page: number, count: number) {
    const onPage = vi.fn();
    render(
      <LanguageProvider initial="nl">
        <PageNav page={page} count={count} onPage={onPage} title="Toetsen">
          {`${page} / ${count}`}
        </PageNav>
      </LanguageProvider>,
    );
    return onPage;
  }

  it('eerste, vorige, volgende en laatste, met de pagina ertussen', () => {
    const onPage = setup(3, 7);
    const group = screen.getByRole('group', { name: b.nav });
    expect(group.getAttribute('title')).toBe('Toetsen');
    expect(group.querySelector('.page-nav__page')!.textContent).toBe('3 / 7');
    fireEvent.click(button(b.first));
    fireEvent.click(button(b.previous));
    fireEvent.click(button(b.next));
    fireEvent.click(button(b.last));
    expect(onPage.mock.calls).toEqual([[1], [2], [4], [7]]);
    // Pictogrammen, geen tekens.
    expect(group.querySelectorAll('svg')).toHaveLength(4);
  });

  it('aan het begin en aan het eind kan het niet verder', () => {
    setup(1, 1);
    for (const name of [b.first, b.previous, b.next, b.last])
      expect(button(name).disabled).toBe(true);
    cleanup();
    setup(1, 2);
    expect(button(b.first).disabled).toBe(true);
    expect(button(b.previous).disabled).toBe(true);
    expect(button(b.next).disabled).toBe(false);
    expect(button(b.last).disabled).toBe(false);
  });
});

describe('ZoomBar', () => {
  function setup(active: 'page' | 'width' | null, canZoomOut = true, canZoomIn = true) {
    const calls: string[] = [];
    render(
      <LanguageProvider initial="nl">
        <ZoomBar
          percent={143}
          canZoomOut={canZoomOut}
          canZoomIn={canZoomIn}
          onZoomOut={() => calls.push('uit')}
          onZoomIn={() => calls.push('in')}
          fits={[
            { label: b.fitPage, active: active === 'page', onClick: () => calls.push('pagina') },
            { label: b.fitWidth, active: active === 'width', onClick: () => calls.push('breedte') },
          ]}
        />
      </LanguageProvider>,
    );
    return calls;
  }

  it('vergrootglazen, het percentage en de passend-knoppen; de actieve staat ingedrukt', () => {
    const calls = setup('width');
    expect(screen.getByRole('group', { name: b.zoom }).querySelector('output')!.textContent).toBe(
      '143%',
    );
    fireEvent.click(button(b.zoomOut));
    fireEvent.click(button(b.zoomIn));
    fireEvent.click(button(b.fitPage));
    fireEvent.click(button(b.fitWidth));
    expect(calls).toEqual(['uit', 'in', 'pagina', 'breedte']);
    expect(button(b.fitWidth).getAttribute('aria-pressed')).toBe('true');
    expect(button(b.fitPage).getAttribute('aria-pressed')).toBe('false');
  });

  it('aan de grenzen kan het niet verder', () => {
    setup(null, false, true);
    expect(button(b.zoomOut).disabled).toBe(true);
    expect(button(b.zoomIn).disabled).toBe(false);
    cleanup();
    setup(null, true, false);
    expect(button(b.zoomIn).disabled).toBe(true);
  });
});
