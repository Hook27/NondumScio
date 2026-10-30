import { describe, expect, it } from 'vitest';
import {
  cleanRest,
  findDates,
  findSender,
  findSubject,
  linesFrom,
  nameLimit,
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
