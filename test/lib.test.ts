import { describe, expect, it } from 'vitest';
import { describeCron, scheduleToCron, validateCron } from '../src/lib/cron';
import { NODE_TYPES, toN8n, validateWorkflowShape, stableUuid, credentialsNeeded } from '../src/lib/n8n';
import { decodeFlow, encodeFlow, findIssues, normalizeFlow } from '../src/lib/state';
import { TEMPLATES } from '../src/lib/templates';
import { toMermaid, toText, summarize } from '../src/lib/summary';
import { STEP_ORDER, STEPS, TRIGGERS, TRIGGER_ORDER, defaultParams } from '../src/lib/catalog';
import type { FlowState } from '../src/lib/types';

const flowOf = (trigger: FlowState['trigger']['kind'], steps: FlowState['steps'][number]['kind'][]): FlowState =>
  normalizeFlow({ name: 'T', trigger: { kind: trigger, p: defaultParams(TRIGGERS[trigger]) }, steps: steps.map((k) => ({ kind: k, p: defaultParams(STEPS[k]) })) });

describe('cron', () => {
  it('compiles the human picker', () => {
    const base = { every: 5, minute: 0, time: '09:30', weekday: 1, dayOfMonth: 15, cron: '' };
    expect(scheduleToCron({ ...base, mode: 'minutes', every: 15 })).toBe('*/15 * * * *');
    expect(scheduleToCron({ ...base, mode: 'hourly', minute: 7 })).toBe('7 * * * *');
    expect(scheduleToCron({ ...base, mode: 'daily' })).toBe('30 9 * * *');
    expect(scheduleToCron({ ...base, mode: 'weekdays' })).toBe('30 9 * * 1-5');
    expect(scheduleToCron({ ...base, mode: 'weekly', weekday: 0 })).toBe('30 9 * * 0');
    expect(scheduleToCron({ ...base, mode: 'monthly' })).toBe('30 9 15 * *');
  });

  it('accepts valid and rejects invalid expressions with a reason', () => {
    for (const ok of ['* * * * *', '*/5 * * * *', '0 9 * * 1-5', '0 0 1,15 * *', '30 8 * JAN-MAR MON', '0 */2 * * *']) expect(validateCron(ok)).toBeNull();
    expect(validateCron('')).toMatch(/Enter/);
    expect(validateCron('* * * *')).toMatch(/5 parts/);
    expect(validateCron('60 * * * *')).toMatch(/minute/);
    expect(validateCron('0 24 * * *')).toMatch(/hour/);
    expect(validateCron('0 9 * * 5-1')).toMatch(/backwards/);
    expect(validateCron('*/0 * * * *')).toMatch(/positive/);
    expect(validateCron('0 9 * * FOO')).toMatch(/day of week/);
  });

  it('describes common shapes in words', () => {
    expect(describeCron('*/10 * * * *')).toBe('every 10 minutes');
    expect(describeCron('0 9 * * 1-5')).toBe('every weekday (Mon–Fri) at 09:00');
    expect(describeCron('15 18 * * 5')).toBe('every Friday at 18:15');
    expect(describeCron('0 7 1 * *')).toBe('on the 1st of every month at 07:00');
    expect(describeCron('5 4 3 2 1')).toBe('on the cron schedule "5 4 3 2 1"');
  });
});

describe('n8n export', () => {
  it('produces a valid shape for every template', () => {
    for (const t of TEMPLATES) {
      const wf = toN8n(t.flow);
      expect(validateWorkflowShape(wf), t.id).toEqual([]);
      expect(wf.nodes).toHaveLength(t.flow.steps.length + 1);
    }
  });

  it('produces a valid shape for every trigger × every step, including duplicates', () => {
    for (const trig of TRIGGER_ORDER) {
      for (const step of STEP_ORDER) {
        const wf = toN8n(flowOf(trig, ['http', step, step]));
        expect(validateWorkflowShape(wf), `${trig}/${step}`).toEqual([]);
        const names = wf.nodes.map((n) => n.name);
        expect(new Set(names).size).toBe(names.length);
        wf.nodes.forEach((n) => expect(n.position.every(Number.isFinite)).toBe(true));
      }
    }
  });

  it('uses real node type ids and suffixes duplicate names the way n8n does', () => {
    const wf = toN8n(flowOf('webhook', ['http', 'http', 'slack']));
    expect(wf.nodes.map((n) => n.name)).toEqual(['Webhook', 'HTTP Request', 'HTTP Request1', 'Slack']);
    expect(wf.nodes.map((n) => n.type)).toEqual(['n8n-nodes-base.webhook', 'n8n-nodes-base.httpRequest', 'n8n-nodes-base.httpRequest', 'n8n-nodes-base.slack']);
    expect(wf.nodes[0].webhookId).toMatch(/^[0-9a-f-]{36}$/);
    expect(wf.connections['Webhook'].main[0]).toEqual([{ node: 'HTTP Request', type: 'main', index: 0 }]);
    expect(Object.values(NODE_TYPES).every((t) => t.type.startsWith('n8n-nodes-base.'))).toBe(true);
  });

  it('wires IF true output onward and leaves the false output empty', () => {
    const wf = toN8n(flowOf('schedule', ['filter', 'telegram']));
    expect(wf.connections['If'].main).toEqual([[{ node: 'Telegram', type: 'main', index: 0 }], []]);
    const cond = (wf.nodes[1].parameters as any).conditions.conditions[0];
    expect(cond.leftValue).toBe('={{ $json.price }}');
    expect(cond.rightValue).toBe(100);
    expect(cond.operator).toEqual({ type: 'number', operation: 'gt' });
  });

  it('feeds Merge input 2 straight from the trigger', () => {
    const wf = toN8n(flowOf('webhook', ['http', 'merge', 'postgres']));
    expect(wf.connections['Webhook'].main[0]).toEqual([
      { node: 'HTTP Request', type: 'main', index: 0 },
      { node: 'Merge', type: 'main', index: 1 },
    ]);
    expect(wf.connections['HTTP Request'].main[0]).toEqual([{ node: 'Merge', type: 'main', index: 0 }]);
  });

  it('leaves credentials as named placeholders and lists them', () => {
    const f = flowOf('sheetsRow', ['telegram', 'email']);
    const wf = toN8n(f);
    expect(wf.nodes[0].credentials).toEqual({ googleSheetsTriggerOAuth2Api: { id: 'REPLACE_ME_googleSheetsTriggerOAuth2Api', name: 'Google Sheets Trigger account' } });
    expect(wf.nodes[1].credentials?.telegramApi.name).toBe('Telegram account');
    expect(credentialsNeeded(f)).toEqual(['Google Sheets (OAuth2)', 'Telegram bot token', 'SMTP server login']);
  });

  it('marks templated strings as n8n expressions and only those', () => {
    const wf = toN8n(TEMPLATES.find((t) => t.id === 'crypto')!.flow);
    expect((wf.nodes[2].parameters as any).text).toMatch(/^=BTC \$\{\{ \$json\.bitcoin\.usd \}\}/);
    expect((wf.nodes[1].parameters as any).url).not.toMatch(/^=/);
  });

  it('compiles schedules to n8n rules', () => {
    const f = flowOf('schedule', ['wait']);
    expect((toN8n(f).nodes[0].parameters as any).rule.interval[0]).toEqual({ field: 'cronExpression', expression: '0 9 * * *' });
    f.trigger.p.mode = 'minutes';
    f.trigger.p.every = '15';
    expect((toN8n(f).nodes[0].parameters as any).rule.interval[0]).toEqual({ field: 'minutes', minutesInterval: 15 });
  });

  it('is deterministic', () => {
    const t = TEMPLATES[2].flow;
    expect(JSON.stringify(toN8n(t))).toBe(JSON.stringify(toN8n(structuredClone(t))));
    expect(stableUuid('a')).not.toBe(stableUuid('b'));
  });

  it('shape checker catches dangling connections and duplicate names', () => {
    const wf = toN8n(flowOf('webhook', ['http']));
    wf.connections['Webhook'].main[0].push({ node: 'Ghost', type: 'main', index: 0 });
    wf.nodes.push({ ...wf.nodes[1], id: stableUuid('x') });
    const p = validateWorkflowShape(wf);
    expect(p).toContain('connection to unknown node "Ghost"');
    expect(p).toContain('node names are not unique');
  });
});

describe('state', () => {
  it('round-trips through the share link', () => {
    for (const t of TEMPLATES) expect(decodeFlow(encodeFlow(t.flow))).toEqual(t.flow);
  });

  it('rejects damaged links in plain language', () => {
    expect(() => decodeFlow('!!!')).toThrow(/cut off or altered/);
    expect(() => decodeFlow('abc')).toThrow(/cut off or altered/);
    expect(() => decodeFlow(encodeFlow({} as FlowState).slice(0, 2))).toThrow();
    expect(() => decodeFlow('a'.repeat(20000))).toThrow(/too long/);
  });

  it('normalises hostile input back into shape', () => {
    const f = normalizeFlow({
      name: 42,
      trigger: { kind: 'evil', p: { mode: 'x' } },
      steps: [
        { kind: 'wait', p: { amount: 1e9, unit: 'years' } },
        { kind: 'nope' },
        ...Array.from({ length: 10 }, () => ({ kind: 'http', p: { url: 'x'.repeat(5000) } })),
      ],
    });
    expect(f.name).toBe('My workflow');
    expect(f.trigger.kind).toBe('schedule');
    expect(f.trigger.p.mode).toBe('daily');
    expect(f.steps).toHaveLength(5);
    expect(f.steps[0].p).toEqual({ amount: 1000, unit: 'minutes' });
    expect(String(f.steps[1].p.url).length).toBe(1000);
  });

  it('finds problems a user can act on', () => {
    const f = flowOf('schedule', []);
    expect(findIssues(f).some((i) => i.level === 'error' && /at least one step/.test(i.message))).toBe(true);
    f.trigger.p.mode = 'cron';
    f.trigger.p.cron = '61 * * * *';
    f.steps = [
      { kind: 'http', p: { ...defaultParams(STEPS.http), url: 'not a url', method: 'POST', body: '{bad' } },
      { kind: 'filter', p: { ...defaultParams(STEPS.filter), field: 'has space', value: 'abc' } },
    ];
    const msgs = findIssues(f).filter((i) => i.level === 'error').map((i) => i.message).join(' | ');
    expect(msgs).toMatch(/minute/);
    expect(msgs).toMatch(/URL is not a valid URL/);
    expect(msgs).toMatch(/JSON body is not valid JSON/);
    expect(msgs).toMatch(/no spaces or braces/);
    expect(msgs).toMatch(/not a number/);
  });

  it('templates are free of errors', () => {
    for (const t of TEMPLATES) expect(findIssues(t.flow).filter((i) => i.level === 'error'), t.id).toEqual([]);
  });
});

describe('summary and diagrams', () => {
  it('reads like English', () => {
    const s = summarize(TEMPLATES.find((t) => t.id === 'orders')!.flow);
    expect(s.when).toBe('Runs whenever something sends an HTTP POST to <your n8n>/webhook/orders.');
    expect(s.then[0]).toBe('Only continues if body.total is greater than 500; otherwise this run stops here.');
  });

  it('exports Mermaid with escaped labels and a false branch', () => {
    const m = toMermaid(TEMPLATES.find((t) => t.id === 'orders')!.flow);
    expect(m.startsWith('flowchart LR\n')).toBe(true);
    expect(m).toContain('n1 -- true --> n2');
    expect(m).toContain('n1 -. false .-> stop0');
    const withQuote = flowOf('form', ['slack']);
    withQuote.trigger.p.title = 'He said "hi" <b>';
    expect(toMermaid(withQuote)).not.toMatch(/"hi"|<b>/);
  });

  it('exports a text diagram', () => {
    const t = toText(TEMPLATES.find((x) => x.id === 'enrich')!.flow);
    expect(t).toContain('[TRIGGER] Google Sheets Trigger');
    expect(t).toContain('input 2 comes straight from the trigger');
  });
});
