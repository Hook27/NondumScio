import { format, plural } from '../i18n/format';
import type { Messages } from '../i18n/nl';
import { formatFileSize } from '../lib/format';
import { countRows, type CompareOptions, type Row } from './diff';
import type { ProfileRow } from './profile';

/**
 * Het rapport van een vergelijking als platte tekst, om te kopiëren of te downloaden: de documenten,
 * de instellingen, waarschuwingen, het documentprofiel en de tekstverschillen in blokken
 * (`@@ A pagina 2 | B pagina 2 @@`, met − en + en één ongewijzigd stuk ervoor en erna). Overgenomen
 * uit de losse pdf-vergelijker; het beeld zat daar ook niet in.
 */

type Texts = Messages['compare'];

/** Wat het rapport van één document noemt. */
export type ReportDoc = { name: string; size: number; pageCount: number; noText: number };

export type ReportInput = {
  a: ReportDoc;
  b: ReportDoc;
  options: CompareOptions;
  rows: readonly Row[];
  /** Alleen op volgorde vergeleken (te groot voor een volledige vergelijking). */
  fallback: boolean;
  profile: readonly ProfileRow[];
  texts: Texts;
  language: string;
  now: Date;
};

/** De instellingen in woorden: "per alinea, alinea-gevoeligheid 1,3, …". */
function settings({ options, texts, language }: ReportInput): string {
  const r = texts.report.settings;
  const parts = [format(r.level, { level: texts.levels[options.level].label.toLowerCase() })];
  if (options.level !== 'line') {
    parts.push(
      format(r.gap, {
        n: options.gapFactor.toLocaleString(language, {
          minimumFractionDigits: 1,
          maximumFractionDigits: 1,
        }),
      }),
    );
  }
  if (options.ignoreCase) parts.push(r.ignoreCase);
  if (options.strip) parts.push(r.strip);
  if (options.columns) parts.push(r.columns);
  if (options.dehyphen) parts.push(r.dehyphen);
  return format(r.label, { list: parts.join(', ') });
}

export function buildReport(input: ReportInput): string {
  const { a, b, rows, fallback, profile, texts, language, now } = input;
  const r = texts.report;
  const doc = (side: string, d: ReportDoc) =>
    format(r.doc, {
      side,
      name: d.name,
      pages: plural(d.pageCount, texts.pagesOne, texts.pages),
      size: formatFileSize(d.size, language),
    });
  const lines: string[] = [
    r.title,
    format(r.created, {
      date: now.toLocaleString(language, { dateStyle: 'short', timeStyle: 'short' }),
    }),
    doc('A', a),
    doc('B', b),
    settings(input),
  ];
  if (fallback) lines.push(r.fallback);
  if (a.noText || b.noText) lines.push(format(r.noText, { a: a.noText, b: b.noText }));

  lines.push('', r.profileTitle);
  for (const row of profile) {
    lines.push(`${row.differs ? '≠ ' : '  '}${texts.profile.fields[row.id]}:`);
    lines.push(`    A: ${row.a || r.empty}`);
    lines.push(`    B: ${row.b || r.empty}`);
  }

  const counts = countRows(rows);
  lines.push('', r.textTitle);
  lines.push(
    (['added', 'removed', 'changed'] as const)
      .map((kind) => format(texts.counts[kind], { n: counts[kind] }))
      .join(', '),
  );
  lines.push('');
  if (!counts.added && !counts.removed && !counts.changed) {
    lines.push(r.none);
    return `${lines.join('\n')}\n`;
  }

  // Blokken van verschillen die op elkaar volgen, met één ongewijzigd stuk ervoor en erna.
  const keep = new Array<boolean>(rows.length).fill(false);
  rows.forEach((row, i) => {
    if (row.kind === 'equal') return;
    for (let k = Math.max(0, i - 1); k <= Math.min(rows.length - 1, i + 1); k++) keep[k] = true;
  });
  let i = 0;
  while (i < rows.length) {
    if (!keep[i]) {
      i++;
      continue;
    }
    let j = i;
    while (j < rows.length && keep[j]) j++;
    const first = rows[i]!;
    const pageA = first.kind === 'added' ? first.b.page : first.a.page;
    const pageB = first.kind === 'removed' ? first.a.page : first.b.page;
    lines.push(format(r.hunk, { a: pageA, b: pageB }));
    for (const row of rows.slice(i, j)) {
      if (row.kind === 'equal') lines.push(`  ${row.a.val}`);
      else if (row.kind === 'changed') lines.push(`- ${row.a.val}`, `+ ${row.b.val}`);
      else if (row.kind === 'removed') lines.push(`- ${row.a.val}`);
      else lines.push(`+ ${row.b.val}`);
    }
    lines.push('');
    i = j;
  }
  return lines.join('\n');
}

/** Tekst naar het klembord; lukt dat niet (oudere browser, geen toestemming), dan de oude manier. */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const area = document.createElement('textarea');
    area.value = text;
    area.setAttribute('readonly', '');
    area.style.position = 'fixed';
    area.style.opacity = '0';
    document.body.append(area);
    area.select();
    let ok: boolean;
    try {
      ok = document.execCommand('copy');
    } catch {
      ok = false;
    }
    area.remove();
    return ok;
  }
}
