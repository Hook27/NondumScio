import { expect, test, type Page } from '@playwright/test';
import { makeSizedPdf } from './fixtures';
import { openPage } from './helpers';

/**
 * Vaste ruimte voor de schuifbalk in het werkvak (audit F19). Zonder die ruimte wordt het vak
 * smaller zodra de schuifbalk verschijnt; Bewerken en Redigeren tekenen de pagina's dan opnieuw
 * passend, en dat kan heen en weer gaan. De testbrowser verbergt schuifbalken normaal (dan nemen ze
 * geen ruimte in en zie je het verschil niet); in dit bestand staan ze aan, zoals op Windows.
 */
test.use({ launchOptions: { ignoreDefaultArgs: ['--hide-scrollbars'] } });

test.skip(({ isMobile }) => isMobile, 'Het werkvak met twee vakken is er alleen op de computer');

/** De breedte die de inhoud van het rechtervak krijgt (zonder de schuifbalk). */
const inner = (page: Page) =>
  page
    .locator('.workspace__view')
    .first()
    .evaluate((el) => ({
      client: el.clientWidth,
      scrolls: el.scrollHeight > el.clientHeight,
    }));

test('Bewerken: het vak houdt dezelfde breedte, met en zonder schuifbalk', async ({ page }) => {
  await openPage(page, '/#/edit', { lang: 'nl' });
  // Eén heel brede, lage pagina: passend getekend is hij laag, dus geen schuifbalk.
  await page.locator('#pdf-file').setInputFiles({
    name: 'breed.pdf',
    mimeType: 'application/pdf',
    buffer: await makeSizedPdf([4000]),
  });
  await expect(page.locator('.annotate-page').first()).toHaveAttribute('data-rendered', 'true', {
    timeout: 15_000,
  });
  const before = await inner(page);
  expect(before.scrolls).toBe(false);

  // Een bestand met vijf staande pagina's erbij: nu past het niet meer, dus wel een schuifbalk.
  await page.locator('#edit-add').setInputFiles({
    name: 'vijf.pdf',
    mimeType: 'application/pdf',
    buffer: await makeSizedPdf([595, 595, 595, 595, 595]),
  });
  await expect(page.locator('.annotate-page')).toHaveCount(6, { timeout: 15_000 });
  const after = await inner(page);
  expect(after.scrolls).toBe(true);
  expect(after.client).toBe(before.client);
});

test('elk rechtervak heeft vaste ruimte voor de schuifbalk, en het linkervak niet', async ({
  page,
}) => {
  await openPage(page, '/#/edit', { lang: 'nl' });
  // Een werkvak zoals elke taak het heeft (Pagina's, Bewerken, Redigeren, Platte tekst, Vergelijken,
  // Triage, Slim hernoemen …): dezelfde klassen, dus dezelfde regels.
  const styles = await page.evaluate(() => {
    const main = document.querySelector('main') ?? document.body;
    const result: Record<string, string> = {};
    for (const kind of ['', 'compare', 'triage', 'plaintext', 'rename']) {
      const section = document.createElement('section');
      section.className = `workspace ${kind}`.trim();
      section.innerHTML = '<div class="workspace__tools"></div><div class="workspace__view"></div>';
      main.append(section);
      const [tools, view] = [...section.children] as HTMLElement[];
      result[`${kind || 'gewoon'} rechts`] = getComputedStyle(view!).scrollbarGutter;
      result[`${kind || 'gewoon'} links`] = getComputedStyle(tools!).scrollbarGutter;
      section.remove();
    }
    return result;
  });
  for (const [where, gutter] of Object.entries(styles)) {
    expect(gutter, where).toBe(where.endsWith('rechts') ? 'stable' : 'auto');
  }
});
