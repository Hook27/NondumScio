import { describe, expect, it } from 'vitest';
import { messages } from '../i18n';
import {
  DUTCH_HEAD,
  EMPTY_META,
  buildConventions,
  buildHeader,
  metaFromInfo,
  pdfDateText,
  upgradeDate,
  withHead,
  type HeadTexts,
} from './header';

const META = { title: 'Notulen', author: 'J. Jansen', subject: 'Vergadering', date: '4 juni 2018' };

/** Alles uit wat het conventieblok kan uitbreiden. */
const NONE = { anchors: false, joinLines: true, structure: true, headingMarker: false };

const en = messages.en.plainText;
const ENGLISH: HeadTexts = { fields: en.header.fields, conventions: en.conventions };

describe('de woorden', () => {
  it('in het Nederlands precies die van de extractor (en de regel over {H})', () => {
    const nl = messages.nl.plainText;
    expect({ fields: nl.header.fields, conventions: nl.conventions }).toEqual(DUTCH_HEAD);
  });
});

describe('pdfDateText', () => {
  it('maakt van een PDF-datum een ISO-datum, zonder tijd', () => {
    expect(pdfDateText("D:20180604090000+02'00'")).toBe('2018-06-04');
    expect(pdfDateText('D:20181231')).toBe('2018-12-31');
    // Zonder "D:" ook, en de tijd en tijdzone tellen niet mee.
    expect(pdfDateText('20240101235959Z')).toBe('2024-01-01');
  });

  it('in elke taal hetzelfde: er staat geen maandnaam in', () => {
    for (let month = 1; month <= 12; month++) {
      const mm = String(month).padStart(2, '0');
      expect(pdfDateText(`D:2019${mm}05`)).toBe(`2019-${mm}-05`);
    }
  });

  it('leeg of onleesbaar geeft niets (en niet de ruwe tekst)', () => {
    expect(pdfDateText(undefined)).toBe('');
    expect(pdfDateText('')).toBe('');
    expect(pdfDateText('gisteren')).toBe('');
    expect(pdfDateText('D:2018-06-04')).toBe('');
    expect(pdfDateText('D:20181304')).toBe('');
    expect(pdfDateText('D:20180004')).toBe('');
    expect(pdfDateText('D:20180600')).toBe('');
    expect(pdfDateText('D:20180632')).toBe('');
    expect(pdfDateText('D:20180631')).toBe('2018-06-31');
  });
});

describe('upgradeDate', () => {
  const RAW = "D:20180604090000+02'00'";
  it('een datum zoals het veld eerder vanzelf gevuld werd, wordt ISO', () => {
    expect(upgradeDate('4 juni 2018', RAW)).toBe('2018-06-04');
    expect(upgradeDate('4 June 2018', RAW)).toBe('2018-06-04');
    expect(upgradeDate(' 4 juni 2018 ', RAW)).toBe('2018-06-04');
  });

  it('een zelf getypte datum, of een andere dag, blijft staan', () => {
    expect(upgradeDate('5 juni 2018', RAW)).toBe('5 juni 2018');
    expect(upgradeDate('begin juni', RAW)).toBe('begin juni');
    expect(upgradeDate('', RAW)).toBe('');
    expect(upgradeDate('2018-06-04', RAW)).toBe('2018-06-04');
    // Zonder datum in de PDF valt er niets te vergelijken.
    expect(upgradeDate('4 juni 2018', undefined)).toBe('4 juni 2018');
    expect(upgradeDate('4 juni 2018', 'onbekend')).toBe('4 juni 2018');
  });
});

describe('metaFromInfo', () => {
  it('vult de velden uit de gegevens van de PDF', () => {
    expect(
      metaFromInfo({
        Title: 'Notulen',
        Author: 'J. Jansen',
        Subject: 'Vergadering',
        CreationDate: "D:20180604090000+02'00'",
        Producer: 'Word',
      }),
    ).toEqual({ ...META, date: '2018-06-04' });
  });

  it('wat er niet is of geen tekst is, blijft leeg', () => {
    expect(metaFromInfo({})).toEqual(EMPTY_META);
    expect(metaFromInfo({ Title: 3 as unknown as string, CreationDate: 'onbekend' })).toEqual(
      EMPTY_META,
    );
  });

  it('de datum in ISO', () => {
    expect(metaFromInfo({ CreationDate: 'D:20200501' }).date).toBe('2020-05-01');
  });
});

describe('buildHeader', () => {
  it('een regel per gegeven, zoals in de extractor', () => {
    expect(buildHeader('notulen.pdf', META)).toBe(
      'Bestand: notulen.pdf\nTitel: Notulen\nAuteur: J. Jansen\nOnderwerp: Vergadering\nDatum: 4 juni 2018',
    );
  });

  it('laat lege velden weg en haalt witruimte eromheen weg', () => {
    expect(
      buildHeader('brief.pdf', { title: '  Brief  ', author: '   ', subject: '', date: '' }),
    ).toBe('Bestand: brief.pdf\nTitel: Brief');
    expect(buildHeader('', EMPTY_META)).toBe('');
  });

  it('in de taal van de app', () => {
    expect(buildHeader('minutes.pdf', META, ENGLISH)).toBe(
      'File: minutes.pdf\nTitle: Notulen\nAuthor: J. Jansen\nSubject: Vergadering\nDate: 4 juni 2018',
    );
  });
});

describe('buildConventions', () => {
  it('zonder markeringen: alleen wat de tekst is', () => {
    expect(buildConventions(NONE)).toBe(
      [
        '=== Conventies ===',
        'Platte tekst geëxtraheerd uit een PDF; opmaak en afbeeldingen zijn weggelaten.',
        '==================',
      ].join('\n'),
    );
  });

  it('met pagina-ankers: {p#} en de concordantie, zoals in de extractor', () => {
    expect(buildConventions({ ...NONE, anchors: true })).toBe(
      [
        '=== Conventies ===',
        'Platte tekst geëxtraheerd uit een PDF; opmaak en afbeeldingen zijn weggelaten.',
        '{p#} = begin van PDF-pagina #. Kan midden in een zin staan als een alinea over de pagina-overgang doorloopt.',
        'Onderaan staat een paginaconcordantie die fysieke PDF-pagina’s koppelt aan afgedrukte documentpaginanummers.',
        '==================',
      ].join('\n'),
    );
  });

  it('met de kopmarkering ook een regel over {H}, maar alleen als {H} in de tekst kan staan', () => {
    const heading = DUTCH_HEAD.conventions.heading;
    const lines = (opts: typeof NONE) => buildConventions(opts).split('\n');
    expect(lines({ ...NONE, anchors: true, headingMarker: true })).toEqual([
      '=== Conventies ===',
      'Platte tekst geëxtraheerd uit een PDF; opmaak en afbeeldingen zijn weggelaten.',
      DUTCH_HEAD.conventions.anchors,
      DUTCH_HEAD.conventions.concordance,
      '{H} = begin van een herkende kop, zoals een hoofdstuk- of artikeltitel.',
      '==================',
    ]);
    // Zonder opsommingen en koppen, of zonder regels samenvoegen, komt er geen {H}.
    expect(lines({ ...NONE, headingMarker: true, structure: false })).not.toContain(heading);
    expect(lines({ ...NONE, headingMarker: true, joinLines: false })).not.toContain(heading);
    expect(lines(NONE)).not.toContain(heading);
  });

  it('voor een batch in één bestand: de concordantie per brondocument, en "Bestand N start/einde"', () => {
    const c = DUTCH_HEAD.conventions;
    // Zoals in de extractor: ankers, concordantie, de regel over de bestanden, dan {H}.
    expect(
      buildConventions({ ...NONE, anchors: true, headingMarker: true }, DUTCH_HEAD, true),
    ).toBe(
      [
        '=== Conventies ===',
        c.intro,
        c.anchors,
        'Per brondocument staat een paginaconcordantie die fysieke PDF-pagina’s koppelt aan afgedrukte documentpaginanummers.',
        '"Bestand N start/einde: <naam>" markeert het begin en einde van elk brondocument.',
        c.heading,
        '==================',
      ].join('\n'),
    );
    expect(buildConventions(NONE, DUTCH_HEAD, true).split('\n')).toEqual([
      '=== Conventies ===',
      c.intro,
      c.files,
      '==================',
    ]);
  });

  it('in de taal van de app; de slotregel is even breed als de titel', () => {
    const lines = buildConventions({ ...NONE, anchors: true, headingMarker: true }, ENGLISH).split(
      '\n',
    );
    expect(lines).toEqual([
      '=== Conventions ===',
      en.conventions.intro,
      en.conventions.anchors,
      en.conventions.concordance,
      en.conventions.heading,
      '===================',
    ]);
    expect(lines.at(-1)!.length).toBe(lines[0]!.length);
  });
});

describe('withHead', () => {
  const head = { name: 'notulen.pdf', meta: META, texts: DUTCH_HEAD };
  const OFF = { ...NONE, anchors: true, header: false, conventions: false };

  it('zonder kop en conventieblok: de tekst zoals hij was', () => {
    expect(withHead('{p1} De tekst.', OFF, head)).toBe('{p1} De tekst.');
  });

  it('eerst het conventieblok, dan de kop, dan de tekst, met een witregel ertussen', () => {
    expect(withHead('De tekst.', { ...OFF, header: true, conventions: true }, head)).toBe(
      [buildConventions(OFF), '', buildHeader('notulen.pdf', META), '', 'De tekst.'].join('\n'),
    );
  });

  it('alleen de kop, of alleen het conventieblok', () => {
    expect(withHead('De tekst.', { ...OFF, header: true }, head)).toBe(
      `${buildHeader('notulen.pdf', META)}\n\nDe tekst.`,
    );
    expect(withHead('De tekst.', { ...OFF, conventions: true }, head)).toBe(
      `${buildConventions(OFF)}\n\nDe tekst.`,
    );
  });

  it('een kop zonder enig gegeven valt weg', () => {
    expect(
      withHead('De tekst.', { ...OFF, header: true }, { ...head, name: '', meta: EMPTY_META }),
    ).toBe('De tekst.');
  });

  it('zonder enige tekst ook geen kop (een bewuste afwijking van de extractor)', () => {
    expect(withHead('', { ...OFF, header: true, conventions: true }, head)).toBe('');
  });
});
