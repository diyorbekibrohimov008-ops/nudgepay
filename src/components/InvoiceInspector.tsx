'use client';

import { useState } from 'react';
import { formatMoney } from '@/lib/late-fees';
import type { EnrichedInvoice } from '@/lib/workspace-service';
import type { CadenceStepConfig, Jurisdiction, ReplyAnalysis, ToneMode } from '@/lib/types';
import {
  CheckCircle2,
  Copy,
  ExternalLink,
  FileText,
  Mail,
  PauseCircle,
  Play,
  Scale,
  Send,
  Sparkles,
  Trash2,
  Webhook,
} from 'lucide-react';
import { SourceBadge, StatusPill } from './StatusPill';

interface InvoiceInspectorProps {
  invoice: EnrichedInvoice;
  cadenceSteps: CadenceStepConfig[];
  onRefreshView: (view: unknown) => void;
}

const REPLY_PRESETS = [
  'I will process this next Tuesday.',
  'Wait — line 2 says 14 hours instead of 12, can you check?',
  'Automatic reply: Out of office until Nov 19.',
  'Just paid via Stripe link five minutes ago!',
];

export function InvoiceInspector({ invoice, cadenceSteps, onRefreshView }: InvoiceInspectorProps) {
  const [tab, setTab] = useState<'thread' | 'fees' | 'cadence'>('thread');
  const [replyText, setReplyText] = useState('');
  const [lastAnalysis, setLastAnalysis] = useState<ReplyAnalysis | null>(null);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [copiedNotice, setCopiedNotice] = useState(false);

  async function patchInvoice(patch: Record<string, unknown>, label: string) {
    setBusyAction(label);
    try {
      const res = await fetch(`/api/invoices/${invoice.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      });
      if (res.ok) onRefreshView(await res.json());
    } finally {
      setBusyAction(null);
    }
  }

  async function submitReply(textToUse?: string) {
    const text = (textToUse ?? replyText).trim();
    if (!text) return;
    setBusyAction('reply');
    try {
      const res = await fetch(`/api/invoices/${invoice.id}/reply`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ senderEmail: invoice.clientEmail, messageBody: text }),
      });
      const data = await res.json();
      if (res.ok) {
        setLastAnalysis(data.analysis);
        setReplyText('');
        onRefreshView(data.view);
      }
    } finally {
      setBusyAction(null);
    }
  }

  async function sendNudgeNow() {
    setBusyAction('nudge');
    try {
      const res = await fetch(`/api/invoices/${invoice.id}/send-nudge`, { method: 'POST' });
      if (res.ok) onRefreshView(await res.json());
    } finally {
      setBusyAction(null);
    }
  }

  async function simulateStripePaid() {
    setBusyAction('stripe');
    try {
      const res = await fetch('/api/webhooks/stripe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'invoice.paid',
          data: {
            object: {
              id: invoice.stripeInvoiceId,
              hosted_invoice_url: invoice.stripeUrl,
              metadata: { invoiceId: invoice.id },
            },
          },
        }),
      });
      if (res.ok) {
        const data = await res.json();
        onRefreshView(data.view);
      }
    } finally {
      setBusyAction(null);
    }
  }

  async function deleteInv() {
    setBusyAction('delete');
    try {
      const res = await fetch(`/api/invoices/${invoice.id}`, { method: 'DELETE' });
      if (res.ok) onRefreshView(await res.json());
    } finally {
      setBusyAction(null);
    }
  }

  const fee = invoice.lateFee;

  function copyStatutorySummary() {
    const summary = [
      `Invoice ${invoice.invoiceNumber} — Statutory Fee & Balance Statement`,
      `Principal: ${formatMoney(invoice.principalCents, invoice.currency)}`,
      `Due Date: ${invoice.dueDate} (${fee.daysPastDue} days overdue)`,
      `Regime: ${fee.statutoryReference}`,
      `Interest (${fee.annualRatePct}% APR · ${fee.billableDays} billable days): ${formatMoney(fee.interestCents, invoice.currency)}`,
      `Fixed Recovery Compensation: ${formatMoney(fee.fixedCompensationCents, invoice.currency)}`,
      `Total Payable Today: ${formatMoney(fee.totalDueCents, invoice.currency)}`,
    ].join('\n');
    void navigator.clipboard.writeText(summary);
    setCopiedNotice(true);
    setTimeout(() => setCopiedNotice(false), 2000);
  }

  return (
    <div className="flex h-full flex-col rounded-2xl border border-slate-200 bg-white shadow-sm">
      {/* Header */}
      <div className="border-b border-slate-200 p-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-mono text-xs font-semibold text-slate-500">{invoice.invoiceNumber}</span>
              <SourceBadge source={invoice.source} />
              <StatusPill status={invoice.status} promisedDate={invoice.promisedDate} />
            </div>
            <h2 className="mt-1.5 text-lg font-semibold text-slate-900">{invoice.clientName}</h2>
            <p className="text-xs text-slate-500">
              {invoice.clientEmail} · Due {invoice.dueDate}
              {fee.daysPastDue > 0 && invoice.status !== 'paid' && (
                <span className="ml-1.5 font-medium text-rose-600">({fee.daysPastDue}d overdue)</span>
              )}
            </p>
          </div>
          <div className="text-right">
            <div className="text-xl font-bold tracking-tight text-slate-900 tabular-nums">
              {formatMoney(fee.totalDueCents, invoice.currency)}
            </div>
            {fee.accruedFeeCents > 0 ? (
              <div className="text-[11px] font-medium text-rose-600 tabular-nums">
                incl. +{formatMoney(fee.accruedFeeCents, invoice.currency)} late fee
              </div>
            ) : (
              <div className="text-[11px] text-slate-500 tabular-nums">
                Principal {formatMoney(invoice.principalCents, invoice.currency)}
              </div>
            )}
          </div>
        </div>

        {/* Action Strip */}
        <div className="mt-4 flex flex-wrap items-center gap-2">
          {invoice.status !== 'paid' && (
            <>
              <button
                type="button"
                disabled={busyAction !== null}
                onClick={sendNudgeNow}
                className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-800 disabled:opacity-50"
              >
                <Send className="h-3.5 w-3.5" />
                {busyAction === 'nudge' ? 'Sending…' : 'Send Nudge Now'}
              </button>
              <button
                type="button"
                disabled={busyAction !== null}
                onClick={() => void patchInvoice({ status: 'paid' }, 'paid')}
                className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
              >
                <CheckCircle2 className="h-3.5 w-3.5" />
                Mark Paid
              </button>
              {invoice.stripeUrl && (
                <button
                  type="button"
                  disabled={busyAction !== null}
                  onClick={simulateStripePaid}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-200 bg-emerald-50 px-2.5 py-1.5 text-xs font-medium text-emerald-800 hover:bg-emerald-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-600"
                >
                  <Webhook className="h-3.5 w-3.5" />
                  Sim Stripe Paid
                </button>
              )}
              {invoice.status.startsWith('paused_') && (
                <button
                  type="button"
                  disabled={busyAction !== null}
                  onClick={() => void patchInvoice({ status: 'overdue' }, 'resume')}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-1.5 text-xs font-medium text-amber-800 hover:bg-amber-100"
                >
                  <Play className="h-3.5 w-3.5" />
                  Resume Chasing
                </button>
              )}
            </>
          )}

          {invoice.stripeUrl && (
            <a
              href={invoice.stripeUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50"
            >
              Stripe Link
              <ExternalLink className="h-3 w-3" />
            </a>
          )}
          {invoice.pdfBlobPathname && (
            <a
              href={`/api/invoices/${invoice.id}/pdf`}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50"
            >
              <FileText className="h-3 w-3" />
              View PDF
            </a>
          )}
          <button
            type="button"
            disabled={busyAction !== null}
            onClick={deleteInv}
            title="Delete invoice"
            aria-label="Delete invoice"
            className="ml-auto rounded-lg p-1.5 text-slate-500 hover:bg-rose-50 hover:text-rose-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-600"
          >
            <Trash2 className="h-4 w-4" />
          </button>
        </div>

        {/* Pause Explanation Banner */}
        {invoice.status.startsWith('paused_') && invoice.pauseReason && (
          <div className="mt-3 flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50/80 p-3 text-xs text-amber-900">
            <PauseCircle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
            <div>
              <div className="font-semibold">Smart Auto-Pause Active</div>
              <p className="mt-0.5 text-amber-800">{invoice.pauseReason}</p>
            </div>
          </div>
        )}
      </div>

      {/* Sub-navigation tabs */}
      <div className="flex border-b border-slate-200 px-5">
        {[
          { key: 'thread' as const, label: 'Thread & Smart NLP', icon: Sparkles },
          { key: 'fees' as const, label: 'Statutory Late Fees', icon: Scale },
          { key: 'cadence' as const, label: 'Cadence & Tone', icon: Mail },
        ].map((item) => {
          const Icon = item.icon;
          const active = tab === item.key;
          return (
            <button
              key={item.key}
              type="button"
              onClick={() => setTab(item.key)}
              className={`-mb-px flex items-center gap-1.5 border-b-2 px-3 py-2.5 text-xs font-medium transition ${
                active
                  ? 'border-blue-600 text-blue-700'
                  : 'border-transparent text-slate-500 hover:text-slate-800'
              }`}
            >
              <Icon className="h-3.5 w-3.5" />
              {item.label}
            </button>
          );
        })}
      </div>

      {/* Tab Content */}
      <div className="flex-1 overflow-y-auto p-5">
        {tab === 'thread' && (
          <div className="space-y-4">
            {/* Interactive NLP Promise-to-Pay Simulator */}
            {invoice.status !== 'paid' && (
              <div className="rounded-xl border border-blue-200 bg-blue-50/50 p-3.5">
                <div className="flex items-center justify-between">
                  <span className="flex items-center gap-1.5 text-xs font-semibold text-blue-950">
                    <Sparkles className="h-3.5 w-3.5 text-blue-600" />
                    Test Client Reply (Promise-to-Pay / Dispute NLP)
                  </span>
                  <span className="font-mono text-[10px] text-blue-700">reply+{invoice.id}@nudgepay.app</span>
                </div>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {REPLY_PRESETS.map((preset) => (
                    <button
                      key={preset}
                      type="button"
                      disabled={busyAction !== null}
                      onClick={() => void submitReply(preset)}
                      className="rounded-full border border-blue-200 bg-white px-2.5 py-1 text-[11px] font-medium text-slate-700 transition hover:border-blue-400 hover:text-blue-700"
                    >
                      &ldquo;{preset}&rdquo;
                    </button>
                  ))}
                </div>
                <div className="mt-2.5 flex gap-2">
                  <input
                    value={replyText}
                    onChange={(e) => setReplyText(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        void submitReply();
                      }
                    }}
                    placeholder="Type any client email reply to test live NLP detection…"
                    className="flex-1 rounded-lg border border-blue-200 bg-white px-3 py-1.5 text-xs text-slate-900 focus:border-sky-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-600"
                  />
                  <button
                    type="button"
                    disabled={busyAction !== null || !replyText.trim()}
                    onClick={() => void submitReply()}
                    className="rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50"
                  >
                    Analyze Reply
                  </button>
                </div>
                {lastAnalysis && (
                  <div className="mt-2.5 rounded-lg bg-white p-2.5 text-xs ring-1 ring-blue-200">
                    <div className="flex items-center justify-between font-medium text-slate-900">
                      <span>
                        Detected: <span className="font-mono text-blue-700">{lastAnalysis.intent}</span>
                      </span>
                      <span className="text-[11px] text-slate-500">
                        {Math.round(lastAnalysis.confidence * 100)}% confidence
                      </span>
                    </div>
                    <p className="mt-1 text-slate-600">{lastAnalysis.explanation}</p>
                    {lastAnalysis.matchedPhrase && (
                      <p className="mt-1 font-mono text-[11px] text-amber-700">
                        Trigger phrase: &ldquo;{lastAnalysis.matchedPhrase}&rdquo;
                      </p>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* Message History */}
            <div className="space-y-3">
              {invoice.messages.length === 0 ? (
                <div className="rounded-xl border border-dashed border-slate-200 p-6 text-center text-xs text-slate-500">
                  No chase messages sent yet. Click <strong>Send Nudge Now</strong> or run the scheduler to dispatch the first reminder.
                </div>
              ) : (
                [...invoice.messages].reverse().map((msg) => (
                  <div
                    key={msg.id}
                    className={`rounded-xl border p-3.5 text-xs ${
                      msg.direction === 'inbound'
                        ? 'border-amber-200 bg-amber-50/40'
                        : msg.direction === 'system'
                        ? 'border-emerald-200 bg-emerald-50/50'
                        : 'border-slate-200 bg-slate-50/60'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-semibold text-slate-900">
                        {msg.direction === 'inbound'
                          ? `Client Reply (${msg.sender})`
                          : msg.direction === 'system'
                          ? 'System Event'
                          : `Outbound Reminder (${msg.stageKey ?? 'manual'})`}
                      </span>
                      <span className="text-[11px] text-slate-500">
                        {msg.createdAt.slice(0, 16).replace('T', ' ')} UTC
                      </span>
                    </div>
                    <div className="mt-1 font-medium text-slate-700">{msg.subject}</div>
                    <pre className="mt-2 whitespace-pre-wrap font-sans text-xs leading-relaxed text-slate-600">
                      {msg.body}
                    </pre>
                    {msg.analysis && (
                      <div className="mt-2.5 flex flex-wrap items-center gap-2 border-t border-amber-200/70 pt-2 text-[11px]">
                        <span className="rounded bg-amber-100 px-1.5 py-0.5 font-mono font-medium text-amber-900">
                          {msg.analysis.intent}
                        </span>
                        {msg.analysis.promisedDate && (
                          <span className="text-amber-900">
                            Promised: <strong>{msg.analysis.promisedDate}</strong> → Auto-resume: <strong>{msg.analysis.resumeAt}</strong>
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                ))
              )}
            </div>
          </div>
        )}

        {tab === 'fees' && (
          <div className="space-y-4">
            <div className="flex items-center justify-between rounded-xl border border-slate-200 bg-slate-50 p-3.5">
              <div>
                <div className="text-xs font-semibold text-slate-900">Apply Statutory / Contractual Late Fees</div>
                <div className="text-[11px] text-slate-500">
                  Toggle off to waive fees for a goodwill client while keeping full calculation visibility.
                </div>
              </div>
              <button
                type="button"
                onClick={() => void patchInvoice({ lateFeeEnabled: !invoice.lateFeeEnabled }, 'fee-toggle')}
                className={`relative inline-flex h-6 w-11 items-center rounded-full transition ${
                  invoice.lateFeeEnabled ? 'bg-blue-600' : 'bg-slate-300'
                }`}
              >
                <span
                  className={`inline-block h-4 w-4 transform rounded-full bg-white transition ${
                    invoice.lateFeeEnabled ? 'translate-x-6' : 'translate-x-1'
                  }`}
                />
              </button>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700">Statutory Regime</label>
              <div className="mt-1.5 grid grid-cols-3 gap-2">
                {[
                  { key: 'UK' as const, label: 'UK Act 1998' },
                  { key: 'EU' as const, label: 'EU 2011/7/EU' },
                  { key: 'US_CUSTOM' as const, label: 'US / Custom' },
                ].map((opt) => (
                  <button
                    key={opt.key}
                    type="button"
                    onClick={() => void patchInvoice({ jurisdiction: opt.key as Jurisdiction }, 'jurisdiction')}
                    className={`rounded-lg border px-3 py-2 text-xs font-medium transition ${
                      invoice.jurisdiction === opt.key
                        ? 'border-blue-600 bg-blue-50 text-blue-700'
                        : 'border-slate-200 text-slate-600 hover:bg-slate-50'
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="rounded-xl border border-slate-200 bg-white p-4">
              <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                <span className="text-xs font-semibold text-slate-900">Audit Calculation Breakdown</span>
                <button
                  type="button"
                  onClick={copyStatutorySummary}
                  className="inline-flex items-center gap-1 rounded-md border border-slate-200 px-2 py-1 text-[11px] font-medium text-slate-600 hover:bg-slate-50"
                >
                  <Copy className="h-3 w-3" />
                  {copiedNotice ? 'Copied!' : 'Copy Statement'}
                </button>
              </div>
              <dl className="mt-3 space-y-2 text-xs">
                <div className="flex justify-between">
                  <dt className="text-slate-500">Original Principal</dt>
                  <dd className="font-medium text-slate-900 tabular-nums">
                    {formatMoney(invoice.principalCents, invoice.currency)}
                  </dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-slate-500">Days Past Due / Billable</dt>
                  <dd className="font-medium text-slate-900 tabular-nums">
                    {fee.daysPastDue}d overdue ({fee.billableDays}d billable after {invoice.gracePeriodDays}d grace)
                  </dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-slate-500">Statutory Interest ({fee.annualRatePct}% APR)</dt>
                  <dd className="font-medium text-slate-900 tabular-nums">
                    {formatMoney(fee.interestCents, invoice.currency)}
                    <span className="ml-1 text-[11px] text-slate-400">
                      ({formatMoney(fee.dailyInterestCents, invoice.currency)}/day)
                    </span>
                  </dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-slate-500">Fixed Recovery Compensation</dt>
                  <dd className="font-medium text-slate-900 tabular-nums">
                    {formatMoney(fee.fixedCompensationCents, invoice.currency)}
                  </dd>
                </div>
                <div className="flex justify-between border-t border-slate-200 pt-2 text-sm font-semibold">
                  <dt className="text-slate-900">Total Payable Today</dt>
                  <dd className="text-slate-900 tabular-nums">
                    {formatMoney(fee.totalDueCents, invoice.currency)}
                  </dd>
                </div>
              </dl>
              <p className="mt-3 rounded-lg bg-slate-50 p-2 text-[11px] text-slate-500">{fee.statutoryReference}</p>
              {fee.waivedPreviewCents > 0 && (
                <p className="mt-2 text-[11px] font-medium text-amber-700">
                  Late fees currently waived ({formatMoney(fee.waivedPreviewCents, invoice.currency)} statutory entitlement unbilled).
                </p>
              )}
            </div>
          </div>
        )}

        {tab === 'cadence' && (
          <div className="space-y-4">
            <div>
              <label className="block text-xs font-medium text-slate-700">Chasing Tone</label>
              <div className="mt-1.5 grid grid-cols-3 gap-2">
                {[
                  { key: 'warm' as const, label: 'Warm & Human' },
                  { key: 'neutral' as const, label: 'Neutral Pro' },
                  { key: 'firm' as const, label: 'Firm Statutory' },
                ].map((opt) => (
                  <button
                    key={opt.key}
                    type="button"
                    onClick={() => void patchInvoice({ tone: opt.key as ToneMode }, 'tone')}
                    className={`rounded-lg border px-3 py-2 text-xs font-medium transition ${
                      invoice.tone === opt.key
                        ? 'border-blue-600 bg-blue-50 text-blue-700'
                        : 'border-slate-200 text-slate-600 hover:bg-slate-50'
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="rounded-xl border border-slate-200 p-3.5">
              <div className="text-xs font-semibold text-slate-900">Cadence Sequence Progress</div>
              <div className="mt-2.5 space-y-2">
                {cadenceSteps.map((step) => {
                  const sent = invoice.sentStages.includes(step.key);
                  return (
                    <div key={step.key} className="flex items-center justify-between text-xs">
                      <div className="flex items-center gap-2">
                        <span
                          className={`h-2 w-2 rounded-full ${
                            sent ? 'bg-emerald-500' : step.enabled ? 'bg-slate-300' : 'bg-slate-200'
                          }`}
                        />
                        <span className={sent ? 'font-medium text-slate-900' : 'text-slate-600'}>{step.label}</span>
                      </div>
                      <span className="text-[11px] text-slate-500">
                        {sent ? 'Sent' : step.enabled ? `Day ${step.dayOffset >= 0 ? `+${step.dayOffset}` : step.dayOffset}` : 'Disabled'}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>

            {invoice.nextPreview && (
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-3.5">
                <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                  Next Scheduled Email Preview ({invoice.nextPreview.stageKey})
                </div>
                <div className="mt-1.5 text-xs font-semibold text-slate-900">{invoice.nextPreview.subject}</div>
                <pre className="mt-2 whitespace-pre-wrap font-sans text-xs leading-relaxed text-slate-600">
                  {invoice.nextPreview.body}
                </pre>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
