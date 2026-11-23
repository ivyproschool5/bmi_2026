/* Ivy Workshop Certificates - backend logic (storage-agnostic).
 *
 * Storage layout (private Vercel Blob store):
 *   banks/<BANK-ID>.json                      question bank with answer keys (admin-editable)
 *   workshops/<CODE>.json                     workshop settings + a snapshot of its questions
 *   subs/<CODE>/<emailKey>/<iso>_<uuid>.json   one file per attempt, never overwritten
 *   certs/<CERT-ID>.json                      certificate register, never overwritten
 *   certidx/<CODE>/<emailKey>.json            one per participant per workshop; create-only, so
 *                                             two simultaneous submits cannot issue two certificates
 *
 * emailKey is a hash of the lower-cased email, so emails never appear in storage paths.
 * Scoring happens here; answer keys never leave the server except to the admin.
 */
'use strict';

const crypto = require('crypto');
const SEED_BANKS = require('./seed-banks');
const { ExistsError } = require('./store');

const APP_VERSION = '2.0';
const TZ = 'Asia/Kolkata';
const NO_ASSESSMENT = 'NONE';
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

/* ------------------------------------------------------------------ helpers */

class UserError extends Error {
  constructor(message, code) { super(message); this.userMessage = message; this.code = code || 'bad_request'; }
}

function todayIST(d) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d || new Date());
}
function yymmIST(d) { const t = todayIST(d); return t.slice(2, 4) + t.slice(5, 7); }
function addDays(iso, n) { const d = new Date(iso + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }
function isIsoDate(s) { return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(new Date(s + 'T00:00:00Z').getTime()); }
function randomCode(len) {
  const bytes = crypto.randomBytes(len);
  let s = '';
  for (let i = 0; i < len; i++) s += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length];
  return s;
}
function emailKey(email) { return crypto.createHash('sha256').update(email).digest('hex').slice(0, 32); }
function clean(v, max) { return String(v === undefined || v === null ? '' : v).replace(/\s+/g, ' ').trim().slice(0, max || 500); }
function isValidName(name) { return /^[\p{L}\p{M}][\p{L}\p{M} .'’-]{1,79}$/u.test(name); }
function isValidEmail(email) { return email.length <= 120 && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email); }
function normCode(code) {
  const c = String(code || '').trim().toUpperCase();
  if (!/^[A-Z0-9]{4,10}$/.test(c)) throw new UserError('That workshop code is not valid. Please scan the QR code again.', 'not_found');
  return c;
}
function normBankId(id) { return String(id || '').trim().toUpperCase(); }
function safeEqual(a, b) {
  const x = Buffer.from(String(a || '')), y = Buffer.from(String(b || ''));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}
async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let i = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) { const idx = i++; out[idx] = await fn(items[idx], idx); }
  });
  await Promise.all(workers);
  return out;
}

/* ------------------------------------------------------------------ banks */

function validateQuestions(questions) {
  if (!Array.isArray(questions) || questions.length === 0) throw new UserError('Add at least one question.');
  if (questions.length > 60) throw new UserError('A bank can have at most 60 questions.');
  return questions.map((q, i) => {
    const n = i + 1;
    const text = clean(q.text, 400);
    const options = (q.options || []).map((o) => clean(o, 250)).filter(Boolean);
    const correct = Number(q.correct);
    if (text.length < 5) throw new UserError('Question ' + n + ' is too short.');
    if (options.length < 2 || options.length > 4) throw new UserError('Question ' + n + ' needs 2 to 4 options.');
    if (!(correct >= 0 && correct < options.length && Math.floor(correct) === correct)) throw new UserError('Question ' + n + ' needs one correct option marked.');
    return { topic: clean(q.topic, 60), text, options, correct };
  });
}

async function getBank(store, id) {
  const saved = await store.getJson('banks/' + id + '.json');
  if (saved) return saved;
  return SEED_BANKS.find((b) => b.id === id) || null;
}

async function listBanks(store) {
  const paths = await store.list('banks/');
  const saved = await mapLimit(paths, 10, (p) => store.getJson(p.pathname));
  const byId = {};
  SEED_BANKS.forEach((b) => { byId[b.id] = Object.assign({ seed: true }, b); });
  saved.filter(Boolean).forEach((b) => { byId[b.id] = b; });
  return Object.values(byId).sort((a, b) => (a.id < b.id ? -1 : 1));
}

/* ------------------------------------------------------------------ workshops */

function workshopState(ws) {
  if (ws.status !== 'Active') return { open: false, reason: 'This assessment is closed. Please contact your trainer if you need help.' };
  if (ws.acceptUntil && todayIST() > ws.acceptUntil) return { open: false, reason: 'This assessment closed on ' + ws.acceptUntil + '. Please contact your trainer if you need help.' };
  return { open: true, reason: '' };
}

function publicWorkshop(ws) {
  const st = workshopState(ws);
  return {
    code: ws.code, programName: ws.programName, clientName: ws.showClient ? ws.clientName : '',
    date: ws.date, trainer: ws.trainer, duration: ws.duration, hasAssessment: ws.bank !== NO_ASSESSMENT,
    questionCount: ws.questions.length, passMark: ws.passMark, maxAttempts: ws.maxAttempts,
    open: st.open, closedReason: st.reason
  };
}

function adminWorkshop(ws, counts) {
  counts = counts || {};
  return {
    code: ws.code, createdAt: ws.createdAt, programName: ws.programName, clientName: ws.clientName,
    showClient: ws.showClient, date: ws.date, trainer: ws.trainer, duration: ws.duration, bank: ws.bank,
    passMark: ws.passMark, maxAttempts: ws.maxAttempts, acceptUntil: ws.acceptUntil, status: ws.status,
    open: workshopState(ws).open, questionCount: ws.questions.length,
    participants: counts.participants || 0, certificates: counts.certificates || 0
  };
}

async function loadWorkshop(store, code) {
  return store.getJson('workshops/' + code + '.json');
}

/* ------------------------------------------------------------------ certificates */

function publicCert(c) {
  return {
    id: c.id, type: c.type, name: c.name, programName: c.programName,
    clientName: c.showClient ? c.clientName : '', date: c.date, trainer: c.trainer,
    duration: c.duration, issuedAt: c.issuedAt
  };
}

/* ------------------------------------------------------------------ public API */

async function apiWorkshop(store, req) {
  const code = normCode(req.code);
  const ws = await loadWorkshop(store, code);
  if (!ws) throw new UserError('We could not find this workshop. Please check the link or scan the QR code again.', 'not_found');
  return {
    ok: true,
    workshop: publicWorkshop(ws),
    questions: ws.questions.map((q) => ({ id: q.id, topic: q.topic, text: q.text, options: q.options }))
  };
}

async function apiVerify(store, req) {
  const id = String(req.id || '').trim().toUpperCase();
  if (!/^IVY-\d{4}-[A-Z0-9]{6}$/.test(id)) throw new UserError('That does not look like an Ivy certificate ID.', 'not_found');
  const c = await store.getJson('certs/' + id + '.json');
  if (!c) throw new UserError('No certificate was found with this ID.', 'not_found');
  return { ok: true, certificate: publicCert(c) };
}

async function apiSubmit(store, req) {
  const code = normCode(req.code);
  const name = clean(req.name, 80);
  const email = String(req.email || '').trim().toLowerCase();
  const rating = Number(req.rating);
  const takeaway = clean(req.takeaway, 280);
  const optIn = req.optIn === true || req.optIn === 'true';
  let answers = req.answers || {};
  if (typeof answers === 'string') { try { answers = JSON.parse(answers); } catch (e) { answers = {}; } }

  if (!isValidName(name)) throw new UserError('Please enter your full name as it should appear on the certificate (letters only, 2 to 80 characters).', 'invalid');
  if (!isValidEmail(email)) throw new UserError('Please enter a valid email address.', 'invalid');
  if (!(req.consent === true || req.consent === 'true')) throw new UserError('Please confirm the consent statement to continue.', 'invalid');
  if (!(rating >= 1 && rating <= 5 && Math.floor(rating) === rating)) throw new UserError('Please rate the workshop from 1 to 5.', 'invalid');

  const ws = await loadWorkshop(store, code);
  if (!ws) throw new UserError('We could not find this workshop.', 'not_found');
  const state = workshopState(ws);
  if (!state.open) throw new UserError(state.reason, 'closed');

  const hasAssessment = ws.bank !== NO_ASSESSMENT;
  let score = 0;
  const answerLetters = {};
  const results = {};
  for (const q of ws.questions) {
    const a = answers[q.id];
    const idx = a === '' || a === null || a === undefined ? NaN : Number(a);
    if (!(idx >= 0 && idx < q.options.length && Math.floor(idx) === idx)) throw new UserError('Please answer every question before submitting.', 'invalid');
    answerLetters[q.id] = 'ABCD'[idx];
    results[q.id] = idx === q.correct ? 1 : 0;
    score += results[q.id];
  }
  const total = ws.questions.length;
  const percent = total ? Math.round((score / total) * 100) : 0;
  const ek = emailKey(email);
  const idxPath = 'certidx/' + code + '/' + ek + '.json';

  const already = await store.getJson(idxPath);
  if (already) return alreadyIssued(store, already.id, ws);

  const attempt = (await store.list('subs/' + code + '/' + ek + '/')).length + 1;
  let outcome;
  if (!hasAssessment) outcome = 'participation';
  else if (percent >= ws.passMark) outcome = 'achievement';
  else if (attempt < ws.maxAttempts) outcome = 'retry';
  else outcome = 'participation';

  const now = new Date();
  const submissionId = crypto.randomUUID();
  let cert = null;

  if (outcome !== 'retry') {
    // Claim the participant slot first. If another request got there first, return its certificate.
    let certId = 'IVY-' + yymmIST(now) + '-' + randomCode(6);
    try {
      await store.putJson(idxPath, { id: certId, at: now.toISOString() }, { overwrite: false });
    } catch (err) {
      if (err instanceof ExistsError) {
        const winner = await store.getJson(idxPath);
        if (winner) return alreadyIssued(store, winner.id, ws);
      }
      throw err;
    }
    cert = {
      id: certId, type: outcome, name, email, code, programName: ws.programName, clientName: ws.clientName,
      showClient: ws.showClient, date: ws.date, trainer: ws.trainer, duration: ws.duration,
      scorePct: hasAssessment ? percent : null, issuedAt: todayIST(now), issuedAtUtc: now.toISOString(),
      submissionId
    };
    for (let tries = 0; ; tries++) {
      try { await store.putJson('certs/' + cert.id + '.json', cert, { overwrite: false }); break; }
      catch (err) {
        if (!(err instanceof ExistsError) || tries > 4) throw err;
        cert.id = 'IVY-' + yymmIST(now) + '-' + randomCode(6); // ID collision: pick another
        await store.putJson(idxPath, { id: cert.id, at: now.toISOString() }, { overwrite: true });
      }
    }
  }

  await store.putJson('subs/' + code + '/' + ek + '/' + now.toISOString().replace(/[:.]/g, '-') + '_' + submissionId + '.json', {
    submissionId, submittedAt: now.toISOString(), code, name, email, attempt,
    score: hasAssessment ? score : null, total: hasAssessment ? total : null, percent: hasAssessment ? percent : null,
    outcome, answers: answerLetters, results, rating, takeaway, optIn,
    certId: cert ? cert.id : '', certType: cert ? cert.type : '', version: APP_VERSION
  }, { overwrite: false });

  return {
    ok: true,
    result: {
      outcome, hasAssessment, score, total, percent, passMark: ws.passMark, attempt,
      attemptsLeft: outcome === 'retry' ? ws.maxAttempts - attempt : 0
    },
    certificate: cert ? publicCert(cert) : null
  };
}

async function alreadyIssued(store, certId, ws) {
  const c = await store.getJson('certs/' + certId + '.json');
  if (!c) throw new UserError('Your certificate is being issued. Please try again in a few seconds.', 'retry_later');
  return {
    ok: true,
    alreadyIssued: true,
    result: { outcome: c.type, hasAssessment: ws.bank !== NO_ASSESSMENT, percent: c.scorePct, passMark: ws.passMark },
    certificate: publicCert(c)
  };
}

/* ------------------------------------------------------------------ admin API */

async function adminBanks(store) {
  const banks = await listBanks(store);
  return {
    ok: true,
    banks: banks.map((b) => ({
      id: b.id, title: b.title || '', count: b.questions.length, seed: !!b.seed, updatedAt: b.updatedAt || '',
      topics: [...new Set(b.questions.map((q) => q.topic).filter(Boolean))]
    }))
  };
}

async function adminGetBank(store, req) {
  const id = normBankId(req.id);
  const b = await getBank(store, id);
  if (!b) throw new UserError('Question bank not found.');
  return { ok: true, bank: b };
}

async function adminSaveBank(store, req) {
  const b = req.bank || {};
  const id = normBankId(b.id);
  if (!/^[A-Z0-9][A-Z0-9-]{2,39}$/.test(id) || id === NO_ASSESSMENT) throw new UserError('Bank ID must be 3 to 40 characters: capital letters, numbers and hyphens, e.g. PROMPT-BASICS.');
  const title = clean(b.title, 100);
  const questions = validateQuestions(b.questions);
  const existing = await store.getJson('banks/' + id + '.json');
  const record = { id, title, questions, createdAt: existing ? existing.createdAt : new Date().toISOString(), updatedAt: new Date().toISOString() };
  await store.putJson('banks/' + id + '.json', record, { overwrite: true });
  return { ok: true, bank: record };
}

async function adminCreateWorkshop(store, req) {
  const w = req.workshop || {};
  const programName = clean(w.programName, 200);
  const clientName = clean(w.clientName, 200);
  const showClient = w.showClient === true || w.showClient === 'true';
  const date = String(w.date || '').trim();
  const trainer = clean(w.trainer, 100);
  const duration = clean(w.duration, 60);
  const bankId = normBankId(w.bank) || NO_ASSESSMENT;
  let passMark = Number(w.passMark);
  let maxAttempts = Number(w.maxAttempts);
  let acceptUntil = String(w.acceptUntil || '').trim();

  if (programName.length < 3 || programName.length > 120) throw new UserError('Program name must be 3 to 120 characters.');
  if (clientName.length > 120) throw new UserError('Client name is too long.');
  if (showClient && !clientName) throw new UserError('Add the client name, or untick "Show client name".');
  if (!isIsoDate(date)) throw new UserError('Workshop date is required.');
  if (trainer.length > 80) throw new UserError('Trainer name is too long.');
  if (duration.length > 40) throw new UserError('Duration is too long.');
  if (!acceptUntil) acceptUntil = addDays(date, 3);
  if (!isIsoDate(acceptUntil) || acceptUntil < date) throw new UserError('"Accept submissions until" must be on or after the workshop date.');

  let questions = [];
  if (bankId !== NO_ASSESSMENT) {
    const bank = await getBank(store, bankId);
    if (!bank || !bank.questions.length) throw new UserError('That question bank has no questions.');
    if (!(passMark >= 0 && passMark <= 100)) throw new UserError('Pass mark must be between 0 and 100.');
    if (!(maxAttempts >= 1 && maxAttempts <= 5)) throw new UserError('Attempts must be between 1 and 5.');
    // Snapshot the questions so later edits to the bank never change a running workshop.
    questions = bank.questions.map((q, i) => ({ id: 'q' + (i + 1), topic: q.topic, text: q.text, options: q.options, correct: q.correct }));
  } else {
    passMark = 0;
    maxAttempts = 1;
  }

  const record = {
    code: '', createdAt: new Date().toISOString(), programName, clientName, showClient, date, trainer, duration,
    bank: bankId, passMark: Math.round(passMark), maxAttempts: Math.round(maxAttempts), acceptUntil, status: 'Active', questions
  };
  for (let tries = 0; ; tries++) {
    record.code = randomCode(6);
    try { await store.putJson('workshops/' + record.code + '.json', record, { overwrite: false }); break; }
    catch (err) { if (!(err instanceof ExistsError) || tries > 5) throw err; }
  }
  return { ok: true, workshop: adminWorkshop(record) };
}

async function participantCounts(store) {
  const [subs, idx] = await Promise.all([store.list('subs/'), store.list('certidx/')]);
  const counts = {};
  const bucket = (code) => (counts[code] = counts[code] || { people: new Set(), participants: 0, certificates: 0 });
  subs.forEach((s) => { const p = s.pathname.split('/'); bucket(p[1]).people.add(p[2]); });
  idx.forEach((s) => { bucket(s.pathname.split('/')[1]).certificates++; });
  Object.values(counts).forEach((c) => { c.participants = c.people.size; });
  return counts;
}

async function adminWorkshops(store) {
  const paths = await store.list('workshops/');
  const [list, counts] = await Promise.all([mapLimit(paths, 10, (p) => store.getJson(p.pathname)), participantCounts(store)]);
  const out = list.filter(Boolean)
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
    .map((ws) => adminWorkshop(ws, counts[ws.code]));
  return { ok: true, workshops: out };
}

async function adminSetStatus(store, req) {
  const code = normCode(req.code);
  const ws = await loadWorkshop(store, code);
  if (!ws) throw new UserError('Workshop not found.');
  ws.status = req.status === 'Closed' ? 'Closed' : 'Active';
  await store.putJson('workshops/' + code + '.json', ws, { overwrite: true });
  return { ok: true, workshop: adminWorkshop(ws) };
}

async function adminStats(store, req) {
  const code = normCode(req.code);
  const ws = await loadWorkshop(store, code);
  if (!ws) throw new UserError('Workshop not found.');
  const paths = await store.list('subs/' + code + '/');
  const subs = (await mapLimit(paths, 15, (p) => store.getJson(p.pathname))).filter(Boolean)
    .sort((a, b) => (a.submittedAt < b.submittedAt ? -1 : 1));

  const certIdx = await store.list('certidx/' + code + '/');
  const certIds = await mapLimit(certIdx, 15, (p) => store.getJson(p.pathname));
  const certs = (await mapLimit(certIds.filter(Boolean), 15, (x) => store.getJson('certs/' + x.id + '.json'))).filter(Boolean);
  const certByEmail = {};
  certs.forEach((c) => { certByEmail[c.email] = c; });

  const people = {};
  const order = [];
  subs.forEach((s) => {
    let p = people[s.email];
    if (!p) {
      p = people[s.email] = { email: s.email, attempts: 0, firstScore: s.percent, bestScore: s.percent, first: s.results || {}, rating: null, takeaway: '', optIn: false };
      order.push(s.email);
    }
    p.name = s.name;
    p.attempts++;
    if (s.percent !== null && (p.bestScore === null || s.percent > p.bestScore)) p.bestScore = s.percent;
    p.rating = s.rating || p.rating;
    p.takeaway = s.takeaway || p.takeaway;
    p.optIn = p.optIn || !!s.optIn;
    p.lastAt = s.submittedAt;
  });

  const participants = order.map((e) => {
    const p = people[e];
    const c = certByEmail[e];
    p.isTest = /^test/i.test(p.name);
    p.certId = c ? c.id : '';
    p.certType = c ? (c.type === 'achievement' ? 'Achievement' : 'Participation') : '';
    return p;
  });
  const real = participants.filter((p) => !p.isTest);
  const avg = (a) => (a.length ? Math.round((a.reduce((s, x) => s + x, 0) / a.length) * 10) / 10 : null);
  const hasA = ws.bank !== NO_ASSESSMENT;
  const achievements = real.filter((p) => p.certType === 'Achievement').length;
  const ratingDist = [0, 0, 0, 0, 0];
  real.forEach((p) => { if (p.rating >= 1 && p.rating <= 5) ratingDist[p.rating - 1]++; });

  return {
    ok: true,
    workshop: adminWorkshop(ws),
    kpis: {
      participants: real.length,
      testRowsExcluded: participants.length - real.length,
      certificates: real.filter((p) => p.certId).length,
      achievements,
      participations: real.filter((p) => p.certType === 'Participation').length,
      passRate: real.length && hasA ? Math.round((achievements / real.length) * 100) : null,
      avgFirstScore: avg(real.map((p) => p.firstScore).filter((x) => x !== null)),
      avgBestScore: avg(real.map((p) => p.bestScore).filter((x) => x !== null)),
      avgRating: avg(real.map((p) => p.rating).filter(Boolean)),
      optIns: real.filter((p) => p.optIn).length
    },
    questionStats: ws.questions.map((q) => {
      let n = 0, right = 0;
      real.forEach((p) => { if (p.first && Object.prototype.hasOwnProperty.call(p.first, q.id)) { n++; right += p.first[q.id] === 1 ? 1 : 0; } });
      return { id: q.id, topic: q.topic, text: q.text, answered: n, pctCorrect: n ? Math.round((right / n) * 100) : null };
    }),
    ratingDist,
    participants: participants.map((p) => ({
      name: p.name, email: p.email, attempts: p.attempts, firstScore: p.firstScore, bestScore: p.bestScore,
      rating: p.rating, takeaway: p.takeaway, optIn: p.optIn, certId: p.certId, certType: p.certType, isTest: p.isTest, lastAt: p.lastAt
    }))
  };
}

/* ------------------------------------------------------------------ dispatcher */

const PUBLIC = { workshop: apiWorkshop, verify: apiVerify };
const ADMIN = {
  'admin.ping': async () => ({ ok: true, version: APP_VERSION }),
  'admin.banks': adminBanks,
  'admin.getBank': adminGetBank,
  'admin.saveBank': adminSaveBank,
  'admin.createWorkshop': adminCreateWorkshop,
  'admin.workshops': adminWorkshops,
  'admin.setStatus': adminSetStatus,
  'admin.stats': adminStats
};

/**
 * @param store   storage implementation
 * @param method  'GET' or 'POST'
 * @param req     merged query + body fields
 * @param env     { adminKey }
 */
async function handle(store, method, req, env) {
  try {
    const action = String(req.action || '');
    if (!action) return { ok: true, service: 'Ivy workshop certificates', version: APP_VERSION };
    if (PUBLIC[action]) return await PUBLIC[action](store, req);
    if (action === 'submit') {
      if (method !== 'POST') throw new UserError('Submissions must be sent with POST.');
      return await apiSubmit(store, req);
    }
    if (ADMIN[action]) {
      if (method !== 'POST') throw new UserError('Admin requests must be sent with POST.');
      if (!env || !env.adminKey) throw new UserError('Admin key is not configured on the server.', 'unauthorised');
      if (!safeEqual(req.adminKey, env.adminKey)) throw new UserError('Admin key is incorrect.', 'unauthorised');
      return await ADMIN[action](store, req);
    }
    throw new UserError('Unknown action.');
  } catch (err) {
    if (err && err.userMessage) return { ok: false, error: err.userMessage, code: err.code };
    console.error(err && err.stack ? err.stack : err);
    return { ok: false, error: 'Something went wrong on our side. Please try again in a moment.', code: 'server_error' };
  }
}

module.exports = { handle, emailKey, todayIST, APP_VERSION };
