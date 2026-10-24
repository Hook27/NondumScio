import { describe, expect, it } from 'vitest';
import {
  HISTORY_LIMIT,
  canRemove,
  initialPages,
  docOrder,
  keysOfDoc,
  moveDoc,
  moveDocTo,
  removeDoc,
  movePages,
  movePagesBy,
  pickPages,
  samePlan,
  setDocPages,
  normalizeRotation,
  record,
  redo,
  removePages,
  rotatePages,
  startHistory,
  undo,
} from './plan';
import { formatRanges } from './ranges';
import { emptySelection, keepExisting, selectAll, selectByClick } from './selection';

const keys = (...values: number[]) => new Set(values);
const order = [0, 1, 2, 3, 4];

describe('pagina-plan', () => {
  it('begint met alle pagina’s in de originele volgorde, zonder draaiing', () => {
    expect(initialPages(3)).toEqual([
      { key: 0, doc: 0, source: 0, rotation: 0 },
      { key: 1, doc: 0, source: 1, rotation: 0 },
      { key: 2, doc: 0, source: 2, rotation: 0 },
    ]);
    // Een tweede bestand: eigen bestandsnummer en sleutels die doortellen.
    expect(initialPages(2, 7, 3)).toEqual([
      { key: 3, doc: 7, source: 0, rotation: 0 },
      { key: 4, doc: 7, source: 1, rotation: 0 },
    ]);
  });

  it('rekent draaiingen om naar 0, 90, 180 of 270', () => {
    expect(normalizeRotation(90)).toBe(90);
    expect(normalizeRotation(360)).toBe(0);
    expect(normalizeRotation(450)).toBe(90);
    expect(normalizeRotation(-90)).toBe(270);
    expect(normalizeRotation(-450)).toBe(270);
    expect(() => normalizeRotation(45)).toThrow(RangeError);
  });

  it('draait alleen de gekozen pagina’s, rechtsom en linksom', () => {
    const pages = initialPages(3);
    const right = rotatePages(pages, keys(0, 2), 90);
    expect(right.map((p) => p.rotation)).toEqual([90, 0, 90]);
    const back = rotatePages(right, keys(0), -90);
    expect(back.map((p) => p.rotation)).toEqual([0, 0, 90]);
    expect(rotatePages(rotatePages(back, keys(2), 90), keys(2), 180)[2]!.rotation).toBe(0);
  });

  it('verandert niets zonder selectie (en geeft hetzelfde plan terug)', () => {
    const pages = initialPages(2);
    expect(rotatePages(pages, keys(), 90)).toBe(pages);
  });

  it('verwijdert de gekozen pagina’s, maar nooit allemaal', () => {
    const pages = initialPages(4);
    expect(removePages(pages, keys(1, 3)).map((p) => p.source)).toEqual([0, 2]);
    expect(removePages(pages, keys(0, 1, 2, 3))).toBe(pages);
    expect(canRemove(pages, keys(0, 1, 2, 3))).toBe(false);
    expect(canRemove(pages, keys(1))).toBe(true);
    expect(canRemove(pages, keys())).toBe(false);
  });
});

describe('samePlan', () => {
  it('vergelijkt de inhoud, niet het object', () => {
    const pages = initialPages(3);
    const turnedBack = rotatePages(rotatePages(pages, keys(1), 90), keys(1), -90);
    expect(samePlan(pages, turnedBack)).toBe(true);
    expect(samePlan(pages, rotatePages(pages, keys(1), 90))).toBe(false);
    expect(samePlan(pages, removePages(pages, keys(0)))).toBe(false);
    expect(samePlan(pages, [...pages].reverse())).toBe(false);
  });
});

describe('ongedaan maken en opnieuw', () => {
  it('gaat terug en weer vooruit', () => {
    const start = initialPages(3);
    const rotated = rotatePages(start, keys(0), 90);
    const removed = removePages(rotated, keys(2));
    let history = record(record(startHistory(start), rotated), removed);
    expect(history.present).toBe(removed);

    history = undo(history);
    expect(history.present).toBe(rotated);
    history = undo(history);
    expect(history.present).toBe(start);
    expect(undo(history)).toBe(history); // niets meer terug

    history = redo(history);
    expect(history.present).toBe(rotated);
    history = redo(history);
    expect(history.present).toBe(removed);
    expect(redo(history)).toBe(history); // niets meer vooruit
  });

  it('laat "opnieuw" vervallen na een nieuwe bewerking', () => {
    const start = initialPages(2);
    let history = record(startHistory(start), rotatePages(start, keys(0), 90));
    history = undo(history);
    history = record(history, removePages(start, keys(1)));
    expect(history.future).toEqual([]);
  });

  it('telt een stap die niets verandert niet mee', () => {
    const start = initialPages(2);
    const history = startHistory(start);
    expect(record(history, rotatePages(start, keys(), 90))).toBe(history);
  });

  it('onthoudt hooguit een vast aantal stappen', () => {
    let history = startHistory(initialPages(1));
    for (let i = 0; i < HISTORY_LIMIT + 20; i += 1) {
      history = record(history, rotatePages(history.present, keys(0), 90));
    }
    expect(history.past).toHaveLength(HISTORY_LIMIT);
  });
});

describe('selecteren', () => {
  it('een klik kiest alleen die pagina', () => {
    const selection = selectByClick(selectAll(order), order, 2);
    expect([...selection.keys]).toEqual([2]);
    expect(selection.anchor).toBe(2);
  });

  it('Ctrl-klik zet een pagina erbij of haalt hem eraf', () => {
    let selection = selectByClick(emptySelection, order, 1);
    selection = selectByClick(selection, order, 3, { toggle: true });
    expect([...selection.keys].sort()).toEqual([1, 3]);
    selection = selectByClick(selection, order, 1, { toggle: true });
    expect([...selection.keys]).toEqual([3]);
  });

  it('Shift-klik kiest alles tussen het anker en de pagina, in beide richtingen', () => {
    let selection = selectByClick(emptySelection, order, 1);
    selection = selectByClick(selection, order, 3, { range: true });
    expect([...selection.keys].sort()).toEqual([1, 2, 3]);
    selection = selectByClick(selection, order, 0, { range: true });
    expect([...selection.keys].sort()).toEqual([0, 1]);
    expect(selection.anchor).toBe(1);
  });

  it('Shift-klik zonder anker werkt als een gewone klik', () => {
    expect([...selectByClick(emptySelection, order, 4, { range: true }).keys]).toEqual([4]);
  });

  it('Ctrl+Shift-klik voegt een reeks toe aan de bestaande selectie', () => {
    let selection = selectByClick(emptySelection, order, 0);
    selection = selectByClick(selection, order, 2, { toggle: true });
    selection = selectByClick(selection, order, 4, { toggle: true, range: true });
    expect([...selection.keys].sort()).toEqual([0, 2, 3, 4]);
  });

  it('alles selecteren', () => {
    expect([...selectAll(order).keys]).toEqual(order);
    expect(selectAll([]).anchor).toBeNull();
  });

  it('haalt verdwenen pagina’s uit de selectie', () => {
    const selection = { keys: new Set([1, 3]), anchor: 3 };
    const kept = keepExisting(selection, [0, 1, 2]);
    expect([...kept.keys]).toEqual([1]);
    expect(kept.anchor).toBeNull();
    expect(keepExisting(kept, [0, 1, 2])).toBe(kept);
  });
});

describe('verplaatsen', () => {
  const sources = (pages: ReturnType<typeof initialPages>) => pages.map((p) => p.source);

  it('zet één pagina op een nieuwe plek, vooruit en achteruit', () => {
    const pages = initialPages(5);
    expect(sources(movePages(pages, keys(3), 1))).toEqual([0, 3, 1, 2, 4]);
    expect(sources(movePages(pages, keys(1), 4))).toEqual([0, 2, 3, 1, 4]);
    expect(sources(movePages(pages, keys(1), 5))).toEqual([0, 2, 3, 4, 1]);
    expect(sources(movePages(pages, keys(4), 0))).toEqual([4, 0, 1, 2, 3]);
  });

  it('verplaatst meerdere pagina’s als één blok, in hun eigen volgorde', () => {
    const pages = initialPages(6);
    expect(sources(movePages(pages, keys(4, 1), 0))).toEqual([1, 4, 0, 2, 3, 5]);
    expect(sources(movePages(pages, keys(0, 2), 6))).toEqual([1, 3, 4, 5, 0, 2]);
    expect(sources(movePages(pages, keys(1, 4), 3))).toEqual([0, 2, 1, 4, 3, 5]);
  });

  it('houdt de draaiing en de sleutel van een pagina vast', () => {
    const pages = rotatePages(initialPages(3), keys(2), 90);
    const moved = movePages(pages, keys(2), 0);
    expect(moved[0]).toEqual({ key: 2, doc: 0, source: 2, rotation: 90 });
  });

  it('geeft hetzelfde plan terug als er niets verandert', () => {
    const pages = initialPages(4);
    expect(movePages(pages, keys(), 2)).toBe(pages);
    expect(movePages(pages, keys(1), 1)).toBe(pages);
    expect(movePages(pages, keys(1), 2)).toBe(pages);
    expect(movePages(pages, keys(1, 2), 2)).toBe(pages);
    expect(movePages(pages, keys(9), 0)).toBe(pages);
  });

  it('begrenst een plek buiten het document', () => {
    const pages = initialPages(3);
    expect(sources(movePages(pages, keys(1), -5))).toEqual([1, 0, 2]);
    expect(sources(movePages(pages, keys(1), 99))).toEqual([0, 2, 1]);
  });

  it('schuift één plek naar voren of naar achteren', () => {
    const pages = initialPages(5);
    expect(sources(movePagesBy(pages, keys(2), -1))).toEqual([0, 2, 1, 3, 4]);
    expect(sources(movePagesBy(pages, keys(2), 1))).toEqual([0, 1, 3, 2, 4]);
    expect(sources(movePagesBy(pages, keys(2, 3), 1))).toEqual([0, 1, 4, 2, 3]);
    expect(sources(movePagesBy(pages, keys(1, 3), -1))).toEqual([1, 3, 0, 2, 4]);
  });

  it('kan niet voorbij het begin of het einde', () => {
    const pages = initialPages(3);
    expect(movePagesBy(pages, keys(0), -1)).toBe(pages);
    expect(movePagesBy(pages, keys(2), 1)).toBe(pages);
    expect(movePagesBy(pages, keys(), 1)).toBe(pages);
  });
});

describe('uitpakken', () => {
  it('kiest de gekozen pagina’s in de huidige volgorde', () => {
    const pages = movePages(initialPages(5), keys(4), 0);
    expect(pickPages(pages, keys(1, 4)).map((p) => p.source)).toEqual([4, 1]);
    expect(pickPages(pages, keys())).toEqual([]);
  });
});

describe('formatRanges', () => {
  it('schrijft reeksen kort op', () => {
    expect(formatRanges([2, 3, 4])).toBe('2-4');
    expect(formatRanges([1, 3, 5, 6])).toBe('1, 3, 5-6');
    expect(formatRanges([7])).toBe('7');
    expect(formatRanges([])).toBe('');
  });

  it('negeert volgorde en dubbele nummers', () => {
    expect(formatRanges([6, 5, 1, 5, 2])).toBe('1-2, 5-6');
  });
});

describe('meerdere bestanden', () => {
  /** Drie bestanden: A (doc 1, 2 pagina's), B (doc 2, 3 pagina's), C (doc 3, 1 pagina). */
  const merged = () => [
    ...initialPages(2, 1, 0),
    ...initialPages(3, 2, 2),
    ...initialPages(1, 3, 5),
  ];
  const docs = (pages: ReturnType<typeof merged>) => pages.map((p) => p.doc);

  it('kent de volgorde van de bestanden en hun pagina’s', () => {
    expect(docOrder(merged())).toEqual([1, 2, 3]);
    expect([...keysOfDoc(merged(), 2)]).toEqual([2, 3, 4]);
    expect(docOrder([])).toEqual([]);
  });

  it('haalt een heel bestand weg, maar nooit het laatste', () => {
    expect(docs(removeDoc(merged(), 2))).toEqual([1, 1, 3]);
    const single = initialPages(2, 1);
    expect(removeDoc(single, 1)).toBe(single);
  });

  it('zet een bestand als blok een plek omhoog of omlaag', () => {
    expect(docs(moveDoc(merged(), 2, -1))).toEqual([2, 2, 2, 1, 1, 3]);
    expect(docs(moveDoc(merged(), 2, 1))).toEqual([1, 1, 3, 2, 2, 2]);
    expect(docs(moveDoc(merged(), 1, 1))).toEqual([2, 2, 2, 1, 1, 3]);
  });

  it('kan niet voorbij de eerste of laatste plek', () => {
    const pages = merged();
    expect(moveDoc(pages, 1, -1)).toBe(pages);
    expect(moveDoc(pages, 3, 1)).toBe(pages);
    expect(moveDoc(pages, 9, 1)).toBe(pages);
  });

  it('houdt bij door elkaar staande pagina’s de volgorde van de eerste pagina aan', () => {
    // A1 B1 A2 B2 B3 C1: A staat eerst, want A1 komt als eerste.
    const pages = merged();
    const mixed = [pages[0]!, pages[2]!, pages[1]!, pages[3]!, pages[4]!, pages[5]!];
    expect(docOrder(mixed)).toEqual([1, 2, 3]);
    // B omhoog: alle pagina's van B komen als blok vóór A.
    expect(docs(moveDoc(mixed, 2, -1))).toEqual([2, 2, 2, 1, 1, 3]);
  });

  it('zet een bestand in één keer op een andere plek (slepen)', () => {
    // C (plek 3) naar voren, B naar achteren, A tussen B en C.
    expect(docs(moveDocTo(merged(), 3, 0))).toEqual([3, 1, 1, 2, 2, 2]);
    expect(docs(moveDocTo(merged(), 2, 3))).toEqual([1, 1, 3, 2, 2, 2]);
    expect(docs(moveDocTo(merged(), 1, 2))).toEqual([2, 2, 2, 1, 1, 3]);
    // Buiten de lijst telt als vooraan of achteraan.
    expect(docs(moveDocTo(merged(), 3, -5))).toEqual([3, 1, 1, 2, 2, 2]);
    expect(docs(moveDocTo(merged(), 1, 99))).toEqual([2, 2, 2, 3, 1, 1]);
  });

  it('verandert niets bij loslaten op de eigen plek of bij een onbekend bestand', () => {
    const pages = merged();
    expect(moveDocTo(pages, 2, 1)).toBe(pages);
    expect(moveDocTo(pages, 2, 2)).toBe(pages);
    expect(moveDocTo(pages, 9, 0)).toBe(pages);
  });

  it('verplaatst bij door elkaar staande pagina’s het hele bestand als blok', () => {
    // A1 B1 A2 B2 B3 C1; A naar plek 2 (tussen B en C).
    const pages = merged();
    const mixed = [pages[0]!, pages[2]!, pages[1]!, pages[3]!, pages[4]!, pages[5]!];
    expect(docs(moveDocTo(mixed, 1, 2))).toEqual([2, 2, 2, 1, 1, 3]);
  });

  describe('pagina’s per bestand kiezen', () => {
    /** Nieuwe sleutels vanaf 100, zoals de documentstatus die doortelt. */
    const keys = () => {
      let next = 100;
      return () => next++;
    };
    const plan = (pages: ReturnType<typeof merged>) => pages.map((p) => `${p.doc}:${p.source + 1}`);

    it('laat pagina’s weg en houdt de rest op zijn plek', () => {
      const result = setDocPages(merged(), 2, new Set([0, 2]), keys());
      expect(plan(result)).toEqual(['1:1', '1:2', '2:1', '2:3', '3:1']);
    });

    it('zet een pagina terug op volgorde van paginanummer, met een nieuwe sleutel', () => {
      const fewer = setDocPages(merged(), 2, new Set([0, 2]), keys());
      const back = setDocPages(fewer, 2, new Set([0, 1, 2]), keys());
      expect(plan(back)).toEqual(['1:1', '1:2', '2:1', '2:2', '2:3', '3:1']);
      expect(back[3]!.key).toBe(100);
      // Ook vooraan en achteraan in het bestand.
      const middle = setDocPages(merged(), 2, new Set([1]), keys());
      expect(plan(setDocPages(middle, 2, new Set([0, 1, 2]), keys()))).toEqual(plan(merged()));
    });

    it('houdt draaiing en plek van pagina’s die blijven, ook als ze door elkaar staan', () => {
      const pages = merged();
      // A1 B1 A2 B2 B3 C1, met B1 gedraaid.
      const mixed = [
        { ...pages[2]!, rotation: 90 as const },
        pages[0]!,
        pages[1]!,
        pages[3]!,
        pages[4]!,
        pages[5]!,
      ];
      const result = setDocPages(mixed, 2, new Set([0, 2]), keys());
      expect(plan(result)).toEqual(['2:1', '1:1', '1:2', '2:3', '3:1']);
      expect(result[0]!.rotation).toBe(90);
    });

    it('zet nieuwe pagina’s op de plek van het bestand als er niets van over is', () => {
      const result = setDocPages(merged(), 2, new Set([1]), keys());
      const swapped = setDocPages(result, 2, new Set([0]), keys());
      expect(plan(swapped)).toEqual(['1:1', '1:2', '2:1', '3:1']);
    });

    it('verandert niets bij een lege keuze, een onbekend bestand of dezelfde keuze', () => {
      const pages = merged();
      expect(setDocPages(pages, 2, new Set(), keys())).toBe(pages);
      expect(setDocPages(pages, 9, new Set([0]), keys())).toBe(pages);
      expect(setDocPages(pages, 2, new Set([0, 1, 2]), keys())).toBe(pages);
    });
  });

  it('vergelijkt ook het bestand bij samePlan', () => {
    expect(samePlan(initialPages(2, 1), initialPages(2, 2))).toBe(false);
  });
});
