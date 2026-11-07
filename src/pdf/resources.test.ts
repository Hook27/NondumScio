import * as lib from 'pdf-lib';
import { describe, expect, it } from 'vitest';
import { initialPages } from '../pages/plan';
import { contentNames, dropUnusedInheritedResources, trimPageResources } from './resources';
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
    ['een aantekening zonder eigen hulpbronnen', 'appearanceWithoutResources'],
  ])('bij twijfel (%s) blijft een pagina zoals ze is', async (_, option) => {
    const [first, second] = await split(await makeSharedResourcesPdf(4, { [option]: true }), 4, 2);
    // Pagina 1 neemt alles mee (alle afbeeldingen); het tweede deel is gewoon uitgedund.
    expect(await imagesIn(first!)).toEqual([0, 1, 2, 3, 4]);
    expect(await imagesIn(second!)).toEqual([0, 3, 4]);
  });

  it('leest een formulier-XObject zonder eigen hulpbronnen mee, in plaats van te twijfelen', async () => {
    const parts = await split(
      await makeSharedResourcesPdf(4, { formWithoutResources: true }),
      4,
      2,
    );
    // Het formulier tekent het logo: dat blijft, met het formulier zelf; scans 3 en 4 niet.
    expect(await imagesIn(parts[0]!)).toEqual([0, 1, 2]);
    expect((await resourceNames(parts[0]!))[0]).toEqual({
      xobjects: ['Fm1', 'Im1', 'Logo'],
      fonts: ['F1'],
    });
  });

  it('meldt per deel hoeveel pagina’s niet uitgedund konden worden', async () => {
    const plan = initialPages(4, 1);
    const untrimmed: number[] = [];
    await buildParts(
      new Map([[1, await makeSharedResourcesPdf(4, { unreadable: true })]]),
      [plan.slice(0, 2), plan.slice(2), plan.slice(0, 1)],
      undefined,
      [],
      undefined,
      (_, index, report) => (untrimmed[index] = report.untrimmed),
    );
    // Pagina 1 is niet te lezen: in elk deel waar hij in zit, telt hij mee.
    expect(untrimmed).toEqual([1, 0, 1]);
    const clean: number[] = [];
    await buildParts(
      new Map([[1, await makeSharedResourcesPdf(4)]]),
      [plan.slice(0, 2), plan.slice(2)],
      undefined,
      [],
      undefined,
      (_, index, report) => (clean[index] = report.untrimmed),
    );
    expect(clean).toEqual([0, 0]);
  });

  it('laat een pagina waarvan de inhoud niet te lezen is ongemoeid', async () => {
    // Een pagina die pdf-lib net zelf maakte (nog geen gecodeerde stream): niet te lezen, dus twijfel.
    const doc = await PDFDocument.create();
    for (let i = 0; i < 3; i += 1) doc.addPage([300, 300]).drawText(`pagina ${i + 1}`);
    const before = doc.getPages().map((page) => page.node.get(PDFName.of('Resources')));
    expect(trimPageResources(lib, doc, [0, 1, 2])).toEqual([0, 1, 2]);
    expect(doc.getPages().map((page) => page.node.get(PDFName.of('Resources')))).toEqual(before);
  });

  it('de lijst aan de paginaboom gaat alleen weg als geen pagina hem nog erft', async () => {
    const doc = await PDFDocument.load(await makeSharedResourcesPdf(3));
    const tree = doc.catalog.Pages();
    // Pagina 2 erft de lijst: dan moet hij blijven staan.
    doc.getPages()[1]!.node.delete(PDFName.of('Resources'));
    dropUnusedInheritedResources(lib, doc);
    expect(tree.has(PDFName.of('Resources'))).toBe(true);
    // Heeft elke pagina een eigen lijst, dan gaat hij weg.
    doc.getPages()[1]!.node.set(PDFName.of('Resources'), tree.get(PDFName.of('Resources'))!);
    dropUnusedInheritedResources(lib, doc);
    expect(tree.has(PDFName.of('Resources'))).toBe(false);
  });

  it('is te herhalen: een tweede keer verandert niets meer', async () => {
    const doc = await PDFDocument.load(await makeSharedResourcesPdf(3));
    trimPageResources(lib, doc, [0, 1, 2]);
    const once = doc.getPages().map((page) => page.node.get(PDFName.of('Resources')));
    trimPageResources(lib, doc, [0, 1, 2]);
    expect(doc.getPages().map((page) => page.node.get(PDFName.of('Resources')))).toEqual(once);
  });
});

/**
 * Een verzonnen PDF voor de gevallen van het origineel: afbeeldingen `Im1` … `Im<count>` (met hun
 * nummer als `/NondumScioImage`) en lettertype `F1` in één lijst die alle pagina's delen, en per
 * pagina een eigen inhoud. Met `build` komen er objecten bij (formulieren, patronen, maskers, …).
 */
async function custom(
  contents: string[],
  count: number,
  build?: (doc: lib.PDFDocument, shared: lib.PDFDict, image: (id: number) => lib.PDFRef) => void,
): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const { context } = doc;
  const image = (id: number) =>
    context.register(
      context.stream(new Uint8Array(4).fill(id), {
        Type: 'XObject',
        Subtype: 'Image',
        Width: 2,
        Height: 2,
        ColorSpace: 'DeviceGray',
        BitsPerComponent: 8,
        NondumScioImage: id,
      }),
    );
  const font = await doc.embedFont(lib.StandardFonts.Helvetica);
  const xobjects: Record<string, lib.PDFRef> = {};
  for (let n = 1; n <= count; n += 1) xobjects[`Im${n}`] = image(n);
  const shared = context.obj({ Font: { F1: font.ref }, XObject: xobjects });
  const sharedRef = context.register(shared);
  build?.(doc, shared, image);
  for (const content of contents) {
    const page = doc.addPage([200, 200]);
    page.node.set(PDFName.of('Contents'), context.register(context.flateStream(content)));
    page.node.set(PDFName.of('Resources'), sharedRef);
  }
  return doc.save();
}

/** Een formulier-XObject met inhoud `content`; met `resources` een eigen lijst. */
function form(doc: lib.PDFDocument, content: string, resources?: lib.PDFDict | lib.PDFRef) {
  return doc.context.register(
    doc.context.flateStream(content, {
      Type: 'XObject',
      Subtype: 'Form',
      BBox: [0, 0, 10, 10],
      ...(resources ? { Resources: resources } : {}),
    }),
  );
}

/** Splitst per pagina. */
async function perPage(bytes: Uint8Array, count: number) {
  return split(bytes, count, 1);
}

describe('uitdunnen zoals het origineel', () => {
  it('leest de inhoud nauwkeurig: tekst, commentaar en ingesloten beeldgegevens tellen niet', () => {
    const names = new Set<string>();
    // In tekst: \) en \( sluiten of openen niets. In de beeldgegevens staat "/Im6".
    const content =
      '(zie /Im9 \\) en \\( /Im8) % /Im7 in commentaar\n /Im1 Do ' +
      'BI /W 1 /H 1 /CS /G /BPC 8 ID \x2fIm6\xff EI /F1 12 Tf <2F496D35> Tj /Na#6De Do';
    contentNames(
      Uint8Array.from(content, (c) => c.charCodeAt(0)),
      names,
    );
    expect([...names].sort()).toEqual(['BPC', 'CS', 'F1', 'G', 'H', 'Im1', 'Name', 'W']);
  });

  it('kent geneste haakjes en escapes in tekst, en EI alleen met witruimte eromheen', () => {
    const names = new Set<string>();
    // In tekst: (b) is genest, \) sluit niets; de tekst loopt tot de laatste ).
    // In de beeldgegevens: "AEI " en " EIB" zijn nog niet het einde (EI moet witruimte ervóór én erna hebben).
    const content = '(a (b) /Im7 \\) /Im8 ) /Im1 Do BI /W 1 ID AEI /Im5 EIB/Im4 EI /Im2 Do';
    contentNames(
      Uint8Array.from(content, (c) => c.charCodeAt(0)),
      names,
    );
    expect([...names].sort()).toEqual(['Im1', 'Im2', 'W']);
  });

  it('neemt geen afbeelding mee die alleen in tekst of commentaar genoemd wordt', async () => {
    const [part] = await perPage(await custom(['/Im1 Do (zie /Im2) % /Im3\n', '/Im2 Do'], 3), 2);
    expect(await imagesIn(part!)).toEqual([1]);
  });

  it('leest inhoud in meer stukken, zonder dat een naam doorloopt in het volgende stuk', async () => {
    const bytes = await custom(['/Im2 Do'], 2);
    const doc = await PDFDocument.load(bytes);
    const page = doc.getPages()[0]!;
    page.node.set(
      PDFName.of('Contents'),
      doc.context.obj([
        doc.context.register(doc.context.flateStream('q 1 0 0 1 0 0 cm /Im1')),
        doc.context.register(doc.context.flateStream('Do Q')),
      ]),
    );
    const [part] = await perPage(await doc.save(), 1);
    expect(await imagesIn(part!)).toEqual([1]);
  });

  it('dunt een eigen, overvolle lijst uit (ook als die niet gedeeld is)', async () => {
    const bytes = await custom(['/Im1 Do', '/Im2 Do'], 3, () => {});
    // Elke pagina een eigen kopie van de volle lijst, niet dezelfde.
    const doc = await PDFDocument.load(bytes);
    for (const page of doc.getPages()) {
      const full = page.node.Resources()!;
      page.node.set(PDFName.of('Resources'), doc.context.register(full.clone(doc.context)));
    }
    const parts = await perPage(await doc.save(), 2);
    expect(await imagesIn(parts[0]!)).toEqual([1]);
    expect(await imagesIn(parts[1]!)).toEqual([2]);
  });

  it('dunt de eigen lijst van een formulier uit, ook als die naar de gedeelde lijst wijst', async () => {
    const bytes = await custom(['/Fm1 Do', '/Im3 Do'], 3, (doc, shared) => {
      const xobjects = shared.lookup(PDFName.of('XObject')) as lib.PDFDict;
      xobjects.set(PDFName.of('Fm1'), form(doc, '/Im1 Do', shared));
    });
    const parts = await perPage(bytes, 2);
    expect(await imagesIn(parts[0]!)).toEqual([1]);
    expect(await imagesIn(parts[1]!)).toEqual([3]);
  });

  it('volgt een formulier zonder eigen lijst binnen een formulier met eigen lijst', async () => {
    const bytes = await custom(['/Fm1 Do', '/Im3 Do'], 3, (doc, shared) => {
      const xobjects = shared.lookup(PDFName.of('XObject')) as lib.PDFDict;
      xobjects.set(PDFName.of('Fm2'), form(doc, '/Im2 Do'));
      xobjects.set(PDFName.of('Fm1'), form(doc, '/Fm2 Do', shared));
    });
    const [first] = await perPage(bytes, 2);
    expect(await imagesIn(first!)).toEqual([2]);
  });

  it('volgt een keten van formulieren zonder eigen lijst', async () => {
    const bytes = await custom(['/Fm1 Do', '/Im4 Do'], 4, (doc, shared) => {
      const xobjects = shared.lookup(PDFName.of('XObject')) as lib.PDFDict;
      xobjects.set(PDFName.of('Fm3'), form(doc, '/Im3 Do'));
      xobjects.set(PDFName.of('Fm2'), form(doc, '/Fm3 Do'));
      xobjects.set(PDFName.of('Fm1'), form(doc, '/Fm2 Do'));
    });
    const [first] = await perPage(bytes, 2);
    expect(await imagesIn(first!)).toEqual([3]);
  });

  it('dunt de eigen lijst van een patroon en van een masker (SMask) uit', async () => {
    const bytes = await custom(
      ['/Pattern cs /P1 scn 0 0 10 10 re f', '/GS1 gs /Im3 Do'],
      4,
      (doc, shared) => {
        const pattern = doc.context.register(
          doc.context.flateStream('/Im1 Do', {
            Type: 'Pattern',
            PatternType: 1,
            PaintType: 1,
            TilingType: 1,
            BBox: [0, 0, 10, 10],
            XStep: 10,
            YStep: 10,
            Resources: shared,
          }),
        );
        shared.set(PDFName.of('Pattern'), doc.context.obj({ P1: pattern }));
        const group = form(doc, '/Im2 Do', shared);
        shared.set(
          PDFName.of('ExtGState'),
          doc.context.obj({ GS1: { Type: 'ExtGState', SMask: { S: 'Luminosity', G: group } } }),
        );
      },
    );
    const parts = await perPage(bytes, 2);
    expect(await imagesIn(parts[0]!)).toEqual([1]);
    expect(await imagesIn(parts[1]!)).toEqual([2, 3]);
  });

  it('dunt de eigen lijst van de weergave van een aantekening uit', async () => {
    const bytes = await custom(['/Im1 Do', '/Im3 Do'], 3);
    const doc = await PDFDocument.load(bytes);
    const shared = doc.getPages()[0]!.node.Resources()!;
    const appearance = form(doc, '/Im2 Do', shared);
    doc.getPages()[0]!.node.set(
      PDFName.of('Annots'),
      doc.context.obj([
        doc.context.register(
          doc.context.obj({
            Type: 'Annot',
            Subtype: 'Stamp',
            Rect: [0, 0, 10, 10],
            AP: { N: appearance },
          }),
        ),
      ]),
    );
    const parts = await perPage(await doc.save(), 2);
    expect(await imagesIn(parts[0]!)).toEqual([1, 2]);
    expect(await imagesIn(parts[1]!)).toEqual([3]);
  });

  it('een formulier dat niet te lezen is: elke pagina die het gebruikt, blijft zoals ze is', async () => {
    const bytes = await custom(['/Fm1 Do', '/Im2 Do', '/Fm1 Do /Im3 Do'], 3, (doc, shared) => {
      const xobjects = shared.lookup(PDFName.of('XObject')) as lib.PDFDict;
      xobjects.set(
        PDFName.of('Fm1'),
        doc.context.register(
          doc.context.stream('/Im1 Do', {
            Type: 'XObject',
            Subtype: 'Form',
            BBox: [0, 0, 10, 10],
            Filter: 'JBIG2Decode',
            Resources: shared,
          }),
        ),
      );
    });
    const plan = initialPages(3, 1);
    const untrimmed: number[] = [];
    await buildParts(
      new Map([[1, bytes]]),
      [plan.slice(0, 1), plan.slice(1, 2), plan.slice(2)],
      undefined,
      [],
      undefined,
      (_, index, report) => (untrimmed[index] = report.untrimmed),
    );
    expect(untrimmed).toEqual([1, 0, 1]);
  });

  it('loopt niet vast op een formulier dat zichzelf aanroept', async () => {
    const bytes = await custom(['/Fm1 Do'], 2, (doc, shared) => {
      const own = doc.context.obj({});
      const self = form(doc, '/Fm1 Do /Im1 Do', own);
      own.set(
        PDFName.of('XObject'),
        doc.context.obj({
          Fm1: self,
          Im1: shared.lookup(PDFName.of('XObject'), lib.PDFDict).get(PDFName.of('Im1'))!,
        }),
      );
      (shared.lookup(PDFName.of('XObject')) as lib.PDFDict).set(PDFName.of('Fm1'), self);
    });
    const untrimmed: number[] = [];
    const [part] = await buildParts(
      new Map([[1, bytes]]),
      [initialPages(1, 1)],
      undefined,
      [],
      undefined,
      undefined,
    );
    await buildParts(
      new Map([[1, bytes]]),
      [initialPages(1, 1)],
      undefined,
      [],
      undefined,
      (_, _index, report) => untrimmed.push(report.untrimmed),
    );
    expect(await imagesIn(part!)).toEqual([1]);
    expect(untrimmed).toEqual([0]);
  });
});
