import { useState, useRef } from 'react';
import { Upload, FileText, X, Check, AlertCircle, Loader2, ChevronRight, ChevronDown } from 'lucide-react';
import { read as xlsxRead, utils as xlsxUtils } from 'xlsx';
import { supabase } from '../../lib/supabase';
import { insertRow, logActivity, createNotification } from '../../lib/hooks';
import { FormField, inputCls, selectCls, textareaCls } from './DataStates';

// ─── Types ────────────────────────────────────────────────────────────────────

interface ManifestRow {
  _id: string;
  product_title: string;
  brand: string;
  model: string;
  category: string;
  // condition intentionally absent — set by technician after inspection
  msrp: string;
  sku: string;
  upc: string;
  serial: string;
  notes: string;
  needs_review: boolean;
  needs_msrp_review: boolean;
}

// One entry per target field; sourceIdx = -1 means not mapped
interface FieldMapping {
  field: string;
  sourceIdx: number;
}

interface FieldDef {
  field: string;
  label: string;
  priorities: string[]; // in priority order; matched after normalization
}

interface LotForm {
  vendor_id: string;
  funding_partner_id: string;
  purchase_price: string;
  freight_cost: string;
  handling_cost: string;
  purchase_date: string;
  arrival_date: string;
  truckload_number: string;
  pallet_count: string;
  liquidation_source: string;
  notes: string;
}

interface ParseResult {
  rows: ManifestRow[];
  fieldMappings: FieldMapping[];
  rawHeaders: string[];
  rawData: any[][];
}

// ─── Header normalization ─────────────────────────────────────────────────────

function normalizeHeader(h: string): string {
  return String(h ?? '')
    .toLowerCase()
    .replace(/[_\-]/g, ' ')        // underscores/hyphens → space
    .replace(/[^a-z0-9\s]/g, ' ')  // remaining punctuation → space
    .replace(/\s+/g, ' ')           // collapse spaces
    .trim();
}

function parseMoney(val: any): string {
  if (val == null || val === '') return '';
  const s = String(val).replace(/[$,\s]/g, '');
  const n = parseFloat(s);
  return isNaN(n) ? '' : String(n);
}

// ─── Field definitions with ordered priority aliases ──────────────────────────
//
// For each field, aliases are tried in priority order against normalized headers.
// The highest-priority match wins. Once a column is claimed, it cannot be reused.
// Condition is intentionally excluded — set during inspection, not at import.

const FIELD_DEFS: FieldDef[] = [
  {
    field: 'product_title',
    label: 'Product Title',
    // NEVER matches: Product Number, Item Number, Model Number, Part Number,
    // SKU, UPC, Barcode, Serial, Serial Number, Lot Number, Asset Number
    priorities: [
      'product title', 'title', 'product', 'item title', 'item name',
      'product description', 'item description', 'merchandise description', 'description',
    ],
  },
  {
    field: 'brand',
    label: 'Brand',
    // Vendor is lowest priority — only used when Brand/Manufacturer/Make absent (B-Stock)
    priorities: ['brand', 'manufacturer', 'make', 'vendor'],
  },
  {
    field: 'model',
    label: 'Model',
    // "Model #" normalizes to "model"; "Model No." normalizes to "model no"
    priorities: ['model', 'model number', 'model no', 'product model', 'item model'],
  },
  {
    field: 'category',
    label: 'Category',
    priorities: [
      'category', 'product category', 'item category', 'department', 'class', 'type',
    ],
  },
  {
    field: '_qty',
    label: 'Quantity',
    priorities: ['quantity', 'qty', 'units', 'unit count', 'count'],
  },
  {
    field: 'msrp',
    label: 'Unit Retail / MSRP',
    // Unit Retail is highest priority (B-Stock pattern)
    priorities: [
      'unit retail', 'msrp', 'unit msrp', 'retail price', 'unit retail price',
      'original retail', 'original retail price', 'estimated retail',
      'estimated retail price', 'list price',
    ],
  },
  {
    field: 'sku',
    label: 'SKU',
    priorities: [
      'sku', 'item sku', 'seller sku', 'product sku',
      'item number', 'product number', 'part number', 'stock keeping unit',
    ],
  },
  {
    field: 'upc',
    label: 'UPC',
    priorities: ['upc', 'barcode', 'gtin', 'ean'],
  },
  {
    field: 'serial',
    label: 'Serial',
    // "Serial #" → normalized → "serial"; "S/N" → "s n"
    priorities: ['serial number', 'serial', 'sn', 's n', 'imei'],
  },
  {
    field: 'notes',
    label: 'Notes',
    priorities: ['notes', 'note', 'comments', 'comment'],
  },
];

// ─── Priority-based column detection ─────────────────────────────────────────

function detectFieldMappings(headers: string[]): FieldMapping[] {
  // Build normalized-header → first column index map
  const normToIdx = new Map<string, number>();
  headers.forEach((h, i) => {
    const n = normalizeHeader(h);
    if (!normToIdx.has(n)) normToIdx.set(n, i);
  });

  const usedIdxs = new Set<number>();

  return FIELD_DEFS.map(({ field, priorities }) => {
    for (const alias of priorities) {
      const normAlias = normalizeHeader(alias);
      const idx = normToIdx.get(normAlias);
      if (idx !== undefined && !usedIdxs.has(idx)) {
        usedIdxs.add(idx);
        return { field, sourceIdx: idx };
      }
    }
    return { field, sourceIdx: -1 };
  });
}

// ─── Apply field mappings to raw data ─────────────────────────────────────────

function applyMappings(rawData: any[][], fieldMappings: FieldMapping[]): ManifestRow[] {
  const fmByField = new Map(fieldMappings.map(m => [m.field, m.sourceIdx]));

  const getStr = (raw: any[], field: string): string => {
    const idx = fmByField.get(field);
    if (idx === undefined || idx < 0) return '';
    const val = raw[idx];
    if (val == null) return '';
    return String(val).trim();
  };

  const rows: ManifestRow[] = [];
  let counter = 0;

  for (const raw of rawData) {
    if (!raw || !raw.some((c: any) => c != null && String(c).trim() !== '')) continue;

    const qtyStr = getStr(raw, '_qty');
    const qty = Math.max(1, parseInt(qtyStr) || 1);

    const productTitle = getStr(raw, 'product_title');
    const msrp = parseMoney(getStr(raw, 'msrp'));
    const msrpNum = parseFloat(msrp);

    for (let q = 0; q < qty; q++) {
      rows.push({
        _id: String(++counter),
        product_title: productTitle,
        brand:    getStr(raw, 'brand'),
        model:    getStr(raw, 'model'),
        category: getStr(raw, 'category'),
        msrp,
        sku:    qty > 1 ? '' : getStr(raw, 'sku'),
        upc:    qty > 1 ? '' : getStr(raw, 'upc'),
        serial: qty > 1 ? '' : getStr(raw, 'serial'),
        notes:  getStr(raw, 'notes'),
        needs_review:      productTitle.trim() === '',
        needs_msrp_review: msrp === '' || isNaN(msrpNum) || msrpNum <= 0,
      });
    }
  }

  return rows;
}

// ─── Review flag recompute (for inline editing) ───────────────────────────────

function recomputeFlags(r: ManifestRow): ManifestRow {
  const msrpNum = parseFloat(r.msrp);
  return {
    ...r,
    needs_review:      r.product_title.trim() === '',
    needs_msrp_review: r.msrp.trim() === '' || isNaN(msrpNum) || msrpNum <= 0,
  };
}

// ─── Spreadsheet parser ───────────────────────────────────────────────────────

async function parseSpreadsheet(file: File): Promise<ParseResult> {
  const buffer = await file.arrayBuffer();
  const workbook = xlsxRead(buffer, { type: 'array' });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const rawRows = xlsxUtils.sheet_to_json<any[]>(sheet, { header: 1 });

  if (rawRows.length < 2) {
    throw new Error('No data rows found. File needs a header row plus at least one data row.');
  }

  const rawHeaders = (rawRows[0] as any[]).map((h: any) => String(h ?? '').trim());
  const rawData = rawRows.slice(1) as any[][];
  const fieldMappings = detectFieldMappings(rawHeaders);
  const rows = applyMappings(rawData, fieldMappings);

  if (rows.length === 0) {
    throw new Error('No valid rows found after parsing. Verify your file has recognizable column headers.');
  }

  return { rows, fieldMappings, rawHeaders, rawData };
}

// ─── Review table columns (condition excluded — set during inspection) ────────

const TABLE_COLS: { key: string; label: string; minW: number; inputType?: string }[] = [
  { key: 'product_title', label: 'Product Title',       minW: 200 },
  { key: 'brand',         label: 'Brand',               minW: 100 },
  { key: 'model',         label: 'Model',               minW: 100 },
  { key: 'category',      label: 'Category',            minW: 100 },
  { key: 'msrp',          label: 'Unit Retail / MSRP',  minW: 105, inputType: 'number' },
  { key: 'sku',           label: 'SKU',                 minW: 90  },
  { key: 'upc',           label: 'UPC',                 minW: 100 },
  { key: 'serial',        label: 'Serial',              minW: 100 },
  { key: 'notes',         label: 'Notes',               minW: 120 },
];

// ─── Constants ────────────────────────────────────────────────────────────────

const EMPTY_LOT: LotForm = {
  vendor_id: '', funding_partner_id: '', purchase_price: '', freight_cost: '',
  handling_cost: '', purchase_date: '', arrival_date: '', truckload_number: '',
  pallet_count: '', liquidation_source: '', notes: '',
};

const STEP_LABELS = ['Upload & Details', 'Parse', 'Review', 'Done'];

// Brand aliases that are direct (not inferred from vendor fallback)
const BRAND_DIRECT = new Set(['brand', 'manufacturer', 'make']);

// ─── Component ────────────────────────────────────────────────────────────────

interface Props {
  open: boolean;
  onClose: () => void;
  orgId: string | null;
  userId: string | undefined;
  vendors: any[];
  partners: any[];
  onCreated: () => void;
}

export function ManifestImportModal({ open, onClose, orgId, userId, vendors, partners, onCreated }: Props) {
  const [step, setStep] = useState(1);
  const [lotForm, setLotForm] = useState<LotForm>(EMPTY_LOT);
  const [manifestFile, setManifestFile] = useState<File | null>(null);
  const [invoiceFile, setInvoiceFile] = useState<File | null>(null);
  const [rows, setRows] = useState<ManifestRow[]>([]);
  const [fieldMappings, setFieldMappings] = useState<FieldMapping[]>([]);
  const [rawHeaders, setRawHeaders] = useState<string[]>([]);
  const [rawData, setRawData] = useState<any[][]>([]);
  const [showMappingPanel, setShowMappingPanel] = useState(true);
  const [isPdf, setIsPdf] = useState(false);
  const [pdfDone, setPdfDone] = useState(false);
  const [parsing, setParsing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [acknowledgedReview, setAcknowledgedReview] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successLotId, setSuccessLotId] = useState<string | null>(null);
  const manifestRef = useRef<HTMLInputElement>(null);
  const invoiceRef = useRef<HTMLInputElement>(null);

  const setLF = (k: keyof LotForm, v: string) => setLotForm(f => ({ ...f, [k]: v }));

  const updateRowField = (id: string, field: string, val: string) => {
    setRows(prev => prev.map(r =>
      r._id !== id ? r : recomputeFlags({ ...r, [field]: val })
    ));
  };

  const updateFieldMapping = (field: string, newSourceIdx: number) => {
    setFieldMappings(prev => {
      const next = prev.map(m => m.field === field ? { ...m, sourceIdx: newSourceIdx } : m);
      setRows(applyMappings(rawData, next));
      return next;
    });
  };

  const reset = () => {
    setStep(1); setLotForm(EMPTY_LOT); setManifestFile(null); setInvoiceFile(null);
    setRows([]); setFieldMappings([]); setRawHeaders([]); setRawData([]);
    setShowMappingPanel(true); setAcknowledgedReview(false);
    setIsPdf(false); setPdfDone(false);
    setParsing(false); setConfirming(false); setError(null); setSuccessLotId(null);
  };

  const handleClose = () => { reset(); onClose(); };

  const onManifestFile = (f: File | null) => {
    setManifestFile(f);
    setIsPdf(!!f && f.name.split('.').pop()?.toLowerCase() === 'pdf');
  };

  // ── Step 1 → 2 ────────────────────────────────────────────────────────────

  const goStep2 = async () => {
    if (!manifestFile) { setError('Please select a manifest file.'); return; }
    setError(null);
    setStep(2);
    setParsing(true);

    const ext = manifestFile.name.split('.').pop()?.toLowerCase();

    if (ext === 'pdf') {
      try {
        const safeName = manifestFile.name.replace(/[^a-zA-Z0-9._-]/g, '_');
        const path = `${orgId}/${Date.now()}-${safeName}`;
        const { error: upErr } = await supabase.storage
          .from('make-1b9ff536-manifests')
          .upload(path, manifestFile, { contentType: 'application/pdf', upsert: false });
        if (upErr) throw new Error(upErr.message);
        await insertRow('manifest_imports', {
          organization_id: orgId!,
          status: 'NEEDS_AI_PARSE',
          file_type: 'pdf',
          file_path: path,
          item_count: 0,
        });
        void createNotification(
          orgId!,
          'PDF manifest uploaded',
          `${manifestFile!.name} is queued for AI extraction. You'll be notified when complete.`,
          { userId, priority: 'low', route: '/lot-intake/all' }
        );
        setPdfDone(true);
      } catch (e: any) {
        setError(`PDF upload failed: ${e.message}`);
        setStep(1);
      }
      setParsing(false);
      return;
    }

    try {
      const result = await parseSpreadsheet(manifestFile);
      setRows(result.rows);
      setFieldMappings(result.fieldMappings);
      setRawHeaders(result.rawHeaders);
      setRawData(result.rawData);
      setAcknowledgedReview(false);
      setStep(3);
    } catch (e: any) {
      setError(`Parse error: ${e.message}`);
      setStep(1);
    }
    setParsing(false);
  };

  // ── Step 3 → 4 ────────────────────────────────────────────────────────────

  const handleConfirm = async () => {
    setConfirming(true);
    setError(null);
    try {
      const { data: intakeLocs } = await supabase
        .from('warehouse_locations')
        .select('id')
        .eq('organization_id', orgId)
        .eq('area_type', 'INTAKE')
        .or('is_active.eq.true,status.eq.active')
        .limit(1);
      const intakeLocId: string | null = intakeLocs?.[0]?.id ?? null;

      const purchase  = parseFloat(lotForm.purchase_price) || 0;
      const freight   = parseFloat(lotForm.freight_cost)   || 0;
      const handling  = parseFloat(lotForm.handling_cost)  || 0;
      const landedCost = purchase + freight + handling;
      const totalMsrp  = rows.reduce((s, r) => s + (parseFloat(r.msrp) || 0), 0);

      const { data: lot, error: lotErr } = await insertRow('lots', {
        organization_id:    orgId!,
        location_id:        null,
        status:             'PROCESSING',
        vendor_id:          lotForm.vendor_id          || null,
        funding_partner_id: lotForm.funding_partner_id || null,
        purchase_date:      lotForm.purchase_date      || null,
        arrival_date:       lotForm.arrival_date       || null,
        purchase_price:     purchase  || null,
        freight_cost:       freight   || null,
        handling_cost:      handling  || null,
        total_msrp:         totalMsrp || null,
        truckload_number:   lotForm.truckload_number   || null,
        pallet_count:       parseInt(lotForm.pallet_count) || null,
        liquidation_source: lotForm.liquidation_source || null,
        notes:              lotForm.notes              || null,
      });
      if (lotErr || !lot?.id) throw new Error(lotErr ?? 'LOT creation failed.');
      const lotId: string = lot.id;

      const items = rows.map(r => {
        const msrp = parseFloat(r.msrp) || null;
        const weight = totalMsrp > 0 && msrp
          ? msrp / totalMsrp
          : rows.length > 0 ? 1 / rows.length : 0;
        const wac = landedCost > 0 ? parseFloat((landedCost * weight).toFixed(2)) : null;
        return {
          organization_id:           orgId!,
          lot_id:                    lotId,
          product_title:             r.product_title  || 'Untitled Item',
          brand:                     r.brand          || null,
          model:                     r.model          || null,
          category:                  r.category       || null,
          condition:                 null,  // set during inspection/testing
          grade:                     null,
          sku:                       r.sku            || null,
          upc:                       r.upc            || null,
          serial_number:             r.serial         || null,
          notes:                     r.notes          || null,
          msrp,
          current_asking_price:      msrp,
          weighted_acquisition_cost: wac,
          status:                    'UNPROCESSED',
          warehouse_location_id:     intakeLocId,
        };
      });

      for (let i = 0; i < items.length; i += 50) {
        const { error: iErr } = await supabase.from('inventory_items').insert(items.slice(i, i + 50));
        if (iErr) throw new Error(`Inventory insert failed: ${iErr.message}`);
      }

      // best-effort record — don't block if schema differs
      void insertRow('manifest_imports', {
        organization_id: orgId!,
        status:          'CONFIRMED',
        file_type:       manifestFile!.name.split('.').pop()?.toLowerCase() ?? 'csv',
        item_count:      rows.length,
      });

      await logActivity(
        orgId!, userId!,
        `Manifest imported: ${rows.length} item${rows.length !== 1 ? 's' : ''} → LOT #${lotId.slice(0, 8).toUpperCase()}`,
        'lots', lotId, 'manifest_import'
      );

      void createNotification(
        orgId!,
        'Manifest imported',
        `${rows.length} item${rows.length !== 1 ? 's' : ''} added to LOT #${lotId.slice(0, 8).toUpperCase()}`,
        { userId, entityType: 'lots', entityId: lotId, route: `/lot-intake/all?selected=${lotId}`, priority: 'medium' }
      );

      const reviewCount = rows.filter(r => r.needs_review).length;
      if (reviewCount > 0) {
        void createNotification(
          orgId!,
          'Manifest needs review',
          `${reviewCount} item${reviewCount !== 1 ? 's' : ''} in LOT #${lotId.slice(0, 8).toUpperCase()} need product title review`,
          { userId, entityType: 'lots', entityId: lotId, route: `/lot-intake/all?selected=${lotId}`, priority: 'high' }
        );
      }

      setSuccessLotId(lotId);
      setStep(4);
      onCreated();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setConfirming(false);
    }
  };

  if (!open) return null;

  const needsReview = rows.filter(r => r.needs_review).length;
  const needsMsrp   = rows.filter(r => r.needs_msrp_review && !r.needs_review).length;
  const modalWidth  = step === 3 ? 'max-w-6xl' : 'max-w-2xl';

  // Detect if brand was inferred from vendor (not a direct brand column)
  const brandMapping = fieldMappings.find(m => m.field === 'brand');
  const brandIsInferred = brandMapping && brandMapping.sourceIdx >= 0 &&
    !BRAND_DIRECT.has(normalizeHeader(rawHeaders[brandMapping.sourceIdx] ?? ''));

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/30 backdrop-blur-[2px]" onClick={handleClose} />
      <div
        className={`relative w-full ${modalWidth} bg-white rounded-2xl shadow-2xl flex flex-col overflow-hidden transition-all duration-150`}
        style={{ maxHeight: '90vh' }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[rgba(0,0,0,0.07)] flex-shrink-0">
          <h2 className="text-[15px] font-semibold text-gray-900">Import Manifest</h2>
          <button onClick={handleClose} className="w-7 h-7 rounded-md hover:bg-gray-100 flex items-center justify-center text-gray-400 hover:text-gray-700 transition-colors text-lg leading-none">×</button>
        </div>

        {/* Step indicator */}
        <div className="px-6 pt-4 pb-2 flex-shrink-0">
          <div className="flex items-center">
            {STEP_LABELS.map((label, i) => {
              const n = i + 1;
              const done = step > n;
              const active = step === n;
              return (
                <div key={n} className={`flex items-center ${n < 4 ? 'flex-1' : ''}`}>
                  <div className="flex items-center gap-1.5 flex-shrink-0">
                    <div className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold flex-shrink-0 ${done ? 'bg-[#3ECF8E] text-white' : active ? 'bg-gray-900 text-white' : 'bg-gray-100 text-gray-400'}`}>
                      {done ? '✓' : n}
                    </div>
                    <span className={`text-[11px] whitespace-nowrap ${active ? 'font-medium text-gray-900' : done ? 'text-[#3ECF8E]' : 'text-gray-400'}`}>{label}</span>
                  </div>
                  {n < 4 && <div className={`flex-1 h-px mx-2 ${done ? 'bg-[#3ECF8E]' : 'bg-gray-200'}`} />}
                </div>
              );
            })}
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-4">
          {error && (
            <div className="mb-4 flex items-start gap-2 text-[12px] text-red-600 bg-red-50 px-3 py-2.5 rounded-lg">
              <AlertCircle size={13} className="flex-shrink-0 mt-0.5" />
              {error}
            </div>
          )}

          {/* ── STEP 1: Upload + LOT Details ── */}
          {step === 1 && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <FormField label="Manifest File" required>
                  <div
                    onClick={() => manifestRef.current?.click()}
                    className={`flex items-center gap-3 px-3 py-3 border-2 border-dashed rounded-lg cursor-pointer transition-colors ${manifestFile ? 'border-[#3ECF8E]/60 bg-[#ECFDF5]' : 'border-gray-200 hover:border-gray-300 bg-gray-50'}`}
                  >
                    <FileText size={16} className={manifestFile ? 'text-[#3ECF8E]' : 'text-gray-400'} />
                    <div className="flex-1 min-w-0">
                      <p className="text-[12px] font-medium text-gray-700 truncate">{manifestFile?.name ?? 'Choose file'}</p>
                      <p className="text-[11px] text-gray-400">CSV, XLSX, PDF</p>
                    </div>
                    {manifestFile && (
                      <button className="flex-shrink-0" onClick={e => { e.stopPropagation(); onManifestFile(null); if (manifestRef.current) manifestRef.current.value = ''; }}>
                        <X size={13} className="text-gray-400 hover:text-gray-700" />
                      </button>
                    )}
                  </div>
                  <input ref={manifestRef} type="file" accept=".csv,.xlsx,.xls,.pdf" className="hidden"
                    onChange={e => onManifestFile(e.target.files?.[0] ?? null)} />
                </FormField>

                <FormField label="Invoice File (optional)">
                  <div
                    onClick={() => invoiceRef.current?.click()}
                    className={`flex items-center gap-3 px-3 py-3 border-2 border-dashed rounded-lg cursor-pointer transition-colors ${invoiceFile ? 'border-[#3ECF8E]/60 bg-[#ECFDF5]' : 'border-gray-200 hover:border-gray-300 bg-gray-50'}`}
                  >
                    <Upload size={14} className={invoiceFile ? 'text-[#3ECF8E]' : 'text-gray-400'} />
                    <div className="flex-1 min-w-0">
                      <p className="text-[12px] font-medium text-gray-700 truncate">{invoiceFile?.name ?? 'Choose file'}</p>
                      <p className="text-[11px] text-gray-400">PDF, JPG, PNG</p>
                    </div>
                    {invoiceFile && (
                      <button className="flex-shrink-0" onClick={e => { e.stopPropagation(); setInvoiceFile(null); if (invoiceRef.current) invoiceRef.current.value = ''; }}>
                        <X size={13} className="text-gray-400 hover:text-gray-700" />
                      </button>
                    )}
                  </div>
                  <input ref={invoiceRef} type="file" accept=".pdf,.jpg,.jpeg,.png" className="hidden"
                    onChange={e => setInvoiceFile(e.target.files?.[0] ?? null)} />
                </FormField>
              </div>

              <div className="h-px bg-[rgba(0,0,0,0.05)]" />

              <div className="grid grid-cols-2 gap-4">
                <FormField label="Vendor">
                  <select className={selectCls} value={lotForm.vendor_id} onChange={e => setLF('vendor_id', e.target.value)}>
                    <option value="">— No vendor —</option>
                    {vendors.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
                  </select>
                </FormField>
                <FormField label="Funding Partner">
                  <select className={selectCls} value={lotForm.funding_partner_id} onChange={e => setLF('funding_partner_id', e.target.value)}>
                    <option value="">— No partner —</option>
                    {partners.map(p => <option key={p.id} value={p.id}>{p.company_name ?? p.name}</option>)}
                  </select>
                </FormField>
              </div>

              <div className="grid grid-cols-3 gap-4">
                <FormField label="Purchase Price ($)">
                  <input type="number" className={inputCls} value={lotForm.purchase_price} onChange={e => setLF('purchase_price', e.target.value)} placeholder="0.00" min="0" step="0.01" />
                </FormField>
                <FormField label="Freight Cost ($)">
                  <input type="number" className={inputCls} value={lotForm.freight_cost} onChange={e => setLF('freight_cost', e.target.value)} placeholder="0.00" min="0" step="0.01" />
                </FormField>
                <FormField label="Handling Cost ($)">
                  <input type="number" className={inputCls} value={lotForm.handling_cost} onChange={e => setLF('handling_cost', e.target.value)} placeholder="0.00" min="0" step="0.01" />
                </FormField>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <FormField label="Purchase Date">
                  <input type="date" className={inputCls} value={lotForm.purchase_date} onChange={e => setLF('purchase_date', e.target.value)} />
                </FormField>
                <FormField label="Arrival Date">
                  <input type="date" className={inputCls} value={lotForm.arrival_date} onChange={e => setLF('arrival_date', e.target.value)} />
                </FormField>
              </div>

              <div className="grid grid-cols-3 gap-4">
                <FormField label="Truckload #">
                  <input type="text" className={inputCls} value={lotForm.truckload_number} onChange={e => setLF('truckload_number', e.target.value)} placeholder="TL-001" />
                </FormField>
                <FormField label="Pallet Count">
                  <input type="number" className={inputCls} value={lotForm.pallet_count} onChange={e => setLF('pallet_count', e.target.value)} placeholder="0" min="0" />
                </FormField>
                <FormField label="Liquidation Source">
                  <input type="text" className={inputCls} value={lotForm.liquidation_source} onChange={e => setLF('liquidation_source', e.target.value)} placeholder="e.g. B-Stock" />
                </FormField>
              </div>

              <FormField label="Notes">
                <textarea className={textareaCls} rows={2} value={lotForm.notes} onChange={e => setLF('notes', e.target.value)} placeholder="Optional notes..." />
              </FormField>
            </div>
          )}

          {/* ── STEP 2: Parse ── */}
          {step === 2 && (
            <div className="py-14 flex flex-col items-center justify-center gap-4">
              {parsing ? (
                <>
                  <Loader2 size={28} className="animate-spin text-[#3ECF8E]" />
                  <p className="text-[14px] font-medium text-gray-700">
                    {isPdf ? 'Uploading PDF manifest…' : 'Parsing manifest…'}
                  </p>
                  <p className="text-[12px] text-gray-400">This will only take a moment.</p>
                </>
              ) : pdfDone ? (
                <>
                  <div className="w-12 h-12 rounded-full bg-[#ECFDF5] flex items-center justify-center">
                    <Check size={22} className="text-[#3ECF8E]" />
                  </div>
                  <p className="text-[14px] font-medium text-gray-900">PDF uploaded</p>
                  <p className="text-[13px] text-gray-500 text-center max-w-sm">
                    AI extraction will process this manifest and create inventory records automatically. You'll be notified when it's complete.
                  </p>
                </>
              ) : null}
            </div>
          )}

          {/* ── STEP 3: Review ── */}
          {step === 3 && (
            <div>
              {/* Column mapping panel */}
              <div className="mb-3 border border-[rgba(0,0,0,0.07)] rounded-xl overflow-hidden">
                <button
                  className="w-full flex items-center justify-between px-3 py-2.5 bg-gray-50 hover:bg-gray-100 transition-colors text-left"
                  onClick={() => setShowMappingPanel(v => !v)}
                >
                  <div className="flex items-center gap-2">
                    <span className="text-[12px] font-medium text-gray-700">Column Mapping</span>
                    {brandIsInferred && (
                      <span className="text-[10px] text-amber-700 bg-amber-50 px-1.5 py-0.5 rounded-full border border-amber-200/60">
                        Brand ← {rawHeaders[brandMapping!.sourceIdx]} (auto)
                      </span>
                    )}
                  </div>
                  <ChevronDown size={13} className={`text-gray-400 transition-transform duration-150 ${showMappingPanel ? 'rotate-180' : ''}`} />
                </button>
                {showMappingPanel && (
                  <div className="px-4 py-3 border-t border-[rgba(0,0,0,0.05)] space-y-2">
                    {FIELD_DEFS.map(def => {
                      const mapping = fieldMappings.find(m => m.field === def.field);
                      const currentIdx = mapping?.sourceIdx ?? -1;
                      const isInferred = def.field === 'brand' && currentIdx >= 0 &&
                        !BRAND_DIRECT.has(normalizeHeader(rawHeaders[currentIdx] ?? ''));
                      const sourceName = currentIdx >= 0 ? (rawHeaders[currentIdx] || `Column ${currentIdx + 1}`) : '';
                      return (
                        <div key={def.field} className="flex items-center gap-2 min-w-0">
                          <span className="text-[12px] text-gray-600 w-[130px] shrink-0">{def.label}</span>
                          <span className="text-[11px] text-gray-300 shrink-0">←</span>
                          <select
                            className="flex-1 text-[12px] border border-[rgba(0,0,0,0.1)] rounded px-2 py-1 bg-white min-w-0"
                            value={String(currentIdx)}
                            onChange={e => updateFieldMapping(def.field, parseInt(e.target.value))}
                          >
                            <option value="-1">— Not mapped —</option>
                            {rawHeaders.map((h, i) => (
                              <option key={i} value={String(i)}>{h || `Column ${i + 1}`}</option>
                            ))}
                          </select>
                          {currentIdx >= 0 && (
                            <span className="text-[11px] text-gray-400 shrink-0 max-w-[100px] truncate" title={sourceName}>
                              {sourceName}
                            </span>
                          )}
                          {isInferred && (
                            <span className="text-[10px] text-amber-600 shrink-0 font-medium">auto</span>
                          )}
                        </div>
                      );
                    })}
                    <p className="text-[11px] text-gray-400 pt-1">
                      Condition is not imported — it will be set during inspection.
                    </p>
                  </div>
                )}
              </div>

              {/* Summary bar */}
              <div className="flex items-center justify-between mb-3">
                <p className="text-[13px] text-gray-600">
                  {rows.length} item{rows.length !== 1 ? 's' : ''} detected. Edit any field before confirming.
                </p>
                <div className="flex items-center gap-2">
                  {needsReview > 0 && (
                    <span className="flex items-center gap-1 text-[11px] text-amber-700 bg-amber-50 px-2 py-0.5 rounded-full">
                      <AlertCircle size={10} />{needsReview} Needs Review
                    </span>
                  )}
                  {needsMsrp > 0 && (
                    <span className="flex items-center gap-1 text-[11px] text-orange-700 bg-orange-50 px-2 py-0.5 rounded-full">
                      <AlertCircle size={10} />{needsMsrp} No MSRP
                    </span>
                  )}
                </div>
              </div>

              <div className="border border-[rgba(0,0,0,0.07)] rounded-xl overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-[12px]">
                    <thead>
                      <tr className="border-b border-[rgba(0,0,0,0.06)] bg-gray-50">
                        <th className="pl-3 pr-2 py-2 text-left text-[10px] font-medium text-gray-400 uppercase tracking-wide w-8">#</th>
                        {TABLE_COLS.map(c => (
                          <th key={c.key} className="px-2 py-2 text-left text-[10px] font-medium text-gray-400 uppercase tracking-wide whitespace-nowrap">{c.label}</th>
                        ))}
                        <th className="px-3 py-2 text-left text-[10px] font-medium text-gray-400 uppercase tracking-wide whitespace-nowrap">Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((row, i) => {
                        const bgCls = row.needs_review
                          ? 'bg-amber-50/40'
                          : row.needs_msrp_review
                          ? 'bg-orange-50/20'
                          : '';
                        return (
                          <tr key={row._id} className={`border-b border-[rgba(0,0,0,0.04)] last:border-0 ${bgCls}`}>
                            <td className="pl-3 pr-2 py-1.5 text-[11px] text-gray-400">{i + 1}</td>
                            {TABLE_COLS.map(col => (
                              <td key={col.key} className="px-1 py-1">
                                <input
                                  type={col.inputType ?? 'text'}
                                  value={(row as any)[col.key]}
                                  onChange={e => updateRowField(row._id, col.key, e.target.value)}
                                  style={{ minWidth: col.minW }}
                                  className="px-2 py-1 text-[12px] bg-transparent border border-transparent hover:border-gray-200 focus:border-[#3ECF8E] focus:bg-white focus:outline-none rounded transition-colors w-full"
                                />
                              </td>
                            ))}
                            <td className="px-3 py-1.5 whitespace-nowrap">
                              {row.needs_review ? (
                                <span className="inline-flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-amber-50 text-amber-700">
                                  <AlertCircle size={9} />Needs Review
                                </span>
                              ) : row.needs_msrp_review ? (
                                <span className="inline-flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-orange-50 text-orange-700">
                                  <AlertCircle size={9} />No MSRP
                                </span>
                              ) : (
                                <span className="inline-flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-[#ECFDF5] text-[#15803d]">
                                  <Check size={9} />OK
                                </span>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {/* ── STEP 4: Done ── */}
          {step === 4 && (
            <div className="py-14 flex flex-col items-center justify-center gap-4">
              <div className="w-12 h-12 rounded-full bg-[#ECFDF5] flex items-center justify-center">
                <Check size={22} className="text-[#3ECF8E]" />
              </div>
              <p className="text-[14px] font-medium text-gray-900">Manifest imported successfully</p>
              <p className="text-[13px] text-gray-500 text-center max-w-sm">
                {rows.length} item{rows.length !== 1 ? 's' : ''} added to a new LOT.{' '}
                {successLotId && (
                  <span className="font-mono font-medium text-gray-700">
                    #{successLotId.slice(0, 8).toUpperCase()}
                  </span>
                )}
              </p>
              <p className="text-[12px] text-gray-400 text-center max-w-xs">
                Condition and grade will be assigned during inspection.
              </p>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-[rgba(0,0,0,0.07)] flex items-center justify-between flex-shrink-0">
          <div>
            {step === 3 && !confirming && (
              <button
                onClick={() => {
                  setError(null); setRows([]); setFieldMappings([]);
                  setRawHeaders([]); setRawData([]); setShowMappingPanel(true); setStep(1);
                }}
                className="px-4 py-2 text-[13px] text-gray-600 border border-[rgba(0,0,0,0.1)] rounded-lg hover:bg-gray-50"
              >
                Back
              </button>
            )}
          </div>

          <div className="flex gap-2">
            {step === 1 && (
              <>
                <button onClick={handleClose} className="px-4 py-2 text-[13px] text-gray-600 border border-[rgba(0,0,0,0.1)] rounded-lg hover:bg-gray-50">
                  Cancel
                </button>
                <button
                  onClick={goStep2}
                  disabled={!manifestFile}
                  className="flex items-center gap-1.5 px-4 py-2 text-[13px] font-medium bg-[#3ECF8E] hover:bg-[#38c484] text-white rounded-lg disabled:opacity-50 transition-colors"
                >
                  Parse Manifest <ChevronRight size={13} />
                </button>
              </>
            )}

            {step === 2 && pdfDone && (
              <button onClick={handleClose} className="px-4 py-2 text-[13px] font-medium bg-[#3ECF8E] hover:bg-[#38c484] text-white rounded-lg">
                Done
              </button>
            )}

            {step === 3 && (
              <>
                <button onClick={handleClose} className="px-4 py-2 text-[13px] text-gray-600 border border-[rgba(0,0,0,0.1)] rounded-lg hover:bg-gray-50">
                  Cancel
                </button>
                <div className="flex items-center gap-3">
                  {needsReview > 0 && (
                    <label className="flex items-center gap-2 text-[12px] text-amber-700 cursor-pointer select-none">
                      <input
                        type="checkbox"
                        checked={acknowledgedReview}
                        onChange={e => setAcknowledgedReview(e.target.checked)}
                        className="rounded"
                      />
                      I acknowledge {needsReview} item{needsReview !== 1 ? 's' : ''} have no product title
                    </label>
                  )}
                  <button
                    onClick={handleConfirm}
                    disabled={confirming || rows.length === 0 || (needsReview > 0 && !acknowledgedReview)}
                    className="flex items-center gap-1.5 px-4 py-2 text-[13px] font-medium bg-[#3ECF8E] hover:bg-[#38c484] text-white rounded-lg disabled:opacity-60 transition-colors"
                  >
                    {confirming && <Loader2 size={12} className="animate-spin" />}
                    Confirm Import ({rows.length} item{rows.length !== 1 ? 's' : ''})
                  </button>
                </div>
              </>
            )}

            {step === 4 && (
              <button onClick={handleClose} className="px-4 py-2 text-[13px] font-medium bg-[#3ECF8E] hover:bg-[#38c484] text-white rounded-lg">
                Close
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
