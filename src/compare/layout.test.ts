import { describe, expect, it } from 'vitest';
import {
  analyseRunning,
  isBullet,
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
