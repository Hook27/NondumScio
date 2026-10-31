import { useState } from 'preact/hooks';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { Dropzone } from '../components/Dropzone';
import { PaneHead } from '../components/WorkspaceParts';
import { SaveDialog } from '../components/SaveDialog';
import { useI18n } from '../i18n/LanguageContext';
import { format, plural } from '../i18n/format';
import { zipWriter } from '../lib/zip';
import { downloadFile } from '../pdf/save';
import { learn, recognize, suggestions, type DbKind, type RenameDb } from './database';
import { DatabaseView } from './DatabaseView';
import { PreviewDialog } from './PreviewDialog';
import { openScanReader, readLines, type ScanReader } from './readText';
import { RenameMerge } from './RenameMerge';
import {
  findDates,
  findSender,
  findSubject,
  nameLimit,
  proposeNames,
  uniqueNames,
} from './recognize';
import {
  clearRename,
  getRenameDb,
  getRenameState,
  newId,
  setRenameDb,
  setRenameState,
  useRenameDb,
  useRenameState,
  type RenameDoc,
  type RenameView,
} from './store';

/** Wat de database in de tekst van een brief herkent; dat gaat vóór wat de tool zelf vond. */
function fromDb(lines: readonly string[], db: RenameDb): Partial<RenameDoc> {
  const text = lines.join('\n');
  const found: Partial<RenameDoc> = {};
  const sender = recognize(db.afzenders, text);
  const subject = recognize(db.onderwerpen, text);
  if (sender) Object.assign(found, { sender, senderRec: true });
  if (subject) Object.assign(found, { subject, subjectRec: true });
  return found;
}

/** Wat de tool in de tekst van een brief vindt: datums, afzender en onderwerp (de database voorop). */
function fieldsFrom(lines: readonly string[], fileName: string, db: RenameDb) {
  const dates = findDates(lines, fileName);
  return {
    dates,
    date: dates[0]?.ymd ?? '',
    sender: findSender(lines),
    subject: findSubject(lines),
    senderRec: false,
    subjectRec: false,
    ...fromDb(lines, db),
  };
}

/**
 * Tekstherkenning (OCR) voor de brieven zonder tekstlaag, nadat de rest gelezen is. Wat je
 * intussen zelf aanpaste, blijft staan: alleen velden die nog zijn zoals ze waren, worden ingevuld.
 */
async function recognizeScans(scans: readonly RenameDoc[]) {
  const total = scans.length;
  const finish = (id: number, change: (doc: RenameDoc) => Partial<RenameDoc>) =>
    setRenameState((current) => ({
      docs: current.docs.map((doc) => (doc.id === id ? { ...doc, ...change(doc) } : doc)),
    }));
  setRenameState(() => ({ ocrProgress: { loading: 0, done: 0, total } }));
  let reader: ScanReader;
  try {
    reader = await openScanReader((loading) =>
      setRenameState(() => ({ ocrProgress: { loading, done: 0, total } })),
    );
  } catch {
    for (const scan of scans) finish(scan.id, () => ({ ocr: 'failed' }));
    return;
  }
  try {
    for (const [index, scan] of scans.entries()) {
      setRenameState(() => ({ ocrProgress: { loading: null, done: index, total } }));
      try {
        const lines = await reader.read(scan.file);
        const found = fieldsFrom(lines, scan.file.name, getRenameDb());
        finish(scan.id, (doc) => {
          const change: Partial<RenameDoc> = {
            lines,
            dates: found.dates,
            ocr: lines.length > 0 ? 'done' : 'empty',
          };
          if (doc.date === scan.date) change.date = found.date;
          if (doc.sender === scan.sender) {
            Object.assign(change, { sender: found.sender, senderRec: found.senderRec });
          }
          if (doc.subject === scan.subject) {
            Object.assign(change, { subject: found.subject, subjectRec: found.subjectRec });
          }
          return change;
        });
      } catch {
        finish(scan.id, () => ({ ocr: 'failed' }));
      }
    }
  } finally {
    reader.close();
  }
}

/** Onthoudt een ingevulde afzender of onderwerp in de database. */
const remember = (kind: DbKind, value: string) => setRenameDb(learn(getRenameDb(), kind, value));

/**
 * Bij het downloaden: afzender en onderwerp van elke meegenomen brief komen in de database, ook
 * wat de tool zelf vond (met het downloaden keur je ze goed). Dit wijkt bewust af van de HTML-tool,
 * die alleen onthoudt wat je zelf aanpast.
 */
function rememberAll(docs: readonly RenameDoc[]) {
  let db = getRenameDb();
  for (const doc of docs) {
    db = learn(db, 'afzenders', doc.sender);
    db = learn(db, 'onderwerpen', doc.subject);
  }
  setRenameDb(db);
}

/** Datum-tijdstempel JJJJMMDD_UUMM, voor de naam van de ZIP. */
function stamp(now = new Date()) {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}${p(now.getMonth() + 1)}${p(now.getDate())}_${p(now.getHours())}${p(now.getMinutes())}`;
}

/**
 * Slim hernoemen: gescande brieven openen, per brief een naam voorstellen
 * (`JJMMDD afzender onderwerp.pdf`), die nakijken en hernoemde kopieën downloaden. Werkt los van de
 * gewone taken, met een eigen lijst bestanden. De stand staat buiten het scherm (`store.ts`), zodat
 * hij blijft als je even naar een andere taak gaat. Met de schakelaar bovenaan ga je naar
 * samenvoegen en naar de database met afzenders en onderwerpen.
 */
export function RenameTool() {
  const { view } = useRenameState();
  return (
    <>
      {/* Op een vaste plek boven het werkvak, zodat hij niet verspringt (en de focus houdt). */}
      <div class="rename-mode">
        <ViewToggle view={view} />
      </div>
      {view === 'merge' ? <RenameMerge /> : view === 'database' ? <DatabaseView /> : <RenameList />}
    </>
  );
}

/** De keuze tussen Hernoemen, Samenvoegen en Database, met dezelfde knoppen als bij Omzetten. */
function ViewToggle({ view }: { view: RenameView }) {
  const { t } = useI18n();
  const v = t.rename.views;

  const options: readonly { value: RenameView; label: string }[] = [
    { value: 'rename', label: v.rename },
    { value: 'merge', label: v.merge },
    { value: 'database', label: v.database },
  ];

  return (
    <div class="segmented" role="group" aria-label={v.label}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          class="segmented__button"
          aria-pressed={view === option.value}
          onClick={() => setRenameState(() => ({ view: option.value }))}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

/** Hernoemen: de lijst met brieven en hun voorgestelde namen. */
function RenameList() {
  const { t } = useI18n();
  const r = t.rename;
  const { docs, reading, ocrProgress, showAll, saved, changed } = useRenameState();
  const db = useRenameDb();
  const [asking, setAsking] = useState<'save' | 'clear' | null>(null);
  // De brief die nu in het voorbeeldvenster staat.
  const [viewing, setViewing] = useState<number | null>(null);

  const names = proposeNames(docs);
  const included = docs.filter((doc) => doc.include);
  const counts = new Map<string, number>();
  docs.forEach((doc, i) => {
    if (doc.include)
      counts.set(names[i]!.toLowerCase(), (counts.get(names[i]!.toLowerCase()) ?? 0) + 1);
  });

  const update = (id: number, change: Partial<RenameDoc>) =>
    setRenameState((current) => ({
      docs: current.docs.map((doc) => (doc.id === id ? { ...doc, ...change } : doc)),
      changed: true,
      saved: null,
    }));

  const add = async (files: File[]) => {
    const pdfs = files.filter(
      (file) => /\.pdf$/i.test(file.name) || file.type === 'application/pdf',
    );
    if (pdfs.length === 0) return;
    setRenameState(() => ({ reading: true, saved: null }));
    const added: RenameDoc[] = [];
    for (const file of pdfs) {
      const doc: RenameDoc = {
        id: newId(),
        file,
        include: true,
        lines: [],
        dates: [],
        date: '',
        sender: '',
        subject: '',
        senderRec: false,
        subjectRec: false,
        manualName: false,
        customName: '',
        showText: getRenameState().showAll,
        error: false,
        pageCount: 0,
        ocr: 'none',
      };
      try {
        const { lines, pageCount } = await readLines(file);
        Object.assign(doc, { lines, pageCount }, fieldsFrom(lines, file.name, getRenameDb()));
        // Een scan zonder tekstlaag: straks met tekstherkenning.
        if (lines.length === 0 && pageCount > 0) doc.ocr = 'waiting';
      } catch {
        doc.error = true;
      }
      added.push(doc);
      setRenameState((current) => ({ docs: [...current.docs, doc] }));
    }
    const scans = added.filter((doc) => doc.ocr === 'waiting');
    if (scans.length > 0) await recognizeScans(scans);
    setRenameState(() => ({ reading: false, ocrProgress: null, changed: true }));
  };

  const clear = () => {
    clearRename();
    setAsking(null);
  };

  /** Vult afzender en onderwerp opnieuw in met de database (bijvoorbeeld na nieuwe herkenwoorden). */
  const recognizeAgain = () =>
    setRenameState((current) => ({
      docs: current.docs.map((doc) =>
        doc.lines.length === 0 ? doc : { ...doc, ...fromDb(doc.lines, db), manualName: false },
      ),
      changed: true,
      saved: r.recognized,
    }));

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
      setRenameState(() => ({ saved: format(r.savedOne, { name: unique[0]! }) }));
    } else {
      const zip = await zipWriter();
      for (const [i, entry] of chosen.entries()) {
        zip.add(unique[i]!, new Uint8Array(await entry.doc.file.arrayBuffer()));
      }
      downloadFile(zip.finish(), zipName!, 'application/zip');
      setRenameState(() => ({ saved: format(r.saved, { n: chosen.length, name: zipName! }) }));
    }
    rememberAll(chosen.map((entry) => entry.doc));
    setRenameState(() => ({ changed: false }));
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
  const busy = !ocrProgress
    ? r.reading
    : ocrProgress.loading !== null
      ? format(r.ocr.loading, { percent: Math.round(ocrProgress.loading * 100) })
      : format(r.ocr.progress, { n: ocrProgress.done + 1, total: ocrProgress.total });
  const status = [
    plural(docs.length, r.filesOne, format(r.files, { n: docs.length })),
    reading ? busy : withoutDate > 0 ? format(r.withoutDate, { n: withoutDate }) : r.ready,
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
              disabled={reading}
              onClick={recognizeAgain}
            >
              {r.recognizeAgain}
            </button>
            <button
              type="button"
              class="button button--secondary"
              aria-pressed={showAll}
              onClick={() =>
                setRenameState((current) => ({
                  showAll: !current.showAll,
                  docs: current.docs.map((doc) => ({ ...doc, showText: !current.showAll })),
                }))
              }
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
        <p class="annotate__hint">{r.knownHint}</p>
        {/* Voor schermlezers: waarom een veld een groene rand heeft. */}
        <span id="rename-known" class="visually-hidden">
          {r.known}
        </span>
        <datalist id="rename-senders">
          {suggestions(db.afzenders).map((naam, i) => (
            <option key={i} value={naam} />
          ))}
        </datalist>
        <datalist id="rename-subjects">
          {suggestions(db.onderwerpen).map((naam, i) => (
            <option key={i} value={naam} />
          ))}
        </datalist>
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
                    {!doc.error && doc.ocr !== 'none' && (
                      <span class="rename-table__problem">{r.ocr[doc.ocr]}</span>
                    )}
                    {!doc.error && doc.ocr === 'none' && doc.lines.length === 0 && (
                      <span class="rename-table__problem">{r.noText}</span>
                    )}
                    {!doc.error && (
                      <button
                        type="button"
                        class="link-button"
                        aria-label={format(r.viewLabel, { name: file })}
                        onClick={() => setViewing(doc.id)}
                      >
                        {r.view}
                      </button>
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
                    {/* Suggesties uit de database; wat je invult, wordt onthouden. */}
                    <input
                      type="text"
                      list="rename-senders"
                      class={doc.senderRec ? 'rename-table__known' : undefined}
                      value={doc.sender}
                      aria-label={format(r.senderLabel, { name: file })}
                      aria-describedby={doc.senderRec ? 'rename-known' : undefined}
                      onInput={(event) =>
                        update(doc.id, {
                          sender: event.currentTarget.value,
                          senderRec: false,
                          manualName: false,
                        })
                      }
                      onChange={(event) => remember('afzenders', event.currentTarget.value)}
                    />
                  </td>
                  <td>
                    <input
                      type="text"
                      list="rename-subjects"
                      class={doc.subjectRec ? 'rename-table__known' : undefined}
                      value={doc.subject}
                      aria-label={format(r.subjectLabel, { name: file })}
                      aria-describedby={doc.subjectRec ? 'rename-known' : undefined}
                      onInput={(event) =>
                        update(doc.id, {
                          subject: event.currentTarget.value,
                          subjectRec: false,
                          manualName: false,
                        })
                      }
                      onChange={(event) => remember('onderwerpen', event.currentTarget.value)}
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
      {viewing !== null &&
        (() => {
          const index = docs.findIndex((doc) => doc.id === viewing);
          const doc = docs[index];
          return doc ? (
            <PreviewDialog
              file={doc.file}
              title={`${names[index]!} · ${doc.file.name}`}
              onClose={() => setViewing(null)}
            />
          ) : null;
        })()}
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
