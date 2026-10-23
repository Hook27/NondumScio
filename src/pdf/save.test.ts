import { PDFDocument, degrees } from 'pdf-lib';
import { describe, expect, it } from 'vitest';
import { initialPages, removePages, rotatePages } from '../pages/plan';
import { PdfSaveError, buildPdf, editedFileName } from './save';

/** Test-PDF waarin elke pagina een eigen breedte heeft, zodat je hem terugkent: 300, 400, 500, … */
async function samplePdf(count: number, rotate: Record<number, number> = {}) {
  const doc = await PDFDocument.create();
  doc.setTitle('Origineel');
  doc.setAuthor('Testschrijver');
  for (let i = 0; i < count; i += 1) {
    const page = doc.addPage([300 + 100 * i, 800]);
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

const keys = (...values: number[]) => new Set(values);

describe('buildPdf', () => {
  it('geeft zonder wijzigingen dezelfde pagina’s terug', async () => {
    const result = await describePdf(await buildPdf(await samplePdf(3), initialPages(3)));
    expect(result.widths).toEqual([300, 400, 500]);
    expect(result.rotations).toEqual([0, 0, 0]);
  });

  it('verwijdert en draait volgens het plan', async () => {
    let pages = initialPages(4);
    pages = removePages(pages, keys(1));
    pages = rotatePages(pages, keys(3), 90);
    pages = rotatePages(pages, keys(0), -90);

    const result = await describePdf(await buildPdf(await samplePdf(4), pages));
    expect(result.widths).toEqual([300, 500, 600]);
    expect(result.rotations).toEqual([270, 0, 90]);
  });

  it('telt de draaiing op bij de draaiing die de pagina al had', async () => {
    const pages = rotatePages(initialPages(2), keys(0, 1), 90);
    const result = await describePdf(await buildPdf(await samplePdf(2, { 0: 90, 1: 270 }), pages));
    expect(result.rotations).toEqual([180, 0]);
  });

  it('volgt de volgorde van het plan', async () => {
    const reversed = initialPages(3).reverse();
    const result = await describePdf(await buildPdf(await samplePdf(3), reversed));
    expect(result.widths).toEqual([500, 400, 300]);
  });

  it('behoudt de titel en de auteur van het origineel', async () => {
    const result = await describePdf(
      await buildPdf(await samplePdf(2), removePages(initialPages(2), keys(0))),
    );
    expect(result.title).toBe('Origineel');
    expect(result.author).toBe('Testschrijver');
  });

  it('laat het origineel in het geheugen onaangeroerd', async () => {
    const original = await samplePdf(3);
    const copy = original.slice();
    await buildPdf(original, removePages(initialPages(3), keys(0)));
    expect(original).toEqual(copy);
  });

  it('meldt een beveiligde PDF', async () => {
    const doc = await PDFDocument.create();
    doc.addPage();
    doc.context.trailerInfo.Encrypt = doc.context.register(
      doc.context.obj({ Filter: 'Standard', V: 1, R: 2 }),
    );
    const encrypted = await doc.save();
    await expect(buildPdf(encrypted, initialPages(1))).rejects.toMatchObject({ code: 'encrypted' });
  });

  it('meldt een fout bij onzin of een onmogelijk plan', async () => {
    await expect(
      buildPdf(new TextEncoder().encode('%PDF-1.7 onzin'), initialPages(1)),
    ).rejects.toBeInstanceOf(PdfSaveError);
    await expect(buildPdf(await samplePdf(1), [])).rejects.toMatchObject({ code: 'failed' });
    await expect(
      buildPdf(await samplePdf(1), [{ key: 0, source: 5, rotation: 0 }]),
    ).rejects.toMatchObject({ code: 'failed' });
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
