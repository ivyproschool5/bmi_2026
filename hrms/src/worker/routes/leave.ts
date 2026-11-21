import { Hono } from 'hono';
import { alias } from 'drizzle-orm/pg-core';
import { and, desc, eq, gte, inArray, lte, ne, or, type SQL } from 'drizzle-orm';
import { employees, leaveRequests, leaveTypes } from '../db/schema';
import { type AppEnv, bad, isHR, notFound, requireEmployee, requireRole } from '../lib/context';
import { countLeaveDays, isValidDate, todayIST } from '../lib/dates';
import { holidaySet, leaveBalances } from '../lib/leave';
import { escapeHtml, sendEmail } from '../lib/email';
import { audit } from '../lib/audit';

const app = new Hono<AppEnv>();
app.use('*', requireEmployee);

/* ---------- Leave types ---------- */

app.get('/types', async (c) => {
  const rows = await c.get('db').select().from(leaveTypes)
    .where(eq(leaveTypes.companyId, c.get('me').companyId)).orderBy(leaveTypes.code);
  return c.json(rows);
});

app.post('/types', requireRole('admin', 'hr'), async (c) => {
  const me = c.get('me');
  const b = await c.req.json<{ name?: string; code?: string; annualQuota?: number }>();
  if (!b.name?.trim() || !b.code?.trim()) throw bad('Name and code are required');
  const quota = Number(b.annualQuota);
  if (!(quota >= 0 && quota <= 365)) throw bad('Annual quota must be between 0 and 365');
  try {
    const [t] = await c.get('db').insert(leaveTypes)
      .values({ companyId: me.companyId, name: b.name.trim(), code: b.code.trim().toUpperCase(), annualQuota: String(quota) })
      .returning();
    await audit(c.get('db'), me.companyId, me.id, 'create', 'leave_type', t.id, b);
    return c.json(t);
  } catch {
    throw bad('A leave type with this code already exists');
  }
});

app.patch('/types/:id', requireRole('admin', 'hr'), async (c) => {
  const me = c.get('me');
  const b = await c.req.json<{ name?: string; annualQuota?: number; active?: boolean }>();
  const patch: Partial<typeof leaveTypes.$inferInsert> = {};
  if (b.name !== undefined) patch.name = b.name.trim();
  if (b.annualQuota !== undefined) {
    if (!(Number(b.annualQuota) >= 0 && Number(b.annualQuota) <= 365)) throw bad('Annual quota must be between 0 and 365');
    patch.annualQuota = String(b.annualQuota);
  }
  if (b.active !== undefined) patch.active = !!b.active;
  const [t] = await c.get('db').update(leaveTypes).set(patch)
    .where(and(eq(leaveTypes.id, c.req.param('id')), eq(leaveTypes.companyId, me.companyId))).returning();
  if (!t) throw notFound('Leave type');
  await audit(c.get('db'), me.companyId, me.id, 'update', 'leave_type', t.id, b);
  return c.json(t);
});

/* ---------- Balances ---------- */

app.get('/balances', async (c) => {
  const me = c.get('me');
  const employeeId = c.req.query('employeeId') || me.id;
  const year = Number(c.req.query('year')) || Number(todayIST().slice(0, 4));
  if (employeeId !== me.id) {
    const [e] = await c.get('db').select().from(employees)
      .where(and(eq(employees.id, employeeId), eq(employees.companyId, me.companyId)));
    if (!e) throw notFound('Employee');
    if (!isHR(me) && e.managerId !== me.id) throw bad('You can only see balances for yourself or your team');
  }
  return c.json(await leaveBalances(c.get('db'), me.companyId, employeeId, year));
});

/* ---------- Requests ---------- */

const emp = alias(employees, 'emp');
const approver = alias(employees, 'approver');

function requestQuery(c: { get: (k: 'db') => AppEnv['Variables']['db'] }, where: SQL | undefined) {
  return c.get('db')
    .select({
      id: leaveRequests.id,
      employeeId: leaveRequests.employeeId,
      employeeName: emp.fullName,
      leaveTypeId: leaveRequests.leaveTypeId,
      leaveType: leaveTypes.name,
      leaveCode: leaveTypes.code,
      fromDate: leaveRequests.fromDate,
      toDate: leaveRequests.toDate,
      halfDay: leaveRequests.halfDay,
      days: leaveRequests.days,
      reason: leaveRequests.reason,
      status: leaveRequests.status,
      approverName: approver.fullName,
      decisionNote: leaveRequests.decisionNote,
      decidedAt: leaveRequests.decidedAt,
      createdAt: leaveRequests.createdAt,
    })
    .from(leaveRequests)
    .innerJoin(emp, eq(emp.id, leaveRequests.employeeId))
    .innerJoin(leaveTypes, eq(leaveTypes.id, leaveRequests.leaveTypeId))
    .leftJoin(approver, eq(approver.id, leaveRequests.approverId))
    .where(where)
    .orderBy(desc(leaveRequests.createdAt))
    .limit(200);
}

/**
 * scope=mine       my own requests
 * scope=approvals  pending requests I can act on (direct reports; HR/admin see everyone's)
 * scope=all        everything in the company (HR/admin only)
 */
app.get('/requests', async (c) => {
  const me = c.get('me');
  const scope = c.req.query('scope') ?? 'mine';
  const base = eq(leaveRequests.companyId, me.companyId);
  if (scope === 'mine') return c.json(await requestQuery(c, and(base, eq(leaveRequests.employeeId, me.id))));
  if (scope === 'approvals') {
    const who = isHR(me) ? ne(leaveRequests.employeeId, me.id) : eq(emp.managerId, me.id);
    return c.json(await requestQuery(c, and(base, eq(leaveRequests.status, 'pending'), who)));
  }
  if (scope === 'all') {
    if (!isHR(me)) throw bad('Only HR can see all requests');
    const status = c.req.query('status');
    const valid = ['pending', 'approved', 'rejected', 'cancelled'] as const;
    const st = valid.find((v) => v === status);
    return c.json(await requestQuery(c, st ? and(base, eq(leaveRequests.status, st)) : base));
  }
  throw bad('Unknown scope');
});

app.post('/requests', async (c) => {
  const me = c.get('me');
  const company = c.get('company');
  const db = c.get('db');
  const b = await c.req.json<{ leaveTypeId?: string; fromDate?: string; toDate?: string; halfDay?: boolean; reason?: string }>();
  if (!b.leaveTypeId) throw bad('Choose a leave type');
  if (!isValidDate(b.fromDate) || !isValidDate(b.toDate)) throw bad('Dates must be YYYY-MM-DD');
  if (b.toDate < b.fromDate) throw bad('End date is before start date');
  if (b.fromDate.slice(0, 4) !== b.toDate.slice(0, 4)) throw bad('A request cannot cross into the next year. Please split it into two requests.');
  if (b.halfDay && b.fromDate !== b.toDate) throw bad('Half day is only allowed for a single date');

  const [type] = await db.select().from(leaveTypes)
    .where(and(eq(leaveTypes.id, b.leaveTypeId), eq(leaveTypes.companyId, me.companyId), eq(leaveTypes.active, true)));
  if (!type) throw notFound('Leave type');

  const hols = await holidaySet(db, me.companyId, b.fromDate, b.toDate);
  const days = countLeaveDays(b.fromDate, b.toDate, company.weeklyOffs, hols, !!b.halfDay);
  if (!days) throw bad('The selected dates are all weekly offs or holidays');

  const overlap = await db.select({ id: leaveRequests.id }).from(leaveRequests).where(and(
    eq(leaveRequests.employeeId, me.id),
    inArray(leaveRequests.status, ['pending', 'approved']),
    lte(leaveRequests.fromDate, b.toDate),
    gte(leaveRequests.toDate, b.fromDate),
  ));
  if (overlap.length) throw bad('You already have a leave request covering some of these dates');

  const balance = (await leaveBalances(db, me.companyId, me.id, Number(b.fromDate.slice(0, 4))))
    .find((x) => x.leaveTypeId === type.id);
  if (!balance || balance.available < days)
    throw bad(`Not enough ${type.name} balance. Available: ${balance?.available ?? 0}, requested: ${days}`);

  const [req] = await db.insert(leaveRequests).values({
    companyId: me.companyId,
    employeeId: me.id,
    leaveTypeId: type.id,
    fromDate: b.fromDate,
    toDate: b.toDate,
    halfDay: !!b.halfDay,
    days: String(days),
    reason: b.reason?.trim().slice(0, 1000) || null,
  }).returning();

  // Notify the manager, or HR/admin when the employee has no manager.
  const recipients = me.managerId
    ? await db.select({ email: employees.email }).from(employees).where(eq(employees.id, me.managerId))
    : await db.select({ email: employees.email }).from(employees).where(and(
      eq(employees.companyId, me.companyId), eq(employees.status, 'active'),
      or(eq(employees.role, 'admin'), eq(employees.role, 'hr')), ne(employees.id, me.id)));
  if (recipients.length) {
    const html = `<p>${escapeHtml(me.fullName)} has applied for ${days} day(s) of ${escapeHtml(type.name)} from ${b.fromDate} to ${b.toDate}.</p>
      ${req.reason ? `<p>Reason: ${escapeHtml(req.reason)}</p>` : ''}<p>Please review it in ${escapeHtml(c.env.APP_NAME)} under Approvals.</p>`;
    c.executionCtx.waitUntil(sendEmail(c.env, recipients.map((r) => r.email), `Leave request from ${me.fullName}`, html));
  }
  return c.json(req);
});

app.post('/requests/:id/decision', async (c) => {
  const me = c.get('me');
  const db = c.get('db');
  const b = await c.req.json<{ action?: 'approve' | 'reject'; note?: string }>();
  if (b.action !== 'approve' && b.action !== 'reject') throw bad('Action must be approve or reject');
  const [row] = await db.select({ r: leaveRequests, e: employees, t: leaveTypes }).from(leaveRequests)
    .innerJoin(employees, eq(employees.id, leaveRequests.employeeId))
    .innerJoin(leaveTypes, eq(leaveTypes.id, leaveRequests.leaveTypeId))
    .where(and(eq(leaveRequests.id, c.req.param('id')), eq(leaveRequests.companyId, me.companyId)));
  if (!row) throw notFound('Leave request');
  if (row.r.employeeId === me.id) throw bad('You cannot approve your own leave');
  if (!isHR(me) && row.e.managerId !== me.id) throw bad('Only the reporting manager or HR can decide on this request');
  if (row.r.status !== 'pending') throw bad(`This request is already ${row.r.status}`);
  if (b.action === 'reject' && !b.note?.trim()) throw bad('Please add a reason when rejecting');

  const status = b.action === 'approve' ? 'approved' : 'rejected';
  const [updated] = await db.update(leaveRequests)
    .set({ status, approverId: me.id, decisionNote: b.note?.trim() || null, decidedAt: new Date() })
    .where(and(eq(leaveRequests.id, row.r.id), eq(leaveRequests.status, 'pending')))
    .returning();
  if (!updated) throw bad('This request was changed by someone else. Please refresh.');
  await audit(db, me.companyId, me.id, status, 'leave_request', row.r.id, { note: b.note });

  const html = `<p>Your ${escapeHtml(row.t.name)} request for ${row.r.fromDate} to ${row.r.toDate} has been <b>${status}</b> by ${escapeHtml(me.fullName)}.</p>
    ${b.note ? `<p>Note: ${escapeHtml(b.note)}</p>` : ''}`;
  c.executionCtx.waitUntil(sendEmail(c.env, row.e.email, `Leave ${status}`, html));
  return c.json(updated);
});

app.post('/requests/:id/cancel', async (c) => {
  const me = c.get('me');
  const db = c.get('db');
  const [r] = await db.select().from(leaveRequests)
    .where(and(eq(leaveRequests.id, c.req.param('id')), eq(leaveRequests.employeeId, me.id)));
  if (!r) throw notFound('Leave request');
  const canCancel = r.status === 'pending' || (r.status === 'approved' && r.fromDate > todayIST());
  if (!canCancel) throw bad('Only pending requests, or approved leave that has not started, can be cancelled');
  const [updated] = await db.update(leaveRequests).set({ status: 'cancelled' }).where(eq(leaveRequests.id, r.id)).returning();
  await audit(db, me.companyId, me.id, 'cancel', 'leave_request', r.id);
  return c.json(updated);
});

export default app;
