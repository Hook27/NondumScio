import { afterAll, beforeAll } from 'vitest';

/**
 * Alleen voor tests. jsdom kent geen opmaak: elk element is 0 px breed. Dan tekent Bewerken /
 * Redigeren de pagina's nooit, en wordt `data-rendered` ("is getekend") nooit true. Dit geeft de
 * paginalijst (`.annotate-pages`) een breedte, zodat het tekenen in de tests echt gebeurt. Standaard
 * die van een A4-pagina (595 punten): dan is één punt op de pagina één beeldpunt, zoals de tests
 * rekenen.
 */
export function giveAnnotatePagesWidth(width = 595): void {
  beforeAll(() => {
    Object.defineProperty(HTMLElement.prototype, 'clientWidth', {
      configurable: true,
      get(this: HTMLElement) {
        return this.classList.contains('annotate-pages') ? width : 0;
      },
    });
  });
  afterAll(() => {
    // Terug naar die van jsdom zelf (op Element.prototype).
    delete (HTMLElement.prototype as { clientWidth?: number }).clientWidth;
  });
}
