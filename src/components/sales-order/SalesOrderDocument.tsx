import { useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { DescList, InfoRow } from '@/components/ui';
import { DocumentLetterhead } from '@/components/DocumentLetterhead';
import { formatDate, formatINR, lineTotal } from '@/lib/format';
import type { ItemTechnical, SoContact, SoPartyDetails } from '@/types';
import type { ResolvedItem, ResolvedSalesOrder } from '@/lib/salesOrder';

// ---------------------------------------------------------------------------
// The single read-only Sales Order Acknowledgement renderer. Consumes a
// ResolvedSalesOrder (from lib/salesOrder) and paints all ten sections, hiding
// any empty optional field. Reused by the List → View drawer, ERP Handoff view,
// the in-app SO previews and the email attachment preview so the same order
// always shows identical values.
// ---------------------------------------------------------------------------

type Row = { label: string; value: React.ReactNode };

function present(rows: unknown[]): Row[] {
  return rows.filter(
    (r): r is Row =>
      typeof r === 'object' && r !== null && (r as Row).value !== '' && (r as Row).value != null
  );
}

export function SoSection({
  index,
  title,
  children,
  action,
}: {
  index: number;
  title: string;
  children: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <section>
      <div className="mb-3 flex items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 text-[13px] font-semibold text-surface-800">
          <span className="flex h-5 w-5 items-center justify-center rounded-full bg-brand-50 text-[11px] font-bold text-brand-700">
            {index}
          </span>
          {title}
        </h3>
        {action}
      </div>
      {children}
    </section>
  );
}

function partyRows(p: SoPartyDetails, gstinLabel = 'GSTIN'): Row[] {
  return present([
    p.name && { label: 'Name', value: p.name },
    p.code && { label: 'Code', value: p.code },
    { label: 'Address', value: p.address },
    p.city && { label: 'City', value: p.city },
    p.state && { label: 'State', value: p.state },
    p.pincode && { label: 'Pincode', value: p.pincode },
    p.country && { label: 'Country', value: p.country },
    p.phone && { label: 'Phone', value: p.phone },
    p.email && { label: 'Email', value: p.email },
    p.gstin && { label: gstinLabel, value: p.gstin },
  ]);
}

function contactRows(c: SoContact): Row[] {
  return present([
    c.name && { label: 'Name', value: c.name },
    c.phone && { label: 'Contact No', value: c.phone },
    c.email && { label: 'Email', value: c.email },
  ]);
}

const TECH_ATTRS: { key: keyof ItemTechnical; label: string }[] = [
  { key: 'make', label: 'Make' },
  { key: 'product', label: 'Product' },
  { key: 'service', label: 'Service / Application' },
  { key: 'operatingPressure', label: 'Operating Pressure' },
  { key: 'operatingTemperature', label: 'Operating Temperature' },
  { key: 'density', label: 'Density' },
  { key: 'decodificationNo', label: 'Decodification No' },
  { key: 'modelNo', label: 'Model No' },
  { key: 'lineSize', label: 'Line Size' },
  { key: 'cToC', label: 'C-to-C Height / Dimensions' },
  { key: 'wettedPartsMOC', label: 'Wetted Parts MOC' },
  { key: 'processConnectionType', label: 'Process Connection Type' },
  { key: 'processConnectionMOC', label: 'Process Connection MOC' },
  { key: 'processConnectionStd', label: 'Process Connection Std' },
  { key: 'cagingType', label: 'Caging Type' },
  { key: 'cageMOC', label: 'Cage MOC' },
  { key: 'scaleMOC', label: 'Scale MOC' },
  { key: 'glandMOC', label: 'Gland MOC' },
  { key: 'floatType', label: 'Float / Flat Type' },
  { key: 'flangeType', label: 'Flange Type' },
  { key: 'valveBodyMOC', label: 'Valve Body MOC' },
];

function technicalRows(t: ItemTechnical): Row[] {
  return present(TECH_ATTRS.map((a) => ({ label: a.label, value: (t[a.key] as string) || '' })));
}

function KeyValueList({ title, rows }: { title: string; rows?: { label: string; value: string }[] }) {
  const present = (rows ?? []).filter((r) => r.value && r.value.trim() !== '');
  if (!present.length) return null;
  return (
    <div>
      <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-surface-400">{title}</p>
      <dl className="space-y-1">
        {present.map((r, i) => (
          <div key={i} className="flex gap-2 text-[12px]">
            <dt className="min-w-[140px] font-medium text-surface-600">{r.label}</dt>
            <dd className="text-surface-800">{r.value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

function TechnicalBlock({ item }: { item: ResolvedItem }) {
  const [open, setOpen] = useState(false);
  if (!item.hasTechnical) return null;
  const attrRows = technicalRows(item.technical);
  return (
    <div className="rounded-lg border border-surface-200">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 px-3 py-2 text-left text-[12px] font-medium text-surface-700 hover:bg-surface-50"
      >
        {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
        <span className="text-surface-400">{item.no}.</span> {item.name}
        <span className="ml-1 rounded-full bg-surface-100 px-1.5 py-0.5 text-[10px] text-surface-500">
          Technical Specifications
        </span>
      </button>
      {open && (
        <div className="space-y-3 border-t border-surface-100 px-3 py-3">
          {attrRows.length > 0 && <DescList items={attrRows} />}
          <KeyValueList title="Technical Specifications" rows={item.technical.specs} />
          <KeyValueList title="Documents Required" rows={item.technical.documents} />
          <KeyValueList title="Accessories" rows={item.technical.accessories} />
          <KeyValueList title="Other Details" rows={item.technical.otherDetails} />
        </div>
      )}
    </div>
  );
}

export function SalesOrderDocument({
  resolved,
  showLetterhead = false,
  showCompany = true,
}: {
  resolved: ResolvedSalesOrder;
  showLetterhead?: boolean;
  showCompany?: boolean;
}) {
  const r = resolved;
  const a = r.amount;

  const docRows = present([
    { label: 'SO Ackn No', value: r.soNumber },
    { label: 'SO Date', value: formatDate(r.soDate) },
    { label: 'Customer PO No', value: r.poNumber },
    { label: 'Customer PO Date', value: formatDate(r.poDate) },
    r.quotationNumber && { label: 'Linked Quotation No', value: r.quotationNumber },
    { label: 'Revision / Version', value: r.revisionLabel },
  ]);

  const spRows = present([
    { label: 'Salesperson', value: r.salesperson.name },
    r.salesperson.phone && { label: 'Contact No', value: r.salesperson.phone },
    r.salesperson.email && { label: 'Email', value: r.salesperson.email },
    { label: 'Sales Office', value: r.officeName },
    { label: 'Owner', value: r.salesperson.owner },
  ]);

  const c = r.commercial;
  const termRows = present([
    { label: 'Packing & Forwarding', value: c.packing },
    c.deliveryTerms && { label: 'Delivery Terms', value: c.deliveryTerms },
    c.deliveryTimeline && { label: 'Delivery Timeline', value: c.deliveryTimeline },
    c.expectedDeliveryDate && { label: 'Expected Delivery Date', value: formatDate(c.expectedDeliveryDate) },
    { label: 'Payment Terms', value: c.paymentTerms },
    c.warranty && { label: 'Warranty', value: c.warranty },
    c.creditDays && { label: 'Credit Days', value: `${c.creditDays} days` },
    c.freight && { label: 'Freight / Transportation', value: c.freight },
    c.inspection && { label: 'Inspection', value: c.inspection },
    c.additionalTerms && { label: 'Additional Commercial Terms', value: c.additionalTerms },
  ]);

  const itemsWithTech = r.items.filter((it) => it.hasTechnical);
  const itemsWithSchedule = r.items.filter((it) => it.schedule.length > 0);

  const bank = r.company.bank;
  const companyRows = present([
    { label: 'Company', value: r.company.legalName },
    { label: 'GST No', value: r.company.gstin },
    { label: 'ARN No', value: r.company.arn },
    { label: 'PAN No', value: r.company.pan },
    { label: 'A/C Holder', value: bank.accountHolder },
    { label: 'Bank Name', value: bank.bankName },
    { label: 'Bank Address', value: bank.bankAddress },
    { label: 'Bank A/C No', value: bank.accountNumber },
    { label: 'IFSC', value: bank.ifsc },
    { label: 'SWIFT', value: bank.swift },
    { label: 'MICR', value: bank.micr },
    { label: 'Authorised Signatory', value: r.company.authorisedSignatory },
  ]);

  let sec = 0;
  const next = () => (sec += 1);

  return (
    <div className="space-y-6">
      {showLetterhead && (
        <DocumentLetterhead
          docTitle="Sales Order Acknowledgement"
          meta={
            <span>
              {r.soNumber} · {formatDate(r.soDate)} · {r.revisionLabel}
            </span>
          }
        />
      )}

      <SoSection index={next()} title="Document Details">
        <DescList items={docRows} />
      </SoSection>

      <SoSection index={next()} title="Buyer Details">
        <DescList items={partyRows(r.buyer)} />
      </SoSection>

      <SoSection
        index={next()}
        title="Consignee Details"
        action={
          r.consigneeSameAsBuyer ? (
            <span className="rounded-full bg-surface-100 px-2 py-0.5 text-[10px] font-medium text-surface-500">
              Same as Buyer's Address
            </span>
          ) : undefined
        }
      >
        <DescList items={partyRows(r.consignee, r.consigneeGstinIsBuyers ? "Buyer's GSTIN" : 'GSTIN')} />
      </SoSection>

      <SoSection index={next()} title="Contact Details">
        <div className="space-y-4">
          {r.kindAttention && (
            <div>
              <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-surface-400">
                Kind Attention
              </p>
              <DescList items={contactRows(r.kindAttention)} />
            </div>
          )}
          <div>
            <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-surface-400">
              Salesperson
            </p>
            <DescList items={spRows} />
          </div>
        </div>
      </SoSection>

      <SoSection index={next()} title="Catalogue Items">
        <div className="overflow-x-auto rounded-xl border border-surface-200">
          <table className="w-full min-w-[760px] border-collapse text-[12px]">
            <thead>
              <tr className="border-b border-surface-200 bg-surface-50 text-[10px] font-semibold uppercase tracking-wide text-surface-500">
                <th className="px-2 py-2 text-left">No.</th>
                <th className="px-2.5 py-2 text-left">Item</th>
                <th className="px-2 py-2 text-left">Code</th>
                <th className="px-2 py-2 text-left">HSN/SAC</th>
                <th className="px-2 py-2 text-right">GST%</th>
                <th className="px-2 py-2 text-left">UOM</th>
                <th className="px-2 py-2 text-right">Qty</th>
                <th className="px-2 py-2 text-right">Rate</th>
                <th className="px-2 py-2 text-right">Disc%</th>
                <th className="px-2.5 py-2 text-right">Amount</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-surface-100">
              {r.items.map((it) => (
                <tr key={it.id}>
                  <td className="px-2 py-2 text-surface-500">{it.no}</td>
                  <td className="px-2.5 py-2 font-medium text-surface-800">{it.name}</td>
                  <td className="px-2 py-2 text-surface-600">{it.itemCode}</td>
                  <td className="px-2 py-2 text-surface-600">{it.hsnCode}</td>
                  <td className="px-2 py-2 text-right">{it.taxPct}%</td>
                  <td className="px-2 py-2 text-surface-600">{it.unit}</td>
                  <td className="px-2 py-2 text-right">{it.quantity}</td>
                  <td className="px-2 py-2 text-right">{formatINR(it.unitPrice)}</td>
                  <td className="px-2 py-2 text-right">{it.discountPct}%</td>
                  <td className="px-2.5 py-2 text-right font-medium text-surface-800">
                    {formatINR(lineTotal(it.quantity, it.unitPrice, it.discountPct))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </SoSection>

      {itemsWithTech.length > 0 && (
        <SoSection index={next()} title="Item Details & Technical Specifications">
          <div className="space-y-2">
            {itemsWithTech.map((it) => (
              <TechnicalBlock key={it.id} item={it} />
            ))}
          </div>
        </SoSection>
      )}

      {itemsWithSchedule.length > 0 && (
        <SoSection index={next()} title="Delivery Schedule">
          <div className="space-y-4">
            {itemsWithSchedule.map((it) => (
              <div key={it.id}>
                <p className="mb-1.5 text-[12px] font-medium text-surface-700">
                  <span className="text-surface-400">{it.no}.</span> {it.name}
                  <span className="ml-2 text-[11px] text-surface-400">Total Qty {it.quantity} {it.unit}</span>
                </p>
                <div className="overflow-x-auto rounded-lg border border-surface-200">
                  <table className="w-full min-w-[520px] border-collapse text-[12px]">
                    <thead>
                      <tr className="border-b border-surface-200 bg-surface-50 text-[10px] font-semibold uppercase tracking-wide text-surface-500">
                        <th className="px-2.5 py-1.5 text-left">Sch. No</th>
                        <th className="px-2 py-1.5 text-left">Delivery Date</th>
                        <th className="px-2 py-1.5 text-left">Expected Arrival</th>
                        <th className="px-2 py-1.5 text-right">Scheduled Qty</th>
                        <th className="px-2.5 py-1.5 text-right">Pending Qty</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-surface-100">
                      {it.schedule.map((s) => (
                        <tr key={s.id}>
                          <td className="px-2.5 py-1.5">{s.scheduleNo}</td>
                          <td className="px-2 py-1.5 text-surface-600">{s.deliveryDate ? formatDate(s.deliveryDate) : '—'}</td>
                          <td className="px-2 py-1.5 text-surface-600">{s.expectedArrivalDate ? formatDate(s.expectedArrivalDate) : '—'}</td>
                          <td className="px-2 py-1.5 text-right">{s.scheduledQty}</td>
                          <td className="px-2.5 py-1.5 text-right">{s.pendingQty ?? s.scheduledQty}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ))}
          </div>
        </SoSection>
      )}

      <SoSection index={next()} title="Commercial Terms">
        <DescList items={termRows} />
      </SoSection>

      <SoSection index={next()} title="Amount Summary">
        <div className="ml-auto max-w-sm space-y-0.5">
          <InfoRow label="Total Quantity" value={a.totalQty} />
          <InfoRow label="Basic Amount" value={formatINR(a.basic)} />
          <InfoRow label="Discount" value={`- ${formatINR(a.discount)}`} />
          <InfoRow label="Subtotal" value={formatINR(a.subtotal)} />
          <InfoRow label="Taxable Value" value={formatINR(a.taxable)} />
          {a.interState ? (
            <InfoRow label="IGST" value={formatINR(a.igst)} />
          ) : (
            <>
              <InfoRow label="CGST" value={formatINR(a.cgst)} />
              <InfoRow label="SGST" value={formatINR(a.sgst)} />
            </>
          )}
          {a.packing > 0 && <InfoRow label="Packing & Forwarding" value={formatINR(a.packing)} />}
          <div className="mt-1.5 flex items-center justify-between border-t-2 border-brand-100 pt-2">
            <span className="text-sm font-semibold text-surface-800">Grand Total</span>
            <span className="text-lg font-bold text-brand-700">{formatINR(a.grandTotal)}</span>
          </div>
          <p className="pt-1.5 text-right text-[11px] italic text-surface-500">{a.amountInWords}</p>
        </div>
      </SoSection>

      {showCompany && (
        <SoSection index={next()} title="Company Details">
          <DescList items={companyRows} />
        </SoSection>
      )}
    </div>
  );
}
