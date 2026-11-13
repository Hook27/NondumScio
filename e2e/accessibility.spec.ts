import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { LANGUAGES, ROUTES, openPage, type Theme } from './helpers';

const THEMES: Theme[] = ['light', 'dark'];

// Elke pagina, in beide thema's, moet door de automatische toegankelijkheidscontrole (axe, WCAG
// 2.0 en 2.1 niveau A en AA, inclusief kleurcontrast in de echte browser). Het kleurcontrast hangt
// van het thema af, niet van de taal: per adres één test die beide thema's na elkaar controleert,
// en de taal wisselt per adres. Zo komt elk adres, elk thema en elke taal aan bod, zonder elke
// combinatie apart (dat was 17% van alle testtijd).
test.describe('toegankelijkheid', () => {
  ROUTES.forEach((route, index) => {
    const lang = LANGUAGES[index % LANGUAGES.length]!;
    test(`${route} · ${lang} · licht en donker hebben geen overtredingen`, async ({ page }) => {
      for (const theme of THEMES) {
        await openPage(page, route, { lang, theme });
        await expect(page.locator('h1')).toBeVisible();
        await expect(page.locator('html')).toHaveAttribute('data-theme', theme);

        const result = await new AxeBuilder({ page })
          .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
          .analyze();

        const overtredingen = result.violations.map((violation) => ({
          regel: violation.id,
          impact: violation.impact,
          elementen: violation.nodes.map((node) => node.target.join(' ')),
        }));
        expect(overtredingen, `thema ${theme}`).toEqual([]);
      }
    });
  });
});
