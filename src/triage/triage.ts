/**
 * Archief / Triage: de rekenregels, los van het scherm. Overgenomen uit de losse pdf-triage.html
 * (de lijst) en DocumentTriage (verplaatsen naar een map, naar het volgende nog niet beoordeelde
 * bestand).
 */

import type { FileEntryHandle } from './folders';

/** Verplaatsen naar een map (in de lijstvariant de naam zoals je hem typte). */
export type Move = { move: string };

/** Het besluit over een PDF; `null` = nog niet beoordeeld. */
export type Decision = 'keep' | 'remove' | Move | null;

/** Een besluit dat je kunt nemen (dus niet "nog niet beoordeeld"). */
export type Choice = Exclude<Decision, null>;

/** Een PDF in de lijst, met het besluit en de pagina waar je was. */
export type TriageFile = {
  /** Vast nummer, ook als de lijst verandert. */
  id: number;
  file: File;
  name: string;
  decision: Decision;
  page: number;
  /** Bij Map opruimen: de mappen tussen de bronmap en het bestand (leeg = in de bronmap). */
  dirs?: string[];
  /** Bij Map opruimen: het bestand in de map, om het later te verplaatsen. */
  handle?: FileEntryHandle;
};

/** Hoe een PDF in de lijsten heet: bij Map opruimen met de submap ervoor ("2024/brief.pdf"). */
export const labelOf = (entry: TriageFile): string =>
  entry.dirs && entry.dirs.length > 0 ? `${entry.dirs.join('/')}/${entry.name}` : entry.name;

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

/** Of een besluit verplaatsen is. */
export const isMove = (decision: Decision): decision is Move =>
  typeof decision === 'object' && decision !== null;

/** Twee mapnamen zijn dezelfde map als ze alleen in hoofdletters verschillen. */
export const sameFolder = (a: string, b: string): boolean =>
  a.toLocaleLowerCase('nl') === b.toLocaleLowerCase('nl');

/** Of twee besluiten hetzelfde zijn (verplaatsen: naar dezelfde map). */
export function sameDecision(a: Decision, b: Decision): boolean {
  if (isMove(a) && isMove(b)) return sameFolder(a.move, b.move);
  return a === b;
}

/** Nog eens dezelfde keuze haalt het besluit weg; een andere keuze vervangt het. */
export const toggle = (current: Decision, choice: Choice): Decision =>
  sameDecision(current, choice) ? null : choice;

/**
 * Een map toevoegen aan de gekozen mappen: de naam zonder spaties aan begin en eind. Staat de map
 * er al (ook met andere hoofdletters), dan blijft de lijst gelijk en telt de naam zoals hij er
 * staat. Een lege naam is geen map (`name` null).
 */
export function addFolder(
  folders: readonly string[],
  typed: string,
): { folders: string[]; name: string | null } {
  const name = typed.trim();
  if (name === '') return { folders: [...folders], name: null };
  const existing = folders.find((folder) => sameFolder(folder, name));
  if (existing !== undefined) return { folders: [...folders], name: existing };
  return { folders: [...folders, name], name };
}

/**
 * De gekozen mappen op naam, zoals in DocumentTriage; de eerste negen hebben een sneltoets 1–9.
 * Met `lastPart` (bij Map opruimen, waar een map een pad is) op de naam van de map zelf, zoals
 * DocumentTriage, en bij gelijke namen op het hele pad.
 */
export function sortFolders(folders: readonly string[], lastPart = false): string[] {
  const compare = (a: string, b: string) => a.localeCompare(b, 'nl', { sensitivity: 'base' });
  const name = (folder: string) => (lastPart ? folder.slice(folder.lastIndexOf('/') + 1) : folder);
  return [...folders].sort((a, b) => compare(name(a), name(b)) || compare(a, b));
}

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

/** Hoeveel er beoordeeld, bewaard, verplaatst en verwijderd zijn. */
export function counts(list: readonly TriageFile[]) {
  const keep = list.filter((entry) => entry.decision === 'keep').length;
  const move = list.filter((entry) => isMove(entry.decision)).length;
  const remove = list.filter((entry) => entry.decision === 'remove').length;
  return { keep, move, remove, done: keep + move + remove, total: list.length };
}

/** De groepen van het overzicht, in de volgorde van de lijst. */
export function groups(list: readonly TriageFile[]) {
  return {
    keep: list.filter((entry) => entry.decision === 'keep'),
    move: list.filter((entry) => isMove(entry.decision)),
    remove: list.filter((entry) => entry.decision === 'remove'),
    none: list.filter((entry) => entry.decision === null),
  };
}

/** Per map de PDF's die erheen gaan, de mappen op naam. */
export function byFolder(list: readonly TriageFile[]): { folder: string; files: TriageFile[] }[] {
  const moved = groups(list).move;
  const folders: string[] = [];
  for (const entry of moved) {
    const folder = (entry.decision as Move).move;
    if (!folders.some((f) => sameFolder(f, folder))) folders.push(folder);
  }
  return sortFolders(folders).map((folder) => ({
    folder,
    files: moved.filter((entry) => sameFolder((entry.decision as Move).move, folder)),
  }));
}

/** De woorden in de lijsten (in de taal van de app). */
export type ExportTexts = {
  title: string;
  keep: string;
  /** "VERPLAATSEN NAAR {folder}". */
  move: string;
  remove: string;
  none: string;
  columnName: string;
  columnDecision: string;
  columnFolder: string;
  decisions: { keep: string; move: string; remove: string; none: string };
};

/**
 * De lijst als tekst, zoals triage.txt van pdf-triage.html: titel, een lijn van 36 '=', en per
 * groep die niet leeg is de kop met ':' en de namen ingesprongen met twee spaties, met een witregel.
 * Verplaatsen staat tussen bewaren en verwijderen, met een groep per map (op naam).
 */
export function triageTxt(list: readonly TriageFile[], texts: ExportTexts): string {
  const lines = [texts.title, '='.repeat(36), ''];
  const all = groups(list);
  const group = (head: string, entries: readonly TriageFile[]) => {
    if (entries.length === 0) return;
    lines.push(`${head}:`);
    for (const entry of entries) lines.push(`  ${labelOf(entry)}`);
    lines.push('');
  };
  group(texts.keep, all.keep);
  // Met een functie: een "$" in de mapnaam blijft zo gewoon een "$".
  for (const { folder, files } of byFolder(list))
    group(
      texts.move.replace('{folder}', () => folder),
      files,
    );
  group(texts.remove, all.remove);
  group(texts.none, all.none);
  return lines.join('\n');
}

/**
 * De lijst als CSV, zoals triage.csv van pdf-triage.html: elke cel tussen aanhalingstekens
 * (aanhalingstekens erin verdubbeld), komma's ertussen, in de volgorde van de lijst. Met een derde
 * kolom voor de map, alleen ingevuld bij verplaatsen.
 */
export function triageCsv(list: readonly TriageFile[], texts: ExportTexts): string {
  const rows = [[texts.columnName, texts.columnDecision, texts.columnFolder]];
  for (const entry of list) {
    const { decision } = entry;
    const name = labelOf(entry);
    if (isMove(decision)) rows.push([name, texts.decisions.move, decision.move]);
    else rows.push([name, texts.decisions[decision ?? 'none'], '']);
  }
  return rows.map((row) => row.map((cell) => `"${cell.replace(/"/g, '""')}"`).join(',')).join('\n');
}

/**
 * De naam van de download met datum en tijd (lokale tijd): `triage_2026-11-07_1830.txt`. Zonder
 * dubbele punt, want die mag niet in een bestandsnaam op Windows.
 */
export function exportName(date: Date, extension: 'txt' | 'csv'): string {
  const two = (n: number) => String(n).padStart(2, '0');
  const day = `${date.getFullYear()}-${two(date.getMonth() + 1)}-${two(date.getDate())}`;
  return `triage_${day}_${two(date.getHours())}${two(date.getMinutes())}.${extension}`;
}
