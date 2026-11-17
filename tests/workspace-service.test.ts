import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createStorage } from '../src/lib/storage.ts';
import { createWorkspaceService } from '../src/lib/workspace-service.ts';

describe('Workspace service end-to-end workflows', () => {
  it('creates standalone Stripe invoice, pauses on NLP promise reply, advances clock, and settles via Stripe webhook', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'nudgepay-svc-'));
    const svc = createWorkspaceService(createStorage({ localDir: tmpDir }));

    // 1. Add Stripe link invoice already 5 days overdue
    const view1 = await svc.createInvoice({
      invoiceNumber: 'INV-2026-500',
      clientName: 'Brightleaf Media',
      clientEmail: 'ap@brightleaf.co',
      principalCents: 150_000,
      currency: 'GBP',
      dueDate: '2026-11-06',
      source: 'stripe_link',
      stripeUrl: 'https://invoice.stripe.com/i/acct_test/inv_brightleaf_500',
      jurisdiction: 'UK',
      lateFeeEnabled: true,
    });

    const created = view1.invoices.find((i) => i.invoiceNumber === 'INV-2026-500')!;
    assert.ok(created);
    assert.equal(created.status, 'overdue');
    assert.equal(created.stripeInvoiceId, 'inv_brightleaf_500');
    assert.ok(created.lateFee.accruedFeeCents >= 7000);

    // 2. Inbound email webhook matching reply+<id>@... with promise-to-pay
    const replyOut = await svc.handleInboundEmail({
      to: `reply+${created.id}@nudgepay.app`,
      from: 'ap@brightleaf.co',
      text: 'Hi! Approved — I will process this next Tuesday.',
    });
    assert.equal(replyOut.matched, true);
    assert.equal(replyOut.analysis?.intent, 'PROMISE_TO_PAY');
    const paused = replyOut.view.invoices.find((i) => i.id === created.id)!;
    assert.equal(paused.status, 'paused_promise');

    // 3. Stripe webhook marks invoice paid & logs $1 performance fee
    const beforeFees = replyOut.view.performanceFees.length;
    const stripeOut = await svc.handleStripeEvent({
      type: 'invoice.paid',
      data: {
        object: {
          id: 'inv_brightleaf_500',
          hosted_invoice_url: 'https://invoice.stripe.com/i/acct_test/inv_brightleaf_500',
        },
      },
    });
    assert.equal(stripeOut.matched, true);
    const paid = stripeOut.view.invoices.find((i) => i.id === created.id)!;
    assert.equal(paid.status, 'paid');
    assert.equal(stripeOut.view.performanceFees.length, beforeFees + 1);
    assert.equal(stripeOut.view.performanceFees.at(-1)?.platformFeeCents, 100);

    await fs.rm(tmpDir, { recursive: true, force: true });
  });
});
