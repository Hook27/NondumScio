import { describe, expect, it } from 'vitest';
import {
  RUNNING_MAX_SIZE,
  analyseRunning,
  isBullet,
  isGenericHeading,
  isKeywordHeading,
  layoutBlock,
  pageText,
  piecesFrom,
  type LayoutOptions,
  type PageText,
  type Piece,
} from './layout';

/** Eén regel tekst als tekststukje, zoals pdf.js het geeft (breedte geschat op de letters). */
const piece = (str: string, x: number, y: number, fh = 10): Piece => ({
  str,
  x,
  y,
  fh,
  w: str.length * fh * 0.5,
});

/** Regels onder elkaar, met een vaste regelafstand. */
const lines = (texts: string[], top: number, step = 12, x = 50) =>
  texts.map((text, i) => piece(text, x, top - i * step));

const OPTS: LayoutOptions = {
  strip: true,
  columns: true,
  dehyphen: true,
  joinLines: true,
  gapFactor: 1.6,
};

const page = (no: number, items: Piece[]): PageText => ({
  no,
  w: 595,
  h: 842,
  items,
  chars: items.reduce((n, i) => n + i.str.length, 0),
});

describe('layoutBlock', () => {
  it('voegt regels samen tot alinea’s en breekt bij een grotere witruimte', () => {
    const items = [
      ...lines(['De eerste alinea loopt', 'over twee regels.'], 700),
      ...lines(['De tweede alinea.'], 650),
    ];
    expect(layoutBlock(items, OPTS, true)).toBe(
      'De eerste alinea loopt over twee regels.\n\nDe tweede alinea.',
    );
  });

  it('laat zonder samenvoegen elke regel los', () => {
    const items = lines(['Eerste regel', 'Tweede regel'], 700);
    expect(layoutBlock(items, { ...OPTS, joinLines: false }, true)).toBe(
      'Eerste regel\nTweede regel',
    );
  });

  it('zet een afgebroken woord weer aan elkaar, alleen als dat aanstaat', () => {
    const items = lines(['Dit is een verge-', 'lijking van twee teksten.'], 700);
    expect(layoutBlock(items, OPTS, true)).toBe('Dit is een vergelijking van twee teksten.');
    expect(layoutBlock(items, { ...OPTS, dehyphen: false }, true)).toBe(
      'Dit is een verge- lijking van twee teksten.',
    );
  });

  it('begint een nieuwe alinea bij een inspringende regel', () => {
    const items = [
      piece('Een regel die tot de marge loopt en verder', 50, 700),
      piece('Ingesprongen begin van iets nieuws', 80, 688),
    ];
    expect(layoutBlock(items, OPTS, true)).toBe(
      'Een regel die tot de marge loopt en verder\n\nIngesprongen begin van iets nieuws',
    );
  });

  it('leest twee kolommen na elkaar: eerst links helemaal, dan rechts', () => {
    const items: Piece[] = [];
    for (let i = 0; i < 6; i++) {
      items.push(piece(`links ${i + 1}`, 50, 700 - i * 12));
      items.push(piece(`rechts ${i + 1}`, 320, 700 - i * 12));
    }
    expect(layoutBlock(items, { ...OPTS, joinLines: false }, true)).toBe(
      [1, 2, 3, 4, 5, 6].map((n) => `links ${n}`).join('\n') +
        '\n' +
        [1, 2, 3, 4, 5, 6].map((n) => `rechts ${n}`).join('\n'),
    );
    // Zonder kolommen herkennen staan links en rechts op één regel.
    expect(layoutBlock(items, { ...OPTS, joinLines: false }, false).split('\n')[0]).toBe(
      'links 1 rechts 1',
    );
  });

  it('breekt bij een opsomming, maar niet bij een bedrag of jaartal midden in een zin', () => {
    const list = lines(['Dit zijn de punten:', '• het eerste punt', '• het tweede punt'], 700);
    expect(layoutBlock(list, OPTS, true)).toBe(
      'Dit zijn de punten:\n\n• het eerste punt\n\n• het tweede punt',
    );
    const sentence = lines(
      [
        'De koopsom bedraagt in totaal ongeveer een bedrag van',
        '390.000 euro en werd betaald in het voorjaar van het jaar',
        '2018. Daarna volgde de overdracht van het pand aan de koper.',
      ],
      700,
    );
    expect(layoutBlock(sentence, OPTS, true).split('\n\n')).toHaveLength(1);
  });

  it('ziet een cijfer als "5.4" midden in een zin niet als een nieuw punt', () => {
    const items = lines(
      [
        'Zoals beschreven in de paragrafen 5.1 en ook in paragraaf',
        '5.4 moet de aanvraag binnen zes weken worden ingediend bij',
        'de gemeente, met alle bijlagen die daarvoor nodig zijn.',
      ],
      700,
    );
    expect(layoutBlock(items, OPTS, true).split('\n\n')).toHaveLength(1);
  });

  it('geeft niets voor een pagina zonder tekst', () => {
    expect(layoutBlock([], OPTS, true)).toBe('');
  });
});

describe('isBullet', () => {
  it('herkent opsommingstekens en paragraafnummers', () => {
    for (const text of ['• punt', '- punt', '1. Inleiding', '2) twee', 'a. eerst', 'iv. vier']) {
      expect(isBullet(text), text).toBe(true);
    }
    expect(isBullet('5.4 De regel')).toBe(true);
  });

  it('ziet een bedrag of jaartal niet als paragraafnummer', () => {
    for (const text of ['390.000 euro', '2018. Daarna', 'Gewone tekst', '12345 meter']) {
      expect(isBullet(text), text).toBe(false);
    }
  });
});

describe('kop- en voetteksten', () => {
  /** Een pagina met een kop, drie regels tekst en een voet, elk ver van de tekst. */
  const withRunning = (no: number, head: string, foot: string) =>
    page(no, [
      piece(head, 50, 800),
      ...lines([`Tekst op pagina ${no}, eerste regel.`, 'Tweede regel.', 'Derde regel.'], 700),
      piece(foot, 50, 40),
    ]);

  it('laat een kop en voet weg die op de meeste pagina’s terugkomen (ook met een paginanummer)', () => {
    const pages = [1, 2, 3].map((no) => withRunning(no, 'Rapport 2026', `Pagina ${no} van 3`));
    const running = analyseRunning(pages);
    expect(running.map((r) => [r.dropTop, r.dropBot])).toEqual([
      [true, true],
      [true, true],
      [true, true],
    ]);
    const text = pageText(pages[1]!, OPTS, running[1]);
    expect(text).not.toContain('Rapport');
    expect(text).not.toContain('Pagina 2');
    expect(text).toContain('Tekst op pagina 2');
    // Met het weglaten uit: alles blijft staan.
    expect(pageText(pages[1]!, { ...OPTS, strip: false }, running[1])).toContain('Rapport 2026');
  });

  it('laat een regel staan die maar op één pagina bovenaan staat', () => {
    const pages = [
      withRunning(1, 'Inleiding', 'Voet 1'),
      withRunning(2, 'Werkwijze', 'Voet 2'),
      withRunning(3, 'Bijlage', 'Voet 3'),
    ];
    const running = analyseRunning(pages);
    expect(running.map((r) => r.dropTop)).toEqual([false, false, false]);
    expect(running.map((r) => r.dropBot)).toEqual([true, true, true]);
  });

  it('laat een titel in een grotere letter staan, ook als hij met een ander nummer terugkomt', () => {
    // Zoals een document met bovenaan elke pagina "Hoofdstuk 1", "Hoofdstuk 2"… in 20 pt boven
    // tekst van 11 pt: met de cijfers als # lijkt het een terugkerende kop.
    const pages = [1, 2, 3].map((no) =>
      page(no, [
        piece(`Hoofdstuk ${no}`, 50, 800, 20),
        ...lines(['Lorem ipsum dolor sit amet.', 'Tweede regel.', 'Derde regel.'], 700).map(
          (item) => ({ ...item, fh: 11 }),
        ),
        piece(`Pagina ${no} van 3`, 50, 40, 9),
      ]),
    );
    const running = analyseRunning(pages);
    expect(running.map((r) => [r.dropTop, r.dropBot])).toEqual([
      [false, true],
      [false, true],
      [false, true],
    ]);
    expect(pageText(pages[1]!, OPTS, running[1]).split('\n\n')[0]).toBe('Hoofdstuk 2');
  });

  it('ziet een kop in een iets grotere letter (12 boven 11 pt) nog wel als kop', () => {
    const pages = [1, 2, 3].map((no) =>
      page(no, [
        piece('Rapport 2026', 50, 800, 11 * RUNNING_MAX_SIZE),
        ...lines(['Eerste regel.', 'Tweede regel.', 'Derde regel.'], 700).map((item) => ({
          ...item,
          fh: 11,
        })),
      ]),
    );
    expect(analyseRunning(pages).map((r) => r.dropTop)).toEqual([true, true, true]);
    // Net iets groter: een titel, die blijft staan.
    const bigger = pages.map((p) => ({
      ...p,
      items: p.items.map((i) =>
        i.str === 'Rapport 2026' ? { ...i, fh: 11 * RUNNING_MAX_SIZE + 0.1 } : i,
      ),
    }));
    expect(analyseRunning(bigger).map((r) => r.dropTop)).toEqual([false, false, false]);
  });

  it('laat een voet in een grotere letter ook staan', () => {
    const pages = [1, 2, 3].map((no) =>
      page(no, [
        ...lines(['Eerste regel.', 'Tweede regel.', 'Derde regel.'], 700),
        piece(`Slotwoord ${no}`, 50, 40, 18),
      ]),
    );
    expect(analyseRunning(pages).map((r) => r.dropBot)).toEqual([false, false, false]);
  });

  it('ziet de eerste tekstregel niet als kop als hij dicht bij de tekst staat', () => {
    const pages = [1, 2, 3].map((no) =>
      page(no, lines(['Dezelfde eerste regel', 'Regel twee', 'Regel drie', 'Regel vier'], 800)),
    );
    expect(analyseRunning(pages).every((r) => !r.dropTop)).toBe(true);
  });
});

describe('piecesFrom', () => {
  it('neemt tekst, plek en maat over, slaat lege stukjes over en telt de tekens', () => {
    const result = piecesFrom([
      { str: 'Hallo', transform: [12, 0, 0, 12, 50, 700], width: 30 },
      { str: '' },
      { transform: [1, 0, 0, 1, 0, 0] },
      { str: 'wereld', transform: [0, 0, 0, 0, 90, 700] },
    ]);
    expect(result.chars).toBe(11);
    expect(result.items).toEqual([
      { str: 'Hallo', x: 50, y: 700, fh: 12, w: 30 },
      // Zonder hoogte en breedte: een schatting.
      { str: 'wereld', x: 90, y: 700, fh: 10, w: 30 },
    ]);
  });
});

describe('opsommingen, koppen en tabellen', () => {
  /** Regels onder elkaar met regelafstand 12; `null` is een witregel (24 in plaats van 12). */
  const block = (rows: (string | null)[], x = 50) => {
    const items: Piece[] = [];
    let y = 700;
    for (const row of rows) {
      if (row === null) {
        y -= 12;
        continue;
      }
      items.push(piece(row, x, y));
      y -= 12;
    }
    return items;
  };
  const STRUCTURE: LayoutOptions = {
    ...OPTS,
    structure: true,
    headingMarker: false,
    tables: false,
  };

  it('zonder `structure` (de vergelijker): elk opsommingspunt een eigen blok, met een witregel', () => {
    const items = block(['• een', '• twee', '• drie']);
    expect(layoutBlock(items, OPTS, false)).toBe('• een\n\n• twee\n\n• drie');
    // Met: één blok, met een enkele regelovergang tussen de punten.
    expect(layoutBlock(items, STRUCTURE, false)).toBe('• een\n• twee\n• drie');
    // Uit: de oude regel van de extractor; • telt daar ook, maar geen blok met enkele regels.
    expect(layoutBlock(items, { ...STRUCTURE, structure: false }, false)).toBe(
      '• een\n\n• twee\n\n• drie',
    );
  });

  it('de oude opsommingsregel kent wel een liggend streepje en een nummer', () => {
    const items = block(['Dit zijn de punten:', '- het eerste punt', '2. het tweede punt']);
    expect(
      layoutBlock(items, { ...STRUCTURE, structure: false }, false).split(
        String.fromCharCode(10, 10),
      ),
    ).toEqual(['Dit zijn de punten:', '- het eerste punt', '2. het tweede punt']);
  });

  it('de oude opsommingsregel kent geen letters, streepjes of geneste nummers', () => {
    const items = block(['Dit zijn de punten:', 'a) het eerste punt', '– het tweede punt']);
    const old = { ...STRUCTURE, structure: false };
    expect(layoutBlock(items, old, false)).toBe(
      'Dit zijn de punten: a) het eerste punt – het tweede punt',
    );
    expect(layoutBlock(items, STRUCTURE, false)).toBe(
      'Dit zijn de punten:\n\na) het eerste punt\n– het tweede punt',
    );
    // De vergelijker gebruikt (zonder `structure`) al de uitgebreide regel.
    expect(layoutBlock(items, OPTS, false)).toBe(
      'Dit zijn de punten:\n\na) het eerste punt\n\n– het tweede punt',
    );
  });

  it('een kop met een vast woord breekt, met een extra witregel erboven, en de tekst erna ook', () => {
    const items = block([
      'Partijen komen het volgende overeen over de woning aan de straat.',
      'Artikel 5 Huurprijs',
      'De huur bedraagt vijfhonderd euro per maand, te betalen vooraf.',
    ]);
    expect(layoutBlock(items, STRUCTURE, false)).toBe(
      'Partijen komen het volgende overeen over de woning aan de straat.\n\n\nArtikel 5 Huurprijs\n\nDe huur bedraagt vijfhonderd euro per maand, te betalen vooraf.',
    );
    expect(layoutBlock(items, { ...STRUCTURE, headingMarker: true }, false)).toContain(
      '\n\n\n{H} Artikel 5 Huurprijs\n\n',
    );
    // De vergelijker ziet geen koppen: alles loopt door.
    expect(layoutBlock(items, OPTS, false).split('\n\n')).toHaveLength(1);
    // Zonder kopmarkering-optie maar zonder `structure`: geen {H}.
    expect(layoutBlock(items, { ...OPTS, headingMarker: true }, false)).not.toContain('{H}');
  });

  it('een korte losse regel na een witregel is een kop; de tekst erna begint opnieuw', () => {
    const items = block([
      'De vorige alinea eindigt hier.',
      null,
      'Inleiding',
      'Dit is een lange regel lopende tekst die op de kop volgt en doorloopt.',
      'En nog een regel van dezelfde alinea.',
    ]);
    expect(layoutBlock(items, { ...STRUCTURE, headingMarker: true }, false)).toBe(
      'De vorige alinea eindigt hier.\n\n\n{H} Inleiding\n\nDit is een lange regel lopende tekst die op de kop volgt en doorloopt. En nog een regel van dezelfde alinea.',
    );
    // Een korte regel midden in een alinea breekt zelf niet af.
    const inside = block([
      'De zin loopt hier door en',
      'Inleiding',
      'Dit is een lange regel lopende tekst die volgt.',
    ]);
    expect(
      layoutBlock(inside, STRUCTURE, false).startsWith('De zin loopt hier door en Inleiding'),
    ).toBe(true);
  });

  it('herkent koppen voorzichtig', () => {
    expect(isKeywordHeading('Artikel 5 Huurprijs')).toBe(true);
    expect(isKeywordHeading('Hoofdstuk II')).toBe(true);
    expect(isKeywordHeading('bijlage B')).toBe(true);
    expect(isKeywordHeading('Artikel 5.1.2')).toBe(true);
    expect(isKeywordHeading('Artikelen over huur')).toBe(false);
    expect(isKeywordHeading('Het artikel 5 zegt')).toBe(false);
    const long = 'Een regel lopende tekst die lang genoeg is.';
    expect(isGenericHeading('Inleiding', long)).toBe(true);
    expect(isGenericHeading('3 Werkwijze', long)).toBe(true);
    expect(isGenericHeading('Inleiding.', long)).toBe(false);
    expect(isGenericHeading('inleiding', long)).toBe(false);
    expect(isGenericHeading('Een kop met zes losse woorden', long + long)).toBe(false);
    expect(isGenericHeading('Een kop van vijf woorden', long + long)).toBe(true);
    expect(isGenericHeading('Onderzoeksverantwoordingsparagraaf', long + long)).toBe(false);
    expect(isGenericHeading('Onderzoeksverantwoordingsparagr', long + long)).toBe(false);
    expect(isGenericHeading('Onderzoeksverantwoordingsparag', long + long)).toBe(true);
    expect(isGenericHeading('Inleiding', 'Kort')).toBe(false);
    expect(isGenericHeading('A', long)).toBe(false);
  });

  it('een raster van cellen wordt een tabel met tabs, ook met onzichtbare spaties in de gaten', () => {
    const items: Piece[] = [];
    const rows = [
      ['Product', 'Prijs', 'Aantal'],
      ['Appel', '0,50', '12'],
      ['Peer', '0,75', '8'],
    ];
    rows.forEach((row, r) => {
      const y = 700 - r * 12;
      row.forEach((cell, c) => {
        const x = 50 + c * 150;
        items.push(piece(cell, x, y));
        // pdf.js zet een spatie die het hele gat tot de volgende cel vult.
        if (c < row.length - 1) {
          const end = x + cell.length * 5;
          items.push({ str: ' ', x: end, y, fh: 10, w: 50 + (c + 1) * 150 - end });
        }
      });
    });
    const tables = { ...STRUCTURE, tables: true };
    expect(layoutBlock(items, tables, true)).toBe(
      'Product\tPrijs\tAantal\nAppel\t0,50\t12\nPeer\t0,75\t8',
    );
    // Zonder tabellen: gewone regels.
    expect(layoutBlock(items, STRUCTURE, true)).not.toContain('\t');
    // Eén regel met cellen is nog geen tabel.
    const single = items.filter((i) => i.y === 700);
    expect(layoutBlock(single, tables, true)).not.toContain('\t');
  });

  it('cellen die een paar punten verspringen, staan toch in dezelfde kolom', () => {
    const items = [
      piece('Product', 50, 700),
      piece('Prijs', 200, 700),
      piece('Appel', 53, 688),
      piece('0,50', 196, 688),
      piece('Peer', 48, 676),
      piece('0,75', 205, 676),
    ];
    expect(layoutBlock(items, { ...STRUCTURE, tables: true }, false)).toBe(
      'Product\tPrijs\nAppel\t0,50\nPeer\t0,75',
    );
  });

  it('een lege cel blijft een lege kolom', () => {
    const items = [
      piece('Naam', 50, 700),
      piece('Plaats', 200, 700),
      piece('Land', 350, 700),
      piece('Jansen', 50, 688),
      piece('Nederland', 350, 688),
    ];
    expect(layoutBlock(items, { ...STRUCTURE, tables: true }, false)).toBe(
      'Naam\tPlaats\tLand\nJansen\t\tNederland',
    );
  });

  it('bij tabellen geen kolomherkenning: de tabel wordt niet in tweeën gesplitst', () => {
    // Zes rijen met twee cellen ver uit elkaar: zonder tabellen lijkt dat op twee kolommen.
    const items: Piece[] = [];
    for (let r = 0; r < 6; r++) {
      items.push(piece(`sleutel ${r + 1}`, 50, 700 - r * 12));
      items.push(piece(`waarde ${r + 1}`, 330, 700 - r * 12));
    }
    const columns = layoutBlock(items, { ...STRUCTURE, joinLines: false }, true).split('\n');
    expect(columns[0]).toBe('sleutel 1');
    const table = layoutBlock(items, { ...STRUCTURE, tables: true }, true).split('\n');
    expect(table[0]).toBe('sleutel 1\twaarde 1');
    expect(table).toHaveLength(6);
  });
});
