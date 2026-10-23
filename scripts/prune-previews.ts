// Ruimt restanten van gesloten voorbeelden op. Bij het sluiten van een PR haalt de
// voorbeeld-actie de inhoud weg, maar zij laat verborgen bestanden (.nojekyll, CNAME)
// achter. Zo'n map zonder echte inhoud is een restant en kan weg.
//
// Gebruik: node scripts/prune-previews.ts <map met voorbeelden>
// Schrijft de namen van de verwijderde mappen naar de uitvoer, één per regel.
import { existsSync, readdirSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

/** Alleen deze bestanden tellen niet mee als "echte inhoud". */
const IGNORED_FILES = new Set(['.nojekyll', 'CNAME']);

const PREVIEW_DIR = /^pr-\d+$/;

function hasRealContent(dir: string): boolean {
  return readdirSync(dir, { withFileTypes: true }).some((entry) => {
    if (entry.isDirectory()) return hasRealContent(join(dir, entry.name));
    return !IGNORED_FILES.has(entry.name);
  });
}

/** Verwijdert voorbeeldmappen (`pr-<nummer>`) zonder echte inhoud en geeft hun namen terug. */
export function prunePreviews(umbrellaDir: string): string[] {
  if (!existsSync(umbrellaDir)) return [];

  const removed: string[] = [];
  for (const name of readdirSync(umbrellaDir).sort()) {
    const dir = join(umbrellaDir, name);
    if (!PREVIEW_DIR.test(name) || !statSync(dir).isDirectory()) continue;
    if (hasRealContent(dir)) continue;

    rmSync(dir, { recursive: true, force: true });
    removed.push(name);
  }
  return removed;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const umbrellaDir = process.argv[2];
  if (!umbrellaDir) {
    console.error('Gebruik: node scripts/prune-previews.ts <map met voorbeelden>');
    process.exit(2);
  }
  for (const name of prunePreviews(umbrellaDir)) console.log(name);
}
