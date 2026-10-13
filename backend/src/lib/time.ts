import { env } from '../config/env';

const DAY_MS = 86_400_000;

const localParts = (date: Date, tz: string) =>
  Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', {
      timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
    }).formatToParts(date).map((p) => [p.type, Number(p.value)]),
  ) as Record<'year' | 'month' | 'day' | 'hour' | 'minute' | 'second', number>;

/** Offset of `tz` from UTC at `date`, in ms. */
const offsetMs = (date: Date, tz: string) => {
  const p = localParts(date, tz);
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - Math.floor(date.getTime() / 1000) * 1000;
};

/** Local calendar day as YYYY-MM-DD. */
export const dayKey = (date: Date, tz = env.TIMEZONE) => {
  const p = localParts(date, tz);
  return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
};

/** The instant at which the local day containing `date` began. */
export const startOfDay = (date = new Date(), tz = env.TIMEZONE) => {
  const midnight = Date.parse(`${dayKey(date, tz)}T00:00:00Z`);
  const first = midnight - offsetMs(new Date(midnight), tz);
  return new Date(midnight - offsetMs(new Date(first), tz));
};

/** The last `count` local day keys, oldest first, ending today. */
export const recentDays = (count: number, tz = env.TIMEZONE) => {
  const noon = startOfDay(new Date(), tz).getTime() + DAY_MS / 2;
  return Array.from({ length: count }, (_, i) => dayKey(new Date(noon - (count - 1 - i) * DAY_MS), tz));
};

export type Period = 'day' | 'week' | 'month';

/** Label of the local day, ISO week (Monday) or month a date falls in, as YYYY-MM-DD. */
export const bucket = (date: Date, unit: Period, tz = env.TIMEZONE) => {
  const key = dayKey(date, tz);
  if (unit === 'day') return key;
  if (unit === 'month') return `${key.slice(0, 7)}-01`;
  const monday = new Date(`${key}T00:00:00Z`);
  monday.setUTCDate(monday.getUTCDate() - ((monday.getUTCDay() + 6) % 7));
  return monday.toISOString().slice(0, 10);
};

/** Today's store date at midnight UTC (expiry dates are calendar dates stored at midnight UTC). */
export const businessToday = () => new Date(dayKey(new Date()));
