'use client';

import type { InvoiceSource, InvoiceStatus } from '@/lib/types';
import { CheckCircle2, Clock, FileText, Link2, PauseCircle, AlertTriangle, HelpCircle, Plane } from 'lucide-react';

export function StatusPill({ status, promisedDate }: { status: InvoiceStatus; promisedDate?: string | null }) {
  switch (status) {
    case 'overdue':
      return (
        <span className="inline-flex items-center gap-1 rounded-full bg-rose-50 px-2.5 py-0.5 text-xs font-medium text-rose-700 ring-1 ring-inset ring-rose-600/20">
          <AlertTriangle className="h-3 w-3" />
          Chasing · Overdue
        </span>
      );
    case 'paused_promise':
      return (
        <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2.5 py-0.5 text-xs font-medium text-amber-800 ring-1 ring-inset ring-amber-600/25">
          <PauseCircle className="h-3 w-3" />
          Paused · Promise {promisedDate ? `(${promisedDate})` : ''}
        </span>
      );
    case 'paused_dispute':
      return (
        <span className="inline-flex items-center gap-1 rounded-full bg-orange-50 px-2.5 py-0.5 text-xs font-medium text-orange-800 ring-1 ring-inset ring-orange-600/25">
          <HelpCircle className="h-3 w-3" />
          Paused · Dispute
        </span>
      );
    case 'paused_ooo':
      return (
        <span className="inline-flex items-center gap-1 rounded-full bg-sky-50 px-2.5 py-0.5 text-xs font-medium text-sky-700 ring-1 ring-inset ring-sky-600/20">
          <Plane className="h-3 w-3" />
          Paused · OOO
        </span>
      );
    case 'paused_payment_claimed':
      return (
        <span className="inline-flex items-center gap-1 rounded-full bg-teal-50 px-2.5 py-0.5 text-xs font-medium text-teal-800 ring-1 ring-inset ring-teal-600/25">
          <Clock className="h-3 w-3" />
          Paused · Verify Payment
        </span>
      );
    case 'upcoming':
      return (
        <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-medium text-slate-700 ring-1 ring-inset ring-slate-500/20">
          <Clock className="h-3 w-3" />
          Upcoming
        </span>
      );
    case 'paid':
      return (
        <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-0.5 text-xs font-medium text-emerald-700 ring-1 ring-inset ring-emerald-600/20">
          <CheckCircle2 className="h-3 w-3" />
          Paid
        </span>
      );
    default:
      return (
        <span className="inline-flex items-center rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-medium text-slate-600">
          Written off
        </span>
      );
  }
}

export function SourceBadge({ source }: { source: InvoiceSource }) {
  if (source === 'stripe_link') {
    return (
      <span className="inline-flex items-center gap-1 rounded-md bg-emerald-50 px-1.5 py-0.5 text-[11px] font-medium text-emerald-800 ring-1 ring-inset ring-emerald-600/20">
        <Link2 className="h-3 w-3" />
        Stripe Link
      </span>
    );
  }
  if (source === 'pdf_upload') {
    return (
      <span className="inline-flex items-center gap-1 rounded-md bg-blue-50 px-1.5 py-0.5 text-[11px] font-medium text-blue-700">
        <FileText className="h-3 w-3" />
        PDF Invoice
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-md bg-slate-100 px-1.5 py-0.5 text-[11px] font-medium text-slate-600">
      Standalone
    </span>
  );
}
