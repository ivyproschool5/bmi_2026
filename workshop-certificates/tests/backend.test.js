/* Backend tests: run Code.gs against fake Google services.  node --test tests/ */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadBackend } = require('./fake-google');

function setupBackend() {
  const b = loadBackend();
  b.sandbox.setup();
  const call = (method, payload) => {
    const out = method === 'GET'
      ? b.sandbox.doGet({ parameter: payload })
      : b.sandbox.doPost({ parameter: { payload: JSON.stringify(payload) }, postData: { type: 'application/x-www-form-urlencoded', contents: '' } });
    return JSON.parse(out.content);
  };
  const key = b.props.ADMIN_KEY;
  const sheet = (n) => b.ss.getSheetByName(n);
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());
  const create = (over) => call('POST', {
    action: 'admin.createWorkshop', adminKey: key,
    workshop: Object.assign({ programName: 'GenAI for Productivity', clientName: 'Acme Corp', showClient: false, date: today, trainer: 'Riya Sen', duration: '3 hours', bank: 'GENAI-WORKPLACE', passMark: 60, maxAttempts: 2 }, over || {})
  });
  return { b, call, key, sheet, create, today };
}

function correctAnswers(b, bank) {
  const qs = b.sandbox.getBankQuestions_(bank);
  const a = {};
  qs.forEach((q) => { a[q.id] = q.correct; });
  return { qs, a };
}

test('setup creates tabs, timezone, admin key and seed questions', () => {
  const { b, sheet } = setupBackend();
  assert.equal(b.ss.tz, 'Asia/Calcutta');
  ['Workshops', 'Question Bank', 'Submissions', 'Certificates'].forEach((n) => assert.ok(sheet(n), n));
  assert.equal(b.ss.getSheetByName('Sheet1'), null);
  assert.match(b.props.ADMIN_KEY, /^[a-f0-9]{20}$/);
  assert.equal(sheet('Question Bank').getLastRow(), 19);
  assert.equal(b.sandbox.getBankQuestions_('GENAI-WORKPLACE').length, 10);
  assert.equal(b.sandbox.getBankQuestions_('AI-FOR-LEADERS').length, 8);
  // running setup twice must not duplicate questions or reset the key
  const k = b.props.ADMIN_KEY;
  b.sandbox.setup();
  assert.equal(sheet('Question Bank').getLastRow(), 19);
  assert.equal(b.props.ADMIN_KEY, k);
});

test('admin actions require the key and POST', () => {
  const { call, key } = setupBackend();
  assert.equal(call('POST', { action: 'admin.workshops', adminKey: 'wrong' }).code, 'unauthorised');
  assert.equal(call('GET', { action: 'admin.workshops', adminKey: key }).ok, false);
  assert.equal(call('POST', { action: 'admin.ping', adminKey: key }).ok, true);
});

test('workshop creation validates and public fetch hides answers and client name', () => {
  const { call, create } = setupBackend();
  assert.equal(create({ programName: 'AI' }).ok, false);
  assert.equal(create({ bank: 'NOPE' }).ok, false);
  const res = create();
  assert.equal(res.ok, true);
  const code = res.workshop.code;
  assert.match(code, /^[A-Z2-9]{6}$/);
  const pub = call('GET', { action: 'workshop', code });
  assert.equal(pub.ok, true);
  assert.equal(pub.workshop.clientName, '');
  assert.equal(pub.questions.length, 10);
  pub.questions.forEach((q) => assert.equal(q.correct, undefined));
  assert.equal(call('GET', { action: 'workshop', code: 'ZZZZZZ' }).code, 'not_found');
});

test('pass issues an Achievement certificate; resubmitting returns the same one', () => {
  const { b, call, create, sheet } = setupBackend();
  const code = create({ showClient: true }).workshop.code;
  const { a } = correctAnswers(b, 'GENAI-WORKPLACE');
  const body = { action: 'submit', code, name: 'Ananya Iyer', email: 'Ananya@Example.com', consent: true, answers: a, rating: 5, takeaway: 'Better prompts', optIn: true };
  const r = call('POST', body);
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.result.outcome, 'achievement');
  assert.equal(r.result.percent, 100);
  assert.match(r.certificate.id, /^IVY-\d{4}-[A-Z2-9]{6}$/);
  assert.equal(r.certificate.clientName, 'Acme Corp');
  assert.equal(r.certificate.type, 'achievement');

  const again = call('POST', body);
  assert.equal(again.alreadyIssued, true);
  assert.equal(again.certificate.id, r.certificate.id);
  assert.equal(sheet('Submissions').getLastRow(), 2, 'second submit must not add a row');
  assert.equal(sheet('Certificates').getLastRow(), 2);

  const v = call('GET', { action: 'verify', id: r.certificate.id.toLowerCase() });
  assert.equal(v.ok, true);
  assert.equal(v.certificate.name, 'Ananya Iyer');
  assert.equal(v.certificate.email, undefined, 'verify must not expose email');
  assert.equal(v.certificate.date, b.sandbox.toIsoDate_(sheet('Certificates').data[1][9]));
});

test('fail with attempts left gives retry; final fail gives Participation', () => {
  const { b, call, create, sheet } = setupBackend();
  const code = create().workshop.code;
  const { qs } = correctAnswers(b, 'GENAI-WORKPLACE');
  const wrong = {};
  qs.forEach((q) => { wrong[q.id] = (q.correct + 1) % q.options.length; });
  const body = { action: 'submit', code, name: 'Kabir Das', email: 'kabir@example.com', consent: true, answers: wrong, rating: 3 };
  const r1 = call('POST', body);
  assert.equal(r1.result.outcome, 'retry');
  assert.equal(r1.result.attemptsLeft, 1);
  assert.equal(r1.certificate, null);
  const r2 = call('POST', body);
  assert.equal(r2.result.outcome, 'participation');
  assert.equal(r2.certificate.type, 'participation');
  assert.equal(sheet('Submissions').getLastRow(), 3);
  const row = sheet('Submissions').data[2];
  assert.equal(row[9], 2, 'attempt number');
  assert.equal(row[13], 'Below pass mark - final attempt');
});

test('validation: missing answers, bad email, no consent, bad rating', () => {
  const { b, call, create } = setupBackend();
  const code = create().workshop.code;
  const { qs, a } = correctAnswers(b, 'GENAI-WORKPLACE');
  const base = { action: 'submit', code, name: 'Meera Nair', email: 'meera@example.com', consent: true, answers: a, rating: 4 };
  const partial = Object.assign({}, a); delete partial[qs[0].id];
  assert.equal(call('POST', Object.assign({}, base, { answers: partial })).ok, false);
  assert.equal(call('POST', Object.assign({}, base, { answers: Object.assign({}, a, { [qs[0].id]: 9 }) })).ok, false);
  assert.equal(call('POST', Object.assign({}, base, { email: 'nope' })).ok, false);
  assert.equal(call('POST', Object.assign({}, base, { consent: false })).ok, false);
  assert.equal(call('POST', Object.assign({}, base, { rating: 7 })).ok, false);
  assert.equal(call('POST', Object.assign({}, base, { name: '=HYPERLINK("x")' })).ok, false);
  assert.equal(call('GET', base).ok, false, 'submit over GET is refused');
});

test('formula-leading text is neutralised before writing', () => {
  const { b } = setupBackend();
  assert.equal(b.sandbox.safe_('=SUM(A1)'), "'=SUM(A1)");
  assert.equal(b.sandbox.safe_('+91'), "'+91");
  assert.equal(b.sandbox.safe_('@x'), "'@x");
  assert.equal(b.sandbox.safe_('Hello'), 'Hello');
});

test('takeaway starting with = is stored as text', () => {
  const { b, call, create, sheet } = setupBackend();
  const code = create().workshop.code;
  const { a } = correctAnswers(b, 'GENAI-WORKPLACE');
  call('POST', { action: 'submit', code, name: 'Sara Khan', email: 'sara@example.com', consent: true, answers: a, rating: 4, takeaway: '=IMPORTXML("http://x")' });
  assert.equal(sheet('Submissions').data[1][17], '=IMPORTXML("http://x")'); // fake strips the apostrophe exactly like Sheets
});

test('closed and expired workshops refuse submissions', () => {
  const { b, call, create, key } = setupBackend();
  const code = create().workshop.code;
  call('POST', { action: 'admin.setStatus', adminKey: key, code, status: 'Closed' });
  const pub = call('GET', { action: 'workshop', code });
  assert.equal(pub.workshop.open, false);
  const { a } = correctAnswers(b, 'GENAI-WORKPLACE');
  const r = call('POST', { action: 'submit', code, name: 'Late Person', email: 'late@example.com', consent: true, answers: a, rating: 4 });
  assert.equal(r.code, 'closed');
  const old = create({ date: '2024-01-10', acceptUntil: '2024-01-12' }).workshop.code;
  assert.equal(call('GET', { action: 'workshop', code: old }).workshop.open, false);
});

test('no-assessment workshop issues Participation directly', () => {
  const { call, create } = setupBackend();
  const code = create({ bank: 'NONE' }).workshop.code;
  const pub = call('GET', { action: 'workshop', code });
  assert.equal(pub.workshop.hasAssessment, false);
  const r = call('POST', { action: 'submit', code, name: 'Rohit Menon', email: 'rohit@example.com', consent: true, answers: {}, rating: 5 });
  assert.equal(r.result.outcome, 'participation');
  assert.ok(r.certificate.id);
});

test('stats: KPIs, question accuracy from first attempts, test rows excluded', () => {
  const { b, call, create, key } = setupBackend();
  const code = create().workshop.code;
  const { qs, a } = correctAnswers(b, 'GENAI-WORKPLACE');
  const wrong = {}; qs.forEach((q) => { wrong[q.id] = (q.correct + 1) % q.options.length; });
  call('POST', { action: 'submit', code, name: 'Ananya Iyer', email: 'a@example.com', consent: true, answers: a, rating: 5, optIn: true });
  call('POST', { action: 'submit', code, name: 'Kabir Das', email: 'k@example.com', consent: true, answers: wrong, rating: 3 });
  call('POST', { action: 'submit', code, name: 'Kabir Das', email: 'k@example.com', consent: true, answers: a, rating: 4 });
  call('POST', { action: 'submit', code, name: 'TEST Trainer', email: 't@example.com', consent: true, answers: a, rating: 1 });
  const s = call('POST', { action: 'admin.stats', adminKey: key, code });
  assert.equal(s.ok, true);
  assert.equal(s.kpis.participants, 2);
  assert.equal(s.kpis.testRowsExcluded, 1);
  assert.equal(s.kpis.achievements, 2);
  assert.equal(s.kpis.passRate, 100);
  assert.equal(s.kpis.avgFirstScore, 50);
  assert.equal(s.kpis.avgBestScore, 100);
  assert.equal(s.kpis.avgRating, 4.5);
  assert.equal(s.kpis.optIns, 1);
  assert.equal(s.questionStats.length, 10);
  s.questionStats.forEach((q) => assert.equal(q.pctCorrect, 50));
  assert.deepEqual(s.ratingDist, [0, 0, 0, 1, 1]);
  const list = call('POST', { action: 'admin.workshops', adminKey: key });
  assert.equal(list.workshops[0].participants, 3);
  assert.equal(list.workshops[0].certificates, 3);
});

test('dates survive Sheets auto-conversion', () => {
  const { b, sheet, create, today } = setupBackend();
  create();
  // Simulate a sheet where text format was lost: the fake turns ISO strings into Date objects.
  const row = sheet('Workshops').data[1];
  row[5] = new Date(today + 'T00:00:00+05:30');
  const w = b.sandbox.listWorkshops_()[0];
  assert.equal(w.date, today);
});
