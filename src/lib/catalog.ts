// The curated catalogue: what each trigger/step is called, what the form asks for, and the
// default values. The UI renders forms straight from these definitions and the normaliser
// uses them to coerce untrusted state (e.g. from a shared URL) back into shape.

import type { Params, StepKind, TriggerKind } from './types';

export interface Option {
  value: string;
  label: string;
}

interface BaseField {
  key: string;
  label: string;
  help?: string;
  placeholder?: string;
  /** Only shown (and only validated) when this returns true. */
  showIf?: (p: Params) => boolean;
}

export type FieldDef =
  | (BaseField & { type: 'text' | 'url' | 'template' | 'textarea' | 'path' | 'fieldPath'; default: string; required?: boolean; max: number })
  | (BaseField & { type: 'select'; default: string; options: Option[] })
  | (BaseField & { type: 'number'; default: number; min: number; max: number })
  | (BaseField & { type: 'toggle'; default: boolean })
  | (BaseField & { type: 'time'; default: string })
  | (BaseField & { type: 'formFields'; default: { label: string; type: 'text' | 'email' | 'number' | 'textarea'; required: boolean }[]; maxItems: number })
  | (BaseField & { type: 'assignments'; default: { name: string; value: string; type: 'string' | 'number' | 'boolean' }[]; maxItems: number });

export type Category = 'trigger' | 'logic' | 'data' | 'notify' | 'store';

export interface NodeDef {
  label: string; // shown in the picker
  blurb: string; // one line in the picker
  n8nName: string; // n8n's default node name, used as the node's display name
  category: Category;
  glyph: string; // 1–3 chars drawn in the graph node
  fields: FieldDef[];
}

const opts = (...pairs: [string, string][]): Option[] => pairs.map(([value, label]) => ({ value, label }));

const is = (key: string, ...vals: string[]) => (p: Params) => vals.includes(String(p[key]));

export const TRIGGERS: Record<TriggerKind, NodeDef> = {
  schedule: {
    label: 'On a schedule',
    blurb: 'Every N minutes, daily, weekly…',
    n8nName: 'Schedule Trigger',
    category: 'trigger',
    glyph: '⏱',
    fields: [
      {
        key: 'mode',
        label: 'Runs',
        type: 'select',
        default: 'daily',
        options: opts(
          ['minutes', 'Every few minutes'],
          ['hourly', 'Every hour'],
          ['daily', 'Every day'],
          ['weekdays', 'Every weekday (Mon–Fri)'],
          ['weekly', 'Once a week'],
          ['monthly', 'Once a month'],
          ['cron', 'Custom (cron expression)'],
        ),
      },
      {
        key: 'every',
        label: 'Interval',
        type: 'select',
        default: '5',
        options: opts(['1', 'Every minute'], ['5', 'Every 5 minutes'], ['10', 'Every 10 minutes'], ['15', 'Every 15 minutes'], ['30', 'Every 30 minutes']),
        showIf: is('mode', 'minutes'),
      },
      { key: 'minute', label: 'Minutes past the hour', type: 'number', default: 0, min: 0, max: 59, showIf: is('mode', 'hourly') },
      { key: 'weekday', label: 'Day', type: 'select', default: '1', options: opts(['1', 'Monday'], ['2', 'Tuesday'], ['3', 'Wednesday'], ['4', 'Thursday'], ['5', 'Friday'], ['6', 'Saturday'], ['0', 'Sunday']), showIf: is('mode', 'weekly') },
      { key: 'dayOfMonth', label: 'Day of month', type: 'number', default: 1, min: 1, max: 28, help: '1–28, so it fires in February too.', showIf: is('mode', 'monthly') },
      { key: 'time', label: 'At', type: 'time', default: '09:00', showIf: is('mode', 'daily', 'weekdays', 'weekly', 'monthly') },
      { key: 'cron', label: 'Cron expression', type: 'text', default: '0 9 * * 1-5', max: 100, placeholder: 'minute hour day month weekday', help: 'Five fields, e.g. "30 8 * * 1-5" = 08:30 on weekdays.', showIf: is('mode', 'cron') },
    ],
  },
  webhook: {
    label: 'Incoming webhook',
    blurb: 'Another system calls a URL',
    n8nName: 'Webhook',
    category: 'trigger',
    glyph: '⇥',
    fields: [
      { key: 'method', label: 'HTTP method', type: 'select', default: 'POST', options: opts(['POST', 'POST'], ['GET', 'GET'], ['PUT', 'PUT']) },
      { key: 'path', label: 'Path', type: 'path', default: 'incoming', max: 60, required: true, placeholder: 'orders', help: 'Your URL becomes <n8n>/webhook/<path>. The request body arrives as $json.body.' },
    ],
  },
  rss: {
    label: 'New RSS item',
    blurb: 'A feed publishes something new',
    n8nName: 'RSS Feed Trigger',
    category: 'trigger',
    glyph: '◉',
    fields: [
      { key: 'feedUrl', label: 'Feed URL', type: 'url', default: 'https://hnrss.org/frontpage', max: 500, required: true, placeholder: 'https://example.com/feed.xml' },
      { key: 'poll', label: 'Check', type: 'select', default: '15', options: opts(['1', 'Every minute'], ['15', 'Every 15 minutes'], ['60', 'Every hour'], ['1440', 'Once a day']) },
    ],
  },
  form: {
    label: 'Form submission',
    blurb: 'n8n hosts a form for you',
    n8nName: 'On form submission',
    category: 'trigger',
    glyph: '▤',
    fields: [
      { key: 'title', label: 'Form title', type: 'text', default: 'Contact us', max: 120, required: true },
      { key: 'description', label: 'Description', type: 'text', default: '', max: 300, placeholder: 'Optional line under the title' },
      {
        key: 'fields',
        label: 'Fields',
        type: 'formFields',
        maxItems: 6,
        default: [
          { label: 'Name', type: 'text', required: true },
          { label: 'Email', type: 'email', required: true },
        ],
        help: 'Each answer arrives keyed by its label, e.g. $json.Email.',
      },
    ],
  },
  sheetsRow: {
    label: 'New Google Sheets row',
    blurb: 'A row is added to a sheet',
    n8nName: 'Google Sheets Trigger',
    category: 'trigger',
    glyph: '▦',
    fields: [
      { key: 'documentUrl', label: 'Spreadsheet URL', type: 'url', default: '', max: 500, required: true, placeholder: 'https://docs.google.com/spreadsheets/d/…/edit#gid=0', help: 'Copy it with the right tab open: the #gid= part picks the tab (first tab if absent).' },
      { key: 'poll', label: 'Check', type: 'select', default: '1', options: opts(['1', 'Every minute'], ['15', 'Every 15 minutes'], ['60', 'Every hour']) },
    ],
  },
};

export const FILTER_OPERATORS: { value: string; label: string; type: 'string' | 'number'; operation: string; single?: boolean; words: string }[] = [
  { value: 'num_gt', label: 'number >', type: 'number', operation: 'gt', words: 'is greater than' },
  { value: 'num_gte', label: 'number ≥', type: 'number', operation: 'gte', words: 'is at least' },
  { value: 'num_lt', label: 'number <', type: 'number', operation: 'lt', words: 'is less than' },
  { value: 'num_lte', label: 'number ≤', type: 'number', operation: 'lte', words: 'is at most' },
  { value: 'num_eq', label: 'number =', type: 'number', operation: 'equals', words: 'equals' },
  { value: 'num_ne', label: 'number ≠', type: 'number', operation: 'notEquals', words: 'is not' },
  { value: 'str_eq', label: 'text equals', type: 'string', operation: 'equals', words: 'is exactly' },
  { value: 'str_ne', label: 'text is not', type: 'string', operation: 'notEquals', words: 'is not' },
  { value: 'str_contains', label: 'text contains', type: 'string', operation: 'contains', words: 'contains' },
  { value: 'str_ncontains', label: 'text does not contain', type: 'string', operation: 'notContains', words: 'does not contain' },
  { value: 'str_starts', label: 'text starts with', type: 'string', operation: 'startsWith', words: 'starts with' },
  { value: 'exists', label: 'exists', type: 'string', operation: 'exists', single: true, words: 'exists' },
  { value: 'not_empty', label: 'is not empty', type: 'string', operation: 'notEmpty', single: true, words: 'is not empty' },
];

const hasBody = (p: Params) => ['POST', 'PUT', 'PATCH'].includes(String(p.method));
const needsValue = (p: Params) => !FILTER_OPERATORS.find((o) => o.value === p.operator)?.single;

export const STEPS: Record<StepKind, NodeDef> = {
  http: {
    label: 'HTTP request',
    blurb: 'Call any API or URL',
    n8nName: 'HTTP Request',
    category: 'data',
    glyph: '↗',
    fields: [
      { key: 'method', label: 'Method', type: 'select', default: 'GET', options: opts(['GET', 'GET'], ['POST', 'POST'], ['PUT', 'PUT'], ['PATCH', 'PATCH'], ['DELETE', 'DELETE']) },
      { key: 'url', label: 'URL', type: 'url', default: '', max: 1000, required: true, placeholder: 'https://api.example.com/items', help: 'May include {{ $json.field }} from the previous step.' },
      { key: 'body', label: 'JSON body', type: 'textarea', default: '', max: 4000, placeholder: '{ "id": "{{ $json.id }}" }', help: 'Sent as application/json. Leave empty to send the incoming item as-is.', showIf: hasBody },
      { key: 'keepGoing', label: 'Keep going on errors (outputs statusCode)', type: 'toggle', default: false, help: 'For health checks: a 500 or a timeout becomes data instead of stopping the run.' },
    ],
  },
  filter: {
    label: 'Filter (IF)',
    blurb: 'Only continue when a condition holds',
    n8nName: 'If',
    category: 'logic',
    glyph: '⋔',
    fields: [
      { key: 'field', label: 'Field', type: 'fieldPath', default: 'price', max: 120, required: true, placeholder: 'body.total', help: 'A field of the incoming item — e.g. statusCode, body.total, bitcoin.usd.' },
      { key: 'operator', label: 'Condition', type: 'select', default: 'num_gt', options: FILTER_OPERATORS.map((o) => ({ value: o.value, label: o.label })) },
      { key: 'value', label: 'Value', type: 'text', default: '100', max: 200, showIf: needsValue },
    ],
  },
  set: {
    label: 'Set / transform fields',
    blurb: 'Rename, compute or add fields',
    n8nName: 'Edit Fields',
    category: 'data',
    glyph: '≔',
    fields: [
      {
        key: 'assignments',
        label: 'Fields',
        type: 'assignments',
        maxItems: 6,
        default: [{ name: 'receivedAt', value: '{{ $now.toISO() }}', type: 'string' }],
        help: 'Values may use expressions, e.g. {{ $json.price * 1.21 }}.',
      },
      { key: 'keepOthers', label: 'Keep all other incoming fields', type: 'toggle', default: true },
    ],
  },
  wait: {
    label: 'Wait',
    blurb: 'Pause before the next step',
    n8nName: 'Wait',
    category: 'logic',
    glyph: '⏸',
    fields: [
      { key: 'amount', label: 'Amount', type: 'number', default: 5, min: 1, max: 1000 },
      { key: 'unit', label: 'Unit', type: 'select', default: 'minutes', options: opts(['seconds', 'Seconds'], ['minutes', 'Minutes'], ['hours', 'Hours'], ['days', 'Days']) },
    ],
  },
  merge: {
    label: 'Merge with trigger data',
    blurb: 'Join this branch back with the original item',
    n8nName: 'Merge',
    category: 'logic',
    glyph: '⋈',
    fields: [
      {
        key: 'mode',
        label: 'How',
        type: 'select',
        default: 'combineByPosition',
        options: opts(['combineByPosition', 'Combine side by side (item 1 with item 1)'], ['append', 'Append (one list after the other)']),
        help: 'Input 1 is the previous step, input 2 is the trigger’s original item.',
      },
    ],
  },
  telegram: {
    label: 'Send to Telegram',
    blurb: 'Message a chat via your bot',
    n8nName: 'Telegram',
    category: 'notify',
    glyph: '✈',
    fields: [
      { key: 'chatId', label: 'Chat ID', type: 'text', default: '', max: 64, required: true, placeholder: '-1001234567890', help: 'The numeric chat or channel ID your bot posts to.' },
      { key: 'text', label: 'Message', type: 'template', default: 'New event: {{ $json.title }}', max: 2000, required: true },
      { key: 'parseMode', label: 'Formatting', type: 'select', default: 'none', options: opts(['none', 'Plain text'], ['HTML', 'HTML'], ['Markdown', 'Markdown']) },
    ],
  },
  slack: {
    label: 'Send to Slack',
    blurb: 'Post to a channel',
    n8nName: 'Slack',
    category: 'notify',
    glyph: '#',
    fields: [
      { key: 'channel', label: 'Channel', type: 'text', default: '#general', max: 80, required: true, placeholder: '#alerts' },
      { key: 'text', label: 'Message', type: 'template', default: 'Heads up: {{ $json.title }}', max: 2000, required: true },
    ],
  },
  discord: {
    label: 'Discord webhook',
    blurb: 'Post into a channel via webhook',
    n8nName: 'Discord',
    category: 'notify',
    glyph: '◈',
    fields: [
      { key: 'content', label: 'Message', type: 'template', default: '{{ $json.title }}', max: 2000, required: true },
      { key: 'username', label: 'Post as', type: 'text', default: '', max: 80, placeholder: 'Optional bot name override' },
    ],
  },
  email: {
    label: 'Send email (SMTP)',
    blurb: 'Plain-text email through your SMTP',
    n8nName: 'Send Email',
    category: 'notify',
    glyph: '✉',
    fields: [
      { key: 'from', label: 'From', type: 'text', default: 'bot@example.com', max: 200, required: true },
      { key: 'to', label: 'To', type: 'text', default: '', max: 500, required: true, placeholder: 'you@example.com, team@example.com' },
      { key: 'subject', label: 'Subject', type: 'template', default: 'New submission', max: 300, required: true },
      { key: 'text', label: 'Body', type: 'textarea', default: '{{ JSON.stringify($json, null, 2) }}', max: 4000 },
    ],
  },
  sheetsAppend: {
    label: 'Append to Google Sheets',
    blurb: 'Add the item as a new row',
    n8nName: 'Google Sheets',
    category: 'store',
    glyph: '▦',
    fields: [
      { key: 'documentUrl', label: 'Spreadsheet URL', type: 'url', default: '', max: 500, required: true, placeholder: 'https://docs.google.com/spreadsheets/d/…' },
      { key: 'sheetName', label: 'Sheet (tab) name', type: 'text', default: 'Sheet1', max: 100, required: true, help: 'Columns are matched to field names automatically.' },
    ],
  },
  postgres: {
    label: 'Write to Postgres',
    blurb: 'Insert the item as a row',
    n8nName: 'Postgres',
    category: 'store',
    glyph: '⛁',
    fields: [
      { key: 'schema', label: 'Schema', type: 'text', default: 'public', max: 63, required: true },
      { key: 'table', label: 'Table', type: 'text', default: 'events', max: 63, required: true, help: 'Field names must match column names — add a Set step first if not.' },
    ],
  },
};

export const TRIGGER_ORDER: TriggerKind[] = ['schedule', 'webhook', 'rss', 'form', 'sheetsRow'];
export const STEP_ORDER: StepKind[] = ['http', 'filter', 'set', 'wait', 'merge', 'telegram', 'slack', 'discord', 'email', 'sheetsAppend', 'postgres'];

export function defaultParams(def: NodeDef): Params {
  const p: Params = {};
  for (const f of def.fields) {
    p[f.key] = Array.isArray(f.default) ? f.default.map((x) => ({ ...x })) as Params[string] : f.default;
  }
  return p;
}
