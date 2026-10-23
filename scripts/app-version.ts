// Bepaalt het versielabel voor een build en schrijft het naar de uitvoer.
// Gebruik (Node 24 draait dit bestand rechtstreeks):
//   node scripts/app-version.ts --pr 9
//   node scripts/app-version.ts --subject "Merge pull request #9 from ..." --sha <commit>
import { versionLabel } from '../src/lib/version.ts';

const args = process.argv.slice(2);

function option(name: string): string | undefined {
  const index = args.indexOf(`--${name}`);
  return index >= 0 ? args[index + 1] : undefined;
}

const pr = option('pr');
console.log(
  versionLabel({
    ...(pr ? { pr: Number(pr) } : {}),
    ...(option('subject') ? { subject: option('subject') as string } : {}),
    ...(option('sha') ? { sha: option('sha') as string } : {}),
  }),
);
