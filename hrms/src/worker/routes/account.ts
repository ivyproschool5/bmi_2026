import { Hono } from 'hono';
import { eq } from 'drizzle-orm';
import { companies, employees, leaveTypes, user } from '../db/schema';
import { type AppEnv, bad, requireEmployee, requireRole, requireUser } from '../lib/context';
import { DEFAULT_LEAVE_TYPES } from '../lib/leave';
import { audit } from '../lib/audit';

const app = new Hono<AppEnv>();

/** Who am I? Works before onboarding so the UI can decide what to show. */
app.get('/me', requireUser, async (c) => {
  const db = c.get('db');
  const [u] = await db.select({ id: user.id, name: user.name, email: user.email }).from(user).where(eq(user.id, c.get('userId')));
  const [row] = await db
    .select({ e: employees, co: companies })
    .from(employees)
    .innerJoin(companies, eq(companies.id, employees.companyId))
    .where(eq(employees.userId, c.get('userId')));
  return c.json({
    user: u,
    employee: row && row.e.status === 'active' ? row.e : null,
    company: row && row.e.status === 'active' ? row.co : null,
    signupAllowed: c.env.ALLOW_SIGNUP === 'true',
  });
});

/** First login after sign-up: create the company and make this user its admin. */
app.post('/onboard', requireUser, async (c) => {
  if (c.env.ALLOW_SIGNUP !== 'true') throw bad('New company sign-up is switched off. Ask your HR team to add you.');
  const { companyName } = await c.req.json<{ companyName?: string }>();
  if (!companyName?.trim()) throw bad('Company name is required');
  const db = c.get('db');
  const [existing] = await db.select({ id: employees.id }).from(employees).where(eq(employees.userId, c.get('userId')));
  if (existing) throw bad('This login already belongs to a company');
  const [u] = await db.select().from(user).where(eq(user.id, c.get('userId')));

  const result = await db.transaction(async (tx) => {
    const [co] = await tx.insert(companies).values({ name: companyName.trim() }).returning();
    const [emp] = await tx
      .insert(employees)
      .values({ companyId: co.id, userId: u.id, fullName: u.name, email: u.email.toLowerCase(), role: 'admin', employeeCode: 'E001' })
      .returning();
    await tx.insert(leaveTypes).values(DEFAULT_LEAVE_TYPES.map((t) => ({ ...t, companyId: co.id })));
    return { co, emp };
  });
  await audit(db, result.co.id, result.emp.id, 'create', 'company', result.co.id, { name: result.co.name });
  return c.json({ company: result.co, employee: result.emp });
});

app.post('/me/password-changed', requireEmployee, async (c) => {
  await c.get('db').update(employees).set({ mustChangePassword: false }).where(eq(employees.id, c.get('me').id));
  return c.json({ ok: true });
});

app.get('/company', requireEmployee, (c) => c.json(c.get('company')));

app.patch('/company', requireEmployee, requireRole('admin'), async (c) => {
  const body = await c.req.json<{ name?: string; weeklyOffs?: number[]; policyText?: string }>();
  const patch: Partial<typeof companies.$inferInsert> = {};
  if (body.name !== undefined) {
    if (!body.name.trim()) throw bad('Company name cannot be empty');
    patch.name = body.name.trim();
  }
  if (body.weeklyOffs !== undefined) {
    if (!Array.isArray(body.weeklyOffs) || body.weeklyOffs.some((d) => !Number.isInteger(d) || d < 0 || d > 6))
      throw bad('Weekly offs must be day numbers 0 (Sunday) to 6 (Saturday)');
    patch.weeklyOffs = [...new Set(body.weeklyOffs)].sort();
  }
  if (body.policyText !== undefined) {
    if (body.policyText.length > 60_000) throw bad('Policy text is too long (limit 60,000 characters)');
    patch.policyText = body.policyText;
  }
  const co = c.get('company');
  const [updated] = await c.get('db').update(companies).set(patch).where(eq(companies.id, co.id)).returning();
  await audit(c.get('db'), co.id, c.get('me').id, 'update', 'company', co.id, { fields: Object.keys(patch) });
  return c.json(updated);
});

export default app;
