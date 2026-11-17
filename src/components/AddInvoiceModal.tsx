'use client';

import { useState } from 'react';
import type { Currency, InvoiceSource, Jurisdiction, ToneMode } from '@/lib/types';
import { FileUp, Link2, Plus, Sparkles, X } from 'lucide-react';

interface AddInvoiceModalProps {
  open: boolean;
  onClose: () => void;
  onCreated: (view: unknown) => void;
  defaultDueDate: string;
}

function buildSamplePdfBlob(): Blob {
  const lines = [
    'INVOICE #INV-2026-312',
    'Issue Date: 2026-10-18',
    'Due Date: 2026-11-02',
    'Bill To: Crescent Wave Ltd',
    'Email: accounts@crescentwave.co.uk',
    'Total Due: £2,150.00',
  ];
  const ops = lines
    .map((line, i) => `BT /F1 12 Tf 50 ${750 - i * 18} Td (${line}) Tj ET`)
    .join('\n');
  const pdf = `%PDF-1.4
1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj
2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj
3 0 obj << /Type /Page /Parent 2 0 R /Contents 4 0 R >> endobj
4 0 obj << /Length ${ops.length} >>
stream
${ops}
endstream
endobj
%%EOF`;
  return new Blob([pdf], { type: 'application/pdf' });
}

export function AddInvoiceModal({ open, onClose, onCreated, defaultDueDate }: AddInvoiceModalProps) {
  const [tab, setTab] = useState<InvoiceSource>('stripe_link');
  const [stripeUrl, setStripeUrl] = useState('');
  const [stripeHint, setStripeHint] = useState<string | null>(null);
  const [pdfFilename, setPdfFilename] = useState<string | null>(null);
  const [pdfBlobPathname, setPdfBlobPathname] = useState<string | null>(null);
  const [pdfSnippet, setPdfSnippet] = useState<string | null>(null);

  const [invoiceNumber, setInvoiceNumber] = useState('INV-2026-118');
  const [clientName, setClientName] = useState('');
  const [clientEmail, setClientEmail] = useState('');
  const [amountDisplay, setAmountDisplay] = useState('1800.00');
  const [currency, setCurrency] = useState<Currency>('USD');
  const [dueDate, setDueDate] = useState(defaultDueDate);
  const [jurisdiction, setJurisdiction] = useState<Jurisdiction>('US_CUSTOM');
  const [lateFeeEnabled, setLateFeeEnabled] = useState(true);
  const [gracePeriodDays, setGracePeriodDays] = useState('3');
  const [customMonthlyRatePct, setCustomMonthlyRatePct] = useState('1.5');
  const [tone, setTone] = useState<ToneMode>('warm');

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!open) return null;

  async function inspectStripe() {
    setError(null);
    setStripeHint(null);
    setBusy(true);
    try {
      const res = await fetch('/api/invoices/inspect-stripe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: stripeUrl }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? 'Invalid Stripe invoice URL');
        return;
      }
      if (data.amountCents) setAmountDisplay((data.amountCents / 100).toFixed(2));
      if (data.currency) setCurrency(data.currency);
      if (data.merchantHint && !clientName) setClientName(data.merchantHint);
      setStripeHint(
        data.reachable
          ? `Verified Stripe link (${data.stripeInvoiceId ?? 'active'}).`
          : `Valid Stripe hosted URL (${data.stripeInvoiceId ?? 'ready'}). Confirm client details below.`,
      );
    } catch {
      setError('Could not inspect Stripe URL.');
    } finally {
      setBusy(false);
    }
  }

  async function uploadPdfFile(file: File | Blob, filename: string) {
    setError(null);
    setBusy(true);
    try {
      const form = new FormData();
      form.append('file', file, filename);
      const res = await fetch('/api/invoices/parse-pdf', { method: 'POST', body: form });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? 'PDF upload failed');
        return;
      }
      setPdfFilename(data.filename);
      setPdfBlobPathname(data.pdfBlobPathname);
      const p = data.parsed;
      if (p.invoiceNumber) setInvoiceNumber(p.invoiceNumber);
      if (p.clientName) setClientName(p.clientName);
      if (p.clientEmail) setClientEmail(p.clientEmail);
      if (p.amountCents) setAmountDisplay((p.amountCents / 100).toFixed(2));
      if (p.currency) {
        setCurrency(p.currency);
        if (p.currency === 'GBP') {
          setJurisdiction('UK');
          setGracePeriodDays('0');
        } else if (p.currency === 'EUR') {
          setJurisdiction('EU');
          setGracePeriodDays('0');
        }
      }
      if (p.dueDate) setDueDate(p.dueDate);
      if (p.stripeUrl) setStripeUrl(p.stripeUrl);
      setPdfSnippet(p.rawTextSnippet || 'PDF stored. Confirm fields below.');
    } catch {
      setError('Failed to parse PDF file.');
    } finally {
      setBusy(false);
    }
  }

  async function submitInvoice(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const parsedAmt = Number(amountDisplay.replace(/,/g, ''));
    if (!Number.isFinite(parsedAmt) || parsedAmt <= 0) {
      setError('Enter a valid positive invoice amount.');
      return;
    }

    setBusy(true);
    try {
      const res = await fetch('/api/invoices', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          invoiceNumber,
          clientName,
          clientEmail,
          principalCents: Math.round(parsedAmt * 100),
          currency,
          dueDate,
          source: tab,
          stripeUrl: stripeUrl || undefined,
          pdfBlobPathname: pdfBlobPathname || undefined,
          pdfFilename: pdfFilename || undefined,
          jurisdiction,
          lateFeeEnabled,
          gracePeriodDays: Number(gracePeriodDays) || 0,
          customMonthlyRatePct: Number(customMonthlyRatePct) || 1.5,
          tone,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? 'Failed to add invoice');
        return;
      }
      onCreated(data);
      onClose();
    } catch {
      setError('Network error while creating invoice.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4 backdrop-blur-sm overscroll-contain">
      <div className="max-h-[92vh] w-full max-w-xl overflow-y-auto overscroll-contain rounded-2xl border border-slate-200 bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-slate-200 px-6 py-4">
          <div>
            <h2 className="text-base font-semibold text-slate-900">Add Standalone Invoice</h2>
            <p className="text-xs text-slate-500">No Xero or QuickBooks required. Start chasing in 15 seconds.</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close modal" className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-600">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="border-b border-slate-200 bg-slate-50 px-6 py-2.5">
          <div className="grid grid-cols-3 gap-2">
            {[
              { key: 'stripe_link' as const, label: 'Paste Stripe Link', icon: Link2 },
              { key: 'pdf_upload' as const, label: 'Upload PDF', icon: FileUp },
              { key: 'manual' as const, label: 'Quick Entry', icon: Plus },
            ].map((item) => {
              const Icon = item.icon;
              const active = tab === item.key;
              return (
                <button
                  key={item.key}
                  type="button"
                  onClick={() => setTab(item.key)}
                  className={`flex items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-xs font-medium transition ${
                    active
                      ? 'bg-white text-slate-900 shadow-sm ring-1 ring-slate-200'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  <Icon className="h-3.5 w-3.5" />
                  {item.label}
                </button>
              );
            })}
          </div>
        </div>

        <form onSubmit={submitInvoice} className="space-y-4 p-6">
          {tab === 'stripe_link' && (
            <div className="rounded-xl border border-emerald-200 bg-emerald-50/50 p-3.5">
              <label className="block text-xs font-medium text-slate-700">Stripe Hosted Invoice / Payment Link</label>
              <div className="mt-1.5 flex gap-2">
                <input
                  type="url"
                  value={stripeUrl}
                  onChange={(e) => setStripeUrl(e.target.value)}
                  placeholder="https://invoice.stripe.com/i/acct_…"
                  className="flex-1 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-sky-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-600"
                />
                <button
                  type="button"
                  disabled={busy || !stripeUrl}
                  onClick={inspectStripe}
                  className="rounded-lg bg-slate-900 px-3 py-2 text-xs font-medium text-white hover:bg-slate-800 disabled:opacity-50"
                >
                  Inspect
                </button>
              </div>
              <div className="mt-2 flex items-center justify-between text-[11px] text-slate-500">
                <span>Paste any `invoice.stripe.com` or `buy.stripe.com` URL.</span>
                <button
                  type="button"
                  onClick={() => {
                    setStripeUrl('https://invoice.stripe.com/i/acct_1Demo/inv_stripe_992');
                    setClientName('Veldt Robotics');
                    setClientEmail('ap@veldt.io');
                    setAmountDisplay('3200.00');
                    setCurrency('USD');
                    setInvoiceNumber('INV-2026-205');
                  }}
                  className="font-medium text-emerald-700 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-600 rounded"
                >
                  Fill sample Stripe link
                </button>
              </div>
              {stripeHint && <p className="mt-2 text-xs font-medium text-emerald-700">{stripeHint}</p>}
            </div>
          )}

          {tab === 'pdf_upload' && (
            <div className="rounded-xl border border-dashed border-blue-300 bg-blue-50/40 p-4 text-center">
              <FileUp className="mx-auto h-6 w-6 text-blue-600" />
              <p className="mt-1.5 text-xs font-medium text-slate-800">
                {pdfFilename ? `Parsed: ${pdfFilename}` : 'Upload any freelancer PDF invoice to auto-extract fields'}
              </p>
              <div className="mt-3 flex flex-wrap items-center justify-center gap-2">
                <label className="cursor-pointer rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700">
                  Choose PDF File
                  <input
                    type="file"
                    accept="application/pdf,.pdf"
                    className="hidden"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) void uploadPdfFile(file, file.name);
                    }}
                  />
                </label>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void uploadPdfFile(buildSamplePdfBlob(), 'INV-2026-312-CrescentWave.pdf')}
                  className="inline-flex items-center gap-1 rounded-lg border border-blue-200 bg-white px-3 py-1.5 text-xs font-medium text-blue-700 hover:bg-blue-50"
                >
                  <Sparkles className="h-3.5 w-3.5" />
                  Test with Sample UK PDF
                </button>
              </div>
              {pdfSnippet && (
                <pre className="mt-3 max-h-24 overflow-y-auto rounded-lg bg-white p-2 text-left font-mono text-[11px] text-slate-600 ring-1 ring-slate-200">
                  {pdfSnippet}
                </pre>
              )}
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-slate-700">Invoice #</label>
              <input
                required
                value={invoiceNumber}
                onChange={(e) => setInvoiceNumber(e.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-sky-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-600"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700">Due Date</label>
              <input
                required
                type="date"
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-sky-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-600"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-slate-700">Client Name</label>
              <input
                required
                placeholder="Acme Studio"
                value={clientName}
                onChange={(e) => setClientName(e.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-sky-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-600"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700">Client Email</label>
              <input
                required
                type="email"
                placeholder="billing@client.com"
                value={clientEmail}
                onChange={(e) => setClientEmail(e.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-sky-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-600"
              />
            </div>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div className="col-span-2">
              <label className="block text-xs font-medium text-slate-700">Invoice Amount</label>
              <input
                required
                value={amountDisplay}
                onChange={(e) => setAmountDisplay(e.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm tabular-nums focus:border-sky-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-600"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700">Currency</label>
              <select
                value={currency}
                onChange={(e) => {
                  const next = e.target.value as Currency;
                  setCurrency(next);
                  if (next === 'GBP') setJurisdiction('UK');
                  else if (next === 'EUR') setJurisdiction('EU');
                  else setJurisdiction('US_CUSTOM');
                }}
                className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm focus:border-sky-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-600"
              >
                <option value="USD">USD ($)</option>
                <option value="GBP">GBP (£)</option>
                <option value="EUR">EUR (€)</option>
              </select>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-3 rounded-xl border border-slate-200 bg-slate-50 p-3">
            <div>
              <label className="block text-[11px] font-medium text-slate-600">Late-Fee Regime</label>
              <select
                value={jurisdiction}
                onChange={(e) => {
                  const j = e.target.value as Jurisdiction;
                  setJurisdiction(j);
                  if (j !== 'US_CUSTOM') setGracePeriodDays('0');
                }}
                className="mt-1 w-full rounded-md border border-slate-300 bg-white px-2 py-1.5 text-xs"
              >
                <option value="UK">UK Statutory Act 1998</option>
                <option value="EU">EU Directive 2011/7/EU</option>
                <option value="US_CUSTOM">US / Custom Terms</option>
              </select>
            </div>
            <div>
              <label className="block text-[11px] font-medium text-slate-600">Grace Days</label>
              <input
                type="number"
                min={0}
                max={30}
                value={gracePeriodDays}
                onChange={(e) => setGracePeriodDays(e.target.value)}
                className="mt-1 w-full rounded-md border border-slate-300 bg-white px-2 py-1.5 text-xs tabular-nums"
              />
            </div>
            <div>
              <label className="block text-[11px] font-medium text-slate-600">Tone</label>
              <select
                value={tone}
                onChange={(e) => setTone(e.target.value as ToneMode)}
                className="mt-1 w-full rounded-md border border-slate-300 bg-white px-2 py-1.5 text-xs"
              >
                <option value="warm">Warm & Friendly</option>
                <option value="neutral">Neutral Pro</option>
                <option value="firm">Firm Statutory</option>
              </select>
            </div>
            {jurisdiction === 'US_CUSTOM' && (
              <div className="col-span-3 flex items-center justify-between pt-1">
                <span className="text-[11px] text-slate-600">Monthly late interest rate (%)</span>
                <input
                  type="number"
                  step="0.1"
                  value={customMonthlyRatePct}
                  onChange={(e) => setCustomMonthlyRatePct(e.target.value)}
                  className="w-20 rounded-md border border-slate-300 bg-white px-2 py-1 text-right text-xs tabular-nums"
                />
              </div>
            )}
            <label className="col-span-3 flex items-center gap-2 pt-1 text-xs text-slate-700">
              <input
                type="checkbox"
                checked={lateFeeEnabled}
                onChange={(e) => setLateFeeEnabled(e.target.checked)}
                className="rounded border-slate-300 text-blue-600"
              />
              Automatically accrue &amp; disclose statutory late fees when overdue
            </label>
          </div>

          {error && <p className="rounded-lg bg-rose-50 px-3 py-2 text-xs font-medium text-rose-700">{error}</p>}

          <div className="flex items-center justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg px-4 py-2 text-xs font-medium text-slate-600 hover:bg-slate-100"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={busy}
              className="rounded-lg bg-blue-600 px-4 py-2 text-xs font-semibold text-white shadow-sm hover:bg-blue-700 disabled:opacity-50"
            >
              {busy ? 'Saving...' : 'Start Automated Chasing'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
