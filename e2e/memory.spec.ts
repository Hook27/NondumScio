import { expect, test, type Page } from '@playwright/test';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { messages, openPage, SLOW } from './helpers';

/**
 * Geheugen: wat na het werk achterblijft. Telt met de ontwikkelaarsingang van Chromium (opruimen
 * en objecten tellen), dus alleen op de computer. Bestanden worden in de pagina zelf gekozen: kiest
 * Playwright ze (`setInputFiles`), dan houdt Playwright het invoerveld en daarmee het hele werkvak
 * vast, en meet je jezelf.
 */
test.skip(({ isMobile }) => isMobile, 'Telt met Chromium op de computer');

async function letter(pages: number) {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (let p = 1; p <= pages; p++) {
    doc.addPage([595, 842]).drawText(`Pagina ${p}`, { x: 60, y: 760, size: 24, font });
  }
  return Buffer.from(await doc.save());
}

const BROKEN = Buffer.from('%PDF-1.7\nhier staat geen echte pdf in\n%%EOF');

/** Kiest een bestand in het invoerveld `selector`, vanuit de pagina zelf. */
async function choose(page: Page, selector: string, name: string, bytes: Buffer) {
  // Een onderdeel van Geavanceerd wordt pas geladen: wachten tot het veld er is.
  await expect
    .poll(() => page.evaluate((s) => document.querySelector(s) !== null, selector), SLOW)
    .toBe(true);
  await page.evaluate(
    ({ selector, name, data }) => {
      const input = document.querySelector<HTMLInputElement>(selector)!;
      const transfer = new DataTransfer();
      transfer.items.add(new File([new Uint8Array(data)], name, { type: 'application/pdf' }));
      input.files = transfer.files;
      input.dispatchEvent(new Event('change', { bubbles: true }));
    },
    { selector, name, data: [...bytes] },
  );
}

/** Na opruimen: hoeveel kijkers er nog zijn, en hoeveel werkvakken los van de pagina bewaard blijven. */
async function leftovers(page: Page) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('HeapProfiler.enable');
  const count = async (prototype: string, fn: string) => {
    const objectGroup = 'telling';
    try {
      const { result } = await cdp.send('Runtime.evaluate', { expression: prototype, objectGroup });
      const { objects } = await cdp.send('Runtime.queryObjects', {
        prototypeObjectId: result.objectId!,
        objectGroup,
      });
      const { result: out } = await cdp.send('Runtime.callFunctionOn', {
        objectId: objects.objectId!,
        functionDeclaration: fn,
        returnByValue: true,
        objectGroup,
      });
      return out.value as number;
    } finally {
      // Loslaten: anders houdt de telling zelf de gevonden objecten vast.
      await cdp.send('Runtime.releaseObjectGroup', { objectGroup });
    }
  };
  for (let i = 0; i < 3; i++) {
    await cdp.send('HeapProfiler.collectGarbage');
    await page.waitForTimeout(200);
  }
  const result = {
    observers: await count('IntersectionObserver.prototype', 'function () { return this.length; }'),
    detachedViews: await count(
      'HTMLDivElement.prototype',
      `function () {
        return this.filter((el) => el.hasAttribute('data-scroll-root') && !el.isConnected).length;
      }`,
    ),
  };
  await cdp.detach();
  return result;
}

const go = (page: Page, hash: string) => page.evaluate((to) => (location.hash = to), hash);

test('wisselen tussen taken laat geen oude werkvakken met hun pagina’s achter', async ({
  page,
}) => {
  await openPage(page, '/#/edit', { lang: 'nl' });
  await choose(page, '#pdf-file', 'tien.pdf', await letter(10));
  const sheet = page.locator('.annotate-page').first();
  await expect(sheet).toHaveAttribute('data-rendered', 'true', SLOW);
  const switches = async (n: number) => {
    for (let i = 0; i < n; i++) {
      await go(page, '#/pages');
      await expect(page.locator('.thumb canvas').first()).toBeVisible(SLOW);
      await go(page, '#/edit');
      await expect(sheet).toHaveAttribute('data-rendered', 'true', SLOW);
    }
  };
  await switches(1);
  const early = await leftovers(page);
  await switches(5);
  const late = await leftovers(page);
  // Alleen de kijker van het werkvak van nu. Preact onthoudt hooguit één vorige weergave (en dus
  // één oud werkvak); dat mag, zolang het niet oploopt met elke wissel (eerst waren het er 12).
  expect(late.observers).toBe(1);
  expect(late.detachedViews).toBeLessThanOrEqual(1);
  expect(late).toEqual(early);
});

test('een PDF die niet opent, laat geen pdf.js-worker achter', async ({ page }) => {
  await openPage(page, '/#/advanced/text', { lang: 'nl' });
  for (let i = 1; i <= 5; i++) {
    await choose(page, '#plaintext-file', `kapot-${i}.pdf`, BROKEN);
    await expect(page.getByRole('alert').first()).toBeVisible(SLOW);
  }
  await expect.poll(() => page.workers().length, SLOW).toBe(0);

  // Een goede PDF opent gewoon, met zijn eigen worker.
  await choose(page, '#plaintext-file', 'goed.pdf', await letter(1));
  await expect(page.locator('canvas.plaintext-preview__canvas')).toBeVisible(SLOW);
  expect(page.workers().length).toBeGreaterThan(0);
});

test('Platte tekst en Vergelijken verlaten: de PDF van het voorbeeld gaat dicht', async ({
  page,
}) => {
  const preview = page.locator('canvas.plaintext-preview__canvas');
  await openPage(page, '/#/advanced/text', { lang: 'nl' });
  await choose(page, '#plaintext-file', 'brief.pdf', await letter(2));
  await expect(preview).toBeVisible(SLOW);
  expect(page.workers().length).toBeGreaterThan(0);
  await go(page, '#/merge');
  await expect.poll(() => page.workers().length, SLOW).toBe(0);
  // Terug: de PDF staat er nog en het voorbeeld wordt opnieuw getekend.
  await go(page, '#/advanced/text');
  await expect(preview).toBeVisible(SLOW);
  await expect(
    page.locator('.plaintext-slot').getByText('brief.pdf', { exact: true }),
  ).toBeVisible();

  // Vergelijken, met het beeld (dat opent beide PDF's): weggaan sluit ze allebei.
  await go(page, '#/advanced/compare');
  await choose(page, '#compare-file-a', 'oud.pdf', await letter(2));
  await choose(page, '#compare-file-b', 'nieuw.pdf', await letter(2));
  await page.getByRole('button', { name: messages.nl.compare.tabs.visual }).click();
  await expect(page.locator('canvas.compare-visual__canvas')).toBeVisible(SLOW);
  expect(page.workers().length).toBeGreaterThan(0);
  await go(page, '#/split');
  await expect.poll(() => page.workers().length, SLOW).toBe(0);
});
