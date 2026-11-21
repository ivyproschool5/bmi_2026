import { Hono } from 'hono';
import { and, asc, count, eq, gte, lte, ne } from 'drizzle-orm';
import { attendance, employees, holidays, leaveRequests, leaveTypes } from '../db/schema';
import { type AppEnv, isHR, requireEmployee } from '../lib/context';
import { leaveBalances } from '../lib/leave';
import { todayIST } from '../lib/dates';

const app = new Hono<AppEnv>();
app.use('*', requireEmployee);

app.get('/', async (c) => {
  const me = c.get('me');
  const db = c.get('db');
  const today = todayIST();

  const approvalsWhere = and(
    eq(leaveRequests.companyId, me.companyId),
    eq(leaveRequests.status, 'pending'),
    isHR(me) ? ne(leaveRequests.employeeId, me.id) : eq(employees.managerId, me.id),
  );

  const [todayAtt, balances, [pending], onLeaveToday, upcomingHolidays, [headcount]] = await Promise.all([
    db.select().from(attendance).where(and(eq(attendance.employeeId, me.id), eq(attendance.date, today))),
    leaveBalances(db, me.companyId, me.id, Number(today.slice(0, 4))),
    db.select({ n: count() }).from(leaveRequests).innerJoin(employees, eq(employees.id, leaveRequests.employeeId)).where(approvalsWhere),
    db.select({ name: employees.fullName, code: leaveTypes.code, toDate: leaveRequests.toDate, halfDay: leaveRequests.halfDay })
      .from(leaveRequests)
      .innerJoin(employees, eq(employees.id, leaveRequests.employeeId))
      .innerJoin(leaveTypes, eq(leaveTypes.id, leaveRequests.leaveTypeId))
      .where(and(eq(leaveRequests.companyId, me.companyId), eq(leaveRequests.status, 'approved'), lte(leaveRequests.fromDate, today), gte(leaveRequests.toDate, today))),
    db.select().from(holidays).where(and(eq(holidays.companyId, me.companyId), gte(holidays.date, today))).orderBy(asc(holidays.date)).limit(5),
    db.select({ n: count() }).from(employees).where(and(eq(employees.companyId, me.companyId), eq(employees.status, 'active'))),
  ]);

  return c.json({
    today,
    attendance: todayAtt[0] ?? null,
    balances,
    pendingApprovals: pending.n,
    onLeaveToday,
    upcomingHolidays,
    headcount: headcount.n,
  });
});

export default app;
