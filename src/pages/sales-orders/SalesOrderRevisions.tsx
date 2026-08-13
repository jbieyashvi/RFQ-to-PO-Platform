import { useMemo, useState } from 'react';
import { Eye, Download, FilePenLine } from 'lucide-react';
import { PageHeader } from '@/layout/PageHeader';
import {
  Button,
  DataTable,
  StatusBadge,
  SearchInput,
  FilterBar,
  FilterSelect,
  Pagination,
  RowActionMenu,
  type Column,
  type FilterChip,
  type RowAction,
} from '@/components/ui';
import { SalesOrderDetailsDrawer } from '@/components/SalesOrderDetails';
import { RevisionWorkspace, type RevisionSubmitPayload } from '@/components/RevisionWorkspace';
import { useApp, useOfficeScope } from '@/context/AppContext';
import { OFFICES, officeName } from '@/data/offices';
import { REVISION_STATE, REVISION_STATE_ORDER } from '@/lib/labels';
import type { ActivityEvent, RevisionState, SalesOrder } from '@/types';
import { downloadText, formatDate, formatINR } from '@/lib/format';
import {
  canApproveRevision,
  completionBlockers,
  isActiveRevision,
  renderRevisedSO,
  revisedVersionExists,
  snapshotOf,
  snapshotValue,
} from '@/lib/revision';
import { usePaginated, useSimulatedLoading } from '@/lib/hooks';

export default function SalesOrderRevisions() {
  const { salesOrders, role, currentUser, can, updateSalesOrder, addToast } = useApp();
  const inScope = useOfficeScope();
  const [search, setSearch] = useState('');
  const [office, setOffice] = useState('');
  const [stateFilter, setStateFilter] = useState<'' | RevisionState>('');
  const [detail, setDetail] = useState<SalesOrder | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const loading = useSimulatedLoading([]);

  const canEdit = can('sales_orders', 'edit');
  const canApprove = canApproveRevision(role) && can('sales_orders', 'edit');

  const active = useMemo(
    () => (activeId ? salesOrders.find((s) => s.id === activeId) ?? null : null),
    [activeId, salesOrders]
  );

  const base = useMemo(
    () =>
      salesOrders.filter((so) => {
        if (!inScope(so.officeId) || !so.revisionState) return false;
        return stateFilter ? so.revisionState === stateFilter : isActiveRevision(so);
      }),
    [salesOrders, inScope, stateFilter]
  );

  const filtered = useMemo(() => {
    const s = search.trim().toLowerCase();
    return base.filter((so) => {
      if (office && so.officeId !== office) return false;
      if (s && !`${so.number} ${so.customerName} ${so.revisionReason ?? ''}`.toLowerCase().includes(s)) return false;
      return true;
    });
  }, [base, search, office]);

  const { page, pageSize, setPage, setPageSize, pageRows, total } = usePaginated(filtered, 10);

  const chips: FilterChip[] = [];
  if (stateFilter) chips.push({ key: 'st', label: `State: ${REVISION_STATE[stateFilter].label}`, onRemove: () => setStateFilter('') });
  if (office) chips.push({ key: 'o', label: `Office: ${officeName(office)}`, onRemove: () => setOffice('') });
  if (search) chips.push({ key: 'q', label: `Search: "${search}"`, onRemove: () => setSearch('') });

  // ---------- Activity helper ----------
  const appendActivity = (so: SalesOrder, action: string, detailText?: string): ActivityEvent[] => [
    ...so.activity,
    { id: `act-${so.id}-${Date.now()}`, date: new Date().toISOString(), actor: currentUser.fullName, action, detail: detailText },
  ];

  // ---------- Transitions ----------
  const handleSaveDraft = (so: SalesOrder, p: RevisionSubmitPayload) => {
    updateSalesOrder(so.id, {
      revisionState: 'draft_in_progress',
      revisionDraft: p.draft,
      revisionNotes: p.notes,
      revisionAttachments: p.attachments,
      revisionPreviewed: p.previewed,
      activity: appendActivity(so, 'Revision draft saved', p.notes || undefined),
    });
    addToast({ type: 'success', title: 'Draft saved', message: `Revision draft saved for ${so.number}.` });
  };

  const handleSubmit = (so: SalesOrder, p: RevisionSubmitPayload) => {
    const blockers = completionBlockers({
      original: snapshotOf(so),
      draft: p.draft,
      notes: p.notes,
      previewed: p.previewed,
      packingCharges: so.packingCharges,
    });
    if (blockers.length) {
      addToast({ type: 'error', title: 'Cannot submit yet', message: blockers[0] });
      return;
    }
    updateSalesOrder(so.id, {
      revisionState: 'awaiting_approval',
      revisionDraft: p.draft,
      revisionNotes: p.notes,
      revisionAttachments: p.attachments,
      revisionPreviewed: true,
      activity: appendActivity(so, 'Submitted for approval', 'Revised Sales Order sent for approval.'),
    });
    addToast({ type: 'success', title: 'Submitted for approval', message: `${so.number} is now awaiting approval.` });
    setActiveId(null);
  };

  const handleApprove = (so: SalesOrder) => {
    if (!canApprove) {
      addToast({ type: 'error', title: 'Approval not permitted', message: 'You need Office Admin or Super Admin permission to approve revisions.' });
      return;
    }
    updateSalesOrder(so.id, {
      revisionState: 'revision_approved',
      activity: appendActivity(so, 'Revision approved', `Approved by ${currentUser.fullName}.`),
    });
    addToast({ type: 'success', title: 'Revision approved', message: `${so.number} is approved and ready to send.` });
  };

  const handleReturnToDraft = (so: SalesOrder) => {
    updateSalesOrder(so.id, {
      revisionState: 'draft_in_progress',
      activity: appendActivity(so, 'Returned to draft', 'Sent back for further changes.'),
    });
    addToast({ type: 'info', title: 'Returned to draft', message: `${so.number} was sent back for changes.` });
  };

  const handleSend = (so: SalesOrder) => {
    if (!canApprove) {
      addToast({ type: 'error', title: 'Send not permitted', message: 'You need Office Admin or Super Admin permission to send a revised SO.' });
      return;
    }
    const draft = so.revisionDraft;
    if (!draft) return;
    const newNumber = so.revisionNumber + 1;
    const label = `Rev ${newNumber}`;
    const value = snapshotValue(draft, so.packingCharges);
    updateSalesOrder(so.id, {
      status: 'so_sent',
      revisionState: 'revised_sent',
      revisionNumber: newNumber,
      // apply the revised snapshot to the live SO (original preserved in versions[0])
      items: draft.items.map((it) => ({ ...it })),
      paymentTerms: draft.paymentTerms,
      deliveryTerms: draft.deliveryTerms,
      deliveryDate: draft.deliveryDate,
      billingAddress: draft.billingAddress,
      shippingAddress: draft.shippingAddress,
      value,
      versions: [
        ...so.versions,
        {
          id: `ver-${so.id}-${newNumber}`,
          label,
          version: newNumber,
          createdAt: new Date().toISOString(),
          by: currentUser.fullName,
          reason: so.revisionReason ?? 'Revision',
          notes: so.revisionNotes,
          snapshot: draft,
          attachments: so.revisionAttachments,
        },
      ],
      activity: appendActivity(so, 'Revised SO sent', `${label} dispatched to ${so.customerName}.`),
    });
    addToast({ type: 'success', title: 'Revised SO sent', message: `${so.number} (${label}) sent and updated in the Sales Order list.` });
    setActiveId(null);
  };

  const downloadRevised = (so: SalesOrder) => {
    const latest = so.versions[so.versions.length - 1];
    const snapshot = so.revisionNumber > 0 ? latest.snapshot : so.revisionDraft ?? latest.snapshot;
    const label = so.revisionNumber > 0 ? `Rev ${so.revisionNumber}` : `Rev ${so.revisionNumber + 1} (draft)`;
    downloadText(`${so.number.replace(/\//g, '-')}-revised.txt`, renderRevisedSO(so, snapshot, label));
    addToast({ type: 'info', title: 'Download started', message: `${so.number} (${label})` });
  };

  const columns: Column<SalesOrder>[] = [
    { key: 'so', header: 'SO No', width: '118px', sticky: 'left', sortValue: (r) => r.number, render: (r) => <span className="font-medium text-surface-800">{r.number}</span> },
    { key: 'customer', header: 'Customer', truncate: true, title: (r) => r.customerName, render: (r) => <span className="font-medium text-surface-800">{r.customerName}</span> },
    { key: 'office', header: 'Sales Office', width: '150px', truncate: true, title: (r) => officeName(r.officeId), render: (r) => <span className="text-surface-600">{officeName(r.officeId)}</span> },
    { key: 'reason', header: 'Revision Reason', truncate: true, title: (r) => r.revisionReason ?? '', render: (r) => <span className="text-surface-700">{r.revisionReason}</span> },
    { key: 'requested', header: 'Requested', width: '92px', sortValue: (r) => r.revisionRequestedDate ?? '', render: (r) => <span className="text-surface-600">{formatDate(r.revisionRequestedDate ?? '', { short: true })}</span> },
    { key: 'owner', header: 'Owner', width: '110px', truncate: true, title: (r) => r.revisionOwner ?? r.owner, render: (r) => <span className="text-surface-600">{r.revisionOwner ?? r.owner}</span> },
    { key: 'state', header: 'Revision State', width: '150px', render: (r) => r.revisionState && <StatusBadge tone={REVISION_STATE[r.revisionState].tone} label={REVISION_STATE[r.revisionState].label} /> },
    {
      key: 'actions',
      header: 'Actions',
      width: '176px',
      align: 'right',
      sticky: 'right',
      render: (r) => {
        const st = r.revisionState ?? 'revision_required';
        const menu: RowAction[] = [
          { label: 'View Existing SO', icon: <Eye className="h-4 w-4" />, onClick: () => setDetail(r) },
        ];
        if (can('sales_orders', 'download')) {
          menu.push({
            label: 'Download Revised SO',
            icon: <Download className="h-4 w-4" />,
            disabled: !revisedVersionExists(r),
            onClick: () => downloadRevised(r),
          });
        }
        return (
          <div className="flex items-center justify-end gap-1" onClick={(e) => e.stopPropagation()}>
            <Button size="sm" variant={st === 'revised_sent' ? 'secondary' : 'primary'} leftIcon={<FilePenLine className="h-3.5 w-3.5" />} onClick={() => setActiveId(r.id)}>
              {REVISION_STATE[st].action}
            </Button>
            <RowActionMenu actions={menu} label={`Actions for ${r.number}`} />
          </div>
        );
      },
    },
  ];

  return (
    <>
      <PageHeader
        title="Sales Order Revision"
        description="Correct sales orders through a reviewed revision workflow — edit, compare, approve and send the revised SO."
        crumbs={[{ label: 'Sales Orders' }, { label: 'Sales Order Revision' }]}
      />

      <div className="card">
        <div className="border-b border-surface-100 p-4">
          <FilterBar chips={chips} onClearAll={() => { setOffice(''); setSearch(''); setStateFilter(''); }}>
            <SearchInput value={search} onChange={setSearch} placeholder="Search SO, customer, reason…" className="w-full sm:w-72" />
            <FilterSelect
              value={stateFilter}
              onChange={(v) => setStateFilter(v as '' | RevisionState)}
              placeholder="Active revisions"
              options={REVISION_STATE_ORDER.map((s) => ({ value: s, label: REVISION_STATE[s].label }))}
            />
            {role === 'super_admin' && <FilterSelect value={office} onChange={setOffice} placeholder="All offices" options={OFFICES.map((o) => ({ value: o.id, label: o.name }))} />}
          </FilterBar>
        </div>
        <DataTable columns={columns} rows={pageRows} rowKey={(r) => r.id} loading={loading} onRowClick={(r) => setActiveId(r.id)} emptyTitle="No revisions here" emptyMessage="No sales orders match this revision filter." />
        {!loading && total > 0 && <Pagination page={page} pageSize={pageSize} total={total} onPageChange={setPage} onPageSizeChange={setPageSize} />}
      </div>

      <SalesOrderDetailsDrawer order={detail} onClose={() => setDetail(null)} />

      <RevisionWorkspace
        order={active}
        canEdit={canEdit}
        canApprove={canApprove}
        onClose={() => setActiveId(null)}
        onSaveDraft={handleSaveDraft}
        onSubmit={handleSubmit}
        onApprove={handleApprove}
        onReturnToDraft={handleReturnToDraft}
        onSend={handleSend}
      />
    </>
  );
}
