import { formatFileSize } from '../lib/format';
import type { PageText } from './layout';

/**
 * Het documentprofiel: de gegevens van twee PDF's naast elkaar (bestand, pagina's, metadata,
 * tekstlaag) en per pagina het formaat en het aantal tekens. Overgenomen uit de losse
 * pdf-vergelijker; de waarden zijn tekst, zodat gelijk en ongelijk precies is wat je ziet.
 */

/** Wat pdf.js uit het informatiewoordenboek van een PDF haalt (alleen wat we gebruiken). */
export type DocInfo = {
  PDFFormatVersion?: string;
  /** Het soort versleuteling, of null als de PDF niet versleuteld is. */
  EncryptFilterName?: string | null;
  Title?: string;
  Author?: string;
  Subject?: string;
  Keywords?: string;
  Creator?: string;
  Producer?: string;
  CreationDate?: string;
  ModDate?: string;
};

/** Wat het profiel van één PDF nodig heeft. */
export type ProfileDoc = {
  name: string;
  size: number;
  pageCount: number;
  pages: readonly PageText[];
  info: DocInfo;
};

export const FIELDS = [
  'name',
  'size',
  'pages',
  'sizes',
  'version',
  'encrypted',
  'title',
  'author',
  'subject',
  'keywords',
  'creator',
  'producer',
  'created',
  'modified',
  'chars',
  'noText',
] as const;

export type FieldId = (typeof FIELDS)[number];

export type ProfileRow = { id: FieldId; a: string; b: string; differs: boolean };

/** Teksten die het profiel zelf invult. */
export type ProfileWords = { yes: string; no: string };

/**
 * Een PDF-datum ("D:20180604090000+02'00'") als "4 juni 2018, 09:00", zoals hij in de PDF staat
 * (zonder omrekenen naar een andere tijdzone). Leeg blijft leeg; wat geen datum is, blijft staan.
 */
export function pdfDate(raw: string | undefined, language: string): string {
  if (!raw) return '';
  const m = /D?:?(\d{4})(\d{2})(\d{2})(\d{2})?(\d{2})?/.exec(raw);
  if (!m) return String(raw);
  const month = Number(m[2]);
  if (month < 1 || month > 12) return String(raw);
  const name = new Intl.DateTimeFormat(language, { month: 'long', timeZone: 'UTC' }).format(
    Date.UTC(2000, month - 1, 1),
  );
  const date = `${Number(m[3])} ${name} ${Number(m[1])}`;
  return m[4] && m[5] ? `${date}, ${m[4]}:${m[5]}` : date;
}

/** "595×842" (afgerond, in punten). */
export const pageSize = (page: PageText) => `${Math.round(page.w)}×${Math.round(page.h)}`;

const totalChars = (doc: ProfileDoc) => doc.pages.reduce((n, page) => n + page.chars, 0);
const withoutText = (doc: ProfileDoc) => doc.pages.filter((page) => page.items.length === 0).length;

/** De paginaformaten met hun aantal: "595×842 pt (3), 842×595 pt (1)". */
function sizes(doc: ProfileDoc): string {
  const counts = new Map<string, number>();
  for (const page of doc.pages) {
    const key = `${pageSize(page)} pt`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts].map(([key, n]) => `${key} (${n})`).join(', ');
}

function values(doc: ProfileDoc, language: string, words: ProfileWords): Record<FieldId, string> {
  const info = doc.info;
  return {
    name: doc.name,
    size: formatFileSize(doc.size, language),
    pages: String(doc.pageCount),
    sizes: sizes(doc),
    version: info.PDFFormatVersion ?? '',
    encrypted: info.EncryptFilterName ? words.yes : words.no,
    title: info.Title ?? '',
    author: info.Author ?? '',
    subject: info.Subject ?? '',
    keywords: info.Keywords ?? '',
    creator: info.Creator ?? '',
    producer: info.Producer ?? '',
    created: pdfDate(info.CreationDate, language),
    modified: pdfDate(info.ModDate, language),
    chars: totalChars(doc).toLocaleString(language),
    noText: String(withoutText(doc)),
  };
}

/** De 16 velden van A en B naast elkaar, met of ze verschillen. */
export function profileRows(
  a: ProfileDoc,
  b: ProfileDoc,
  language: string,
  words: ProfileWords,
): ProfileRow[] {
  const va = values(a, language, words);
  const vb = values(b, language, words);
  return FIELDS.map((id) => {
    const left = String(va[id]).trim();
    const right = String(vb[id]).trim();
    return { id, a: left, b: right, differs: left !== right };
  });
}

/** Wat er bij een pagina opvalt. */
export type PageNote =
  | { kind: 'onlyA' | 'onlyB' | 'size' | 'noTextBoth' | 'noTextA' | 'noTextB' }
  | { kind: 'chars'; n: number };

export type PageRow = { no: number; a: PageText | null; b: PageText | null; notes: PageNote[] };

/**
 * Per pagina: formaat en tekens van A en B, met wat opvalt. Een verschil in tekens telt pas als
 * het duidelijk is: meer dan 20 tekens én meer dan 10 % van de grootste.
 */
export function pageRows(a: ProfileDoc, b: ProfileDoc): PageRow[] {
  const rows: PageRow[] = [];
  for (let no = 1; no <= Math.max(a.pageCount, b.pageCount); no++) {
    const pa = a.pages[no - 1] ?? null;
    const pb = b.pages[no - 1] ?? null;
    const notes: PageNote[] = [];
    if (!pa) notes.push({ kind: 'onlyB' });
    else if (!pb) notes.push({ kind: 'onlyA' });
    else {
      if (pageSize(pa) !== pageSize(pb)) notes.push({ kind: 'size' });
      const ca = pa.chars;
      const cb = pb.chars;
      if (ca === 0 && cb === 0) notes.push({ kind: 'noTextBoth' });
      else if (ca === 0) notes.push({ kind: 'noTextA' });
      else if (cb === 0) notes.push({ kind: 'noTextB' });
      else if (Math.abs(ca - cb) > Math.max(20, Math.max(ca, cb) * 0.1)) {
        notes.push({ kind: 'chars', n: cb - ca });
      }
    }
    rows.push({ no, a: pa, b: pb, notes });
  }
  return rows;
}
