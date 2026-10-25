// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/preact';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from './App';
import { Footer } from './components/Footer';
import { STORAGE_KEY, messages, type Language } from './i18n';
import { LanguageProvider } from './i18n/LanguageContext';
import { TASK_IDS } from './router';

const nl = messages.nl;
const en = messages.en;

function goTo(hash: string) {
  window.location.hash = hash;
}

/** Start de app, standaard in het Nederlands (via een bewaarde keuze). */
function renderApp(language: Language | null = 'nl') {
  if (language) window.localStorage.setItem(STORAGE_KEY, language);
  return render(<App />);
}

beforeEach(() => {
  window.location.hash = '';
  window.localStorage.clear();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('App', () => {
  it('toont op de startpagina een kaart per taak', () => {
    renderApp();
    expect(screen.getByRole('heading', { level: 1, name: nl.home.title })).toBeTruthy();
    const cards = document.querySelectorAll('.card');
    expect(cards.length).toBe(TASK_IDS.length);
    for (const id of TASK_IDS) {
      expect(screen.getByRole('heading', { level: 2, name: nl.tasks[id].title })).toBeTruthy();
    }
  });

  it('opent de juiste taakpagina vanuit het adres', () => {
    goTo('#/redact');
    renderApp();
    expect(screen.getByRole('heading', { level: 1, name: nl.tasks.redact.title })).toBeTruthy();
    // Zonder PDF: eerst het vak om er een te openen.
    expect(screen.getByRole('heading', { name: nl.document.openTitle })).toBeTruthy();
  });

  it('heeft voor elke taak een werkgebied', () => {
    for (const id of TASK_IDS) {
      goTo(`#/${id}`);
      renderApp();
      expect(screen.getByRole('heading', { level: 1, name: nl.tasks[id].title })).toBeTruthy();
      cleanup();
    }
  });

  it('wisselt van pagina als het adres verandert, met titel en focus', async () => {
    renderApp();
    expect(document.title).toContain(nl.tagline);

    goTo('#/split');
    await waitFor(() =>
      expect(screen.getByRole('heading', { level: 1, name: nl.tasks.split.title })).toBeTruthy(),
    );
    await waitFor(() => {
      expect(document.title).toBe(`${nl.tasks.split.title} · ${nl.appName}`);
      expect(document.activeElement?.id).toBe('page-title');
    });
  });

  it('markeert de huidige taak in het menu', () => {
    goTo('#/redact');
    renderApp();
    const nav = screen.getByRole('navigation', { name: nl.mainMenu });
    const current = within(nav).getByRole('link', { current: 'page' });
    expect(current.textContent).toBe(nl.tasks.redact.title);
    expect(within(nav).getAllByRole('link').length).toBe(TASK_IDS.length);
  });

  it('toont een duidelijke melding bij een onbekend adres', () => {
    goTo('#/bestaat-niet');
    renderApp();
    expect(screen.getByRole('heading', { level: 1, name: nl.notFound.title })).toBeTruthy();
    expect(screen.getAllByRole('link', { name: nl.allTasks }).length).toBe(1);
  });

  it('heeft een sla-over-link en een hoofdgebied', () => {
    renderApp();
    const skip = screen.getByRole('link', { name: nl.skipToContent });
    expect(skip.getAttribute('href')).toBe('#main');
    expect(screen.getByRole('main').id).toBe('main');
  });

  it('brengt de sla-over-link de focus naar de inhoud zonder van pagina te wisselen', async () => {
    goTo('#/merge');
    renderApp();
    fireEvent.click(screen.getByRole('link', { name: nl.skipToContent }));

    expect(document.activeElement).toBe(screen.getByRole('main'));
    expect(window.location.hash).toBe('#/merge');
    expect(screen.getByRole('heading', { level: 1, name: nl.tasks.merge.title })).toBeTruthy();
  });

  it('toont het versienummer linksonder in de voettekst', () => {
    renderApp();
    const footer = screen.getByRole('contentinfo');
    expect(within(footer).getByText('dev')).toBeTruthy();
  });
});

describe('Footer', () => {
  it('toont het opgegeven versienummer met een uitleg bij de muis', () => {
    render(
      <LanguageProvider initial="nl">
        <Footer version="PR.009" />
      </LanguageProvider>,
    );
    expect(screen.getByText('PR.009').getAttribute('title')).toBe(`${nl.version} PR.009`);
  });

  it('toont naast het versienummer dat alles in de browser gebeurt', () => {
    render(
      <LanguageProvider initial="nl">
        <Footer version="PR.009" />
      </LanguageProvider>,
    );
    expect(screen.getByText(nl.privacyNote)).toBeTruthy();
  });

  it('vertaalt de uitleg bij het versienummer', () => {
    render(
      <LanguageProvider initial="en">
        <Footer version="PR.009" />
      </LanguageProvider>,
    );
    expect(screen.getByText('PR.009').getAttribute('title')).toBe(`${en.version} PR.009`);
  });
});

describe('taalkeuze', () => {
  it('start in de bewaarde taal', () => {
    renderApp('en');
    expect(screen.getByRole('heading', { level: 1, name: en.home.title })).toBeTruthy();
    expect(document.documentElement.lang).toBe('en');
  });

  it('volgt zonder bewaarde keuze de taal van de browser', () => {
    vi.spyOn(window.navigator, 'languages', 'get').mockReturnValue(['nl-BE', 'en']);
    renderApp(null);
    expect(screen.getByRole('heading', { level: 1, name: nl.home.title })).toBeTruthy();
  });

  it('kiest Engels als de browser een onbekende taal heeft', () => {
    vi.spyOn(window.navigator, 'languages', 'get').mockReturnValue(['de-DE']);
    renderApp(null);
    expect(screen.getByRole('heading', { level: 1, name: en.home.title })).toBeTruthy();
  });

  it('negeert een ongeldige bewaarde waarde', () => {
    window.localStorage.setItem(STORAGE_KEY, 'fr');
    vi.spyOn(window.navigator, 'languages', 'get').mockReturnValue(['nl']);
    render(<App />);
    expect(screen.getByRole('heading', { level: 1, name: nl.home.title })).toBeTruthy();
  });

  it('heeft een groep met twee knoppen en toont welke actief is', () => {
    renderApp('nl');
    const group = screen.getByRole('group', { name: nl.language });
    const dutch = within(group).getByRole('button', { name: /Nederlands/ });
    const english = within(group).getByRole('button', { name: /English/ });
    expect(dutch.getAttribute('aria-pressed')).toBe('true');
    expect(english.getAttribute('aria-pressed')).toBe('false');
    expect(dutch.getAttribute('lang')).toBe('nl');
    expect(english.getAttribute('lang')).toBe('en');
  });

  it('wisselt alles mee: teksten, menu, titel, lang-attribuut en bewaarde keuze', async () => {
    goTo('#/merge');
    renderApp('nl');
    fireEvent.click(screen.getByRole('button', { name: /English/ }));

    await waitFor(() =>
      expect(screen.getByRole('heading', { level: 1, name: en.tasks.merge.title })).toBeTruthy(),
    );
    expect(screen.getByText(en.tasks.merge.description)).toBeTruthy();
    expect(screen.getByRole('navigation', { name: en.mainMenu })).toBeTruthy();
    expect(screen.getByRole('group', { name: en.language })).toBeTruthy();
    expect(document.title).toBe(`${en.tasks.merge.title} · ${en.appName}`);
    expect(document.documentElement.lang).toBe('en');
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe('en');
    expect(screen.getByRole('button', { name: /English/ }).getAttribute('aria-pressed')).toBe(
      'true',
    );
    expect(screen.getByRole('button', { name: /Nederlands/ }).getAttribute('aria-pressed')).toBe(
      'false',
    );
  });

  it('blijft op de plek: wisselen van taal verplaatst de focus niet', async () => {
    renderApp('nl');
    const english = screen.getByRole('button', { name: /English/ });
    english.focus();
    fireEvent.click(english);
    await waitFor(() =>
      expect(screen.getByRole('heading', { level: 1, name: en.home.title })).toBeTruthy(),
    );
    expect(document.activeElement).toBe(screen.getByRole('button', { name: /English/ }));
  });

  it('onthoudt de keuze bij een nieuwe start', async () => {
    renderApp('nl');
    fireEvent.click(screen.getByRole('button', { name: /English/ }));
    await waitFor(() =>
      expect(screen.getByRole('heading', { level: 1, name: en.home.title })).toBeTruthy(),
    );
    cleanup();

    render(<App />);
    expect(screen.getByRole('heading', { level: 1, name: en.home.title })).toBeTruthy();
  });

  it('kan terug naar Nederlands', async () => {
    renderApp('en');
    fireEvent.click(screen.getByRole('button', { name: /Nederlands/ }));
    await waitFor(() =>
      expect(screen.getByRole('heading', { level: 1, name: nl.home.title })).toBeTruthy(),
    );
    expect(document.documentElement.lang).toBe('nl');
  });
});
