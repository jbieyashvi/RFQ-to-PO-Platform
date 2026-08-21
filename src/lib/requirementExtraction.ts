import type { InboxEmail, LineItem, Quotation, SalesOrder } from '@/types';
import { ITEMS } from '@/data/masters';
import { inquiryIdOfEmail } from '@/lib/inquiry';

// ---------------------------------------------------------------------------
// AI Requirement Extraction — the line-level reading of an inquiry
// ---------------------------------------------------------------------------
// The inbox already stores WHAT the AI pulled out of an enquiry as flat rows
// (`email.extraction`): one "Products / Items" row and one "Quantity" row, both
// semicolon-separated. That is enough to answer "did we understand the mail",
// but not "can we quote line 3" — which is the question the sales engineer
// actually has in front of an instrument enquiry, where every line is a tagged
// instrument with its own datasheet.
//
// This module expands those rows into per-line requirements and scores each one:
// the tag it serves, the quantity, how confident the extraction is and which
// datasheet fields are still missing. Nothing here is random — everything is
// derived from the email's own id, its classification confidence and the quality
// of its extraction rows, so the same email always reads the same way.
// ---------------------------------------------------------------------------

export type RequirementStatus = 'confirmed' | 'needs_review' | 'error';

export interface RequirementItem {
  id: string;
  lineNo: number;
  /** Item Master name where the line resolves, else the enquiry's own wording. */
  name: string;
  /** Flowtech item code when the line matches the catalogue. */
  code: string;
  /** Instrument tag number, or a tag range when the line covers several units. */
  tag: string;
  /** Service / application the tag sits on. */
  service: string;
  quantity: number | null; // null when the enquiry's quantity could not be read
  unit: string;
  quantityRaw: string;
  confidence: number; // 0–100
  /** Datasheet fields the enquiry never stated — the gap before this can be quoted. */
  missingFields: string[];
  status: RequirementStatus;
  /** Why the line failed to extract (error lines only). */
  errorNote?: string;
}

export interface RequirementExtraction {
  items: RequirementItem[];
  /** Mean line confidence, 0–100. */
  accuracy: number;
  /** Green at 80%+, yellow below it, red as soon as any line failed to extract. */
  state: 'good' | 'review' | 'error';
  confirmed: number;
  needsReview: number;
  errors: number;
  missingTotal: number;
}

// The fields a Flowtech quotation needs before a line can be priced, per kind of
// line — an enquiry that omits them is incomplete however confidently it reads.
// Ordered by how often they are the blocker, so the first missing field on a
// line is the one worth chasing.
const DATASHEET_FIELDS: Record<Domain, string[]> = {
  instrument: [
    'Line size',
    'Process connection',
    'Wetted parts MOC',
    'Operating pressure',
    'Operating temperature',
    'Output signal',
    'Flange rating',
    'Area classification',
  ],
  mechanical: [
    'Line size',
    'End connection',
    'Body MOC',
    'Pressure rating',
    'Operating temperature',
    'Seat / trim material',
  ],
  electrical: [
    'Breaking capacity',
    'Coil / control voltage',
    'Enclosure IP rating',
    'Mounting type',
    'Cable entry size',
    'Duty class',
  ],
  bulk: ['Grade / specification', 'Pack size', 'Batch test certificate', 'Shelf life'],
};

// What a tagged line actually sits on. Kept domain-separate: an instrument tag
// belongs to a process line, an electrical feeder belongs to a board.
const PROCESS_SERVICES = [
  'Cooling water header',
  'Boiler feed line',
  'Nitrogen blanketing line',
  'Raw water inlet',
  'Effluent discharge line',
  'Steam header',
  'Reactor jacket circuit',
  'Storage tank T-104',
  'Compressed air header',
  'DM water transfer line',
];

// Level instruments sit on vessels, not on running lines.
const VESSEL_SERVICES = [
  'Storage tank T-104',
  'Day tank T-201',
  'DM water tank T-302',
  'Condensate receiver',
  'Effluent collection sump',
  'Reactor R-101',
];

const ELECTRICAL_SERVICES = [
  'Compressor feeder',
  'Cooling tower fan feeder',
  'Plant lighting circuit',
  'Utility MCC spare feeder',
  'Process pump feeder',
  'Air handling unit feeder',
];

const EXTRACTION_ERRORS = [
  'Specification block unreadable — the enquiry attachment could not be parsed',
  'Conflicting quantity between the enquiry body and its annexure',
  'No tag number found against this line in the enquiry',
  'Item description too ambiguous to match the Item Master',
];

type Domain = 'instrument' | 'mechanical' | 'electrical' | 'bulk';

/** Which tagging convention a line follows — instruments, rotating/piping
 *  equipment, an electrical feeder, or bulk material that carries no tag. */
function domainOf(name: string, category: string): Domain {
  const n = name.toLowerCase();
  if (/flow\s*meter|flowmeter|rotameter|transmitter|sensor|gauge|switch|analys|thermo|rtd/.test(n)) return 'instrument';
  if (/valve|pump|coupling/.test(n)) return 'mechanical';
  if (/mccb|contactor|cable|panel|plc|hmi|vfd|light|drive/.test(n)) return 'electrical';
  if (category === 'Instrumentation' || category === 'Automation') return 'instrument';
  if (category === 'Mechanical') return 'mechanical';
  if (category === 'Electrical') return 'electrical';
  return 'bulk';
}

/** The ISA-style tag prefix for a tagged line. */
function tagPrefix(name: string, domain: Domain): string {
  const n = name.toLowerCase();
  if (/flow\s*meter|flowmeter|rotameter/.test(n)) return 'FT';
  if (/pressure/.test(n)) return 'PT';
  if (/level/.test(n)) return 'LT';
  if (/temperature|thermo|rtd/.test(n)) return 'TT';
  if (/control valve|actuat/.test(n)) return 'FCV';
  if (/valve/.test(n)) return 'HV';
  if (/pump/.test(n)) return 'P';
  if (/proximity|sensor/.test(n)) return 'ZS';
  return domain === 'mechanical' ? 'ME' : 'AT';
}

/**
 * Tag (or tag range) and the service it sits on, per tagging convention.
 * `offset` picks one tag out of a line that was expanded per tag; `span` covers
 * the whole line in one range when it was not.
 */
function tagAndService(
  name: string,
  domain: Domain,
  seed: number,
  span: number,
  offset = 0
): { tag: string; service: string } {
  if (domain === 'bulk') {
    return { tag: 'Untagged — bulk supply', service: 'General plant stores' };
  }
  if (domain === 'electrical') {
    const board = ['MCC-2', 'PCC-1', 'MCC-4', 'LDB-3'][seed % 4];
    const feeder = 5 + (seed % 20) + offset;
    const tag = span > 1 ? `${board}/F-${pad(feeder)} … F-${pad(feeder + span - 1)}` : `${board}/F-${pad(feeder)}`;
    return { tag, service: ELECTRICAL_SERVICES[((seed >> 3) + offset) % ELECTRICAL_SERVICES.length] };
  }
  const prefix = tagPrefix(name, domain);
  const first = 1201 + (seed % 40) * 2 + offset;
  const tag = span > 1 ? `${prefix}-${first} … ${prefix}-${first + span - 1}` : `${prefix}-${first}`;
  const pool = prefix === 'LT' ? VESSEL_SERVICES : PROCESS_SERVICES;
  return { tag, service: pool[((seed >> 3) + offset) % pool.length] };
}

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

/** Stable 32-bit hash — the seed behind every derived number here. */
function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h);
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

/** "40 Nos" / "6" / "2 Sets" → quantity + unit. Null quantity = unreadable. */
function parseQuantity(raw: string): { quantity: number | null; unit: string } {
  const m = raw.trim().match(/^([\d,.]+)\s*(.*)$/);
  if (!m) return { quantity: null, unit: raw.trim() || 'Nos' };
  const qty = Number(m[1].replace(/,/g, ''));
  if (!Number.isFinite(qty) || qty <= 0) return { quantity: null, unit: m[2].trim() || 'Nos' };
  return { quantity: qty, unit: m[2].trim() || 'Nos' };
}

function splitRow(email: InboxEmail, key: string): string[] {
  const value = email.extraction.find((f) => f.key === key)?.value ?? '';
  return value
    .split(';')
    .map((s) => s.trim())
    .filter(Boolean);
}

/** The catalogue entry a line's wording refers to, when it refers to one. */
function matchItem(name: string) {
  const n = name.toLowerCase();
  return (
    ITEMS.find((it) => it.name.toLowerCase() === n) ??
    ITEMS.find((it) => n.includes(it.name.toLowerCase()) || it.name.toLowerCase().includes(n)) ??
    null
  );
}

interface SourceLine {
  name: string;
  quantityRaw: string;
}

/**
 * The raw requirement lines behind an inquiry, in order of trust: the AI's own
 * "Products / Items" + "Quantity" rows first, and the linked quotation's lines
 * when the mail carried no itemised extraction.
 */
function sourceLines(email: InboxEmail, quotations: Quotation[], salesOrders: SalesOrder[]): SourceLine[] {
  const products = splitRow(email, 'product');
  if (products.length) {
    const quantities = splitRow(email, 'quantity');
    return products.map((name, i) => ({ name, quantityRaw: quantities[i] ?? '' }));
  }
  const inquiryId = inquiryIdOfEmail(email, quotations, salesOrders);
  const lines: LineItem[] = quotations.find((q) => q.id === inquiryId)?.items ?? [];
  return lines.map((l) => ({
    name: l.itemName ?? l.description,
    quantityRaw: `${l.quantity} ${l.unit}`,
  }));
}

/**
 * The line-level extraction for an inquiry email. Returns null when the email
 * carries no requirement at all — there is nothing to score.
 */
export function requirementExtraction(
  email: InboxEmail,
  quotations: Quotation[],
  salesOrders: SalesOrder[]
): RequirementExtraction | null {
  const lines = sourceLines(email, quotations, salesOrders);
  if (!lines.length) return null;

  // The enquiry's own weak spots drag the whole reading down: every extraction
  // row the AI could not fill or was unsure of costs the line scores.
  const weakRows = email.extraction.filter((f) => f.confidence === 'low' || f.confidence === 'missing').length;
  const base = email.aiConfidence - weakRows * 16;

  const items: RequirementItem[] = [];
  lines.forEach((line, i) => {
    const lineSeed = hash(`${email.id}#${i}#${line.name}`);
    const match = matchItem(line.name);
    const { quantity, unit } = parseQuantity(line.quantityRaw);
    const domain = domainOf(line.name, match?.category ?? '');

    // How an instrument enquiry is actually written: a handful of instruments
    // are listed tag by tag, each with its own datasheet, while a large count —
    // and anything bulk or switchgear — stays one line against a tag range.
    const perTag =
      (domain === 'instrument' || domain === 'mechanical') &&
      quantity !== null &&
      quantity >= 2 &&
      quantity <= 8 &&
      unit.toLowerCase() === 'nos';
    const count = perTag ? (quantity as number) : 1;
    const span = !perTag && quantity && quantity > 1 && unit.toLowerCase() === 'nos' ? Math.min(quantity, 12) : 1;

    for (let k = 0; k < count; k++) {
      const seed = perTag ? hash(`${email.id}#${i}#${k}#${line.name}`) : lineSeed;
      const confidence = clamp(base - 26 + (seed % 34), 35, 99);
      const { tag, service } = tagAndService(line.name, domain, lineSeed, span, perTag ? k : 0);

      const missingCount =
        quantity === null || confidence < 55 ? 3 : confidence >= 88 ? 0 : confidence >= 78 ? 1 : confidence >= 62 ? 2 : 3;
      // Rotate the pool rather than sampling it, so the fields named are always
      // distinct and the count on the card matches the list under it.
      const pool = DATASHEET_FIELDS[domain];
      const from = seed % pool.length;
      const missingFields = [...pool.slice(from), ...pool.slice(0, from)].slice(0, missingCount);

      let status: RequirementStatus = 'confirmed';
      let errorNote: string | undefined;
      if (quantity === null) {
        status = 'error';
        errorNote = 'Quantity could not be read from the enquiry';
      } else if (confidence < 55) {
        status = 'error';
        errorNote = EXTRACTION_ERRORS[seed % EXTRACTION_ERRORS.length];
      } else if (confidence < 80 || missingCount > 0) {
        // A line is only Confirmed when it reads cleanly AND states every field
        // a quotation needs — an incomplete line still has to be chased.
        status = 'needs_review';
      }

      items.push({
        id: `${email.id}-req-${items.length + 1}`,
        lineNo: items.length + 1,
        name: match?.name ?? line.name,
        code: match?.code ?? '',
        tag,
        service,
        quantity: perTag ? 1 : quantity,
        unit,
        quantityRaw: line.quantityRaw,
        confidence,
        missingFields,
        status,
        errorNote,
      });
    }
  });

  const errors = items.filter((it) => it.status === 'error').length;
  const needsReview = items.filter((it) => it.status === 'needs_review').length;
  const accuracy = Math.round(items.reduce((s, it) => s + it.confidence, 0) / items.length);

  return {
    items,
    accuracy,
    state: errors > 0 ? 'error' : accuracy >= 80 ? 'good' : 'review',
    confirmed: items.filter((it) => it.status === 'confirmed').length,
    needsReview,
    errors,
    missingTotal: items.reduce((s, it) => s + it.missingFields.length, 0),
  };
}
