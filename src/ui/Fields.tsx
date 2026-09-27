import type { FieldDef, NodeDef } from '../lib/catalog';
import type { Issue } from '../lib/state';
import type { AssignmentItem, FormFieldItem, Params, ParamValue } from '../lib/types';

interface FormProps {
  def: NodeDef;
  p: Params;
  idPrefix: string;
  issues: Issue[];
  onChange: (key: string, value: ParamValue) => void;
}

const inputValue = (e: Event) => (e.currentTarget as HTMLInputElement).value;

export function NodeForm({ def, p, idPrefix, issues, onChange }: FormProps) {
  return (
    <div class="fields">
      {def.fields.map((f) => {
        if (f.showIf && !f.showIf(p)) return null;
        const id = `${idPrefix}-${f.key}`;
        const mine = issues.filter((i) => i.field === f.key);
        const errId = mine.length ? `${id}-err` : undefined;
        const helpId = f.help ? `${id}-help` : undefined;
        const describedBy = [errId, helpId].filter(Boolean).join(' ') || undefined;
        const wide = ['textarea', 'formFields', 'assignments', 'template', 'url'].includes(f.type);
        return (
          <div class={`field${wide ? ' field--wide' : ''}${f.type === 'toggle' ? ' field--toggle' : ''}`} key={f.key}>
            {f.type === 'toggle' ? (
              <label class="toggle" for={id}>
                <input id={id} type="checkbox" checked={p[f.key] === true} aria-describedby={describedBy} onChange={(e) => onChange(f.key, (e.currentTarget as HTMLInputElement).checked)} />
                <span class="toggle__track" aria-hidden="true" />
                <span class="lbl">{f.label}</span>
              </label>
            ) : (
              <label class="lbl" for={id}>
                {f.label}
              </label>
            )}
            <Control f={f} id={id} value={p[f.key]} invalid={mine.some((i) => i.level === 'error')} describedBy={describedBy} onChange={(v) => onChange(f.key, v)} />
            {f.help && (
              <p class="help" id={helpId}>
                {f.help}
              </p>
            )}
            {mine.map((i) => (
              <p class={`msg msg--${i.level}`} id={errId} key={i.message}>
                {i.message}
              </p>
            ))}
          </div>
        );
      })}
    </div>
  );
}

interface ControlProps {
  f: FieldDef;
  id: string;
  value: ParamValue;
  invalid: boolean;
  describedBy?: string;
  onChange: (v: ParamValue) => void;
}

const pad = (n: number) => String(n).padStart(2, '0');

function Control({ f, id, value, invalid, describedBy, onChange }: ControlProps) {
  const common = { id, 'aria-invalid': invalid || undefined, 'aria-describedby': describedBy };
  switch (f.type) {
    case 'toggle':
      return null;
    case 'select':
      return (
        <div class="select">
          <select {...common} value={String(value)} onChange={(e) => onChange(inputValue(e))}>
            {f.options.map((o) => (
              <option value={o.value} key={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </div>
      );
    case 'number':
      return (
        <input
          {...common}
          class="input"
          type="number"
          inputMode="numeric"
          min={f.min}
          max={f.max}
          value={Number(value)}
          onChange={(e) => {
            const n = Number(inputValue(e));
            onChange(Number.isFinite(n) ? Math.min(f.max, Math.max(f.min, Math.round(n))) : f.default);
          }}
        />
      );
    case 'time': {
      const [h, m] = String(value).split(':').map(Number);
      const mins = Array.from({ length: 12 }, (_, i) => i * 5);
      if (!mins.includes(m)) mins.push(m), mins.sort((a, b) => a - b);
      return (
        <div class="time" role="group" aria-labelledby={undefined} aria-describedby={describedBy}>
          <div class="select">
            <select id={id} aria-label="Hour" value={h} onChange={(e) => onChange(`${pad(Number(inputValue(e)))}:${pad(m)}`)}>
              {Array.from({ length: 24 }, (_, i) => (
                <option value={i} key={i}>
                  {pad(i)}
                </option>
              ))}
            </select>
          </div>
          <span aria-hidden="true">:</span>
          <div class="select">
            <select aria-label="Minute" value={m} onChange={(e) => onChange(`${pad(h)}:${pad(Number(inputValue(e)))}`)}>
              {mins.map((i) => (
                <option value={i} key={i}>
                  {pad(i)}
                </option>
              ))}
            </select>
          </div>
        </div>
      );
    }
    case 'textarea':
      return <textarea {...common} class="input input--area" rows={4} maxLength={f.max} placeholder={f.placeholder} value={String(value)} spellcheck={false} onInput={(e) => onChange(inputValue(e))} />;
    case 'template':
      return <textarea {...common} class="input input--area input--short" rows={2} maxLength={f.max} placeholder={f.placeholder} value={String(value)} onInput={(e) => onChange(inputValue(e))} />;
    case 'formFields':
      return <FormFieldsEditor id={id} items={value as FormFieldItem[]} max={f.maxItems} onChange={onChange} />;
    case 'assignments':
      return <AssignmentsEditor id={id} items={value as AssignmentItem[]} max={f.maxItems} onChange={onChange} />;
    default:
      return (
        <input
          {...common}
          class="input"
          type={f.type === 'url' ? 'url' : 'text'}
          inputMode={f.type === 'url' ? 'url' : undefined}
          maxLength={f.max}
          placeholder={f.placeholder}
          value={String(value)}
          spellcheck={false}
          autoComplete="off"
          onInput={(e) => onChange(inputValue(e))}
        />
      );
  }
}

function FormFieldsEditor({ id, items, max, onChange }: { id: string; items: FormFieldItem[]; max: number; onChange: (v: ParamValue) => void }) {
  const set = (i: number, patch: Partial<FormFieldItem>) => onChange(items.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  return (
    <div class="rows" id={id}>
      {items.map((it, i) => (
        <div class="row" key={i}>
          <input class="input" aria-label={`Field ${i + 1} label`} value={it.label} maxLength={80} placeholder="Label" onInput={(e) => set(i, { label: inputValue(e) })} />
          <div class="select">
            <select aria-label={`Field ${i + 1} type`} value={it.type} onChange={(e) => set(i, { type: inputValue(e) as FormFieldItem['type'] })}>
              <option value="text">Text</option>
              <option value="email">Email</option>
              <option value="number">Number</option>
              <option value="textarea">Long text</option>
            </select>
          </div>
          <label class="check">
            <input type="checkbox" checked={it.required} onChange={(e) => set(i, { required: (e.currentTarget as HTMLInputElement).checked })} />
            <span>Req.</span>
          </label>
          <button type="button" class="icon-btn" aria-label={`Remove field ${it.label || i + 1}`} onClick={() => onChange(items.filter((_, j) => j !== i))}>
            ×
          </button>
        </div>
      ))}
      {items.length < max && (
        <button type="button" class="link-btn" onClick={() => onChange([...items, { label: '', type: 'text', required: false }])}>
          + Add field
        </button>
      )}
    </div>
  );
}

function AssignmentsEditor({ id, items, max, onChange }: { id: string; items: AssignmentItem[]; max: number; onChange: (v: ParamValue) => void }) {
  const set = (i: number, patch: Partial<AssignmentItem>) => onChange(items.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  return (
    <div class="rows" id={id}>
      {items.map((it, i) => (
        <div class="row row--assign" key={i}>
          <input class="input" aria-label={`Field ${i + 1} name`} value={it.name} maxLength={80} placeholder="name" spellcheck={false} onInput={(e) => set(i, { name: inputValue(e) })} />
          <input class="input" aria-label={`Field ${i + 1} value`} value={it.value} maxLength={500} placeholder="value or {{ expression }}" spellcheck={false} onInput={(e) => set(i, { value: inputValue(e) })} />
          <div class="select">
            <select aria-label={`Field ${i + 1} type`} value={it.type} onChange={(e) => set(i, { type: inputValue(e) as AssignmentItem['type'] })}>
              <option value="string">Text</option>
              <option value="number">Number</option>
              <option value="boolean">True/false</option>
            </select>
          </div>
          <button type="button" class="icon-btn" aria-label={`Remove field ${it.name || i + 1}`} onClick={() => onChange(items.filter((_, j) => j !== i))}>
            ×
          </button>
        </div>
      ))}
      {items.length < max && (
        <button type="button" class="link-btn" onClick={() => onChange([...items, { name: '', value: '', type: 'string' }])}>
          + Add field
        </button>
      )}
    </div>
  );
}
