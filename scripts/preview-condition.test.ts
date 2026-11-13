import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * Het live voorbeeld van een PR wordt gebouwd met schrijfrechten op de repo (zie
 * .github/workflows/deploy.yml). Een PR van Dependabot hoort dat niet te krijgen. De voorwaarde
 * moet daarom naar de maker van de PR kijken, en niet naar `github.actor`: dat is degene die de
 * run start, en wie een Dependabot-PR bijwerkt of de run opnieuw start, is zelf de actor.
 */
const workflow = readFileSync('.github/workflows/deploy.yml', 'utf-8');

/** De voorwaarde (`if:`) van de taak `preview`, tot de volgende sleutel van die taak. */
function previewCondition(text: string): string {
  const job = /\n {2}preview:\n([\s\S]*?)\n {2}\w[\w-]*:\n/.exec(`${text}\n  einde:\n`)?.[1] ?? '';
  return /\n? {4}if: >-\n((?: {6}.*\n?)+)/.exec(job)?.[1] ?? '';
}

describe('voorbeeld van een PR', () => {
  const condition = previewCondition(workflow);

  it('heeft een voorwaarde', () => {
    expect(condition).toContain("github.event_name == 'pull_request'");
  });

  it('slaat een PR van Dependabot over op de maker van de PR, niet op wie de run start', () => {
    expect(condition).toContain("github.event.pull_request.user.login != 'dependabot[bot]'");
    expect(condition).not.toContain('github.actor');
  });

  it('alleen voor PR’s uit deze repo (een fork krijgt geen schrijfrechten)', () => {
    expect(condition).toContain(
      'github.event.pull_request.head.repo.full_name == github.repository',
    );
  });
});
