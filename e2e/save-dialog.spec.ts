import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { makeSizedPdf } from './fixtures';
import { downloadVia, messages, openPage } from './helpers';

const nl = messages.nl;
const toolbarButton = (page: Page, name: string) =>
  page.getByRole('toolbar', { name: nl.pages.toolbar }).getByRole('button', { name });

async function openTwoPages(page: Page, theme: 'light' | 'dark' = 'light') {
  await openPage(page, '/#/pages', { lang: 'nl', theme });
  await page.locator('input[type="file"]').setInputFiles({
    name: 'brief.pdf',
    mimeType: 'application/pdf',
    buffer: await makeSizedPdf([300, 400]),
  });
  await expect(page.getByRole('option')).toHaveCount(2);
}

test.describe('bestandsnaam bij downloaden', () => {
  test('stelt een naam voor die je kunt aanpassen', async ({ page }) => {
    await openTwoPages(page);
    await toolbarButton(page, nl.pages.save).click();
    const field = page.getByRole('dialog').getByRole('textbox', { name: nl.saveDialog.label });
    await expect(field).toHaveValue('brief (bewerkt)');
    await expect(page.locator('.save-dialog__extension')).toHaveText('.pdf');
    await expect(field).toBeFocused();
    await page.getByRole('button', { name: nl.saveDialog.cancel }).click();

    const download = await downloadVia(page, toolbarButton(page, nl.pages.save), 'Brief aan: VvE');
    expect(download.suggestedFilename()).toBe('Brief aan- VvE.pdf');
  });

  test('overtypen vervangt de naam, .pdf komt er vanzelf bij', async ({ page, isMobile }) => {
    test.skip(isMobile, 'Toetsenbordbediening is op een telefoon niet relevant');
    await openTwoPages(page);
    await toolbarButton(page, nl.pages.save).click();
    await page.keyboard.type('Nieuwe naam');
    await expect(page.getByRole('dialog').getByRole('textbox')).toHaveValue('Nieuwe naam');
    await expect(page.getByText('Wordt gedownload als: Nieuwe naam.pdf')).toBeVisible();
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.keyboard.press('Enter'),
    ]);
    expect(download.suggestedFilename()).toBe('Nieuwe naam.pdf');
  });

  test('Escape en Annuleren downloaden niets', async ({ page, isMobile }) => {
    await openTwoPages(page);
    let downloads = 0;
    page.on('download', () => (downloads += 1));

    await toolbarButton(page, nl.pages.save).click();
    await page.getByRole('button', { name: nl.saveDialog.cancel }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);

    if (!isMobile) {
      await toolbarButton(page, nl.pages.save).click();
      await page.keyboard.press('Escape');
      await expect(page.getByRole('dialog')).toHaveCount(0);
    }
    await page.waitForTimeout(500);
    expect(downloads).toBe(0);
  });

  test('ook bij uitpakken kun je de naam aanpassen', async ({ page }) => {
    await openTwoPages(page);
    await page.getByRole('option').nth(1).locator('.select-box').click();
    const download = await downloadVia(page, toolbarButton(page, nl.pages.extract), 'alleen twee');
    expect(download.suggestedFilename()).toBe('alleen twee.pdf');
  });

  for (const theme of ['light', 'dark'] as const) {
    test(`het venster is toegankelijk (${theme})`, async ({ page }) => {
      await openTwoPages(page, theme);
      await toolbarButton(page, nl.pages.save).click();
      await expect(page.getByRole('dialog')).toBeVisible();
      const result = await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
        .analyze();
      expect(result.violations.map((v) => `${v.id}: ${v.nodes.length}`)).toEqual([]);
    });
  }
});
