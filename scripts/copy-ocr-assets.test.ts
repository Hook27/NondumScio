import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { OCR_CORE_FILES, OCR_LANGUAGES, OCR_LANG_VARIANT, copyOcrAssets } from './copy-ocr-assets';

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'ocr-assets-'));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function put(path: string, content: string) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
}

function fakeModules() {
  const modules = join(root, 'node_modules');
  put(join(modules, 'tesseract.js', 'dist', 'worker.min.js'), 'worker');
  for (const file of OCR_CORE_FILES) put(join(modules, 'tesseract.js-core', file), file);
  for (const language of OCR_LANGUAGES) {
    put(
      join(modules, '@tesseract.js-data', language, OCR_LANG_VARIANT, `${language}.traineddata.gz`),
      language,
    );
  }
  return modules;
}

describe('copyOcrAssets', () => {
  it('kopieert de werker, de herkenner en de taaldata', () => {
    const to = join(root, 'public', 'ocr');
    const copied = copyOcrAssets(fakeModules(), to);
    expect(copied).toContain('worker.min.js');
    expect(readFileSync(join(to, 'core', OCR_CORE_FILES[1]), 'utf-8')).toBe(OCR_CORE_FILES[1]);
    expect(readFileSync(join(to, 'lang', 'nld.traineddata.gz'), 'utf-8')).toBe('nld');
    expect(readFileSync(join(to, 'lang', 'eng.traineddata.gz'), 'utf-8')).toBe('eng');
  });

  it('haalt een oude kopie eerst weg', () => {
    const to = join(root, 'public', 'ocr');
    put(join(to, 'oud.bin'), 'oud');
    copyOcrAssets(fakeModules(), to);
    expect(existsSync(join(to, 'oud.bin'))).toBe(false);
  });

  it('meldt het duidelijk als een bestand ontbreekt', () => {
    const modules = fakeModules();
    rmSync(join(modules, 'tesseract.js-core', OCR_CORE_FILES[0]));
    expect(() => copyOcrAssets(modules, join(root, 'uit'))).toThrow(OCR_CORE_FILES[0]);
  });

  it('vindt alle bestanden in de echte pakketten', () => {
    const to = join(root, 'echt');
    expect(copyOcrAssets('node_modules', to).length).toBe(1 + OCR_CORE_FILES.length + 2);
  });
});
