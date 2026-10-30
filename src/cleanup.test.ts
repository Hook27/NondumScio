import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Preact ruimt effecten soms pas op na een korte timer. Eindigt een testbestand net daarvoor, dan
 * heeft Vitest de testomgeving (en daarmee `document` en `window`) al weggehaald. Een opruimfunctie
 * die dan nog de globale `document` of `window` gebruikt, geeft "document is not defined" en laat
 * een test wisselvallig mislukken (zo gebeurd op GitHub). Daarom onthouden ze hun doel bij het
 * aanzetten (`const doc = document; … return () => doc.removeEventListener(…)`).
 */

/** Alle bronbestanden van de app (geen tests). */
function sourceFiles(dir = join(process.cwd(), 'src')): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : [];
  });
}

describe('opruimen, ook als de testomgeving al weg is', () => {
  it('geen opruimfunctie gebruikt de globale document of window', () => {
    const offenders = sourceFiles().flatMap((file) =>
      readFileSync(file, 'utf8')
        .split('\n')
        .flatMap((line, i) =>
          /\b(document|window)\.(removeEventListener|clearTimeout)\(/.test(line)
            ? [`${file.slice(process.cwd().length + 1)}:${i + 1}`]
            : [],
        ),
    );
    expect(offenders).toEqual([]);
  });
});
