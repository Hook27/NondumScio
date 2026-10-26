import { useEffect, useRef, useState } from 'preact/hooks';
import type { Annotation, BoxAnnotation } from '../annotations/model';
import type { Source } from '../document/DocumentContext';
import type { PageItem } from '../pages/plan';
import { SearchCancelled, runSearch, type Candidate, type SearchResult } from './run';
import { parseTerms, type PatternId } from './patterns';
import { openPageSource } from './source';

/**
 * Het zoeken bij Redigeren: wat je invult, wat er gevonden is en wat je ervan aanvinkt. De
 * treffers zijn nog geen vakken; pas `apply` maakt er redactievakken van (in één ongedaan-stap).
 */

export type SearchForm = {
  /** Eén term per regel. */
  terms: string;
  patterns: PatternId[];
  wholeWords: boolean;
  /** Pagina's zonder tekst met tekstherkenning doorzoeken. */
  ocr: boolean;
};

export type SearchPhase =
  | { status: 'idle' }
  | { status: 'running'; done: number; total: number }
  | { status: 'error'; code: 'failed' | 'ocr' };

export type SearchSummary = Omit<SearchResult, 'candidates'>;

export type RedactSearch = {
  form: SearchForm;
  setForm: (change: Partial<SearchForm>) => void;
  phase: SearchPhase;
  /** Het laden van de tekstherkenning (0 tot 1), als dat bezig is. */
  loading: number | null;
  /** De treffers op pagina's die nog in het plan staan. */
  candidates: Candidate[];
  /** Wat de laatste zoekopdracht verder opleverde; `null` als er nog niet gezocht is. */
  summary: SearchSummary | null;
  /** Hoeveel vakken er met "Zet vakken" zijn gezet (tot de volgende zoekopdracht). */
  applied: number | null;
  /** De treffer die even oplicht omdat je erop klikte. */
  focus: number | null;
  canSearch: boolean;
  run: () => void;
  stop: () => void;
  toggle: (id: number) => void;
  setAll: (checked: boolean) => void;
  focusOn: (id: number) => void;
  apply: () => void;
  clear: () => void;
};

const FOCUS_MS = 1600;

export function useRedactSearch({
  pages,
  annotations,
  sourceOf,
  annotate,
  newAnnotationId,
  color,
}: {
  pages: readonly PageItem[];
  annotations: readonly Annotation[];
  sourceOf: (page: PageItem) => Source | undefined;
  annotate: (change: (items: Annotation[]) => Annotation[]) => void;
  newAnnotationId: () => number;
  /** De kleur van een redactievak. */
  color: string;
}): RedactSearch {
  const [form, setFormState] = useState<SearchForm>({
    terms: '',
    patterns: [],
    wholeWords: false,
    ocr: false,
  });
  const [phase, setPhase] = useState<SearchPhase>({ status: 'idle' });
  const [loading, setLoading] = useState<number | null>(null);
  const [all, setCandidates] = useState<Candidate[]>([]);
  const [summary, setSummary] = useState<SearchSummary | null>(null);
  const [applied, setApplied] = useState<number | null>(null);
  const [focus, setFocus] = useState<number | null>(null);
  const stopper = useRef<AbortController | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const nextId = useRef(1);

  // Sluit het pagina niet af terwijl er gezocht wordt: stop en ruim op.
  useEffect(
    () => () => {
      stopper.current?.abort();
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  const keys = new Set(pages.map((page) => page.key));
  const candidates = all.filter((candidate) => keys.has(candidate.page));
  const spec = {
    terms: parseTerms(form.terms),
    patterns: form.patterns,
    wholeWords: form.wholeWords,
  };
  const canSearch = spec.terms.length > 0 || spec.patterns.length > 0;

  const run = () => {
    if (!canSearch) return;
    stopper.current?.abort();
    const controller = new AbortController();
    stopper.current = controller;
    setPhase({ status: 'running', done: 0, total: pages.length });
    setLoading(null);
    setApplied(null);
    let ocrFailed = false;
    const source = openPageSource({
      sourceOf,
      openOcr: async () => (await import('../pdf/ocr')).openOcr((progress) => setLoading(progress)),
      signal: controller.signal,
    });
    const provider = {
      text: source.text,
      ocr: async (page: PageItem) => {
        try {
          return await source.ocr(page);
        } catch (error) {
          if (!(error instanceof SearchCancelled)) ocrFailed = true;
          throw error;
        }
      },
    };
    void (async () => {
      try {
        const { candidates: found, ...rest } = await runSearch({
          pages,
          annotations,
          spec,
          ocr: form.ocr,
          provider,
          newId: () => nextId.current++,
          onProgress: (done, total) => {
            setLoading(null);
            setPhase({ status: 'running', done, total });
          },
          signal: controller.signal,
        });
        if (controller.signal.aborted) return;
        setCandidates(found);
        setSummary(rest);
        setPhase({ status: 'idle' });
      } catch (error) {
        if (controller.signal.aborted || error instanceof SearchCancelled) {
          if (stopper.current === controller) setPhase({ status: 'idle' });
        } else {
          setPhase({ status: 'error', code: ocrFailed ? 'ocr' : 'failed' });
        }
      } finally {
        source.close();
        setLoading(null);
        if (stopper.current === controller) stopper.current = null;
      }
    })();
  };

  const apply = () => {
    const chosen = candidates.filter((candidate) => candidate.checked);
    const boxes: BoxAnnotation[] = chosen.flatMap((candidate) =>
      candidate.boxes.map((box) => ({
        id: newAnnotationId(),
        page: candidate.page,
        kind: 'redact' as const,
        ...box,
        color,
        strokeWidth: 0,
      })),
    );
    if (boxes.length === 0) return;
    annotate((items) => [...items, ...boxes]);
    setCandidates([]);
    setSummary(null);
    setApplied(boxes.length);
  };

  return {
    form,
    setForm: (change) => setFormState((current) => ({ ...current, ...change })),
    phase,
    loading,
    candidates,
    summary,
    applied,
    focus,
    canSearch,
    run,
    stop: () => stopper.current?.abort(),
    toggle: (id) =>
      setCandidates((current) =>
        current.map((c) => (c.id === id ? { ...c, checked: !c.checked } : c)),
      ),
    setAll: (checked) => setCandidates((current) => current.map((c) => ({ ...c, checked }))),
    focusOn: (id) => {
      setFocus(id);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setFocus(null), FOCUS_MS);
    },
    apply,
    clear: () => {
      setCandidates([]);
      setSummary(null);
      setApplied(null);
    },
  };
}
