import zlib from 'node:zlib';
import type { Currency } from './types.ts';

export interface ParsedPdfInvoice {
  invoiceNumber: string | null;
  clientName: string | null;
  clientEmail: string | null;
  amountCents: number | null;
  currency: Currency | null;
  issueDate: string | null;
  dueDate: string | null;
  stripeUrl: string | null;
  rawTextSnippet: string;
}

const MONTHS: Record<string, number> = {
  january: 0, jan: 0,
  february: 1, feb: 1,
  march: 2, mar: 2,
  april: 3, apr: 3,
  may: 4,
  june: 5, jun: 5,
  july: 6, jul: 6,
  august: 7, aug: 7,
  september: 8, sep: 8, sept: 8,
  october: 9, oct: 9,
  november: 10, nov: 10,
  december: 11, dec: 11,
};

function decodeBufferSmart(buf: Buffer): string {
  const utf8 = buf.toString('utf8');
  return utf8.includes('\uFFFD') ? buf.toString('latin1') : utf8;
}

function unescapePdfLiteral(raw: string): string {
  let out = '';
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i];
    if (ch !== '\\') {
      out += ch;
      continue;
    }
    const next = raw[i + 1];
    if (next === undefined) break;
    if (next === 'n') { out += '\n'; i++; }
    else if (next === 'r') { out += '\r'; i++; }
    else if (next === 't') { out += '\t'; i++; }
    else if (next === 'b') { out += '\b'; i++; }
    else if (next === 'f') { out += '\f'; i++; }
    else if (next === '(' || next === ')' || next === '\\') { out += next; i++; }
    else if (/[0-7]/.test(next)) {
      const oct = raw.slice(i + 1, i + 4).match(/^[0-7]{1,3}/)?.[0] ?? next;
      out += String.fromCharCode(parseInt(oct, 8));
      i += oct.length;
    } else {
      out += next;
      i++;
    }
  }
  return out;
}

function decodePdfHexString(hex: string): string {
  const clean = hex.replace(/\s+/g, '');
  if (clean.length < 2) return '';
  const bytes: number[] = [];
  for (let i = 0; i + 1 < clean.length; i += 2) {
    bytes.push(parseInt(clean.slice(i, i + 2), 16));
  }
  const buf = Buffer.from(bytes);
  if ((bytes[0] === 0xfe && bytes[1] === 0xff) || (bytes.length >= 4 && bytes[0] === 0 && bytes[2] === 0)) {
    const start = bytes[0] === 0xfe && bytes[1] === 0xff ? 2 : 0;
    let out = '';
    for (let i = start; i + 1 < bytes.length; i += 2) {
      const code = (bytes[i] << 8) | bytes[i + 1];
      if (code >= 32 && code !== 127) out += String.fromCharCode(code);
    }
    return out;
  }
  return decodeBufferSmart(buf);
}

function extractTextFromContentStream(streamText: string): string {
  const lines: string[] = [];
  let currentLine = '';

  const pushCurrent = () => {
    const trimmed = currentLine.trim();
    if (trimmed) lines.push(trimmed);
    currentLine = '';
  };

  let i = 0;
  while (i < streamText.length) {
    const ch = streamText[i];

    // Inside literal string (...)
    if (ch === '(') {
      let depth = 1;
      let j = i + 1;
      let raw = '';
      while (j < streamText.length && depth > 0) {
        const c = streamText[j];
        if (c === '\\') {
          raw += c + (streamText[j + 1] ?? '');
          j += 2;
          continue;
        }
        if (c === '(') depth++;
        else if (c === ')') {
          depth--;
          if (depth === 0) break;
        }
        raw += c;
        j++;
      }
      const decoded = unescapePdfLiteral(raw);
      // Look ahead for Tj / ' / " or TJ
      const tail = streamText.slice(j + 1, j + 16);
      if (/^\s*(?:Tj|'|")/.test(tail) || streamText.slice(Math.max(0, i - 2), i).includes('[')) {
        currentLine += decoded;
      } else {
        // Also collect standalone strings inside TJ arrays
        currentLine += decoded;
      }
      i = j + 1;
      continue;
    }

    // Hex string <...> (not dictionary <<)
    if (ch === '<' && streamText[i + 1] !== '<') {
      const end = streamText.indexOf('>', i + 1);
      if (end !== -1 && end - i < 2000) {
        const hexBody = streamText.slice(i + 1, end);
        if (/^[0-9a-fA-F\s]+$/.test(hexBody)) {
          currentLine += decodePdfHexString(hexBody);
        }
        i = end + 1;
        continue;
      }
    }

    // Text positioning / newline operators
    if ((ch === 'T' && (streamText[i + 1] === 'd' || streamText[i + 1] === 'D' || streamText[i + 1] === '*')) ||
        (ch === 'E' && streamText[i + 1] === 'T')) {
      const prev = streamText[i - 1] ?? ' ';
      const next = streamText[i + 2] ?? ' ';
      if (/\s/.test(prev) && /\s/.test(next)) {
        pushCurrent();
      }
    }

    i++;
  }

  pushCurrent();
  return lines.join('\n');
}

export function extractTextFromPdfBuffer(buffer: Buffer): { text: string; uris: string[] } {
  const latin = buffer.toString('latin1');
  const uris: string[] = [];

  // Extract PDF /URI (...) annotations
  const uriRegex = /\/URI\s*\(([^)]+)\)/g;
  let uriMatch: RegExpExecArray | null;
  while ((uriMatch = uriRegex.exec(latin)) !== null) {
    const clean = unescapePdfLiteral(uriMatch[1]).trim();
    if (clean.startsWith('http')) uris.push(clean);
  }

  const chunks: string[] = [];
  let cursor = 0;
  while (cursor < buffer.length) {
    const streamIdx = latin.indexOf('stream', cursor);
    if (streamIdx === -1) break;
    let dataStart = streamIdx + 6;
    if (latin[dataStart] === '\r' && latin[dataStart + 1] === '\n') dataStart += 2;
    else if (latin[dataStart] === '\n' || latin[dataStart] === '\r') dataStart += 1;

    const endIdx = latin.indexOf('endstream', dataStart);
    if (endIdx === -1) break;

    let dataEnd = endIdx;
    while (dataEnd > dataStart && (latin[dataEnd - 1] === '\n' || latin[dataEnd - 1] === '\r')) {
      dataEnd--;
    }

    const slice = buffer.subarray(dataStart, dataEnd);
    let decompressed: Buffer = slice;
    try {
      decompressed = zlib.inflateSync(slice);
    } catch {
      try {
        decompressed = zlib.inflateRawSync(slice);
      } catch {
        decompressed = slice;
      }
    }

    const decoded = decodeBufferSmart(decompressed);
    if (decoded.includes('Tj') || decoded.includes('TJ') || decoded.includes('BT')) {
      const extracted = extractTextFromContentStream(decoded);
      if (extracted) chunks.push(extracted);
    }

    cursor = endIdx + 9;
  }

  // Fallback for uncompressed plain PDF text streams not wrapped properly
  if (chunks.length === 0) {
    const fallback = extractTextFromContentStream(latin);
    if (fallback) chunks.push(fallback);
  }

  return {
    text: chunks.join('\n').trim(),
    uris: Array.from(new Set(uris)),
  };
}

function normalizeParsedDate(raw: string): string | null {
  const s = raw.trim();
  const iso = s.match(/^(20\d{2})-(\d{1,2})-(\d{1,2})$/);
  if (iso) {
    return `${iso[1]}-${iso[2].padStart(2, '0')}-${iso[3].padStart(2, '0')}`;
  }

  const mFirst = s.match(/^(january|jan|february|feb|march|mar|april|apr|may|june|jun|july|jul|august|aug|september|sept|sep|october|oct|november|nov|december|dec)\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s*(20\d{2})$/i);
  if (mFirst) {
    const m = String(MONTHS[mFirst[1].toLowerCase()] + 1).padStart(2, '0');
    return `${mFirst[3]}-${m}-${mFirst[2].padStart(2, '0')}`;
  }

  const dFirst = s.match(/^(\d{1,2})(?:st|nd|rd|th)?\s+(january|jan|february|feb|march|mar|april|apr|may|june|jun|july|jul|august|aug|september|sept|sep|october|oct|november|nov|december|dec)\.?,?\s*(20\d{2})$/i);
  if (dFirst) {
    const m = String(MONTHS[dFirst[2].toLowerCase()] + 1).padStart(2, '0');
    return `${dFirst[3]}-${m}-${dFirst[1].padStart(2, '0')}`;
  }

  const slash = s.match(/^(\d{1,2})\/(\d{1,2})\/(20\d{2})$/);
  if (slash) {
    const a = Number(slash[1]);
    const b = Number(slash[2]);
    const month = a > 12 ? b : a;
    const day = a > 12 ? a : b;
    return `${slash[3]}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  }

  return null;
}

function addDaysUtc(ymd: string, days: number): string {
  const [y, m, d] = ymd.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d) + days * 86_400_000);
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-${String(dt.getUTCDate()).padStart(2, '0')}`;
}

export function extractInvoiceFieldsFromText(text: string, uris: string[] = []): ParsedPdfInvoice {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);

  // Invoice number
  let invoiceNumber: string | null = null;
  for (const line of lines) {
    const invMatch = line.match(/invoice\s*(?:number|no\.?|#)\s*[:#-]?\s*([A-Z0-9][A-Z0-9-]{1,24})/i)
      ?? line.match(/^(?:inv|invoice)\s*#([A-Z0-9-]{2,24})/i);
    if (invMatch) {
      invoiceNumber = invMatch[1].replace(/^#/, '');
      break;
    }
  }

  // Email
  const emailMatch = text.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/);
  const clientEmail = emailMatch ? emailMatch[0] : null;

  // Client Name (after Bill To / Billed To / Client:)
  let clientName: string | null = null;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const inlineMatch = line.match(/^(?:bill(?:ed)?\s*to|client|customer)\s*:\s*(.+)$/i);
    if (inlineMatch && inlineMatch[1].trim()) {
      clientName = inlineMatch[1].replace(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/, '').trim() || null;
      if (clientName) break;
    }
    if (/^(?:bill(?:ed)?\s*to|client|customer)\s*:?$/i.test(line) && lines[i + 1]) {
      const next = lines[i + 1].replace(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/, '').trim();
      if (next && !/^(?:email|due|date|invoice|total)/i.test(next)) {
        clientName = next;
        break;
      }
    }
  }

  // Amount & Currency
  let amountCents: number | null = null;
  let currency: Currency | null = null;
  const amountRegex = /(USD|GBP|EUR|[$£€])\s*([0-9]{1,3}(?:,[0-9]{3})*(?:\.[0-9]{2})|[0-9]+(?:\.[0-9]{2})?)|([0-9]{1,3}(?:,[0-9]{3})*(?:\.[0-9]{2}))\s*(USD|GBP|EUR)/i;

  const prioritizedLines = [
    ...lines.filter((l) => /(?:total\s+due|amount\s+due|balance\s+due|total\s+payable|grand\s+total)/i.test(l)),
    ...lines.filter((l) => /\btotal\b/i.test(l)),
    ...lines,
  ];

  for (const line of prioritizedLines) {
    const m = line.match(amountRegex);
    if (!m) continue;
    const sym = (m[1] ?? m[4] ?? '$').toUpperCase();
    const numStr = (m[2] ?? m[3] ?? '').replace(/,/g, '');
    const numeric = Number(numStr);
    if (!Number.isFinite(numeric) || numeric <= 0) continue;

    amountCents = Math.round(numeric * 100);
    if (sym === '£' || sym === 'GBP') currency = 'GBP';
    else if (sym === '€' || sym === 'EUR') currency = 'EUR';
    else currency = 'USD';
    break;
  }

  // Dates
  const datePattern = '(20\\d{2}-\\d{1,2}-\\d{1,2}|(?:january|jan|february|feb|march|mar|april|apr|may|june|jun|july|jul|august|aug|september|sept|sep|october|oct|november|nov|december|dec)\\.?\\s+\\d{1,2}(?:st|nd|rd|th)?,?\\s*20\\d{2}|\\d{1,2}(?:st|nd|rd|th)?\\s+(?:january|jan|february|feb|march|mar|april|apr|may|june|jun|july|jul|august|aug|september|sept|sep|october|oct|november|nov|december|dec)\\.?,?\\s*20\\d{2}|\\d{1,2}\\/\\d{1,2}\\/20\\d{2})';

  let issueDate: string | null = null;
  let dueDate: string | null = null;

  const dueMatch = text.match(new RegExp(`(?:due\\s*date|payment\\s*due|pay\\s*by)\\s*[:\\s]+${datePattern}`, 'i'));
  if (dueMatch) dueDate = normalizeParsedDate(dueMatch[1]);

  const issueMatch = text.match(new RegExp(`(?:issue\\s*date|invoice\\s*date|date)\\s*[:\\s]+${datePattern}`, 'i'));
  if (issueMatch) issueDate = normalizeParsedDate(issueMatch[1]);

  if (!dueDate && issueDate) {
    const netMatch = text.match(/\bnet\s*(\d{1,3})\b/i);
    if (netMatch) {
      dueDate = addDaysUtc(issueDate, Number(netMatch[1]));
    }
  }

  const textStripe = text.match(/https:\/\/(?:invoice|pay|buy|checkout)\.stripe\.com\/[^\s)]+/i)?.[0] ?? null;
  const uriStripe = uris.find((u) => /^https:\/\/(?:invoice|pay|buy|checkout)\.stripe\.com\//i.test(u)) ?? null;

  return {
    invoiceNumber,
    clientName,
    clientEmail,
    amountCents,
    currency,
    issueDate,
    dueDate,
    stripeUrl: uriStripe ?? textStripe,
    rawTextSnippet: text.slice(0, 600),
  };
}

export function parsePdfInvoice(buffer: Buffer): ParsedPdfInvoice {
  const { text, uris } = extractTextFromPdfBuffer(buffer);
  return extractInvoiceFieldsFromText(text, uris);
}
