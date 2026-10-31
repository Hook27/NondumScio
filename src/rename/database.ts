/**
 * Slim hernoemen: de database met afzenders en onderwerpen. Wat je invult, wordt onthouden (zodat
 * je steeds dezelfde naam gebruikt), en met herkenwoorden vult de tool een naam zelf in. Overgenomen
 * uit Jörgs `pdf-hernoemer.html`; de vorm van de export is dezelfde, zodat een bestand in beide werkt.
 */

import { readItem, writeItem, type StorageLike, browserStorage } from '../lib/storage';
import { stamp } from './stamp';

/** Een afzender of onderwerp: de naam in de bestandsnaam, en woorden waaraan hij te herkennen is. */
export type DbEntry = { naam: string; triggers: string[] };

/** De hele database, in de vorm van de export van de HTML-tool (vandaar de Nederlandse sleutels). */
export type RenameDb = { afzenders: DbEntry[]; onderwerpen: DbEntry[] };

export type DbKind = keyof RenameDb;

export const DB_STORAGE_KEY = 'nondumscio:rename-db';

/**
 * De naam van de export: die van de HTML-tool, met een datum-tijdstempel erachter
 * (`pdf-hernoemer-database_20261101_1430.json`), zodat een nieuwe export een oude niet overschrijft.
 */
export function dbFileName(now = new Date()): string {
  return `pdf-hernoemer-database_${stamp(now)}.json`;
}

export function emptyDb(): RenameDb {
  return { afzenders: [], onderwerpen: [] };
}

/** Is dit iets met de vorm van een database (of een export)? */
function isDbShape(value: unknown): value is { afzenders: unknown[]; onderwerpen: unknown[] } {
  const object = value as { afzenders?: unknown; onderwerpen?: unknown } | null;
  return (
    typeof object === 'object' &&
    object !== null &&
    Array.isArray(object.afzenders) &&
    Array.isArray(object.onderwerpen)
  );
}

/** Een regel zoals hij bewaard is, met wat ontbreekt of niet klopt rechtgezet. */
function cleanEntry(raw: unknown): DbEntry {
  const entry = raw as { naam?: unknown; triggers?: unknown } | null;
  return {
    naam: typeof entry?.naam === 'string' ? entry.naam : '',
    triggers: Array.isArray(entry?.triggers) ? entry.triggers.map(String) : [],
  };
}

/** De bewaarde database, of een lege als er niets (bruikbaars) staat. */
export function loadDb(storage: StorageLike | null = browserStorage()): RenameDb {
  try {
    const stored: unknown = JSON.parse(readItem(DB_STORAGE_KEY, storage) ?? 'null');
    if (isDbShape(stored)) {
      return {
        afzenders: stored.afzenders.map(cleanEntry),
        onderwerpen: stored.onderwerpen.map(cleanEntry),
      };
    }
  } catch {
    // Kapotte inhoud: dan begint de database leeg.
  }
  return emptyDb();
}

export function saveDb(db: RenameDb, storage: StorageLike | null = browserStorage()): void {
  writeItem(DB_STORAGE_KEY, JSON.stringify(db), storage);
}

/** De database als export-bestand (zoals de HTML-tool hem schrijft). */
export function exportDb(db: RenameDb): string {
  return JSON.stringify(db, null, 2);
}

/** Een export lezen. Gooit een fout als het geen database-export is. */
export function parseExport(text: string): { afzenders: unknown[]; onderwerpen: unknown[] } {
  const parsed: unknown = JSON.parse(text);
  if (!isDbShape(parsed)) throw new Error('onverwachte structuur');
  return parsed;
}

/** Namen die gelijk zijn op hoofdletters na, zijn dezelfde. */
const sameName = (entry: DbEntry, naam: string) =>
  (entry.naam || '').toLowerCase() === naam.toLowerCase();

/**
 * Onthoudt een ingevulde naam, als die er nog niet is (hoofdletters tellen niet mee). Geeft
 * dezelfde database terug als er niets bij kwam.
 */
export function learn(db: RenameDb, kind: DbKind, value: string): RenameDb {
  const naam = (value || '').trim();
  if (!naam || db[kind].some((entry) => sameName(entry, naam))) return db;
  return { ...db, [kind]: [...db[kind], { naam, triggers: [] }] };
}

/**
 * Herkent een naam aan zijn herkenwoorden in de tekst (hoofdletters tellen niet mee). Bij meer
 * treffers wint het langste herkenwoord; bij gelijke lengte de eerste. Zonder treffer: `null`.
 */
export function recognize(list: readonly DbEntry[], text: string): string | null {
  const low = text.toLowerCase();
  let best: string | null = null;
  let bestLength = 0;
  for (const entry of list) {
    if (!entry.naam) continue;
    for (const trigger of entry.triggers || []) {
      const word = trigger.trim().toLowerCase();
      if (word && word.length > bestLength && low.includes(word)) {
        best = entry.naam;
        bestLength = word.length;
      }
    }
  }
  return best;
}

/**
 * Voegt een binnenkomende lijst samen met een bestaande: een naam die er al is (hoofdletters tellen
 * niet mee) krijgt de nieuwe herkenwoorden erbij, een nieuwe naam komt achteraan. Regels zonder naam
 * vallen weg. Geeft de nieuwe lijst en hoeveel namen er nieuw bij kwamen.
 */
export function mergeList(
  target: readonly DbEntry[],
  incoming: readonly unknown[],
): { list: DbEntry[]; added: number } {
  const list = target.map((entry) => ({ ...entry, triggers: [...entry.triggers] }));
  let added = 0;
  for (const raw of incoming) {
    const entry = raw as { naam?: unknown; triggers?: unknown } | null;
    const naam = typeof entry?.naam === 'string' ? entry.naam.trim() : '';
    if (!naam) continue;
    const triggers = Array.isArray(entry?.triggers)
      ? entry.triggers.map((trigger) => String(trigger).trim()).filter(Boolean)
      : [];
    const known = list.find((existing) => sameName(existing, naam));
    if (known) {
      const have = new Set(known.triggers.map((trigger) => trigger.toLowerCase()));
      for (const trigger of triggers) {
        if (!have.has(trigger.toLowerCase())) {
          known.triggers.push(trigger);
          have.add(trigger.toLowerCase());
        }
      }
    } else {
      list.push({ naam, triggers });
      added += 1;
    }
  }
  return { list, added };
}

/** Een export bij de database voegen (zie `mergeList`), met hoeveel er per soort nieuw is. */
export function importInto(
  db: RenameDb,
  text: string,
): { db: RenameDb; added: Record<DbKind, number> } {
  const incoming = parseExport(text);
  const afzenders = mergeList(db.afzenders, incoming.afzenders);
  const onderwerpen = mergeList(db.onderwerpen, incoming.onderwerpen);
  return {
    db: { afzenders: afzenders.list, onderwerpen: onderwerpen.list },
    added: { afzenders: afzenders.added, onderwerpen: onderwerpen.added },
  };
}

/** Herkenwoorden zoals ze getypt worden: gescheiden door komma's. */
export function parseTriggers(text: string): string[] {
  return text
    .split(',')
    .map((trigger) => trigger.trim())
    .filter(Boolean);
}

/** De namen voor de suggesties bij het typen (zonder lege). */
export function suggestions(list: readonly DbEntry[]): string[] {
  return list.filter((entry) => entry.naam).map((entry) => entry.naam);
}
