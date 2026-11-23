/**
 * Ivy Professional School - Workshop Assessment and Certificate backend
 * ---------------------------------------------------------------------
 * Bound Google Apps Script for a Google Sheet. Paste this whole file into
 * Extensions > Apps Script, run setup() once, then deploy as a Web app
 * (Execute as: Me, Who has access: Anyone). See README.md for the click-path.
 *
 * Tabs created by setup():
 *   Workshops      one row per workshop you run (created from the admin page)
 *   Question Bank  assessment questions, grouped by Bank ID (edit freely)
 *   Submissions    append-only log of every assessment attempt
 *   Certificates   append-only register of every certificate issued
 *
 * Rules this script keeps:
 *   - Submissions and Certificates are append-only. Nothing is ever edited,
 *     sorted or deleted by the script.
 *   - Scoring happens here, not in the browser, so answer keys never reach
 *     participants.
 *   - Every write runs inside a script lock.
 */

var APP_VERSION = '1.0';
var TZ = 'Asia/Calcutta';
var NO_ASSESSMENT = 'NONE';
var CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // no 0/O, 1/I/L

var SHEET = {
  WORKSHOPS: 'Workshops',
  BANK: 'Question Bank',
  SUBMISSIONS: 'Submissions',
  CERTS: 'Certificates'
};

var HEADERS = {
  WORKSHOPS: ['Created At', 'Workshop Code', 'Program Name', 'Client Name', 'Show Client On Certificate',
    'Workshop Date', 'Trainer', 'Duration', 'Question Bank', 'Pass Mark %', 'Max Attempts',
    'Accept Until', 'Status'],
  BANK: ['Bank ID', 'Question ID', 'Topic', 'Question', 'Option A', 'Option B', 'Option C', 'Option D',
    'Correct Option', 'Active'],
  SUBMISSIONS: ['Timestamp', 'Submission ID', 'Submitted At (UTC)', 'Workshop Code', 'Program Name',
    'Client Name', 'Workshop Date', 'Participant Name', 'Email', 'Attempt', 'Score', 'Total Questions',
    'Score %', 'Result', 'Answers', 'Question Results', 'Rating (1-5)', 'Key Takeaway',
    'Ivy Updates Opt-in', 'Certificate ID', 'Certificate Type', 'App Version'],
  CERTS: ['Issued At', 'Certificate ID', 'Certificate Type', 'Participant Name', 'Email', 'Workshop Code',
    'Program Name', 'Client Name', 'Show Client', 'Workshop Date', 'Trainer', 'Duration', 'Score %',
    'Submission ID']
};

// Columns stored as plain text so Sheets does not turn them into dates or numbers.
var TEXT_COLUMNS = {
  WORKSHOPS: ['Workshop Code', 'Workshop Date', 'Accept Until'],
  SUBMISSIONS: ['Submitted At (UTC)', 'Workshop Code', 'Workshop Date', 'Answers', 'Question Results', 'Certificate ID'],
  CERTS: ['Certificate ID', 'Workshop Code', 'Workshop Date']
};

/* =========================================================================
 * HTTP entry points
 * ========================================================================= */

function doGet(e) { return handle_(e, 'GET'); }
function doPost(e) { return handle_(e, 'POST'); }

function handle_(e, method) {
  var out;
  try {
    var params = (e && e.parameter) || {};
    var body = {};
    if (method === 'POST') {
      var raw = params.payload;
      if (!raw && e && e.postData && e.postData.type !== 'application/x-www-form-urlencoded') {
        raw = e.postData.contents;
      }
      if (raw) {
        try { body = JSON.parse(raw); } catch (parseErr) { throw userError_('Request could not be read.'); }
      }
    }
    var req = {};
    Object.keys(params).forEach(function (k) { if (k !== 'payload') req[k] = params[k]; });
    Object.keys(body).forEach(function (k) { req[k] = body[k]; });

    var action = String(req.action || '');
    var adminActions = {
      'admin.ping': apiAdminPing_,
      'admin.banks': apiAdminBanks_,
      'admin.createWorkshop': apiAdminCreateWorkshop_,
      'admin.workshops': apiAdminWorkshops_,
      'admin.setStatus': apiAdminSetStatus_,
      'admin.stats': apiAdminStats_
    };

    if (action === '') {
      out = { ok: true, service: 'Ivy workshop certificates', version: APP_VERSION };
    } else if (action === 'workshop') {
      out = apiGetWorkshop_(req.code);
    } else if (action === 'verify') {
      out = apiVerify_(req.id);
    } else if (action === 'submit') {
      if (method !== 'POST') throw userError_('Submissions must be sent with POST.');
      out = apiSubmit_(req);
    } else if (adminActions[action]) {
      if (method !== 'POST') throw userError_('Admin requests must be sent with POST.');
      requireAdmin_(req.adminKey);
      out = adminActions[action](req);
    } else {
      throw userError_('Unknown action.');
    }
  } catch (err) {
    if (err && err.userMessage) {
      out = { ok: false, error: err.userMessage, code: err.code || 'bad_request' };
    } else {
      console.error(err && err.stack ? err.stack : err);
      out = { ok: false, error: 'Something went wrong on our side. Please try again in a moment.', code: 'server_error' };
    }
  }
  return ContentService.createTextOutput(JSON.stringify(out)).setMimeType(ContentService.MimeType.JSON);
}

/* =========================================================================
 * Public API
 * ========================================================================= */

function apiGetWorkshop_(codeIn) {
  var code = normCode_(codeIn);
  var ws = findWorkshop_(code);
  if (!ws) throw userError_('We could not find this workshop. Please check the link or scan the QR code again.', 'not_found');
  var state = workshopState_(ws);
  var questions = [];
  if (ws.bank !== NO_ASSESSMENT) {
    questions = getBankQuestions_(ws.bank).map(function (q) {
      return { id: q.id, topic: q.topic, text: q.text, options: q.options };
    });
  }
  return {
    ok: true,
    workshop: publicWorkshop_(ws, state, questions.length),
    questions: questions
  };
}

function apiVerify_(idIn) {
  var id = String(idIn || '').trim().toUpperCase();
  if (!/^IVY-\d{4}-[A-Z0-9]{6}$/.test(id)) throw userError_('That does not look like an Ivy certificate ID.', 'not_found');
  var cert = findCertById_(id);
  if (!cert) throw userError_('No certificate was found with this ID.', 'not_found');
  return { ok: true, certificate: publicCert_(cert) };
}

function apiSubmit_(req) {
  var code = normCode_(req.code);
  var name = String(req.name || '').replace(/\s+/g, ' ').trim();
  var email = String(req.email || '').trim().toLowerCase();
  var rating = Number(req.rating);
  var takeaway = String(req.takeaway || '').trim().slice(0, 500);
  var optIn = req.optIn === true || req.optIn === 'true' || req.optIn === 'Yes';
  var answers = req.answers || {};
  if (typeof answers === 'string') {
    try { answers = JSON.parse(answers); } catch (e) { answers = {}; }
  }

  if (!isValidName_(name)) throw userError_('Please enter your full name as it should appear on the certificate (letters only, 2 to 80 characters).', 'invalid');
  if (!isValidEmail_(email)) throw userError_('Please enter a valid email address.', 'invalid');
  if (!(req.consent === true || req.consent === 'true' || req.consent === 'Yes')) throw userError_('Please confirm the consent statement to continue.', 'invalid');
  if (!(rating >= 1 && rating <= 5 && Math.floor(rating) === rating)) throw userError_('Please rate the workshop from 1 to 5.', 'invalid');

  var ws = findWorkshop_(code);
  if (!ws) throw userError_('We could not find this workshop.', 'not_found');
  var state = workshopState_(ws);
  if (!state.open) throw userError_(state.reason, 'closed');

  var hasAssessment = ws.bank !== NO_ASSESSMENT;
  var questions = hasAssessment ? getBankQuestions_(ws.bank) : [];
  if (hasAssessment && questions.length === 0) throw userError_('This assessment has no questions yet. Please tell your trainer.', 'config');

  // Validate and score answers (before taking the lock; this is read-only).
  var score = 0;
  var answerLetters = {};
  var questionResults = {};
  for (var i = 0; i < questions.length; i++) {
    var q = questions[i];
    var a = answers[q.id];
    var idx = (a === '' || a === null || a === undefined) ? NaN : Number(a);
    if (!(idx >= 0 && idx < q.options.length && Math.floor(idx) === idx)) {
      throw userError_('Please answer every question before submitting.', 'invalid');
    }
    answerLetters[q.id] = 'ABCD'.charAt(idx);
    var correct = idx === q.correct ? 1 : 0;
    questionResults[q.id] = correct;
    score += correct;
  }
  var total = questions.length;
  var percent = total ? Math.round((score / total) * 100) : 0;

  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    // Already certified for this workshop? Return the same certificate, write nothing.
    var existing = findCertForParticipant_(code, email);
    if (existing) {
      return {
        ok: true,
        alreadyIssued: true,
        result: { outcome: existing.type === 'Achievement' ? 'achievement' : 'participation', percent: existing.scorePct, passMark: ws.passMark },
        certificate: publicCert_(existing)
      };
    }

    var attempt = countAttempts_(code, email) + 1;
    var outcome;
    if (!hasAssessment) outcome = 'participation';
    else if (percent >= ws.passMark) outcome = 'achievement';
    else if (attempt < ws.maxAttempts) outcome = 'retry';
    else outcome = 'participation';

    var now = new Date();
    var submissionId = Utilities.getUuid();
    var certId = '';
    var certType = '';
    if (outcome !== 'retry') {
      certId = newCertId_(now);
      certType = outcome === 'achievement' ? 'Achievement' : 'Participation';
    }
    var resultLabel = !hasAssessment ? 'Feedback only' : (outcome === 'achievement' ? 'Pass' : (outcome === 'retry' ? 'Below pass mark - retry allowed' : 'Below pass mark - final attempt'));

    getSheet_(SHEET.SUBMISSIONS).appendRow([
      now, submissionId, now.toISOString(), code, safe_(ws.programName), safe_(ws.clientName), ws.date,
      safe_(name), safe_(email), attempt, hasAssessment ? score : '', hasAssessment ? total : '',
      hasAssessment ? percent : '', resultLabel, JSON.stringify(answerLetters), JSON.stringify(questionResults),
      rating, safe_(takeaway), optIn ? 'Yes' : 'No', certId, certType, APP_VERSION
    ]);

    var cert = null;
    if (certId) {
      getSheet_(SHEET.CERTS).appendRow([
        now, certId, certType, safe_(name), safe_(email), code, safe_(ws.programName), safe_(ws.clientName),
        ws.showClient ? 'Yes' : 'No', ws.date, safe_(ws.trainer), safe_(ws.duration),
        hasAssessment ? percent : '', submissionId
      ]);
      cert = {
        id: certId, type: certType, name: name, programName: ws.programName, clientName: ws.clientName,
        showClient: ws.showClient, date: ws.date, trainer: ws.trainer, duration: ws.duration,
        scorePct: hasAssessment ? percent : '', issuedAt: Utilities.formatDate(now, TZ, 'yyyy-MM-dd')
      };
    }
    SpreadsheetApp.flush();

    return {
      ok: true,
      result: {
        outcome: outcome,
        hasAssessment: hasAssessment,
        score: score,
        total: total,
        percent: percent,
        passMark: ws.passMark,
        attempt: attempt,
        attemptsLeft: outcome === 'retry' ? ws.maxAttempts - attempt : 0
      },
      certificate: cert ? publicCert_(cert) : null
    };
  } finally {
    lock.releaseLock();
  }
}

/* =========================================================================
 * Admin API (needs ADMIN_KEY from Script Properties)
 * ========================================================================= */

function apiAdminPing_() {
  return { ok: true, version: APP_VERSION };
}

function apiAdminBanks_() {
  var rows = readObjects_(getSheet_(SHEET.BANK));
  var banks = {};
  var order = [];
  rows.forEach(function (r) {
    var id = String(r['Bank ID'] || '').trim();
    if (!id) return;
    if (!banks[id]) { banks[id] = { id: id, count: 0, topics: [] }; order.push(id); }
    if (String(r['Active']).trim().toLowerCase() === 'no') return;
    banks[id].count++;
    var t = String(r['Topic'] || '').trim();
    if (t && banks[id].topics.indexOf(t) === -1) banks[id].topics.push(t);
  });
  return { ok: true, banks: order.map(function (id) { return banks[id]; }) };
}

function apiAdminCreateWorkshop_(req) {
  var w = req.workshop || {};
  var programName = String(w.programName || '').replace(/\s+/g, ' ').trim();
  var clientName = String(w.clientName || '').replace(/\s+/g, ' ').trim();
  var showClient = w.showClient === true || w.showClient === 'true';
  var date = String(w.date || '').trim();
  var trainer = String(w.trainer || '').replace(/\s+/g, ' ').trim();
  var duration = String(w.duration || '').trim();
  var bank = String(w.bank || '').trim();
  var passMark = Number(w.passMark);
  var maxAttempts = Number(w.maxAttempts);
  var acceptUntil = String(w.acceptUntil || '').trim();

  if (programName.length < 3 || programName.length > 120) throw userError_('Program name must be 3 to 120 characters.');
  if (clientName.length > 120) throw userError_('Client name is too long.');
  if (!isIsoDate_(date)) throw userError_('Workshop date is required.');
  if (trainer.length > 80) throw userError_('Trainer name is too long.');
  if (duration.length > 40) throw userError_('Duration is too long.');
  if (!acceptUntil) acceptUntil = addDays_(date, 3);
  if (!isIsoDate_(acceptUntil) || acceptUntil < date) throw userError_('"Accept submissions until" must be on or after the workshop date.');
  if (bank !== NO_ASSESSMENT) {
    if (getBankQuestions_(bank).length === 0) throw userError_('That question bank has no active questions.');
    if (!(passMark >= 0 && passMark <= 100)) throw userError_('Pass mark must be between 0 and 100.');
    if (!(maxAttempts >= 1 && maxAttempts <= 5)) throw userError_('Attempts must be between 1 and 5.');
  } else {
    passMark = 0;
    maxAttempts = 1;
  }

  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var code;
    do { code = randomCode_(6); } while (findWorkshop_(code));
    getSheet_(SHEET.WORKSHOPS).appendRow([
      new Date(), code, safe_(programName), safe_(clientName), showClient ? 'Yes' : 'No', date,
      safe_(trainer), safe_(duration), bank, Math.round(passMark), Math.round(maxAttempts), acceptUntil, 'Active'
    ]);
    SpreadsheetApp.flush();
  } finally {
    lock.releaseLock();
  }
  var ws = findWorkshop_(code);
  return { ok: true, workshop: adminWorkshop_(ws, {}) };
}

function apiAdminWorkshops_() {
  var subs = readObjects_(getSheet_(SHEET.SUBMISSIONS));
  var certs = readObjects_(getSheet_(SHEET.CERTS));
  var counts = {};
  function bucket(code) {
    if (!counts[code]) counts[code] = { emails: {}, participants: 0, certificates: 0, achievements: 0 };
    return counts[code];
  }
  subs.forEach(function (r) {
    var c = bucket(String(r['Workshop Code']));
    var e = String(r['Email']).toLowerCase();
    if (!c.emails[e]) { c.emails[e] = true; c.participants++; }
  });
  certs.forEach(function (r) {
    var c = bucket(String(r['Workshop Code']));
    c.certificates++;
    if (r['Certificate Type'] === 'Achievement') c.achievements++;
  });
  var list = listWorkshops_().map(function (ws) { return adminWorkshop_(ws, counts[ws.code] || {}); });
  list.reverse(); // newest first
  return { ok: true, workshops: list };
}

function apiAdminSetStatus_(req) {
  var code = normCode_(req.code);
  var status = req.status === 'Closed' ? 'Closed' : 'Active';
  var ws = findWorkshop_(code);
  if (!ws) throw userError_('Workshop not found.');
  var sheet = getSheet_(SHEET.WORKSHOPS);
  var col = HEADERS.WORKSHOPS.indexOf('Status') + 1;
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    sheet.getRange(ws.row, col).setValue(status);
    SpreadsheetApp.flush();
  } finally {
    lock.releaseLock();
  }
  return { ok: true, workshop: adminWorkshop_(findWorkshop_(code), {}) };
}

function apiAdminStats_(req) {
  var code = normCode_(req.code);
  var ws = findWorkshop_(code);
  if (!ws) throw userError_('Workshop not found.');
  var questions = ws.bank !== NO_ASSESSMENT ? getBankQuestions_(ws.bank) : [];
  var subs = readObjects_(getSheet_(SHEET.SUBMISSIONS)).filter(function (r) { return String(r['Workshop Code']) === code; });
  var certs = readObjects_(getSheet_(SHEET.CERTS)).filter(function (r) { return String(r['Workshop Code']) === code; });

  var certByEmail = {};
  certs.forEach(function (c) { certByEmail[String(c['Email']).toLowerCase()] = c; });

  var people = {};
  var order = [];
  subs.forEach(function (r) {
    var email = String(r['Email']).toLowerCase();
    var p = people[email];
    var pct = r['Score %'] === '' ? null : Number(r['Score %']);
    if (!p) {
      p = people[email] = {
        name: '', email: email, attempts: 0, firstScore: pct, bestScore: pct, firstResults: null,
        rating: null, takeaway: '', optIn: false, lastAt: ''
      };
      order.push(email);
      try { p.firstResults = JSON.parse(r['Question Results'] || '{}'); } catch (e) { p.firstResults = {}; }
    }
    p.name = String(r['Participant Name']);
    p.attempts++;
    if (pct !== null && (p.bestScore === null || pct > p.bestScore)) p.bestScore = pct;
    p.rating = Number(r['Rating (1-5)']) || p.rating;
    p.takeaway = String(r['Key Takeaway'] || '') || p.takeaway;
    p.optIn = p.optIn || r['Ivy Updates Opt-in'] === 'Yes';
    p.lastAt = r['Submitted At (UTC)'];
  });

  var participants = order.map(function (email) {
    var p = people[email];
    var c = certByEmail[email];
    p.isTest = /^test/i.test(p.name);
    p.certId = c ? String(c['Certificate ID']) : '';
    p.certType = c ? String(c['Certificate Type']) : '';
    return p;
  });

  var real = participants.filter(function (p) { return !p.isTest; });
  function avg(arr) { return arr.length ? Math.round((arr.reduce(function (s, x) { return s + x; }, 0) / arr.length) * 10) / 10 : null; }
  var firstScores = real.map(function (p) { return p.firstScore; }).filter(function (x) { return x !== null; });
  var bestScores = real.map(function (p) { return p.bestScore; }).filter(function (x) { return x !== null; });
  var ratings = real.map(function (p) { return p.rating; }).filter(function (x) { return x; });
  var achievements = real.filter(function (p) { return p.certType === 'Achievement'; }).length;
  var participations = real.filter(function (p) { return p.certType === 'Participation'; }).length;

  var questionStats = questions.map(function (q) {
    var answered = 0, right = 0;
    real.forEach(function (p) {
      if (p.firstResults && p.firstResults.hasOwnProperty(q.id)) {
        answered++;
        right += Number(p.firstResults[q.id]) === 1 ? 1 : 0;
      }
    });
    return { id: q.id, topic: q.topic, text: q.text, answered: answered, pctCorrect: answered ? Math.round((right / answered) * 100) : null };
  });

  var ratingDist = [0, 0, 0, 0, 0];
  ratings.forEach(function (r) { if (r >= 1 && r <= 5) ratingDist[r - 1]++; });

  return {
    ok: true,
    workshop: adminWorkshop_(ws, {}),
    kpis: {
      participants: real.length,
      testRowsExcluded: participants.length - real.length,
      certificates: achievements + participations,
      achievements: achievements,
      participations: participations,
      passRate: real.length && ws.bank !== NO_ASSESSMENT ? Math.round((achievements / real.length) * 100) : null,
      avgFirstScore: avg(firstScores),
      avgBestScore: avg(bestScores),
      avgRating: avg(ratings),
      optIns: real.filter(function (p) { return p.optIn; }).length
    },
    questionStats: questionStats,
    ratingDist: ratingDist,
    participants: participants.map(function (p) {
      return {
        name: p.name, email: p.email, attempts: p.attempts, firstScore: p.firstScore, bestScore: p.bestScore,
        rating: p.rating, takeaway: p.takeaway, optIn: p.optIn, certId: p.certId, certType: p.certType,
        isTest: p.isTest, lastAt: p.lastAt
      };
    })
  };
}

function requireAdmin_(key) {
  var expected = PropertiesService.getScriptProperties().getProperty('ADMIN_KEY');
  if (!expected) throw userError_('Admin key is not set. Run setup() in Apps Script first.', 'unauthorised');
  if (String(key || '') !== expected) throw userError_('Admin key is incorrect.', 'unauthorised');
}

/* =========================================================================
 * Data access
 * ========================================================================= */

function getSheet_(name) {
  var sheet = SpreadsheetApp.getActive().getSheetByName(name);
  if (!sheet) throw new Error('Missing tab "' + name + '". Run setup() first.');
  return sheet;
}

function readObjects_(sheet) {
  var lastRow = sheet.getLastRow();
  var lastCol = sheet.getLastColumn();
  if (lastRow < 2 || lastCol < 1) return [];
  var values = sheet.getRange(1, 1, lastRow, lastCol).getValues();
  var headers = values[0].map(function (h) { return String(h).trim(); });
  var out = [];
  for (var i = 1; i < values.length; i++) {
    var obj = { _row: i + 1 };
    var empty = true;
    for (var j = 0; j < headers.length; j++) {
      var v = values[i][j];
      if (v !== '' && v !== null) empty = false;
      obj[headers[j]] = v;
    }
    if (!empty) out.push(obj);
  }
  return out;
}

function listWorkshops_() {
  return readObjects_(getSheet_(SHEET.WORKSHOPS)).map(toWorkshop_).filter(function (w) { return w.code; });
}

function findWorkshop_(code) {
  var list = listWorkshops_();
  for (var i = 0; i < list.length; i++) if (list[i].code === code) return list[i];
  return null;
}

function toWorkshop_(r) {
  return {
    row: r._row,
    createdAt: isDate_(r['Created At']) ? r['Created At'].toISOString() : String(r['Created At'] || ''),
    code: String(r['Workshop Code'] || '').trim().toUpperCase(),
    programName: String(r['Program Name'] || '').trim(),
    clientName: String(r['Client Name'] || '').trim(),
    showClient: String(r['Show Client On Certificate']).trim().toLowerCase() === 'yes',
    date: toIsoDate_(r['Workshop Date']),
    trainer: String(r['Trainer'] || '').trim(),
    duration: String(r['Duration'] || '').trim(),
    bank: String(r['Question Bank'] || '').trim() || NO_ASSESSMENT,
    passMark: Number(r['Pass Mark %']) || 0,
    maxAttempts: Math.max(1, Number(r['Max Attempts']) || 1),
    acceptUntil: toIsoDate_(r['Accept Until']),
    status: String(r['Status'] || 'Active').trim()
  };
}

function workshopState_(ws) {
  if (ws.status.toLowerCase() !== 'active') return { open: false, reason: 'This assessment is closed. Please contact your trainer if you need help.' };
  var today = Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd');
  if (ws.acceptUntil && today > ws.acceptUntil) return { open: false, reason: 'This assessment closed on ' + ws.acceptUntil + '. Please contact your trainer if you need help.' };
  return { open: true, reason: '' };
}

function publicWorkshop_(ws, state, questionCount) {
  return {
    code: ws.code,
    programName: ws.programName,
    clientName: ws.showClient ? ws.clientName : '',
    date: ws.date,
    trainer: ws.trainer,
    duration: ws.duration,
    hasAssessment: ws.bank !== NO_ASSESSMENT,
    questionCount: questionCount,
    passMark: ws.passMark,
    maxAttempts: ws.maxAttempts,
    open: state.open,
    closedReason: state.reason
  };
}

function adminWorkshop_(ws, counts) {
  var state = workshopState_(ws);
  return {
    code: ws.code, createdAt: ws.createdAt, programName: ws.programName, clientName: ws.clientName,
    showClient: ws.showClient, date: ws.date, trainer: ws.trainer, duration: ws.duration, bank: ws.bank,
    passMark: ws.passMark, maxAttempts: ws.maxAttempts, acceptUntil: ws.acceptUntil, status: ws.status,
    open: state.open, participants: counts.participants || 0, certificates: counts.certificates || 0,
    achievements: counts.achievements || 0
  };
}

function getBankQuestions_(bankId) {
  var rows = readObjects_(getSheet_(SHEET.BANK));
  var out = [];
  rows.forEach(function (r) {
    if (String(r['Bank ID']).trim() !== bankId) return;
    if (String(r['Active']).trim().toLowerCase() === 'no') return;
    var options = [];
    var letters = [];
    ['A', 'B', 'C', 'D'].forEach(function (L) {
      var t = String(r['Option ' + L] === undefined ? '' : r['Option ' + L]).trim();
      if (t) { options.push(t); letters.push(L); }
    });
    var correct = letters.indexOf(String(r['Correct Option']).trim().toUpperCase());
    var id = String(r['Question ID'] || '').trim();
    if (!id || options.length < 2 || correct < 0) return; // skip malformed rows
    out.push({ id: id, topic: String(r['Topic'] || '').trim(), text: String(r['Question']).trim(), options: options, correct: correct });
  });
  return out;
}

function findCertById_(id) {
  var sheet = getSheet_(SHEET.CERTS);
  if (sheet.getLastRow() < 2) return null;
  var col = HEADERS.CERTS.indexOf('Certificate ID') + 1;
  var cell = sheet.getRange(2, col, sheet.getLastRow() - 1, 1).createTextFinder(id).matchEntireCell(true).findNext();
  if (!cell) return null;
  var values = sheet.getRange(cell.getRow(), 1, 1, HEADERS.CERTS.length).getValues()[0];
  var r = {};
  HEADERS.CERTS.forEach(function (h, i) { r[h] = values[i]; });
  return toCert_(r);
}

function findCertForParticipant_(code, email) {
  var rows = readObjects_(getSheet_(SHEET.CERTS));
  for (var i = 0; i < rows.length; i++) {
    if (String(rows[i]['Workshop Code']) === code && String(rows[i]['Email']).toLowerCase() === email) return toCert_(rows[i]);
  }
  return null;
}

function countAttempts_(code, email) {
  return readObjects_(getSheet_(SHEET.SUBMISSIONS)).filter(function (r) {
    return String(r['Workshop Code']) === code && String(r['Email']).toLowerCase() === email;
  }).length;
}

function toCert_(r) {
  var issued = r['Issued At'];
  return {
    id: String(r['Certificate ID']),
    type: String(r['Certificate Type']),
    name: String(r['Participant Name']),
    programName: String(r['Program Name']),
    clientName: String(r['Client Name'] || ''),
    showClient: String(r['Show Client']).toLowerCase() === 'yes',
    date: toIsoDate_(r['Workshop Date']),
    trainer: String(r['Trainer'] || ''),
    duration: String(r['Duration'] || ''),
    scorePct: r['Score %'],
    issuedAt: isDate_(issued) ? Utilities.formatDate(issued, TZ, 'yyyy-MM-dd') : String(issued || '').slice(0, 10)
  };
}

function publicCert_(c) {
  return {
    id: c.id,
    type: c.type === 'Achievement' ? 'achievement' : 'participation',
    name: c.name,
    programName: c.programName,
    clientName: c.showClient ? c.clientName : '',
    date: c.date,
    trainer: c.trainer,
    duration: c.duration,
    issuedAt: c.issuedAt
  };
}

function newCertId_(now) {
  var yymm = Utilities.formatDate(now, TZ, 'yyMM');
  var id;
  do { id = 'IVY-' + yymm + '-' + randomCode_(6); } while (findCertById_(id));
  return id;
}

/* =========================================================================
 * Helpers
 * ========================================================================= */

function userError_(message, code) {
  var e = new Error(message);
  e.userMessage = message;
  e.code = code || 'bad_request';
  return e;
}

function normCode_(code) {
  var c = String(code || '').trim().toUpperCase();
  if (!/^[A-Z0-9]{4,10}$/.test(c)) throw userError_('That workshop code is not valid. Please scan the QR code again.', 'not_found');
  return c;
}

function randomCode_(len) {
  var s = '';
  for (var i = 0; i < len; i++) s += CODE_ALPHABET.charAt(Math.floor(Math.random() * CODE_ALPHABET.length));
  return s;
}

function isValidName_(name) {
  return /^[\p{L}\p{M}][\p{L}\p{M} .'’-]{1,79}$/u.test(name);
}

function isValidEmail_(email) {
  return email.length <= 120 && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email);
}

function isIsoDate_(s) {
  return /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(new Date(s + 'T00:00:00Z').getTime());
}

function isDate_(v) {
  return Object.prototype.toString.call(v) === '[object Date]' && !isNaN(v.getTime());
}

function toIsoDate_(v) {
  if (isDate_(v)) return Utilities.formatDate(v, TZ, 'yyyy-MM-dd');
  return String(v || '').trim().slice(0, 10);
}

function addDays_(iso, days) {
  var d = new Date(iso + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Stops Sheets from treating participant text as a formula. */
function safe_(v) {
  var s = String(v === null || v === undefined ? '' : v);
  return /^[=+\-@]/.test(s) ? "'" + s : s;
}

/* =========================================================================
 * Setup, menu and seed data
 * ========================================================================= */

function onOpen() {
  SpreadsheetApp.getUi().createMenu('Ivy Certificates')
    .addItem('Run setup', 'setup')
    .addItem('Show admin key', 'showAdminKey')
    .addItem('Reset admin key', 'resetAdminKey')
    .addToUi();
}

function setup() {
  var ss = SpreadsheetApp.getActive();
  ss.setSpreadsheetTimeZone(TZ);
  ensureSheet_(ss, SHEET.WORKSHOPS, HEADERS.WORKSHOPS, TEXT_COLUMNS.WORKSHOPS);
  var bank = ensureSheet_(ss, SHEET.BANK, HEADERS.BANK, []);
  ensureSheet_(ss, SHEET.SUBMISSIONS, HEADERS.SUBMISSIONS, TEXT_COLUMNS.SUBMISSIONS);
  ensureSheet_(ss, SHEET.CERTS, HEADERS.CERTS, TEXT_COLUMNS.CERTS);

  if (bank.getLastRow() < 2) {
    var rows = seedQuestions_();
    bank.getRange(2, 1, rows.length, HEADERS.BANK.length).setValues(rows);
    bank.setColumnWidth(4, 420);
  }

  // Remove the blank default tab if it is still there.
  var def = ss.getSheetByName('Sheet1');
  if (def && def.getLastRow() === 0 && ss.getSheets().length > 1) ss.deleteSheet(def);

  var props = PropertiesService.getScriptProperties();
  if (!props.getProperty('ADMIN_KEY')) props.setProperty('ADMIN_KEY', generateKey_());
  showAdminKey();
}

function ensureSheet_(ss, name, headers, textCols) {
  var sheet = ss.getSheetByName(name) || ss.insertSheet(name);
  if (sheet.getLastRow() === 0) {
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  }
  sheet.getRange(1, 1, 1, headers.length).setFontWeight('bold').setBackground('#0b5394').setFontColor('#ffffff');
  sheet.setFrozenRows(1);
  textCols.forEach(function (h) {
    var col = headers.indexOf(h) + 1;
    if (col > 0) sheet.getRange(2, col, sheet.getMaxRows() - 1, 1).setNumberFormat('@');
  });
  return sheet;
}

function generateKey_() {
  return Utilities.getUuid().replace(/-/g, '').slice(0, 20);
}

function showAdminKey() {
  var key = PropertiesService.getScriptProperties().getProperty('ADMIN_KEY');
  var msg = key ? 'Your admin key is:\n\n' + key + '\n\nPaste it into the admin page when asked. Keep it private.' : 'No admin key yet. Run setup first.';
  Logger.log(msg);
  try { SpreadsheetApp.getUi().alert('Ivy Certificates', msg, SpreadsheetApp.getUi().ButtonSet.OK); } catch (e) { /* run from editor: see Execution log */ }
}

function resetAdminKey() {
  PropertiesService.getScriptProperties().setProperty('ADMIN_KEY', generateKey_());
  showAdminKey();
}

/**
 * Starter question banks. Review and edit these in the "Question Bank" tab;
 * the tab is the source of truth once setup() has run.
 * Columns: Bank ID, Question ID, Topic, Question, Option A-D, Correct Option, Active
 */
function seedQuestions_() {
  var G = 'GENAI-WORKPLACE';
  var L = 'AI-FOR-LEADERS';
  return [
    [G, 'gw01', 'Basics', 'What does it mean when a generative AI tool "hallucinates"?',
      'It refuses to answer the question', 'It produces confident but incorrect or made-up information', 'It runs slowly because of heavy load', 'It repeats the prompt back to you', 'B', 'Yes'],
    [G, 'gw02', 'Data privacy', 'You want help summarising a client contract. What is the right first step?',
      'Paste the full contract into any free public chatbot', 'Check your company AI policy and use an approved tool, removing confidential details if required', 'Email the contract to a personal account and use AI from home', 'Avoid AI completely for any document', 'B', 'Yes'],
    [G, 'gw03', 'Prompting', 'Which prompt is most likely to give a useful first draft?',
      '"Write an email"', '"Email to client"', '"You are an account manager. Write a 120-word email to a client explaining a two-day delivery delay, apologise once, offer a revised date, keep a polite tone."', '"Write something professional and good"', 'C', 'Yes'],
    [G, 'gw04', 'Prompting', 'Giving the AI two or three sample input-output pairs before your actual request is called:',
      'Few-shot prompting', 'Fine-tuning', 'Data labelling', 'Prompt injection', 'A', 'Yes'],
    [G, 'gw05', 'Verification', 'An AI tool gives you a market-size figure for a board presentation. What should you do?',
      'Use it as is because AI is trained on large data', 'Round it off and use it', 'Verify it against a reliable, citable source before using it', 'Ask the AI if it is sure and use it if it says yes', 'C', 'Yes'],
    [G, 'gw06', 'Prompting', 'The first answer from the AI is too generic. What usually works best?',
      'Start a new chat and ask the same question', 'Refine the prompt with more context, constraints and the output format you want', 'Type the question in capital letters', 'Accept it, since AI output cannot be improved', 'B', 'Yes'],
    [G, 'gw07', 'Concepts', 'What is Retrieval-Augmented Generation (RAG) mainly used for?',
      'Making the model respond faster', 'Grounding answers in your own documents or data sources', 'Generating images from text', 'Translating code between languages', 'B', 'Yes'],
    [G, 'gw08', 'Concepts', 'The "context window" of a language model refers to:',
      'The size of the chat window on screen', 'How much text the model can consider at one time, including your prompt and its reply', 'The number of users who can use the tool at once', 'The date range of the training data', 'B', 'Yes'],
    [G, 'gw09', 'Responsible use', 'Which use of generative AI most needs a qualified human to review the output before acting on it?',
      'Drafting a team lunch invitation', 'Brainstorming names for an internal project', 'A final credit, legal or medical decision', 'Reformatting a list into a table', 'C', 'Yes'],
    [G, 'gw10', 'Responsible use', 'Why can AI-generated output be biased?',
      'Because models learn patterns from data that may contain human biases', 'Because AI tools are designed to have opinions', 'Because bias only appears when the internet is slow', 'AI output cannot be biased', 'A', 'Yes'],

    [L, 'al01', 'Use cases', 'Which makes the strongest first AI use case for a business team?',
      'The most complex process in the company', 'A high-volume, repetitive task with clear quality checks and measurable time or cost', 'A process nobody currently owns', 'Whatever a competitor announced last week', 'B', 'Yes'],
    [L, 'al02', 'ROI', 'What is the best way to judge whether an AI pilot worked?',
      'Number of employees who logged in once', 'Comparing agreed baseline metrics (time, cost, quality, errors) before and after', 'Feedback from the vendor', 'How advanced the model is', 'B', 'Yes'],
    [L, 'al03', 'Governance', 'An AI usage policy for employees should cover at minimum:',
      'Approved tools, what data may and may not be shared, and who reviews outputs', 'Only the list of banned websites', 'Only the budget for AI licences', 'Nothing, since teams should experiment freely', 'A', 'Yes'],
    [L, 'al04', 'Risk', '"Human-in-the-loop" means:',
      'A person reviews or approves AI output at defined points before it takes effect', 'Humans are replaced by AI step by step', 'Employees must type all prompts by hand', 'Customers must talk to a human first', 'A', 'Yes'],
    [L, 'al05', 'Strategy', 'When does building a custom AI solution usually make more sense than buying an off-the-shelf tool?',
      'Always, because custom is cheaper', 'When the process is a core differentiator and depends on proprietary data that tools cannot handle well', 'When the team wants to learn coding', 'Never', 'B', 'Yes'],
    [L, 'al06', 'Data', 'Which is the most common reason AI projects stall after the pilot?',
      'The model is not large enough', 'Poor data quality, unclear ownership and no integration into daily workflow', 'Too many employees want to use it', 'The pilot was too successful', 'B', 'Yes'],
    [L, 'al07', 'Change', 'What most improves employee adoption of a new AI tool?',
      'Announcing it by email only', 'Role-specific training, clear use cases and a manager who uses it visibly', 'Making it optional and never mentioning it', 'Tracking every keystroke', 'B', 'Yes'],
    [L, 'al08', 'Scaling', 'After a successful pilot, what is the sensible next step?',
      'Roll out to every department at once', 'Document results, fix gaps, set governance and scale in phases with owners and metrics', 'Stop and wait for better models', 'Hand it over to the vendor fully', 'B', 'Yes']
  ];
}
