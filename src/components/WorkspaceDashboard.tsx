'use client';

import { useMemo, useState } from 'react';
import { formatMoney } from '@/lib/late-fees';
import { PRICING_PLANS } from '@/lib/pricing';
import type { EnrichedInvoice, WorkspaceView } from '@/lib/workspace-service';
import {
  CalendarClock,
  CreditCard,
  FastForward,
  PauseCircle,
  Play,
  Plus,
  RotateCcw,
  Search,
  Settings2,
  ShieldCheck,
  TrendingUp,
} from 'lucide-react';
import { AddInvoiceModal } from './AddInvoiceModal';
import { InvoiceInspector } from './InvoiceInspector';
import { PricingAndSettingsModal } from './PricingAndSettingsModal';
import { SourceBadge, StatusPill } from './StatusPill';

type FilterTab = 'all' | 'overdue' | 'paused' | 'upcoming' | 'paid';

export function WorkspaceDashboard({ initialView }: { initialView: WorkspaceView }) {
  const [view, setView] = useState<WorkspaceView>(initialView);
  const [selectedId, setSelectedId] = useState<string>(initialView.invoices[0]?.id ?? '');
  const [filter, setFilter] = useState<FilterTab>('all');
  const [search, setSearch] = useState('');
  const [showAddModal, setShowAddModal] = useState(false);
  const [showSettingsModal, setShowSettingsModal] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [busyScheduler, setBusyScheduler] = useState(false);

  function showBanner(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(null), 4000);
  }

  function handleViewUpdate(nextRaw: unknown) {
    const next = nextRaw as WorkspaceView;
    setView(next);
    if (next.invoices.length > 0 && !next.invoices.some((i) => i.id === selectedId)) {
      setSelectedId(next.invoices[0].id);
    }
  }

  async function runScheduler(opts: { advanceDays?: number; resetClock?: boolean }) {
    setBusyScheduler(true);
    try {
      const res = await fetch('/api/cron/process-chases', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(opts),
      });
      if (res.ok) {
        const data = await res.json();
        handleViewUpdate(data.view);
        if (opts.resetClock) {
          showBanner('Clock reset to real time.');
        } else {
          showBanner(
            `Scheduler ran as of ${data.view.effectiveNowIso.slice(0, 10)} — ${data.dispatchedCount} reminder(s) dispatched.`,
          );
        }
      }
    } finally {
      setBusyScheduler(false);
    }
  }

  const filteredInvoices = useMemo(() => {
    const q = search.trim().toLowerCase();
    return view.invoices.filter((inv) => {
      if (filter === 'overdue' && inv.status !== 'overdue') return false;
      if (filter === 'paused' && !inv.status.startsWith('paused_')) return false;
      if (filter === 'upcoming' && inv.status !== 'upcoming') return false;
      if (filter === 'paid' && inv.status !== 'paid') return false;
      if (!q) return true;
      return (
        inv.clientName.toLowerCase().includes(q) ||
        inv.invoiceNumber.toLowerCase().includes(q) ||
        inv.clientEmail.toLowerCase().includes(q)
      );
    });
  }, [view.invoices, filter, search]);

  const selectedInvoice: EnrichedInvoice | null =
    view.invoices.find((i) => i.id === selectedId) ?? filteredInvoices[0] ?? view.invoices[0] ?? null;

  const overdueCount = view.invoices.filter((i) => i.status === 'overdue').length;
  const pausedCount = view.invoices.filter((i) => i.status.startsWith('paused_')).length;
  const totalFeeAccruedCount = view.invoices.filter((i) => i.status !== 'paid' && i.lateFee.accruedFeeCents > 0).length;
  const activePlan = PRICING_PLANS[view.settings.pricingTier];
  const billing = view.billingSummary;

  return (
    <div className="min-h-screen bg-[#f6f7f9] text-slate-900">
      {/* Top Bar */}
      <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/95 backdrop-blur">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-6">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-slate-900 text-sm font-bold text-white shadow-sm">
              NP
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-sm font-bold tracking-tight text-slate-900">NudgePay</h1>
                <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-700 ring-1 ring-emerald-600/20">
                  {activePlan.badge}
                </span>
              </div>
              <p className="text-[11px] text-slate-500">
                {view.settings.workspaceName} · Standalone Stripe &amp; PDF Chasing
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {/* Effective Clock / Time-travel simulator */}
            <div className="flex items-center gap-1 rounded-xl border border-slate-200 bg-slate-50 px-2 py-1 text-xs">
              <CalendarClock className="h-3.5 w-3.5 text-slate-500" />
              <span className="font-mono text-[11px] font-medium text-slate-700">
                {view.effectiveNowIso.slice(0, 10)}
              </span>
              {view.settings.simulatedDayOffset !== 0 && (
                <span className="rounded bg-amber-100 px-1 text-[10px] font-semibold text-amber-800">
                  +{view.settings.simulatedDayOffset}d
                </span>
              )}
              <button
                type="button"
                disabled={busyScheduler}
                onClick={() => void runScheduler({ advanceDays: 7 })}
                title="Simulate +7 days & run scheduler"
                className="ml-1 inline-flex items-center gap-1 rounded-md bg-white px-2 py-0.5 text-[11px] font-medium text-slate-700 ring-1 ring-slate-200 hover:bg-slate-100"
              >
                <FastForward className="h-3 w-3" />
                +7d
              </button>
              {view.settings.simulatedDayOffset !== 0 && (
                <button
                  type="button"
                  disabled={busyScheduler}
                  onClick={() => void runScheduler({ resetClock: true })}
                  title="Reset simulated clock"
                  className="rounded-md p-0.5 text-slate-500 hover:bg-slate-200"
                >
                  <RotateCcw className="h-3 w-3" />
                </button>
              )}
            </div>

            <button
              type="button"
              disabled={busyScheduler}
              onClick={() => void runScheduler({})}
              className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50"
            >
              <Play className="h-3.5 w-3.5 text-blue-600" />
              Run Chase Tick
            </button>

            <button
              type="button"
              onClick={() => setShowSettingsModal(true)}
              className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50"
            >
              <Settings2 className="h-3.5 w-3.5" />
              Pricing &amp; Webhooks
            </button>

            <button
              type="button"
              onClick={() => setShowAddModal(true)}
              className="inline-flex items-center gap-1.5 rounded-xl bg-blue-600 px-3.5 py-2 text-xs font-semibold text-white shadow-sm hover:bg-blue-700"
            >
              <Plus className="h-3.5 w-3.5" />
              Add Invoice
            </button>
          </div>
        </div>
      </header>

      {toast && (
        <div className="mx-auto mt-3 max-w-7xl px-4 sm:px-6">
          <div className="rounded-xl border border-blue-200 bg-blue-50 px-4 py-2.5 text-xs font-medium text-blue-900">
            {toast}
          </div>
        </div>
      )}

      {/* Main Container */}
      <main className="mx-auto max-w-7xl space-y-5 px-4 py-5 sm:px-6">
        {/* KPI Cards */}
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="flex items-center justify-between text-xs font-medium text-slate-500">
              <span>Active Overdue Chasing</span>
              <TrendingUp className="h-4 w-4 text-rose-500" />
            </div>
            <div className="mt-2 flex items-baseline gap-2">
              <span className="text-2xl font-bold text-slate-900 tabular-nums">{overdueCount}</span>
              <span className="text-xs text-slate-500">
                invoices · {totalFeeAccruedCount} accruing statutory fees
              </span>
            </div>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="flex items-center justify-between text-xs font-medium text-slate-500">
              <span>Smart Auto-Paused</span>
              <PauseCircle className="h-4 w-4 text-amber-500" />
            </div>
            <div className="mt-2 flex items-baseline gap-2">
              <span className="text-2xl font-bold text-slate-900 tabular-nums">{pausedCount}</span>
              <span className="text-xs text-slate-500">promises &amp; disputes protected</span>
            </div>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="flex items-center justify-between text-xs font-medium text-slate-500">
              <span>Recovered Cashflow</span>
              <ShieldCheck className="h-4 w-4 text-emerald-600" />
            </div>
            <div className="mt-2 flex items-baseline gap-2">
              <span className="text-2xl font-bold text-slate-900 tabular-nums">
                {formatMoney(billing.totalRecoveredCents, 'USD')}
              </span>
              <span className="text-xs text-slate-500">{billing.recoveredOverdueCount} collected</span>
            </div>
          </div>

          <button
            type="button"
            onClick={() => setShowSettingsModal(true)}
            className="rounded-2xl border border-slate-200 bg-white p-4 text-left shadow-sm transition hover:border-blue-300"
          >
            <div className="flex items-center justify-between text-xs font-medium text-slate-500">
              <span>Monthly Cost vs Paidnice ($69)</span>
              <CreditCard className="h-4 w-4 text-blue-600" />
            </div>
            <div className="mt-2 flex items-baseline gap-2">
              <span className="text-2xl font-bold text-slate-900 tabular-nums">
                {formatMoney(billing.totalMonthlyCostCents, 'USD')}
              </span>
              <span className="text-xs font-semibold text-emerald-700 tabular-nums">
                Saving {formatMoney(Math.max(0, billing.savingsVsPaidniceCents), 'USD')}/mo
              </span>
            </div>
          </button>
        </div>

        {/* Split Workspace */}
        <div className="grid gap-5 lg:grid-cols-12">
          {/* Left: Filterable Invoice Queue */}
          <section className="space-y-3 lg:col-span-5">
            <div className="rounded-2xl border border-slate-200 bg-white p-3.5 shadow-sm">
              <div className="relative">
                <Search className="absolute left-3 top-2.5 h-3.5 w-3.5 text-slate-400" />
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search client, invoice #, or email…"
                  className="w-full rounded-xl border border-slate-200 bg-slate-50 py-2 pl-9 pr-3 text-xs text-slate-900 focus:border-sky-600 focus:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-600"
                />
              </div>

              <div className="mt-2.5 flex flex-wrap gap-1.5">
                {[
                  { key: 'all' as const, label: `All (${view.invoices.length})` },
                  { key: 'overdue' as const, label: `Overdue (${overdueCount})` },
                  { key: 'paused' as const, label: `Smart Paused (${pausedCount})` },
                  { key: 'upcoming' as const, label: 'Upcoming' },
                  { key: 'paid' as const, label: 'Paid' },
                ].map((t) => (
                  <button
                    key={t.key}
                    type="button"
                    onClick={() => setFilter(t.key)}
                    className={`rounded-lg px-2.5 py-1 text-[11px] font-medium transition ${
                      filter === t.key
                        ? 'bg-slate-900 text-white'
                        : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                    }`}
                  >
                    {t.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="space-y-2.5">
              {filteredInvoices.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-8 text-center text-xs text-slate-500">
                  No invoices match this filter. Click <strong>Add Invoice</strong> to paste a Stripe link or upload a PDF.
                </div>
              ) : (
                filteredInvoices.map((inv) => {
                  const isSelected = selectedInvoice?.id === inv.id;
                  return (
                    <button
                      key={inv.id}
                      type="button"
                      onClick={() => setSelectedId(inv.id)}
                      className={`w-full rounded-2xl border p-4 text-left transition ${
                        isSelected
                          ? 'border-blue-600 bg-white shadow-md ring-1 ring-blue-600/20'
                          : 'border-slate-200 bg-white hover:border-slate-300'
                      }`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <div className="flex items-center gap-1.5">
                            <span className="font-mono text-[11px] font-semibold text-slate-500">
                              {inv.invoiceNumber}
                            </span>
                            <SourceBadge source={inv.source} />
                          </div>
                          <div className="mt-1 text-sm font-semibold text-slate-900">{inv.clientName}</div>
                        </div>
                        <div className="text-right">
                          <div className="text-sm font-bold text-slate-900 tabular-nums">
                            {formatMoney(inv.lateFee.totalDueCents, inv.currency)}
                          </div>
                          {inv.lateFee.accruedFeeCents > 0 && (
                            <div className="text-[11px] font-medium text-rose-600 tabular-nums">
                              +{formatMoney(inv.lateFee.accruedFeeCents, inv.currency)} statutory
                            </div>
                          )}
                        </div>
                      </div>

                      <div className="mt-2.5 flex flex-wrap items-center justify-between gap-2">
                        <StatusPill status={inv.status} promisedDate={inv.promisedDate} />
                        <span className="text-[11px] text-slate-500">
                          {inv.status === 'paid'
                            ? `Paid ${inv.paidAt?.slice(0, 10) ?? ''}`
                            : inv.lateFee.daysPastDue > 0
                            ? `${inv.lateFee.daysPastDue}d overdue`
                            : `Due ${inv.dueDate}`}
                        </span>
                      </div>
                    </button>
                  );
                })
              )}
            </div>
          </section>

          {/* Right: Detail Inspector */}
          <section className="lg:col-span-7">
            {selectedInvoice ? (
              <InvoiceInspector
                invoice={selectedInvoice}
                cadenceSteps={view.settings.cadenceSteps}
                onRefreshView={handleViewUpdate}
              />
            ) : (
              <div className="flex h-72 items-center justify-center rounded-2xl border border-dashed border-slate-300 bg-white text-xs text-slate-500">
                Select an invoice to inspect its NLP thread, statutory late fees, and cadence.
              </div>
            )}
          </section>
        </div>
      </main>

      <AddInvoiceModal
        open={showAddModal}
        onClose={() => setShowAddModal(false)}
        onCreated={(next) => {
          handleViewUpdate(next);
          showBanner('Invoice added to NudgePay automated chasing.');
        }}
        defaultDueDate={view.effectiveNowIso.slice(0, 10)}
      />

      <PricingAndSettingsModal
        open={showSettingsModal}
        onClose={() => setShowSettingsModal(false)}
        view={view}
        onRefreshView={handleViewUpdate}
      />
    </div>
  );
}
