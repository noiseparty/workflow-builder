// The live plain-English description, and the Mermaid / text exports.

import { buildGraph, filterWords, pollWords, scheduleParams, sheetGid } from './graph';
import { describeSchedule } from './cron';
import type { AssignmentItem, FlowState, FormFieldItem, Params, StepKind } from './types';

const q = (s: unknown) => `“${String(s).trim() || '…'}”`;
const clip = (s: string, n = 60) => {
  const one = s.replace(/\s+/g, ' ').trim();
  return one.length > n ? one.slice(0, n - 1) + '…' : one;
};

export function triggerSentence(flow: FlowState): string {
  const p = flow.trigger.p;
  switch (flow.trigger.kind) {
    case 'schedule':
      return `Runs ${describeSchedule(scheduleParams(p))} (in your n8n instance’s timezone).`;
    case 'webhook':
      return `Runs whenever something sends an HTTP ${p.method} to <your n8n>/webhook/${String(p.path).trim() || '…'}.`;
    case 'rss':
      return `Checks ${String(p.feedUrl).trim() || 'the feed'} ${pollWords(String(p.poll))} and runs once per new item.`;
    case 'form': {
      const fields = (p.fields as FormFieldItem[]).map((f) => f.label.trim() || '?');
      return `Publishes a form called ${q(p.title)} asking for ${listJoin(fields)}, and runs on every submission.`;
    }
    case 'sheetsRow':
      return `Checks the Google Sheet (tab gid=${sheetGid(String(p.documentUrl))}) ${pollWords(String(p.poll))} and runs once per new row.`;
  }
}

function listJoin(xs: string[]): string {
  if (xs.length <= 1) return xs.join('');
  return `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`;
}

export function stepSentence(kind: StepKind, p: Params): string {
  switch (kind) {
    case 'http':
      return `Sends an HTTP ${p.method} to ${String(p.url).trim() || '(no URL yet)'}${p.keepGoing ? ', carrying on even if it fails so the status code can be checked' : ''}.`;
    case 'filter':
      return `Only continues if ${filterWords(p)}; otherwise this run stops here.`;
    case 'set': {
      const names = (p.assignments as AssignmentItem[]).map((a) => a.name.trim() || '?');
      return `Sets ${names.length ? listJoin(names) : 'no fields'}${p.keepOthers ? ', keeping everything else' : ' and drops all other fields'}.`;
    }
    case 'wait':
      return `Waits ${p.amount} ${Number(p.amount) === 1 ? String(p.unit).replace(/s$/, '') : p.unit}.`;
    case 'merge':
      return p.mode === 'append' ? 'Appends the original trigger item after the previous step’s results.' : 'Combines each result with the original trigger item, side by side.';
    case 'telegram':
      return `Messages Telegram chat ${String(p.chatId).trim() || '(chat ID to fill in)'}: ${q(clip(String(p.text)))}.`;
    case 'slack':
      return `Posts to Slack ${String(p.channel).trim() || '(channel to fill in)'}: ${q(clip(String(p.text)))}.`;
    case 'discord':
      return `Posts to Discord via webhook${String(p.username).trim() ? ` as ${p.username}` : ''}: ${q(clip(String(p.content)))}.`;
    case 'email':
      return `Emails ${String(p.to).trim() || '(recipient to fill in)'} with the subject ${q(clip(String(p.subject)))}.`;
    case 'sheetsAppend':
      return `Appends a row to the ${q(p.sheetName)} tab of the Google Sheet, matching columns by field name.`;
    case 'postgres':
      return `Inserts a row into Postgres table ${String(p.schema).trim()}.${String(p.table).trim() || '…'}, matching columns by field name.`;
  }
}

export function summarize(flow: FlowState): { when: string; then: string[] } {
  return { when: triggerSentence(flow), then: flow.steps.map((s) => stepSentence(s.kind, s.p)) };
}

// ---- Mermaid ---------------------------------------------------------------------------

/** Mermaid labels are quoted; quotes, brackets and angle brackets inside must be entities. */
const mm = (s: string) => s.replace(/"/g, '#quot;').replace(/</g, '#lt;').replace(/>/g, '#gt;').replace(/[\r\n]+/g, ' ');

export function toMermaid(flow: FlowState): string {
  const g = buildGraph(flow);
  const lines = ['flowchart LR'];
  g.nodes.forEach((n, i) => {
    const label = `${mm(n.name)}<br/><small>${mm(n.detail)}</small>`;
    lines.push(n.kind === 'filter' ? `  n${i}{"${label}"}` : i === 0 ? `  n${i}(["${label}"])` : `  n${i}["${label}"]`);
  });
  for (const e of g.edges) {
    const label = e.label ?? (e.toInput === 1 ? 'input 2' : undefined);
    lines.push(label ? `  n${e.from} -- ${label} --> n${e.to}` : `  n${e.from} --> n${e.to}`);
  }
  g.deadEnds.forEach((d, k) => {
    lines.push(`  stop${k}(("stop"))`);
    lines.push(`  n${d.from} -. false .-> stop${k}`);
  });
  return lines.join('\n') + '\n';
}

// ---- plain text ------------------------------------------------------------------------

export function toText(flow: FlowState): string {
  const g = buildGraph(flow);
  const { when, then } = summarize(flow);
  const out: string[] = [`${flow.name}`, '='.repeat(Math.min(60, flow.name.length || 1)), ''];
  g.nodes.forEach((n, i) => {
    out.push(`[${i === 0 ? 'TRIGGER' : String(i).padStart(2, '0')}] ${n.name} — ${n.detail}`);
    out.push(`     ${i === 0 ? when : then[i - 1]}`);
    const isMerge = n.kind === 'merge';
    if (isMerge) out.push('     ↑ input 2 comes straight from the trigger');
    if (i < g.nodes.length - 1) {
      out.push(n.kind === 'filter' ? '   │ true            (false → stop)' : '   │');
      out.push('   ▼');
    }
  });
  return out.join('\n') + '\n';
}
