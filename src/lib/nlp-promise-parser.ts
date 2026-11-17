import type { ReplyAnalysis } from './types.ts';

const MS_PER_DAY = 86_400_000;

const WEEKDAYS: Record<string, number> = {
  sunday: 0,
  sun: 0,
  monday: 1,
  mon: 1,
  tuesday: 2,
  tue: 2,
  tues: 2,
  wednesday: 3,
  wed: 3,
  thursday: 4,
  thu: 4,
  thur: 4,
  thurs: 4,
  friday: 5,
  fri: 5,
  saturday: 6,
  sat: 6,
};

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

const NUMBER_WORDS: Record<string, number> = {
  one: 1, a: 1, an: 1,
  two: 2, couple: 2,
  three: 3, few: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  ten: 10,
  fourteen: 14,
};

function formatUtcYmd(ms: number): string {
  const d = new Date(ms);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function addDaysYmd(ymd: string, days: number): string {
  const [y, m, d] = ymd.split('-').map(Number);
  return formatUtcYmd(Date.UTC(y, m - 1, d) + days * MS_PER_DAY);
}

function getBaseUtcDate(receivedAtIso: string): { year: number; month: number; day: number; dow: number; ymd: string; utcMs: number } {
  const datePart = receivedAtIso.slice(0, 10);
  const [year, monthOneBased, day] = datePart.split('-').map(Number);
  const month = monthOneBased - 1;
  const utcMs = Date.UTC(year, month, day);
  const dow = new Date(utcMs).getUTCDay();
  return { year, month, day, dow, ymd: formatUtcYmd(utcMs), utcMs };
}

interface ExtractedDate {
  date: string;
  matchedPhrase: string;
}

export function extractDateFromText(text: string, receivedAtIso: string): ExtractedDate | null {
  const base = getBaseUtcDate(receivedAtIso);
  const lower = text.toLowerCase();

  // 1. ISO date YYYY-MM-DD
  const isoMatch = text.match(/\b(20\d{2}-\d{2}-\d{2})\b/);
  if (isoMatch) {
    return { date: isoMatch[1], matchedPhrase: isoMatch[1] };
  }

  // 2. Month name + day ("Nov 20", "November 20th", "Nov 20, 2026")
  const monthFirstRegex = /\b(january|jan|february|feb|march|mar|april|apr|may|june|jun|july|jul|august|aug|september|sept|sep|october|oct|november|nov|december|dec)\.?\s+(\d{1,2})(?:st|nd|rd|th)?(?:,?\s*(20\d{2}))?\b/i;
  const mFirst = text.match(monthFirstRegex);
  if (mFirst) {
    const mIdx = MONTHS[mFirst[1].toLowerCase()];
    const dayNum = Number(mFirst[2]);
    let yr = mFirst[3] ? Number(mFirst[3]) : base.year;
    let candidate = Date.UTC(yr, mIdx, dayNum);
    if (!mFirst[3] && candidate < base.utcMs - 30 * MS_PER_DAY) {
      yr += 1;
      candidate = Date.UTC(yr, mIdx, dayNum);
    }
    return { date: formatUtcYmd(candidate), matchedPhrase: mFirst[0] };
  }

  // 3. Day + Month name ("20 Nov", "20th of November")
  const dayFirstRegex = /\b(\d{1,2})(?:st|nd|rd|th)?(?:\s+of)?\s+(january|jan|february|feb|march|mar|april|apr|may|june|jun|july|jul|august|aug|september|sept|sep|october|oct|november|nov|december|dec)\b(?:,?\s*(20\d{2}))?/i;
  const dFirst = text.match(dayFirstRegex);
  if (dFirst) {
    const dayNum = Number(dFirst[1]);
    const mIdx = MONTHS[dFirst[2].toLowerCase()];
    let yr = dFirst[3] ? Number(dFirst[3]) : base.year;
    let candidate = Date.UTC(yr, mIdx, dayNum);
    if (!dFirst[3] && candidate < base.utcMs - 30 * MS_PER_DAY) {
      yr += 1;
      candidate = Date.UTC(yr, mIdx, dayNum);
    }
    return { date: formatUtcYmd(candidate), matchedPhrase: dFirst[0] };
  }

  // 4. Relative days/weeks ("in 3 days", "in a couple of days", "in 2 weeks")
  const relMatch = lower.match(/\bin\s+(\d+|one|two|three|four|five|six|seven|ten|fourteen|a|an|a couple(?:\s+of)?|a few)\s+(day|days|week|weeks)\b/);
  if (relMatch) {
    const rawNum = relMatch[1].replace(/^a\s+/, '');
    const count = /^\d+$/.test(rawNum) ? Number(rawNum) : (NUMBER_WORDS[rawNum] ?? 1);
    const unitDays = relMatch[2].startsWith('week') ? count * 7 : count;
    return { date: addDaysYmd(base.ymd, unitDays), matchedPhrase: relMatch[0] };
  }

  // 5. End of month / EOM
  const eomMatch = lower.match(/\b(?:end of(?: the)? month|eom)\b/);
  if (eomMatch) {
    const lastDayMs = Date.UTC(base.year, base.month + 1, 0);
    return { date: formatUtcYmd(lastDayMs), matchedPhrase: eomMatch[0] };
  }

  // 6. End of week / EOW
  const eowMatch = lower.match(/\b(?:end of(?: the)? week|eow)\b/);
  if (eowMatch) {
    const daysToFri = (5 - base.dow + 7) % 7 || 7;
    return { date: addDaysYmd(base.ymd, daysToFri), matchedPhrase: eowMatch[0] };
  }

  // 7. Tomorrow / Today
  if (/\btomorrow\b/.test(lower)) {
    return { date: addDaysYmd(base.ymd, 1), matchedPhrase: 'tomorrow' };
  }
  if (/\b(?:today|tonight|this afternoon|later today)\b/.test(lower)) {
    return { date: base.ymd, matchedPhrase: 'today' };
  }

  // 8. Weekday ("next Tuesday", "this Friday", "on Monday", "by Thursday", "next week Tuesday")
  const weekdayMatch = lower.match(/\b(?:(next\s+week(?:\s+on)?|next|this|on|by)\s+)?(monday|mon|tuesday|tues|tue|wednesday|wed|thursday|thurs|thur|thu|friday|fri|saturday|sat|sunday|sun)\b/);
  if (weekdayMatch) {
    const modifier = (weekdayMatch[1] ?? '').trim();
    const targetDow = WEEKDAYS[weekdayMatch[2]];
    let daysAhead = (targetDow - base.dow + 7) % 7;
    if (daysAhead === 0) {
      daysAhead = 7;
    }
    const isoCurrentDow = base.dow === 0 ? 7 : base.dow;
    const isoTargetDow = targetDow === 0 ? 7 : targetDow;
    if (modifier.startsWith('next week') && isoTargetDow > isoCurrentDow) {
      daysAhead += 7;
    } else if (modifier === 'next' && daysAhead === 1) {
      // On Monday saying "next Tuesday" implies next week's Tuesday, whereas on Wed saying "next Tuesday" is already 6 days out.
      daysAhead += 7;
    }
    return { date: addDaysYmd(base.ymd, daysAhead), matchedPhrase: weekdayMatch[0] };
  }

  // 9. Explicit "next week" without a weekday
  if (/\bnext week\b/.test(lower)) {
    const daysToMonday = (1 - base.dow + 7) % 7 || 7;
    return { date: addDaysYmd(base.ymd, daysToMonday), matchedPhrase: 'next week' };
  }

  // 10. Ordinal day of month ("on the 15th", "by the 28th")
  const ordMatch = lower.match(/\b(?:on|by)\s+(?:the\s+)?(\d{1,2})(?:st|nd|rd|th)\b/);
  if (ordMatch) {
    const targetDay = Number(ordMatch[1]);
    if (targetDay >= 1 && targetDay <= 31) {
      let yr = base.year;
      let m = base.month;
      if (targetDay <= base.day) {
        m += 1;
        if (m > 11) {
          m = 0;
          yr += 1;
        }
      }
      return { date: formatUtcYmd(Date.UTC(yr, m, targetDay)), matchedPhrase: ordMatch[0] };
    }
  }

  // 11. Numeric slash date (MM/DD or DD/MM)
  const slashMatch = lower.match(/\b(\d{1,2})\/(\d{1,2})(?:\/(20\d{2}))?\b/);
  if (slashMatch) {
    const p1 = Number(slashMatch[1]);
    const p2 = Number(slashMatch[2]);
    const yr = slashMatch[3] ? Number(slashMatch[3]) : base.year;
    let monthZero = p1 - 1;
    let dayNum = p2;
    if (p1 > 12 && p2 <= 12) {
      dayNum = p1;
      monthZero = p2 - 1;
    }
    if (monthZero >= 0 && monthZero <= 11 && dayNum >= 1 && dayNum <= 31) {
      return { date: formatUtcYmd(Date.UTC(yr, monthZero, dayNum)), matchedPhrase: slashMatch[0] };
    }
  }

  return null;
}

export function analyzeClientReply(messageBody: string, receivedAtIso: string): ReplyAnalysis {
  const text = messageBody.trim();
  const lower = text.toLowerCase();

  // 1. Payment already sent / claimed (must be past-tense or explicit confirmation, not "will pay")
  const paymentClaimedMatch = lower.match(
    /\b(?:just\s+paid|paid\s+(?:this|just\s+now|today|via|by|through)|payment\s+(?:has\s+been\s+)?(?:sent|completed|made|submitted)|sent\s+(?:the\s+)?(?:wire|ach|payment|transfer|funds)|already\s+paid|wire\s+(?:is\s+)?sent|transferred\s+(?:just\s+now|today|the\s+funds))\b/
  );
  if (paymentClaimedMatch && !/\bwill\b/.test(lower)) {
    return {
      intent: 'PAYMENT_CLAIMED',
      confidence: 0.94,
      shouldPause: true,
      newStatus: 'paused_payment_claimed',
      promisedDate: null,
      resumeAt: null,
      matchedPhrase: paymentClaimedMatch[0],
      explanation: 'Client reported that payment has already been submitted. Automated chasing paused pending verification.',
      suggestedDraftReply: 'Thanks for letting me know! I have paused all automated reminders while I verify the transfer on my end.',
    };
  }

  // 2. Explicit refusal / negation ("will not pay", "won't pay", "cannot pay")
  const refusalMatch = lower.match(
    /\b(?:will\s+not\s+pay|won'?t\s+pay|cannot\s+pay|can'?t\s+pay|refuse\s+to\s+pay|not\s+paying|hold(?:ing)?\s+payment|not\s+approved)\b/
  );
  if (refusalMatch) {
    return {
      intent: 'DISPUTE_OR_QUESTION',
      confidence: 0.95,
      shouldPause: true,
      newStatus: 'paused_dispute',
      promisedDate: null,
      resumeAt: null,
      matchedPhrase: refusalMatch[0],
      explanation: 'Client expressed a payment hold or refusal. Sequence immediately paused to avoid damaging the relationship.',
      suggestedDraftReply: 'Understood—I have paused all reminders right away. Let me know what needs to be resolved so we can sort this out together.',
    };
  }

  // 3. Out of Office / Auto-responder
  const oooMatch = lower.match(
    /\b(?:out\s+of\s+(?:the\s+)?office|ooo\b|automatic\s+reply|auto-?reply|annual\s+leave|on\s+vacation|on\s+holiday|away\s+(?:from\s+desk\s+)?until|returning\s+on|back\s+in\s+(?:the\s+)?office)\b/
  );
  if (oooMatch) {
    const returnDate = extractDateFromText(text, receivedAtIso);
    const promisedDate = returnDate?.date ?? null;
    const resumeAt = promisedDate
      ? addDaysYmd(promisedDate, 1)
      : addDaysYmd(getBaseUtcDate(receivedAtIso).ymd, 3);
    return {
      intent: 'OUT_OF_OFFICE',
      confidence: 0.93,
      shouldPause: true,
      newStatus: 'paused_ooo',
      promisedDate,
      resumeAt,
      matchedPhrase: returnDate ? `${oooMatch[0]} (${returnDate.matchedPhrase})` : oooMatch[0],
      explanation: promisedDate
        ? `Out-of-office auto-reply detected. Paused until ${resumeAt} (1 day after return on ${promisedDate}).`
        : `Out-of-office auto-reply detected. Paused for 3 days until ${resumeAt}.`,
      suggestedDraftReply: 'No rush at all—enjoy your time away. I will follow back up once you are back in the office.',
    };
  }

  // 4. Informal dispute / invoice question / PO blocker
  const disputeMatch = lower.match(
    /\b(?:dispute|incorrect|overcharg(?:ed|ing)|wrong\s+(?:hours|amount|total|rate|number)|billed\s+(?:for\s+)?\d+|instead\s+of|error\s+on|missing\s+po|purchase\s+order|need\s+(?:an?\s+)?updated\s+(?:pdf|invoice)|credit\s+note|never\s+received|didn'?t\s+receive|can\s+you\s+check|please\s+check|line\s+\d+|discrepancy)\b/
  );
  if (disputeMatch) {
    return {
      intent: 'DISPUTE_OR_QUESTION',
      confidence: 0.91,
      shouldPause: true,
      newStatus: 'paused_dispute',
      promisedDate: null,
      resumeAt: null,
      matchedPhrase: disputeMatch[0],
      explanation: 'Informal dispute or billing question detected. Automated escalations paused so you can resolve this personally.',
      suggestedDraftReply: 'Thanks for flagging this! I have paused automated reminders while I double-check the line items and get right back to you.',
    };
  }

  // 5. Promise-to-Pay detection
  const extractedDate = extractDateFromText(text, receivedAtIso);
  const promiseVerbMatch = lower.match(
    /\b(?:will\s+(?:process|pay|settle|remit|send|transfer|clear|handle)|processing\s+(?:this|it|payment)|queued\s+(?:for|to\s+pay)|scheduled\s+(?:for|to\s+pay)|approved\s+for\s+(?:our|payment)|pay\s+run|payment\s+batch|settle\s+this|remit\s+(?:on|by)|clearing\s+(?:on|by)|i'?ll\s+(?:pay|process|send|handle)|we'?ll\s+(?:pay|process|send|settle))\b/
  );

  if (promiseVerbMatch || (extractedDate && /\b(?:pay|payment|invoice|process|ap\b|accounts\s+payable|check|cheque|wire|ach|transfer|funds|batch)\b/.test(lower))) {
    const promisedDate = extractedDate?.date ?? addDaysYmd(getBaseUtcDate(receivedAtIso).ymd, 5);
    const resumeAt = addDaysYmd(promisedDate, 1);
    const phrase = [promiseVerbMatch?.[0], extractedDate?.matchedPhrase].filter(Boolean).join(' · ') || 'payment commitment';
    const confidence = promiseVerbMatch && extractedDate ? 0.96 : extractedDate ? 0.87 : 0.81;

    return {
      intent: 'PROMISE_TO_PAY',
      confidence,
      shouldPause: true,
      newStatus: 'paused_promise',
      promisedDate,
      resumeAt,
      matchedPhrase: phrase,
      explanation: extractedDate
        ? `Promise-to-pay detected for ${promisedDate}. Sequence automatically paused with 1-day grace until ${resumeAt}.`
        : `Payment commitment detected with no exact date. Sequence paused for 5 days until ${resumeAt}.`,
      suggestedDraftReply: `Thanks for the update! I've noted ${promisedDate} and paused automated follow-ups on this invoice.`,
    };
  }

  // 6. Simple polite acknowledgement without promise or dispute
  const ackMatch = lower.match(/\b(?:got\s+it|received|thank\s+you|thanks|noted|cheers)\b/);
  if (ackMatch) {
    return {
      intent: 'GENERAL_ACK',
      confidence: 0.72,
      shouldPause: false,
      newStatus: null,
      promisedDate: null,
      resumeAt: null,
      matchedPhrase: ackMatch[0],
      explanation: 'Polite acknowledgement with no specific payment date or dispute. Cadence remains active.',
      suggestedDraftReply: 'Thank you! Feel free to reply with an expected payment date anytime and I will pause reminders.',
    };
  }

  return {
    intent: 'NONE',
    confidence: 0.4,
    shouldPause: false,
    newStatus: null,
    promisedDate: null,
    resumeAt: null,
    matchedPhrase: null,
    explanation: 'No promise-to-pay date, dispute, or payment claim detected.',
    suggestedDraftReply: 'Thanks for your message. Let me know when this is scheduled for payment or if you need anything updated.',
  };
}
