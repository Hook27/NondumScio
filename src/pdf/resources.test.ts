import * as lib from 'pdf-lib';
import { describe, expect, it } from 'vitest';
import { initialPages } from '../pages/plan';
import { trimSharedResources } from './resources';
import { buildParts, buildPdf } from './save';
import { imagesIn, makeSharedResourcesPdf } from './testShared';

const { PDFDocument, PDFDict, PDFName } = lib;

/** Splitst een bestand in delen van `size` pagina's. */
async function split(bytes: Uint8Array, count: number, size: number) {
  const plan = initialPages(count, 1);
  const parts: (typeof plan)[] = [];
  for (let i = 0; i < count; i += size) parts.push(plan.slice(i, i + size));
  return buildParts(new Map([[1, bytes]]), parts);
}

/** Per pagina: de namen van de afbeeldingen en lettertypen in zijn hulpbronnen. */
async function resourceNames(bytes: Uint8Array) {
  const doc = await PDFDocument.load(bytes);
  return doc.getPages().map((page) => {
    const resources = page.node.Resources()!;
    const names = (kind: string) => {
      const list = resources.lookup(PDFName.of(kind));
      return list instanceof PDFDict ? list.keys().map((key) => key.decodeText()) : [];
    };
    return { xobjects: names('XObject').sort(), fonts: names('Font') };
  });
}

describe('gedeelde hulpbronnen (zoals bij veel scans)', () => {
  it('Splitsen: elk deel krijgt alleen zijn eigen afbeeldingen, het logo maar één keer', async () => {
    const parts = await split(await makeSharedResourcesPdf(10), 10, 5);
    expect(await imagesIn(parts[0]!)).toEqual([0, 1, 2, 3, 4, 5]);
    expect(await imagesIn(parts[1]!)).toEqual([0, 6, 7, 8, 9, 10]);
  });

  it('elke pagina houdt wat ze aanroept: haar afbeelding, het logo en het lettertype', async () => {
    const [part] = await split(await makeSharedResourcesPdf(4), 4, 2);
    expect(await resourceNames(part!)).toEqual([
      { xobjects: ['Im1', 'Logo'], fonts: ['F1'] },
      { xobjects: ['Im2', 'Logo'], fonts: ['F1'] },
    ]);
  });

  it('ook bij een selectie (Pagina’s, Samenvoegen) gaan alleen de gebruikte afbeeldingen mee', async () => {
    const bytes = await makeSharedResourcesPdf(6);
    const plan = initialPages(6, 1);
    const result = await buildPdf(new Map([[1, bytes]]), [plan[1]!, plan[4]!]);
    expect(await imagesIn(result)).toEqual([0, 2, 5]);
  });

  it.each([
    ['onleesbare inhoud', 'unreadable'],
    ['een formulier-XObject zonder eigen hulpbronnen', 'formWithoutResources'],
    ['een aantekening zonder eigen hulpbronnen', 'appearanceWithoutResources'],
  ])('bij twijfel (%s) blijft een pagina zoals ze is', async (_, option) => {
    const [first, second] = await split(await makeSharedResourcesPdf(4, { [option]: true }), 4, 2);
    // Pagina 1 neemt alles mee (alle afbeeldingen); het tweede deel is gewoon uitgedund.
    expect(await imagesIn(first!)).toEqual([0, 1, 2, 3, 4]);
    expect(await imagesIn(second!)).toEqual([0, 3, 4]);
  });

  it('laat pagina’s met eigen hulpbronnen ongemoeid', async () => {
    const doc = await PDFDocument.create();
    for (let i = 0; i < 3; i += 1) doc.addPage([300, 300]).drawText(`pagina ${i + 1}`);
    const before = doc.getPages().map((page) => page.node.get(PDFName.of('Resources')));
    trimSharedResources(lib, doc, [0, 1, 2]);
    expect(doc.getPages().map((page) => page.node.get(PDFName.of('Resources')))).toEqual(before);
  });

  it('is te herhalen: een tweede keer verandert niets meer', async () => {
    const doc = await PDFDocument.load(await makeSharedResourcesPdf(3));
    trimSharedResources(lib, doc, [0, 1, 2]);
    const once = doc.getPages().map((page) => page.node.get(PDFName.of('Resources')));
    trimSharedResources(lib, doc, [0, 1, 2]);
    expect(doc.getPages().map((page) => page.node.get(PDFName.of('Resources')))).toEqual(once);
  });
});
