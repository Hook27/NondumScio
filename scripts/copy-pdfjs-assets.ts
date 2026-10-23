// Kopieert de hulpbestanden van pdf.js naar public/pdfjs/, zodat ze met de site worden
// meegeleverd. pdf.js laadt ze alleen als een PDF erom vraagt:
//   wasm/            decodeerders voor gescande afbeeldingen (JBIG2, JPEG 2000) en kleurbeheer
//   cmaps/           tekentabellen, onder meer voor Chinese, Japanse en Koreaanse tekst
//   standard_fonts/  de standaardlettertypen voor PDF's die hun lettertype niet bevatten
//   iccs/            kleurprofielen
//
// Gebruik: node scripts/copy-pdfjs-assets.ts  (draait vanzelf vóór `npm run dev` en `npm run build`)
import { copyFileSync, existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

export const PDFJS_ASSET_DIRS = ['wasm', 'cmaps', 'standard_fonts', 'iccs'] as const;

/**
 * Kopieert een map met alles erin. Bewust zonder `cpSync`: die faalde op Windows in een
 * pad met een niet-Engelse letter (zoals "ö") met "EIO, Access is denied".
 */
function copyDir(source: string, target: string): void {
  mkdirSync(target, { recursive: true });
  for (const entry of readdirSync(source, { withFileTypes: true })) {
    const from = join(source, entry.name);
    const to = join(target, entry.name);
    if (entry.isDirectory()) copyDir(from, to);
    else copyFileSync(from, to);
  }
}

/** Kopieert de mappen van `from` (pdfjs-dist) naar `to`; een oude kopie wordt eerst weggehaald. */
export function copyPdfjsAssets(from: string, to: string): string[] {
  const copied: string[] = [];
  for (const dir of PDFJS_ASSET_DIRS) {
    const source = join(from, dir);
    if (!existsSync(source)) throw new Error(`Map ontbreekt in pdfjs-dist: ${dir}`);
    const target = join(to, dir);
    rmSync(target, { recursive: true, force: true });
    copyDir(source, target);
    copied.push(dir);
  }
  return copied;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const copied = copyPdfjsAssets(join('node_modules', 'pdfjs-dist'), join('public', 'pdfjs'));
  console.log(`pdf.js-hulpbestanden gekopieerd: ${copied.join(', ')}`);
}
