import { NextResponse } from 'next/server';
import { verifyStripeWebhookSignature } from '@/lib/mailer';
import { workspaceService } from '@/lib/workspace-service';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  try {
    const rawBody = await request.text();
    const secret = process.env.STRIPE_WEBHOOK_SECRET;
    if (secret) {
      const sig = request.headers.get('stripe-signature');
      if (!verifyStripeWebhookSignature(rawBody, sig, secret)) {
        return NextResponse.json({ error: 'Invalid Stripe webhook signature' }, { status: 401 });
      }
    }

    const event = JSON.parse(rawBody);
    const result = await workspaceService.handleStripeEvent(event);
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to handle Stripe webhook' },
      { status: 400 },
    );
  }
}
