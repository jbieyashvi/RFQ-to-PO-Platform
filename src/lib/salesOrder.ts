// ---------------------------------------------------------------------------
// The single Sales Order resolver. Given a stored SalesOrder plus the masters
// it needs (parties, offices), it produces ONE fully-populated view model with
// all ten Sales Order Acknowledgement sections. Every display surface — the
// View drawer, the in-app previews, the email attachment preview and the ERP
// Handoff view — renders from this resolver, so the same SO always shows
// identical values everywhere. Stored structured fields win; where a record
// omits them (older/seed/PO-verified records) the block is derived from the
// flat fields + masters so nothing is ever blank that shouldn't be.
// ---------------------------------------------------------------------------
import type {
  DeliveryScheduleRow,
  Item,
  ItemTechnical,
  LineItem,
  Party,
  SalesOrder,
  SoContact,
  SoPartyDetails,
  SoSalesperson,
} from '@/types';
import { COMPANY, type CompanyConfig } from '@/lib/company';
import { COMPANY_DOMAIN } from '@/lib/brand';
import { officeName } from '@/data/offices';
import { computeTotals, formatDate, formatINR, amountInWords, lineTotal } from '@/lib/format';
import { formatPaymentTerms } from '@/lib/commercialTerms';
import { defaultItemTechnical } from '@/lib/technicalSpecs';
import { USERS } from '@/data/users';

// Indian GST state codes (first two GSTIN digits) → state name, for display and
// the intra vs inter-state tax split.
const GST_STATE_CODES: Record<string, string> = {
  '01': 'Jammu & Kashmir', '02': 'Himachal Pradesh', '03': 'Punjab', '04': 'Chandigarh',
  '05': 'Uttarakhand', '06': 'Haryana', '07': 'Delhi', '08': 'Rajasthan', '09': 'Uttar Pradesh',
  '10': 'Bihar', '11': 'Sikkim', '12': 'Arunachal Pradesh', '13': 'Nagaland', '14': 'Manipur',
  '15': 'Mizoram', '16': 'Tripura', '17': 'Meghalaya', '18': 'Assam', '19': 'West Bengal',
  '20': 'Jharkhand', '21': 'Odisha', '22': 'Chhattisgarh', '23': 'Madhya Pradesh', '24': 'Gujarat',
  '25': 'Daman & Diu', '26': 'Dadra & Nagar Haveli', '27': 'Maharashtra', '28': 'Andhra Pradesh',
  '29': 'Karnataka', '30': 'Goa', '31': 'Lakshadweep', '32': 'Kerala', '33': 'Tamil Nadu',
  '34': 'Puducherry', '35': 'Andaman & Nicobar', '36': 'Telangana', '37': 'Andhra Pradesh',
};

function stateFromGstin(gstin?: string): string | undefined {
  if (!gstin || gstin.length < 2) return undefined;
  return GST_STATE_CODES[gstin.slice(0, 2)];
}

const nonEmpty = (v?: string): v is string => typeof v === 'string' && v.trim() !== '';

export interface ResolvedItem extends LineItem {
  no: number;
  name: string;
  technical: ItemTechnical;
  hasTechnical: boolean;
  schedule: DeliveryScheduleRow[];
  amount: number; // line total after discount, before tax
}

export interface ResolvedAmountSummary {
  totalQty: number;
  basic: number;
  discount: number;
  subtotal: number;
  taxable: number;
  interState: boolean;
  cgst: number;
  sgst: number;
  igst: number;
  taxTotal: number;
  packing: number;
  grandTotal: number;
  amountInWords: string;
}

export interface ResolvedCommercial {
  packing: string;
  deliveryTerms?: string;
  deliveryTimeline?: string;
  expectedDeliveryDate?: string;
  paymentTerms: string;
  warranty?: string;
  creditDays?: number;
  freight?: string;
  inspection?: string;
  additionalTerms?: string;
}

export interface ResolvedSalesOrder {
  raw: SalesOrder;
  soNumber: string;
  soDate: string;
  revisionNumber: number;
  revisionLabel: string;
  poNumber: string;
  poDate: string;
  quotationNumber?: string;
  buyer: SoPartyDetails;
  consignee: SoPartyDetails;
  consigneeSameAsBuyer: boolean;
  kindAttention?: SoContact;
  salesperson: SoSalesperson;
  officeName: string;
  items: ResolvedItem[];
  commercial: ResolvedCommercial;
  amount: ResolvedAmountSummary;
  company: CompanyConfig;
}

export interface ResolveContext {
  parties: Party[];
  catalog: Item[];
}

// Stored per-item technical block wins; otherwise synthesise the shared block
// from the Item Master (identical builder the Create SO editor prefills with).
function technicalForLine(line: LineItem, catalog: Item[]): ItemTechnical {
  if (line.technical) return line.technical;
  return defaultItemTechnical(line, catalog);
}

// True when any displayable technical field carries a value.
function hasTechnical(t: ItemTechnical): boolean {
  const strings: (string | undefined)[] = [
    t.make, t.product, t.service, t.operatingPressure, t.operatingTemperature, t.density,
    t.decodificationNo, t.modelNo, t.lineSize, t.cToC, t.wettedPartsMOC, t.processConnectionType,
    t.processConnectionMOC, t.processConnectionStd, t.cagingType, t.cageMOC, t.scaleMOC,
    t.glandMOC, t.floatType, t.flangeType, t.valveBodyMOC,
  ];
  if (strings.some(nonEmpty)) return true;
  const lists = [t.specs, t.documents, t.accessories, t.otherDetails];
  return lists.some((l) => (l ?? []).some((r) => nonEmpty(r.value)));
}

function scheduleForLine(line: LineItem, deliveryDate: string): DeliveryScheduleRow[] {
  if (line.schedule && line.schedule.length) return line.schedule;
  return [
    {
      id: `${line.id}-sch-1`,
      scheduleNo: 1,
      deliveryDate: deliveryDate || undefined,
      expectedArrivalDate: deliveryDate || undefined,
      scheduledQty: line.quantity,
      pendingQty: line.quantity,
    },
  ];
}

function resolveBuyer(so: SalesOrder, party?: Party): SoPartyDetails {
  if (so.buyer) return so.buyer;
  const gstin = party?.gstin;
  return {
    name: so.customerName,
    code: so.customerCode,
    address: so.billingAddress || party?.billingAddress || '',
    pincode: so.pincode,
    country: 'India',
    state: stateFromGstin(gstin),
    phone: so.customerPhone || party?.phone,
    email: so.customerEmail || party?.email,
    gstin,
  };
}

function resolveConsignee(so: SalesOrder, buyer: SoPartyDetails, party?: Party): {
  consignee: SoPartyDetails;
  same: boolean;
} {
  if (so.consignee) {
    return { consignee: so.consignee, same: !!so.consigneeSameAsBuyer };
  }
  const shipping = so.shippingAddress || party?.shippingAddress || '';
  const same =
    so.consigneeSameAsBuyer === true ||
    !nonEmpty(shipping) ||
    shipping.trim() === buyer.address.trim();
  if (same) return { consignee: { ...buyer }, same: true };
  return {
    consignee: {
      name: buyer.name,
      address: shipping,
      country: 'India',
      state: buyer.state,
      gstin: buyer.gstin,
    },
    same: false,
  };
}

function resolveSalesperson(so: SalesOrder): SoSalesperson {
  if (so.salesperson) return so.salesperson;
  const owner = so.owner || '';
  // Prefer the real contact from the user directory (Sales Office Master); fall
  // back to a derived email so the block is never blank.
  const user = USERS.find((u) => u.fullName === owner);
  const slug = owner.toLowerCase().replace(/[^a-z]+/g, '.').replace(/^\.|\.$/g, '');
  return {
    name: owner,
    phone: user?.phone,
    email: user?.email ?? (slug ? `${slug}@${COMPANY_DOMAIN}` : undefined),
    officeId: so.officeId,
    owner,
  };
}

function resolveKindAttention(so: SalesOrder): SoContact | undefined {
  if (so.kindAttention) return so.kindAttention;
  if (nonEmpty(so.kindAttentionName) || nonEmpty(so.kindAttentionEmail)) {
    return { name: so.kindAttentionName, email: so.kindAttentionEmail };
  }
  return undefined;
}

function resolveCommercial(so: SalesOrder, totals: ReturnType<typeof computeTotals>): ResolvedCommercial {
  const pct =
    so.commercials?.packingPct ??
    (totals.taxable > 0 ? Math.round((so.packingCharges / totals.taxable) * 100) : 0);
  const packing = so.packingCharges > 0 ? `${pct}% · ${formatINR(so.packingCharges)}` : `${pct}%`;
  const paymentTerms = so.commercials?.payment
    ? formatPaymentTerms(so.commercials.payment)
    : so.paymentTerms || '—';
  const creditDays = so.commercials?.creditDays;
  return {
    packing,
    deliveryTerms: so.deliveryTerms || undefined,
    deliveryTimeline: so.deliveryTimeline,
    expectedDeliveryDate: so.expectedDeliveryDate || so.deliveryDate || undefined,
    paymentTerms,
    warranty: so.warranty || undefined,
    creditDays: creditDays && creditDays > 0 ? creditDays : undefined,
    freight: so.freight,
    inspection: so.inspection,
    additionalTerms: so.additionalTerms,
  };
}

function resolveAmount(so: SalesOrder, buyer: SoPartyDetails): ResolvedAmountSummary {
  const totals = computeTotals(so.items, so.packingCharges);
  const totalQty = so.items.reduce((n, it) => n + it.quantity, 0);
  // CGST/SGST vs IGST is decided from the same buyer GSTIN the Buyer Details
  // section displays (structured buyer, else the party-master GSTIN resolved
  // into `buyer`). Falling back to only so.buyer would wrongly force intra-state
  // for records that carry the GSTIN via the Party Master.
  const buyerStateCode = (buyer.gstin ?? '').slice(0, 2);
  const companyStateCode = COMPANY.gstin.slice(0, 2);
  const interState = buyerStateCode !== '' && buyerStateCode !== companyStateCode;
  return {
    totalQty,
    basic: totals.subtotal,
    discount: totals.discount,
    subtotal: totals.taxable,
    taxable: totals.taxable,
    interState,
    cgst: interState ? 0 : totals.tax / 2,
    sgst: interState ? 0 : totals.tax / 2,
    igst: interState ? totals.tax : 0,
    taxTotal: totals.tax,
    packing: totals.packingCharges,
    grandTotal: totals.grandTotal,
    amountInWords: amountInWords(totals.grandTotal),
  };
}

export function resolveSalesOrder(so: SalesOrder, ctx: ResolveContext): ResolvedSalesOrder {
  const party = ctx.parties.find((p) => p.id === so.partyId);
  const buyer = resolveBuyer(so, party);
  const { consignee, same } = resolveConsignee(so, buyer, party);
  const totals = computeTotals(so.items, so.packingCharges);

  const items: ResolvedItem[] = so.items.map((line, idx) => {
    const technical = technicalForLine(line, ctx.catalog);
    const catItem = ctx.catalog.find((c) => c.id === line.itemId);
    return {
      ...line,
      no: idx + 1,
      name: line.itemName || catItem?.name || line.description,
      technical,
      hasTechnical: hasTechnical(technical),
      schedule: scheduleForLine(line, so.deliveryDate),
      amount: lineTotal(line.quantity, line.unitPrice, line.discountPct),
    };
  });

  const revisionNumber = so.revisionNumber ?? 0;

  return {
    raw: so,
    soNumber: so.number,
    soDate: so.createdDate,
    revisionNumber,
    revisionLabel: revisionNumber > 0 ? `Rev ${revisionNumber}` : 'Original',
    poNumber: so.poNumber,
    poDate: so.poDate,
    quotationNumber: so.quotationNumber,
    buyer,
    consignee,
    consigneeSameAsBuyer: same,
    kindAttention: resolveKindAttention(so),
    salesperson: resolveSalesperson(so),
    officeName: officeName(so.officeId),
    items,
    commercial: resolveCommercial(so, totals),
    amount: resolveAmount(so, buyer),
    company: COMPANY,
  };
}

// Plain-text Sales Order document — used by the "Download SO" action so every
// surface exports the same structured content. Kept text-only (no PDF).
export function salesOrderText(r: ResolvedSalesOrder): string {
  const L: string[] = [];
  L.push(r.company.legalName);
  L.push('SALES ORDER ACKNOWLEDGEMENT');
  L.push('');
  L.push(`SO No: ${r.soNumber}   Date: ${formatDate(r.soDate)}   ${r.revisionLabel}`);
  L.push(`Customer PO: ${r.poNumber} (${formatDate(r.poDate)})`);
  if (r.quotationNumber) L.push(`Linked Quotation: ${r.quotationNumber}`);
  L.push('');
  L.push(`Buyer: ${r.buyer.name ?? ''}${r.buyer.gstin ? `  GSTIN ${r.buyer.gstin}` : ''}`);
  L.push(r.buyer.address);
  L.push('');
  L.push('Items:');
  r.items.forEach((it) => {
    L.push(
      `  ${it.no}. ${it.name} [${it.itemCode}] HSN ${it.hsnCode}  ${it.quantity} ${it.unit} @ ${formatINR(it.unitPrice)} = ${formatINR(it.amount)}`
    );
  });
  L.push('');
  L.push(`Taxable Value: ${formatINR(r.amount.taxable)}`);
  if (r.amount.interState) {
    L.push(`IGST: ${formatINR(r.amount.igst)}`);
  } else {
    L.push(`CGST: ${formatINR(r.amount.cgst)}   SGST: ${formatINR(r.amount.sgst)}`);
  }
  if (r.amount.packing > 0) L.push(`Packing & Forwarding: ${formatINR(r.amount.packing)}`);
  L.push(`Grand Total: ${formatINR(r.amount.grandTotal)}`);
  L.push(r.amount.amountInWords);
  return L.join('\n');
}
