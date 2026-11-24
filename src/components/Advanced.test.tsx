// @vitest-environment jsdom
import { act, cleanup, render, screen } from '@testing-library/preact';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { messages } from '../i18n';
import { LanguageProvider } from '../i18n/LanguageContext';
import { AdvancedToolPage } from './Advanced';

const loaded = vi.hoisted(() => ({ rename: 0 }));

// Het onderdeel kan niet geladen worden, zoals bij een tabblad dat openstond tijdens een uitrol: het
// oude bestand bestaat dan niet meer.
vi.mock('../text/TextTool', () => {
  throw new Error('Failed to fetch dynamically imported module');
});

// Een onderdeel dat wel laadt; de teller zegt of het geladen is.
vi.mock('../rename/RenameTool', () => {
  loaded.rename += 1;
  return { RenameTool: () => <p>Slim hernoemen geladen</p> };
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

/** Een nep-`matchMedia` voor de grens van een breed scherm; `set` laat het venster veranderen. */
function screenWidth(wide: boolean) {
  let listener = () => {};
  const list = {
    matches: wide,
    media: '',
    addEventListener: (_: string, on: () => void) => (listener = on),
    removeEventListener: () => {},
  };
  vi.stubGlobal('matchMedia', () => list);
  return {
    set: (next: boolean) => {
      list.matches = next;
      act(() => listener());
    },
  };
}

const renderTool = (id: 'text' | 'rename') =>
  render(
    <LanguageProvider initial="nl">
      <AdvancedToolPage id={id} />
    </LanguageProvider>,
  );

describe('Geavanceerd', () => {
  it('kan een onderdeel niet geladen worden, dan een melding in plaats van een leeg vak', async () => {
    renderTool('text');
    expect((await screen.findByRole('alert')).textContent).toBe(messages.nl.advanced.loadFailed);
  });

  it('op een smal scherm wordt het onderdeel niet geladen; wordt het venster breder, dan wel (audit F17)', async () => {
    const width = screenWidth(false);
    renderTool('rename');
    expect(screen.getByText(messages.nl.advanced.desktopOnly)).toBeTruthy();
    await act(() => new Promise((resolve) => setTimeout(resolve, 50)));
    expect(screen.queryByText('Slim hernoemen geladen')).toBeNull();
    expect(loaded.rename).toBe(0);

    width.set(true);
    expect(await screen.findByText('Slim hernoemen geladen')).toBeTruthy();
    expect(loaded.rename).toBe(1);

    // Weer smaller: het blijft staan (alleen verborgen), zodat lopend werk niet stopt.
    width.set(false);
    await act(() => new Promise((resolve) => setTimeout(resolve, 50)));
    expect(screen.getByText('Slim hernoemen geladen')).toBeTruthy();
  });
});
