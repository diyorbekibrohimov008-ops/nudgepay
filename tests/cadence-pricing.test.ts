import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { renderChaseEmail, evaluateSchedulerTick, applyClientReplyToInvoice } from '../src/lib/cadence-engine.ts';
import { markInvoicePaid, computeBillingSummary } from '../src/lib/pricing.ts';
import { createSeedState } from '../src/lib/seed.ts';

describe('Cadence engine & scheduler', () => {
  it('renders human-tone email with statutory late fee breakdown and Stripe payment CTA', () => {
    const state = createSeedState('2026-11-11T12:00:00Z');
    const ukInv = state.invoices.find((i) => i.jurisdiction === 'UK')!;
    const email = renderChaseEmail(ukInv, 'day_plus_14', state.settings, '2026-11-11T12:00:00Z');

    assert.match(email.subject, new RegExp(ukInv.invoiceNumber));
    assert.match(email.body, /£/);
    assert.match(email.body, /Hi /);
    assert.doesNotMatch(email.body, /FINAL LEGAL DEMAND/i);
  });

  it('keeps paused promises and disputes silent before resumeAt, and resumes broken promises politely', () => {
    const state = createSeedState('2026-11-11T12:00:00Z');
    const northstar = state.invoices.find((i) => i.clientName.includes('Northstar'))!;

    // Client says "I will process this next Tuesday" on Wed Nov 11 -> promisedDate 2026-11-17, resumeAt 2026-11-18
    const replyRes = applyClientReplyToInvoice(
      northstar,
      'client@northstar.studio',
      'I will process this next Tuesday.',
      '2026-11-11T15:00:00Z',
    );
    assert.equal(replyRes.invoice.status, 'paused_promise');
    assert.equal(replyRes.invoice.promisedDate, '2026-11-17');
    assert.equal(replyRes.invoice.resumeAt, '2026-11-18');

    // Replace in state and tick on Nov 14 -> must remain paused and send 0 emails
    state.invoices = state.invoices.map((i) => (i.id === northstar.id ? replyRes.invoice : i));
    const midWeekTick = evaluateSchedulerTick(state, '2026-11-14T10:00:00Z');
    const pausedNorthstar = midWeekTick.state.invoices.find((i) => i.id === northstar.id)!;
    assert.equal(pausedNorthstar.status, 'paused_promise');
    assert.equal(midWeekTick.dispatched.filter((d) => d.invoiceId === northstar.id).length, 0);

    // Tick on Nov 18 (grace expired) -> politely resumes with promise_broken check-in
    const resumeTick = evaluateSchedulerTick(midWeekTick.state, '2026-11-18T10:00:00Z');
    const resumedNorthstar = resumeTick.state.invoices.find((i) => i.id === northstar.id)!;
    assert.equal(resumedNorthstar.status, 'overdue');
    assert.equal(resumedNorthstar.promiseBrokenCount, 1);
    assert.ok(resumedNorthstar.sentStages.includes('promise_broken'));
    const sent = resumeTick.dispatched.find((d) => d.invoiceId === northstar.id);
    assert.ok(sent);
    assert.match(sent.message.body, /2026-11-17|Tuesday/);

    // Same-day repeat tick is idempotent (no duplicate send)
    const repeatTick = evaluateSchedulerTick(resumeTick.state, '2026-11-18T16:00:00Z');
    assert.equal(repeatTick.dispatched.filter((d) => d.invoiceId === northstar.id).length, 0);
  });

  it('never chases paused_dispute invoices automatically', () => {
    const state = createSeedState('2026-11-11T12:00:00Z');
    const disputeInv = state.invoices.find((i) => i.status === 'paused_dispute')!;
    const tick = evaluateSchedulerTick(state, '2026-11-25T10:00:00Z');
    assert.equal(tick.dispatched.filter((d) => d.invoiceId === disputeInv.id).length, 0);
  });
});

describe('Pricing & performance fee ledger', () => {
  it('charges $1 only when an overdue invoice is collected on pay_per_recovery, and $0 for on-time or pro_15', () => {
    const state = createSeedState('2026-11-11T12:00:00Z');
    state.settings.pricingTier = 'pay_per_recovery';
    const initialFeeCount = state.performanceFees.length;

    // Overdue invoice collected -> +$1.00 fee
    const overdueInv = state.invoices.find((i) => i.status === 'overdue')!;
    const afterOverdue = markInvoicePaid(state, overdueInv.id, '2026-11-11T18:00:00Z', 'stripe_webhook');
    assert.equal(afterOverdue.performanceFees.length, initialFeeCount + 1);
    const addedFee = afterOverdue.performanceFees[afterOverdue.performanceFees.length - 1];
    assert.equal(addedFee.platformFeeCents, 100);

    // Idempotent duplicate webhook call does NOT charge another $1
    const duplicate = markInvoicePaid(afterOverdue, overdueInv.id, '2026-11-11T18:05:00Z', 'stripe_webhook');
    assert.equal(duplicate.performanceFees.length, initialFeeCount + 1);

    // On-time / upcoming invoice collected -> $0 fee
    const upcomingInv = {
      ...overdueInv,
      id: 'inv_ontime',
      invoiceNumber: 'INV-ONTIME',
      dueDate: '2026-12-01',
      status: 'upcoming' as const,
      sentStages: [],
    };
    duplicate.invoices.push(upcomingInv);
    const afterOntime = markInvoicePaid(duplicate, 'inv_ontime', '2026-11-11T18:10:00Z', 'manual');
    const ontimeFee = afterOntime.performanceFees.find((f) => f.invoiceId === 'inv_ontime');
    assert.equal(ontimeFee?.platformFeeCents, 0);

    // Pro $15/mo tier -> $0 performance fee on overdue recovery and $54/mo savings vs Paidnice ($69/mo)
    const proState = createSeedState('2026-11-11T12:00:00Z');
    proState.performanceFees = [];
    proState.settings.pricingTier = 'pro_15';
    const proOverdue = proState.invoices.find((i) => i.status === 'overdue')!;
    const afterPro = markInvoicePaid(proState, proOverdue.id, '2026-11-11T18:15:00Z', 'manual');
    assert.equal(afterPro.performanceFees[0].platformFeeCents, 0);
    const summary = computeBillingSummary(afterPro);
    assert.equal(summary.monthlyBaseCents, 1500);
    assert.equal(summary.performanceFeesCents, 0);
    assert.equal(summary.savingsVsPaidniceCents, 5400);
  });
});
