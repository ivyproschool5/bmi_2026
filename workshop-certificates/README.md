# Ivy Workshop Assessments and Certificates

At the end of a workshop you show a QR code. Participants scan it on their phones, take a short post-training assessment and leave feedback. They then get an Ivy Professional School certificate and a square badge. They can download both as PNG or PDF, share them on LinkedIn, or add them to their LinkedIn profile. Each certificate has an ID and a public verification page, and that page also promotes Ivy.

```
Trainer console (admin.html)        Participant page (index.html)          Google Sheet
  create workshop  ───────────────▶  ?w=CODE  details > quiz > feedback ──▶  Submissions (append-only)
  show QR / slide                     certificate + badge + LinkedIn         Certificates (append-only)
  live results, CSV                   ?c=IVY-2611-XXXXXX  public verify ◀──  Workshops, Question Bank
```

- **Front end:** static HTML/CSS/JS in `site/`. No build step. Host it anywhere that serves static files.
- **Back end:** one Google Apps Script file (`apps-script/Code.gs`) bound to a Google Sheet. It is free and needs no server.
- **Scoring runs on the server**, so participants never receive the answer keys.

## What it does

| | |
|---|---|
| Workshop inputs | Program name, client name, date, trainer, duration, question bank, pass mark, attempts, closing date |
| Participant flow | Name (with a live certificate preview), work email, consent, one question per screen in a shuffled order, a 1 to 5 rating, an optional takeaway, an optional opt-in for Ivy updates |
| Outcomes | Score at or above the pass mark: **Certificate of Achievement**. Below it with attempts left: a retry. Below it on the last attempt: **Certificate of Participation**. Workshops set to "No assessment" give a Participation certificate after the feedback form. |
| Certificate | A4 landscape PNG and PDF. Ivy logo top right, verification QR, certificate ID, sign-off by Prateek Agrawal and the trainer, and a footer with the approved figures |
| Badge | A 1080 x 1080 PNG, sized for LinkedIn posts |
| LinkedIn | **Share:** on a phone, opens the share sheet with the image attached. On a computer, copies the post text, downloads the image and opens LinkedIn. **Add to profile:** pre-fills the Licenses and Certifications form with the certificate URL and ID |
| Verification | `/?c=<ID>` shows the certificate and its details, plus links to Ivy programs and enterprise training (with UTM tags) |
| Trainer console | Create workshops. Present the QR full screen with a live completion counter. Download the QR or a 1920 x 1080 slide for your deck. Close or reopen submissions. See results (pass rate, average scores, % correct per question, ratings, participant list). Export CSV |
| Duplicate protection | One certificate per email per workshop. Submitting again returns the same certificate and adds no new row |
| Ivy promotion | Logo on every screen and image, an Ivy section with approved figures and program/enterprise links on the certificate and verification pages, hashtags in the LinkedIn post, an opt-in that captures leads |

## One-time setup (about 15 minutes)

### 1. Google Sheet and Apps Script

1. Create a blank Google Sheet in the Ivy Google account, for example `Ivy Workshop Certificates`.
2. Open **Extensions > Apps Script**. Delete the sample code, paste in all of `apps-script/Code.gs`, and save.
3. In the function dropdown pick `setup` and click **Run**. Approve the permissions. This creates four tabs: `Workshops`, `Question Bank` (with two starter banks), `Submissions` and `Certificates`. It also sets the time zone to IST and generates an **admin key**, which you will find in the Execution log. Afterwards you can see the key again from the Sheet menu: **Ivy Certificates > Show admin key**.
4. Click **Deploy > New deployment**, choose the type **Web app**, and set:
   - Execute as: **Me**
   - Who has access: **Anyone**
5. Click **Deploy** and copy the URL that ends in `/exec`.

### 2. Configure the site

Edit `site/config.js`:

```js
API_URL: 'https://script.google.com/macros/s/XXXX/exec',
SITE_URL: 'https://certificates.ivyproschool.com',   // where the site will live
LINKEDIN_ORG_ID: '',                                  // optional, see below
```

- `SITE_URL` is printed on every certificate and encoded in every QR code. Decide it **before** issuing real certificates. If you change it later, old certificates will point to the old address.
- `LINKEDIN_ORG_ID`: when set, "Add to profile" links the certification to Ivy's LinkedIn company page, so the Ivy logo shows on the participant's profile. You can find the number in the URL of the company page admin view (`linkedin.com/company/<number>/admin`). Without it, LinkedIn shows the plain text "Ivy Professional School".
- `SIGNATURE_IMAGE`: optional transparent PNG of the founder's signature, for example `assets/signature.png`. Without it, the sign-off is typed.

### 3. Host the `site/` folder

Use any one of these:
- **Netlify Drop:** drag the `site` folder onto app.netlify.com/drop, then add a custom domain.
- **Vercel / Netlify CLI:** deploy `site/` as a static project.
- **GitHub Pages:** publish the `site` folder.

The best option is a subdomain such as `certificates.ivyproschool.com`, so the verification links carry the Ivy domain.

After you deploy, change `og:image` in `site/index.html` to the absolute URL (`https://<your-site>/assets/og-card.jpg`). LinkedIn only shows a preview image when that URL is absolute.

### 4. Test before the first real workshop

1. Open `admin.html`, enter the admin key and create a test workshop.
2. Scan the QR code with your phone. Complete the assessment using a name that starts with **TEST**. Results ignore rows whose names start with TEST.
3. Check that a row appears in `Submissions` and in `Certificates`, then open the certificate's verification link.

## On the day of a workshop

1. Before the session, open `admin.html` and go to **New workshop**. Fill in the details and click **Create**.
2. Click **Download QR slide for deck** and put the slide at the end of your deck. Alternatively, keep the presenter screen open and press **Full screen** at the end of the session.
3. While people scan, the counter shows how many have completed.
4. Afterwards, go to **My workshops > Results** to see scores, the weakest questions, ratings and the participant list, and use **Export CSV** for the client report.
5. Submissions close automatically three days after the workshop. You can also click **Close submissions** yourself.

## Editing questions

Questions live in the `Question Bank` tab, and you can edit them directly in the Sheet:

| Bank ID | Question ID | Topic | Question | Option A | Option B | Option C | Option D | Correct Option | Active |
|---|---|---|---|---|---|---|---|---|---|

- To create a new set, add rows with a new **Bank ID**, for example `PROMPT-ENG-101`. It will appear in the console dropdown.
- **Question ID** must be unique and must never be reused. Results are matched on it.
- Two to four options are allowed. **Correct Option** is A, B, C or D.
- To retire a question, set **Active** to `No`. Do not delete it, or historical results lose their link to it.
- The two starter banks (`GENAI-WORKPLACE`, `AI-FOR-LEADERS`) are drafts. **Review them before using them with a client.**

## Data and privacy

- `Submissions` and `Certificates` are append-only. The script never edits, sorts or deletes those rows. Build reports in separate tabs or use the console.
- Participant emails are stored but never shown on certificates or on verification pages.
- The client name is always stored. It appears on certificates and LinkedIn posts **only** when "Show client name" is ticked for that workshop. Tick it only after the client has approved being named in public.
- If you export participant data to share with a client, remove personal identifiers that the client does not need.

## Limits to be aware of

- **The endpoint URL is public.** Anyone can see the Apps Script URL in the page source, much like a public Google Form link. With it, someone can submit attempts to a workshop that is open. They cannot read, edit or delete existing data, and the admin actions need the key. Closing dates and the Close button limit how long a workshop is exposed.
- **Anyone with the workshop link can earn a certificate** while the workshop is open, even if they did not attend. If this matters for a client, keep the window short or close submissions right after the session.
- **The admin key is a shared password** saved in the trainer's browser. Reset it from the Sheet menu if it leaks. After a reset, every trainer must enter the new key.
- **LinkedIn post pre-fill:** LinkedIn does not let a website attach an image to a post. On a computer the participant pastes the text (already copied) and adds the downloaded image. On a phone, the share sheet attaches the image directly. The `linkedin.com/feed/?shareActive=true&text=` link that opens LinkedIn with the text filled in is not an official, documented API. If LinkedIn stops supporting it, the copied text still works.
- **Apps Script quotas:** a consumer Google account allows about 20,000 URL calls a day, and Workspace accounts allow more. That is plenty for workshops. The Sheet handles tens of thousands of rows. Every call reads the tabs, so it will slow down after roughly 50,000 submissions. At that point, archive old rows into a second Sheet.

## Updating the backend later

After you edit `Code.gs`, go to **Deploy > Manage deployments**, click edit (the pencil) on the existing deployment, choose **Version: New version**, and click **Deploy**. This keeps the same `/exec` URL. If you create a new deployment instead, you get a new URL and must update `config.js`.

## Demo mode

If `API_URL` in `config.js` is empty, the site runs in demo mode. Data stays in the browser and the admin key is `demo`. Use it to preview the flow without a Sheet.

## Development and tests

```bash
cd workshop-certificates
node --test tests/          # backend: Code.gs on fake Google services (12 tests)
node tests/e2e.js out/      # browser end-to-end with Playwright, saves screenshots
node tests/local-server.js  # http://localhost:8787/admin.html with a local backend
```

`tests/fake-google.js` is a small in-memory stand-in for SpreadsheetApp and the other services. It is enough to test the logic locally, but it does not replace one real test against Google before going live.

## Files

```
workshop-certificates/
  apps-script/Code.gs     Backend: paste into Apps Script
  site/index.html         Participant flow and public verification
  site/admin.html         Trainer console
  site/config.js          The only file you need to edit
  site/js/api.js          API client and demo backend
  site/js/certificate.js  Certificate, badge, QR slide rendering and LinkedIn helpers
  site/assets/            Ivy logo, styles, social preview card
  site/vendor/            qrcode-generator 1.4.4 and jsPDF 2.5.1 (MIT), bundled locally
  tests/                  Backend tests, local server, end-to-end test
```
