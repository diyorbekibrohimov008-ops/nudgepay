import { NextResponse } from 'next/server';
import { workspaceService, type CreateInvoiceInput } from '@/lib/workspace-service';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as Partial<CreateInvoiceInput>;
    if (!body.invoiceNumber || !body.clientName || !body.clientEmail || !body.principalCents || !body.dueDate) {
      return NextResponse.json(
        { error: 'invoiceNumber, clientName, clientEmail, principalCents, and dueDate are required.' },
        { status: 400 },
      );
    }

    const view = await workspaceService.createInvoice({
      invoiceNumber: body.invoiceNumber,
      clientName: body.clientName,
      clientEmail: body.clientEmail,
      principalCents: Number(body.principalCents),
      currency: body.currency ?? 'USD',
      issueDate: body.issueDate,
      dueDate: body.dueDate,
      source: body.source ?? (body.stripeUrl ? 'stripe_link' : 'manual'),
      stripeUrl: body.stripeUrl,
      pdfBlobPathname: body.pdfBlobPathname,
      pdfFilename: body.pdfFilename,
      jurisdiction: body.jurisdiction ?? 'US_CUSTOM',
      lateFeeEnabled: body.lateFeeEnabled ?? true,
      gracePeriodDays: body.gracePeriodDays,
      customMonthlyRatePct: body.customMonthlyRatePct,
      customFlatFeeCents: body.customFlatFeeCents,
      tone: body.tone,
    });
    return NextResponse.json(view, { status: 201 });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to create invoice' },
      { status: 400 },
    );
  }
}
