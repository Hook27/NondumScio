import { expect, test, type Page } from '@playwright/test';
import { pdfFile } from './fixtures';
import { messages, openPage } from './helpers';

const nl = messages.nl;

/** De taken met een geopend bestand, en hoe je ze opent. */
const TASKS = [
  { id: 'merge', title: nl.tasks.merge.title, path: '/#/merge', toolbar: nl.merge.actions },
  { id: 'split', title: nl.tasks.split.title, path: '/#/split', toolbar: nl.split.actions },
  { id: 'pages', title: nl.tasks.pages.title, path: '/#/pages', toolbar: nl.pages.toolbar },
  { id: 'edit', title: nl.tasks.edit.title, path: '/#/edit', toolbar: nl.edit.toolbar },
  { id: 'convert', title: nl.tasks.convert.title, path: '/#/convert', toolbar: nl.convert.actions },
] as const;

async function open(page: Page, task: (typeof TASKS)[number]) {
  await openPage(page, task.path, { lang: 'nl' });
  if (task.id === 'convert') {
    await page.getByRole('button', { name: nl.convert.toImages }).click();
  }
  await page
    .locator('#pdf-file')
    .setInputFiles([await pdfFile('rapport.pdf', 3), await pdfFile('bijlage.pdf', 2)]);
  await expect(page.getByRole('list', { name: nl.merge.files }).getByRole('listitem')).toHaveCount(
    2,
    { timeout: 15_000 },
  );
}

test.describe('overal dezelfde indeling', () => {
  for (const task of TASKS) {
    test(`${task.title}: links de bestandslijst en de balk, rechts de kop “Resultaat”`, async ({
      page,
    }) => {
      await open(page, task);
      const list = page.getByRole('list', { name: nl.merge.files });

      // Links: bij elk bestand een greepje, het volgnummer, de naam, een bereikveld en de knoppen.
      await expect(list.locator('.drag-handle')).toHaveCount(2);
      await expect(list.locator('.merge-list__name')).toHaveText(['rapport.pdf', 'bijlage.pdf']);
      await expect(page.getByLabel('Pagina’s kiezen uit bijlage.pdf')).toBeVisible();
      await expect(page.getByRole('button', { name: 'bijlage.pdf omhoog' })).toBeEnabled();
      await expect(page.getByRole('button', { name: 'bijlage.pdf weghalen' })).toBeVisible();

      // De balk: ongedaan maken en opnieuw; onderaan toevoegen naast de hoofdactie.
      const toolbar = page.getByRole('toolbar', { name: task.toolbar });
      await expect(toolbar.getByRole('button', { name: nl.pages.undo })).toBeVisible();
      await expect(toolbar.getByRole('button', { name: nl.pages.redo })).toBeVisible();
      const wide = toolbar.locator('.toolbar__group--wide');
      await expect(wide.getByText(nl.merge.add)).toBeVisible();
      expect(await wide.locator('.button').count()).toBeGreaterThanOrEqual(2);

      // Rechts: dezelfde kop met het aantal pagina's.
      await expect(page.getByRole('heading', { name: nl.merge.result })).toBeVisible();
      await expect(page.locator('.pane-head__meta').first()).toContainText(/5 pagina’s|\d+ delen/);
    });

    test(`${task.title}: een bestand omhoog zetten en ongedaan maken werkt hier hetzelfde`, async ({
      page,
    }) => {
      await open(page, task);
      const names = page.getByRole('list', { name: nl.merge.files }).locator('.merge-list__name');
      await page.getByRole('button', { name: 'bijlage.pdf omhoog' }).click();
      await expect(names).toHaveText(['bijlage.pdf', 'rapport.pdf']);
      await page
        .getByRole('toolbar', { name: task.toolbar })
        .getByRole('button', { name: nl.pages.undo })
        .click();
      await expect(names).toHaveText(['rapport.pdf', 'bijlage.pdf']);
    });
  }

  test('Splitsen toont alle pagina’s in één raster, met het deel bij elke pagina', async ({
    page,
  }) => {
    await open(page, TASKS[1]);
    await page.getByLabel(nl.split.size).fill('2');
    const grid = page.getByRole('list', { name: nl.merge.result });
    await expect(grid.getByRole('listitem')).toHaveCount(5);
    await expect(grid.locator('.page-option__file')).toHaveText([
      'Deel 1',
      'Deel 1',
      'Deel 2',
      'Deel 2',
      'Deel 3',
    ]);
    // Een raster met meerdere kolommen, niet één pagina per regel.
    const tops = await grid
      .getByRole('listitem')
      .evaluateAll((els) => els.map((el) => Math.round(el.getBoundingClientRect().top)));
    expect(tops.filter((top) => top === tops[0]).length).toBeGreaterThan(1);
  });

  test('op een telefoon staan toevoegen en de hoofdactie vast onderaan, bij elke taak', async ({
    page,
    isMobile,
  }) => {
    test.skip(!isMobile, 'Alleen voor de telefoonindeling');
    for (const task of TASKS) {
      await open(page, task);
      const add = page.getByRole('toolbar', { name: task.toolbar }).getByText(nl.merge.add);
      const box = (await add.boundingBox())!;
      expect(box.y + box.height, task.title).toBeGreaterThan(page.viewportSize()!.height - 20);
      expect(box.height, task.title).toBeGreaterThanOrEqual(44);
    }
  });
});
