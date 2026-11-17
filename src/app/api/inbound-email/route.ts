import { NextResponse } from 'next/server';
import { workspaceService } from '@/lib/workspace-service';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      to?: string;
      from?: string;
      text?: string;
      body?: string;
      invoiceId?: string;
      data?: { to?: string[]; from?: string; text?: string };
    };

    const normalized = {
      to: body.to ?? body.data?.to?.[0],
      from: body.from ?? body.data?.from,
      text: body.text ?? body.body ?? body.data?.text,
      invoiceId: body.invoiceId,
    };

    const res = await workspaceService.handleInboundEmail(normalized);
    return NextResponse.json(res, { status: res.matched ? 200 : 404 });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to process inbound email' },
      { status: 400 },
    );
  }
}
