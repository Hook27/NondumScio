// @vitest-environment jsdom
import { cleanup, render, screen, waitFor, within } from '@testing-library/preact';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { App } from './App';
import { TASK_IDS } from './router';
import { strings } from './strings';

function goTo(hash: string) {
  window.location.hash = hash;
}

beforeEach(() => {
  window.location.hash = '';
});

afterEach(() => {
  cleanup();
});

describe('App', () => {
  it('toont op de startpagina een kaart per taak', () => {
    render(<App />);
    expect(screen.getByRole('heading', { level: 1, name: strings.home.title })).toBeTruthy();
    const cards = document.querySelectorAll('.card');
    expect(cards.length).toBe(TASK_IDS.length);
    for (const id of TASK_IDS) {
      expect(screen.getByRole('heading', { level: 2, name: strings.tasks[id].title })).toBeTruthy();
    }
  });

  it('opent de juiste taakpagina vanuit het adres', () => {
    goTo('#/merge');
    render(<App />);
    expect(screen.getByRole('heading', { level: 1, name: strings.tasks.merge.title })).toBeTruthy();
    expect(screen.getByText(strings.comingSoon)).toBeTruthy();
  });

  it('wisselt van pagina als het adres verandert, met titel en focus', async () => {
    render(<App />);
    expect(document.title).toContain(strings.tagline);

    goTo('#/split');
    await waitFor(() =>
      expect(
        screen.getByRole('heading', { level: 1, name: strings.tasks.split.title }),
      ).toBeTruthy(),
    );
    await waitFor(() => {
      expect(document.title).toBe(`${strings.tasks.split.title} · ${strings.appName}`);
      expect(document.activeElement?.id).toBe('page-title');
    });
  });

  it('markeert de huidige taak in het menu', () => {
    goTo('#/redact');
    render(<App />);
    const nav = screen.getByRole('navigation', { name: strings.mainMenu });
    const current = within(nav).getByRole('link', { current: 'page' });
    expect(current.textContent).toBe(strings.tasks.redact.title);
    expect(within(nav).getAllByRole('link').length).toBe(TASK_IDS.length);
  });

  it('toont een duidelijke melding bij een onbekend adres', () => {
    goTo('#/bestaat-niet');
    render(<App />);
    expect(screen.getByRole('heading', { level: 1, name: strings.notFound.title })).toBeTruthy();
    expect(screen.getAllByRole('link', { name: strings.allTasks }).length).toBe(1);
  });

  it('heeft een sla-over-link en een hoofdgebied', () => {
    render(<App />);
    const skip = screen.getByRole('link', { name: strings.skipToContent });
    expect(skip.getAttribute('href')).toBe('#main');
    expect(screen.getByRole('main').id).toBe('main');
  });
});
