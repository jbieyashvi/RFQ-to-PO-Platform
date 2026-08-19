import type { Item, ItemTechnical, LineItem, SoKeyValue, TechnicalSpecs } from '@/types';

// The Sales Order Revision workspace shows an expandable Technical Specifications
// area per catalogue item. Catalogue items may carry authored specs; where they
// don't, we synthesise plausible, category-appropriate defaults so every line has
// a complete technical block to review/edit. Deterministic (no randomness) so the
// prototype stays stable across reloads.

const CATEGORY_DEFAULTS: Record<
  string,
  Partial<TechnicalSpecs> & { makes: string[]; productWord: string }
> = {
  Electrical: {
    makes: ['Schneider Electric', 'ABB', 'Siemens'],
    productWord: 'Switchgear',
    operatingPressure: 'N/A',
    operatingTemperature: '-5 to 55 °C',
    lineSize: 'N/A',
    mocConnection: 'Powder-coated CRCA enclosure, IP54',
    documentsRequired: 'Test certificate, GA drawing, warranty card',
  },
  Mechanical: {
    makes: ['Audco', 'KSB', 'Kirloskar'],
    productWord: 'Valve / Pump',
    operatingPressure: 'PN16 (16 bar)',
    operatingTemperature: '0 to 120 °C',
    lineSize: 'As per line schedule',
    mocConnection: 'SS316 body, flanged ANSI 150#',
    documentsRequired: 'Material test certificate, hydro-test report',
  },
  Instrumentation: {
    makes: ['Endress+Hauser', 'Emerson', 'Yokogawa'],
    productWord: 'Field Instrument',
    operatingPressure: '0-16 bar',
    operatingTemperature: '-20 to 80 °C',
    lineSize: 'DN50 flanged',
    mocConnection: 'SS316L wetted parts, 4-20mA HART',
    documentsRequired: 'Calibration certificate, datasheet, IOM manual',
  },
  Automation: {
    makes: ['Siemens', 'Delta', 'Allen-Bradley'],
    productWord: 'Automation Device',
    operatingPressure: 'N/A',
    operatingTemperature: '0 to 50 °C',
    lineSize: 'N/A',
    mocConnection: 'DIN-rail mount, 24V DC',
    documentsRequired: 'Configuration sheet, wiring diagram, warranty card',
  },
  Hardware: {
    makes: ['TVS', 'Unbrako', 'Generic'],
    productWord: 'Fastener / Gasket',
    operatingPressure: 'N/A',
    operatingTemperature: 'Ambient',
    lineSize: 'As specified',
    mocConnection: 'SS304 / SS316',
    documentsRequired: 'Material certificate',
  },
  Consumables: {
    makes: ['Servo', '3M', 'Generic'],
    productWord: 'Consumable',
    operatingPressure: 'N/A',
    operatingTemperature: 'Ambient',
    lineSize: 'N/A',
    mocConnection: 'N/A',
    documentsRequired: 'Batch / MSDS sheet',
  },
  Safety: {
    makes: ['3M', 'Karam', 'Honeywell'],
    productWord: 'Safety Equipment',
    operatingPressure: 'N/A',
    operatingTemperature: 'Ambient',
    lineSize: 'N/A',
    mocConnection: 'As per IS standard',
    documentsRequired: 'Conformity certificate',
  },
};

const FALLBACK = {
  makes: ['Generic'],
  productWord: 'Industrial Item',
  operatingPressure: 'N/A',
  operatingTemperature: 'Ambient',
  lineSize: 'As specified',
  mocConnection: 'As per datasheet',
  documentsRequired: 'Test certificate',
};

// Stable index from an id/code so a "make" choice is deterministic per item.
function stableIndex(seed: string, mod: number): number {
  let h = 0;
  for (let i = 0; i < seed.length; i += 1) h = (h * 31 + seed.charCodeAt(i)) % 100000;
  return h % mod;
}

export function synthTechnicalSpecs(item: Pick<Item, 'code' | 'name' | 'category'>): TechnicalSpecs {
  const def = CATEGORY_DEFAULTS[item.category] ?? FALLBACK;
  const make = def.makes[stableIndex(item.code, def.makes.length)];
  const model = item.code;
  return {
    make,
    product: item.name,
    model,
    decodification: `${make} ${model}`,
    operatingPressure: def.operatingPressure,
    operatingTemperature: def.operatingTemperature,
    lineSize: def.lineSize,
    dimensions: 'As per approved GA drawing',
    deliverySchedule: '4-6 weeks from clear PO',
    expectedArrival: '',
    documentsRequired: def.documentsRequired,
    mocConnection: def.mocConnection,
    accessories: 'Standard accessories as per make',
    otherDetails: `${def.productWord} — ${item.category} grade, as per approved datasheet.`,
  };
}

// Resolve the technical specs for a sales-order line: authored specs on the
// catalogue item win, otherwise synthesise from the item/line metadata.
export function specsForLine(line: LineItem, catalog: Item[]): TechnicalSpecs {
  const item = catalog.find((c) => c.id === line.itemId);
  if (item?.technicalSpecs) return { ...item.technicalSpecs };
  if (item) return synthTechnicalSpecs(item);
  return synthTechnicalSpecs({ code: line.itemCode, name: line.description, category: 'Hardware' });
}

// ---------------------------------------------------------------------------
// The single builder that turns Item Master specs into the shared ItemTechnical
// block used everywhere. Identity fields (make/product/model/decodification)
// stay typed; everything else becomes reusable key→value rows, because
// different Flowtech products carry different specification requirements. Used
// both to prefill the Create SO expandable item editor AND (via the resolver)
// to synthesise a complete block for records that never stored one, so both
// paths render identically. 'N/A' / empty values are dropped so no blank rows
// are ever displayed.
// ---------------------------------------------------------------------------
let kvSeq = 0;
export const nextKvId = () => `kv-${(kvSeq += 1)}`;

const meaningful = (v?: string): v is string =>
  typeof v === 'string' && v.trim() !== '' && v.trim().toUpperCase() !== 'N/A';

export function defaultItemTechnical(line: LineItem, catalog: Item[]): ItemTechnical {
  const s = specsForLine(line, catalog);
  const specs: SoKeyValue[] = [];
  const documents: SoKeyValue[] = [];
  const accessories: SoKeyValue[] = [];
  const otherDetails: SoKeyValue[] = [];
  const push = (arr: SoKeyValue[], label: string, value?: string) => {
    if (meaningful(value)) arr.push({ id: nextKvId(), label, value: value.trim() });
  };
  push(specs, 'Operating Pressure', s.operatingPressure);
  push(specs, 'Operating Temperature', s.operatingTemperature);
  push(specs, 'Line Size', s.lineSize);
  push(specs, 'Dimensions', s.dimensions);
  push(specs, 'MOC / Connection', s.mocConnection);
  push(documents, 'Documents Required', s.documentsRequired);
  push(accessories, 'Accessories', s.accessories);
  push(otherDetails, 'Other Details', s.otherDetails);
  return {
    make: s.make,
    product: s.product,
    modelNo: s.model,
    decodificationNo: s.decodification,
    specs,
    documents,
    accessories,
    otherDetails,
  };
}

// Human-readable label list for the expandable spec editor.
export const TECH_SPEC_FIELDS: { key: keyof TechnicalSpecs; label: string }[] = [
  { key: 'make', label: 'Make' },
  { key: 'product', label: 'Product' },
  { key: 'model', label: 'Model' },
  { key: 'decodification', label: 'Decodification' },
  { key: 'operatingPressure', label: 'Operating pressure' },
  { key: 'operatingTemperature', label: 'Operating temperature' },
  { key: 'lineSize', label: 'Line size' },
  { key: 'dimensions', label: 'Dimensions' },
  { key: 'deliverySchedule', label: 'Delivery schedule' },
  { key: 'expectedArrival', label: 'Expected arrival date' },
  { key: 'documentsRequired', label: 'Documents required' },
  { key: 'mocConnection', label: 'MOC and connection details' },
  { key: 'accessories', label: 'Accessories' },
  { key: 'otherDetails', label: 'Other technical details' },
];
