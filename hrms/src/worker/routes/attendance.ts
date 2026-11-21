import { Hono } from 'hono';
import { and, asc, eq, gte, inArray, lte } from 'drizzle-orm';
import { attendance, employees, holidays, leaveRequests, leaveTypes } from '../db/schema';
import { type AppEnv, bad, isHR, notFound, requireEmployee } from '../lib/context';
import { dayOfWeek, todayIST } from '../lib/dates';

const app = new Hono<AppEnv>();
app.use('*', requireEmployee);

app.get('/today', async (c) => {
  const [r] = await c.get('db').select().from(attendance)
    .where(and(eq(attendance.employeeId, c.get('me').id), eq(attendance.date, todayIST())));
  return c.json(r ?? null);
});

app.post('/check-in', async (c) => {
  const me = c.get('me');
  const [r] = await c.get('db').insert(attendance)
    .values({ companyId: me.companyId, employeeId: me.id, date: todayIST(), checkIn: new Date() })
    .onConflictDoNothing()
    .returning();
  if (!r) throw bad('You have already checked in today');
  return c.json(r);
});

app.post('/check-out', async (c) => {
  const me = c.get('me');
  const db = c.get('db');
  const [r] = await db.select().from(attendance).where(and(eq(attendance.employeeId, me.id), eq(attendance.date, todayIST())));
  if (!r?.checkIn) throw bad('Please check in first');
  if (r.checkOut) throw bad('You have already checked out today');
  const [u] = await db.update(attendance).set({ checkOut: new Date() }).where(eq(attendance.id, r.id)).returning();
  return c.json(u);
});

/** Month view for one employee: attendance rows, approved leave and holidays. */
app.get('/', async (c) => {
  const me = c.get('me');
  const db = c.get('db');
  const month = c.req.query('month') ?? todayIST().slice(0, 7);
  if (!/^\d{4}-\d{2}$/.test(month)) throw bad('Month must be YYYY-MM');
  const employeeId = c.req.query('employeeId') || me.id;
  if (employeeId !== me.id) {
    const [e] = await db.select().from(employees).where(and(eq(employees.id, employeeId), eq(employees.companyId, me.companyId)));
    if (!e) throw notFound('Employee');
    if (!isHR(me) && e.managerId !== me.id) throw bad('You can only see attendance for yourself or your team');
  }
  const from = `${month}-01`;
  const last = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0)).getUTCDate();
  const to = `${month}-${String(last).padStart(2, '0')}`;

  const [records, leaves, hols] = await Promise.all([
    db.select().from(attendance).where(and(eq(attendance.employeeId, employeeId), gte(attendance.date, from), lte(attendance.date, to))).orderBy(asc(attendance.date)),
    db.select({ fromDate: leaveRequests.fromDate, toDate: leaveRequests.toDate, halfDay: leaveRequests.halfDay, code: leaveTypes.code })
      .from(leaveRequests).innerJoin(leaveTypes, eq(leaveTypes.id, leaveRequests.leaveTypeId))
      .where(and(eq(leaveRequests.employeeId, employeeId), eq(leaveRequests.status, 'approved'), lte(leaveRequests.fromDate, to), gte(leaveRequests.toDate, from))),
    db.select().from(holidays).where(and(eq(holidays.companyId, me.companyId), gte(holidays.date, from), lte(holidays.date, to))),
  ]);
  return c.json({ month, from, to, weeklyOffs: c.get('company').weeklyOffs, records, leaves, holidays: hols });
});

/** Today's status for my team (HR/admin: whole company). */
app.get('/team', async (c) => {
  const me = c.get('me');
  const db = c.get('db');
  const today = todayIST();
  const team = await db.select({ id: employees.id, fullName: employees.fullName, designation: employees.designation }).from(employees)
    .where(and(eq(employees.companyId, me.companyId), eq(employees.status, 'active'), ...(isHR(me) ? [] : [eq(employees.managerId, me.id)])))
    .orderBy(asc(employees.fullName));
  if (!team.length) return c.json([]);
  const ids = team.map((t) => t.id);
  const [att, onLeave, [hol]] = await Promise.all([
    db.select().from(attendance).where(and(inArray(attendance.employeeId, ids), eq(attendance.date, today))),
    db.select({ employeeId: leaveRequests.employeeId, code: leaveTypes.code, halfDay: leaveRequests.halfDay })
      .from(leaveRequests).innerJoin(leaveTypes, eq(leaveTypes.id, leaveRequests.leaveTypeId))
      .where(and(inArray(leaveRequests.employeeId, ids), eq(leaveRequests.status, 'approved'), lte(leaveRequests.fromDate, today), gte(leaveRequests.toDate, today))),
    db.select().from(holidays).where(and(eq(holidays.companyId, me.companyId), eq(holidays.date, today))),
  ]);
  const off = hol ? `Holiday: ${hol.name}` : c.get('company').weeklyOffs.includes(dayOfWeek(today)) ? 'Weekly off' : null;
  return c.json(team.map((t) => {
    const a = att.find((x) => x.employeeId === t.id);
    const l = onLeave.find((x) => x.employeeId === t.id);
    const status = a ? (a.checkOut ? 'checked_out' : 'present') : l ? 'on_leave' : off ? 'off' : 'not_marked';
    return { ...t, status, checkIn: a?.checkIn ?? null, checkOut: a?.checkOut ?? null, leaveCode: l?.code ?? null, offReason: off };
  }));
});

export default app;
