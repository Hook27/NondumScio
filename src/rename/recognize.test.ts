import { describe, expect, it } from 'vitest';
import {
  cleanRest,
  findDates,
  findSender,
  findSubject,
  linesFrom,
  nameLimit,
  pickDate,
  proposeNames,
  uniqueNames,
  type NameInput,
} from './recognize';

/** Een brief van de gemeente, zoals de tekstlaag van een scan hem geeft. */
const GEMEENTE = [
  'Gemeente Utrecht',
  'Postbus 16200',
  '3500 CE Utrecht',
  'Datum: 12 mrt. 2026',
  'Ons kenmerk: 12345',
  'Betreft: Aanslag gemeentelijke belastingen 2026',
];

const input = (fields: Partial<NameInput>): NameInput => ({
  date: '',
  sender: '',
  subject: '',
  include: true,
  manualName: false,
  customName: '',
  ...fields,
});

describe('linesFrom: regels uit de tekst van een pagina', () => {
  it('groepeert op hoogte (bovenaan eerst) en zet stukjes op volgorde, met spaties', () => {
    const at = (str: string, x: number, y: number, width: number) => ({
      str,
      transform: [1, 0, 0, 1, x, y],
      width,
    });
    expect(
      linesFrom([
        at('2500', 85, 680.5, 18),
        at('dienst', 90, 701, 25),
        at('Belasting', 50, 700, 40),
        at('Postbus', 50, 680, 30),
        at('', 0, 0, 0),
      ]),
    ).toEqual(['Belastingdienst', 'Postbus 2500']);
  });
});

describe('findDates', () => {
  it('kiest de datum bij "Datum", uitgeschreven met een afgekorte maand', () => {
    const dates = findDates(GEMEENTE, 'scan.pdf', 2026);
    expect(dates[0]).toMatchObject({ ymd: '260312', source: 'text', raw: '12 mrt. 2026' });
  });

  it('een datum bij "Datum" wint van een uitgeschreven datum hoger op de pagina', () => {
    const lines = ['Geldig vanaf 1 januari 2026', 'Klant 123', 'Ref', 'Datum: 5-3-2026'];
    expect(findDates(lines, 'f.pdf', 2026).map((date) => date.ymd)).toEqual(['260305', '260101']);
  });

  it('herkent dag-maand-jaar, ISO en een jaar van twee cijfers', () => {
    expect(findDates(['Factuurdatum 03-02-2026'], 'f.pdf', 2026)[0]!.ymd).toBe('260203');
    expect(findDates(['2026-05-31'], 'f.pdf', 2026)[0]).toMatchObject({
      ymd: '260531',
      source: 'iso',
    });
    expect(findDates(['op 7/8/25 ontvangen'], 'f.pdf', 2026)[0]!.ymd).toBe('250807');
  });

  it('valt terug op de datum in de naam van de scan', () => {
    const dates = findDates(['Brief zonder datum'], 'scan_20260613_101112.pdf', 2026);
    expect(dates).toEqual([expect.objectContaining({ ymd: '260613', source: 'fileName' })]);
  });

  it('negeert jaartallen voor 1990 en na volgend jaar, en onmogelijke datums', () => {
    expect(findDates(['1-1-1985', '31-12-2030', '32-13-2026'], 'f.pdf', 2026)).toEqual([]);
  });
});

/*
 * Verzonnen brieven met de opbouw van echte scans waar het misging (de tekstlaag van de scanner:
 * kolommen door elkaar, en soms ontbreekt de briefdatum helemaal).
 */
describe('findDates en pickDate: briefdatum of ingangsdatum', () => {
  const ymds = (lines: string[], fileName = 'f.pdf') =>
    findDates(lines, fileName, 2026).map((date) => date.ymd);
  const pick = (lines: string[], fileName = 'f.pdf') => pickDate(findDates(lines, fileName, 2026));

  it('ontbreekt de briefdatum, dan geen "per 1 januari": liever leeg (of de datum van de scan)', () => {
    const lines = [
      'Verzekeraar',
      'Postbus 1234, 1234 AB Heerlen',
      'Heerlen,',
      'Klantnummer Polisnummer',
      'Onderwerp: premieverhoging per 1 januari 2026',
      'Per 1 januari 2026 stijgt de premie.',
      'Op 1 januari 2026 gaat de basispremie omhoog.',
    ];
    expect(findDates(lines, 'f.pdf', 2026)).toEqual([
      expect.objectContaining({ ymd: '260101', raw: 'per 1 januari 2026', excluded: true }),
    ]);
    expect(pick(lines)).toBe('');
    // De datum in de naam van de scan blijft het laatste redmiddel.
    expect(pick(lines, 'scan_20251110.pdf')).toBe('251110');
  });

  it('"Heerlen," met de datum eronder wint ruim van een ingangsdatum', () => {
    const lines = [
      'Verzekeraar',
      'Heerlen,',
      '19 oktober 2026',
      'AFM-vergunningnummer Onderwerp: nieuwe voorwaarden per 1 januari 2027',
      'Daarom veranderen we per 1 januari 2027 onze voorwaarden.',
    ];
    const dates = findDates(lines, 'f.pdf', 2026);
    expect(dates.map((date) => [date.ymd, date.excluded])).toEqual([
      ['261019', false],
      ['270101', true],
    ]);
    expect(pick(lines)).toBe('261019');
  });

  it('de plaats vóór de datum telt zwaar, op dezelfde regel of de regel erboven', () => {
    // Zonder de plaats zou de datum hoger op de pagina winnen.
    expect(pick(['Afgedrukt 2 oktober 2026', 'Heerlen,', '19 oktober 2026'])).toBe('261019');
    expect(pick(['Afgedrukt 2 oktober 2026', 'Utrecht, 12 maart 2026'])).toBe('260312');
    expect(pick(['Afgedrukt 2 oktober 2026', "'s-Hertogenbosch, 12-3-2026"])).toBe('260312');
    // Maar alleen als de datum vooraan de regel staat.
    expect(pick(['Afgedrukt 2 oktober 2026', 'Heerlen,', 'Zie ook 19 oktober 2026'])).toBe(
      '261002',
    );
  });

  it('"Datum" op de regel erboven telt als label', () => {
    expect(pick(['Afgedrukt 1 april 2026', 'Jansen Datum', '22 april 2026'])).toBe('260422');
    expect(pick(['Afgedrukt 1 april 2026', 'Dagtekening:', '22 april 2026'])).toBe('260422');
  });

  it('woorden die een ingangs-, eind- of verwijsdatum maken', () => {
    const before = [
      'per',
      'Op',
      'vanaf',
      'uw brief van',
      'sinds',
      'tot',
      'tot en met',
      't/m',
      'vóór',
      'voor',
      'uiterlijk',
      'm.i.v.',
      'met ingang van',
      'Vervaldatum:',
      'geboortedatum',
      'Ingangsdatum',
      'Wijzigingsdatum',
    ];
    for (const words of before) {
      const line = `${words} 1 mei 2026`;
      const [date] = findDates([line], 'f.pdf', 2026);
      expect(date!.excluded, words).toBe(true);
      // In de lijst met het woord ervoor, zodat te zien is waarom hij niet gekozen is.
      expect(line.endsWith(date!.raw) && date!.raw !== '1 mei 2026', date!.raw).toBe(true);
    }
    // Met een datumlabel op de regel is het wel de briefdatum ("verzonden op").
    expect(pick(['Verzonden op 3 mei 2026'])).toBe('260503');
    expect(pick(['Datum van verzending: 3 mei 2026'])).toBe('260503');
    // Een woord dat er alleen op lijkt, telt niet ("koop 1 mei").
    expect(pick(['Koop 1 mei 2026 iets moois'])).toBe('260501');
  });

  it('staat het woord aan het eind van de regel erboven, dan telt het ook', () => {
    // Zoals de tekstlaag de regels afbreekt: het woord op de ene regel, de datum op de volgende.
    const lines = [
      'Verzekeraar',
      'Wilt u opzeggen? Laat ons dit dan weten vóór',
      '1 februari 2026. Dit kan via MijnVerzekeraar.',
      'Er komen meer uitkeringen. We verhogen daarom per',
      '1 januari 2027 de premie van uw verzekering.',
    ];
    expect(
      findDates(lines, 'f.pdf', 2026).map((date) => [date.ymd, date.raw, date.excluded]),
    ).toEqual([
      ['260201', 'vóór 1 februari 2026', true],
      ['270101', 'per 1 januari 2027', true],
    ]);
    expect(pick(lines)).toBe('');
    // Alleen als de datum vooraan de regel staat.
    expect(pick(['Laat ons dit weten vóór', 'Heerlen, 3 november 2025'])).toBe('251103');
    // Met een datumlabel op de regel erboven is het wel de briefdatum.
    expect(pick(['Verzonden op', '3 mei 2026'])).toBe('260503');
  });

  it('een vervaldatum is geen datumlabel', () => {
    expect(pick(['Vervaldatum: 30 juni 2026', 'Amsterdam, 3 juni 2026'])).toBe('260603');
    expect(ymds(['Vervaldatum: 30 juni 2026', 'Amsterdam, 3 juni 2026'])).toEqual([
      '260603',
      '260630',
    ]);
  });

  it('een ingangsdatum komt achteraan, ook als hij meer punten heeft', () => {
    // "Per 1 mei 2026" staat bovenaan en is uitgeschreven: meer punten dan "3-4-2026" onderaan.
    const lines = ['Per 1 mei 2026 gaat de premie omhoog', 'Tekst', 'Tekst', 'Tekst', '3-4-2026'];
    expect(ymds(lines)).toEqual(['260403', '260501']);
    // Staat dezelfde datum ook gewoon in de brief (met minder punten), dan telt die plek.
    const same = ['Per 1 mei 2026 gaat de premie omhoog', 'Tekst', 'Tekst', 'Tekst', '1-5-2026'];
    expect(findDates(same, 'f.pdf', 2026)).toEqual([
      expect.objectContaining({ ymd: '260501', raw: '1-5-2026', excluded: false }),
    ]);
    expect(pick(same)).toBe('260501');
  });

  it('staat dezelfde datum ook als briefdatum in de brief, dan telt die', () => {
    const dates = findDates(
      ['Gemeente', 'Utrecht, 1 januari 2026', 'De regels gelden per 1 januari 2026.'],
      'f.pdf',
      2026,
    );
    expect(dates).toEqual([
      expect.objectContaining({ ymd: '260101', raw: '1 januari 2026', excluded: false }),
    ]);
  });
});

describe('findSender', () => {
  it('een regel met een organisatiewoord wint', () => {
    expect(findSender(['Geachte heer,', 'Coolblue B.V.', 'Factuur'])).toBe('Coolblue B');
    expect(findSender(GEMEENTE)).toBe('Gemeente Utrecht');
  });

  it('hooguit drie woorden, en niets na een leesteken', () => {
    expect(findSender(['Stichting Pensioenfonds ABP, afdeling klanten'])).toBe(
      'Stichting Pensioenfonds ABP',
    );
  });

  it('zonder bruikbare regel: het domein van een e-mailadres', () => {
    expect(findSender(['info@energie-direct.nl', '1234 AB', '12-12'])).toBe('info@energie-direct');
    expect(findSender(['1234 AB', 'Pagina 1', 'mail: a@energie-direct.nl'])).toBe('mail');
    expect(findSender(['1234 AB', '12-12'])).toBe('');
  });
});

describe('findSubject', () => {
  it('neemt wat na "Betreft:", "Onderwerp -" of "Re:" staat', () => {
    expect(findSubject(GEMEENTE)).toBe('Aanslag gemeentelijke belastingen 2026');
    expect(findSubject(['x', 'Onderwerp - Jaarnota energie'])).toBe('Jaarnota energie');
    expect(findSubject(['x', 'Re: deelnemersnummer'])).toBe('deelnemersnummer');
  });

  it('anders een opvallende korte regel, niet de eerste', () => {
    expect(findSubject(['Belastingdienst', 'Postbus 2500', 'Voorlopige aanslag'])).toBe(
      'Postbus 2500',
    );
    expect(findSubject(['Alleen de afzender'])).toBe('');
  });
});

describe('namen', () => {
  it('JJMMDD afzender onderwerp, in kleine letters en hooguit 20 tekens na de datum', () => {
    expect(
      proposeNames([
        input({ date: '260312', sender: 'Gemeente Utrecht', subject: 'Aanslag belastingen' }),
      ]),
    ).toEqual(['260312 gemeente utrecht aan.pdf']);
  });

  it('haalt verboden tekens weg', () => {
    expect(cleanRest('A/B: "Ç?é*" x.pdf')).toBe('a b ç é x');
  });

  it('geeft dubbele namen een volgnummer achter de datum; zonder datum achteraan', () => {
    expect(
      proposeNames([
        input({ date: '260604', sender: 'Bank', subject: 'Afschrift' }),
        input({ date: '260604', sender: 'Bank', subject: 'Afschrift' }),
        input({}),
        input({}),
      ]),
    ).toEqual([
      '260604_01 bank afschrift.pdf',
      '260604_02 bank afschrift.pdf',
      'naamloos_01.pdf',
      'naamloos_02.pdf',
    ]);
  });

  it('een niet meegenomen bestand telt niet mee voor dubbele namen; een eigen naam blijft', () => {
    expect(
      proposeNames([
        input({ date: '260604', sender: 'Bank' }),
        input({ date: '260604', sender: 'Bank', include: false }),
        input({ manualName: true, customName: 'mijn naam' }),
      ]),
    ).toEqual(['260604 bank.pdf', '260604 bank.pdf', 'mijn naam.pdf']);
  });

  it('meldt de lengte: 27 tekens, of 30 met een volgnummer', () => {
    expect(nameLimit('260604 bank afschrift.pdf')).toEqual({ length: 21, limit: 27 });
    expect(nameLimit('260604_01 bank.pdf')).toEqual({ length: 14, limit: 30 });
  });

  it('maakt namen uniek in de ZIP', () => {
    expect(uniqueNames(['a.pdf', 'A.pdf', 'b.pdf', 'a.pdf'])).toEqual([
      'a.pdf',
      'A_02.pdf',
      'b.pdf',
      'a_03.pdf',
    ]);
  });
});
