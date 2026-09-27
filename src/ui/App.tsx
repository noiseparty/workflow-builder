import { useCallback, useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { STEPS, STEP_ORDER, TRIGGERS, TRIGGER_ORDER, defaultParams } from '../lib/catalog';
import { buildGraph } from '../lib/graph';
import { decodeFlow, emptyFlow, encodeFlow, findIssues, type Issue } from '../lib/state';
import { summarize } from '../lib/summary';
import { TEMPLATES } from '../lib/templates';
import { MAX_STEPS, type FlowState, type ParamValue, type StepKind, type TriggerKind } from '../lib/types';
import { Canvas } from './Canvas';
import { NodeForm } from './Fields';
import { Output } from './Output';

const PORTFOLIO = 'https://www.skabene.id.lv/';
const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x));
const nn = (i: number) => String(i).padStart(2, '0');

type Open = 'trigger' | number | null;

function initial(): { flow: FlowState; error: string | null } {
  const m = /^#f=(.*)$/.exec(location.hash);
  if (!m) return { flow: emptyFlow(), error: null };
  try {
    return { flow: decodeFlow(m[1]), error: null };
  } catch (e) {
    return { flow: emptyFlow(), error: `${(e as Error).message} Starting from a blank workflow instead.` };
  }
}

export function App() {
  const init = useMemo(initial, []);
  const [flow, setFlow] = useState<FlowState>(init.flow);
  const [loadError, setLoadError] = useState<string | null>(init.error);
  const [open, setOpen] = useState<Open>(init.flow.steps.length ? null : 'trigger');
  const [sample, setSample] = useState<string | null>(null);
  const [status, setStatus] = useState('');
  const statusTimer = useRef<number>();
  const pickerRef = useRef<HTMLDivElement>(null);

  const say = useCallback((msg: string) => {
    setStatus(msg);
    clearTimeout(statusTimer.current);
    statusTimer.current = window.setTimeout(() => setStatus(''), 2600);
  }, []);

  // The share link is the builder state itself, kept in the hash (never sent to the server).
  useEffect(() => {
    const t = setTimeout(() => history.replaceState(null, '', `#f=${encodeFlow(flow)}`), 200);
    return () => clearTimeout(t);
  }, [flow]);

  useEffect(() => {
    const onHash = () => {
      const m = /^#f=(.*)$/.exec(location.hash);
      if (!m || m[1] === encodeFlow(flow)) return;
      try {
        setFlow(decodeFlow(m[1]));
        setLoadError(null);
      } catch (e) {
        setLoadError(`${(e as Error).message} Your current workflow was kept.`);
      }
    };
    addEventListener('hashchange', onHash);
    return () => removeEventListener('hashchange', onHash);
  }, [flow]);

  const issues = useMemo(() => findIssues(flow), [flow]);
  const graph = useMemo(() => buildGraph(flow), [flow]);
  const summary = useMemo(() => summarize(flow), [flow]);

  const edit = (fn: (f: FlowState) => void) => {
    setFlow((prev) => {
      const next = clone(prev);
      fn(next);
      return next;
    });
    setSample(null);
  };

  const issuesAt = (at: Issue['at']) => issues.filter((i) => i.at === at);
  const countAt = (index: number) => {
    const list = issuesAt(index < 0 ? 'trigger' : index);
    return { errors: list.filter((i) => i.level === 'error').length, warnings: list.filter((i) => i.level === 'warning').length };
  };

  const focusCard = (o: Open) => {
    setOpen(o);
    requestAnimationFrame(() => {
      const el = document.getElementById(`card-${o}`);
      if (!el) return;
      el.scrollIntoView({ block: 'nearest', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
      (el.querySelector('.card__toggle') as HTMLElement | null)?.focus({ preventScroll: true });
    });
  };

  const loadSample = (id: string) => {
    const t = TEMPLATES.find((x) => x.id === id)!;
    setFlow(clone(t.flow));
    setSample(id);
    setOpen(null);
    setLoadError(null);
    say(`Loaded sample: ${t.title}`);
  };

  const addStep = (kind: StepKind) => {
    if (flow.steps.length >= MAX_STEPS) return;
    const index = flow.steps.length;
    edit((f) => f.steps.push({ kind, p: defaultParams(STEPS[kind]) }));
    focusCard(index);
    say(`Added step ${index + 1}: ${STEPS[kind].label}`);
  };

  const moveStep = (i: number, d: -1 | 1) => {
    edit((f) => {
      const [s] = f.steps.splice(i, 1);
      f.steps.splice(i + d, 0, s);
    });
    setOpen(i + d);
    say(`Moved step to position ${i + d + 1}`);
  };

  const removeStep = (i: number) => {
    const label = STEPS[flow.steps[i].kind].label;
    edit((f) => f.steps.splice(i, 1));
    setOpen(null);
    say(`Removed ${label}`);
  };

  const errorCount = issues.filter((i) => i.level === 'error').length;
  const warnings = issues.filter((i) => i.level === 'warning');

  return (
    <div class="page">
      <div class="grain" aria-hidden="true" />
      <a class="skip" href="#builder">
        Skip to the builder
      </a>

      <header class="topbar">
        <a class="brand" href={PORTFOLIO}>
          <span class="brand__name">Cosmic</span>
          <span class="brand__role">/ Demo</span>
        </a>
        <a class="topbar__back" href={`${PORTFOLIO}#work`}>
          ← All work
        </a>
      </header>

      <main>
        <section class="hero" aria-labelledby="title">
          <p class="kicker hero__kicker">
            <i aria-hidden="true" />
            Demo 05 / Automation &amp; workflows
          </p>
          <h1 id="title" class="display">
            Flow builder
          </h1>
          <p class="lead">Describe an automation in a few clicks and download a ready-to-import n8n workflow — built deterministically in your browser, no AI and no sign-up.</p>
        </section>

        <section class="samples" aria-labelledby="samples-h">
          <h2 class="kicker" id="samples-h">
            Try a sample
          </h2>
          <div class="chips">
            {TEMPLATES.map((t) => (
              <button type="button" key={t.id} class={`chip${sample === t.id ? ' is-on' : ''}`} aria-pressed={sample === t.id} onClick={() => loadSample(t.id)}>
                <span class="chip__t">{t.title}</span>
                <span class="chip__b">{t.blurb}</span>
              </button>
            ))}
            <button
              type="button"
              class="chip chip--blank"
              onClick={() => {
                setFlow(emptyFlow());
                setSample(null);
                setOpen('trigger');
                say('Started a blank workflow');
              }}
            >
              <span class="chip__t">Start blank</span>
              <span class="chip__b">Pick your own trigger</span>
            </button>
          </div>
        </section>

        {loadError && (
          <div class="banner" role="alert">
            <span>{loadError}</span>
            <button type="button" class="icon-btn" aria-label="Dismiss" onClick={() => setLoadError(null)}>
              ×
            </button>
          </div>
        )}

        <div class="bench" id="builder">
          {/* ---------------------------------------------------------------- builder */}
          <section class="panel builder" aria-labelledby="build-h">
            <div class="panel__head">
              <h2 class="kicker" id="build-h">
                <span class="num">01</span> Build
              </h2>
              <span class="count">
                {flow.steps.length}/{MAX_STEPS} steps
              </span>
            </div>

            <div class="field field--wide name-field">
              <label class="lbl" for="wf-name">
                Workflow name
              </label>
              <input id="wf-name" class="input" value={flow.name} maxLength={80} onInput={(e) => edit((f) => (f.name = (e.currentTarget as HTMLInputElement).value))} />
            </div>

            <ol class="cards">
              <li class={`card card--trigger${open === 'trigger' ? ' is-open' : ''}`} id="card-trigger">
                <div class="card__head">
                  <button type="button" class="card__toggle" aria-expanded={open === 'trigger'} aria-controls="card-trigger-body" onClick={() => setOpen(open === 'trigger' ? null : 'trigger')}>
                    <span class="card__num">When</span>
                    <span class="card__title">{TRIGGERS[flow.trigger.kind].label}</span>
                    <span class="card__detail">{graph.nodes[0].detail}</span>
                    <Badge counts={countAt(-1)} />
                  </button>
                </div>
                {open === 'trigger' && (
                  <div class="card__body" id="card-trigger-body">
                    <fieldset class="kinds">
                      <legend class="lbl">Trigger</legend>
                      <div class="kinds__grid">
                      {TRIGGER_ORDER.map((k) => (
                        <label class={`kind${flow.trigger.kind === k ? ' is-on' : ''}`} key={k}>
                          <input
                            type="radio"
                            name="trigger-kind"
                            value={k}
                            checked={flow.trigger.kind === k}
                            onChange={() => edit((f) => (f.trigger = { kind: k as TriggerKind, p: defaultParams(TRIGGERS[k]) }))}
                          />
                          <span class="kind__g" aria-hidden="true">
                            {TRIGGERS[k].glyph}
                          </span>
                          <span class="kind__t">{TRIGGERS[k].label}</span>
                          <span class="kind__b">{TRIGGERS[k].blurb}</span>
                        </label>
                      ))}
                      </div>
                    </fieldset>
                    <NodeForm
                      def={TRIGGERS[flow.trigger.kind]}
                      p={flow.trigger.p}
                      idPrefix="trigger"
                      issues={issuesAt('trigger')}
                      onChange={(key, v: ParamValue) => edit((f) => (f.trigger.p[key] = v))}
                    />
                  </div>
                )}
              </li>

              {flow.steps.map((s, i) => {
                const def = STEPS[s.kind];
                const isOpen = open === i;
                return (
                  <li class={`card${isOpen ? ' is-open' : ''}`} id={`card-${i}`} key={`${i}-${s.kind}`}>
                    <div class="card__head">
                      <button type="button" class="card__toggle" aria-expanded={isOpen} aria-controls={`card-${i}-body`} onClick={() => setOpen(isOpen ? null : i)}>
                        <span class="card__num">{nn(i + 1)}</span>
                        <span class="card__title">{def.label}</span>
                        <span class="card__detail">{graph.nodes[i + 1].detail}</span>
                        <Badge counts={countAt(i)} />
                      </button>
                      <div class="card__tools">
                        <button type="button" class="icon-btn" aria-label={`Move step ${i + 1} up`} disabled={i === 0} onClick={() => moveStep(i, -1)}>
                          ↑
                        </button>
                        <button type="button" class="icon-btn" aria-label={`Move step ${i + 1} down`} disabled={i === flow.steps.length - 1} onClick={() => moveStep(i, 1)}>
                          ↓
                        </button>
                        <button type="button" class="icon-btn icon-btn--danger" aria-label={`Remove step ${i + 1}, ${def.label}`} onClick={() => removeStep(i)}>
                          ×
                        </button>
                      </div>
                    </div>
                    {isOpen && (
                      <div class="card__body" id={`card-${i}-body`}>
                        <NodeForm def={def} p={s.p} idPrefix={`step${i}`} issues={issuesAt(i)} onChange={(key, v) => edit((f) => (f.steps[i].p[key] = v))} />
                      </div>
                    )}
                  </li>
                );
              })}
            </ol>

            {flow.steps.length < MAX_STEPS ? (
              <div class="picker" ref={pickerRef} role="group" aria-labelledby="picker-h">
                <p class="lbl" id="picker-h">
                  {flow.steps.length === 0 ? 'Then — add your first step' : 'Add a step'}
                </p>
                <div class="picker__grid">
                  {STEP_ORDER.map((k) => (
                    <button type="button" key={k} class={`pick pick--${STEPS[k].category}`} onClick={() => addStep(k)}>
                      <span class="pick__g" aria-hidden="true">
                        {STEPS[k].glyph}
                      </span>
                      <span class="pick__t">{STEPS[k].label}</span>
                      <span class="pick__b">{STEPS[k].blurb}</span>
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <p class="full">Five steps is the limit for this demo — remove one to add another.</p>
            )}
          </section>

          <div class="stack">
            {/* ---------------------------------------------------------------- preview */}
            <section class="panel preview" aria-labelledby="prev-h">
              <div class="panel__head">
                <h2 class="kicker" id="prev-h">
                  <span class="num">02</span> Preview
                </h2>
                <span class={`count${errorCount ? ' count--err' : ''}`}>{errorCount ? `${errorCount} to fix` : warnings.length ? `${warnings.length} note${warnings.length > 1 ? 's' : ''}` : 'Ready'}</span>
              </div>
              <Canvas
                graph={graph}
                selected={open}
                issueCount={countAt}
                canAdd={flow.steps.length < MAX_STEPS}
                onSelect={(index) => focusCard(index < 0 ? 'trigger' : index)}
                onAdd={() => {
                  pickerRef.current?.scrollIntoView({ block: 'nearest', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
                  (pickerRef.current?.querySelector('button') as HTMLButtonElement | null)?.focus({ preventScroll: true });
                }}
              />
              <div class="summary">
                <p class="summary__when">
                  <b>When</b> {summary.when}
                </p>
                {summary.then.length > 0 ? (
                  <ol class="summary__then">
                    {summary.then.map((s, i) => (
                      <li key={i}>
                        <span class="summary__n">{nn(i + 1)}</span> {s}
                      </li>
                    ))}
                  </ol>
                ) : (
                  <p class="empty">Nothing happens yet — add a step, or load a sample above.</p>
                )}
                {warnings.length > 0 && (
                  <ul class="notes">
                    {warnings.map((w) => (
                      <li key={`${w.at}-${w.field}-${w.message}`}>
                        <span class="notes__at">{w.at === 'trigger' ? 'Trigger' : w.at === 'flow' ? 'Flow' : `Step ${nn(Number(w.at) + 1)}`}</span> {w.message}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </section>

            <Output flow={flow} issues={issues} onStatus={say} />
          </div>
        </div>

        <section class="how" aria-labelledby="how-h">
          <h2 class="kicker" id="how-h">
            <i aria-hidden="true" />
            How it works
          </h2>
          <ol class="how__grid">
            <li>
              <span class="how__n">01</span>
              <h3>A curated catalogue</h3>
              <p>Five triggers and eleven steps, each mapped to a real n8n node. Your choices live in one small, typed state object — nothing else.</p>
            </li>
            <li>
              <span class="how__n">02</span>
              <h3>A pure compiler</h3>
              <p>One function turns that state into n8n’s JSON: node type ids and typeVersions taken from n8n’s source, a connections map, positions, and credential placeholders. Ids are hashed from the state, so the same flow gives byte-identical output.</p>
            </li>
            <li>
              <span class="how__n">03</span>
              <h3>Checked before export</h3>
              <p>Cron fields, URLs, JSON bodies and field paths are validated as you type, and a shape check confirms every connection points at a real, uniquely named node.</p>
            </li>
            <li>
              <span class="how__n">04</span>
              <h3>No server in the loop</h3>
              <p>No AI, no account, no upload. The whole build is encoded in the URL, so a shared link reproduces it exactly. The server only ships static files.</p>
            </li>
          </ol>
        </section>
      </main>

      <footer class="foot">
        <span>Built by Cosmic · Riga</span>
        <a href={`${PORTFOLIO}#contact`}>Want one for your team? Get in touch →</a>
      </footer>

      <div class={`toast${status ? ' is-on' : ''}`} role="status" aria-live="polite">
        {status}
      </div>
    </div>
  );
}

function Badge({ counts }: { counts: { errors: number; warnings: number } }) {
  if (counts.errors) return <span class="badge badge--err">{counts.errors} to fix</span>;
  if (counts.warnings) return <span class="badge badge--warn">{counts.warnings} note{counts.warnings > 1 ? 's' : ''}</span>;
  return null;
}
