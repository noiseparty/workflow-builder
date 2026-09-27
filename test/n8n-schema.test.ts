// Checks every node Flow Builder emits against n8n's own node descriptions (a slice of
// n8n-nodes-base's dist/types/nodes.json, see scripts/extract-n8n-fixture.mjs): the type and
// typeVersion exist, every parameter we write is a real, visible parameter for that version,
// option values are among the allowed ones, resource-locator modes exist, collection keys are
// real, and each credential slot is one the node accepts given its other parameters.

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { toN8n, type N8nNode } from '../src/lib/n8n';
import { TEMPLATES } from '../src/lib/templates';
import { normalizeFlow } from '../src/lib/state';
import { STEP_ORDER, STEPS, TRIGGERS, TRIGGER_ORDER, defaultParams } from '../src/lib/catalog';
import type { FlowState } from '../src/lib/types';

type Prop = {
  name: string;
  type: string;
  default?: unknown;
  displayOptions?: { show?: Record<string, unknown[]>; hide?: Record<string, unknown[]> };
  options?: (Prop & { value?: unknown; values?: Prop[] })[];
  modes?: { name: string; validation?: { type: string; properties: { regex: string } }[] }[];
};
type Desc = { version: number | number[]; properties: Prop[]; credentials: { name: string; displayOptions?: Prop['displayOptions'] }[] };

const fixture = JSON.parse(readFileSync(new URL('./fixtures/n8n-nodes.json', import.meta.url), 'utf8')) as { nodes: Record<string, Desc> };

function cond(expected: unknown, actual: unknown): boolean {
  if (expected && typeof expected === 'object' && '_cnd' in expected) {
    const [[op, v]] = Object.entries((expected as { _cnd: Record<string, unknown> })._cnd);
    const a = actual as number;
    switch (op) {
      case 'gte': return a >= (v as number);
      case 'gt': return a > (v as number);
      case 'lte': return a <= (v as number);
      case 'lt': return a < (v as number);
      case 'eq': return a === v;
      case 'not': return a !== v;
      case 'exists': return actual !== undefined && actual !== '';
      case 'between': { const r = v as { from: number; to: number }; return a >= r.from && a <= r.to; }
      default: throw new Error(`unhandled _cnd ${op}`);
    }
  }
  return expected === actual;
}

function visible(p: { displayOptions?: Prop['displayOptions'] }, values: Record<string, unknown>, version: number): boolean {
  const get = (k: string) => (k === '@version' ? version : values[k.replace(/^\//, '')]);
  const { show, hide } = p.displayOptions ?? {};
  for (const [k, allowed] of Object.entries(show ?? {})) if (!allowed.some((e) => cond(e, get(k)))) return false;
  for (const [k, banned] of Object.entries(hide ?? {})) if (banned.some((e) => cond(e, get(k)))) return false;
  return true;
}

/** Top-level values as n8n would see them: our parameters over the defaults of visible props. */
function effectiveValues(desc: Desc, params: Record<string, unknown>, version: number) {
  const values: Record<string, unknown> = { ...params };
  for (let pass = 0; pass < 4; pass++) {
    for (const p of desc.properties) if (!(p.name in params) && visible(p, values, version)) values[p.name] = p.default;
  }
  return values;
}

const isExpr = (v: unknown) => typeof v === 'string' && v.startsWith('=');

function checkValue(prop: Prop, value: unknown, path: string, out: string[]) {
  if (isExpr(value)) return;
  switch (prop.type) {
    case 'options':
      if (!prop.options?.some((o) => o.value === value)) out.push(`${path}: "${String(value)}" not in [${prop.options?.map((o) => o.value).join(', ')}]`);
      break;
    case 'boolean':
      if (typeof value !== 'boolean') out.push(`${path}: expected boolean`);
      break;
    case 'number':
      if (typeof value !== 'number') out.push(`${path}: expected number`);
      break;
    case 'string':
      if (typeof value !== 'string') out.push(`${path}: expected string`);
      break;
    case 'resourceLocator': {
      const rl = value as { __rl?: boolean; mode?: string; value?: string };
      const mode = prop.modes?.find((m) => m.name === rl?.mode);
      if (!rl?.__rl || !mode) out.push(`${path}: resource locator mode "${rl?.mode}" not in [${prop.modes?.map((m) => m.name)}]`);
      for (const v of mode?.validation ?? [])
        if (v.type === 'regex' && rl.value && !isExpr(rl.value) && !new RegExp(v.properties.regex).test(rl.value)) out.push(`${path}: "${rl.value}" fails n8n's ${rl.mode} validation`);
      break;
    }
    case 'collection': {
      for (const [k, v] of Object.entries(value as object)) {
        const sub = prop.options?.find((o) => o.name === k);
        if (!sub) out.push(`${path}.${k}: not an option of ${prop.name}`);
        else checkValue(sub, v, `${path}.${k}`, out);
      }
      break;
    }
    case 'fixedCollection': {
      for (const [k, v] of Object.entries(value as object)) {
        const group = prop.options?.find((o) => o.name === k);
        if (!group) { out.push(`${path}.${k}: not a group of ${prop.name}`); continue; }
        for (const item of [].concat(v as never)) {
          for (const [ik, iv] of Object.entries(item as object)) {
            const sub = group.values?.find((o) => o.name === ik);
            if (!sub) out.push(`${path}.${k}.${ik}: unknown field`);
            else checkValue(sub, iv, `${path}.${k}.${ik}`, out);
          }
        }
      }
      break;
    }
  }
}

export function checkNode(node: N8nNode): string[] {
  const desc = fixture.nodes[node.type];
  if (!desc) return [`${node.name}: unknown node type ${node.type}`];
  if (![desc.version].flat().includes(node.typeVersion)) return [`${node.name}: ${node.type} has no typeVersion ${node.typeVersion}`];
  const out: string[] = [];
  const values = effectiveValues(desc, node.parameters, node.typeVersion);
  for (const [k, v] of Object.entries(node.parameters)) {
    const props = desc.properties.filter((p) => p.name === k && visible(p, values, node.typeVersion));
    if (!props.length) { out.push(`${node.name}: parameter "${k}" does not exist or is hidden`); continue; }
    // Several same-named props can be visible under different option lists; one must accept it.
    const errs = props.map((p) => { const e: string[] = []; checkValue(p, v, `${node.name}.${k}`, e); return e; });
    if (errs.every((e) => e.length)) out.push(...errs[0]);
  }
  for (const key of Object.keys(node.credentials ?? {})) {
    const c = desc.credentials.find((c) => c.name === key);
    if (!c) out.push(`${node.name}: credential type ${key} not accepted (${desc.credentials.map((c) => c.name)})`);
    else if (!visible(c, values, node.typeVersion)) out.push(`${node.name}: credential ${key} not active for these parameters`);
  }
  return out;
}

const flowOf = (trigger: FlowState['trigger']['kind'], steps: FlowState['steps'][number]['kind'][], overrides: Record<string, unknown> = {}): FlowState =>
  normalizeFlow({
    name: 'T',
    trigger: { kind: trigger, p: defaultParams(TRIGGERS[trigger]) },
    steps: steps.map((k) => ({ kind: k, p: { ...defaultParams(STEPS[k]), ...(overrides[k] as object) } })),
  });

describe('n8n node definitions', () => {
  it('every template matches n8n-nodes-base', () => {
    for (const t of TEMPLATES) expect(toN8n(t.flow).nodes.flatMap(checkNode), t.id).toEqual([]);
  });

  it('every trigger and every step, with defaults, matches n8n-nodes-base', () => {
    for (const trig of TRIGGER_ORDER) expect(toN8n(flowOf(trig, STEP_ORDER.slice(0, 5))).nodes.flatMap(checkNode), trig).toEqual([]);
    for (let i = 0; i < STEP_ORDER.length; i += 5) expect(toN8n(flowOf('webhook', STEP_ORDER.slice(i, i + 5))).nodes.flatMap(checkNode)).toEqual([]);
  });

  it('every select option of every node matches n8n-nodes-base', () => {
    const defs = [...TRIGGER_ORDER.map((k) => ['t', k, TRIGGERS[k]] as const), ...STEP_ORDER.map((k) => ['s', k, STEPS[k]] as const)];
    for (const [where, kind, def] of defs) {
      for (const f of def.fields) {
        if (f.type !== 'select') continue;
        for (const o of f.options) {
          const p = { ...defaultParams(def), [f.key]: o.value };
          const flow =
            where === 't'
              ? normalizeFlow({ name: 'T', trigger: { kind, p }, steps: [{ kind: 'http', p: {} }] })
              : normalizeFlow({ name: 'T', trigger: { kind: 'webhook', p: {} }, steps: [{ kind: 'http', p: {} }, { kind, p }] });
          expect(toN8n(flow).nodes.flatMap(checkNode), `${kind}.${f.key}=${o.value}`).toEqual([]);
        }
      }
    }
  });

  it('hand-built flows with every field filled in match n8n-nodes-base', () => {
    const sheet = 'https://docs.google.com/spreadsheets/d/1AbC_d-9/edit#gid=42';
    const flows = [
      normalizeFlow({
        name: 'A',
        trigger: { kind: 'sheetsRow', p: { documentUrl: sheet, poll: '60' } },
        steps: [
          { kind: 'http', p: { method: 'POST', url: 'https://x.test/{{ $json.id }}', body: '{"a": "{{ $json.a }}"}', keepGoing: true } },
          { kind: 'filter', p: { field: 'body.ok', operator: 'str_contains', value: '{{ $json.x }}' } },
          { kind: 'set', p: { assignments: [{ name: 'n', value: '3', type: 'number' }, { name: 'b', value: 'true', type: 'boolean' }, { name: 's', value: '{{ 1 }}', type: 'string' }], keepOthers: true } },
          { kind: 'sheetsAppend', p: { documentUrl: sheet, sheetName: 'Log' } },
          { kind: 'postgres', p: { schema: 'public', table: 't' } },
        ],
      }),
      normalizeFlow({
        name: 'B',
        trigger: { kind: 'form', p: { title: 'F', fields: [{ label: 'A', type: 'number', required: true }, { label: 'B', type: 'textarea', required: false }] } },
        steps: [
          { kind: 'wait', p: { amount: 2, unit: 'hours' } },
          { kind: 'merge', p: { mode: 'append' } },
          { kind: 'telegram', p: { chatId: '-100', text: '<b>{{ $json.A }}</b>', parseMode: 'HTML' } },
          { kind: 'discord', p: { content: 'x', username: 'bot' } },
          { kind: 'email', p: { from: 'a@b.c', to: 'd@e.f', subject: 'S', text: 'T' } },
        ],
      }),
    ];
    for (const f of flows) expect(toN8n(f).nodes.flatMap(checkNode), f.name).toEqual([]);
  });

  it('rejects a node n8n would not know', () => {
    const bad = { ...toN8n(flowOf('webhook', ['slack'])).nodes[1], parameters: { channel: '#x' } };
    expect(checkNode(bad as N8nNode).join()).toMatch(/does not exist/);
  });
});
