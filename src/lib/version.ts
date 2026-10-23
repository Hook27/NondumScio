/** `PR.009`: het versienummer volgt het nummer van de pull request waarmee de wijziging binnenkwam. */
export function formatPrVersion(prNumber: number): string {
  if (!Number.isInteger(prNumber) || prNumber < 1) {
    throw new RangeError(`Ongeldig PR-nummer: ${prNumber}`);
  }
  return `PR.${String(prNumber).padStart(3, '0')}`;
}

/**
 * Haalt het PR-nummer uit de eerste regel van een commitbericht. Herkent een
 * gewone merge ("Merge pull request #9 from ...") en een squash-merge
 * ("Titel (#9)"). Geeft `null` als er geen PR-nummer in staat.
 */
export function parsePrNumber(subject: string): number | null {
  const merge = /^Merge pull request #(\d+)\b/.exec(subject);
  if (merge?.[1]) return Number(merge[1]);

  const squash = /\(#(\d+)\)\s*$/.exec(subject);
  if (squash?.[1]) return Number(squash[1]);

  return null;
}

/**
 * Het versielabel voor een build: het PR-nummer als dat bekend is, anders de
 * korte commitcode, anders "dev".
 */
export function versionLabel(input: { pr?: number; subject?: string; sha?: string }): string {
  const pr = input.pr ?? (input.subject ? parsePrNumber(input.subject) : null);
  if (pr) return formatPrVersion(pr);
  if (input.sha) return input.sha.slice(0, 7);
  return 'dev';
}
