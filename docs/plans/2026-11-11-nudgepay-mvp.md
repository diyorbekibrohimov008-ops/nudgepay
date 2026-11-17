# NudgePay Full MVP Implementation Plan

**Goal:** Build and deploy NudgePay, a 24/7 freelancer-first automated invoice chasing & statutory late-fee SaaS on Vercel Hobby with zero accounting-suite dependency.

**Architecture:** Next.js 15 App Router + TypeScript backend and UI deployed on Vercel, backed by Vercel Blob private storage (`@vercel/blob`) with automatic local JSON fallback for tests/dev, Vercel Cron/Schedules for daily chase ticks, and zero-dependency pure-TypeScript domain engines for statutory late-fee calculation, binary PDF invoice parsing, human-tone cadence orchestration, pricing ledger tracking, and natural-language promise-to-pay / dispute detection.

**Tech Stack:** Next.js 15, React 19, TypeScript, Tailwind CSS v3, Lucide Icons, `@vercel/blob`, Node 24 native test runner (`node --test`).

## Modules & TDD Tasks

1. **Task 1: Shared Domain Types & Statutory Late-Fee Engine (`src/lib/types.ts`, `src/lib/late-fees.ts`)**
   - UK Late Payment Act 1998 (8% + BoE base rate simple daily interest + £40/£70/£100 tier compensation)
   - EU Late Payment Directive 2011/7/EU (8% + ECB rate + €40 fixed cost)
   - US / Custom Contract terms (monthly % prorated daily + flat fee + grace period)
   - Waiver toggle (`lateFeeEnabled: false`) returns 0 accrued fee with `waivedPreviewCents`

2. **Task 2: Smart NLP Promise-to-Pay, Dispute & OOO Detector (`src/lib/nlp-promise-parser.ts`)**
   - Detects `PAYMENT_CLAIMED`, `DISPUTE_OR_QUESTION`, `OUT_OF_OFFICE`, `PROMISE_TO_PAY`, `GENERAL_ACK`, `NONE`
   - Resolves relative dates (*"next Tuesday"*, *"this Friday"*, *"tomorrow"*, *"in 3 days"*, *"end of month"*, *"Nov 18"*, *"on the 15th"*) relative to `receivedAt`
   - Outputs `resumeAt` = `promisedDate + 1 day` grace buffer and a warm acknowledgement draft

3. **Task 3: Pure-Node PDF Invoice Text & Field Extractor + Stripe URL Inspector (`src/lib/pdf-invoice-parser.ts`, `src/lib/stripe-link.ts`)**
   - Decompresses PDF `/FlateDecode` streams via `node:zlib` and extracts text operators + raw ASCII fallback
   - Extracts invoice number, amount & currency, due date / Net terms, client name/email, and embedded Stripe links
   - Validates & inspects Stripe invoice URLs safely

4. **Task 4: Adaptive Human-Tone Cadence Engine, Scheduler & Pricing Ledger (`src/lib/cadence-engine.ts`, `src/lib/pricing.ts`, `src/lib/seed.ts`)**
   - Renders human-sounding reminders across 3 tones (`warm`, `neutral`, `firm`) and `promise_broken` check-ins
   - Advances due/overdue/paused-expired invoices idempotently per scheduler tick
   - Computes $0 + $1/collected-overdue vs $15/mo Pro vs $39/mo Agency fees and savings vs Paidnice ($69/mo)

5. **Task 5: Storage & Email Adapters (`src/lib/storage.ts`, `src/lib/mailer.ts`)**
   - Private `@vercel/blob` JSON state + PDF storage when `BLOB_READ_WRITE_TOKEN` exists; local JSON fallback for dev/tests
   - Resend email dispatch when `RESEND_API_KEY` is configured; recorded sandbox delivery otherwise

6. **Task 6: Next.js API Routes & Webhook/Cron Endpoints (`src/app/api/...`)**
   - Full CRUD, PDF upload/parse, Stripe link inspection, client reply NLP endpoint, Resend/Postmark inbound webhook, Stripe `invoice.paid` webhook, Vercel Cron tick, settings & demo reset

7. **Task 7: Frontend Command Center UI (`src/app/page.tsx`, `src/components/...`)**
   - Freelancer fintech workspace: KPI strip, filterable invoice list, split inspector (NLP reply simulator + thread, statutory late-fee audit card, cadence timeline), Add Invoice modal (Stripe link / PDF / manual), Pricing & Integrations view

8. **Task 8: Remote Build/Test Verification & Production Vercel Deployment**
   - Create Vercel project + private Blob store, verify build & tests in Vercel Sandbox / Cloud Build, deploy production URL, verify health & live UI via `web_fetch_vercel_url`
