// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/preact';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from './App';
import { STORAGE_KEY, messages } from './i18n';
import { THEME_STORAGE_KEY } from './theme';

type Listener = (event: MediaQueryListEvent) => void;

/** Een nep-`matchMedia` waarmee de test de systeemvoorkeur kan laten veranderen. */
function mockSystemTheme(prefersDark: boolean) {
  const listeners = new Set<Listener>();
  const query = {
    matches: prefersDark,
    addEventListener: (_type: string, listener: Listener) => listeners.add(listener),
    removeEventListener: (_type: string, listener: Listener) => listeners.delete(listener),
  };
  vi.stubGlobal('matchMedia', () => query);
  Object.defineProperty(window, 'matchMedia', { configurable: true, value: () => query });
  return {
    change(matches: boolean) {
      query.matches = matches;
      for (const listener of listeners) listener({ matches } as MediaQueryListEvent);
    },
    listenerCount: () => listeners.size,
  };
}

const toggle = () => screen.getByRole('button', { name: messages.nl.theme.dark });
const root = () => document.documentElement;

beforeEach(() => {
  window.localStorage.clear();
  window.localStorage.setItem(STORAGE_KEY, 'nl');
  delete root().dataset.theme;
  window.location.hash = '';
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  Reflect.deleteProperty(window, 'matchMedia');
});

describe('thema', () => {
  it('is licht als er geen keuze is en het systeem niets vraagt', () => {
    render(<App />);
    expect(root().dataset.theme).toBe('light');
    expect(toggle().getAttribute('aria-pressed')).toBe('false');
  });

  it('volgt de systeemvoorkeur voor donker', () => {
    mockSystemTheme(true);
    render(<App />);
    expect(root().dataset.theme).toBe('dark');
    expect(toggle().getAttribute('aria-pressed')).toBe('true');
  });

  it('geeft de bewaarde keuze voorrang op het systeem', () => {
    mockSystemTheme(false);
    window.localStorage.setItem(THEME_STORAGE_KEY, 'dark');
    render(<App />);
    expect(root().dataset.theme).toBe('dark');
  });

  it('negeert een ongeldige bewaarde waarde', () => {
    mockSystemTheme(true);
    window.localStorage.setItem(THEME_STORAGE_KEY, 'blauw');
    render(<App />);
    expect(root().dataset.theme).toBe('dark');
  });

  it('wisselt met de knop en bewaart de keuze', async () => {
    render(<App />);
    fireEvent.click(toggle());
    await waitFor(() => expect(root().dataset.theme).toBe('dark'));
    expect(toggle().getAttribute('aria-pressed')).toBe('true');
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe('dark');

    fireEvent.click(toggle());
    await waitFor(() => expect(root().dataset.theme).toBe('light'));
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe('light');
  });

  it('onthoudt de keuze bij een nieuwe start', async () => {
    render(<App />);
    fireEvent.click(toggle());
    await waitFor(() => expect(root().dataset.theme).toBe('dark'));
    cleanup();
    delete root().dataset.theme;

    render(<App />);
    expect(root().dataset.theme).toBe('dark');
  });

  it('volgt een verandering van het systeem zolang de gebruiker niet koos', async () => {
    const system = mockSystemTheme(false);
    render(<App />);
    expect(root().dataset.theme).toBe('light');

    system.change(true);
    await waitFor(() => expect(root().dataset.theme).toBe('dark'));
    system.change(false);
    await waitFor(() => expect(root().dataset.theme).toBe('light'));
  });

  it('houdt de eigen keuze vast als het systeem daarna verandert', async () => {
    const system = mockSystemTheme(false);
    render(<App />);
    fireEvent.click(toggle());
    await waitFor(() => expect(root().dataset.theme).toBe('dark'));

    system.change(false);
    system.change(true);
    system.change(false);
    expect(root().dataset.theme).toBe('dark');
    // De luisteraar is dan ook opgeruimd.
    expect(system.listenerCount()).toBe(0);
  });

  it('heeft een vertaald label in beide talen', async () => {
    render(<App />);
    expect(screen.getByRole('button', { name: messages.nl.theme.dark })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /English/ }));
    await waitFor(() =>
      expect(screen.getByRole('button', { name: messages.en.theme.dark })).toBeTruthy(),
    );
  });
});
