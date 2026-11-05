import { describe, expect, it } from 'vitest';
import { DEFAULT_TEXT_OPTIONS } from './extract';
import {
  SETTINGS_PREFIX,
  forgetStored,
  fromSettings,
  loadStored,
  saveStored,
  settingsFileName,
  toSettings,
  type Settings,
  type SettingsStorage,
} from './settings';

const BASE: Settings = {
  options: DEFAULT_TEXT_OPTIONS,
  useZones: false,
  zones: [],
  pages: {},
  readEmpty: false,
  joins: {},
  extra: { options: {} },
};

const A = { x0: 0.1, y0: 0.1, x1: 0.5, y1: 0.9 };
const B = { x0: 0.5, y0: 0.1, x1: 0.9, y1: 0.9 };

/** Een instellingenbestand zoals de losse pdf-tekst-extractor het opslaat ("Instellingen opslaan"). */
const ORIGINAL = {
  v: 2,
  pdf: 'artikel.pdf',
  zones: { d: [A], p: { '2': [B], '3': [] } },
  joinOverride: { '2': 'join' },
  options: {
    useCrop: true,
    columns: false,
    dehyphen: true,
    joinLines: true,
    paraGap: '1.6',
    readEmpty: true,
    anchors: true,
    crossPage: true,
    structure: true,
    headingMarker: false,
    metaHeader: false,
    conventions: false,
    tables: false,
  },
  meta: { title: 'Artikel', author: '', subject: '', date: '' },
};

/** Een nep-opslag, zoals `localStorage`. */
function fakeStorage(initial: Record<string, string> = {}): SettingsStorage & {
  data: Map<string, string>;
} {
  const data = new Map(Object.entries(initial));
  return {
    data,
    get length() {
      return data.size;
    },
    key: (i: number) => [...data.keys()][i] ?? null,
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => void data.set(key, value),
    removeItem: (key: string) => void data.delete(key),
  };
}

describe('fromSettings', () => {
  it('leest een bestand van de extractor: vakken, eigen sets, opties', () => {
    const s = fromSettings(ORIGINAL, BASE)!;
    expect(s.useZones).toBe(true);
    expect(s.zones).toEqual([A]);
    expect(s.pages).toEqual({ 2: [B], 3: [] });
    expect(s.readEmpty).toBe(true);
    expect(s.options).toEqual({ ...DEFAULT_TEXT_OPTIONS, columns: false, gapFactor: 1.6 });
  });

  it('bewaart wat de extractor kent maar deze tool nog niet, en schrijft het terug', () => {
    const s = fromSettings(ORIGINAL, BASE)!;
    expect(s.extra.options).toEqual({ metaHeader: false, conventions: false });
    expect(s.options.anchors).toBe(true);
    expect(s.options.crossPage).toBe(true);
    expect(s.joins).toEqual({ 2: 'join' });
    const out = toSettings('artikel.pdf', s);
    expect(out.joinOverride).toEqual({ 2: 'join' });
    expect(out.meta).toEqual(ORIGINAL.meta);
    // Alle opties van de extractor staan er weer in, met dezelfde waarden; "strip" komt erbij.
    expect(out.options).toEqual({ ...ORIGINAL.options, strip: true });
    expect(out.zones).toEqual({ d: [A], p: { 2: [B], 3: [] } });
    expect(out.v).toBe(2);
    expect(out.pdf).toBe('artikel.pdf');
  });

  it('heen en terug geeft hetzelfde, ook via JSON', () => {
    const s: Settings = {
      options: { ...DEFAULT_TEXT_OPTIONS, strip: false, gapFactor: 2.1 },
      useZones: true,
      zones: [A, B],
      pages: { 4: [B] },
      readEmpty: true,
      joins: { 3: 'break', 4: 'join' },
      extra: { options: { metaHeader: true } },
    };
    const back = fromSettings(JSON.parse(JSON.stringify(toSettings('x.pdf', s))), BASE)!;
    expect(back).toEqual(s);
  });

  it('leest en schrijft opsommingen en koppen, de kopmarkering en tabellen', () => {
    const s = fromSettings(
      { options: { structure: false, headingMarker: true, tables: true } },
      BASE,
    )!;
    expect(s.options).toEqual({
      ...BASE.options,
      structure: false,
      headingMarker: true,
      tables: true,
    });
    expect(s.extra.options).toEqual({});
    expect(toSettings('x.pdf', s).options).toMatchObject({
      structure: false,
      headingMarker: true,
      tables: true,
    });
    // Niet opgegeven: zoals het was.
    expect(fromSettings({ options: {} }, s)!.options).toEqual(s.options);
  });

  it('leest de keuzes per overgang: alleen bekende keuzes en paginanummers vanaf 1', () => {
    const s = fromSettings(
      {
        joinOverride: {
          '2': 'join',
          '3': 'break',
          '4': 'auto',
          '5': 'anders',
          '0': 'join',
          x: 'join',
        },
      },
      { ...BASE, joins: { 9: 'join' } },
    )!;
    expect(s.joins).toEqual({ 2: 'join', 3: 'break', 4: 'auto' });
    // Zonder keuzes in het bestand: geen keuzes (zoals de vakken altijd vervangen).
    expect(fromSettings({}, { ...BASE, joins: { 9: 'join' } })!.joins).toEqual({});
  });

  it('leest ook het oude formaat van de extractor (alleen { d, p })', () => {
    const s = fromSettings({ d: [A], p: { 5: [B] } }, BASE)!;
    expect(s.zones).toEqual([A]);
    expect(s.pages).toEqual({ 5: [B] });
    expect(s.options).toEqual(BASE.options);
  });

  it('vervangt de vakken altijd, maar laat opties die er niet staan zoals ze waren', () => {
    const base = { ...BASE, zones: [A], useZones: true, readEmpty: true };
    const s = fromSettings({ options: { dehyphen: false } }, base)!;
    expect(s.zones).toEqual([]);
    expect(s.pages).toEqual({});
    expect(s.useZones).toBe(true);
    expect(s.readEmpty).toBe(true);
    expect(s.options).toEqual({ ...BASE.options, dehyphen: false });
  });

  it('slaat kapotte vakken en paginanummers over, en zet vakken binnen de pagina', () => {
    const s = fromSettings(
      {
        zones: {
          d: [A, { x0: 'a', y0: 0, x1: 1, y1: 1 }, null, { x0: 0.8, y0: -1, x1: 1.5, y1: 0.2 }],
          p: { '0': [A], x: [A], '2.5': [A], '-1': [A], '7': 'geen lijst' },
        },
      },
      BASE,
    )!;
    expect(s.zones).toEqual([A, { x0: 0.8, y0: 0, x1: 1, y1: 0.2 }]);
    expect(s.pages).toEqual({ 7: [] });
  });

  it('houdt de alinea-gevoeligheid binnen de schuif, op 0,1 afgerond', () => {
    const gap = (paraGap: unknown) =>
      fromSettings({ options: { paraGap } }, BASE)!.options.gapFactor;
    expect(gap('1.6')).toBe(1.6);
    expect(gap(2)).toBe(2);
    expect(gap('9')).toBe(2.5);
    expect(gap('0.5')).toBe(1.1);
    expect(gap('1.34')).toBe(1.3);
    expect(gap('geen getal')).toBe(BASE.options.gapFactor);
    expect(gap('')).toBe(BASE.options.gapFactor);
  });

  it('negeert opties van het verkeerde soort', () => {
    const s = fromSettings({ options: { columns: 'nee', useCrop: 1, metaHeader: 'ja' } }, BASE)!;
    expect(s.options.columns).toBe(true);
    expect(s.useZones).toBe(false);
    expect(s.extra.options).toEqual({});
  });

  it('geeft null bij iets wat geen instellingen zijn', () => {
    for (const raw of [null, 3, 'tekst', [A], undefined])
      expect(fromSettings(raw, BASE)).toBeNull();
  });
});

describe('settingsFileName', () => {
  it('zet _instellingen.json achter de naam, zonder .pdf', () => {
    expect(settingsFileName('artikel.pdf')).toBe('artikel_instellingen.json');
    expect(settingsFileName('ARTIKEL.PDF')).toBe('ARTIKEL_instellingen.json');
    expect(settingsFileName('.pdf')).toBe('pdf_instellingen.json');
  });
});

describe('onthouden in de browser', () => {
  it('bewaart per bestandsnaam en haalt het terug', () => {
    const store = fakeStorage();
    saveStored('a.pdf', { ...BASE, zones: [A] }, store);
    saveStored('b.pdf', { ...BASE, zones: [B] }, store);
    expect([...store.data.keys()]).toEqual([`${SETTINGS_PREFIX}a.pdf`, `${SETTINGS_PREFIX}b.pdf`]);
    expect(fromSettings(loadStored('a.pdf', store), BASE)!.zones).toEqual([A]);
    expect(fromSettings(loadStored('b.pdf', store), BASE)!.zones).toEqual([B]);
    expect(loadStored('c.pdf', store)).toBeNull();
  });

  it('een kapotte waarde telt als niets', () => {
    const store = fakeStorage({ [`${SETTINGS_PREFIX}a.pdf`]: '{kapot' });
    expect(loadStored('a.pdf', store)).toBeNull();
  });

  it('een opslag die niet mag of vol is, geeft geen fout', () => {
    const broken: SettingsStorage = {
      length: 1,
      key: () => {
        throw new Error('geen toegang');
      },
      getItem: () => {
        throw new Error('geen toegang');
      },
      setItem: () => {
        throw new Error('vol');
      },
      removeItem: () => undefined,
    };
    expect(loadStored('a.pdf', broken)).toBeNull();
    expect(() => saveStored('a.pdf', BASE, broken)).not.toThrow();
    expect(forgetStored(broken)).toBe(0);
    expect(loadStored('a.pdf', null)).toBeNull();
    expect(forgetStored(null)).toBe(0);
  });

  it('vergeten wist alleen de instellingen van deze tool, van alle PDF’s', () => {
    const store = fakeStorage({ 'nondumscio:lang': 'nl', 'nondumscio:theme': 'dark' });
    saveStored('a.pdf', BASE, store);
    saveStored('b.pdf', BASE, store);
    expect(forgetStored(store)).toBe(2);
    expect([...store.data.keys()]).toEqual(['nondumscio:lang', 'nondumscio:theme']);
    expect(forgetStored(store)).toBe(0);
  });
});
