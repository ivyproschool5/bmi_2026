import { createMiddleware } from 'hono/factory';
import { HTTPException } from 'hono/http-exception';
import { and, eq } from 'drizzle-orm';
import { employees, companies } from '../db/schema';
import type { DB } from './db';
import type { Auth } from './auth';

export type Employee = typeof employees.$inferSelect;
export type Company = typeof companies.$inferSelect;
export type Role = Employee['role'];

export type AppEnv = {
  Bindings: Env;
  Variables: {
    db: DB;
    auth: Auth;
    userId: string;
    me: Employee;
    company: Company;
  };
};

/** Requires a logged-in user (may not belong to a company yet). */
export const requireUser = createMiddleware<AppEnv>(async (c, next) => {
  const session = await c.get('auth').api.getSession({ headers: c.req.raw.headers });
  if (!session) throw new HTTPException(401, { message: 'Please log in' });
  c.set('userId', session.user.id);
  await next();
});

/** Requires a logged-in user who is an active employee of a company. */
export const requireEmployee = createMiddleware<AppEnv>(async (c, next) => {
  const session = await c.get('auth').api.getSession({ headers: c.req.raw.headers });
  if (!session) throw new HTTPException(401, { message: 'Please log in' });
  const rows = await c
    .get('db')
    .select({ e: employees, co: companies })
    .from(employees)
    .innerJoin(companies, eq(companies.id, employees.companyId))
    .where(and(eq(employees.userId, session.user.id), eq(employees.status, 'active')))
    .limit(1);
  if (!rows[0]) throw new HTTPException(403, { message: 'No active employee profile for this login' });
  c.set('userId', session.user.id);
  c.set('me', rows[0].e);
  c.set('company', rows[0].co);
  await next();
});

export const isHR = (e: Employee) => e.role === 'admin' || e.role === 'hr';

export const requireRole = (...roles: Role[]) =>
  createMiddleware<AppEnv>(async (c, next) => {
    if (!roles.includes(c.get('me').role)) throw new HTTPException(403, { message: 'You do not have access to this' });
    await next();
  });

export const bad = (message: string) => new HTTPException(400, { message });
export const notFound = (what = 'Record') => new HTTPException(404, { message: `${what} not found` });
