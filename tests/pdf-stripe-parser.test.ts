import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import zlib from 'node:zlib';
import { extractTextFromPdfBuffer, extractInvoiceFieldsFromText, parsePdfInvoice } from '../src/lib/pdf-invoice-parser.ts';
import { parseStripeInvoiceUrl } from '../src/lib/stripe-link.ts';

function buildCompressedTestPdf(lines: string[], uri?: string): Buffer {
  const ops = lines
    .map((line, i) => `BT /F1 12 Tf 50 ${750 - i * 18} Td (${line.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)')}) Tj ET`)
    .join('\n');
  const compressed = zlib.deflateSync(Buffer.from(ops, 'utf8'));
  const header = Buffer.from(
    `%PDF-1.4\n1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj\n2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj\n3 0 obj << /Type /Page /Parent 2 0 R /Contents 4 0 R >> endobj\n4 0 obj << /Length ${compressed.length} /Filter /FlateDecode >>\nstream\n`,
    'latin1',
  );
  const uriObj = uri ? `\n5 0 obj << /Type /Action /S /URI /URI (${uri}) >> endobj\n` : '\n';
  const footer = Buffer.from(`\nendstream\nendobj${uriObj}%%EOF`, 'latin1');
  return Buffer.concat([header, compressed, footer]);
}

describe('PDF invoice parser', () => {
  it('decompresses FlateDecode PDF streams and extracts readable invoice text and embedded Stripe URI', () => {
    const pdf = buildCompressedTestPdf(
      [
        'INVOICE #INV-2026-778',
        'Issue Date: 2026-11-01',
        'Due Date: 2026-11-25',
        'Bill To: Acme Design Studio',
        'Email: ap@acmedesign.co.uk',
        'Total Due: £1,450.00',
      ],
      'https://invoice.stripe.com/i/acct_1Test/live_XYZ123',
    );

    const extracted = extractTextFromPdfBuffer(pdf);
    assert.match(extracted.text, /INV-2026-778/);
    assert.match(extracted.text, /Acme Design Studio/);
    assert.equal(extracted.uris[0], 'https://invoice.stripe.com/i/acct_1Test/live_XYZ123');
  });

  it('extracts structured invoice fields from raw invoice text', () => {
    const raw = `
      STUDIO NORTHWEST
      Invoice Number: INV-2026-778
      Issue Date: Nov 1, 2026
      Due Date: Nov 25, 2026
      Bill To:
      Acme Design Studio
      ap@acmedesign.co.uk
      Subtotal: £1,450.00
      Total Due: £1,450.00
    `;
    const fields = extractInvoiceFieldsFromText(raw);
    assert.equal(fields.invoiceNumber, 'INV-2026-778');
    assert.equal(fields.currency, 'GBP');
    assert.equal(fields.amountCents, 145_000);
    assert.equal(fields.dueDate, '2026-11-25');
    assert.equal(fields.clientName, 'Acme Design Studio');
    assert.equal(fields.clientEmail, 'ap@acmedesign.co.uk');
  });

  it('parses full compressed PDF buffer end-to-end including Net 15 fallback due date', () => {
    const pdf = buildCompressedTestPdf([
      'Invoice #8841',
      'Date: 2026-11-01',
      'Terms: Net 15',
      'Client: Harbor Creative LLC',
      'finance@harborcreative.io',
      'Amount Due: $2,400.50',
    ]);

    const parsed = parsePdfInvoice(pdf);
    assert.equal(parsed.invoiceNumber, '8841');
    assert.equal(parsed.currency, 'USD');
    assert.equal(parsed.amountCents, 240_050);
    assert.equal(parsed.dueDate, '2026-11-16');
    assert.equal(parsed.clientName, 'Harbor Creative LLC');
    assert.equal(parsed.clientEmail, 'finance@harborcreative.io');
  });
});

describe('Stripe link validator', () => {
  it('accepts valid Stripe invoice and payment URLs and rejects invalid URLs', () => {
    const valid = parseStripeInvoiceUrl('https://invoice.stripe.com/i/acct_123abc/test_YWNjdF8x');
    assert.equal(valid.valid, true);
    assert.equal(valid.stripeInvoiceId, 'test_YWNjdF8x');

    const invalid = parseStripeInvoiceUrl('https://evil.example.com/invoice/123');
    assert.equal(invalid.valid, false);
  });
});
