# Ivy HRMS (MVP)

A lightweight HRMS built on free-tier cloud services. MVP scope: employees, leave, attendance, holidays, employee documents and an AI HR policy assistant.

## Stack

| Layer | Service | Notes |
|---|---|---|
| App (UI + API) | One Cloudflare Worker | React + Vite for the UI, Hono for the API, served from the same domain |
| Database | Neon Postgres | Drizzle ORM. Hyperdrive can be added later for connection pooling |
| Login | Better Auth | Email + password, sessions stored in Postgres |
| Files | Cloudflare R2 | Employee documents, private to the employee and HR |
| Email | Resend | Leave applied / approved / rejected. Logged only if no API key |
| AI | NVIDIA NIM (OpenAI-compatible) | Swap provider by changing `AI_BASE_URL` and `AI_MODEL` |

## Roles

- **Admin**: everything, including company settings and giving HR/admin access
- **HR**: add/edit employees, approve any leave, holidays, leave types, all documents
- **Manager**: approve leave and see attendance for direct reports
- **Employee**: own leave, attendance, documents, profile

Approval rights follow the reporting line: anyone who has direct reports can approve their leave.

## Run locally

Needs Node 20+ and a Postgres database (local Postgres, or a free Neon project).

```bash
npm install
cp .dev.vars.example .dev.vars      # then fill in DATABASE_URL and BETTER_AUTH_SECRET
npm run db:migrate                  # creates the tables
npm run dev                         # http://localhost:5173
```

Open `/signup` to create the company and the first admin. Add employees from the Employees page. Each new employee gets a one-time temporary password, which the admin shares privately; the employee must set their own password at first login.

## Deploy to Cloudflare (first time)

1. **Neon**: create a project (pick the region closest to your users), copy the connection string, then run migrations against it:
   `DATABASE_URL="postgres://..." npx drizzle-kit migrate`
2. **Cloudflare**: `npx wrangler login`, then create the documents bucket: `npx wrangler r2 bucket create ivy-hrms-docs`
3. **Secrets**:
   ```bash
   npx wrangler secret put DATABASE_URL
   npx wrangler secret put BETTER_AUTH_SECRET     # e.g. output of: openssl rand -base64 32
   npx wrangler secret put RESEND_API_KEY         # optional
   npx wrangler secret put NVIDIA_API_KEY         # optional, from build.nvidia.com
   ```
4. Set `EMAIL_FROM` in `wrangler.jsonc` to an address on a domain verified in Resend.
5. `npm run deploy`
6. After creating your own company, set `ALLOW_SIGNUP` to `"false"` in `wrangler.jsonc` and deploy again, so strangers cannot create companies on your instance.

## Known limits and things to decide

- **Workers free plan CPU (10 ms per request)**: login uses PBKDF2 from the built-in crypto API to stay within it, capped at 100,000 iterations by Cloudflare. Plan to move to Workers Paid (USD 5/month) before payroll PDFs and bulk imports arrive in Phase 1.
- **Resend free plan** allows about 100 emails a day.
- **NVIDIA's free API** is meant for prototyping. For production, route through Cloudflare AI Gateway (`AI_BASE_URL`) and keep a fallback provider.
- **Personal data (DPDP Act)**: do not store full Aadhaar numbers; upload masked copies. Every change by HR/admin is written to `audit_log`.
- **Time zone** is fixed to IST for now.
- **Leave rules in MVP**: full annual quota from 1 January, no accrual, no carry-forward, no sandwich rule, requests cannot cross 31 December.

## Roadmap

- **Phase 1**: payroll basics (salary structure, payslips, PF/ESI/PT), monthly leave accrual and carry-forward, expense claims with receipt reading, onboarding/exit checklists, Excel import, PWA install, reports, password reset by email.
- **Phase 2**: performance reviews, helpdesk, WhatsApp notifications, statutory files (PF ECR, TDS working), biometric device integration, Tally export.

## Project layout

```
src/worker/        API (Cloudflare Worker)
  db/schema.ts     all tables
  lib/             auth, db connection, dates, leave balance logic, email, audit
  routes/          one file per module
src/web/           React UI
  pages/           one file per screen
drizzle/           SQL migrations (generated with npm run db:generate)
```
