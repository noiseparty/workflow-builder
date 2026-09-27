// FlowState → n8n workflow JSON, ready for "Import from File…".
//
// Node type ids, typeVersions and parameter shapes were taken from n8n's own node sources
// (github.com/n8n-io/n8n, packages/nodes-base/nodes). Versions are deliberately one or two
// behind the newest so the file also imports into self-hosted instances that lag a little.
// Everything here is deterministic: the same builder state always yields byte-identical JSON,
// including node ids, which are hashed from the state rather than drawn at random.

import { buildGraph, scheduleParams, sheetGid } from './graph';
import { scheduleToCron } from './cron';
import { FILTER_OPERATORS } from './catalog';
import type { AssignmentItem, FlowState, FormFieldItem, Params, StepKind, TriggerKind } from './types';

export interface N8nNode {
  parameters: Record<string, unknown>;
  id: string;
  name: string;
  type: string;
  typeVersion: number;
  position: [number, number];
  webhookId?: string;
  credentials?: Record<string, { id: string; name: string }>;
  onError?: 'continueRegularOutput';
}

export interface N8nConnection {
  node: string;
  type: 'main';
  index: number;
}

export interface N8nWorkflow {
  name: string;
  nodes: N8nNode[];
  connections: Record<string, { main: N8nConnection[][] }>;
  active: false;
  settings: { executionOrder: 'v1' };
  pinData: Record<string, never>;
}

export const NODE_TYPES: Record<TriggerKind | StepKind, { type: string; typeVersion: number }> = {
  schedule: { type: 'n8n-nodes-base.scheduleTrigger', typeVersion: 1.2 },
  webhook: { type: 'n8n-nodes-base.webhook', typeVersion: 2 },
  rss: { type: 'n8n-nodes-base.rssFeedReadTrigger', typeVersion: 1 },
  form: { type: 'n8n-nodes-base.formTrigger', typeVersion: 2.2 },
  sheetsRow: { type: 'n8n-nodes-base.googleSheetsTrigger', typeVersion: 1 },
  http: { type: 'n8n-nodes-base.httpRequest', typeVersion: 4.2 },
  filter: { type: 'n8n-nodes-base.if', typeVersion: 2.2 },
  set: { type: 'n8n-nodes-base.set', typeVersion: 3.4 },
  wait: { type: 'n8n-nodes-base.wait', typeVersion: 1.1 },
  merge: { type: 'n8n-nodes-base.merge', typeVersion: 3 },
  telegram: { type: 'n8n-nodes-base.telegram', typeVersion: 1.2 },
  slack: { type: 'n8n-nodes-base.slack', typeVersion: 2.3 },
  discord: { type: 'n8n-nodes-base.discord', typeVersion: 2 },
  email: { type: 'n8n-nodes-base.emailSend', typeVersion: 2.1 },
  sheetsAppend: { type: 'n8n-nodes-base.googleSheets', typeVersion: 4.5 },
  postgres: { type: 'n8n-nodes-base.postgres', typeVersion: 2.5 },
};

/** Credential slot → the placeholder name shown in n8n until you pick a real credential. */
export const CREDENTIALS: Partial<Record<TriggerKind | StepKind, { key: string; name: string; label: string }>> = {
  sheetsRow: { key: 'googleSheetsTriggerOAuth2Api', name: 'Google Sheets Trigger account', label: 'Google Sheets (OAuth2)' },
  telegram: { key: 'telegramApi', name: 'Telegram account', label: 'Telegram bot token' },
  slack: { key: 'slackApi', name: 'Slack account', label: 'Slack API token' },
  discord: { key: 'discordWebhookApi', name: 'Discord Webhook account', label: 'Discord webhook URL' },
  email: { key: 'smtp', name: 'SMTP account', label: 'SMTP server login' },
  sheetsAppend: { key: 'googleSheetsOAuth2Api', name: 'Google Sheets account', label: 'Google Sheets (OAuth2)' },
  postgres: { key: 'postgres', name: 'Postgres account', label: 'Postgres connection' },
};

// ---- deterministic ids -----------------------------------------------------------------

function fnv1a(str: string, seed: number): number {
  let h = 0x811c9dc5 ^ seed;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  // murmur3's finaliser, so keys that differ only in their last character still diverge fully.
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

/** A UUID-v4-shaped id derived from `key`. Stable across runs; unique for distinct keys in practice. */
export function stableUuid(key: string): string {
  const hex = [1, 2, 3, 4].map((s) => fnv1a(key, s * 0x9e3779b1).toString(16).padStart(8, '0')).join('');
  const variant = ((parseInt(hex[16], 16) & 0x3) | 0x8).toString(16);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-${variant}${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

// ---- parameter builders ----------------------------------------------------------------

const HAS_EXPR = /\{\{[\s\S]*?\}\}/;
/** n8n treats a parameter as an expression only when it starts with "=". */
export const expr = (s: string) => (HAS_EXPR.test(s) ? `=${s}` : s);

const rl = (value: string, mode: string) => ({ __rl: true, value, mode });

function pollTimes(minutes: string) {
  const item =
    minutes === '1' ? { mode: 'everyMinute' } : minutes === '60' ? { mode: 'everyHour' } : minutes === '1440' ? { mode: 'everyDay', hour: 9 } : { mode: 'everyX', value: Number(minutes), unit: 'minutes' };
  return { item: [item] };
}

const autoMapColumns = () => ({ mappingMode: 'autoMapInputData', value: {}, matchingColumns: [], schema: [] });

function triggerParams(kind: TriggerKind, p: Params): Record<string, unknown> {
  switch (kind) {
    case 'schedule': {
      const sp = scheduleParams(p);
      const interval = sp.mode === 'minutes' ? { field: 'minutes', minutesInterval: sp.every } : { field: 'cronExpression', expression: scheduleToCron(sp) };
      return { rule: { interval: [interval] } };
    }
    case 'webhook':
      return { httpMethod: p.method, path: String(p.path).trim(), options: {} };
    case 'rss':
      return { pollTimes: pollTimes(String(p.poll)), feedUrl: String(p.feedUrl).trim() };
    case 'form':
      return {
        formTitle: p.title,
        formDescription: p.description,
        formFields: {
          values: (p.fields as FormFieldItem[]).map((f) => ({
            fieldLabel: f.label.trim(),
            ...(f.type !== 'text' ? { fieldType: f.type } : {}),
            ...(f.required ? { requiredField: true } : {}),
          })),
        },
        options: {},
      };
    case 'sheetsRow':
      return {
        pollTimes: pollTimes(String(p.poll)),
        documentId: rl(String(p.documentUrl).trim(), 'url'),
        sheetName: rl(sheetGid(String(p.documentUrl)), 'id'),
        event: 'rowAdded',
        options: {},
      };
  }
}

function assignmentValue(a: AssignmentItem): string | number | boolean {
  if (HAS_EXPR.test(a.value)) return `=${a.value}`;
  if (a.type === 'number' && a.value.trim() !== '' && Number.isFinite(Number(a.value))) return Number(a.value);
  if (a.type === 'boolean') return /^true$/i.test(a.value.trim());
  return a.value;
}

function stepParams(kind: StepKind, p: Params, idKey: string): Record<string, unknown> {
  switch (kind) {
    case 'http': {
      const out: Record<string, unknown> = { method: p.method, url: expr(String(p.url).trim()) };
      if (['POST', 'PUT', 'PATCH'].includes(String(p.method))) {
        const body = String(p.body).trim();
        out.sendBody = true;
        out.specifyBody = 'json';
        out.jsonBody = body ? expr(body) : '={{ JSON.stringify($json) }}';
      }
      out.options = p.keepGoing ? { response: { response: { fullResponse: true, neverError: true } }, timeout: 10000 } : {};
      return out;
    }
    case 'filter': {
      const op = FILTER_OPERATORS.find((o) => o.value === p.operator) ?? FILTER_OPERATORS[0];
      const raw = String(p.value).trim();
      const rightValue = op.single ? '' : HAS_EXPR.test(raw) ? `=${raw}` : op.type === 'number' ? Number(raw) : raw;
      return {
        conditions: {
          options: { caseSensitive: true, leftValue: '', typeValidation: 'loose', version: 2 },
          conditions: [
            {
              id: stableUuid(`${idKey}:cond`),
              leftValue: `={{ $json.${String(p.field).trim()} }}`,
              rightValue,
              operator: { type: op.type, operation: op.operation, ...(op.single ? { singleValue: true } : {}) },
            },
          ],
          combinator: 'and',
        },
        looseTypeValidation: true,
        options: {},
      };
    }
    case 'set':
      return {
        assignments: {
          assignments: (p.assignments as AssignmentItem[]).map((a, i) => ({
            id: stableUuid(`${idKey}:a${i}`),
            name: a.name.trim(),
            value: assignmentValue(a),
            type: a.type,
          })),
        },
        includeOtherFields: p.keepOthers === true,
        options: {},
      };
    case 'wait':
      return { amount: p.amount, unit: p.unit };
    case 'merge':
      return p.mode === 'append' ? { mode: 'append' } : { mode: 'combine', combineBy: 'combineByPosition', options: {} };
    case 'telegram':
      return {
        chatId: expr(String(p.chatId).trim()),
        text: expr(String(p.text)),
        additionalFields: { appendAttribution: false, ...(p.parseMode !== 'none' ? { parse_mode: p.parseMode } : {}) },
      };
    case 'slack':
      return {
        select: 'channel',
        channelId: rl(String(p.channel).trim(), 'name'),
        text: expr(String(p.text)),
        otherOptions: { includeLinkToWorkflow: false },
      };
    case 'discord':
      return {
        authentication: 'webhook',
        operation: 'sendLegacy',
        content: expr(String(p.content)),
        options: String(p.username).trim() ? { username: String(p.username).trim() } : {},
      };
    case 'email':
      return {
        fromEmail: expr(String(p.from).trim()),
        toEmail: expr(String(p.to).trim()),
        subject: expr(String(p.subject)),
        emailFormat: 'text',
        text: expr(String(p.text)),
        options: { appendAttribution: false },
      };
    case 'sheetsAppend':
      return {
        operation: 'append',
        documentId: rl(String(p.documentUrl).trim(), 'url'),
        sheetName: rl(String(p.sheetName).trim(), 'name'),
        columns: autoMapColumns(),
        options: {},
      };
    case 'postgres':
      return {
        operation: 'insert',
        schema: rl(String(p.schema).trim(), 'name'),
        table: rl(String(p.table).trim(), 'name'),
        columns: autoMapColumns(),
        options: {},
      };
  }
}

const NEEDS_WEBHOOK_ID = new Set<string>(['webhook', 'form', 'wait']);
export const NODE_SPACING = 220;

export function toN8n(flow: FlowState): N8nWorkflow {
  const graph = buildGraph(flow);
  const seed = JSON.stringify(flow);

  const nodes: N8nNode[] = graph.nodes.map((g, i) => {
    const idKey = `${seed}#${i}`;
    const src = g.index < 0 ? flow.trigger : flow.steps[g.index];
    const parameters = g.index < 0 ? triggerParams(src.kind as TriggerKind, src.p) : stepParams(src.kind as StepKind, src.p, idKey);
    const node: N8nNode = {
      parameters,
      id: stableUuid(idKey),
      name: g.name,
      type: NODE_TYPES[g.kind].type,
      typeVersion: NODE_TYPES[g.kind].typeVersion,
      position: [i * NODE_SPACING, 0],
    };
    if (NEEDS_WEBHOOK_ID.has(g.kind)) node.webhookId = stableUuid(`${idKey}:webhook`);
    const cred = CREDENTIALS[g.kind];
    // Named placeholder: the id matches nothing, so n8n flags the node and asks you to pick
    // or create a credential of this type — which is exactly the step we want you to take.
    if (cred) node.credentials = { [cred.key]: { id: `REPLACE_ME_${cred.key}`, name: cred.name } };
    if (g.kind === 'http' && src.p.keepGoing) node.onError = 'continueRegularOutput';
    return node;
  });

  const connections: N8nWorkflow['connections'] = {};
  for (const e of graph.edges) {
    const fromName = graph.nodes[e.from].name;
    const slot = (connections[fromName] ??= { main: [] });
    while (slot.main.length <= e.fromOutput) slot.main.push([]);
    slot.main[e.fromOutput].push({ node: graph.nodes[e.to].name, type: 'main', index: e.toInput });
  }
  // An IF's false output is declared (empty) so n8n draws the second handle explicitly.
  for (const d of graph.deadEnds) {
    const slot = (connections[graph.nodes[d.from].name] ??= { main: [] });
    while (slot.main.length <= d.fromOutput) slot.main.push([]);
  }

  return {
    name: flow.name.trim() || 'My workflow',
    nodes,
    connections,
    active: false,
    settings: { executionOrder: 'v1' },
    pinData: {},
  };
}

export function credentialsNeeded(flow: FlowState): string[] {
  const kinds = [flow.trigger.kind, ...flow.steps.map((s) => s.kind)];
  return [...new Set(kinds.map((k) => CREDENTIALS[k]?.label).filter((x): x is string => !!x))];
}

// ---- shape check (used by the tests, and as a last guard before export) -----------------

export function validateWorkflowShape(wf: N8nWorkflow): string[] {
  const problems: string[] = [];
  const names = wf.nodes.map((n) => n.name);
  const nameSet = new Set(names);
  if (nameSet.size !== names.length) problems.push('node names are not unique');
  const ids = new Set(wf.nodes.map((n) => n.id));
  if (ids.size !== wf.nodes.length) problems.push('node ids are not unique');
  for (const n of wf.nodes) {
    if (!/^n8n-nodes-base\.[A-Za-z]+$/.test(n.type)) problems.push(`${n.name}: bad type ${n.type}`);
    if (!(typeof n.typeVersion === 'number' && n.typeVersion >= 1)) problems.push(`${n.name}: bad typeVersion`);
    if (!Array.isArray(n.position) || n.position.length !== 2 || !n.position.every(Number.isFinite)) problems.push(`${n.name}: position not set`);
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(n.id)) problems.push(`${n.name}: id is not a UUID`);
  }
  for (const [from, conn] of Object.entries(wf.connections)) {
    if (!nameSet.has(from)) problems.push(`connection from unknown node "${from}"`);
    conn.main.forEach((out) =>
      out.forEach((c) => {
        if (!nameSet.has(c.node)) problems.push(`connection to unknown node "${c.node}"`);
        if (c.type !== 'main' || !Number.isInteger(c.index) || c.index < 0) problems.push(`bad connection into "${c.node}"`);
      }),
    );
  }
  const triggers = wf.nodes.filter((n) => /Trigger$|\.webhook$|\.formTrigger$/.test(n.type));
  if (triggers.length !== 1) problems.push(`expected exactly one trigger, found ${triggers.length}`);
  // Every non-trigger node must be reachable from something.
  const targets = new Set(Object.values(wf.connections).flatMap((c) => c.main.flat().map((x) => x.node)));
  for (const n of wf.nodes) if (!triggers.includes(n) && !targets.has(n.name)) problems.push(`${n.name} is not connected`);
  return problems;
}
