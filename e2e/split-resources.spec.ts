import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { unzipSync } from 'fflate';
import { grayOf, imagesIn, makeSharedResourcesPdf } from '../src/pdf/testShared';
import { downloadVia, messages, openPage } from './helpers';
import { pixels } from './redact-helpers';

/**
 * Een scan waarvan alle pagina's één lijst met hulpbronnen delen (met de afbeeldingen van alle
 * pagina's): na Splitsen heeft elk deel alleen zijn eigen afbeeldingen, en ziet het er hetzelfde uit.
 */

const nl = messages.nl;

test('splitsen van een scan met gedeelde hulpbronnen: kleine delen die er hetzelfde uitzien', async ({
  page,
}) => {
  test.setTimeout(60_000);
  await openPage(page, '/#/split', { lang: 'nl' });
  await page.locator('#pdf-file').setInputFiles({
    name: 'scan.pdf',
    mimeType: 'application/pdf',
    buffer: Buffer.from(await makeSharedResourcesPdf(6)),
  });
  const parts = page.getByRole('list', { name: nl.split.parts }).getByRole('listitem');
  // Ruim: op een drukke machine duurt het openen soms langer dan bij andere tests.
  await expect(parts).toHaveCount(6, { timeout: 30_000 });
  await page.getByLabel(nl.split.size).fill('3');
  await expect(parts).toHaveCount(2);

  const download = await downloadVia(
    page,
    page.getByRole('button', { name: 'Alle 2 delen downloaden (ZIP)' }),
  );
  const files = Object.values(unzipSync(new Uint8Array(readFileSync((await download.path())!))));
  expect(files).toHaveLength(2);
  // Alleen het logo (0) en de eigen afbeeldingen, niet die van het hele document.
  expect(await imagesIn(files[0]!)).toEqual([0, 1, 2, 3]);
  expect(await imagesIn(files[1]!)).toEqual([0, 4, 5, 6]);

  // De eerste pagina van deel 2 (pagina 4) toont zijn eigen afbeelding en het logo.
  const { colors } = await pixels(page, Buffer.from(files[1]!), [
    [300, 342],
    [525, 57],
  ]);
  const near = (color: number[], gray: number) =>
    color.every((value) => Math.abs(value - gray) <= 3);
  expect(near(colors[0]!, grayOf(4)), `afbeelding: ${colors[0]!.join(',')}`).toBe(true);
  expect(near(colors[1]!, grayOf(0)), `logo: ${colors[1]!.join(',')}`).toBe(true);
});
