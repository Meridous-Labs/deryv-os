import { useState, useEffect, useMemo } from 'react';
import { Download, Plus, Loader2, PlayCircle, FileText, Trash2 } from 'lucide-react';
import { useNavigate } from 'react-router';
import { useAuth } from '../../contexts/AuthContext';
import { useOrgQuery, insertRow, updateRow, deleteRow, logActivity } from '../../lib/hooks';
import { useSecondaryView } from '../components/SecondarySidebar';
import { EmptyState, ErrorState, Modal, FormField, DetailRow, inputCls, selectCls } from '../components/DataStates';
import { FilterBar, FilterValues, FilterDef } from '../components/FilterBar';
import { Drawer } from '../components/Drawer';
import { ConfirmDialog } from '../components/ConfirmDialog';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, LineChart, Line, Legend
} from 'recharts';

const REPORT_TYPES = ['Recovery', 'Vendor', 'Inventory', 'Marketplace', 'Orders', 'Custom'];
const SCHEDULES = ['Manual', 'Daily', 'Weekly', 'Monthly', 'Quarterly'];

const tooltipStyle = {
  contentStyle: { borderRadius: 8, border: '1px solid rgba(0,0,0,0.08)', fontSize: 11, boxShadow: '0 4px 16px rgba(0,0,0,0.08)' },
  cursor: { fill: 'rgba(0,0,0,0.03)' },
};

function NewReportModal({ open, onClose, orgId, userId, currentFilters, onCreated }: any) {
  const [form, setForm] = useState({ name: '', report_type: 'Recovery', schedule: 'Manual' });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (k: string, v: string) => setForm(f => ({ ...f, [k]: v }));

  const save = async () => {
    if (!form.name) { setError('Report name is required.'); return; }
    setSaving(true); setError(null);
    const { error: err } = await insertRow('reports', {
      organization_id: orgId,
      name: form.name,
      report_type: form.report_type,
      schedule: form.schedule,
      filters: currentFilters || {},
      created_by: userId,
      last_run_at: null,
      pdf_url: null,
    });
    if (err) { setError(err); setSaving(false); return; }
    await logActivity(orgId, userId, `Report "${form.name}" created`, 'reports');
    setSaving(false); onCreated(); onClose();
    setForm({ name: '', report_type: 'Recovery', schedule: 'Manual' });
  };

  return (
    <Modal open={open} onClose={onClose} title="New Report"
      footer={<>
        <button onClick={onClose} className="px-4 py-2 text-[13px] text-gray-600 border border-[rgba(0,0,0,0.1)] rounded-lg hover:bg-gray-50">Cancel</button>
        <button onClick={save} disabled={saving} className="flex items-center gap-1.5 px-4 py-2 bg-[#3ECF8E] hover:bg-[#38c484] text-white text-[13px] font-medium rounded-lg disabled:opacity-60">
          {saving && <Loader2 size={12} className="animate-spin" />}Create Report
        </button>
      </>}>
      <div className="space-y-4">
        {error && <p className="text-[12px] text-red-500 bg-red-50 px-3 py-2 rounded-lg">{error}</p>}
        <FormField label="Report Name" required><input className={inputCls} value={form.name} onChange={e => set('name', e.target.value)} placeholder="Monthly Recovery Report" /></FormField>
        <div className="grid grid-cols-2 gap-4">
          <FormField label="Type"><select className={selectCls} value={form.report_type} onChange={e => set('report_type', e.target.value)}>{REPORT_TYPES.map(t => <option key={t}>{t}</option>)}</select></FormField>
          <FormField label="Schedule"><select className={selectCls} value={form.schedule} onChange={e => set('schedule', e.target.value)}>{SCHEDULES.map(s => <option key={s}>{s}</option>)}</select></FormField>
        </div>
        {Object.keys(currentFilters || {}).length > 0 && (
          <div className="text-[11px] text-gray-500 bg-gray-50 px-3 py-2 rounded-lg">
            Current filters will be saved with this report
          </div>
        )}
      </div>
    </Modal>
  );
}

// ── Sort helper ────────────────────────────────────────────────────────────────
function sortItems(items: any[], col: string | null, dir: 'asc' | 'desc', getVal: (item: any, col: string) => any): any[] {
  if (!col) return items;
  return [...items].sort((a, b) => {
    const av = getVal(a, col);
    const bv = getVal(b, col);
    if (av == null && bv == null) return 0;
    if (av == null) return 1;
    if (bv == null) return -1;
    if (typeof av === 'number' && typeof bv === 'number') return dir === 'asc' ? av - bv : bv - av;
    return dir === 'asc' ? String(av).localeCompare(String(bv)) : String(bv).localeCompare(String(av));
  });
}

function ReportDrawer({ report, onClose, orgId, userId, onUpdated, onDeleted }: any) {
  const [running, setRunning] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleRun = async () => {
    setRunning(true); setError(null);
    const { error: err } = await updateRow('reports', report.id, {
      last_run_at: new Date().toISOString(),
    });
    if (err) {
      setError(err);
      setRunning(false);
      return;
    }
    await logActivity(orgId, userId, `Report "${report.name}" run`, 'reports', report.id);
    setRunning(false);
    onUpdated();
  };

  const handleDelete = async () => {
    setDeleting(true);
    await deleteRow('reports', report.id);
    await logActivity(orgId, userId, `Report "${report.name}" deleted`, 'reports', report.id);
    setDeleting(false);
    setConfirmDelete(false);
    onDeleted();
    onClose();
  };

  const handleDownloadPDF = () => {
    if (report.pdf_url) {
      window.open(report.pdf_url, '_blank');
    }
  };

  const handleExportCSV = () => {
    // Generate CSV based on report type and filters
    const csvContent = `Report: ${report.name}\nType: ${report.report_type}\nGenerated: ${new Date().toLocaleString()}\n\n`;
    const blob = new Blob([csvContent], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${report.name.replace(/\s+/g, '_')}_${Date.now()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <>
      <Drawer
        open
        onClose={onClose}
        title={report.name}
        subtitle={`${report.report_type} Report`}
        footer={
          <div className="flex items-center gap-2">
            <button onClick={() => setConfirmDelete(true)} className="flex items-center gap-1.5 px-3 py-2 text-[13px] text-red-500 border border-red-200 rounded-lg hover:bg-red-50">
              <Trash2 size={13} />Delete
            </button>
            <button onClick={handleExportCSV} className="flex items-center gap-1.5 px-3 py-2 border border-[rgba(0,0,0,0.1)] text-[13px] text-gray-600 rounded-lg hover:bg-gray-50">
              <Download size={13} />Export CSV
            </button>
            {report.pdf_url && (
              <button onClick={handleDownloadPDF} className="flex items-center gap-1.5 px-3 py-2 border border-[rgba(0,0,0,0.1)] text-[13px] text-gray-600 rounded-lg hover:bg-gray-50">
                <FileText size={13} />Download PDF
              </button>
            )}
            <button onClick={handleRun} disabled={running} className="flex items-center gap-1.5 px-4 py-2 bg-[#3ECF8E] hover:bg-[#38c484] text-white text-[13px] font-medium rounded-lg disabled:opacity-60">
              {running ? <Loader2 size={13} className="animate-spin" /> : <PlayCircle size={13} />}Run Report
            </button>
          </div>
        }
      >
        {error && <p className="text-[12px] text-red-500 bg-red-50 px-3 py-2 rounded-lg mb-4">{error}</p>}
        <div>
          <DetailRow label="Report Name" value={report.name} />
          <DetailRow label="Type" value={report.report_type} />
          <DetailRow label="Schedule" value={report.schedule} />
          <DetailRow label="Last Run" value={report.last_run_at ? new Date(report.last_run_at).toLocaleString() : 'Never'} />
          <DetailRow label="Created" value={new Date(report.created_at).toLocaleDateString()} />
          {report.filters && Object.keys(report.filters).length > 0 && (
            <DetailRow label="Filters" value={
              <div className="text-[11px] text-gray-600 space-y-1">
                {Object.entries(report.filters).map(([key, value]) => (
                  <div key={key}>{key}: {String(value)}</div>
                ))}
              </div>
            } />
          )}
          {report.pdf_url && <DetailRow label="PDF URL" value={<a href={report.pdf_url} target="_blank" rel="noopener noreferrer" className="text-[#3ECF8E] hover:underline text-[11px]">{report.pdf_url}</a>} />}
        </div>
      </Drawer>

      <ConfirmDialog
        open={confirmDelete}
        title="Delete Report"
        description={`Delete report "${report.name}"? This action cannot be undone.`}
        confirmLabel="Delete"
        danger
        onConfirm={handleDelete}
        onCancel={() => setConfirmDelete(false)}
        loading={deleting}
      />
    </>
  );
}
export function Reports() {
  const view = useSecondaryView();
  const navigate = useNavigate();
  const { orgId, user } = useAuth();
  const [showNew, setShowNew] = useState(false);
  const _sortInit = (() => { try { return JSON.parse(localStorage.getItem('deryv.sort.reports') ?? 'null') ?? {}; } catch { return {}; } })();
  const [sortCol, setSortCol] = useState<string | null>(_sortInit.col ?? null);
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>(_sortInit.dir ?? 'asc');
  const handleSort = (col: string) => {
    const next = sortCol === col ? (sortDir === 'asc' ? 'desc' : 'asc') : 'asc';
    const nextCol = sortCol === col ? col : col;
    setSortCol(nextCol);
    setSortDir(next as 'asc' | 'desc');
    localStorage.setItem('deryv.sort.reports', JSON.stringify({ col: nextCol, dir: next }));
  };
  const [filterValues, setFilterValues] = useState<FilterValues>({});
  const [selectedReportId, setSelectedReportId] = useState<string | null>(null);

  const { data: reports, loading: reportsLoading, error: reportsError, reload: reloadReports } = useOrgQuery<any>('reports', orgId, {
    select: 'id, name, report_type, schedule, last_run_at, created_at, filters, pdf_url, created_by',
  });

  const { data: lots } = useOrgQuery<any>('lots', orgId, {
    select: 'id, lot_id, vendor_id, funding_partner_id, purchase_cost, total_msrp, status, created_at, vendors(id, name)',
  });

  const { data: vendors } = useOrgQuery<any>('vendors', orgId, { select: 'id, name' });
  const { data: partners } = useOrgQuery<any>('partners', orgId, { select: 'id, company_name' });

  const reportFilterDefs: FilterDef[] = [
    { type: 'daterange', keyFrom: 'date_from', keyTo: 'date_to', label: 'Date Range' },
    { type: 'select', key: 'vendor_id', label: 'Vendor', options: vendors.map((v: any) => ({ value: v.id, label: v.name })) },
    { type: 'select', key: 'funding_partner_id', label: 'Funding Partner', options: partners.map((p: any) => ({ value: p.id, label: p.company_name })) },
    { type: 'select', key: 'lot_id', label: 'LOT', options: lots.map((l: any) => ({ value: l.id, label: l.lot_id || l.id })) },
  ];

  const { data: orders } = useOrgQuery<any>('orders', orgId, {
    select: 'id, total_amount, status, created_at, order_items(inventory_items(lot_id, total_cost_basis, weighted_acquisition_cost, component_cost, supply_cost, shipping_cost, marketplace_fees))',
  });

  const { data: items } = useOrgQuery<any>('inventory_items', orgId, {
    select: 'id, lot_id, total_cost_basis, grade, status, created_at, date_received',
  });

  const { data: listings } = useOrgQuery<any>('marketplace_listings', orgId, {
    select: 'id, channel, status, sync_status, price, created_at',
  });

  // Apply filters to lots
  const filteredLots = useMemo(() => {
    return lots.filter((l: any) => {
      const f = filterValues;
      if (f.vendor_id && l.vendor_id !== f.vendor_id) return false;
      if (f.funding_partner_id && l.funding_partner_id !== f.funding_partner_id) return false;
      if (f.lot_id && l.id !== f.lot_id) return false;
      if (f.date_from || f.date_to) {
        const d = l.created_at ? new Date(l.created_at) : null;
        if (!d) return false;
        if (f.date_from && d < new Date(f.date_from)) return false;
        if (f.date_to && d > new Date(f.date_to)) return false;
      }
      return true;
    });
  }, [lots, filterValues]);

  // Apply filters to orders
  const filteredOrders = useMemo(() => {
    return orders.filter((o: any) => {
      const f = filterValues;
      if (f.date_from || f.date_to) {
        const d = o.created_at ? new Date(o.created_at) : null;
        if (!d) return false;
        if (f.date_from && d < new Date(f.date_from)) return false;
        if (f.date_to && d > new Date(f.date_to)) return false;
      }
      // Filter by LOT through order_items
      if (f.lot_id) {
        const hasLot = o.order_items?.some((oi: any) =>
          oi.inventory_items?.lot_id === f.lot_id
        );
        if (!hasLot) return false;
      }
      return true;
    });
  }, [orders, filterValues]);

  // Apply filters to inventory items
  const filteredItems = useMemo(() => {
    return items.filter((i: any) => {
      const f = filterValues;
      if (f.lot_id && i.lot_id !== f.lot_id) return false;
      if (f.date_from || f.date_to) {
        const d = i.date_received || i.created_at;
        if (!d) return false;
        const dateObj = new Date(d);
        if (f.date_from && dateObj < new Date(f.date_from)) return false;
        if (f.date_to && dateObj > new Date(f.date_to)) return false;
      }
      return true;
    });
  }, [items, filterValues]);

  // Hardcoded month abbreviations
  const MONTHS_SHORT = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

  const monthlyData = useMemo(() => {
    const now = new Date();
    return Array.from({ length: 6 }, (_, i) => {
      const d = new Date(now.getFullYear(), now.getMonth() - (5 - i), 1);
      const month = MONTHS_SHORT[d.getMonth()];
      const year = d.getFullYear();

      const monthOrders = filteredOrders.filter((o: any) => {
        if (!o.created_at) return false;
        const od = new Date(o.created_at);
        return od.getFullYear() === year && od.getMonth() === d.getMonth();
      });

      const revenue = monthOrders.reduce((s: number, o: any) => s + Number(o.total_amount || 0), 0);

      // Calculate actual cost from inventory items sold in these orders
      let actualCost = 0;
      monthOrders.forEach((o: any) => {
        o.order_items?.forEach((oi: any) => {
          const inv = oi.inventory_items;
          if (inv) {
            const cost = inv.total_cost_basis
              || (Number(inv.weighted_acquisition_cost || 0) + Number(inv.component_cost || 0) + Number(inv.supply_cost || 0) + Number(inv.shipping_cost || 0) + Number(inv.marketplace_fees || 0));
            actualCost += cost;
          }
        });
      });

      const grossRecovery = actualCost > 0 ? parseFloat(((revenue / actualCost) * 100).toFixed(1)) : 0;
      const netMargin = revenue > 0 ? parseFloat(((revenue - actualCost) / revenue * 100).toFixed(1)) : 0;

      return { month, grossRecovery, netMargin, revenue, cost: actualCost };
    });
  }, [filteredOrders, MONTHS_SHORT]);

  const hasMonthlyData = monthlyData.some(d => d.revenue > 0 || d.cost > 0);

  const nowMs = Date.now();
  const ageDays = (item: any): number | null => {
    const d = item.date_received || item.created_at;
    if (!d) return null;
    return (nowMs - new Date(d).getTime()) / 86400000;
  };

  const agingData = useMemo(() => [
    { range: '0–7d',   count: filteredItems.filter((i: any) => { const d = ageDays(i); return d !== null && d < 7; }).length },
    { range: '8–14d',  count: filteredItems.filter((i: any) => { const d = ageDays(i); return d !== null && d >= 8 && d < 15; }).length },
    { range: '15–30d', count: filteredItems.filter((i: any) => { const d = ageDays(i); return d !== null && d >= 15 && d < 31; }).length },
    { range: '31–60d', count: filteredItems.filter((i: any) => { const d = ageDays(i); return d !== null && d >= 31 && d < 61; }).length },
    { range: '60d+',   count: filteredItems.filter((i: any) => { const d = ageDays(i); return d !== null && d > 60; }).length },
  ], [filteredItems]);

  const hasAgingData = agingData.some(d => d.count > 0);

  // Vendor performance metrics
  const vendorMetrics = useMemo(() => {
    return vendors.map((v: any) => {
      const vLots = filteredLots.filter((l: any) => l.vendor_id === v.id);
      const activeLots = vLots.filter((l: any) => !['CLOSED', 'ARCHIVED'].includes(l.status));
      const purchaseCost = vLots.reduce((s: number, l: any) => s + Number(l.purchase_cost || 0), 0);
      const totalMSRP = vLots.reduce((s: number, l: any) => s + Number(l.total_msrp || 0), 0);

      // Calculate sold revenue from orders for this vendor's inventory
      let soldRevenue = 0;
      filteredOrders.forEach((o: any) => {
        o.order_items?.forEach((oi: any) => {
          const inv = oi.inventory_items;
          if (inv && vLots.some((l: any) => l.id === inv.lot_id)) {
            soldRevenue += Number(o.total_amount || 0) / (o.order_items?.length || 1);
          }
        });
      });

      const recoveryAmount = purchaseCost > 0 ? ((soldRevenue / purchaseCost) * 100).toFixed(1) : '0.0';

      return {
        id: v.id,
        name: v.name,
        totalLots: vLots.length,
        activeLots: activeLots.length,
        purchaseCost,
        totalMSRP,
        soldRevenue,
        recoveryAmount: parseFloat(recoveryAmount),
      };
    }).filter((v: any) => v.totalLots > 0);
  }, [vendors, filteredLots, filteredOrders]);

  // Marketplace metrics
  const marketplaceMetrics = useMemo(() => {
    const activeListings = listings.filter((l: any) => l.status === 'ACTIVE').length;
    const pendingSync = listings.filter((l: any) => l.sync_status === 'PENDING').length;
    const syncErrors = listings.filter((l: any) => l.sync_status === 'ERROR').length;
    const soldListings = listings.filter((l: any) => l.status === 'SOLD').length;

    const channelRevenue = {
      EBAY: listings.filter((l: any) => l.channel === 'EBAY' && l.status === 'SOLD').reduce((s: number, l: any) => s + Number(l.price || 0), 0),
      SHOPIFY: listings.filter((l: any) => l.channel === 'SHOPIFY' && l.status === 'SOLD').reduce((s: number, l: any) => s + Number(l.price || 0), 0),
    };

    return {
      activeListings,
      pendingSync,
      syncErrors,
      soldListings,
      channelRevenue,
    };
  }, [listings]);

  const handleExportCSV = () => {
    let csvContent = 'Type,Value\n';

    if (view === 'vendor' && vendorMetrics.length > 0) {
      csvContent = 'Vendor,Total LOTs,Active LOTs,Purchase Cost,Total MSRP,Sold Revenue,Recovery %\n';
      vendorMetrics.forEach((v: any) => {
        csvContent += `${v.name},${v.totalLots},${v.activeLots},${v.purchaseCost},${v.totalMSRP},${v.soldRevenue},${v.recoveryAmount}\n`;
      });
    } else if (view === 'marketplace') {
      csvContent = 'Metric,Value\n';
      csvContent += `Active Listings,${marketplaceMetrics.activeListings}\n`;
      csvContent += `Pending Sync,${marketplaceMetrics.pendingSync}\n`;
      csvContent += `Sync Errors,${marketplaceMetrics.syncErrors}\n`;
      csvContent += `Sold Listings,${marketplaceMetrics.soldListings}\n`;
      csvContent += `eBay Revenue,${marketplaceMetrics.channelRevenue.EBAY}\n`;
      csvContent += `Shopify Revenue,${marketplaceMetrics.channelRevenue.SHOPIFY}\n`;
    } else {
      csvContent += `Total Orders,${filteredOrders.length}\n`;
      csvContent += `Total Revenue,${filteredOrders.reduce((s: number, o: any) => s + Number(o.total_amount || 0), 0)}\n`;
      csvContent += `Total LOTs,${filteredLots.length}\n`;
      csvContent += `Inventory Items,${filteredItems.length}\n`;
    }

    const blob = new Blob([csvContent], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `report_${Date.now()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const selectedReport = reports.find((r: any) => r.id === selectedReportId) ?? null;

  const handleReportUpdated = () => {
    reloadReports();
  };

  const handleReportDeleted = () => {
    setSelectedReportId(null);
  };

  // Close drawer if report no longer exists after reload
  useEffect(() => {
    if (selectedReportId && !reportsLoading && !reports.find((r: any) => r.id === selectedReportId)) {
      setSelectedReportId(null);
    }
  }, [reports, reportsLoading, selectedReportId]);

  const activeFilterCount = Object.keys(filterValues).filter(k => filterValues[k]).length;



  const sorted = sortItems(vendorMetrics, sortCol, sortDir, (item: any, col: string) => {
    if (col === 'name') return item.name;
    if (col === 'totalLots') return Number(item.totalLots ?? 0);
    if (col === 'activeLots') return Number(item.activeLots ?? 0);
    if (col === 'cost') return Number(item.purchaseCost ?? 0);
    if (col === 'msrp') return Number(item.totalMSRP ?? 0);
    if (col === 'revenue') return Number(item.soldRevenue ?? 0);
    if (col === 'recovery') return Number(item.recoveryAmount ?? 0);
    return null;
  });

  return (
    <div className="p-3 sm:p-6 max-w-[1200px] space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-gray-900">Reports</h2>
          <p className="text-[13px] text-gray-400 mt-0.5">Operational analytics and export</p>
        </div>
        <div className="flex gap-1.5">
          <button onClick={handleExportCSV} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-[rgba(0,0,0,0.1)] text-[13px] text-gray-600 hover:bg-gray-50">
            <Download size={13} />Export CSV
          </button>
          <button onClick={() => setShowNew(true)} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#3ECF8E] hover:bg-[#38c484] text-white text-[13px] font-medium">
            <Plus size={13} />New Report
          </button>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-[rgba(0,0,0,0.07)] overflow-hidden">
        <FilterBar defs={reportFilterDefs} values={filterValues} onChange={setFilterValues} />
        {activeFilterCount > 0 && (
          <div className="px-5 py-2 border-t border-[rgba(0,0,0,0.06)] flex items-center gap-2">
            <span className="text-[11px] text-gray-400">Active filters:</span>
            <div className="flex gap-1.5 flex-wrap">
              {Object.entries(filterValues).filter(([_, v]) => v).map(([key, value]) => {
                let label = key;
                let displayValue = String(value);

                if (key === 'vendor_id') {
                  const v = vendors.find((v: any) => v.id === value);
                  label = 'Vendor';
                  displayValue = v?.name || value;
                } else if (key === 'funding_partner_id') {
                  const p = partners.find((p: any) => p.id === value);
                  label = 'Partner';
                  displayValue = p?.company_name || value;
                } else if (key === 'lot_id') {
                  const l = lots.find((l: any) => l.id === value);
                  label = 'LOT';
                  displayValue = l?.lot_id || l?.id || value;
                }

                return (
                  <span key={key} className="text-[11px] bg-[#ECFDF5] text-[#15803d] px-2 py-0.5 rounded-full">
                    {label}: {displayValue}
                  </span>
                );
              })}
            </div>
            <button onClick={() => setFilterValues({})} className="ml-auto text-[11px] text-gray-500 hover:text-gray-700 underline">
              Clear Filters
            </button>
          </div>
        )}
      </div>

      {(view === 'overview' || view === 'recovery' || view === 'margins') && (
        <div className="bg-white rounded-xl border border-[rgba(0,0,0,0.07)] p-5">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="text-[13px] font-semibold text-gray-900">Recovery & Margin Trend</h3>
              <p className="text-[11px] text-gray-400 mt-0.5">Last 6 months · {filteredOrders.length} filtered orders</p>
            </div>
          </div>
          {hasMonthlyData ? (
            <ResponsiveContainer width="100%" height={180}>
              <LineChart data={monthlyData} margin={{ top: 4, right: 8, left: -24, bottom: 4 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(0,0,0,0.04)" />
                <XAxis dataKey="month" tick={{ fontSize: 11, fill: '#9CA3AF' }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 11, fill: '#9CA3AF' }} axisLine={false} tickLine={false} />
                <Tooltip {...tooltipStyle} formatter={(v: number) => `${v}%`} />
                <Legend wrapperStyle={{ fontSize: 11, color: '#9CA3AF' }} />
                <Line type="monotone" dataKey="grossRecovery" stroke="#3ECF8E" strokeWidth={2} dot={{ r: 2.5, fill: '#3ECF8E' }} name="Gross Recovery %" />
                <Line type="monotone" dataKey="netMargin" stroke="#9CA3AF" strokeWidth={2} dot={{ r: 2.5, fill: '#9CA3AF' }} name="Net Margin %" />
              </LineChart>
            </ResponsiveContainer>
          ) : (
            <div className="h-[180px] flex items-center justify-center text-[13px] text-gray-400">
              No order or inventory cost data available for selected filters.
            </div>
          )}
        </div>
      )}

      {(view === 'overview' || view === 'aging') && (
        <div className="bg-white rounded-xl border border-[rgba(0,0,0,0.07)] p-5">
          <h3 className="text-[13px] font-semibold text-gray-900 mb-1">Inventory Aging</h3>
          <p className="text-[11px] text-gray-400 mb-4">{filteredItems.length} filtered items</p>
          {hasAgingData ? (
            <ResponsiveContainer width="100%" height={120}>
              <BarChart data={agingData} margin={{ top: 4, right: 8, left: -24, bottom: 4 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(0,0,0,0.04)" />
                <XAxis dataKey="range" tick={{ fontSize: 11, fill: '#9CA3AF' }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 11, fill: '#9CA3AF' }} axisLine={false} tickLine={false} />
                <Tooltip {...tooltipStyle} />
                <Bar dataKey="count" fill="#D1D5DB" radius={[3, 3, 0, 0]} name="Items" />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <div className="h-[120px] flex items-center justify-center text-[13px] text-gray-400">
              No inventory items match selected filters.
            </div>
          )}
        </div>
      )}

      {view === 'vendor' && (
        <div className="bg-white rounded-xl border border-[rgba(0,0,0,0.07)] overflow-hidden">
          <div className="px-5 py-3.5 border-b border-[rgba(0,0,0,0.06)] flex items-center justify-between">
            <h3 className="text-[13px] font-semibold text-gray-900">Vendor Performance</h3>
            <span className="text-[12px] text-gray-400">{vendorMetrics.length} vendors with LOTs</span>
          </div>
          {vendorMetrics.length === 0 ? (
            <EmptyState title="No vendor data" description="Vendor performance will show once LOTs are assigned to vendors." />
          ) : (
            <>
              {/* Mobile card list */}
              <div className="sm:hidden divide-y divide-[rgba(0,0,0,0.05)]">
                {vendorMetrics.map((v: any) => (
                  <div key={v.id} onClick={() => navigate(`/partners/vendors?selected=${v.id}`)}
                    className="px-3 py-3 hover:bg-gray-50 active:bg-gray-100 cursor-pointer">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-[13px] font-medium text-gray-900">{v.name}</p>
                      <span className="text-[14px] font-semibold text-gray-900 tabular-nums">{v.recoveryAmount}%</span>
                    </div>
                    <div className="flex items-center gap-3 mt-1 flex-wrap">
                      <span className="text-[11px] text-gray-500">{v.totalLots} LOTs · <span className="text-[#16a34a] font-medium">{v.activeLots} active</span></span>
                      <span className="text-[11px] text-gray-400">${v.purchaseCost.toLocaleString()} cost</span>
                      <span className="text-[11px] text-gray-400">${v.soldRevenue.toFixed(0)} sold</span>
                    </div>
                  </div>
                ))}
              </div>
              {/* Desktop table */}
              <div className="hidden sm:block overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-[rgba(0,0,0,0.06)]">
                      {([
                        { label: 'Vendor', col: 'name' },
                        { label: 'Total LOTs', col: 'totalLots' },
                        { label: 'Active LOTs', col: 'activeLots' },
                        { label: 'Purchase Cost', col: 'cost' },
                        { label: 'Total MSRP', col: 'msrp' },
                        { label: 'Sold Revenue', col: 'revenue' },
                        { label: 'Recovery %', col: 'recovery' },
                      ] as const).map(({ label, col }) => (
                        <th key={col} onClick={() => handleSort(col)}
                          className="text-left px-5 py-2.5 text-[11px] font-medium text-gray-400 uppercase tracking-wide whitespace-nowrap cursor-pointer select-none hover:text-gray-600 transition-colors">
                          <span className="inline-flex items-center gap-1">
                            {label}
                            {sortCol === col ? <span className="text-[#3ECF8E]">{sortDir === 'asc' ? '↑' : '↓'}</span> : <span className="opacity-0">↕</span>}
                          </span>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {sorted.map((v: any, i: number) => (
                      <tr
                        key={v.id}
                        onClick={() => navigate(`/partners/vendors?selected=${v.id}`)}
                        className={`hover:bg-gray-50/70 cursor-pointer transition-colors ${i < sorted.length-1 ? 'border-b border-[rgba(0,0,0,0.04)]' : ''}`}
                      >
                        <td className="px-5 py-3 text-[13px] font-medium text-gray-900">{v.name}</td>
                        <td className="px-5 py-3 text-[13px] text-gray-600 tabular-nums">{v.totalLots}</td>
                        <td className="px-5 py-3 text-[13px] font-semibold text-[#16a34a] tabular-nums">{v.activeLots}</td>
                        <td className="px-5 py-3 text-[13px] text-gray-600 tabular-nums">${v.purchaseCost.toLocaleString()}</td>
                        <td className="px-5 py-3 text-[13px] text-gray-600 tabular-nums">${v.totalMSRP.toLocaleString()}</td>
                        <td className="px-5 py-3 text-[13px] text-gray-600 tabular-nums">${v.soldRevenue.toFixed(2)}</td>
                        <td className="px-5 py-3 text-[13px] font-semibold text-gray-900 tabular-nums">{v.recoveryAmount}%</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      )}


      {view === 'marketplace' && (
        <div className="space-y-5">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-px bg-[rgba(0,0,0,0.07)] rounded-xl overflow-hidden border border-[rgba(0,0,0,0.07)]">
            {[
              { label: 'Active Listings', value: marketplaceMetrics.activeListings, green: true },
              { label: 'Pending Sync', value: marketplaceMetrics.pendingSync },
              { label: 'Sync Errors', value: marketplaceMetrics.syncErrors, red: marketplaceMetrics.syncErrors > 0 },
              { label: 'Sold', value: marketplaceMetrics.soldListings },
            ].map(stat => (
              <div key={stat.label} className="bg-white px-5 py-4">
                <p className={`text-xl font-semibold ${(stat as any).green ? 'text-[#16a34a]' : (stat as any).red ? 'text-red-500' : 'text-gray-900'}`}>{stat.value}</p>
                <p className="text-[11px] text-gray-400 mt-1">{stat.label}</p>
              </div>
            ))}
          </div>

          <div className="bg-white rounded-xl border border-[rgba(0,0,0,0.07)] p-5">
            <h3 className="text-[13px] font-semibold text-gray-900 mb-4">Revenue by Channel</h3>
            <div className="space-y-3">
              {Object.entries(marketplaceMetrics.channelRevenue).map(([channel, revenue]) => (
                <div key={channel} className="flex items-center justify-between">
                  <span className="text-[13px] text-gray-700">{channel}</span>
                  <span className="text-[15px] font-semibold text-gray-900 tabular-nums">${(revenue as number).toLocaleString()}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="flex gap-2">
            <button onClick={() => navigate('/marketplace/all')} className="flex-1 px-4 py-2 border border-[rgba(0,0,0,0.1)] rounded-lg text-[13px] text-gray-600 hover:bg-gray-50">
              View All Listings
            </button>
            <button onClick={() => navigate('/marketplace/error')} className="flex-1 px-4 py-2 border border-[rgba(0,0,0,0.1)] rounded-lg text-[13px] text-gray-600 hover:bg-gray-50">
              View Sync Errors
            </button>
          </div>
        </div>
      )}

      {(view === 'overview' || view === 'saved') && (
        <div className="bg-white rounded-xl border border-[rgba(0,0,0,0.07)] overflow-hidden">
          <div className="px-5 py-3.5 border-b border-[rgba(0,0,0,0.06)] flex items-center justify-between">
            <h3 className="text-[13px] font-semibold text-gray-900">Saved Reports</h3>
            <span className="text-[12px] text-gray-400">{reports.length} reports</span>
          </div>
          {reportsLoading ? (
            <div className="divide-y divide-[rgba(0,0,0,0.04)]">{[1,2,3].map(i => <div key={i} className="h-12 px-5 py-3 flex items-center"><div className="h-4 w-48 bg-gray-100 animate-pulse rounded" /></div>)}</div>
          ) : reportsError ? <ErrorState message={reportsError} onRetry={reloadReports} />
          : reports.length === 0 ? (
            <EmptyState title="No saved reports" description="Create your first report." action={{ label: 'New Report', onClick: () => setShowNew(true) }} />
          ) : (
            <div>
              {reports.map((r: any, i: number) => (
                <div
                  key={r.id}
                  onClick={() => setSelectedReportId(r.id)}
                  className={`flex items-center justify-between px-5 py-3.5 hover:bg-gray-50/70 cursor-pointer transition-colors ${selectedReportId === r.id ? 'bg-[#F0FDF4]' : ''} ${i < reports.length-1 ? 'border-b border-[rgba(0,0,0,0.04)]' : ''}`}
                >
                  <div>
                    <p className="text-[13px] font-medium text-gray-900">{r.name}</p>
                    <p className="text-[11px] text-gray-400 mt-0.5">{r.schedule} · {r.last_run_at ? `Last run ${new Date(r.last_run_at).toLocaleDateString()}` : 'Never run'}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-[11px] text-gray-400 bg-gray-100 px-2 py-0.5 rounded-full">{r.report_type}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="bg-white rounded-xl border border-[rgba(0,0,0,0.07)] p-5">
        <h3 className="text-[13px] font-semibold text-gray-900 mb-3">Export Options</h3>
        <div className="flex gap-2 flex-wrap">
          <button onClick={handleExportCSV} className="flex items-center gap-1.5 px-3 py-1.5 border border-[rgba(0,0,0,0.08)] rounded-lg text-[13px] text-gray-600 hover:bg-gray-50 transition-colors">
            <Download size={11} />CSV
          </button>
          <button disabled title="Excel export requires xlsx library integration" className="flex items-center gap-1.5 px-3 py-1.5 border border-[rgba(0,0,0,0.08)] rounded-lg text-[13px] text-gray-400 cursor-not-allowed opacity-60">
            <Download size={11} />Excel
          </button>
          <button disabled title="PDF generation requires jsPDF library integration" className="flex items-center gap-1.5 px-3 py-1.5 border border-[rgba(0,0,0,0.08)] rounded-lg text-[13px] text-gray-400 cursor-not-allowed opacity-60">
            <Download size={11} />PDF Report
          </button>
          <button disabled title="QuickBooks integration not connected" className="flex items-center gap-1.5 px-3 py-1.5 border border-[rgba(0,0,0,0.08)] rounded-lg text-[13px] text-gray-400 cursor-not-allowed opacity-60">
            <Download size={11} />QuickBooks Export
          </button>
        </div>
      </div>

      <NewReportModal
        open={showNew}
        onClose={() => setShowNew(false)}
        orgId={orgId}
        userId={user?.id}
        currentFilters={filterValues}
        onCreated={reloadReports}
      />

      {selectedReport && (
        <ReportDrawer
          report={selectedReport}
          onClose={() => setSelectedReportId(null)}
          orgId={orgId}
          userId={user?.id}
          onUpdated={handleReportUpdated}
          onDeleted={handleReportDeleted}
        />
      )}
    </div>
  );
}
