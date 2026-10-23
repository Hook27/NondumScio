import { expect, test } from '@playwright/test';
import { ROUTES, openPage, url } from './helpers';

test.describe('de site als geheel', () => {
  test('geeft op geen enkele pagina een fout in de console', async ({ page }) => {
    const problemen: string[] = [];
    page.on('console', (message) => {
      if (message.type() === 'error') problemen.push(`console: ${message.text()}`);
    });
    page.on('pageerror', (error) => problemen.push(`fout: ${error.message}`));

    await openPage(page, '/', { lang: 'nl' });
    for (const route of ROUTES) {
      await page.goto(url(route));
      await expect(page.locator('h1')).toBeVisible();
    }
    expect(problemen).toEqual([]);
  });

  test('past op het scherm: geen horizontaal scrollen', async ({ page }) => {
    for (const route of ROUTES) {
      await openPage(page, route, { lang: 'nl' });
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow, `breedte-overschot op ${route}`).toBeLessThanOrEqual(0);
    }
  });

  test('toont linksonder een versienummer', async ({ page }) => {
    await openPage(page, '/', { lang: 'nl' });
    const version = page.locator('.site-footer .version');
    // In de lokale en testbuild is dat "dev"; in de echte site "PR.NNN".
    await expect(version).toHaveText(/^(dev|PR\.\d{3,}|[0-9a-f]{7})$/);

    const box = await version.boundingBox();
    const viewport = page.viewportSize();
    expect(box).not.toBeNull();
    expect(box!.x).toBeLessThan(40);
    expect(box!.y + box!.height).toBeGreaterThan(viewport!.height * 0.5);
  });

  test('heeft een eigen favicon', async ({ page, request }) => {
    await openPage(page, '/', { lang: 'nl' });
    const href = await page.locator('link[rel="icon"]').getAttribute('href');
    expect(href).toContain('favicon.svg');

    const response = await request.get(new URL('favicon.svg', page.url()).href);
    expect(response.status()).toBe(200);
    expect(response.headers()['content-type']).toContain('svg');
    expect(await response.text()).toContain('<svg');
  });
});
