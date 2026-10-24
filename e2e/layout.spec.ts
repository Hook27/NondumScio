import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { makeSizedPdf } from './fixtures';
import { messages, openPage } from './helpers';

const nl = messages.nl;
const a4 = (count: number) => Array.from({ length: count }, () => 595);

/** Opent een PDF van 20 pagina's bij Pagina's: genoeg om te moeten scrollen. */
async function openPages(page: Page, theme: 'light' | 'dark' = 'light') {
  await openPage(page, '/#/pages', { lang: 'nl', theme });
  await page.locator('#pdf-file').setInputFiles({
    name: 'twintig.pdf',
    mimeType: 'application/pdf',
    buffer: await makeSizedPdf(a4(20)),
  });
  await expect(page.getByRole('option')).toHaveCount(20, { timeout: 15_000 });
}

const toolbar = (page: Page) => page.getByRole('toolbar', { name: nl.pages.toolbar });

/** Of een element helemaal binnen het venster staat. */
async function inViewport(page: Page, selector: ReturnType<Page['locator']>) {
  const box = (await selector.boundingBox())!;
  const viewport = page.viewportSize()!;
  return box.y >= 0 && box.y + box.height <= viewport.height;
}

test.describe('layout', () => {
  test('het gereedschap blijft in beeld als je door de pagina’s scrolt', async ({
    page,
    isMobile,
  }) => {
    await openPages(page);
    await page.getByRole('option').last().scrollIntoViewIfNeeded();
    expect(await inViewport(page, toolbar(page))).toBe(true);
    if (isMobile) {
      // Onder elkaar: de pagina scrolt, de knoppenbalk blijft bovenaan hangen.
      expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(0);
    } else {
      // Splitscherm: alleen het rechtervak scrolt, de pagina zelf niet.
      expect(await page.evaluate(() => window.scrollY)).toBe(0);
      expect(await page.locator('.workspace__view').evaluate((el) => el.scrollTop)).toBeGreaterThan(
        0,
      );
      expect(await inViewport(page, page.getByRole('heading', { name: 'twintig.pdf' }))).toBe(true);
    }
  });

  test('symboolknoppen tonen hun naam als hover-tekst, ook als ze uit staan', async ({
    page,
    isMobile,
  }) => {
    test.skip(isMobile, 'Geen muis en geen hover op een telefoon');
    await openPages(page);
    const rotate = toolbar(page).getByRole('button', { name: nl.pages.rotateLeft });
    await expect(rotate).toBeDisabled();
    await rotate.hover({ force: true });
    const tip = page.locator('.tooltip');
    await expect(tip).toHaveText(nl.pages.rotateLeft);
    await page.keyboard.press('Escape');
    await expect(tip).toHaveCount(0);

    // Met het toetsenbord verschijnt de tekst meteen bij focus.
    await page.mouse.move(0, 0);
    // Eerst een toets: dan telt de focus als toetsenbordfocus (:focus-visible).
    await page.keyboard.press('Shift');
    await toolbar(page).getByRole('button', { name: nl.pages.selectAll }).focus();
    await expect(tip).toHaveText(nl.pages.selectAll);
    // De hover-tekst blijft binnen het venster.
    const box = (await tip.boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(0);
  });

  test('de uitleg staat achter de ⓘ-knop', async ({ page }) => {
    await openPages(page);
    const info = page.getByRole('button', { name: nl.info });
    await expect(page.getByText(nl.pages.hint)).toBeHidden();
    await info.click();
    await expect(info).toHaveAttribute('aria-expanded', 'true');
    await expect(page.getByText(nl.pages.hint)).toBeVisible();
  });

  test('bij Samenvoegen wisselt ⊞ het rechtervak tussen resultaat en pagina’s kiezen', async ({
    page,
  }) => {
    await openPage(page, '/#/merge', { lang: 'nl' });
    await page.locator('#pdf-file').setInputFiles([
      { name: 'een.pdf', mimeType: 'application/pdf', buffer: await makeSizedPdf(a4(2)) },
      { name: 'twee.pdf', mimeType: 'application/pdf', buffer: await makeSizedPdf(a4(3)) },
    ]);
    await expect(page.getByRole('heading', { name: nl.merge.result })).toBeVisible({
      timeout: 15_000,
    });
    const toggle = page.getByRole('button', { name: `${nl.merge.showPages}: twee.pdf` });
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-pressed', 'true');
    const heading = page.getByRole('heading', { name: 'twee.pdf: pagina’s kiezen' });
    await expect(heading).toBeFocused();
    expect(await inViewport(page, heading)).toBe(true);
    await expect(page.getByRole('group', { name: 'Miniaturen van twee.pdf' })).toBeVisible();

    await page.getByRole('button', { name: nl.merge.showResult }).click();
    await expect(page.getByRole('heading', { name: nl.merge.result })).toBeFocused();
    await expect(toggle).toHaveAttribute('aria-pressed', 'false');
  });

  for (const theme of ['light', 'dark'] as const) {
    test(`Pagina’s met een open document is toegankelijk (${theme})`, async ({ page }) => {
      await openPages(page, theme);
      await page.getByRole('button', { name: nl.info }).click();
      await expect(page.locator('.thumb[data-rendered="true"]').first()).toBeVisible();
      const result = await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
        .analyze();
      expect(
        result.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target).join(', ')}`),
      ).toEqual([]);
    });
  }
});
