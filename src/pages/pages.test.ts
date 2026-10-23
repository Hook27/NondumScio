import { describe, expect, it } from 'vitest';
import {
  HISTORY_LIMIT,
  canRemove,
  initialPages,
  isChanged,
  samePlan,
  normalizeRotation,
  record,
  redo,
  removePages,
  rotatePages,
  startHistory,
  undo,
} from './plan';
import { emptySelection, keepExisting, selectAll, selectByClick } from './selection';

const keys = (...values: number[]) => new Set(values);
const order = [0, 1, 2, 3, 4];

describe('pagina-plan', () => {
  it('begint met alle pagina’s in de originele volgorde, zonder draaiing', () => {
    expect(initialPages(3)).toEqual([
      { key: 0, source: 0, rotation: 0 },
      { key: 1, source: 1, rotation: 0 },
      { key: 2, source: 2, rotation: 0 },
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

  it('ziet of het plan afwijkt van het origineel', () => {
    const pages = initialPages(3);
    expect(isChanged(pages, 3)).toBe(false);
    expect(isChanged(rotatePages(pages, keys(1), 90), 3)).toBe(true);
    expect(isChanged(removePages(pages, keys(2)), 3)).toBe(true);
    expect(isChanged(rotatePages(rotatePages(pages, keys(1), 90), keys(1), -90), 3)).toBe(false);
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
