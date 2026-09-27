// One topology, three consumers: the n8n exporter, the SVG canvas and the Mermaid/text
// exports all read this, so the picture can never disagree with the file you download.

import { STEPS, TRIGGERS, FILTER_OPERATORS, type Category } from './catalog';
import { describeSchedule, type ScheduleParams } from './cron';
import type { FlowState, FormFieldItem, AssignmentItem, Params, StepKind, TriggerKind } from './types';

export interface GraphNode {
  /** Index in the flow: -1 for the trigger, else the step index. */
  index: number;
  kind: TriggerKind | StepKind;
  /** Unique n8n node name. */
  name: string;
  /** Short label for the canvas. */
  title: string;
  /** One line of detail for the canvas. */
  detail: string;
  category: Category;
  glyph: string;
  inputs: number;
  outputs: number;
}

export interface GraphEdge {
  from: number; // node position in `nodes`
  to: number;
  fromOutput: number;
  toInput: number;
  label?: string;
}

export interface FlowGraph {
  nodes: GraphNode[];
  edges: GraphEdge[];
  /** Nodes whose `false` output deliberately leads nowhere. */
  deadEnds: { from: number; fromOutput: number; label: string }[];
}

export function scheduleParams(p: Params): ScheduleParams {
  return {
    mode: String(p.mode) as ScheduleParams['mode'],
    every: Number(p.every),
    minute: Number(p.minute),
    time: String(p.time),
    weekday: Number(p.weekday),
    dayOfMonth: Number(p.dayOfMonth),
    cron: String(p.cron),
  };
}

const host = (u: string) => {
  try {
    return new URL(u.replace(/\{\{[\s\S]*?\}\}/g, 'x')).host;
  } catch {
    return u || '(no URL yet)';
  }
};

const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + '…' : s);

/** The tab id from a Sheets URL (#gid=123 or ?gid=123); the first tab is always 0. */
export function sheetGid(url: string): string {
  return /[#&?]gid=(\d+)/.exec(url)?.[1] ?? '0';
}

export function pollWords(minutes: string): string {
  return minutes === '1' ? 'every minute' : minutes === '60' ? 'every hour' : minutes === '1440' ? 'once a day' : `every ${minutes} minutes`;
}

export function filterWords(p: Params): string {
  const op = FILTER_OPERATORS.find((o) => o.value === p.operator) ?? FILTER_OPERATORS[0];
  return op.single ? `${p.field} ${op.words}` : `${p.field} ${op.words} ${op.type === 'string' ? `"${p.value}"` : p.value}`;
}

function detailFor(kind: TriggerKind | StepKind, p: Params): string {
  switch (kind) {
    case 'schedule':
      return describeSchedule(scheduleParams(p));
    case 'webhook':
      return `${p.method} /webhook/${p.path || '…'}`;
    case 'rss':
      return `${host(String(p.feedUrl))}, ${pollWords(String(p.poll))}`;
    case 'form':
      return `"${p.title}" · ${(p.fields as FormFieldItem[]).length} fields`;
    case 'sheetsRow':
      return `new row, tab gid=${sheetGid(String(p.documentUrl))}`;
    case 'http':
      return `${p.method} ${host(String(p.url))}`;
    case 'filter':
      return filterWords(p);
    case 'set':
      return (p.assignments as AssignmentItem[]).map((a) => a.name || '?').join(', ') || 'no fields';
    case 'wait':
      return `${p.amount} ${Number(p.amount) === 1 ? String(p.unit).replace(/s$/, '') : p.unit}`;
    case 'merge':
      return p.mode === 'append' ? 'append' : 'combine by position';
    case 'telegram':
      return `chat ${p.chatId || '…'}`;
    case 'slack':
      return String(p.channel || '#…');
    case 'discord':
      return p.username ? `as ${p.username}` : 'via webhook';
    case 'email':
      return `to ${p.to || '…'}`;
    case 'sheetsAppend':
      return `append to ${p.sheetName || 'a sheet'}`;
    case 'postgres':
      return `insert into ${p.schema}.${p.table || '…'}`;
  }
}

export function buildGraph(flow: FlowState): FlowGraph {
  const used = new Map<string, number>();
  const uniqueName = (base: string) => {
    const n = used.get(base) ?? 0;
    used.set(base, n + 1);
    return n === 0 ? base : `${base}${n}`; // n8n's own convention: "HTTP Request1"
  };

  const tDef = TRIGGERS[flow.trigger.kind];
  const nodes: GraphNode[] = [
    {
      index: -1,
      kind: flow.trigger.kind,
      name: uniqueName(tDef.n8nName),
      title: tDef.label,
      detail: clip(detailFor(flow.trigger.kind, flow.trigger.p), 40),
      category: 'trigger',
      glyph: tDef.glyph,
      inputs: 0,
      outputs: 1,
    },
  ];
  const edges: GraphEdge[] = [];
  const deadEnds: FlowGraph['deadEnds'] = [];

  flow.steps.forEach((s, i) => {
    const def = STEPS[s.kind];
    const me = nodes.length;
    nodes.push({
      index: i,
      kind: s.kind,
      name: uniqueName(def.n8nName),
      title: def.label,
      detail: clip(detailFor(s.kind, s.p), 40),
      category: def.category,
      glyph: def.glyph,
      inputs: s.kind === 'merge' ? 2 : 1,
      outputs: s.kind === 'filter' ? 2 : 1,
    });
    const prev = me - 1;
    const prevIsIf = nodes[prev].kind === 'filter';
    edges.push({ from: prev, to: me, fromOutput: 0, toInput: 0, label: prevIsIf ? 'true' : undefined });
    if (s.kind === 'merge') edges.push({ from: 0, to: me, fromOutput: 0, toInput: 1 });
    if (s.kind === 'filter') deadEnds.push({ from: me, fromOutput: 1, label: 'false → stop' });
  });

  return { nodes, edges, deadEnds };
}
