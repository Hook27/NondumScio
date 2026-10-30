import { expect, test } from '@playwright/test';
import { TASK_IDS, messages, openPage } from './helpers';

const nl = messages.nl;

test.describe('navigatie', () => {
  test('de startpagina toont een kaart per taak, en op de computer ook Geavanceerd', async ({
    page,
    isMobile,
  }) => {
    await openPage(page, '/', { lang: 'nl' });
    await expect(page.getByRole('heading', { level: 1, name: nl.home.title })).toBeVisible();
    await expect(page.locator('.card:visible')).toHaveCount(TASK_IDS.length + (isMobile ? 0 : 1));
  });

  test('een kaart opent de taakpagina en markeert hem in het menu', async ({ page }) => {
    await openPage(page, '/', { lang: 'nl' });
    await page.locator('.card', { hasText: nl.tasks.merge.title }).click();

    await expect(page).toHaveURL(/#\/merge$/);
    await expect(page.getByRole('heading', { level: 1, name: nl.tasks.merge.title })).toBeVisible();
    await expect(
      page.getByRole('navigation', { name: nl.mainMenu }).locator('a[aria-current="page"]'),
    ).toHaveText(nl.tasks.merge.title);
  });

  test('de paginatitel en de focus volgen de navigatie', async ({ page }) => {
    await openPage(page, '/', { lang: 'nl' });
    await page.locator('.card', { hasText: nl.tasks.split.title }).click();

    await expect(page).toHaveTitle(`${nl.tasks.split.title} · ${nl.appName}`);
    await expect(page.locator('#page-title')).toBeFocused();
  });

  test('de terugknop van de browser werkt', async ({ page }) => {
    await openPage(page, '/', { lang: 'nl' });
    await page.locator('.card', { hasText: nl.tasks.edit.title }).click();
    await expect(page.getByRole('heading', { level: 1, name: nl.tasks.edit.title })).toBeVisible();

    await page.goBack();
    await expect(page.getByRole('heading', { level: 1, name: nl.home.title })).toBeVisible();
  });

  test('een adres met een taak opent die taak direct', async ({ page }) => {
    await openPage(page, '/#/redact', { lang: 'nl' });
    await expect(
      page.getByRole('heading', { level: 1, name: nl.tasks.redact.title }),
    ).toBeVisible();
  });

  test('een onbekend adres toont een melding met een weg terug', async ({ page }) => {
    await openPage(page, '/#/bestaat-niet', { lang: 'nl' });
    await expect(page.getByRole('heading', { level: 1, name: nl.notFound.title })).toBeVisible();

    await page.getByRole('link', { name: nl.allTasks }).click();
    await expect(page.getByRole('heading', { level: 1, name: nl.home.title })).toBeVisible();
  });

  test('de sla-over-link verschijnt met Tab en brengt je bij de inhoud, op dezelfde pagina', async ({
    page,
    isMobile,
  }) => {
    test.skip(isMobile, 'Toetsenbordbediening is op een telefoon niet relevant');
    await openPage(page, '/#/merge', { lang: 'nl' });

    await page.keyboard.press('Tab');
    const skip = page.getByRole('link', { name: nl.skipToContent });
    await expect(skip).toBeFocused();
    await expect(skip).toBeVisible();

    await page.keyboard.press('Enter');
    await expect(page.locator('#main')).toBeFocused();
    // Nog steeds dezelfde pagina: de link mag geen "niet gevonden" veroorzaken.
    await expect(page.getByRole('heading', { level: 1, name: nl.tasks.merge.title })).toBeVisible();
    await expect(page).toHaveURL(/#\/merge$/);
  });

  test('alle taken zijn bereikbaar via het menu', async ({ page }) => {
    await openPage(page, '/', { lang: 'nl' });
    const nav = page.getByRole('navigation', { name: nl.mainMenu });
    for (const id of TASK_IDS) {
      await nav.getByRole('link', { name: nl.tasks[id].title }).click();
      await expect(page).toHaveURL(new RegExp(`#/${id}$`));
      await expect(page.getByRole('heading', { level: 1, name: nl.tasks[id].title })).toBeVisible();
    }
  });
});
