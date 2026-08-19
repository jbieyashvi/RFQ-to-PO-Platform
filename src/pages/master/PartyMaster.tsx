import { PageHeader } from '@/layout/PageHeader';
import { DataTable, type Column } from '@/components/ui';

// ---------------------------------------------------------------------------
// Party Master — aligned to the PM reference prototype: a single clean,
// read-only table (Company · Buyer & Billing · Consignee & Address · GSTIN ·
// Sector). No office/status filters, no search toolbar, no status chips, no
// row actions, no drawer. These PM-reference records are prototype data until
// the final Party Master data is received from OM. Rendered locally so the
// shared party store, types and other modules are left untouched.
//
// The desktop table uses the shared `DataTable` so its header, typography,
// spacing, hover, sticky-header, sorting and overflow behaviour match Item
// Master exactly. Only the two address columns override the DataTable default
// to wrap onto (at most) two lines.
// ---------------------------------------------------------------------------
interface PartyRow {
  company: string;
  buyer: string;
  billingAddress: string;
  consignee: string;
  consigneeAddress: string;
  gstin: string;
  sector: string;
}

const PARTY_ROWS: PartyRow[] = [
  {
    company: 'Cargill India Pvt. Ltd.',
    buyer: 'Rajesh Kumar',
    billingAddress: 'Plot 45, GIDC Ankleshwar, Gujarat 393002',
    consignee: 'Cargill Plant Mgr.',
    consigneeAddress: 'Cargill Plant, GIDC Phase II, Ankleshwar',
    gstin: '24AAACC1234A1Z5',
    sector: 'Food Processing',
  },
  {
    company: 'Reliance Industries',
    buyer: 'Manish Agarwal',
    billingAddress: 'Maker Chambers IV, Nariman Point, Mumbai 400021',
    consignee: 'RIL Jamnagar Refinery',
    consigneeAddress: 'Jamnagar Refinery Complex, Gujarat 361142',
    gstin: '27AAACR5055K1Z7',
    sector: 'Oil & Gas',
  },
  {
    company: 'Apollo Tyres',
    buyer: 'Vikram Desai',
    billingAddress: 'Apollo House, Vadodara 390007',
    consignee: 'Apollo Tyres Plant',
    consigneeAddress: 'Limda, Waghodia, Vadodara 391760',
    gstin: '29AAACI5642L1Z3',
    sector: 'Automotive',
  },
  {
    company: 'ITC Limited',
    buyer: 'Sunita Menon',
    billingAddress: 'Virginia House, Kolkata 700071',
    consignee: 'ITC Bangalore Unit',
    consigneeAddress: 'Peenya Industrial Area, Bangalore 560058',
    gstin: '27AABCI1234F1Z5',
    sector: 'FMCG',
  },
  {
    company: 'Nestle India',
    buyer: 'Kavita Reddy',
    billingAddress: '100/101, Techno Park, Whitefield, Bangalore 560066',
    consignee: 'Nestle Nanjangud Factory',
    consigneeAddress: 'Nanjangud Industrial Area, Mysore 571301',
    gstin: '24AAACN1234B1Z5',
    sector: 'Food & Beverage',
  },
];

// Person + address stacked inside a single cell. The wrapper resets the
// DataTable cell's default `whitespace-nowrap` so the address can wrap, capped
// at two lines with a tooltip carrying the full value.
function PersonAddress({ name, address }: { name: string; address: string }) {
  return (
    <div className="whitespace-normal">
      <p className="text-[12px] font-medium text-surface-800">{name}</p>
      <p className="mt-0.5 line-clamp-2 text-[11px] leading-snug text-surface-500" title={address}>
        {address}
      </p>
    </div>
  );
}

const columns: Column<PartyRow>[] = [
  {
    key: 'company',
    header: 'Company Name',
    width: '20%',
    truncate: true,
    title: (r) => r.company,
    sortValue: (r) => r.company,
    render: (r) => <span className="font-medium text-surface-800">{r.company}</span>,
  },
  {
    key: 'buyer',
    header: "Buyer's Name & Billing Address",
    width: '27%',
    render: (r) => <PersonAddress name={r.buyer} address={r.billingAddress} />,
  },
  {
    key: 'consignee',
    header: "Consignee's Name & Address",
    width: '27%',
    render: (r) => <PersonAddress name={r.consignee} address={r.consigneeAddress} />,
  },
  {
    key: 'gstin',
    header: 'GSTIN',
    width: '15%',
    truncate: true,
    title: (r) => r.gstin,
    sortValue: (r) => r.gstin,
    render: (r) => <span className="text-surface-700">{r.gstin}</span>,
  },
  {
    key: 'sector',
    header: 'Sector',
    width: '11%',
    truncate: true,
    title: (r) => r.sector,
    sortValue: (r) => r.sector,
    render: (r) => <span className="text-surface-700">{r.sector}</span>,
  },
];

export default function PartyMaster() {
  return (
    <>
      <PageHeader
        title="Party Master"
        description="Registered customer companies with buyer, consignee and tax details."
        crumbs={[{ label: 'Master' }, { label: 'Party Master' }]}
      />

      <div className="card">
        {/* Desktop / tablet — shared DataTable (no filter toolbar: Party Master
            intentionally has no filters, so the table begins inside the card). */}
        <div className="hidden md:block">
          <DataTable columns={columns} rows={PARTY_ROWS} rowKey={(r) => r.gstin} />
        </div>

        {/* Mobile — each record as a labelled stacked card */}
        <div className="divide-y divide-surface-100 md:hidden">
          {PARTY_ROWS.map((p) => (
            <div key={p.gstin} className="space-y-2.5 p-4">
              <Field label="Company Name">
                <p className="text-[12px] font-medium text-surface-800">{p.company}</p>
              </Field>
              <Field label="Buyer's Name & Billing Address">
                <p className="text-[12px] font-medium text-surface-800">{p.buyer}</p>
                <p className="mt-0.5 text-[11px] leading-snug text-surface-500">{p.billingAddress}</p>
              </Field>
              <Field label="Consignee's Name & Address">
                <p className="text-[12px] font-medium text-surface-800">{p.consignee}</p>
                <p className="mt-0.5 text-[11px] leading-snug text-surface-500">{p.consigneeAddress}</p>
              </Field>
              <Field label="GSTIN">
                <span className="text-[12px] text-surface-700">{p.gstin}</span>
              </Field>
              <Field label="Sector">
                <span className="text-[12px] text-surface-700">{p.sector}</span>
              </Field>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-[11px] font-semibold uppercase tracking-wide text-surface-400">{label}</p>
      <div className="mt-0.5">{children}</div>
    </div>
  );
}
