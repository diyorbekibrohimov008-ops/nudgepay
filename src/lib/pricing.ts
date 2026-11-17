import { calculateLateFeeBreakdown, diffCalendarDays } from './late-fees.ts';
import type { AppState, PerformanceFeeEntry, PricingTier, ThreadMessage } from './types.ts';

export const PRICING_PLANS: Record<
  PricingTier,
  {
    name: string;
    monthlyCents: number;
    perRecoveryCents: number;
    badge: string;
    description: string;
  }
> = {
  pay_per_recovery: {
    name: 'Pay-Per-Recovery',
    monthlyCents: 0,
    perRecoveryCents: 100,
    badge: '$0/mo + $1/collected',
    description: 'Free to chase unlimited invoices. Pay $1 only when an overdue invoice actually gets paid.',
  },
  pro_15: {
    name: 'Freelancer Pro',
    monthlyCents: 1500,
    perRecoveryCents: 0,
    badge: '$15/mo flat',
    description: 'Unlimited invoices, $0 collection fees, custom tone templates & statutory late-fee notices.',
  },
  agency_39: {
    name: 'Micro-Agency',
    monthlyCents: 3900,
    perRecoveryCents: 0,
    badge: '$39/mo flat',
    description: 'Multi-seat team access, custom Reply-To domain, Stripe Connect & priority webhook logs.',
  },
};

export const PAIDNICE_ENTRY_MONTHLY_CENTS = 6900; // £49 / $69/mo

export function markInvoicePaid(
  state: AppState,
  invoiceId: string,
  paidAtIso: string,
  source: 'manual' | 'stripe_webhook' | 'client_claim_verified' = 'manual',
): AppState {
  const target = state.invoices.find((i) => i.id === invoiceId);
  if (!target || target.status === 'paid') {
    return state;
  }

  const breakdown = calculateLateFeeBreakdown(target, paidAtIso, {
    boeBaseRatePct: state.settings.boeBaseRatePct,
    ecbRefRatePct: state.settings.ecbRefRatePct,
  });

  const wasOverdue =
    diffCalendarDays(target.dueDate, paidAtIso) > 0 ||
    target.status === 'overdue' ||
    target.status === 'paused_promise' ||
    target.status === 'paused_dispute' ||
    target.status === 'paused_ooo' ||
    target.status === 'paused_payment_claimed' ||
    target.sentStages.some((s) => s !== 'day_minus_3');

  const plan = PRICING_PLANS[state.settings.pricingTier];
  const platformFeeCents = wasOverdue ? plan.perRecoveryCents : 0;

  const systemMsg: ThreadMessage = {
    id: `msg_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    direction: 'system',
    sender: 'NudgePay Billing Engine',
    recipient: state.settings.replyFromEmail,
    subject: `Invoice ${target.invoiceNumber} marked Paid (${source})`,
    body: wasOverdue
      ? `Payment confirmed via ${source}. All chasing stopped. ${platformFeeCents > 0 ? '$1.00 recovery fee logged (overdue collection).' : '$0 recovery fee (included in plan).'}`
      : `Paid on time before overdue chasing began. $0 platform fee.`,
    createdAt: paidAtIso,
  };

  const feeEntry: PerformanceFeeEntry = {
    id: `fee_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    invoiceId: target.id,
    invoiceNumber: target.invoiceNumber,
    clientName: target.clientName,
    recoveredPrincipalCents: target.principalCents,
    recoveredLateFeeCents: breakdown.accruedFeeCents,
    currency: target.currency,
    platformFeeCents,
    tierAtCollection: state.settings.pricingTier,
    collectedAt: paidAtIso,
  };

  return {
    ...state,
    invoices: state.invoices.map((inv) =>
      inv.id === invoiceId
        ? {
            ...inv,
            status: 'paid',
            paidAt: paidAtIso,
            resumeAt: null,
            pauseReason: null,
            collectedTotalCents: breakdown.totalDueCents,
            wasOverdueWhenPaid: wasOverdue,
            updatedAt: paidAtIso,
            messages: [...inv.messages, systemMsg],
          }
        : inv,
    ),
    performanceFees: [...state.performanceFees, feeEntry],
  };
}

export interface BillingSummary {
  tier: PricingTier;
  planName: string;
  monthlyBaseCents: number;
  performanceFeesCents: number;
  totalMonthlyCostCents: number;
  paidniceMonthlyCents: number;
  savingsVsPaidniceCents: number;
  totalRecoveredCents: number;
  recoveredOverdueCount: number;
}

export function computeBillingSummary(state: AppState): BillingSummary {
  const plan = PRICING_PLANS[state.settings.pricingTier];
  const performanceFeesCents = state.performanceFees.reduce((sum, f) => sum + f.platformFeeCents, 0);
  const totalMonthlyCostCents = plan.monthlyCents + performanceFeesCents;
  const totalRecoveredCents = state.performanceFees.reduce(
    (sum, f) => sum + f.recoveredPrincipalCents + f.recoveredLateFeeCents,
    0,
  );
  const recoveredOverdueCount = state.performanceFees.filter((f) => f.recoveredPrincipalCents > 0).length;

  return {
    tier: state.settings.pricingTier,
    planName: plan.name,
    monthlyBaseCents: plan.monthlyCents,
    performanceFeesCents,
    totalMonthlyCostCents,
    paidniceMonthlyCents: PAIDNICE_ENTRY_MONTHLY_CENTS,
    savingsVsPaidniceCents: PAIDNICE_ENTRY_MONTHLY_CENTS - totalMonthlyCostCents,
    totalRecoveredCents,
    recoveredOverdueCount,
  };
}
