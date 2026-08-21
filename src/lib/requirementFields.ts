// ---------------------------------------------------------------------------
// The requirement datasheet — what a single enquiry line has to state before it
// can be quoted
// ---------------------------------------------------------------------------
// One schema, three groups, shared by the extraction (which decides what is
// missing) and the line-item detail drawer (which lets a human fill it in). The
// groups follow the instrument datasheet an enquiry is answered against:
// identity, the process the tag sits in, and how the instrument is built.
//
// Not every field applies to every line — an MCCB has no fluid viscosity — so a
// handful of labels and option lists are domain-aware, and only the fields in
// REQUIRED_FIELDS count towards a line's missing-field score. Everything else
// stays visible and editable but empty is not a fault.
// ---------------------------------------------------------------------------

/** What kind of line this is — decides tagging, labels and required fields. */
export type Domain = 'instrument' | 'mechanical' | 'electrical' | 'bulk';

export type FieldKind = 'text' | 'number' | 'select' | 'toggle';

export interface FieldSpec {
  key: string;
  label: string;
  kind: FieldKind;
  /** Datasheet term when this domain calls the same field something else. */
  labelBy?: Partial<Record<Domain, string>>;
  options?: string[];
  optionsBy?: Partial<Record<Domain, string[]>>;
  /** Fixed unit shown inside the control. */
  unit?: string;
  /** Unit taken from another field's current value (flow / pressure units). */
  unitFrom?: string;
  placeholder?: string;
  /** Spans the whole grid row. */
  wide?: boolean;
  /** Renders inside a named sub-block (the fluid nature flags). */
  group?: string;
}

export interface FieldSection {
  id: string;
  title: string;
  description: string;
  fields: FieldSpec[];
}

const MOC = [
  'SS 304',
  'SS 316',
  'SS 316L',
  'CS A105',
  'CF8M',
  'Hastelloy C-276',
  'PTFE lined CS',
  'Titanium',
  'PP',
  'PVDF',
];

export const REQUIREMENT_SECTIONS: FieldSection[] = [
  {
    id: 'identity',
    title: 'Identity',
    description: 'Which tag this line is, and how many of it.',
    fields: [
      {
        key: 'meterIdentity',
        label: 'Meter identity',
        kind: 'text',
        labelBy: { mechanical: 'Equipment identity', electrical: 'Feeder identity', bulk: 'Material identity' },
        placeholder: 'e.g. Electromagnetic flow meter — cooling water',
        wide: true,
      },
      { key: 'tag', label: 'Tag number', kind: 'text', placeholder: 'e.g. FT-1207' },
      {
        key: 'instrumentType',
        label: 'Instrument type / model',
        kind: 'text',
        labelBy: { mechanical: 'Equipment type / model', electrical: 'Equipment type / model', bulk: 'Material grade / type' },
        placeholder: 'e.g. Flanged electromagnetic, remote transmitter',
      },
      { key: 'service', label: 'Service', kind: 'text', placeholder: 'e.g. Cooling water header' },
      { key: 'quantity', label: 'Quantity', kind: 'number', unit: 'Nos' },
    ],
  },
  {
    id: 'process',
    title: 'Application and Process Conditions',
    description: 'The duty the tag has to hold — the numbers that size it.',
    fields: [
      { key: 'applicationName', label: 'Application name', kind: 'text', placeholder: 'e.g. Cooling water make-up metering', wide: true },
      { key: 'phase', label: 'Phase', kind: 'select', options: ['Liquid', 'Gas', 'Steam', 'Slurry', 'Two-phase'] },
      { key: 'fluidDensity', label: 'Fluid density', kind: 'number', unit: 'kg/m³' },
      { key: 'fluidViscosity', label: 'Viscosity', kind: 'number', unit: 'cP' },
      { key: 'specificGravity', label: 'Specific gravity', kind: 'number' },
      { key: 'flowUnit', label: 'Flow unit', kind: 'select', options: ['m³/h', 'LPM', 'kg/h', 'Nm³/h', 'TPH'] },
      { key: 'flowMin', label: 'Flow rate — minimum', kind: 'number', unitFrom: 'flowUnit' },
      { key: 'flowNormal', label: 'Flow rate — normal', kind: 'number', unitFrom: 'flowUnit' },
      { key: 'flowMax', label: 'Flow rate — maximum', kind: 'number', unitFrom: 'flowUnit' },
      { key: 'pressureUnit', label: 'Pressure unit', kind: 'select', options: ['bar g', 'kg/cm²g', 'psi g', 'kPa g'] },
      { key: 'tempMin', label: 'Operating temperature — minimum', kind: 'number', unit: '°C' },
      { key: 'tempMax', label: 'Operating temperature — maximum', kind: 'number', unit: '°C' },
      { key: 'pressMin', label: 'Operating pressure — minimum', kind: 'number', unitFrom: 'pressureUnit' },
      { key: 'pressMax', label: 'Operating pressure — maximum', kind: 'number', unitFrom: 'pressureUnit' },
      { key: 'corrosionRate', label: 'Corrosion strength / rate', kind: 'text', placeholder: 'e.g. < 0.1 mm/year' },
      { key: 'designPressure', label: 'Design pressure', kind: 'number', unitFrom: 'pressureUnit' },
      { key: 'testPressure', label: 'Test pressure', kind: 'number', unitFrom: 'pressureUnit' },
      { key: 'fluidCorrosive', label: 'Corrosive', kind: 'toggle', group: 'Fluid nature' },
      { key: 'fluidAbrasive', label: 'Abrasive / slurry', kind: 'toggle', group: 'Fluid nature' },
      { key: 'fluidToxic', label: 'Toxic', kind: 'toggle', group: 'Fluid nature' },
      { key: 'fluidFlammable', label: 'Flammable', kind: 'toggle', group: 'Fluid nature' },
      { key: 'fluidScaling', label: 'Scaling / fouling', kind: 'toggle', group: 'Fluid nature' },
    ],
  },
  {
    id: 'construction',
    title: 'Flow and Construction',
    description: 'How the instrument is built and what it is offered with.',
    fields: [
      { key: 'lineSize', label: 'Line size', kind: 'text', placeholder: 'e.g. 80 NB' },
      {
        key: 'connectionSize',
        label: 'Process connection size',
        kind: 'text',
        labelBy: { electrical: 'Cable entry size' },
        placeholder: 'e.g. 80 NB',
      },
      {
        key: 'connectionType',
        label: 'Process connection type',
        kind: 'select',
        labelBy: { mechanical: 'End connection type', electrical: 'Cable entry type' },
        options: ['Flanged', 'Wafer', 'Screwed (BSP)', 'Screwed (NPT)', 'Tri-clover', 'Butt-welded', 'Socket-welded'],
        optionsBy: { electrical: ['Double compression gland', 'Cable gland — Ex d', 'Plug-in terminal', 'Bus-bar'] },
      },
      {
        key: 'connectionStandard',
        label: 'Connection standard',
        kind: 'select',
        options: ['ANSI B16.5', 'ASME B16.5', 'DIN 2501', 'EN 1092-1', 'IS 6392', 'JIS B2220'],
        optionsBy: { electrical: ['IS/IEC 60947-2', 'IS/IEC 60947-4-1', 'IEC 61439'] },
      },
      { key: 'connectionMoc', label: 'Connection MOC', kind: 'select', options: MOC },
      {
        key: 'connectionRating',
        label: 'Flange rating',
        kind: 'select',
        labelBy: { mechanical: 'Pressure rating', electrical: 'Breaking capacity', bulk: 'Grade / specification' },
        options: ['150#', '300#', '600#', 'PN10', 'PN16', 'PN25', 'PN40'],
        optionsBy: { electrical: ['16 kA', '25 kA', '36 kA', '50 kA'] },
      },
      {
        key: 'areaClassification',
        label: 'Area classification / enclosure',
        kind: 'select',
        options: [
          'Safe area — IP65',
          'Safe area — IP67',
          'Weatherproof IP66',
          'Zone 2 — Ex n IIC T6',
          'Zone 1 — Ex d IIC T6',
          'Zone 0 — Ex ia IIC T6',
        ],
      },
      {
        key: 'bodyMoc',
        label: 'Body / housing MOC',
        kind: 'select',
        options: [...MOC, 'Die-cast aluminium', 'Powder-coated MS'],
      },
      {
        key: 'wettedMoc',
        label: 'Wetted parts MOC',
        kind: 'select',
        labelBy: { mechanical: 'Seat / trim material', electrical: 'Contact material', bulk: 'Pack material' },
        options: MOC,
      },
      { key: 'floatMoc', label: 'Float / displacer MOC', kind: 'select', options: MOC },
      {
        key: 'linerMaterial',
        label: 'Lining / liner material',
        kind: 'select',
        options: ['PTFE', 'PFA', 'Neoprene', 'Polyurethane', 'Hard rubber', 'Ebonite', 'None'],
      },
      {
        key: 'electrodeMaterial',
        label: 'Electrode material',
        kind: 'select',
        options: ['SS 316L', 'Hastelloy C-276', 'Titanium', 'Tantalum', 'Platinum-Iridium'],
      },
      { key: 'flowTubeMoc', label: 'Flow tube / chamber MOC', kind: 'select', options: MOC },
      { key: 'measuringTubeMaterial', label: 'Measuring tube material', kind: 'select', options: MOC },
      { key: 'conductiveFluid', label: 'Conductive fluid required (> 5 µS/cm)', kind: 'toggle' },
      {
        key: 'requiredAccuracy',
        label: 'Required accuracy',
        kind: 'select',
        options: ['± 0.2 % of rate', '± 0.5 % of rate', '± 1.0 % of rate', '± 1.5 % of FSD', '± 2.0 % of FSD'],
      },
      {
        key: 'output',
        label: 'Output / signal',
        kind: 'select',
        labelBy: { electrical: 'Control / coil voltage', bulk: 'Test certificate' },
        options: [
          '4–20 mA HART',
          '4–20 mA',
          'Pulse / frequency',
          'Modbus RTU (RS-485)',
          'Profibus DP',
          'Local indication only',
        ],
        optionsBy: {
          electrical: ['240 V AC', '110 V AC', '24 V DC', '415 V AC'],
          bulk: ['Mill test certificate', 'Batch test certificate', 'MSDS only', 'Not required'],
        },
      },
      {
        key: 'accessories',
        label: 'Accessories / scope of supply',
        kind: 'text',
        labelBy: { bulk: 'Pack size & scope of supply' },
        placeholder: 'e.g. Mating flanges, 10 m cable, mounting bracket',
        wide: true,
      },
    ],
  },
];

export const FIELD_SPECS: FieldSpec[] = REQUIREMENT_SECTIONS.flatMap((s) => s.fields);

export const FIELD_BY_KEY: Record<string, FieldSpec> = Object.fromEntries(
  FIELD_SPECS.map((f) => [f.key, f])
);

/**
 * The fields a quotation cannot be priced without, per kind of line, ordered by
 * how often they are the blocker — so the first missing field named on a card is
 * the one worth chasing.
 */
export const REQUIRED_FIELDS: Record<Domain, string[]> = {
  instrument: [
    'lineSize',
    'connectionType',
    'wettedMoc',
    'pressMax',
    'tempMax',
    'output',
    'connectionRating',
    'areaClassification',
  ],
  mechanical: ['lineSize', 'connectionType', 'bodyMoc', 'connectionRating', 'tempMax', 'wettedMoc'],
  electrical: ['connectionRating', 'output', 'areaClassification', 'instrumentType', 'connectionSize', 'bodyMoc'],
  bulk: ['instrumentType', 'connectionRating', 'output'],
};

/** The datasheet term this domain uses for a field. */
export function fieldLabel(spec: FieldSpec, domain: Domain): string {
  return spec.labelBy?.[domain] ?? spec.label;
}

export function fieldOptions(spec: FieldSpec, domain: Domain): string[] {
  return spec.optionsBy?.[domain] ?? spec.options ?? [];
}

export function isToggle(key: string): boolean {
  return FIELD_BY_KEY[key]?.kind === 'toggle';
}

// ---------------------------------------------------------------------------
// Validation — a stated value that cannot be true
// ---------------------------------------------------------------------------
// Only ever flags values that ARE there: an empty field is missing (yellow), not
// invalid (red), and the two never overlap.

function num(fields: Record<string, string>, key: string): number | null {
  const raw = (fields[key] ?? '').trim();
  if (!raw) return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

function isBadNumber(fields: Record<string, string>, key: string): boolean {
  const raw = (fields[key] ?? '').trim();
  return raw !== '' && !Number.isFinite(Number(raw));
}

/** Field key → why the stated value cannot stand. */
export function validateFields(fields: Record<string, string>, domain: Domain): Record<string, string> {
  const errors: Record<string, string> = {};

  for (const spec of FIELD_SPECS) {
    if (spec.kind === 'number' && isBadNumber(fields, spec.key)) {
      errors[spec.key] = 'Not a number';
    }
  }

  // Quantity is the one field a line cannot be read without — an enquiry the AI
  // could not pull a quantity from is an error, not merely incomplete.
  const qty = num(fields, 'quantity');
  if (!(fields.quantity ?? '').trim()) {
    errors.quantity = 'Could not be read from the enquiry — state the quantity';
  } else if (qty !== null && (qty <= 0 || !Number.isInteger(qty))) {
    errors.quantity = 'Must be a whole number above zero';
  }

  for (const key of ['fluidDensity', 'fluidViscosity', 'specificGravity'] as const) {
    const v = num(fields, key);
    if (v !== null && v <= 0) errors[key] = 'Must be above zero';
  }

  const pairs: [string, string, string][] = [
    ['flowMin', 'flowMax', 'Minimum flow exceeds the maximum'],
    ['tempMin', 'tempMax', 'Minimum temperature exceeds the maximum'],
    ['pressMin', 'pressMax', 'Minimum pressure exceeds the maximum'],
  ];
  for (const [lo, hi, message] of pairs) {
    const a = num(fields, lo);
    const b = num(fields, hi);
    if (a !== null && b !== null && a > b && !errors[lo]) errors[lo] = message;
  }

  const flowNormal = num(fields, 'flowNormal');
  const flowMin = num(fields, 'flowMin');
  const flowMax = num(fields, 'flowMax');
  if (flowNormal !== null && !errors.flowNormal) {
    if (flowMin !== null && flowNormal < flowMin) errors.flowNormal = 'Normal flow is below the minimum';
    else if (flowMax !== null && flowNormal > flowMax) errors.flowNormal = 'Normal flow is above the maximum';
  }

  const pressMax = num(fields, 'pressMax');
  const design = num(fields, 'designPressure');
  const test = num(fields, 'testPressure');
  if (design !== null && pressMax !== null && design < pressMax && !errors.designPressure) {
    errors.designPressure = 'Below the maximum operating pressure';
  }
  if (test !== null && design !== null && test < design && !errors.testPressure) {
    errors.testPressure = 'Below the design pressure';
  }

  // A magnetic flow meter only reads a conductive fluid — saying it does not
  // conduct while asking for electrodes is a contradiction, not a gap.
  if (domain === 'instrument' && fields.conductiveFluid === 'no' && (fields.electrodeMaterial ?? '').trim()) {
    errors.conductiveFluid = 'Electrodes are specified — a magnetic meter needs a conductive fluid';
  }

  return errors;
}

/** The required fields this line still has not stated. */
export function missingKeysOf(fields: Record<string, string>, domain: Domain): string[] {
  return REQUIRED_FIELDS[domain].filter((key) => !(fields[key] ?? '').trim());
}
