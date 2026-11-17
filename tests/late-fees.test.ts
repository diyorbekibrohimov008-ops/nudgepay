import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { calculateLateFeeBreakdown } from '../src/lib/late-fees.ts';

const defaultSettings = {
  boeBaseRatePct: 5.0,
  ecbRefRatePct: 4.5,
};

describe('calculateLateFeeBreakdown', () => {
  it('calculates UK Late Payment Act 1998 interest and £40 fixed compensation for debts under £1,000', () => {
    const result = calculateLateFeeBreakdown(
      {
        principalCents: 80_000,
        currency: 'GBP',
        dueDate: '2026-10-01',
        jurisdiction: 'UK',
        lateFeeEnabled: true,
        gracePeriodDays: 0,
        customMonthlyRatePct: 1.5,
        customFlatFeeCents: 0,
        status: 'overdue',
      },
      '2026-10-31T12:00:00Z',
      defaultSettings,
    );

    assert.equal(result.daysPastDue, 30);
    assert.equal(result.billableDays, 30);
    assert.equal(result.annualRatePct, 13.0);
    assert.equal(result.interestCents, 855);
    assert.equal(result.fixedCompensationCents, 4000);
    assert.equal(result.accruedFeeCents, 4855);
    assert.equal(result.totalDueCents, 84855);
    assert.match(result.statutoryReference, /Late Payment of Commercial Debts/i);
  });

  it('applies £70 and £100 UK compensation tiers at £1,000 and £10,000 boundaries', () => {
    const mid = calculateLateFeeBreakdown(
      {
        principalCents: 385_000,
        currency: 'GBP',
        dueDate: '2026-10-01',
        jurisdiction: 'UK',
        lateFeeEnabled: true,
        gracePeriodDays: 0,
        customMonthlyRatePct: 1.5,
        customFlatFeeCents: 0,
        status: 'overdue',
      },
      '2026-10-11T00:00:00Z',
      defaultSettings,
    );
    assert.equal(mid.fixedCompensationCents, 7000);

    const high = calculateLateFeeBreakdown(
      {
        principalCents: 1_200_000,
        currency: 'GBP',
        dueDate: '2026-10-01',
        jurisdiction: 'UK',
        lateFeeEnabled: true,
        gracePeriodDays: 0,
        customMonthlyRatePct: 1.5,
        customFlatFeeCents: 0,
        status: 'overdue',
      },
      '2026-10-11T00:00:00Z',
      defaultSettings,
    );
    assert.equal(high.fixedCompensationCents, 10000);
  });

  it('calculates EU Directive 2011/7/EU interest and €40 fixed recovery cost', () => {
    const result = calculateLateFeeBreakdown(
      {
        principalCents: 160_000,
        currency: 'EUR',
        dueDate: '2026-10-01',
        jurisdiction: 'EU',
        lateFeeEnabled: true,
        gracePeriodDays: 0,
        customMonthlyRatePct: 1.5,
        customFlatFeeCents: 0,
        status: 'overdue',
      },
      '2026-10-11T08:00:00Z',
      defaultSettings,
    );

    assert.equal(result.daysPastDue, 10);
    assert.equal(result.annualRatePct, 12.5);
    assert.equal(result.interestCents, 548);
    assert.equal(result.fixedCompensationCents, 4000);
    assert.equal(result.accruedFeeCents, 4548);
    assert.equal(result.totalDueCents, 164548);
  });

  it('respects grace period and custom monthly rate for US_CUSTOM contracts', () => {
    const result = calculateLateFeeBreakdown(
      {
        principalCents: 240_000,
        currency: 'USD',
        dueDate: '2026-10-01',
        jurisdiction: 'US_CUSTOM',
        lateFeeEnabled: true,
        gracePeriodDays: 3,
        customMonthlyRatePct: 1.5,
        customFlatFeeCents: 2500,
        status: 'overdue',
      },
      '2026-10-11T08:00:00Z',
      defaultSettings,
    );

    assert.equal(result.daysPastDue, 10);
    assert.equal(result.billableDays, 7);
    assert.equal(result.annualRatePct, 18.0);
    assert.equal(result.interestCents, 828);
    assert.equal(result.fixedCompensationCents, 2500);
    assert.equal(result.accruedFeeCents, 3328);
    assert.equal(result.totalDueCents, 243328);
  });

  it('charges zero fee when disabled or not past grace period, while exposing waived preview', () => {
    const waived = calculateLateFeeBreakdown(
      {
        principalCents: 100_000,
        currency: 'GBP',
        dueDate: '2026-10-01',
        jurisdiction: 'UK',
        lateFeeEnabled: false,
        gracePeriodDays: 0,
        customMonthlyRatePct: 1.5,
        customFlatFeeCents: 0,
        status: 'overdue',
      },
      '2026-10-11T08:00:00Z',
      defaultSettings,
    );
    assert.equal(waived.accruedFeeCents, 0);
    assert.equal(waived.totalDueCents, 100_000);
    assert.ok(waived.waivedPreviewCents > 7000);

    const inGrace = calculateLateFeeBreakdown(
      {
        principalCents: 240_000,
        currency: 'USD',
        dueDate: '2026-10-10',
        jurisdiction: 'US_CUSTOM',
        lateFeeEnabled: true,
        gracePeriodDays: 3,
        customMonthlyRatePct: 1.5,
        customFlatFeeCents: 2500,
        status: 'overdue',
      },
      '2026-10-12T08:00:00Z',
      defaultSettings,
    );
    assert.equal(inGrace.daysPastDue, 2);
    assert.equal(inGrace.billableDays, 0);
    assert.equal(inGrace.accruedFeeCents, 0);
  });
});
