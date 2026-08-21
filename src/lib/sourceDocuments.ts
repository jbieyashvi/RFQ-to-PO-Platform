import type { InboxEmail } from '@/types';
import type { RequirementExtraction, RequirementItem } from '@/lib/requirementExtraction';
import { formatDate } from '@/lib/format';

// ---------------------------------------------------------------------------
// The documents the enquiry arrived as
// ---------------------------------------------------------------------------
// Everywhere else in the workspace the question is "what did the AI read". The
// compare-with-source view asks the other one: "is that actually what the
// customer sent". Answering it needs the enquiry back in the shape it landed
// in — the mail, the requirement schedule, the datasheet annexure — so a value
// on the right can be checked against the page it was read off.
//
// Like the requirement extraction itself, these are DERIVED from the email
// rather than stored: which documents an enquiry carries follows from what it
// actually contains, so a mail with no itemised extraction has only its own
// body to compare against and never grows a schedule out of nowhere.
//
// Nothing here reads `item.fields` — it prints `item.sourceFields`, the reading
// before any human correction. A document that moved when you edited the line
// you were checking against it would be worth nothing.
// ---------------------------------------------------------------------------

export type SourceDocKind = 'mail' | 'schedule' | 'datasheet';

/** One printed sheet, and the requirement lines it carries. */
export interface SourceDocPage {
  itemIds: string[];
}

export interface SourceDocument {
  id: string;
  kind: SourceDocKind;
  /** File name as it arrived — shown in the viewer's toolbar. */
  fileName: string;
  /** Short tab label, for when an enquiry carries several documents. */
  label: string;
  /** The document's own printed heading. */
  title: string;
  /** Plausible file size, deterministic per document. */
  sizeKb: number;
  pages: SourceDocPage[];
}

/** How many lines a printed sheet holds, per kind of document. */
const ROWS_PER_SCHEDULE_PAGE = 12;
const ITEMS_PER_DATASHEET_PAGE = 2;

function chunk(items: RequirementItem[], per: number): SourceDocPage[] {
  const pages: SourceDocPage[] = [];
  for (let i = 0; i < items.length; i += per) {
    pages.push({ itemIds: items.slice(i, i + per).map((it) => it.id) });
  }
  return pages.length ? pages : [{ itemIds: [] }];
}

/** `2026-08-13` → `130826`, the way an enquiry reference is usually stamped. */
function refStamp(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getDate())}${pad(d.getMonth() + 1)}${String(d.getFullYear()).slice(2)}`;
}

/** The customer's own reference for this enquiry, as printed on every sheet. */
export function enquiryRef(email: InboxEmail): string {
  return `${email.customerCode ?? 'ENQ'}/RFQ/${refStamp(email.receivedAt)}`;
}

/**
 * The documents behind one enquiry. The mail is always there; a requirement
 * schedule only when the AI's own reading was itemised (an enquiry whose lines
 * had to be recovered from the linked quotation never carried one), and a
 * datasheet annexure only when some line is tagged equipment with process
 * conditions to state — switchgear and bulk supply are quoted off the schedule.
 */
export function sourceDocuments(email: InboxEmail, extraction: RequirementExtraction): SourceDocument[] {
  const items = extraction.items;
  const docs: SourceDocument[] = [];

  docs.push({
    id: `${email.id}-doc-mail`,
    kind: 'mail',
    fileName: `${enquiryRef(email)}.eml`,
    label: 'Enquiry mail',
    title: 'Request for Quotation',
    sizeKb: 18 + Math.round(email.body.length / 90),
    pages: [{ itemIds: [] }],
  });

  const itemised = (email.extraction.find((f) => f.key === 'product')?.value ?? '').trim() !== '';
  if (itemised) {
    docs.push({
      id: `${email.id}-doc-schedule`,
      kind: 'schedule',
      fileName: `Annexure-I-Requirement-Schedule.pdf`,
      label: 'Requirement schedule',
      title: 'Annexure I — Schedule of Requirement',
      sizeKb: 64 + items.length * 6,
      pages: chunk(items, ROWS_PER_SCHEDULE_PAGE),
    });
  }

  const tagged = items.filter((it) => it.domain === 'instrument' || it.domain === 'mechanical');
  if (tagged.length) {
    docs.push({
      id: `${email.id}-doc-datasheet`,
      kind: 'datasheet',
      fileName: `Annexure-II-Datasheets.pdf`,
      label: 'Datasheets',
      title: 'Annexure II — Technical Datasheet',
      sizeKb: 96 + tagged.length * 21,
      pages: chunk(tagged, ITEMS_PER_DATASHEET_PAGE),
    });
  }

  return docs;
}

/** Total printed sheets across a document — shown beside its file name. */
export function pageLabel(doc: SourceDocument): string {
  return `${doc.pages.length} ${doc.pages.length === 1 ? 'page' : 'pages'} · ${doc.sizeKb} KB`;
}

/** The date line printed on every sheet. */
export function docDate(email: InboxEmail): string {
  return formatDate(email.receivedAt);
}
