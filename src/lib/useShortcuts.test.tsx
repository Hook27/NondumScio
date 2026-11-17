// @vitest-environment jsdom
import { cleanup, fireEvent, render } from '@testing-library/preact';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useShortcuts } from './useShortcuts';

function setup() {
  const onKey = vi.fn();
  function Screen() {
    useShortcuts(onKey, []);
    return (
      <div>
        <input type="text" aria-label="tekst" />
        <input type="checkbox" aria-label="vinkje" />
        <input type="range" aria-label="schuif" />
        <textarea aria-label="vak" />
        <select aria-label="keuze">
          <option>een</option>
        </select>
        <div contentEditable aria-label="bewerkbaar" />
      </div>
    );
  }
  const view = render(<Screen />);
  const press = (target: Element, key = 'ArrowDown') => fireEvent.keyDown(target, { key });
  const by = (label: string) => view.container.querySelector(`[aria-label="${label}"]`)!;
  return { onKey, press, by };
}

afterEach(() => {
  cleanup();
  document.querySelectorAll('dialog').forEach((dialog) => dialog.remove());
});

describe('useShortcuts: één regel voor sneltoetsen, overal', () => {
  it('werkt op de pagina zelf en op een vinkje', () => {
    const { onKey, press, by } = setup();
    press(document.body);
    press(by('vinkje'));
    expect(onKey).toHaveBeenCalledTimes(2);
  });

  it('niet tijdens het typen: tekstveld, tekstvak, keuzelijst, schuif en bewerkbare tekst', () => {
    const { onKey, press, by } = setup();
    for (const label of ['tekst', 'vak', 'keuze', 'schuif', 'bewerkbaar']) press(by(label));
    expect(onKey).not.toHaveBeenCalled();
  });

  it('niet zolang er een venster open is', () => {
    const { onKey, press } = setup();
    const dialog = document.createElement('dialog');
    dialog.setAttribute('open', '');
    document.body.append(dialog);
    press(document.body);
    expect(onKey).not.toHaveBeenCalled();
    dialog.removeAttribute('open');
    press(document.body);
    expect(onKey).toHaveBeenCalledTimes(1);
  });
});
