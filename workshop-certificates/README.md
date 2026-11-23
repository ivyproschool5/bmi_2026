# Ivy Workshop Assessments and Certificates

At the end of a workshop you show a QR code. Participants scan it on their phones, take a short post-training assessment and give feedback. They then get an Ivy Professional School certificate and a square badge. They can download these as PNG or PDF, share them on LinkedIn, or add them to their LinkedIn profile. Every certificate has an ID and a public verification page, and that page also promotes Ivy.

Everything runs on Vercel, and it can be managed from an iPad or phone with no spreadsheet or code editor.

```
Trainer console  /admin.html          Participant page  /?w=CODE              Vercel
  question banks (paste text)           details > quiz > feedback  ───────▶  /api  (serverless function)
  create workshop, show QR / slide      certificate + badge + LinkedIn         private Blob storage
  live results, CSV export            Public verification  /?c=IVY-2611-XXXXXX
```

## What it does

| | |
|---|---|
| Workshop inputs | Program name, client name, date, trainer, duration, question bank, pass mark, attempts, closing date |
| Participant flow | Name (with a live certificate preview), work email, consent, one question per screen in a shuffled order, a 1 to 5 rating, an optional takeaway, an optional opt-in for Ivy updates |
| Outcomes | Score at or above the pass mark: **Certificate of Achievement**. Below it with attempts left: a retry. Below it on the last attempt: **Certificate of Participation**. "No assessment" workshops: feedback, then a Participation certificate |
| Certificate | A4 landscape PNG and PDF. Ivy logo top right, verification QR, certificate ID, sign-off by Prateek Agrawal and the trainer, and a footer with the approved figures |
| Badge | A 1080 x 1080 PNG for LinkedIn posts |
| LinkedIn | **Share:** on a phone, the share sheet opens with the image attached. On a computer, the post text is copied, the image downloads and LinkedIn opens. **Add to profile:** pre-fills Licenses and Certifications with the certificate URL and ID |
| Verification | `/?c=<ID>` shows the certificate and its details, plus links to Ivy programs and enterprise training (with UTM tags) |
| Question banks | Create and edit from the console by pasting plain text, with a live preview. Each workshop keeps its own copy of the questions, so later edits never change a workshop already created |
| Trainer console | Present the QR full screen with a live counter. Download the QR or a 1920 x 1080 slide for your deck. Close or reopen submissions. Results: pass rate, average scores, % correct per question, ratings, participant list, CSV export |
| Integrity | Scoring happens on the server, so answer keys never reach the browser. One certificate per email per workshop, even if someone submits twice at the same moment |

## Running a workshop (from an iPad or laptop)

1. Open `<site>/admin.html` and enter the admin key. It is saved on that device.
2. **New workshop:** fill in the details and click **Create workshop and show QR code**.
3. Either click **Download QR slide for deck** and add the slide to your closing slides, or keep the presenter screen open and press **Full screen** at the end of the session.
4. Watch the counter as people complete the assessment.
5. Afterwards, go to **My workshops > Results** for scores, the weakest questions, ratings and the participant list, and use **Export CSV** for the client report.
6. Submissions close automatically three days after the workshop. You can also click **Close submissions** yourself.

To test, use a name that starts with **TEST**. Results leave those rows out.

## Writing question banks

Go to **Question banks > New question bank** and paste questions in this format:

```
1. What does it mean when an AI tool hallucinates?
Topic: Basics
A) It refuses to answer
B) It gives confident but incorrect information *
C) It runs slowly
D) It repeats the prompt
```

- Put `*` at the end of the correct option. `(correct)` or a separate `Answer: B` line also works.
- Each question needs 2 to 4 options. `Topic:` is optional; it groups the per-question results.
- The preview shows how each question was read and flags anything missing before you save.
- The two starter banks (`GENAI-WORKPLACE`, `AI-FOR-LEADERS`) are drafts. **Review them before using them with a client.**

## Settings (`site/config.js`)

| Setting | Purpose |
|---|---|
| `API_URL` | `/api`. Leave it as is. Set it to `''` for demo mode, where data stays in the browser and the admin key is `demo` |
| `SITE_URL` | Leave it empty to use the address the page is served from |
| `IVY_WEBSITE`, `ENTERPRISE_URL` | Targets of the "Explore programs" and "Train your team" buttons |
| `LINKEDIN_ORG_ID` | Optional. Ivy's LinkedIn company page number. With it, the Ivy logo shows next to the certification on participants' profiles |
| `SIGNATORY_NAME`, `SIGNATORY_TITLE`, `SIGNATURE_IMAGE` | Sign-off on certificates. `SIGNATURE_IMAGE` takes an optional transparent PNG path |
| `PROOF_POINTS` | Figures shown in the Ivy section. Use approved figures only |

## Hosting and data

- **Vercel project** with `outputDirectory: site` and a serverless function at `api/index.js`.
- **Private Vercel Blob store**, connected to the project, so `BLOB_READ_WRITE_TOKEN` is set automatically. Nothing in it is publicly readable.
- **`ADMIN_KEY` environment variable** (sensitive) holds the trainer console password. If you change it in Vercel, redeploy.

Storage layout:

```
banks/<BANK-ID>.json                      question banks (with answer keys)
workshops/<CODE>.json                     workshop settings + snapshot of its questions
subs/<CODE>/<emailHash>/<time>_<id>.json  one file per attempt, never overwritten
certs/<CERT-ID>.json                      certificate register, never overwritten
certidx/<CODE>/<emailHash>.json           create-only marker: one certificate per person per workshop
```

Emails are stored inside records but never in file paths, and they never appear on certificates or verification pages. The client name appears on certificates and LinkedIn posts **only** when "Show client name" is ticked for that workshop. Tick it only after the client has approved being named in public.

## Limits to be aware of

- **Anyone with the workshop link can earn a certificate** while the workshop is open, even if they did not attend. Keep the window short, or close submissions right after the session if attendance matters to the client.
- **The admin key is a shared password.** Anyone who has it can create workshops and see participant emails. To rotate it, change `ADMIN_KEY` in the Vercel project settings and redeploy.
- **LinkedIn does not let a website attach an image to a post on desktop.** The participant pastes the copied text and adds the downloaded image. On phones, the share sheet attaches the image. The link that pre-fills the post text is not an official, documented LinkedIn API. If it stops working, the copied text still does.
- **Scale:** the results view reads every attempt for a workshop, which is fine for hundreds of participants per workshop. The workshop list reads every workshop, which stays quick up to a few hundred workshops. Archive old data beyond that.
- **No rate limiting** on the public endpoints. Vercel's platform DDoS protection applies, but there is no per-user throttle.

## Development

```bash
cd workshop-certificates
npm ci
npm test                    # backend logic on an in-memory store (13 tests)
node tests/e2e.js out/      # Playwright end-to-end: console, bank editor, phone flows, verify, results
npm run serve               # http://localhost:8787/admin.html  (admin key: local-test-key)
```

## Files

```
workshop-certificates/
  api/index.js            Vercel function: request parsing
  api/_lib/logic.js       All backend rules: scoring, attempts, certificates, stats
  api/_lib/store.js       Private Blob storage (and in-memory store for tests)
  api/_lib/seed-banks.js  Starter question banks
  site/index.html         Participant flow and public verification
  site/admin.html         Trainer console and question bank editor
  site/config.js          Settings
  site/js/                API client (with demo mode) and certificate rendering
  site/assets/            Ivy logo, styles, social preview card
  site/vendor/            qrcode-generator 1.4.4 and jsPDF 2.5.1 (MIT), bundled locally
  vercel.json             Hosting configuration
  tests/                  Backend tests, local server, end-to-end test
```
