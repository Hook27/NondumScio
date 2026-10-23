import { expect, test } from '@playwright/test';
import { messages, openPage, url } from './helpers';

const { nl, en } = messages;

test.describe('taal', () => {
  test('wisselen naar Engels past teksten, titel en lang-attribuut aan en blijft na herladen', async ({
    page,
  }) => {
    await openPage(page, '/#/merge', { lang: 'nl' });
    await expect(page.locator('html')).toHaveAttribute('lang', 'nl');

    await page.getByRole('button', { name: 'English' }).click();
    await expect(page.getByRole('heading', { level: 1, name: en.tasks.merge.title })).toBeVisible();
    await expect(page).toHaveTitle(`${en.tasks.merge.title} · ${en.appName}`);
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');

    await page.reload();
    await expect(page.getByRole('heading', { level: 1, name: en.tasks.merge.title })).toBeVisible();
    await expect(page.getByRole('button', { name: 'English' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });

  test('terug naar Nederlands kan ook', async ({ page }) => {
    await openPage(page, '/', { lang: 'en' });
    await page.getByRole('button', { name: 'Nederlands' }).click();
    await expect(page.getByRole('heading', { level: 1, name: nl.home.title })).toBeVisible();
  });

  test('zonder keuze volgt de taal van de browser', async ({ browser }) => {
    const context = await browser.newContext({ locale: 'nl-NL' });
    const page = await context.newPage();
    await page.goto(url('/'));
    await expect(page.getByRole('heading', { level: 1, name: nl.home.title })).toBeVisible();
    await context.close();

    const english = await browser.newContext({ locale: 'de-DE' });
    const englishPage = await english.newPage();
    await englishPage.goto(url('/'));
    await expect(englishPage.getByRole('heading', { level: 1, name: en.home.title })).toBeVisible();
    await english.close();
  });
});

test.describe('thema', () => {
  const darkBackground = 'rgb(20, 23, 29)';
  const lightBackground = 'rgb(246, 247, 249)';
  const background = (page: import('@playwright/test').Page) =>
    page.evaluate(() => getComputedStyle(document.body).backgroundColor);

  test('de knop wisselt tussen licht en donker en de keuze blijft na herladen', async ({
    page,
  }) => {
    await openPage(page, '/', { lang: 'nl', theme: 'light' });
    expect(await background(page)).toBe(lightBackground);

    const toggle = page.getByRole('button', { name: nl.theme.dark });
    await toggle.click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await expect(toggle).toHaveAttribute('aria-pressed', 'true');
    expect(await background(page)).toBe(darkBackground);

    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    expect(await background(page)).toBe(darkBackground);

    await page.getByRole('button', { name: nl.theme.dark }).click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  });

  test('zonder keuze volgt de site het systeemthema', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'dark' });
    await openPage(page, '/', { lang: 'nl' });
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');

    await page.emulateMedia({ colorScheme: 'light' });
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  });

  test('een bewaarde keuze wint van het systeemthema', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'dark' });
    await openPage(page, '/', { lang: 'nl', theme: 'light' });
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
    expect(await background(page)).toBe(lightBackground);
  });

  test('een bewaarde keuze wordt toegepast vóór de app laadt (geen flits)', async ({ page }) => {
    await openPage(page, '/', { lang: 'nl', theme: 'dark' });
    // Zonder de scripts van de app moet het thema er al staan: dat doet het korte script in de pagina.
    await page.route('**/assets/*.js', (route) => route.abort());
    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  });
});
