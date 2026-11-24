import { afterEach, describe, expect, it, vi } from 'vitest';
import { limitedStorage } from '../lib/testStorage';
import { DEFAULT_TEXT_OPTIONS } from './extract';
import { EMPTY_META } from './header';
import {
  MAX_STORED,
  SETTINGS_PREFIX,
  forgetStored,
  fromSettings,
  isSettingsFile,
  loadStored,
  saveStored,
  settingsFileName,
  storedFingerprint,
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
  meta: EMPTY_META,
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

  it('kent alle opties van de extractor, en schrijft ze terug zoals ze waren', () => {
    const s = fromSettings(ORIGINAL, BASE)!;
    expect(s.extra.options).toEqual({});
    expect(s.options.anchors).toBe(true);
    expect(s.options.crossPage).toBe(true);
    expect(s.options.header).toBe(false);
    expect(s.options.conventions).toBe(false);
    expect(s.joins).toEqual({ 2: 'join' });
    expect(s.meta).toEqual(ORIGINAL.meta);
    const out = toSettings('artikel.pdf', s);
    expect(out.joinOverride).toEqual({ 2: 'join' });
    expect(out.meta).toEqual(ORIGINAL.meta);
    // Alle opties van de extractor staan er weer in, met dezelfde waarden; "strip" en "ocr" (uit)
    // komen erbij.
    expect(out.options).toEqual({ ...ORIGINAL.options, strip: true, ocr: false });
    // Ook in dezelfde volgorde als bij de extractor.
    expect(Object.keys(out.options)).toEqual([...Object.keys(ORIGINAL.options), 'strip', 'ocr']);
    expect(out.zones).toEqual({ d: [A], p: { 2: [B], 3: [] } });
    expect(out.v).toBe(2);
    expect(out.pdf).toBe('artikel.pdf');
  });

  it('leest en schrijft de tekstherkenning (OCR), die de extractor niet kent', () => {
    const on = fromSettings({ options: { ocr: true } }, BASE)!;
    expect(on.options).toEqual({ ...BASE.options, ocr: true });
    expect(on.extra.options).toEqual({});
    expect(toSettings('x.pdf', on).options).toMatchObject({ ocr: true });
    // Niet in het bestand: zoals het was.
    expect(
      fromSettings({ options: {} }, { ...BASE, options: { ...BASE.options, ocr: true } })!.options
        .ocr,
    ).toBe(true);
  });

  it('leest en schrijft de documentkop, het conventieblok en de gegevens', () => {
    const s = fromSettings(
      {
        options: { metaHeader: true, conventions: true },
        meta: {
          title: 'Notulen',
          author: 'J. Jansen',
          subject: 'Vergadering',
          date: '4 juni 2018',
        },
      },
      BASE,
    )!;
    expect(s.options).toEqual({ ...BASE.options, header: true, conventions: true });
    expect(s.meta).toEqual({
      title: 'Notulen',
      author: 'J. Jansen',
      subject: 'Vergadering',
      date: '4 juni 2018',
    });
    const out = toSettings('x.pdf', s);
    expect(out.options).toMatchObject({ metaHeader: true, conventions: true });
    expect(out.options).not.toHaveProperty('header');
    expect(out.meta).toEqual(s.meta);
  });

  it('een veld met een tekst vervangt wat er stond; de rest blijft', () => {
    const base = {
      ...BASE,
      meta: { title: 'Uit de PDF', author: 'Ook uit de PDF', subject: 'S', date: 'D' },
    };
    const meta = (raw: unknown) => fromSettings({ meta: raw }, base)!.meta;
    // Een leeg veld is ook een tekst: dat vervangt, zoals in de extractor.
    expect(meta({ title: 'Eigen titel', author: '', subject: 3, date: null })).toEqual({
      title: 'Eigen titel',
      author: '',
      subject: 'S',
      date: 'D',
    });
    expect(meta('geen gegevens')).toEqual(base.meta);
    expect(meta([1, 2])).toEqual(base.meta);
    expect(fromSettings({}, base)!.meta).toEqual(base.meta);
  });

  it('een optie die deze tool niet kent, gaat mee bij opslaan', () => {
    const s = fromSettings({ options: { laterNieuw: true, ookNieuw: false } }, BASE)!;
    expect(s.extra.options).toEqual({ laterNieuw: true, ookNieuw: false });
    expect(toSettings('x.pdf', s).options).toMatchObject({ laterNieuw: true, ookNieuw: false });
  });

  it('heen en terug geeft hetzelfde, ook via JSON', () => {
    const s: Settings = {
      options: {
        ...DEFAULT_TEXT_OPTIONS,
        strip: false,
        gapFactor: 2.1,
        header: true,
        conventions: true,
      },
      useZones: true,
      zones: [A, B],
      pages: { 4: [B] },
      readEmpty: true,
      joins: { 3: 'break', 4: 'join' },
      meta: { title: 'Titel', author: 'Auteur', subject: '', date: '1 mei 2020' },
      extra: { options: { laterNieuw: true } },
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
    const s = fromSettings(
      { options: { columns: 'nee', useCrop: 1, metaHeader: 'ja', conventions: 1, later: 'x' } },
      BASE,
    )!;
    expect(s.options.columns).toBe(true);
    expect(s.useZones).toBe(false);
    expect(s.options.header).toBe(false);
    expect(s.options.conventions).toBe(false);
    expect(s.extra.options).toEqual({});
  });

  it('geeft null bij iets wat geen instellingen zijn', () => {
    for (const raw of [null, 3, 'tekst', [A], undefined])
      expect(fromSettings(raw, BASE)).toBeNull();
  });
});

describe('isSettingsFile', () => {
  it('neemt een bestand van deze tool en van de extractor aan, ook het oude formaat', () => {
    expect(isSettingsFile(ORIGINAL)).toBe(true);
    expect(isSettingsFile(JSON.parse(JSON.stringify(toSettings('a.pdf', BASE))))).toBe(true);
    // Het oude formaat van de extractor: alleen de vakken.
    expect(isSettingsFile({ d: [A], p: {} })).toBe(true);
    expect(isSettingsFile({ d: [] })).toBe(true);
    expect(isSettingsFile({ p: { 2: [B] } })).toBe(true);
    // Eén bekend onderdeel is genoeg.
    for (const raw of [
      { options: { dehyphen: false } },
      { zones: { d: [] } },
      { joinOverride: { 2: 'join' } },
      { meta: { title: 'x' } },
    ])
      expect(isSettingsFile(raw)).toBe(true);
  });

  it('weigert ander JSON, zoals de database van Slim hernoemen', () => {
    for (const raw of [
      null,
      3,
      'tekst',
      [A],
      {},
      { afzenders: [], onderwerpen: [] },
      { v: 2, pdf: 'a.pdf' },
      { x: 1 },
      // Bekende namen, maar van het verkeerde soort.
      { zones: [A] },
      { d: { 0: A } },
      { p: [[A]] },
      { options: [true] },
      { joinOverride: 'join' },
      { meta: 'titel' },
    ])
      expect(isSettingsFile(raw), JSON.stringify(raw)).toBe(false);
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
    saveStored('a.pdf', { ...BASE, zones: [A] }, null, store);
    saveStored('b.pdf', { ...BASE, zones: [B] }, null, store);
    expect([...store.data.keys()]).toEqual([`${SETTINGS_PREFIX}a.pdf`, `${SETTINGS_PREFIX}b.pdf`]);
    expect(fromSettings(loadStored('a.pdf', store), BASE)!.zones).toEqual([A]);
    expect(fromSettings(loadStored('b.pdf', store), BASE)!.zones).toEqual([B]);
    expect(loadStored('c.pdf', store)).toBeNull();
  });

  it('bewaart de vingerafdruk van de PDF erbij; een bestand om op te slaan heeft hem niet', () => {
    const store = fakeStorage();
    saveStored('a.pdf', { ...BASE, zones: [A] }, 'abc123', store);
    expect(storedFingerprint(loadStored('a.pdf', store))).toBe('abc123');
    saveStored('b.pdf', BASE, null, store);
    expect(storedFingerprint(loadStored('b.pdf', store))).toBeNull();
    // Van vóór de vingerafdruk, of iets anders dan een tekst: onbekend.
    expect(storedFingerprint(toSettings('c.pdf', BASE))).toBeNull();
    expect(storedFingerprint({ fingerprint: 12 })).toBeNull();
    expect(storedFingerprint(null)).toBeNull();
    expect('fingerprint' in toSettings('a.pdf', BASE)).toBe(false);
    // De instellingen zelf lezen zoals altijd.
    expect(fromSettings(loadStored('a.pdf', store), BASE)!.zones).toEqual([A]);
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
    expect(() => saveStored('a.pdf', BASE, null, broken)).not.toThrow();
    expect(forgetStored(broken)).toBe(0);
    expect(loadStored('a.pdf', null)).toBeNull();
    expect(forgetStored(null)).toBe(0);
  });

  it('vergeten wist alleen de instellingen van deze tool, van alle PDF’s', () => {
    const store = fakeStorage({ 'nondumscio:lang': 'nl', 'nondumscio:theme': 'dark' });
    saveStored('a.pdf', BASE, null, store);
    saveStored('b.pdf', BASE, null, store);
    expect(forgetStored(store)).toBe(2);
    expect([...store.data.keys()]).toEqual(['nondumscio:lang', 'nondumscio:theme']);
    expect(forgetStored(store)).toBe(0);
  });
});

describe('onthouden in de browser: begrensd, en plaatsmaken als de opslag vol is (audit F17)', () => {
  afterEach(() => {
    vi.useRealTimers();
  });
  const key = (pdf: string) => `${SETTINGS_PREFIX}${pdf}`;
  const remembered = (store: { data: Map<string, string> }) =>
    [...store.data.keys()].filter((k) => k.startsWith(SETTINGS_PREFIX));

  it('bewaart wanneer; de instellingen zelf blijven zoals in de extractor', () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_700_000_000_000);
    const store = limitedStorage();
    saveStored('a.pdf', { ...BASE, zones: [A] }, 'abc', store);
    const raw = loadStored('a.pdf', store) as { saved: unknown };
    expect(raw.saved).toBe(1_700_000_000_000);
    expect(fromSettings(raw, BASE)!.zones).toEqual([A]);
    expect(storedFingerprint(raw)).toBe('abc');
    expect(isSettingsFile(raw)).toBe(true);
  });

  it(`hooguit ${MAX_STORED} PDF's; daarboven gaan de oudst bewaarde weg, die van vóór de tijdstempel eerst`, () => {
    vi.useFakeTimers();
    const store = limitedStorage(Infinity, {
      'nondumscio:lang': 'nl',
      [key('oud.pdf')]: JSON.stringify(toSettings('oud.pdf', BASE)),
    });
    for (let i = 0; i < MAX_STORED; i++) {
      vi.setSystemTime(1000 + i);
      saveStored(`${i}.pdf`, BASE, null, store);
    }
    expect(remembered(store)).toHaveLength(MAX_STORED);
    expect(store.data.has(key('oud.pdf'))).toBe(false);
    expect(store.data.has(key('0.pdf'))).toBe(true);

    // Opnieuw bewaren maakt een PDF weer de nieuwste: dan gaat de volgende oudste weg.
    vi.setSystemTime(5000);
    saveStored('0.pdf', BASE, null, store);
    vi.setSystemTime(5001);
    saveStored('nieuw.pdf', BASE, null, store);
    expect(remembered(store)).toHaveLength(MAX_STORED);
    expect(store.data.has(key('0.pdf'))).toBe(true);
    expect(store.data.has(key('1.pdf'))).toBe(false);
    expect(store.data.has(key('nieuw.pdf'))).toBe(true);
    // Iets anders dan onthouden instellingen blijft altijd staan.
    expect(store.data.get('nondumscio:lang')).toBe('nl');
  });

  it('wie nu al meer dan het maximum onthoudt: bij de volgende keer in één keer terug tot het maximum', () => {
    vi.useFakeTimers();
    vi.setSystemTime(9000);
    const legacy = Object.fromEntries(
      Array.from({ length: MAX_STORED + 5 }, (_, i) => [
        key(`${i}.pdf`),
        JSON.stringify(toSettings(`${i}.pdf`, BASE)),
      ]),
    );
    const store = limitedStorage(Infinity, legacy);
    saveStored('nieuw.pdf', BASE, null, store);
    expect(remembered(store)).toHaveLength(MAX_STORED);
    expect(store.data.has(key('nieuw.pdf'))).toBe(true);
  });

  it('is de klok teruggezet, dan blijft wat net bewaard is toch staan', () => {
    vi.useFakeTimers();
    const store = limitedStorage();
    for (let i = 0; i < MAX_STORED; i++) {
      vi.setSystemTime(10_000 + i);
      saveStored(`${i}.pdf`, BASE, null, store);
    }
    // Nu "eerder" dan alles wat er staat: toch de nieuwste, en die blijft.
    vi.setSystemTime(500);
    saveStored('nu.pdf', BASE, null, store);
    expect(remembered(store)).toHaveLength(MAX_STORED);
    expect(store.data.has(key('nu.pdf'))).toBe(true);
    expect(store.data.has(key('0.pdf'))).toBe(false);
  });

  it('is de opslag vol, dan eerst de oudst bewaarde weg, tot het past', () => {
    vi.useFakeTimers();
    const store = limitedStorage();
    for (const [i, pdf] of ['a.pdf', 'b.pdf', 'c.pdf'].entries()) {
      vi.setSystemTime(100 + i);
      saveStored(pdf, BASE, null, store);
    }
    const one = store.data.get(key('a.pdf'))!.length + key('a.pdf').length;
    // Nog plaats voor ongeveer drie, plus de taal: een vierde past pas als er één weg is.
    const full = limitedStorage(3.5 * one, Object.fromEntries(store.data));
    full.setItem('nondumscio:lang', 'nl');
    vi.setSystemTime(200);
    saveStored('d.pdf', BASE, null, full);
    expect(remembered(full)).toEqual([key('b.pdf'), key('c.pdf'), key('d.pdf')]);
    expect(full.data.get('nondumscio:lang')).toBe('nl');
    // Opnieuw bewaren in een volle opslag: de nieuwe versie staat er.
    vi.setSystemTime(300);
    saveStored('d.pdf', { ...BASE, zones: [A] }, null, full);
    expect(fromSettings(loadStored('d.pdf', full), BASE)!.zones).toEqual([A]);
  });

  it('past het helemaal niet, dan niet bewaard en de rest weg, zonder fout; de rest van de opslag blijft', () => {
    const store = limitedStorage(60, { 'nondumscio:lang': 'nl', [key('x.pdf')]: '{}' });
    expect(() => saveStored('a.pdf', { ...BASE, zones: [A, B] }, null, store)).not.toThrow();
    expect(remembered(store)).toEqual([]);
    expect(store.data.get('nondumscio:lang')).toBe('nl');
  });
});
