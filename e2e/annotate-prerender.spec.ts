import { expect, test, type Page } from '@playwright/test';
import { pdfFile } from './fixtures';
import { openPage } from './helpers';

/**
 * Bewerken en Redigeren tekenen de pagina's net buiten beeld al vooruit, ook op een breed scherm
 * waar het werkvak zelf scrolt (op een telefoon scrolt het venster): zonder dat zie je tijdens het
 * scrollen eerst lege pagina's.
 */

const PAGES = 60;
const pages = (page: Page) => page.locator('.annotate-page');

for (const route of ['edit', 'redact']) {
  test(`${route}: pagina’s vlak buiten beeld zijn al getekend`, async ({ page }) => {
    await openPage(page, `/#/${route}`, { lang: 'nl' });
    await page.locator('#pdf-file').setInputFiles(await pdfFile('lang.pdf', PAGES));
    await expect(pages(page)).toHaveCount(PAGES, { timeout: 15_000 });

    await pages(page).nth(30).scrollIntoViewIfNeeded();
    await expect(pages(page).nth(30)).toHaveAttribute('data-rendered', 'true');

    // Eén pagina onder de zichtbare pagina's staat al klaar, en één erboven ook.
    const counts = async () =>
      page.evaluate(() => {
        const scroller = document.querySelector<HTMLElement>('[data-scroll-root]')!;
        const overflow = getComputedStyle(scroller).overflowY;
        const view =
          overflow === 'auto' || overflow === 'scroll'
            ? scroller.getBoundingClientRect()
            : new DOMRect(0, 0, innerWidth, innerHeight);
        let outside = 0;
        for (const el of document.querySelectorAll<HTMLElement>('.annotate-page')) {
          const box = el.getBoundingClientRect();
          const inView = box.bottom > view.top && box.top < view.bottom;
          if (!inView && el.dataset.rendered === 'true') outside += 1;
        }
        return outside;
      });
    await expect.poll(counts).toBeGreaterThanOrEqual(1);

    // Maar niet alles: ver weg is weer vrijgegeven.
    await expect(pages(page).first()).toHaveAttribute('data-rendered', 'false');
    await expect(pages(page).last()).toHaveAttribute('data-rendered', 'false');
  });
}
