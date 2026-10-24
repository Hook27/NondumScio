import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * De browsertests in GitHub draaien in de kant-en-klare Playwright-omgeving van Microsoft
 * (zie .github/workflows/tests.yml). Die omgeving bevat één vaste browserversie. Wijkt de
 * versie van @playwright/test in ons project daarvan af (bijvoorbeeld na een update door
 * Dependabot), dan vindt Playwright zijn browser niet en lopen alle browsertests vast met
 * een vage fout. Deze test geeft dan meteen een duidelijke melding.
 */
const workflow = readFileSync('.github/workflows/tests.yml', 'utf-8');
const lockfile = JSON.parse(readFileSync('package-lock.json', 'utf-8')) as {
  packages: Record<string, { version?: string }>;
};

const IMAGE = /mcr\.microsoft\.com\/playwright:v(\d+\.\d+\.\d+)-(\w+)/g;

describe('Playwright-omgeving in GitHub', () => {
  const images = [...workflow.matchAll(IMAGE)];
  const playwright = lockfile.packages['node_modules/@playwright/test']?.version;

  it('gebruikt een kant-en-klare Playwright-omgeving', () => {
    expect(images.length).toBeGreaterThan(0);
  });

  it('heeft dezelfde versie als @playwright/test in package-lock.json', () => {
    expect(playwright).toBeDefined();
    for (const [image, version] of images) {
      expect(version, `Werk ${image} in .github/workflows/tests.yml bij naar v${playwright}`).toBe(
        playwright,
      );
    }
  });
});
