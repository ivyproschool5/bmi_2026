import { Hono } from 'hono';
import { and, asc, eq, gte } from 'drizzle-orm';
import { employees, holidays } from '../db/schema';
import { type AppEnv, bad, requireEmployee } from '../lib/context';
import { leaveBalances } from '../lib/leave';
import { todayIST } from '../lib/dates';

const app = new Hono<AppEnv>();
app.use('*', requireEmployee);

type Msg = { role: 'user' | 'assistant'; content: string };

/**
 * HR policy assistant. Answers from the company's policy text plus the asking
 * employee's own leave balances and upcoming holidays. Calls any OpenAI-compatible
 * endpoint: NVIDIA NIM by default; point AI_BASE_URL at Cloudflare AI Gateway or
 * another provider without changing code.
 */
app.post('/', async (c) => {
  if (!c.env.NVIDIA_API_KEY) throw bad('The HR assistant is not set up yet. Ask your admin to add an NVIDIA_API_KEY.');
  const me = c.get('me');
  const company = c.get('company');
  const db = c.get('db');
  const b = await c.req.json<{ question?: string; history?: Msg[] }>();
  const question = b.question?.trim();
  if (!question) throw bad('Please type a question');
  if (question.length > 1000) throw bad('Please keep the question under 1,000 characters');

  const today = todayIST();
  const [balances, hols, managerRow] = await Promise.all([
    leaveBalances(db, me.companyId, me.id, Number(today.slice(0, 4))),
    db.select().from(holidays).where(and(eq(holidays.companyId, me.companyId), gte(holidays.date, today))).orderBy(asc(holidays.date)).limit(10),
    me.managerId ? db.select({ name: employees.fullName }).from(employees).where(eq(employees.id, me.managerId)) : Promise.resolve([]),
  ]);

  const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const system = `You are the HR help desk assistant for ${company.name}. Today is ${today}.
Answer only from the company policy and employee data below. If the answer is not covered, say so plainly and suggest the employee contact HR. Do not invent rules, numbers or dates. Keep answers short and practical. Use plain Indian professional English.

EMPLOYEE: ${me.fullName}${me.designation ? `, ${me.designation}` : ''}${managerRow[0] ? `, reports to ${managerRow[0].name}` : ''}
LEAVE BALANCES (${today.slice(0, 4)}): ${balances.map((x) => `${x.name} (${x.code}): ${x.available} available, ${x.taken} taken, ${x.pending} pending, quota ${x.quota}`).join('; ') || 'none set up'}
WEEKLY OFFS: ${company.weeklyOffs.map((d) => days[d]).join(', ')}
UPCOMING HOLIDAYS: ${hols.map((h) => `${h.date} ${h.name}`).join('; ') || 'none listed'}

COMPANY POLICY:
${company.policyText || '(No policy document has been added yet.)'}`;

  const history = (b.history ?? []).filter((m) => (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string').slice(-6);
  const res = await fetch(`${c.env.AI_BASE_URL || 'https://integrate.api.nvidia.com/v1'}/chat/completions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${c.env.NVIDIA_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: c.env.AI_MODEL,
      temperature: 0.2,
      max_tokens: 600,
      messages: [{ role: 'system', content: system }, ...history.map((m) => ({ role: m.role, content: m.content.slice(0, 2000) })), { role: 'user', content: question }],
    }),
  });
  if (!res.ok) {
    console.error('AI error', res.status, await res.text());
    throw bad('The assistant could not answer right now. Please try again in a minute.');
  }
  const data = await res.json<{ choices?: { message?: { content?: string } }[] }>();
  return c.json({ answer: data.choices?.[0]?.message?.content?.trim() || 'No answer was returned.' });
});

export default app;
