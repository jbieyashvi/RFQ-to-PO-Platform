import { useLocation, useNavigate } from 'react-router-dom';
import { Download, Building2, User, CalendarDays, ExternalLink } from 'lucide-react';
import type { SalesOrder } from '@/types';
import { Drawer, Button } from '@/components/ui';
import { useApp } from '@/context/AppContext';
import { officeName } from '@/data/offices';
import { ITEMS } from '@/data/masters';
import { downloadText, formatDate, formatDateTime } from '@/lib/format';
import { resolveSalesOrder, salesOrderText } from '@/lib/salesOrder';
import { SalesOrderDocument } from '@/components/sales-order/SalesOrderDocument';
import { ERP_HANDOFF_STATE, ERP_HANDOFF_SOURCE } from '@/lib/labels';

export function SalesOrderDetailsDrawer({
  order,
  onClose,
}: {
  order: SalesOrder | null;
  onClose: () => void;
}) {
  const { addToast, parties } = useApp();
  const navigate = useNavigate();
  const location = useLocation();
  if (!order) return null;
  const so = order;
  const resolved = resolveSalesOrder(so, { parties, catalog: ITEMS });
  // The cross-link is only useful from somewhere else. Opened from the ERP
  // Handoff screen itself it is redundant, so that popup keeps just Close and
  // Download SO.
  const showHandoffLink = !!so.erpHandoff && !location.pathname.startsWith('/erp-handoff');

  const download = () => {
    downloadText(`${so.number.replace(/\//g, '-')}.txt`, salesOrderText(resolved));
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
          <span className="font-medium text-surface-700">{so.customerName}</span>
          <span className="flex items-center gap-1"><CalendarDays className="h-3.5 w-3.5" /> {formatDate(so.createdDate)}</span>
          <span className="flex items-center gap-1"><Building2 className="h-3.5 w-3.5" /> {officeName(so.officeId)}</span>
          <span className="flex items-center gap-1"><User className="h-3.5 w-3.5" /> {so.owner}</span>
        </span>
      }
      footer={
        <div className="flex items-center justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>Close</Button>
          {showHandoffLink && (
            <Button variant="secondary" leftIcon={<ExternalLink className="h-4 w-4" />} onClick={() => navigate('/erp-handoff')}>
              View in ERP Handoff
            </Button>
          )}
          <Button variant="primary" leftIcon={<Download className="h-4 w-4" />} onClick={download}>Download SO</Button>
        </div>
      }
    >
      <div className="pt-1">
        <SalesOrderDocument resolved={resolved} />

        {so.erpHandoff && (
          <div className="mt-6 rounded-xl border border-surface-200 bg-surface-50/60 p-4">
            <h3 className="mb-3 flex items-center gap-2 text-[13px] font-semibold text-surface-800">
              <ExternalLink className="h-4 w-4 text-brand-600" /> ERP Handoff
            </h3>
            <dl className="grid grid-cols-1 gap-x-6 gap-y-2 sm:grid-cols-2">
              <Meta label="Status" value={ERP_HANDOFF_STATE[so.erpHandoff.state]?.label ?? so.erpHandoff.state} />
              <Meta label="Source" value={ERP_HANDOFF_SOURCE[so.erpHandoff.source] ?? so.erpHandoff.source} />
              <Meta label="Revision" value={so.revisionNumber > 0 ? `Rev ${so.revisionNumber}` : 'Original'} />
              <Meta label="Queued" value={`${formatDateTime(so.erpHandoff.queuedAt)} · ${so.erpHandoff.queuedBy}`} />
              {/* Absent while Pending — the SO is in the queue, not in the ERP. */}
              <Meta
                label="Submitted to ERP"
                value={so.erpHandoff.submittedAt ? `${formatDateTime(so.erpHandoff.submittedAt)} · ${so.erpHandoff.submittedBy}` : 'Not yet submitted'}
              />
              <Meta label="Last Updated" value={formatDateTime(so.erpHandoff.updatedAt)} />
              {so.erpHandoff.reference && <Meta label="ERP Reference" value={so.erpHandoff.reference} />}
            </dl>
          </div>
        )}
      </div>
    </Drawer>
  );
}

function Meta({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <dt className="text-[11px] font-medium uppercase tracking-wide text-surface-400">{label}</dt>
      <dd className="mt-0.5 text-[12px] text-surface-800">{value}</dd>
    </div>
  );
}
