import type { InboxEmail, LineItem, Quotation, SalesOrder } from '@/types';
import { ITEMS } from '@/data/masters';
import { inquiryIdOfEmail } from '@/lib/inquiry';
import type { Domain } from '@/lib/requirementFields';
import { FIELD_BY_KEY, FIELD_SPECS, REQUIRED_FIELDS, fieldLabel, missingKeysOf, validateFields } from '@/lib/requirementFields';

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
// This module expands those rows into per-line requirements, fills in the
// datasheet the AI could read off the enquiry, and scores each line: the tag it
// serves, the quantity, how confident the extraction is, which required fields
// are still missing and which stated values cannot be true. Nothing here is
// random — everything derives from the email's own id, its classification
// confidence and the quality of its extraction rows, so the same email always
// reads the same way.
//
// A human's own corrections (made in the line-item detail drawer) live on the
// email as `requirementEdits` / `requirementConfirmed` and are layered on top
// here. That keeps the derivation pure while letting a saved datasheet move the
// card, the missing count and the overall accuracy with it.
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
  /** Which datasheet this line is read against. */
  domain: Domain;
  /** Instrument type / model as read — shown in the detail drawer's header. */
  instrumentType: string;
  quantity: number | null; // null when the enquiry's quantity could not be read
  unit: string;
  quantityRaw: string;
  confidence: number; // 0–100
  /** The whole datasheet. An empty string means the enquiry never stated it. */
  fields: Record<string, string>;
  /** Required field keys the enquiry never stated. */
  missingKeys: string[];
  /** Those keys as datasheet labels — the gap before this line can be quoted. */
  missingFields: string[];
  /** Field key → why a STATED value cannot stand. Empty fields never appear. */
  invalid: Record<string, string>;
  status: RequirementStatus;
  /** Why the line cannot be quoted as it stands (error lines only). */
  errorNote?: string;
  /** A human has edited this line's datasheet. */
  edited: boolean;
  /** A human has explicitly confirmed this line. */
  confirmedByUser: boolean;
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

// Why a line failed to read. Each of these has to stay consistent with the
// contradiction the failure leaves behind in the datasheet — the note explains
// the red field below it, it does not claim some other fact.
const EXTRACTION_ERRORS = [
  'Specification block unreadable — the enquiry attachment could not be parsed',
  'Conflicting figures between the enquiry body and its annexure',
  'Range read back inconsistently — the stated minimum is above the maximum',
  'Enquiry wording too ambiguous to read this line with confidence',
];

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

/** A plausible maximum flow, used when a line has to carry a contradiction but
 *  the enquiry never stated a flow at all. */
function flowFallback(seed: number): number {
  return 40 + (seed % 18) * 10;
}

function pick<T>(pool: T[], seed: number): T {
  return pool[Math.abs(seed) % pool.length];
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

// ---------------------------------------------------------------------------
// The datasheet the AI read off the enquiry
// ---------------------------------------------------------------------------

/**
 * Fields that make no sense for a kind of line, and are therefore left blank
 * without ever being counted against it — an MCCB has no viscosity, a drum of
 * lubricant has no electrodes.
 */
const NOT_APPLICABLE: Record<Domain, string[]> = {
  instrument: [],
  mechanical: ['electrodeMaterial', 'measuringTubeMaterial', 'conductiveFluid'],
  electrical: [
    'phase',
    'fluidDensity',
    'fluidViscosity',
    'specificGravity',
    'flowUnit',
    'flowMin',
    'flowNormal',
    'flowMax',
    'pressureUnit',
    'pressMin',
    'pressMax',
    'designPressure',
    'testPressure',
    'corrosionRate',
    'lineSize',
    'connectionMoc',
    'connectionStandard',
    'floatMoc',
    'linerMaterial',
    'electrodeMaterial',
    'flowTubeMoc',
    'measuringTubeMaterial',
    'conductiveFluid',
    'requiredAccuracy',
    'fluidCorrosive',
    'fluidAbrasive',
    'fluidToxic',
    'fluidFlammable',
    'fluidScaling',
  ],
  bulk: [
    'phase',
    'flowUnit',
    'flowMin',
    'flowNormal',
    'flowMax',
    'pressureUnit',
    'pressMin',
    'pressMax',
    'designPressure',
    'testPressure',
    'lineSize',
    'connectionSize',
    'connectionType',
    'connectionStandard',
    'connectionMoc',
    'areaClassification',
    'bodyMoc',
    'floatMoc',
    'linerMaterial',
    'electrodeMaterial',
    'flowTubeMoc',
    'measuringTubeMaterial',
    'conductiveFluid',
    'requiredAccuracy',
  ],
};

const MODELS: Record<Domain, string[]> = {
  instrument: [
    'Flanged electromagnetic, remote transmitter',
    'Wafer-type electromagnetic, integral transmitter',
    'Guided-wave radar, rod probe',
    'Two-wire capacitance type',
    'Vortex shedding, integral display',
    'Variable-area glass tube with limit switch',
  ],
  mechanical: [
    'Cast steel, bolted bonnet, rising stem',
    'Wafer butterfly, lever operated',
    'Pneumatic actuated globe, ON/OFF duty',
    'Centrifugal, back-pull-out, mechanical seal',
  ],
  electrical: [
    'Fixed type, thermal-magnetic release',
    'Withdrawable, microprocessor release',
    'Three-pole, AC-3 duty, screw terminals',
    'Motorised, front-operated',
  ],
  bulk: ['IS 15328 Grade A', 'ISO VG 68', 'Commercial grade, drum pack', 'ASTM A536 Gr 60-40-18'],
};

const SIZES = ['25 NB', '40 NB', '50 NB', '80 NB', '100 NB', '150 NB', '200 NB'];

/**
 * What the AI managed to read off this enquiry line — deterministic per line, so
 * the same enquiry always presents the same datasheet.
 */
function seedFields(
  seed: number,
  domain: Domain,
  base: { name: string; tag: string; service: string; instrumentType: string; quantity: number | null }
): Record<string, string> {
  const isSteam = /steam/i.test(base.service);
  const isGas = /nitrogen|air|gas/i.test(base.service);
  const flowMax = 40 + (seed % 18) * 10;
  const size = pick(SIZES, seed >> 8);

  const fields: Record<string, string> = {
    meterIdentity: `${base.name} — ${base.service}`,
    tag: base.tag,
    instrumentType: base.instrumentType,
    service: base.service,
    quantity: base.quantity === null ? '' : String(base.quantity),

    applicationName: `${base.service} ${pick(['metering', 'monitoring', 'batch control', 'flow totalising'], seed >> 4)}`,
    phase: isSteam ? 'Steam' : isGas ? 'Gas' : 'Liquid',
    fluidDensity: isSteam ? '0.6' : isGas ? '1.2' : String(985 + (seed % 22) * 9),
    fluidViscosity: isSteam || isGas ? '0.02' : ((seed % 30) / 10 + 0.8).toFixed(2),
    specificGravity: isSteam || isGas ? '0.001' : (0.98 + (seed % 26) / 100).toFixed(2),
    flowUnit: isGas ? 'Nm³/h' : isSteam ? 'kg/h' : pick(['m³/h', 'LPM', 'm³/h'], seed >> 5),
    flowMin: String(Math.round(flowMax * 0.1)),
    flowNormal: String(Math.round(flowMax * 0.65)),
    flowMax: String(flowMax),
    pressureUnit: pick(['bar g', 'kg/cm²g'], seed >> 6),
    tempMin: isSteam ? '120' : String((seed % 4) * 5),
    tempMax: isSteam ? '185' : String(45 + (seed % 9) * 5),
    pressMin: String((seed % 3) + 1),
    pressMax: String(6 + (seed % 7)),
    corrosionRate: pick(['< 0.1 mm/year', '< 0.05 mm/year', 'Nil — non-corrosive', '< 0.25 mm/year'], seed >> 7),
    designPressure: String(16 + (seed % 5)),
    testPressure: String(24 + (seed % 5)),
    fluidCorrosive: seed % 5 === 0 ? 'yes' : 'no',
    fluidAbrasive: seed % 7 === 0 ? 'yes' : 'no',
    fluidToxic: seed % 11 === 0 ? 'yes' : 'no',
    fluidFlammable: seed % 9 === 0 ? 'yes' : 'no',
    fluidScaling: seed % 6 === 0 ? 'yes' : 'no',

    lineSize: size,
    connectionSize: size,
    connectionType: pick(['Flanged', 'Wafer', 'Screwed (BSP)', 'Butt-welded'], seed >> 9),
    connectionStandard: pick(['ANSI B16.5', 'ASME B16.5', 'DIN 2501', 'IS 6392'], seed >> 10),
    connectionMoc: pick(['SS 304', 'SS 316', 'CS A105'], seed >> 11),
    connectionRating:
      domain === 'electrical'
        ? pick(['16 kA', '25 kA', '36 kA', '50 kA'], seed >> 12)
        : domain === 'bulk'
        ? pick(['IS 15328 Grade A', 'ISO VG 68'], seed >> 12)
        : pick(['150#', '300#', 'PN16', 'PN25'], seed >> 12),
    areaClassification: pick(
      ['Safe area — IP65', 'Safe area — IP67', 'Weatherproof IP66', 'Zone 1 — Ex d IIC T6', 'Zone 2 — Ex n IIC T6'],
      seed >> 13
    ),
    bodyMoc: domain === 'electrical' ? 'Powder-coated MS' : pick(['SS 304', 'CS A105', 'CF8M'], seed >> 14),
    wettedMoc: pick(['SS 316', 'SS 316L', 'CF8M', 'Hastelloy C-276'], seed >> 15),
    floatMoc: pick(['SS 316', 'SS 316L', 'PP'], seed >> 16),
    linerMaterial: pick(['PTFE', 'PFA', 'Neoprene', 'Hard rubber'], seed >> 17),
    electrodeMaterial: pick(['SS 316L', 'Hastelloy C-276', 'Titanium'], seed >> 18),
    flowTubeMoc: pick(['SS 304', 'SS 316', 'CF8M'], seed >> 19),
    measuringTubeMaterial: pick(['SS 316', 'SS 316L', 'PTFE lined CS'], seed >> 20),
    conductiveFluid: domain === 'instrument' ? 'yes' : '',
    requiredAccuracy: pick(['± 0.5 % of rate', '± 1.0 % of rate', '± 1.5 % of FSD'], seed >> 21),
    output:
      domain === 'electrical'
        ? pick(['240 V AC', '110 V AC', '24 V DC', '415 V AC'], seed >> 22)
        : domain === 'bulk'
        ? pick(['Mill test certificate', 'Batch test certificate', 'MSDS only'], seed >> 22)
        : pick(['4–20 mA HART', '4–20 mA', 'Pulse / frequency', 'Modbus RTU (RS-485)'], seed >> 22),
    accessories: pick(
      [
        'Mating flanges with fasteners, 10 m signal cable',
        'Mounting bracket and sun shade',
        'Calibration certificate, mating flanges',
        '',
      ],
      seed >> 23
    ),
  };

  // Nothing that cannot apply to this kind of line is ever presented as read.
  for (const key of NOT_APPLICABLE[domain]) fields[key] = '';

  // Enquiries are written by people: alongside the required fields they skip,
  // plenty of optional detail is simply never mentioned. Blanking a stable slice
  // of it keeps the datasheet honestly incomplete — and editable.
  FIELD_SPECS.forEach((spec, i) => {
    if (REQUIRED_FIELDS[domain].includes(spec.key)) return;
    if (spec.key === 'tag' || spec.key === 'service' || spec.key === 'quantity') return;
    if ((seed >> (i % 12)) % 3 === 0) fields[spec.key] = '';
  });

  return fields;
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
 * The line-level extraction for an inquiry email, with the human's own saved
 * corrections applied. Returns null when the email carries no requirement at
 * all — there is nothing to score.
 */
export function requirementExtraction(
  email: InboxEmail,
  quotations: Quotation[],
  salesOrders: SalesOrder[]
): RequirementExtraction | null {
  const lines = sourceLines(email, quotations, salesOrders);
  if (!lines.length) return null;

  const edits = email.requirementEdits ?? {};
  const confirmedIds = new Set(email.requirementConfirmed ?? []);

  // The enquiry's own weak spots drag the whole reading down: every extraction
  // row the AI could not fill, or was unsure of, costs the line scores.
  const weakRows = email.extraction.filter((f) => f.confidence === 'low' || f.confidence === 'missing').length;
  const base = email.aiConfidence - weakRows * 16;

  const items: RequirementItem[] = [];
  lines.forEach((line, i) => {
    const lineSeed = hash(`${email.id}#${i}#${line.name}`);
    const match = matchItem(line.name);
    const { quantity, unit } = parseQuantity(line.quantityRaw);
    const domain = domainOf(line.name, match?.category ?? '');
    const name = match?.name ?? line.name;

    // How an instrument enquiry is actually written: a handful of instruments
    // are listed tag by tag, each with its own datasheet, while a large count —
    // and anything bulk or switchgear — stays one line against a tag range.
    // Driven by the ENQUIRY's quantity and never by an edited one, so correcting
    // a quantity can never reshuffle the lines (and the ids edits hang off).
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
      const id = `${email.id}-req-${items.length + 1}`;
      const { tag, service } = tagAndService(line.name, domain, lineSeed, span, perTag ? k : 0);
      const lineQuantity = perTag ? 1 : quantity;
      const instrumentType = pick(MODELS[domain], seed >> 2);

      // How well the AI read THIS line, before anyone touched it.
      const rawConfidence = clamp(base - 26 + (seed % 34), 35, 99);

      // How much of the datasheet the enquiry left unstated, scaled to how well
      // it read: a poor reading skips more of what a quotation needs.
      const seededMissing =
        lineQuantity === null || rawConfidence < 55
          ? 3
          : rawConfidence >= 88
          ? 0
          : rawConfidence >= 78
          ? 1
          : rawConfidence >= 62
          ? 2
          : 3;

      const seeded = seedFields(seed, domain, { name, tag, service, instrumentType, quantity: lineQuantity });
      // Rotate the required pool rather than sampling it, so the fields blanked
      // are always distinct and the count on the card matches the list under it.
      const pool = REQUIRED_FIELDS[domain];
      const from = seed % pool.length;
      for (const key of [...pool.slice(from), ...pool.slice(0, from)].slice(0, seededMissing)) {
        seeded[key] = '';
      }

      // A line the AI could not read carries a contradiction, not just a gap:
      // the enquiry's own figures disagree, which is what the drawer shows red.
      let seedNote: string | undefined;
      if (lineQuantity === null) {
        seedNote = 'Quantity could not be read from the enquiry';
      } else if (rawConfidence < 55) {
        seedNote = pick(EXTRACTION_ERRORS, seed);
        if (domain === 'instrument' || domain === 'mechanical') {
          if (!seeded.flowMax) seeded.flowMax = String(flowFallback(seed));
          seeded.flowMin = String(Number(seeded.flowMax) + 25);
        } else {
          if (!seeded.tempMax) seeded.tempMax = '55';
          seeded.tempMin = String(Number(seeded.tempMax) + 20);
        }
      }

      const edit = edits[id];
      const fields = edit ? { ...seeded, ...edit } : seeded;
      const edited = Boolean(edit);
      const confirmedByUser = confirmedIds.has(id);

      const missingKeys = missingKeysOf(fields, domain);
      const invalid = validateFields(fields, domain);
      const invalidCount = Object.keys(invalid).length;

      // Filling in what the enquiry never stated genuinely improves the reading;
      // a value that cannot be true genuinely damages it.
      const resolved = Math.max(0, seededMissing - missingKeys.length);
      const confidence = clamp(rawConfidence + resolved * 7 - invalidCount * 12, 35, 99);

      let status: RequirementStatus;
      let errorNote: string | undefined;
      if (!edited && seedNote) {
        // Untouched and unreadable — say WHY it could not be read, which is more
        // use than the contradiction that failure left in the datasheet.
        status = 'error';
        errorNote = seedNote;
      } else if (invalidCount > 0) {
        // A stated value that cannot be true outranks a confirmation.
        status = 'error';
        errorNote = Object.values(invalid)[0];
      } else if (confirmedByUser) {
        status = 'confirmed';
      } else if (confidence < 80 || missingKeys.length > 0) {
        // A line is only Confirmed when it reads cleanly AND states every field
        // a quotation needs — an incomplete line still has to be chased.
        status = 'needs_review';
      } else {
        status = 'confirmed';
      }

      items.push({
        id,
        lineNo: items.length + 1,
        name,
        code: match?.code ?? '',
        tag: fields.tag || tag,
        service: fields.service || service,
        domain,
        instrumentType: fields.instrumentType || instrumentType,
        quantity: (fields.quantity ?? '').trim() === '' ? null : Number(fields.quantity),
        unit: perTag ? 'Nos' : unit,
        quantityRaw: line.quantityRaw,
        confidence,
        fields,
        missingKeys,
        missingFields: missingKeys.map((key) => fieldLabel(FIELD_BY_KEY[key], domain)),
        invalid,
        status,
        errorNote,
        edited,
        confirmedByUser,
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
    missingTotal: items.reduce((s, it) => s + it.missingKeys.length, 0),
  };
}
