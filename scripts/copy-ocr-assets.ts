// Kopieert de bestanden voor tekstherkenning (OCR) naar public/ocr/, zodat ze met de site
// worden meegeleverd en er nooit iets van een andere server komt. De browser laadt ze pas als
// iemand OCR aanzet:
//   worker.min.js     de werker van tesseract.js
//   core/             de herkenner zelf (WebAssembly), drie varianten; de browser kiest de snelste
//   lang/             taaldata voor Nederlands en Engels (de "best_int"-modellen)
//
// Gebruik: node scripts/copy-ocr-assets.ts  (draait vanzelf vóór `npm run dev` en `npm run build`)
import { copyFileSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { pathToFileURL } from 'node:url';

export const OCR_LANGUAGES = ['nld', 'eng'] as const;
export const OCR_CORE_FILES = [
  'tesseract-core-relaxedsimd-lstm.wasm.js',
  'tesseract-core-simd-lstm.wasm.js',
  'tesseract-core-lstm.wasm.js',
] as const;
/** De map met de taaldata die we kiezen: kleiner dan de volledige modellen, bijna even nauwkeurig. */
export const OCR_LANG_VARIANT = '4.0.0_best_int';

/** Kopieert de OCR-bestanden uit `modules` (node_modules) naar `to`; een oude kopie gaat eerst weg. */
export function copyOcrAssets(modules: string, to: string): string[] {
  const copied: string[] = [];
  const copy = (from: string, target: string) => {
    if (!existsSync(from)) throw new Error(`Bestand ontbreekt voor OCR: ${from}`);
    mkdirSync(join(target, '..'), { recursive: true });
    copyFileSync(from, target);
    copied.push(relative(to, target).split(sep).join('/'));
  };
  rmSync(to, { recursive: true, force: true });
  copy(join(modules, 'tesseract.js', 'dist', 'worker.min.js'), join(to, 'worker.min.js'));
  for (const file of OCR_CORE_FILES) {
    copy(join(modules, 'tesseract.js-core', file), join(to, 'core', file));
  }
  for (const language of OCR_LANGUAGES) {
    const file = `${language}.traineddata.gz`;
    copy(
      join(modules, '@tesseract.js-data', language, OCR_LANG_VARIANT, file),
      join(to, 'lang', file),
    );
  }
  return copied;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const copied = copyOcrAssets('node_modules', join('public', 'ocr'));
  console.log(`OCR-bestanden gekopieerd: ${copied.join(', ')}`);
}
