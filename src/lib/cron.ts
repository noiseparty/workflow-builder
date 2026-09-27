// The "human picker" for schedules: a handful of plain choices that compile to a 5-field
// cron expression, plus a validator and describer for the custom-cron escape hatch.

export type ScheduleMode = 'minutes' | 'hourly' | 'daily' | 'weekdays' | 'weekly' | 'monthly' | 'cron';

export interface ScheduleParams {
  mode: ScheduleMode;
  every: number; // minutes, for mode=minutes
  minute: number; // for mode=hourly
  time: string; // "HH:MM" for daily/weekdays/weekly/monthly
  weekday: number; // 0=Sunday .. 6=Saturday
  dayOfMonth: number; // 1..28
  cron: string; // for mode=cron
}

export const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

export function parseTime(time: string): { h: number; m: number } | null {
  const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(time);
  return m ? { h: Number(m[1]), m: Number(m[2]) } : null;
}

export function scheduleToCron(p: ScheduleParams): string {
  const t = parseTime(p.time) ?? { h: 9, m: 0 };
  switch (p.mode) {
    case 'minutes':
      return `*/${p.every} * * * *`;
    case 'hourly':
      return `${p.minute} * * * *`;
    case 'daily':
      return `${t.m} ${t.h} * * *`;
    case 'weekdays':
      return `${t.m} ${t.h} * * 1-5`;
    case 'weekly':
      return `${t.m} ${t.h} * * ${p.weekday}`;
    case 'monthly':
      return `${t.m} ${t.h} ${p.dayOfMonth} * *`;
    case 'cron':
      return p.cron.trim().replace(/\s+/g, ' ');
  }
}

function ordinal(n: number): string {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

export function describeSchedule(p: ScheduleParams): string {
  switch (p.mode) {
    case 'minutes':
      return p.every === 1 ? 'every minute' : `every ${p.every} minutes`;
    case 'hourly':
      return p.minute === 0 ? 'every hour, on the hour' : `every hour at ${p.minute} minutes past`;
    case 'daily':
      return `every day at ${p.time}`;
    case 'weekdays':
      return `every weekday (Mon–Fri) at ${p.time}`;
    case 'weekly':
      return `every ${WEEKDAYS[p.weekday]} at ${p.time}`;
    case 'monthly':
      return `on the ${ordinal(p.dayOfMonth)} of every month at ${p.time}`;
    case 'cron':
      return describeCron(p.cron);
  }
}

// ---- custom cron ----------------------------------------------------------------------

interface FieldSpec {
  name: string;
  min: number;
  max: number;
  names?: string[];
}

const FIELDS: FieldSpec[] = [
  { name: 'minute', min: 0, max: 59 },
  { name: 'hour', min: 0, max: 23 },
  { name: 'day of month', min: 1, max: 31 },
  { name: 'month', min: 1, max: 12, names: ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'] },
  { name: 'day of week', min: 0, max: 7, names: ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'] },
];

function atom(raw: string, f: FieldSpec): number | null {
  if (/^\d+$/.test(raw)) {
    const n = Number(raw);
    return n >= f.min && n <= f.max ? n : null;
  }
  if (f.names) {
    const i = f.names.indexOf(raw.toUpperCase());
    if (i >= 0) return f.name === 'month' ? i + 1 : i;
  }
  return null;
}

function checkField(part: string, f: FieldSpec): string | null {
  for (const item of part.split(',')) {
    if (item === '') return `the ${f.name} field has an empty list entry`;
    const [range, step, extra] = item.split('/');
    if (extra !== undefined) return `the ${f.name} field "${item}" has two steps`;
    if (step !== undefined && !(/^\d+$/.test(step) && Number(step) > 0)) {
      return `the ${f.name} step "/${step}" must be a positive number`;
    }
    if (range === '*') continue;
    const bounds = range.split('-');
    if (bounds.length > 2) return `the ${f.name} field "${item}" is not a valid range`;
    const nums = bounds.map((b) => atom(b, f));
    if (nums.some((n) => n === null)) {
      return `"${range}" is not a valid ${f.name} (${f.min}–${f.max})`;
    }
    if (nums.length === 2 && (nums[0] as number) > (nums[1] as number)) {
      return `the ${f.name} range "${range}" runs backwards`;
    }
  }
  return null;
}

/** Returns a plain-language problem, or null when the expression is a valid 5-field cron. */
export function validateCron(expr: string): string | null {
  const parts = expr.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return 'Enter a cron expression, e.g. "0 9 * * 1-5".';
  if (parts.length !== 5) {
    return `A cron expression has 5 parts (minute hour day month weekday); this one has ${parts.length}.`;
  }
  for (let i = 0; i < 5; i++) {
    const err = checkField(parts[i], FIELDS[i]);
    if (err) return err.charAt(0).toUpperCase() + err.slice(1) + '.';
  }
  return null;
}

const pad = (n: number) => String(n).padStart(2, '0');

/** Describes the common shapes in words; anything exotic is quoted back verbatim. */
export function describeCron(expr: string): string {
  const e = expr.trim().replace(/\s+/g, ' ');
  if (validateCron(e)) return `on the (invalid) cron schedule "${e}"`;
  const [mi, h, dom, mon, dow] = e.split(' ');
  const num = (s: string) => /^\d+$/.test(s);
  const everyN = /^\*\/(\d+)$/;

  if (everyN.test(mi) && h === '*' && dom === '*' && mon === '*' && dow === '*') {
    const n = Number(everyN.exec(mi)![1]);
    return n === 1 ? 'every minute' : `every ${n} minutes`;
  }
  if (mi === '*' && h === '*' && dom === '*' && mon === '*' && dow === '*') return 'every minute';
  if (num(mi) && h === '*' && dom === '*' && mon === '*' && dow === '*') {
    return Number(mi) === 0 ? 'every hour, on the hour' : `every hour at ${Number(mi)} minutes past`;
  }
  if (num(mi) && everyN.test(h) && dom === '*' && mon === '*' && dow === '*') {
    return `every ${everyN.exec(h)![1]} hours at ${Number(mi)} minutes past`;
  }
  if (num(mi) && num(h)) {
    const at = `at ${pad(Number(h))}:${pad(Number(mi))}`;
    if (dom === '*' && mon === '*') {
      if (dow === '*') return `every day ${at}`;
      if (dow === '1-5' || dow.toUpperCase() === 'MON-FRI') return `every weekday (Mon–Fri) ${at}`;
      if (dow === '0,6' || dow === '6,0') return `every weekend day ${at}`;
      const d = atom(dow, FIELDS[4]);
      if (d !== null) return `every ${WEEKDAYS[d % 7]} ${at}`;
    }
    if (num(dom) && dow === '*') {
      if (mon === '*') return `on the ${ordinal(Number(dom))} of every month ${at}`;
      const m = atom(mon, FIELDS[3]);
      if (m !== null) return `every year on ${MONTHS[m - 1]} ${Number(dom)} ${at}`;
    }
  }
  return `on the cron schedule "${e}"`;
}
