import * as lib from 'pdf-lib';
import { PDFArray, PDFDict, PDFDocument, PDFName, PDFNull, PDFString } from 'pdf-lib';
import { describe, expect, it } from 'vitest';
import type { BoxAnnotation } from '../annotations/model';
import { initialPages, type PageItem } from '../pages/plan';
import { strayObjects } from './links';
import { PdfSaveError, buildParts, buildPdf } from './save';
import { SECRET, annotate, annotationsOn, leaks, link, makeSource, pageIndexOf } from './testLinks';

/** Weggehaalde pagina's zijn echt weg, ook als er nog iets naar wees (koppelingen, bladwijzers, velden). */

const [p1, p2, p3] = initialPages(3);
/** Het plan zonder pagina 2 (die met het geheim). */
const withoutSecret = [p1!, p3!];

async function save(source: Uint8Array, pages: readonly PageItem[]) {
  const bytes = await buildPdf(new Map([[0, source]]), pages);
  const doc = await PDFDocument.load(bytes, { updateMetadata: false });
  return { bytes, doc };
}

/** De bladwijzers bovenaan, als woordenboeken. */
function outlineItems(doc: PDFDocument): PDFDict[] {
  const root = doc.catalog.lookupMaybe(PDFName.of('Outlines'), PDFDict);
  const items: PDFDict[] = [];
  for (let item = root?.lookupMaybe(PDFName.of('First'), PDFDict); item;) {
    items.push(item);
    item = item.lookupMaybe(PDFName.of('Next'), PDFDict);
  }
  return items;
}

describe('één bestand: weggehaalde pagina’s zijn echt weg', () => {
  it('controle: zonder verwijzingen is pagina 2 weg', async () => {
    const { bytes, doc } = await save(await makeSource(() => {}), withoutSecret);
    expect(await leaks(bytes)).toBe(false);
    expect(strayObjects(lib, doc)).toBe(0);
  });

  it('een koppeling naar de weggehaalde pagina valt weg, en houdt die pagina niet vast', async () => {
    const source = await makeSource((doc, [a, b, c]) => annotate(doc, a!, link(b!), link(c!)));
    const { bytes, doc } = await save(source, withoutSecret);
    expect(await leaks(bytes)).toBe(false);
    expect(strayObjects(lib, doc)).toBe(0);
    // Alleen de koppeling naar pagina 3 blijft, en die wijst naar de nieuwe plek (2).
    const { items } = await annotationsOn(bytes, 0);
    expect(items).toHaveLength(1);
    expect(pageIndexOf(doc, items[0]!.lookup(PDFName.of('Dest'), PDFArray).get(0))).toBe(1);
  });

  it('een koppeling volgt zijn pagina als die verplaatst is', async () => {
    const source = await makeSource((doc, [a, , c]) => annotate(doc, a!, link(c!)));
    const { bytes, doc } = await save(source, [p3!, p1!]);
    const { items } = await annotationsOn(bytes, 1);
    expect(pageIndexOf(doc, items[0]!.lookup(PDFName.of('Dest'), PDFArray).get(0))).toBe(0);
    expect(strayObjects(lib, doc)).toBe(0);
  });

  it('een behouden bladwijzer naar de weggehaalde pagina houdt die pagina niet vast', async () => {
    const source = await makeSource((doc, [a, b]) => {
      const { context } = doc;
      const root = context.nextRef();
      const second = context.nextRef();
      const first = context.register(
        context.obj({
          Title: PDFString.of('Inhoud'),
          Parent: root,
          Next: second,
          Dest: [a!.ref, 'Fit'],
        }),
      );
      context.assign(
        second,
        context.obj({
          Title: PDFString.of('Geheim'),
          Parent: root,
          Prev: first,
          Dest: [b!.ref, 'Fit'],
        }),
      );
      context.assign(root, context.obj({ Type: 'Outlines', First: first, Last: second, Count: 2 }));
      doc.catalog.set(PDFName.of('Outlines'), root);
    });
    const { bytes, doc } = await save(source, withoutSecret);
    expect(await leaks(bytes)).toBe(false);
    expect(strayObjects(lib, doc)).toBe(0);
    // De bladwijzers blijven, zoals ze waren; die naar de weggehaalde pagina wijst nergens heen.
    const [first, second] = outlineItems(doc);
    expect(pageIndexOf(doc, first!.lookup(PDFName.of('Dest'), PDFArray).get(0))).toBe(0);
    expect(second!.lookup(PDFName.of('Dest'), PDFArray).get(0)).toBe(PDFNull);
  });

  it('een benoemde bestemming en de startactie houden de pagina niet vast', async () => {
    const source = await makeSource((doc, [a, b]) => {
      const dests = doc.context.obj({ Names: [PDFString.of('geheim'), [b!.ref, 'Fit']] });
      doc.catalog.set(PDFName.of('Names'), doc.context.obj({ Dests: dests }));
      doc.catalog.set(PDFName.of('OpenAction'), doc.context.obj([b!.ref, 'Fit']));
      annotate(doc, a!, { Subtype: 'Link', Dest: PDFString.of('geheim') });
    });
    const { bytes, doc } = await save(source, withoutSecret);
    expect(await leaks(bytes)).toBe(false);
    expect(strayObjects(lib, doc)).toBe(0);
  });

  it('formuliervelden van de weggehaalde pagina gaan uit het formulier, de rest blijft', async () => {
    const source = await makeSource((doc, [a, b]) => {
      const { context } = doc;
      // Een veld alleen op pagina 1, een veld alleen op pagina 2 (met het geheim als waarde),
      // en een veld met een vak op beide pagina's.
      const [own] = annotate(doc, a!, {
        Subtype: 'Widget',
        FT: 'Tx',
        T: PDFString.of('openbaar'),
        V: PDFString.of('Openbaar'),
        P: a!.ref,
      });
      const shared = context.nextRef();
      const [secret, sharedOnB] = annotate(
        doc,
        b!,
        {
          Subtype: 'Widget',
          FT: 'Tx',
          T: PDFString.of('geheim'),
          V: PDFString.of(SECRET),
          P: b!.ref,
        },
        { Subtype: 'Widget', Parent: shared, P: b!.ref, TU: PDFString.of(SECRET) },
      );
      const sharedOnA = context.register(
        context.obj({
          Type: 'Annot',
          Subtype: 'Widget',
          Rect: [0, 0, 10, 10],
          Parent: shared,
          P: a!.ref,
        }),
      );
      a!.node.lookup(PDFName.of('Annots'), PDFArray).push(sharedOnA);
      context.assign(
        shared,
        context.obj({ FT: 'Tx', T: PDFString.of('gedeeld'), Kids: [sharedOnA, sharedOnB] }),
      );
      doc.catalog.set(
        PDFName.of('AcroForm'),
        context.obj({ Fields: [own, secret, shared], CO: [secret] }),
      );
    });
    const { bytes, doc } = await save(source, withoutSecret);
    expect(await leaks(bytes)).toBe(false);
    expect(strayObjects(lib, doc)).toBe(0);
    expect(
      doc
        .getForm()
        .getFields()
        .map((field) => field.getName()),
    ).toEqual(['openbaar', 'gedeeld']);
    const shared = doc.getForm().getField('gedeeld');
    expect(shared.acroField.getWidgets()).toHaveLength(1);
  });

  it('een antwoord op een opmerking op de weggehaalde pagina blijft, zonder die opmerking', async () => {
    const source = await makeSource((doc, [a, b]) => {
      const [comment] = annotate(doc, b!, {
        Subtype: 'Text',
        Contents: PDFString.of(SECRET),
        P: b!.ref,
      });
      annotate(doc, a!, {
        Subtype: 'Text',
        Contents: PDFString.of('Eens'),
        IRT: comment,
        P: a!.ref,
      });
    });
    const { bytes, doc } = await save(source, withoutSecret);
    expect(await leaks(bytes)).toBe(false);
    expect(strayObjects(lib, doc)).toBe(0);
    const { items } = await annotationsOn(bytes, 0);
    expect(items).toHaveLength(1);
    expect(items[0]!.has(PDFName.of('IRT'))).toBe(false);
  });
});

describe('meer bestanden en splitsen: geen verstopte pagina’s', () => {
  /** Een tweede bestand van één pagina, met een koppeling naar zichzelf. */
  const other = () => makeSource((doc, [a]) => annotate(doc, a!, link(a!)), ['Ander bestand']);
  const b1: PageItem = { key: 10, doc: 1, source: 0, rotation: 0 };

  it('samenvoegen: een koppeling naar een pagina die niet meedoet, haalt die niet mee', async () => {
    const a = await makeSource((doc, [x, y, z]) => annotate(doc, x!, link(y!), link(z!)));
    const pages = [b1, p3!, p1!];
    const bytes = await buildPdf(
      new Map([
        [0, a],
        [1, await other()],
      ]),
      pages,
    );
    const doc = await PDFDocument.load(bytes, { updateMetadata: false });
    expect(await leaks(bytes)).toBe(false);
    expect(strayObjects(lib, doc)).toBe(0);
    // Pagina 1 van A staat nu op plek 3; zijn koppeling naar pagina 3 van A wijst naar plek 2.
    const { items } = await annotationsOn(bytes, 2);
    expect(items).toHaveLength(1);
    expect(pageIndexOf(doc, items[0]!.lookup(PDFName.of('Dest'), PDFArray).get(0))).toBe(1);
    // De koppeling van het andere bestand naar zichzelf blijft kloppen.
    const own = await annotationsOn(bytes, 0);
    expect(pageIndexOf(doc, own.items[0]!.lookup(PDFName.of('Dest'), PDFArray).get(0))).toBe(0);
  });

  it('splitsen: een deel haalt via een koppeling geen pagina uit een ander deel mee', async () => {
    const a = await makeSource((doc, [x, y]) => annotate(doc, x!, link(y!)));
    const [first, second] = await buildParts(new Map([[0, a]]), [[p1!], [p2!, p3!]]);
    expect(await leaks(first!)).toBe(false);
    const doc = await PDFDocument.load(first!, { updateMetadata: false });
    expect(strayObjects(lib, doc)).toBe(0);
    expect(await leaks(second!)).toBe(true);
  });

  it('splitsen: een mislukte redactie geeft de melding van redactie, niet een algemene', async () => {
    const a = await makeSource(() => {});
    const box: BoxAnnotation = {
      id: 1,
      page: p2!.key,
      kind: 'redact',
      x: 40,
      y: 60,
      width: 200,
      height: 40,
      color: '#000000',
      strokeWidth: 0,
    };
    // Zonder browser kan er niet getekend worden: de redactie mislukt.
    await expect(buildParts(new Map([[0, a]]), [[p1!], [p2!]], undefined, [box])).rejects.toEqual(
      new PdfSaveError('redaction'),
    );
  });
});
