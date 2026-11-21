import { Hono } from 'hono';
import { and, asc, eq, gte, lte } from 'drizzle-orm';
import { holidays } from '../db/schema';
import { type AppEnv, bad, notFound, requireEmployee, requireRole } from '../lib/context';
import { isValidDate, todayIST } from '../lib/dates';
import { audit } from '../lib/audit';

const app = new Hono<AppEnv>();
app.use('*', requireEmployee);

app.get('/', async (c) => {
  const year = Number(c.req.query('year')) || Number(todayIST().slice(0, 4));
  const rows = await c.get('db').select().from(holidays).where(and(
    eq(holidays.companyId, c.get('me').companyId),
    gte(holidays.date, `${year}-01-01`),
    lte(holidays.date, `${year}-12-31`),
  )).orderBy(asc(holidays.date));
  return c.json(rows);
});

app.post('/', requireRole('admin', 'hr'), async (c) => {
  const me = c.get('me');
  const b = await c.req.json<{ date?: string; name?: string }>();
  if (!isValidDate(b.date) || !b.name?.trim()) throw bad('Date (YYYY-MM-DD) and name are required');
  try {
    const [h] = await c.get('db').insert(holidays).values({ companyId: me.companyId, date: b.date, name: b.name.trim() }).returning();
    await audit(c.get('db'), me.companyId, me.id, 'create', 'holiday', h.id, b);
    return c.json(h);
  } catch {
    throw bad('There is already a holiday on this date');
  }
});

app.delete('/:id', requireRole('admin', 'hr'), async (c) => {
  const me = c.get('me');
  const [h] = await c.get('db').delete(holidays)
    .where(and(eq(holidays.id, c.req.param('id')), eq(holidays.companyId, me.companyId))).returning();
  if (!h) throw notFound('Holiday');
  await audit(c.get('db'), me.companyId, me.id, 'delete', 'holiday', h.id, { date: h.date, name: h.name });
  return c.json({ ok: true });
});

export default app;
