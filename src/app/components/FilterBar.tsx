import { useState } from 'react';
import { Filter, X, ChevronDown, ChevronUp } from 'lucide-react';

// ─── Types ────────────────────────────────────────────────────────────────────

export type SelectOption = { value: string; label: string };

export type FilterDef =
  | { type: 'select';    key: string; label: string; options: SelectOption[]; placeholder?: string }
  | { type: 'daterange'; keyFrom: string; keyTo: string; label: string }
  | { type: 'numrange';  keyMin: string; keyMax: string; label: string; prefix?: string }
  | { type: 'boolean';   key: string; label: string }
  | { type: 'text';      key: string; label: string; placeholder?: string };

export type FilterValues = Record<string, string>;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function isActive(def: FilterDef, vals: FilterValues): boolean {
  switch (def.type) {
    case 'select':    return !!vals[def.key];
    case 'daterange': return !!(vals[def.keyFrom] || vals[def.keyTo]);
    case 'numrange':  return !!(vals[def.keyMin] || vals[def.keyMax]);
    case 'boolean':   return vals[def.key] === 'true';
    case 'text':      return !!vals[def.key];
  }
}

function chipLabel(def: FilterDef, vals: FilterValues): string {
  switch (def.type) {
    case 'select': {
      const opt = def.options.find(o => o.value === vals[def.key]);
      return `${def.label}: ${opt?.label ?? vals[def.key]}`;
    }
    case 'daterange': {
      const from = vals[def.keyFrom];
      const to = vals[def.keyTo];
      if (from && to) return `${def.label}: ${from} – ${to}`;
      if (from) return `${def.label}: from ${from}`;
      return `${def.label}: until ${to}`;
    }
    case 'numrange': {
      const p = def.prefix ?? '';
      const min = vals[def.keyMin];
      const max = vals[def.keyMax];
      if (min && max) return `${def.label}: ${p}${min} – ${p}${max}`;
      if (min) return `${def.label}: ≥ ${p}${min}`;
      return `${def.label}: ≤ ${p}${max}`;
    }
    case 'boolean': return def.label;
    case 'text':    return `${def.label}: ${vals[def.key]}`;
  }
}

function clearDef(def: FilterDef, vals: FilterValues): FilterValues {
  const next = { ...vals };
  switch (def.type) {
    case 'select':    delete next[def.key]; break;
    case 'daterange': delete next[def.keyFrom]; delete next[def.keyTo]; break;
    case 'numrange':  delete next[def.keyMin]; delete next[def.keyMax]; break;
    case 'boolean':   delete next[def.key]; break;
    case 'text':      delete next[def.key]; break;
  }
  return next;
}

// ─── Count active filters ─────────────────────────────────────────────────────

export function countActive(defs: FilterDef[], vals: FilterValues): number {
  return defs.filter(d => isActive(d, vals)).length;
}

// ─── Apply filters to a data array ───────────────────────────────────────────
// Each def maps to a field accessor fn. Pass null to skip a def's filtering.

export type FieldAccessor = (key: string) => any;

export function applyFilterDefs(
  defs: FilterDef[],
  vals: FilterValues,
  accessor: FieldAccessor
): boolean {
  for (const def of defs) {
    if (!isActive(def, vals)) continue;
    switch (def.type) {
      case 'select': {
        const v = vals[def.key];
        const field = accessor(def.key);
        if (field !== v) return false;
        break;
      }
      case 'daterange': {
        const from = vals[def.keyFrom];
        const to   = vals[def.keyTo];
        // Derive field key from keyFrom by stripping _from / From suffix
        const fieldKey = def.keyFrom.replace(/_from$/, '').replace(/From$/, '');
        const field = String(accessor(fieldKey) ?? '').slice(0, 10); // ISO date
        if (from && field && field < from) return false;
        if (to   && field && field > to)   return false;
        break;
      }
      case 'numrange': {
        const min = vals[def.keyMin];
        const max = vals[def.keyMax];
        const fieldKey = def.keyMin.replace(/_min$/, '').replace(/Min$/, '');
        const field = Number(accessor(fieldKey) ?? 0);
        if (min && field < Number(min)) return false;
        if (max && field > Number(max)) return false;
        break;
      }
      case 'boolean': {
        // For boolean, the accessor must return true/false
        const field = accessor(def.key);
        if (!field) return false;
        break;
      }
      case 'text': {
        const v = vals[def.key];
        const field = String(accessor(def.key) ?? '').toLowerCase();
        if (!field.includes(v.toLowerCase())) return false;
        break;
      }
    }
  }
  return true;
}

// ─── FilterBar component ──────────────────────────────────────────────────────

interface FilterBarProps {
  defs: FilterDef[];
  values: FilterValues;
  onChange: (v: FilterValues) => void;
}

const controlBase =
  'h-7 text-[12px] border border-[rgba(0,0,0,0.09)] rounded-md bg-white focus:outline-none focus:ring-1 focus:ring-[#3ECF8E]/40 focus:border-[#3ECF8E]/60 text-gray-700 placeholder:text-gray-400';

export function FilterBar({ defs, values, onChange }: FilterBarProps) {
  const [open, setOpen] = useState(false);
  const active = countActive(defs, values);

  const set = (k: string, v: string) => {
    const next = { ...values };
    if (v === '') delete next[k]; else next[k] = v;
    onChange(next);
  };

  const clearAll = () => onChange({});

  // Chip list: one per active filter def
  const chips = defs.filter(d => isActive(d, values));

  if (defs.length === 0) return null;

  return (
    <div className="border-b border-[rgba(0,0,0,0.06)]">
      {/* Toggle row */}
      <div className="px-4 py-2 flex items-center gap-2 flex-wrap">
        <button
          onClick={() => setOpen(o => !o)}
          className={`flex items-center gap-1.5 h-7 px-2.5 text-[12px] font-medium rounded-md border transition-colors ${
            active > 0
              ? 'border-[#3ECF8E]/50 text-[#15803d] bg-[#ECFDF5]'
              : 'border-[rgba(0,0,0,0.09)] text-gray-500 hover:text-gray-700 hover:bg-gray-50'
          }`}
        >
          <Filter size={11} />
          Filters
          {active > 0 && (
            <span className="bg-[#3ECF8E] text-white text-[10px] font-semibold rounded-full w-4 h-4 flex items-center justify-center leading-none">
              {active}
            </span>
          )}
          {open ? <ChevronUp size={11} /> : <ChevronDown size={11} />}
        </button>

        {/* Active chips */}
        {chips.map((def, i) => {
          const key = def.type === 'select' ? def.key : def.type === 'daterange' ? def.keyFrom : def.type === 'numrange' ? def.keyMin : (def as any).key;
          return (
            <span
              key={`chip-${i}`}
              className="flex items-center gap-1 h-6 pl-2 pr-1 bg-gray-100 text-gray-600 text-[11px] rounded-full border border-[rgba(0,0,0,0.07)]"
            >
              {chipLabel(def, values)}
              <button
                onClick={() => onChange(clearDef(def, values))}
                className="w-4 h-4 flex items-center justify-center rounded-full hover:bg-gray-200 text-gray-400 hover:text-gray-600 transition-colors"
              >
                <X size={9} strokeWidth={2.5} />
              </button>
            </span>
          );
        })}

        {active > 0 && (
          <button
            onClick={clearAll}
            className="h-6 px-2 text-[11px] text-gray-400 hover:text-red-500 transition-colors"
          >
            Clear all
          </button>
        )}
      </div>

      {/* Expanded controls */}
      {open && (
        <div className="px-4 pb-3 flex flex-wrap gap-2">
          {defs.map((def, i) => {
            if (def.type === 'select') {
              return (
                <div key={i} className="flex flex-col gap-0.5">
                  <label className="text-[10px] text-gray-400 font-medium uppercase tracking-wide px-0.5">{def.label}</label>
                  <select
                    className={`${controlBase} pl-2 pr-6 appearance-none min-w-[130px]`}
                    value={values[def.key] ?? ''}
                    onChange={e => set(def.key, e.target.value)}
                  >
                    <option value="">{def.placeholder ?? `All ${def.label}`}</option>
                    {def.options.map(o => (
                      <option key={o.value} value={o.value}>{o.label}</option>
                    ))}
                  </select>
                </div>
              );
            }

            if (def.type === 'daterange') {
              return (
                <div key={i} className="flex flex-col gap-0.5">
                  <label className="text-[10px] text-gray-400 font-medium uppercase tracking-wide px-0.5">{def.label}</label>
                  <div className="flex items-center gap-1">
                    <input
                      type="date"
                      className={`${controlBase} px-2 w-[130px]`}
                      value={values[def.keyFrom] ?? ''}
                      onChange={e => set(def.keyFrom, e.target.value)}
                    />
                    <span className="text-[11px] text-gray-400">—</span>
                    <input
                      type="date"
                      className={`${controlBase} px-2 w-[130px]`}
                      value={values[def.keyTo] ?? ''}
                      onChange={e => set(def.keyTo, e.target.value)}
                    />
                  </div>
                </div>
              );
            }

            if (def.type === 'numrange') {
              const p = def.prefix ?? '';
              return (
                <div key={i} className="flex flex-col gap-0.5">
                  <label className="text-[10px] text-gray-400 font-medium uppercase tracking-wide px-0.5">{def.label}</label>
                  <div className="flex items-center gap-1">
                    <input
                      type="number"
                      className={`${controlBase} px-2 w-[90px]`}
                      placeholder={`${p}Min`}
                      value={values[def.keyMin] ?? ''}
                      onChange={e => set(def.keyMin, e.target.value)}
                      min="0"
                      step="0.01"
                    />
                    <span className="text-[11px] text-gray-400">—</span>
                    <input
                      type="number"
                      className={`${controlBase} px-2 w-[90px]`}
                      placeholder={`${p}Max`}
                      value={values[def.keyMax] ?? ''}
                      onChange={e => set(def.keyMax, e.target.value)}
                      min="0"
                      step="0.01"
                    />
                  </div>
                </div>
              );
            }

            if (def.type === 'boolean') {
              const on = values[(def as any).key] === 'true';
              return (
                <div key={i} className="flex flex-col gap-0.5">
                  <label className="text-[10px] text-gray-400 font-medium uppercase tracking-wide px-0.5">&nbsp;</label>
                  <button
                    onClick={() => set((def as any).key, on ? '' : 'true')}
                    className={`h-7 px-3 text-[12px] font-medium rounded-md border transition-colors ${
                      on
                        ? 'border-[#3ECF8E]/50 text-[#15803d] bg-[#ECFDF5]'
                        : 'border-[rgba(0,0,0,0.09)] text-gray-500 hover:bg-gray-50'
                    }`}
                  >
                    {def.label}
                  </button>
                </div>
              );
            }

            if (def.type === 'text') {
              return (
                <div key={i} className="flex flex-col gap-0.5">
                  <label className="text-[10px] text-gray-400 font-medium uppercase tracking-wide px-0.5">{def.label}</label>
                  <input
                    type="text"
                    className={`${controlBase} px-2 min-w-[120px]`}
                    placeholder={def.placeholder ?? def.label}
                    value={values[(def as any).key] ?? ''}
                    onChange={e => set((def as any).key, e.target.value)}
                  />
                </div>
              );
            }

            return null;
          })}
        </div>
      )}
    </div>
  );
}
