// Normalising untrusted state, encoding it into a share link, and checking it for problems.

import { STEPS, TRIGGERS, defaultParams, type FieldDef, type NodeDef } from './catalog';
import { validateCron } from './cron';
import { MAX_STEPS, type AssignmentItem, type FlowState, type FormFieldItem, type Params, type StepKind, type TriggerKind } from './types';

const isObj = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);

function coerceField(f: FieldDef, raw: unknown): Params[string] {
  switch (f.type) {
    case 'select': {
      const s = String(raw ?? '');
      return f.options.some((o) => o.value === s) ? s : f.default;
    }
    case 'number': {
      const n = typeof raw === 'number' ? raw : Number(raw);
      if (!Number.isFinite(n)) return f.default;
      return Math.min(f.max, Math.max(f.min, Math.round(n)));
    }
    case 'toggle':
      return typeof raw === 'boolean' ? raw : f.default;
    case 'time':
      return typeof raw === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(raw) ? raw : f.default;
    case 'formFields': {
      if (!Array.isArray(raw)) return f.default.map((x) => ({ ...x }));
      return raw.filter(isObj).slice(0, f.maxItems).map(
        (x): FormFieldItem => ({
          label: String(x.label ?? '').slice(0, 80),
          type: ['text', 'email', 'number', 'textarea'].includes(String(x.type)) ? (x.type as FormFieldItem['type']) : 'text',
          required: x.required === true,
        }),
      );
    }
    case 'assignments': {
      if (!Array.isArray(raw)) return f.default.map((x) => ({ ...x }));
      return raw.filter(isObj).slice(0, f.maxItems).map(
        (x): AssignmentItem => ({
          name: String(x.name ?? '').slice(0, 80),
          value: String(x.value ?? '').slice(0, 500),
          type: ['string', 'number', 'boolean'].includes(String(x.type)) ? (x.type as AssignmentItem['type']) : 'string',
        }),
      );
    }
    default:
      return typeof raw === 'string' ? raw.slice(0, f.max) : typeof raw === 'number' ? String(raw).slice(0, f.max) : f.default;
  }
}

export function normalizeParams(def: NodeDef, raw: unknown): Params {
  const src = isObj(raw) ? raw : {};
  const out: Params = {};
  for (const f of def.fields) out[f.key] = coerceField(f, src[f.key]);
  return out;
}

export function normalizeFlow(raw: unknown): FlowState {
  const src = isObj(raw) ? raw : {};
  const t = isObj(src.trigger) ? src.trigger : {};
  const tKind: TriggerKind = typeof t.kind === 'string' && t.kind in TRIGGERS ? (t.kind as TriggerKind) : 'schedule';
  const steps = (Array.isArray(src.steps) ? src.steps : [])
    .filter((s): s is Record<string, unknown> => isObj(s) && typeof s.kind === 'string' && s.kind in STEPS)
    .slice(0, MAX_STEPS)
    .map((s) => ({ kind: s.kind as StepKind, p: normalizeParams(STEPS[s.kind as StepKind], s.p) }));
  const name = typeof src.name === 'string' && src.name.trim() ? src.name.trim().slice(0, 80) : 'My workflow';
  return { name, trigger: { kind: tKind, p: normalizeParams(TRIGGERS[tKind], t.p) }, steps };
}

export function emptyFlow(): FlowState {
  return { name: 'My workflow', trigger: { kind: 'schedule', p: defaultParams(TRIGGERS.schedule) }, steps: [] };
}

// ---- share link ------------------------------------------------------------------------

export const MAX_HASH_LENGTH = 16_000;

function toBase64Url(bytes: Uint8Array): string {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(s: string): Uint8Array {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4);
  const bin = atob(b64);
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

export function encodeFlow(flow: FlowState): string {
  return toBase64Url(new TextEncoder().encode(JSON.stringify(flow)));
}

/** Decodes a share-link payload. Throws with a plain-language message when it is damaged. */
export function decodeFlow(payload: string): FlowState {
  if (payload.length > MAX_HASH_LENGTH) throw new Error('That shared link is too long to be a workflow.');
  if (!/^[A-Za-z0-9_-]*$/.test(payload)) throw new Error('That shared link has been cut off or altered.');
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(fromBase64Url(payload)));
  } catch {
    throw new Error('That shared link has been cut off or altered.');
  }
  if (!isObj(parsed) || !isObj(parsed.trigger)) throw new Error('That shared link does not contain a workflow.');
  return normalizeFlow(parsed);
}

// ---- problems --------------------------------------------------------------------------

export interface Issue {
  /** 'trigger', a step index, or 'flow' for structural problems. */
  at: 'trigger' | 'flow' | number;
  field?: string;
  level: 'error' | 'warning';
  message: string;
}

const EXPR = /\{\{[\s\S]*?\}\}/;
export const FIELD_PATH = /^[A-Za-z_$][\w$]*(\.[A-Za-z_$][\w$]*|\[\d+\])*$/;

function checkUrl(v: string): string | null {
  if (EXPR.test(v)) return /^https?:\/\//i.test(v) ? null : 'must start with http:// or https://';
  try {
    const u = new URL(v);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return 'must start with http:// or https://';
    return null;
  } catch {
    return 'is not a valid URL';
  }
}

function checkNode(def: NodeDef, p: Params, at: Issue['at'], out: Issue[]) {
  for (const f of def.fields) {
    if (f.showIf && !f.showIf(p)) continue;
    const v = p[f.key];
    const push = (level: Issue['level'], message: string) => out.push({ at, field: f.key, level, message });
    if (typeof v === 'string') {
      const s = v.trim();
      if (!s) {
        if ('required' in f && f.required) push('warning', `${f.label} is empty — you'll need to fill it in n8n.`);
        continue;
      }
      if (f.type === 'url') {
        const e = checkUrl(s);
        if (e) push('error', `${f.label} ${e}.`);
      } else if (f.type === 'path' && !/^[A-Za-z0-9][A-Za-z0-9/_-]*$/.test(s)) {
        push('error', `${f.label} may only use letters, numbers, "-", "_" and "/".`);
      } else if (f.type === 'fieldPath' && !FIELD_PATH.test(s)) {
        push('error', `${f.label} should look like "price" or "body.total" — no spaces or braces.`);
      } else if (f.type === 'textarea' && f.key === 'body' && !EXPR.test(s)) {
        try {
          JSON.parse(s);
        } catch {
          push('error', 'JSON body is not valid JSON.');
        }
      }
      if (f.key === 'cron') {
        const e = validateCron(s);
        if (e) push('error', e);
      }
    }
    if (f.type === 'formFields' && Array.isArray(v)) {
      const items = v as FormFieldItem[];
      if (items.length === 0) push('error', 'The form needs at least one field.');
      const labels = items.map((x) => x.label.trim());
      if (labels.some((l) => !l)) push('error', 'Every form field needs a label.');
      if (new Set(labels).size !== labels.length) push('error', 'Two form fields share a label; answers are keyed by label.');
    }
    if (f.type === 'assignments' && Array.isArray(v)) {
      const items = v as AssignmentItem[];
      if (items.length === 0) push('warning', 'This step sets no fields.');
      const names = items.map((x) => x.name.trim());
      if (names.some((n) => !n)) push('error', 'Every field needs a name.');
      if (new Set(names).size !== names.length) push('error', 'Two fields share a name.');
      items.forEach((x) => {
        if (x.type === 'number' && x.value.trim() && !EXPR.test(x.value) && !Number.isFinite(Number(x.value))) push('error', `"${x.name}" is set to a number but "${x.value}" is not one.`);
        if (x.type === 'boolean' && x.value.trim() && !EXPR.test(x.value) && !/^(true|false)$/i.test(x.value.trim())) push('error', `"${x.name}" is a true/false field; use true or false.`);
      });
    }
  }
}

export function findIssues(flow: FlowState): Issue[] {
  const out: Issue[] = [];
  checkNode(TRIGGERS[flow.trigger.kind], flow.trigger.p, 'trigger', out);
  flow.steps.forEach((s, i) => {
    checkNode(STEPS[s.kind], s.p, i, out);
    if (s.kind === 'merge' && i === 0) out.push({ at: i, level: 'warning', message: 'Merge straight after the trigger joins the trigger with itself; put a step before it.' });
    if (s.kind === 'filter' && s.p.operator.toString().startsWith('num_') && !EXPR.test(String(s.p.value)) && !Number.isFinite(Number(String(s.p.value).trim())))
      out.push({ at: i, field: 'value', level: 'error', message: `"${s.p.value}" is not a number, but the condition compares numbers.` });
  });
  if (flow.steps.length === 0) out.push({ at: 'flow', level: 'error', message: 'Add at least one step after the trigger.' });
  const last = flow.steps[flow.steps.length - 1];
  if (last && (last.kind === 'filter' || last.kind === 'wait' || last.kind === 'merge')) {
    out.push({ at: 'flow', level: 'warning', message: `The workflow ends on a ${STEPS[last.kind].label.toLowerCase()} step, so nothing happens afterwards.` });
  }
  return out;
}
