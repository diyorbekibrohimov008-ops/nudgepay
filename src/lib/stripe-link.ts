import type { Currency } from './types.ts';

export interface ParsedStripeLink {
  valid: boolean;
  normalizedUrl: string;
  stripeInvoiceId: string | null;
  error?: string;
}

export interface InspectedStripeMetadata extends ParsedStripeLink {
  reachable: boolean;
  merchantHint: string | null;
  amountCents: number | null;
  currency: Currency | null;
  title: string | null;
}

const ALLOWED_STRIPE_HOSTS = new Set([
  'invoice.stripe.com',
  'pay.stripe.com',
  'buy.stripe.com',
  'checkout.stripe.com',
]);

export function parseStripeInvoiceUrl(rawUrl: string): ParsedStripeLink {
  const trimmed = rawUrl.trim();
  if (!trimmed) {
    return { valid: false, normalizedUrl: '', stripeInvoiceId: null, error: 'Stripe URL is required.' };
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return { valid: false, normalizedUrl: trimmed, stripeInvoiceId: null, error: 'Invalid URL format.' };
  }

  if (parsed.protocol !== 'https:' || !ALLOWED_STRIPE_HOSTS.has(parsed.hostname.toLowerCase())) {
    return {
      valid: false,
      normalizedUrl: trimmed,
      stripeInvoiceId: null,
      error: 'URL must be an https://invoice.stripe.com, pay.stripe.com, buy.stripe.com, or checkout.stripe.com link.',
    };
  }

  const segments = parsed.pathname.split('/').filter(Boolean);
  const lastSegment = segments.length > 0 ? segments[segments.length - 1] : null;

  return {
    valid: true,
    normalizedUrl: parsed.toString(),
    stripeInvoiceId: lastSegment,
  };
}

export async function inspectStripeUrlMetadata(rawUrl: string): Promise<InspectedStripeMetadata> {
  const base = parseStripeInvoiceUrl(rawUrl);
  if (!base.valid) {
    return {
      ...base,
      reachable: false,
      merchantHint: null,
      amountCents: null,
      currency: null,
      title: null,
    };
  }

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 3000);
    const res = await fetch(base.normalizedUrl, {
      method: 'GET',
      signal: controller.signal,
      headers: { 'user-agent': 'NudgePay-InvoiceInspector/1.0' },
    });
    clearTimeout(timer);

    if (!res.ok) {
      return {
        ...base,
        reachable: false,
        merchantHint: null,
        amountCents: null,
        currency: null,
        title: null,
      };
    }

    const html = await res.text();
    const titleMatch = html.match(/<title>([^<]+)<\/title>/i);
    const ogTitleMatch = html.match(/property=["']og:title["'][^>]*content=["']([^"']+)["']/i);
    const ogDescMatch = html.match(/property=["']og:description["'][^>]*content=["']([^"']+)["']/i);
    const title = ogTitleMatch?.[1] ?? titleMatch?.[1] ?? null;
    const combined = `${title ?? ''} ${ogDescMatch?.[1] ?? ''}`;

    let amountCents: number | null = null;
    let currency: Currency | null = null;
    const amt = combined.match(/([$£€])\s*([0-9,]+\.[0-9]{2})/);
    if (amt) {
      amountCents = Math.round(Number(amt[2].replace(/,/g, '')) * 100);
      currency = amt[1] === '£' ? 'GBP' : amt[1] === '€' ? 'EUR' : 'USD';
    }

    const merchantHint = title
      ? title.replace(/invoice\s+from\s+/i, '').split('|')[0].trim()
      : null;

    return {
      ...base,
      reachable: true,
      merchantHint,
      amountCents,
      currency,
      title,
    };
  } catch {
    return {
      ...base,
      reachable: false,
      merchantHint: null,
      amountCents: null,
      currency: null,
      title: null,
    };
  }
}
