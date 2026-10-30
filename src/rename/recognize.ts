/**
 * Slim hernoemen: uit de tekst van een gescande brief een bestandsnaam voorstellen,
 * `JJMMDD afzender onderwerp.pdf`. Overgenomen uit Jörgs `pdf-hernoemer.html` (daar beproefd met
 * echte scans); de regels en de scores zijn bewust gelijk gehouden.
 */

/** Een stukje tekst van pdf.js (`getTextContent`), met zijn plek op de pagina. */
export type TextItem = { str?: string; transform: number[]; width?: number };

/** Maanden in het Nederlands, voluit en afgekort. */
const MONTHS: Record<string, number> = {
  januari: 1,
  februari: 2,
  maart: 3,
  april: 4,
  mei: 5,
  juni: 6,
  juli: 7,
  augustus: 8,
  september: 9,
  oktober: 10,
  november: 11,
  december: 12,
  jan: 1,
  feb: 2,
  mrt: 3,
  apr: 4,
  jun: 6,
  jul: 7,
  aug: 8,
  sep: 9,
  sept: 9,
  okt: 10,
  nov: 11,
  dec: 12,
};

/** Hoeveel tekens afzender en onderwerp samen mogen hebben. */
export const MAX_REST = 20;

/**
 * Zet de stukjes tekst van een pagina om in leesbare regels: op hoogte gegroepeerd (bovenaan
 * eerst), en binnen een regel van links naar rechts, met een spatie waar er ruimte tussen zit.
 */
export function linesFrom(items: readonly TextItem[]): string[] {
  const tolerance = 3;
  const rows: { y: number; parts: { x: number; w: number; s: string }[] }[] = [];
  for (const item of items) {
    if (item.str === undefined || item.str === '') continue;
    const y = item.transform[5]!;
    const x = item.transform[4]!;
    let row = rows.find((r) => Math.abs(r.y - y) <= tolerance);
    if (!row) {
      row = { y, parts: [] };
      rows.push(row);
    }
    row.parts.push({ x, w: item.width || 0, s: item.str });
  }
  rows.sort((a, b) => b.y - a.y);
  return rows
    .map((row) => {
      row.parts.sort((a, b) => a.x - b.x);
      let text = '';
      let previousEnd: number | null = null;
      for (const part of row.parts) {
        if (
          previousEnd !== null &&
          part.x - previousEnd > 1.2 &&
          !/\s$/.test(text) &&
          !/^\s/.test(part.s)
        ) {
          text += ' ';
        }
        text += part.s;
        previousEnd = part.x + part.w;
      }
      return text.replace(/\s+/g, ' ').trim();
    })
    .filter((line) => line.length > 0);
}

/* Datum */

/** Waar een datum vandaan komt: tekst ("4 juni 2026"), ISO, dag-maand-jaar, of de bestandsnaam. */
export type DateSource = 'text' | 'iso' | 'dmy' | 'fileName';

export type DateCandidate = {
  /** De datum als JJMMDD. */
  ymd: string;
  score: number;
  source: DateSource;
  /** Zoals hij in de tekst (of de naam) stond. */
  raw: string;
};

/**
 * Alle datums in de tekst, de waarschijnlijkste eerst. Een datum bij "datum" of "dagtekening"
 * telt zwaar, een datum hoger op de pagina iets zwaarder, een uitgeschreven datum ook. Als laatste
 * redmiddel telt een datum in de bestandsnaam van de scan (`scan_20260613_…`) mee. Jaren voor 1990
 * of na volgend jaar vallen weg.
 */
export function findDates(
  lines: readonly string[],
  fileName: string,
  nowYear = new Date().getFullYear(),
): DateCandidate[] {
  const candidates: DateCandidate[] = [];
  const monthAlt = Object.keys(MONTHS)
    .sort((a, b) => b.length - a.length)
    .join('|');
  const reText = new RegExp(
    '(\\d{1,2})\\s*(?:e\\.?|de)?\\s+(' + monthAlt + ')\\.?\\s+(\\d{4})',
    'gi',
  );
  const reNum = /\b(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})\b/g;
  const reIso = /\b(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})\b/g;
  const total = lines.length || 1;
  const add = (
    day: number,
    month: number,
    year: number,
    near: boolean,
    early: number,
    source: DateSource,
    raw: string,
    bonus = 0,
  ) => {
    if (!(month >= 1 && month <= 12) || !(day >= 1 && day <= 31)) return;
    if (year < 1990 || year > nowYear + 1) return;
    let score = 2 + bonus + early * 2;
    if (near) score += 6;
    if (source === 'text') score += 3;
    if (source === 'iso') score += 1;
    const ymd =
      String(year % 100).padStart(2, '0') +
      String(month).padStart(2, '0') +
      String(day).padStart(2, '0');
    candidates.push({ ymd, score, source, raw: raw.trim() });
  };

  lines.forEach((line, index) => {
    const near = /datum|dagtekening|verzonden|verzenddatum/i.test(line);
    const early = (total - index) / total;
    for (const m of line.matchAll(reText)) {
      add(+m[1]!, MONTHS[m[2]!.toLowerCase()]!, +m[3]!, near, early, 'text', m[0]);
    }
    for (const m of line.matchAll(reIso)) add(+m[3]!, +m[2]!, +m[1]!, near, early, 'iso', m[0]);
    for (const m of line.matchAll(reNum)) {
      let year = +m[3]!;
      if (year < 100) year += year < 70 ? 2000 : 1900;
      add(+m[1]!, +m[2]!, year, near, early, 'dmy', m[0]);
    }
  });

  const fromName = fileName.match(/(20\d{2})[-_.]?(\d{2})[-_.]?(\d{2})/);
  if (fromName) {
    add(+fromName[3]!, +fromName[2]!, +fromName[1]!, false, 0, 'fileName', fromName[0], -3);
  }

  // Per datum de hoogste score.
  const best = new Map<string, DateCandidate>();
  for (const candidate of candidates) {
    const known = best.get(candidate.ymd);
    if (!known || candidate.score > known.score) best.set(candidate.ymd, candidate);
  }
  return [...best.values()].sort((a, b) => b.score - a.score);
}

/* Afzender */

/** Woorden die op een organisatie wijzen (in een briefhoofd). */
const ORG =
  /\b(b\.?\s?v\.?|n\.?\s?v\.?|gemeente|belastingdienst|ministerie|stichting|vereniging|notariaat|notaris|advoca|gerecht|rechtbank|bank|verzekerin|ziekenhuis|hogeschool|universiteit|pensioen|woningcorporatie|coöperatie|holding|incasso|deurwaarder)\b/i;

/** Regels die geen afzender of onderwerp zijn: nummers, postcodes, kopjes als "Datum" of "Betreft". */
function isNoise(line: string): boolean {
  if (line.length < 2) return true;
  if (/^[\d\s.\-/]+$/.test(line)) return true;
  if (/^\d{4}\s?[a-z]{2}\b/i.test(line)) return true;
  if (
    /^(pagina|blad|bladzijde|datum|kenmerk|ons kenmerk|uw kenmerk|betreft|onderwerp|referentie|factuur(nummer)?)\b/i.test(
      line,
    )
  ) {
    return true;
  }
  return false;
}

/**
 * De afzender uit het briefhoofd (de bovenste 15 regels): een regel met een organisatiewoord wint,
 * anders de bovenste zinvolle regel; zonder bruikbare regel het domein van een e-mailadres. Hooguit
 * 3 woorden, en alles na een leesteken valt weg.
 */
export function findSender(lines: readonly string[]): string {
  const top = lines.slice(0, 15);
  let best: string | null = null;
  let bestScore = -1;
  let emailDomain = '';
  top.forEach((line, index) => {
    const email = line.match(/[\w.+-]+@([\w-]+)\.[\w.-]+/);
    if (email && !emailDomain) emailDomain = email[1]!;
    if (isNoise(line)) return;
    let score = top.length - index;
    if (ORG.test(line)) score += 12;
    if (line.length > 45) score -= 4;
    if (/^[A-ZÀ-Þ]/.test(line)) score += 1;
    if (score > bestScore) {
      bestScore = score;
      best = line;
    }
  });
  let sender: string = best || emailDomain || '';
  sender = sender.replace(/[,.;:].*$/, '').trim();
  return sender.split(/\s+/).slice(0, 3).join(' ');
}

/* Onderwerp */

/**
 * Het onderwerp: wat na "Betreft:", "Onderwerp:" of "Inzake:" staat, of anders een opvallende
 * korte regel bovenaan (niet de eerste, dat is meestal de afzender).
 */
export function findSubject(lines: readonly string[]): string {
  const labelRe = /^(betreft|onderwerp|inzake|re|subject)\s*[:-]\s*(.+)$/i;
  for (const line of lines) {
    const m = line.match(labelRe);
    if (m && m[2]!.trim().length >= 2) return m[2]!.trim();
  }
  const top = lines.slice(0, 18);
  for (let i = 0; i < top.length; i += 1) {
    const line = top[i]!;
    if (isNoise(line)) continue;
    if (line.length >= 6 && line.length <= 60 && /[a-zà-þ]/i.test(line)) {
      if (i === 0) continue;
      return line;
    }
  }
  return '';
}

/* Naam */

/** Afzender en onderwerp als deel van een bestandsnaam: kleine letters, zonder verboden tekens. */
export function cleanRest(text: string): string {
  return (text || '')
    .toLowerCase()
    .replace(/\.pdf$/i, '')
    .replace(/[\\/:*?"<>|]/g, ' ')
    .replace(/[^\p{L}\p{N} _-]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Zet er ".pdf" achter als dat er nog niet staat. */
export function ensurePdf(name: string): string {
  const trimmed = (name || '').trim();
  return /\.pdf$/i.test(trimmed) ? trimmed : `${trimmed}.pdf`;
}

/** Wat er van één bestand nodig is om zijn naam te maken. */
export type NameInput = {
  /** JJMMDD (of wat er ingevuld is). */
  date: string;
  sender: string;
  subject: string;
  include: boolean;
  /** Met de hand een naam gegeven: die blijft zoals hij is. */
  manualName: boolean;
  customName: string;
};

/**
 * De nieuwe naam per bestand: `JJMMDD afzender onderwerp.pdf`, met afzender en onderwerp samen
 * hooguit `MAX_REST` tekens. Hebben meegenomen bestanden dezelfde naam, dan krijgen ze een volgnummer
 * direct achter de datum (`260604_01 …`); zonder datum achteraan. Een met de hand gegeven naam blijft.
 */
export function proposeNames(inputs: readonly NameInput[]): string[] {
  const rests: string[] = [];
  const names = inputs.map((input, index) => {
    if (input.manualName) return ensurePdf(input.customName);
    let rest = cleanRest(`${input.sender || ''} ${input.subject || ''}`);
    if (rest.length > MAX_REST) rest = rest.slice(0, MAX_REST).trim();
    rests[index] = rest;
    const base = input.date ? input.date + (rest ? ` ${rest}` : '') : rest || 'naamloos';
    return ensurePdf(base);
  });
  const groups = new Map<string, number[]>();
  inputs.forEach((input, index) => {
    if (input.manualName || !input.include) return;
    const key = names[index]!.toLowerCase();
    groups.set(key, [...(groups.get(key) ?? []), index]);
  });
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    group.forEach((index, n) => {
      const number = String(n + 1).padStart(2, '0');
      const date = inputs[index]!.date || '';
      const rest = rests[index] ?? '';
      names[index] = ensurePdf(
        date ? `${date}_${number}${rest ? ` ${rest}` : ''}` : `${rest || 'naamloos'}_${number}`,
      );
    });
  }
  return names;
}

/**
 * Hoe lang een naam mag zijn (zonder ".pdf"): 27 tekens (`JJMMDD ` en 20), of 30 met een
 * volgnummer (`_01`).
 */
export function nameLimit(name: string): { length: number; limit: number } {
  const base = name.replace(/\.pdf$/i, '');
  return { length: base.length, limit: base.includes('_') ? 30 : 27 };
}

/** Maakt namen uniek voor in één ZIP: een tweede "a.pdf" wordt "a_02.pdf". */
export function uniqueNames(names: readonly string[]): string[] {
  const used = new Map<string, number>();
  return names.map((name) => {
    const key = name.toLowerCase();
    const count = (used.get(key) ?? 0) + 1;
    used.set(key, count);
    return count === 1
      ? name
      : `${name.replace(/\.pdf$/i, '')}_${String(count).padStart(2, '0')}.pdf`;
  });
}
