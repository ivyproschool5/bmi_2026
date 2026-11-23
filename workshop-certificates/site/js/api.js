/* Ivy Workshop Certificates - API client and shared helpers.
 * Talks to the Apps Script web app in IVY_CONFIG.API_URL.
 * With no API_URL it runs a demo backend in localStorage so the whole flow can be previewed. */
(function () {
  'use strict';
  var cfg = window.IVY_CONFIG || {};
  var DEMO = !cfg.API_URL;
  var TIMEOUT_MS = 30000;

  /* ---------------- helpers ---------------- */
  var MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

  function formatDate(iso, short) {
    if (!iso || !/^\d{4}-\d{2}-\d{2}/.test(iso)) return iso || '';
    var p = iso.slice(0, 10).split('-');
    var m = MONTHS[Number(p[1]) - 1] || '';
    return Number(p[2]) + ' ' + (short ? m.slice(0, 3) : m) + ' ' + p[0];
  }

  function todayIso() {
    var d = new Date();
    var off = d.getTimezoneOffset();
    return new Date(d.getTime() - off * 60000).toISOString().slice(0, 10);
  }

  function addDays(iso, n) {
    var d = new Date(iso + 'T00:00:00Z');
    d.setUTCDate(d.getUTCDate() + n);
    return d.toISOString().slice(0, 10);
  }

  function siteBase() {
    if (cfg.SITE_URL) return cfg.SITE_URL.replace(/\/+$/, '');
    var path = location.pathname.replace(/[^/]*$/, '');
    return (location.origin + path).replace(/\/+$/, '');
  }

  function workshopUrl(code) { return siteBase() + '/?w=' + encodeURIComponent(code); }
  function verifyUrl(id) { return siteBase() + '/?c=' + encodeURIComponent(id); }

  function utm(url, source, campaign) {
    try {
      var u = new URL(url);
      u.searchParams.set('utm_source', source);
      u.searchParams.set('utm_medium', 'workshop_certificate');
      if (campaign) u.searchParams.set('utm_campaign', campaign);
      return u.toString();
    } catch (e) { return url; }
  }

  function esc(s) {
    return String(s === null || s === undefined ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  /* ---------------- real backend ---------------- */
  function withTimeout(promise) {
    return new Promise(function (resolve, reject) {
      var t = setTimeout(function () { reject(new Error('timeout')); }, TIMEOUT_MS);
      promise.then(function (v) { clearTimeout(t); resolve(v); }, function (e) { clearTimeout(t); reject(e); });
    });
  }

  function networkError(e) {
    return {
      ok: false,
      code: 'network',
      error: e && e.message === 'timeout'
        ? 'The server took too long to respond. Please check your connection and try again.'
        : 'We could not reach the server. Please check your internet connection and try again.'
    };
  }

  function remoteGet(action, params) {
    var q = new URLSearchParams(Object.assign({ action: action }, params || {}));
    return withTimeout(fetch(cfg.API_URL + '?' + q.toString(), { method: 'GET', redirect: 'follow' }))
      .then(function (r) { return r.json(); })
      .catch(networkError);
  }

  function remotePost(action, data) {
    // Form-encoded body keeps this a "simple" request, so the browser sends no CORS preflight.
    var body = new URLSearchParams();
    body.set('payload', JSON.stringify(Object.assign({ action: action }, data || {})));
    return withTimeout(fetch(cfg.API_URL, { method: 'POST', body: body, redirect: 'follow' }))
      .then(function (r) { return r.json(); })
      .catch(networkError);
  }

  /* ---------------- demo backend (browser only) ---------------- */
  var DEMO_KEY = 'ivy-cert-demo-db-v1';
  var DEMO_BANK = {
    'DEMO-GENAI': [
      { id: 'd1', topic: 'Basics', text: 'Demo question: what is a "prompt"?', options: ['The instruction or input you give an AI model', 'A software licence', 'A type of GPU', 'An error message'], correct: 0 },
      { id: 'd2', topic: 'Verification', text: 'Demo question: an AI tool quotes a statistic. What should you do before using it?', options: ['Use it directly', 'Verify it against a reliable source', 'Change the number slightly', 'Ask a colleague to guess'], correct: 1 },
      { id: 'd3', topic: 'Data privacy', text: 'Demo question: which data should you avoid pasting into an unapproved public AI tool?', options: ['A public news headline', 'Confidential client or employee data', 'A recipe', 'A general grammar question'], correct: 1 },
      { id: 'd4', topic: 'Prompting', text: 'Demo question: which addition most improves a prompt?', options: ['More exclamation marks', 'Context, audience and the output format you want', 'Typing in capitals', 'Removing all details'], correct: 1 },
      { id: 'd5', topic: 'Responsible use', text: 'Demo question: who is accountable for work you submit that was drafted with AI?', options: ['The AI vendor', 'Nobody', 'You', 'The internet'], correct: 2 }
    ]
  };
  var CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

  function demoDb() {
    try { return JSON.parse(localStorage.getItem(DEMO_KEY)) || { workshops: [], submissions: [], certs: [] }; }
    catch (e) { return { workshops: [], submissions: [], certs: [] }; }
  }
  function demoSave(db) { try { localStorage.setItem(DEMO_KEY, JSON.stringify(db)); } catch (e) { /* storage blocked */ } }
  function rand(n) { var s = ''; for (var i = 0; i < n; i++) s += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)]; return s; }
  function fail(msg, code) { return { ok: false, error: msg, code: code || 'bad_request' }; }
  function wsState(w) {
    if (w.status !== 'Active') return { open: false, reason: 'This assessment is closed. Please contact your trainer if you need help.' };
    if (w.acceptUntil && todayIso() > w.acceptUntil) return { open: false, reason: 'This assessment closed on ' + w.acceptUntil + '.' };
    return { open: true, reason: '' };
  }
  function pubCert(c) {
    return { id: c.id, type: c.type, name: c.name, programName: c.programName, clientName: c.showClient ? c.clientName : '', date: c.date, trainer: c.trainer, duration: c.duration, issuedAt: c.issuedAt };
  }
  function adminWs(w, db) {
    var emails = {};
    db.submissions.forEach(function (s) { if (s.code === w.code) emails[s.email] = 1; });
    var certs = db.certs.filter(function (c) { return c.code === w.code; });
    return Object.assign({}, w, {
      open: wsState(w).open,
      participants: Object.keys(emails).length,
      certificates: certs.length,
      achievements: certs.filter(function (c) { return c.type === 'achievement'; }).length
    });
  }

  function demo(action, d) {
    var db = demoDb();
    d = d || {};
    if (action.indexOf('admin.') === 0 && d.adminKey !== 'demo') return fail('Admin key is incorrect. In demo mode the key is: demo', 'unauthorised');

    if (action === 'workshop') {
      var w = db.workshops.filter(function (x) { return x.code === String(d.code || '').toUpperCase(); })[0];
      if (!w) return fail('We could not find this workshop. Please check the link or scan the QR code again.', 'not_found');
      var qs = w.bank === 'NONE' ? [] : (DEMO_BANK[w.bank] || []);
      var st = wsState(w);
      return {
        ok: true,
        workshop: { code: w.code, programName: w.programName, clientName: w.showClient ? w.clientName : '', date: w.date, trainer: w.trainer, duration: w.duration, hasAssessment: w.bank !== 'NONE', questionCount: qs.length, passMark: w.passMark, maxAttempts: w.maxAttempts, open: st.open, closedReason: st.reason },
        questions: qs.map(function (q) { return { id: q.id, topic: q.topic, text: q.text, options: q.options }; })
      };
    }
    if (action === 'verify') {
      var c = db.certs.filter(function (x) { return x.id === String(d.id || '').toUpperCase(); })[0];
      return c ? { ok: true, certificate: pubCert(c) } : fail('No certificate was found with this ID.', 'not_found');
    }
    if (action === 'submit') {
      var ws = db.workshops.filter(function (x) { return x.code === d.code; })[0];
      if (!ws) return fail('We could not find this workshop.', 'not_found');
      var state = wsState(ws);
      if (!state.open) return fail(state.reason, 'closed');
      var email = String(d.email || '').trim().toLowerCase();
      var existing = db.certs.filter(function (x) { return x.code === ws.code && x.email === email; })[0];
      if (existing) return { ok: true, alreadyIssued: true, result: { outcome: existing.type }, certificate: pubCert(existing) };
      var has = ws.bank !== 'NONE';
      var bank = has ? DEMO_BANK[ws.bank] : [];
      var score = 0;
      for (var i = 0; i < bank.length; i++) {
        var a = d.answers[bank[i].id];
        if (a === undefined || a === null || a === '') return fail('Please answer every question before submitting.');
        if (Number(a) === bank[i].correct) score++;
      }
      var pct = bank.length ? Math.round(score / bank.length * 100) : 0;
      var attempt = db.submissions.filter(function (s) { return s.code === ws.code && s.email === email; }).length + 1;
      var outcome = !has ? 'participation' : pct >= ws.passMark ? 'achievement' : attempt < ws.maxAttempts ? 'retry' : 'participation';
      var cert = null;
      if (outcome !== 'retry') {
        var now = new Date();
        cert = {
          id: 'IVY-' + String(now.getFullYear()).slice(2) + String(now.getMonth() + 1).padStart(2, '0') + '-' + rand(6),
          type: outcome, name: d.name, email: email, code: ws.code, programName: ws.programName, clientName: ws.clientName,
          showClient: ws.showClient, date: ws.date, trainer: ws.trainer, duration: ws.duration, issuedAt: todayIso(), scorePct: pct
        };
        db.certs.push(cert);
      }
      db.submissions.push({ code: ws.code, name: d.name, email: email, attempt: attempt, pct: has ? pct : null, rating: d.rating, takeaway: d.takeaway, optIn: !!d.optIn, at: new Date().toISOString(), answers: d.answers });
      demoSave(db);
      return {
        ok: true,
        result: { outcome: outcome, hasAssessment: has, score: score, total: bank.length, percent: pct, passMark: ws.passMark, attempt: attempt, attemptsLeft: outcome === 'retry' ? ws.maxAttempts - attempt : 0 },
        certificate: cert ? pubCert(cert) : null
      };
    }
    if (action === 'admin.ping') return { ok: true, version: 'demo' };
    if (action === 'admin.banks') {
      return { ok: true, banks: Object.keys(DEMO_BANK).map(function (k) { return { id: k, count: DEMO_BANK[k].length, topics: DEMO_BANK[k].map(function (q) { return q.topic; }) }; }) };
    }
    if (action === 'admin.createWorkshop') {
      var nw = d.workshop || {};
      if (!nw.programName || nw.programName.trim().length < 3) return fail('Program name must be 3 to 120 characters.');
      if (!nw.date) return fail('Workshop date is required.');
      var code; do { code = rand(6); } while (db.workshops.some(function (x) { return x.code === code; }));
      var rec = {
        code: code, createdAt: new Date().toISOString(), programName: nw.programName.trim(), clientName: (nw.clientName || '').trim(),
        showClient: !!nw.showClient, date: nw.date, trainer: (nw.trainer || '').trim(), duration: (nw.duration || '').trim(),
        bank: nw.bank || 'NONE', passMark: nw.bank === 'NONE' ? 0 : Number(nw.passMark), maxAttempts: nw.bank === 'NONE' ? 1 : Number(nw.maxAttempts),
        acceptUntil: nw.acceptUntil || addDays(nw.date, 3), status: 'Active'
      };
      db.workshops.push(rec); demoSave(db);
      return { ok: true, workshop: adminWs(rec, db) };
    }
    if (action === 'admin.workshops') {
      return { ok: true, workshops: db.workshops.slice().reverse().map(function (w) { return adminWs(w, db); }) };
    }
    if (action === 'admin.setStatus') {
      var t = db.workshops.filter(function (x) { return x.code === d.code; })[0];
      if (!t) return fail('Workshop not found.');
      t.status = d.status === 'Closed' ? 'Closed' : 'Active'; demoSave(db);
      return { ok: true, workshop: adminWs(t, db) };
    }
    if (action === 'admin.stats') {
      var sw = db.workshops.filter(function (x) { return x.code === d.code; })[0];
      if (!sw) return fail('Workshop not found.');
      var qsBank = sw.bank === 'NONE' ? [] : DEMO_BANK[sw.bank];
      var people = {}, order = [];
      db.submissions.filter(function (s) { return s.code === sw.code; }).forEach(function (s) {
        var p = people[s.email];
        if (!p) { p = people[s.email] = { email: s.email, attempts: 0, firstScore: s.pct, bestScore: s.pct, first: s.answers, rating: null, takeaway: '', optIn: false }; order.push(s.email); }
        p.name = s.name; p.attempts++; p.rating = s.rating; p.takeaway = s.takeaway || p.takeaway; p.optIn = p.optIn || s.optIn; p.lastAt = s.at;
        if (s.pct !== null && s.pct > p.bestScore) p.bestScore = s.pct;
      });
      var list = order.map(function (e) {
        var p = people[e]; var c = db.certs.filter(function (x) { return x.code === sw.code && x.email === e; })[0];
        p.certId = c ? c.id : ''; p.certType = c ? (c.type === 'achievement' ? 'Achievement' : 'Participation') : ''; p.isTest = /^test/i.test(p.name);
        return p;
      });
      var real = list.filter(function (p) { return !p.isTest; });
      var avg = function (a) { return a.length ? Math.round(a.reduce(function (s, x) { return s + x; }, 0) / a.length * 10) / 10 : null; };
      var ach = real.filter(function (p) { return p.certType === 'Achievement'; }).length;
      var dist = [0, 0, 0, 0, 0]; real.forEach(function (p) { if (p.rating) dist[p.rating - 1]++; });
      return {
        ok: true, workshop: adminWs(sw, db),
        kpis: {
          participants: real.length, testRowsExcluded: list.length - real.length,
          certificates: real.filter(function (p) { return p.certId; }).length, achievements: ach,
          participations: real.filter(function (p) { return p.certType === 'Participation'; }).length,
          passRate: real.length && sw.bank !== 'NONE' ? Math.round(ach / real.length * 100) : null,
          avgFirstScore: avg(real.map(function (p) { return p.firstScore; }).filter(function (x) { return x !== null; })),
          avgBestScore: avg(real.map(function (p) { return p.bestScore; }).filter(function (x) { return x !== null; })),
          avgRating: avg(real.map(function (p) { return Number(p.rating); }).filter(Boolean)),
          optIns: real.filter(function (p) { return p.optIn; }).length
        },
        questionStats: qsBank.map(function (q) {
          var n = 0, r = 0; real.forEach(function (p) { if (p.first && p.first[q.id] !== undefined) { n++; if (Number(p.first[q.id]) === q.correct) r++; } });
          return { id: q.id, topic: q.topic, text: q.text, answered: n, pctCorrect: n ? Math.round(r / n * 100) : null };
        }),
        ratingDist: dist,
        participants: list.map(function (p) { return { name: p.name, email: p.email, attempts: p.attempts, firstScore: p.firstScore, bestScore: p.bestScore, rating: p.rating, takeaway: p.takeaway, optIn: p.optIn, certId: p.certId, certType: p.certType, isTest: p.isTest, lastAt: p.lastAt }; })
      };
    }
    return fail('Unknown action.');
  }

  function demoCall(action, data) {
    return new Promise(function (resolve) {
      setTimeout(function () { resolve(demo(action, JSON.parse(JSON.stringify(data || {})))); }, 350);
    });
  }

  /* ---------------- public API ---------------- */
  var api = {
    isDemo: DEMO,
    getWorkshop: function (code) { return DEMO ? demoCall('workshop', { code: code }) : remoteGet('workshop', { code: code }); },
    verify: function (id) { return DEMO ? demoCall('verify', { id: id }) : remoteGet('verify', { id: id }); },
    submit: function (data) { return DEMO ? demoCall('submit', data) : remotePost('submit', data); },
    admin: function (action, adminKey, data) {
      var payload = Object.assign({ adminKey: adminKey }, data || {});
      return DEMO ? demoCall('admin.' + action, payload) : remotePost('admin.' + action, payload);
    }
  };

  window.IvyApi = api;
  window.IvyUtil = {
    cfg: cfg, formatDate: formatDate, todayIso: todayIso, addDays: addDays, siteBase: siteBase,
    workshopUrl: workshopUrl, verifyUrl: verifyUrl, utm: utm, esc: esc
  };
})();
