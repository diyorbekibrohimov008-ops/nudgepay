import { applyClientReplyToInvoice, evaluateSchedulerTick, renderChaseEmail } from './cadence-engine.ts';
import { calculateLateFeeBreakdown, diffCalendarDays } from './late-fees.ts';
import { sendChaseEmail } from './mailer.ts';
import { computeBillingSummary, markInvoicePaid, type BillingSummary } from './pricing.ts';
import { createSeedState } from './seed.ts';
import { defaultStorage, getEffectiveNowIso } from './storage.ts';
import { parseStripeInvoiceUrl } from './stripe-link.ts';
import type {
  AppState,
  CadenceStageKey,
  Currency,
  Invoice,
  InvoiceSource,
  InvoiceStatus,
  Jurisdiction,
  LateFeeBreakdown,
  PerformanceFeeEntry,
  PricingTier,
  ReplyAnalysis,
  ToneMode,
  WorkspaceSettings,
} from './types.ts';

export interface EnrichedInvoice extends Invoice {
  lateFee: LateFeeBreakdown;
  nextPreview: {
    stageKey: CadenceStageKey;
    subject: string;
    body: string;
  } | null;
}

export interface WorkspaceView {
  effectiveNowIso: string;
  storageMode: 'vercel_blob' | 'local_json';
  settings: WorkspaceSettings;
  billingSummary: BillingSummary;
  invoices: EnrichedInvoice[];
  performanceFees: PerformanceFeeEntry[];
  lastSchedulerRunAt: string | null;
}

export interface CreateInvoiceInput {
  invoiceNumber: string;
  clientName: string;
  clientEmail: string;
  principalCents: number;
  currency: Currency;
  issueDate?: string;
  dueDate: string;
  source: InvoiceSource;
  stripeUrl?: string;
  pdfBlobPathname?: string;
  pdfFilename?: string;
  jurisdiction: Jurisdiction;
  lateFeeEnabled?: boolean;
  gracePeriodDays?: number;
  customMonthlyRatePct?: number;
  customFlatFeeCents?: number;
  tone?: ToneMode;
}

export function createWorkspaceService(storage = defaultStorage) {
  function buildView(state: AppState): WorkspaceView {
    const effectiveNowIso = getEffectiveNowIso(state.settings.simulatedDayOffset);
    const rates = {
      boeBaseRatePct: state.settings.boeBaseRatePct,
      ecbRefRatePct: state.settings.ecbRefRatePct,
    };

    const invoices: EnrichedInvoice[] = state.invoices.map((inv) => {
      const lateFee = calculateLateFeeBreakdown(inv, effectiveNowIso, rates);
      let nextPreview: EnrichedInvoice['nextPreview'] = null;
      if (inv.status !== 'paid' && inv.status !== 'written_off') {
        const nextStep = state.settings.cadenceSteps.find(
          (s) => s.enabled && !inv.sentStages.includes(s.key),
        );
        const stageKey: CadenceStageKey = nextStep?.key ?? 'day_plus_28';
        const rendered = renderChaseEmail(inv, stageKey, state.settings, effectiveNowIso);
        nextPreview = { stageKey, subject: rendered.subject, body: rendered.body };
      }
      return { ...inv, lateFee, nextPreview };
    });

    return {
      effectiveNowIso,
      storageMode: storage.isBlobBacked() ? 'vercel_blob' : 'local_json',
      settings: {
        ...state.settings,
        resendApiKeyConfigured: Boolean(process.env.RESEND_API_KEY),
        stripeWebhookConfigured: Boolean(process.env.STRIPE_WEBHOOK_SECRET),
      },
      billingSummary: computeBillingSummary(state),
      invoices,
      performanceFees: state.performanceFees,
      lastSchedulerRunAt: state.lastSchedulerRunAt,
    };
  }

  async function getView(): Promise<WorkspaceView> {
    const state = await storage.loadState();
    return buildView(state);
  }

  async function createInvoice(input: CreateInvoiceInput): Promise<WorkspaceView> {
    const state = await storage.loadState();
    const nowIso = getEffectiveNowIso(state.settings.simulatedDayOffset);

    let stripeUrl: string | undefined;
    let stripeInvoiceId: string | undefined;
    if (input.stripeUrl?.trim()) {
      const parsed = parseStripeInvoiceUrl(input.stripeUrl);
      if (!parsed.valid) {
        throw new Error(parsed.error ?? 'Invalid Stripe URL');
      }
      stripeUrl = parsed.normalizedUrl;
      stripeInvoiceId = parsed.stripeInvoiceId ?? undefined;
    }

    const daysPastDue = diffCalendarDays(input.dueDate, nowIso);
    const initialStatus: InvoiceStatus = daysPastDue > 0 ? 'overdue' : 'upcoming';

    const newInvoice: Invoice = {
      id: `inv_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
      invoiceNumber: input.invoiceNumber.trim(),
      clientName: input.clientName.trim(),
      clientEmail: input.clientEmail.trim(),
      principalCents: Math.max(100, Math.round(input.principalCents)),
      currency: input.currency,
      issueDate: input.issueDate || nowIso.slice(0, 10),
      dueDate: input.dueDate.slice(0, 10),
      source: input.source,
      stripeUrl,
      stripeInvoiceId,
      pdfBlobPathname: input.pdfBlobPathname,
      pdfFilename: input.pdfFilename,
      jurisdiction: input.jurisdiction,
      lateFeeEnabled: input.lateFeeEnabled ?? true,
      gracePeriodDays: input.gracePeriodDays ?? (input.jurisdiction === 'US_CUSTOM' ? 3 : 0),
      customMonthlyRatePct: input.customMonthlyRatePct ?? 1.5,
      customFlatFeeCents: input.customFlatFeeCents ?? 0,
      tone: input.tone ?? state.settings.defaultTone,
      status: initialStatus,
      sentStages: [],
      promisedDate: null,
      resumeAt: null,
      pauseReason: null,
      promiseBrokenCount: 0,
      createdAt: nowIso,
      updatedAt: nowIso,
      messages: [],
    };

    const nextState: AppState = {
      ...state,
      invoices: [newInvoice, ...state.invoices],
    };
    await storage.saveState(nextState);
    return buildView(nextState);
  }

  async function updateInvoice(
    id: string,
    patch: {
      lateFeeEnabled?: boolean;
      tone?: ToneMode;
      jurisdiction?: Jurisdiction;
      status?: InvoiceStatus;
      gracePeriodDays?: number;
      customMonthlyRatePct?: number;
      customFlatFeeCents?: number;
      stripeUrl?: string;
    },
  ): Promise<WorkspaceView> {
    const state = await storage.loadState();
    const nowIso = getEffectiveNowIso(state.settings.simulatedDayOffset);
    const existing = state.invoices.find((i) => i.id === id);
    if (!existing) throw new Error('Invoice not found');

    if (patch.status === 'paid') {
      const paidState = markInvoicePaid(state, id, nowIso, 'manual');
      await storage.saveState(paidState);
      return buildView(paidState);
    }

    const updatedInvoices = state.invoices.map((inv) => {
      if (inv.id !== id) return inv;
      const nextStatus = patch.status ?? inv.status;
      return {
        ...inv,
        lateFeeEnabled: patch.lateFeeEnabled ?? inv.lateFeeEnabled,
        tone: patch.tone ?? inv.tone,
        jurisdiction: patch.jurisdiction ?? inv.jurisdiction,
        gracePeriodDays: patch.gracePeriodDays ?? inv.gracePeriodDays,
        customMonthlyRatePct: patch.customMonthlyRatePct ?? inv.customMonthlyRatePct,
        customFlatFeeCents: patch.customFlatFeeCents ?? inv.customFlatFeeCents,
        stripeUrl: patch.stripeUrl !== undefined ? patch.stripeUrl : inv.stripeUrl,
        status: nextStatus,
        resumeAt: nextStatus === 'overdue' ? null : inv.resumeAt,
        pauseReason: nextStatus === 'overdue' ? null : inv.pauseReason,
        updatedAt: nowIso,
      };
    });

    const nextState = { ...state, invoices: updatedInvoices };
    await storage.saveState(nextState);
    return buildView(nextState);
  }

  async function deleteInvoice(id: string): Promise<WorkspaceView> {
    const state = await storage.loadState();
    const nextState = {
      ...state,
      invoices: state.invoices.filter((i) => i.id !== id),
    };
    await storage.saveState(nextState);
    return buildView(nextState);
  }

  async function recordClientReply(
    id: string,
    senderEmail: string,
    messageBody: string,
  ): Promise<{ view: WorkspaceView; analysis: ReplyAnalysis }> {
    const state = await storage.loadState();
    const nowIso = getEffectiveNowIso(state.settings.simulatedDayOffset);
    const target = state.invoices.find((i) => i.id === id);
    if (!target) throw new Error('Invoice not found');

    const { invoice, analysis } = applyClientReplyToInvoice(
      target,
      senderEmail || target.clientEmail,
      messageBody,
      nowIso,
    );

    const nextState: AppState = {
      ...state,
      invoices: state.invoices.map((i) => (i.id === id ? invoice : i)),
    };
    await storage.saveState(nextState);
    return { view: buildView(nextState), analysis };
  }

  async function sendManualNudge(id: string): Promise<WorkspaceView> {
    const state = await storage.loadState();
    const nowIso = getEffectiveNowIso(state.settings.simulatedDayOffset);
    const target = state.invoices.find((i) => i.id === id);
    if (!target) throw new Error('Invoice not found');

    const nextStep = state.settings.cadenceSteps.find(
      (s) => s.enabled && !target.sentStages.includes(s.key),
    );
    const stageKey: CadenceStageKey = nextStep?.key ?? 'day_plus_7';
    const rendered = renderChaseEmail(target, stageKey, state.settings, nowIso);
    const delivery = await sendChaseEmail({
      to: target.clientEmail,
      from: state.settings.replyFromEmail,
      replyTo: `reply+${target.id}@nudgepay.app`,
      subject: rendered.subject,
      body: rendered.body,
    });

    const nextInvoices = state.invoices.map((inv) => {
      if (inv.id !== id) return inv;
      const stages = inv.sentStages.includes(stageKey) ? inv.sentStages : [...inv.sentStages, stageKey];
      return {
        ...inv,
        status: inv.status === 'upcoming' && diffCalendarDays(inv.dueDate, nowIso) > 0 ? 'overdue' : inv.status,
        sentStages: stages,
        updatedAt: nowIso,
        messages: [
          ...inv.messages,
          {
            id: `msg_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
            direction: 'outbound' as const,
            sender: state.settings.replyFromEmail,
            recipient: inv.clientEmail,
            subject: rendered.subject,
            body: rendered.body,
            createdAt: nowIso,
            stageKey,
            deliveryMode: delivery.mode,
          },
        ],
      };
    });

    const nextState = { ...state, invoices: nextInvoices };
    await storage.saveState(nextState);
    return buildView(nextState);
  }

  async function runScheduler(options: { advanceDays?: number; resetClock?: boolean } = {}) {
    const state = await storage.loadState();
    const nextOffset = options.resetClock
      ? 0
      : state.settings.simulatedDayOffset + (options.advanceDays ?? 0);

    const shiftedState: AppState = {
      ...state,
      settings: {
        ...state.settings,
        simulatedDayOffset: nextOffset,
      },
    };

    const nowIso = getEffectiveNowIso(nextOffset);
    const { state: ticked, dispatched } = evaluateSchedulerTick(shiftedState, nowIso);

    for (const item of dispatched) {
      const delivery = await sendChaseEmail({
        to: item.recipient,
        from: ticked.settings.replyFromEmail,
        replyTo: `reply+${item.invoiceId}@nudgepay.app`,
        subject: item.message.subject,
        body: item.message.body,
      });
      item.message.deliveryMode = delivery.mode;
    }

    await storage.saveState(ticked);
    return {
      view: buildView(ticked),
      dispatchedCount: dispatched.length,
      dispatched,
    };
  }

  async function handleInboundEmail(payload: {
    to?: string;
    from?: string;
    text?: string;
    body?: string;
    invoiceId?: string;
  }): Promise<{ matched: boolean; view: WorkspaceView; analysis: ReplyAnalysis | null }> {
    const state = await storage.loadState();
    const messageBody = (payload.text ?? payload.body ?? '').trim();
    if (!messageBody) {
      return { matched: false, view: buildView(state), analysis: null };
    }

    let invoiceId = payload.invoiceId;
    if (!invoiceId && payload.to) {
      const tokenMatch = payload.to.match(/reply\+([a-zA-Z0-9_-]+)@/i);
      if (tokenMatch) invoiceId = tokenMatch[1];
    }

    let target = invoiceId ? state.invoices.find((i) => i.id === invoiceId) : undefined;
    if (!target && payload.from) {
      const fromLower = payload.from.toLowerCase();
      target = state.invoices.find(
        (i) => i.status !== 'paid' && fromLower.includes(i.clientEmail.toLowerCase()),
      );
    }

    if (!target) {
      return { matched: false, view: buildView(state), analysis: null };
    }

    const res = await recordClientReply(target.id, payload.from ?? target.clientEmail, messageBody);
    return { matched: true, view: res.view, analysis: res.analysis };
  }

  async function handleStripeEvent(event: {
    type?: string;
    data?: {
      object?: {
        id?: string;
        hosted_invoice_url?: string;
        metadata?: Record<string, string>;
      };
    };
  }): Promise<{ matched: boolean; view: WorkspaceView }> {
    const state = await storage.loadState();
    if (event.type !== 'invoice.paid' && event.type !== 'checkout.session.completed') {
      return { matched: false, view: buildView(state) };
    }

    const obj = event.data?.object;
    const match = state.invoices.find(
      (i) =>
        (obj?.metadata?.invoiceId && i.id === obj.metadata.invoiceId) ||
        (obj?.id && i.stripeInvoiceId === obj.id) ||
        (obj?.hosted_invoice_url && i.stripeUrl === obj.hosted_invoice_url),
    );

    if (!match) {
      return { matched: false, view: buildView(state) };
    }

    const nowIso = getEffectiveNowIso(state.settings.simulatedDayOffset);
    const updated = markInvoicePaid(state, match.id, nowIso, 'stripe_webhook');
    await storage.saveState(updated);
    return { matched: true, view: buildView(updated) };
  }

  async function updateSettings(patch: Partial<WorkspaceSettings> & { pricingTier?: PricingTier }): Promise<WorkspaceView> {
    const state = await storage.loadState();
    const nextState: AppState = {
      ...state,
      settings: {
        ...state.settings,
        ...patch,
      },
    };
    await storage.saveState(nextState);
    return buildView(nextState);
  }

  async function resetDemo(): Promise<WorkspaceView> {
    const fresh = createSeedState(new Date().toISOString());
    await storage.saveState(fresh);
    return buildView(fresh);
  }

  return {
    getView,
    createInvoice,
    updateInvoice,
    deleteInvoice,
    recordClientReply,
    sendManualNudge,
    runScheduler,
    handleInboundEmail,
    handleStripeEvent,
    updateSettings,
    resetDemo,
    storage,
  };
}

export const workspaceService = createWorkspaceService();
