import { PageHeader } from '@/layout/PageHeader';

// ---------------------------------------------------------------------------
// Party Master — aligned to the PM reference prototype: a single clean,
// read-only table (Company · Buyer & Billing · Consignee & Address · GSTIN ·
// Sector). No office/status filters, no search toolbar, no status chips, no
// row actions, no drawer. These PM-reference records are prototype data until
// the final Party Master data is received from OM. Rendered locally so the
// shared party store, types and other modules are left untouched.
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

const TH = 'px-4 py-2.5 text-left text-[12px] font-semibold uppercase tracking-wide text-surface-500';
const PRIMARY = 'text-[13px] font-medium text-surface-800';
const SECONDARY = 'mt-0.5 text-[12px] leading-relaxed text-surface-500';

export default function PartyMaster() {
  return (
    <>
      <PageHeader
        title="Party Master"
        description="Registered customer companies with buyer, consignee and tax details."
        crumbs={[{ label: 'Master' }, { label: 'Party Master' }]}
      />

      <div className="card overflow-hidden">
        {/* Desktop / tablet — single responsive table */}
        <div className="hidden md:block">
          <table className="w-full table-fixed border-collapse">
            <colgroup>
              <col className="w-[20%]" />
              <col className="w-[26%]" />
              <col className="w-[26%]" />
              <col className="w-[16%]" />
              <col className="w-[12%]" />
            </colgroup>
            <thead>
              <tr className="border-b border-surface-200 bg-surface-50">
                <th className={TH}>Company Name</th>
                <th className={TH}>Buyer&rsquo;s Name &amp; Billing Address</th>
                <th className={TH}>Consignee&rsquo;s Name &amp; Address</th>
                <th className={TH}>GSTIN</th>
                <th className={TH}>Sector</th>
              </tr>
            </thead>
            <tbody>
              {PARTY_ROWS.map((p) => (
                <tr
                  key={p.gstin}
                  className="border-b border-surface-100 align-top last:border-0 hover:bg-surface-50/60"
                >
                  <td className="px-4 py-3">
                    <p className={PRIMARY}>{p.company}</p>
                  </td>
                  <td className="px-4 py-3">
                    <p className={PRIMARY}>{p.buyer}</p>
                    <p className={SECONDARY}>{p.billingAddress}</p>
                  </td>
                  <td className="px-4 py-3">
                    <p className={PRIMARY}>{p.consignee}</p>
                    <p className={SECONDARY}>{p.consigneeAddress}</p>
                  </td>
                  <td className="px-4 py-3">
                    <span className="font-mono text-[13px] font-medium text-surface-700">{p.gstin}</span>
                  </td>
                  <td className="px-4 py-3">
                    <span className="text-[13px] text-surface-700">{p.sector}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Mobile — each record as a labelled stacked card */}
        <div className="divide-y divide-surface-100 md:hidden">
          {PARTY_ROWS.map((p) => (
            <div key={p.gstin} className="space-y-3 p-4">
              <Field label="Company Name">
                <p className={PRIMARY}>{p.company}</p>
              </Field>
              <Field label="Buyer's Name & Billing Address">
                <p className={PRIMARY}>{p.buyer}</p>
                <p className={SECONDARY}>{p.billingAddress}</p>
              </Field>
              <Field label="Consignee's Name & Address">
                <p className={PRIMARY}>{p.consignee}</p>
                <p className={SECONDARY}>{p.consigneeAddress}</p>
              </Field>
              <Field label="GSTIN">
                <span className="font-mono text-[13px] font-medium text-surface-700">{p.gstin}</span>
              </Field>
              <Field label="Sector">
                <span className="text-[13px] text-surface-700">{p.sector}</span>
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
