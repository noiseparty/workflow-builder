// One-click starting points. Each is plain builder state, run through the same normaliser as
// a shared link, so a template can never be something the builder itself could not produce.

import { normalizeFlow } from './state';
import type { FlowState } from './types';

export interface Template {
  id: string;
  title: string;
  blurb: string;
  flow: FlowState;
}

const raw: { id: string; title: string; blurb: string; flow: unknown }[] = [
  {
    id: 'crypto',
    title: 'Daily crypto price → Telegram',
    blurb: 'CoinGecko at 09:00, straight to your phone',
    flow: {
      name: 'Daily crypto price to Telegram',
      trigger: { kind: 'schedule', p: { mode: 'daily', time: '09:00' } },
      steps: [
        { kind: 'http', p: { method: 'GET', url: 'https://api.coingecko.com/api/v3/simple/price?ids=bitcoin,ethereum&vs_currencies=usd' } },
        { kind: 'telegram', p: { chatId: '', text: 'BTC ${{ $json.bitcoin.usd }} · ETH ${{ $json.ethereum.usd }}', parseMode: 'none' } },
      ],
    },
  },
  {
    id: 'rss',
    title: 'RSS → Discord',
    blurb: 'Every new Hacker News front-page story',
    flow: {
      name: 'RSS to Discord',
      trigger: { kind: 'rss', p: { feedUrl: 'https://hnrss.org/frontpage', poll: '15' } },
      steps: [{ kind: 'discord', p: { content: '**{{ $json.title }}**\n{{ $json.link }}', username: 'HN bot' } }],
    },
  },
  {
    id: 'form',
    title: 'Form → Sheets + email',
    blurb: 'Log every enquiry and ping the inbox',
    flow: {
      name: 'Contact form to Sheets and email',
      trigger: {
        kind: 'form',
        p: {
          title: 'Contact us',
          description: 'We reply within one working day.',
          fields: [
            { label: 'Name', type: 'text', required: true },
            { label: 'Email', type: 'email', required: true },
            { label: 'Message', type: 'textarea', required: false },
          ],
        },
      },
      steps: [
        { kind: 'set', p: { assignments: [{ name: 'receivedAt', value: '{{ $now.toISO() }}', type: 'string' }], keepOthers: true } },
        { kind: 'sheetsAppend', p: { documentUrl: 'https://docs.google.com/spreadsheets/d/YOUR_SHEET_ID/edit#gid=0', sheetName: 'Enquiries' } },
        { kind: 'email', p: { from: 'forms@example.com', to: 'you@example.com', subject: 'New enquiry from {{ $json.Name }}', text: '{{ $json.Name }} <{{ $json.Email }}> wrote:\n\n{{ $json.Message }}' } },
      ],
    },
  },
  {
    id: 'orders',
    title: 'Webhook → filter → Slack',
    blurb: 'Shout about orders over €500 only',
    flow: {
      name: 'Big orders to Slack',
      trigger: { kind: 'webhook', p: { method: 'POST', path: 'orders' } },
      steps: [
        { kind: 'filter', p: { field: 'body.total', operator: 'num_gt', value: '500' } },
        { kind: 'slack', p: { channel: '#sales', text: ':tada: Order {{ $json.body.id }} for €{{ $json.body.total }}' } },
      ],
    },
  },
  {
    id: 'uptime',
    title: 'Uptime check every 5 min',
    blurb: 'Alert the moment a site stops answering 200',
    flow: {
      name: 'Uptime check with alert',
      trigger: { kind: 'schedule', p: { mode: 'minutes', every: '5' } },
      steps: [
        { kind: 'http', p: { method: 'GET', url: 'https://example.com/', keepGoing: true } },
        { kind: 'filter', p: { field: 'statusCode', operator: 'num_ne', value: '200' } },
        { kind: 'telegram', p: { chatId: '', text: '⚠️ example.com answered {{ $json.statusCode || "no response" }} at {{ $now.toFormat("HH:mm") }}' } },
      ],
    },
  },
  {
    id: 'enrich',
    title: 'Sheet row → enrich → Postgres',
    blurb: 'Look each new name up, then store both',
    flow: {
      name: 'Enrich new sheet rows into Postgres',
      trigger: { kind: 'sheetsRow', p: { documentUrl: 'https://docs.google.com/spreadsheets/d/YOUR_SHEET_ID/edit#gid=0', poll: '15' } },
      steps: [
        { kind: 'http', p: { method: 'GET', url: 'https://api.agify.io/?name={{ encodeURIComponent($json.name) }}' } },
        { kind: 'merge', p: { mode: 'combineByPosition' } },
        { kind: 'postgres', p: { schema: 'public', table: 'people' } },
      ],
    },
  },
];

export const TEMPLATES: Template[] = raw.map((t) => ({ ...t, flow: normalizeFlow(t.flow) }));
