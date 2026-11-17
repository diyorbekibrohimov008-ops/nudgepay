import type { Currency, InvoiceStatus, Jurisdiction, LateFeeBreakdown } from './types.ts';

export interface LateFeeInput {
  principalCents: number;
  currency: Currency;
  dueDate: string;
  jurisdiction: Jurisdiction;
  lateFeeEnabled: boolean;
  gracePeriodDays: number;
  customMonthlyRatePct: number;
  customFlatFeeCents: number;
  status: InvoiceStatus;
}

export interface LateFeeRates {
  boeBaseRatePct: number;
  ecbRefRatePct: number;
}

const MS_PER_DAY = 86_400_000;

export function parseUtcDateMs(dateStr: string): number {
  const datePart = dateStr.slice(0, 10);
  const [y, m, d] = datePart.split('-').map(Number);
  return Date.UTC(y, m - 1, d);
}

export function diffCalendarDays(fromDateIso: string, toDateIso: string): number {
  const fromMs = parseUtcDateMs(fromDateIso);
  const toMs = parseUtcDateMs(toDateIso);
  return Math.floor((toMs - fromMs) / MS_PER_DAY);
}

function getUkCompensationPence(principalPence: number): number {
  if (principalPence < 100_000) return 4_000;
  if (principalPence < 1_000_000) return 7_000;
  return 10_000;
}

export function calculateLateFeeBreakdown(
  invoice: LateFeeInput,
  asOfIso: string,
  rates: LateFeeRates,
): LateFeeBreakdown {
  const daysPastDue = Math.max(0, diffCalendarDays(invoice.dueDate, asOfIso));
  const grace = Math.max(0, invoice.gracePeriodDays);
  const billableDays = Math.max(0, daysPastDue - grace);

  let annualRatePct = 0;
  let fixedCompensationCents = 0;
  let statutoryReference = '';

  if (invoice.jurisdiction === 'UK') {
    annualRatePct = Number((8 + rates.boeBaseRatePct).toFixed(4));
    fixedCompensationCents = billableDays > 0 ? getUkCompensationPence(invoice.principalCents) : 0;
    statutoryReference = `UK Late Payment of Commercial Debts (Interest) Act 1998 (8% + ${rates.boeBaseRatePct.toFixed(2)}% BoE base rate)`;
  } else if (invoice.jurisdiction === 'EU') {
    annualRatePct = Number((8 + rates.ecbRefRatePct).toFixed(4));
    fixedCompensationCents = billableDays > 0 ? 4_000 : 0;
    statutoryReference = `EU Late Payment Directive 2011/7/EU (8% + ${rates.ecbRefRatePct.toFixed(2)}% ECB reference rate)`;
  } else {
    annualRatePct = Number((invoice.customMonthlyRatePct * 12).toFixed(4));
    fixedCompensationCents = billableDays > 0 ? Math.max(0, invoice.customFlatFeeCents) : 0;
    statutoryReference = `Custom Freelancer Contract Terms (${invoice.customMonthlyRatePct}%/mo · ${annualRatePct.toFixed(2)}% APR)`;
  }

  const dailyRateFactor = (annualRatePct / 100) / 365;
  const dailyInterestCents = billableDays > 0
    ? Math.round(invoice.principalCents * dailyRateFactor)
    : 0;
  const potentialInterestCents = billableDays > 0
    ? Math.round(invoice.principalCents * dailyRateFactor * billableDays)
    : 0;
  const potentialFeeCents = potentialInterestCents + fixedCompensationCents;

  const isActiveLateFee =
    invoice.lateFeeEnabled &&
    billableDays > 0 &&
    invoice.status !== 'paid' &&
    invoice.status !== 'written_off';

  const interestCents = isActiveLateFee ? potentialInterestCents : 0;
  const appliedFixedCents = isActiveLateFee ? fixedCompensationCents : 0;
  const accruedFeeCents = interestCents + appliedFixedCents;

  return {
    daysPastDue,
    billableDays,
    annualRatePct,
    dailyInterestCents: isActiveLateFee ? dailyInterestCents : 0,
    interestCents,
    fixedCompensationCents: appliedFixedCents,
    accruedFeeCents,
    waivedPreviewCents: !invoice.lateFeeEnabled && billableDays > 0 ? potentialFeeCents : 0,
    totalDueCents: invoice.principalCents + accruedFeeCents,
    statutoryReference,
  };
}

export function formatMoney(cents: number, currency: Currency): string {
  const symbols: Record<Currency, string> = {
    USD: '$',
    GBP: '£',
    EUR: '€',
  };
  const amount = (cents / 100).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return `${symbols[currency]}${amount}`;
}
