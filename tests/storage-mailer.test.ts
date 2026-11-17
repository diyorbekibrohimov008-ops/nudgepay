import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createStorage, getEffectiveNowIso } from '../src/lib/storage.ts';
import { verifyStripeWebhookSignature, sendChaseEmail } from '../src/lib/mailer.ts';
import crypto from 'node:crypto';

describe('Storage adapter', () => {
  it('seeds initial state on first load and persists updates via local store when no blob driver is present', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'nudgepay-test-'));
    const store = createStorage({ localDir: tmpDir });

    const initial = await store.loadState();
    assert.ok(initial.invoices.length >= 4);

    initial.settings.workspaceName = 'Updated Studio';
    await store.saveState(initial);

    const reloaded = await store.loadState();
    assert.equal(reloaded.settings.workspaceName, 'Updated Studio');

    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('persists state and PDF buffers to blob driver when provided', async () => {
    const blobs = new Map<string, { data: Buffer; contentType: string }>();
    const fakeBlobDriver = {
      async put(pathname: string, body: string | Buffer, opts: { contentType?: string }) {
        const buf = typeof body === 'string' ? Buffer.from(body, 'utf8') : body;
        blobs.set(pathname, { data: buf, contentType: opts.contentType ?? 'application/octet-stream' });
        return { pathname };
      },
      async get(pathname: string) {
        const hit = blobs.get(pathname);
        if (!hit) return null;
        return {
          statusCode: 200,
          blob: { contentType: hit.contentType },
          stream: new ReadableStream({
            start(controller) {
              controller.enqueue(hit.data);
              controller.close();
            },
          }),
        };
      },
    };

    const store = createStorage({ blobDriver: fakeBlobDriver });
    const s = await store.loadState();
    s.settings.pricingTier = 'pro_15';
    await store.saveState(s);

    const s2 = await store.loadState();
    assert.equal(s2.settings.pricingTier, 'pro_15');

    const pdfPath = await store.savePdf('test-invoice.pdf', Buffer.from('%PDF-1.4 demo'));
    const pdfData = await store.readPdf(pdfPath);
    assert.equal(pdfData?.buffer.toString('utf8'), '%PDF-1.4 demo');
  });

  it('computes effective clock offset cleanly', () => {
    const baseMs = Date.UTC(2026, 10, 11, 12, 0, 0);
    const iso = getEffectiveNowIso(7, baseMs);
    assert.equal(iso.slice(0, 10), '2026-11-18');
  });
});

describe('Mailer & Stripe webhook signature verification', () => {
  it('returns sandbox delivery mode when no Resend key is configured', async () => {
    const prev = process.env.RESEND_API_KEY;
    delete process.env.RESEND_API_KEY;
    const res = await sendChaseEmail({
      to: 'client@example.com',
      from: 'milo@vance.design',
      replyTo: 'reply+inv_1@nudgepay.app',
      subject: 'Quick nudge',
      body: 'Hello',
    });
    if (prev !== undefined) process.env.RESEND_API_KEY = prev;
    assert.equal(res.mode, 'sandbox');
  });

  it('verifies valid Stripe HMAC-SHA256 webhook signatures and rejects tampered payloads', () => {
    const secret = 'whsec_test_secret_123';
    const payload = JSON.stringify({ type: 'invoice.paid', data: { object: { id: 'inv_123' } } });
    const ts = Math.floor(Date.now() / 1000);
    const sig = crypto.createHmac('sha256', secret).update(`${ts}.${payload}`).digest('hex');
    const header = `t=${ts},v1=${sig}`;

    assert.equal(verifyStripeWebhookSignature(payload, header, secret), true);
    assert.equal(verifyStripeWebhookSignature(payload + 'tamper', header, secret), false);
    assert.equal(verifyStripeWebhookSignature(payload, 't=1,v1=deadbeef', secret), false);
  });
});
