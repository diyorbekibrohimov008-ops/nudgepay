export type Jurisdiction = 'UK' | 'EU' | 'US_CUSTOM';
export type Currency = 'USD' | 'GBP' | 'EUR';
export type InvoiceSource = 'stripe_link' | 'pdf_upload' | 'manual';
export type ToneMode = 'warm' | 'neutral' | 'firm';
export type PricingTier = 'pay_per_recovery' | 'pro_15' | 'agency_39';

export type InvoiceStatus =
  | 'upcoming'
  | 'overdue'
  | 'paused_promise'
  | 'paused_dispute'
  | 'paused_ooo'
  | 'paused_payment_claimed'
  | 'paid'
  | 'written_off';

export type ReplyIntent =
  | 'PROMISE_TO_PAY'
  | 'DISPUTE_OR_QUESTION'
  | 'OUT_OF_OFFICE'
  | 'PAYMENT_CLAIMED'
  | 'GENERAL_ACK'
  | 'NONE';

export type CadenceStageKey =
  | 'day_minus_3'
  | 'day_plus_1'
  | 'day_plus_7'
  | 'day_plus_14'
  | 'day_plus_28'
  | 'promise_broken';

export interface CadenceStepConfig {
  key: Exclude<CadenceStageKey, 'promise_broken'>;
  label: string;
  dayOffset: number;
  enabled: boolean;
  includeLateFeeNotice: boolean;
}

export interface ReplyAnalysis {
  intent: ReplyIntent;
  confidence: number;
  shouldPause: boolean;
  newStatus: InvoiceStatus | null;
  promisedDate: string | null;
  resumeAt: string | null;
  matchedPhrase: string | null;
  explanation: string;
  suggestedDraftReply: string;
}

export interface ThreadMessage {
  id: string;
  direction: 'outbound' | 'inbound' | 'system';
  sender: string;
  recipient: string;
  subject: string;
  body: string;
  createdAt: string;
  stageKey?: CadenceStageKey;
  deliveryMode?: 'resend' | 'sandbox' | 'inbound_webhook';
  analysis?: ReplyAnalysis;
}

export interface Invoice {
  id: string;
  invoiceNumber: string;
  clientName: string;
  clientEmail: string;
  principalCents: number;
  currency: Currency;
  issueDate: string;
  dueDate: string;
  source: InvoiceSource;
  stripeUrl?: string;
  stripeInvoiceId?: string;
  pdfBlobPathname?: string;
  pdfFilename?: string;
  jurisdiction: Jurisdiction;
  lateFeeEnabled: boolean;
  gracePeriodDays: number;
  customMonthlyRatePct: number;
  customFlatFeeCents: number;
  tone: ToneMode;
  status: InvoiceStatus;
  sentStages: CadenceStageKey[];
  promisedDate?: string | null;
  resumeAt?: string | null;
  pauseReason?: string | null;
  promiseBrokenCount: number;
  paidAt?: string | null;
  collectedTotalCents?: number | null;
  wasOverdueWhenPaid?: boolean;
  createdAt: string;
  updatedAt: string;
  messages: ThreadMessage[];
}

export interface LateFeeBreakdown {
  daysPastDue: number;
  billableDays: number;
  annualRatePct: number;
  dailyInterestCents: number;
  interestCents: number;
  fixedCompensationCents: number;
  accruedFeeCents: number;
  waivedPreviewCents: number;
  totalDueCents: number;
  statutoryReference: string;
}

export interface PerformanceFeeEntry {
  id: string;
  invoiceId: string;
  invoiceNumber: string;
  clientName: string;
  recoveredPrincipalCents: number;
  recoveredLateFeeCents: number;
  currency: Currency;
  platformFeeCents: number;
  tierAtCollection: PricingTier;
  collectedAt: string;
}

export interface WorkspaceSettings {
  workspaceName: string;
  freelancerName: string;
  replyFromEmail: string;
  pricingTier: PricingTier;
  defaultTone: ToneMode;
  boeBaseRatePct: number;
  ecbRefRatePct: number;
  resendApiKeyConfigured?: boolean;
  stripeWebhookConfigured?: boolean;
  simulatedDayOffset: number;
  cadenceSteps: CadenceStepConfig[];
}

export interface AppState {
  version: number;
  settings: WorkspaceSettings;
  invoices: Invoice[];
  performanceFees: PerformanceFeeEntry[];
  lastSchedulerRunAt: string | null;
  processedExecutionIds: string[];
}
