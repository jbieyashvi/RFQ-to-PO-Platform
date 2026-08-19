// Single company / bank configuration for the Sales Order Acknowledgement.
// Every Sales Order surface (View drawer, previews, email attachment, ERP
// handoff) reads the "Company Details" block from HERE so the values are always
// identical. Bank / statutory numbers below are PLACEHOLDER Flowtech values for
// the prototype — they are NOT taken from any real supplied document.

import { COMPANY_ADDRESS, COMPANY_NAME } from '@/lib/brand';

export interface CompanyConfig {
  legalName: string;
  address: { line1: string; line2: string; phone: string; email: string };
  // State the company is registered in — drives the intra vs inter-state GST
  // split (CGST+SGST when the buyer is in the same state, else IGST).
  state: string;
  gstin: string;
  arn: string;
  pan: string;
  bank: {
    accountHolder: string;
    bankName: string;
    bankAddress: string;
    accountNumber: string;
    ifsc: string;
    swift: string;
    micr: string;
  };
  authorisedSignatory: string;
}

// GSTIN state code 26 → Dadra & Nagar Haveli (matches the Silvassa address).
export const COMPANY: CompanyConfig = {
  legalName: COMPANY_NAME,
  address: {
    line1: COMPANY_ADDRESS.line1,
    line2: COMPANY_ADDRESS.line2,
    phone: COMPANY_ADDRESS.phone,
    email: COMPANY_ADDRESS.email,
  },
  state: 'Dadra & Nagar Haveli',
  gstin: COMPANY_ADDRESS.gstin,
  arn: 'AA260226000001Z',
  pan: COMPANY_ADDRESS.pan,
  bank: {
    accountHolder: COMPANY_NAME,
    bankName: 'HDFC Bank',
    bankAddress: 'Silvassa Main Branch, Dadra & Nagar Haveli 396230',
    accountNumber: '50200012345678',
    ifsc: 'HDFC0001234',
    swift: 'HDFCINBB',
    micr: '396240002',
  },
  authorisedSignatory: 'For Flowtech Measuring Instruments Pvt. Ltd.',
};
