import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PDFJS_ASSET_DIRS, copyPdfjsAssets } from './copy-pdfjs-assets';

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'pdfjs-assets-'));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function fakePdfjs() {
  const from = join(root, 'pdfjs-dist');
  for (const dir of PDFJS_ASSET_DIRS) {
    mkdirSync(join(from, dir), { recursive: true });
    writeFileSync(join(from, dir, `${dir}.bin`), dir);
  }
  return from;
}

describe('copyPdfjsAssets', () => {
  it('kopieert alle hulpmappen', () => {
    const to = join(root, 'public', 'pdfjs');
    expect(copyPdfjsAssets(fakePdfjs(), to)).toEqual([...PDFJS_ASSET_DIRS]);
    for (const dir of PDFJS_ASSET_DIRS) {
      expect(readFileSync(join(to, dir, `${dir}.bin`), 'utf-8')).toBe(dir);
    }
  });

  it('haalt een oude kopie eerst weg', () => {
    const to = join(root, 'public', 'pdfjs');
    mkdirSync(join(to, 'wasm'), { recursive: true });
    writeFileSync(join(to, 'wasm', 'oud.wasm'), 'oud');

    copyPdfjsAssets(fakePdfjs(), to);
    expect(existsSync(join(to, 'wasm', 'oud.wasm'))).toBe(false);
  });

  it('meldt het duidelijk als een map in pdfjs-dist ontbreekt', () => {
    const from = fakePdfjs();
    rmSync(join(from, 'cmaps'), { recursive: true });
    expect(() => copyPdfjsAssets(from, join(root, 'uit'))).toThrow('cmaps');
  });

  it('vindt alle mappen in de echte pdfjs-dist', () => {
    for (const dir of PDFJS_ASSET_DIRS) {
      expect(existsSync(join('node_modules', 'pdfjs-dist', dir)), dir).toBe(true);
    }
  });
});
