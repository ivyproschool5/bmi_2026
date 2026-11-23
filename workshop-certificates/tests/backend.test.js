/* Backend tests: api/_lib/logic.js on the in-memory store.   node --test tests/ */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { handle, emailKey, todayIST } = require('../api/_lib/logic');
const { memoryStore } = require('../api/_lib/store');
const ADMIN = 'test-admin-key';

function setup() {
  const store = memoryStore();
  const call = (method, req) => handle(store, method, req, { adminKey: ADMIN });
  const admin = (action, data) => call('POST', Object.assign({ action: 'admin.' + action, adminKey: ADMIN }, data || {}));
  const create = (over) => admin('createWorkshop', {
    workshop: Object.assign({ programName: 'GenAI for Productivity', clientName: 'Acme Corp', showClient: false, date: todayIST(), trainer: 'Riya Sen', duration: '3 hours', bank: 'GENAI-WORKPLACE', passMark: 60, maxAttempts: 2 }, over || {})
  });
  const ws = async (code) => store.getJson('workshops/' + code + '.json');
  const keyFor = async (code) => { const w = await ws(code); const a = {}; w.questions.forEach((q) => { a[q.id] = q.correct; }); return { a, w }; };
  const wrongFor = async (code) => { const w = await ws(code); const a = {}; w.questions.forEach((q) => { a[q.id] = (q.correct + 1) % q.options.length; }); return a; };
  const count = (prefix) => [...store.data.keys()].filter((k) => k.startsWith(prefix)).length;
  return { store, call, admin, create, keyFor, wrongFor, count };
}
const person = (code, answers, over) => Object.assign({ action: 'submit', code, name: 'Ananya Iyer', email: 'ananya@example.com', consent: true, answers, rating: 5 }, over || {});

test('health check and unknown action', async () => {
  const { call } = setup();
  assert.equal((await call('GET', {})).ok, true);
  assert.equal((await call('GET', { action: 'nope' })).ok, false);
});

test('admin actions require the key and POST', async () => {
  const { call } = setup();
  assert.equal((await call('POST', { action: 'admin.workshops', adminKey: 'wrong' })).code, 'unauthorised');
  assert.equal((await call('GET', { action: 'admin.workshops', adminKey: ADMIN })).ok, false);
  assert.equal((await handle(memoryStore(), 'POST', { action: 'admin.ping', adminKey: '' }, { adminKey: '' })).code, 'unauthorised');
  assert.equal((await call('POST', { action: 'admin.ping', adminKey: ADMIN })).ok, true);
});

test('starter banks are listed; saving a bank validates and overrides', async () => {
  const { admin } = setup();
  let banks = (await admin('banks')).banks;
  assert.deepEqual(banks.map((b) => [b.id, b.count]), [['AI-FOR-LEADERS', 8], ['GENAI-WORKPLACE', 10]]);
  assert.equal((await admin('saveBank', { bank: { id: 'x', questions: [] } })).ok, false);
  assert.equal((await admin('saveBank', { bank: { id: 'PROMPT-BASICS', questions: [{ text: 'What is a prompt?', options: ['A', 'B'], correct: 5 }] } })).ok, false);
  const ok = await admin('saveBank', { bank: { id: 'prompt-basics', title: 'Prompt basics', questions: [{ text: 'What is a prompt?', options: ['An instruction', 'A GPU'], correct: 0, topic: 'Basics' }] } });
  assert.equal(ok.ok, true, JSON.stringify(ok));
  assert.equal(ok.bank.id, 'PROMPT-BASICS');
  banks = (await admin('banks')).banks;
  assert.equal(banks.length, 3);
  const got = await admin('getBank', { id: 'PROMPT-BASICS' });
  assert.equal(got.bank.questions[0].correct, 0);
  await admin('saveBank', { bank: { id: 'GENAI-WORKPLACE', title: 'Edited', questions: [{ text: 'Only question here', options: ['Yes', 'No'], correct: 0 }] } });
  const edited = (await admin('banks')).banks.find((b) => b.id === 'GENAI-WORKPLACE');
  assert.equal(edited.count, 1);
  assert.equal(edited.seed, false);
});

test('workshop creation validates; public fetch hides answers and unapproved client name', async () => {
  const { call, create } = setup();
  assert.equal((await create({ programName: 'AI' })).ok, false);
  assert.equal((await create({ bank: 'NOPE' })).ok, false);
  assert.equal((await create({ showClient: true, clientName: '' })).ok, false);
  const res = await create();
  assert.equal(res.ok, true, JSON.stringify(res));
  assert.match(res.workshop.code, /^[A-Z2-9]{6}$/);
  const pub = await call('GET', { action: 'workshop', code: res.workshop.code.toLowerCase() });
  assert.equal(pub.ok, true);
  assert.equal(pub.workshop.clientName, '');
  assert.equal(pub.questions.length, 10);
  pub.questions.forEach((q) => assert.equal(q.correct, undefined));
  assert.equal((await call('GET', { action: 'workshop', code: 'ZZZZZZ' })).code, 'not_found');
});

test('editing a bank later does not change an existing workshop', async () => {
  const { admin, create, call } = setup();
  const code = (await create()).workshop.code;
  await admin('saveBank', { bank: { id: 'GENAI-WORKPLACE', questions: [{ text: 'Only question here', options: ['Yes', 'No'], correct: 0 }] } });
  assert.equal((await call('GET', { action: 'workshop', code })).questions.length, 10);
});

test('pass gives Achievement; resubmitting returns the same certificate and writes nothing', async () => {
  const { call, create, keyFor, count } = setup();
  const code = (await create({ showClient: true })).workshop.code;
  const { a } = await keyFor(code);
  const r = await call('POST', person(code, a, { email: 'Ananya@Example.com', takeaway: 'Better prompts', optIn: true }));
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.result.outcome, 'achievement');
  assert.equal(r.result.percent, 100);
  assert.match(r.certificate.id, /^IVY-\d{4}-[A-Z2-9]{6}$/);
  assert.equal(r.certificate.clientName, 'Acme Corp');
  const again = await call('POST', person(code, a));
  assert.equal(again.alreadyIssued, true);
  assert.equal(again.certificate.id, r.certificate.id);
  assert.equal(count('subs/'), 1);
  assert.equal(count('certs/'), 1);
  const v = await call('GET', { action: 'verify', id: r.certificate.id.toLowerCase() });
  assert.equal(v.ok, true);
  assert.equal(v.certificate.name, 'Ananya Iyer');
  assert.equal(v.certificate.email, undefined, 'verify must not expose email');
  assert.equal((await call('GET', { action: 'verify', id: 'IVY-0000-AAAAAA' })).ok, false);
});

test('emails never appear in storage paths', async () => {
  const { store, call, create, keyFor } = setup();
  const code = (await create()).workshop.code;
  const { a } = await keyFor(code);
  await call('POST', person(code, a));
  for (const k of store.data.keys()) assert.ok(!k.includes('@') && !k.includes('ananya'), k);
  assert.ok(store.data.has('certidx/' + code + '/' + emailKey('ananya@example.com') + '.json'));
});

test('simultaneous submissions from the same email issue one certificate', async () => {
  const { call, create, keyFor, count } = setup();
  const code = (await create()).workshop.code;
  const { a } = await keyFor(code);
  const results = await Promise.all([1, 2, 3, 4].map(() => call('POST', person(code, a))));
  results.forEach((r) => assert.equal(r.ok, true, JSON.stringify(r)));
  assert.equal(new Set(results.map((r) => r.certificate.id)).size, 1);
  assert.equal(count('certs/'), 1);
});

test('fail with attempts left gives retry; final fail gives Participation', async () => {
  const { call, create, wrongFor, store } = setup();
  const code = (await create()).workshop.code;
  const wrong = await wrongFor(code);
  const r1 = await call('POST', person(code, wrong, { name: 'Kabir Das', email: 'kabir@example.com', rating: 3 }));
  assert.equal(r1.result.outcome, 'retry');
  assert.equal(r1.result.attemptsLeft, 1);
  assert.equal(r1.certificate, null);
  const r2 = await call('POST', person(code, wrong, { name: 'Kabir Das', email: 'kabir@example.com', rating: 3 }));
  assert.equal(r2.result.outcome, 'participation');
  assert.equal(r2.certificate.type, 'participation');
  const subs = [...store.data.keys()].filter((k) => k.startsWith('subs/'));
  assert.equal(subs.length, 2);
});

test('validation: missing answers, out-of-range answer, bad email, no consent, bad rating, bad name, GET submit', async () => {
  const { call, create, keyFor } = setup();
  const code = (await create()).workshop.code;
  const { a } = await keyFor(code);
  const partial = Object.assign({}, a); delete partial.q1;
  assert.equal((await call('POST', person(code, partial))).ok, false);
  assert.equal((await call('POST', person(code, Object.assign({}, a, { q1: 9 })))).ok, false);
  assert.equal((await call('POST', person(code, a, { email: 'nope' }))).ok, false);
  assert.equal((await call('POST', person(code, a, { consent: false }))).ok, false);
  assert.equal((await call('POST', person(code, a, { rating: 7 }))).ok, false);
  assert.equal((await call('POST', person(code, a, { name: '=HYPERLINK("x")' }))).ok, false);
  assert.equal((await call('GET', person(code, a))).ok, false);
});

test('closed and expired workshops refuse submissions', async () => {
  const { call, admin, create, keyFor } = setup();
  const code = (await create()).workshop.code;
  await admin('setStatus', { code, status: 'Closed' });
  assert.equal((await call('GET', { action: 'workshop', code })).workshop.open, false);
  const { a } = await keyFor(code);
  assert.equal((await call('POST', person(code, a))).code, 'closed');
  await admin('setStatus', { code, status: 'Active' });
  assert.equal((await call('POST', person(code, a))).ok, true);
  const old = (await create({ date: '2024-01-10', acceptUntil: '2024-01-12' })).workshop.code;
  assert.equal((await call('GET', { action: 'workshop', code: old })).workshop.open, false);
});

test('no-assessment workshop issues Participation directly', async () => {
  const { call, create } = setup();
  const code = (await create({ bank: 'NONE' })).workshop.code;
  const pub = await call('GET', { action: 'workshop', code });
  assert.equal(pub.workshop.hasAssessment, false);
  const r = await call('POST', person(code, {}, { name: 'Rohit Menon', email: 'rohit@example.com' }));
  assert.equal(r.result.outcome, 'participation');
  assert.ok(r.certificate.id);
});

test('stats: KPIs, first-attempt accuracy, TEST rows excluded; list counts', async () => {
  const { call, admin, create, keyFor, wrongFor } = setup();
  const code = (await create()).workshop.code;
  const { a } = await keyFor(code);
  const wrong = await wrongFor(code);
  await call('POST', person(code, a, { optIn: true }));
  await call('POST', person(code, wrong, { name: 'Kabir Das', email: 'k@example.com', rating: 3 }));
  await call('POST', person(code, a, { name: 'Kabir Das', email: 'k@example.com', rating: 4 }));
  await call('POST', person(code, a, { name: 'TEST Trainer', email: 't@example.com', rating: 1 }));
  const s = await admin('stats', { code });
  assert.equal(s.ok, true, JSON.stringify(s));
  assert.equal(s.kpis.participants, 2);
  assert.equal(s.kpis.testRowsExcluded, 1);
  assert.equal(s.kpis.achievements, 2);
  assert.equal(s.kpis.passRate, 100);
  assert.equal(s.kpis.avgFirstScore, 50);
  assert.equal(s.kpis.avgBestScore, 100);
  assert.equal(s.kpis.avgRating, 4.5);
  assert.equal(s.kpis.optIns, 1);
  s.questionStats.forEach((q) => assert.equal(q.pctCorrect, 50));
  assert.deepEqual(s.ratingDist, [0, 0, 0, 1, 1]);
  const list = await admin('workshops');
  assert.equal(list.workshops[0].participants, 3);
  assert.equal(list.workshops[0].certificates, 3);
});
