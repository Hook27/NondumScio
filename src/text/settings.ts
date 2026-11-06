import { GAP_FACTOR } from '../compare/layout';
import { browserStorage } from '../lib/storage';
import { clampZone, type TextOptions, type Zone } from './extract';
import { META_FIELDS, type Meta } from './header';
import { JOINS, type Join } from './pages';

/**
 * Instellingen bewaren: per PDF (op bestandsnaam) in de opslag van de browser, en als .json-bestand
 * om op te slaan en te laden. Het bestand heeft hetzelfde formaat als dat van de losse
 * pdf-tekst-extractor ("v: 2"), zodat instellingen van daar hier werken en andersom. Een optie die
 * deze tool niet kent, gaat ongewijzigd mee.
 */

/** Wat er bewaard wordt. */
export type Settings = {
  options: TextOptions;
  useZones: boolean;
  /** De standaardvakken. */
  zones: Zone[];
  /** Eigen vakken per pagina. */
  pages: Record<number, Zone[]>;
  readEmpty: boolean;
  /** De keuze per pagina-overgang (aansluiting op de vorige pagina). */
  joins: Record<number, Join>;
  /** De gegevens voor de documentkop, zoals ze in de velden staan. */
  meta: Meta;
  /** Wat er in een bestand staat maar hier niet gebruikt wordt; gaat ongewijzigd mee. */
  extra: Extra;
};

export type Extra = {
  /** Opties die deze tool niet kent (bijvoorbeeld van een latere versie van de extractor). */
  options: Record<string, unknown>;
};

/** De opties van de extractor die hier een eigen plek hebben; de rest gaat in `extra`. */
const KNOWN = [
  'useCrop',
  'columns',
  'dehyphen',
  'joinLines',
  'paraGap',
  'readEmpty',
  'structure',
  'headingMarker',
  'tables',
  'anchors',
  'crossPage',
  'metaHeader',
  'conventions',
  'strip',
];

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** Een vak uit een bestand: alleen als het vier getallen heeft, en dan binnen de pagina. */
function readZone(value: unknown): Zone | null {
  if (!isObject(value)) return null;
  const { x0, y0, x1, y1 } = value;
  const numbers = [x0, y0, x1, y1];
  if (!numbers.every((n) => typeof n === 'number' && Number.isFinite(n))) return null;
  return clampZone({ x0: x0 as number, y0: y0 as number, x1: x1 as number, y1: y1 as number });
}

/** De keuzes per overgang: alleen paginanummers vanaf 1 en bekende keuzes. */
function readJoins(value: unknown): Record<number, Join> {
  const joins: Record<number, Join> = {};
  if (!isObject(value)) return joins;
  for (const [key, choice] of Object.entries(value)) {
    const no = Number(key);
    if (Number.isInteger(no) && no >= 1 && JOINS.includes(choice as Join))
      joins[no] = choice as Join;
  }
  return joins;
}

const readZones = (value: unknown): Zone[] =>
  Array.isArray(value) ? value.map(readZone).filter((z): z is Zone => z !== null) : [];

/**
 * De gegevens voor de documentkop: elk veld dat een tekst is, vervangt wat er stond (zoals in de
 * extractor); de rest blijft.
 */
function readMeta(value: unknown, base: Meta): Meta {
  if (!isObject(value)) return base;
  const meta = { ...base };
  for (const field of META_FIELDS) {
    const text = value[field];
    if (typeof text === 'string') meta[field] = text;
  }
  return meta;
}

/** De alinea-gevoeligheid binnen de grenzen van de schuif, op 0,1 afgerond. */
function readGap(value: unknown, fallback: number): number {
  const n = typeof value === 'string' || typeof value === 'number' ? Number(value) : NaN;
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.round(Math.max(GAP_FACTOR.min, Math.min(GAP_FACTOR.max, n)) * 10) / 10;
}

/**
 * Instellingen uit een bestand of de opslag toepassen op `base`. Zoals in de extractor: de vakken
 * worden altijd vervangen (ook door niets), opties alleen als ze er staan, en ook het oude formaat
 * van de extractor ({ d, p } met alleen de vakken) wordt gelezen. Geeft null bij iets wat geen
 * instellingen zijn.
 */
export function fromSettings(raw: unknown, base: Settings): Settings | null {
  if (!isObject(raw)) return null;
  const zones = isObject(raw.zones) ? raw.zones : raw;
  const pages: Record<number, Zone[]> = {};
  if (isObject(zones.p)) {
    for (const [key, value] of Object.entries(zones.p)) {
      const no = Number(key);
      if (Number.isInteger(no) && no >= 1) pages[no] = readZones(value);
    }
  }
  const options = isObject(raw.options) ? raw.options : {};
  const flag = (key: string, fallback: boolean) =>
    typeof options[key] === 'boolean' ? (options[key] as boolean) : fallback;
  const extraOptions = { ...base.extra.options };
  for (const [key, value] of Object.entries(options))
    if (!KNOWN.includes(key) && typeof value === 'boolean') extraOptions[key] = value;
  return {
    options: {
      strip: flag('strip', base.options.strip),
      columns: flag('columns', base.options.columns),
      dehyphen: flag('dehyphen', base.options.dehyphen),
      joinLines: flag('joinLines', base.options.joinLines),
      gapFactor: options.paraGap
        ? readGap(options.paraGap, base.options.gapFactor)
        : base.options.gapFactor,
      structure: flag('structure', base.options.structure),
      headingMarker: flag('headingMarker', base.options.headingMarker),
      tables: flag('tables', base.options.tables),
      anchors: flag('anchors', base.options.anchors),
      crossPage: flag('crossPage', base.options.crossPage),
      header: flag('metaHeader', base.options.header),
      conventions: flag('conventions', base.options.conventions),
    },
    useZones: flag('useCrop', base.useZones),
    zones: readZones(zones.d),
    pages,
    readEmpty: flag('readEmpty', base.readEmpty),
    // Zoals de vakken: altijd vervangen, zoals in de extractor.
    joins: readJoins(raw.joinOverride),
    meta: readMeta(raw.meta, base.meta),
    extra: { options: extraOptions },
  };
}

/** De instellingen in het formaat van de extractor, met de naam van de PDF. */
export function toSettings(pdf: string, settings: Settings) {
  const { options, extra } = settings;
  return {
    v: 2,
    pdf,
    zones: { d: settings.zones, p: settings.pages },
    joinOverride: settings.joins,
    options: {
      useCrop: settings.useZones,
      columns: options.columns,
      dehyphen: options.dehyphen,
      joinLines: options.joinLines,
      // In de extractor is dit de waarde van de schuif: een tekst.
      paraGap: String(options.gapFactor),
      readEmpty: settings.readEmpty,
      anchors: options.anchors,
      crossPage: options.crossPage,
      structure: options.structure,
      headingMarker: options.headingMarker,
      metaHeader: options.header,
      conventions: options.conventions,
      tables: options.tables,
      ...extra.options,
      // Alleen hier: de extractor kent dit niet en slaat het over.
      strip: options.strip,
    },
    // Zoals in de extractor: altijd alle vier de velden.
    meta: { ...settings.meta },
  };
}

/** De naam van het bestand, zoals in de extractor: "brief.pdf" → "brief_instellingen.json". */
export function settingsFileName(pdf: string): string {
  return `${pdf.replace(/\.pdf$/i, '') || 'pdf'}_instellingen.json`;
}

/** Het begin van de sleutels in de opslag van de browser. */
export const SETTINGS_PREFIX = 'nondumscio:plaintext:';

const keyFor = (pdf: string) => SETTINGS_PREFIX + pdf;

/** Het deel van de opslag dat we gebruiken; in tests een nep-opslag. */
export type SettingsStorage = Pick<
  Storage,
  'getItem' | 'setItem' | 'removeItem' | 'key' | 'length'
>;

const storage = (): SettingsStorage | null => browserStorage() as SettingsStorage | null;

/** De onthouden instellingen van een PDF, of null. Een kapotte waarde telt als niets. */
export function loadStored(pdf: string, store = storage()): unknown {
  try {
    const raw = store?.getItem(keyFor(pdf));
    return raw ? (JSON.parse(raw) as unknown) : null;
  } catch {
    return null;
  }
}

/** De instellingen van een PDF onthouden. Lukt dat niet (vol, geblokkeerd), dan niet. */
export function saveStored(pdf: string, settings: Settings, store = storage()): void {
  try {
    store?.setItem(keyFor(pdf), JSON.stringify(toSettings(pdf, settings)));
  } catch {
    // Bewust genegeerd: onthouden is een gemak, geen voorwaarde.
  }
}

/** Alle onthouden instellingen van deze tool wissen; geeft het aantal PDF's. */
export function forgetStored(store = storage()): number {
  if (!store) return 0;
  try {
    const keys: string[] = [];
    for (let i = 0; i < store.length; i++) {
      const key = store.key(i);
      if (key?.startsWith(SETTINGS_PREFIX)) keys.push(key);
    }
    for (const key of keys) store.removeItem(key);
    return keys.length;
  } catch {
    return 0;
  }
}
