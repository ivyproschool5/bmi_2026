// All dates are handled as 'YYYY-MM-DD' strings in India Standard Time.
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

export const todayIST = () => new Date(Date.now() + IST_OFFSET_MS).toISOString().slice(0, 10);

export function eachDate(from: string, to: string): string[] {
  const out: string[] = [];
  const d = new Date(from + 'T00:00:00Z');
  const end = new Date(to + 'T00:00:00Z');
  while (d <= end) {
    out.push(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return out;
}

export const dayOfWeek = (date: string) => new Date(date + 'T00:00:00Z').getUTCDay();

export const isValidDate = (s: unknown): s is string =>
  typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(Date.parse(s + 'T00:00:00Z'));

/** Working days between two dates, excluding weekly offs and company holidays. */
export function countLeaveDays(from: string, to: string, weeklyOffs: number[], holidayDates: Set<string>, halfDay: boolean) {
  const days = eachDate(from, to).filter((d) => !weeklyOffs.includes(dayOfWeek(d)) && !holidayDates.has(d)).length;
  if (halfDay) return days === 1 ? 0.5 : NaN;
  return days;
}
