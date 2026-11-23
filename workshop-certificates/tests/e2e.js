/* End-to-end run: real pages + Code.gs on fake Google services.
 * node tests/e2e.js [outDir]   (needs Playwright with Chromium available) */
'use strict';
const path = require('path');
const fs = require('fs');
const assert = require('assert/strict');
const { chromium, devices } = require('playwright');
const { start } = require('./local-server');

const PORT = 8787;
const BASE = `http://localhost:${PORT}`;
const OUT = process.argv[2] || path.join(__dirname, 'out');
fs.mkdirSync(OUT, { recursive: true });

async function dump() { return (await fetch(BASE + '/__dump')).json(); }

function answerKey(d) {
  const key = {};
  d.sheets['Question Bank'].slice(1).forEach((r) => {
    const opts = { A: r[4], B: r[5], C: r[6], D: r[7] };
    key[r[3]] = opts[r[8]];
  });
  return key;
}

async function takeAssessment(page, code, who, key, mode) {
  await page.goto(`${BASE}/?w=${code}`);
  await page.waitForSelector('[data-view=details]:not([hidden])');
  await page.fill('#name', who.name);
  await page.fill('#email', who.email);
  await page.check('#consent');
  await page.click('#detailsNext');
  await answerAll(page, key, mode);
  await page.waitForSelector('[data-view=feedback]:not([hidden])');
  await page.click('.scale label:nth-child(' + who.rating + ')');
  if (who.takeaway) await page.fill('#takeaway', who.takeaway);
  if (who.optIn) await page.check('#optIn');
  await page.click('#submitBtn');
}

async function answerAll(page, key, mode) {
  for (;;) {
    await page.waitForSelector('[data-view=quiz]:not([hidden])');
    const q = await page.textContent('#qText');
    const labels = page.locator('#qChoices .choice');
    const n = await labels.count();
    let picked = false;
    for (let i = 0; i < n; i++) {
      const t = await labels.nth(i).locator('.box span:last-child').textContent();
      const right = t === key[q];
      if ((mode === 'right' && right) || (mode === 'wrong' && !right)) { await labels.nth(i).click(); picked = true; break; }
    }
    assert.ok(picked, 'could not pick an answer for: ' + q);
    const last = (await page.textContent('#qNext')) === 'Continue';
    await page.click('#qNext');
    if (last) return;
  }
}

(async () => {
  const { server, adminKey } = await start(PORT);
  const browser = await chromium.launch();
  const errors = [];
  try {
    /* ---------- Admin: create workshop ---------- */
    const desk = await browser.newContext({ viewport: { width: 1366, height: 860 }, acceptDownloads: true });
    const admin = await desk.newPage();
    admin.on('pageerror', (e) => errors.push('admin: ' + e.message));
    await admin.goto(BASE + '/admin.html');
    await admin.fill('#adminKey', adminKey);
    await admin.click('#gateBtn');
    await admin.waitForSelector('#tab-new:not([hidden])');
    await admin.waitForFunction(() => document.querySelectorAll('#bank option').length > 2);
    await admin.screenshot({ path: path.join(OUT, '01-admin-new.png'), fullPage: true });
    await admin.fill('#programName', 'Generative AI for Everyday Productivity');
    await admin.fill('#clientName', 'Demo Client Pvt Ltd');
    await admin.check('#showClient');
    await admin.fill('#trainer', 'Riya Sen');
    await admin.fill('#duration', '3 hours');
    await admin.selectOption('#bank', 'GENAI-WORKPLACE');
    await admin.click('#createBtn');
    await admin.waitForSelector('#present:not([hidden])');
    const code = (await admin.textContent('#pCode')).trim();
    assert.match(code, /^[A-Z2-9]{6}$/);
    await admin.waitForTimeout(400);
    await admin.screenshot({ path: path.join(OUT, '02-presenter.png') });
    const [slideDl] = await Promise.all([admin.waitForEvent('download'), admin.click('#pDlSlide')]);
    await slideDl.saveAs(path.join(OUT, 'qr-slide.png'));
    const [qrDl] = await Promise.all([admin.waitForEvent('download'), admin.click('#pDlQr')]);
    await qrDl.saveAs(path.join(OUT, 'qr.png'));
    await admin.click('#pClose');
    await admin.waitForSelector('#tab-list:not([hidden]) .ws');
    console.log('created workshop', code);

    const key = answerKey(await dump());

    /* ---------- Participant 1 on a phone: passes ---------- */
    const phone = await browser.newContext({ ...devices['iPhone 13'], acceptDownloads: true });
    const p1 = await phone.newPage();
    p1.on('pageerror', (e) => errors.push('p1: ' + e.message));
    await p1.goto(`${BASE}/?w=${code}`);
    await p1.waitForSelector('[data-view=details]:not([hidden])');
    await p1.fill('#name', 'Ananya Iyer');
    await p1.screenshot({ path: path.join(OUT, '03-phone-details.png'), fullPage: true });
    // validation: submit without email/consent
    await p1.click('#detailsNext');
    assert.ok(await p1.isVisible('#f-email .field-error'));
    await takeAssessment(p1, code, { name: 'Ananya Iyer', email: 'ananya@example.com', rating: 5, takeaway: 'Structured prompts for client emails', optIn: true }, key, 'right');
    await p1.waitForSelector('[data-view=certificate]:not([hidden]) #certFrame img');
    await p1.waitForTimeout(300);
    await p1.screenshot({ path: path.join(OUT, '04-phone-certificate.png'), fullPage: true });
    const heading = await p1.textContent('#certHeading');
    assert.match(heading, /You passed/);
    const shareText = await p1.inputValue('#shareText');
    assert.match(shareText, /Structured prompts/);
    assert.match(shareText, /\?c=IVY-/);
    const addHref = await p1.getAttribute('#addToProfile', 'href');
    assert.match(addHref, /linkedin\.com\/profile\/add\?startTask=CERTIFICATION_NAME/);
    const [pngDl] = await Promise.all([p1.waitForEvent('download'), p1.click('#dlPng')]);
    await pngDl.saveAs(path.join(OUT, 'certificate.png'));
    const [pdfDl] = await Promise.all([p1.waitForEvent('download'), p1.click('#dlPdf')]);
    await pdfDl.saveAs(path.join(OUT, 'certificate.pdf'));
    await p1.click('#tabBadge');
    await p1.waitForTimeout(200);
    const [badgeDl] = await Promise.all([p1.waitForEvent('download'), p1.click('#dlPng')]);
    await badgeDl.saveAs(path.join(OUT, 'badge.png'));
    assert.ok(fs.statSync(path.join(OUT, 'certificate.pdf')).size > 50000, 'pdf has content');

    // Revisit the QR link: certificate shown again from this device, no new row.
    await p1.goto(`${BASE}/?w=${code}`);
    await p1.waitForSelector('[data-view=certificate]:not([hidden])');
    assert.match(await p1.textContent('#certSub'), /already have a certificate/);

    let d = await dump();
    const certId = d.sheets.Certificates[1][1];
    assert.match(certId, /^IVY-\d{4}-[A-Z2-9]{6}$/);

    /* ---------- Participant 2: fails twice -> participation ---------- */
    const phone2 = await browser.newContext({ ...devices['Pixel 7'] });
    const p2 = await phone2.newPage();
    p2.on('pageerror', (e) => errors.push('p2: ' + e.message));
    await takeAssessment(p2, code, { name: 'Kabir Das', email: 'kabir@example.com', rating: 3 }, key, 'wrong');
    await p2.waitForSelector('[data-view=retry]:not([hidden])');
    await p2.screenshot({ path: path.join(OUT, '05-phone-retry.png'), fullPage: true });
    await p2.click('#retryBtn');
    await answerAll(p2, key, 'wrong');
    await p2.waitForSelector('[data-view=feedback]:not([hidden])');
    await p2.click('.scale label:nth-child(3)');
    await p2.click('#submitBtn');
    await p2.waitForSelector('[data-view=certificate]:not([hidden]) #certFrame img');
    assert.match(await p2.textContent('#certHeading'), /Thank you for attending/);

    /* ---------- Participant 3: same email from another device returns the same cert ---------- */
    const other = await browser.newContext();
    const p3 = await other.newPage();
    await takeAssessment(p3, code, { name: 'Ananya Iyer', email: 'ANANYA@example.com', rating: 4 }, key, 'right');
    await p3.waitForSelector('[data-view=certificate]:not([hidden])');
    assert.match(await p3.textContent('#certSub'), /already have a certificate/);

    d = await dump();
    assert.equal(d.sheets.Submissions.length - 1, 3, 'three attempt rows (1 pass + 2 fails)');
    assert.equal(d.sheets.Certificates.length - 1, 2);
    assert.equal(d.tz, 'Asia/Calcutta');

    /* ---------- Public verification ---------- */
    const viewer = await desk.newPage();
    viewer.on('pageerror', (e) => errors.push('verify: ' + e.message));
    await viewer.goto(`${BASE}/?c=${certId}`);
    await viewer.waitForSelector('[data-view=verify]:not([hidden]) #verifyFrame img');
    await viewer.waitForTimeout(300);
    await viewer.screenshot({ path: path.join(OUT, '06-verify-desktop.png'), fullPage: true });
    assert.match(await viewer.textContent('#verifyFacts'), /Ananya Iyer/);
    await viewer.goto(`${BASE}/?c=IVY-0000-AAAAAA`);
    await viewer.waitForSelector('[data-view=message]:not([hidden])');
    assert.match(await viewer.textContent('#msgBody'), /No certificate/);

    /* ---------- Admin results ---------- */
    await admin.click('#refreshList');
    await admin.waitForSelector('.ws button[data-act=results]');
    await admin.click('.ws button[data-act=results]');
    await admin.waitForSelector('#resBody .kpis');
    await admin.screenshot({ path: path.join(OUT, '07-admin-results.png'), fullPage: true });
    const kpiText = await admin.textContent('#resBody .kpis');
    assert.match(kpiText, /Participants2/);
    const [csvDl] = await Promise.all([admin.waitForEvent('download'), admin.click('#resCsv')]);
    await csvDl.saveAs(path.join(OUT, 'results.csv'));

    /* ---------- Landing page ---------- */
    const land = await phone.newPage();
    await land.goto(BASE + '/');
    await land.waitForSelector('[data-view=landing]:not([hidden])');
    await land.screenshot({ path: path.join(OUT, '08-landing-phone.png'), fullPage: true });

    /* ---------- Closed workshop ---------- */
    await admin.click('#resBack');
    await admin.waitForSelector('.ws button[data-act=toggle]');
    admin.once('dialog', (dlg) => dlg.accept());
    await admin.click('.ws button[data-act=toggle]');
    await admin.waitForFunction(() => /Reopen/.test(document.querySelector('.ws button[data-act=toggle]').textContent));
    const fresh = await browser.newContext();
    const p4 = await fresh.newPage();
    await p4.goto(`${BASE}/?w=${code}`);
    await p4.waitForSelector('[data-view=message]:not([hidden])');
    assert.match(await p4.textContent('#msgTitle'), /closed/);

    assert.deepEqual(errors, [], 'no page errors');
    console.log('E2E PASSED. Screenshots in', OUT);
  } catch (e) {
    console.error('E2E FAILED:', e);
    if (errors.length) console.error('Page errors:', errors);
    process.exitCode = 1;
  } finally {
    await browser.close();
    server.close();
  }
})();
