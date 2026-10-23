import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { LANGUAGES, ROUTES, openPage, type Theme } from './helpers';

const THEMES: Theme[] = ['light', 'dark'];

// Elke pagina, in elke taal en elk thema, moet door de automatische toegankelijkheidscontrole
// (axe, WCAG 2.0 en 2.1 niveau A en AA, inclusief kleurcontrast in de echte browser).
test.describe('toegankelijkheid', () => {
  for (const route of ROUTES) {
    for (const lang of LANGUAGES) {
      for (const theme of THEMES) {
        test(`${route} · ${lang} · ${theme} heeft geen overtredingen`, async ({ page }) => {
          await openPage(page, route, { lang, theme });
          await expect(page.locator('h1')).toBeVisible();

          const result = await new AxeBuilder({ page })
            .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
            .analyze();

          const overtredingen = result.violations.map((violation) => ({
            regel: violation.id,
            impact: violation.impact,
            elementen: violation.nodes.map((node) => node.target.join(' ')),
          }));
          expect(overtredingen).toEqual([]);
        });
      }
    }
  }
});
