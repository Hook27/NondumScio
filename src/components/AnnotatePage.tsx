import type { PDFDocumentProxy, RenderTask } from 'pdfjs-dist';
import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import {
  displaySize,
  fromDisplay,
  toDisplay,
  type Point,
  type Size,
} from '../annotations/geometry';
import {
  BASELINE,
  KEYBOARD_BOX,
  LINE_HEIGHT,
  boxFrom,
  keptOnPage,
  moved,
  type Annotation,
  type BoxAnnotation,
  type LineAnnotation,
  type TextAnnotation,
  type Tool,
} from '../annotations/model';
import { useI18n } from '../i18n/LanguageContext';
import { format } from '../i18n/format';
import type { PageItem } from '../pages/plan';
import { outputScale } from '../pdf/images';
import type { Box } from '../search/pageText';
import type { Candidate } from '../search/run';

/** Wat een pagina nodig heeft van de plek waar de annotaties beheerd worden (AnnotateView). */
export type AnnotateController = {
  tool: Tool;
  selectedId: number | null;
  editingId: number | null;
  /** Wat er nu getekend, verplaatst of getypt wordt, nog niet vastgelegd. */
  draft: Annotation | null;
  newId: () => number;
  /** Een nieuwe annotatie met de gekozen kleur, lettergrootte en dikte, op een plek. */
  create: (tool: Exclude<Tool, 'select'>, page: number, from: Point, to?: Point) => Annotation;
  setDraft: (annotation: Annotation | null) => void;
  /** Legt het concept vast (of gooit het weg als het te klein of leeg is). */
  commitDraft: () => void;
  /** Toon redactievakken zoals het resultaat: effen zwart (en niet half doorzichtig). */
  preview?: boolean;
  /** Welke soorten annotatie je kunt aanpakken; de rest staat er alleen (standaard alles). */
  interactive?: (kind: Annotation['kind']) => boolean;
  /** Legt een kant-en-klare annotatie meteen vast. */
  add: (annotation: Annotation) => void;
  select: (id: number | null) => void;
  edit: (id: number | null) => void;
  remove: (id: number) => void;
  nudge: (id: number, dx: number, dy: number) => void;
  /** Zet een treffer van het zoeken aan of uit (een klik op zijn vak). */
  toggleCandidate?: (id: number) => void;
  /** De treffer die even oplicht. */
  focusedCandidate?: number | null;
};

/** Zolang we de grootte van een pagina nog niet kennen, rekenen we met een A4. */
const PLACEHOLDER: Size = { width: 595, height: 842 };

/** De uitleg per pagina nodig om grootte en draaiing te weten; per bestand en pagina bewaard. */
type PageInfo = { base: Size; rotate: number };
const infoCache = new WeakMap<PDFDocumentProxy, Map<number, PageInfo>>();

async function pageInfo(pdf: PDFDocumentProxy, pageNumber: number): Promise<PageInfo> {
  const cache = infoCache.get(pdf) ?? new Map<number, PageInfo>();
  infoCache.set(pdf, cache);
  const known = cache.get(pageNumber);
  if (known) return known;
  const page = await pdf.getPage(pageNumber);
  // De basisstand: met de draaiing die de pagina in het bestand zelf al heeft.
  const { width, height } = page.getViewport({ scale: 1, rotation: page.rotate });
  const info = { base: { width, height }, rotate: page.rotate };
  cache.set(pageNumber, info);
  page.cleanup();
  return info;
}

/** De stappen waarin je met de pijltjestoetsen schuift (in punten). */
const NUDGE = 1;
const NUDGE_BIG = 10;

/** Hoeveel scherm (in paginahoogtes) boven en onder het zichtbare deel al getekend wordt. */
const RENDER_MARGIN = '120% 0px';

/**
 * Eén pagina op leesbare grootte, met de annotaties erbovenop. Wordt pas getekend als de pagina
 * (bijna) in beeld komt en geeft het geheugen weer vrij als je er ver vandaan scrolt, zodat ook
 * een lang document werkt. De annotaties staan in de basisstand van de pagina; hier worden ze
 * omgerekend naar wat je ziet, met de extra draaiing uit het pagina-plan.
 */
export function AnnotatePage({
  pdf,
  item,
  position,
  fitWidth,
  zoom,
  annotations,
  candidates = [],
  controller,
}: {
  pdf: PDFDocumentProxy;
  item: PageItem;
  /** De plek in het resultaat, vanaf 1. */
  position: number;
  /** De breedte (in beeldpunten) waarop de pagina bij zoom 1 past. */
  fitWidth: number;
  zoom: number;
  /** De vastgelegde annotaties van deze pagina. */
  annotations: Annotation[];
  /** De treffers van het zoeken op deze pagina (nog geen vakken). */
  candidates?: Candidate[];
  controller: AnnotateController;
}) {
  const { t } = useI18n();
  const [info, setInfo] = useState<PageInfo | null>(null);
  const [active, setActive] = useState(false);
  const frame = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const overlay = useRef<SVGSVGElement>(null);
  const drag = useRef<{
    mode: 'draw' | 'move' | 'resize';
    start: Point;
    original?: Annotation;
    handle?: string;
    moved: boolean;
  } | null>(null);
  // De treffer waarop de aanwijzer neerkwam; een klik zonder slepen zet hem aan of uit.
  const candidateClick = useRef<number | null>(null);

  const base = info?.base ?? PLACEHOLDER;
  const extra = item.rotation;
  const shown = displaySize(base, extra);
  // Beeldpunten per punt op de pagina.
  const scale = fitWidth > 0 ? (fitWidth / shown.width) * zoom : zoom;
  const width = shown.width * scale;
  const height = shown.height * scale;

  useEffect(() => {
    let cancelled = false;
    void pageInfo(pdf, item.source + 1).then((result) => {
      if (!cancelled) setInfo(result);
    });
    return () => {
      cancelled = true;
    };
  }, [pdf, item.source]);

  // Tekenen als de pagina (bijna) in beeld is; anders het geheugen vrijgeven.
  useEffect(() => {
    const element = frame.current;
    if (!element || typeof IntersectionObserver === 'undefined') {
      setActive(true);
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => setActive(entries.some((entry) => entry.isIntersecting)),
      { rootMargin: RENDER_MARGIN },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const target = canvas.current;
    if (!target) return;
    if (!active || !info || fitWidth <= 0) {
      // Weg met de beeldpunten: een lege pagina houdt zijn plek, maar kost geen geheugen.
      target.width = 0;
      target.height = 0;
      return;
    }
    let task: RenderTask | null = null;
    let cancelled = false;
    void (async () => {
      const page = await pdf.getPage(item.source + 1);
      if (cancelled) return;
      const angle = (((info.rotate + extra) % 360) + 360) % 360;
      const natural = page.getViewport({ scale: 1, rotation: angle });
      const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
      const wanted = scale * pixelRatio;
      // Begrensd, zodat een grote pagina op hoge zoom geen onmogelijk grote afbeelding wordt.
      const { scale: renderScale } = outputScale(natural.width, natural.height, wanted * 72);
      const viewport = page.getViewport({ scale: renderScale, rotation: angle });
      // Eerst op een los canvas tekenen, zodat de pagina bij zoomen niet even wit wordt.
      const next = document.createElement('canvas');
      next.width = Math.max(1, Math.round(viewport.width));
      next.height = Math.max(1, Math.round(viewport.height));
      task = page.render({ canvas: next, viewport });
      try {
        await task.promise;
        if (cancelled) return;
        target.width = next.width;
        target.height = next.height;
        target.getContext('2d')?.drawImage(next, 0, 0);
      } catch {
        // Afgebroken (bijvoorbeeld bij zoomen of sluiten): niets aan de hand.
      } finally {
        page.cleanup();
      }
    })();
    return () => {
      cancelled = true;
      task?.cancel();
    };
  }, [active, info, fitWidth, scale, pdf, item.source, extra]);

  /* Omrekenen tussen pagina (punten, basisstand) en scherm (beeldpunten) */

  const toScreen = (point: Point): Point => {
    const d = toDisplay(base, extra, point);
    return { x: d.x * scale, y: d.y * scale };
  };
  /** Een vak uit de basisstand als rechthoek op het scherm (ook bij een gedraaide pagina). */
  const screenRect = (box: Box) => {
    const a = toScreen({ x: box.x, y: box.y });
    const d = toScreen({ x: box.x + box.width, y: box.y + box.height });
    return {
      x: Math.min(a.x, d.x),
      y: Math.min(a.y, d.y),
      width: Math.abs(d.x - a.x),
      height: Math.abs(d.y - a.y),
    };
  };
  const pointerAt = (event: PointerEvent): Point => {
    const box = overlay.current!.getBoundingClientRect();
    return fromDisplay(base, extra, {
      x: (event.clientX - box.left) / scale,
      y: (event.clientY - box.top) / scale,
    });
  };

  /** Wat er op deze pagina staat: de vastgelegde annotaties, met het concept op zijn plek. */
  const draft = controller.draft?.page === item.key ? controller.draft : null;
  const shownAnnotations = draft
    ? annotations.some((a) => a.id === draft.id)
      ? annotations.map((a) => (a.id === draft.id ? draft : a))
      : [...annotations, draft]
    : annotations;
  const selected = shownAnnotations.find((a) => a.id === controller.selectedId) ?? null;

  /* Aanwijzen en slepen */

  const onPointerDown = (event: PointerEvent) => {
    if (event.button !== 0) return;
    // Wordt er getypt, dan sluit een klik elders dat af en doet verder niets.
    if (controller.editingId !== null) {
      if (!(event.target as Element).closest('textarea')) {
        controller.commitDraft();
        event.preventDefault();
      }
      return;
    }
    const target = event.target as Element;
    const handle = target.closest<SVGElement>('[data-handle]')?.dataset.handle;
    const annotationId = target.closest<SVGElement | HTMLElement>('[data-annotation]')?.dataset
      .annotation;
    const hit =
      annotationId !== undefined
        ? shownAnnotations.find((a) => a.id === Number(annotationId))
        : undefined;
    const tool = controller.tool;
    const at = pointerAt(event);
    overlay.current!.setPointerCapture?.(event.pointerId);
    candidateClick.current =
      hit || handle
        ? null
        : (candidates.find((candidate) =>
            candidate.boxes.some(
              (box) =>
                at.x >= box.x &&
                at.x <= box.x + box.width &&
                at.y >= box.y &&
                at.y <= box.y + box.height,
            ),
          )?.id ?? null);

    if (handle && selected) {
      drag.current = { mode: 'resize', start: at, original: selected, handle, moved: false };
      event.preventDefault();
    } else if (hit && (tool === 'select' || (tool === 'text' && hit.kind === 'text'))) {
      controller.select(hit.id);
      drag.current = { mode: 'move', start: at, original: hit, moved: false };
      event.preventDefault();
    } else if (tool === 'select') {
      controller.select(null);
    } else if (tool === 'text') {
      const created = controller.create('text', item.key, at);
      controller.setDraft(created);
      controller.select(created.id);
      controller.edit(created.id);
      event.preventDefault();
    } else {
      const created = controller.create(tool, item.key, at, at);
      controller.setDraft(created);
      drag.current = { mode: 'draw', start: at, original: created, moved: false };
      event.preventDefault();
    }
  };

  const onPointerMove = (event: PointerEvent) => {
    const current = drag.current;
    if (!current?.original) return;
    const at = pointerAt(event);
    const original = current.original;
    if (current.mode === 'move') {
      const dx = at.x - current.start.x;
      const dy = at.y - current.start.y;
      if (!current.moved && Math.hypot(dx, dy) * scale < 3) return;
      current.moved = true;
      controller.setDraft(keptOnPage(moved(original, dx, dy), base));
    } else if (current.mode === 'draw') {
      current.moved = true;
      controller.setDraft(reshaped(original, current.start, at));
    } else if (current.mode === 'resize') {
      current.moved = true;
      controller.setDraft(resized(original, current.handle!, at));
    }
  };

  const onPointerUp = (event: PointerEvent) => {
    const current = drag.current;
    drag.current = null;
    overlay.current?.releasePointerCapture?.(event.pointerId);
    const clicked = candidateClick.current;
    candidateClick.current = null;
    if (clicked !== null && !current?.moved) controller.toggleCandidate?.(clicked);
    if (!current) return;
    if (current.moved) controller.commitDraft();
    else controller.setDraft(null);
  };

  /* Toetsenbord */

  const onAnnotationKey = (event: KeyboardEvent, annotation: Annotation) => {
    const step = event.shiftKey ? NUDGE_BIG : NUDGE;
    const arrows: Record<string, [number, number]> = {
      ArrowLeft: [-step, 0],
      ArrowRight: [step, 0],
      ArrowUp: [0, -step],
      ArrowDown: [0, step],
    };
    if (event.key in arrows) {
      // De pijl wijst naar wat je op het scherm ziet, ook bij een gedraaide pagina.
      const [dx, dy] = arrows[event.key]!;
      const a = fromDisplay(base, extra, { x: 0, y: 0 });
      const b = fromDisplay(base, extra, { x: dx, y: dy });
      controller.nudge(annotation.id, b.x - a.x, b.y - a.y);
      event.preventDefault();
    } else if (event.key === 'Delete' || event.key === 'Backspace') {
      controller.remove(annotation.id);
      event.preventDefault();
    } else if (event.key === 'Enter' || event.key === ' ') {
      controller.select(annotation.id);
      if (annotation.kind === 'text' && event.key === 'Enter') {
        controller.setDraft(annotation);
        controller.edit(annotation.id);
      }
      event.preventDefault();
    } else if (event.key === 'Escape') {
      controller.select(null);
    }
  };

  /** Met een gereedschap gekozen plaatst Enter op de pagina zelf een annotatie in het midden. */
  const onPageKey = (event: KeyboardEvent) => {
    if (event.target !== event.currentTarget || event.key !== 'Enter') return;
    const tool = controller.tool;
    if (tool === 'select') return;
    const middle = { x: base.width / 2, y: base.height / 2 };
    if (tool === 'text') {
      const created = controller.create('text', item.key, middle);
      controller.setDraft(created);
      controller.select(created.id);
      controller.edit(created.id);
    } else {
      const half = { x: KEYBOARD_BOX.width / 2, y: KEYBOARD_BOX.height / 2 };
      const from = { x: middle.x - half.x, y: middle.y - half.y };
      const to =
        tool === 'line'
          ? { x: middle.x + half.x, y: middle.y - half.y }
          : { x: middle.x + half.x, y: middle.y + half.y };
      const created = controller.create(tool, item.key, from, to);
      controller.add(created);
      controller.select(created.id);
    }
    event.preventDefault();
  };

  /* Weergave */

  const label = (annotation: Annotation) =>
    annotation.kind === 'text'
      ? format(t.edit.textOf, { text: annotation.text })
      : annotation.kind === 'highlight'
        ? t.edit.highlightOf
        : annotation.kind === 'rect'
          ? t.edit.rectOf
          : annotation.kind === 'redact'
            ? t.redact.boxOf
            : t.edit.lineOf;

  const common = (annotation: Annotation) => ({
    'data-annotation': annotation.id,
    tabIndex: 0,
    role: 'button',
    'aria-label': label(annotation),
    'aria-pressed': annotation.id === controller.selectedId,
    onKeyDown: (event: KeyboardEvent) => onAnnotationKey(event, annotation),
    onFocus: () => {
      if (controller.editingId === null) controller.select(annotation.id);
    },
  });

  const classes = ['annotate-overlay', `annotate-overlay--${controller.tool}`].join(' ');
  const interactive = (kind: Annotation['kind']) => controller.interactive?.(kind) ?? true;

  return (
    <div
      ref={frame}
      class="annotate-page"
      role="group"
      aria-label={format(t.document.page, { n: position })}
      aria-describedby="annotate-help"
      data-position={position}
      data-rendered={active && info ? 'true' : 'false'}
      tabIndex={0}
      style={{ width: `${width}px`, height: `${height}px` }}
      onKeyDown={onPageKey}
    >
      <canvas
        ref={canvas}
        class="annotate-page__canvas"
        style={{ width: `${width}px`, height: `${height}px` }}
      />
      <svg
        ref={overlay}
        class={classes}
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={() => {
          drag.current = null;
          candidateClick.current = null;
          controller.setDraft(null);
        }}
      >
        {candidates.map((candidate) => (
          <g
            key={candidate.id}
            class={[
              'annotate-candidate',
              candidate.checked ? '' : 'annotate-candidate--off',
              candidate.id === controller.focusedCandidate ? 'annotate-candidate--focus' : '',
            ]
              .filter(Boolean)
              .join(' ')}
            data-candidate={candidate.id}
            aria-hidden="true"
          >
            {candidate.boxes.map((box, i) => {
              const { x, y, width, height } = screenRect(box);
              return <rect key={i} x={x} y={y} width={width} height={height} />;
            })}
          </g>
        ))}
        {shownAnnotations.map((annotation) => {
          if (annotation.id === controller.editingId && annotation.kind === 'text') return null;
          const isSelected =
            annotation.id === controller.selectedId && interactive(annotation.kind);
          // Wat je bij deze taak niet kunt aanpakken, staat er alleen: zonder focus en zonder klik.
          const attributes = interactive(annotation.kind)
            ? common(annotation)
            : { 'data-inert': 'true', 'aria-hidden': 'true' };
          if (annotation.kind === 'text') {
            return (
              <TextShape
                key={annotation.id}
                annotation={annotation}
                at={toScreen({ x: annotation.x, y: annotation.y })}
                scale={scale}
                extra={extra}
                selected={isSelected}
                attributes={attributes}
              />
            );
          }
          if (annotation.kind === 'line') {
            return (
              <LineShape
                key={annotation.id}
                annotation={annotation}
                from={toScreen({ x: annotation.x1, y: annotation.y1 })}
                to={toScreen({ x: annotation.x2, y: annotation.y2 })}
                scale={scale}
                selected={isSelected}
                attributes={attributes}
              />
            );
          }
          return (
            <BoxShape
              key={annotation.id}
              annotation={annotation}
              corners={boxCorners(annotation).map(toScreen)}
              scale={scale}
              selected={isSelected}
              preview={Boolean(controller.preview)}
              attributes={attributes}
            />
          );
        })}
        {selected && selected.id !== controller.editingId && selected.kind !== 'text' && (
          <Handles annotation={selected} toScreen={toScreen} />
        )}
      </svg>
      {draft?.kind === 'text' && draft.id === controller.editingId && (
        <TextEditor
          annotation={draft}
          at={toScreen({ x: draft.x, y: draft.y })}
          scale={scale}
          extra={extra}
          onChange={(text) => controller.setDraft({ ...draft, text })}
          onDone={() => controller.commitDraft()}
        />
      )}
    </div>
  );
}

/** De vier hoeken van een vak in de basisstand: linksboven, rechtsboven, linksonder, rechtsonder. */
function boxCorners(box: BoxAnnotation): Point[] {
  return [
    { x: box.x, y: box.y },
    { x: box.x + box.width, y: box.y },
    { x: box.x, y: box.y + box.height },
    { x: box.x + box.width, y: box.y + box.height },
  ];
}

/** Een annotatie die wordt getekend, met het tweede punt op `to`. */
function reshaped(annotation: Annotation, from: Point, to: Point): Annotation {
  if (annotation.kind === 'line') return { ...annotation, x2: to.x, y2: to.y };
  if (
    annotation.kind === 'highlight' ||
    annotation.kind === 'rect' ||
    annotation.kind === 'redact'
  ) {
    return { ...annotation, ...boxFrom(from.x, from.y, to.x, to.y) };
  }
  return annotation;
}

/**
 * Een annotatie waarvan één hoekpunt (of eindpunt) naar `to` is gesleept en de rest blijft staan.
 * De hoekpunten van een vak heten 0 tot 3 (zie `boxCorners`); de overliggende is 3 min de eigen.
 */
function resized(annotation: Annotation, handle: string, to: Point): Annotation {
  if (annotation.kind === 'line') {
    return handle === 'p1'
      ? { ...annotation, x1: to.x, y1: to.y }
      : { ...annotation, x2: to.x, y2: to.y };
  }
  if (
    annotation.kind === 'highlight' ||
    annotation.kind === 'rect' ||
    annotation.kind === 'redact'
  ) {
    const opposite = boxCorners(annotation)[3 - Number(handle)]!;
    return { ...annotation, ...boxFrom(opposite.x, opposite.y, to.x, to.y) };
  }
  return annotation;
}

type Attributes = Record<string, unknown>;

function TextShape({
  annotation,
  at,
  scale,
  extra,
  selected,
  attributes,
}: {
  annotation: TextAnnotation;
  at: Point;
  scale: number;
  extra: number;
  selected: boolean;
  attributes: Attributes;
}) {
  const size = annotation.size * scale;
  const lines = annotation.text.split('\n');
  const textRef = useRef<SVGTextElement>(null);
  // De ware afmetingen van de tekst, voor het vlak om op te klikken en de rand bij selecteren.
  // Zonder meting (bijvoorbeeld in een test) een schatting.
  const guess = {
    width: Math.max(...lines.map((line) => line.length), 1) * size * 0.55,
    height: lines.length * size * LINE_HEIGHT,
  };
  const [measured, setMeasured] = useState<{ width: number; height: number } | null>(null);
  useLayoutEffect(() => {
    const element = textRef.current;
    if (!element || typeof element.getBBox !== 'function') return;
    const { width, height } = element.getBBox();
    setMeasured({ width, height: Math.max(height, guess.height) });
  }, [annotation.text, size]);
  const box = measured ?? guess;
  return (
    <g
      {...attributes}
      class={`annotate-shape annotate-shape--text${selected ? ' annotate-shape--selected' : ''}`}
      transform={`translate(${at.x} ${at.y}) rotate(${extra})`}
    >
      <rect
        class="annotate-shape__hit"
        x={-3}
        y={-3}
        width={box.width + 6}
        height={box.height + 6}
      />
      <text
        ref={textRef}
        fill={annotation.color}
        font-size={size}
        font-family="Helvetica, Arial, sans-serif"
      >
        {lines.map((line, i) => (
          <tspan key={i} x={0} y={size * (BASELINE + i * LINE_HEIGHT)} xml:space="preserve">
            {line === '' ? ' ' : line}
          </tspan>
        ))}
      </text>
    </g>
  );
}

function BoxShape({
  annotation,
  corners,
  scale,
  selected,
  preview,
  attributes,
}: {
  annotation: BoxAnnotation;
  corners: Point[];
  scale: number;
  selected: boolean;
  preview: boolean;
  attributes: Attributes;
}) {
  const [a, , , d] = corners as [Point, Point, Point, Point];
  const x = Math.min(a.x, d.x);
  const y = Math.min(a.y, d.y);
  const width = Math.abs(d.x - a.x);
  const height = Math.abs(d.y - a.y);
  const highlight = annotation.kind === 'highlight';
  return (
    <g {...attributes} class={`annotate-shape${selected ? ' annotate-shape--selected' : ''}`}>
      {annotation.kind === 'redact' ? (
        // Tijdens het werken half doorzichtig met een rode stippelrand, zodat je ziet wat eronder
        // staat; in het voorbeeld effen zwart, zoals het resultaat.
        <rect
          x={x}
          y={y}
          width={width}
          height={height}
          fill="#000000"
          fill-opacity={preview ? 1 : 0.35}
          stroke={preview ? 'none' : '#d92d20'}
          stroke-width={preview ? undefined : 2}
          stroke-dasharray={preview ? undefined : '6 4'}
          pointer-events="visible"
        />
      ) : (
        <rect
          x={x}
          y={y}
          width={width}
          height={height}
          fill={highlight ? annotation.color : 'none'}
          fill-opacity={highlight ? 0.4 : undefined}
          stroke={highlight ? 'none' : annotation.color}
          stroke-width={highlight ? undefined : annotation.strokeWidth * scale}
          pointer-events="visible"
        />
      )}
      {selected && (
        <rect
          class="annotate-shape__outline"
          x={x - 3}
          y={y - 3}
          width={width + 6}
          height={height + 6}
          pointer-events="none"
        />
      )}
    </g>
  );
}

function LineShape({
  annotation,
  from,
  to,
  scale,
  selected,
  attributes,
}: {
  annotation: LineAnnotation;
  from: Point;
  to: Point;
  scale: number;
  selected: boolean;
  attributes: Attributes;
}) {
  return (
    <g
      {...attributes}
      class={`annotate-shape annotate-shape--line${selected ? ' annotate-shape--selected' : ''}`}
    >
      {/* Een bredere, onzichtbare lijn eronder maakt hem makkelijker aan te wijzen. */}
      <line
        x1={from.x}
        y1={from.y}
        x2={to.x}
        y2={to.y}
        stroke="transparent"
        stroke-width={Math.max(annotation.strokeWidth * scale, 14)}
        pointer-events="stroke"
      />
      <line
        x1={from.x}
        y1={from.y}
        x2={to.x}
        y2={to.y}
        stroke={annotation.color}
        stroke-width={annotation.strokeWidth * scale}
        stroke-linecap="round"
        pointer-events="none"
      />
    </g>
  );
}

/** De greepjes om een vak of lijn aan te passen: de hoeken, of de twee uiteinden. */
function Handles({
  annotation,
  toScreen,
}: {
  annotation: BoxAnnotation | LineAnnotation;
  toScreen: (point: Point) => Point;
}) {
  const points =
    annotation.kind === 'line'
      ? [
          ['p1', toScreen({ x: annotation.x1, y: annotation.y1 })],
          ['p2', toScreen({ x: annotation.x2, y: annotation.y2 })],
        ]
      : boxCorners(annotation).map((corner, i) => [String(i), toScreen(corner)] as const);
  return (
    <g class="annotate-handles">
      {points.map(([handle, point]) => (
        <circle
          key={String(handle)}
          class="annotate-handle"
          data-handle={String(handle)}
          cx={(point as Point).x}
          cy={(point as Point).y}
          r={6}
        />
      ))}
    </g>
  );
}

/** Het tekstveld waarin je typt; sluit af met Escape of door ernaast te klikken. */
function TextEditor({
  annotation,
  at,
  scale,
  extra,
  onChange,
  onDone,
}: {
  annotation: TextAnnotation;
  at: Point;
  scale: number;
  extra: number;
  onChange: (text: string) => void;
  onDone: () => void;
}) {
  const { t } = useI18n();
  const field = useRef<HTMLTextAreaElement>(null);
  const size = annotation.size * scale;

  // Groei mee met wat er getypt wordt.
  const fit = () => {
    const element = field.current;
    if (!element) return;
    element.style.height = '0';
    element.style.width = '0';
    element.style.height = `${element.scrollHeight}px`;
    element.style.width = `${Math.max(element.scrollWidth + 4, size * 4)}px`;
  };

  useEffect(() => {
    field.current?.focus();
    fit();
  }, []);
  useEffect(fit, [annotation.text, size]);

  return (
    <textarea
      ref={field}
      class="annotate-editor"
      aria-label={t.edit.textLabel}
      placeholder={t.edit.textPlaceholder}
      value={annotation.text}
      spellcheck={false}
      rows={1}
      style={{
        left: `${at.x}px`,
        top: `${at.y}px`,
        fontSize: `${size}px`,
        color: annotation.color,
        lineHeight: LINE_HEIGHT,
        transform: `rotate(${extra}deg)`,
      }}
      onInput={(event) => onChange(event.currentTarget.value)}
      onBlur={onDone}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.preventDefault();
          onDone();
        }
        // Binnen het tekstveld horen toetsen bij het typen, niet bij de gereedschappen.
        event.stopPropagation();
      }}
    />
  );
}
