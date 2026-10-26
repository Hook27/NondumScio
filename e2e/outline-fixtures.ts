import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import { PDFDocument, PDFHexString, PDFName, PDFString, StandardFonts, type PDFRef } from 'pdf-lib';

/** PDF's met bladwijzers voor de tests (outline.spec.ts en merge-outline.spec.ts). */

export type OutlineItem = { title: string; page?: number; uri?: string; children?: OutlineItem[] };

/** Bladwijzers zoals in een rapport: genest, één naar een bijlage en één naar een website. */
export const REPORT_OUTLINE: OutlineItem[] = [
  { title: 'Inleiding', page: 0 },
  {
    title: 'Hoofdstuk 1',
    page: 1,
    children: [
      { title: 'Paragraaf 1.1', page: 2 },
      { title: 'Paragraaf 1.2', page: 3 },
    ],
  },
  { title: 'Bijlage', page: 5 },
  { title: 'Website', uri: 'https://example.com/' },
];

/** Een PDF met `count` pagina's ("<label> n" erop) en de bladwijzers volgens de PDF-norm. */
export async function makeOutlinePdf(
  outline: OutlineItem[] | null,
  count = 6,
  label = 'Pagina',
): Promise<Buffer> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const pages = Array.from({ length: count }, (_, i) => {
    const page = doc.addPage([595, 842]);
    page.drawText(`${label} ${i + 1}`, { x: 60, y: 760, size: 28, font });
    return page;
  });
  if (outline) {
    const context = doc.context;
    const build = (items: OutlineItem[], parent: PDFRef) => {
      const refs = items.map(() => context.nextRef());
      items.forEach((item, i) => {
        const dict: Record<string, unknown> = {
          Title: PDFHexString.fromText(item.title),
          Parent: parent,
        };
        if (i > 0) dict.Prev = refs[i - 1];
        if (i < items.length - 1) dict.Next = refs[i + 1];
        if (item.page !== undefined) dict.Dest = [pages[item.page]!.ref, 'Fit'];
        if (item.uri) dict.A = { S: 'URI', URI: PDFString.of(item.uri) };
        if (item.children) {
          const sub = build(item.children, refs[i]!);
          // Een negatief aantal: in een PDF-lezer staat dit deel ingeklapt.
          Object.assign(dict, { First: sub.first, Last: sub.last, Count: -sub.count });
        }
        context.assign(refs[i]!, context.obj(dict as never));
      });
      return { first: refs[0]!, last: refs.at(-1)!, count: items.length };
    };
    const root = context.nextRef();
    const top = build(outline, root);
    context.assign(
      root,
      context.obj({ Type: 'Outlines', First: top.first, Last: top.last, Count: top.count }),
    );
    doc.catalog.set(PDFName.of('Outlines'), root);
  }
  return Buffer.from(await doc.save());
}

export type ReadItem = { title: string; page: number | null; children: ReadItem[] };

/** De bladwijzers van een PDF zoals een PDF-lezer ze ziet (met pdf.js): titel, pagina vanaf 1, en wat eronder valt. */
export async function readOutlineOf(bytes: Buffer): Promise<ReadItem[]> {
  const pdf = await pdfjs.getDocument({ data: new Uint8Array(bytes), verbosity: 0 }).promise;
  type Node = { title: string; dest: unknown; items: Node[] };
  const walk = (items: Node[]): Promise<ReadItem[]> =>
    Promise.all(
      items.map(async (item) => ({
        title: item.title,
        page:
          Array.isArray(item.dest) && item.dest[0]
            ? (await pdf.getPageIndex(item.dest[0] as never)) + 1
            : null,
        children: await walk(item.items),
      })),
    );
  const outline = await walk(((await pdf.getOutline()) ?? []) as Node[]);
  await pdf.loadingTask.destroy();
  return outline;
}
