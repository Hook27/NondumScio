// @vitest-environment jsdom
import { act, cleanup, render, screen } from '@testing-library/preact';
import { useState } from 'preact/hooks';
import { afterEach, describe, expect, it } from 'vitest';
import { memo, shallowEqual } from './memo';
import { useStable } from './useStable';

afterEach(() => cleanup());

describe('shallowEqual', () => {
  it('vergelijkt waarde voor waarde, niet de inhoud van lijsten', () => {
    const list = [1];
    expect(shallowEqual({ a: 1, b: list }, { a: 1, b: list })).toBe(true);
    expect(shallowEqual({ a: 1, b: list }, { a: 1, b: [1] })).toBe(false);
    expect(shallowEqual({ a: 1 }, { a: 1, b: undefined })).toBe(false);
    expect(shallowEqual({ a: NaN }, { a: NaN })).toBe(true);
  });
});

describe('memo', () => {
  it('tekent niet opnieuw als de gegevens gelijk zijn, en wel als er een verandert', () => {
    let renders = 0;
    const Child = memo(function Child({ label }: { label: string }) {
      renders += 1;
      return <p>{label}</p>;
    });
    let setLabel: (label: string) => void = () => {};
    let bump: () => void = () => {};
    function Parent() {
      const [label, set] = useState('een');
      const [, setCount] = useState(0);
      setLabel = set;
      bump = () => setCount((n) => n + 1);
      return <Child label={label} />;
    }
    render(<Parent />);
    expect(renders).toBe(1);

    // De ouder tekent opnieuw, het kind krijgt hetzelfde: overslaan.
    act(() => bump());
    act(() => bump());
    expect(renders).toBe(1);

    act(() => setLabel('twee'));
    expect(renders).toBe(2);
    expect(screen.getByText('twee')).toBeTruthy();
  });

  it('laat wat het onderdeel zelf bijhoudt gewoon doorwerken', () => {
    const Counter = memo(function Counter({ start }: { start: number }) {
      const [n, setN] = useState(start);
      return (
        <button type="button" onClick={() => setN(n + 1)}>
          {n}
        </button>
      );
    });
    render(<Counter start={5} />);
    act(() => screen.getByRole('button').click());
    expect(screen.getByRole('button').textContent).toBe('6');
  });
});

describe('useStable', () => {
  it('geeft bij elke render dezelfde functies, die de nieuwste versie aanroepen', () => {
    const seen: { go: () => string }[] = [];
    let bump: () => void = () => {};
    function Parent() {
      const [n, setN] = useState(0);
      bump = () => setN((value) => value + 1);
      seen.push(useStable({ go: () => `stand ${n}` }));
      return null;
    }
    render(<Parent />);
    act(() => bump());
    act(() => bump());
    expect(seen).toHaveLength(3);
    expect(seen[1]).toBe(seen[0]);
    expect(seen[2]).toBe(seen[0]);
    // Ook de oudste verwijzing geeft het nieuwste antwoord.
    expect(seen[0]!.go()).toBe('stand 2');
  });
});
