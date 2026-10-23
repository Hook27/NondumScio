import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { prunePreviews } from './prune-previews';

let root: string;

function file(path: string, content = 'x') {
  const full = join(root, path);
  mkdirSync(join(full, '..'), { recursive: true });
  writeFileSync(full, content);
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'prune-previews-'));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('prunePreviews', () => {
  it('laat een voorbeeld met echte inhoud ongemoeid', () => {
    file('pr-12/index.html');
    file('pr-12/.nojekyll', '');
    file('pr-12/CNAME', 'pdf.nondumsc.io');

    expect(prunePreviews(root)).toEqual([]);
    expect(existsSync(join(root, 'pr-12/index.html'))).toBe(true);
  });

  it('verwijdert een voorbeeld dat alleen .nojekyll en CNAME bevat', () => {
    file('pr-7/.nojekyll', '');
    file('pr-7/CNAME', 'pdf.nondumsc.io');

    expect(prunePreviews(root)).toEqual(['pr-7']);
    expect(existsSync(join(root, 'pr-7'))).toBe(false);
  });

  it('verwijdert ook een lege map', () => {
    mkdirSync(join(root, 'pr-3'));
    expect(prunePreviews(root)).toEqual(['pr-3']);
  });

  it('ziet echte inhoud ook in een submap', () => {
    file('pr-5/.nojekyll', '');
    file('pr-5/assets/app.js');

    expect(prunePreviews(root)).toEqual([]);
    expect(existsSync(join(root, 'pr-5/assets/app.js'))).toBe(true);
  });

  it('raakt alleen mappen met de naam pr-<nummer> aan', () => {
    file('overig/.nojekyll', '');
    file('pr-abc/.nojekyll', '');
    file('pr-8.txt');

    expect(prunePreviews(root)).toEqual([]);
    expect(readdirSync(root).sort()).toEqual(['overig', 'pr-8.txt', 'pr-abc']);
  });

  it('behandelt meerdere voorbeelden in één keer, op volgorde', () => {
    file('pr-10/.nojekyll', '');
    file('pr-9/CNAME', 'x');
    file('pr-11/index.html');

    expect(prunePreviews(root)).toEqual(['pr-10', 'pr-9']);
    expect(readdirSync(root)).toEqual(['pr-11']);
  });

  it('geeft niets terug als de map niet bestaat', () => {
    expect(prunePreviews(join(root, 'bestaat-niet'))).toEqual([]);
  });
});
