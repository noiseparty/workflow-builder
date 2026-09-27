import { useEffect, useRef, useState } from 'preact/hooks';
import type { FlowGraph, GraphNode } from '../lib/graph';

interface Props {
  graph: FlowGraph;
  selected: number | 'trigger' | null;
  issueCount: (index: number) => { errors: number; warnings: number };
  canAdd: boolean;
  onSelect: (index: number) => void;
  onAdd: () => void;
}

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

const H_W = 200, H_H = 76, H_GAP = 64, PAD = 28;
const V_W = 290, V_H = 60, V_GAP = 46, V_X = 44;

/** Horizontal on wide containers, vertical on phones — the same graph either way. */
function useWidth(ref: { current: HTMLElement | null }) {
  const [w, setW] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setW(e.contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return w;
}

const curve = (x1: number, y1: number, x2: number, y2: number, vertical: boolean) => {
  if (vertical) {
    const d = Math.max(16, (y2 - y1) / 2);
    return `M${x1} ${y1} C${x1} ${y1 + d} ${x2} ${y2 - d} ${x2} ${y2}`;
  }
  const d = Math.max(16, (x2 - x1) / 2);
  return `M${x1} ${y1} C${x1 + d} ${y1} ${x2 - d} ${y2} ${x2} ${y2}`;
};

const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + '…' : s);

export function Canvas({ graph, selected, issueCount, canAdd, onSelect, onAdd }: Props) {
  const wrap = useRef<HTMLDivElement>(null);
  const avail = useWidth(wrap);
  const vertical = avail > 0 && avail < 560;
  const n = graph.nodes.length;
  const slots = n + (canAdd ? 1 : 0);

  const box = (i: number): Box =>
    vertical ? { x: V_X, y: PAD + i * (V_H + V_GAP), w: V_W, h: V_H } : { x: PAD + i * (H_W + H_GAP), y: PAD, w: H_W, h: H_H };

  const width = vertical ? V_X + V_W + 70 : PAD * 2 + slots * H_W + (slots - 1) * H_GAP;
  const hasLane = graph.edges.some((e) => e.toInput === 1) || graph.deadEnds.length > 0;
  const height = vertical ? PAD * 2 + slots * V_H + (slots - 1) * V_GAP : PAD + H_H + (hasLane ? 76 : 32);
  // Shrink a wide flow to fit (down to 70%) before resorting to a horizontal scroll.
  const shown = vertical || !avail ? width : Math.max(width * 0.78, Math.min(width, avail - 2));
  const overflows = !vertical && shown > avail;

  const outPort = (i: number, out: number) => {
    const b = box(i);
    const isIf = graph.nodes[i].outputs === 2;
    if (vertical) return out === 0 ? { x: b.x + b.w / 2, y: b.y + b.h } : { x: b.x + b.w, y: b.y + b.h / 2 };
    return { x: b.x + b.w, y: b.y + b.h / 2 + (isIf ? (out === 0 ? -14 : 14) : 0) };
  };
  const inPort = (i: number, input: number) => {
    const b = box(i);
    const isMerge = graph.nodes[i].inputs === 2;
    if (vertical) return input === 0 ? { x: b.x + b.w / 2, y: b.y } : { x: b.x, y: b.y + b.h / 2 };
    return { x: b.x, y: b.y + b.h / 2 + (isMerge ? (input === 0 ? -14 : 14) : 0) };
  };

  // When a step is added, bring it into view; on load or when a sample swaps in, show the start.
  const scroller = useRef<HTMLDivElement>(null);
  const prevN = useRef(n);
  useEffect(() => {
    const el = scroller.current;
    const grew = n === prevN.current + 1;
    prevN.current = n;
    if (!el) return;
    const behavior = matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth';
    el.scrollTo({ left: grew && overflows ? el.scrollWidth : 0, behavior: grew ? behavior : 'auto' });
  }, [n, overflows, graph.nodes[0].kind]);

  const selIndex = selected === 'trigger' ? -1 : selected;
  const describe = graph.nodes.map((g, i) => `${i === 0 ? 'Trigger' : `Step ${i}`}: ${g.name}, ${g.detail}`).join('. ');

  return (
    <div class="canvas" ref={wrap}>
      <div class="canvas__scroll" ref={scroller}>
        <svg
          class={`graph${vertical ? ' graph--v' : ''}`}
          width={vertical ? width : shown}
          height={vertical ? height : (height * shown) / width}
          viewBox={`0 0 ${width} ${height}`}
          role="group"
          aria-label={`Workflow graph. ${describe}.`}
          style={vertical ? { width: '100%', height: 'auto', maxWidth: `${width}px` } : undefined}
        >
          <defs>
            <marker id="arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
              <path d="M0 0 L8 4 L0 8 z" class="arrowhead" />
            </marker>
          </defs>

          {graph.edges.map((e, k) => {
            const a = outPort(e.from, e.fromOutput);
            const b = inPort(e.to, e.toInput);
            let d: string;
            if (e.toInput === 1) {
              // The Merge's second input comes from the trigger, routed around the row.
              if (vertical) {
                const lx = 16;
                d = `M${a.x} ${a.y} C${a.x} ${a.y + 18} ${lx} ${a.y + 4} ${lx} ${a.y + 30} L${lx} ${b.y - 24} C${lx} ${b.y} ${b.x - 20} ${b.y} ${b.x} ${b.y}`;
              } else {
                const ly = PAD + H_H + 52;
                d = `M${a.x} ${a.y} C${a.x + 26} ${a.y} ${a.x + 26} ${ly} ${a.x + 56} ${ly} L${b.x - 56} ${ly} C${b.x - 26} ${ly} ${b.x - 26} ${b.y} ${b.x} ${b.y}`;
              }
            } else {
              d = curve(a.x, a.y, b.x, b.y, vertical);
            }
            const mid = vertical ? { x: a.x + 8, y: (a.y + b.y) / 2 + 4 } : { x: (a.x + b.x) / 2, y: Math.min(a.y, b.y) - 6 };
            return (
              <g key={`e${k}`} class={`edge${e.toInput === 1 ? ' edge--lane' : ''}`}>
                <path d={d} class="edge__line" marker-end="url(#arrow)" />
                {e.label && (
                  <text x={mid.x} y={mid.y} class="edge__label" text-anchor={vertical ? 'start' : 'middle'}>
                    {e.label}
                  </text>
                )}
              </g>
            );
          })}

          {graph.deadEnds.map((d, k) => {
            const a = outPort(d.from, d.fromOutput);
            const path = vertical ? `M${a.x} ${a.y} h14 v${V_H / 2 + 12}` : `M${a.x} ${a.y} h16 v${H_H / 2 - 4}`;
            const end = vertical ? { x: a.x + 14, y: a.y + V_H / 2 + 12 } : { x: a.x + 16, y: a.y + H_H / 2 - 4 };
            return (
              <g key={`d${k}`} class="deadend">
                <path d={path} />
                <circle cx={end.x} cy={end.y} r={3} />
                <text x={end.x + (vertical ? -6 : 7)} y={end.y + (vertical ? 16 : 4)} text-anchor={vertical ? 'end' : 'start'}>
                  false → stop
                </text>
              </g>
            );
          })}

          {graph.nodes.map((g, i) => (
            <NodeBox
              key={`n${i}-${g.kind}`}
              g={g}
              b={box(i)}
              detailMax={vertical ? 38 : 26}
              selected={selIndex === g.index}
              counts={issueCount(g.index)}
              onSelect={() => onSelect(g.index)}
            />
          ))}

          {canAdd && (
            <g
              class="ghost"
              role="button"
              tabIndex={0}
              aria-label="Add a step"
              onClick={onAdd}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  onAdd();
                }
              }}
            >
              {(() => {
                const b = box(n);
                const a = outPort(n - 1, 0);
                const p = vertical ? { x: b.x + b.w / 2, y: b.y } : { x: b.x, y: b.y + b.h / 2 };
                return (
                  <>
                    <path d={curve(a.x, a.y, p.x, p.y, vertical)} class="ghost__line" />
                    <rect x={b.x} y={b.y} width={b.w} height={b.h} rx={6} />
                    <text x={b.x + b.w / 2} y={b.y + b.h / 2 + 5} text-anchor="middle">
                      + ADD STEP
                    </text>
                  </>
                );
              })()}
            </g>
          )}
        </svg>
      </div>
    </div>
  );
}

function NodeBox({ g, b, detailMax, selected, counts, onSelect }: { g: GraphNode; b: Box; detailMax: number; selected: boolean; counts: { errors: number; warnings: number }; onSelect: () => void }) {
  const trigger = g.index < 0;
  const r = 6;
  // n8n draws triggers with a rounded left edge; do the same so the shape carries meaning.
  const shape = trigger
    ? `M${b.x + b.h / 2} ${b.y} H${b.x + b.w - r} Q${b.x + b.w} ${b.y} ${b.x + b.w} ${b.y + r} V${b.y + b.h - r} Q${b.x + b.w} ${b.y + b.h} ${b.x + b.w - r} ${b.y + b.h} H${b.x + b.h / 2} A${b.h / 2} ${b.h / 2} 0 0 1 ${b.x + b.h / 2} ${b.y} Z`
    : null;
  const status = counts.errors ? `, ${counts.errors} problem${counts.errors > 1 ? 's' : ''}` : counts.warnings ? `, ${counts.warnings} note${counts.warnings > 1 ? 's' : ''}` : '';
  return (
    <g
      class={`node node--${g.category}${selected ? ' is-selected' : ''}`}
      role="button"
      tabIndex={0}
      aria-pressed={selected}
      aria-label={`${trigger ? 'Trigger' : `Step ${g.index + 1}`}: ${g.name} — ${g.detail}${status}. Edit.`}
      onClick={onSelect}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onSelect();
        }
      }}
    >
      <title>{`${g.name} — ${g.detail}`}</title>
      {shape ? <path d={shape} class="node__body" /> : <rect x={b.x} y={b.y} width={b.w} height={b.h} rx={r} class="node__body" />}
      <rect x={b.x + (trigger ? b.h / 2 - 2 : 0)} y={b.y + 10} width={3} height={b.h - 20} class="node__stripe" />
      <circle cx={b.x + 26} cy={b.y + b.h / 2} r={14} class="node__icon" />
      <text x={b.x + 26} y={b.y + b.h / 2 + 5} text-anchor="middle" class="node__glyph">
        {g.glyph}
      </text>
      <text x={b.x + 50} y={b.y + b.h / 2 - 4} class="node__title">
        {clip(g.name.toUpperCase(), 22)}
      </text>
      <text x={b.x + 50} y={b.y + b.h / 2 + 13} class="node__detail">
        {clip(g.detail, detailMax)}
      </text>
      {trigger && (
        <text x={b.x + b.w - 8} y={b.y + 13} text-anchor="end" class="node__tag">
          TRIGGER
        </text>
      )}
      {(counts.errors > 0 || counts.warnings > 0) && <circle cx={b.x + b.w - 10} cy={b.y + b.h - 10} r={4} class={counts.errors ? 'dot dot--err' : 'dot dot--warn'} />}
    </g>
  );
}
