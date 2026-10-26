import { describe, expect, it, vi } from 'vitest';
import type { PageItem } from '../pages/plan';
import {
  countEntries,
  loadOutline,
  outlinesOf,
  placeOutline,
  readOutline,
  remapOutline,
  type OutlineEntry,
  type OutlineSource,
} from './outline';

type Node = { title: string; dest: unknown; items?: Node[] };

/** Een nep-PDF: pagina's als verwijzing { num }, en benoemde bestemmingen. */
function fakePdf(outline: Node[] | null, named: Record<string, unknown[]> = {}) {
  const pdf = {
    getOutline: vi.fn(async () => outline),
    getDestination: vi.fn(async (name: string) => named[name] ?? null),
    getPageIndex: vi.fn(async (ref: { num: number }) => {
      if (ref.num >= 100) throw new Error('Onbekende pagina');
      return ref.num - 10;
    }),
  };
  return pdf as unknown as OutlineSource & typeof pdf;
}

const ref = (page: number) => ({ num: page + 10, gen: 0 });
const node = (title: string, dest: unknown, items: Node[] = []): Node => ({ title, dest, items });

describe('readOutline', () => {
  it('leest geneste bladwijzers met hun pagina', async () => {
    const pdf = fakePdf([
      node('Inleiding', [ref(0), { name: 'Fit' }]),
      node(
        'Hoofdstuk 1',
        [ref(1), { name: 'XYZ' }, 0, 800, null],
        [node('Paragraaf 1.1', [ref(2), { name: 'Fit' }])],
      ),
    ]);
    expect(await readOutline(pdf)).toEqual([
      { id: '0', title: 'Inleiding', page: 0, children: [] },
      {
        id: '1',
        title: 'Hoofdstuk 1',
        page: 1,
        children: [{ id: '1.0', title: 'Paragraaf 1.1', page: 2, children: [] }],
      },
    ]);
  });

  it('volgt benoemde bestemmingen en paginanummers in de bestemming', async () => {
    const pdf = fakePdf([node('Bijlage', 'bijlage'), node('Direct', [4, { name: 'Fit' }])], {
      bijlage: [ref(5), { name: 'Fit' }],
    });
    const entries = await readOutline(pdf);
    expect(entries.map((entry) => entry.page)).toEqual([5, 4]);
  });

  it('geeft geen pagina bij een link, een onbekende bestemming of een fout', async () => {
    const pdf = fakePdf([
      node('Website', null),
      node('Weg', 'bestaat-niet'),
      node('Kapot', [{ num: 200, gen: 0 }]),
      node('Leeg', []),
    ]);
    expect((await readOutline(pdf)).map((entry) => entry.page)).toEqual([null, null, null, null]);
  });

  it('maakt titels netjes en geeft een lege lijst zonder bladwijzers of bij een fout', async () => {
    expect((await readOutline(fakePdf([node('  Twee\n regels ', null)])))[0]!.title).toBe(
      'Twee regels',
    );
    expect(await readOutline(fakePdf(null))).toEqual([]);
    const broken = fakePdf([]);
    broken.getOutline.mockRejectedValueOnce(new Error('kapot'));
    expect(await readOutline(broken)).toEqual([]);
    // Een nep-PDF zonder deze functie (zoals in andere tests) gaat ook goed.
    expect(await readOutline({} as OutlineSource)).toEqual([]);
  });

  it('leest elk bestand maar één keer', async () => {
    const pdf = fakePdf([node('Een', [ref(0)])]);
    const first = await loadOutline(pdf);
    expect(await loadOutline(pdf)).toBe(first);
    expect(pdf.getOutline).toHaveBeenCalledTimes(1);
  });
});

const entry = (id: string, page: number | null, children: OutlineEntry[] = []): OutlineEntry => ({
  id,
  title: `Bladwijzer ${id}`,
  page,
  children,
});
const plan = (...items: [doc: number, source: number][]): PageItem[] =>
  items.map(([doc, source], key) => ({ key, doc, source, rotation: 0 }) as PageItem);

describe('placeOutline', () => {
  const outline = [entry('0', 0), entry('1', 1, [entry('1.0', 2)]), entry('2', null)];

  it('geeft de plek in het resultaat, ook na verplaatsen', () => {
    const placed = placeOutline(outline, 1, plan([1, 2], [1, 0], [1, 1]));
    expect(placed[0]!.target).toEqual({ kind: 'page', position: 1 });
    expect(placed[1]!.target).toEqual({ kind: 'page', position: 2 });
    expect(placed[1]!.children[0]!.target).toEqual({ kind: 'page', position: 0 });
    expect(placed[2]!.target).toEqual({ kind: 'none' });
  });

  it('markeert bladwijzers naar een weggehaalde pagina', () => {
    const placed = placeOutline(outline, 1, plan([1, 0], [1, 2]));
    expect(placed[1]!.target).toEqual({ kind: 'removed' });
    expect(placed[1]!.children[0]!.target).toEqual({ kind: 'page', position: 1 });
  });

  it('kijkt alleen naar pagina’s van het eigen bestand, en neemt bij dubbele de eerste', () => {
    const placed = placeOutline(outline, 2, plan([1, 0], [2, 1], [2, 0], [2, 0]));
    expect(placed[0]!.target).toEqual({ kind: 'page', position: 2 });
    expect(placed[1]!.target).toEqual({ kind: 'page', position: 1 });
    expect(placed[1]!.children[0]!.target).toEqual({ kind: 'removed' });
  });
});

describe('remapOutline', () => {
  it('geeft de nieuwe plekken en laat weg wat geen pagina in het resultaat heeft', () => {
    const outline = [
      entry('0', 0),
      // Weggehaald, maar met een onderliggende die wel meedoet: die schuift op.
      entry('1', 1, [entry('1.0', 2), entry('1.1', 1)]),
      entry('2', null),
      entry('3', 3, [entry('3.0', 3)]),
    ];
    const pages = plan([1, 3], [1, 0], [1, 2]);
    expect(remapOutline(outline, 1, pages)).toEqual([
      { title: 'Bladwijzer 0', pageIndex: 1, children: [] },
      { title: 'Bladwijzer 1.0', pageIndex: 2, children: [] },
      {
        title: 'Bladwijzer 3',
        pageIndex: 0,
        children: [{ title: 'Bladwijzer 3.0', pageIndex: 0, children: [] }],
      },
    ]);
  });
});

describe('outlinesOf', () => {
  it('geeft de bladwijzers per bestandsnummer', async () => {
    const a = fakePdf([node('Een', [ref(0)])]);
    const b = fakePdf(null);
    const result = await outlinesOf([
      { id: 7, pdf: a },
      { id: 9, pdf: b },
    ]);
    expect([...result.keys()]).toEqual([7, 9]);
    expect(result.get(7)![0]!.title).toBe('Een');
    expect(result.get(9)).toEqual([]);
  });
});

describe('countEntries', () => {
  it('telt ook onderliggende bladwijzers, eventueel alleen een soort', () => {
    const placed = placeOutline(
      [entry('0', 0), entry('1', 1, [entry('1.0', 2), entry('1.1', 3)])],
      1,
      plan([1, 0], [1, 1]),
    );
    expect(countEntries(placed)).toBe(4);
    expect(countEntries(placed, (item) => item.target.kind === 'removed')).toBe(2);
  });
});
