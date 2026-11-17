'use client';

import { useState } from 'react';
import { formatMoney } from '@/lib/late-fees';
import { PRICING_PLANS } from '@/lib/pricing';
import type { WorkspaceView } from '@/lib/workspace-service';
import type { PricingTier } from '@/lib/types';
import { Check, Database, RotateCcw, Webhook, X } from 'lucide-react';

interface PricingAndSettingsModalProps {
  open: boolean;
  onClose: () => void;
  view: WorkspaceView;
  onRefreshView: (view: unknown) => void;
}

export function PricingAndSettingsModal({ open, onClose, view, onRefreshView }: PricingAndSettingsModalProps) {
  const [freelancerName, setFreelancerName] = useState(view.settings.freelancerName);
  const [workspaceName, setWorkspaceName] = useState(view.settings.workspaceName);
  const [replyFromEmail, setReplyFromEmail] = useState(view.settings.replyFromEmail);
  const [boeRate, setBoeRate] = useState(String(view.settings.boeBaseRatePct));
  const [ecbRate, setEcbRate] = useState(String(view.settings.ecbRefRatePct));
  const [busy, setBusy] = useState(false);

  if (!open) return null;

  async function selectTier(pricingTier: PricingTier) {
    setBusy(true);
    try {
      const res = await fetch('/api/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pricingTier }),
      });
      if (res.ok) onRefreshView(await res.json());
    } finally {
      setBusy(false);
    }
  }

  async function saveSettings(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const res = await fetch('/api/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          freelancerName,
          workspaceName,
          replyFromEmail,
          boeBaseRatePct: Number(boeRate) || 5.0,
          ecbRefRatePct: Number(ecbRate) || 4.5,
        }),
      });
      if (res.ok) {
        onRefreshView(await res.json());
        onClose();
      }
    } finally {
      setBusy(false);
    }
  }

  async function resetDemo() {
    setBusy(true);
    try {
      const res = await fetch('/api/reset-demo', { method: 'POST' });
      if (res.ok) {
        onRefreshView(await res.json());
        onClose();
      }
    } finally {
      setBusy(false);
    }
  }

  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  const summary = view.billingSummary;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4 backdrop-blur-sm overscroll-contain">
      <div className="max-h-[92vh] w-full max-w-3xl overflow-y-auto overscroll-contain rounded-2xl border border-slate-200 bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-slate-200 px-6 py-4">
          <div>
            <h2 className="text-base font-semibold text-slate-900">Freelancer Pricing, Statutory Rates &amp; Webhooks</h2>
            <p className="text-xs text-slate-500">
              Built to beat Paidnice ($69/mo for 150 invoices) &amp; Chaser (Xero/QuickBooks lock-in).
            </p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close modal" className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-600">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-6 p-6">
          {/* Pricing Tier Switcher */}
          <div>
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">Your Active Plan</h3>
              <span className="rounded-full bg-emerald-50 px-2.5 py-0.5 text-xs font-semibold text-emerald-700 tabular-nums">
                Saving {formatMoney(Math.max(0, summary.savingsVsPaidniceCents), 'USD')}/mo vs Paidnice
              </span>
            </div>
            <div className="mt-2.5 grid gap-3 sm:grid-cols-3">
              {(['pay_per_recovery', 'pro_15', 'agency_39'] as PricingTier[]).map((tier) => {
                const plan = PRICING_PLANS[tier];
                const active = view.settings.pricingTier === tier;
                return (
                  <button
                    key={tier}
                    type="button"
                    disabled={busy}
                    onClick={() => void selectTier(tier)}
                    className={`flex flex-col rounded-xl border p-4 text-left transition ${
                      active
                        ? 'border-blue-600 bg-blue-50/50 ring-1 ring-blue-600'
                        : 'border-slate-200 hover:border-slate-300'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-semibold text-slate-900">{plan.name}</span>
                      {active && <Check className="h-4 w-4 text-blue-600" />}
                    </div>
                    <div className="mt-1.5 text-lg font-bold text-slate-900 tabular-nums">{plan.badge}</div>
                    <p className="mt-1.5 text-[11px] leading-relaxed text-slate-600">{plan.description}</p>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Performance Fee Ledger */}
          <div className="rounded-xl border border-slate-200 p-4">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-semibold text-slate-900">Performance Fee Ledger</h3>
              <span className="text-xs text-slate-500 tabular-nums">
                Total Fees This Cycle: <strong>{formatMoney(summary.performanceFeesCents, 'USD')}</strong>
              </span>
            </div>
            {view.performanceFees.length === 0 ? (
              <p className="mt-2 text-xs text-slate-500">No recovered invoices logged yet.</p>
            ) : (
              <div className="mt-3 overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="border-b border-slate-200 text-[11px] text-slate-500">
                    <tr>
                      <th className="pb-2 font-medium">Invoice</th>
                      <th className="pb-2 font-medium">Client</th>
                      <th className="pb-2 font-medium">Recovered</th>
                      <th className="pb-2 font-medium">Plan at Collection</th>
                      <th className="pb-2 text-right font-medium">NudgePay Fee</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {view.performanceFees.map((entry) => (
                      <tr key={entry.id}>
                        <td className="py-2 font-mono text-slate-800">{entry.invoiceNumber}</td>
                        <td className="py-2 text-slate-700">{entry.clientName}</td>
                        <td className="py-2 tabular-nums text-slate-900">
                          {formatMoney(entry.recoveredPrincipalCents + entry.recoveredLateFeeCents, entry.currency)}
                        </td>
                        <td className="py-2 text-slate-500">{PRICING_PLANS[entry.tierAtCollection].name}</td>
                        <td className="py-2 text-right font-semibold tabular-nums text-emerald-700">
                          {formatMoney(entry.platformFeeCents, 'USD')}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Statutory Reference Rates & Sender Identity */}
          <form onSubmit={saveSettings} className="space-y-4 rounded-xl border border-slate-200 p-4">
            <h3 className="text-xs font-semibold text-slate-900">Workspace &amp; Statutory Base Rates</h3>
            <div className="grid gap-3 sm:grid-cols-3">
              <div>
                <label className="block text-[11px] font-medium text-slate-600">Freelancer / Sender Name</label>
                <input
                  value={freelancerName}
                  onChange={(e) => setFreelancerName(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-1.5 text-xs"
                />
              </div>
              <div>
                <label className="block text-[11px] font-medium text-slate-600">Studio / Business Name</label>
                <input
                  value={workspaceName}
                  onChange={(e) => setWorkspaceName(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-1.5 text-xs"
                />
              </div>
              <div>
                <label className="block text-[11px] font-medium text-slate-600">Reply-From Email</label>
                <input
                  type="email"
                  value={replyFromEmail}
                  onChange={(e) => setReplyFromEmail(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-1.5 text-xs"
                />
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label className="block text-[11px] font-medium text-slate-600">
                  Bank of England Base Rate % (UK +8% = {(8 + (Number(boeRate) || 0)).toFixed(2)}% APR)
                </label>
                <input
                  type="number"
                  step="0.05"
                  value={boeRate}
                  onChange={(e) => setBoeRate(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-1.5 text-xs tabular-nums"
                />
              </div>
              <div>
                <label className="block text-[11px] font-medium text-slate-600">
                  ECB Reference Rate % (EU +8% = {(8 + (Number(ecbRate) || 0)).toFixed(2)}% APR)
                </label>
                <input
                  type="number"
                  step="0.05"
                  value={ecbRate}
                  onChange={(e) => setEcbRate(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-1.5 text-xs tabular-nums"
                />
              </div>
            </div>

            <div className="flex items-center justify-between pt-2">
              <button
                type="button"
                onClick={resetDemo}
                disabled={busy}
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50"
              >
                <RotateCcw className="h-3.5 w-3.5" />
                Reset Demo Workspace
              </button>
              <button
                type="submit"
                disabled={busy}
                className="rounded-lg bg-slate-900 px-4 py-1.5 text-xs font-semibold text-white hover:bg-slate-800"
              >
                Save Changes
              </button>
            </div>
          </form>

          {/* Production Webhooks & Persistence Diagnostics */}
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-xs">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="flex items-center gap-1.5 font-semibold text-slate-900">
                <Webhook className="h-3.5 w-3.5 text-blue-600" />
                Live Integration Endpoints
              </span>
              <span className="inline-flex items-center gap-1 rounded-full bg-white px-2.5 py-0.5 text-[11px] font-medium text-slate-700 ring-1 ring-slate-200">
                <Database className="h-3 w-3 text-emerald-600" />
                Storage: {view.storageMode === 'vercel_blob' ? 'Vercel Blob (Persistent)' : 'Local JSON'}
              </span>
            </div>
            <div className="mt-2.5 space-y-1.5 font-mono text-[11px] text-slate-600">
              <div>Inbound Email Reply Webhook: POST {origin}/api/inbound-email</div>
              <div>Stripe Webhook (`invoice.paid`): POST {origin}/api/webhooks/stripe</div>
              <div>Scheduled Daily Chase Cron: GET {origin}/api/cron/process-chases</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
