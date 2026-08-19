// Central Flowtech brand constants — the single source of truth for all
// visible product naming, company identity and document/letterhead details.
// Keep visual colour tokens in tailwind.config.js (the `brand` scale) and use
// these string constants wherever company naming or contact data is rendered
// (sidebar, login, emails, quotation/SO documents).

/** Short application name shown in the sidebar, header and login. */
export const APP_NAME = 'Flowtech RFQ';

/** Platform subtitle shown beneath the app name. */
export const APP_SUBTITLE = 'RFQ → PO Platform';

/** Full legal company name for emails, letterheads and documents. */
export const COMPANY_NAME = 'Flowtech Measuring Instruments Pvt. Ltd.';

/** Primary web domain / email domain. */
export const COMPANY_DOMAIN = 'flowtech-instruments.com';
export const COMPANY_WEBSITE = 'https://flowtech-instruments.com';

/** Registered office / contact block used on documents. */
export const COMPANY_ADDRESS = {
  line1: 'Survey No. 42, Silvassa Industrial Estate',
  line2: 'Silvassa, Dadra & Nagar Haveli 396230, India',
  phone: '+91 260 264 2200',
  email: `sales@${COMPANY_DOMAIN}`,
  gstin: '26AABCF1234K1Z5',
  pan: 'AABCF1234K',
};

/** Path to the official logo SVG, base-path aware for GH Pages / Vercel. */
export const LOGO_SRC = `${import.meta.env.BASE_URL}flowtech-logo.svg`;

/**
 * Professional Flowtech email signature block. Used to close every outbound
 * operational email so signatures consistently reflect Flowtech identity.
 * @param name   sender's full name
 * @param office sales office name
 * @param role   optional role / designation line
 */
export function emailSignature(name: string, office: string, role?: string): string {
  return [
    'Warm regards,',
    name,
    ...(role ? [role] : []),
    COMPANY_NAME,
    `${office} Sales Office`,
    COMPANY_DOMAIN,
  ].join('\n');
}
