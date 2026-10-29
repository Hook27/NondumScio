import { PDFDocument, PDFName, PDFRawStream, StandardFonts, type PDFRef } from 'pdf-lib';

/** Hoe groot elke testafbeelding is (beeldpunten in het vierkant, grijs: één byte per punt). */
const SIDE = 64;

/** De grijswaarde van afbeelding `id` (het logo: 0); nooit wit, en per pagina anders. */
export const grayOf = (id: number) => 30 + ((id * 37) % 180);

/** Waar (in punten, de oorsprong linksboven) de afbeelding van een pagina staat: een vierkant van 400. */
export const IMAGE_AREA = { x: 100, y: 142, size: 400 };

type Options = {
  /** Pagina 1 heeft inhoud in een codering die we niet kunnen lezen. */
  unreadable?: boolean;
  /** Pagina 1 tekent een formulier-XObject zonder eigen hulpbronnen, dat `/Im2` aanroept. */
  formWithoutResources?: boolean;
  /** Pagina 1 heeft een aantekening waarvan de weergave geen eigen hulpbronnen heeft. */
  appearanceWithoutResources?: boolean;
};

/**
 * Een PDF zoals veel scanprogramma's hem maken: alle pagina's delen één lijst met hulpbronnen, met
 * daarin de afbeeldingen van álle pagina's. Pagina n tekent alleen zijn eigen afbeelding (`/Im<n>`,
 * effen grijs: `grayOf(n)`), het gedeelde logo (`/Logo`) en een regel tekst (`/F1`). Elke afbeelding
 * draagt `/NondumScioImage <n>` (het logo: 0), zodat een test kan zien welke er in een resultaat staan.
 * Dezelfde lijst hangt ook aan de paginaboom, zoals bij Jörgs scan (die pagina's kunnen hem erven).
 */
export async function makeSharedResourcesPdf(
  count: number,
  options: Options = {},
): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const { context } = doc;
  const image = (id: number): PDFRef =>
    context.register(
      context.stream(new Uint8Array(SIDE * SIDE).fill(grayOf(id)), {
        Type: 'XObject',
        Subtype: 'Image',
        Width: SIDE,
        Height: SIDE,
        ColorSpace: 'DeviceGray',
        BitsPerComponent: 8,
        NondumScioImage: id,
      }),
    );
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const xobjects: Record<string, PDFRef> = { Logo: image(0) };
  for (let n = 1; n <= count; n += 1) xobjects[`Im${n}`] = image(n);
  if (options.formWithoutResources) {
    xobjects.Fm1 = context.register(
      context.stream('q 10 0 0 10 0 0 cm /Im2 Do Q', {
        Type: 'XObject',
        Subtype: 'Form',
        BBox: [0, 0, 10, 10],
      }),
    );
  }
  const shared = context.register(
    context.obj({
      ProcSet: ['PDF', 'Text', 'ImageB'],
      Font: { F1: font.ref },
      XObject: xobjects,
    }),
  );
  // Zoals in echte scans hangt de lijst ook aan de paginaboom (pagina's kunnen hem erven).
  doc.catalog.Pages().set(PDFName.of('Resources'), shared);
  const { x, y, size } = IMAGE_AREA;
  for (let n = 1; n <= count; n += 1) {
    const page = doc.addPage([595, 842]);
    const content =
      `q ${size} 0 0 ${size} ${x} ${842 - y - size} cm /Im${n} Do Q ` +
      `q 50 0 0 50 500 760 cm /Logo Do Q ` +
      `BT /F1 24 Tf 100 200 Td (Pagina ${n}) Tj ET` +
      (n === 1 && options.formWithoutResources ? ' /Fm1 Do' : '');
    const stream =
      n === 1 && options.unreadable
        ? context.stream(content, { Filter: 'JBIG2Decode' })
        : context.flateStream(content);
    page.node.set(PDFName.of('Contents'), context.register(stream));
    page.node.set(PDFName.of('Resources'), shared);
    if (n === 1 && options.appearanceWithoutResources) {
      const appearance = context.register(
        context.stream('q 10 0 0 10 0 0 cm /Im2 Do Q', {
          Type: 'XObject',
          Subtype: 'Form',
          BBox: [0, 0, 10, 10],
        }),
      );
      page.node.set(
        PDFName.of('Annots'),
        context.obj([
          context.register(
            context.obj({
              Type: 'Annot',
              Subtype: 'Stamp',
              Rect: [0, 0, 10, 10],
              AP: { N: appearance },
            }),
          ),
        ]),
      );
    }
  }
  return doc.save();
}

/** De nummers (`/NondumScioImage`) van de afbeeldingen die in een PDF staan, oplopend. */
export async function imagesIn(bytes: Uint8Array): Promise<number[]> {
  const doc = await PDFDocument.load(bytes);
  const ids: number[] = [];
  for (const [, object] of doc.context.enumerateIndirectObjects()) {
    if (!(object instanceof PDFRawStream)) continue;
    const id = object.dict.get(PDFName.of('NondumScioImage'));
    if (id !== undefined) ids.push(Number(id.toString()));
  }
  return ids.sort((a, b) => a - b);
}
