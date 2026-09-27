// The builder's whole state. Everything else — the n8n JSON, the graph, the summary, the
// Mermaid export and the share link — is a pure function of one of these.

export type TriggerKind = 'schedule' | 'webhook' | 'rss' | 'form' | 'sheetsRow';

export type StepKind =
  | 'http'
  | 'filter'
  | 'set'
  | 'wait'
  | 'merge'
  | 'telegram'
  | 'slack'
  | 'discord'
  | 'email'
  | 'sheetsAppend'
  | 'postgres';

export interface FormFieldItem {
  label: string;
  type: 'text' | 'email' | 'number' | 'textarea';
  required: boolean;
}

export interface AssignmentItem {
  name: string;
  value: string;
  type: 'string' | 'number' | 'boolean';
}

export type ParamValue = string | number | boolean | FormFieldItem[] | AssignmentItem[];
export type Params = Record<string, ParamValue>;

export interface TriggerState {
  kind: TriggerKind;
  p: Params;
}

export interface StepState {
  kind: StepKind;
  p: Params;
}

export interface FlowState {
  name: string;
  trigger: TriggerState;
  steps: StepState[];
}

export const MAX_STEPS = 5;
