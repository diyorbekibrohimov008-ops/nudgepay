import { calculateLateFeeBreakdown, diffCalendarDays, formatMoney } from './late-fees.ts';
import { analyzeClientReply } from './nlp-promise-parser.ts';
import type {
  AppState,
  CadenceStageKey,
  Invoice,
  ReplyAnalysis,
  ThreadMessage,
  ToneMode,
  WorkspaceSettings,
} from './types.ts';

export interface RenderedChaseEmail {
  subject: string;
  body: string;
  stageKey: CadenceStageKey;
}

export interface DispatchedChase {
  invoiceId: string;
  invoiceNumber: string;
  recipient: string;
  message: ThreadMessage;
}

function getFirstName(fullName: string): string {
  return fullName.split(/[\s,]+/)[0] || fullName;
}

function getToneOpening(tone: ToneMode, stageKey: CadenceStageKey, clientFirst: string): string {
  if (stageKey === 'promise_broken') {
    return tone === 'firm'
      ? `Hi ${clientFirst},\n\nFollowing up on the payment date you shared earlier, which has now passed without clearing on our end.`
      : `Hi ${clientFirst},\n\nHope your week is going well — just checking in on the payment date you mentioned earlier in case it slipped past the queue.`;
  }

  if (stageKey === 'day_minus_3') {
    return `Hi ${clientFirst},\n\nQuick friendly heads-up that your upcoming invoice is due in a few days.`;
  }

  if (stageKey === 'day_plus_1') {
    return tone === 'firm'
      ? `Hi ${clientFirst},\n\nThis invoice moved past its due date yesterday. Please let us know when payment is scheduled.`
      : `Hi ${clientFirst},\n\nJust floating this up in your inbox in case it got buried — the invoice below passed its due date yesterday.`;
  }

  if (stageKey === 'day_plus_7') {
    return tone === 'warm'
      ? `Hi ${clientFirst},\n\nChecking back in on this invoice (now 7 days past due). Totally understand things get busy — just reply with a payment date if it's queued for an upcoming pay run.`
      : `Hi ${clientFirst},\n\nFollowing up on the invoice below, which is now 7 days overdue.`;
  }

  if (stageKey === 'day_plus_14') {
    return tone === 'warm'
      ? `Hi ${clientFirst},\n\nWanted to send a quick note that this invoice is now two weeks overdue. If there's any issue with the work or invoice details, just hit reply and I'll pause reminders right away.`
      : `Hi ${clientFirst},\n\nThis is a formal reminder that the invoice below is now 14+ days past due.`;
  }

  return tone === 'warm'
    ? `Hi ${clientFirst},\n\nI'm following up one final time before escalating this balance. Please let me know today if this is in progress or if anything needs resolving.`
    : `Hi ${clientFirst},\n\nFinal notice: this invoice remains unpaid past 28 days overdue. Please settle the balance below or reply immediately to confirm a payment date.`;
}

export function renderChaseEmail(
  invoice: Invoice,
  stageKey: CadenceStageKey,
  settings: WorkspaceSettings,
  asOfIso: string,
): RenderedChaseEmail {
  const breakdown = calculateLateFeeBreakdown(invoice, asOfIso, {
    boeBaseRatePct: settings.boeBaseRatePct,
    ecbRefRatePct: settings.ecbRefRatePct,
  });

  const clientFirst = getFirstName(invoice.clientName);
  const principalStr = formatMoney(invoice.principalCents, invoice.currency);
  const feeStr = formatMoney(breakdown.accruedFeeCents, invoice.currency);
  const totalStr = formatMoney(breakdown.totalDueCents, invoice.currency);

  const stageSubjects: Record<CadenceStageKey, string> = {
    day_minus_3: `Heads-up: Invoice ${invoice.invoiceNumber} (${principalStr}) due ${invoice.dueDate}`,
    day_plus_1: `Quick nudge: Invoice ${invoice.invoiceNumber} (${principalStr})`,
    day_plus_7: `Following up: Invoice ${invoice.invoiceNumber} (${breakdown.daysPastDue}d overdue)`,
    day_plus_14: breakdown.accruedFeeCents > 0
      ? `Action needed: Invoice ${invoice.invoiceNumber} — Total ${totalStr} (incl. statutory fee)`
      : `Checking in: Invoice ${invoice.invoiceNumber} (${breakdown.daysPastDue}d overdue)`,
    day_plus_28: `Final notice: Invoice ${invoice.invoiceNumber} (${totalStr})`,
    promise_broken: `Checking in on ${invoice.promisedDate ?? 'planned'} payment: Invoice ${invoice.invoiceNumber}`,
  };

  const lines: string[] = [getToneOpening(invoice.tone, stageKey, clientFirst), ''];

  if (stageKey === 'promise_broken' && invoice.promisedDate) {
    lines.push(`You previously noted this would be processed around ${invoice.promisedDate}.`);
    lines.push('');
  }

  lines.push(`• Invoice: ${invoice.invoiceNumber}`);
  lines.push(`• Original amount: ${principalStr}`);
  lines.push(`• Due date: ${invoice.dueDate}${breakdown.daysPastDue > 0 ? ` (${breakdown.daysPastDue} days overdue)` : ''}`);

  if (invoice.lateFeeEnabled && breakdown.accruedFeeCents > 0) {
    lines.push(`• Statutory late fee & interest: ${feeStr} (${breakdown.statutoryReference})`);
    lines.push(`• Total payable today: ${totalStr}`);
  }

  if (invoice.stripeUrl) {
    lines.push('');
    lines.push(`Pay securely via Stripe: ${invoice.stripeUrl}`);
  } else if (invoice.pdfFilename) {
    lines.push('');
    lines.push(`Original PDF invoice attached: ${invoice.pdfFilename}`);
  }

  lines.push('');
  lines.push('Need another week or spotted an error? Just reply with a date (e.g. "processing next Tuesday") or question — automated follow-ups pause automatically.');
  lines.push('');
  lines.push(`Best,\n${settings.freelancerName}\n${settings.workspaceName}`);

  return {
    subject: stageSubjects[stageKey],
    body: lines.join('\n'),
    stageKey,
  };
}

export function applyClientReplyToInvoice(
  invoice: Invoice,
  senderEmail: string,
  messageBody: string,
  receivedAtIso: string,
  analysisOverride?: ReplyAnalysis,
): { invoice: Invoice; analysis: ReplyAnalysis } {
  const analysis = analysisOverride ?? analyzeClientReply(messageBody, receivedAtIso);

  const inboundMsg: ThreadMessage = {
    id: `msg_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    direction: 'inbound',
    sender: senderEmail,
    recipient: `reply+${invoice.id}@nudgepay.app`,
    subject: `Re: Invoice ${invoice.invoiceNumber}`,
    body: messageBody.trim(),
    createdAt: receivedAtIso,
    deliveryMode: 'inbound_webhook',
    analysis,
  };

  const nextInvoice: Invoice = {
    ...invoice,
    messages: [...invoice.messages, inboundMsg],
    updatedAt: receivedAtIso,
  };

  if (analysis.shouldPause && analysis.newStatus) {
    nextInvoice.status = analysis.newStatus;
    nextInvoice.promisedDate = analysis.promisedDate;
    nextInvoice.resumeAt = analysis.resumeAt;
    nextInvoice.pauseReason = analysis.explanation;
    if (analysis.intent === 'PROMISE_TO_PAY') {
      nextInvoice.sentStages = nextInvoice.sentStages.filter((s) => s !== 'promise_broken');
    }
  }

  return { invoice: nextInvoice, analysis };
}

export function evaluateSchedulerTick(
  state: AppState,
  nowIso: string,
): { state: AppState; dispatched: DispatchedChase[] } {
  const todayYmd = nowIso.slice(0, 10);
  const dispatched: DispatchedChase[] = [];

  const updatedInvoices = state.invoices.map((orig) => {
    const inv: Invoice = {
      ...orig,
      sentStages: [...orig.sentStages],
      messages: [...orig.messages],
    };

    if (inv.status === 'paid' || inv.status === 'written_off' || inv.status === 'paused_dispute' || inv.status === 'paused_payment_claimed') {
      return inv;
    }

    const alreadyEmailedToday = inv.messages.some(
      (m) => m.direction === 'outbound' && m.createdAt.slice(0, 10) === todayYmd,
    );
    if (alreadyEmailedToday) {
      return inv;
    }

    // Check if paused promise or OOO has reached its resume date
    if ((inv.status === 'paused_promise' || inv.status === 'paused_ooo') && inv.resumeAt) {
      if (todayYmd < inv.resumeAt.slice(0, 10)) {
        return inv;
      }

      const wasPromise = inv.status === 'paused_promise';
      inv.status = 'overdue';
      inv.resumeAt = null;
      inv.pauseReason = null;

      if (wasPromise) {
        inv.promiseBrokenCount += 1;
        if (!inv.sentStages.includes('promise_broken')) {
          const rendered = renderChaseEmail(inv, 'promise_broken', state.settings, nowIso);
          const msg: ThreadMessage = {
            id: `msg_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
            direction: 'outbound',
            sender: state.settings.replyFromEmail,
            recipient: inv.clientEmail,
            subject: rendered.subject,
            body: rendered.body,
            createdAt: nowIso,
            stageKey: 'promise_broken',
            deliveryMode: 'sandbox',
          };
          inv.sentStages.push('promise_broken');
          inv.messages.push(msg);
          inv.updatedAt = nowIso;
          dispatched.push({
            invoiceId: inv.id,
            invoiceNumber: inv.invoiceNumber,
            recipient: inv.clientEmail,
            message: msg,
          });
          return inv;
        }
      }
    }

    // Transition upcoming -> overdue if past dueDate
    const daysPastDue = diffCalendarDays(inv.dueDate, nowIso);
    if (inv.status === 'upcoming' && daysPastDue > 0) {
      inv.status = 'overdue';
    }

    // Find highest enabled cadence step whose dayOffset <= daysPastDue and not yet sent
    const dueSteps = state.settings.cadenceSteps
      .filter((step) => step.enabled && daysPastDue >= step.dayOffset && !inv.sentStages.includes(step.key))
      .sort((a, b) => a.dayOffset - b.dayOffset);

    const targetStep = dueSteps[dueSteps.length - 1];
    if (!targetStep) {
      return inv;
    }

    const rendered = renderChaseEmail(inv, targetStep.key, state.settings, nowIso);
    const msg: ThreadMessage = {
      id: `msg_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      direction: 'outbound',
      sender: state.settings.replyFromEmail,
      recipient: inv.clientEmail,
      subject: rendered.subject,
      body: rendered.body,
      createdAt: nowIso,
      stageKey: targetStep.key,
      deliveryMode: 'sandbox',
    };

    inv.sentStages.push(targetStep.key);
    inv.messages.push(msg);
    inv.updatedAt = nowIso;
    dispatched.push({
      invoiceId: inv.id,
      invoiceNumber: inv.invoiceNumber,
      recipient: inv.clientEmail,
      message: msg,
    });
    return inv;
  });

  return {
    state: {
      ...state,
      invoices: updatedInvoices,
      lastSchedulerRunAt: nowIso,
    },
    dispatched,
  };
}
