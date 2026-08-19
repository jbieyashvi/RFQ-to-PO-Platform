import { useNavigate } from 'react-router-dom';
import { Download, Building2, User, CalendarDays, ExternalLink } from 'lucide-react';
import type { SalesOrder, PaymentTerms } from '@/types';
import { Drawer, Button, DescList, InfoRow } from '@/components/ui';
import { useApp } from '@/context/AppContext';
import { officeName } from '@/data/offices';
import { computeTotals, downloadText, formatDate, formatINR, lineTotal } from '@/lib/format';
import { COMPANY_NAME } from '@/lib/brand';

// Spec-aligned labels for the four payment buckets (mirrors Create SO Manually).
const PAYMENT_LABEL: Record<keyof PaymentTerms, string> = {
  advance: 'Advance %',
  beforeDispatch: 'Before Dispatch %',
  creditDays: 'Credit %',
  afterInstall: 'After Installation %',
};

const PO_PROOF_LABEL: Record<string, string> = {
  uploaded: 'PO Document',
  phone_call: 'Phone Call',
  message: 'Message / WhatsApp',
};

type Row = { label: string; value: React.ReactNode };

// Keep only rows whose value is present — hides empty optional fields.
function present(rows: unknown[]): Row[] {
  return rows.filter(
    (r): r is Row =>
      typeof r === 'object' && r !== null && (r as Row).value !== '' && (r as Row).value != null
  );
}

function Section({ index, title, children }: { index: number; title: string; children: React.ReactNode }) {
  return (
    <section>
      <h3 className="mb-3 flex items-center gap-2 text-[13px] font-semibold text-surface-800">
        <span className="flex h-5 w-5 items-center justify-center rounded-full bg-brand-50 text-[11px] font-bold text-brand-700">
          {index}
        </span>
        {title}
      </h3>
      {children}
    </section>
  );
}

export function SalesOrderDetailsDrawer({
  order,
  onClose,
}: {
  order: SalesOrder | null;
  onClose: () => void;
}) {
  const { addToast, parties } = useApp();
  const navigate = useNavigate();
  if (!order) return null;
  const so = order;
  const totals = computeTotals(so.items, so.packingCharges);
  const party = parties.find((p) => p.id === so.partyId);
  const gstin = party?.gstin ?? '';
  const pendingHandoff = so.erpHandoff?.state === 'pending';

  const packingPct =
    so.commercials?.packingPct ??
    (totals.taxable > 0 ? Math.round((so.packingCharges / totals.taxable) * 100) : 0);

  const download = () => {
    downloadText(
      `${so.number.replace(/\//g, '-')}.txt`,
      `${COMPANY_NAME}\nSALES ORDER ACKNOWLEDGEMENT\n\n${so.number}\nPO: ${so.poNumber} (${formatDate(so.poDate)})\nCustomer: ${so.customerName} (${so.customerCode})\nSales Office: ${officeName(so.officeId)}\nOwner: ${so.owner}\nValue: ${formatINR(so.value)}\n\nItems:\n${so.items
        .map((it) => `- ${it.itemCode} ${it.description} x${it.quantity} @ ${formatINR(it.unitPrice)}`)
        .join('\n')}`
    );
    addToast({ type: 'success', title: 'Download started', message: `${so.number} exported.` });
  };

  const clientRows = present([
    { label: 'Customer / Party', value: so.customerName },
    { label: 'Customer Code', value: so.customerCode },
    so.customerPhone && { label: 'Phone', value: so.customerPhone },
    so.customerEmail && { label: 'Email', value: so.customerEmail },
    gstin && { label: 'GSTIN', value: gstin },
    so.pincode && { label: 'Pincode', value: so.pincode },
    { label: 'Billing Address', value: so.billingAddress },
    { label: 'Shipping Address', value: so.shippingAddress },
    so.kindAttentionName && { label: 'Kind Attention — Name', value: so.kindAttentionName },
    so.kindAttentionEmail && { label: 'Kind Attention — Email', value: so.kindAttentionEmail },
  ]);

  const orderRows = present([
    { label: 'PO Number', value: so.poNumber },
    { label: 'PO Date', value: formatDate(so.poDate) },
    so.quotationNumber && { label: 'Linked Quotation', value: so.quotationNumber },
    { label: 'Sales Office', value: officeName(so.officeId) },
    { label: 'Owner / Sales Person', value: so.owner },
    so.officeAdmin && { label: 'Office Admin', value: so.officeAdmin },
    so.poProofType && { label: 'PO Proof Type', value: PO_PROOF_LABEL[so.poProofType] ?? so.poProofType },
    so.poProofNotes && { label: 'PO Document Reference & Notes', value: so.poProofNotes },
  ]);

  const pay = so.commercials?.payment;
  const termRows = present([
    { label: 'Packing %', value: `${packingPct}%` },
    so.deliveryTerms && { label: 'Delivery Terms', value: so.deliveryTerms },
    so.deliveryDate && { label: 'Expected Delivery Date', value: formatDate(so.deliveryDate) },
    so.warranty && { label: 'Warranty', value: so.warranty },
    ...(pay
      ? ([
          { label: PAYMENT_LABEL.advance, value: `${pay.advance}%` },
          { label: PAYMENT_LABEL.beforeDispatch, value: `${pay.beforeDispatch}%` },
          { label: PAYMENT_LABEL.creditDays, value: `${pay.creditDays}%` },
          { label: PAYMENT_LABEL.afterInstall, value: `${pay.afterInstall}%` },
          so.commercials && so.commercials.creditDays > 0
            ? { label: 'Credit Days', value: `${so.commercials.creditDays} days` }
            : false,
        ] as (Row | false)[])
      : ([so.paymentTerms && { label: 'Payment Terms', value: so.paymentTerms }] as (Row | false)[])),
  ]);

  return (
    <Drawer
      open={!!order}
      onClose={onClose}
      width="xl"
      title={so.number}
      subtitle={
        <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <span className="font-medium text-surface-700">{so.customerName}</span>
          <span className="flex items-center gap-1"><CalendarDays className="h-3.5 w-3.5" /> {formatDate(so.createdDate)}</span>
          <span className="flex items-center gap-1"><Building2 className="h-3.5 w-3.5" /> {officeName(so.officeId)}</span>
          <span className="flex items-center gap-1"><User className="h-3.5 w-3.5" /> {so.owner}</span>
        </span>
      }
      footer={
        <div className="flex items-center justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>Close</Button>
          {pendingHandoff && (
            <Button variant="secondary" leftIcon={<ExternalLink className="h-4 w-4" />} onClick={() => navigate('/erp-handoff')}>
              View in ERP Handoff
            </Button>
          )}
          <Button variant="primary" leftIcon={<Download className="h-4 w-4" />} onClick={download}>Download SO</Button>
        </div>
      }
    >
      <div className="space-y-6 pt-1">
        <Section index={1} title="Client Details">
          <DescList items={clientRows} />
        </Section>

        <Section index={2} title="Order Details">
          <DescList items={orderRows} />
        </Section>

        <Section index={3} title="Catalogue Items">
          <div className="overflow-x-auto rounded-xl border border-surface-200">
            <table className="w-full min-w-[720px] border-collapse text-[12px]">
              <thead>
                <tr className="border-b border-surface-200 bg-surface-50 text-[10px] font-semibold uppercase tracking-wide text-surface-500">
                  <th className="px-2.5 py-2 text-left">Item</th>
                  <th className="px-2 py-2 text-left">Item Code</th>
                  <th className="px-2 py-2 text-left">HSN</th>
                  <th className="px-2 py-2 text-right">Qty</th>
                  <th className="px-2 py-2 text-left">Unit</th>
                  <th className="px-2 py-2 text-right">Unit Price</th>
                  <th className="px-2 py-2 text-right">Disc %</th>
                  <th className="px-2 py-2 text-right">Tax %</th>
                  <th className="px-2.5 py-2 text-right">Line Total</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-surface-100">
                {so.items.map((it) => (
                  <tr key={it.id}>
                    <td className="px-2.5 py-2 font-medium text-surface-800">{it.description}</td>
                    <td className="px-2 py-2 text-surface-600">{it.itemCode}</td>
                    <td className="px-2 py-2 text-surface-600">{it.hsnCode}</td>
                    <td className="px-2 py-2 text-right">{it.quantity}</td>
                    <td className="px-2 py-2 text-surface-600">{it.unit}</td>
                    <td className="px-2 py-2 text-right">{formatINR(it.unitPrice)}</td>
                    <td className="px-2 py-2 text-right">{it.discountPct}%</td>
                    <td className="px-2 py-2 text-right">{it.taxPct}%</td>
                    <td className="px-2.5 py-2 text-right font-medium text-surface-800">
                      {formatINR(lineTotal(it.quantity, it.unitPrice, it.discountPct))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>

        <Section index={4} title="Commercial Terms">
          <DescList items={termRows} />
        </Section>

        <Section index={5} title="Amount Summary">
          <div className="ml-auto max-w-xs space-y-0.5">
            <InfoRow label="Subtotal" value={formatINR(totals.subtotal)} />
            <InfoRow label="Discount" value={`- ${formatINR(totals.discount)}`} />
            <InfoRow label="Taxable Value" value={formatINR(totals.taxable)} />
            <InfoRow label="GST" value={formatINR(totals.tax)} />
            <InfoRow label="Packing & Forwarding" value={formatINR(so.packingCharges)} />
            <div className="mt-1.5 flex items-center justify-between border-t-2 border-brand-100 pt-2">
              <span className="text-sm font-semibold text-surface-800">Grand Total</span>
              <span className="text-lg font-bold text-brand-700">{formatINR(totals.grandTotal)}</span>
            </div>
          </div>
        </Section>
      </div>
    </Drawer>
  );
}
