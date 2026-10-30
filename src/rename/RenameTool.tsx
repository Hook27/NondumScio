import type { ComponentChildren } from 'preact';
import { useLayoutEffect, useRef, useState } from 'preact/hooks';
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
import { readLines } from './readText';
import {
  findDates,
  findSender,
  findSubject,
  nameLimit,
  proposeNames,
  uniqueNames,
} from './recognize';
import {
  getRenameDb,
  getRenameState,
  setRenameDb,
  setRenameState,
  useRenameDb,
  useRenameState,
  type RenameDoc,
  type RenameView,
} from './store';

let nextId = 1;

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

/** Onthoudt een ingevulde afzender of onderwerp in de database. */
const remember = (kind: DbKind, value: string) => setRenameDb(learn(getRenameDb(), kind, value));

/** Datum-tijdstempel JJJJMMDD_UUMM, voor de naam van de ZIP. */
function stamp(now = new Date()) {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}${p(now.getMonth() + 1)}${p(now.getDate())}_${p(now.getHours())}${p(now.getMinutes())}`;
}

/**
 * Slim hernoemen: gescande brieven openen, per brief een naam voorstellen
 * (`JJMMDD afzender onderwerp.pdf`), die nakijken en hernoemde kopieën downloaden. Werkt los van de
 * gewone taken, met een eigen lijst bestanden. De stand staat buiten het scherm (`store.ts`), zodat
 * hij blijft als je even naar een andere taak gaat. Met de schakelaar bovenaan ga je naar de
 * database met afzenders en onderwerpen.
 */
export function RenameTool() {
  const { view } = useRenameState();
  const restoreFocus = useRef(false);
  const toggle = <ViewToggle view={view} restoreFocus={restoreFocus} />;
  return view === 'database' ? <DatabaseView head={toggle} /> : <RenameList head={toggle} />;
}

/**
 * De keuze tussen Hernoemen en Database, zoals bij Omzetten. De knoppen staan in elke weergave op
 * een andere plek en worden bij het wisselen opnieuw opgebouwd; `restoreFocus` zet de focus dan
 * meteen terug op de gekozen knop.
 */
function ViewToggle({
  view,
  restoreFocus,
}: {
  view: RenameView;
  restoreFocus: { current: boolean };
}) {
  const { t } = useI18n();
  const v = t.rename.views;
  const pressed = useRef<HTMLButtonElement>(null);

  useLayoutEffect(() => {
    if (!restoreFocus.current) return;
    restoreFocus.current = false;
    pressed.current?.focus();
  }, [restoreFocus]);

  const options: readonly { value: RenameView; label: string }[] = [
    { value: 'rename', label: v.rename },
    { value: 'database', label: v.database },
  ];

  return (
    <div class="segmented" role="group" aria-label={v.label}>
      {options.map((option) => (
        <button
          key={option.value}
          ref={view === option.value ? pressed : undefined}
          type="button"
          class="segmented__button"
          aria-pressed={view === option.value}
          onClick={() => {
            if (view === option.value) return;
            restoreFocus.current = true;
            setRenameState(() => ({ view: option.value }));
          }}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

/** Hernoemen: de lijst met brieven en hun voorgestelde namen. */
function RenameList({ head }: { head: ComponentChildren }) {
  const { t } = useI18n();
  const r = t.rename;
  const { docs, reading, showAll, saved, changed } = useRenameState();
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
        senderRec: false,
        subjectRec: false,
        manualName: false,
        customName: '',
        showText: getRenameState().showAll,
        error: false,
      };
      try {
        const { lines } = await readLines(file);
        doc.lines = lines;
        doc.dates = findDates(lines, file.name);
        doc.date = doc.dates[0]?.ymd ?? '';
        doc.sender = findSender(lines);
        doc.subject = findSubject(lines);
        Object.assign(doc, fromDb(lines, getRenameDb()));
      } catch {
        doc.error = true;
      }
      setRenameState((current) => ({ docs: [...current.docs, doc] }));
    }
    setRenameState(() => ({ reading: false, changed: true }));
  };

  const clear = () => {
    setRenameState(() => ({ docs: [], saved: null, changed: false }));
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
    setRenameState(() => ({ changed: false }));
  };

  if (docs.length === 0) {
    return (
      <>
        <div class="rename-mode">{head}</div>
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
      </>
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
        {head}
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
                    {!doc.error && doc.lines.length === 0 && (
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
