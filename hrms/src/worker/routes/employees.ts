import { Hono, type Context } from 'hono';
import { and, asc, eq } from 'drizzle-orm';
import { account, employees, session } from '../db/schema';
import { type AppEnv, type Employee, bad, isHR, notFound, requireEmployee, requireRole } from '../lib/context';
import { hashPassword, tempPassword } from '../lib/password';
import { isValidDate } from '../lib/dates';
import { audit } from '../lib/audit';

const app = new Hono<AppEnv>();
app.use('*', requireEmployee);

const ROLES = ['admin', 'hr', 'manager', 'employee'] as const;
type EmployeeInput = Partial<Pick<Employee, 'fullName' | 'email' | 'designation' | 'department' | 'managerId' | 'role' | 'dateOfJoining' | 'employeeCode' | 'status'>>;

const publicFields = (e: Employee) => {
  const { userId: _u, ...rest } = e;
  return { ...rest, hasLogin: !!e.userId };
};

async function validate(c: Context<AppEnv>, body: EmployeeInput, selfId?: string) {
  const me = c.get('me');
  if (body.role !== undefined) {
    if (!ROLES.includes(body.role)) throw bad('Invalid role');
    if ((body.role === 'admin' || body.role === 'hr') && me.role !== 'admin') throw bad('Only an admin can give admin or HR access');
  }
  if (body.dateOfJoining && !isValidDate(body.dateOfJoining)) throw bad('Date of joining must be YYYY-MM-DD');
  if (body.status !== undefined && !['active', 'exited'].includes(body.status)) throw bad('Invalid status');
  if (body.managerId) {
    if (body.managerId === selfId) throw bad('An employee cannot report to themselves');
    const [m] = await c.get('db').select({ id: employees.id }).from(employees)
      .where(and(eq(employees.id, body.managerId), eq(employees.companyId, me.companyId)));
    if (!m) throw bad('Manager not found');
  }
}

app.get('/', async (c) => {
  const me = c.get('me');
  const includeExited = c.req.query('all') === '1' && isHR(me);
  const rows = await c.get('db').select().from(employees)
    .where(includeExited ? eq(employees.companyId, me.companyId) : and(eq(employees.companyId, me.companyId), eq(employees.status, 'active')))
    .orderBy(asc(employees.fullName));
  return c.json(rows.map(publicFields));
});

app.get('/:id', async (c) => {
  const me = c.get('me');
  const [e] = await c.get('db').select().from(employees)
    .where(and(eq(employees.id, c.req.param('id')), eq(employees.companyId, me.companyId)));
  if (!e) throw notFound('Employee');
  return c.json(publicFields(e));
});

/** Add an employee and create their login with a one-time temporary password. */
app.post('/', requireRole('admin', 'hr'), async (c) => {
  const me = c.get('me');
  const db = c.get('db');
  const body = await c.req.json<EmployeeInput>();
  if (!body.fullName?.trim()) throw bad('Full name is required');
  const email = body.email?.trim().toLowerCase();
  if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw bad('A valid email is required');
  await validate(c, body);

  const [dupe] = await db.select({ id: employees.id }).from(employees)
    .where(and(eq(employees.companyId, me.companyId), eq(employees.email, email)));
  if (dupe) throw bad('An employee with this email already exists');

  const password = tempPassword();
  let userId: string;
  try {
    const res = await c.get('auth').api.signUpEmail({ body: { email, password, name: body.fullName.trim() } });
    userId = res.user.id;
  } catch {
    throw bad('This email already has a login (possibly in another company). Use a different email.');
  }
  // signUpEmail signs the new user in; that session is not needed here.
  await db.delete(session).where(eq(session.userId, userId));

  const [emp] = await db.insert(employees).values({
    companyId: me.companyId,
    userId,
    fullName: body.fullName.trim(),
    email,
    designation: body.designation?.trim() || null,
    department: body.department?.trim() || null,
    managerId: body.managerId || null,
    role: body.role ?? 'employee',
    dateOfJoining: body.dateOfJoining || null,
    employeeCode: body.employeeCode?.trim() || null,
    mustChangePassword: true,
  }).returning();
  await audit(db, me.companyId, me.id, 'create', 'employee', emp.id, { email, role: emp.role });
  return c.json({ employee: publicFields(emp), tempPassword: password });
});

app.patch('/:id', requireRole('admin', 'hr'), async (c) => {
  const me = c.get('me');
  const db = c.get('db');
  const id = c.req.param('id');
  const [target] = await db.select().from(employees).where(and(eq(employees.id, id), eq(employees.companyId, me.companyId)));
  if (!target) throw notFound('Employee');
  const body = await c.req.json<EmployeeInput>();
  if ((target.role === 'admin' || target.role === 'hr') && me.role !== 'admin') throw bad('Only an admin can edit admin or HR profiles');
  if (target.id === me.id && body.role !== undefined && body.role !== me.role) throw bad('You cannot change your own role');
  if (target.id === me.id && body.status === 'exited') throw bad('You cannot mark yourself as exited');
  await validate(c, body, id);

  const patch: Partial<typeof employees.$inferInsert> = {};
  if (body.fullName !== undefined) {
    if (!body.fullName?.trim()) throw bad('Full name cannot be empty');
    patch.fullName = body.fullName.trim();
  }
  for (const k of ['designation', 'department', 'employeeCode'] as const) {
    if (body[k] !== undefined) patch[k] = body[k]?.trim() || null;
  }
  if (body.managerId !== undefined) patch.managerId = body.managerId || null;
  if (body.role !== undefined) patch.role = body.role;
  if (body.dateOfJoining !== undefined) patch.dateOfJoining = body.dateOfJoining || null;
  if (body.status !== undefined) patch.status = body.status;

  const [updated] = await db.update(employees).set(patch).where(eq(employees.id, id)).returning();
  if (body.status === 'exited' && target.userId) await db.delete(session).where(eq(session.userId, target.userId));
  await audit(db, me.companyId, me.id, 'update', 'employee', id, { fields: Object.keys(patch) });
  return c.json(publicFields(updated));
});

app.post('/:id/reset-password', requireRole('admin', 'hr'), async (c) => {
  const me = c.get('me');
  const db = c.get('db');
  const [target] = await db.select().from(employees)
    .where(and(eq(employees.id, c.req.param('id')), eq(employees.companyId, me.companyId)));
  if (!target?.userId) throw notFound('Employee login');
  if ((target.role === 'admin' || target.role === 'hr') && me.role !== 'admin') throw bad('Only an admin can reset admin or HR passwords');
  const password = tempPassword();
  await db.update(account).set({ password: await hashPassword(password), updatedAt: new Date() })
    .where(and(eq(account.userId, target.userId), eq(account.providerId, 'credential')));
  await db.delete(session).where(eq(session.userId, target.userId));
  await db.update(employees).set({ mustChangePassword: true }).where(eq(employees.id, target.id));
  await audit(db, me.companyId, me.id, 'reset_password', 'employee', target.id);
  return c.json({ tempPassword: password });
});

export default app;
