import { Hono } from 'hono';
import { and, desc, eq } from 'drizzle-orm';
import { documents, employees } from '../db/schema';
import { type AppEnv, type Employee, bad, isHR, notFound, requireEmployee } from '../lib/context';
import { audit } from '../lib/audit';

const app = new Hono<AppEnv>();
app.use('*', requireEmployee);

const MAX_BYTES = 10 * 1024 * 1024;
const ALLOWED = new Set([
  'application/pdf', 'image/jpeg', 'image/png', 'image/webp',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
]);

// Documents are private: only the employee and HR/admin can see them.
const canAccess = (me: Employee, employeeId: string) => me.id === employeeId || isHR(me);

app.get('/', async (c) => {
  const me = c.get('me');
  const employeeId = c.req.query('employeeId') || me.id;
  if (!canAccess(me, employeeId)) throw bad('You cannot view these documents');
  const rows = await c.get('db').select().from(documents)
    .where(and(eq(documents.companyId, me.companyId), eq(documents.employeeId, employeeId)))
    .orderBy(desc(documents.createdAt));
  return c.json(rows.map(({ r2Key: _k, ...d }) => d));
});

app.post('/', async (c) => {
  const me = c.get('me');
  const db = c.get('db');
  const form = await c.req.formData();
  const file = form.get('file');
  const employeeId = String(form.get('employeeId') || me.id);
  if (!(file instanceof File)) throw bad('Choose a file to upload');
  if (!canAccess(me, employeeId)) throw bad('You cannot upload documents for this employee');
  if (file.size > MAX_BYTES) throw bad('File is larger than 10 MB');
  if (!ALLOWED.has(file.type)) throw bad('Only PDF, JPG, PNG, WEBP and DOCX files are allowed');
  const [emp] = await db.select({ id: employees.id }).from(employees)
    .where(and(eq(employees.id, employeeId), eq(employees.companyId, me.companyId)));
  if (!emp) throw notFound('Employee');

  const name = (String(form.get('name') || '') || file.name).slice(0, 200);
  const safe = file.name.replace(/[^\w.-]+/g, '_').slice(-80);
  const key = `${me.companyId}/${employeeId}/${crypto.randomUUID()}-${safe}`;
  await c.env.DOCS.put(key, file.stream(), { httpMetadata: { contentType: file.type } });
  const [doc] = await db.insert(documents).values({
    companyId: me.companyId, employeeId, name, r2Key: key, contentType: file.type, size: file.size, uploadedBy: me.id,
  }).returning();
  await audit(db, me.companyId, me.id, 'upload', 'document', doc.id, { employeeId, name });
  const { r2Key: _k, ...out } = doc;
  return c.json(out);
});

app.get('/:id/download', async (c) => {
  const me = c.get('me');
  const [doc] = await c.get('db').select().from(documents)
    .where(and(eq(documents.id, c.req.param('id')), eq(documents.companyId, me.companyId)));
  if (!doc || !canAccess(me, doc.employeeId)) throw notFound('Document');
  const obj = await c.env.DOCS.get(doc.r2Key);
  if (!obj) throw notFound('File');
  return new Response(obj.body, {
    headers: {
      'Content-Type': doc.contentType ?? 'application/octet-stream',
      'Content-Disposition': `attachment; filename="${doc.r2Key.split('/').pop()!.slice(37) || 'document'}"`,
      'Cache-Control': 'private, no-store',
    },
  });
});

app.delete('/:id', async (c) => {
  const me = c.get('me');
  if (!isHR(me)) throw bad('Only HR can delete documents');
  const db = c.get('db');
  const [doc] = await db.delete(documents)
    .where(and(eq(documents.id, c.req.param('id')), eq(documents.companyId, me.companyId))).returning();
  if (!doc) throw notFound('Document');
  await c.env.DOCS.delete(doc.r2Key);
  await audit(db, me.companyId, me.id, 'delete', 'document', doc.id, { employeeId: doc.employeeId, name: doc.name });
  return c.json({ ok: true });
});

export default app;
