import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { downloadVia, messages, openPage } from './helpers';
import { REPORT_OUTLINE, makeOutlinePdf, readOutlineOf, type ReadItem } from './outline-fixtures';

const nl = messages.nl;

/** Rapport (6 pagina's, geneste bladwijzers en een link) en notulen (3 pagina's, platte bladwijzers). */
async function openBoth(page: Page, task: 'merge' | 'pages' = 'merge') {
  await openPage(page, `/#/${task}`, { lang: 'nl' });
  await page.locator('#pdf-file').setInputFiles([
    {
      name: 'rapport.pdf',
      mimeType: 'application/pdf',
      buffer: await makeOutlinePdf(REPORT_OUTLINE, 6, 'Rapport'),
    },
    {
      name: 'notulen.pdf',
      mimeType: 'application/pdf',
      buffer: await makeOutlinePdf(
        [
          { title: 'Samenvatting', page: 0 },
          { title: 'Besluiten', page: 2 },
        ],
        3,
        'Notulen',
      ),
    },
  ]);
  await expect(page.getByRole('list', { name: nl.merge.files }).getByRole('listitem')).toHaveCount(
    2,
  );
}

async function downloadOutline(page: Page, button: string) {
  const file = await downloadVia(page, page.getByRole('button', { name: button }));
  return readOutlineOf(readFileSync((await file.path())!));
}

const leaf = (title: string, page: number): ReadItem => ({ title, page, children: [] });

/** De bladwijzers van het rapport en de notulen in het samengevoegde bestand (de link valt weg). */
const REPORT: ReadItem[] = [
  leaf('Inleiding', 1),
  {
    title: 'Hoofdstuk 1',
    page: 2,
    children: [leaf('Paragraaf 1.1', 3), leaf('Paragraaf 1.2', 4)],
  },
  leaf('Bijlage', 6),
];
const MINUTES: ReadItem[] = [leaf('Samenvatting', 7), leaf('Besluiten', 9)];

test.describe('samenvoegen: bestaande bladwijzers behouden', () => {
  test('staat standaard aan: de bladwijzers van beide bestanden staan achter elkaar', async ({
    page,
  }) => {
    await openBoth(page);
    await expect(page.getByLabel(nl.merge.keepBookmarks)).toBeChecked();
    expect(await downloadOutline(page, nl.merge.download)).toEqual([...REPORT, ...MINUTES]);
  });

  test('met "Bladwijzer per bestand" staan ze onder de bladwijzer van hun bestand', async ({
    page,
  }) => {
    await openBoth(page);
    await page.getByLabel(nl.merge.bookmarks).check();
    expect(await downloadOutline(page, nl.merge.download)).toEqual([
      { title: 'rapport', page: 1, children: REPORT },
      { title: 'notulen', page: 7, children: MINUTES },
    ]);
  });

  test('volgt de volgorde van de bestanden en laat weggehaalde pagina’s weg', async ({ page }) => {
    await openBoth(page);
    await page.getByRole('button', { name: 'notulen.pdf omhoog' }).click();
    // Van het rapport alleen pagina 2 t/m 5: de inleiding en de bijlage vallen weg.
    const range = page.getByLabel('Pagina’s kiezen uit rapport.pdf');
    await range.fill('2-5');
    await range.press('Enter');
    expect(await downloadOutline(page, nl.merge.download)).toEqual([
      leaf('Samenvatting', 1),
      leaf('Besluiten', 3),
      {
        title: 'Hoofdstuk 1',
        page: 4,
        children: [leaf('Paragraaf 1.1', 5), leaf('Paragraaf 1.2', 6)],
      },
    ]);
  });

  test('uitgezet gaan de bestaande bladwijzers niet mee', async ({ page }) => {
    await openBoth(page);
    await page.getByLabel(nl.merge.keepBookmarks).uncheck();
    expect(await downloadOutline(page, nl.merge.download)).toEqual([]);
  });

  test('geldt ook bij Pagina’s met meer bestanden, en het blok Bladwijzers zegt wat er gebeurt', async ({
    page,
  }) => {
    await openBoth(page, 'pages');
    // Pagina 6 van het rapport (de bijlage) weg.
    await page.getByRole('option', { name: /^Pagina 6,/ }).click();
    await page.keyboard.press('Delete');
    await page.getByText(/^Bladwijzers \(/).click();
    await expect(page.getByText(`${nl.outline.removedOne} ${nl.outline.left}`)).toBeVisible();
    expect(await downloadOutline(page, nl.pages.save)).toEqual([
      ...REPORT.slice(0, 2),
      leaf('Samenvatting', 6),
      leaf('Besluiten', 8),
    ]);
  });
});
