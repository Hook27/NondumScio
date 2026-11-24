// @vitest-environment jsdom
import { cleanup, fireEvent, render } from '@testing-library/preact';
import { useRef } from 'preact/hooks';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useDragReorder } from './useDragReorder';

/**
 * Een lijst van drie onderdelen van 100 × 100 px: onder elkaar (`vertical`) of naast elkaar
 * (`grid`). jsdom kent geen opmaak; de maten en `elementFromPoint` zijn daarom nagebootst.
 */
const SIZE = 100;
const COUNT = 3;

function List({
  direction,
  onStart,
  onDrop,
  onClick,
}: {
  direction: 'vertical' | 'grid';
  onStart: (item: number) => void;
  onDrop: (item: number, target: number) => void;
  onClick: (item: number) => void;
}) {
  const list = useRef<HTMLUListElement>(null);
  const { dragged, dropAt, handlers, consumeClick } = useDragReorder<number>({
    list,
    itemSelector: '[data-index]',
    direction,
    onStart,
    onDrop,
  });
  return (
    <ul ref={list} data-testid="list" data-dragged={dragged ?? 'geen'} data-drop={dropAt ?? 'geen'}>
      {Array.from({ length: COUNT }, (_, index) => (
        <li
          key={index}
          data-index={index}
          {...handlers(index)}
          onClick={() => {
            if (!consumeClick()) onClick(index);
          }}
        >
          onderdeel {index}
          <button type="button">knop</button>
          <span class="drag-handle">greep</span>
        </li>
      ))}
    </ul>
  );
}

/** De plek van onderdeel `index` (en van de lijst als geheel bij `null`). */
function boxOf(direction: 'vertical' | 'grid', index: number | null): DOMRect {
  const [left, top, width, height] =
    index === null
      ? direction === 'vertical'
        ? [0, 0, SIZE, SIZE * COUNT]
        : [0, 0, SIZE * COUNT, SIZE]
      : direction === 'vertical'
        ? [0, index * SIZE, SIZE, SIZE]
        : [index * SIZE, 0, SIZE, SIZE];
  return {
    left,
    top,
    width,
    height,
    right: left + width,
    bottom: top + height,
    x: left,
    y: top,
    toJSON: () => ({}),
  };
}

function setup(direction: 'vertical' | 'grid' = 'vertical') {
  const onStart = vi.fn();
  const onDrop = vi.fn();
  const onClick = vi.fn();
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
    const index = (this as HTMLElement).dataset.index;
    return boxOf(direction, index === undefined ? null : Number(index));
  });
  document.elementFromPoint = (x: number, y: number) => {
    const list = boxOf(direction, null);
    if (x < list.left || x >= list.right || y < list.top || y >= list.bottom) return document.body;
    const index = Math.floor((direction === 'vertical' ? y : x) / SIZE);
    return document.querySelector(`[data-index="${index}"]`);
  };
  render(<List direction={direction} onStart={onStart} onDrop={onDrop} onClick={onClick} />);
  const item = (index: number) => document.querySelector<HTMLElement>(`[data-index="${index}"]`)!;
  const list = () => document.querySelector<HTMLElement>('[data-testid="list"]')!;
  return { onStart, onDrop, onClick, item, list };
}

/** Een muis met de linkerknop ingedrukt (`buttons: 1`), zoals een echte browser hem meldt. */
const mouse = { pointerId: 1, pointerType: 'mouse', button: 0, buttons: 1 };
const at = (x: number, y: number) => ({ clientX: x, clientY: y });

describe('useDragReorder: slepen in een lijst', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('een kleine beweging (minder dan 6 px) is een klik, geen slepen', () => {
    const { onStart, onDrop, onClick, item, list } = setup();
    fireEvent.pointerDown(item(0), { ...mouse, ...at(50, 50) });
    fireEvent.pointerMove(item(0), { ...mouse, ...at(53, 54) });
    expect(list().dataset.dragged).toBe('geen');
    fireEvent.pointerUp(item(0), { ...mouse, buttons: 0, ...at(53, 54) });
    fireEvent.click(item(0));
    expect(onStart).not.toHaveBeenCalled();
    expect(onDrop).not.toHaveBeenCalled();
    expect(onClick).toHaveBeenCalledWith(0);
  });

  it('slepen en loslaten: het streepje wijst de plek aan, en daar komt het terecht', () => {
    const { onStart, onDrop, onClick, item, list } = setup();
    fireEvent.pointerDown(item(0), { ...mouse, ...at(50, 50) });
    // In de bovenste helft van onderdeel 1: ervóór (plek 1).
    fireEvent.pointerMove(item(0), { ...mouse, ...at(50, 120) });
    expect(onStart).toHaveBeenCalledWith(0);
    expect(list().dataset.dragged).toBe('0');
    expect(list().dataset.drop).toBe('1');
    // In de onderste helft van onderdeel 2: erachter (plek 3 = achteraan).
    fireEvent.pointerMove(item(0), { ...mouse, ...at(50, 280) });
    expect(list().dataset.drop).toBe('3');
    fireEvent.pointerUp(item(0), { ...mouse, buttons: 0, ...at(50, 280) });
    expect(onDrop).toHaveBeenCalledWith(0, 3);
    expect(list().dataset.dragged).toBe('geen');
    expect(list().dataset.drop).toBe('geen');
    // De klik die op het slepen volgt, doet niets; de klik daarna weer wel.
    fireEvent.click(item(0));
    expect(onClick).not.toHaveBeenCalled();
    fireEvent.click(item(0));
    expect(onClick).toHaveBeenCalledWith(0);
  });

  it('naast elkaar (miniaturen): links of rechts van het midden telt', () => {
    const { onDrop, item, list } = setup('grid');
    fireEvent.pointerDown(item(2), { ...mouse, ...at(250, 50) });
    fireEvent.pointerMove(item(2), { ...mouse, ...at(130, 50) });
    expect(list().dataset.drop).toBe('1');
    fireEvent.pointerMove(item(2), { ...mouse, ...at(70, 50) });
    expect(list().dataset.drop).toBe('1');
    fireEvent.pointerMove(item(2), { ...mouse, ...at(30, 50) });
    expect(list().dataset.drop).toBe('0');
    fireEvent.pointerUp(item(2), { ...mouse, buttons: 0, ...at(30, 50) });
    expect(onDrop).toHaveBeenCalledWith(2, 0);
  });

  it('net naast de lijst loslaten houdt de laatste plek; ver erbuiten breekt af', () => {
    const { onDrop, item, list } = setup();
    fireEvent.pointerDown(item(0), { ...mouse, ...at(50, 50) });
    fireEvent.pointerMove(item(0), { ...mouse, ...at(50, 180) });
    // Binnen 48 px naast de lijst: het streepje blijft staan.
    fireEvent.pointerMove(item(0), { ...mouse, ...at(130, 180) });
    expect(list().dataset.drop).toBe('2');
    fireEvent.pointerUp(item(0), { ...mouse, buttons: 0, ...at(130, 180) });
    expect(onDrop).toHaveBeenCalledWith(0, 2);

    // Een nieuwe sleepbeweging begint zonder plek: de vorige is vergeten.
    fireEvent.pointerDown(item(0), { ...mouse, ...at(50, 50) });
    fireEvent.pointerMove(item(0), { ...mouse, ...at(130, 50) });
    expect(list().dataset.drop).toBe('geen');
    fireEvent.pointerUp(item(0), { ...mouse, buttons: 0, ...at(130, 50) });
    expect(onDrop).toHaveBeenCalledTimes(1);

    onDrop.mockClear();
    fireEvent.pointerDown(item(1), { ...mouse, ...at(50, 150) });
    fireEvent.pointerMove(item(1), { ...mouse, ...at(50, 250) });
    fireEvent.pointerMove(item(1), { ...mouse, ...at(400, 250) });
    expect(list().dataset.drop).toBe('geen');
    fireEvent.pointerUp(item(1), { ...mouse, buttons: 0, ...at(400, 250) });
    expect(onDrop).not.toHaveBeenCalled();
  });

  it('Escape breekt het slepen af; loslaten zet daarna niets neer', () => {
    const { onDrop, onClick, item, list } = setup();
    fireEvent.pointerDown(item(0), { ...mouse, ...at(50, 50) });
    fireEvent.pointerMove(item(0), { ...mouse, ...at(50, 250) });
    expect(list().dataset.dragged).toBe('0');
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(list().dataset.dragged).toBe('geen');
    fireEvent.pointerUp(item(0), { ...mouse, buttons: 0, ...at(50, 250) });
    fireEvent.click(item(0));
    expect(onDrop).not.toHaveBeenCalled();
    expect(onClick).not.toHaveBeenCalled();
  });

  it('afbreken door de browser (pointercancel) zet niets neer', () => {
    const { onDrop, item, list } = setup();
    fireEvent.pointerDown(item(0), { ...mouse, ...at(50, 50) });
    fireEvent.pointerMove(item(0), { ...mouse, ...at(50, 250) });
    fireEvent.pointerCancel(item(0), { ...mouse });
    expect(list().dataset.dragged).toBe('geen');
    fireEvent.pointerUp(item(0), { ...mouse, buttons: 0, ...at(50, 250) });
    expect(onDrop).not.toHaveBeenCalled();
  });

  it('op een knop, of met een andere muisknop, begint geen slepen', () => {
    const { onStart, item } = setup();
    const button = item(0).querySelector('button')!;
    fireEvent.pointerDown(button, { ...mouse, ...at(50, 50) });
    fireEvent.pointerMove(item(0), { ...mouse, ...at(50, 250) });
    fireEvent.pointerUp(item(0), { ...mouse, buttons: 0, ...at(50, 250) });
    // De rechterknop, ook als de linkerknop er daarna bij komt.
    fireEvent.pointerDown(item(0), { ...mouse, button: 2, buttons: 2, ...at(50, 50) });
    fireEvent.pointerMove(item(0), { ...mouse, button: 0, buttons: 3, ...at(50, 250) });
    expect(onStart).not.toHaveBeenCalled();
  });

  it('op een aanraakscherm alleen via het greepje, zodat gewoon scrollen blijft werken', () => {
    const { onStart, onDrop, item } = setup();
    const touch = { pointerId: 5, pointerType: 'touch', button: 0, buttons: 1 };
    fireEvent.pointerDown(item(0), { ...touch, ...at(50, 50) });
    fireEvent.pointerMove(item(0), { ...touch, ...at(50, 250) });
    fireEvent.pointerUp(item(0), { ...touch, buttons: 0, ...at(50, 250) });
    expect(onStart).not.toHaveBeenCalled();

    const handle = item(0).querySelector('.drag-handle')!;
    fireEvent.pointerDown(handle, { ...touch, ...at(50, 50) });
    fireEvent.pointerMove(item(0), { ...touch, ...at(50, 250) });
    fireEvent.pointerUp(item(0), { ...touch, buttons: 0, ...at(50, 250) });
    expect(onStart).toHaveBeenCalledWith(0);
    expect(onDrop).toHaveBeenCalledWith(0, 3);
  });

  it('een tweede vinger of muis doet niet mee met het slepen', () => {
    const { onDrop, item, list } = setup();
    fireEvent.pointerDown(item(0), { ...mouse, ...at(50, 50) });
    fireEvent.pointerMove(item(0), { ...mouse, pointerId: 2, ...at(50, 250) });
    expect(list().dataset.dragged).toBe('geen');
    fireEvent.pointerMove(item(0), { ...mouse, ...at(50, 250) });
    fireEvent.pointerUp(item(0), { ...mouse, pointerId: 2, buttons: 0, ...at(50, 120) });
    expect(onDrop).not.toHaveBeenCalled();
    fireEvent.pointerUp(item(0), { ...mouse, buttons: 0, ...at(50, 250) });
    expect(onDrop).toHaveBeenCalledWith(0, 3);
  });

  it('naast het onderdeel losgelaten: daarna eroverheen bewegen begint géén slepen (audit F17)', () => {
    const { onStart, onDrop, onClick, item, list } = setup();
    // Knop in op onderdeel 0 en zonder te bewegen loslaten naast de lijst: dat loslaten komt
    // niet bij het onderdeel aan (er is nog niets "gevangen").
    fireEvent.pointerDown(item(0), { ...mouse, ...at(50, 50) });
    fireEvent.pointerUp(document.body, { ...mouse, buttons: 0, ...at(400, 50) });
    // Later, met de knop los, over het onderdeel bewegen.
    fireEvent.pointerMove(item(0), { ...mouse, button: -1, buttons: 0, ...at(50, 60) });
    fireEvent.pointerMove(item(0), { ...mouse, button: -1, buttons: 0, ...at(50, 250) });
    expect(onStart).not.toHaveBeenCalled();
    expect(list().dataset.dragged).toBe('geen');
    // Ook niet als de knop daarna ergens anders weer ingedrukt wordt (bijvoorbeeld om tekst te
    // kiezen) en de muis zo over het onderdeel komt: het oude begin is vergeten.
    fireEvent.pointerMove(item(0), { ...mouse, button: -1, ...at(50, 260) });
    expect(onStart).not.toHaveBeenCalled();
    fireEvent.pointerUp(item(0), { ...mouse, buttons: 0, ...at(50, 260) });
    expect(onDrop).not.toHaveBeenCalled();
    // Een gewone klik doet daarna gewoon zijn werk.
    fireEvent.click(item(0));
    expect(onClick).toHaveBeenCalledWith(0);
  });
});
