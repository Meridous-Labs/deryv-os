import { useState, useRef, useCallback } from 'react';
import { X, Upload, ChevronRight, ChevronLeft, Check, AlertTriangle, FileText, Loader2 } from 'lucide-react';
import * as XLSX from 'xlsx';
import { insertRow, updateRow, logActivity } from '../../lib/hooks';
import { supabase } from '../../lib/supabase';
import { FormField, inputCls, selectCls, textareaCls } from './DataStates';

// ─── Types ────────────────────────────────────────────────────────────────────

interface Supply { id: string; name: string; sku?: string; unit_cost?: number; quantity_on_hand?: number; status?: string; }
interface Category { id: string; name: string; }
interface Vendor { id: string; name?: string; company_name?: string; }
interface Location { id: string; name: string; zone?: string; }

interface Props {
  open: boolean;
  onClose: () => void;
  orgId: string | null;
  userId?: string;
  existingSupplies: Supply[];
  categories: Category[];
  vendors: Vendor[];
  locations: Location[];
  onCreated: () => void;
}

// ─── Column detection ─────────────────────────────────────────────────────────

interface FieldDef { field: string; label: string; priorities: string[]; }

const FIELD_DEFS: FieldDef[] = [
  { field: 'supply_name',     label: 'Supply Name',     priorities: ['item', 'product', 'product name', 'description', 'item description', 'supply', 'material', 'supply name', 'name'] },
  { field: 'sku',             label: 'SKU',             priorities: ['sku', 'item number', 'product number', 'part number', 'part no', 'item no'] },
  { field: 'quantity',        label: 'Quantity',        priorities: ['quantity', 'qty', 'units', 'count', 'unit count'] },
  { field: 'unit_cost',       label: 'Unit Cost',       priorities: ['unit cost', 'cost', 'price', 'unit price', 'rate', 'each'] },
  { field: 'total_cost',      label: 'Total Cost',      priorities: ['total', 'line total', 'amount', 'extended price', 'total cost', 'ext price', 'ext. price', 'extended amount'] },
  { field: 'vendor',          label: 'Vendor',          priorities: ['vendor', 'supplier', 'merchant'] },
  { field: 'invoice_number',  label: 'Invoice Number',  priorities: ['invoice number', 'invoice #', 'invoice no', 'inv number', 'inv no', 'inv #', 'invoice'] },
  { field: 'invoice_date',    label: 'Invoice Date',    priorities: ['invoice date', 'date', 'order date', 'purchase date'] },
  { field: 'notes',           label: 'Notes',           priorities: ['notes', 'note', 'comments', 'comment', 'remarks'] },
];

interface FieldMapping { field: string; sourceIdx: number; }

function normalizeHeader(h: string): string {
  return String(h ?? '').toLowerCase()
    .replace(/[_\-]/g, ' ').replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ').trim();
}

function parseMoney(val: any): number {
  if (val == null || val === '') return 0;
  const s = String(val).replace(/[$,\s]/g, '');
  const n = parseFloat(s);
  return isNaN(n) ? 0 : n;
}

function parseQty(val: any): number {
  if (val == null || val === '') return 0;
  const n = parseInt(String(val).replace(/[^0-9.-]/g, ''), 10);
  return isNaN(n) ? 0 : Math.max(0, n);
}

function detectFieldMappings(headers: string[]): FieldMapping[] {
  const normToIdx = new Map<string, number>();
  headers.forEach((h, i) => { const n = normalizeHeader(h); if (!normToIdx.has(n)) normToIdx.set(n, i); });
  const usedIdxs = new Set<number>();
  return FIELD_DEFS.map(({ field, priorities }) => {
    for (const alias of priorities) {
      const idx = normToIdx.get(normalizeHeader(alias));
      if (idx !== undefined && !usedIdxs.has(idx)) { usedIdxs.add(idx); return { field, sourceIdx: idx }; }
    }
    return { field, sourceIdx: -1 };
  });
}

function getCellStr(row: any[], idx: number): string {
  if (idx < 0 || idx >= row.length) return '';
  return String(row[idx] ?? '').trim();
}

// ─── Parsed row ───────────────────────────────────────────────────────────────

interface ParsedRow {
  _id: string;
  supply_name: string;
  sku: string;
  quantity: number;
  unit_cost: number;
  total_cost: number;
  vendor: string;
  invoice_number: string;
  invoice_date: string;
  notes: string;
  matched_supply_id: string;  // '' = no match
  create_new: boolean;        // if no match, create a new supply item
  needs_review: boolean;
}

function applyMappings(rawData: any[][], mappings: FieldMapping[], rawHeaders: string[]): ParsedRow[] {
  const get = (row: any[], field: string): string => {
    const m = mappings.find(f => f.field === field);
    return m && m.sourceIdx >= 0 ? getCellStr(row, m.sourceIdx) : '';
  };

  return rawData.map((row, i) => {
    const supply_name = get(row, 'supply_name');
    const sku = get(row, 'sku');
    const qty = parseQty(get(row, 'quantity'));
    let unitCost = parseMoney(get(row, 'unit_cost'));
    let totalCost = parseMoney(get(row, 'total_cost'));

    // Derive missing cost
    if (unitCost === 0 && totalCost > 0 && qty > 0) unitCost = totalCost / qty;
    if (totalCost === 0 && unitCost > 0 && qty > 0) totalCost = unitCost * qty;

    return {
      _id: `row-${i}`,
      supply_name,
      sku,
      quantity: qty,
      unit_cost: unitCost,
      total_cost: totalCost,
      vendor: get(row, 'vendor'),
      invoice_number: get(row, 'invoice_number'),
      invoice_date: get(row, 'invoice_date'),
      notes: get(row, 'notes'),
      matched_supply_id: '',
      create_new: false,
      needs_review: !supply_name.trim(),
    };
  }).filter(r => r.supply_name || r.sku || r.quantity > 0);
}

// ─── Step indicators ──────────────────────────────────────────────────────────

const STEPS = ['Upload', 'Parse', 'Review', 'Confirm'];

function StepBar({ step }: { step: number }) {
  return (
    <div className="flex items-center gap-0 px-6 py-4 border-b border-[rgba(0,0,0,0.07)] bg-gray-50/60">
      {STEPS.map((s, i) => (
        <div key={s} className="flex items-center gap-0">
          <div className={`flex items-center gap-1.5 ${i < step ? 'text-[#3ECF8E]' : i === step ? 'text-gray-800' : 'text-gray-400'}`}>
            <div className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-semibold border ${
              i < step ? 'bg-[#3ECF8E] border-[#3ECF8E] text-white' :
              i === step ? 'border-gray-800 text-gray-800' :
              'border-gray-300 text-gray-400'
            }`}>
              {i < step ? <Check size={10} strokeWidth={3} /> : i + 1}
            </div>
            <span className="text-[12px] font-medium hidden sm:block">{s}</span>
          </div>
          {i < STEPS.length - 1 && (
            <div className={`h-px w-8 mx-2 ${i < step ? 'bg-[#3ECF8E]' : 'bg-gray-200'}`} />
          )}
        </div>
      ))}
    </div>
  );
}

// ─── Main Modal ───────────────────────────────────────────────────────────────

export function SupplyInvoiceImportModal({ open, onClose, orgId, userId, existingSupplies, categories, vendors, locations, onCreated }: Props) {
  const [step, setStep] = useState(0);
  const [file, setFile] = useState<File | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [invoiceNum, setInvoiceNum] = useState('');
  const [invoiceDate, setInvoiceDate] = useState('');
  const [vendorId, setVendorId] = useState('');
  const [notes, setNotes] = useState('');
  const [rawHeaders, setRawHeaders] = useState<string[]>([]);
  const [rawData, setRawData] = useState<any[][]>([]);
  const [mappings, setMappings] = useState<FieldMapping[]>([]);
  const [showMappings, setShowMappings] = useState(false);
  const [rows, setRows] = useState<ParsedRow[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  if (!open) return null;

  const resetAll = () => {
    setStep(0); setFile(null); setIsDragging(false);
    setInvoiceNum(''); setInvoiceDate(''); setVendorId(''); setNotes('');
    setRawHeaders([]); setRawData([]); setMappings([]); setShowMappings(false);
    setRows([]); setSaving(false); setError('');
  };

  const handleClose = () => { resetAll(); onClose(); };

  // ─── Step 0: Upload & Details ───────────────────────────────────────────────

  const handleFile = useCallback(async (f: File) => {
    setFile(f);
    setError('');
  }, []);

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault(); setIsDragging(false);
    const f = e.dataTransfer.files[0];
    if (f) handleFile(f);
  };

  const handleParse = async () => {
    if (!file) { setError('Please select a file to upload.'); return; }
    setError('');
    try {
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: 'array', raw: false, cellDates: true });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const data: any[][] = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
      if (data.length < 2) { setError('File appears empty or has no data rows.'); return; }
      const headers = data[0].map((h: any) => String(h ?? '').trim());
      const body = data.slice(1).filter((row: any[]) => row.some(c => c !== ''));
      setRawHeaders(headers);
      setRawData(body);
      const detected = detectFieldMappings(headers);
      setMappings(detected);
      setStep(1);
    } catch (e: any) {
      setError(`Failed to parse file: ${e.message}`);
    }
  };

  // ─── Step 1: Parse / Column Mapping ────────────────────────────────────────

  const applyAndReview = () => {
    const parsed = applyMappings(rawData, mappings, rawHeaders);
    // Auto-match existing supplies by name or SKU
    const matched = parsed.map(row => {
      let matchId = '';
      if (row.sku) {
        const bySkU = existingSupplies.find(s => s.sku && s.sku.toLowerCase() === row.sku.toLowerCase());
        if (bySkU) matchId = bySkU.id;
      }
      if (!matchId && row.supply_name) {
        const byName = existingSupplies.find(s => s.name.toLowerCase() === row.supply_name.toLowerCase());
        if (byName) matchId = byName.id;
      }
      return { ...row, matched_supply_id: matchId, create_new: !matchId };
    });
    setRows(matched);
    setStep(2);
  };

  // ─── Step 2: Review ─────────────────────────────────────────────────────────

  const updateRow_ = (id: string, changes: Partial<ParsedRow>) => {
    setRows(prev => prev.map(r => r._id === id ? { ...r, ...changes } : r));
  };

  // ─── Step 3: Confirm ────────────────────────────────────────────────────────

  const handleConfirm = async () => {
    if (!orgId) return;
    setSaving(true); setError('');
    try {
      // 1. Create supply_invoice_imports record
      const { error: invErr, data: invData } = await insertRow('supply_invoice_imports', {
        organization_id: orgId,
        vendor_id: vendorId || null,
        invoice_number: invoiceNum || null,
        invoice_date: invoiceDate || null,
        notes: notes || null,
        status: 'CONFIRMED',
        imported_by: userId ?? null,
        row_count: rows.length,
      });
      if (invErr) throw new Error(invErr);
      const invoiceId: string | undefined = invData?.id;

      for (const row of rows) {
        let supplyId: string = row.matched_supply_id;

        if (!supplyId && row.create_new && row.supply_name) {
          // Create new supply with quantity_on_hand = 0; DB trigger adds qty from PURCHASE transaction
          const { error: supErr, data: supData } = await insertRow('supplies', {
            organization_id: orgId,
            name: row.supply_name,
            sku: row.sku || null,
            unit_cost: row.unit_cost || null,
            quantity_on_hand: 0,
            status: 'ACTIVE',
          });
          if (supErr) throw new Error(`Failed to create supply "${row.supply_name}": ${supErr}`);
          supplyId = supData?.id ?? '';
        }

        if (!supplyId) continue; // row was skipped (no match, create_new = false)

        // Create supply_transaction — DB trigger updates quantity_on_hand
        const { error: txErr } = await insertRow('supply_transactions', {
          organization_id: orgId,
          supply_id: supplyId,
          transaction_type: 'PURCHASE',
          quantity: row.quantity,
          unit_cost: row.unit_cost || null,
          total_cost: row.total_cost || null,
          reference_number: row.invoice_number || invoiceNum || null,
          notes: row.notes || null,
          created_by: userId ?? null,
          supply_invoice_import_id: invoiceId ?? null,
        });
        if (txErr) throw new Error(`Failed to create transaction for "${row.supply_name}": ${txErr}`);

        // Update unit_cost on existing supplies after transaction insert succeeds
        if (row.matched_supply_id && row.unit_cost > 0) {
          await updateRow('supplies', supplyId, { unit_cost: row.unit_cost });
        }
      }

      await logActivity(orgId, userId ?? null, `Imported supply invoice with ${rows.length} line item(s)`, 'supply_invoice_imports', invoiceId ?? undefined, 'create');

      onCreated();
      handleClose();
    } catch (e: any) {
      setError(`Failed to save: ${e.message}`);
    } finally {
      setSaving(false);
    }
  };

  const reviewCount = rows.length;
  const needsReviewCount = rows.filter(r => r.needs_review).length;
  const newCount = rows.filter(r => r.create_new && !r.matched_supply_id).length;
  const matchedCount = rows.filter(r => !!r.matched_supply_id).length;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/30 backdrop-blur-[2px]" onClick={handleClose} />
      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-3xl mx-4 flex flex-col max-h-[90vh] overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[rgba(0,0,0,0.07)]">
          <div>
            <h2 className="text-[15px] font-semibold text-gray-900">Import Supply Invoice</h2>
            <p className="text-[12px] text-gray-500 mt-0.5">Upload a CSV or XLSX file to import supply purchases</p>
          </div>
          <button onClick={handleClose} className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-gray-100 text-gray-400 hover:text-gray-600 transition-colors">
            <X size={16} />
          </button>
        </div>

        <StepBar step={step} />

        {/* Body */}
        <div className="flex-1 overflow-y-auto">

          {/* ── Step 0: Upload & Details ── */}
          {step === 0 && (
            <div className="p-6 space-y-5">
              {/* File drop zone */}
              <div
                className={`border-2 border-dashed rounded-xl p-8 text-center transition-colors cursor-pointer ${isDragging ? 'border-[#3ECF8E] bg-[#3ECF8E]/5' : 'border-gray-200 hover:border-gray-300'}`}
                onClick={() => fileRef.current?.click()}
                onDragOver={e => { e.preventDefault(); setIsDragging(true); }}
                onDragLeave={() => setIsDragging(false)}
                onDrop={handleDrop}
              >
                <input ref={fileRef} type="file" accept=".csv,.xlsx,.xls" className="hidden"
                  onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f); }} />
                {file ? (
                  <div className="flex flex-col items-center gap-2">
                    <FileText size={28} className="text-[#3ECF8E]" />
                    <p className="text-[13px] font-medium text-gray-800">{file.name}</p>
                    <p className="text-[11px] text-gray-400">{(file.size / 1024).toFixed(1)} KB · Click to change</p>
                  </div>
                ) : (
                  <div className="flex flex-col items-center gap-2">
                    <Upload size={28} className="text-gray-300" />
                    <p className="text-[13px] font-medium text-gray-600">Drop CSV or XLSX file here</p>
                    <p className="text-[11px] text-gray-400">or click to browse</p>
                  </div>
                )}
              </div>

              {/* Invoice details */}
              <div className="grid grid-cols-2 gap-4">
                <FormField label="Invoice Number">
                  <input className={inputCls} value={invoiceNum} onChange={e => setInvoiceNum(e.target.value)} placeholder="INV-00123" />
                </FormField>
                <FormField label="Invoice Date">
                  <input type="date" className={inputCls} value={invoiceDate} onChange={e => setInvoiceDate(e.target.value)} />
                </FormField>
                <FormField label="Vendor">
                  <select className={selectCls} value={vendorId} onChange={e => setVendorId(e.target.value)}>
                    <option value="">— select vendor —</option>
                    {vendors.map(v => <option key={v.id} value={v.id}>{v.name || v.company_name || 'Unnamed Vendor'}</option>)}
                  </select>
                </FormField>
                <FormField label="Notes">
                  <input className={inputCls} value={notes} onChange={e => setNotes(e.target.value)} placeholder="Optional notes" />
                </FormField>
              </div>

              {error && <p className="text-[12px] text-red-500 bg-red-50 border border-red-100 rounded-lg px-3 py-2">{error}</p>}
            </div>
          )}

          {/* ── Step 1: Column Mapping ── */}
          {step === 1 && (
            <div className="p-6 space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-[13px] font-medium text-gray-800">Column Mapping</p>
                  <p className="text-[12px] text-gray-500 mt-0.5">{rawData.length} data rows detected. Verify the column assignments below.</p>
                </div>
                <button onClick={() => setShowMappings(m => !m)} className="text-[12px] text-[#3ECF8E] hover:text-[#38c484] font-medium">
                  {showMappings ? 'Hide' : 'Show'} mappings
                </button>
              </div>

              {showMappings && (
                <div className="border border-[rgba(0,0,0,0.07)] rounded-xl overflow-hidden">
                  <table className="w-full text-[12px]">
                    <thead>
                      <tr className="bg-gray-50 border-b border-[rgba(0,0,0,0.06)]">
                        <th className="px-4 py-2 text-left text-[10px] font-medium text-gray-400 uppercase tracking-wide">Field</th>
                        <th className="px-4 py-2 text-left text-[10px] font-medium text-gray-400 uppercase tracking-wide">Source Column</th>
                      </tr>
                    </thead>
                    <tbody>
                      {FIELD_DEFS.map((fd, fi) => {
                        const m = mappings.find(x => x.field === fd.field) ?? { field: fd.field, sourceIdx: -1 };
                        return (
                          <tr key={fd.field} className="border-b border-[rgba(0,0,0,0.04)] last:border-0">
                            <td className="px-4 py-2 font-medium text-gray-700 whitespace-nowrap">{fd.label}</td>
                            <td className="px-4 py-2">
                              <select
                                className="text-[12px] border border-[rgba(0,0,0,0.1)] rounded-md px-2 py-1 focus:outline-none focus:ring-1 focus:ring-[#3ECF8E]/40"
                                value={m.sourceIdx}
                                onChange={e => {
                                  const newIdx = parseInt(e.target.value);
                                  setMappings(prev => prev.map(x => x.field === fd.field ? { ...x, sourceIdx: newIdx } : x));
                                }}
                              >
                                <option value={-1}>— not mapped —</option>
                                {rawHeaders.map((h, hi) => (
                                  <option key={hi} value={hi}>{h || `Column ${hi + 1}`}</option>
                                ))}
                              </select>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}

              {/* Preview */}
              <div>
                <p className="text-[11px] font-medium text-gray-400 uppercase tracking-wide mb-2">File Preview (first 5 rows)</p>
                <div className="border border-[rgba(0,0,0,0.07)] rounded-xl overflow-hidden">
                  <div className="overflow-x-auto">
                    <table className="w-full text-[12px]">
                      <thead>
                        <tr className="bg-gray-50 border-b border-[rgba(0,0,0,0.06)]">
                          {rawHeaders.map((h, i) => <th key={i} className="px-3 py-2 text-left text-[10px] font-medium text-gray-400 whitespace-nowrap">{h || `Col ${i+1}`}</th>)}
                        </tr>
                      </thead>
                      <tbody>
                        {rawData.slice(0, 5).map((row, ri) => (
                          <tr key={ri} className="border-b border-[rgba(0,0,0,0.04)] last:border-0">
                            {rawHeaders.map((_, ci) => (
                              <td key={ci} className="px-3 py-1.5 text-gray-600 whitespace-nowrap max-w-[160px] truncate">{String(row[ci] ?? '')}</td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>

              {error && <p className="text-[12px] text-red-500 bg-red-50 border border-red-100 rounded-lg px-3 py-2">{error}</p>}
            </div>
          )}

          {/* ── Step 2: Review ── */}
          {step === 2 && (
            <div className="p-6 space-y-4">
              {/* Summary badges */}
              <div className="flex items-center gap-3 flex-wrap">
                <span className="text-[12px] bg-gray-100 text-gray-600 px-2.5 py-1 rounded-full">{reviewCount} rows</span>
                {matchedCount > 0 && <span className="text-[12px] bg-[#ECFDF5] text-[#15803d] px-2.5 py-1 rounded-full">{matchedCount} matched</span>}
                {newCount > 0 && <span className="text-[12px] bg-blue-50 text-blue-700 px-2.5 py-1 rounded-full">{newCount} new</span>}
                {needsReviewCount > 0 && <span className="text-[12px] bg-amber-50 text-amber-700 px-2.5 py-1 rounded-full flex items-center gap-1"><AlertTriangle size={11} />{needsReviewCount} needs review</span>}
              </div>

              <div className="border border-[rgba(0,0,0,0.07)] rounded-xl overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-[12px]">
                    <thead>
                      <tr className="bg-gray-50 border-b border-[rgba(0,0,0,0.06)]">
                        <th className="px-3 py-2 text-left text-[10px] font-medium text-gray-400 uppercase tracking-wide">Supply Name</th>
                        <th className="px-3 py-2 text-left text-[10px] font-medium text-gray-400 uppercase tracking-wide">SKU</th>
                        <th className="px-3 py-2 text-right text-[10px] font-medium text-gray-400 uppercase tracking-wide">Qty</th>
                        <th className="px-3 py-2 text-right text-[10px] font-medium text-gray-400 uppercase tracking-wide">Unit Cost</th>
                        <th className="px-3 py-2 text-left text-[10px] font-medium text-gray-400 uppercase tracking-wide w-48">Match / Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map(row => (
                        <tr key={row._id} className={`border-b border-[rgba(0,0,0,0.04)] last:border-0 ${row.needs_review ? 'bg-amber-50/40' : ''}`}>
                          <td className="px-3 py-2">
                            {row.needs_review ? (
                              <div className="flex items-center gap-1.5">
                                <AlertTriangle size={11} className="text-amber-500 flex-shrink-0" />
                                <input
                                  className="text-[12px] border border-amber-200 rounded px-1.5 py-0.5 focus:outline-none focus:ring-1 focus:ring-amber-300 bg-white w-40"
                                  value={row.supply_name}
                                  placeholder="Enter supply name"
                                  onChange={e => updateRow_(row._id, { supply_name: e.target.value, needs_review: !e.target.value.trim() })}
                                />
                              </div>
                            ) : (
                              <span className="text-gray-800 font-medium">{row.supply_name}</span>
                            )}
                          </td>
                          <td className="px-3 py-2 text-gray-500">{row.sku || '—'}</td>
                          <td className="px-3 py-2 text-right text-gray-700">{row.quantity}</td>
                          <td className="px-3 py-2 text-right text-gray-700">{row.unit_cost > 0 ? `$${row.unit_cost.toFixed(2)}` : '—'}</td>
                          <td className="px-3 py-2">
                            <select
                              className="text-[11px] border border-[rgba(0,0,0,0.1)] rounded px-1.5 py-0.5 focus:outline-none focus:ring-1 focus:ring-[#3ECF8E]/40 w-full"
                              value={row.matched_supply_id || (row.create_new ? '__new__' : '__skip__')}
                              onChange={e => {
                                const v = e.target.value;
                                if (v === '__new__') updateRow_(row._id, { matched_supply_id: '', create_new: true });
                                else if (v === '__skip__') updateRow_(row._id, { matched_supply_id: '', create_new: false });
                                else updateRow_(row._id, { matched_supply_id: v, create_new: false });
                              }}
                            >
                              <option value="__new__">+ Create new supply</option>
                              <option value="__skip__">Skip this row</option>
                              {existingSupplies.map(s => (
                                <option key={s.id} value={s.id}>{s.name}{s.sku ? ` (${s.sku})` : ''}</option>
                              ))}
                            </select>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {error && <p className="text-[12px] text-red-500 bg-red-50 border border-red-100 rounded-lg px-3 py-2">{error}</p>}
            </div>
          )}

          {/* ── Step 3: Confirm ── */}
          {step === 3 && (
            <div className="p-6 space-y-5">
              <div className="bg-gray-50 rounded-xl border border-[rgba(0,0,0,0.07)] divide-y divide-[rgba(0,0,0,0.05)]">
                <div className="px-5 py-4">
                  <p className="text-[11px] font-medium text-gray-400 uppercase tracking-wide mb-3">Invoice Details</p>
                  <div className="grid grid-cols-2 gap-3">
                    {invoiceNum && <div><span className="text-[11px] text-gray-400">Invoice #</span><p className="text-[13px] font-medium text-gray-800">{invoiceNum}</p></div>}
                    {invoiceDate && <div><span className="text-[11px] text-gray-400">Date</span><p className="text-[13px] text-gray-800">{invoiceDate}</p></div>}
                    {vendorId && <div><span className="text-[11px] text-gray-400">Vendor</span><p className="text-[13px] text-gray-800">{vendors.find(v => v.id === vendorId)?.name || vendors.find(v => v.id === vendorId)?.company_name || '—'}</p></div>}
                  </div>
                </div>
                <div className="px-5 py-4">
                  <p className="text-[11px] font-medium text-gray-400 uppercase tracking-wide mb-3">Import Summary</p>
                  <div className="grid grid-cols-3 gap-3">
                    <div><span className="text-[11px] text-gray-400">Total Rows</span><p className="text-[20px] font-semibold text-gray-900">{rows.filter(r => r.matched_supply_id || r.create_new).length}</p></div>
                    <div><span className="text-[11px] text-gray-400">Updating</span><p className="text-[20px] font-semibold text-[#3ECF8E]">{rows.filter(r => !!r.matched_supply_id).length}</p></div>
                    <div><span className="text-[11px] text-gray-400">Creating New</span><p className="text-[20px] font-semibold text-blue-600">{rows.filter(r => r.create_new && !r.matched_supply_id).length}</p></div>
                  </div>
                </div>
                {rows.filter(r => r.matched_supply_id || r.create_new).length > 0 && (
                  <div className="px-5 py-4">
                    <p className="text-[11px] font-medium text-gray-400 uppercase tracking-wide mb-3">Total Spend</p>
                    <p className="text-[22px] font-semibold text-gray-900">
                      ${rows.filter(r => r.matched_supply_id || r.create_new).reduce((sum, r) => sum + r.total_cost, 0).toLocaleString('en-US', { minimumFractionDigits: 2 })}
                    </p>
                  </div>
                )}
              </div>

              <p className="text-[12px] text-gray-500">
                This will create supply transactions for each line item, update quantities for matched supplies, and create new supply records where indicated.
              </p>

              {error && <p className="text-[12px] text-red-500 bg-red-50 border border-red-100 rounded-lg px-3 py-2">{error}</p>}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-6 py-4 border-t border-[rgba(0,0,0,0.07)] bg-gray-50/60">
          <button
            onClick={() => step === 0 ? handleClose() : setStep(s => s - 1)}
            className="flex items-center gap-1.5 text-[13px] text-gray-600 hover:text-gray-800 font-medium transition-colors"
          >
            {step > 0 && <ChevronLeft size={14} />}
            {step === 0 ? 'Cancel' : 'Back'}
          </button>

          <div className="flex items-center gap-3">
            {step === 0 && (
              <button
                onClick={handleParse}
                disabled={!file}
                className="flex items-center gap-1.5 bg-[#3ECF8E] hover:bg-[#38c484] disabled:bg-gray-200 disabled:text-gray-400 text-white px-4 py-2 rounded-lg text-[13px] font-medium transition-colors"
              >
                Parse File <ChevronRight size={14} />
              </button>
            )}
            {step === 1 && (
              <button
                onClick={applyAndReview}
                className="flex items-center gap-1.5 bg-[#3ECF8E] hover:bg-[#38c484] text-white px-4 py-2 rounded-lg text-[13px] font-medium transition-colors"
              >
                Review Rows <ChevronRight size={14} />
              </button>
            )}
            {step === 2 && (
              <button
                onClick={() => { setStep(3); }}
                className="flex items-center gap-1.5 bg-[#3ECF8E] hover:bg-[#38c484] text-white px-4 py-2 rounded-lg text-[13px] font-medium transition-colors"
              >
                Continue <ChevronRight size={14} />
              </button>
            )}
            {step === 3 && (
              <button
                onClick={handleConfirm}
                disabled={saving}
                className="flex items-center gap-1.5 bg-[#3ECF8E] hover:bg-[#38c484] disabled:bg-gray-200 disabled:text-gray-400 text-white px-4 py-2 rounded-lg text-[13px] font-medium transition-colors"
              >
                {saving ? <><Loader2 size={13} className="animate-spin" />Saving…</> : <><Check size={13} />Confirm Import</>}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
