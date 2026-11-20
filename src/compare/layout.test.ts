import { describe, expect, it } from 'vitest';
import {
  RUNNING_MAX_SIZE,
  TURN_TOLERANCE,
  analyseRunning,
  centerOf,
  isBullet,
  isGenericHeading,
  hasTextLayer,
  withoutTextLayer,
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
    expect(isKeywordHeading('Bijlage B')).toBe(true);
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

describe('voorzichtiger tekstregels (audit F15)', () => {
  const STRUCTURE: LayoutOptions = {
    ...OPTS,
    structure: true,
    headingMarker: false,
    tables: false,
  };

  it('een kop met een vast woord alleen met een hoofdletter vooraan, ook in het Engels', () => {
    expect(isKeywordHeading('artikel 5 van de wet, tenzij')).toBe(false);
    expect(isKeywordHeading('bijlage B')).toBe(false);
    expect(isKeywordHeading('ARTIKEL 5')).toBe(true);
    for (const text of ['Chapter 3', 'Section 2.1', 'Article 5', 'Appendix B', 'Part II']) {
      expect(isKeywordHeading(text), text).toBe(true);
    }
    expect(isKeywordHeading('Partly sunny')).toBe(false);
  });

  it('een Romeins cijfer als opsomming alleen als echt cijfer met i, v en x', () => {
    for (const text of ['iv. vier', 'xiv. veertien', 'IX. Negen', 'ii) twee', 'v. vijf']) {
      expect(isBullet(text), text).toBe(true);
    }
    for (const text of [
      'mi. half elf',
      'mm. dik',
      'dl. 2',
      'cd. speler',
      'iiii. vier',
      'iX. mix',
    ]) {
      expect(isBullet(text), text).toBe(false);
    }
    expect(isBullet('. punt')).toBe(false);
  });

  it('een letter met een punt midden in een alinea breekt niet af ("A. Jansen")', () => {
    const items = lines(
      [
        'De verklaring is opgesteld en ondertekend door',
        'A. Jansen namens het bestuur van de stichting en',
        'de penningmeester van de vereniging samen.',
      ],
      700,
    );
    const joined =
      'De verklaring is opgesteld en ondertekend door A. Jansen namens het bestuur van de stichting en de penningmeester van de vereniging samen.';
    expect(layoutBlock(items, STRUCTURE, false)).toBe(joined);
    // Ook bij Vergelijken (zonder `structure`).
    expect(layoutBlock(items, OPTS, false)).toBe(joined);
  });

  it('een echte lijst met letters breekt wel af', () => {
    const items = lines(
      ['De voorwaarden zijn:', 'a. de huur is betaald;', 'b. de borg is betaald.'],
      700,
    );
    expect(layoutBlock(items, STRUCTURE, false)).toBe(
      'De voorwaarden zijn:\n\na. de huur is betaald;\nb. de borg is betaald.',
    );
  });

  it('een pagina met alleen spaties heeft geen tekstlaag', () => {
    expect(hasTextLayer(page(1, [piece(' ', 50, 700), piece('  ', 80, 680)]))).toBe(false);
    expect(hasTextLayer(page(1, []))).toBe(false);
    expect(hasTextLayer(page(1, [piece(' ', 50, 700), piece('Tekst', 80, 680)]))).toBe(true);
    expect(
      withoutTextLayer([
        page(1, [piece(' ', 50, 700)]),
        page(2, []),
        page(3, [piece('x', 50, 700)]),
      ]),
    ).toBe(2);
  });
});

describe('gedraaide tekst (wens 20-11, deel B)', () => {
  /** Een pdf.js-stukje van `size` punten, gedraaid over `degrees` graden tegen de klok in. */
  const turned = (str: string, x: number, y: number, degrees: number, size = 10) => {
    const angle = (degrees * Math.PI) / 180;
    const [cos, sin] = [Math.cos(angle), Math.sin(angle)];
    return {
      str,
      transform: [size * cos, size * sin, -size * sin, size * cos, x, y],
      width: str.length * size * 0.5,
    };
  };

  it('piecesFrom: de richting in graden, alleen bij meer dan 5 graden scheef', () => {
    const { items } = piecesFrom([
      turned('recht', 50, 700, 0),
      turned('iets scheef', 50, 680, 5),
      turned('ook scheef', 50, 660, 355),
      turned('net te scheef', 50, 640, 6),
      turned('CONCEPT', 150, 400, 45, 60),
      turned('omhoog', 40, 200, 90),
      turned('omlaag', 560, 600, 270),
      turned('ondersteboven', 300, 300, 180),
    ]);
    expect(items.map((i) => [i.str, i.turn])).toEqual([
      ['recht', undefined],
      ['iets scheef', undefined],
      ['ook scheef', undefined],
      ['net te scheef', 6],
      ['CONCEPT', 45],
      ['omhoog', 90],
      ['omlaag', 270],
      ['ondersteboven', 180],
    ]);
    expect(TURN_TOLERANCE).toBe(5);
    // Net onder recht (een halve graad of minder) is recht.
    expect(piecesFrom([turned('bijna', 50, 600, 359.6)]).items[0]!.turn).toBeUndefined();
    // Een gewoon stukje heeft geen `turn` (en dus niets extra's).
    expect(Object.keys(items[0]!)).toEqual(['str', 'x', 'y', 'fh', 'w']);
    // De letterhoogte en de plek blijven zoals ze waren.
    expect(items[4]).toMatchObject({ x: 150, y: 400 });
    expect(items[4]!.fh).toBeCloseTo(60);
  });

  it('piecesFrom: de richting zoals je de pagina ziet, met de draaiing van de pagina', () => {
    // Een pagina met /Rotate: tekst die in het bestand omhoog loopt, staat op het scherm recht.
    const toPage = (x: number, y: number): [number, number] => [y, 595 - x];
    const { items } = piecesFrom(
      [turned('recht op het scherm', 100, 50, 90), turned('nu omhoog', 100, 50, 180)],
      toPage,
    );
    expect(items.map((i) => i.turn)).toEqual([undefined, 90]);
    expect(items[0]).toMatchObject({ x: 50, y: 495 });
  });

  /** Lopende tekst in één alinea van zes regels, met een regelafstand van 12. */
  const BODY = [
    'Het krediet is niet volledig besteed en van',
    'het resterende bedrag is een deel teruggevloeid',
    'naar de algemene reserve, zo blijkt uit de',
    'bijlage bij het raadsvoorstel dat de raad',
    'later heeft besproken en waar de raad mee',
    'heeft ingestemd.',
  ];
  const BODY_TEXT = BODY.join(' ');

  it('twee kolommen worden ook naast een watermerk herkend', () => {
    const items: Piece[] = [];
    for (let i = 0; i < 6; i++) {
      items.push(piece(`links ${i + 1}`, 50, 700 - i * 12));
      items.push(piece(`rechts ${i + 1}`, 320, 700 - i * 12));
    }
    const watermark = piecesFrom([turned('CONCEPT', 120, 664, 45, 60)]).items;
    expect(layoutBlock([...items, ...watermark], { ...OPTS, joinLines: false }, true)).toBe(
      [1, 2, 3, 4, 5, 6].map((n) => `links ${n}`).join('\n') +
        '\n' +
        [1, 2, 3, 4, 5, 6].map((n) => `rechts ${n}`).join('\n') +
        '\n\nCONCEPT',
    );
  });

  it('een watermerk midden in de tekst breekt geen zin: het komt als eigen blok erachter', () => {
    const watermark = piecesFrom([turned('CONCEPT', 120, 664, 45, 60)]).items;
    expect(layoutBlock([...lines(BODY, 700), ...watermark], OPTS, true)).toBe(
      `${BODY_TEXT}\n\nCONCEPT`,
    );
    // Ook als het watermerk vóór de tekst in het bestand staat.
    expect(layoutBlock([...watermark, ...lines(BODY, 700)], OPTS, true)).toBe(
      `${BODY_TEXT}\n\nCONCEPT`,
    );
  });

  it('een verticale strook van losse stukjes wordt één regel, in leesvolgorde', () => {
    // Van onder naar boven (90 graden) en van boven naar beneden (270 graden).
    const up = piecesFrom([
      turned('[cs.CL]', 40, 300, 90),
      turned('arXiv:2611.01234v1', 40, 200, 90),
      turned('20 Nov 2026', 40, 340, 90),
    ]).items;
    const down = piecesFrom([
      turned('2026/123', 560, 540, 270),
      turned('Kenmerk', 560, 600, 270),
    ]).items;
    expect(layoutBlock([...down, ...lines(BODY, 700), ...up], OPTS, true)).toBe(
      `${BODY_TEXT}\n\narXiv:2611.01234v1 [cs.CL] 20 Nov 2026\n\nKenmerk 2026/123`,
    );
  });

  it('een pagina die helemaal gedraaid in het bestand staat, wordt gewoon gelezen', () => {
    // Elke regel 90 graden gedraaid: de regels staan naast elkaar, van links naar rechts.
    const raw = BODY.map((text, i) => turned(text, 100 + i * 12, 100, 90));
    // Regels die van onder naar boven lopen, lees je met de pagina een kwartslag naar rechts: de
    // regel het meest rechts is dan de eerste.
    raw.reverse();
    expect(layoutBlock(piecesFrom(raw).items, OPTS, true)).toBe(BODY_TEXT);
  });

  it('een gedraaide regel bovenaan elke pagina is geen kop die wegvalt', () => {
    const pages = [1, 2, 3].map((no) =>
      page(no, [
        ...piecesFrom([turned('Kenmerk 2026/123', 50, 800, 90)]).items,
        ...lines(['Eerste regel.', 'Tweede regel.', 'Derde regel.'], 700),
      ]),
    );
    const running = analyseRunning(pages);
    expect(running.map((r) => r.dropTop)).toEqual([false, false, false]);
    expect(pageText(pages[0]!, OPTS, running[0])).toContain('Kenmerk 2026/123');
  });

  it('centerOf: het midden, ook van een gedraaid stukje', () => {
    expect(centerOf(piece('Tekst', 50, 700))).toEqual({ x: 62.5, y: 705 });
    const up = centerOf({ str: 'Kenmerk', x: 40, y: 200, fh: 10, w: 100, turn: 90 });
    expect(up.x).toBeCloseTo(35);
    expect(up.y).toBeCloseTo(250);
    const slant = centerOf({ str: 'x', x: 0, y: 0, fh: 0, w: 20, turn: 45 });
    // Halverwege de 20 punten langs 45 graden: 10 keer cos 45.
    expect(slant.x).toBeCloseTo(10 * Math.SQRT1_2);
    expect(slant.y).toBeCloseTo(slant.x);
  });
});

describe('twee kolommen regel voor regel in het bestand (audit F22)', () => {
  /**
   * Zoals pdf.js het geeft als links en rechts om en om in het bestand staan: tussen de regel links
   * en de regel rechts een spatie die het hele gat overbrugt (bij de proef van x 256 tot 315).
   */
  function interleaved(rows = 8): Piece[] {
    const items: Piece[] = [];
    for (let i = 0; i < rows; i++) {
      const y = 700 - i * 12;
      const left = piece(`links ${i + 1} van de kolom`, 60, y);
      items.push(left, { str: ' ', x: left.x + left.w, y, fh: 10, w: 315 - (left.x + left.w) });
      items.push(piece(`rechts ${i + 1} van de kolom`, 315, y));
    }
    return items;
  }
  const expected = (rows = 8) =>
    [
      ...Array.from({ length: rows }, (_, i) => `links ${i + 1} van de kolom`),
      ...Array.from({ length: rows }, (_, i) => `rechts ${i + 1} van de kolom`),
    ].join('\n');

  it('leest eerst links helemaal, dan rechts, ook met de overbruggende spatie', () => {
    expect(layoutBlock(interleaved(), { ...OPTS, joinLines: false }, true)).toBe(expected());
  });

  it('net zo als zonder die spatie (kolom voor kolom in het bestand)', () => {
    const items = interleaved();
    const withoutSpace = items.filter((i) => i.str.trim() !== '');
    expect(layoutBlock(items, OPTS, true)).toBe(layoutBlock(withoutSpace, OPTS, true));
  });

  /**
   * Een tabel zoals in golden-tést.pdf: drie kolommen cellen, met tussen de cellen spaties die het
   * gat overbruggen, onder een kop.
   */
  function table(): Piece[] {
    const rows = [
      ['Omschrijving', 'Aantal', 'Bedrag'],
      ['Detachering senior', '160 uur', 'EUR 14.400'],
      ['Detachering junior', '120 uur', 'EUR 7.200'],
      ['Reiskosten', '1 post', 'EUR 350'],
      ['Overig', '2 posten', 'EUR 90'],
      ['Totaal', '', 'EUR 22.040'],
    ];
    const items: Piece[] = [piece('Hoofdstuk 3 Voorbeeldtabel', 57, 757, 14)];
    rows.forEach((row, r) => {
      const y = 714 - r * 20;
      const cells = row
        .map((str, c) => (str ? piece(str, [62, 269, 425][c]!, y) : null))
        .filter((cell): cell is Piece => cell !== null);
      cells.forEach((cell, c) => {
        items.push(cell);
        const next = cells[c + 1];
        if (next)
          items.push({ str: ' ', x: cell.x + cell.w, y, fh: 10, w: next.x - cell.x - cell.w });
      });
    });
    return items;
  }

  it('een tabel blijft rij voor rij, zoals voordat de spaties werden overgeslagen', () => {
    expect(layoutBlock(table(), { ...OPTS, joinLines: false }, true).split('\n')).toEqual([
      'Hoofdstuk 3 Voorbeeldtabel',
      'Omschrijving Aantal Bedrag',
      'Detachering senior 160 uur EUR 14.400',
      'Detachering junior 120 uur EUR 7.200',
      'Reiskosten 1 post EUR 350',
      'Overig 2 posten EUR 90',
      'Totaal EUR 22.040',
    ]);
  });

  it('ook een smalle tabel, met gaten van drie keer de letterhoogte, blijft rij voor rij', () => {
    const items: Piece[] = [];
    for (let r = 0; r < 6; r++)
      for (const [c, x] of [60, 150, 240].entries())
        items.push({ str: `r${r}k${c}`, x, y: 700 - r * 14, fh: 10, w: 60 });
    const text = layoutBlock(items, { ...OPTS, joinLines: false }, true);
    expect(text.split('\n')[0]).toBe('r0k0 r0k1 r0k2');
  });

  it('staan er net zoveel regels met losse cellen als zonder, dan blijven het kolommen', () => {
    // Acht regels in twee kolommen, en direct daaronder (zonder grote witregel, dus één deel)
    // acht met drie stukjes ver uit elkaar.
    const items = interleaved();
    for (let i = 0; i < 8; i++)
      for (const x of [60, 230, 400]) items.push(piece(`cel ${x} ${i}`, x, 604 - i * 12));
    const text = layoutBlock(items, { ...OPTS, joinLines: false }, true).split('\n');
    expect(text.slice(0, 16)).toEqual(expected().split('\n'));
    // Met één regel cellen meer is het een tabel: dan per rij, zoals voorheen.
    for (const x of [60, 230, 400]) items.push(piece(`cel ${x} 8`, x, 604 - 8 * 12));
    expect(layoutBlock(items, { ...OPTS, joinLines: false }, true).split('\n')[0]).toBe(
      'links 1 van de kolom rechts 1 van de kolom',
    );
  });

  it('een regel met echte tekst over de goot blijft een regel over de volle breedte', () => {
    const items = interleaved();
    // Een kop over de hele breedte, midden tussen de regels.
    items.push(piece('Tussenkop die over de volle breedte van de pagina loopt', 60, 658, 10));
    const text = layoutBlock(items, { ...OPTS, joinLines: false }, true).split('\n');
    const kop = text.indexOf('Tussenkop die over de volle breedte van de pagina loopt');
    // Erboven de vier regels links en rechts, eronder de rest.
    expect(text.slice(0, kop)).toEqual([
      'links 1 van de kolom',
      'links 2 van de kolom',
      'links 3 van de kolom',
      'links 4 van de kolom',
      'rechts 1 van de kolom',
      'rechts 2 van de kolom',
      'rechts 3 van de kolom',
      'rechts 4 van de kolom',
    ]);
    expect(text.slice(kop + 1)).toHaveLength(8);
  });
});

describe('meer kolommen en kantlijnnoten (wens 20-11, deel C2)', () => {
  const NOJOIN = { ...OPTS, joinLines: false };
  /** `rows` regels per kolom; kolom c begint op x[c], elke regel `width` punten breed (9 pt). */
  function columns(xs: number[], rows = 12, width = 150): Piece[] {
    const items: Piece[] = [];
    xs.forEach((x, c) => {
      for (let i = 0; i < rows; i++)
        items.push({ str: `k${c} r${i}`, x, y: 700 - i * 12, fh: 9, w: width });
    });
    return items;
  }
  const order = (text: string) => text.split('\n').map((line) => line.split(' ')[0]);

  it('drie kolommen: links helemaal, dan het midden, dan rechts', () => {
    const text = layoutBlock(columns([50, 225, 400]), NOJOIN, true);
    expect(order(text)).toEqual([
      ...Array(12).fill('k0'),
      ...Array(12).fill('k1'),
      ...Array(12).fill('k2'),
    ]);
    expect(text.split('\n')[13]).toBe('k1 r1');
  });

  it('vier smallere kolommen ook', () => {
    const text = layoutBlock(columns([40, 175, 310, 445], 10, 115), NOJOIN, true);
    expect([...new Set(order(text))]).toEqual(['k0', 'k1', 'k2', 'k3']);
  });

  it('een titel over de volle breedte gaat voor, en onderbreekt de kolommen', () => {
    const items = [
      piece('Nieuwsbrief met een titel over de hele breedte van de pagina', 50, 730, 16),
      ...columns([50, 225, 400]),
    ];
    const text = layoutBlock(items, NOJOIN, true).split('\n');
    expect(text[0]).toBe('Nieuwsbrief met een titel over de hele breedte van de pagina');
    expect(text[1]).toBe('k0 r0');
    expect(text[13]).toBe('k1 r0');
  });

  it('zonder kolommen herkennen (of in een leesvak) blijft het per regel', () => {
    expect(layoutBlock(columns([50, 225, 400]), NOJOIN, false).split('\n')[0]).toBe(
      'k0 r0 k1 r0 k2 r0',
    );
    expect(layoutBlock(columns([50, 225, 400]), { ...NOJOIN, tables: true }, true)).not.toMatch(
      /^k0 r0\nk0 r1/,
    );
  });

  it('een kolom die de regels niet vullen (een tabel) maakt er geen drie kolommen van', () => {
    // Dezelfde plekken, maar de regels vullen hun kolom maar voor een derde.
    const text = layoutBlock(columns([50, 225, 400], 12, 55), NOJOIN, true);
    expect(text.split('\n')[0]).toBe('k0 r0 k1 r0 k2 r0');
  });

  it('een te smalle kolom (minder dan tien letters) ook niet', () => {
    const text = layoutBlock(columns([50, 135, 220], 12, 75), NOJOIN, true);
    expect(text.split('\n')[0]).toBe('k0 r0 k1 r0 k2 r0');
  });

  it('een kolom met te weinig regels ook niet (minder dan een kwart)', () => {
    const third = (n: number) =>
      columns([50, 225], 20).concat(
        Array.from({ length: n }, (_, i) => ({
          str: `k2 r${i}`,
          x: 400,
          y: 700 - i * 12,
          fh: 9,
          w: 150,
        })),
      );
    // Vier van de twintig regels: geen derde kolom (wel twee, met k2 rechts erbij).
    expect(layoutBlock(third(4), NOJOIN, true).split('\n')).not.toContain('k2 r0');
    // Vijf van de twintig (een kwart): wel.
    expect(layoutBlock(third(5), NOJOIN, true).split('\n')).toContain('k2 r0');
  });

  it('minder dan zes regels: geen kolommen', () => {
    expect(layoutBlock(columns([50, 225, 400], 5), NOJOIN, true).split('\n')[0]).toBe(
      'k0 r0 k1 r0 k2 r0',
    );
    expect(layoutBlock(columns([50, 225, 400], 6), NOJOIN, true).split('\n')[0]).toBe('k0 r0');
  });

  it('twee kolommen ook als de goot niet in het midden ligt', () => {
    // Een brede kolom links (x 50 tot 400) en een smallere rechts (x 420 tot 550), zelfde letter.
    const items: Piece[] = [];
    for (let i = 0; i < 10; i++) {
      items.push({ str: `breed ${i}`, x: 50, y: 700 - i * 12, fh: 9, w: 345 });
      items.push({ str: `smal ${i}`, x: 425, y: 700 - i * 12, fh: 9, w: 125 });
    }
    const text = layoutBlock(items, NOJOIN, true).split('\n');
    expect(text.slice(0, 2)).toEqual(['breed 0', 'breed 1']);
    expect(text[10]).toBe('smal 0');
  });

  it('ingesprongen regels links maken geen goot aan de rand', () => {
    // De eerste kolom springt in (x 70), op twee regels na (x 50): geen strook vóór de tekst.
    const items = columns([50, 225, 400]).map((i) =>
      i.x === 50 && !/ r(0|6)$/.test(i.str) ? { ...i, x: 70, w: 130 } : i,
    );
    const text = layoutBlock(items, NOJOIN, true).split('\n');
    expect(text.slice(0, 2)).toEqual(['k0 r0', 'k0 r1']);
  });

  it('een kolom met alleen een spatie maakt geen lege regel', () => {
    const items = columns([50, 225, 400]);
    const joined = layoutBlock(items, OPTS, true);
    // Een losse spatie direct onder de middelste kolom, op een eigen regel.
    items.push({ str: ' ', x: 230, y: 700 - 12 * 12, fh: 9, w: 3 });
    expect(layoutBlock(items, OPTS, true)).toBe(joined);
  });

  /** Lopende tekst (11 pt) vanaf x 170, met kantlijnnoten (8 pt) links op x 50. */
  function withNotes(noteSize = 8, noteX = 50): Piece[] {
    const items: Piece[] = [];
    for (let i = 0; i < 20; i++)
      items.push({
        str: `t${i} de lopende tekst van deze alinea`,
        x: 170,
        y: 740 - i * 14,
        fh: 11,
        w: 360,
      });
    const note = (str: string, y: number) =>
      items.push({ str, x: noteX, y, fh: noteSize, w: str.length * noteSize * 0.5 });
    note('Zie ook', 698);
    note('artikel 3.', 688);
    note('Vervallen.', 530);
    return items;
  }

  it('kantlijnnoten in een kleinere letter: na de lopende tekst, niet erin', () => {
    const text = layoutBlock(withNotes(), OPTS, true);
    const body = Array.from({ length: 20 }, (_, i) => `t${i} de lopende tekst van deze alinea`);
    expect(text).toBe(`${body.join(' ')}\n\nZie ook artikel 3.\n\nVervallen.`);
  });

  it('te dicht op de tekst (minder dan anderhalve letter) is het geen kantlijn', () => {
    // De noten eindigen op x 100, de tekst begint op x 115: 15 punten, minder dan 1,5 × 11.
    const items = withNotes().map((i) => (i.x === 170 ? { ...i, x: 115 } : { ...i, x: 100 - i.w }));
    expect(layoutBlock(items, NOJOIN, true)).toContain('Zie ook t3');
    // Met 20 punten wel.
    const wider = withNotes().map((i) => (i.x === 170 ? { ...i, x: 120 } : { ...i, x: 100 - i.w }));
    expect(layoutBlock(wider, NOJOIN, true)).not.toContain('Zie ook t3');
  });

  it('naast lopende tekst in twee kolommen: de noten erna, de kolommen blijven', () => {
    // Twee kolommen van 11 pt (x 170 en 380) met de noten links.
    const items = withNotes().flatMap((i) =>
      i.x === 170
        ? [
            { ...i, str: i.str.replace('t', 'L'), w: 190 },
            { ...i, str: i.str.replace('t', 'R'), x: 380, w: 170 },
          ]
        : [i],
    );
    const text = layoutBlock(items, NOJOIN, true).split('\n');
    expect(text[0]).toBe('L0 de lopende tekst van deze alinea');
    expect(text[20]).toBe('R0 de lopende tekst van deze alinea');
    expect(text.slice(-3)).toEqual(['Zie ook', 'artikel 3.', 'Vervallen.']);
  });

  it('met "Tabellen herkennen" geen kantlijnnoten (zoals geen kolommen)', () => {
    expect(layoutBlock(withNotes(), { ...NOJOIN, tables: true }, true)).toContain('Zie ook t3');
  });

  it('ook met breedtes in delen van een punt, zoals pdf.js ze geeft', () => {
    // "artikel 3." eindigt op 80,23: net voorbij een heel punt.
    const items = withNotes().map((i) =>
      i.str === 'artikel 3.'
        ? { ...i, w: 30.232 }
        : i.str === 'Vervallen.'
          ? { ...i, w: 28 }
          : i.x === 170
            ? { ...i, w: 253.143 }
            : i,
    );
    const text = layoutBlock(items, NOJOIN, true).split('\n');
    expect(text.slice(-3)).toEqual(['Zie ook', 'artikel 3.', 'Vervallen.']);
  });

  it('ook rechts van de tekst', () => {
    const items = withNotes(8, 560);
    expect(layoutBlock(items, OPTS, true).endsWith('\n\nZie ook artikel 3.\n\nVervallen.')).toBe(
      true,
    );
  });

  it('in dezelfde letter als de tekst (een kop in de kantlijn) blijven ze waar ze staan', () => {
    const text = layoutBlock(withNotes(11), NOJOIN, true);
    expect(text.split('\n').some((line) => line.startsWith('Zie ook t3'))).toBe(true);
  });

  it('hangende nummers van een lijst zijn geen kantlijnnoten', () => {
    const items: Piece[] = [];
    for (let i = 0; i < 8; i++) {
      items.push({ str: `${i + 1}.`, x: 60, y: 700 - i * 14, fh: 9, w: 8 });
      items.push({ str: `punt ${i + 1} van de lijst`, x: 90, y: 700 - i * 14, fh: 11, w: 300 });
    }
    expect(layoutBlock(items, NOJOIN, true).split('\n')[0]).toBe('1. punt 1 van de lijst');
  });

  it('één losse noot is nog geen kolom', () => {
    const items = withNotes().filter((i) => i.str !== 'artikel 3.' && i.str !== 'Vervallen.');
    expect(layoutBlock(items, NOJOIN, true)).toContain('Zie ook t3');
  });

  it('naast te weinig lopende tekst ook niet', () => {
    // Vijf regels lopende tekst (t0 tot en met t4); met zes wel (zie hierboven, met twintig).
    const items = withNotes().filter((i) => !/^t([5-9]|1\d)\b/.test(i.str));
    expect(layoutBlock(items, NOJOIN, true)).toContain('Zie ook t3');
    const six = withNotes().filter((i) => !/^t([6-9]|1\d)\b/.test(i.str));
    expect(layoutBlock(six, NOJOIN, true)).not.toContain('Zie ook t3');
  });

  it('een brede kolom aan de rand is geen kantlijn', () => {
    // De noten zijn hier 170 punten breed van de 500: meer dan 30 procent.
    const wide = (items: Piece[], w: number) =>
      items
        .map((i) => (i.x === 50 ? { ...i, w } : i))
        .map((i) => (i.x === 170 ? { ...i, x: 300, w: 250 } : i));
    expect(layoutBlock(wide(withNotes(), 170), NOJOIN, true)).toContain('Zie ook t3');
    // Net onder de 30 procent (140 van 500) wel.
    expect(layoutBlock(wide(withNotes(), 140), NOJOIN, true)).not.toContain('Zie ook t3');
  });
});

describe('gemengde opmaak per pagina (wens 20-11, deel C3)', () => {
  const NOJOIN = { ...OPTS, joinLines: false };
  /** Een deel met kolommen op `xs`, `rows` regels van 9 pt vanaf `top`, merkjes vanaf `mark`. */
  function band(marks: string[], xs: number[], top: number, rows = 8, width = 150): Piece[] {
    return xs.flatMap((x, c) =>
      Array.from({ length: rows }, (_, i) => ({
        str: `${marks[c]}${i + 1}`,
        x,
        y: top - i * 12,
        fh: 9,
        w: width,
      })),
    );
  }
  const order = (text: string) =>
    text
      .split(/\n+/)
      .map((line) => line.replace(/\d+$/, ''))
      .filter((mark, i, all) => mark !== all[i - 1]);

  it('boven twee kolommen, onder drie: elk deel met zijn eigen kolommen', () => {
    const items = [
      ...band(['a', 'b'], [50, 315], 740, 8, 230),
      ...band(['c', 'd', 'e'], [50, 225, 400], 600),
    ];
    const text = layoutBlock(items, NOJOIN, true);
    expect(order(text)).toEqual(['a', 'b', 'c', 'd', 'e']);
    // Tussen de delen een witregel.
    expect(text).toContain('b8\n\nc1');
  });

  it('ook in de andere volgorde (drie boven, twee onder)', () => {
    const items = [
      ...band(['a', 'b', 'c'], [50, 225, 400], 740),
      ...band(['d', 'e'], [50, 315], 600, 8, 230),
    ];
    expect(order(layoutBlock(items, NOJOIN, true))).toEqual(['a', 'b', 'c', 'd', 'e']);
  });

  it('dezelfde kolommen boven en onder een grote witregel: één geheel, zoals altijd', () => {
    const items = [
      ...band(['a', 'b'], [50, 315], 740, 8, 230),
      ...band(['a', 'b'], [50, 315], 600, 8, 230).map((i) => ({ ...i, str: `${i.str}0` })),
    ];
    // Eerst de hele linkerkolom (boven en onder), dan de rechter.
    expect(order(layoutBlock(items, NOJOIN, true))).toEqual(['a', 'b']);
  });

  it('een goot die een klein stukje verschuift, telt als dezelfde', () => {
    const items = [
      ...band(['a', 'b'], [50, 315], 740, 8, 230),
      ...band(['a', 'b'], [55, 325], 600, 8, 225).map((i) => ({ ...i, str: `${i.str}0` })),
    ];
    expect(order(layoutBlock(items, NOJOIN, true))).toEqual(['a', 'b']);
    // Ver verschoven (een brede kolom links en een smalle rechts): twee delen.
    const shifted = [
      ...band(['a', 'b'], [50, 315], 740, 8, 230),
      ...band(['c', 'd'], [50, 435], 600, 8, 345).map((i) => (i.x === 435 ? { ...i, w: 115 } : i)),
    ];
    expect(order(layoutBlock(shifted, NOJOIN, true))).toEqual(['a', 'b', 'c', 'd']);
  });

  it('alleen bij een grote witregel: meer dan drie keer de gewone regelafstand', () => {
    // De onderste drie kolommen beginnen 3 regels (36 punten) lager: geen grote witregel.
    const close = [
      ...band(['a', 'b'], [50, 315], 740, 8, 230),
      ...band(['c', 'd', 'e'], [50, 225, 400], 740 - 7 * 12 - 36),
    ];
    // Zonder opdeling (en zonder samenvoegen) staat er nergens een witregel.
    expect(layoutBlock(close, NOJOIN, true)).not.toContain('\n\n');
    // Iets meer dan drie regels: wel.
    const apart = [
      ...band(['a', 'b'], [50, 315], 740, 8, 230),
      ...band(['c', 'd', 'e'], [50, 225, 400], 740 - 7 * 12 - 37),
    ];
    expect(order(layoutBlock(apart, NOJOIN, true))).toEqual(['a', 'b', 'c', 'd', 'e']);
  });

  it('een deel met minder dan zes regels telt niet mee', () => {
    const items = [
      ...band(['a', 'b'], [50, 315], 740, 8, 230),
      ...band(['c', 'd', 'e'], [50, 225, 400], 600, 5),
    ];
    // Het onderste deel heeft maar vijf regels: geen opdeling (geen witregel tussen delen).
    expect(layoutBlock(items, NOJOIN, true)).not.toContain('\n\n');
    const six = [
      ...band(['a', 'b'], [50, 315], 740, 8, 230),
      ...band(['c', 'd', 'e'], [50, 225, 400], 600, 6),
    ];
    expect(order(layoutBlock(six, NOJOIN, true))).toEqual(['a', 'b', 'c', 'd', 'e']);
  });

  it('een extra goot telt als andere opmaak, ook als de eerste gelijk is', () => {
    // Boven een smalle kolom links en een brede rechts (goot rond x 212), onder drie kolommen
    // (goten rond x 212 en 387).
    const items = [
      ...band(['a', 'b'], [50, 225], 740, 8, 150).map((i) => (i.x === 225 ? { ...i, w: 325 } : i)),
      ...band(['c', 'd', 'e'], [50, 225, 400], 600),
    ];
    expect(order(layoutBlock(items, NOJOIN, true))).toEqual(['a', 'b', 'c', 'd', 'e']);
  });

  it('minder goten onder, met de eerste gelijk, is ook andere opmaak', () => {
    // Boven drie kolommen (goten rond x 212 en 387), onder een smalle en een brede (rond x 212).
    const items = [
      ...band(['a', 'b', 'c'], [50, 225, 400], 740),
      ...band(['d', 'e'], [50, 225], 600, 8, 150).map((i) => (i.x === 225 ? { ...i, w: 325 } : i)),
    ];
    expect(order(layoutBlock(items, NOJOIN, true))).toEqual(['a', 'b', 'c', 'd', 'e']);
  });

  it('de grote witregel naar de gewone regelafstand, ook met alinea-witregels ertussen', () => {
    // Elke derde regel een alinea-witregel (24 in plaats van 12): de gewone afstand blijft 12, dus
    // een witregel van 50 is groot genoeg.
    const spaced = (items: Piece[], top: number) =>
      items.map((i) => {
        const row = Math.round((top - i.y) / 12);
        return { ...i, y: i.y - Math.floor(row / 3) * 12 };
      });
    const top = spaced(band(['a', 'b'], [50, 315], 740, 8, 230), 740);
    const lowest = Math.min(...top.map((i) => i.y));
    const items = [
      ...top,
      ...spaced(band(['c', 'd', 'e'], [50, 225, 400], lowest - 50), lowest - 50),
    ];
    expect(order(layoutBlock(items, NOJOIN, true))).toEqual(['a', 'b', 'c', 'd', 'e']);
  });

  it('een los stukje witruimte ver onder de tekst geeft geen lege regels', () => {
    const items = [
      ...band(['a', 'b'], [50, 315], 740, 8, 230),
      ...band(['c', 'd', 'e'], [50, 225, 400], 600),
    ];
    const text = layoutBlock(items, NOJOIN, true);
    items.push({ str: ' ', x: 300, y: 200, fh: 9, w: 3 });
    expect(layoutBlock(items, NOJOIN, true)).toBe(text);
  });

  it('zonder kolommen herkennen, of met tabellen, geen opdeling', () => {
    const items = [
      ...band(['a', 'b'], [50, 315], 740, 8, 230),
      ...band(['c', 'd', 'e'], [50, 225, 400], 600),
    ];
    expect(layoutBlock(items, NOJOIN, false)).not.toContain('\n\n');
    expect(layoutBlock(items, { ...NOJOIN, tables: true }, true)).not.toContain('\n\n');
    expect(layoutBlock(items, NOJOIN, false).split('\n')[0]).toBe('a1 b1');
  });
});
