import AxeBuilder from '@axe-core/playwright';
import { readFileSync } from 'node:fs';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { format } from '../src/i18n/format';
import { messages, openPage, SLOW, type Theme } from './helpers';

/**
 * Archief / Triage (Geavanceerd, alleen op de computer): PDF's één voor één bekijken, per PDF
 * bewaren of verwijderen, en de lijst downloaden. De PDF's worden hier gemaakt en in de browser door
 * pdf.js gelezen, zoals bij een echte PDF.
 */

const nl = messages.nl;
const tr = nl.triage;
const pv = nl.plainText.preview;

/** Een PDF met `pages` pagina's; op elke pagina staat "<naam> pagina <n>". */
async function pdf(name: string, pages: number) {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (let n = 1; n <= pages; n++) {
    doc.addPage([595, 842]).drawText(`${name} pagina ${n}`, { x: 72, y: 760, size: 24, font });
  }
  return { name, mimeType: 'application/pdf', buffer: Buffer.from(await doc.save()) };
}

async function open(page: Page, lang: 'nl' | 'en' = 'nl', theme?: Theme) {
  await openPage(page, '/#/advanced/triage', { lang, theme });
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
}

async function addThree(page: Page) {
  await page
    .locator('#triage-files')
    .setInputFiles([
      await pdf('brief.pdf', 2),
      await pdf('factuur.pdf', 1),
      await pdf('offerte.pdf', 3),
    ]);
}

const fd = tr.folderDialog;
const list = (page: Page) => page.getByRole('list', { name: tr.files });
const active = (page: Page) => list(page).locator('[aria-current="true"]');
/**
 * Een besluittoets (K, X, M, 1–9): pas als de pagina van de PDF van nu in beeld is, zoals voor
 * iemand die kijkt (daarvoor doet de app niets met de toets).
 */
async function decideKey(page: Page, key: string) {
  await expect(page.locator('.plaintext-preview[data-shown="true"]')).toBeAttached(SLOW);
  await page.keyboard.press(key);
}
const canvas = (page: Page, n: number, lang: 'nl' | 'en' = 'nl') =>
  page.getByRole('img', { name: format(messages[lang].plainText.preview.canvas, { n }) });
const pageNumber = (page: Page) =>
  page.locator('.plaintext-bar .plaintext-nav__page [aria-hidden]');

/**
 * Het aantal regels van de tekst op een knop: de bovenkanten van de stukjes tekst, waarbij een
 * verschil van minder dan een halve letterhoogte (een ✓ of een kleiner toetsje) dezelfde regel is.
 */
const lines = (button: Locator) =>
  button.evaluate((element) => {
    const size = parseFloat(getComputedStyle(element).fontSize);
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    const tops: number[] = [];
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (!node.textContent?.trim()) continue;
      const range = document.createRange();
      range.selectNodeContents(node);
      for (const rect of range.getClientRects()) tops.push(rect.top);
    }
    tops.sort((a, b) => a - b);
    return tops.filter((top, i) => i === 0 || top - tops[i - 1]! > size / 2).length;
  });

test.describe('Archief / Triage', () => {
  test.skip(({ isMobile }) => isMobile, 'Archief / Triage is er alleen op een breed scherm');

  test('PDF’s beoordelen met toetsen, bladeren, en de lijst downloaden', async ({ page }) => {
    await open(page);
    await expect(page.getByText(tr.placeholder)).toBeVisible();
    // Chromium kan mappen kiezen: Map opruimen staat aan.
    await expect(page.getByRole('button', { name: tr.modes.folder })).toBeEnabled();

    await addThree(page);
    await expect(list(page).getByRole('button')).toHaveCount(3);
    await expect(active(page)).toContainText('brief.pdf');
    await expect(canvas(page, 1)).toBeVisible(SLOW);
    await expect(pageNumber(page)).toHaveText('1 / 2');
    await expect(page.locator('.triage-meta')).toContainText('brief.pdf · 2 pagina’s');

    // Bladeren met ↓ en End; ← → gaat naar een ander bestand.
    await page.keyboard.press('ArrowDown');
    await expect(canvas(page, 2)).toBeVisible(SLOW);
    await expect(pageNumber(page)).toHaveText('2 / 2');
    await page.keyboard.press('ArrowRight');
    await expect(active(page)).toContainText('factuur.pdf');
    await expect(pageNumber(page)).toHaveText('1 / 1');
    await page.keyboard.press('ArrowLeft');
    await expect(active(page)).toContainText('brief.pdf');
    await expect(pageNumber(page)).toHaveText('2 / 2');

    // K bewaart en gaat vanzelf naar de volgende; X verwijdert.
    await decideKey(page, 'k');
    await expect(active(page)).toContainText('factuur.pdf');
    await decideKey(page, 'x');
    await expect(active(page)).toContainText('offerte.pdf');
    await expect(canvas(page, 1)).toBeVisible(SLOW);
    await expect(page.locator('.triage-progress__text')).toContainText(
      format(tr.progress, { done: 2, total: 3 }),
    );
    await expect(
      list(page).getByRole('button', { name: `brief.pdf, ${tr.states.keep}` }),
    ).toBeVisible();
    await expect(
      list(page).getByRole('button', { name: `factuur.pdf, ${tr.states.remove}` }),
    ).toBeVisible();

    // Overzicht en downloaden.
    await page.getByRole('button', { name: tr.views.overview }).click();
    await expect(
      page.getByRole('heading', { name: format(tr.overview.keep, { n: 1 }) }),
    ).toBeVisible();
    const [txt] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('button', { name: tr.overview.txt }).click(),
    ]);
    expect(txt.suggestedFilename()).toMatch(/^triage_\d{4}-\d{2}-\d{2}_\d{4}\.txt$/);
    expect(readFileSync(await txt.path(), 'utf8')).toBe(
      'ARCHIEF TRIAGE\n====================================\n\nBEWAREN:\n  brief.pdf\n\nVERWIJDEREN:\n  factuur.pdf\n\nNIET BEOORDEELD:\n  offerte.pdf\n',
    );
    const [csv] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('button', { name: tr.overview.csv }).click(),
    ]);
    expect(csv.suggestedFilename()).toMatch(/^triage_\d{4}-\d{2}-\d{2}_\d{4}\.csv$/);
    // Voor een Nederlandse Excel: het coderingsteken (BOM) vooraan, puntkomma's en Windows-regeleinden.
    const bytes = readFileSync(await csv.path());
    expect([...bytes.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    expect(bytes.subarray(3).toString('utf8')).toBe(
      '"Bestandsnaam";"Besluit";"Map"\r\n"brief.pdf";"bewaren";""\r\n"factuur.pdf";"verwijderen";""\r\n"offerte.pdf";"niet beoordeeld";""',
    );
  });

  test('met de knoppen: beslissen, bladeren en zoomen', async ({ page }) => {
    await open(page);
    await addThree(page);
    await expect(canvas(page, 1)).toBeVisible(SLOW);
    const before = (await canvas(page, 1).boundingBox())!.width;
    await page.getByRole('button', { name: pv.zoomIn }).click();
    await expect
      .poll(async () => (await canvas(page, 1).boundingBox())?.width ?? 0)
      .toBeGreaterThan(before * 1.2);
    await page.getByRole('button', { name: pv.fitPage }).click();
    await page.getByRole('button', { name: pv.next }).click();
    await expect(canvas(page, 2)).toBeVisible(SLOW);

    await page.getByRole('button', { name: tr.keep, exact: true }).click();
    await expect(page.getByRole('button', { name: tr.keep, exact: true })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await expect(active(page)).toContainText('factuur.pdf');
    await page.getByRole('button', { name: tr.previousFile }).click();
    await expect(active(page)).toContainText('brief.pdf');
    // Nog eens Bewaren haalt het besluit weg; je blijft staan.
    await page.getByRole('button', { name: tr.keep, exact: true }).click();
    await expect(page.getByRole('button', { name: tr.keep, exact: true })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
    // Bewust een vaste wachttijd (langer dan de 200 ms waarna Triage verder gaat): er mag níets
    // gebeuren, en daar is geen teken voor om op te wachten.
    await page.waitForTimeout(400);
    await expect(active(page)).toContainText('brief.pdf');
  });

  test('andere bestanden en dubbele namen worden overgeslagen; een kapotte PDF geeft een melding', async ({
    page,
  }) => {
    await open(page);
    await page
      .locator('#triage-files')
      .setInputFiles([
        await pdf('brief.pdf', 1),
        { name: 'foto.png', mimeType: 'image/png', buffer: Buffer.from('png') },
        { name: 'kapot.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.7 kapot') },
      ]);
    await expect(page.getByText(format(tr.skipped, { list: tr.notPdfOne }))).toBeVisible();
    await page.locator('#triage-files').setInputFiles([await pdf('brief.pdf', 1)]);
    await expect(page.getByText(format(tr.skipped, { list: tr.duplicateOne }))).toBeVisible();
    await expect(list(page).getByRole('button')).toHaveCount(2);

    await page.keyboard.press('ArrowRight');
    await expect(page.getByRole('alert')).toHaveText(nl.compare.errors.damaged, SLOW);
    await decideKey(page, 'x');
    await expect(
      list(page).getByRole('button', { name: `kapot.pdf, ${tr.states.remove}` }),
    ).toBeVisible();
  });

  test('verplaatsen: M voor een nieuwe map, 1–9 voor een gekozen map, en in de lijst', async ({
    page,
  }) => {
    await open(page);
    await addThree(page);
    await expect(canvas(page, 1)).toBeVisible(SLOW);
    // M: een nieuwe map; Enter verplaatst en gaat door naar de volgende.
    await decideKey(page, 'm');
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByRole('heading')).toHaveText(fd.title);
    await expect(dialog.getByLabel(fd.label)).toBeFocused();
    await page.keyboard.type('Facturen');
    await page.keyboard.press('Enter');
    await expect(dialog).toHaveCount(0);
    await expect(active(page)).toContainText('factuur.pdf');
    await expect(
      list(page).getByRole('button', {
        name: `brief.pdf, ${format(tr.states.move, { folder: 'Facturen' })}`,
      }),
    ).toBeVisible();
    // 1: de eerste map op naam.
    await decideKey(page, '1');
    await expect(active(page)).toContainText('offerte.pdf');
    // Een tweede map, met Escape eerst afgebroken.
    await decideKey(page, 'm');
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await page.getByRole('button', { name: tr.newFolder }).click();
    await page.keyboard.type('Archief');
    await dialog.getByRole('button', { name: fd.confirm }).click();
    await expect(
      page.getByRole('group', { name: tr.moveTo }).getByRole('button', { name: 'Archief' }),
    ).toHaveAttribute('aria-pressed', 'true');

    await page.getByRole('button', { name: tr.views.overview }).click();
    await expect(
      page.getByRole('heading', { name: format(tr.overview.move, { n: 3 }) }),
    ).toBeVisible();
    // Factuur toch bewaren.
    await page
      .getByRole('button', { name: format(tr.overview.setKeep, { name: 'factuur.pdf' }) })
      .click();
    const [csv] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('button', { name: tr.overview.csv }).click(),
    ]);
    expect(readFileSync(await csv.path(), 'utf8')).toBe(
      '﻿"Bestandsnaam";"Besluit";"Map"\r\n"brief.pdf";"verplaatsen";"Facturen"\r\n"factuur.pdf";"bewaren";""\r\n"offerte.pdf";"verplaatsen";"Archief"',
    );
    const [txt] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('button', { name: tr.overview.txt }).click(),
    ]);
    expect(readFileSync(await txt.path(), 'utf8')).toBe(
      'ARCHIEF TRIAGE\n====================================\n\nBEWAREN:\n  factuur.pdf\n\nVERPLAATSEN NAAR Archief:\n  offerte.pdf\n\nVERPLAATSEN NAAR Facturen:\n  brief.pdf\n',
    );
  });

  test('Wis alles vraagt eerst', async ({ page }) => {
    await open(page);
    await addThree(page);
    await expect(canvas(page, 1)).toBeVisible(SLOW);
    await page.getByRole('button', { name: tr.clear }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    // In het venster doen de toetsen niets.
    await decideKey(page, 'k');
    await dialog.getByRole('button', { name: tr.clearConfirm }).click();
    await expect(page.getByText(tr.placeholder)).toBeVisible();
    await expect(list(page)).toHaveCount(0);
  });

  for (const theme of ['light', 'dark'] as const) {
    test(`geen toegankelijkheidsfouten met PDF’s, bij beoordelen en in het overzicht (${theme})`, async ({
      page,
    }) => {
      await open(page, 'nl', theme);
      await addThree(page);
      await expect(canvas(page, 1)).toBeVisible(SLOW);
      await decideKey(page, 'k');
      await expect(active(page)).toContainText('factuur.pdf');
      await decideKey(page, 'm');
      await page.keyboard.type('Facturen');
      await page.keyboard.press('Enter');
      await expect(active(page)).toContainText('offerte.pdf');
      const check = async () => {
        const result = await new AxeBuilder({ page })
          .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
          .analyze();
        expect(
          result.violations.map((v) => [v.id, v.nodes.map((n) => n.target.join(' '))]),
        ).toEqual([]);
      };
      await check();
      await decideKey(page, 'm');
      await expect(page.getByRole('dialog')).toBeVisible();
      await page.getByRole('dialog').getByRole('button', { name: fd.confirm }).click();
      await expect(page.getByRole('alert')).toHaveText(fd.empty);
      await check();
      await page.keyboard.press('Escape');
      await page.getByRole('button', { name: tr.views.overview }).click();
      await expect(
        page.getByRole('heading', { name: format(tr.overview.keep, { n: 1 }) }),
      ).toBeVisible();
      await check();
    });
  }
});

/**
 * Zoals een laptop met Windows-schaal 150 %: 1366 × 768 met de balken van de browser en Windows eraf
 * (911 × 433), en een groter scherm op 150 % zoals in de review van PR 91 (1333 × 722).
 */
for (const size of [
  { width: 911, height: 433 },
  { width: 1333, height: 722 },
]) {
  test.describe(`Archief / Triage op ${size.width} × ${size.height} bij 150 %`, () => {
    test.skip(({ isMobile }) => isMobile, 'Alleen op de computer');
    test.use({ viewport: size, deviceScaleFactor: 1.5 });

    for (const lang of ['nl', 'en'] as const) {
      test(`de knoppen passen, op één regel, en Bewaren/Verwijderen zijn in beeld (${lang})`, async ({
        page,
      }) => {
        const t = messages[lang].triage;
        await open(page, lang);
        // Een gewone schuifbalk (17 px op Windows) kost breedte; de testbrowser toont er geen.
        await page.addStyleTag({
          content: '.workspace__tools { padding-right: 23px !important; }',
        });
        await addThree(page);
        await expect(canvas(page, 1, lang)).toBeVisible(SLOW);
        // Met drie gekozen mappen (twee rijen): de knoppen per map staan dan ook in de vaste balk.
        for (const folder of ['Facturen 2024', 'Belastingdienst', 'Foto/Bloemen']) {
          await page.getByRole('button', { name: t.newFolder }).click();
          await page.keyboard.type(folder);
          await page.keyboard.press('Enter');
        }
        await page.keyboard.press('ArrowLeft');
        await page.keyboard.press('ArrowLeft');
        await expect(canvas(page, 1, lang)).toBeVisible(SLOW);
        const viewport = page.viewportSize()!;
        for (const name of [
          t.keep,
          t.remove,
          t.views.review,
          t.views.overview,
          t.modes.list,
          t.modes.folder,
        ]) {
          const button = page.getByRole('button', { name, exact: true });
          expect(await lines(button), name).toBe(1);
        }
        // Verwijderen en Bewaren: in beeld, binnen het vak (ook met de schuifbalk), niet afgekapt,
        // en de toets staat in de hint.
        const tools = page.locator('.workspace__tools');
        const inner = await tools.evaluate((element) => {
          const box = element.getBoundingClientRect();
          const style = getComputedStyle(element);
          return {
            right: box.left + element.clientWidth - parseFloat(style.paddingRight),
            overflow: element.scrollWidth - element.clientWidth,
          };
        });
        expect(inner.overflow, 'zijwaarts schuiven in het linkervak').toBeLessThanOrEqual(0);
        for (const [name, key] of [
          [t.keep, 'K'],
          [t.remove, 'X'],
        ] as const) {
          const button = page.getByRole('button', { name, exact: true });
          const box = (await button.boundingBox())!;
          expect(box.y + box.height, name).toBeLessThanOrEqual(viewport.height);
          expect(box.x + box.width, name).toBeLessThanOrEqual(inner.right + 0.5);
          const label = button.locator('.triage-decide__label');
          expect(
            await label.evaluate((element) => element.scrollWidth - element.clientWidth),
            `${name} afgekapt`,
          ).toBeLessThanOrEqual(0);
          await expect(button).toHaveAttribute('data-tip', `${name} (${key})`);
        }
        // "+ Nieuwe map" en de knoppen van de mappen: helemaal in beeld (niet weggeschoven of half
        // afgeknipt), binnen het vak.
        const move = page.getByRole('group', { name: t.moveTo });
        for (const name of [t.newFolder, 'Belastingdienst', 'Facturen 2024', 'Foto/Bloemen']) {
          const button = move.getByRole('button', { name });
          const box = (await button.boundingBox())!;
          const area = (await button.evaluate((element) => {
            const scroller = element.closest('.triage-folders') ?? element.parentElement!;
            const r = scroller.getBoundingClientRect();
            return { top: r.top, bottom: r.bottom };
          }))!;
          expect(box.y, name).toBeGreaterThanOrEqual(area.top - 0.5);
          expect(box.y + box.height, name).toBeLessThanOrEqual(
            Math.min(area.bottom, viewport.height) + 0.5,
          );
          expect(box.x + box.width, name).toBeLessThanOrEqual(inner.right + 0.5);
        }
        // De pagina zelf krijgt het grootste deel van de breedte.
        const view = (await page.locator('.workspace__view').boundingBox())!;
        expect(view.width / viewport.width).toBeGreaterThan(0.55);
        // Zoals pdf-triage.html staat de pagina op de breedte van het vak: goed te lezen.
        const shown = (await canvas(page, 1, lang).boundingBox())!;
        expect(shown.width / view.width).toBeGreaterThan(0.8);
      });
    }

    test('de lijst links schuift mee met het bestand van nu, en de pagina zelf schuift niet', async ({
      page,
    }) => {
      // Op 911 × 433 is het linkervak zo laag (175 px) dat de vaste balk het helemaal vult: daar is
      // de lijst niet te zien. Wel nagaan dat de pagina zelf daar niet schuift.
      const roomy = size.width >= 1000;
      test.setTimeout(90_000);
      await open(page);
      await page.addStyleTag({
        content: '.workspace__tools { padding-right: 23px !important; }',
      });
      const names = Array.from(
        { length: 16 },
        (_, i) => `stuk ${String(i + 1).padStart(2, '0')}.pdf`,
      );
      const files = [];
      for (const name of names) files.push(await pdf(name, 1));
      await page.locator('#triage-files').setInputFiles(files);
      await expect(canvas(page, 1)).toBeVisible(SLOW);
      const pane = page.locator('.workspace__tools');
      /** Het bestand van nu staat helemaal in het linkervak, boven de vaste balk. */
      const shown = async (name: string) => {
        await expect(active(page)).toContainText(name);
        if (!roomy) return;
        await expect
          .poll(() =>
            active(page).evaluate((item) => {
              const box = item.getBoundingClientRect();
              const area = item.closest('.workspace__tools')!.getBoundingClientRect();
              const bar = document.querySelector('.triage-decide')!.getBoundingClientRect();
              return box.top >= area.top - 0.5 && box.bottom <= bar.top + 0.5;
            }),
          )
          .toBe(true);
      };
      /** De pagina zelf heeft niets om te schuiven. */
      const pageFits = () =>
        page.evaluate(
          () => document.documentElement.scrollHeight <= document.documentElement.clientHeight,
        );
      // Een map erbij (de balk onderaan wordt dan hoger), dan om en om bewaren en verplaatsen.
      await decideKey(page, 'm');
      await page.keyboard.type('Map');
      await page.keyboard.press('Enter');
      for (let i = 1; i < names.length - 1; i++) {
        await shown(names[i]!);
        await decideKey(page, i % 2 ? 'k' : '1');
      }
      await shown(names.at(-1)!);
      if (roomy) expect(await pane.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
      expect(await pageFits()).toBe(true);
      // Terug naar boven: de lijst schuift mee terug.
      for (let i = names.length - 2; i >= 0; i--) await page.keyboard.press('ArrowLeft');
      await shown(names[0]!);
      // Het overzicht, met verplaatste PDF's (en dus tekst alleen voor schermlezers).
      await page.getByRole('button', { name: tr.views.overview }).click();
      await expect(
        page.getByRole('heading', { name: format(tr.overview.move, { n: 8 }) }),
      ).toBeVisible();
      expect(await pageFits()).toBe(true);
    });
  });
}

/**
 * Map opruimen gebruikt de mappen-toegang van de browser. Het Windows-venster om een map te kiezen
 * kan een test niet bedienen; daarom geeft `showDirectoryPicker` hier de map "Documenten" uit het
 * afgeschermde bestandssysteem van de browser zelf (OPFS), gevuld met verzonnen bestanden.
 */
async function folders(page: Page, tree: Record<string, string | null>) {
  await page.addInitScript(() => {
    const w = window as unknown as { showDirectoryPicker: unknown; __picks: number };
    w.__picks = 0;
    w.showDirectoryPicker = async () => {
      w.__picks++;
      return (await navigator.storage.getDirectory()).getDirectoryHandle('Documenten');
    };
  });
  await open(page);
  const entries: [string, string | null][] = [];
  for (const [path, content] of Object.entries(tree)) {
    entries.push([
      path,
      content === null
        ? null
        : path.endsWith('.pdf')
          ? (await pdf(content, 1)).buffer.toString('base64')
          : Buffer.from(content).toString('base64'),
    ]);
  }
  await page.evaluate(async (list) => {
    const root = await navigator.storage.getDirectory();
    for await (const name of (root as unknown as { keys(): AsyncIterable<string> }).keys())
      await root.removeEntry(name, { recursive: true });
    for (const [path, data] of list) {
      const parts = path.split('/');
      const name = parts.pop();
      let dir = root;
      for (const part of parts) dir = await dir.getDirectoryHandle(part, { create: true });
      if (!name || data === null) continue;
      const handle = await dir.getFileHandle(name, { create: true });
      const writer = await handle.createWritable();
      await writer.write(Uint8Array.from(atob(data), (c) => c.charCodeAt(0)));
      await writer.close();
    }
  }, entries);
}

/** Alle paden in het afgeschermde bestandssysteem (mappen eindigen op "/"). */
const opfs = (page: Page) =>
  page.evaluate(async () => {
    type Dir = FileSystemDirectoryHandle & {
      entries(): AsyncIterable<[string, FileSystemHandle]>;
    };
    const out: string[] = [];
    const walk = async (dir: Dir, prefix: string) => {
      for await (const [name, handle] of dir.entries()) {
        if (handle.kind === 'directory') {
          out.push(`${prefix}${name}/`);
          await walk(handle as Dir, `${prefix}${name}/`);
        } else out.push(`${prefix}${name}`);
      }
    };
    await walk((await navigator.storage.getDirectory()) as Dir, '');
    return out.sort();
  });

const TRASH = '_Prullenbak (triage)';

const TREE = {
  'Documenten/Archief/brief.pdf': 'brief',
  'Documenten/Archief/factuur.pdf': 'factuur',
  'Documenten/Archief/notitie.txt': 'hallo',
  'Documenten/Archief/2024/c.pdf': 'c',
  'Documenten/Archief/.git/x.pdf': 'x',
  'Documenten/Archief/_Prullenbak (triage)/oud.pdf': 'oud',
  'Documenten/Foto/Bloemen/': null,
};

test.describe('Archief / Triage: Map opruimen', () => {
  test.skip(({ isMobile }) => isMobile, 'Archief / Triage is er alleen op een breed scherm');
  const f = tr.folderMode;
  const b = tr.browser;

  test('hoofdmap, bronmap, submappen, verplaatsen naar een nieuwe en een bestaande map; niets op schijf veranderd', async ({
    page,
  }) => {
    await folders(page, TREE);
    const before = await opfs(page);
    await page.getByRole('button', { name: tr.modes.folder }).click();
    await expect(page.getByText(f.placeholder)).toBeVisible();
    await page.getByRole('button', { name: f.chooseRoot }).click();
    await page.getByRole('button', { name: f.chooseSource }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByRole('heading')).toHaveText(b.titleSource);
    await dialog.getByRole('button', { name: 'Archief' }).click();
    await dialog.getByRole('button', { name: b.confirm }).click();
    const region = page.getByRole('region', { name: f.root });
    await expect(region.getByRole('status')).toHaveText(format(f.found, { n: 2 }));
    await expect(canvas(page, 1)).toBeVisible(SLOW);
    await page.getByLabel(f.recursive).check();
    await expect(region.getByRole('status')).toHaveText(format(f.found, { n: 3 }));
    await expect(list(page).getByRole('button')).toHaveCount(3);
    await expect(list(page).getByRole('button').nth(2)).toHaveAttribute('data-tip', '2024/c.pdf');

    // M (met de focus nog op het vinkje): een nieuwe map in Archief.
    await decideKey(page, 'm');
    await expect(dialog.getByRole('heading')).toHaveText(b.titleTarget);
    await dialog.getByLabel(b.newLabel).fill('Facturen');
    await dialog.getByRole('button', { name: b.create }).click();
    await expect(dialog.getByText(b.empty)).toBeVisible();
    await dialog.getByRole('button', { name: b.confirm }).click();
    await expect(active(page)).toContainText('factuur.pdf');
    // Nog eens: het venster begint in Archief, met Facturen (nieuw); naar Foto/Bloemen.
    await page.getByRole('button', { name: f.choose }).click();
    await expect(dialog.getByRole('button', { name: `Facturen (${b.isNew})` })).toBeVisible();
    await dialog.getByRole('button', { name: b.up }).click();
    await dialog.getByRole('button', { name: 'Foto' }).click();
    await dialog.getByRole('button', { name: 'Bloemen' }).click();
    await dialog.getByRole('button', { name: b.confirm }).click();
    await expect(active(page)).toContainText('c.pdf');
    const move = page.getByRole('group', { name: tr.moveTo });
    await expect(move.getByRole('button', { name: '.../Archief/Facturen' })).toBeVisible();
    await expect(move.getByRole('button', { name: '.../Foto/Bloemen' })).toBeVisible();
    await decideKey(page, 'k');

    await page.getByRole('button', { name: tr.views.overview }).click();
    await expect(page.getByRole('button', { name: tr.run.button })).toBeEnabled();
    const [csv] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('button', { name: tr.overview.csv }).click(),
    ]);
    expect(readFileSync(await csv.path(), 'utf8')).toBe(
      '﻿"Bestandsnaam";"Besluit";"Map"\r\n"brief.pdf";"verplaatsen";"Archief/Facturen"\r\n"factuur.pdf";"verplaatsen";"Foto/Bloemen"\r\n"2024/c.pdf";"bewaren";""',
    );
    // Tot Uitvoeren is er niets veranderd: geen nieuwe map, alle bestanden waar ze waren.
    expect(await opfs(page)).toEqual(before);
    expect(before).not.toContain('Documenten/Archief/Facturen/');
  });

  test('Uitvoeren: vraagt eerst, verplaatst dan echt (nieuwe map, prullenbakmap met submap, _1 bij dubbel); de datum blijft', async ({
    page,
  }) => {
    await folders(page, {
      ...TREE,
      'Documenten/Archief/2024/oud.pdf': 'oud',
      'Documenten/Foto/Bloemen/factuur.pdf': 'al er',
    });
    /** De datum (laatst gewijzigd) van een bestand in de afgeschermde browsermap. */
    const modified = (path: string) =>
      page.evaluate(async (p) => {
        const parts = p.split('/');
        const name = parts.pop()!;
        let dir = await navigator.storage.getDirectory();
        for (const part of parts) dir = await dir.getDirectoryHandle(part);
        return (await (await dir.getFileHandle(name)).getFile()).lastModified;
      }, path);
    const before = await modified('Documenten/Archief/brief.pdf');
    // Even wachten: een nieuw geschreven bestand zou een latere datum krijgen.
    await page.waitForTimeout(1100);

    await page.getByRole('button', { name: tr.modes.folder }).click();
    await page.getByRole('button', { name: f.chooseRoot }).click();
    await page.getByRole('button', { name: f.chooseSource }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByRole('button', { name: 'Archief' }).click();
    await dialog.getByRole('button', { name: b.confirm }).click();
    await page.getByLabel(f.recursive).check();
    await expect(list(page).getByRole('button')).toHaveCount(4);
    await expect(canvas(page, 1)).toBeVisible(SLOW);
    // brief → nieuwe map Facturen; factuur → Foto/Bloemen (daar staat al een factuur.pdf);
    // 2024/c bewaren; 2024/oud naar de prullenbak.
    await decideKey(page, 'm');
    await dialog.getByLabel(b.newLabel).fill('Facturen');
    await dialog.getByRole('button', { name: b.create }).click();
    await dialog.getByRole('button', { name: b.confirm }).click();
    await expect(active(page)).toContainText('factuur.pdf');
    await decideKey(page, 'm');
    await dialog.getByRole('button', { name: b.up }).click();
    await dialog.getByRole('button', { name: 'Foto' }).click();
    await dialog.getByRole('button', { name: 'Bloemen' }).click();
    await dialog.getByRole('button', { name: b.confirm }).click();
    await expect(active(page)).toContainText('c.pdf');
    await decideKey(page, 'k');
    await expect(active(page)).toContainText('oud.pdf');
    await decideKey(page, 'x');

    await page.getByRole('button', { name: tr.views.overview }).click();
    await expect(page.getByText(format(tr.run.warnOne, { folder: TRASH }))).toBeVisible();
    await page.getByRole('button', { name: tr.run.button }).click();
    await expect(dialog.getByRole('heading')).toHaveText(tr.run.title);
    await expect(dialog).toContainText(
      `${format(tr.run.move, { n: 2 })} · ${tr.run.trashOne} · ${tr.run.newOne}. ${tr.run.rest}`,
    );
    await dialog.getByRole('button', { name: tr.run.confirm }).click();
    await expect(page.getByText(format(tr.run.done, { n: 3 }))).toBeVisible(SLOW);
    await expect(page.getByText(format(tr.run.okRenamed, { name: 'factuur_1.pdf' }))).toBeVisible();

    expect(await opfs(page)).toEqual(
      [
        'Documenten/',
        'Documenten/Archief/',
        'Documenten/Archief/.git/',
        'Documenten/Archief/.git/x.pdf',
        'Documenten/Archief/2024/',
        'Documenten/Archief/2024/c.pdf',
        'Documenten/Archief/Facturen/',
        'Documenten/Archief/Facturen/brief.pdf',
        'Documenten/Archief/notitie.txt',
        `Documenten/Archief/${TRASH}/`,
        `Documenten/Archief/${TRASH}/2024/`,
        `Documenten/Archief/${TRASH}/2024/oud.pdf`,
        `Documenten/Archief/${TRASH}/oud.pdf`,
        'Documenten/Foto/',
        'Documenten/Foto/Bloemen/',
        'Documenten/Foto/Bloemen/factuur.pdf',
        'Documenten/Foto/Bloemen/factuur_1.pdf',
      ].sort(),
    );
    // Verplaatsen is geen kopie: de datum van het bestand blijft.
    expect(await modified('Documenten/Archief/Facturen/brief.pdf')).toBe(before);

    // Opnieuw inlezen: wat er nu in de bronmap staat (Facturen staat in Archief, dus brief.pdf
    // komt daar weer langs), met het besluit dat erbij hoorde.
    await page.getByRole('button', { name: tr.run.again }).click();
    await expect(list(page).getByRole('button')).toHaveCount(2);
    await expect(
      list(page).getByRole('button', { name: `c.pdf, ${tr.states.keep}` }),
    ).toHaveAttribute('data-tip', '2024/c.pdf');
    await expect(
      list(page).getByRole('button', { name: `brief.pdf, ${tr.states.none}` }),
    ).toHaveAttribute('data-tip', 'Facturen/brief.pdf');
  });

  test('de hoofdmap wordt onthouden: na herladen meteen verder, zonder opnieuw te kiezen', async ({
    page,
  }) => {
    await folders(page, TREE);
    await page.getByRole('button', { name: tr.modes.folder }).click();
    await page.getByRole('button', { name: f.chooseRoot }).click();
    await expect(page.getByRole('button', { name: f.chooseSource })).toBeVisible();
    await page.reload();
    await page.getByRole('button', { name: tr.modes.folder }).click();
    await expect(page.getByRole('button', { name: f.chooseSource })).toBeVisible();
    await expect(page.getByRole('region', { name: f.root })).toContainText('Documenten');
    expect(await page.evaluate(() => (window as unknown as { __picks: number }).__picks)).toBe(0);
  });

  test('wisselen van werkwijze met besluiten vraagt eerst', async ({ page }) => {
    await folders(page, TREE);
    await page.getByRole('button', { name: tr.modes.folder }).click();
    await page.getByRole('button', { name: f.chooseRoot }).click();
    await page.getByRole('button', { name: f.chooseSource }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Archief' }).click();
    await page.getByRole('dialog').getByRole('button', { name: b.confirm }).click();
    await expect(canvas(page, 1)).toBeVisible(SLOW);
    await decideKey(page, 'x');
    await page.getByRole('button', { name: tr.modes.list }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByRole('heading')).toHaveText(tr.switchMode.title);
    await dialog.getByRole('button', { name: tr.switchMode.confirm }).click();
    await expect(page.getByText(tr.placeholder)).toBeVisible();
    await expect(page.getByRole('button', { name: tr.slot.choose })).toBeVisible();
  });

  for (const theme of ['light', 'dark'] as const) {
    test(`geen toegankelijkheidsfouten bij Map opruimen, ook met het mapvenster open (${theme})`, async ({
      page,
    }) => {
      await folders(page, TREE);
      if (theme === 'dark') await open(page, 'nl', 'dark');
      await page.getByRole('button', { name: tr.modes.folder }).click();
      await page.getByRole('button', { name: f.chooseRoot }).click();
      await page.getByRole('button', { name: f.chooseSource }).click();
      await page.getByRole('dialog').getByRole('button', { name: 'Archief' }).click();
      await page.getByRole('dialog').getByRole('button', { name: b.confirm }).click();
      await expect(canvas(page, 1)).toBeVisible(SLOW);
      const check = async () => {
        const result = await new AxeBuilder({ page })
          .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
          .analyze();
        expect(
          result.violations.map((v) => [v.id, v.nodes.map((n) => n.target.join(' '))]),
        ).toEqual([]);
      };
      await check();
      await decideKey(page, 'm');
      await page.getByRole('dialog').getByLabel(b.newLabel).fill('a/b');
      await page.getByRole('dialog').getByRole('button', { name: b.create }).click();
      await expect(page.getByRole('alert')).toHaveText(b.badName);
      await check();
    });
  }
});
