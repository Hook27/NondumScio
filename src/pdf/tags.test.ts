import * as lib from 'pdf-lib';
import { PDFArray, PDFDict, PDFDocument, PDFName, PDFNumber, PDFString } from 'pdf-lib';
import { describe, expect, it } from 'vitest';
import { initialPages, type PageItem } from '../pages/plan';
import { strayObjects } from './links';
import { buildParts, buildPdf } from './save';
import {
  SECRET,
  annotate,
  annotationsOn,
  leaks,
  link,
  makeSource,
  makeStructureSource,
  pageIndexOf,
} from './testLinks';

/**
 * Een getagde PDF (met een structuur voor schermlezers): per pagina een element, met alternatieve
 * tekst. Pagina 2 heeft een figuur met het geheim in de alternatieve tekst, en een koppeling die
 * via een eigen element (OBJR) in de structuur staat.
 */
const tagged = () =>
  makeSource((doc, [a, b, c]) => {
    const { context } = doc;
    const [linkRef] = annotate(doc, b!, { ...link(c!), StructParent: 3 });
    const element = (fields: Record<string, unknown>) =>
      context.register(context.obj({ Type: 'StructElem', ...fields } as never));
    const p1 = element({ S: 'P', Pg: a!.ref, ActualText: PDFString.of('Inhoud'), K: 0 });
    const figure = element({ S: 'Figure', Pg: b!.ref, Alt: PDFString.of(`Foto ${SECRET}`), K: 0 });
    const linkElement = element({
      S: 'Link',
      Alt: PDFString.of(`Koppeling ${SECRET}`),
      K: context.obj({ Type: 'OBJR', Obj: linkRef, Pg: b!.ref }),
    });
    const p3 = element({ S: 'P', Pg: c!.ref, Alt: PDFString.of('Bijlage'), K: 0 });
    const document = element({ S: 'Document', K: [p1, figure, linkElement, p3] });
    const root = context.register(
      context.obj({
        Type: 'StructTreeRoot',
        K: document,
        ParentTree: context.obj({ Nums: [0, [p1], 1, [figure], 2, [p3], 3, linkElement] }),
        ParentTreeNextKey: 4,
      }),
    );
    for (const ref of [p1, figure, linkElement, p3]) {
      context.lookup(ref, PDFDict).set(PDFName.of('P'), document);
    }
    context.lookup(document, PDFDict).set(PDFName.of('P'), root);
    a!.node.set(PDFName.of('StructParents'), PDFNumber.of(0));
    b!.node.set(PDFName.of('StructParents'), PDFNumber.of(1));
    c!.node.set(PDFName.of('StructParents'), PDFNumber.of(2));
    doc.catalog.set(PDFName.of('StructTreeRoot'), root);
    doc.catalog.set(PDFName.of('MarkInfo'), context.obj({ Marked: true }));
  });

/** De elementen direct onder het Document-element, met hun soort en waar ze heen wijzen. */
function elements(doc: PDFDocument) {
  const root = doc.catalog.lookup(PDFName.of('StructTreeRoot'), PDFDict);
  const document = root.lookup(PDFName.of('K'), PDFDict);
  const kids = document.lookup(PDFName.of('K'), PDFArray);
  return kids.asArray().map((ref) => {
    const element = doc.context.lookup(ref, PDFDict);
    return {
      type: element.get(PDFName.of('S'))!.toString(),
      page: pageIndexOf(doc, element.get(PDFName.of('Pg'))),
    };
  });
}

/** De sleutels in de ParentTree. */
function parentKeys(doc: PDFDocument) {
  const root = doc.catalog.lookup(PDFName.of('StructTreeRoot'), PDFDict);
  const nums = root.lookup(PDFName.of('ParentTree'), PDFDict).lookup(PDFName.of('Nums'), PDFArray);
  return nums
    .asArray()
    .filter((_, i) => i % 2 === 0)
    .map((key) => Number(key.toString()));
}

describe('tags (structuur voor schermlezers) van weggehaalde pagina’s', () => {
  const [p1, p2, p3] = initialPages(3);

  it('de alternatieve tekst van een weggehaalde pagina staat niet meer in het bestand', async () => {
    const bytes = await buildPdf(new Map([[0, await tagged()]]), [p1!, p3!]);
    expect(await leaks(bytes)).toBe(false);
    const doc = await PDFDocument.load(bytes, { updateMetadata: false });
    expect(strayObjects(lib, doc)).toBe(0);
    // De elementen van de blijvende pagina's blijven, en wijzen naar hun nieuwe plek.
    expect(elements(doc)).toEqual([
      { type: '/P', page: 0 },
      { type: '/P', page: 1 },
    ]);
    expect(parentKeys(doc)).toEqual([0, 2]);
  });

  it('blijven alle pagina’s, dan blijft de hele structuur', async () => {
    const bytes = await buildPdf(new Map([[0, await tagged()]]), [p1!, p2!, p3!]);
    const doc = await PDFDocument.load(bytes, { updateMetadata: false });
    expect(elements(doc).map((element) => element.type)).toEqual(['/P', '/Figure', '/Link', '/P']);
    expect(parentKeys(doc)).toEqual([0, 1, 2, 3]);
  });
});

describe('structuurbestemming en structuurelement (PDF 2.0) naar een weggehaalde pagina', () => {
  const [p1, , p3] = initialPages(3);
  const other: PageItem = { key: 10, doc: 1, source: 0, rotation: 0 };

  /** De actie van de koppeling op pagina 1 van het resultaat. */
  async function linkAction(bytes: Uint8Array) {
    const { items } = await annotationsOn(bytes, 0);
    expect(items).toHaveLength(1);
    return items[0]!.lookup(PDFName.of('A'), PDFDict);
  }

  it('controle: zonder structuurbestemming staat het geheim nergens', async () => {
    const source = await makeStructureSource();
    const [part] = await buildParts(new Map([[0, source]]), [[p1!], [p3!]]);
    expect(await leaks(part!)).toBe(false);
    expect(await leaks(await buildPdf(new Map([[0, source]]), [p1!, p3!]))).toBe(false);
  });

  it('één bestand, splitsen en samenvoegen: de koppeling blijft, zonder structuurbestemming', async () => {
    const source = await makeStructureSource({ sd: true });
    const [part] = await buildParts(new Map([[0, source]]), [[p1!], [p3!]]);
    const single = await buildPdf(new Map([[0, source]]), [p1!, p3!]);
    const merged = await buildPdf(
      new Map([
        [0, source],
        [1, await makeSource(() => {}, ['Ander bestand'])],
      ]),
      [p1!, other],
    );
    for (const bytes of [part!, single, merged]) {
      expect(await leaks(bytes)).toBe(false);
      const doc = await PDFDocument.load(bytes, { updateMetadata: false });
      expect(strayObjects(lib, doc)).toBe(0);
      // De gewone bestemming blijft: de koppeling werkt nog en wijst naar pagina 1.
      const action = await linkAction(bytes);
      expect(action.has(PDFName.of('SD'))).toBe(false);
      expect(pageIndexOf(doc, action.lookup(PDFName.of('D'), PDFArray).get(0))).toBe(0);
    }
  });

  it('één bestand: een behouden bladwijzer houdt via een structuurelement geen tekst vast', async () => {
    const bytes = await buildPdf(new Map([[0, await makeStructureSource({ se: true })]]), [
      p1!,
      p3!,
    ]);
    expect(await leaks(bytes)).toBe(false);
    const doc = await PDFDocument.load(bytes, { updateMetadata: false });
    const outlines = doc.catalog.lookup(PDFName.of('Outlines'), PDFDict);
    const item = outlines.lookup(PDFName.of('First'), PDFDict);
    expect(item.has(PDFName.of('SE'))).toBe(false);
    expect(pageIndexOf(doc, item.lookup(PDFName.of('Dest'), PDFArray).get(0))).toBe(0);
  });

  it('één bestand: de startactie houdt via een structuurbestemming geen tekst vast', async () => {
    const bytes = await buildPdf(new Map([[0, await makeStructureSource({ open: true })]]), [
      p1!,
      p3!,
    ]);
    expect(await leaks(bytes)).toBe(false);
    const doc = await PDFDocument.load(bytes, { updateMetadata: false });
    const action = doc.catalog.lookup(PDFName.of('OpenAction'), PDFDict);
    expect(action.has(PDFName.of('SD'))).toBe(false);
    expect(pageIndexOf(doc, action.lookup(PDFName.of('D'), PDFArray).get(0))).toBe(0);
  });
});
