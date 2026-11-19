import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { messages } from './i18n';

/**
 * Bedieningsafspraak V9: een knop toont geen los teken (× ✕ ✓ ‹ › ← → ↑ ◀ ▶ − +), maar een gewoon
 * pictogram (`Icon`, `IconButton`) met uitleg bij de muis. En overal dezelfde woorden.
 */

/** Alle onderdelen van de app (geen tests). */
function componentFiles(dir = join(process.cwd(), 'src')): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return componentFiles(path);
    return /\.tsx$/.test(name) && !/\.test\.tsx$/.test(name) ? [path] : [];
  });
}

/** De vaste tekst in een stuk JSX: zonder `{…}` (ook genest) en zonder tags. */
function fixedText(jsx: string): string {
  let text = '';
  let depth = 0;
  for (const char of jsx) {
    if (char === '{') depth += 1;
    else if (char === '}') depth -= 1;
    else if (depth === 0) text += char;
  }
  return text.replace(/<[^>]*>/g, ' ');
}

/** De inhoud van elke `<button>` in de broncode (tussen de openingstag en `</button>`). */
function buttonBodies(source: string): string[] {
  const bodies: string[] = [];
  for (const match of source.matchAll(/<button\b/g)) {
    // Het einde van de openingstag: de eerste > buiten accolades (niet die van een =>).
    let depth = 0;
    let end = match.index + match[0].length;
    for (; end < source.length; end += 1) {
      const char = source[end];
      if (char === '{') depth += 1;
      else if (char === '}') depth -= 1;
      else if (char === '>' && depth === 0) break;
    }
    const close = source.indexOf('</button>', end);
    if (close > end) bodies.push(source.slice(end + 1, close));
  }
  return bodies;
}

const SIGNS = /[×✕✓‹›←→↑↓◀▶−+]/;

describe('pictogrammen in plaats van tekens', () => {
  it('geen knop toont een los teken als vaste tekst', () => {
    const offenders = componentFiles().flatMap((file) =>
      buttonBodies(readFileSync(file, 'utf8'))
        .filter((body) => SIGNS.test(fixedText(body)))
        .map((body) => `${file.slice(process.cwd().length + 1)}: ${fixedText(body).trim()}`),
    );
    expect(offenders).toEqual([]);
  });

  it('vindt een teken, ook na een pijlfunctie en tussen andere tags', () => {
    const source =
      '<button onClick={() => go({ a: 1 })}>\n  →\n</button>' +
      '<button class="x"><span aria-hidden="true">✕</span><span>{t.remove}</span></button>' +
      '<button>{t.keep}</button>';
    expect(buttonBodies(source).map((body) => fixedText(body).trim())).toEqual(['→', '✕', '']);
  });
});

describe('overal dezelfde woorden', () => {
  it('PDF’s toevoegen waar alleen PDF’s kunnen', () => {
    expect(messages.nl.merge.add).toBe('PDF’s toevoegen');
    expect(messages.en.merge.add).toBe('Add PDFs');
  });

  it('Wissen, ook in Triage en in de batch van Platte tekst', () => {
    expect(messages.nl.triage.clear).toBe('Wissen');
    expect(messages.en.triage.clear).toBe('Clear');
    expect(messages.nl.plainText.batch.clearList).toBe('Lijst wissen');
    expect(messages.en.plainText.batch.clearList).toBe('Clear list');
  });

  it('Ongedaan maken en Opnieuw', () => {
    expect(messages.nl.pages.undo).toBe('Ongedaan maken');
    expect(messages.nl.pages.redo).toBe('Opnieuw');
  });
});
