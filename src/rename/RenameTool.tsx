import { useState } from 'preact/hooks';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { Dropzone } from '../components/Dropzone';
import { PaneHead } from '../components/WorkspaceParts';
import { SaveDialog } from '../components/SaveDialog';
import { useI18n } from '../i18n/LanguageContext';
import { format, plural } from '../i18n/format';
import { zipWriter } from '../lib/zip';
import { downloadFile } from '../pdf/save';
import { readLines } from './readText';
import {
  findDates,
  findSender,
  findSubject,
  nameLimit,
  proposeNames,
  uniqueNames,
  type DateCandidate,
} from './recognize';

/** Eén geopende PDF met wat erin herkend is en wat de gebruiker ervan maakt. */
type RenameDoc = {
  id: number;
  file: File;
  include: boolean;
  /** Herkende tekst (regels), leeg als de PDF geen tekstlaag heeft. */
  lines: string[];
  dates: DateCandidate[];
  date: string;
  sender: string;
  subject: string;
  manualName: boolean;
  customName: string;
  showText: boolean;
  error: boolean;
};

let nextId = 1;

/** Datum-tijdstempel JJJJMMDD_UUMM, voor de naam van de ZIP. */
function stamp(now = new Date()) {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}${p(now.getMonth() + 1)}${p(now.getDate())}_${p(now.getHours())}${p(now.getMinutes())}`;
}

/**
 * Slim hernoemen: gescande brieven openen, per brief een naam voorstellen
 * (`JJMMDD afzender onderwerp.pdf`), die nakijken en hernoemde kopieën downloaden. Werkt los van de
 * gewone taken, met een eigen lijst bestanden.
 */
export function RenameTool() {
  const { t } = useI18n();
  const r = t.rename;
  const [docs, setDocs] = useState<RenameDoc[]>([]);
  const [reading, setReading] = useState(false);
  const [showAll, setShowAll] = useState(true);
  const [asking, setAsking] = useState<'save' | 'clear' | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [changed, setChanged] = useState(false);

  const names = proposeNames(docs);
  const included = docs.filter((doc) => doc.include);
  const counts = new Map<string, number>();
  docs.forEach((doc, i) => {
    if (doc.include)
      counts.set(names[i]!.toLowerCase(), (counts.get(names[i]!.toLowerCase()) ?? 0) + 1);
  });

  const update = (id: number, change: Partial<RenameDoc>) => {
    setDocs((current) => current.map((doc) => (doc.id === id ? { ...doc, ...change } : doc)));
    setChanged(true);
    setSaved(null);
  };

  const add = async (files: File[]) => {
    const pdfs = files.filter(
      (file) => /\.pdf$/i.test(file.name) || file.type === 'application/pdf',
    );
    if (pdfs.length === 0) return;
    setReading(true);
    setSaved(null);
    for (const file of pdfs) {
      const doc: RenameDoc = {
        id: nextId++,
        file,
        include: true,
        lines: [],
        dates: [],
        date: '',
        sender: '',
        subject: '',
        manualName: false,
        customName: '',
        showText: showAll,
        error: false,
      };
      try {
        const { lines } = await readLines(file);
        doc.lines = lines;
        doc.dates = findDates(lines, file.name);
        doc.date = doc.dates[0]?.ymd ?? '';
        doc.sender = findSender(lines);
        doc.subject = findSubject(lines);
      } catch {
        doc.error = true;
      }
      setDocs((current) => [...current, doc]);
    }
    setReading(false);
    setChanged(true);
  };

  const clear = () => {
    setDocs([]);
    setSaved(null);
    setChanged(false);
    setAsking(null);
  };

  /** Downloadt de hernoemde kopieën: één bestand los, meer in een ZIP. */
  const download = async (zipName?: string) => {
    setAsking(null);
    const chosen = docs.flatMap((doc, i) => (doc.include ? [{ doc, name: names[i]! }] : []));
    if (chosen.length === 0) return;
    const unique = uniqueNames(chosen.map((entry) => entry.name));
    if (chosen.length === 1) {
      downloadFile(
        new Uint8Array(await chosen[0]!.doc.file.arrayBuffer()),
        unique[0]!,
        'application/pdf',
      );
      setSaved(format(r.savedOne, { name: unique[0]! }));
    } else {
      const zip = await zipWriter();
      for (const [i, entry] of chosen.entries()) {
        zip.add(unique[i]!, new Uint8Array(await entry.doc.file.arrayBuffer()));
      }
      downloadFile(zip.finish(), zipName!, 'application/zip');
      setSaved(format(r.saved, { n: chosen.length, name: zipName! }));
    }
    setChanged(false);
  };

  if (docs.length === 0) {
    return (
      <Dropzone
        title={r.openTitle}
        dropTitle={r.dropHere}
        hint={r.openHint}
        inputId="rename-files"
        accept="application/pdf,.pdf"
        chooseLabel={r.choose}
        onFiles={(files) => void add(files)}
      >
        {reading && (
          <p class="dropzone__status" role="status">
            {r.reading}
          </p>
        )}
      </Dropzone>
    );
  }

  const withoutDate = included.filter((doc) => doc.date.length !== 6).length;
  const status = [
    plural(docs.length, r.filesOne, format(r.files, { n: docs.length })),
    reading ? r.reading : withoutDate > 0 ? format(r.withoutDate, { n: withoutDate }) : r.ready,
  ].join(' · ');

  return (
    <section class="workspace rename" aria-labelledby="rename-tools-title">
      <div class="workspace__tools">
        <div class="document__bar">
          <div class="document__info">
            <h2 id="rename-tools-title" class="document__name">
              {plural(docs.length, r.filesOne, format(r.files, { n: docs.length }))}
            </h2>
          </div>
        </div>
        <div class="toolbar toolbar--tools" role="toolbar" aria-label={r.toolbar}>
          <div class="toolbar__group toolbar__group--wide">
            <input
              id="rename-add"
              class="visually-hidden"
              type="file"
              accept="application/pdf,.pdf"
              multiple
              disabled={reading}
              onChange={(event) => {
                const files = [...(event.currentTarget.files ?? [])];
                event.currentTarget.value = '';
                void add(files);
              }}
            />
            <label for="rename-add" class="button button--secondary">
              {r.add}
            </label>
            <button
              type="button"
              class="button"
              disabled={reading || included.length === 0}
              onClick={() => (included.length === 1 ? void download() : setAsking('save'))}
            >
              {r.download}
            </button>
          </div>
          <div class="toolbar__group toolbar__group--wide">
            <button
              type="button"
              class="button button--secondary"
              aria-pressed={showAll}
              onClick={() => {
                setShowAll(!showAll);
                setDocs((current) => current.map((doc) => ({ ...doc, showText: !showAll })));
              }}
            >
              {showAll ? r.hideAllText : r.showAllText}
            </button>
            <button
              type="button"
              class="button button--secondary"
              onClick={() => (changed ? setAsking('clear') : clear())}
            >
              {r.clear}
            </button>
          </div>
        </div>
        <p class="page-editor__status" aria-live="polite">
          {status}
        </p>
        {saved && (
          <p class="page-editor__saved" role="status">
            {saved}
          </p>
        )}
        <p class="annotate__hint">{r.rules}</p>
      </div>
      <div class="workspace__view" data-scroll-root>
        <PaneHead title={r.table} />
        <table class="rename-table">
          <thead>
            <tr>
              <th scope="col" class="rename-table__include">
                <span class="visually-hidden">{r.columns.include}</span>
              </th>
              <th scope="col">{r.columns.original}</th>
              <th scope="col" class="rename-table__date">
                {r.columns.date}
              </th>
              <th scope="col">{r.columns.sender}</th>
              <th scope="col">{r.columns.subject}</th>
              <th scope="col" class="rename-table__name">
                {r.columns.name}
              </th>
            </tr>
          </thead>
          <tbody>
            {docs.map((doc, i) => {
              const name = names[i]!;
              const { length, limit } = nameLimit(name);
              const over = length > limit;
              const duplicate = doc.include && (counts.get(name.toLowerCase()) ?? 0) > 1;
              const noDate = doc.date.length !== 6;
              const warn = doc.include && (over || duplicate || noDate);
              const file = doc.file.name;
              const text = doc.lines.join('\n');
              return (
                <tr
                  key={doc.id}
                  class={[doc.include ? '' : 'rename-table__skip', warn ? 'rename-table__warn' : '']
                    .filter(Boolean)
                    .join(' ')}
                >
                  <td class="rename-table__include">
                    <input
                      type="checkbox"
                      checked={doc.include}
                      aria-label={format(r.includeLabel, { name: file })}
                      onChange={(event) => update(doc.id, { include: event.currentTarget.checked })}
                    />
                  </td>
                  <td class="rename-table__original">
                    <span class="rename-table__file">{file}</span>
                    {doc.error && <span class="rename-table__problem">{r.readError}</span>}
                    {!doc.error && doc.lines.length === 0 && (
                      <span class="rename-table__problem">{r.noText}</span>
                    )}
                    {text && (
                      <>
                        <button
                          type="button"
                          class="link-button"
                          aria-expanded={doc.showText}
                          onClick={() => update(doc.id, { showText: !doc.showText })}
                        >
                          {doc.showText ? r.hideText : r.showText}
                        </button>
                        {doc.showText && (
                          <pre class="rename-table__text">{text.slice(0, 1500)}</pre>
                        )}
                      </>
                    )}
                  </td>
                  <td class="rename-table__date">
                    <input
                      type="text"
                      inputMode="numeric"
                      maxLength={6}
                      value={doc.date}
                      aria-label={format(r.dateLabel, { name: file })}
                      aria-invalid={noDate}
                      onInput={(event) =>
                        update(doc.id, {
                          date: event.currentTarget.value.replace(/\D/g, '').slice(0, 6),
                          manualName: false,
                        })
                      }
                    />
                    {doc.dates.length > 0 && (
                      <select
                        aria-label={format(r.candidatesLabel, { name: file })}
                        value=""
                        onChange={(event) => {
                          const value = event.currentTarget.value;
                          if (value) update(doc.id, { date: value, manualName: false });
                        }}
                      >
                        <option value="">{r.candidates}</option>
                        {doc.dates.map((date) => (
                          <option key={date.ymd} value={date.ymd}>
                            {`${date.ymd} · ${r.sources[date.source]}: ${date.raw}`}
                          </option>
                        ))}
                      </select>
                    )}
                  </td>
                  <td>
                    <input
                      type="text"
                      value={doc.sender}
                      aria-label={format(r.senderLabel, { name: file })}
                      onInput={(event) =>
                        update(doc.id, { sender: event.currentTarget.value, manualName: false })
                      }
                    />
                  </td>
                  <td>
                    <input
                      type="text"
                      value={doc.subject}
                      aria-label={format(r.subjectLabel, { name: file })}
                      onInput={(event) =>
                        update(doc.id, { subject: event.currentTarget.value, manualName: false })
                      }
                    />
                  </td>
                  <td class="rename-table__name">
                    <input
                      type="text"
                      // Met de hand: precies wat er getypt wordt (".pdf" komt er bij het opslaan bij).
                      value={doc.manualName ? doc.customName : name}
                      aria-label={format(r.nameLabel, { name: file })}
                      aria-invalid={over}
                      onInput={(event) =>
                        update(doc.id, { manualName: true, customName: event.currentTarget.value })
                      }
                    />
                    <span class="rename-table__meta">
                      {[
                        `${length}/${limit}`,
                        over && r.tooLong,
                        duplicate && r.duplicate,
                        noDate && r.noDate,
                      ]
                        .filter(Boolean)
                        .join(' · ')}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {asking === 'save' && (
        <SaveDialog
          title={r.saveTitle}
          suggestion={`${r.zipName}_${stamp()}.zip`}
          extension=".zip"
          onConfirm={(fileName) => void download(fileName)}
          onCancel={() => setAsking(null)}
        />
      )}
      {asking === 'clear' && (
        <ConfirmDialog
          title={r.clearTitle}
          text={r.clearText}
          cancel={t.closeDialog.cancel}
          confirm={r.clear}
          onCancel={() => setAsking(null)}
          onConfirm={clear}
        />
      )}
    </section>
  );
}
