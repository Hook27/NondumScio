import { expect, test } from '@playwright/test';
import { messages, openPage } from './helpers';

/**
 * Geavanceerd: zelfstandige onderdelen voor op de computer. Op een breed scherm staan ze in het
 * menu en op de startpagina; op een telefoon niet, en het adres zelf geeft daar een melding.
 */

const nl = messages.nl;
const a = nl.advanced;

test.describe('Geavanceerd', () => {
  test('op de computer: via het menu naar het overzicht en een onderdeel, en terug', async ({
    page,
    isMobile,
  }) => {
    test.skip(isMobile, 'Geavanceerd is er alleen op een breed scherm');
    await openPage(page, '/', { lang: 'nl' });
    await expect(page.getByRole('link', { name: new RegExp(a.title) }).last()).toBeVisible();

    await page
      .getByRole('navigation', { name: nl.mainMenu })
      .getByRole('link', { name: a.title })
      .click();
    await expect(page.getByRole('heading', { level: 1, name: a.title })).toBeVisible();
    await expect(page.getByText(a.desktopOnly)).toBeHidden();

    await page.getByRole('link', { name: new RegExp(a.tools.rename.title) }).click();
    await expect(page).toHaveURL(/#\/advanced\/rename$/);
    await expect(page.getByRole('heading', { level: 1, name: a.tools.rename.title })).toBeVisible();

    await page.getByRole('link', { name: a.back }).click();
    await expect(page.getByRole('heading', { level: 1, name: a.title })).toBeVisible();
  });

  test('op een telefoon: niet in het menu en niet op de startpagina; het adres geeft een melding', async ({
    page,
    isMobile,
  }) => {
    test.skip(!isMobile, 'Alleen op een smal scherm');
    await openPage(page, '/', { lang: 'nl' });
    const nav = page.getByRole('navigation', { name: nl.mainMenu });
    await expect(nav.getByRole('link', { name: nl.tasks.merge.title })).toBeVisible();
    await expect(nav.getByRole('link', { name: a.title })).toBeHidden();
    await expect(page.getByRole('heading', { level: 2, name: a.title })).toBeHidden();

    for (const path of ['/#/advanced', '/#/advanced/rename']) {
      await openPage(page, path, { lang: 'nl' });
      await expect(page.locator('h1')).toBeVisible();
      await expect(page.getByText(a.desktopOnly)).toBeVisible();
      await expect(page.getByRole('link', { name: new RegExp(a.tools.rename.title) })).toBeHidden();
    }
  });
});
