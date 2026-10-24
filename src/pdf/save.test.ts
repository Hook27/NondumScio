import {
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFName,
  PDFRef,
  PDFString,
  degrees,
  type PDFHexString,
} from 'pdf-lib';
import { describe, expect, it } from 'vitest';
import { initialPages, movePages, removePages, rotatePages } from '../pages/plan';
import { PdfSaveError, buildPdf, editedFileName } from './save';

/** Test-PDF waarin elke pagina een eigen breedte heeft, zodat je hem terugkent: 300, 400, 500, … */
async function samplePdf(
  count: number,
  rotate: Record<number, number> = {},
  { title = 'Origineel', firstWidth = 300 }: { title?: string; firstWidth?: number } = {},
) {
  const doc = await PDFDocument.create();
  doc.setTitle(title);
  doc.setAuthor('Testschrijver');
  for (let i = 0; i < count; i += 1) {
    const page = doc.addPage([firstWidth + 100 * i, 800]);
    if (rotate[i]) page.setRotation(degrees(rotate[i]!));
  }
  return doc.save();
}

async function describePdf(bytes: Uint8Array) {
  const doc = await PDFDocument.load(bytes);
  return {
    widths: doc.getPages().map((page) => page.getWidth()),
    rotations: doc.getPages().map((page) => page.getRotation().angle),
    title: doc.getTitle(),
    author: doc.getAuthor(),
  };
}

/** De bladwijzers van een PDF: titel en paginanummer (vanaf 1), in volgorde. */
async function readBookmarks(bytes: Uint8Array) {
  const doc = await PDFDocument.load(bytes);
  const outlines = doc.catalog.lookupMaybe(PDFName.of('Outlines'), PDFDict);
  const pageRefs = doc.getPages().map((page) => page.ref);
  const result: { title: string; page: number }[] = [];
  let item = outlines?.lookupMaybe(PDFName.of('First'), PDFDict);
  while (item) {
    const title = item.lookup(PDFName.of('Title')) as PDFString | PDFHexString;
    const dest = item.lookup(PDFName.of('Dest'), PDFArray).get(0) as PDFRef;
    result.push({ title: title.decodeText(), page: pageRefs.indexOf(dest) + 1 });
    item = item.lookupMaybe(PDFName.of('Next'), PDFDict);
  }
  const pageMode = doc.catalog.lookupMaybe(PDFName.of('PageMode'), PDFName)?.asString();
  return { bookmarks: result, pageMode };
}

/** Een PDF met één bestaande bladwijzer naar pagina 1. */
async function withOldBookmark(bytes: Uint8Array) {
  const doc = await PDFDocument.load(bytes);
  const { context } = doc;
  const outlines = context.nextRef();
  const item = context.register(
    context.obj({
      Title: PDFString.of('Oud'),
      Parent: outlines,
      Dest: [doc.getPage(0).ref, 'Fit'],
    }),
  );
  context.assign(outlines, context.obj({ Type: 'Outlines', First: item, Last: item, Count: 1 }));
  doc.catalog.set(PDFName.of('Outlines'), outlines);
  return doc.save();
}

const keys = (...values: number[]) => new Set(values);

/** Opslaan met één bestand (bestandsnummer 0). */
const build = (bytes: Uint8Array, pages: Parameters<typeof buildPdf>[1]) =>
  buildPdf(new Map([[0, bytes]]), pages);

describe('buildPdf', () => {
  it('geeft zonder wijzigingen dezelfde pagina’s terug', async () => {
    const result = await describePdf(await build(await samplePdf(3), initialPages(3)));
    expect(result.widths).toEqual([300, 400, 500]);
    expect(result.rotations).toEqual([0, 0, 0]);
  });

  it('verwijdert en draait volgens het plan', async () => {
    let pages = initialPages(4);
    pages = removePages(pages, keys(1));
    pages = rotatePages(pages, keys(3), 90);
    pages = rotatePages(pages, keys(0), -90);

    const result = await describePdf(await build(await samplePdf(4), pages));
    expect(result.widths).toEqual([300, 500, 600]);
    expect(result.rotations).toEqual([270, 0, 90]);
  });

  it('telt de draaiing op bij de draaiing die de pagina al had', async () => {
    const pages = rotatePages(initialPages(2), keys(0, 1), 90);
    const result = await describePdf(await build(await samplePdf(2, { 0: 90, 1: 270 }), pages));
    expect(result.rotations).toEqual([180, 0]);
  });

  it('volgt de volgorde van het plan', async () => {
    const reversed = initialPages(3).reverse();
    const result = await describePdf(await build(await samplePdf(3), reversed));
    expect(result.widths).toEqual([500, 400, 300]);
  });

  it('behoudt de titel en de auteur van het origineel', async () => {
    const result = await describePdf(
      await build(await samplePdf(2), removePages(initialPages(2), keys(0))),
    );
    expect(result.title).toBe('Origineel');
    expect(result.author).toBe('Testschrijver');
  });

  it('laat het origineel in het geheugen onaangeroerd', async () => {
    const original = await samplePdf(3);
    const copy = original.slice();
    await build(original, removePages(initialPages(3), keys(0)));
    expect(original).toEqual(copy);
  });

  it('meldt een beveiligde PDF', async () => {
    const doc = await PDFDocument.create();
    doc.addPage();
    doc.context.trailerInfo.Encrypt = doc.context.register(
      doc.context.obj({ Filter: 'Standard', V: 1, R: 2 }),
    );
    const encrypted = await doc.save();
    await expect(build(encrypted, initialPages(1))).rejects.toMatchObject({ code: 'encrypted' });
  });

  it('meldt een fout bij onzin of een onmogelijk plan', async () => {
    await expect(
      build(new TextEncoder().encode('%PDF-1.7 onzin'), initialPages(1)),
    ).rejects.toBeInstanceOf(PdfSaveError);
    await expect(build(await samplePdf(1), [])).rejects.toMatchObject({ code: 'failed' });
    await expect(
      build(await samplePdf(1), [{ key: 0, doc: 0, source: 5, rotation: 0 }]),
    ).rejects.toMatchObject({ code: 'failed' });
  });
});

describe('buildPdf met meerdere bestanden (samenvoegen)', () => {
  /** Bestand A: breedtes 300, 400; bestand B: 1000, 1100, 1200 (en een andere titel). */
  async function twoSources() {
    return new Map([
      [1, await samplePdf(2, {}, { title: 'Bestand A' })],
      [2, await samplePdf(3, { 1: 90 }, { title: 'Bestand B', firstWidth: 1000 })],
    ]);
  }
  const plan = () => [...initialPages(2, 1, 0), ...initialPages(3, 2, 2)];

  it('zet alle pagina’s van beide bestanden achter elkaar', async () => {
    const result = await describePdf(await buildPdf(await twoSources(), plan()));
    expect(result.widths).toEqual([300, 400, 1000, 1100, 1200]);
    expect(result.rotations).toEqual([0, 0, 0, 90, 0]);
  });

  it('volgt het plan: pagina’s door elkaar, weggelaten en gedraaid', async () => {
    let pages = plan();
    pages = movePages(pages, keys(3), 1); // B2 tussen A1 en A2
    pages = removePages(pages, keys(4)); // B3 eruit
    pages = rotatePages(pages, keys(0, 3), 90); // A1 en B2 draaien
    const result = await describePdf(await buildPdf(await twoSources(), pages));
    expect(result.widths).toEqual([300, 1100, 400, 1000]);
    expect(result.rotations).toEqual([90, 180, 0, 0]);
  });

  it('neemt titel en auteur over van het bestand van de eerste pagina', async () => {
    const reversed = [...initialPages(3, 2, 2), ...initialPages(2, 1, 0)];
    const result = await describePdf(await buildPdf(await twoSources(), reversed));
    expect(result.title).toBe('Bestand B');
    expect(result.author).toBe('Testschrijver');
  });

  it('gebruikt alleen de bestanden die in het plan staan', async () => {
    const sources = await twoSources();
    const onlyB = initialPages(3, 2, 2);
    const result = await describePdf(await buildPdf(sources, onlyB));
    expect(result.widths).toEqual([1000, 1100, 1200]);
    expect(result.title).toBe('Bestand B');
  });

  it('meldt een fout als een bestand ontbreekt of beveiligd is', async () => {
    const sources = await twoSources();
    sources.delete(2);
    await expect(buildPdf(sources, plan())).rejects.toMatchObject({ code: 'failed' });

    const locked = await PDFDocument.create();
    locked.addPage();
    locked.context.trailerInfo.Encrypt = locked.context.register(
      locked.context.obj({ Filter: 'Standard', V: 1, R: 2 }),
    );
    const withLocked = await twoSources();
    withLocked.set(2, await locked.save());
    await expect(buildPdf(withLocked, plan())).rejects.toMatchObject({ code: 'encrypted' });
  });
});

describe('buildPdf met nieuwe bladwijzers', () => {
  async function sources() {
    return new Map([
      [1, await withOldBookmark(await samplePdf(2, {}, { title: 'Bestand A' }))],
      [2, await samplePdf(3, {}, { title: 'Bestand B', firstWidth: 1000 })],
    ]);
  }
  const plan = () => [...initialPages(2, 1, 0), ...initialPages(3, 2, 2)];
  const marks = [
    { doc: 1, title: 'Offerte' },
    { doc: 2, title: 'Bijlage – €, ü en 中文' },
  ];

  it('zet per bestand een bladwijzer naar zijn eerste pagina, en toont ze bij openen', async () => {
    const result = await readBookmarks(
      await buildPdf(await sources(), plan(), { bookmarks: marks }),
    );
    expect(result.bookmarks).toEqual([
      { title: 'Offerte', page: 1 },
      { title: 'Bijlage – €, ü en 中文', page: 3 },
    ]);
    expect(result.pageMode).toBe('/UseOutlines');
  });

  it('volgt de volgorde van het resultaat en slaat weggelaten bestanden over', async () => {
    const reversed = [...initialPages(3, 2, 2), ...initialPages(2, 1, 0)];
    const result = await readBookmarks(
      await buildPdf(await sources(), reversed, { bookmarks: marks }),
    );
    expect(result.bookmarks).toEqual([
      { title: 'Bijlage – €, ü en 中文', page: 1 },
      { title: 'Offerte', page: 4 },
    ]);
    const onlyB = initialPages(3, 2, 2);
    const single = await readBookmarks(
      await buildPdf(await sources(), onlyB, { bookmarks: marks }),
    );
    expect(single.bookmarks).toEqual([{ title: 'Bijlage – €, ü en 中文', page: 1 }]);
  });

  it('wijst bij door elkaar staande pagina’s naar de eerste pagina van elk bestand', async () => {
    const mixed = movePages(plan(), keys(2), 1); // B1 tussen A1 en A2
    const result = await readBookmarks(
      await buildPdf(await sources(), mixed, { bookmarks: marks }),
    );
    expect(result.bookmarks).toEqual([
      { title: 'Offerte', page: 1 },
      { title: 'Bijlage – €, ü en 中文', page: 2 },
    ]);
  });

  it('vervangt bestaande bladwijzers, ook bij één bestand', async () => {
    const one = new Map([[1, await withOldBookmark(await samplePdf(2))]]);
    const kept = await readBookmarks(await buildPdf(one, initialPages(2, 1)));
    expect(kept.bookmarks).toEqual([{ title: 'Oud', page: 1 }]);
    const replaced = await readBookmarks(
      await buildPdf(one, initialPages(2, 1), { bookmarks: [{ doc: 1, title: 'Nieuw' }] }),
    );
    expect(replaced.bookmarks).toEqual([{ title: 'Nieuw', page: 1 }]);
  });

  it('zonder de optie: geen bladwijzers bij samenvoegen', async () => {
    const result = await readBookmarks(await buildPdf(await sources(), plan()));
    expect(result.bookmarks).toEqual([]);
  });
});

describe('editedFileName', () => {
  it('zet het achtervoegsel vóór .pdf', () => {
    expect(editedFileName('rapport.pdf', 'bewerkt')).toBe('rapport (bewerkt).pdf');
    expect(editedFileName('Rapport.PDF', 'edited')).toBe('Rapport (edited).pdf');
    expect(editedFileName('scan zonder extensie', 'bewerkt')).toBe(
      'scan zonder extensie (bewerkt).pdf',
    );
  });
});
