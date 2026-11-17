import crypto from 'node:crypto';

export interface SendEmailInput {
  to: string;
  from: string;
  replyTo: string;
  subject: string;
  body: string;
  resendApiKey?: string;
}

export interface SendEmailResult {
  mode: 'resend' | 'sandbox';
  providerId: string | null;
  error?: string;
}

export async function sendChaseEmail(input: SendEmailInput): Promise<SendEmailResult> {
  const apiKey = input.resendApiKey ?? process.env.RESEND_API_KEY;
  if (!apiKey) {
    return { mode: 'sandbox', providerId: null };
  }

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: input.from,
        to: [input.to],
        reply_to: input.replyTo,
        subject: input.subject,
        text: input.body,
      }),
    });

    if (!res.ok) {
      const errText = await res.text();
      return { mode: 'sandbox', providerId: null, error: `Resend ${res.status}: ${errText}` };
    }

    const data = (await res.json()) as { id?: string };
    return { mode: 'resend', providerId: data.id ?? null };
  } catch (err) {
    return {
      mode: 'sandbox',
      providerId: null,
      error: err instanceof Error ? err.message : 'Resend request failed',
    };
  }
}

export function verifyStripeWebhookSignature(
  payload: string,
  signatureHeader: string | null,
  webhookSecret: string,
): boolean {
  if (!signatureHeader || !webhookSecret) return false;

  const parts = signatureHeader.split(',').reduce<Record<string, string>>((acc, item) => {
    const [k, v] = item.split('=');
    if (k && v) acc[k.trim()] = v.trim();
    return acc;
  }, {});

  const timestamp = parts.t;
  const sig = parts.v1;
  if (!timestamp || !sig) return false;

  const expected = crypto
    .createHmac('sha256', webhookSecret)
    .update(`${timestamp}.${payload}`)
    .digest('hex');

  try {
    const sigBuf = Buffer.from(sig, 'hex');
    const expBuf = Buffer.from(expected, 'hex');
    if (sigBuf.length !== expBuf.length) return false;
    return crypto.timingSafeEqual(sigBuf, expBuf);
  } catch {
    return false;
  }
}
