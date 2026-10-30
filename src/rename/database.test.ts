import { describe, expect, it } from 'vitest';
import type { StorageLike } from '../lib/storage';
import {
  DB_STORAGE_KEY,
  emptyDb,
  exportDb,
  importInto,
  learn,
  loadDb,
  mergeList,
  parseTriggers,
  recognize,
  saveDb,
  suggestions,
  type RenameDb,
} from './database';

/** Een export zoals de HTML-tool (`pdf-hernoemer.html`) hem schrijft; verzonnen namen. */
const EXPORT = `{
  "afzenders": [
    {
      "naam": "Belastingdienst",
      "triggers": [
        "belastingdienst",
        "postbus 9000"
      ]
    },
    {
      "naam": "Gemeente Utrecht",
      "triggers": []
    }
  ],
  "onderwerpen": [
    {
      "naam": "Aanslag",
      "triggers": [
        "aanslag"
      ]
    }
  ]
}`;

/** Een nep-opslag, zoals `localStorage`. */
function memory(): StorageLike & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => void data.set(key, value),
  };
}

describe('recognize: een naam herkennen aan zijn herkenwoorden', () => {
  const list = [
    { naam: 'Bank', triggers: ['bank'] },
    { naam: 'ING', triggers: ['ing bank', 'nl99ingb'] },
    { naam: '', triggers: ['gemeente'] },
    { naam: 'Leeg', triggers: ['', '  '] },
  ];

  it('het langste herkenwoord wint, waar het ook in de lijst staat', () => {
    expect(recognize(list, 'Uw ING Bank afschrift')).toBe('ING');
    expect(recognize(list, 'Een andere bank')).toBe('Bank');
    expect(recognize([...list].reverse(), 'Uw ING Bank afschrift')).toBe('ING');
  });

  it('hoofdletters tellen niet mee, en spaties rond een herkenwoord ook niet', () => {
    expect(
      recognize([{ naam: 'Belastingdienst', triggers: ['  POSTBUS 9000 '] }], 'postbus 9000'),
    ).toBe('Belastingdienst');
  });

  it('een regel zonder naam of zonder herkenwoorden telt niet mee; geen treffer geeft null', () => {
    expect(recognize(list, 'Gemeente Utrecht')).toBeNull();
    expect(recognize(list, '')).toBeNull();
  });

  it('bij gelijke lengte wint de eerste', () => {
    const tie = [
      { naam: 'Eerste', triggers: ['abc'] },
      { naam: 'Tweede', triggers: ['xyz'] },
    ];
    expect(recognize(tie, 'xyz en abc')).toBe('Eerste');
  });
});

describe('learn: een ingevulde naam onthouden', () => {
  it('een nieuwe naam komt achteraan, zonder spaties eromheen en zonder herkenwoorden', () => {
    const db = learn(emptyDb(), 'afzenders', '  ING Bank ');
    expect(db).toEqual({ afzenders: [{ naam: 'ING Bank', triggers: [] }], onderwerpen: [] });
  });

  it('een bekende naam (op hoofdletters na) of een lege waarde verandert niets', () => {
    const db: RenameDb = { afzenders: [{ naam: 'ING Bank', triggers: ['ing'] }], onderwerpen: [] };
    expect(learn(db, 'afzenders', 'ing bank')).toBe(db);
    expect(learn(db, 'afzenders', '   ')).toBe(db);
    expect(learn(db, 'onderwerpen', 'ING Bank').onderwerpen).toEqual([
      { naam: 'ING Bank', triggers: [] },
    ]);
  });
});

describe('mergeList en importInto: een export samenvoegen', () => {
  it('een bekende naam krijgt alleen de nieuwe herkenwoorden erbij; een nieuwe naam komt achteraan', () => {
    const target = [{ naam: 'ING Bank', triggers: ['ing'] }];
    const { list, added } = mergeList(target, [
      { naam: ' ing bank ', triggers: ['ING', ' nl99ingb ', ''] },
      { naam: 'Gemeente', triggers: [' gemeente '] },
    ]);
    expect(list).toEqual([
      { naam: 'ING Bank', triggers: ['ing', 'nl99ingb'] },
      { naam: 'Gemeente', triggers: ['gemeente'] },
    ]);
    expect(added).toBe(1);
    // De bestaande lijst zelf blijft ongemoeid.
    expect(target).toEqual([{ naam: 'ING Bank', triggers: ['ing'] }]);
  });

  it('regels zonder bruikbare naam vallen weg; dubbele namen in de export worden er één', () => {
    const { list, added } = mergeList(
      [],
      [
        null,
        'tekst',
        { naam: 42 },
        { naam: '   ' },
        { naam: 'Notaris', triggers: 'notaris' },
        { naam: 'NOTARIS', triggers: ['notariaat'] },
      ],
    );
    expect(list).toEqual([{ naam: 'Notaris', triggers: ['notariaat'] }]);
    expect(added).toBe(1);
  });

  it('importInto voegt beide lijsten samen en telt per soort wat er nieuw is', () => {
    const db: RenameDb = {
      afzenders: [{ naam: 'belastingdienst', triggers: ['b/01'] }],
      onderwerpen: [],
    };
    const result = importInto(db, EXPORT);
    expect(result.added).toEqual({ afzenders: 1, onderwerpen: 1 });
    expect(result.db.afzenders).toEqual([
      { naam: 'belastingdienst', triggers: ['b/01', 'belastingdienst', 'postbus 9000'] },
      { naam: 'Gemeente Utrecht', triggers: [] },
    ]);
    expect(result.db.onderwerpen).toEqual([{ naam: 'Aanslag', triggers: ['aanslag'] }]);
  });

  it('iets anders dan een database-export geeft een fout', () => {
    expect(() => importInto(emptyDb(), 'geen json')).toThrow();
    expect(() => importInto(emptyDb(), '{"afzenders": []}')).toThrow('onverwachte structuur');
    expect(() => importInto(emptyDb(), 'null')).toThrow('onverwachte structuur');
    expect(() => importInto(emptyDb(), '[]')).toThrow('onverwachte structuur');
  });
});

describe('exportDb: hetzelfde bestand als de HTML-tool', () => {
  it('schrijft precies de vorm van de HTML-tool, en importeren geeft hetzelfde terug', () => {
    const db = importInto(emptyDb(), EXPORT).db;
    expect(exportDb(db)).toBe(EXPORT);
    expect(importInto(emptyDb(), exportDb(db)).db).toEqual(db);
  });
});

describe('loadDb en saveDb: bewaren in de browser', () => {
  it('wat bewaard is, komt bij het laden terug', () => {
    const storage = memory();
    const db = importInto(emptyDb(), EXPORT).db;
    saveDb(db, storage);
    expect(storage.data.has(DB_STORAGE_KEY)).toBe(true);
    expect(loadDb(storage)).toEqual(db);
  });

  it('niets, kapotte inhoud, een verkeerde vorm of geen opslag: een lege database', () => {
    const storage = memory();
    expect(loadDb(storage)).toEqual(emptyDb());
    storage.setItem(DB_STORAGE_KEY, '{kapot');
    expect(loadDb(storage)).toEqual(emptyDb());
    storage.setItem(DB_STORAGE_KEY, '{"afzenders": {}}');
    expect(loadDb(storage)).toEqual(emptyDb());
    expect(loadDb(null)).toEqual(emptyDb());
    expect(() => saveDb(emptyDb(), null)).not.toThrow();
  });

  it('rare regels worden rechtgezet, zodat de rest van de tool erop kan rekenen', () => {
    const storage = memory();
    storage.setItem(
      DB_STORAGE_KEY,
      '{"afzenders": [{"naam": "ING"}, null, {"naam": 3, "triggers": ["a", 1]}], "onderwerpen": []}',
    );
    expect(loadDb(storage).afzenders).toEqual([
      { naam: 'ING', triggers: [] },
      { naam: '', triggers: [] },
      { naam: '', triggers: ['a', '1'] },
    ]);
  });
});

describe('hulpjes', () => {
  it('parseTriggers: gescheiden door komma’s, zonder lege', () => {
    expect(parseTriggers(' belastingdienst, b/01 ,, ')).toEqual(['belastingdienst', 'b/01']);
    expect(parseTriggers('')).toEqual([]);
  });

  it('suggestions: alle namen, behalve lege', () => {
    expect(
      suggestions([
        { naam: 'ING', triggers: [] },
        { naam: '', triggers: ['x'] },
      ]),
    ).toEqual(['ING']);
  });
});
