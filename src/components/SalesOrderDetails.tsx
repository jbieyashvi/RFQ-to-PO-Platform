import { useState } from 'react';
import { Download, Building2 } from 'lucide-react';
import type { SalesOrder } from '@/types';
import {
  Drawer,
  Button,
  StatusBadge,
  Tabs,
  DescList,
  InfoRow,
} from '@/components/ui';
import { useApp } from '@/context/AppContext';
import { SO_STATUS, VERIFICATION_STATUS } from '@/lib/labels';
import { officeName } from '@/data/offices';
import { computeTotals, downloadText, formatDate, formatDateTime, formatINR, lineTotal } from '@/lib/format';

export function SalesOrderDetailsDrawer({
  order,
  onClose,
}: {
  order: SalesOrder | null;
  onClose: () => void;
}) {
  const { addToast } = useApp();
  const [tab, setTab] = useState('overview');
  if (!order) return null;
  const so = order;
  const totals = computeTotals(so.items, so.packingCharges);

  const download = () => {
    downloadText(
      `${so.number.replace(/\//g, '-')}.txt`,
      `SALES ORDER ${so.number}\nPO: ${so.poNumber} (${formatDate(so.poDate)})\nCustomer: ${so.customerName} (${so.customerCode})\nSales Office: ${officeName(so.officeId)}\nOwner: ${so.owner}\nValue: ${formatINR(so.value)}\n\nItems:\n${so.items
        .map((it) => `- ${it.itemCode} ${it.description} x${it.quantity} @ ${formatINR(it.unitPrice)}`)
        .join('\n')}`
    );
    addToast({ type: 'success', title: 'Download started', message: `${so.number} exported.` });
  };

  return (
    <Drawer
      open={!!order}
      onClose={onClose}
      width="xl"
      title={so.number}
      subtitle={
        <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <span>{so.customerName}</span>
          <span className="flex items-center gap-1"><Building2 className="h-3.5 w-3.5" /> {officeName(so.officeId)}</span>
          <span>PO: {so.poNumber}</span>
        </span>
      }
      headerExtra={<StatusBadge tone={SO_STATUS[so.status].tone} label={SO_STATUS[so.status].label} />}
      footer={<Button variant="secondary" leftIcon={<Download className="h-4 w-4" />} onClick={download}>Download SO</Button>}
    >
      <Tabs
        active={tab}
        onChange={setTab}
        tabs={[
          { key: 'overview', label: 'Overview' },
          { key: 'items', label: 'Items & Pricing', count: so.items.length },
          { key: 'terms', label: 'Commercial Terms' },
        ]}
      />
      <div className="pt-5">
        {tab === 'overview' && (
          <div className="space-y-5">
            <DescList
              items={[
                { label: 'SO Number', value: so.number },
                { label: 'SO Status', value: <StatusBadge tone={SO_STATUS[so.status].tone} label={SO_STATUS[so.status].label} /> },
                { label: 'PO Number', value: so.poNumber },
                { label: 'PO Date', value: formatDate(so.poDate) },
                { label: 'Linked Quotation', value: so.quotationNumber ?? '—' },
                { label: 'Verification', value: <StatusBadge tone={VERIFICATION_STATUS[so.verificationStatus].tone} label={VERIFICATION_STATUS[so.verificationStatus].label} /> },
                { label: 'Customer', value: `${so.customerName} (${so.customerCode})` },
                { label: 'Sales Office', value: officeName(so.officeId) },
                { label: 'Owner', value: so.owner },
                { label: 'Created', value: formatDate(so.createdDate) },
                { label: 'Delivery Date', value: formatDate(so.deliveryDate) },
                { label: 'SO Sent Date', value: so.sentAt ? formatDateTime(so.sentAt) : 'Not sent' },
                { label: 'Order Value', value: formatINR(so.value) },
              ]}
            />
            {so.revisionReason && (
              <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
                <span className="font-semibold">Revision reason:</span> {so.revisionReason}
              </div>
            )}
          </div>
        )}

        {tab === 'items' && (
          <div>
            <div className="overflow-x-auto rounded-xl border border-surface-200">
              <table className="w-full min-w-[640px] border-collapse text-sm">
                <thead>
                  <tr className="border-b border-surface-200 bg-surface-50 text-xs font-semibold uppercase tracking-wide text-surface-500">
                    <th className="px-3 py-2.5 text-left">Item</th>
                    <th className="px-2 py-2.5 text-right">Qty</th>
                    <th className="px-2 py-2.5 text-right">Rate</th>
                    <th className="px-2 py-2.5 text-right">Disc%</th>
                    <th className="px-2 py-2.5 text-right">Tax%</th>
                    <th className="px-3 py-2.5 text-right">Amount</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-surface-100">
                  {so.items.map((it) => (
                    <tr key={it.id}>
                      <td className="px-3 py-2.5">
                        <p className="font-medium text-surface-800">{it.description}</p>
                        <p className="text-xs text-surface-400">{it.itemCode} • HSN {it.hsnCode}</p>
                      </td>
                      <td className="px-2 py-2.5 text-right">{it.quantity} {it.unit}</td>
                      <td className="px-2 py-2.5 text-right">{formatINR(it.unitPrice)}</td>
                      <td className="px-2 py-2.5 text-right">{it.discountPct}%</td>
                      <td className="px-2 py-2.5 text-right">{it.taxPct}%</td>
                      <td className="px-3 py-2.5 text-right font-medium text-surface-800">{formatINR(lineTotal(it.quantity, it.unitPrice, it.discountPct))}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="mt-4 ml-auto max-w-xs space-y-1">
              <InfoRow label="Subtotal" value={formatINR(totals.subtotal)} />
              <InfoRow label="Discount" value={`- ${formatINR(totals.discount)}`} />
              <InfoRow label="Taxable Value" value={formatINR(totals.taxable)} />
              <InfoRow label="GST" value={formatINR(totals.tax)} />
              {so.packingCharges > 0 && <InfoRow label="Packing & Forwarding" value={formatINR(so.packingCharges)} />}
              <div className="mt-1 border-t border-surface-200 pt-2">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-semibold text-surface-800">Grand Total</span>
                  <span className="text-base font-bold text-brand-700">{formatINR(totals.grandTotal)}</span>
                </div>
              </div>
            </div>
          </div>
        )}

        {tab === 'terms' && (
          <DescList
            items={[
              { label: 'Payment Terms', value: so.paymentTerms },
              { label: 'Delivery Terms', value: so.deliveryTerms },
              { label: 'Warranty', value: so.warranty },
              { label: 'Packing Charges', value: so.packingCharges > 0 ? formatINR(so.packingCharges) : 'Included' },
            ]}
          />
        )}
      </div>
    </Drawer>
  );
}
