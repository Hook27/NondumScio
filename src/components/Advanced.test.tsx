// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/preact';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { messages } from '../i18n';
import { LanguageProvider } from '../i18n/LanguageContext';
import { AdvancedToolPage } from './Advanced';

// Het onderdeel kan niet geladen worden, zoals bij een tabblad dat openstond tijdens een uitrol: het
// oude bestand bestaat dan niet meer.
vi.mock('../text/TextTool', () => {
  throw new Error('Failed to fetch dynamically imported module');
});

afterEach(() => cleanup());

describe('Geavanceerd', () => {
  it('kan een onderdeel niet geladen worden, dan een melding in plaats van een leeg vak', async () => {
    render(
      <LanguageProvider initial="nl">
        <AdvancedToolPage id="text" />
      </LanguageProvider>,
    );
    expect((await screen.findByRole('alert')).textContent).toBe(messages.nl.advanced.loadFailed);
  });
});
