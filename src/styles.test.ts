import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { THEME_STORAGE_KEY } from './theme';

const css = readFileSync(new URL('./styles.css', import.meta.url), 'utf-8');
const html = readFileSync(new URL('../index.html', import.meta.url), 'utf-8');

type Palette = Record<string, string>;

/** Leest de `--naam: waarde;`-regels uit het blok dat begint bij `selector {`. */
function variables(selector: string): Palette {
  const start = css.indexOf(`${selector} {`);
  if (start < 0) throw new Error(`Blok niet gevonden: ${selector}`);
  const end = css.indexOf('}', start);
  const body = css.slice(start + selector.length + 2, end);
  const palette: Palette = {};
  for (const [, name, value] of body.matchAll(/--([\w-]+):\s*([^;]+);/g)) {
    palette[name as string] = (value as string).trim();
  }
  return palette;
}

const light = variables(':root');
const darkAuto = variables(":root:not([data-theme='light'])");
const darkChosen = variables(":root[data-theme='dark']");

function luminance(hex: string): number {
  const channels = [1, 3, 5].map((i) => {
    const value = parseInt(hex.slice(i, i + 2), 16) / 255;
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * channels[0]! + 0.7152 * channels[1]! + 0.0722 * channels[2]!;
}

/** Contrastverhouding volgens WCAG: 1 (geen) tot 21 (zwart op wit). */
function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi! + 0.05) / (lo! + 0.05);
}

describe('kleuren', () => {
  it('het donkere thema staat op beide plekken met dezelfde waarden', () => {
    // `color-scheme` is geen kleur en hoeft niet mee te tellen.
    const auto = { ...darkAuto };
    const chosen = { ...darkChosen };
    delete auto['color-scheme'];
    delete chosen['color-scheme'];
    expect(auto).toEqual(chosen);
    expect(Object.keys(auto).length).toBeGreaterThan(5);
  });

  it('gebruikt in de stijl geen vaste kleuren buiten de variabelen', () => {
    const outsideVariables = css
      .split('\n')
      .filter((line) => !line.trim().startsWith('--') && !line.includes('rgb(20 28 48'))
      .filter((line) => /#[0-9a-fA-F]{3,8}\b/.test(line) && !/^#app/.test(line.trim()));
    expect(outsideVariables).toEqual([]);
  });

  for (const [name, palette] of [
    ['licht', light],
    ['donker', darkChosen],
  ] as const) {
    describe(`thema ${name}`, () => {
      const colors = (key: string) => {
        // Waarden die niet gedefinieerd zijn in het donkere blok erven van licht.
        return palette[key] ?? light[key]!;
      };

      it('heeft leesbare tekst (minstens 4,5 : 1)', () => {
        expect(contrast(colors('text'), colors('bg'))).toBeGreaterThanOrEqual(4.5);
        expect(contrast(colors('text'), colors('surface'))).toBeGreaterThanOrEqual(4.5);
        expect(contrast(colors('text-muted'), colors('bg'))).toBeGreaterThanOrEqual(4.5);
        expect(contrast(colors('text-muted'), colors('surface'))).toBeGreaterThanOrEqual(4.5);
      });

      it('heeft leesbare links en knoppen (minstens 4,5 : 1)', () => {
        expect(contrast(colors('accent'), colors('bg'))).toBeGreaterThanOrEqual(4.5);
        expect(contrast(colors('accent'), colors('surface'))).toBeGreaterThanOrEqual(4.5);
        expect(contrast(colors('accent-contrast'), colors('accent'))).toBeGreaterThanOrEqual(4.5);
      });

      it('heeft een goed zichtbare focusring (minstens 3 : 1)', () => {
        expect(contrast(colors('focus'), colors('bg'))).toBeGreaterThanOrEqual(3);
        expect(contrast(colors('focus'), colors('surface'))).toBeGreaterThanOrEqual(3);
      });
    });
  }
});

describe('script tegen het oplichten bij laden', () => {
  it('gebruikt dezelfde opslagsleutel als de app', () => {
    expect(html).toContain(`'${THEME_STORAGE_KEY}'`);
  });
});
