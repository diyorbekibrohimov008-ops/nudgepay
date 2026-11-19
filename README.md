# NudgePay

> Automated overdue invoice recovery, polite-to-firm cadence nudges, late-fee calculation, and client reply handling for freelancers and lean service teams.

> [!WARNING]
> **Project Status — Work in Progress (Not Fully Ready)**
> This project is currently under active development and is **not fully ready for production**. Some parts, features, or workflow steps will fail or behave unexpectedly. We are actively working on fixing all remaining issues.

## Overview

NudgePay helps freelancers, consultants, and small agencies replace awkward manual chasing with an automated invoice recovery desk:

- **Progressive Follow-Up Cadence:** Automatically stages and dispatches escalating reminders based on invoice due dates, grace periods, and configurable tone modes.
- **Late-Fee Engine & Jurisdiction Rules:** Calculates statutory or custom monthly/flat late fees across supported jurisdictions (`calculateLateFeeBreakdown`).
- **Reply Analysis & Auto-Pause:** Parses inbound client replies (`/api/inbound-email`, `/api/invoices/[id]/reply`) to pause or adjust chase schedules automatically.
- **Stripe Link & PDF Parsing:** Inspects Stripe invoice URLs and parses uploaded PDF invoices, with local JSON or `@vercel/blob` storage fallback.

## Tech Stack

- **Framework:** Next.js 16, React 19, TypeScript
- **Styling:** Tailwind CSS, Lucide Icons
- **Storage:** `@vercel/blob` (production) with local JSON persistence (`.data/`) fallback
- **Testing:** Node.js built-in test runner (`node --test tests/*.test.ts`)

## Local Development

```bash
npm install
npm run typecheck
npm test
npm run build
npm run dev
```
