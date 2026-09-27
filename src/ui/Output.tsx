import { useMemo, useState } from 'preact/hooks';
import { credentialsNeeded, toN8n, validateWorkflowShape } from '../lib/n8n';
import { toMermaid, toText } from '../lib/summary';
import type { Issue } from '../lib/state';
import type { FlowState } from '../lib/types';

type Tab = 'n8n' | 'mermaid' | 'text';

const TABS: { id: Tab; label: string }[] = [
  { id: 'n8n', label: 'n8n JSON' },
  { id: 'mermaid', label: 'Mermaid' },
  { id: 'text', label: 'Text' },
];

async function copy(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Older browsers / insecure contexts: fall back to a hidden textarea.
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  }
}

export const slugify = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'workflow';

export function Output({ flow, issues, onStatus }: { flow: FlowState; issues: Issue[]; onStatus: (msg: string) => void }) {
  const [tab, setTab] = useState<Tab>('n8n');
  const errors = issues.filter((i) => i.level === 'error');

  const built = useMemo(() => {
    const wf = toN8n(flow);
    const shape = validateWorkflowShape(wf);
    return { json: JSON.stringify(wf, null, 2), shape, mermaid: toMermaid(flow), text: toText(flow), creds: credentialsNeeded(flow) };
  }, [flow]);

  const blocked = errors.length > 0 || built.shape.length > 0;
  const body = tab === 'n8n' ? built.json : tab === 'mermaid' ? built.mermaid : built.text;

  const download = () => {
    const ext = tab === 'n8n' ? 'json' : tab === 'mermaid' ? 'mmd' : 'txt';
    const type = tab === 'n8n' ? 'application/json' : 'text/plain';
    const url = URL.createObjectURL(new Blob([body], { type }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `${slugify(flow.name)}.${ext}`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    onStatus(`Downloaded ${a.download}`);
  };

  return (
    <section class="panel output" aria-labelledby="out-h">
      <div class="panel__head">
        <h2 class="kicker" id="out-h">
          <span class="num">03</span> Export
        </h2>
        <div class="tabs" role="tablist" aria-label="Export format">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              id={`tab-${t.id}`}
              aria-selected={tab === t.id}
              aria-controls="out-body"
              tabIndex={tab === t.id ? 0 : -1}
              class={`tab${tab === t.id ? ' is-on' : ''}`}
              onClick={() => setTab(t.id)}
              onKeyDown={(e) => {
                const i = TABS.findIndex((x) => x.id === tab);
                const next = e.key === 'ArrowRight' ? (i + 1) % TABS.length : e.key === 'ArrowLeft' ? (i + TABS.length - 1) % TABS.length : -1;
                if (next >= 0) {
                  setTab(TABS[next].id);
                  document.getElementById(`tab-${TABS[next].id}`)?.focus();
                }
              }}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {blocked ? (
        <div class="blocked" role="status">
          <p class="blocked__title">Fix {errors.length || built.shape.length} {errors.length + built.shape.length === 1 ? 'problem' : 'problems'} to export</p>
          <ul>
            {(errors.length ? errors.map((e) => e.message) : built.shape).slice(0, 4).map((m) => (
              <li key={m}>{m}</li>
            ))}
          </ul>
        </div>
      ) : (
        <>
          <div class="actions">
            <button type="button" class="btn btn--primary" onClick={download}>
              <span>Download .{tab === 'n8n' ? 'json' : tab === 'mermaid' ? 'mmd' : 'txt'}</span>
              <span aria-hidden="true">↓</span>
            </button>
            <button type="button" class="btn" onClick={async () => onStatus((await copy(body)) ? 'Copied to clipboard' : 'Copy failed — select the text and copy it manually')}>
              <span>Copy</span>
              <span aria-hidden="true">⧉</span>
            </button>
            <button type="button" class="btn" onClick={async () => onStatus((await copy(location.href)) ? 'Share link copied' : 'Copy failed — copy the address bar instead')}>
              <span>Share link</span>
              <span aria-hidden="true">↗</span>
            </button>
          </div>
          <pre class="code" id="out-body" role="tabpanel" aria-labelledby={`tab-${tab}`} tabIndex={0}>
            <code>{body}</code>
          </pre>
        </>
      )}

      {tab === 'n8n' ? (
        <ol class="howto">
          <li>
            In n8n, create a new workflow, open the <b>⋯</b> menu top-right and choose <b>Import from File…</b> — or just paste the copied JSON onto the canvas.
          </li>
          <li>
            {built.creds.length ? (
              <>
                Open each node flagged red and pick or create its credential: <b>{built.creds.join(', ')}</b>.
              </>
            ) : (
              <>No credentials needed — nothing to connect.</>
            )}
          </li>
          <li>Fill any fields left blank, click <b>Test workflow</b>, then switch it to <b>Active</b>.</li>
        </ol>
      ) : tab === 'mermaid' ? (
        <p class="howto howto--p">Paste into any Mermaid renderer — GitHub and GitLab markdown (```mermaid), Notion, Obsidian or mermaid.live.</p>
      ) : (
        <p class="howto howto--p">A plain-text outline for tickets, emails or a README.</p>
      )}
    </section>
  );
}
