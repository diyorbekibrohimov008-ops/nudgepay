import { NextResponse } from 'next/server';
import { inspectStripeUrlMetadata } from '@/lib/stripe-link';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  try {
    const { url } = (await request.json()) as { url?: string };
    const result = await inspectStripeUrlMetadata(url ?? '');
    if (!result.valid) {
      return NextResponse.json(result, { status: 400 });
    }
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to inspect Stripe URL.' },
      { status: 400 },
    );
  }
}
