import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { makeSizedPdf } from './fixtures';
import { messages, openPage } from './helpers';

/**
 * Sluiten met wijzigingen die nog niet gedownload zijn: eerst een venster dat om bevestiging
 * vraagt (Annuleren is de veilige keuze). Zonder wijzigingen sluit de knop meteen.
 */

const nl = messages.nl;
const options = (page: Page) => page.getByRole('option');
const closeButton = (page: Page) =>
  page.getByRole('button', { name: nl.document.close, exact: true });
const dialog = (page: Page) => page.getByRole('dialog', { name: nl.closeDialog.title });
const openTitle = (page: Page) =>
  page.getByRole('heading', { level: 2, name: nl.document.openTitle });

async function openThreePages(page: Page) {
  await openPage(page, '/#/pages', { lang: 'nl' });
  await page.locator('input[type="file"]').setInputFiles({
    name: 'drie.pdf',
    mimeType: 'application/pdf',
    buffer: await makeSizedPdf([300, 400, 500]),
  });
  await expect(options(page)).toHaveCount(3);
}

async function rotateFirst(page: Page) {
  await options(page).first().click();
  await page
    .getByRole('toolbar', { name: nl.pages.toolbar })
    .getByRole('button', { name: nl.pages.rotateRight })
    .click();
  await expect(page.getByText(nl.pages.unsaved)).toBeVisible();
}

test.describe('sluiten met niet-gedownloade wijzigingen', () => {
  test('vraagt eerst; Annuleren laat alles staan, bevestigen sluit', async ({ page }) => {
    await openThreePages(page);
    await rotateFirst(page);

    await closeButton(page).click();
    await expect(dialog(page)).toBeVisible();
    await expect(dialog(page)).toContainText(nl.closeDialog.text);
    await expect(dialog(page).getByRole('button', { name: nl.closeDialog.cancel })).toBeFocused();
    const result = await new AxeBuilder({ page })
      .include('dialog')
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze();
    expect(result.violations).toEqual([]);

    await dialog(page).getByRole('button', { name: nl.closeDialog.cancel }).click();
    await expect(dialog(page)).toBeHidden();
    await expect(options(page).first()).toHaveAttribute('aria-label', 'Pagina 1, 90° gedraaid');
    // De focus is terug op de knop.
    await expect(closeButton(page)).toBeFocused();

    // Escape breekt ook af.
    await closeButton(page).click();
    await expect(dialog(page)).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(dialog(page)).toBeHidden();
    await expect(options(page)).toHaveCount(3);

    await closeButton(page).click();
    await dialog(page).getByRole('button', { name: nl.closeDialog.confirm }).click();
    await expect(openTitle(page)).toBeVisible();
  });

  test('zonder wijzigingen sluit de knop meteen', async ({ page }) => {
    await openThreePages(page);
    await closeButton(page).click();
    await expect(dialog(page)).toHaveCount(0);
    await expect(openTitle(page)).toBeVisible();
  });
});
