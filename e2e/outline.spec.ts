import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { messages, openPage } from './helpers';
import { REPORT_OUTLINE, makeOutlinePdf } from './outline-fixtures';

const nl = messages.nl;
const o = nl.outline;

async function open(page: Page, task: 'pages' | 'edit' | 'redact', withOutline = true) {
  await openPage(page, `/#/${task}`, { lang: 'nl' });
  await page.locator('#pdf-file').setInputFiles({
    name: 'rapport.pdf',
    mimeType: 'application/pdf',
    buffer: await makeOutlinePdf(withOutline ? REPORT_OUTLINE : null),
  });
}

const summary = (page: Page) => page.getByText('Bladwijzers (6)');
const panel = (page: Page) => page.locator('details.outline');
const entry = (page: Page, name: string) =>
  panel(page).getByRole('button', { name: new RegExp(`^${name}`) });

test.describe('bladwijzers van een geopend bestand', () => {
  test('Pagina’s: ingeklapt, uitklappen en naar de pagina springen', async ({ page }) => {
    await open(page, 'pages');
    await expect(summary(page)).toBeVisible();
    await expect(entry(page, 'Inleiding')).toBeHidden();

    await summary(page).click();
    await expect(entry(page, 'Inleiding')).toContainText('blz. 1');
    await expect(entry(page, 'Bijlage')).toContainText('blz. 6');
    await expect(panel(page).getByText('Paragraaf 1.1')).toBeHidden();
    // Een link naar een website staat erbij, maar is geen knop.
    await expect(panel(page).getByText(o.noPage)).toBeVisible();
    await expect(entry(page, 'Website')).toHaveCount(0);

    await entry(page, 'Bijlage').click();
    const zes = page.getByRole('option', { name: 'Pagina 6' });
    await expect(zes).toHaveAttribute('aria-selected', 'true');
    await expect(zes).toBeFocused();
    await expect(zes).toBeInViewport();

    await panel(page)
      .getByRole('button', { name: 'Onderliggende bladwijzers van Hoofdstuk 1' })
      .click();
    await expect(entry(page, 'Paragraaf 1.2')).toContainText('blz. 4');
    await entry(page, 'Paragraaf 1.2').click();
    await expect(page.getByRole('option', { name: 'Pagina 4' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await expect(zes).toHaveAttribute('aria-selected', 'false');
  });

  test('Pagina’s: een bladwijzer naar een weggehaalde pagina wordt grijs, de nummers schuiven', async ({
    page,
  }) => {
    await open(page, 'pages');
    await summary(page).click();
    await page.getByRole('option', { name: 'Pagina 1' }).click();
    await page.keyboard.press('Delete');
    await expect(page.getByRole('option')).toHaveCount(5);

    await expect(entry(page, 'Inleiding')).toHaveCount(0);
    await expect(panel(page).getByText(o.removed)).toBeVisible();
    await expect(panel(page).getByText(`${o.removedOne} ${o.nowhere}`)).toBeVisible();
    await expect(entry(page, 'Hoofdstuk 1')).toContainText('blz. 1');
    // Ongedaan maken zet het terug.
    await page.getByRole('button', { name: nl.pages.undo }).click();
    await expect(entry(page, 'Inleiding')).toContainText('blz. 1');
  });

  test('Bewerken: springen zet de pagina in beeld met de focus erop', async ({ page }) => {
    await open(page, 'edit');
    await summary(page).click();
    await entry(page, 'Bijlage').click();
    const zes = page.locator('.annotate-page[data-position="6"]');
    await expect(zes).toBeFocused();
    await expect(zes).toBeInViewport();
    await expect(zes).toHaveAttribute('data-rendered', 'true', { timeout: 15_000 });
  });

  test('Redigeren: met een redactievak staat erbij dat de bladwijzers niet meegaan', async ({
    page,
  }) => {
    await open(page, 'redact');
    await summary(page).click();
    await expect(panel(page).getByText(o.redacted)).toHaveCount(0);
    const first = page.locator('.annotate-page').first();
    await first.focus();
    await page.keyboard.press('r');
    await first.focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('[data-annotation]')).toHaveCount(1);
    await expect(panel(page).getByText(o.redacted)).toBeVisible();
  });

  test('open en uitgeklapt blijft zo bij het wisselen tussen Pagina’s, Bewerken en Redigeren', async ({
    page,
  }) => {
    await open(page, 'pages');
    await summary(page).click();
    await panel(page)
      .getByRole('button', { name: 'Onderliggende bladwijzers van Hoofdstuk 1' })
      .click();
    for (const task of ['edit', 'redact', 'pages', 'redact', 'edit', 'pages']) {
      await page.goto(`./#/${task}`);
      await expect(entry(page, 'Paragraaf 1.1'), task).toBeVisible();
      await expect(panel(page), task).toHaveAttribute('open', '');
    }
    // Dichtgeklapt blijft ook dicht, ook na Pagina's.
    await summary(page).click();
    await expect(entry(page, 'Inleiding')).toBeHidden();
    for (const task of ['edit', 'pages', 'redact']) {
      await page.goto(`./#/${task}`);
      await expect(summary(page), task).toBeVisible();
      await expect(entry(page, 'Inleiding'), task).toBeHidden();
    }
  });

  test('zonder bladwijzers is er geen blok', async ({ page }) => {
    await open(page, 'pages', false);
    await expect(page.getByRole('option')).toHaveCount(6);
    await expect(page.getByText(/^Bladwijzers \(/)).toHaveCount(0);
  });

  test('is toegankelijk en past op het scherm, ook uitgeklapt', async ({ page }) => {
    await open(page, 'pages');
    await summary(page).click();
    await panel(page)
      .getByRole('button', { name: 'Onderliggende bladwijzers van Hoofdstuk 1' })
      .click();
    await expect(entry(page, 'Paragraaf 1.1')).toBeVisible();
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth,
    );
    expect(overflow).toBe(false);
    const results = await new AxeBuilder({ page }).analyze();
    expect(results.violations).toEqual([]);
  });
});
