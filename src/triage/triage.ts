/**
 * Archief / Triage: de rekenregels, los van het scherm. Overgenomen uit de losse pdf-triage.html
 * (de lijst) en DocumentTriage (naar het volgende nog niet beoordeelde bestand).
 */

/** Het besluit over een PDF; `null` = nog niet beoordeeld. */
export type Decision = 'keep' | 'remove' | null;

/** Een PDF in de lijst, met het besluit en de pagina waar je was. */
export type TriageFile = {
  /** Vast nummer, ook als de lijst verandert. */
  id: number;
  file: File;
  name: string;
  decision: Decision;
  page: number;
};

/** Of het bestand een PDF is: op naam (".pdf", ook in hoofdletters) of op het opgegeven type. */
export const isPdfFile = (file: File): boolean =>
  /\.pdf$/i.test(file.name) || file.type === 'application/pdf';

/**
 * Voegt PDF's toe aan het eind van de lijst. Andere bestanden en een naam die al in de lijst staat
 * worden overgeslagen, zoals in pdf-triage.html; hier ook een tweede keer dezelfde naam in één
 * keer kiezen.
 */
export function addFiles(
  list: readonly TriageFile[],
  files: readonly File[],
  nextId: number,
): { list: TriageFile[]; notPdf: number; duplicate: number; nextId: number } {
  const names = new Set(list.map((entry) => entry.name));
  const added: TriageFile[] = [];
  let notPdf = 0;
  let duplicate = 0;
  let id = nextId;
  for (const file of files) {
    if (!isPdfFile(file)) notPdf++;
    else if (names.has(file.name)) duplicate++;
    else {
      names.add(file.name);
      added.push({ id: id++, file, name: file.name, decision: null, page: 1 });
    }
  }
  return { list: [...list, ...added], notPdf, duplicate, nextId: id };
}

/** Nog eens dezelfde keuze haalt het besluit weg; een andere keuze vervangt het. */
export const toggle = (current: Decision, choice: Exclude<Decision, null>): Decision =>
  current === choice ? null : choice;

/**
 * Waar je na een besluit heen gaat: het eerstvolgende bestand dat nog niet beoordeeld is; is er
 * na dit bestand geen meer, dan gewoon het volgende; bij het laatste bestand blijf je staan (null).
 * Zoals in DocumentTriage.
 */
export function nextAfter(list: readonly TriageFile[], current: number): number | null {
  const open = list.findIndex((entry, i) => i > current && entry.decision === null);
  if (open !== -1) return open;
  return current < list.length - 1 ? current + 1 : null;
}

/** Hoeveel er beoordeeld, bewaard en verwijderd zijn. */
export function counts(list: readonly TriageFile[]) {
  const keep = list.filter((entry) => entry.decision === 'keep').length;
  const remove = list.filter((entry) => entry.decision === 'remove').length;
  return { keep, remove, done: keep + remove, total: list.length };
}

/** De drie groepen van het overzicht, in de volgorde van de lijst. */
export function groups(list: readonly TriageFile[]) {
  return {
    keep: list.filter((entry) => entry.decision === 'keep'),
    remove: list.filter((entry) => entry.decision === 'remove'),
    none: list.filter((entry) => entry.decision === null),
  };
}

/** De woorden in de lijsten (in de taal van de app). */
export type ExportTexts = {
  title: string;
  keep: string;
  remove: string;
  none: string;
  columnName: string;
  columnDecision: string;
  decisions: { keep: string; remove: string; none: string };
};

/**
 * De lijst als tekst, zoals triage.txt van pdf-triage.html: titel, een lijn van 36 '=', en per
 * groep die niet leeg is de kop met ':' en de namen ingesprongen met twee spaties, met een witregel.
 */
export function triageTxt(list: readonly TriageFile[], texts: ExportTexts): string {
  const lines = [texts.title, '='.repeat(36), ''];
  const all = groups(list);
  for (const key of ['keep', 'remove', 'none'] as const) {
    if (all[key].length === 0) continue;
    lines.push(`${texts[key]}:`);
    for (const entry of all[key]) lines.push(`  ${entry.name}`);
    lines.push('');
  }
  return lines.join('\n');
}

/**
 * De lijst als CSV, zoals triage.csv van pdf-triage.html: elke cel tussen aanhalingstekens
 * (aanhalingstekens erin verdubbeld), komma's ertussen, in de volgorde van de lijst.
 */
export function triageCsv(list: readonly TriageFile[], texts: ExportTexts): string {
  const rows = [[texts.columnName, texts.columnDecision]];
  for (const entry of list) rows.push([entry.name, texts.decisions[entry.decision ?? 'none']]);
  return rows.map((row) => row.map((cell) => `"${cell.replace(/"/g, '""')}"`).join(',')).join('\n');
}
