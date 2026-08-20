import type { Quotation } from '@/types';

// ---------------------------------------------------------------------------
// Derived business timestamps for the List of Quotations + detail drawer.
//
// These are deliberately NOT generic created/updated fields. They model two
// distinct customer-facing moments the PM asked to surface:
//
//   First Inquiry Date    — when the original customer inquiry / RFQ enquiry
//                           first arrived and was logged.
//   Latest Quote Sent     — when the most recent quotation version was
//                           successfully sent to the customer.
// ---------------------------------------------------------------------------

// The RFQ enquiry that opened this quotation — the earliest inquiry timestamp.
// The seed data records it as the first activity event ("Quotation created —
// From RFQ enquiry"); fall back to the createdDate at the standard intake time
// when no such event exists.
export function firstInquiryAt(q: Quotation): string {
  const intake = q.activity.find(
    (a) => /created/i.test(a.action) || /enquiry|inquiry|rfq/i.test(a.detail ?? '')
  );
  if (intake?.date) return intake.date;
  return q.createdDate ? `${q.createdDate}T09:15:00` : '';
}

// The latest version actually sent to the customer. Prefer the immutable
// version history (a revised quote is saved as a new sent version); fall back
// to the quotation's own send timestamp. Returns null when nothing was ever
// sent, so callers can render "—".
export function latestQuoteSubmittedAt(q: Quotation): string | null {
  const sentVersions = (q.quoteVersions ?? []).filter((v) => v.sent && v.sentAt);
  if (sentVersions.length > 0) {
    return sentVersions.reduce((latest, v) =>
      new Date(v.sentAt!).getTime() > new Date(latest.sentAt!).getTime() ? v : latest
    ).sentAt!;
  }
  return q.sentAt ?? null;
}
