import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { analyzeClientReply } from '../src/lib/nlp-promise-parser.ts';

// 2026-11-11 is a Wednesday
const WED_NOV_11 = '2026-11-11T14:00:00.000Z';

describe('analyzeClientReply', () => {
  it('detects promise-to-pay for "I will process this next Tuesday." and resolves exact date + grace resumeAt', () => {
    const res = analyzeClientReply('I will process this next Tuesday.', WED_NOV_11);
    assert.equal(res.intent, 'PROMISE_TO_PAY');
    assert.equal(res.shouldPause, true);
    assert.equal(res.newStatus, 'paused_promise');
    assert.equal(res.promisedDate, '2026-11-17');
    assert.equal(res.resumeAt, '2026-11-18');
    assert.ok(res.confidence >= 0.85);
    assert.ok(res.matchedPhrase);
  });

  it('resolves "this Friday", "tomorrow", "in 3 days", and "end of month"', () => {
    const fri = analyzeClientReply('Accounts payable has this queued to pay this Friday.', WED_NOV_11);
    assert.equal(fri.intent, 'PROMISE_TO_PAY');
    assert.equal(fri.promisedDate, '2026-11-13');
    assert.equal(fri.resumeAt, '2026-11-14');

    const tom = analyzeClientReply('Sorry for the delay, will pay tomorrow morning.', WED_NOV_11);
    assert.equal(tom.intent, 'PROMISE_TO_PAY');
    assert.equal(tom.promisedDate, '2026-11-12');
    assert.equal(tom.resumeAt, '2026-11-13');

    const days = analyzeClientReply('We will settle this in 3 days.', WED_NOV_11);
    assert.equal(days.intent, 'PROMISE_TO_PAY');
    assert.equal(days.promisedDate, '2026-11-14');

    const eom = analyzeClientReply('This is scheduled for the end of the month pay run.', WED_NOV_11);
    assert.equal(eom.intent, 'PROMISE_TO_PAY');
    assert.equal(eom.promisedDate, '2026-11-30');
    assert.equal(eom.resumeAt, '2026-12-01');
  });

  it('resolves explicit month/day dates like "Nov 20" and ISO dates', () => {
    const explicit = analyzeClientReply('Approved for our Nov 20 payment batch.', WED_NOV_11);
    assert.equal(explicit.intent, 'PROMISE_TO_PAY');
    assert.equal(explicit.promisedDate, '2026-11-20');
    assert.equal(explicit.resumeAt, '2026-11-21');

    const iso = analyzeClientReply('Will remit on 2026-11-24.', WED_NOV_11);
    assert.equal(iso.intent, 'PROMISE_TO_PAY');
    assert.equal(iso.promisedDate, '2026-11-24');
  });

  it('immediately pauses on informal disputes, billing errors, or missing PO requests', () => {
    const res = analyzeClientReply('Wait — line 2 billed 14 hours instead of 12, can you check before we pay?', WED_NOV_11);
    assert.equal(res.intent, 'DISPUTE_OR_QUESTION');
    assert.equal(res.shouldPause, true);
    assert.equal(res.newStatus, 'paused_dispute');
  });

  it('does not misclassify explicit refusal/negation as a promise to pay', () => {
    const res = analyzeClientReply('We will not pay this invoice until the deliverables are fixed.', WED_NOV_11);
    assert.equal(res.intent, 'DISPUTE_OR_QUESTION');
    assert.equal(res.shouldPause, true);
    assert.equal(res.newStatus, 'paused_dispute');
    assert.equal(res.promisedDate, null);
  });

  it('detects out-of-office auto-replies and pauses until return date', () => {
    const res = analyzeClientReply('Automatic reply: I am out of office until Nov 19 with no access to email.', WED_NOV_11);
    assert.equal(res.intent, 'OUT_OF_OFFICE');
    assert.equal(res.shouldPause, true);
    assert.equal(res.newStatus, 'paused_ooo');
    assert.equal(res.promisedDate, '2026-11-19');
    assert.equal(res.resumeAt, '2026-11-20');
  });

  it('detects payment claimed replies and pauses for confirmation', () => {
    const res = analyzeClientReply('Just paid via Stripe link five minutes ago!', WED_NOV_11);
    assert.equal(res.intent, 'PAYMENT_CLAIMED');
    assert.equal(res.shouldPause, true);
    assert.equal(res.newStatus, 'paused_payment_claimed');
  });

  it('does not pause on simple acknowledgement with no commitment or dispute', () => {
    const res = analyzeClientReply('Got it, thanks.', WED_NOV_11);
    assert.equal(res.intent, 'GENERAL_ACK');
    assert.equal(res.shouldPause, false);
    assert.equal(res.newStatus, null);
  });
});
