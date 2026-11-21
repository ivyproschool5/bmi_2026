import { and, eq, gte, inArray, lte, sql } from 'drizzle-orm';
import { holidays, leaveRequests, leaveTypes } from '../db/schema';
import type { DB } from './db';

export const DEFAULT_LEAVE_TYPES = [
  { name: 'Casual Leave', code: 'CL', annualQuota: '12' },
  { name: 'Sick Leave', code: 'SL', annualQuota: '12' },
  { name: 'Earned Leave', code: 'EL', annualQuota: '15' },
];

export async function holidaySet(db: DB, companyId: string, from: string, to: string) {
  const rows = await db
    .select({ date: holidays.date })
    .from(holidays)
    .where(and(eq(holidays.companyId, companyId), gte(holidays.date, from), lte(holidays.date, to)));
  return new Set(rows.map((r) => r.date));
}

/**
 * Balance per leave type for a calendar year.
 * MVP rule: full annual quota from 1 January, no accrual or carry-forward yet (Phase 1).
 * Pending requests are counted as reserved so people cannot over-apply.
 */
export async function leaveBalances(db: DB, companyId: string, employeeId: string, year: number) {
  const types = await db
    .select()
    .from(leaveTypes)
    .where(and(eq(leaveTypes.companyId, companyId), eq(leaveTypes.active, true)))
    .orderBy(leaveTypes.code);
  const used = await db
    .select({
      leaveTypeId: leaveRequests.leaveTypeId,
      status: leaveRequests.status,
      days: sql<string>`sum(${leaveRequests.days})`,
    })
    .from(leaveRequests)
    .where(
      and(
        eq(leaveRequests.employeeId, employeeId),
        inArray(leaveRequests.status, ['pending', 'approved']),
        gte(leaveRequests.fromDate, `${year}-01-01`),
        lte(leaveRequests.fromDate, `${year}-12-31`),
      ),
    )
    .groupBy(leaveRequests.leaveTypeId, leaveRequests.status);

  return types.map((t) => {
    const taken = Number(used.find((u) => u.leaveTypeId === t.id && u.status === 'approved')?.days ?? 0);
    const pending = Number(used.find((u) => u.leaveTypeId === t.id && u.status === 'pending')?.days ?? 0);
    const quota = Number(t.annualQuota);
    return { leaveTypeId: t.id, name: t.name, code: t.code, quota, taken, pending, available: quota - taken - pending };
  });
}
