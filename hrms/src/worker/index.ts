import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { createDb } from './lib/db';
import { createAuth } from './lib/auth';
import type { AppEnv } from './lib/context';
import account from './routes/account';
import employeesRoute from './routes/employees';
import leave from './routes/leave';
import holidaysRoute from './routes/holidays';
import attendanceRoute from './routes/attendance';
import documentsRoute from './routes/documents';
import assistant from './routes/assistant';
import dashboard from './routes/dashboard';

const app = new Hono<AppEnv>();

// One database connection and auth instance per request.
app.use('/api/*', async (c, next) => {
  const { db, sql } = createDb(c.env);
  c.set('db', db);
  c.set('auth', createAuth(c.env, db, c.req.url));
  try {
    await next();
  } finally {
    c.executionCtx.waitUntil(sql.end({ timeout: 5 }));
  }
});

app.on(['GET', 'POST'], '/api/auth/*', (c) => c.get('auth').handler(c.req.raw));

app.get('/api/health', (c) => c.json({ ok: true }));
app.route('/api', account);
app.route('/api/employees', employeesRoute);
app.route('/api/leave', leave);
app.route('/api/holidays', holidaysRoute);
app.route('/api/attendance', attendanceRoute);
app.route('/api/documents', documentsRoute);
app.route('/api/assistant', assistant);
app.route('/api/dashboard', dashboard);

app.notFound((c) => c.json({ error: 'Not found' }, 404));
app.onError((err, c) => {
  if (err instanceof HTTPException) return c.json({ error: err.message }, err.status);
  console.error(err);
  return c.json({ error: 'Something went wrong. Please try again.' }, 500);
});

export default app;
